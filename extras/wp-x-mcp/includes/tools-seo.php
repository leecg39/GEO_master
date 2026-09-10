<?php
/**
 * SEO / GEO / AEO tool group.
 *
 * - SEO: meta title/description, focus keyword, canonical, OG tags.
 * - AEO (Answer Engine Optimization): FAQ schema, Q&A blocks, speakable schema.
 * - GEO (Generative Engine Optimization): structured data, entity markup,
 *   llms.txt, clear factual summaries for AI crawlers.
 * - Technical: schema JSON-LD injection, internal link insertion,
 *   sitemap.xml and robots.txt repair.
 *
 * Auto-detects Yoast SEO vs Rank Math and writes the correct meta keys.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_SEO {

	/**
	 * Detect the active SEO plugin: 'yoast' | 'rankmath' | 'none'.
	 */
	public static function seo_plugin(): string {
		if ( defined( 'WPSEO_VERSION' ) || is_plugin_active_safe( 'wordpress-seo/wp-seo.php' ) || is_plugin_active_safe( 'wordpress-seo-premium/wp-seo-premium.php' ) ) {
			return 'yoast';
		}
		if ( defined( 'RANK_MATH_VERSION' ) || is_plugin_active_safe( 'seo-by-rank-math/rank-math.php' ) ) {
			return 'rankmath';
		}
		return 'none';
	}

	/**
	 * Meta-key map per SEO plugin.
	 */
	private static function keys(): array {
		$p = self::seo_plugin();
		if ( 'rankmath' === $p ) {
			return array(
				'title'     => 'rank_math_title',
				'desc'      => 'rank_math_description',
				'focus'     => 'rank_math_focus_keyword',
				'canonical' => 'rank_math_canonical_url',
				'robots'    => 'rank_math_robots',
			);
		}
		// Default to Yoast key names (also a sane fallback if none active).
		return array(
			'title'     => '_yoast_wpseo_title',
			'desc'      => '_yoast_wpseo_metadesc',
			'focus'     => '_yoast_wpseo_focuskw',
			'canonical' => '_yoast_wpseo_canonical',
			'robots'    => '_yoast_wpseo_meta-robots-noindex',
		);
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// SEO META
		// ============================================================
		$reg['seo_get_meta'] = array(
			'desc'     => 'Get current SEO meta (title, description, focus keyword, canonical) for a post/page/product. Auto-detects Yoast or Rank Math.',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$keys = WPXMCP_Tools_SEO_keys_public();
				return array(
					'seo_plugin'  => WPXMCP_Tools_SEO::seo_plugin(),
					'post_id'     => $id,
					'title'       => get_post_meta( $id, $keys['title'], true ),
					'description' => get_post_meta( $id, $keys['desc'], true ),
					'focus_kw'    => get_post_meta( $id, $keys['focus'], true ),
					'canonical'   => get_post_meta( $id, $keys['canonical'], true ),
					'current_title' => get_the_title( $id ),
					'permalink'   => get_permalink( $id ),
				);
			},
		);

		$reg['seo_set_meta'] = array(
			'desc'     => 'Set SEO meta title, description, focus keyword, and/or canonical for a post. Writes to whichever SEO plugin is active (Yoast/Rank Math). Title best ≤60 chars, description ≤155.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'     => array( 'type' => 'integer' ),
				'title'       => array( 'type' => 'string', 'description' => 'SEO meta title (≤60 chars recommended)' ),
				'description' => array( 'type' => 'string', 'description' => 'Meta description (≤155 chars recommended)' ),
				'focus_kw'    => array( 'type' => 'string' ),
				'canonical'   => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$keys = WPXMCP_Tools_SEO_keys_public();
				$set  = array();
				if ( isset( $a['title'] ) ) {
					update_post_meta( $id, $keys['title'], $a['title'] );
					$set['title'] = $a['title'];
				}
				if ( isset( $a['description'] ) ) {
					update_post_meta( $id, $keys['desc'], $a['description'] );
					$set['description'] = $a['description'];
				}
				if ( isset( $a['focus_kw'] ) ) {
					update_post_meta( $id, $keys['focus'], $a['focus_kw'] );
					$set['focus_kw'] = $a['focus_kw'];
				}
				if ( isset( $a['canonical'] ) ) {
					update_post_meta( $id, $keys['canonical'], $a['canonical'] );
					$set['canonical'] = $a['canonical'];
				}
				return array( 'post_id' => $id, 'seo_plugin' => WPXMCP_Tools_SEO::seo_plugin(), 'updated' => $set );
			},
		);

		$reg['seo_audit_post'] = array(
			'desc'     => 'Run an on-page SEO/AEO audit of a post and return issues + recommendations: missing meta, title/desc length, H1 count, image alt coverage, word count, internal/external links, schema presence.',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$keys    = WPXMCP_Tools_SEO_keys_public();
				$content = $post->post_content;
				$text    = wp_strip_all_tags( $content );
				$words   = str_word_count( $text );
				$title   = get_post_meta( $id, $keys['title'], true );
				$desc    = get_post_meta( $id, $keys['desc'], true );
				$focus   = get_post_meta( $id, $keys['focus'], true );

				$h1   = preg_match_all( '/<h1[ >]/i', $content );
				$h2   = preg_match_all( '/<h2[ >]/i', $content );
				$imgs = preg_match_all( '/<img[^>]*>/i', $content, $im );
				$imgs_no_alt = 0;
				if ( ! empty( $im[0] ) ) {
					foreach ( $im[0] as $tag ) {
						if ( ! preg_match( '/alt=["\'][^"\']+["\']/i', $tag ) ) {
							$imgs_no_alt++;
						}
					}
				}
				$home          = wp_parse_url( home_url(), PHP_URL_HOST );
				$links         = preg_match_all( '/<a [^>]*href=["\']([^"\']+)["\']/i', $content, $lm );
				$internal      = 0;
				$external      = 0;
				if ( ! empty( $lm[1] ) ) {
					foreach ( $lm[1] as $href ) {
						$host = wp_parse_url( $href, PHP_URL_HOST );
						if ( ! $host || $host === $home ) {
							$internal++;
						} else {
							$external++;
						}
					}
				}
				$has_schema = (bool) get_post_meta( $id, '_wpxmcp_schema', true );

				$issues = array();
				if ( ! $title ) {
					$issues[] = 'Missing SEO meta title.';
				} elseif ( mb_strlen( $title ) > 60 ) {
					$issues[] = 'Meta title too long (' . mb_strlen( $title ) . ' chars, aim ≤60).';
				}
				if ( ! $desc ) {
					$issues[] = 'Missing meta description.';
				} elseif ( mb_strlen( $desc ) > 160 ) {
					$issues[] = 'Meta description too long (' . mb_strlen( $desc ) . ' chars, aim ≤155).';
				}
				if ( ! $focus ) {
					$issues[] = 'No focus keyword set.';
				}
				if ( $h1 > 1 ) {
					$issues[] = "Multiple H1 tags ({$h1}); should be exactly 1.";
				}
				if ( $words < 300 ) {
					$issues[] = "Thin content ({$words} words); aim for 600+ for ranking.";
				}
				if ( $imgs_no_alt > 0 ) {
					$issues[] = "{$imgs_no_alt} image(s) missing alt text.";
				}
				if ( 0 === $internal ) {
					$issues[] = 'No internal links — add 2-4 for crawlability and AEO.';
				}
				if ( ! $has_schema ) {
					$issues[] = 'No custom schema attached (consider FAQ/Article schema for AEO).';
				}

				return array(
					'post_id'        => $id,
					'word_count'     => $words,
					'h1_count'       => $h1,
					'h2_count'       => $h2,
					'images'         => $imgs,
					'images_no_alt'  => $imgs_no_alt,
					'internal_links' => $internal,
					'external_links' => $external,
					'has_schema'     => $has_schema,
					'meta_title'     => $title ?: '(missing)',
					'meta_desc'      => $desc ?: '(missing)',
					'focus_keyword'  => $focus ?: '(none)',
					'issues'         => $issues,
					'score'          => max( 0, 100 - ( count( $issues ) * 12 ) ),
				);
			},
		);

		// ============================================================
		// SCHEMA / JSON-LD (GEO + AEO)
		// ============================================================
		$reg['seo_set_schema'] = array(
			'desc'     => 'Attach custom JSON-LD schema to a post (Article, Product, FAQPage, HowTo, LocalBusiness, BreadcrumbList, Organization). Injected into <head> on that page. Pass schema_json as a JSON object/string.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'     => array( 'type' => 'integer' ),
				'schema_json' => array( 'description' => 'A JSON-LD object (or array of objects). Will be wrapped in a script tag with type application/ld+json.' ),
			),
			'required' => array( 'post_id', 'schema_json' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$json = is_string( $a['schema_json'] ) ? $a['schema_json'] : wp_json_encode( $a['schema_json'] );
				// Validate it parses.
				$decoded = json_decode( $json, true );
				if ( null === $decoded ) {
					throw new Exception( 'schema_json is not valid JSON.' );
				}
				update_post_meta( $id, '_wpxmcp_schema', wp_slash( $json ) );
				return array( 'post_id' => $id, 'schema_attached' => true, 'type' => $decoded['@type'] ?? ( $decoded[0]['@type'] ?? 'unknown' ) );
			},
		);

		$reg['seo_build_faq_schema'] = array(
			'desc'     => 'Build and attach FAQPage schema (great for AEO / answer engines like Google AI Overviews and ChatGPT). Pass an array of {question, answer} pairs. Optionally also appends a visible FAQ section to the post content.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer' ),
				'faqs'         => array( 'type' => 'array', 'description' => 'Array of objects: [{"question":"...","answer":"..."}]' ),
				'append_visible' => array( 'type' => 'boolean', 'description' => 'Also append a visible FAQ block to the post content. Default false.' ),
			),
			'required' => array( 'post_id', 'faqs' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$faqs = $a['faqs'];
				if ( ! is_array( $faqs ) || empty( $faqs ) ) {
					throw new Exception( 'faqs must be a non-empty array of {question, answer}.' );
				}
				$entities = array();
				foreach ( $faqs as $f ) {
					$q = $f['question'] ?? '';
					$ans = $f['answer'] ?? '';
					if ( ! $q || ! $ans ) {
						continue;
					}
					$entities[] = array(
						'@type'          => 'Question',
						'name'           => $q,
						'acceptedAnswer' => array(
							'@type' => 'Answer',
							'text'  => $ans,
						),
					);
				}
				$schema = array(
					'@context'   => 'https://schema.org',
					'@type'      => 'FAQPage',
					'mainEntity' => $entities,
				);
				update_post_meta( $id, '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );

				if ( ! empty( $a['append_visible'] ) ) {
					$html = "\n<!-- wp:heading --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->\n";
					foreach ( $faqs as $f ) {
						$html .= '<!-- wp:heading {"level":3} --><h3>' . esc_html( $f['question'] ) . '</h3><!-- /wp:heading -->';
						$html .= '<!-- wp:paragraph --><p>' . wp_kses_post( $f['answer'] ) . '</p><!-- /wp:paragraph -->' . "\n";
					}
					$post = get_post( $id );
					wp_update_post( array( 'ID' => $id, 'post_content' => $post->post_content . $html ) );
				}

				return array( 'post_id' => $id, 'faq_count' => count( $entities ), 'visible_appended' => ! empty( $a['append_visible'] ) );
			},
		);

		// ============================================================
		// INTERNAL LINKS
		// ============================================================
		$reg['seo_suggest_internal_links'] = array(
			'desc'     => 'Find internal linking opportunities: given a post, return other published posts/products whose titles match keywords in this post — candidates to link to for SEO and crawl depth.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer' ),
				'limit'    => array( 'type' => 'integer', 'description' => 'Max suggestions. Default 10.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				// Pull significant words from the title.
				$words = array_filter(
					preg_split( '/\W+/', strtolower( $post->post_title ) ),
					function ( $w ) {
						return strlen( $w ) > 3;
					}
				);
				$found = array();
				foreach ( array_slice( $words, 0, 5 ) as $w ) {
					$q = new WP_Query(
						array(
							'post_type'      => array( 'post', 'product', 'page' ),
							'post_status'    => 'publish',
							's'              => $w,
							'posts_per_page' => 5,
							'post__not_in'   => array( $id ),
							'no_found_rows'  => true,
						)
					);
					foreach ( $q->posts as $p ) {
						$found[ $p->ID ] = array(
							'id'      => $p->ID,
							'title'   => $p->post_title,
							'type'    => $p->post_type,
							'url'     => get_permalink( $p->ID ),
							'anchor'  => $p->post_title,
						);
					}
				}
				return array_slice( array_values( $found ), 0, (int) ( $a['limit'] ?? 10 ) );
			},
		);

		$reg['seo_insert_internal_link'] = array(
			'desc'     => 'Insert an internal link into a post\'s content by wrapping the first occurrence of anchor_text with a link to target_url. Skips if anchor already linked.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'     => array( 'type' => 'integer' ),
				'anchor_text' => array( 'type' => 'string' ),
				'target_url'  => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'anchor_text', 'target_url' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$content = $post->post_content;
				$anchor  = $a['anchor_text'];
				// Don't double-link.
				if ( preg_match( '/<a [^>]*>' . preg_quote( $anchor, '/' ) . '<\/a>/i', $content ) ) {
					return array( 'post_id' => $id, 'inserted' => false, 'reason' => 'Anchor already linked.' );
				}
				$link    = '<a href="' . esc_url( $a['target_url'] ) . '">' . esc_html( $anchor ) . '</a>';
				$new     = preg_replace( '/' . preg_quote( $anchor, '/' ) . '/', $link, $content, 1, $count );
				if ( ! $count ) {
					return array( 'post_id' => $id, 'inserted' => false, 'reason' => 'Anchor text not found in content.' );
				}
				wp_update_post( array( 'ID' => $id, 'post_content' => $new ) );
				return array( 'post_id' => $id, 'inserted' => true, 'anchor' => $anchor, 'target' => $a['target_url'] );
			},
		);

		// ============================================================
		// SITEMAP + ROBOTS.TXT
		// ============================================================
		$reg['seo_fix_robots'] = array(
			'desc'     => 'Read or replace the virtual robots.txt. Without "content", returns current robots.txt. With "content", sets a custom robots.txt via the SEO plugin / WP filter (removes any conflicting physical file requirement). Pass sitemap_url to auto-append the correct Sitemap directive.',
			'risk'     => 'write',
			'schema'   => array(
				'content'     => array( 'type' => 'string', 'description' => 'Full robots.txt body. Omit to just read current.' ),
				'sitemap_url' => array( 'type' => 'string', 'description' => 'If set, appends "Sitemap: <url>" to the output.' ),
			),
			'handler'  => function ( $a ) {
				// Read mode.
				if ( empty( $a['content'] ) && empty( $a['sitemap_url'] ) ) {
					$current = apply_filters( 'robots_txt', "User-agent: *\nDisallow:\n", true );
					return array( 'robots_txt' => $current );
				}
				$body = $a['content'] ?? "User-agent: *\nAllow: /\n";
				if ( ! empty( $a['sitemap_url'] ) && false === stripos( $body, 'sitemap:' ) ) {
					$body .= "\nSitemap: " . esc_url_raw( $a['sitemap_url'] ) . "\n";
				}
				update_option( 'wpxmcp_robots_txt', $body );
				return array( 'robots_txt_set' => true, 'body' => $body, 'note' => 'Served via robots_txt filter. Delete any physical robots.txt file in web root for this to take effect.' );
			},
		);

		$reg['seo_sitemap_status'] = array(
			'desc'    => 'Report sitemap health: which sitemap provider is active (Yoast, Rank Math, or WP core), the index URL, and counts of indexable post types and taxonomies.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$plugin = WPXMCP_Tools_SEO::seo_plugin();
				if ( 'yoast' === $plugin ) {
					$index = home_url( '/sitemap_index.xml' );
				} elseif ( 'rankmath' === $plugin ) {
					$index = home_url( '/sitemap_index.xml' );
				} else {
					$index = home_url( '/wp-sitemap.xml' );
				}
				$counts = array();
				foreach ( get_post_types( array( 'public' => true ), 'names' ) as $pt ) {
					$counts[ $pt ] = (int) wp_count_posts( $pt )->publish;
				}
				return array(
					'provider'   => $plugin,
					'sitemap_url'=> $index,
					'post_types' => $counts,
					'recommendation' => 'Submit this index URL in Google Search Console. Disable attachment sitemaps to save crawl budget.',
				);
			},
		);

		$reg['seo_toggle_attachment_sitemap'] = array(
			'desc'     => 'Disable (or enable) attachment/media URLs in the sitemap and redirect attachment pages — the #1 crawl-budget fix for media-heavy stores. Works with Yoast and Rank Math.',
			'risk'     => 'write',
			'schema'   => array(
				'disable' => array( 'type' => 'boolean', 'description' => 'true = remove attachments from sitemap + redirect attachment URLs. Default true.' ),
			),
			'handler'  => function ( $a ) {
				$disable = isset( $a['disable'] ) ? (bool) $a['disable'] : true;
				$plugin  = WPXMCP_Tools_SEO::seo_plugin();
				$done    = array();

				if ( 'yoast' === $plugin ) {
					$opt = get_option( 'wpseo_titles', array() );
					$opt['disable-attachment'] = $disable; // redirect attachment URLs to parent
					$opt['noindex-attachment'] = $disable;
					update_option( 'wpseo_titles', $opt );
					$done[] = 'Yoast: disable-attachment + noindex-attachment = ' . ( $disable ? 'on' : 'off' );
				} elseif ( 'rankmath' === $plugin ) {
					$opt = get_option( 'rank-math-options-sitemap', array() );
					$opt['attachment_sitemap'] = $disable ? 'off' : 'on';
					update_option( 'rank-math-options-sitemap', $opt );
					$general = get_option( 'rank-math-options-general', array() );
					$general['attachment_redirect_urls'] = $disable ? 'on' : 'off';
					update_option( 'rank-math-options-general', $general );
					$done[] = 'Rank Math: attachment_sitemap off + redirect on';
				} else {
					throw new Exception( 'No supported SEO plugin active (need Yoast or Rank Math).' );
				}

				return array( 'attachments_disabled' => $disable, 'actions' => $done );
			},
		);

		// ============================================================
		// GEO / AEO — llms.txt + entity summary
		// ============================================================
		$reg['seo_generate_llms_txt'] = array(
			'desc'    => 'Generate and save an llms.txt file (the emerging standard for AI crawlers / generative engines). Lists site purpose, key pages, and product categories so LLMs cite you accurately. Served at /llms.txt.',
			'risk'    => 'write',
			'schema'  => array(
				'summary'  => array( 'type' => 'string', 'description' => 'One-paragraph factual description of the business for AI engines.' ),
				'key_urls' => array( 'type' => 'array', 'description' => 'Optional array of {title, url} important pages.' ),
			),
			'handler' => function ( $a ) {
				$name    = get_bloginfo( 'name' );
				$summary = $a['summary'] ?? get_bloginfo( 'description' );
				$body    = "# {$name}\n\n> {$summary}\n\n";
				$body   .= "## Key pages\n";
				if ( ! empty( $a['key_urls'] ) && is_array( $a['key_urls'] ) ) {
					foreach ( $a['key_urls'] as $k ) {
						$body .= '- [' . ( $k['title'] ?? $k['url'] ) . '](' . $k['url'] . ")\n";
					}
				} else {
					// Auto-fill from top product categories.
					$terms = get_terms( array( 'taxonomy' => 'product_cat', 'parent' => 0, 'hide_empty' => true, 'number' => 15 ) );
					if ( ! is_wp_error( $terms ) ) {
						foreach ( $terms as $t ) {
							$body .= '- [' . $t->name . '](' . get_term_link( $t ) . ")\n";
						}
					}
				}
				update_option( 'wpxmcp_llms_txt', $body );
				return array( 'llms_txt_set' => true, 'url' => home_url( '/llms.txt' ), 'preview' => $body );
			},
		);

		// ============================================================
		// BULK AUDIT — scan many posts/products, surface worst offenders
		// ============================================================
		$reg['seo_bulk_audit'] = array(
			'desc'     => 'Audit SEO health across many posts/products at once. Returns each item with a 0-100 score and its issues, plus a summary of the worst offenders and aggregate stats. Use this to find what to fix first. Paginate with page if you have thousands of items.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'post, page, product, or any type. Default product.' ),
				'status'    => array( 'type' => 'string', 'description' => 'publish, draft, any. Default publish.' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'How many to audit this call. Default 50, max 200.' ),
				'page'      => array( 'type' => 'integer', 'description' => 'Page of results. Default 1.' ),
				'max_score' => array( 'type' => 'integer', 'description' => 'Only return items scoring at or below this (e.g. 70 = problem items only). Default 100 (all).' ),
			),
			'handler'  => function ( $a ) {
				$keys      = WPXMCP_Tools_SEO_keys_public();
				$per_page  = min( (int) ( $a['per_page'] ?? 50 ), 200 );
				$max_score = (int) ( $a['max_score'] ?? 100 );
				$home      = wp_parse_url( home_url(), PHP_URL_HOST );

				$q = new WP_Query(
					array(
						'post_type'      => $a['post_type'] ?? 'product',
						'post_status'    => $a['status'] ?? 'publish',
						'posts_per_page' => $per_page,
						'paged'          => max( 1, (int) ( $a['page'] ?? 1 ) ),
						'orderby'        => 'ID',
						'order'          => 'ASC',
						'no_found_rows'  => false,
					)
				);

				$items   = array();
				$agg     = array(
					'no_meta_title' => 0,
					'no_meta_desc'  => 0,
					'no_focus_kw'   => 0,
					'thin_content'  => 0,
					'no_internal'   => 0,
					'imgs_no_alt'   => 0,
					'multiple_h1'   => 0,
				);
				$score_sum = 0;

				foreach ( $q->posts as $post ) {
					$id      = $post->ID;
					$content = $post->post_content;
					$text    = wp_strip_all_tags( $content );
					$words   = str_word_count( $text );
					$title   = get_post_meta( $id, $keys['title'], true );
					$desc    = get_post_meta( $id, $keys['desc'], true );
					$focus   = get_post_meta( $id, $keys['focus'], true );

					$h1 = preg_match_all( '/<h1[ >]/i', $content );
					preg_match_all( '/<img[^>]*>/i', $content, $im );
					$imgs_no_alt = 0;
					foreach ( ( $im[0] ?? array() ) as $tag ) {
						if ( ! preg_match( '/alt=["\'][^"\']+["\']/i', $tag ) ) {
							$imgs_no_alt++;
						}
					}
					preg_match_all( '/<a [^>]*href=["\']([^"\']+)["\']/i', $content, $lm );
					$internal = 0;
					foreach ( ( $lm[1] ?? array() ) as $href ) {
						$host = wp_parse_url( $href, PHP_URL_HOST );
						if ( ! $host || $host === $home ) {
							$internal++;
						}
					}

					$issues = array();
					if ( ! $title ) { $issues[] = 'no_meta_title'; $agg['no_meta_title']++; }
					if ( ! $desc ) { $issues[] = 'no_meta_desc'; $agg['no_meta_desc']++; }
					if ( ! $focus ) { $issues[] = 'no_focus_kw'; $agg['no_focus_kw']++; }
					if ( $words < 300 ) { $issues[] = 'thin_content'; $agg['thin_content']++; }
					if ( 0 === $internal ) { $issues[] = 'no_internal_links'; $agg['no_internal']++; }
					if ( $imgs_no_alt > 0 ) { $issues[] = 'images_missing_alt'; $agg['imgs_no_alt']++; }
					if ( $h1 > 1 ) { $issues[] = 'multiple_h1'; $agg['multiple_h1']++; }

					$score      = max( 0, 100 - ( count( $issues ) * 14 ) );
					$score_sum += $score;

					if ( $score <= $max_score ) {
						$items[] = array(
							'id'     => $id,
							'title'  => $post->post_title,
							'type'   => $post->post_type,
							'url'    => get_permalink( $id ),
							'score'  => $score,
							'words'  => $words,
							'issues' => $issues,
						);
					}
				}

				// Sort worst-first.
				usort( $items, function ( $x, $y ) {
					return $x['score'] <=> $y['score'];
				} );

				return array(
					'audited'        => count( $q->posts ),
					'total_matching' => (int) $q->found_posts,
					'total_pages'    => (int) $q->max_num_pages,
					'page'           => max( 1, (int) ( $a['page'] ?? 1 ) ),
					'avg_score'      => $q->posts ? round( $score_sum / count( $q->posts ) ) : 0,
					'issue_totals'   => $agg,
					'worst_first'    => $items,
				);
			},
		);

		// ============================================================
		// FIX ALL — batch auto-fix missing meta across many posts
		// ============================================================
		$reg['seo_fix_all'] = array(
			'desc'     => 'Batch auto-fix missing SEO meta across many posts/products. For each item missing a meta title or description, generates a sensible one from the post title, excerpt, content, and (for products) price/SKU — then saves it. Also sets focus keyword from the title when absent. Set dry_run=true to preview changes without writing. Process in pages for large catalogues.',
			'risk'     => 'write',
			'schema'   => array(
				'post_type'  => array( 'type' => 'string', 'description' => 'post, page, product, etc. Default product.' ),
				'status'     => array( 'type' => 'string', 'description' => 'Default publish.' ),
				'per_page'   => array( 'type' => 'integer', 'description' => 'Items per call. Default 50, max 200.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Default 1.' ),
				'fields'     => array( 'type' => 'array', 'description' => 'Which to fix: any of ["title","description","focus_kw"]. Default all three.' ),
				'overwrite'  => array( 'type' => 'boolean', 'description' => 'If true, overwrite existing values too. Default false (only fill blanks).' ),
				'title_suffix' => array( 'type' => 'string', 'description' => 'Appended to generated meta titles, e.g. " | Mubashir Hassan". Optional.' ),
				'dry_run'    => array( 'type' => 'boolean', 'description' => 'Preview only, no writes. Default false.' ),
			),
			'handler'  => function ( $a ) {
				$keys     = WPXMCP_Tools_SEO_keys_public();
				$per_page = min( (int) ( $a['per_page'] ?? 50 ), 200 );
				$fields   = ! empty( $a['fields'] ) && is_array( $a['fields'] ) ? $a['fields'] : array( 'title', 'description', 'focus_kw' );
				$over     = ! empty( $a['overwrite'] );
				$dry      = ! empty( $a['dry_run'] );
				$suffix   = $a['title_suffix'] ?? '';
				$is_wc    = class_exists( 'WooCommerce' );

				$q = new WP_Query(
					array(
						'post_type'      => $a['post_type'] ?? 'product',
						'post_status'    => $a['status'] ?? 'publish',
						'posts_per_page' => $per_page,
						'paged'          => max( 1, (int) ( $a['page'] ?? 1 ) ),
						'orderby'        => 'ID',
						'order'          => 'ASC',
					)
				);

				$changes = array();
				$counts  = array( 'title' => 0, 'description' => 0, 'focus_kw' => 0 );

				foreach ( $q->posts as $post ) {
					$id      = $post->ID;
					$change  = array( 'id' => $id, 'title' => $post->post_title, 'set' => array() );
					$pname   = $post->post_title;

					// Build a description source: excerpt → short desc → content.
					$desc_src = $post->post_excerpt;
					if ( ! $desc_src ) {
						$desc_src = wp_strip_all_tags( $post->post_content );
					}
					$desc_src = trim( preg_replace( '/\s+/', ' ', $desc_src ) );

					// Product extras.
					$price_bit = '';
					if ( $is_wc && 'product' === $post->post_type ) {
						$product = wc_get_product( $id );
						if ( $product ) {
							$price = $product->get_price();
							if ( $price ) {
								$price_bit = ' — ' . get_woocommerce_currency() . ' ' . $price;
							}
							if ( ! $desc_src ) {
								$desc_src = wp_strip_all_tags( $product->get_short_description() ?: $product->get_description() );
							}
						}
					}

					// ----- META TITLE -----
					if ( in_array( 'title', $fields, true ) ) {
						$existing = get_post_meta( $id, $keys['title'], true );
						if ( $over || ! $existing ) {
							$gen = $pname . $price_bit . $suffix;
							$gen = mb_substr( $gen, 0, 60 );
							if ( ! $dry ) {
								update_post_meta( $id, $keys['title'], $gen );
							}
							$change['set']['title'] = $gen;
							$counts['title']++;
						}
					}

					// ----- META DESCRIPTION -----
					if ( in_array( 'description', $fields, true ) ) {
						$existing = get_post_meta( $id, $keys['desc'], true );
						if ( $over || ! $existing ) {
							$gen = $desc_src ? $desc_src : ( 'Buy ' . $pname . ' at ' . get_bloginfo( 'name' ) . '.' );
							// Trim to ~155 chars on a word boundary.
							if ( mb_strlen( $gen ) > 155 ) {
								$gen = mb_substr( $gen, 0, 152 );
								$gen = preg_replace( '/\s+\S*$/', '', $gen ) . '…';
							}
							if ( ! $dry ) {
								update_post_meta( $id, $keys['desc'], $gen );
							}
							$change['set']['description'] = $gen;
							$counts['description']++;
						}
					}

					// ----- FOCUS KEYWORD -----
					if ( in_array( 'focus_kw', $fields, true ) ) {
						$existing = get_post_meta( $id, $keys['focus'], true );
						if ( $over || ! $existing ) {
							// First 4 significant words of the title.
							$words = array_filter(
								preg_split( '/\W+/', $pname ),
								function ( $w ) {
									return mb_strlen( $w ) > 2;
								}
							);
							$gen = implode( ' ', array_slice( array_values( $words ), 0, 4 ) );
							if ( $gen ) {
								if ( ! $dry ) {
									update_post_meta( $id, $keys['focus'], $gen );
								}
								$change['set']['focus_kw'] = $gen;
								$counts['focus_kw']++;
							}
						}
					}

					if ( ! empty( $change['set'] ) ) {
						$changes[] = $change;
					}
				}

				return array(
					'dry_run'        => $dry,
					'seo_plugin'     => WPXMCP_Tools_SEO::seo_plugin(),
					'processed'      => count( $q->posts ),
					'total_matching' => (int) $q->found_posts,
					'total_pages'    => (int) $q->max_num_pages,
					'page'           => max( 1, (int) ( $a['page'] ?? 1 ) ),
					'fixed_counts'   => $counts,
					'changes'        => $changes,
					'note'           => $dry ? 'Preview only — nothing was written. Re-run with dry_run=false to apply.' : 'Changes saved.',
				);
			},
		);

		return $reg;
	}
}

/**
 * Public helper so closures (which run in a different scope) can read the
 * SEO key map without exposing a private method.
 */
function WPXMCP_Tools_SEO_keys_public(): array {
	$p = WPXMCP_Tools_SEO::seo_plugin();
	if ( 'rankmath' === $p ) {
		return array(
			'title'     => 'rank_math_title',
			'desc'      => 'rank_math_description',
			'focus'     => 'rank_math_focus_keyword',
			'canonical' => 'rank_math_canonical_url',
			'robots'    => 'rank_math_robots',
		);
	}
	return array(
		'title'     => '_yoast_wpseo_title',
		'desc'      => '_yoast_wpseo_metadesc',
		'focus'     => '_yoast_wpseo_focuskw',
		'canonical' => '_yoast_wpseo_canonical',
		'robots'    => '_yoast_wpseo_meta-robots-noindex',
	);
}

/**
 * Safe is_plugin_active that loads the dependency first.
 */
function is_plugin_active_safe( string $path ): bool {
	if ( ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	return is_plugin_active( $path );
}
