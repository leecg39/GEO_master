<?php
/**
 * Yoast SEO tools for WP x MCP.
 *
 * Ports the Yoast SEO tool set from MountDev AI MCP Connector
 * into wp-x-mcp's procedural tool registry style.
 *
 * 29 tools total:
 *   23 free  — post meta, social meta, canonical, analyses, schema, sitemap,
 *              robots, breadcrumb, term SEO, global settings, post-type config
 *    6 premium — redirects (list/create/update/delete), multiple keywords,
 *              inclusive language score
 *
 * Free tools register only when Yoast SEO is active. Premium tools additionally
 * require Yoast SEO Premium to be active. Each handler also runtime-guards so a
 * deactivation between registration and execution fails clean rather than
 * fatal-ing on missing classes.
 *
 * Many operations call current_user_can() in MountDev. Those per-user checks
 * are intentionally NOT ported — wp-x-mcp gates by API-key risk scope, not by
 * WP user capability. The risk classification (read / write / destructive)
 * on each tool is the access boundary.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Yoast {

	/* -------------------------------------------------------------------------
	 * Plugin-detection guards.
	 * ---------------------------------------------------------------------- */

	public static function is_active(): bool {
		if ( class_exists( 'WPSEO_Meta' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'wordpress-seo/wp-seo.php' );
	}

	public static function is_premium_active(): bool {
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		if ( is_plugin_active( 'wordpress-seo-premium/wp-seo-premium.php' ) ) {
			return true;
		}
		if ( class_exists( 'WPSEO_Premium' ) || class_exists( 'Yoast\WP\SEO\Premium\Main' ) ) {
			return true;
		}
		if ( class_exists( 'WPSEO_Redirect_Manager' ) || class_exists( 'Yoast\WP\SEO\Premium\Routes\Redirect_Route' ) ) {
			return true;
		}
		return false;
	}

	/* -------------------------------------------------------------------------
	 * Shared helpers (kept static so closures can reference them).
	 * ---------------------------------------------------------------------- */

	/**
	 * Resolve $args['post_id'] into a WP_Post, throwing on any guard failure.
	 * Also asserts Yoast is loaded (WPSEO_Meta class present).
	 */
	public static function require_post( array $a ) {
		if ( ! self::is_active() ) {
			throw new Exception( 'Yoast SEO is not active.' );
		}
		$id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
		if ( ! $id ) {
			throw new Exception( 'Invalid post ID provided.' );
		}
		$post = get_post( $id );
		if ( ! $post ) {
			throw new Exception( 'Post not found.' );
		}
		if ( ! class_exists( 'WPSEO_Meta' ) ) {
			throw new Exception( 'Yoast SEO is not available.' );
		}
		return $post;
	}

	public static function score_label( $score ): string {
		$score = intval( $score );
		if ( $score >= 80 ) return 'good';
		if ( $score >= 60 ) return 'ok';
		if ( $score > 0 )  return 'poor';
		return 'not_available';
	}

	public static function reading_level( $score ): string {
		$score = intval( $score );
		if ( $score >= 80 ) return 'easy';
		if ( $score >= 60 ) return 'fairly_easy';
		if ( $score >= 40 ) return 'fairly_difficult';
		if ( $score > 0 )  return 'difficult';
		return 'not_available';
	}

	/** Keyword-in-content analysis (shared by free and premium tools). */
	public static function analyze_keyword( string $keyword, $post ): array {
		$content_text = strtolower( strip_tags( $post->post_content ) );
		$title_text   = strtolower( $post->post_title );
		$kw           = strtolower( $keyword );

		$content_count = substr_count( $content_text, $kw );
		$title_count   = substr_count( $title_text, $kw );
		$word_count    = str_word_count( strip_tags( $post->post_content ) );
		$density       = $word_count > 0 ? ( $content_count / $word_count ) * 100 : 0;

		return array(
			'in_title'            => $title_count > 0,
			'title_occurrences'   => $title_count,
			'content_occurrences' => $content_count,
			'keyword_density'     => round( $density, 2 ),
			'word_count'          => $word_count,
		);
	}

	/* -------------------------------------------------------------------------
	 * Redirect helpers (Premium only; preserved verbatim from MountDev).
	 * ---------------------------------------------------------------------- */

	public static function format_redirects( $redirects, $type, $search, $page, $per_page ): array {
		$formatted = array();
		foreach ( $redirects as $r ) {
			$item = array(
				'origin' => $r->get_origin(),
				'target' => $r->get_target(),
				'type'   => $r->get_type(),
				'format' => $r->get_format(),
			);
			if ( ! empty( $type ) && (string) $item['type'] !== $type ) continue;
			if ( ! empty( $search ) && stripos( $item['origin'], $search ) === false && stripos( $item['target'], $search ) === false ) continue;
			$formatted[] = $item;
		}
		return array_slice( $formatted, ( $page - 1 ) * $per_page, $per_page );
	}

	public static function format_legacy_redirects( $redirects, $type, $search, $page, $per_page ): array {
		$formatted = array();
		foreach ( $redirects as $origin => $r ) {
			$item = array(
				'origin' => $origin,
				'target' => $r['url'] ?? '',
				'type'   => $r['type'] ?? 301,
				'format' => $r['format'] ?? 'plain',
			);
			if ( ! empty( $type ) && (string) $item['type'] !== $type ) continue;
			if ( ! empty( $search ) && stripos( $item['origin'], $search ) === false && stripos( $item['target'], $search ) === false ) continue;
			$formatted[] = $item;
		}
		return array_slice( $formatted, ( $page - 1 ) * $per_page, $per_page );
	}

	public static function parse_option_redirects( $redirects, string $format ): array {
		$parsed = array();
		if ( ! is_array( $redirects ) ) return $parsed;
		foreach ( $redirects as $origin => $r ) {
			$parsed[] = array(
				'origin' => $origin,
				'target' => $r['url'] ?? '',
				'type'   => isset( $r['type'] ) ? (int) $r['type'] : 301,
				'format' => $format,
			);
		}
		return $parsed;
	}

	public static function filter_redirects( $redirects, $type, $search, $page, $per_page ): array {
		$filtered = array();
		foreach ( $redirects as $r ) {
			if ( ! empty( $type ) && (string) $r['type'] !== $type ) continue;
			if ( ! empty( $search ) && stripos( $r['origin'], $search ) === false && stripos( $r['target'], $search ) === false ) continue;
			$filtered[] = $r;
		}
		return array_slice( $filtered, ( $page - 1 ) * $per_page, $per_page );
	}

	public static function single_post_type_settings( string $post_type ): array {
		$pt_obj          = get_post_type_object( $post_type );
		$has_archive     = $pt_obj ? (bool) $pt_obj->has_archive : false;
		$noindex_archive = $has_archive ? (bool) WPSEO_Options::get( 'noindex-ptarchive-' . $post_type ) : null;

		$tax_settings = array();
		foreach ( get_object_taxonomies( $post_type, 'objects' ) as $tax ) {
			$tax_settings[ $tax->name ] = array(
				'noindex' => (bool) WPSEO_Options::get( 'noindex-tax-' . $tax->name ),
			);
		}

		return array(
			'post_type'       => $post_type,
			'noindex'         => (bool) WPSEO_Options::get( 'noindex-' . $post_type ),
			'not_in_sitemap'  => (bool) WPSEO_Options::get( 'post_types-' . $post_type . '-not_in_sitemap' ),
			'has_archive'     => $has_archive,
			'noindex_archive' => $noindex_archive,
			'taxonomies'      => $tax_settings,
		);
	}

	/* -------------------------------------------------------------------------
	 * Registry.
	 * ---------------------------------------------------------------------- */

	public static function all(): array {
		if ( ! self::is_active() ) {
			return array();
		}

		$reg = array();

		// ============================================================
		// FREE — read tools (8)
		// ============================================================

		$reg['yoast_get_post_meta'] = array(
			'desc'     => 'Get Yoast SEO meta for a post: title, description, focus keyword, canonical URL.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				return array(
					'post_id'          => $id,
					'post_title'       => $post->post_title,
					'seo_title'        => WPSEO_Meta::get_value( 'title', $id ) ?: '',
					'meta_description' => WPSEO_Meta::get_value( 'metadesc', $id ) ?: '',
					'focus_keyword'    => WPSEO_Meta::get_value( 'focuskw', $id ) ?: '',
					'canonical_url'    => WPSEO_Meta::get_value( 'canonical', $id ) ?: '',
				);
			},
		);

		$reg['yoast_get_social_meta'] = array(
			'desc'     => 'Get Yoast SEO social meta for a post: Open Graph and Twitter Card fields.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				return array(
					'post_id'      => $id,
					'open_graph'   => array(
						'title'       => WPSEO_Meta::get_value( 'opengraph-title', $id ) ?: '',
						'description' => WPSEO_Meta::get_value( 'opengraph-description', $id ) ?: '',
						'image'       => WPSEO_Meta::get_value( 'opengraph-image', $id ) ?: '',
					),
					'twitter_card' => array(
						'title'       => WPSEO_Meta::get_value( 'twitter-title', $id ) ?: '',
						'description' => WPSEO_Meta::get_value( 'twitter-description', $id ) ?: '',
						'image'       => WPSEO_Meta::get_value( 'twitter-image', $id ) ?: '',
					),
				);
			},
		);

		$reg['yoast_get_canonical_url'] = array(
			'desc'     => 'Get the canonical URL for a post as set in Yoast SEO. Falls back to WPSEO_Frontend canonical, then post permalink.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post   = WPXMCP_Tools_Yoast::require_post( $a );
				$id     = $post->ID;
				$custom = WPSEO_Meta::get_value( 'canonical', $id );
				$canon  = $custom;
				if ( empty( $canon ) && class_exists( 'WPSEO_Frontend' ) ) {
					$canon = WPSEO_Frontend::get_instance()->canonical( false );
				}
				if ( empty( $canon ) ) {
					$canon = get_permalink( $id );
				}
				return array(
					'post_id'       => $id,
					'canonical_url' => $canon ?: '',
					'is_custom'     => ! empty( $custom ),
				);
			},
		);

		$reg['yoast_analyze_content'] = array(
			'desc'     => 'Get comprehensive Yoast SEO analysis for a post: focus keyword, score, label, problems/improvements/good_results.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$kw   = WPSEO_Meta::get_value( 'focuskw', $id );
				$seo  = WPSEO_Meta::get_value( 'linkdex', $id );

				$out = array(
					'post_id'       => $id,
					'focus_keyword' => $kw ?: '',
					'seo_score'     => $seo ? intval( $seo ) : 0,
					'score_label'   => WPXMCP_Tools_Yoast::score_label( $seo ),
					'assessments'   => array(),
				);

				if ( function_exists( 'YoastSEO' ) && method_exists( YoastSEO(), 'meta' ) ) {
					$surface = YoastSEO()->meta;
					if ( $surface && method_exists( $surface, 'for_post' ) ) {
						$pm = $surface->for_post( $id );
						if ( $pm ) {
							$out['assessments'] = array(
								'problems'     => $pm->get_seo_problems() ?: array(),
								'improvements' => $pm->get_seo_improvements() ?: array(),
								'good_results' => $pm->get_seo_good_results() ?: array(),
							);
						}
					}
				}

				return $out;
			},
		);

		$reg['yoast_get_readability_score'] = array(
			'desc'     => 'Get Flesch Reading Ease score and readability assessments for a post.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post  = WPXMCP_Tools_Yoast::require_post( $a );
				$id    = $post->ID;
				$score = WPSEO_Meta::get_value( 'content_score', $id );

				$out = array(
					'post_id'           => $id,
					'readability_score' => $score ? intval( $score ) : 0,
					'score_label'       => WPXMCP_Tools_Yoast::score_label( $score ),
					'reading_level'     => WPXMCP_Tools_Yoast::reading_level( $score ),
					'assessments'       => array(),
				);

				if ( function_exists( 'YoastSEO' ) && method_exists( YoastSEO(), 'meta' ) ) {
					$surface = YoastSEO()->meta;
					if ( $surface && method_exists( $surface, 'for_post' ) ) {
						$pm = $surface->for_post( $id );
						if ( $pm ) {
							$out['assessments'] = array(
								'problems'     => $pm->get_readability_problems() ?: array(),
								'improvements' => $pm->get_readability_improvements() ?: array(),
								'good_results' => $pm->get_readability_good_results() ?: array(),
							);
						}
					}
				}

				return $out;
			},
		);

		$reg['yoast_get_keyword_analysis'] = array(
			'desc'     => 'Analyze focus keyword usage in a post: occurrences in title and content, keyword density.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$kw   = WPSEO_Meta::get_value( 'focuskw', $id );
				if ( empty( $kw ) ) {
					return array(
						'post_id'       => $id,
						'focus_keyword' => '',
						'has_keyword'   => false,
						'message'       => 'No focus keyword set for this post.',
					);
				}
				$an = WPXMCP_Tools_Yoast::analyze_keyword( $kw, $post );
				return array(
					'post_id'             => $id,
					'focus_keyword'       => $kw,
					'has_keyword'         => true,
					'in_title'            => $an['in_title'],
					'title_occurrences'   => $an['title_occurrences'],
					'content_occurrences' => $an['content_occurrences'],
					'keyword_density'     => $an['keyword_density'],
					'word_count'          => $an['word_count'],
				);
			},
		);

		$reg['yoast_get_internal_links'] = array(
			'desc'     => 'Inventory internal vs external links inside a post body, plus 5 related-post suggestions matched on the focus keyword.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post     = WPXMCP_Tools_Yoast::require_post( $a );
				$id       = $post->ID;
				$site_url = get_site_url();

				preg_match_all( '/<a\s+(?:[^>]*?\s+)?href=(["\'])(.*?)\1/i', $post->post_content, $m );
				$internal = array();
				$external = array();
				foreach ( ( $m[2] ?? array() ) as $url ) {
					if ( strpos( $url, $site_url ) === 0 || strpos( $url, '/' ) === 0 ) {
						$internal[] = $url;
					} else {
						$external[] = $url;
					}
				}

				$suggestions = array();
				$kw          = WPSEO_Meta::get_value( 'focuskw', $id );
				if ( ! empty( $kw ) ) {
					$related = get_posts( array(
						'post_type'      => $post->post_type,
						'posts_per_page' => 5,
						'post__not_in'   => array( $id ),
						's'              => $kw,
						'orderby'        => 'relevance',
					) );
					foreach ( $related as $r ) {
						$suggestions[] = array(
							'id'    => $r->ID,
							'title' => $r->post_title,
							'url'   => get_permalink( $r->ID ),
						);
					}
				}

				return array(
					'post_id'              => $id,
					'internal_links_count' => count( $internal ),
					'external_links_count' => count( $external ),
					'internal_links'       => array_values( array_unique( $internal ) ),
					'suggestions'          => $suggestions,
				);
			},
		);

		$reg['yoast_check_cornerstone'] = array(
			'desc'     => 'Check cornerstone-content status for a post. If marked cornerstone, also returns SEO/readability scores and improvement recommendations.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$cs   = WPSEO_Meta::get_value( 'is_cornerstone', $id );

				$out = array(
					'post_id'        => $id,
					'is_cornerstone' => (bool) $cs,
				);

				if ( $cs ) {
					$seo  = WPSEO_Meta::get_value( 'linkdex', $id );
					$read = WPSEO_Meta::get_value( 'content_score', $id );
					$rec  = array();
					if ( intval( $seo ) < 70 ) {
						$rec[] = 'Cornerstone content should have a good SEO score (70+). Consider improving SEO.';
					}
					if ( intval( $read ) < 60 ) {
						$rec[] = 'Cornerstone content should be easily readable. Consider improving readability.';
					}
					$out['seo_score']         = $seo ? intval( $seo ) : 0;
					$out['readability_score'] = $read ? intval( $read ) : 0;
					$out['seo_label']         = WPXMCP_Tools_Yoast::score_label( $seo );
					$out['readability_label'] = WPXMCP_Tools_Yoast::score_label( $read );
					$out['recommendations']   = $rec;
				} else {
					$out['message'] = 'This post is not marked as cornerstone content.';
				}

				return $out;
			},
		);

		// ============================================================
		// FREE — write tools (5 post meta updates)
		// ============================================================

		$reg['yoast_update_post_meta'] = array(
			'desc'     => 'Update Yoast SEO meta for a post. Pass any subset of seo_title, meta_description, focus_keyword, canonical_url.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'          => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'seo_title'        => array( 'type' => 'string', 'description' => 'SEO title.' ),
				'meta_description' => array( 'type' => 'string', 'description' => 'Meta description.' ),
				'focus_keyword'    => array( 'type' => 'string', 'description' => 'Focus keyword.' ),
				'canonical_url'    => array( 'type' => 'string', 'description' => 'Canonical URL.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post    = WPXMCP_Tools_Yoast::require_post( $a );
				$id      = $post->ID;
				$updated = array();

				if ( isset( $a['seo_title'] ) ) {
					$v = sanitize_text_field( $a['seo_title'] );
					WPSEO_Meta::set_value( 'title', $v, $id );
					$updated['seo_title'] = $v;
				}
				if ( isset( $a['meta_description'] ) ) {
					$v = sanitize_textarea_field( $a['meta_description'] );
					WPSEO_Meta::set_value( 'metadesc', $v, $id );
					$updated['meta_description'] = $v;
				}
				if ( isset( $a['focus_keyword'] ) ) {
					$v = sanitize_text_field( $a['focus_keyword'] );
					WPSEO_Meta::set_value( 'focuskw', $v, $id );
					$updated['focus_keyword'] = $v;
				}
				if ( isset( $a['canonical_url'] ) ) {
					$v = esc_url_raw( $a['canonical_url'] );
					WPSEO_Meta::set_value( 'canonical', $v, $id );
					$updated['canonical_url'] = $v;
				}

				return array(
					'post_id'        => $id,
					'success'        => true,
					'updated_fields' => $updated,
					'message'        => 'SEO meta data updated successfully.',
				);
			},
		);

		$reg['yoast_update_social_meta'] = array(
			'desc'     => 'Update Yoast SEO social meta for a post (Open Graph and Twitter Card). Only provided fields are updated.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'             => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'og_title'            => array( 'type' => 'string', 'description' => 'Open Graph title.' ),
				'og_description'      => array( 'type' => 'string', 'description' => 'Open Graph description.' ),
				'og_image'            => array( 'type' => 'string', 'description' => 'Open Graph image URL.' ),
				'twitter_title'       => array( 'type' => 'string', 'description' => 'Twitter Card title.' ),
				'twitter_description' => array( 'type' => 'string', 'description' => 'Twitter Card description.' ),
				'twitter_image'       => array( 'type' => 'string', 'description' => 'Twitter Card image URL.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post    = WPXMCP_Tools_Yoast::require_post( $a );
				$id      = $post->ID;
				$updated = array();

				$str_map = array(
					'og_title'            => array( 'opengraph-title', 'sanitize_text_field' ),
					'og_description'      => array( 'opengraph-description', 'sanitize_textarea_field' ),
					'og_image'            => array( 'opengraph-image', 'esc_url_raw' ),
					'twitter_title'       => array( 'twitter-title', 'sanitize_text_field' ),
					'twitter_description' => array( 'twitter-description', 'sanitize_textarea_field' ),
					'twitter_image'       => array( 'twitter-image', 'esc_url_raw' ),
				);
				foreach ( $str_map as $arg_key => list( $meta_key, $sanitizer ) ) {
					if ( isset( $a[ $arg_key ] ) ) {
						$v = call_user_func( $sanitizer, $a[ $arg_key ] );
						WPSEO_Meta::set_value( $meta_key, $v, $id );
						$updated[ $arg_key ] = $v;
					}
				}

				return array(
					'post_id'        => $id,
					'success'        => true,
					'updated_fields' => $updated,
					'message'        => 'Social meta data updated successfully.',
				);
			},
		);

		$reg['yoast_set_canonical_url'] = array(
			'desc'     => 'Set or remove the custom canonical URL for a post. Pass empty string to remove.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'       => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'canonical_url' => array( 'type' => 'string', 'description' => 'Canonical URL (empty string removes the custom canonical).' ),
			),
			'required' => array( 'post_id', 'canonical_url' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$raw  = trim( (string) $a['canonical_url'] );
				if ( '' !== $raw ) {
					$raw = esc_url_raw( $raw );
					if ( '' === $raw ) {
						throw new Exception( 'Invalid canonical URL provided.' );
					}
				}
				WPSEO_Meta::set_value( 'canonical', $raw, $id );
				return array(
					'post_id'       => $id,
					'success'       => true,
					'canonical_url' => $raw,
					'is_custom'     => '' !== $raw,
					'message'       => '' === $raw ? 'Custom canonical URL removed.' : 'Canonical URL set successfully.',
				);
			},
		);

		$reg['yoast_get_schema'] = array(
			'desc'     => 'Get Yoast schema configuration for a post (schema_page_type + schema_article_type) and the rendered schema output where available.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$page = WPSEO_Meta::get_value( 'schema_page_type', $id );
				$art  = WPSEO_Meta::get_value( 'schema_article_type', $id );
				if ( empty( $page ) ) {
					$page = 'WebPage';
				}
				if ( empty( $art ) && 'post' === $post->post_type ) {
					$art = 'Article';
				}

				$out = array(
					'post_id'             => $id,
					'post_type'           => $post->post_type,
					'schema_page_type'    => $page,
					'schema_article_type' => $art ?: '',
				);

				if ( class_exists( 'Yoast\WP\SEO\Generators\Schema\Abstract_Schema_Piece' ) && function_exists( 'YoastSEO' ) ) {
					try {
						$context = YoastSEO()->classes->get( 'Yoast\WP\SEO\Context\Meta_Tags_Context' );
						if ( method_exists( $context, 'for_post' ) ) {
							$pc = $context::for_post( $id );
							if ( $pc && isset( $pc->schema ) ) {
								$out['schema_output'] = $pc->schema;
							}
						}
					} catch ( \Throwable $e ) {
						$out['schema_output'] = null;
						$out['note']          = 'Schema output generation not available in this Yoast SEO version.';
					}
				} else {
					$out['schema_output'] = null;
					$out['note']          = 'Schema graph builder not available. Install Yoast SEO 14.0+ for full schema support.';
				}

				return $out;
			},
		);

		$reg['yoast_update_schema'] = array(
			'desc'     => 'Update Yoast schema_page_type and/or schema_article_type for a post. Pass "None" as schema_article_type to clear it.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'             => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'schema_page_type'    => array( 'type' => 'string', 'description' => 'WebPage | ItemPage | AboutPage | FAQPage | QAPage | ProfilePage | ContactPage | MedicalWebPage | CollectionPage | CheckoutPage | RealEstateListing | SearchResultsPage.' ),
				'schema_article_type' => array( 'type' => 'string', 'description' => 'Article | BlogPosting | SocialMediaPosting | NewsArticle | AdvertiserContentArticle | SatiricalArticle | ScholarlyArticle | TechArticle | Report | None.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;

				$page_allowed = array( 'WebPage', 'ItemPage', 'AboutPage', 'FAQPage', 'QAPage', 'ProfilePage', 'ContactPage', 'MedicalWebPage', 'CollectionPage', 'CheckoutPage', 'RealEstateListing', 'SearchResultsPage' );
				$art_allowed  = array( 'Article', 'BlogPosting', 'SocialMediaPosting', 'NewsArticle', 'AdvertiserContentArticle', 'SatiricalArticle', 'ScholarlyArticle', 'TechArticle', 'Report', 'None' );

				$updated = array();
				if ( isset( $a['schema_page_type'] ) ) {
					$v = sanitize_text_field( $a['schema_page_type'] );
					if ( ! in_array( $v, $page_allowed, true ) ) {
						throw new Exception( 'Invalid schema page type. Allowed: ' . implode( ', ', $page_allowed ) );
					}
					WPSEO_Meta::set_value( 'schema_page_type', $v, $id );
					$updated['schema_page_type'] = $v;
				}
				if ( isset( $a['schema_article_type'] ) ) {
					$v = sanitize_text_field( $a['schema_article_type'] );
					if ( ! in_array( $v, $art_allowed, true ) ) {
						throw new Exception( 'Invalid schema article type. Allowed: ' . implode( ', ', $art_allowed ) );
					}
					if ( 'None' === $v ) {
						WPSEO_Meta::set_value( 'schema_article_type', '', $id );
						$updated['schema_article_type'] = 'None (removed)';
					} else {
						WPSEO_Meta::set_value( 'schema_article_type', $v, $id );
						$updated['schema_article_type'] = $v;
					}
				}
				if ( empty( $updated ) ) {
					throw new Exception( 'At least one schema type (page or article) must be provided.' );
				}

				return array(
					'post_id'        => $id,
					'success'        => true,
					'updated_fields' => $updated,
					'message'        => 'Schema type updated successfully.',
				);
			},
		);

		// ============================================================
		// FREE — sitemap, robots, breadcrumb, term, settings (8)
		// ============================================================

		$reg['yoast_get_sitemap_status'] = array(
			'desc'    => 'XML sitemap enablement status + per-post-type and per-taxonomy sitemap URLs.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! class_exists( 'WPSEO_Sitemaps_Router' ) && ! function_exists( 'YoastSEO' ) ) {
					throw new Exception( 'Yoast SEO is not available.' );
				}
				$xml      = get_option( 'wpseo_xml', array() );
				$enabled  = isset( $xml['enablexmlsitemap'] ) ? (bool) $xml['enablexmlsitemap'] : true;
				$home_url = home_url();

				$urls         = array();
				$enabled_pts  = array();
				$enabled_taxs = array();

				foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $pt ) {
					$key = 'post_types-' . $pt->name . '-not_in_sitemap';
					$on  = isset( $xml[ $key ] ) ? ! (bool) $xml[ $key ] : true;
					if ( $on ) {
						$enabled_pts[] = $pt->name;
						$urls[]        = array( 'type' => 'post_type', 'name' => $pt->name, 'url' => $home_url . '/' . $pt->name . '-sitemap.xml' );
					}
				}
				foreach ( get_taxonomies( array( 'public' => true ), 'objects' ) as $tx ) {
					$key = 'taxonomies-' . $tx->name . '-not_in_sitemap';
					$on  = isset( $xml[ $key ] ) ? ! (bool) $xml[ $key ] : true;
					if ( $on ) {
						$enabled_taxs[] = $tx->name;
						$urls[]         = array( 'type' => 'taxonomy', 'name' => $tx->name, 'url' => $home_url . '/' . $tx->name . '-sitemap.xml' );
					}
				}

				return array(
					'sitemap_enabled'    => $enabled,
					'sitemap_index_url'  => $home_url . '/sitemap_index.xml',
					'enabled_post_types' => $enabled_pts,
					'enabled_taxonomies' => $enabled_taxs,
					'sitemap_urls'       => $urls,
					'total_sitemaps'     => count( $urls ),
				);
			},
		);

		$reg['yoast_get_robots_settings'] = array(
			'desc'     => 'Get robots directives for a post: noindex (default/index/noindex), nofollow (default/follow/nofollow), advanced (noarchive/noimageindex/nosnippet).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;

				$ni  = WPSEO_Meta::get_value( 'meta-robots-noindex', $id );
				$nf  = WPSEO_Meta::get_value( 'meta-robots-nofollow', $id );
				$adv = WPSEO_Meta::get_value( 'meta-robots-adv', $id );

				if ( $ni === '' || $ni === false ) {
					$ni_label = 'default';
				} elseif ( $ni == '1' ) {
					$ni_label = 'noindex';
				} else {
					$ni_label = 'index';
				}
				if ( $nf === '' || $nf === false ) {
					$nf_label = 'default';
				} elseif ( $nf == '1' ) {
					$nf_label = 'nofollow';
				} else {
					$nf_label = 'follow';
				}

				$advanced = array();
				if ( ! empty( $adv ) && 'none' !== $adv ) {
					$advanced = array_values( array_filter( array_map( 'trim', explode( ',', $adv ) ) ) );
				}

				return array(
					'post_id'  => $id,
					'noindex'  => $ni_label,
					'nofollow' => $nf_label,
					'advanced' => $advanced,
				);
			},
		);

		$reg['yoast_update_robots_settings'] = array(
			'desc'     => 'Update robots directives for a post. noindex: default|index|noindex. nofollow: default|follow|nofollow. advanced: array subset of [noarchive, noimageindex, nosnippet] (replaces existing).',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'noindex'  => array( 'type' => 'string', 'description' => 'default | index | noindex.' ),
				'nofollow' => array( 'type' => 'string', 'description' => 'default | follow | nofollow.' ),
				'advanced' => array( 'type' => 'array', 'description' => 'Subset of [noarchive, noimageindex, nosnippet].' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;

				$updated = array();
				if ( isset( $a['noindex'] ) ) {
					$ni = sanitize_text_field( $a['noindex'] );
					$nv = ( 'default' === $ni ) ? '' : ( ( 'noindex' === $ni ) ? '1' : '0' );
					WPSEO_Meta::set_value( 'meta-robots-noindex', $nv, $id );
					$updated['noindex'] = $ni;
				}
				if ( isset( $a['nofollow'] ) ) {
					$nf = sanitize_text_field( $a['nofollow'] );
					$nv = ( 'default' === $nf ) ? '' : ( ( 'nofollow' === $nf ) ? '1' : '0' );
					WPSEO_Meta::set_value( 'meta-robots-nofollow', $nv, $id );
					$updated['nofollow'] = $nf;
				}
				if ( isset( $a['advanced'] ) ) {
					$allowed  = array( 'noarchive', 'noimageindex', 'nosnippet' );
					$adv      = is_array( $a['advanced'] ) ? $a['advanced'] : array();
					$filtered = array_values( array_intersect( $adv, $allowed ) );
					$str      = ! empty( $filtered ) ? implode( ',', $filtered ) : 'none';
					WPSEO_Meta::set_value( 'meta-robots-adv', $str, $id );
					$updated['advanced'] = $filtered;
				}
				if ( empty( $updated ) ) {
					throw new Exception( 'At least one setting (noindex, nofollow, advanced) must be provided.' );
				}

				return array(
					'post_id' => $id,
					'success' => true,
					'updated' => $updated,
					'message' => 'Robot settings updated successfully.',
				);
			},
		);

		$reg['yoast_get_breadcrumb_title'] = array(
			'desc'     => 'Get the custom breadcrumb title for a post.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$bt   = WPSEO_Meta::get_value( 'bctitle', $id );
				return array(
					'post_id'          => $id,
					'post_title'       => $post->post_title,
					'breadcrumb_title' => $bt ?: '',
					'is_custom'        => ! empty( $bt ),
				);
			},
		);

		$reg['yoast_set_breadcrumb_title'] = array(
			'desc'     => 'Set or clear the custom breadcrumb title for a post (empty string clears it).',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'          => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'breadcrumb_title' => array( 'type' => 'string', 'description' => 'Custom breadcrumb title (empty string clears).' ),
			),
			'required' => array( 'post_id', 'breadcrumb_title' ),
			'handler'  => function ( $a ) {
				$post = WPXMCP_Tools_Yoast::require_post( $a );
				$id   = $post->ID;
				$bt   = sanitize_text_field( $a['breadcrumb_title'] );
				WPSEO_Meta::set_value( 'bctitle', $bt, $id );
				return array(
					'post_id'          => $id,
					'success'          => true,
					'breadcrumb_title' => $bt,
					'is_custom'        => ! empty( $bt ),
					'message'          => empty( $bt ) ? 'Custom breadcrumb title removed.' : 'Breadcrumb title set successfully.',
				);
			},
		);

		$reg['yoast_get_term_seo_meta'] = array(
			'desc'     => 'Get Yoast SEO meta for a taxonomy term (title, description, focus_keyword, canonical_url, noindex, OG fields).',
			'risk'     => 'read',
			'schema'   => array(
				'term_id'  => array( 'type' => 'integer', 'description' => 'Term ID.' ),
				'taxonomy' => array( 'type' => 'string', 'description' => 'Taxonomy slug (category, post_tag, product_cat, etc.).' ),
			),
			'required' => array( 'term_id', 'taxonomy' ),
			'handler'  => function ( $a ) {
				if ( ! WPXMCP_Tools_Yoast::is_active() ) {
					throw new Exception( 'Yoast SEO is not active.' );
				}
				$term_id  = absint( $a['term_id'] );
				$taxonomy = sanitize_key( $a['taxonomy'] );
				if ( ! $term_id ) throw new Exception( 'Invalid term ID provided.' );

				$term = get_term( $term_id, $taxonomy );
				if ( is_wp_error( $term ) || ! $term ) {
					throw new Exception( 'Term not found.' );
				}

				$tm   = get_option( 'wpseo_taxonomy_meta', array() );
				$data = $tm[ $taxonomy ][ $term_id ] ?? array();

				$ni_raw = $data['wpseo_noindex'] ?? '';
				if ( 'noindex' === $ni_raw ) {
					$ni = 'noindex';
				} elseif ( 'index' === $ni_raw ) {
					$ni = 'index';
				} else {
					$ni = 'default';
				}

				return array(
					'term_id'          => $term_id,
					'taxonomy'         => $taxonomy,
					'term_name'        => $term->name,
					'seo_title'        => $data['wpseo_title'] ?? '',
					'meta_description' => $data['wpseo_desc'] ?? '',
					'focus_keyword'    => $data['wpseo_focuskw'] ?? '',
					'canonical_url'    => $data['wpseo_canonical'] ?? '',
					'noindex'          => $ni,
					'og_title'         => $data['wpseo_opengraph-title'] ?? '',
					'og_description'   => $data['wpseo_opengraph-description'] ?? '',
					'og_image'         => $data['wpseo_opengraph-image'] ?? '',
				);
			},
		);

		$reg['yoast_update_term_seo_meta'] = array(
			'desc'     => 'Update Yoast SEO meta for a taxonomy term. Pass any subset of seo_title, meta_description, focus_keyword, canonical_url, noindex.',
			'risk'     => 'write',
			'schema'   => array(
				'term_id'          => array( 'type' => 'integer', 'description' => 'Term ID.' ),
				'taxonomy'         => array( 'type' => 'string', 'description' => 'Taxonomy slug.' ),
				'seo_title'        => array( 'type' => 'string', 'description' => 'SEO title for term archive.' ),
				'meta_description' => array( 'type' => 'string', 'description' => 'Meta description.' ),
				'focus_keyword'    => array( 'type' => 'string', 'description' => 'Focus keyword.' ),
				'canonical_url'    => array( 'type' => 'string', 'description' => 'Canonical URL.' ),
				'noindex'          => array( 'type' => 'string', 'description' => 'default | index | noindex.' ),
			),
			'required' => array( 'term_id', 'taxonomy' ),
			'handler'  => function ( $a ) {
				if ( ! WPXMCP_Tools_Yoast::is_active() ) {
					throw new Exception( 'Yoast SEO is not active.' );
				}
				$term_id  = absint( $a['term_id'] );
				$taxonomy = sanitize_key( $a['taxonomy'] );
				if ( ! $term_id ) throw new Exception( 'Invalid term ID provided.' );

				$term = get_term( $term_id, $taxonomy );
				if ( is_wp_error( $term ) || ! $term ) {
					throw new Exception( 'Term not found.' );
				}

				$tm = get_option( 'wpseo_taxonomy_meta', array() );
				if ( ! isset( $tm[ $taxonomy ] ) ) {
					$tm[ $taxonomy ] = array();
				}
				if ( ! isset( $tm[ $taxonomy ][ $term_id ] ) ) {
					$tm[ $taxonomy ][ $term_id ] = array();
				}

				$updated = array();
				if ( isset( $a['seo_title'] ) ) {
					$v = sanitize_text_field( $a['seo_title'] );
					$tm[ $taxonomy ][ $term_id ]['wpseo_title'] = $v;
					$updated['seo_title']                       = $v;
				}
				if ( isset( $a['meta_description'] ) ) {
					$v = sanitize_textarea_field( $a['meta_description'] );
					$tm[ $taxonomy ][ $term_id ]['wpseo_desc'] = $v;
					$updated['meta_description']               = $v;
				}
				if ( isset( $a['focus_keyword'] ) ) {
					$v = sanitize_text_field( $a['focus_keyword'] );
					$tm[ $taxonomy ][ $term_id ]['wpseo_focuskw'] = $v;
					$updated['focus_keyword']                     = $v;
				}
				if ( isset( $a['canonical_url'] ) ) {
					$v = esc_url_raw( $a['canonical_url'] );
					$tm[ $taxonomy ][ $term_id ]['wpseo_canonical'] = $v;
					$updated['canonical_url']                       = $v;
				}
				if ( isset( $a['noindex'] ) ) {
					$v = sanitize_text_field( $a['noindex'] );
					$tm[ $taxonomy ][ $term_id ]['wpseo_noindex'] = ( 'noindex' === $v || 'index' === $v ) ? $v : '';
					$updated['noindex']                           = $v;
				}

				if ( empty( $updated ) ) {
					throw new Exception( 'At least one field must be provided.' );
				}

				update_option( 'wpseo_taxonomy_meta', $tm );

				return array(
					'term_id'  => $term_id,
					'taxonomy' => $taxonomy,
					'success'  => true,
					'updated'  => $updated,
					'message'  => 'Term SEO meta updated successfully.',
				);
			},
		);

		$reg['yoast_get_global_settings'] = array(
			'desc'    => 'Get global Yoast SEO settings: breadcrumbs, social, title separator/template, homepage title/description.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! class_exists( 'WPSEO_Options' ) ) {
					throw new Exception( 'Yoast SEO is not available.' );
				}
				$pts       = get_post_types( array( 'public' => true ), 'names' );
				$templates = array();
				foreach ( $pts as $pt ) {
					$templates[ $pt ] = array(
						'title'    => WPSEO_Options::get( 'title-' . $pt ),
						'metadesc' => WPSEO_Options::get( 'metadesc-' . $pt ),
					);
				}
				return array(
					'breadcrumbs'    => array(
						'enabled'        => (bool) WPSEO_Options::get( 'breadcrumbs-enable' ),
						'separator'      => WPSEO_Options::get( 'breadcrumbs-sep' ),
						'home_label'     => WPSEO_Options::get( 'breadcrumbs-home' ),
						'show_blog_page' => (bool) WPSEO_Options::get( 'breadcrumbs-display-blog-page' ),
						'bold_last_item' => (bool) WPSEO_Options::get( 'breadcrumbs-boldlast' ),
					),
					'social'         => array(
						'og_enabled'       => (bool) WPSEO_Options::get( 'opengraph' ),
						'twitter_enabled'  => (bool) WPSEO_Options::get( 'twitter' ),
						'facebook_site'    => WPSEO_Options::get( 'facebook_site' ),
						'twitter_site'     => WPSEO_Options::get( 'twitter_site' ),
						'og_default_image' => WPSEO_Options::get( 'og_default_image' ),
					),
					'title_settings' => array(
						'title_separator'      => WPSEO_Options::get( 'separator' ),
						'force_rewrite_titles' => (bool) WPSEO_Options::get( 'forcerewritetitle' ),
					),
					'title_templates' => $templates,
					'homepage'        => array(
						'title'    => WPSEO_Options::get( 'title-home-wpseo' ),
						'metadesc' => WPSEO_Options::get( 'metadesc-home-wpseo' ),
					),
				);
			},
		);

		$reg['yoast_check_keyword_usage'] = array(
			'desc'     => 'Check whether a focus keyword is already used on other posts. Pass post_id to exclude that post from results.',
			'risk'     => 'read',
			'schema'   => array(
				'keyword' => array( 'type' => 'string', 'description' => 'Focus keyword to check.' ),
				'post_id' => array( 'type' => 'integer', 'description' => 'Exclude this post ID from results.' ),
			),
			'required' => array( 'keyword' ),
			'handler'  => function ( $a ) {
				if ( ! WPXMCP_Tools_Yoast::is_active() || ! class_exists( 'WPSEO_Meta' ) ) {
					throw new Exception( 'Yoast SEO is not available.' );
				}
				$kw  = sanitize_text_field( $a['keyword'] );
				$pid = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				if ( '' === $kw ) {
					throw new Exception( 'Keyword is required.' );
				}

				$used = WPSEO_Meta::keyword_usage( $kw, $pid );
				if ( ! is_array( $used ) ) {
					$used = array();
				}
				if ( $pid ) {
					$used = array_values(
						array_filter( $used, function ( $id ) use ( $pid ) {
							return (int) $id !== $pid;
						} )
					);
				}

				$posts = array();
				foreach ( $used as $id ) {
					$p = get_post( $id );
					if ( $p ) {
						$posts[] = array(
							'id'        => $p->ID,
							'title'     => $p->post_title,
							'post_type' => $p->post_type,
							'status'    => $p->post_status,
							'url'       => get_permalink( $p->ID ),
						);
					}
				}

				return array(
					'keyword'     => $kw,
					'used_in'     => $posts,
					'usage_count' => count( $posts ),
					'is_unique'   => count( $posts ) === 0,
				);
			},
		);

		$reg['yoast_get_post_type_settings'] = array(
			'desc'     => 'Get Yoast SEO config for a post type (noindex, sitemap inclusion, archive settings, related taxonomies). Pass "all" to get every public post type.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Post type slug (e.g. post, page, product) or "all".' ),
			),
			'required' => array( 'post_type' ),
			'handler'  => function ( $a ) {
				if ( ! class_exists( 'WPSEO_Options' ) ) {
					throw new Exception( 'Yoast SEO is not available.' );
				}
				$pt  = sanitize_key( $a['post_type'] );
				$pts = get_post_types( array( 'public' => true ), 'objects' );

				if ( 'all' === $pt ) {
					$out = array();
					foreach ( $pts as $obj ) {
						$out[ $obj->name ] = WPXMCP_Tools_Yoast::single_post_type_settings( $obj->name );
					}
					return $out;
				}

				if ( ! isset( $pts[ $pt ] ) ) {
					throw new Exception( 'Invalid post type. Available: ' . implode( ', ', array_keys( $pts ) ) );
				}

				return WPXMCP_Tools_Yoast::single_post_type_settings( $pt );
			},
		);

		// ============================================================
		// PREMIUM — register only if Yoast SEO Premium is active (6 tools)
		// ============================================================

		if ( self::is_premium_active() ) {

			$reg['yoast_get_redirects'] = array(
				'desc'    => 'List Yoast SEO Premium redirects with optional filters (type 301/302/307/410/451, search, pagination).',
				'risk'    => 'read',
				'schema'  => array(
					'type'     => array( 'type' => 'string', 'description' => 'Filter by 301, 302, 307, 410, 451.' ),
					'search'   => array( 'type' => 'string', 'description' => 'Search inside origin or target.' ),
					'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
					'per_page' => array( 'type' => 'integer', 'description' => 'Items per page (1-100). Default 25.' ),
				),
				'handler' => function ( $a ) {
					if ( ! WPXMCP_Tools_Yoast::is_premium_active() ) {
						throw new Exception( 'Yoast SEO Premium is required for redirect management.' );
					}
					$type     = isset( $a['type'] ) ? sanitize_text_field( $a['type'] ) : '';
					$search   = isset( $a['search'] ) ? sanitize_text_field( $a['search'] ) : '';
					$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;
					$per_page = isset( $a['per_page'] ) ? min( 100, max( 1, absint( $a['per_page'] ) ) ) : 25;

					$rows  = array();
					$total = 0;

					// Modern repository.
					if ( class_exists( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' ) ) {
						try {
							$repo = YoastSEO()->classes->get( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' );
							if ( $repo ) {
								$all   = $repo->get_all();
								$rows  = WPXMCP_Tools_Yoast::format_redirects( $all, $type, $search, $page, $per_page );
								$total = count( $all );
							}
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					// Legacy manager.
					if ( empty( $rows ) && class_exists( 'WPSEO_Redirect_Manager' ) ) {
						try {
							$mgr   = new WPSEO_Redirect_Manager();
							$all   = $mgr->get_redirects();
							$rows  = WPXMCP_Tools_Yoast::format_legacy_redirects( $all, $type, $search, $page, $per_page );
							$total = count( $all );
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					// Options fallback.
					if ( empty( $rows ) ) {
						$plain = get_option( 'wpseo-premium-redirects-base', array() );
						$regex = get_option( 'wpseo-premium-redirects-regex', array() );
						$all   = array_merge(
							WPXMCP_Tools_Yoast::parse_option_redirects( $plain, 'plain' ),
							WPXMCP_Tools_Yoast::parse_option_redirects( $regex, 'regex' )
						);
						$rows  = WPXMCP_Tools_Yoast::filter_redirects( $all, $type, $search, $page, $per_page );
						$total = count( $all );
					}

					return array(
						'redirects'   => $rows,
						'total'       => $total,
						'page'        => $page,
						'per_page'    => $per_page,
						'total_pages' => $per_page > 0 ? (int) ceil( $total / $per_page ) : 0,
						'is_premium'  => true,
					);
				},
			);

			$reg['yoast_create_redirect'] = array(
				'desc'     => 'Create a Yoast Premium redirect. Target is required except for type 410 (gone) and 451 (legal).',
				'risk'     => 'write',
				'schema'   => array(
					'origin' => array( 'type' => 'string', 'description' => 'Source URL/path.' ),
					'target' => array( 'type' => 'string', 'description' => 'Destination URL (not required for 410/451).' ),
					'type'   => array( 'type' => 'integer', 'description' => '301 | 302 | 307 | 410 | 451.' ),
					'format' => array( 'type' => 'string', 'description' => 'plain (default) | regex.' ),
				),
				'required' => array( 'origin', 'type' ),
				'handler'  => function ( $a ) {
					if ( ! WPXMCP_Tools_Yoast::is_premium_active() ) {
						throw new Exception( 'Yoast SEO Premium is required for redirect management.' );
					}
					$origin = sanitize_text_field( $a['origin'] );
					$target = isset( $a['target'] ) ? esc_url_raw( $a['target'] ) : '';
					$type   = absint( $a['type'] );
					$format = isset( $a['format'] ) ? sanitize_text_field( $a['format'] ) : 'plain';

					if ( '' === $origin ) {
						throw new Exception( 'Origin URL is required.' );
					}
					$allowed = array( 301, 302, 307, 410, 451 );
					if ( ! in_array( $type, $allowed, true ) ) {
						throw new Exception( 'Invalid redirect type. Allowed: ' . implode( ', ', $allowed ) );
					}
					if ( ! in_array( $type, array( 410, 451 ), true ) && '' === $target ) {
						throw new Exception( 'Target URL is required for this redirect type.' );
					}
					if ( ! in_array( $format, array( 'plain', 'regex' ), true ) ) {
						$format = 'plain';
					}

					// Modern API.
					if ( class_exists( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' ) ) {
						try {
							$repo    = YoastSEO()->classes->get( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' );
							$factory = YoastSEO()->classes->get( 'Yoast\WP\SEO\Premium\Redirect\Redirect_Factory' );
							if ( $repo && $factory ) {
								$r = $factory->create( $origin, $target, $type, $format );
								$repo->save( $r );
								return array(
									'success'  => true,
									'redirect' => array(
										'origin' => $origin,
										'target' => $target,
										'type'   => $type,
										'format' => $format,
									),
									'message'  => 'Redirect created successfully.',
								);
							}
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					// Legacy.
					if ( class_exists( 'WPSEO_Redirect_Manager' ) ) {
						try {
							$mgr = new WPSEO_Redirect_Manager();
							$mgr->create_redirect( $origin, $target, $type, $format );
							return array(
								'success'  => true,
								'redirect' => array(
									'origin' => $origin,
									'target' => $target,
									'type'   => $type,
									'format' => $format,
								),
								'message'  => 'Redirect created successfully.',
							);
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					// Options fallback.
					$key   = ( 'regex' === $format ) ? 'wpseo-premium-redirects-regex' : 'wpseo-premium-redirects-base';
					$store = get_option( $key, array() );
					if ( ! is_array( $store ) ) {
						$store = array();
					}
					$store[ $origin ] = array( 'url' => $target, 'type' => $type );
					update_option( $key, $store );

					return array(
						'success'  => true,
						'redirect' => array(
							'origin' => $origin,
							'target' => $target,
							'type'   => $type,
							'format' => $format,
						),
						'message'  => 'Redirect created successfully.',
					);
				},
			);

			$reg['yoast_update_redirect'] = array(
				'desc'     => 'Update an existing Yoast Premium redirect by its origin URL. Pass any subset of new_target / new_type / new_format.',
				'risk'     => 'write',
				'schema'   => array(
					'origin'     => array( 'type' => 'string', 'description' => 'Origin URL of the redirect to update.' ),
					'new_target' => array( 'type' => 'string', 'description' => 'New destination URL.' ),
					'new_type'   => array( 'type' => 'integer', 'description' => '301 | 302 | 307 | 410 | 451.' ),
					'new_format' => array( 'type' => 'string', 'description' => 'plain | regex.' ),
				),
				'required' => array( 'origin' ),
				'handler'  => function ( $a ) {
					if ( ! WPXMCP_Tools_Yoast::is_premium_active() ) {
						throw new Exception( 'Yoast SEO Premium is required for redirect management.' );
					}
					$origin     = sanitize_text_field( $a['origin'] );
					$new_target = isset( $a['new_target'] ) ? esc_url_raw( $a['new_target'] ) : null;
					$new_type   = isset( $a['new_type'] ) ? absint( $a['new_type'] ) : null;
					$new_format = isset( $a['new_format'] ) ? sanitize_text_field( $a['new_format'] ) : null;

					if ( '' === $origin ) {
						throw new Exception( 'Origin URL is required.' );
					}
					if ( null === $new_target && null === $new_type && null === $new_format ) {
						throw new Exception( 'At least one field (new_target, new_type, new_format) must be provided.' );
					}

					// Modern API.
					if ( class_exists( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' ) ) {
						try {
							$repo = YoastSEO()->classes->get( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' );
							if ( $repo ) {
								$r = $repo->find_by_origin( $origin );
								if ( $r ) {
									if ( null !== $new_target ) $r->set_target( $new_target );
									if ( null !== $new_type )   $r->set_type( $new_type );
									if ( null !== $new_format ) $r->set_format( $new_format );
									$repo->save( $r );
									return array(
										'success'  => true,
										'redirect' => array(
											'origin' => $origin,
											'target' => $r->get_target(),
											'type'   => $r->get_type(),
											'format' => $r->get_format(),
										),
										'message'  => 'Redirect updated successfully.',
									);
								}
							}
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					// Options fallback.
					$stores = array(
						'plain' => 'wpseo-premium-redirects-base',
						'regex' => 'wpseo-premium-redirects-regex',
					);
					foreach ( $stores as $fmt => $key ) {
						$store = get_option( $key, array() );
						if ( ! is_array( $store ) || ! isset( $store[ $origin ] ) ) {
							continue;
						}
						if ( null !== $new_target ) $store[ $origin ]['url'] = $new_target;
						if ( null !== $new_type )   $store[ $origin ]['type'] = $new_type;
						update_option( $key, $store );
						return array(
							'success'  => true,
							'redirect' => array(
								'origin' => $origin,
								'target' => $store[ $origin ]['url'] ?? '',
								'type'   => $store[ $origin ]['type'] ?? 301,
								'format' => $fmt,
							),
							'message'  => 'Redirect updated successfully.',
						);
					}

					throw new Exception( 'Redirect not found.' );
				},
			);

			$reg['yoast_delete_redirect'] = array(
				'desc'     => 'Delete a Yoast Premium redirect by its origin URL.',
				'risk'     => 'destructive',
				'schema'   => array(
					'origin' => array( 'type' => 'string', 'description' => 'Origin URL of the redirect to delete.' ),
				),
				'required' => array( 'origin' ),
				'handler'  => function ( $a ) {
					if ( ! WPXMCP_Tools_Yoast::is_premium_active() ) {
						throw new Exception( 'Yoast SEO Premium is required for redirect management.' );
					}
					$origin = sanitize_text_field( $a['origin'] );
					if ( '' === $origin ) {
						throw new Exception( 'Origin URL is required.' );
					}

					$deleted = false;

					if ( class_exists( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' ) ) {
						try {
							$repo = YoastSEO()->classes->get( 'Yoast\WP\SEO\Premium\Repositories\Redirect_Repository' );
							if ( $repo ) {
								$r = $repo->find_by_origin( $origin );
								if ( $r ) {
									$repo->delete( $r );
									$deleted = true;
								}
							}
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					if ( ! $deleted && class_exists( 'WPSEO_Redirect_Manager' ) ) {
						try {
							$mgr = new WPSEO_Redirect_Manager();
							$mgr->delete_redirect( $origin );
							$deleted = true;
						} catch ( \Throwable $e ) {
							// fallthrough
						}
					}

					if ( ! $deleted ) {
						$plain = get_option( 'wpseo-premium-redirects-base', array() );
						$regex = get_option( 'wpseo-premium-redirects-regex', array() );
						if ( isset( $plain[ $origin ] ) ) {
							unset( $plain[ $origin ] );
							update_option( 'wpseo-premium-redirects-base', $plain );
							$deleted = true;
						}
						if ( isset( $regex[ $origin ] ) ) {
							unset( $regex[ $origin ] );
							update_option( 'wpseo-premium-redirects-regex', $regex );
							$deleted = true;
						}
					}

					if ( ! $deleted ) {
						throw new Exception( 'Redirect not found.' );
					}

					return array(
						'success' => true,
						'origin'  => $origin,
						'message' => 'Redirect deleted successfully.',
					);
				},
			);

			$reg['yoast_get_multiple_keywords'] = array(
				'desc'     => 'Get additional focus keywords (Yoast Premium) and their density/usage analysis for a post.',
				'risk'     => 'read',
				'schema'   => array(
					'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				),
				'required' => array( 'post_id' ),
				'handler'  => function ( $a ) {
					if ( ! WPXMCP_Tools_Yoast::is_premium_active() ) {
						throw new Exception( 'Yoast SEO Premium is required for multiple keywords analysis.' );
					}
					$post = WPXMCP_Tools_Yoast::require_post( $a );
					$id   = $post->ID;

					$primary = WPSEO_Meta::get_value( 'focuskw', $id );

					$additional = array();
					$raw_kws    = get_post_meta( $id, '_yoast_wpseo_focuskeywords', true );
					if ( ! empty( $raw_kws ) ) {
						$parsed = json_decode( $raw_kws, true );
						if ( is_array( $parsed ) ) {
							foreach ( $parsed as $kw_data ) {
								$kw = $kw_data['keyword'] ?? '';
								if ( '' === $kw ) continue;
								$an           = WPXMCP_Tools_Yoast::analyze_keyword( $kw, $post );
								$additional[] = array(
									'keyword'             => $kw,
									'score'               => $kw_data['score'] ?? null,
									'in_title'            => $an['in_title'],
									'title_occurrences'   => $an['title_occurrences'],
									'content_occurrences' => $an['content_occurrences'],
									'keyword_density'     => $an['keyword_density'],
								);
							}
						}
					}

					$synonyms = array();
					$raw_syn  = get_post_meta( $id, '_yoast_wpseo_keywordsynonyms', true );
					if ( ! empty( $raw_syn ) ) {
						$parsed = json_decode( $raw_syn, true );
						if ( is_array( $parsed ) ) {
							foreach ( $parsed as $g ) {
								if ( is_string( $g ) && '' !== $g ) {
									$synonyms[] = $g;
								}
							}
						}
					}

					return array(
						'post_id'             => $id,
						'primary_keyword'     => $primary ?: '',
						'additional_keywords' => $additional,
						'keyword_count'       => count( $additional ) + ( ! empty( $primary ) ? 1 : 0 ),
						'synonyms'            => $synonyms,
						'word_count'          => str_word_count( strip_tags( $post->post_content ) ),
						'is_premium'          => true,
					);
				},
			);

			$reg['yoast_get_inclusive_language_score'] = array(
				'desc'     => 'Get the inclusive-language score (Yoast Premium) and its label for a post.',
				'risk'     => 'read',
				'schema'   => array(
					'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				),
				'required' => array( 'post_id' ),
				'handler'  => function ( $a ) {
					if ( ! WPXMCP_Tools_Yoast::is_premium_active() ) {
						throw new Exception( 'Yoast SEO Premium is required for inclusive language analysis.' );
					}
					$post  = WPXMCP_Tools_Yoast::require_post( $a );
					$id    = $post->ID;
					$score = WPSEO_Meta::get_value( 'inclusive_language_score', $id );
					$score = ( false !== $score && '' !== $score ) ? intval( $score ) : null;

					return array(
						'post_id'    => $id,
						'score'      => $score,
						'label'      => null !== $score ? WPXMCP_Tools_Yoast::score_label( $score ) : 'not_available',
						'is_premium' => true,
					);
				},
			);
		}

		return $reg;
	}
}
