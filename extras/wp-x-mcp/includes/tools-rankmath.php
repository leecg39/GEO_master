<?php
/**
 * Rank Math SEO tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's Rank Math SEO tool set into wp-x-mcp's
 * procedural tool registry style: per-post meta/social/canonical/schema,
 * content analysis, redirects, 404 monitor, global/local/social/homepage
 * settings, post type & taxonomy SEO templates, sitemap settings, and a
 * large Rank Math Pro surface (Link Genius, Keyword Tracking, Multi-Location
 * SEO, News/Video sitemaps, Keyword Maps, Analytics, Email Reports, Schema
 * Templates, Video metadata, Image SEO).
 *
 * 78 tools, zero collisions with the existing wp-x-mcp toolset. Tools
 * register only when Rank Math SEO is active; Pro-only tools additionally
 * runtime-check is_rank_math_pro_active() and return a clear error if Pro
 * is not present. Several Pro tools also runtime-check for specific DB
 * tables (e.g. rank_math_analytics_gsc, rank_math_internal_links) since
 * those tables only exist once the corresponding Pro module has run.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_RankMath {

	public static function is_active(): bool {
		if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'seo-by-rank-math/rank-math.php' );
	}

	public static function is_pro_active(): bool {
		if ( ! self::is_active() ) {
			return false;
		}
		if ( defined( 'RANK_MATH_PRO_VERSION' ) ) {
			return true;
		}
		if ( class_exists( 'RankMathPro\Plugin' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'seo-by-rank-math-pro/rank-math-pro.php' );
	}

	public static function require_active(): void {
		if ( ! self::is_active() ) {
			throw new Exception( 'Rank Math SEO is not active.' );
		}
	}

	public static function require_pro(): void {
		if ( ! self::is_pro_active() ) {
			throw new Exception( 'This feature requires Rank Math Pro.' );
		}
	}

	public static function require_post( int $post_id ) {
		if ( ! $post_id ) {
			throw new Exception( 'Invalid post ID provided.' );
		}
		$post = get_post( $post_id );
		if ( ! $post ) {
			throw new Exception( 'Post not found.' );
		}
		return $post;
	}

	/** Throw if a $wpdb table doesn't exist (Pro module tables only appear once enabled/synced). */
	public static function require_table( string $table, string $message = '' ): void {
		global $wpdb;
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
			throw new Exception( $message ?: "Required table '$table' not found." );
		}
	}

	/* -------------------------------------------------------------------------
	 * Internal helpers shared across handlers.
	 * ---------------------------------------------------------------------- */

	public static function get_post_schema_entries( int $post_id ): array {
		$all_meta = get_post_meta( $post_id );
		$schemas  = array();
		foreach ( $all_meta as $key => $values ) {
			if ( 0 === strpos( $key, 'rank_math_schema_' ) ) {
				$schema = maybe_unserialize( $values[0] );
				if ( is_array( $schema ) ) {
					$schemas[ $key ] = $schema;
				}
			}
		}
		return $schemas;
	}

	public static function make_schema_meta_key(): string {
		return 'rank_math_schema_' . ( floor( microtime( true ) * 1000 ) + wp_rand( 0, 999 ) );
	}

	public static function get_seo_score( int $post_id ): int {
		$score_meta = get_post_meta( $post_id, 'rank_math_seo_score', true );
		if ( ! empty( $score_meta ) ) {
			return absint( $score_meta );
		}
		$passed = 0;
		$total  = 0;
		foreach ( self::get_test_results( $post_id ) as $r ) {
			$total++;
			if ( 'passed' === $r['status'] ) $passed++;
		}
		return $total > 0 ? (int) round( ( $passed / $total ) * 100 ) : 0;
	}

	public static function get_test_results( int $post_id ): array {
		$results = array();
		$post    = get_post( $post_id );
		if ( ! $post ) {
			return $results;
		}

		$seo_title       = get_post_meta( $post_id, 'rank_math_title', true );
		$seo_description = get_post_meta( $post_id, 'rank_math_description', true );
		$focus_keyword   = get_post_meta( $post_id, 'rank_math_focus_keyword', true );

		$results[] = array(
			'test'    => 'focus_keyword_set',
			'status'  => ! empty( $focus_keyword ) ? 'passed' : 'failed',
			'message' => ! empty( $focus_keyword ) ? 'Focus keyword is set' : 'Focus keyword is not set',
		);
		$results[] = array(
			'test'    => 'seo_title_set',
			'status'  => ! empty( $seo_title ) ? 'passed' : 'warning',
			'message' => ! empty( $seo_title ) ? 'SEO title is set' : 'SEO title is not set',
		);
		$results[] = array(
			'test'    => 'meta_description_set',
			'status'  => ! empty( $seo_description ) ? 'passed' : 'warning',
			'message' => ! empty( $seo_description ) ? 'Meta description is set' : 'Meta description is not set',
		);
		if ( ! empty( $seo_description ) ) {
			$len = strlen( $seo_description );
			$results[] = array(
				'test'    => 'meta_description_length',
				'status'  => ( $len >= 120 && $len <= 160 ) ? 'passed' : 'warning',
				'message' => "Meta description length: $len characters",
			);
		}
		$content_length = str_word_count( wp_strip_all_tags( $post->post_content ) );
		$results[] = array(
			'test'    => 'content_length',
			'status'  => $content_length >= 300 ? 'passed' : 'warning',
			'message' => "Content length: $content_length words",
		);
		if ( ! empty( $focus_keyword ) ) {
			$in_title = false !== stripos( $post->post_title, $focus_keyword );
			$results[] = array(
				'test'    => 'keyword_in_title',
				'status'  => $in_title ? 'passed' : 'warning',
				'message' => $in_title ? 'Focus keyword found in title' : 'Focus keyword not found in title',
			);
		}
		return $results;
	}

	public static function format_test_results( array $test_results ): array {
		$passed = 0; $warnings = 0; $failed = 0;
		foreach ( $test_results as $r ) {
			if ( 'passed' === $r['status'] ) $passed++;
			elseif ( 'warning' === $r['status'] ) $warnings++;
			elseif ( 'failed' === $r['status'] ) $failed++;
		}
		return array(
			'passed'   => $passed,
			'warnings' => $warnings,
			'failed'   => $failed,
			'total'    => count( $test_results ),
		);
	}

	public static function save_location_meta( int $post_id, array $a ): void {
		if ( isset( $a['latitude'] ) )  update_post_meta( $post_id, 'rank_math_local_business_latitude', (float) $a['latitude'] );
		if ( isset( $a['longitude'] ) ) update_post_meta( $post_id, 'rank_math_local_business_longitude', (float) $a['longitude'] );
		if ( isset( $a['phone'] ) )     update_post_meta( $post_id, 'rank_math_local_business_phone', sanitize_text_field( $a['phone'] ) );
		if ( isset( $a['email'] ) )     update_post_meta( $post_id, 'rank_math_local_business_email', sanitize_email( $a['email'] ) );
		if ( isset( $a['address'] ) && is_array( $a['address'] ) ) {
			$address = array();
			foreach ( array( 'street', 'city', 'state', 'postal_code', 'country' ) as $f ) {
				if ( isset( $a['address'][ $f ] ) ) $address[ $f ] = sanitize_text_field( $a['address'][ $f ] );
			}
			update_post_meta( $post_id, 'rank_math_local_business_address', $address );
		}
	}

	/** Returns ['maps' => table, 'variations' => table] or null if not present. */
	public static function get_link_genius_maps_tables() {
		global $wpdb;
		$maps       = $wpdb->prefix . 'rank_math_link_genius_maps';
		$variations = $wpdb->prefix . 'rank_math_link_genius_map_variations';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $maps ) ) !== $maps ) {
			return null;
		}
		return array( 'maps' => $maps, 'variations' => $variations );
	}

	public static function get_position_movers( array $a, string $type ): array {
		$days  = isset( $a['days'] ) ? min( absint( $a['days'] ), 90 ) : 30;
		$limit = isset( $a['limit'] ) ? min( absint( $a['limit'] ), 50 ) : 10;
		if ( 0 === $days ) $days = 30;

		global $wpdb;
		$table = $wpdb->prefix . 'rank_math_analytics_gsc';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
			return array( 'success' => true, 'data' => array(), 'message' => 'Analytics GSC table not found.' );
		}

		$current_end   = gmdate( 'Y-m-d' );
		$current_start = gmdate( 'Y-m-d', strtotime( "-{$days} days" ) );
		$prev_end      = gmdate( 'Y-m-d', strtotime( "-{$days} days -1 day" ) );
		$prev_start    = gmdate( 'Y-m-d', strtotime( '-' . ( $days * 2 ) . ' days' ) );
		$order_dir     = ( 'winning' === $type ) ? 'DESC' : 'ASC';

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT
				    cur.page,
				    cur.avg_position  AS position_current,
				    prev.avg_position AS position_previous,
				    (prev.avg_position - cur.avg_position) AS position_diff,
				    cur.total_clicks AS clicks,
				    cur.total_impressions AS impressions
				 FROM (
				    SELECT page, AVG(position) AS avg_position, SUM(clicks) AS total_clicks, SUM(impressions) AS total_impressions
				    FROM {$table}
				    WHERE created BETWEEN %s AND %s
				    GROUP BY page
				 ) AS cur
				 INNER JOIN (
				    SELECT page, AVG(position) AS avg_position
				    FROM {$table}
				    WHERE created BETWEEN %s AND %s
				    GROUP BY page
				 ) AS prev ON cur.page = prev.page
				 ORDER BY position_diff {$order_dir}
				 LIMIT %d",
				$current_start . ' 00:00:00',
				$current_end . ' 23:59:59',
				$prev_start . ' 00:00:00',
				$prev_end . ' 23:59:59',
				$limit
			),
			ARRAY_A
		);

		return array( 'success' => true, 'type' => $type, 'days' => $days, 'data' => $rows ?: array() );
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
		// Post Meta / Social / Canonical / Analysis (8)
		// ============================================================

		$reg['rankmath_get_post_meta'] = array(
			'desc'     => 'Get Rank Math SEO meta for a post: title, description, focus_keywords array, canonical_url, robots_meta.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();

				$title       = get_post_meta( $post_id, 'rank_math_title', true );
				$description = get_post_meta( $post_id, 'rank_math_description', true );
				$canonical   = get_post_meta( $post_id, 'rank_math_canonical_url', true );

				$focus_keywords = array();
				$fk = get_post_meta( $post_id, 'rank_math_focus_keyword', true );
				if ( ! empty( $fk ) ) {
					foreach ( explode( ',', $fk ) as $kw ) {
						$kw = trim( $kw );
						if ( $kw !== '' ) $focus_keywords[] = $kw;
					}
				}

				$robots = get_post_meta( $post_id, 'rank_math_robots', true );
				$robots = is_array( $robots ) ? $robots : array();

				return array(
					'post_id'          => $post_id,
					'seo_title'        => $title ?: '',
					'meta_description' => $description ?: '',
					'focus_keywords'   => $focus_keywords,
					'canonical_url'    => $canonical ?: '',
					'robots_meta'      => array(
						'noindex'      => in_array( 'noindex', $robots, true ),
						'nofollow'     => in_array( 'nofollow', $robots, true ),
						'noarchive'    => in_array( 'noarchive', $robots, true ),
						'noimageindex' => in_array( 'noimageindex', $robots, true ),
						'nosnippet'    => in_array( 'nosnippet', $robots, true ),
					),
				);
			},
		);

		$reg['rankmath_get_social_meta'] = array(
			'desc'     => 'Get Rank Math SEO social meta (Open Graph and Twitter Card) for a post.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();

				return array(
					'post_id' => $post_id,
					'open_graph' => array(
						'title'       => get_post_meta( $post_id, 'rank_math_facebook_title', true ) ?: '',
						'description' => get_post_meta( $post_id, 'rank_math_facebook_description', true ) ?: '',
						'image'       => get_post_meta( $post_id, 'rank_math_facebook_image', true ) ?: '',
						'image_id'    => absint( get_post_meta( $post_id, 'rank_math_facebook_image_id', true ) ),
					),
					'twitter' => array(
						'title'       => get_post_meta( $post_id, 'rank_math_twitter_title', true ) ?: '',
						'description' => get_post_meta( $post_id, 'rank_math_twitter_description', true ) ?: '',
						'image'       => get_post_meta( $post_id, 'rank_math_twitter_image', true ) ?: '',
						'image_id'    => absint( get_post_meta( $post_id, 'rank_math_twitter_image_id', true ) ),
						'card_type'   => get_post_meta( $post_id, 'rank_math_twitter_card_type', true ) ?: 'summary_large_image',
					),
				);
			},
		);

		$reg['rankmath_get_canonical_url'] = array(
			'desc'     => 'Get the canonical URL for a post as set in Rank Math SEO (falls back to permalink if not custom).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();

				$canonical = get_post_meta( $post_id, 'rank_math_canonical_url', true );
				$is_custom = ! empty( $canonical );
				if ( empty( $canonical ) ) {
					$canonical = get_permalink( $post_id );
				}
				return array( 'post_id' => $post_id, 'canonical_url' => $canonical ?: '', 'is_custom' => $is_custom );
			},
		);

		$reg['rankmath_analyze_content'] = array(
			'desc'     => 'Get comprehensive SEO analysis for a post: SEO score, test results, pass/warn/fail summary.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();

				$results = WPXMCP_Tools_RankMath::get_test_results( $post_id );
				return array(
					'post_id'      => $post_id,
					'seo_score'    => WPXMCP_Tools_RankMath::get_seo_score( $post_id ),
					'test_results' => $results,
					'summary'      => WPXMCP_Tools_RankMath::format_test_results( $results ),
				);
			},
		);

		$reg['rankmath_get_keyword_analysis'] = array(
			'desc'     => 'Analyze focus keyword usage and density in a post (supports multiple comma-separated keywords).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				$post    = WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();

				$fk        = get_post_meta( $post_id, 'rank_math_focus_keyword', true );
				$keywords  = array();
				$word_count = 0;

				if ( ! empty( $fk ) ) {
					$content    = strtolower( wp_strip_all_tags( $post->post_content . ' ' . $post->post_title ) );
					$word_count = str_word_count( $content );
					foreach ( explode( ',', $fk ) as $kw ) {
						$kw = trim( $kw );
						if ( $kw === '' ) continue;
						$kw_lower = strtolower( $kw );
						$count    = substr_count( $content, $kw_lower );
						$density  = $word_count > 0 ? round( ( $count / $word_count ) * 100, 2 ) : 0;
						$keywords[] = array(
							'keyword'  => $kw,
							'count'    => $count,
							'density'  => $density,
							'in_title' => false !== stripos( $post->post_title, $kw ),
						);
					}
				}

				return array( 'post_id' => $post_id, 'word_count' => $word_count, 'keywords' => $keywords );
			},
		);

		$reg['rankmath_get_seo_suggestions'] = array(
			'desc'     => 'Get actionable SEO improvement suggestions for a post (missing/short/long title, description, keyword, thin content).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				$post    = WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();

				$suggestions = array();
				$title       = get_post_meta( $post_id, 'rank_math_title', true );
				$description = get_post_meta( $post_id, 'rank_math_description', true );
				$fk          = get_post_meta( $post_id, 'rank_math_focus_keyword', true );

				if ( empty( $title ) ) {
					$suggestions[] = array( 'type' => 'warning', 'category' => 'meta', 'message' => 'SEO title is not set. Add a custom SEO title for better search visibility.' );
				}
				if ( empty( $description ) ) {
					$suggestions[] = array( 'type' => 'warning', 'category' => 'meta', 'message' => 'Meta description is not set. Add a compelling meta description (150-160 characters).' );
				} elseif ( strlen( $description ) < 120 ) {
					$suggestions[] = array( 'type' => 'info', 'category' => 'meta', 'message' => 'Meta description is short. Consider expanding it to 150-160 characters.' );
				} elseif ( strlen( $description ) > 160 ) {
					$suggestions[] = array( 'type' => 'warning', 'category' => 'meta', 'message' => 'Meta description is too long. Keep it under 160 characters to avoid truncation.' );
				}
				if ( empty( $fk ) ) {
					$suggestions[] = array( 'type' => 'warning', 'category' => 'keywords', 'message' => 'No focus keyword set. Add at least one focus keyword to optimize content.' );
				}
				$len = str_word_count( wp_strip_all_tags( $post->post_content ) );
				if ( $len < 300 ) {
					$suggestions[] = array( 'type' => 'warning', 'category' => 'content', 'message' => "Content is short ($len words). Aim for at least 300 words for better SEO." );
				}

				return array( 'post_id' => $post_id, 'suggestions' => $suggestions, 'total' => count( $suggestions ) );
			},
		);

		$reg['rankmath_get_schema_types'] = array(
			'desc'    => 'List all available schema types in Rank Math.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_RankMath::require_active();
				$types = array(
					'Article', 'BlogPosting', 'NewsArticle', 'WebPage', 'Product', 'Review', 'Recipe',
					'HowTo', 'FAQ', 'Course', 'Event', 'JobPosting', 'LocalBusiness', 'Organization',
					'Person', 'VideoObject', 'SoftwareApplication', 'Book', 'Movie', 'MusicAlbum',
				);
				return array( 'schema_types' => $types, 'total' => count( $types ) );
			},
		);

		$reg['rankmath_get_post_schema'] = array(
			'desc'     => 'Get all schema markup entries stored on a post.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_active();
				return array( 'post_id' => $post_id, 'schemas' => array_values( WPXMCP_Tools_RankMath::get_post_schema_entries( $post_id ) ) );
			},
		);

		// ============================================================
		// Post Meta / Schema writes (6)
		// ============================================================

		$reg['rankmath_update_post_meta'] = array(
			'desc'     => 'Update Rank Math SEO meta for a post: title, description, focus_keywords array, canonical_url, robots_meta.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'          => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'seo_title'        => array( 'type' => 'string', 'description' => 'SEO title.' ),
				'meta_description' => array( 'type' => 'string', 'description' => 'Meta description.' ),
				'focus_keywords'   => array( 'type' => 'array', 'description' => 'Array of focus keywords.' ),
				'canonical_url'    => array( 'type' => 'string', 'description' => 'Custom canonical URL.' ),
				'robots_meta'      => array( 'type' => 'object', 'description' => 'noindex, nofollow, noarchive, noimageindex, nosnippet booleans. Omitted fields unchanged.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'edit_post', $post_id ) ) {
					throw new Exception( 'You do not have permission to edit this post.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				$updated = array();

				if ( isset( $a['seo_title'] ) ) {
					update_post_meta( $post_id, 'rank_math_title', sanitize_text_field( $a['seo_title'] ) );
					$updated[] = 'seo_title';
				}
				if ( isset( $a['meta_description'] ) ) {
					update_post_meta( $post_id, 'rank_math_description', sanitize_textarea_field( $a['meta_description'] ) );
					$updated[] = 'meta_description';
				}
				if ( isset( $a['focus_keywords'] ) && is_array( $a['focus_keywords'] ) ) {
					$kws = array_filter( array_map( 'sanitize_text_field', $a['focus_keywords'] ) );
					update_post_meta( $post_id, 'rank_math_focus_keyword', implode( ', ', $kws ) );
					$updated[] = 'focus_keywords';
				}
				if ( isset( $a['canonical_url'] ) ) {
					update_post_meta( $post_id, 'rank_math_canonical_url', esc_url_raw( $a['canonical_url'] ) );
					$updated[] = 'canonical_url';
				}
				if ( isset( $a['robots_meta'] ) && is_array( $a['robots_meta'] ) ) {
					$input    = $a['robots_meta'];
					$existing = get_post_meta( $post_id, 'rank_math_robots', true );
					$existing = is_array( $existing ) ? $existing : array();
					$directives = array( 'noindex', 'nofollow', 'noarchive', 'noimageindex', 'nosnippet' );
					$new = array();
					foreach ( $directives as $d ) {
						if ( isset( $input[ $d ] ) ) {
							if ( $input[ $d ] ) $new[] = $d;
						} elseif ( in_array( $d, $existing, true ) ) {
							$new[] = $d;
						}
					}
					update_post_meta( $post_id, 'rank_math_robots', $new );
					$updated[] = 'robots_meta';
				}

				return array(
					'success'        => true,
					'post_id'        => $post_id,
					'updated_fields' => $updated,
					'message'        => 'Successfully updated ' . count( $updated ) . ' field(s).',
				);
			},
		);

		$reg['rankmath_update_social_meta'] = array(
			'desc'     => 'Update Rank Math SEO social meta (Open Graph and Twitter Card) for a post.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'              => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'og_title'             => array( 'type' => 'string', 'description' => 'Open Graph title.' ),
				'og_description'       => array( 'type' => 'string', 'description' => 'Open Graph description.' ),
				'og_image'             => array( 'type' => 'string', 'description' => 'Open Graph image URL.' ),
				'twitter_title'        => array( 'type' => 'string', 'description' => 'Twitter Card title.' ),
				'twitter_description'  => array( 'type' => 'string', 'description' => 'Twitter Card description.' ),
				'twitter_image'        => array( 'type' => 'string', 'description' => 'Twitter Card image URL.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'edit_post', $post_id ) ) {
					throw new Exception( 'You do not have permission to edit this post.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				$updated = array();
				$map = array(
					'og_title'             => 'rank_math_facebook_title',
					'og_description'       => 'rank_math_facebook_description',
					'og_image'             => 'rank_math_facebook_image',
					'twitter_title'        => 'rank_math_twitter_title',
					'twitter_description'  => 'rank_math_twitter_description',
					'twitter_image'        => 'rank_math_twitter_image',
				);
				foreach ( $map as $arg => $meta_key ) {
					if ( ! isset( $a[ $arg ] ) ) continue;
					$value = in_array( $arg, array( 'og_image', 'twitter_image' ), true )
						? esc_url_raw( $a[ $arg ] )
						: ( strpos( $arg, 'description' ) !== false ? sanitize_textarea_field( $a[ $arg ] ) : sanitize_text_field( $a[ $arg ] ) );
					update_post_meta( $post_id, $meta_key, $value );
					$updated[] = $arg;
				}

				return array(
					'success'        => true,
					'post_id'        => $post_id,
					'updated_fields' => $updated,
					'message'        => 'Successfully updated ' . count( $updated ) . ' social meta field(s).',
				);
			},
		);

		$reg['rankmath_set_canonical_url'] = array(
			'desc'     => 'Set or clear the custom canonical URL for a post. Pass empty string to remove and fall back to permalink.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'       => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'canonical_url' => array( 'type' => 'string', 'description' => 'Canonical URL; empty string removes the custom canonical.' ),
			),
			'required' => array( 'post_id', 'canonical_url' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'edit_post', $post_id ) ) {
					throw new Exception( 'You do not have permission to edit this post.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				$canonical = $a['canonical_url'];
				if ( empty( $canonical ) ) {
					delete_post_meta( $post_id, 'rank_math_canonical_url' );
					return array(
						'success'       => true,
						'post_id'       => $post_id,
						'canonical_url' => get_permalink( $post_id ),
						'is_custom'     => false,
						'message'       => 'Custom canonical URL removed. Using default permalink.',
					);
				}

				$canonical = esc_url_raw( $canonical );
				if ( empty( $canonical ) ) {
					throw new Exception( 'Invalid canonical URL provided.' );
				}
				update_post_meta( $post_id, 'rank_math_canonical_url', $canonical );

				return array(
					'success'       => true,
					'post_id'       => $post_id,
					'canonical_url' => $canonical,
					'is_custom'     => true,
					'message'       => 'Canonical URL updated successfully.',
				);
			},
		);

		$reg['rankmath_update_schema'] = array(
			'desc'     => 'Update or set the schema type and properties for a post. Supported types: Article, BlogPosting, NewsArticle, Product, Recipe, HowTo, FAQ/FAQPage, Course, Event, JobPosting, LocalBusiness, Organization, Person, VideoObject, Book, Movie, MusicAlbum, Service, Restaurant, SoftwareApplication, Dataset, ClaimReview, PodcastEpisode.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'     => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'schema_type' => array( 'type' => 'string', 'description' => 'Schema type name.' ),
				'schema_data' => array( 'type' => 'object', 'description' => 'Additional schema properties as key-value pairs.' ),
			),
			'required' => array( 'post_id', 'schema_type' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'edit_post', $post_id ) ) {
					throw new Exception( 'You do not have permission to edit this post.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				$schema_type = sanitize_text_field( $a['schema_type'] );
				$type_map = array(
					'Article'             => array( '@type' => 'Article',  'articleType' => 'Article' ),
					'BlogPosting'         => array( '@type' => 'Article',  'articleType' => 'BlogPosting' ),
					'NewsArticle'         => array( '@type' => 'Article',  'articleType' => 'NewsArticle' ),
					'Product'             => array( '@type' => 'Product' ),
					'Recipe'              => array( '@type' => 'Recipe' ),
					'HowTo'               => array( '@type' => 'HowTo' ),
					'FAQ'                 => array( '@type' => 'FAQPage' ),
					'FAQPage'             => array( '@type' => 'FAQPage' ),
					'Course'              => array( '@type' => 'Course' ),
					'Event'               => array( '@type' => 'Event' ),
					'JobPosting'          => array( '@type' => 'JobPosting' ),
					'LocalBusiness'       => array( '@type' => 'LocalBusiness' ),
					'Organization'        => array( '@type' => 'Organization' ),
					'Person'              => array( '@type' => 'Person' ),
					'VideoObject'         => array( '@type' => 'VideoObject' ),
					'Book'                => array( '@type' => 'Book' ),
					'Movie'               => array( '@type' => 'Movie' ),
					'MusicAlbum'          => array( '@type' => 'MusicAlbum' ),
					'Service'             => array( '@type' => 'Service' ),
					'Restaurant'          => array( '@type' => 'Restaurant' ),
					'SoftwareApplication' => array( '@type' => 'SoftwareApplication' ),
					'Dataset'             => array( '@type' => 'Dataset' ),
					'ClaimReview'         => array( '@type' => 'ClaimReview' ),
					'PodcastEpisode'      => array( '@type' => 'PodcastEpisode' ),
				);

				if ( ! isset( $type_map[ $schema_type ] ) ) {
					throw new Exception( 'Invalid schema type. Supported types: ' . implode( ', ', array_keys( $type_map ) ) );
				}

				$type_info = $type_map[ $schema_type ];
				$at_type   = $type_info['@type'];

				$entries  = WPXMCP_Tools_RankMath::get_post_schema_entries( $post_id );
				$existing_key = null;
				$existing     = null;
				foreach ( $entries as $key => $schema ) {
					if ( null === $existing_key || ! empty( $schema['metadata']['isPrimary'] ) ) {
						$existing_key = $key;
						$existing     = $schema;
					}
				}

				$extra = array();
				if ( isset( $a['schema_data'] ) && is_array( $a['schema_data'] ) ) {
					foreach ( $a['schema_data'] as $field => $value ) {
						$extra[ sanitize_key( $field ) ] = sanitize_text_field( $value );
					}
				}

				if ( $existing ) {
					$existing['@type'] = $at_type;
					if ( isset( $type_info['articleType'] ) ) {
						$existing['articleType'] = $type_info['articleType'];
					} else {
						unset( $existing['articleType'] );
					}
					if ( isset( $existing['metadata']['title'] ) ) {
						$existing['metadata']['title'] = $schema_type;
					}
					foreach ( $extra as $field => $value ) {
						$existing[ $field ] = $value;
					}
					update_post_meta( $post_id, $existing_key, $existing );
					$meta_key = $existing_key;
				} else {
					$schema = array(
						'@type'    => $at_type,
						'metadata' => array( 'title' => $schema_type, 'type' => 'template', 'isPrimary' => '1' ),
					);
					if ( 'Article' === $at_type ) {
						$schema['headline']    = '%seo_title%';
						$schema['description'] = '%seo_description%';
						$schema['keywords']    = '%keywords%';
						$schema['articleType'] = $type_info['articleType'];
					}
					foreach ( $extra as $field => $value ) {
						$schema[ $field ] = $value;
					}
					$meta_key = WPXMCP_Tools_RankMath::make_schema_meta_key();
					add_post_meta( $post_id, $meta_key, $schema );
				}

				return array(
					'success'     => true,
					'post_id'     => $post_id,
					'schema_type' => $schema_type,
					'meta_key'    => $meta_key,
					'message'     => "Schema type updated to $schema_type successfully.",
				);
			},
		);

		$reg['rankmath_add_faq_schema'] = array(
			'desc'     => 'Add FAQ (FAQPage) schema to a post with question/answer pairs. Updates the existing FAQPage entry if one exists.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'faqs'    => array( 'type' => 'array', 'description' => 'Array of {question, answer} objects.' ),
			),
			'required' => array( 'post_id', 'faqs' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'edit_post', $post_id ) ) {
					throw new Exception( 'You do not have permission to edit this post.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				if ( ! is_array( $a['faqs'] ) || empty( $a['faqs'] ) ) {
					throw new Exception( 'FAQ items are required.' );
				}

				$items = array();
				foreach ( $a['faqs'] as $faq ) {
					if ( ! isset( $faq['question'], $faq['answer'] ) ) continue;
					$items[] = array(
						'question' => sanitize_text_field( $faq['question'] ),
						'answer'   => sanitize_textarea_field( $faq['answer'] ),
					);
				}
				if ( empty( $items ) ) {
					throw new Exception( 'No valid FAQ items provided. Each item must have question and answer.' );
				}

				$entities = array();
				foreach ( $items as $item ) {
					$entities[] = array(
						'@type'          => 'Question',
						'name'           => $item['question'],
						'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $item['answer'] ),
					);
				}

				$entries  = WPXMCP_Tools_RankMath::get_post_schema_entries( $post_id );
				$meta_key = null;
				foreach ( $entries as $key => $schema ) {
					if ( isset( $schema['@type'] ) && 'FAQPage' === $schema['@type'] ) {
						$schema['mainEntity'] = $entities;
						update_post_meta( $post_id, $key, $schema );
						$meta_key = $key;
						break;
					}
				}
				if ( ! $meta_key ) {
					$meta_key = WPXMCP_Tools_RankMath::make_schema_meta_key();
					add_post_meta( $post_id, $meta_key, array(
						'@type'      => 'FAQPage',
						'metadata'   => array( 'title' => 'FAQ', 'type' => 'template', 'isPrimary' => '1' ),
						'mainEntity' => $entities,
					) );
				}

				return array(
					'success'   => true,
					'post_id'   => $post_id,
					'faq_count' => count( $items ),
					'meta_key'  => $meta_key,
					'message'   => 'FAQ schema added successfully with ' . count( $items ) . ' question(s).',
				);
			},
		);

		$reg['rankmath_add_howto_schema'] = array(
			'desc'     => 'Add HowTo schema to a post with step-by-step instructions. Updates the existing HowTo entry if one exists.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'     => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'name'        => array( 'type' => 'string', 'description' => 'HowTo name/title.' ),
				'description' => array( 'type' => 'string', 'description' => 'HowTo description.' ),
				'steps'       => array( 'type' => 'array', 'description' => 'Array of {name, text, image?} step objects.' ),
			),
			'required' => array( 'post_id', 'name', 'steps' ),
			'handler'  => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'edit_post', $post_id ) ) {
					throw new Exception( 'You do not have permission to edit this post.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				if ( empty( $a['name'] ) ) {
					throw new Exception( 'HowTo name is required.' );
				}
				if ( ! is_array( $a['steps'] ) || empty( $a['steps'] ) ) {
					throw new Exception( 'HowTo steps are required.' );
				}

				$name        = sanitize_text_field( $a['name'] );
				$description = isset( $a['description'] ) ? sanitize_textarea_field( $a['description'] ) : '';

				$steps = array();
				foreach ( $a['steps'] as $step ) {
					if ( ! isset( $step['name'], $step['text'] ) ) continue;
					$s = array(
						'name' => sanitize_text_field( $step['name'] ),
						'text' => sanitize_textarea_field( $step['text'] ),
					);
					if ( ! empty( $step['image'] ) ) $s['image'] = esc_url_raw( $step['image'] );
					$steps[] = $s;
				}
				if ( empty( $steps ) ) {
					throw new Exception( 'No valid steps provided. Each step must have name and text.' );
				}

				$how_to_steps = array();
				foreach ( $steps as $step ) {
					$entry = array( '@type' => 'HowToStep', 'name' => $step['name'], 'text' => $step['text'] );
					if ( ! empty( $step['image'] ) ) $entry['image'] = $step['image'];
					$how_to_steps[] = $entry;
				}

				$schema = array(
					'@type'       => 'HowTo',
					'metadata'    => array( 'title' => 'HowTo', 'type' => 'template', 'isPrimary' => '1' ),
					'name'        => $name,
					'description' => $description,
					'step'        => $how_to_steps,
				);

				$entries  = WPXMCP_Tools_RankMath::get_post_schema_entries( $post_id );
				$meta_key = null;
				foreach ( $entries as $key => $existing ) {
					if ( isset( $existing['@type'] ) && 'HowTo' === $existing['@type'] ) {
						update_post_meta( $post_id, $key, $schema );
						$meta_key = $key;
						break;
					}
				}
				if ( ! $meta_key ) {
					$meta_key = WPXMCP_Tools_RankMath::make_schema_meta_key();
					add_post_meta( $post_id, $meta_key, $schema );
				}

				return array(
					'success'    => true,
					'post_id'    => $post_id,
					'step_count' => count( $steps ),
					'meta_key'   => $meta_key,
					'message'    => 'HowTo schema added successfully with ' . count( $steps ) . ' step(s).',
				);
			},
		);

		// ============================================================
		// Redirects (3) + 404 Logs (1)
		// ============================================================

		$reg['rankmath_get_redirects'] = array(
			'desc'    => 'List Rank Math redirects with optional type/search filter and pagination.',
			'risk'    => 'read',
			'schema'  => array(
				'type'   => array( 'type' => 'string', 'description' => '301 | 302 | 307 | 410 | 451.' ),
				'search' => array( 'type' => 'string', 'description' => 'Search in destination URLs.' ),
				'limit'  => array( 'type' => 'integer', 'description' => 'Default 20, max 100.' ),
				'offset' => array( 'type' => 'integer', 'description' => 'Default 0.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'You do not have permission to manage redirects.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_redirections';
				WPXMCP_Tools_RankMath::require_table( $table, 'Rank Math redirections table not found. Please ensure redirections module is enabled.' );

				$limit  = isset( $a['limit'] ) ? min( absint( $a['limit'] ), 100 ) : 20;
				$offset = isset( $a['offset'] ) ? absint( $a['offset'] ) : 0;

				$where  = array( '1=1' );
				$values = array();
				if ( ! empty( $a['type'] ) ) { $where[] = 'header_code = %s'; $values[] = sanitize_text_field( $a['type'] ); }
				if ( ! empty( $a['search'] ) ) { $where[] = 'url_to LIKE %s'; $values[] = '%' . $wpdb->esc_like( sanitize_text_field( $a['search'] ) ) . '%'; }

				$where_sql = implode( ' AND ', $where );
				$values2   = array_merge( $values, array( $limit, $offset ) );
				$redirects = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY id DESC LIMIT %d OFFSET %d", $values2 ), ARRAY_A );
				$total     = $wpdb->get_var( empty( $values ) ? "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}" : $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}", $values ) );

				return array( 'redirects' => $redirects ?: array(), 'total' => absint( $total ), 'limit' => $limit, 'offset' => $offset );
			},
		);

		$reg['rankmath_create_redirect'] = array(
			'desc'     => 'Create a Rank Math redirect with comparison type (exact, contains, starts-with, ends-with, regex).',
			'risk'     => 'write',
			'schema'   => array(
				'source'      => array( 'type' => 'string', 'description' => 'Source URL or pattern.' ),
				'destination' => array( 'type' => 'string', 'description' => 'Destination URL.' ),
				'type'        => array( 'type' => 'string', 'description' => '301 (default) | 302 | 307 | 410 | 451.' ),
				'comparison'  => array( 'type' => 'string', 'description' => 'exact (default) | contains | starts-with | ends-with | regex.' ),
			),
			'required' => array( 'source', 'destination' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'You do not have permission to create redirects.' );
				}
				WPXMCP_Tools_RankMath::require_active();
				if ( empty( $a['source'] ) ) throw new Exception( 'Source URL is required.' );
				if ( empty( $a['destination'] ) ) throw new Exception( 'Destination URL is required.' );

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_redirections';
				WPXMCP_Tools_RankMath::require_table( $table, 'Rank Math redirections table not found. Please ensure redirections module is enabled.' );

				$source      = sanitize_text_field( $a['source'] );
				$destination = esc_url_raw( $a['destination'] );
				$type        = isset( $a['type'] ) ? sanitize_text_field( $a['type'] ) : '301';
				$comparison  = isset( $a['comparison'] ) ? sanitize_text_field( $a['comparison'] ) : 'exact';

				$valid_types = array( '301', '302', '307', '410', '451' );
				if ( ! in_array( $type, $valid_types, true ) ) {
					throw new Exception( 'Invalid redirect type. Supported types: ' . implode( ', ', $valid_types ) );
				}
				$valid_comparisons = array( 'exact', 'contains', 'starts-with', 'ends-with', 'regex' );
				if ( ! in_array( $comparison, $valid_comparisons, true ) ) {
					throw new Exception( 'Invalid comparison type. Supported types: ' . implode( ', ', $valid_comparisons ) );
				}

				$data = array(
					'sources'     => maybe_serialize( array( array( 'pattern' => $source, 'comparison' => $comparison ) ) ),
					'url_to'      => $destination,
					'header_code' => $type,
					'status'      => 'active',
					'hits'        => 0,
					'created'     => current_time( 'mysql' ),
					'updated'     => current_time( 'mysql' ),
				);

				$result = $wpdb->insert( $table, $data );
				if ( false === $result ) {
					throw new Exception( 'Failed to create redirect.' );
				}

				return array(
					'success'     => true,
					'redirect_id' => $wpdb->insert_id,
					'source'      => $source,
					'destination' => $destination,
					'type'        => $type,
					'comparison'  => $comparison,
					'message'     => 'Redirect created successfully.',
				);
			},
		);

		$reg['rankmath_get_404_logs'] = array(
			'desc'    => 'Get 404 error logs from the Rank Math 404 Monitor, useful for creating redirects.',
			'risk'    => 'read',
			'schema'  => array(
				'limit'   => array( 'type' => 'integer', 'description' => 'Default 20, max 100.' ),
				'offset'  => array( 'type' => 'integer', 'description' => 'Default 0.' ),
				'orderby' => array( 'type' => 'string', 'description' => 'accessed (default) | uri | referer.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'You do not have permission to view 404 logs.' );
				}
				WPXMCP_Tools_RankMath::require_active();

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_404_logs';
				WPXMCP_Tools_RankMath::require_table( $table, 'Rank Math 404 monitor table not found. Please ensure 404 monitor module is enabled.' );

				$limit   = isset( $a['limit'] ) ? min( absint( $a['limit'] ), 100 ) : 20;
				$offset  = isset( $a['offset'] ) ? absint( $a['offset'] ) : 0;
				$orderby = isset( $a['orderby'] ) ? sanitize_text_field( $a['orderby'] ) : 'accessed';
				if ( ! in_array( $orderby, array( 'accessed', 'uri', 'referer' ), true ) ) $orderby = 'accessed';

				$logs  = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} ORDER BY {$orderby} DESC LIMIT %d OFFSET %d", $limit, $offset ), ARRAY_A );
				$total = $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );

				return array( 'logs' => $logs ?: array(), 'total' => absint( $total ), 'limit' => $limit, 'offset' => $offset );
			},
		);

		// ============================================================
		// Pro Analytics — Basic (3)
		// ============================================================

		$reg['rankmath_get_analytics'] = array(
			'desc'    => 'Get Rank Math Pro analytics data: page SEO/page scores, indexability, schemas in use, for a date range.',
			'risk'    => 'read',
			'schema'  => array(
				'start_date' => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default 30 days ago.' ),
				'end_date'   => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default today.' ),
				'limit'      => array( 'type' => 'integer', 'description' => 'Default 20.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'You do not have permission to view analytics.' );
				}
				WPXMCP_Tools_RankMath::require_active();
				WPXMCP_Tools_RankMath::require_pro();

				$start = isset( $a['start_date'] ) ? sanitize_text_field( $a['start_date'] ) : gmdate( 'Y-m-d', strtotime( '-30 days' ) );
				$end   = isset( $a['end_date'] ) ? sanitize_text_field( $a['end_date'] ) : gmdate( 'Y-m-d' );
				$limit = isset( $a['limit'] ) ? min( absint( $a['limit'] ), 100 ) : 20;

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_analytics_objects';
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
					return array( 'success' => true, 'data' => array(), 'total' => 0, 'start_date' => $start, 'end_date' => $end, 'message' => 'Analytics table not found. Ensure Rank Math Pro Analytics module is enabled and synced.' );
				}

				$rows = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT page, object_type, object_subtype, object_id, seo_score, page_score, is_indexable, schemas_in_use, created
						 FROM {$table} WHERE created BETWEEN %s AND %s ORDER BY seo_score DESC LIMIT %d",
						$start . ' 00:00:00', $end . ' 23:59:59', $limit
					),
					ARRAY_A
				);
				$total = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE created BETWEEN %s AND %s", $start . ' 00:00:00', $end . ' 23:59:59' ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'start_date' => $start, 'end_date' => $end, 'limit' => $limit );
			},
		);

		$reg['rankmath_get_search_console_data'] = array(
			'desc'    => 'Get Google Search Console insights via Rank Math Pro: clicks, impressions, CTR, position grouped by query/page/country/device.',
			'risk'    => 'read',
			'schema'  => array(
				'start_date' => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default 30 days ago.' ),
				'end_date'   => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default today.' ),
				'dimension'  => array( 'type' => 'string', 'description' => 'query (default) | page | country | device.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'You do not have permission to view Search Console data.' );
				}
				WPXMCP_Tools_RankMath::require_active();
				WPXMCP_Tools_RankMath::require_pro();

				$start = isset( $a['start_date'] ) ? sanitize_text_field( $a['start_date'] ) : gmdate( 'Y-m-d', strtotime( '-30 days' ) );
				$end   = isset( $a['end_date'] ) ? sanitize_text_field( $a['end_date'] ) : gmdate( 'Y-m-d' );
				$dim   = isset( $a['dimension'] ) ? sanitize_text_field( $a['dimension'] ) : 'query';
				if ( ! in_array( $dim, array( 'query', 'page', 'country', 'device' ), true ) ) $dim = 'query';
				$limit = isset( $a['limit'] ) ? min( absint( $a['limit'] ), 100 ) : 20;

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_analytics_gsc';
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
					return array( 'success' => true, 'data' => array(), 'total' => 0, 'dimension' => $dim, 'start_date' => $start, 'end_date' => $end, 'message' => 'Search Console table not found. Ensure Rank Math Pro Analytics module is enabled and GSC data has been synced.' );
				}

				// $dim is validated against a whitelist above.
				$rows = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT {$dim} AS dimension_value, SUM(clicks) AS clicks, SUM(impressions) AS impressions, AVG(ctr) AS ctr, AVG(position) AS position
						 FROM {$table} WHERE created BETWEEN %s AND %s GROUP BY {$dim} ORDER BY impressions DESC LIMIT %d",
						$start . ' 00:00:00', $end . ' 23:59:59', $limit
					),
					ARRAY_A
				);
				$total = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT {$dim}) FROM {$table} WHERE created BETWEEN %s AND %s", $start . ' 00:00:00', $end . ' 23:59:59' ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'dimension' => $dim, 'start_date' => $start, 'end_date' => $end, 'limit' => $limit );
			},
		);

		$reg['rankmath_get_content_ai_score'] = array(
			'desc'    => 'Get the Content AI optimization score stored for a post (requires Rank Math Pro with Content AI credits).',
			'risk'    => 'read',
			'schema'  => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler' => function ( $a ) {
				$post_id = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				WPXMCP_Tools_RankMath::require_post( $post_id );
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'You do not have permission to view Content AI scores.' );
				}
				WPXMCP_Tools_RankMath::require_active();
				if ( ! WPXMCP_Tools_RankMath::is_pro_active() ) {
					throw new Exception( 'This feature requires Rank Math Pro with Content AI.' );
				}

				$score = get_post_meta( $post_id, 'rank_math_contentai_score', true );
				return array(
					'success'          => true,
					'post_id'          => $post_id,
					'content_ai_score' => $score ? absint( $score ) : 0,
					'message'          => 'Content AI score retrieved.',
					'note'             => 'Content AI score requires Rank Math Pro with Content AI credits.',
				);
			},
		);

		// ============================================================
		// Global Meta (2)
		// ============================================================

		$reg['rankmath_get_global_meta'] = array(
			'desc'    => 'Get global meta settings: robots meta defaults, title separator, capitalization, OpenGraph thumbnail.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$general = get_option( 'rank-math-options-general', array() );
				return array(
					'robots_meta' => array(
						'index'          => empty( $general['noindex'] ),
						'no_follow'      => ! empty( $general['nofollow'] ),
						'no_image_index' => ! empty( $general['noimageindex'] ),
						'no_archive'     => ! empty( $general['noarchive'] ),
						'no_snippet'     => ! empty( $general['nosnippet'] ),
					),
					'separator_character' => $general['title_separator'] ?? '-',
					'capitalize_titles'   => ! empty( $general['capitalize_titles'] ),
					'opengraph_thumbnail' => $general['open_graph_image'] ?? '',
				);
			},
		);

		$reg['rankmath_update_global_meta'] = array(
			'desc'    => 'Update global meta settings.',
			'risk'    => 'write',
			'schema'  => array(
				'robots_meta'         => array( 'type' => 'object', 'description' => 'index, no_follow, no_image_index, no_archive, no_snippet booleans.' ),
				'separator_character' => array( 'type' => 'string', 'description' => 'One of: - – — » | · *' ),
				'capitalize_titles'   => array( 'type' => 'boolean', 'description' => 'Auto-capitalize titles.' ),
				'opengraph_thumbnail' => array( 'type' => 'string', 'description' => 'Default OpenGraph image URL.' ),
			),
			'handler' => function ( $a ) {
				$general = get_option( 'rank-math-options-general', array() );

				if ( isset( $a['robots_meta'] ) ) {
					$robots = $a['robots_meta'];
					if ( isset( $robots['index'] ) )          $general['noindex']      = ! $robots['index'];
					if ( isset( $robots['no_follow'] ) )       $general['nofollow']     = $robots['no_follow'];
					if ( isset( $robots['no_image_index'] ) )   $general['noimageindex'] = $robots['no_image_index'];
					if ( isset( $robots['no_archive'] ) )       $general['noarchive']    = $robots['no_archive'];
					if ( isset( $robots['no_snippet'] ) )       $general['nosnippet']    = $robots['no_snippet'];
				}
				if ( isset( $a['separator_character'] ) ) {
					$allowed = array( '-', '–', '—', '»', '|', '·', '*' );
					if ( ! in_array( $a['separator_character'], $allowed, true ) ) {
						throw new Exception( 'Invalid separator character' );
					}
					$general['title_separator'] = $a['separator_character'];
				}
				if ( isset( $a['capitalize_titles'] ) ) $general['capitalize_titles'] = (bool) $a['capitalize_titles'];
				if ( isset( $a['opengraph_thumbnail'] ) ) $general['open_graph_image'] = esc_url_raw( $a['opengraph_thumbnail'] );

				update_option( 'rank-math-options-general', $general );
				return array( 'success' => true, 'message' => 'Global meta settings updated successfully' );
			},
		);

		// ============================================================
		// Local SEO (2)
		// ============================================================

		$reg['rankmath_get_local_seo'] = array(
			'desc'    => 'Get Local SEO settings for Knowledge Graph optimization.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$general = get_option( 'rank-math-options-general', array() );
				$address = $general['local_address'] ?? array();
				return array(
					'person_or_company'        => $general['knowledgegraph_type'] ?? 'person',
					'website_name'              => $general['knowledgegraph_name'] ?? get_bloginfo( 'name' ),
					'website_alternate_name'    => $general['knowledgegraph_alternate_name'] ?? '',
					'person_organization_name'  => $general['knowledgegraph_name'] ?? '',
					'logo'                      => $general['knowledgegraph_logo'] ?? '',
					'url'                       => $general['url'] ?? get_site_url(),
					'contact_info' => array(
						'phone'   => $general['phone'] ?? '',
						'email'   => $general['email'] ?? '',
						'address' => array(
							'street'      => $address['streetAddress'] ?? '',
							'city'        => $address['addressLocality'] ?? '',
							'state'       => $address['addressRegion'] ?? '',
							'postal_code' => $address['postalCode'] ?? '',
							'country'     => $address['addressCountry'] ?? '',
						),
					),
					'opening_hours' => $general['opening_hours'] ?? array(),
					'price_range'   => $general['price_range'] ?? '',
				);
			},
		);

		$reg['rankmath_update_local_seo'] = array(
			'desc'    => 'Update Local SEO settings.',
			'risk'    => 'write',
			'schema'  => array(
				'person_or_company'        => array( 'type' => 'string', 'description' => 'person | organization.' ),
				'website_name'              => array( 'type' => 'string' ),
				'website_alternate_name'    => array( 'type' => 'string' ),
				'person_organization_name'  => array( 'type' => 'string' ),
				'logo'                      => array( 'type' => 'string' ),
				'url'                       => array( 'type' => 'string' ),
				'contact_info'              => array( 'type' => 'object', 'description' => 'phone, email, address {street, city, state, postal_code, country}.' ),
				'opening_hours'             => array( 'type' => 'array', 'description' => 'Each item: {day, open, close}.' ),
				'price_range'               => array( 'type' => 'string' ),
			),
			'handler' => function ( $a ) {
				$general = get_option( 'rank-math-options-general', array() );

				if ( isset( $a['person_or_company'] ) && in_array( $a['person_or_company'], array( 'person', 'organization' ), true ) ) {
					$general['knowledgegraph_type'] = $a['person_or_company'];
				}
				if ( isset( $a['website_name'] ) )             $general['knowledgegraph_name'] = sanitize_text_field( $a['website_name'] );
				if ( isset( $a['website_alternate_name'] ) )    $general['knowledgegraph_alternate_name'] = sanitize_text_field( $a['website_alternate_name'] );
				if ( isset( $a['person_organization_name'] ) )  $general['knowledgegraph_name'] = sanitize_text_field( $a['person_organization_name'] );
				if ( isset( $a['logo'] ) )                      $general['knowledgegraph_logo'] = esc_url_raw( $a['logo'] );
				if ( isset( $a['url'] ) )                       $general['url'] = esc_url_raw( $a['url'] );

				if ( isset( $a['contact_info'] ) ) {
					$contact = $a['contact_info'];
					if ( isset( $contact['phone'] ) ) $general['phone'] = sanitize_text_field( $contact['phone'] );
					if ( isset( $contact['email'] ) ) $general['email'] = sanitize_email( $contact['email'] );
					if ( isset( $contact['address'] ) ) {
						$address = $contact['address'];
						$general['local_address'] = array(
							'streetAddress'   => isset( $address['street'] ) ? sanitize_text_field( $address['street'] ) : '',
							'addressLocality' => isset( $address['city'] ) ? sanitize_text_field( $address['city'] ) : '',
							'addressRegion'   => isset( $address['state'] ) ? sanitize_text_field( $address['state'] ) : '',
							'postalCode'      => isset( $address['postal_code'] ) ? sanitize_text_field( $address['postal_code'] ) : '',
							'addressCountry'  => isset( $address['country'] ) ? sanitize_text_field( $address['country'] ) : '',
						);
					}
				}
				if ( isset( $a['opening_hours'] ) )  $general['opening_hours'] = $a['opening_hours'];
				if ( isset( $a['price_range'] ) )     $general['price_range'] = sanitize_text_field( $a['price_range'] );

				update_option( 'rank-math-options-general', $general );
				return array( 'success' => true, 'message' => 'Local SEO settings updated successfully' );
			},
		);

		// ============================================================
		// Social Settings (2)
		// ============================================================

		$reg['rankmath_get_social_settings'] = array(
			'desc'    => 'Get global social media profile settings.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$social = get_option( 'rank-math-options-social', array() );
				return array(
					'facebook' => array(
						'page_url'       => $social['facebook_author_urls'] ?? '',
						'authorship_url' => $social['facebook_authorship'] ?? '',
						'admin_id'       => $social['facebook_admin_id'] ?? '',
						'app_id'         => $social['facebook_app_id'] ?? '',
						'app_secret'     => '',
					),
					'twitter' => array(
						'username'  => $social['twitter_author_names'] ?? '',
						'card_type' => $social['twitter_card_type'] ?? 'summary_large_image',
					),
					'additional_profiles' => isset( $social['social_url_facebook'] ) ? array( $social['social_url_facebook'] ) : array(),
				);
			},
		);

		$reg['rankmath_update_social_settings'] = array(
			'desc'    => 'Update global social media settings.',
			'risk'    => 'write',
			'schema'  => array(
				'facebook'            => array( 'type' => 'object', 'description' => 'page_url, authorship_url, admin_id, app_id, app_secret.' ),
				'twitter'             => array( 'type' => 'object', 'description' => 'username, card_type.' ),
				'additional_profiles' => array( 'type' => 'array', 'description' => 'Array of profile URLs.' ),
			),
			'handler' => function ( $a ) {
				$social = get_option( 'rank-math-options-social', array() );

				if ( isset( $a['facebook'] ) ) {
					$fb = $a['facebook'];
					if ( isset( $fb['page_url'] ) )       $social['facebook_author_urls'] = esc_url_raw( $fb['page_url'] );
					if ( isset( $fb['authorship_url'] ) )  $social['facebook_authorship']  = esc_url_raw( $fb['authorship_url'] );
					if ( isset( $fb['admin_id'] ) )         $social['facebook_admin_id']    = sanitize_text_field( $fb['admin_id'] );
					if ( isset( $fb['app_id'] ) )            $social['facebook_app_id']      = sanitize_text_field( $fb['app_id'] );
					if ( isset( $fb['app_secret'] ) )        $social['facebook_app_secret']  = sanitize_text_field( $fb['app_secret'] );
				}
				if ( isset( $a['twitter'] ) ) {
					$tw = $a['twitter'];
					if ( isset( $tw['username'] ) ) $social['twitter_author_names'] = sanitize_text_field( str_replace( '@', '', $tw['username'] ) );
					if ( isset( $tw['card_type'] ) && in_array( $tw['card_type'], array( 'summary', 'summary_large_image' ), true ) ) {
						$social['twitter_card_type'] = $tw['card_type'];
					}
				}
				if ( isset( $a['additional_profiles'] ) && is_array( $a['additional_profiles'] ) ) {
					foreach ( $a['additional_profiles'] as $profile ) {
						$social['social_url_facebook'] = esc_url_raw( $profile );
						break;
					}
				}

				update_option( 'rank-math-options-social', $social );
				return array( 'success' => true, 'message' => 'Social settings updated successfully' );
			},
		);

		// ============================================================
		// Homepage (2)
		// ============================================================

		$reg['rankmath_get_homepage_settings'] = array(
			'desc'    => 'Get homepage SEO template settings.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$titles = get_option( 'rank-math-options-titles', array() );
				return array(
					'title'              => $titles['homepage_title'] ?? '',
					'meta_description'   => $titles['homepage_description'] ?? '',
					'thumbnail_facebook' => $titles['homepage_facebook_image'] ?? '',
				);
			},
		);

		$reg['rankmath_update_homepage_settings'] = array(
			'desc'    => 'Update homepage SEO template.',
			'risk'    => 'write',
			'schema'  => array(
				'title'              => array( 'type' => 'string' ),
				'meta_description'   => array( 'type' => 'string' ),
				'thumbnail_facebook' => array( 'type' => 'string' ),
			),
			'handler' => function ( $a ) {
				$titles = get_option( 'rank-math-options-titles', array() );
				if ( isset( $a['title'] ) )              $titles['homepage_title'] = sanitize_text_field( $a['title'] );
				if ( isset( $a['meta_description'] ) )    $titles['homepage_description'] = sanitize_textarea_field( $a['meta_description'] );
				if ( isset( $a['thumbnail_facebook'] ) )  $titles['homepage_facebook_image'] = esc_url_raw( $a['thumbnail_facebook'] );
				update_option( 'rank-math-options-titles', $titles );
				return array( 'success' => true, 'message' => 'Homepage settings updated successfully' );
			},
		);

		// ============================================================
		// Post Type Settings (2)
		// ============================================================

		$reg['rankmath_get_post_type_settings'] = array(
			'desc'     => 'Get SEO template settings for a post type.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Post type slug.' ),
			),
			'required' => array( 'post_type' ),
			'handler'  => function ( $a ) {
				$pt = isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : '';
				if ( ! post_type_exists( $pt ) ) {
					throw new Exception( 'Invalid post type' );
				}
				$titles = get_option( 'rank-math-options-titles', array() );
				$prefix = "pt_{$pt}_";
				$robots = (array) ( $titles[ $prefix . 'custom_robots' ] ?? array() );

				return array(
					'post_type'            => $pt,
					'title_template'       => $titles[ $prefix . 'title' ] ?? '',
					'description_template' => $titles[ $prefix . 'description' ] ?? '',
					'schema_type'          => $titles[ $prefix . 'default_article_type' ] ?? 'Article',
					'article_type'         => $titles[ $prefix . 'default_article_type' ] ?? 'BlogPosting',
					'robots_meta' => array(
						'index'  => ! in_array( 'noindex', $robots, true ),
						'follow' => ! in_array( 'nofollow', $robots, true ),
					),
				);
			},
		);

		$reg['rankmath_update_post_type_settings'] = array(
			'desc'     => 'Update SEO template for a post type.',
			'risk'     => 'write',
			'schema'   => array(
				'post_type'            => array( 'type' => 'string' ),
				'title_template'       => array( 'type' => 'string' ),
				'description_template' => array( 'type' => 'string' ),
				'schema_type'          => array( 'type' => 'string' ),
				'article_type'         => array( 'type' => 'string' ),
				'robots_meta'          => array( 'type' => 'object', 'description' => 'index, follow booleans.' ),
			),
			'required' => array( 'post_type' ),
			'handler'  => function ( $a ) {
				$pt = isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : '';
				if ( ! post_type_exists( $pt ) ) {
					throw new Exception( 'Invalid post type' );
				}
				$titles = get_option( 'rank-math-options-titles', array() );
				$prefix = "pt_{$pt}_";

				if ( isset( $a['title_template'] ) )       $titles[ $prefix . 'title' ] = sanitize_text_field( $a['title_template'] );
				if ( isset( $a['description_template'] ) ) $titles[ $prefix . 'description' ] = sanitize_textarea_field( $a['description_template'] );
				if ( isset( $a['schema_type'] ) )           $titles[ $prefix . 'default_article_type' ] = sanitize_text_field( $a['schema_type'] );
				if ( isset( $a['article_type'] ) )          $titles[ $prefix . 'default_article_type' ] = sanitize_text_field( $a['article_type'] );
				if ( isset( $a['robots_meta'] ) ) {
					$robots = array();
					if ( isset( $a['robots_meta']['index'] ) && ! $a['robots_meta']['index'] )  $robots[] = 'noindex';
					if ( isset( $a['robots_meta']['follow'] ) && ! $a['robots_meta']['follow'] ) $robots[] = 'nofollow';
					$titles[ $prefix . 'custom_robots' ] = $robots;
				}

				update_option( 'rank-math-options-titles', $titles );
				return array( 'success' => true, 'message' => 'Post type settings updated successfully' );
			},
		);

		// ============================================================
		// Taxonomy Settings (2)
		// ============================================================

		$reg['rankmath_get_taxonomy_settings'] = array(
			'desc'     => 'Get SEO template settings for a taxonomy.',
			'risk'     => 'read',
			'schema'   => array(
				'taxonomy' => array( 'type' => 'string', 'description' => 'Taxonomy slug.' ),
			),
			'required' => array( 'taxonomy' ),
			'handler'  => function ( $a ) {
				$tax = isset( $a['taxonomy'] ) ? sanitize_key( $a['taxonomy'] ) : '';
				if ( ! taxonomy_exists( $tax ) ) {
					throw new Exception( 'Invalid taxonomy' );
				}
				$titles = get_option( 'rank-math-options-titles', array() );
				$prefix = "tax_{$tax}_";
				$robots = (array) ( $titles[ $prefix . 'custom_robots' ] ?? array() );

				return array(
					'taxonomy'             => $tax,
					'title_template'       => $titles[ $prefix . 'title' ] ?? '',
					'description_template' => $titles[ $prefix . 'description' ] ?? '',
					'robots_meta' => array(
						'index'  => ! in_array( 'noindex', $robots, true ),
						'follow' => ! in_array( 'nofollow', $robots, true ),
					),
				);
			},
		);

		$reg['rankmath_update_taxonomy_settings'] = array(
			'desc'     => 'Update SEO template for a taxonomy.',
			'risk'     => 'write',
			'schema'   => array(
				'taxonomy'             => array( 'type' => 'string' ),
				'title_template'       => array( 'type' => 'string' ),
				'description_template' => array( 'type' => 'string' ),
				'robots_meta'          => array( 'type' => 'object', 'description' => 'index, follow booleans.' ),
			),
			'required' => array( 'taxonomy' ),
			'handler'  => function ( $a ) {
				$tax = isset( $a['taxonomy'] ) ? sanitize_key( $a['taxonomy'] ) : '';
				if ( ! taxonomy_exists( $tax ) ) {
					throw new Exception( 'Invalid taxonomy' );
				}
				$titles = get_option( 'rank-math-options-titles', array() );
				$prefix = "tax_{$tax}_";

				if ( isset( $a['title_template'] ) )       $titles[ $prefix . 'title' ] = sanitize_text_field( $a['title_template'] );
				if ( isset( $a['description_template'] ) ) $titles[ $prefix . 'description' ] = sanitize_textarea_field( $a['description_template'] );
				if ( isset( $a['robots_meta'] ) ) {
					$robots = array();
					if ( isset( $a['robots_meta']['index'] ) && ! $a['robots_meta']['index'] )  $robots[] = 'noindex';
					if ( isset( $a['robots_meta']['follow'] ) && ! $a['robots_meta']['follow'] ) $robots[] = 'nofollow';
					$titles[ $prefix . 'custom_robots' ] = $robots;
				}

				update_option( 'rank-math-options-titles', $titles );
				return array( 'success' => true, 'message' => 'Taxonomy settings updated successfully' );
			},
		);

		// ============================================================
		// Sitemap General (2)
		// ============================================================

		$reg['rankmath_get_sitemap_general'] = array(
			'desc'    => 'Get general sitemap settings: links per sitemap, image inclusion, exclusions.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$s = get_option( 'rank-math-options-sitemap', array() );
				return array(
					'links_per_sitemap'       => isset( $s['items_per_page'] ) ? (int) $s['items_per_page'] : 200,
					'images_in_sitemaps'      => ! isset( $s['include_images'] ) || 'on' === $s['include_images'],
					'include_featured_images' => isset( $s['include_featured_image'] ) && 'on' === $s['include_featured_image'],
					'exclude_posts'           => isset( $s['exclude_posts'] ) ? array_map( 'intval', explode( ',', $s['exclude_posts'] ) ) : array(),
					'exclude_terms'           => isset( $s['exclude_terms'] ) ? array_map( 'intval', explode( ',', $s['exclude_terms'] ) ) : array(),
				);
			},
		);

		$reg['rankmath_update_sitemap_general'] = array(
			'desc'    => 'Update general sitemap settings.',
			'risk'    => 'write',
			'schema'  => array(
				'links_per_sitemap'       => array( 'type' => 'integer', 'description' => '1-50000.' ),
				'images_in_sitemaps'      => array( 'type' => 'boolean' ),
				'include_featured_images' => array( 'type' => 'boolean' ),
				'exclude_posts'           => array( 'type' => 'array', 'description' => 'Post IDs.' ),
				'exclude_terms'           => array( 'type' => 'array', 'description' => 'Term IDs.' ),
			),
			'handler' => function ( $a ) {
				$s = get_option( 'rank-math-options-sitemap', array() );

				if ( isset( $a['links_per_sitemap'] ) ) {
					$links = (int) $a['links_per_sitemap'];
					if ( $links < 1 || $links > 50000 ) {
						throw new Exception( 'Links per sitemap must be between 1 and 50000' );
					}
					$s['items_per_page'] = $links;
				}
				if ( isset( $a['images_in_sitemaps'] ) )      $s['include_images'] = $a['images_in_sitemaps'] ? 'on' : 'off';
				if ( isset( $a['include_featured_images'] ) ) $s['include_featured_image'] = $a['include_featured_images'] ? 'on' : 'off';
				if ( isset( $a['exclude_posts'] ) && is_array( $a['exclude_posts'] ) ) $s['exclude_posts'] = implode( ',', array_map( 'intval', $a['exclude_posts'] ) );
				if ( isset( $a['exclude_terms'] ) && is_array( $a['exclude_terms'] ) ) $s['exclude_terms'] = implode( ',', array_map( 'intval', $a['exclude_terms'] ) );

				update_option( 'rank-math-options-sitemap', $s );
				return array( 'success' => true, 'message' => 'Sitemap general settings updated successfully' );
			},
		);

		// ============================================================
		// HTML Sitemap (2)
		// ============================================================

		$reg['rankmath_get_html_sitemap'] = array(
			'desc'    => 'Get HTML sitemap settings.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$s = get_option( 'rank-math-options-sitemap', array() );
				return array(
					'enabled'        => isset( $s['html_sitemap'] ) && 'on' === $s['html_sitemap'],
					'display_format' => $s['html_sitemap_display'] ?? 'shortcode',
					'shortcode'      => '[rank_math_html_sitemap]',
					'sort_by'        => $s['html_sitemap_sort'] ?? 'published_date',
					'show_dates'     => isset( $s['html_sitemap_show_dates'] ) && 'on' === $s['html_sitemap_show_dates'],
					'item_titles'    => $s['html_sitemap_titles'] ?? 'item_titles',
				);
			},
		);

		$reg['rankmath_update_html_sitemap'] = array(
			'desc'    => 'Update HTML sitemap settings.',
			'risk'    => 'write',
			'schema'  => array(
				'enabled'        => array( 'type' => 'boolean' ),
				'display_format' => array( 'type' => 'string', 'description' => 'shortcode | page.' ),
				'shortcode'      => array( 'type' => 'string' ),
				'sort_by'        => array( 'type' => 'string' ),
				'show_dates'     => array( 'type' => 'boolean' ),
				'item_titles'    => array( 'type' => 'string', 'description' => 'item_titles | seo_titles.' ),
			),
			'handler' => function ( $a ) {
				$s = get_option( 'rank-math-options-sitemap', array() );

				if ( isset( $a['enabled'] ) ) $s['html_sitemap'] = $a['enabled'] ? 'on' : 'off';
				if ( isset( $a['display_format'] ) && in_array( $a['display_format'], array( 'shortcode', 'page' ), true ) ) {
					$s['html_sitemap_display'] = $a['display_format'];
				}
				if ( isset( $a['sort_by'] ) )     $s['html_sitemap_sort'] = sanitize_text_field( $a['sort_by'] );
				if ( isset( $a['show_dates'] ) )  $s['html_sitemap_show_dates'] = $a['show_dates'] ? 'on' : 'off';
				if ( isset( $a['item_titles'] ) && in_array( $a['item_titles'], array( 'item_titles', 'seo_titles' ), true ) ) {
					$s['html_sitemap_titles'] = $a['item_titles'];
				}

				update_option( 'rank-math-options-sitemap', $s );
				return array( 'success' => true, 'message' => 'HTML sitemap settings updated successfully' );
			},
		);

		// ============================================================
		// Sitemap Post Type (2)
		// ============================================================

		$reg['rankmath_get_sitemap_post_type'] = array(
			'desc'     => 'Get sitemap settings for a specific post type.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Post type slug.' ),
			),
			'required' => array( 'post_type' ),
			'handler'  => function ( $a ) {
				$pt = isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : '';
				if ( ! post_type_exists( $pt ) ) {
					throw new Exception( 'Invalid post type' );
				}
				$s = get_option( 'rank-math-options-sitemap', array() );
				$prefix = "pt_{$pt}_";

				return array(
					'post_type'               => $pt,
					'include_in_sitemap'      => ! isset( $s[ $prefix . 'sitemap' ] ) || 'on' === $s[ $prefix . 'sitemap' ],
					'include_in_html_sitemap' => isset( $s[ $prefix . 'html_sitemap' ] ) && 'on' === $s[ $prefix . 'html_sitemap' ],
					'image_custom_fields'     => isset( $s[ $prefix . 'image_custom_fields' ] ) ? explode( "\n", $s[ $prefix . 'image_custom_fields' ] ) : array(),
				);
			},
		);

		$reg['rankmath_update_sitemap_post_type'] = array(
			'desc'     => 'Update sitemap settings for a specific post type.',
			'risk'     => 'write',
			'schema'   => array(
				'post_type'               => array( 'type' => 'string' ),
				'include_in_sitemap'      => array( 'type' => 'boolean' ),
				'include_in_html_sitemap' => array( 'type' => 'boolean' ),
				'image_custom_fields'     => array( 'type' => 'array', 'description' => 'Custom field names to pull images from.' ),
			),
			'required' => array( 'post_type' ),
			'handler'  => function ( $a ) {
				$pt = isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : '';
				if ( ! post_type_exists( $pt ) ) {
					throw new Exception( 'Invalid post type' );
				}
				$s = get_option( 'rank-math-options-sitemap', array() );
				$prefix = "pt_{$pt}_";

				if ( isset( $a['include_in_sitemap'] ) )       $s[ $prefix . 'sitemap' ] = $a['include_in_sitemap'] ? 'on' : 'off';
				if ( isset( $a['include_in_html_sitemap'] ) )  $s[ $prefix . 'html_sitemap' ] = $a['include_in_html_sitemap'] ? 'on' : 'off';
				if ( isset( $a['image_custom_fields'] ) && is_array( $a['image_custom_fields'] ) ) {
					$s[ $prefix . 'image_custom_fields' ] = implode( "\n", array_map( 'sanitize_text_field', $a['image_custom_fields'] ) );
				}

				update_option( 'rank-math-options-sitemap', $s );
				return array( 'success' => true, 'message' => 'Post type sitemap settings updated successfully' );
			},
		);

		// ============================================================
		// Sitemap Taxonomy (2)
		// ============================================================

		$reg['rankmath_get_sitemap_taxonomy'] = array(
			'desc'     => 'Get sitemap settings for a specific taxonomy.',
			'risk'     => 'read',
			'schema'   => array(
				'taxonomy' => array( 'type' => 'string', 'description' => 'Taxonomy slug.' ),
			),
			'required' => array( 'taxonomy' ),
			'handler'  => function ( $a ) {
				$tax = isset( $a['taxonomy'] ) ? sanitize_key( $a['taxonomy'] ) : '';
				if ( ! taxonomy_exists( $tax ) ) {
					throw new Exception( 'Invalid taxonomy' );
				}
				$s = get_option( 'rank-math-options-sitemap', array() );
				$prefix = "tax_{$tax}_";

				return array(
					'taxonomy'                => $tax,
					'include_in_sitemap'      => ! isset( $s[ $prefix . 'sitemap' ] ) || 'on' === $s[ $prefix . 'sitemap' ],
					'include_in_html_sitemap' => isset( $s[ $prefix . 'html_sitemap' ] ) && 'on' === $s[ $prefix . 'html_sitemap' ],
					'include_empty_terms'     => isset( $s[ $prefix . 'include_empty' ] ) && 'on' === $s[ $prefix . 'include_empty' ],
				);
			},
		);

		$reg['rankmath_update_sitemap_taxonomy'] = array(
			'desc'     => 'Update sitemap settings for a specific taxonomy.',
			'risk'     => 'write',
			'schema'   => array(
				'taxonomy'                => array( 'type' => 'string' ),
				'include_in_sitemap'      => array( 'type' => 'boolean' ),
				'include_in_html_sitemap' => array( 'type' => 'boolean' ),
				'include_empty_terms'     => array( 'type' => 'boolean' ),
			),
			'required' => array( 'taxonomy' ),
			'handler'  => function ( $a ) {
				$tax = isset( $a['taxonomy'] ) ? sanitize_key( $a['taxonomy'] ) : '';
				if ( ! taxonomy_exists( $tax ) ) {
					throw new Exception( 'Invalid taxonomy' );
				}
				$s = get_option( 'rank-math-options-sitemap', array() );
				$prefix = "tax_{$tax}_";

				if ( isset( $a['include_in_sitemap'] ) )       $s[ $prefix . 'sitemap' ] = $a['include_in_sitemap'] ? 'on' : 'off';
				if ( isset( $a['include_in_html_sitemap'] ) )  $s[ $prefix . 'html_sitemap' ] = $a['include_in_html_sitemap'] ? 'on' : 'off';
				if ( isset( $a['include_empty_terms'] ) )      $s[ $prefix . 'include_empty' ] = $a['include_empty_terms'] ? 'on' : 'off';

				update_option( 'rank-math-options-sitemap', $s );
				return array( 'success' => true, 'message' => 'Taxonomy sitemap settings updated successfully' );
			},
		);

		// ============================================================
		// Link Genius (Pro) (5)
		// ============================================================

		$reg['rankmath_get_links'] = array(
			'desc'    => 'List internal/external links tracked by Rank Math Pro Link Genius with optional filtering.',
			'risk'    => 'read',
			'schema'  => array(
				'post_id'         => array( 'type' => 'integer', 'description' => 'Filter links belonging to a specific post.' ),
				'is_internal'     => array( 'type' => 'boolean', 'description' => 'Filter by internal (true) or external (false).' ),
				'is_broken'       => array( 'type' => 'boolean', 'description' => 'Filter broken links only.' ),
				'is_nofollow'     => array( 'type' => 'boolean', 'description' => 'Filter nofollow links only.' ),
				'status_category' => array( 'type' => 'string', 'description' => 'working | broken | redirected.' ),
				'per_page'        => array( 'type' => 'integer', 'description' => 'Default 20, max 100.' ),
				'page'            => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'orderby'         => array( 'type' => 'string', 'description' => 'id | url | http_status_code | status_category. Default id.' ),
				'order'           => array( 'type' => 'string', 'description' => 'ASC | DESC. Default DESC.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_internal_links';
				WPXMCP_Tools_RankMath::require_table( $table, 'Link Genius table not found. Ensure Rank Math Pro Link Genius module is enabled.' );

				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 100 ) : 20;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				$valid_orderby = array( 'id', 'url', 'http_status_code', 'status_category' );
				$orderby = ( isset( $a['orderby'] ) && in_array( $a['orderby'], $valid_orderby, true ) ) ? $a['orderby'] : 'id';
				$order   = ( isset( $a['order'] ) && 'ASC' === strtoupper( $a['order'] ) ) ? 'ASC' : 'DESC';

				$where  = array( '1=1' );
				$values = array();
				if ( isset( $a['post_id'] ) )     { $where[] = 'post_id = %d'; $values[] = absint( $a['post_id'] ); }
				if ( isset( $a['is_internal'] ) )  { $where[] = 'is_internal = %d'; $values[] = $a['is_internal'] ? 1 : 0; }
				if ( ! empty( $a['is_broken'] ) )   { $where[] = "status_category = 'broken'"; }
				if ( isset( $a['is_nofollow'] ) )   { $where[] = 'is_nofollow = %d'; $values[] = $a['is_nofollow'] ? 1 : 0; }
				if ( isset( $a['status_category'] ) && in_array( $a['status_category'], array( 'working', 'broken', 'redirected' ), true ) ) {
					$where[] = 'status_category = %s'; $values[] = $a['status_category'];
				}

				$where_sql = implode( ' AND ', $where );
				$values[]  = $per_page;
				$values[]  = $offset;

				$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, post_id, url, anchor_text, is_internal, is_nofollow, http_status_code, status_category, robots_blocked, is_marked_safe FROM {$table} WHERE {$where_sql} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d", $values ), ARRAY_A );

				$count_values = array_slice( $values, 0, -2 );
				$total = $wpdb->get_var( empty( $count_values ) ? "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}" : $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}", $count_values ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'pages' => (int) ceil( absint( $total ) / $per_page ), 'page' => $page, 'per_page' => $per_page );
			},
		);

		$reg['rankmath_get_link_details'] = array(
			'desc'     => 'Get details for a single Link Genius link, including all posts it appears in.',
			'risk'     => 'read',
			'schema'   => array(
				'link_id' => array( 'type' => 'integer', 'description' => 'Link ID from the rank_math_internal_links table.' ),
			),
			'required' => array( 'link_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_internal_links';
				WPXMCP_Tools_RankMath::require_table( $table, 'Link Genius table not found.' );

				$link_id = absint( $a['link_id'] );
				$link    = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $link_id ), ARRAY_A );
				if ( ! $link ) {
					throw new Exception( 'Link not found.' );
				}

				$occurrences = $wpdb->get_results( $wpdb->prepare( "SELECT l.post_id, p.post_title, COUNT(*) AS occurrence_count FROM {$table} l LEFT JOIN {$wpdb->posts} p ON l.post_id = p.ID WHERE l.url = %s GROUP BY l.post_id", $link['url'] ), ARRAY_A );
				$link['occurrences'] = $occurrences ?: array();

				return array( 'success' => true, 'data' => $link );
			},
		);

		$reg['rankmath_get_link_audit'] = array(
			'desc'    => 'Get a Link Genius audit summary: broken/redirect/nofollow counts and top broken links.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_internal_links';
				WPXMCP_Tools_RankMath::require_table( $table, 'Link Genius table not found.' );

				$summary    = $wpdb->get_row( "SELECT COUNT(*) AS total, SUM(status_category = 'broken') AS broken, SUM(status_category = 'redirected') AS redirected, SUM(is_nofollow = 1) AS nofollow FROM {$table}", ARRAY_A );
				$top_broken = $wpdb->get_results( "SELECT id, url, post_id, http_status_code FROM {$table} WHERE status_category = 'broken' AND is_marked_safe = 0 ORDER BY id DESC LIMIT 20", ARRAY_A );

				return array(
					'success' => true,
					'summary' => array(
						'total'      => absint( $summary['total'] ),
						'broken'     => absint( $summary['broken'] ),
						'redirected' => absint( $summary['redirected'] ),
						'nofollow'   => absint( $summary['nofollow'] ),
					),
					'top_broken' => $top_broken ?: array(),
				);
			},
		);

		$reg['rankmath_update_link'] = array(
			'desc'     => "Update a link's URL, anchor text, nofollow, or target_blank in Rank Math Link Genius.",
			'risk'     => 'write',
			'schema'   => array(
				'link_id'      => array( 'type' => 'integer', 'description' => 'Link ID to update.' ),
				'new_url'      => array( 'type' => 'string', 'description' => 'New URL.' ),
				'new_anchor'   => array( 'type' => 'string', 'description' => 'New anchor text.' ),
				'is_nofollow'  => array( 'type' => 'boolean', 'description' => 'Set nofollow attribute.' ),
				'target_blank' => array( 'type' => 'boolean', 'description' => 'Open in new tab.' ),
			),
			'required' => array( 'link_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				global $wpdb;
				$table   = $wpdb->prefix . 'rank_math_internal_links';
				$link_id = absint( $a['link_id'] );
				WPXMCP_Tools_RankMath::require_table( $table, 'Link Genius table not found.' );

				$update = array();
				$format = array();
				if ( isset( $a['new_url'] ) )       { $update['url'] = esc_url_raw( $a['new_url'] ); $format[] = '%s'; }
				if ( isset( $a['new_anchor'] ) )     { $update['anchor_text'] = sanitize_text_field( $a['new_anchor'] ); $format[] = '%s'; }
				if ( isset( $a['is_nofollow'] ) )     { $update['is_nofollow'] = $a['is_nofollow'] ? 1 : 0; $format[] = '%d'; }
				if ( isset( $a['target_blank'] ) )    { $update['target_blank'] = $a['target_blank'] ? 1 : 0; $format[] = '%d'; }

				if ( empty( $update ) ) {
					throw new Exception( 'No fields to update provided.' );
				}

				$result = $wpdb->update( $table, $update, array( 'id' => $link_id ), $format, array( '%d' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to update link.' );
				}

				return array( 'success' => true, 'updated' => $result, 'link_id' => $link_id );
			},
		);

		$reg['rankmath_mark_link_safe'] = array(
			'desc'     => 'Mark a broken or suspect link as safe to suppress it from the Link Genius audit report.',
			'risk'     => 'write',
			'schema'   => array(
				'link_id' => array( 'type' => 'integer', 'description' => 'Link ID to mark.' ),
				'safe'    => array( 'type' => 'boolean', 'description' => 'True to mark safe, false to unmark. Default true.' ),
			),
			'required' => array( 'link_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				global $wpdb;
				$table   = $wpdb->prefix . 'rank_math_internal_links';
				$link_id = absint( $a['link_id'] );
				$safe    = isset( $a['safe'] ) ? (bool) $a['safe'] : true;
				WPXMCP_Tools_RankMath::require_table( $table, 'Link Genius table not found.' );

				$result = $wpdb->update( $table, array( 'is_marked_safe' => $safe ? 1 : 0 ), array( 'id' => $link_id ), array( '%d' ), array( '%d' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to update link.' );
				}

				return array( 'success' => true, 'link_id' => $link_id, 'is_marked_safe' => $safe );
			},
		);

		// ============================================================
		// Keyword Tracking (Pro) (3)
		// ============================================================

		$reg['rankmath_get_tracked_keywords'] = array(
			'desc'    => 'List keywords being tracked in Rank Math Pro Keyword Manager with performance data.',
			'risk'    => 'read',
			'schema'  => array(
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 20, max 100.' ),
				'orderby'  => array( 'type' => 'string', 'description' => 'keyword | position | impressions | clicks. Default impressions.' ),
				'search'   => array( 'type' => 'string', 'description' => 'Filter by search term.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_analytics_keyword_manager';
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
					return array( 'success' => true, 'data' => array(), 'total' => 0, 'message' => 'Keyword Manager table not found. Ensure Rank Math Pro Analytics module is enabled.' );
				}

				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 100 ) : 20;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;
				$offset   = ( $page - 1 ) * $per_page;
				$valid_orderby = array( 'keyword', 'position', 'impressions', 'clicks' );
				$orderby = ( isset( $a['orderby'] ) && in_array( $a['orderby'], $valid_orderby, true ) ) ? $a['orderby'] : 'impressions';

				$where  = array( '1=1' );
				$values = array();
				if ( ! empty( $a['search'] ) ) { $where[] = 'keyword LIKE %s'; $values[] = '%' . $wpdb->esc_like( sanitize_text_field( $a['search'] ) ) . '%'; }

				$where_sql = implode( ' AND ', $where );
				$values[]  = $per_page;
				$values[]  = $offset;

				$rows = $wpdb->get_results( $wpdb->prepare( "SELECT keyword, position, impressions, clicks, ctr FROM {$table} WHERE {$where_sql} ORDER BY {$orderby} DESC LIMIT %d OFFSET %d", $values ), ARRAY_A );
				$count_values = array_slice( $values, 0, -2 );
				$total = $wpdb->get_var( empty( $count_values ) ? "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}" : $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}", $count_values ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'pages' => (int) ceil( absint( $total ) / $per_page ), 'page' => $page, 'per_page' => $per_page );
			},
		);

		$reg['rankmath_add_tracked_keyword'] = array(
			'desc'     => 'Add a keyword to Rank Math Pro Keyword Manager tracking.',
			'risk'     => 'write',
			'schema'   => array(
				'keyword' => array( 'type' => 'string', 'description' => 'Keyword to start tracking.' ),
			),
			'required' => array( 'keyword' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				global $wpdb;
				$table   = $wpdb->prefix . 'rank_math_analytics_keyword_manager';
				$keyword = sanitize_text_field( $a['keyword'] );
				if ( empty( $keyword ) ) {
					throw new Exception( 'Keyword cannot be empty.' );
				}
				WPXMCP_Tools_RankMath::require_table( $table, 'Keyword Manager table not found. Ensure Rank Math Pro Analytics module is enabled.' );

				$exists = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE keyword = %s", $keyword ) );
				if ( $exists ) {
					throw new Exception( 'Keyword is already being tracked.' );
				}

				$result = $wpdb->insert( $table, array( 'keyword' => $keyword ), array( '%s' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to add keyword.' );
				}
				return array( 'success' => true, 'keyword' => $keyword, 'id' => $wpdb->insert_id );
			},
		);

		$reg['rankmath_remove_tracked_keyword'] = array(
			'desc'     => 'Remove a keyword from Rank Math Pro Keyword Manager tracking.',
			'risk'     => 'destructive',
			'schema'   => array(
				'keyword' => array( 'type' => 'string', 'description' => 'Keyword to stop tracking.' ),
			),
			'required' => array( 'keyword' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				global $wpdb;
				$table   = $wpdb->prefix . 'rank_math_analytics_keyword_manager';
				$keyword = sanitize_text_field( $a['keyword'] );
				if ( empty( $keyword ) ) {
					throw new Exception( 'Keyword cannot be empty.' );
				}
				WPXMCP_Tools_RankMath::require_table( $table, 'Keyword Manager table not found.' );

				$result = $wpdb->delete( $table, array( 'keyword' => $keyword ), array( '%s' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to remove keyword.' );
				}
				if ( 0 === $result ) {
					throw new Exception( 'Keyword not found in tracking list.' );
				}
				return array( 'success' => true, 'keyword' => $keyword );
			},
		);

		// ============================================================
		// Multi-Location SEO (Pro) (5)
		// ============================================================

		$reg['rankmath_get_locations'] = array(
			'desc'    => 'List all Rank Math Pro Local SEO location posts.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'search'   => array( 'type' => 'string', 'description' => 'Search by location title.' ),
				'category' => array( 'type' => 'string', 'description' => 'Filter by location category slug.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_RankMath::require_pro();

				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 100 ) : 20;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;

				$qa = array(
					'post_type'      => 'rank_math_locations',
					'post_status'    => array( 'publish', 'draft', 'pending' ),
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'title',
					'order'          => 'ASC',
				);
				if ( ! empty( $a['search'] ) ) $qa['s'] = sanitize_text_field( $a['search'] );
				if ( ! empty( $a['category'] ) ) {
					$qa['tax_query'] = array( array( 'taxonomy' => 'rank_math_locations_category', 'field' => 'slug', 'terms' => sanitize_key( $a['category'] ) ) );
				}

				$query = new WP_Query( $qa );
				$locations = array();
				foreach ( $query->posts as $post ) {
					$locations[] = array(
						'post_id' => $post->ID,
						'title'   => $post->post_title,
						'status'  => $post->post_status,
						'lat'     => get_post_meta( $post->ID, 'rank_math_local_business_latitude', true ),
						'lng'     => get_post_meta( $post->ID, 'rank_math_local_business_longitude', true ),
						'address' => get_post_meta( $post->ID, 'rank_math_local_business_address', true ),
					);
				}

				return array( 'success' => true, 'data' => $locations, 'total' => $query->found_posts, 'pages' => $query->max_num_pages, 'page' => $page, 'per_page' => $per_page );
			},
		);

		$reg['rankmath_get_location'] = array(
			'desc'     => 'Get all details for a single Rank Math Pro Local SEO location.',
			'risk'     => 'read',
			'schema'   => array(
				'location_id' => array( 'type' => 'integer', 'description' => 'Post ID of the location.' ),
			),
			'required' => array( 'location_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_RankMath::require_pro();

				$location_id = absint( $a['location_id'] );
				$post = get_post( $location_id );
				if ( ! $post || 'rank_math_locations' !== $post->post_type ) {
					throw new Exception( 'Location not found.' );
				}

				$meta_keys = array(
					'rank_math_local_business_latitude', 'rank_math_local_business_longitude',
					'rank_math_local_business_address', 'rank_math_local_business_phone',
					'rank_math_local_business_email', 'rank_math_local_business_type',
					'rank_math_schema_EmailAddress', 'rank_math_schema_telephone',
				);
				$meta = array();
				foreach ( $meta_keys as $key ) {
					$meta[ $key ] = get_post_meta( $location_id, $key, true );
				}

				return array(
					'success' => true,
					'data'    => array(
						'post_id' => $post->ID,
						'title'   => $post->post_title,
						'content' => $post->post_content,
						'status'  => $post->post_status,
						'meta'    => $meta,
					),
				);
			},
		);

		$reg['rankmath_create_location'] = array(
			'desc'     => 'Create a new Rank Math Pro Local SEO location post.',
			'risk'     => 'write',
			'schema'   => array(
				'title'     => array( 'type' => 'string', 'description' => 'Location name/title.' ),
				'content'   => array( 'type' => 'string', 'description' => 'Location description.' ),
				'status'    => array( 'type' => 'string', 'description' => 'publish (default) | draft | pending.' ),
				'latitude'  => array( 'type' => 'number' ),
				'longitude' => array( 'type' => 'number' ),
				'phone'     => array( 'type' => 'string' ),
				'email'     => array( 'type' => 'string' ),
				'address'   => array( 'type' => 'object', 'description' => 'street, city, state, postal_code, country.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'edit_posts' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$post_data = array(
					'post_type'    => 'rank_math_locations',
					'post_title'   => sanitize_text_field( $a['title'] ),
					'post_content' => isset( $a['content'] ) ? wp_kses_post( $a['content'] ) : '',
					'post_status'  => isset( $a['status'] ) && in_array( $a['status'], array( 'publish', 'draft', 'pending' ), true ) ? $a['status'] : 'publish',
				);

				$post_id = wp_insert_post( $post_data, true );
				if ( is_wp_error( $post_id ) ) {
					throw new Exception( $post_id->get_error_message() );
				}

				WPXMCP_Tools_RankMath::save_location_meta( $post_id, $a );

				return array( 'success' => true, 'location_id' => $post_id, 'message' => 'Location created successfully.' );
			},
		);

		$reg['rankmath_update_location'] = array(
			'desc'     => 'Update an existing Rank Math Pro Local SEO location post.',
			'risk'     => 'write',
			'schema'   => array(
				'location_id' => array( 'type' => 'integer', 'description' => 'Post ID of the location to update.' ),
				'title'       => array( 'type' => 'string' ),
				'content'     => array( 'type' => 'string' ),
				'status'      => array( 'type' => 'string', 'description' => 'publish | draft | pending.' ),
				'latitude'    => array( 'type' => 'number' ),
				'longitude'   => array( 'type' => 'number' ),
				'phone'       => array( 'type' => 'string' ),
				'email'       => array( 'type' => 'string' ),
				'address'     => array( 'type' => 'object', 'description' => 'street, city, state, postal_code, country.' ),
			),
			'required' => array( 'location_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'edit_posts' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$location_id = absint( $a['location_id'] );
				$post = get_post( $location_id );
				if ( ! $post || 'rank_math_locations' !== $post->post_type ) {
					throw new Exception( 'Location not found.' );
				}

				$post_data = array( 'ID' => $location_id );
				if ( isset( $a['title'] ) )    $post_data['post_title'] = sanitize_text_field( $a['title'] );
				if ( isset( $a['content'] ) )   $post_data['post_content'] = wp_kses_post( $a['content'] );
				if ( isset( $a['status'] ) && in_array( $a['status'], array( 'publish', 'draft', 'pending' ), true ) ) {
					$post_data['post_status'] = $a['status'];
				}

				if ( count( $post_data ) > 1 ) {
					$result = wp_update_post( $post_data, true );
					if ( is_wp_error( $result ) ) {
						throw new Exception( $result->get_error_message() );
					}
				}

				WPXMCP_Tools_RankMath::save_location_meta( $location_id, $a );

				return array( 'success' => true, 'location_id' => $location_id, 'message' => 'Location updated successfully.' );
			},
		);

		$reg['rankmath_delete_location'] = array(
			'desc'     => 'Delete or trash a Rank Math Pro Local SEO location post.',
			'risk'     => 'destructive',
			'schema'   => array(
				'location_id' => array( 'type' => 'integer', 'description' => 'Post ID of the location to delete.' ),
				'force'       => array( 'type' => 'boolean', 'description' => 'True to permanently delete, false to trash. Default false.' ),
			),
			'required' => array( 'location_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$location_id = absint( $a['location_id'] );
				$post = get_post( $location_id );
				if ( ! $post || 'rank_math_locations' !== $post->post_type ) {
					throw new Exception( 'Location not found.' );
				}

				$force  = isset( $a['force'] ) ? (bool) $a['force'] : false;
				$result = wp_delete_post( $location_id, $force );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete location.' );
				}

				return array( 'success' => true, 'location_id' => $location_id, 'force' => $force );
			},
		);

		// ============================================================
		// News & Video Sitemaps (Pro) (4)
		// ============================================================

		$reg['rankmath_get_news_sitemap_settings'] = array(
			'desc'    => 'Get Rank Math Pro Google News sitemap settings.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_RankMath::require_pro();
				$s = get_option( 'rank-math-options-sitemap', array() );
				return array(
					'success' => true,
					'data'    => array(
						'enabled'          => ! empty( $s['news_sitemap_enabled'] ),
						'post_types'       => isset( $s['news_sitemap_post_types'] ) ? (array) $s['news_sitemap_post_types'] : array(),
						'publication_name' => $s['news_sitemap_publication_name'] ?? get_bloginfo( 'name' ),
					),
				);
			},
		);

		$reg['rankmath_update_news_sitemap_settings'] = array(
			'desc'    => 'Update Rank Math Pro Google News sitemap settings.',
			'risk'    => 'write',
			'schema'  => array(
				'enabled'          => array( 'type' => 'boolean', 'description' => 'Enable or disable the news sitemap.' ),
				'post_types'       => array( 'type' => 'array', 'description' => 'Post types to include.' ),
				'publication_name' => array( 'type' => 'string', 'description' => 'Publication name for the news sitemap.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$s = get_option( 'rank-math-options-sitemap', array() );
				if ( isset( $a['enabled'] ) ) $s['news_sitemap_enabled'] = (bool) $a['enabled'];
				if ( isset( $a['post_types'] ) && is_array( $a['post_types'] ) ) $s['news_sitemap_post_types'] = array_map( 'sanitize_key', $a['post_types'] );
				if ( isset( $a['publication_name'] ) ) $s['news_sitemap_publication_name'] = sanitize_text_field( $a['publication_name'] );

				update_option( 'rank-math-options-sitemap', $s );
				return array( 'success' => true, 'message' => 'News sitemap settings updated.' );
			},
		);

		$reg['rankmath_get_video_sitemap_settings'] = array(
			'desc'    => 'Get Rank Math Pro video sitemap settings.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_RankMath::require_pro();
				$s = get_option( 'rank-math-options-sitemap', array() );
				return array(
					'success' => true,
					'data'    => array(
						'enabled'    => ! empty( $s['video_sitemap_enabled'] ),
						'post_types' => isset( $s['video_sitemap_post_types'] ) ? (array) $s['video_sitemap_post_types'] : array(),
					),
				);
			},
		);

		$reg['rankmath_update_video_sitemap_settings'] = array(
			'desc'    => 'Update Rank Math Pro video sitemap settings.',
			'risk'    => 'write',
			'schema'  => array(
				'enabled'    => array( 'type' => 'boolean', 'description' => 'Enable or disable the video sitemap.' ),
				'post_types' => array( 'type' => 'array', 'description' => 'Post types to include.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$s = get_option( 'rank-math-options-sitemap', array() );
				if ( isset( $a['enabled'] ) ) $s['video_sitemap_enabled'] = (bool) $a['enabled'];
				if ( isset( $a['post_types'] ) && is_array( $a['post_types'] ) ) $s['video_sitemap_post_types'] = array_map( 'sanitize_key', $a['post_types'] );

				update_option( 'rank-math-options-sitemap', $s );
				return array( 'success' => true, 'message' => 'Video sitemap settings updated.' );
			},
		);

		// ============================================================
		// Link Genius — Keyword Maps (Pro) (6)
		// ============================================================

		$reg['rankmath_get_keyword_maps'] = array(
			'desc'    => 'List Rank Math Pro Link Genius auto-linking keyword map rules.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page'   => array( 'type' => 'integer', 'description' => 'Default 20.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'search'     => array( 'type' => 'string', 'description' => 'Filter by map name.' ),
				'is_enabled' => array( 'type' => 'boolean', 'description' => 'Filter by enabled/disabled status.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$tables = WPXMCP_Tools_RankMath::get_link_genius_maps_tables();
				if ( null === $tables ) {
					return array( 'success' => true, 'data' => array(), 'total' => 0, 'message' => 'Link Genius Keyword Maps table not found. Ensure the Link Genius Pro module is enabled.' );
				}
				global $wpdb;
				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 100 ) : 20;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				$where  = array( '1=1' );
				$values = array();
				if ( ! empty( $a['search'] ) ) { $where[] = 'name LIKE %s'; $values[] = '%' . $wpdb->esc_like( sanitize_text_field( $a['search'] ) ) . '%'; }
				if ( isset( $a['is_enabled'] ) ) { $where[] = 'is_enabled = %d'; $values[] = $a['is_enabled'] ? 1 : 0; }

				$where_sql = implode( ' AND ', $where );
				$t = $tables['maps'];
				$values[] = $per_page;
				$values[] = $offset;

				$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t} WHERE {$where_sql} ORDER BY id DESC LIMIT %d OFFSET %d", $values ), ARRAY_A );
				$count_values = array_slice( $values, 0, -2 );
				$total = $wpdb->get_var( empty( $count_values ) ? "SELECT COUNT(*) FROM {$t} WHERE {$where_sql}" : $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE {$where_sql}", $count_values ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'pages' => (int) ceil( absint( $total ) / $per_page ), 'page' => $page );
			},
		);

		$reg['rankmath_create_keyword_map'] = array(
			'desc'     => 'Create a new Rank Math Pro Link Genius auto-linking rule with keyword variations.',
			'risk'     => 'write',
			'schema'   => array(
				'name'                 => array( 'type' => 'string', 'description' => 'Map name (internal label).' ),
				'target_url'           => array( 'type' => 'string', 'description' => 'URL to link to.' ),
				'variations'           => array( 'type' => 'array', 'description' => 'Keyword strings that will be auto-linked.' ),
				'description'          => array( 'type' => 'string' ),
				'is_enabled'           => array( 'type' => 'boolean', 'description' => 'Default true.' ),
				'max_links_per_post'   => array( 'type' => 'integer', 'description' => 'Default 3.' ),
				'auto_link_on_publish' => array( 'type' => 'boolean', 'description' => 'Default false.' ),
				'case_sensitive'       => array( 'type' => 'boolean', 'description' => 'Default false.' ),
			),
			'required' => array( 'name', 'target_url', 'variations' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$tables = WPXMCP_Tools_RankMath::get_link_genius_maps_tables();
				if ( null === $tables ) {
					throw new Exception( 'Link Genius Keyword Maps table not found.' );
				}
				global $wpdb;

				$data = array(
					'name'                 => sanitize_text_field( $a['name'] ),
					'target_url'           => esc_url_raw( $a['target_url'] ),
					'description'          => isset( $a['description'] ) ? sanitize_text_field( $a['description'] ) : '',
					'is_enabled'           => isset( $a['is_enabled'] ) ? ( $a['is_enabled'] ? 1 : 0 ) : 1,
					'max_links_per_post'   => isset( $a['max_links_per_post'] ) ? absint( $a['max_links_per_post'] ) : 3,
					'auto_link_on_publish' => isset( $a['auto_link_on_publish'] ) ? ( $a['auto_link_on_publish'] ? 1 : 0 ) : 0,
					'case_sensitive'       => isset( $a['case_sensitive'] ) ? ( $a['case_sensitive'] ? 1 : 0 ) : 0,
				);

				$result = $wpdb->insert( $tables['maps'], $data );
				if ( false === $result ) {
					throw new Exception( 'Failed to create keyword map.' );
				}

				$map_id     = $wpdb->insert_id;
				$variations = array();
				$tv         = $tables['variations'];
				foreach ( (array) $a['variations'] as $variation ) {
					$v = sanitize_text_field( $variation );
					if ( empty( $v ) ) continue;
					$wpdb->insert( $tv, array( 'keyword_map_id' => $map_id, 'variation' => $v, 'source' => 'manual' ) );
					$variations[] = array( 'id' => $wpdb->insert_id, 'variation' => $v );
				}

				return array( 'success' => true, 'map_id' => $map_id, 'data' => array_merge( $data, array( 'id' => $map_id, 'variations' => $variations ) ) );
			},
		);

		$reg['rankmath_update_keyword_map'] = array(
			'desc'     => 'Update an existing Rank Math Pro Link Genius keyword map rule.',
			'risk'     => 'write',
			'schema'   => array(
				'map_id'               => array( 'type' => 'integer', 'description' => 'Map ID to update.' ),
				'name'                 => array( 'type' => 'string' ),
				'target_url'           => array( 'type' => 'string' ),
				'description'          => array( 'type' => 'string' ),
				'is_enabled'           => array( 'type' => 'boolean' ),
				'max_links_per_post'   => array( 'type' => 'integer' ),
				'auto_link_on_publish' => array( 'type' => 'boolean' ),
				'case_sensitive'       => array( 'type' => 'boolean' ),
			),
			'required' => array( 'map_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$tables = WPXMCP_Tools_RankMath::get_link_genius_maps_tables();
				if ( null === $tables ) {
					throw new Exception( 'Link Genius Keyword Maps table not found.' );
				}
				global $wpdb;
				$map_id = absint( $a['map_id'] );
				$update = array();
				$format = array();

				if ( isset( $a['name'] ) ) { $update['name'] = sanitize_text_field( $a['name'] ); $format[] = '%s'; }
				if ( isset( $a['target_url'] ) ) { $update['target_url'] = esc_url_raw( $a['target_url'] ); $format[] = '%s'; }
				if ( isset( $a['description'] ) ) { $update['description'] = sanitize_text_field( $a['description'] ); $format[] = '%s'; }
				if ( isset( $a['is_enabled'] ) ) { $update['is_enabled'] = $a['is_enabled'] ? 1 : 0; $format[] = '%d'; }
				if ( isset( $a['max_links_per_post'] ) ) { $update['max_links_per_post'] = absint( $a['max_links_per_post'] ); $format[] = '%d'; }
				if ( isset( $a['auto_link_on_publish'] ) ) { $update['auto_link_on_publish'] = $a['auto_link_on_publish'] ? 1 : 0; $format[] = '%d'; }
				if ( isset( $a['case_sensitive'] ) ) { $update['case_sensitive'] = $a['case_sensitive'] ? 1 : 0; $format[] = '%d'; }

				if ( empty( $update ) ) {
					throw new Exception( 'No fields to update.' );
				}

				$t = $tables['maps'];
				$result = $wpdb->update( $t, $update, array( 'id' => $map_id ), $format, array( '%d' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to update keyword map.' );
				}

				return array( 'success' => true, 'map_id' => $map_id, 'updated' => $result );
			},
		);

		$reg['rankmath_delete_keyword_map'] = array(
			'desc'     => 'Delete a Rank Math Pro Link Genius keyword map rule and all its variations.',
			'risk'     => 'destructive',
			'schema'   => array(
				'map_id' => array( 'type' => 'integer', 'description' => 'Map ID to delete.' ),
			),
			'required' => array( 'map_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$tables = WPXMCP_Tools_RankMath::get_link_genius_maps_tables();
				if ( null === $tables ) {
					throw new Exception( 'Link Genius Keyword Maps table not found.' );
				}
				global $wpdb;
				$map_id = absint( $a['map_id'] );
				$tv = $tables['variations'];
				$t  = $tables['maps'];

				$wpdb->delete( $tv, array( 'keyword_map_id' => $map_id ), array( '%d' ) );
				$result = $wpdb->delete( $t, array( 'id' => $map_id ), array( '%d' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to delete keyword map.' );
				}

				return array( 'success' => true, 'map_id' => $map_id );
			},
		);

		$reg['rankmath_add_keyword_map_variation'] = array(
			'desc'     => 'Add a keyword variation to a Rank Math Pro Link Genius map rule.',
			'risk'     => 'write',
			'schema'   => array(
				'map_id'    => array( 'type' => 'integer', 'description' => 'Map ID to add variation to.' ),
				'variation' => array( 'type' => 'string', 'description' => 'Keyword string to add.' ),
			),
			'required' => array( 'map_id', 'variation' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$tables = WPXMCP_Tools_RankMath::get_link_genius_maps_tables();
				if ( null === $tables ) {
					throw new Exception( 'Link Genius Keyword Maps table not found.' );
				}
				global $wpdb;
				$map_id    = absint( $a['map_id'] );
				$variation = sanitize_text_field( $a['variation'] );
				$tv        = $tables['variations'];

				if ( empty( $variation ) ) {
					throw new Exception( 'Variation cannot be empty.' );
				}

				$result = $wpdb->insert( $tv, array( 'keyword_map_id' => $map_id, 'variation' => $variation, 'source' => 'manual' ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to add variation. It may already exist for this map.' );
				}

				return array( 'success' => true, 'variation_id' => $wpdb->insert_id, 'map_id' => $map_id, 'variation' => $variation );
			},
		);

		$reg['rankmath_remove_keyword_map_variation'] = array(
			'desc'     => 'Remove a keyword variation from a Rank Math Pro Link Genius map rule.',
			'risk'     => 'destructive',
			'schema'   => array(
				'variation_id' => array( 'type' => 'integer', 'description' => 'Variation ID to remove.' ),
			),
			'required' => array( 'variation_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$tables = WPXMCP_Tools_RankMath::get_link_genius_maps_tables();
				if ( null === $tables ) {
					throw new Exception( 'Link Genius Keyword Maps table not found.' );
				}
				global $wpdb;
				$variation_id = absint( $a['variation_id'] );
				$tv = $tables['variations'];
				$result = $wpdb->delete( $tv, array( 'id' => $variation_id ), array( '%d' ) );
				if ( false === $result || 0 === $result ) {
					throw new Exception( 'Variation not found or could not be deleted.' );
				}

				return array( 'success' => true, 'variation_id' => $variation_id );
			},
		);

		// ============================================================
		// Link Genius — Post Link Stats (1)
		// ============================================================

		$reg['rankmath_get_post_link_stats'] = array(
			'desc'    => 'Get per-post link health stats (broken count, internal/external ratio) from Rank Math Link Genius.',
			'risk'    => 'read',
			'schema'  => array(
				'post_id'   => array( 'type' => 'integer', 'description' => 'Filter to a single post.' ),
				'post_type' => array( 'type' => 'string', 'description' => 'Filter by post type slug.' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Default 20.' ),
				'page'      => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'orderby'   => array( 'type' => 'string', 'description' => 'total_links | broken_links | external_links | internal_links. Default total_links.' ),
				'order'     => array( 'type' => 'string', 'description' => 'ASC | DESC. Default DESC.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_internal_links';
				WPXMCP_Tools_RankMath::require_table( $table, 'Link Genius table not found. Ensure Rank Math Pro Link Genius module is enabled.' );

				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 100 ) : 20;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				$valid_orderby = array( 'total_links', 'broken_links', 'external_links', 'internal_links' );
				$orderby = ( isset( $a['orderby'] ) && in_array( $a['orderby'], $valid_orderby, true ) ) ? $a['orderby'] : 'total_links';
				$order   = ( isset( $a['order'] ) && 'ASC' === strtoupper( $a['order'] ) ) ? 'ASC' : 'DESC';

				$where  = array( '1=1' );
				$values = array();
				if ( isset( $a['post_id'] ) ) { $where[] = 'l.post_id = %d'; $values[] = absint( $a['post_id'] ); }
				if ( ! empty( $a['post_type'] ) ) { $where[] = 'p.post_type = %s'; $values[] = sanitize_key( $a['post_type'] ); }

				$where_sql = implode( ' AND ', $where );
				$values[] = $per_page;
				$values[] = $offset;

				$rows = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT l.post_id, p.post_title, p.post_type,
						        COUNT(*) AS total_links,
						        SUM(l.is_internal = 1) AS internal_links,
						        SUM(l.is_internal = 0) AS external_links,
						        SUM(l.status_category = 'broken') AS broken_links,
						        SUM(l.is_nofollow = 1) AS nofollow_links
						 FROM {$table} l
						 LEFT JOIN {$wpdb->posts} p ON l.post_id = p.ID
						 WHERE {$where_sql}
						 GROUP BY l.post_id
						 ORDER BY {$orderby} {$order}
						 LIMIT %d OFFSET %d",
						$values
					),
					ARRAY_A
				);

				$count_values = array_slice( $values, 0, -2 );
				$total = $wpdb->get_var( empty( $count_values ) ? "SELECT COUNT(DISTINCT l.post_id) FROM {$table} l LEFT JOIN {$wpdb->posts} p ON l.post_id = p.ID WHERE {$where_sql}" : $wpdb->prepare( "SELECT COUNT(DISTINCT l.post_id) FROM {$table} l LEFT JOIN {$wpdb->posts} p ON l.post_id = p.ID WHERE {$where_sql}", $count_values ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'pages' => (int) ceil( absint( $total ) / $per_page ), 'page' => $page );
			},
		);

		// ============================================================
		// Analytics — Extended Summaries (3)
		// ============================================================

		$reg['rankmath_get_analytics_overview'] = array(
			'desc'    => 'Get site-wide analytics summary: total clicks, impressions, average CTR and position from Rank Math Pro.',
			'risk'    => 'read',
			'schema'  => array(
				'start_date' => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default 30 days ago.' ),
				'end_date'   => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default today.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				$start = isset( $a['start_date'] ) ? sanitize_text_field( $a['start_date'] ) : gmdate( 'Y-m-d', strtotime( '-30 days' ) );
				$end   = isset( $a['end_date'] ) ? sanitize_text_field( $a['end_date'] ) : gmdate( 'Y-m-d' );

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_analytics_gsc';
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
					return array( 'success' => true, 'data' => array(), 'start_date' => $start, 'end_date' => $end, 'message' => 'Analytics GSC table not found. Ensure Rank Math Pro Analytics module is enabled and synced.' );
				}

				$summary = $wpdb->get_row(
					$wpdb->prepare(
						"SELECT SUM(clicks) AS total_clicks, SUM(impressions) AS total_impressions, AVG(ctr) AS avg_ctr, AVG(position) AS avg_position, COUNT(DISTINCT page) AS total_pages
						 FROM {$table} WHERE created BETWEEN %s AND %s",
						$start . ' 00:00:00', $end . ' 23:59:59'
					),
					ARRAY_A
				);

				return array( 'success' => true, 'data' => $summary ?: array(), 'start_date' => $start, 'end_date' => $end );
			},
		);

		$reg['rankmath_get_winning_posts'] = array(
			'desc'    => 'Get pages with the biggest search position improvement comparing current vs previous period (Rank Math Pro).',
			'risk'    => 'read',
			'schema'  => array(
				'days'  => array( 'type' => 'integer', 'description' => 'Lookback window in days (max 90). Default 30.' ),
				'limit' => array( 'type' => 'integer', 'description' => 'Max results (max 50). Default 10.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				return WPXMCP_Tools_RankMath::get_position_movers( $a, 'winning' );
			},
		);

		$reg['rankmath_get_losing_posts'] = array(
			'desc'    => 'Get pages with the biggest search position drop comparing current vs previous period (Rank Math Pro).',
			'risk'    => 'read',
			'schema'  => array(
				'days'  => array( 'type' => 'integer', 'description' => 'Lookback window in days (max 90). Default 30.' ),
				'limit' => array( 'type' => 'integer', 'description' => 'Max results (max 50). Default 10.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				return WPXMCP_Tools_RankMath::get_position_movers( $a, 'losing' );
			},
		);

		// ============================================================
		// Analytics — Email Reports (2)
		// ============================================================

		$reg['rankmath_get_email_report_settings'] = array(
			'desc'    => 'Get Rank Math Pro Analytics email report schedule and configuration.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();
				return array( 'success' => true, 'data' => get_option( 'rank_math_email_reports_settings', array() ) );
			},
		);

		$reg['rankmath_update_email_report_settings'] = array(
			'desc'    => 'Update Rank Math Pro Analytics email report schedule and recipients.',
			'risk'    => 'write',
			'schema'  => array(
				'send_to'          => array( 'type' => 'string', 'description' => 'Recipient email address.' ),
				'subject'          => array( 'type' => 'string', 'description' => 'Email subject line.' ),
				'frequency'        => array( 'type' => 'string', 'description' => 'daily | weekly | monthly.' ),
				'tracked_keywords' => array( 'type' => 'boolean', 'description' => 'Use only tracked keywords in the report.' ),
				'logo'             => array( 'type' => 'string', 'description' => 'Logo image URL.' ),
				'logo_link'        => array( 'type' => 'string', 'description' => 'Logo hyperlink URL.' ),
				'top_text'         => array( 'type' => 'string', 'description' => 'HTML content at top of report.' ),
				'footer_text'      => array( 'type' => 'string', 'description' => 'HTML footer content.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$settings = get_option( 'rank_math_email_reports_settings', array() );
				if ( isset( $a['send_to'] ) )    $settings['send_to'] = sanitize_email( $a['send_to'] );
				if ( isset( $a['subject'] ) )     $settings['subject'] = sanitize_text_field( $a['subject'] );
				if ( isset( $a['frequency'] ) && in_array( $a['frequency'], array( 'daily', 'weekly', 'monthly' ), true ) ) $settings['frequency'] = $a['frequency'];
				if ( isset( $a['tracked_keywords'] ) ) $settings['tracked_keywords'] = (bool) $a['tracked_keywords'];
				if ( isset( $a['logo'] ) )        $settings['logo'] = esc_url_raw( $a['logo'] );
				if ( isset( $a['logo_link'] ) )    $settings['logo_link'] = esc_url_raw( $a['logo_link'] );
				if ( isset( $a['top_text'] ) )     $settings['top_text'] = wp_kses_post( $a['top_text'] );
				if ( isset( $a['footer_text'] ) )  $settings['footer_text'] = wp_kses_post( $a['footer_text'] );

				update_option( 'rank_math_email_reports_settings', $settings );
				return array( 'success' => true, 'data' => $settings );
			},
		);

		// ============================================================
		// Schema Templates (2)
		// ============================================================

		$reg['rankmath_get_schema_templates'] = array(
			'desc'    => 'List saved reusable Rank Math Pro schema templates.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'search'   => array( 'type' => 'string', 'description' => 'Filter by template title.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_RankMath::require_pro();

				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 100 ) : 20;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;

				$qa = array(
					'post_type'      => 'rank_math_schema',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'title',
					'order'          => 'ASC',
				);
				if ( ! empty( $a['search'] ) ) $qa['s'] = sanitize_text_field( $a['search'] );

				$query = new WP_Query( $qa );
				$templates = array();
				foreach ( $query->posts as $post ) {
					$all_meta    = get_post_meta( $post->ID );
					$schema_type = '';
					foreach ( array_keys( $all_meta ) as $meta_key ) {
						if ( preg_match( '/^rank_math_schema_([A-Za-z]+)$/', $meta_key, $m ) ) {
							$schema_type = $m[1];
							break;
						}
					}
					$templates[] = array(
						'template_id' => $post->ID,
						'title'       => $post->post_title,
						'schema_type' => $schema_type,
						'created'     => $post->post_date,
						'modified'    => $post->post_modified,
					);
				}

				return array( 'success' => true, 'data' => $templates, 'total' => $query->found_posts, 'pages' => $query->max_num_pages, 'page' => $page, 'per_page' => $per_page );
			},
		);

		$reg['rankmath_delete_schema_template'] = array(
			'desc'     => 'Permanently delete a Rank Math Pro schema template.',
			'risk'     => 'destructive',
			'schema'   => array(
				'template_id' => array( 'type' => 'integer', 'description' => 'Schema template post ID.' ),
			),
			'required' => array( 'template_id' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$template_id = absint( $a['template_id'] );
				$post = get_post( $template_id );
				if ( ! $post || 'rank_math_schema' !== $post->post_type ) {
					throw new Exception( 'Schema template not found.' );
				}
				$result = wp_delete_post( $template_id, true );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete schema template.' );
				}
				return array( 'success' => true, 'template_id' => $template_id );
			},
		);

		// ============================================================
		// Video — Per-post Metadata (2)
		// ============================================================

		$reg['rankmath_get_post_video_metadata'] = array(
			'desc'     => 'Get the VideoObject schema metadata stored on a post by Rank Math Pro.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID to retrieve video metadata from.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = absint( $a['post_id'] );
				WPXMCP_Tools_RankMath::require_post( $post_id );
				WPXMCP_Tools_RankMath::require_pro();

				$video = get_post_meta( $post_id, 'rank_math_schema_VideoObject', true );
				return array( 'success' => true, 'post_id' => $post_id, 'data' => $video ?: array() );
			},
		);

		$reg['rankmath_set_post_video_metadata'] = array(
			'desc'     => 'Set or update VideoObject schema metadata on a post for the Rank Math Pro video sitemap.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'            => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'name'               => array( 'type' => 'string', 'description' => 'Video title.' ),
				'description'        => array( 'type' => 'string', 'description' => 'Video description.' ),
				'upload_date'        => array( 'type' => 'string', 'description' => 'YYYY-MM-DD.' ),
				'thumbnail_url'      => array( 'type' => 'string', 'description' => 'Thumbnail image URL.' ),
				'embed_url'          => array( 'type' => 'string', 'description' => 'Video embed/player URL.' ),
				'duration'           => array( 'type' => 'string', 'description' => 'ISO 8601 duration, e.g. PT5M30S.' ),
				'is_family_friendly' => array( 'type' => 'boolean', 'description' => 'Is the video family friendly?' ),
			),
			'required' => array( 'post_id', 'name' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'edit_posts' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$post_id = absint( $a['post_id'] );
				WPXMCP_Tools_RankMath::require_post( $post_id );

				$existing = get_post_meta( $post_id, 'rank_math_schema_VideoObject', true );
				if ( ! is_array( $existing ) ) $existing = array();

				$video = array_merge( $existing, array(
					'@type'            => 'VideoObject',
					'metadata'         => $existing['metadata'] ?? array( 'title' => sanitize_text_field( $a['name'] ), 'shortcode' => '' ),
					'name'             => sanitize_text_field( $a['name'] ),
					'description'      => isset( $a['description'] ) ? sanitize_textarea_field( $a['description'] ) : ( $existing['description'] ?? '' ),
					'uploadDate'       => isset( $a['upload_date'] ) ? sanitize_text_field( $a['upload_date'] ) : ( $existing['uploadDate'] ?? '' ),
					'thumbnailUrl'     => isset( $a['thumbnail_url'] ) ? esc_url_raw( $a['thumbnail_url'] ) : ( $existing['thumbnailUrl'] ?? '' ),
					'embedUrl'         => isset( $a['embed_url'] ) ? esc_url_raw( $a['embed_url'] ) : ( $existing['embedUrl'] ?? '' ),
					'duration'         => isset( $a['duration'] ) ? sanitize_text_field( $a['duration'] ) : ( $existing['duration'] ?? '' ),
					'isFamilyFriendly' => isset( $a['is_family_friendly'] ) ? ( $a['is_family_friendly'] ? 'True' : 'False' ) : ( $existing['isFamilyFriendly'] ?? 'True' ),
				) );

				update_post_meta( $post_id, 'rank_math_schema_VideoObject', $video );
				return array( 'success' => true, 'post_id' => $post_id, 'data' => $video );
			},
		);

		// ============================================================
		// Image SEO Settings (Pro) (2)
		// ============================================================

		$reg['rankmath_get_image_seo_settings'] = array(
			'desc'    => 'Get Rank Math Pro Image SEO auto alt/title generation settings.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$general = get_option( 'rank-math-options-general', array() );
				$keys = array(
					'add_img_alt', 'add_img_title', 'add_avatar_alt', 'add_img_caption', 'add_img_description',
					'img_alt_format', 'img_title_format', 'img_caption_format', 'img_description_format',
					'img_alt_change_case', 'img_title_change_case', 'img_caption_change_case', 'img_description_change_case',
					'image_replacements',
				);
				$settings = array();
				foreach ( $keys as $key ) {
					$settings[ $key ] = $general[ $key ] ?? null;
				}
				return array( 'success' => true, 'data' => $settings );
			},
		);

		$reg['rankmath_update_image_seo_settings'] = array(
			'desc'    => 'Update Rank Math Pro Image SEO auto alt/title generation settings.',
			'risk'    => 'write',
			'schema'  => array(
				'add_img_alt'                  => array( 'type' => 'boolean', 'description' => 'Auto-add alt text to images.' ),
				'add_img_title'                => array( 'type' => 'boolean', 'description' => 'Auto-add title attribute.' ),
				'add_avatar_alt'               => array( 'type' => 'boolean', 'description' => 'Add alt to avatar images.' ),
				'add_img_caption'              => array( 'type' => 'boolean', 'description' => 'Auto-add captions.' ),
				'add_img_description'          => array( 'type' => 'boolean', 'description' => 'Auto-add descriptions.' ),
				'img_alt_format'               => array( 'type' => 'string' ),
				'img_title_format'             => array( 'type' => 'string' ),
				'img_caption_format'           => array( 'type' => 'string' ),
				'img_description_format'       => array( 'type' => 'string' ),
				'img_alt_change_case'          => array( 'type' => 'string', 'description' => 'titlecase | sentencecase | lowercase | uppercase | (empty).' ),
				'img_title_change_case'        => array( 'type' => 'string', 'description' => 'titlecase | sentencecase | lowercase | uppercase | (empty).' ),
				'img_caption_change_case'      => array( 'type' => 'string', 'description' => 'titlecase | sentencecase | lowercase | uppercase | (empty).' ),
				'img_description_change_case'  => array( 'type' => 'string', 'description' => 'titlecase | sentencecase | lowercase | uppercase | (empty).' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				WPXMCP_Tools_RankMath::require_pro();

				$general     = get_option( 'rank-math-options-general', array() );
				$bool_keys   = array( 'add_img_alt', 'add_img_title', 'add_avatar_alt', 'add_img_caption', 'add_img_description' );
				$string_keys = array( 'img_alt_format', 'img_title_format', 'img_caption_format', 'img_description_format' );
				$case_keys   = array( 'img_alt_change_case', 'img_title_change_case', 'img_caption_change_case', 'img_description_change_case' );
				$valid_cases = array( 'titlecase', 'sentencecase', 'lowercase', 'uppercase', '' );

				foreach ( $bool_keys as $key ) {
					if ( isset( $a[ $key ] ) ) $general[ $key ] = (bool) $a[ $key ] ? 'on' : 'off';
				}
				foreach ( $string_keys as $key ) {
					if ( isset( $a[ $key ] ) ) $general[ $key ] = sanitize_text_field( $a[ $key ] );
				}
				foreach ( $case_keys as $key ) {
					if ( isset( $a[ $key ] ) && in_array( $a[ $key ], $valid_cases, true ) ) $general[ $key ] = $a[ $key ];
				}

				update_option( 'rank-math-options-general', $general );
				return array( 'success' => true, 'message' => 'Image SEO settings updated.' );
			},
		);

		// ============================================================
		// 404 Monitor — Summary (1)
		// ============================================================

		$reg['rankmath_get_404_summary'] = array(
			'desc'    => 'Get a 404 error log summary with aggregate stats and top offending URLs.',
			'risk'    => 'read',
			'schema'  => array(
				'start_date' => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default 30 days ago.' ),
				'end_date'   => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Default today.' ),
				'limit'      => array( 'type' => 'integer', 'description' => 'Default 10, max 50.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}

				$start = isset( $a['start_date'] ) ? sanitize_text_field( $a['start_date'] ) : gmdate( 'Y-m-d', strtotime( '-30 days' ) );
				$end   = isset( $a['end_date'] ) ? sanitize_text_field( $a['end_date'] ) : gmdate( 'Y-m-d' );
				$limit = isset( $a['limit'] ) ? min( absint( $a['limit'] ), 50 ) : 10;

				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_404_logs';
				WPXMCP_Tools_RankMath::require_table( $table, '404 log table not found. Ensure Rank Math 404 Monitor is enabled.' );

				$totals = $wpdb->get_row(
					$wpdb->prepare(
						"SELECT COUNT(DISTINCT uri) AS total_unique_urls, SUM(times_accessed) AS total_hits FROM {$table} WHERE DATE(accessed) BETWEEN %s AND %s",
						$start, $end
					),
					ARRAY_A
				);
				$top_urls = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT uri, SUM(times_accessed) AS times_accessed FROM {$table} WHERE DATE(accessed) BETWEEN %s AND %s GROUP BY uri ORDER BY times_accessed DESC LIMIT %d",
						$start, $end, $limit
					),
					ARRAY_A
				);

				return array(
					'success'           => true,
					'total_unique_urls' => absint( $totals['total_unique_urls'] ?? 0 ),
					'total_hits'        => absint( $totals['total_hits'] ?? 0 ),
					'top_urls'          => $top_urls ?: array(),
					'start_date'        => $start,
					'end_date'          => $end,
				);
			},
		);

		// ============================================================
		// Redirect Bulk Operations (2)
		// ============================================================

		$reg['rankmath_export_redirects'] = array(
			'desc'    => 'Export Rank Math redirects as a structured list with optional status/header_code filtering.',
			'risk'    => 'read',
			'schema'  => array(
				'status'      => array( 'type' => 'string', 'description' => 'active | inactive | all (default).' ),
				'header_code' => array( 'type' => 'integer', 'description' => 'Filter by HTTP redirect code (e.g. 301, 302).' ),
				'per_page'    => array( 'type' => 'integer', 'description' => 'Default 100, max 500.' ),
				'page'        => array( 'type' => 'integer', 'description' => 'Default 1.' ),
			),
			'handler' => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_redirections';
				WPXMCP_Tools_RankMath::require_table( $table, 'Redirections table not found. Ensure Rank Math Redirections module is enabled.' );

				$per_page = isset( $a['per_page'] ) ? min( absint( $a['per_page'] ), 500 ) : 100;
				$page     = isset( $a['page'] ) ? max( absint( $a['page'] ), 1 ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				$where  = array( '1=1' );
				$values = array();
				$status = $a['status'] ?? 'all';
				if ( 'active' === $status )   $where[] = "status = 'active'";
				elseif ( 'inactive' === $status ) $where[] = "status = 'inactive'";

				if ( isset( $a['header_code'] ) && absint( $a['header_code'] ) > 0 ) {
					$where[] = 'header_code = %d';
					$values[] = absint( $a['header_code'] );
				}

				$where_sql = implode( ' AND ', $where );
				$values2   = array_merge( $values, array( $per_page, $offset ) );
				$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT id, sources, url_to, header_code, status, hits, created, updated FROM {$table} WHERE {$where_sql} ORDER BY id DESC LIMIT %d OFFSET %d", $values2 ), ARRAY_A );
				$total = $wpdb->get_var( empty( $values ) ? "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}" : $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}", $values ) );

				return array( 'success' => true, 'data' => $rows ?: array(), 'total' => absint( $total ), 'pages' => (int) ceil( absint( $total ) / $per_page ), 'page' => $page );
			},
		);

		$reg['rankmath_bulk_delete_redirects'] = array(
			'desc'     => 'Delete multiple Rank Math redirects by their IDs (max 100 per call).',
			'risk'     => 'destructive',
			'schema'   => array(
				'ids' => array( 'type' => 'array', 'description' => 'Array of redirect IDs to delete (max 100).' ),
			),
			'required' => array( 'ids' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Permission denied.' );
				}
				global $wpdb;
				$table = $wpdb->prefix . 'rank_math_redirections';
				WPXMCP_Tools_RankMath::require_table( $table, 'Redirections table not found.' );

				$ids = array_filter( array_map( 'absint', (array) $a['ids'] ) );
				if ( empty( $ids ) ) {
					throw new Exception( 'No valid IDs provided.' );
				}
				if ( count( $ids ) > 100 ) {
					$ids = array_slice( $ids, 0, 100 );
				}

				$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );
				$result = $wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE id IN ({$placeholders})", $ids ) );
				if ( false === $result ) {
					throw new Exception( 'Failed to delete redirects.' );
				}

				return array( 'success' => true, 'deleted' => $result, 'ids_submitted' => count( $ids ) );
			},
		);

		return $reg;
	}
}
