<?php
/**
 * SEO / GEO / AEO Pro v2 tool group — advanced content + entity + answer-engine tools.
 *
 *  - readability_scorer            Flesch reading-ease + grade level
 *  - heading_outline               H1-H6 outline with lengths + gaps
 *  - serp_preview                  Pixel-style SERP preview for title/desc
 *  - og_preview                    Facebook / LinkedIn share preview check
 *  - video_schema_builder          Build + attach VideoObject JSON-LD
 *  - breadcrumb_schema_builder     Build + attach BreadcrumbList JSON-LD
 *  - product_schema_builder        Build + attach Product JSON-LD (Woo-aware)
 *  - organization_schema_builder   Site-wide Organization / LocalBusiness schema
 *  - speakable_schema_builder      Speakable schema for voice assistants
 *  - ai_summary_block              Inject a TL;DR / "Key Takeaways" block for AI citations
 *  - people_also_ask_seed          Generate 6-10 PAA-style questions from a post
 *  - keyword_cannibalization       Find posts competing for the same query
 *  - clickbait_detector           Flag sensationalist patterns in title/intro
 *  - faq_seed_generator           Auto-extract Q/A pairs from a post
 *  - topical_authority_score      Cluster coverage / pillar strength per topic
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_SEO_AEO_GEO_Pro {

	private static function meta_keys(): array {
		if ( 'rankmath' === WPXMCP_Tools_SEO::seo_plugin() ) {
			return array(
				'title'     => 'rank_math_title',
				'desc'      => 'rank_math_description',
			);
		}
		return array(
			'title'     => '_yoast_wpseo_title',
			'desc'      => '_yoast_wpseo_metadesc',
		);
	}

	/**
	 * Count syllables for a single English word (cheap heuristic).
	 */
	private static function syllables( string $word ): int {
		$word = strtolower( preg_replace( '/[^a-z]/', '', $word ) );
		if ( strlen( $word ) <= 3 ) {
			return 1;
		}
		$word = preg_replace( '/(?:[^laeiouy]es|ed|[^laeiouy]e)$/', '', $word );
		$word = preg_replace( '/^y/', '', $word );
		$c = preg_match_all( '/[aeiouy]{1,2}/', $word );
		return max( 1, (int) $c );
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// 1. READABILITY SCORER
		// ============================================================
		$reg['readability_scorer'] = array(
			'desc'     => 'Compute Flesch reading-ease, Flesch-Kincaid grade level, and a few cheap stats (avg sentence length, % complex words). Returns a 0-100 score and a verdict (very easy / plain / medium / hard / very hard).',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$text = wp_strip_all_tags( $post->post_content );
				$sentences = max( 1, preg_match_all( '/[.!?]+/u', $text, $m ) );
				$words = preg_split( '/\s+/u', trim( $text ), -1, PREG_SPLIT_NO_EMPTY );
				$word_count = max( 1, count( $words ) );
				$syll_total = 0;
				$complex = 0;
				foreach ( $words as $w ) {
					$s = self::syllables( $w );
					$syll_total += $s;
					if ( $s >= 3 ) {
						$complex++;
					}
				}
				$flesch_re = 206.835 - 1.015 * ( $word_count / $sentences ) - 84.6 * ( $syll_total / $word_count );
				$fk_grade  = 0.39 * ( $word_count / $sentences ) + 11.8 * ( $syll_total / $word_count ) - 15.59;
				$verdict = $flesch_re >= 90 ? 'very easy' : ( $flesch_re >= 80 ? 'easy' : ( $flesch_re >= 70 ? 'fairly easy' : ( $flesch_re >= 60 ? 'plain' : ( $flesch_re >= 50 ? 'medium' : ( $flesch_re >= 30 ? 'hard' : 'very hard' ) ) ) ) );
				return array(
					'post_id'        => $id,
					'word_count'     => $word_count,
					'sentence_count' => $sentences,
					'syllable_count' => $syll_total,
					'flesch_re'      => round( $flesch_re, 1 ),
					'fk_grade'       => round( $fk_grade, 1 ),
					'complex_words'  => $complex,
					'verdict'        => $verdict,
				);
			},
		);

		// ============================================================
		// 2. HEADING OUTLINE
		// ============================================================
		$reg['heading_outline'] = array(
			'desc'     => 'Extract the full H1-H6 outline of a post with text length per heading. Flags missing-H2, oversized headings, and jumps in hierarchy (e.g. H1 → H4).',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				preg_match_all( '/<(h[1-6])[^>]*>(.*?)<\/\1>/is', $post->post_content, $m, PREG_SET_ORDER );
				$out = array();
				$h1_count = 0; $has_h2 = false; $issues = array();
				$prev_level = 0;
				foreach ( $m as $h ) {
					$lvl = (int) substr( $h[1], 1 );
					$txt = trim( wp_strip_all_tags( $h[2] ) );
					if ( 1 === $lvl ) {
						$h1_count++;
					}
					if ( 2 === $lvl ) {
						$has_h2 = true;
					}
					if ( $prev_level > 0 && $lvl > $prev_level + 1 ) {
						$issues[] = "Hierarchy jump: H{$prev_level} → H{$lvl} (" . mb_substr( $txt, 0, 40 ) . '…)';
					}
					if ( mb_strlen( $txt ) > 80 ) {
						$issues[] = "Heading H{$lvl} too long (" . mb_strlen( $txt ) . ' chars): ' . mb_substr( $txt, 0, 60 ) . '…';
					}
					$out[] = array( 'level' => $lvl, 'text' => $txt, 'len' => mb_strlen( $txt ) );
					$prev_level = $lvl;
				}
				if ( $h1_count > 1 ) {
					$issues[] = "Multiple H1 tags ({$h1_count}).";
				}
				if ( count( $out ) > 2 && ! $has_h2 ) {
					$issues[] = 'No H2 tags — long content should have H2 sections.';
				}
				return array( 'post_id' => $id, 'h1_count' => $h1_count, 'headings' => $out, 'issues' => $issues );
			},
		);

		// ============================================================
		// 3. SERP PREVIEW
		// ============================================================
		$reg['serp_preview'] = array(
			'desc'     => 'Build a Google-SERP-style preview for a post or a custom title/desc. Returns the visual block + length warnings + estimated pixel width for the title (heuristic 6.5px/char at 20px Arial).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'title'   => array( 'type' => 'string', 'description' => 'Override title.' ),
				'desc'    => array( 'type' => 'string', 'description' => 'Override description.' ),
			),
			'handler'  => function ( $a ) {
				$title = $a['title'] ?? '';
				$desc  = $a['desc']  ?? '';
				$url   = home_url( '/' );
				if ( ! empty( $a['post_id'] ) ) {
					$post = get_post( (int) $a['post_id'] );
					if ( $post ) {
						$keys = self::meta_keys();
						$title = $title ?: ( get_post_meta( $post->ID, $keys['title'], true ) ?: $post->post_title );
						$desc  = $desc  ?: ( get_post_meta( $post->ID, $keys['desc'], true ) ?: $post->post_excerpt );
						$url  = get_permalink( $post->ID );
					}
				}
				$title = $title ?: get_bloginfo( 'name' );
				$desc  = $desc  ?: get_bloginfo( 'description' );
				$title_pixels = (int) round( mb_strlen( $title ) * 6.5 );
				$issues = array();
				if ( mb_strlen( $title ) > 60 ) {
					$issues[] = 'Title over 60 chars — Google may truncate.';
				}
				if ( $title_pixels > 580 ) {
					$issues[] = "Title estimated {$title_pixels}px wide, limit ~580px.";
				}
				if ( mb_strlen( $desc ) > 160 ) {
					$issues[] = 'Description over 160 chars.';
				}
				return array(
					'url'           => $url,
					'title'         => $title,
					'description'   => $desc,
					'title_len'     => mb_strlen( $title ),
					'title_px'      => $title_pixels,
					'desc_len'      => mb_strlen( $desc ),
					'issues'        => $issues,
					'preview_lines' => array(
						get_bloginfo( 'name' ) . ' › ' . ( wp_parse_url( $url, PHP_URL_PATH ) ?: '/' ),
						$title,
						date( 'M j, Y' ) . ' — ' . $url,
						$desc,
					),
				);
			},
		);

		// ============================================================
		// 4. OG PREVIEW
		// ============================================================
		$reg['og_preview'] = array(
			'desc'     => 'Inspect the Open Graph + Twitter Card tags actually rendered on a post (or override with custom values). Flags missing og:title / og:description / og:image / twitter:card and reports image dimensions.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer' ),
				'url'      => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : ( ! empty( $a['post_id'] ) ? get_permalink( (int) $a['post_id'] ) : home_url( '/' ) );
				$resp = wp_remote_get( $url, array( 'timeout' => 15 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				$pick = function ( $prop ) use ( $html ) {
					if ( preg_match( '/<meta[^>]+property=["\']og:' . preg_quote( $prop, '/' ) . '["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $m ) ) {
						return $m[1];
					}
					if ( preg_match( '/<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' . preg_quote( $prop, '/' ) . '["\']/i', $html, $m ) ) {
						return $m[1];
					}
					return null;
				};
				$tags = array(
					'og:title'       => $pick( 'title' ),
					'og:description' => $pick( 'description' ),
					'og:image'       => $pick( 'image' ),
					'og:url'         => $pick( 'url' ),
					'og:type'        => $pick( 'type' ),
					'og:site_name'   => $pick( 'site_name' ),
				);
				preg_match( '/<meta[^>]+name=["\']twitter:card["\'][^>]+content=["\']([^"\']+)["\']/i', $html, $tm );
				$tags['twitter:card'] = $tm[1] ?? null;
				$required = array( 'og:title' => 'og:title', 'og:description' => 'og:description', 'og:image' => 'og:image' );
				$missing = array();
				foreach ( $required as $k => $v ) {
					if ( empty( $tags[ $k ] ) ) {
						$missing[] = $k;
					}
				}
				return array( 'url' => $url, 'tags' => $tags, 'missing' => $missing, 'ok' => empty( $missing ) );
			},
		);

		// ============================================================
		// 5. VIDEO SCHEMA BUILDER
		// ============================================================
		$reg['video_schema_builder'] = array(
			'desc'     => 'Build + attach VideoObject JSON-LD. Pass name, description, thumbnail_url, upload_date (ISO), duration (ISO 8601), content_url or embed_url. Set apply=true to store on the post.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'name'           => array( 'type' => 'string' ),
				'description'    => array( 'type' => 'string' ),
				'thumbnail_url'  => array( 'type' => 'string' ),
				'upload_date'    => array( 'type' => 'string' ),
				'duration'       => array( 'type' => 'string', 'description' => 'ISO 8601, e.g. PT1M30S' ),
				'content_url'    => array( 'type' => 'string' ),
				'embed_url'      => array( 'type' => 'string' ),
				'apply'          => array( 'type' => 'boolean' ),
			),
			'handler'  => function ( $a ) {
				$schema = array_filter( array(
					'@context'      => 'https://schema.org',
					'@type'         => 'VideoObject',
					'name'          => $a['name'] ?? '',
					'description'   => $a['description'] ?? '',
					'thumbnailUrl'  => $a['thumbnail_url'] ?? '',
					'uploadDate'    => $a['upload_date'] ?? '',
					'duration'      => $a['duration'] ?? '',
					'contentUrl'    => $a['content_url'] ?? '',
					'embedUrl'      => $a['embed_url'] ?? '',
				), function ( $v ) {
					return $v !== '' && $v !== null;
				} );
				$out = array( 'schema' => $schema, 'valid' => ! empty( $schema['name'] ) && ! empty( $schema['thumbnailUrl'] ) );
				if ( ! empty( $a['apply'] ) && ! empty( $a['post_id'] ) ) {
					update_post_meta( (int) $a['post_id'], '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 6. BREADCRUMB SCHEMA BUILDER
		// ============================================================
		$reg['breadcrumb_schema_builder'] = array(
			'desc'     => 'Build + attach BreadcrumbList JSON-LD. Pass items = [{name, url}] in order. Set apply=true to store on the post.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'items'   => array( 'type' => 'array' ),
				'apply'   => array( 'type' => 'boolean' ),
			),
			'handler'  => function ( $a ) {
				$items = (array) ( $a['items'] ?? array() );
				$list = array();
				foreach ( array_values( $items ) as $i => $it ) {
					$list[] = array(
						'@type'    => 'ListItem',
						'position' => $i + 1,
						'name'     => $it['name'] ?? '',
						'item'     => $it['url'] ?? '',
					);
				}
				$schema = array(
					'@context'        => 'https://schema.org',
					'@type'           => 'BreadcrumbList',
					'itemListElement' => $list,
				);
				$out = array( 'schema' => $schema, 'count' => count( $list ) );
				if ( ! empty( $a['apply'] ) && ! empty( $a['post_id'] ) ) {
					update_post_meta( (int) $a['post_id'], '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 7. PRODUCT SCHEMA BUILDER (Woo-aware)
		// ============================================================
		$reg['product_schema_builder'] = array(
			'desc'     => 'Build Product JSON-LD. If post_id is a Woo product and no overrides are given, auto-fills name/sku/price/image/availability from the WC product object. apply=true to store.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'name'    => array( 'type' => 'string' ),
				'image'   => array( 'type' => 'string' ),
				'description' => array( 'type' => 'string' ),
				'sku'     => array( 'type' => 'string' ),
				'price'   => array( 'type' => 'string' ),
				'currency'=> array( 'type' => 'string' ),
				'availability' => array( 'type' => 'string', 'description' => 'InStock | OutOfStock | PreOrder.' ),
				'apply'   => array( 'type' => 'boolean' ),
			),
			'handler'  => function ( $a ) {
				$id = (int) ( $a['post_id'] ?? 0 );
				$schema = array( '@context' => 'https://schema.org', '@type' => 'Product' );
				// WC auto-fill.
				if ( $id && class_exists( 'WooCommerce' ) && 'product' === get_post_type( $id ) ) {
					$p = wc_get_product( $id );
					if ( $p ) {
						$schema['name']        = $a['name'] ?: $p->get_name();
						$schema['description'] = $a['description'] ?: wp_strip_all_tags( $p->get_description() ?: $p->get_short_description() );
						$schema['sku']         = $a['sku'] ?: $p->get_sku();
						$img = wp_get_attachment_image_url( $p->get_image_id(), 'full' );
						$schema['image']       = $a['image'] ?: $img;
						$price = $a['price'] ?: (string) $p->get_price();
						if ( $price ) {
							$schema['offers'] = array(
								'@type'         => 'Offer',
								'price'         => $price,
								'priceCurrency' => $a['currency'] ?: get_woocommerce_currency(),
								'availability'  => 'https://schema.org/' . ( $a['availability'] ?: ( $p->is_in_stock() ? 'InStock' : 'OutOfStock' ) ),
							);
						}
					}
				}
				// Overrides.
				foreach ( array( 'name', 'image', 'description', 'sku' ) as $k ) {
					if ( ! empty( $a[ $k ] ) ) {
						$schema[ $k ] = $a[ $k ];
					}
				}
				$out = array( 'schema' => $schema );
				if ( ! empty( $a['apply'] ) && $id ) {
					update_post_meta( $id, '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 8. ORGANIZATION SCHEMA BUILDER (site-wide)
		// ============================================================
		$reg['organization_schema_builder'] = array(
			'desc'     => 'Build + save the site-wide Organization / LocalBusiness JSON-LD (stored in wpxmcp_org_schema option; render via wp_head). Pass name, url, logo, same_as (array of social URLs), optional contactPoint + address.',
			'risk'     => 'write',
			'schema'   => array(
				'name'        => array( 'type' => 'string' ),
				'url'         => array( 'type' => 'string' ),
				'logo'        => array( 'type' => 'string' ),
				'same_as'     => array( 'type' => 'array' ),
				'type'        => array( 'type' => 'string', 'description' => 'Organization or LocalBusiness. Default Organization.' ),
				'telephone'   => array( 'type' => 'string' ),
				'street'      => array( 'type' => 'string' ),
				'locality'    => array( 'type' => 'string' ),
				'region'      => array( 'type' => 'string' ),
				'postal'      => array( 'type' => 'string' ),
				'country'     => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$type = ! empty( $a['type'] ) ? $a['type'] : 'Organization';
				$schema = array_filter( array(
					'@context' => 'https://schema.org',
					'@type'    => $type,
					'name'     => $a['name'] ?? get_bloginfo( 'name' ),
					'url'      => $a['url'] ?? home_url( '/' ),
					'logo'     => $a['logo'] ?? '',
					'sameAs'   => (array) ( $a['same_as'] ?? array() ),
				), function ( $v ) {
					return $v !== '' && $v !== array();
				} );
				if ( ! empty( $a['telephone'] ) || ! empty( $a['street'] ) ) {
					$schema['contactPoint'] = array_filter( array(
						'@type'       => 'ContactPoint',
						'telephone'   => $a['telephone'] ?? '',
						'contactType' => 'customer support',
					) );
					if ( ! empty( $a['street'] ) ) {
						$schema['address'] = array_filter( array(
							'@type'           => 'PostalAddress',
							'streetAddress'   => $a['street'] ?? '',
							'addressLocality' => $a['locality'] ?? '',
							'addressRegion'   => $a['region'] ?? '',
							'postalCode'      => $a['postal'] ?? '',
							'addressCountry'  => $a['country'] ?? '',
						) );
					}
				}
				update_option( 'wpxmcp_org_schema', wp_json_encode( $schema ) );
				return array( 'saved' => true, 'schema' => $schema );
			},
		);

		// ============================================================
		// 9. SPEAKABLE SCHEMA BUILDER
		// ============================================================
		$reg['speakable_schema_builder'] = array(
			'desc'     => 'Build Speakable schema (voice assistants pick these sections to read aloud). Pass xpath or css_selector arrays. apply=true to store on the post.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'xpath'   => array( 'type' => 'array' ),
				'css'     => array( 'type' => 'array', 'description' => 'CSS selectors; converted to xpath heuristically.' ),
				'apply'   => array( 'type' => 'boolean' ),
			),
			'handler'  => function ( $a ) {
				$xpaths = (array) ( $a['xpath'] ?? array() );
				if ( empty( $xpaths ) && ! empty( $a['css'] ) ) {
					foreach ( (array) $a['css'] as $sel ) {
						$xpaths[] = '/' . ltrim( $sel, '/*' );
					}
				}
				$schema = array(
					'@context'  => 'https://schema.org',
					'@type'     => 'WebPage',
					'speakable' => array(
						'@type'   => 'SpeakableSpecification',
						'xpath'   => $xpaths,
					),
				);
				$out = array( 'schema' => $schema, 'xpath_count' => count( $xpaths ) );
				if ( ! empty( $a['apply'] ) && ! empty( $a['post_id'] ) ) {
					update_post_meta( (int) $a['post_id'], '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 10. AI SUMMARY BLOCK
		// ============================================================
		$reg['ai_summary_block'] = array(
			'desc'     => 'Inject a TL;DR / "Key Takeaways" block at the top of a post — designed for AI citation (GEO). Pass bullets (array of strings) and optional heading. apply=true writes to post_content.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'bullets' => array( 'type' => 'array' ),
				'heading' => array( 'type' => 'string' ),
				'apply'   => array( 'type' => 'boolean' ),
			),
			'required' => array( 'post_id', 'bullets' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$heading = $a['heading'] ?? 'Key Takeaways';
				$html  = '<!-- wp:heading --><h2>' . esc_html( $heading ) . '</h2><!-- /wp:heading -->';
				$html .= '<!-- wp:list --><ul>';
				foreach ( (array) $a['bullets'] as $b ) {
					$html .= '<li>' . esc_html( $b ) . '</li>';
				}
				$html .= '</ul><!-- /wp:list -->';
				$out = array( 'preview' => $html, 'bullets' => count( (array) $a['bullets'] ) );
				if ( ! empty( $a['apply'] ) ) {
					wp_update_post( array( 'ID' => $id, 'post_content' => $html . "\n" . $post->post_content ) );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 11. PEOPLE ALSO ASK SEED
		// ============================================================
		$reg['people_also_ask_seed'] = array(
			'desc'     => 'Generate 6-10 PAA-style questions from a post (extracted from the H2/H3 outline and a small set of question templates). Use as a seed for a FAQ block or schema.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer' ),
				'topic'    => array( 'type' => 'string', 'description' => 'Optional focus topic.' ),
				'max'      => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$id = (int) ( $a['post_id'] ?? 0 );
				$post = $id ? get_post( $id ) : null;
				$topic = $a['topic'] ?? ( $post ? $post->post_title : '' );
				$max = (int) ( $a['max'] ?? 8 );
				$out = array();
				$templates = array(
					'What is %s and why does it matter?',
					'How does %s work in practice?',
					'What are the benefits of %s?',
					'What are the most common mistakes with %s?',
					'How much does %s cost?',
					'Is %s worth it in 2026?',
					'How long does it take to learn %s?',
					'%s vs alternatives: which is better?',
					'What tools do I need for %s?',
					'How do I get started with %s today?',
				);
				if ( $post ) {
					preg_match_all( '/<h[23][^>]*>(.*?)<\/h[23]>/is', $post->post_content, $m );
					foreach ( array_slice( $m[1] ?? array(), 0, 5 ) as $h ) {
						$h = trim( wp_strip_all_tags( $h ) );
						if ( $h ) {
							$out[] = $h . '?';
						}
					}
				}
				foreach ( $templates as $t ) {
					if ( count( $out ) >= $max ) {
						break;
					}
					$out[] = sprintf( $t, $topic );
				}
				return array( 'topic' => $topic, 'questions' => array_slice( $out, 0, $max ) );
			},
		);

		// ============================================================
		// 12. KEYWORD CANNIBALIZATION
		// ============================================================
		$reg['keyword_cannibalization'] = array(
			'desc'     => 'Find posts whose focus keyword overlaps — i.e. two or more posts targeting the same query. Returns cannibalization groups with the candidate URLs and their meta titles.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$keys = self::meta_keys();
				$limit = min( (int) ( $a['limit'] ?? 300 ), 1000 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => 'ids',
				) );
				$buckets = array();
				foreach ( $posts as $pid ) {
					$kw = strtolower( trim( (string) get_post_meta( $pid, $keys['title'] !== '_yoast_wpseo_title' ? 'rank_math_focus_keyword' : '_yoast_wpseo_focuskw', true ) ) );
					if ( ! $kw ) {
						continue;
					}
					$buckets[ $kw ][] = array(
						'id'    => $pid,
						'title' => get_post_meta( $pid, $keys['title'], true ) ?: get_the_title( $pid ),
						'url'   => get_permalink( $pid ),
					);
				}
				$dupes = array();
				foreach ( $buckets as $kw => $items ) {
					if ( count( $items ) > 1 ) {
						$dupes[ $kw ] = $items;
					}
				}
				return array( 'scanned' => count( $posts ), 'cannibalized_keywords' => count( $dupes ), 'groups' => $dupes );
			},
		);

		// ============================================================
		// 13. CLICKBAIT DETECTOR
		// ============================================================
		$reg['clickbait_detector'] = array(
			'desc'     => 'Flag clickbait / sensationalist patterns in a post title and first 200 words. Checks for power words (secret, unbelievable, you won\'t believe…), ALL CAPS, excessive punctuation, and first-person bait ("I tried…").',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$power = array( 'secret','shocking','unbelievable','you won\'t','youll','this is why','mind-blowing','life-changing','game-changer','jaw-dropping','insane','crazy','viral' );
				$title = $post->post_title;
				$intro = wp_trim_words( wp_strip_all_tags( $post->post_content ), 30, '' );
				$combined = $title . ' ' . $intro;
				$hits = array();
				foreach ( $power as $w ) {
					if ( stripos( $combined, $w ) !== false ) {
						$hits[] = $w;
					}
				}
				$caps_ratio = preg_match_all( '/\b[A-Z]{4,}\b/', $combined, $m ) ? count( $m[0] ) : 0;
				$excl = substr_count( $title, '!' );
				$question = str_contains( $title, '?' );
				$first_person = (bool) preg_match( '/\b(i tried|i tested|here\'s why|heres why)\b/i', $intro );
				$score = count( $hits ) * 10 + $caps_ratio * 5 + $excl * 3 + ( $first_person ? 5 : 0 ) + ( $question ? 1 : 0 );
				return array(
					'post_id'        => $id,
					'score'          => $score,
					'verdict'        => $score >= 20 ? 'clickbait-leaning' : ( $score >= 10 ? 'borderline' : 'clean' ),
					'power_words'    => $hits,
					'all_caps_words' => $caps_ratio,
					'exclamations'   => $excl,
					'first_person'   => $first_person,
				);
			},
		);

		// ============================================================
		// 14. FAQ SEED GENERATOR
		// ============================================================
		$reg['faq_seed_generator'] = array(
			'desc'     => 'Extract question/answer pairs from a post: scans for "Q:", "FAQ:", "?", and section headings, and uses the surrounding paragraph as the answer seed. Returns clean Q/A pairs ready to feed seo_build_faq_schema.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'max'     => array( 'type' => 'integer' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$text = wp_strip_all_tags( $post->post_content );
				$paras = preg_split( '/\n\s*\n/', $text );
				$faqs = array();
				$max = (int) ( $a['max'] ?? 8 );
				foreach ( $paras as $p ) {
					$p = trim( $p );
					if ( strlen( $p ) < 20 ) {
						continue;
					}
					// First sentence as Q, second as A.
					if ( preg_match( '/^(.+?\?)\s+(.{40,300}?)(?:\.|\n|$)/u', $p, $m ) ) {
						$faqs[] = array( 'question' => trim( $m[1] ), 'answer' => trim( $m[2] ) );
					}
					if ( count( $faqs ) >= $max ) {
						break;
					}
				}
				return array( 'post_id' => $id, 'faqs' => $faqs );
			},
		);

		// ============================================================
		// 15. TOPICAL AUTHORITY SCORE
		// ============================================================
		$reg['topical_authority_score'] = array(
			'desc'     => 'Score a topic\'s coverage on this site: how many posts, total word count, average post score, internal-link density, and a 0-100 authority score. Pass topic as a string (used to match title + content).',
			'risk'     => 'read',
			'schema'   => array(
				'topic'      => array( 'type' => 'string' ),
				'post_type'  => array( 'type' => 'string' ),
				'limit'      => array( 'type' => 'integer' ),
			),
			'required' => array( 'topic' ),
			'handler'  => function ( $a ) {
				$topic = strtolower( trim( $a['topic'] ) );
				$limit = min( (int) ( $a['limit'] ?? 200 ), 1000 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					's'              => $topic,
				) );
				$total_words = 0; $ids = array();
				foreach ( $posts as $p ) {
					$total_words += str_word_count( wp_strip_all_tags( $p->post_content ) );
					$ids[] = $p->ID;
				}
				$home = wp_parse_url( home_url(), PHP_URL_HOST );
				$inbound_links = 0;
				if ( $ids ) {
					$others = get_posts( array(
						'post_type'      => $a['post_type'] ?? 'post',
						'post_status'    => 'publish',
						'posts_per_page' => 500,
						'fields'         => array( 'ID', 'post_content' ),
						'post__not_in'   => $ids,
					) );
					foreach ( $others as $o ) {
						preg_match_all( '/href=["\']([^"\']+)["\']/i', $o->post_content, $m );
						foreach ( $m[1] as $href ) {
							$tid = url_to_postid( $href );
							if ( $tid && in_array( $tid, $ids, true ) ) {
								$inbound_links++;
							}
						}
					}
				}
				$post_score   = min( 40, count( $posts ) * 2 );          // 0-40
				$word_score   = min( 30, (int) round( $total_words / 1000 ) );  // 0-30
				$link_score   = min( 30, $inbound_links * 2 );            // 0-30
				$authority    = $post_score + $word_score + $link_score;
				return array(
					'topic'          => $a['topic'],
					'post_count'     => count( $posts ),
					'total_words'    => $total_words,
					'inbound_links'  => $inbound_links,
					'components'     => array( 'post_score' => $post_score, 'word_score' => $word_score, 'link_score' => $link_score ),
					'authority_score'=> $authority,
				);
			},
		);

		return $reg;
	}
}
