<?php
/**
 * Content-generation + Elementor page-builder tool group.
 *
 * The AI client does the research/writing; these tools persist the result as
 * fully-formed, SEO-complete WordPress content. The Elementor tools build
 * pages using the free Elementor data structure (no Pro required).
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Content_Gen {

	/** Flesch readability metrics on the plain text of an HTML body. */
	private static function readability( string $html ): array {
		$text = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $html ) ) );
		if ( '' === $text ) {
			return array( 'words' => 0 );
		}
		$sentences = max( 1, count( (array) preg_split( '/[.!?]+(?:\s|$)/u', $text, -1, PREG_SPLIT_NO_EMPTY ) ) );
		$words_arr = (array) preg_split( '/\s+/u', $text, -1, PREG_SPLIT_NO_EMPTY );
		$words     = max( 1, count( $words_arr ) );
		$syll      = 0;
		foreach ( $words_arr as $w ) {
			$syll += self::syllables( $w );
		}
		$long = 0;
		foreach ( (array) preg_split( '/[.!?]+/u', $text, -1, PREG_SPLIT_NO_EMPTY ) as $s ) {
			if ( count( (array) preg_split( '/\s+/u', trim( $s ), -1, PREG_SPLIT_NO_EMPTY ) ) > 20 ) {
				$long++;
			}
		}
		$wps   = $words / $sentences;
		$spw   = $syll / $words;
		$ease  = 206.835 - ( 1.015 * $wps ) - ( 84.6 * $spw );
		$grade = ( 0.39 * $wps ) + ( 11.8 * $spw ) - 15.59;
		return array(
			'words'                  => $words,
			'sentences'              => $sentences,
			'avg_words_per_sentence' => round( $wps, 1 ),
			'reading_ease'           => round( $ease, 1 ),
			'grade_level'            => max( 0, round( $grade, 1 ) ),
			'long_sentences'         => $long,
			'verdict'                => $ease >= 80 ? 'very easy (grade 5 or under)' : ( $ease >= 70 ? 'easy (≈grade 6)' : ( $ease >= 60 ? 'standard (≈grade 7-8)' : 'tighten — shorten sentences and use simpler words' ) ),
		);
	}

	/** Rough English syllable count. */
	private static function syllables( string $word ): int {
		$word = strtolower( preg_replace( '/[^a-z]/i', '', $word ) );
		if ( strlen( $word ) <= 3 ) {
			return $word ? 1 : 0;
		}
		$word = preg_replace( '/(?:[^laeiouy]es|ed|[^laeiouy]e)$/', '', $word );
		$word = preg_replace( '/^y/', '', (string) $word );
		preg_match_all( '/[aeiouy]{1,2}/', (string) $word, $m );
		return max( 1, count( $m[0] ) );
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// RESEARCHED ARTICLE — one-shot publish with SEO + schema
		// ============================================================
		$reg['publish_article'] = array(
			'desc'     => 'Publish a complete, SEO-ready article in one call. Sets content, category, meta title/description, focus keyword, Article schema, and optional FAQ schema. The AI client supplies researched content; this tool persists it correctly. Returns the live URL.',
			'risk'     => 'write',
			'schema'   => array(
				'title'         => array( 'type' => 'string' ),
				'content_html'  => array( 'type' => 'string', 'description' => 'Full article body as HTML (use h2/h3, p, ul, etc.)' ),
				'meta_title'    => array( 'type' => 'string', 'description' => 'SEO title ≤60 chars' ),
				'meta_desc'     => array( 'type' => 'string', 'description' => 'Meta description ≤155 chars' ),
				'focus_kw'      => array( 'type' => 'string' ),
				'excerpt'       => array( 'type' => 'string' ),
				'category_ids'  => array( 'type' => 'array', 'description' => 'Array of category term IDs' ),
				'tags'          => array( 'type' => 'array', 'description' => 'Array of tag names' ),
				'status'        => array( 'type' => 'string', 'description' => 'publish or draft. Default draft.' ),
				'featured_image_url' => array( 'type' => 'string', 'description' => 'Optional image to sideload as featured image' ),
				'faqs'          => array( 'type' => 'array', 'description' => 'Optional [{question, answer}] for FAQ schema + visible block' ),
				'author_id'     => array( 'type' => 'integer' ),
			),
			'required' => array( 'title', 'content_html' ),
			'handler'  => function ( $a ) {
				// 1. Create the post.
				$id = wp_insert_post(
					array(
						'post_title'   => $a['title'],
						'post_content' => $a['content_html'],
						'post_excerpt' => $a['excerpt'] ?? '',
						'post_status'  => $a['status'] ?? 'draft',
						'post_type'    => 'post',
						'post_author'  => (int) ( $a['author_id'] ?? get_current_user_id() ?: 1 ),
					),
					true
				);
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}

				// 2. Categories + tags.
				if ( ! empty( $a['category_ids'] ) && is_array( $a['category_ids'] ) ) {
					wp_set_post_categories( $id, array_map( 'intval', $a['category_ids'] ) );
				}
				if ( ! empty( $a['tags'] ) && is_array( $a['tags'] ) ) {
					wp_set_post_tags( $id, $a['tags'] );
				}

				// 3. SEO meta (via the SEO tool's key map).
				$keys = WPXMCP_Tools_SEO_keys_public();
				if ( ! empty( $a['meta_title'] ) ) {
					update_post_meta( $id, $keys['title'], $a['meta_title'] );
				}
				if ( ! empty( $a['meta_desc'] ) ) {
					update_post_meta( $id, $keys['desc'], $a['meta_desc'] );
				}
				if ( ! empty( $a['focus_kw'] ) ) {
					update_post_meta( $id, $keys['focus'], $a['focus_kw'] );
				}

				// 4. Featured image.
				if ( ! empty( $a['featured_image_url'] ) ) {
					require_once ABSPATH . 'wp-admin/includes/file.php';
					require_once ABSPATH . 'wp-admin/includes/media.php';
					require_once ABSPATH . 'wp-admin/includes/image.php';
					$tmp = download_url( $a['featured_image_url'] );
					if ( ! is_wp_error( $tmp ) ) {
						$file = array(
							'name'     => basename( wp_parse_url( $a['featured_image_url'], PHP_URL_PATH ) ),
							'tmp_name' => $tmp,
						);
						$att = media_handle_sideload( $file, $id, $a['title'] );
						if ( ! is_wp_error( $att ) ) {
							set_post_thumbnail( $id, $att );
						} else {
							@unlink( $tmp );
						}
					}
				}

				// 5. Article schema.
				$schema = array(
					'@context'      => 'https://schema.org',
					'@type'         => 'Article',
					'headline'      => $a['title'],
					'description'   => $a['meta_desc'] ?? '',
					'datePublished' => get_the_date( 'c', $id ),
					'author'        => array( '@type' => 'Organization', 'name' => get_bloginfo( 'name' ) ),
					'publisher'     => array( '@type' => 'Organization', 'name' => get_bloginfo( 'name' ) ),
					'mainEntityOfPage' => get_permalink( $id ),
				);
				update_post_meta( $id, '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );

				// 6. Optional FAQ schema + visible block.
				$faq_count = 0;
				if ( ! empty( $a['faqs'] ) && is_array( $a['faqs'] ) ) {
					$entities = array();
					$html     = "\n<h2>Frequently Asked Questions</h2>\n";
					foreach ( $a['faqs'] as $f ) {
						if ( empty( $f['question'] ) || empty( $f['answer'] ) ) {
							continue;
						}
						$entities[] = array(
							'@type'          => 'Question',
							'name'           => $f['question'],
							'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $f['answer'] ),
						);
						$html .= '<h3>' . esc_html( $f['question'] ) . '</h3><p>' . wp_kses_post( $f['answer'] ) . '</p>' . "\n";
						$faq_count++;
					}
					if ( $entities ) {
						update_post_meta( $id, '_wpxmcp_faq_schema', wp_slash( wp_json_encode( array( '@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $entities ) ) ) );
						$post = get_post( $id );
						wp_update_post( array( 'ID' => $id, 'post_content' => $post->post_content . $html ) );
					}
				}

				return array(
					'post_id'   => $id,
					'url'       => get_permalink( $id ),
					'status'    => get_post_status( $id ),
					'faq_count' => $faq_count,
					'seo_set'   => ! empty( $a['meta_title'] ),
				);
			},
		);

		// ============================================================
		// BULK SEO POSTS — persist AI-researched, Koray-style content as drafts
		// ============================================================
		$reg['bulk_publish_posts'] = array(
			'desc'     => 'Bulk-create fully-formed, SEO-complete posts (default AS DRAFTS) in one call — the persistence layer for AI-researched, Koray-style content. The AI does the research and writing (entities, LSI / secondary keywords, heading vectors, internal + external links and image refs inside content_html, meta title/description, slug, FAQ, schema, GEO/AEO) and passes a "posts" array; this tool drafts each one with Yoast/Rank Math meta, slug, categories/tags, featured image, BlogPosting/Article + FAQPage JSON-LD (rendered in <head>), stored entities + LSI keywords, and optional custom schema folded into an @graph. Continues on per-post errors and returns a per-post report. Use dry_run=true to preview. Max 50 posts per call.',
			'risk'     => 'write',
			'schema'   => array(
				'posts'                => array( 'type' => 'array', 'description' => 'Array of post objects. Each: {title, content_html, slug?, excerpt?, meta_title?, meta_desc?, focus_kw?, secondary_keywords?:[], entities?:[name|{name,url}], key_takeaways?:[short bullet strings], categories?:[names], category_ids?:[ids], tags?:[names], featured_image_url?, featured_image_alt?, faqs?:[{question,answer}], schema_type?:"BlogPosting|Article|NewsArticle", custom_schema?:{}, external_links?:[{anchor,url}], append_sources?:bool, author_id?, status?, date?}. Put internal & external links and <img> tags directly inside content_html. key_takeaways renders a TL;DR box at the top (great for AI answer engines).' ),
				'default_status'       => array( 'type' => 'string', 'description' => 'draft | publish | pending. Default draft.' ),
				'default_category_ids' => array( 'type' => 'array', 'description' => 'Category IDs applied to any post that has none of its own.' ),
				'dry_run'              => array( 'type' => 'boolean', 'description' => 'Validate and report what would be created, writing nothing. Default false.' ),
				'add_speakable'        => array( 'type' => 'boolean', 'description' => 'Add SpeakableSpecification to each article schema so voice and AI answer engines can read the headings and TL;DR aloud. Default true.' ),
			),
			'required' => array( 'posts' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['posts'] ) || ! is_array( $a['posts'] ) ) {
					throw new Exception( 'Provide a non-empty "posts" array.' );
				}
				$posts = array_values( $a['posts'] );
				if ( count( $posts ) > 50 ) {
					throw new Exception( 'Max 50 posts per call. Split into batches.' );
				}
				$default_status = $a['default_status'] ?? 'draft';
				$dry            = ! empty( $a['dry_run'] );
				$keys           = WPXMCP_Tools_SEO_keys_public();

				$resolve_cats = function ( $names ) {
					$ids = array();
					foreach ( (array) $names as $n ) {
						$t = term_exists( $n, 'category' );
						if ( ! $t ) {
							$t = wp_insert_term( $n, 'category' );
						}
						if ( ! is_wp_error( $t ) && $t ) {
							$ids[] = (int) ( is_array( $t ) ? $t['term_id'] : $t );
						}
					}
					return $ids;
				};

				$results = array();
				$ok      = 0;
				$fail    = 0;

				foreach ( $posts as $i => $p ) {
					$label = $p['title'] ?? ( '#' . $i );
					try {
						if ( empty( $p['title'] ) || empty( $p['content_html'] ) ) {
							throw new Exception( 'Each post needs a title and content_html.' );
						}

						if ( $dry ) {
							$results[] = array(
								'index'        => $i,
								'title'        => $label,
								'would_create' => true,
								'status'       => $p['status'] ?? $default_status,
								'slug'         => $p['slug'] ?? sanitize_title( $p['title'] ),
								'has_image'    => ! empty( $p['featured_image_url'] ),
								'faqs'         => count( (array) ( $p['faqs'] ?? array() ) ),
								'entities'     => count( (array) ( $p['entities'] ?? array() ) ),
								'lsi'          => count( (array) ( $p['secondary_keywords'] ?? array() ) ),
							);
							$ok++;
							continue;
						}

						$content = (string) $p['content_html'];
						if ( ! empty( $p['key_takeaways'] ) && is_array( $p['key_takeaways'] ) ) {
							$tk = '';
							foreach ( $p['key_takeaways'] as $t ) {
								$t = trim( (string) $t );
								if ( '' !== $t ) {
									$tk .= '<li>' . esc_html( $t ) . '</li>';
								}
							}
							if ( '' !== $tk ) {
								$content = '<div class="wpxmcp-key-takeaways"><h2>Key Takeaways</h2><ul>' . $tk . '</ul></div>' . "\n\n" . $content;
							}
						}

						$postarr = array(
							'post_title'   => $p['title'],
							'post_content' => $content,
							'post_excerpt' => $p['excerpt'] ?? '',
							'post_status'  => $p['status'] ?? $default_status,
							'post_type'    => $p['post_type'] ?? 'post',
							'post_author'  => (int) ( $p['author_id'] ?? ( get_current_user_id() ?: 1 ) ),
						);
						if ( ! empty( $p['slug'] ) ) {
							$postarr['post_name'] = sanitize_title( $p['slug'] );
						}
						if ( ! empty( $p['date'] ) ) {
							$postarr['post_date'] = sanitize_text_field( $p['date'] );
						}
						$id = wp_insert_post( $postarr, true );
						if ( is_wp_error( $id ) ) {
							throw new Exception( $id->get_error_message() );
						}

						// Categories (ids and/or names) + tags.
						$cat_ids = array();
						if ( ! empty( $p['category_ids'] ) && is_array( $p['category_ids'] ) ) {
							$cat_ids = array_map( 'intval', $p['category_ids'] );
						}
						if ( ! empty( $p['categories'] ) && is_array( $p['categories'] ) ) {
							$cat_ids = array_merge( $cat_ids, $resolve_cats( $p['categories'] ) );
						}
						if ( empty( $cat_ids ) && ! empty( $a['default_category_ids'] ) && is_array( $a['default_category_ids'] ) ) {
							$cat_ids = array_map( 'intval', $a['default_category_ids'] );
						}
						if ( $cat_ids ) {
							wp_set_post_categories( $id, $cat_ids );
						}
						if ( ! empty( $p['tags'] ) && is_array( $p['tags'] ) ) {
							wp_set_post_tags( $id, $p['tags'] );
						}

						// SEO meta (Yoast / Rank Math aware).
						if ( ! empty( $p['meta_title'] ) ) {
							update_post_meta( $id, $keys['title'], $p['meta_title'] );
						}
						if ( ! empty( $p['meta_desc'] ) ) {
							update_post_meta( $id, $keys['desc'], $p['meta_desc'] );
						}
						$focus = $p['focus_kw'] ?? '';
						if ( ! empty( $p['secondary_keywords'] ) && is_array( $p['secondary_keywords'] ) ) {
							update_post_meta( $id, '_wpxmcp_lsi_keywords', wp_json_encode( array_values( $p['secondary_keywords'] ) ) );
							$focus = trim( $focus . '|' . implode( '|', $p['secondary_keywords'] ), '|' ); // Rank Math accepts pipe-separated
						}
						if ( '' !== $focus ) {
							update_post_meta( $id, $keys['focus'], $focus );
						}
						if ( ! empty( $p['entities'] ) && is_array( $p['entities'] ) ) {
							update_post_meta( $id, '_wpxmcp_entities', wp_json_encode( array_values( $p['entities'] ) ) );
						}

						// Featured image (sideload from URL).
						$image_set = false;
						if ( ! empty( $p['featured_image_url'] ) ) {
							require_once ABSPATH . 'wp-admin/includes/file.php';
							require_once ABSPATH . 'wp-admin/includes/media.php';
							require_once ABSPATH . 'wp-admin/includes/image.php';
							$tmp = download_url( $p['featured_image_url'] );
							if ( ! is_wp_error( $tmp ) ) {
								$file = array(
									'name'     => basename( (string) wp_parse_url( $p['featured_image_url'], PHP_URL_PATH ) ) ?: 'image.jpg',
									'tmp_name' => $tmp,
								);
								$att = media_handle_sideload( $file, $id, $p['title'] );
								if ( ! is_wp_error( $att ) ) {
									set_post_thumbnail( $id, $att );
									$image_set = true;
									if ( ! empty( $p['featured_image_alt'] ) ) {
										update_post_meta( $att, '_wp_attachment_image_alt', $p['featured_image_alt'] );
									}
								} else {
									@unlink( $tmp );
								}
							}
						}

						// Article / BlogPosting schema (+ optional custom schema folded into @graph).
						$stype  = in_array( ( $p['schema_type'] ?? 'BlogPosting' ), array( 'Article', 'BlogPosting', 'NewsArticle' ), true ) ? $p['schema_type'] : 'BlogPosting';
						$schema = array(
							'@context'         => 'https://schema.org',
							'@type'            => $stype,
							'headline'         => $p['title'],
							'description'      => $p['meta_desc'] ?? '',
							'datePublished'    => get_the_date( 'c', $id ),
							'dateModified'     => get_the_modified_date( 'c', $id ),
							'author'           => array( '@type' => 'Organization', 'name' => get_bloginfo( 'name' ) ),
							'publisher'        => array( '@type' => 'Organization', 'name' => get_bloginfo( 'name' ) ),
							'mainEntityOfPage' => get_permalink( $id ),
						);
						if ( $image_set ) {
							$schema['image'] = get_the_post_thumbnail_url( $id, 'full' );
						}
						if ( '' !== $focus ) {
							$schema['keywords'] = $focus;
						}
						if ( ! empty( $p['entities'] ) && is_array( $p['entities'] ) ) {
							$schema['about'] = array();
							foreach ( $p['entities'] as $e ) {
								$schema['about'][] = array( '@type' => 'Thing', 'name' => is_array( $e ) ? ( $e['name'] ?? '' ) : $e );
							}
						}
						if ( false !== ( $a['add_speakable'] ?? true ) ) {
							$schema['speakable'] = array(
								'@type'       => 'SpeakableSpecification',
								'cssSelector' => array( 'h1', 'h2', '.wpxmcp-key-takeaways' ),
							);
						}
						if ( ! empty( $p['custom_schema'] ) && is_array( $p['custom_schema'] ) ) {
							$custom = $p['custom_schema'];
							$nodes  = ( isset( $custom['@graph'] ) && is_array( $custom['@graph'] ) ) ? $custom['@graph'] : array( $custom );
							$graph  = array_merge( array( $schema ), $nodes );
							foreach ( $graph as $gi => $node ) {
								if ( is_array( $node ) ) {
									unset( $graph[ $gi ]['@context'] );
								}
							}
							$schema = array( '@context' => 'https://schema.org', '@graph' => array_values( $graph ) );
						}
						update_post_meta( $id, '_wpxmcp_schema', wp_slash( wp_json_encode( $schema ) ) );

						// FAQ schema + visible block.
						$faq_count = 0;
						if ( ! empty( $p['faqs'] ) && is_array( $p['faqs'] ) ) {
							$entities = array();
							$html     = "\n<h2>Frequently Asked Questions</h2>\n";
							foreach ( $p['faqs'] as $f ) {
								if ( empty( $f['question'] ) || empty( $f['answer'] ) ) {
									continue;
								}
								$entities[] = array(
									'@type'          => 'Question',
									'name'           => $f['question'],
									'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $f['answer'] ),
								);
								$html .= '<h3>' . esc_html( $f['question'] ) . '</h3><p>' . wp_kses_post( $f['answer'] ) . '</p>' . "\n";
								$faq_count++;
							}
							if ( $entities ) {
								update_post_meta( $id, '_wpxmcp_faq_schema', wp_slash( wp_json_encode( array( '@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $entities ) ) ) );
								$po = get_post( $id );
								wp_update_post( array( 'ID' => $id, 'post_content' => $po->post_content . $html ) );
							}
						}

						// Optional external sources list appended to the body.
						if ( ! empty( $p['append_sources'] ) && ! empty( $p['external_links'] ) && is_array( $p['external_links'] ) ) {
							$po = get_post( $id );
							$h  = "\n<h2>Sources</h2>\n<ul>\n";
							foreach ( $p['external_links'] as $l ) {
								if ( empty( $l['url'] ) ) {
									continue;
								}
								$h .= '<li><a href="' . esc_url( $l['url'] ) . '" rel="nofollow noopener" target="_blank">' . esc_html( $l['anchor'] ?? $l['url'] ) . '</a></li>' . "\n";
							}
							$h .= "</ul>\n";
							wp_update_post( array( 'ID' => $id, 'post_content' => $po->post_content . $h ) );
						}

						$rd = self::readability( (string) get_post_field( 'post_content', $id ) );

						$results[] = array(
							'index'       => $i,
							'title'       => $p['title'],
							'post_id'     => $id,
							'status'      => get_post_status( $id ),
							'slug'        => get_post_field( 'post_name', $id ),
							'edit_url'    => admin_url( 'post.php?post=' . $id . '&action=edit' ),
							'view_url'    => get_permalink( $id ),
							'seo_set'     => ! empty( $p['meta_title'] ),
							'image_set'   => $image_set,
							'faq_count'   => $faq_count,
							'categories'  => $cat_ids,
							'readability' => $rd,
						);
						$ok++;
					} catch ( \Throwable $e ) {
						$fail++;
						$results[] = array( 'index' => $i, 'title' => $label, 'error' => $e->getMessage() );
					}
				}

				return array(
					'dry_run'        => $dry,
					'requested'      => count( $posts ),
					'created'        => $dry ? 0 : $ok,
					'validated'      => $dry ? $ok : null,
					'failed'         => $fail,
					'default_status' => $default_status,
					'results'        => $results,
					'note'           => $dry ? 'Preview only — set dry_run=false to create the drafts.' : ( 'Created as ' . $default_status . '. Review each in the editor, then publish.' ),
				);
			},
		);

		// ============================================================
		// BULK CATEGORY CREATION
		// ============================================================
		$reg['bulk_create_categories'] = array(
			'desc'     => 'Create multiple categories or product categories at once, with optional parent nesting and SEO descriptions. Pass an array of {name, parent_id?, description?, slug?}.',
			'risk'     => 'write',
			'schema'   => array(
				'taxonomy'   => array( 'type' => 'string', 'description' => 'category or product_cat. Default category.' ),
				'categories' => array( 'type' => 'array', 'description' => '[{"name":"...","parent_id":0,"description":"...","slug":"..."}]' ),
			),
			'required' => array( 'categories' ),
			'handler'  => function ( $a ) {
				$tax     = $a['taxonomy'] ?? 'category';
				$created = array();
				$errors  = array();
				foreach ( $a['categories'] as $c ) {
					if ( empty( $c['name'] ) ) {
						continue;
					}
					$res = wp_insert_term(
						$c['name'],
						$tax,
						array(
							'parent'      => (int) ( $c['parent_id'] ?? 0 ),
							'description' => $c['description'] ?? '',
							'slug'        => $c['slug'] ?? '',
						)
					);
					if ( is_wp_error( $res ) ) {
						$errors[] = array( 'name' => $c['name'], 'error' => $res->get_error_message() );
					} else {
						$created[] = array( 'name' => $c['name'], 'term_id' => $res['term_id'] );
					}
				}
				return array( 'created' => $created, 'errors' => $errors, 'count' => count( $created ) );
			},
		);

		// ============================================================
		// ELEMENTOR (FREE) PAGE BUILDER
		// ============================================================
		$reg['elementor_status'] = array(
			'desc'    => 'Check if Elementor is installed/active and return its version, so the client knows whether elementor_* tools will work.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$active = defined( 'ELEMENTOR_VERSION' );
				return array(
					'installed' => $active,
					'version'   => $active ? ELEMENTOR_VERSION : null,
					'note'      => $active ? 'Ready.' : 'Install the free Elementor plugin to use elementor_build_page.',
				);
			},
		);

		$reg['elementor_build_page'] = array(
			'desc'     => 'Build (or rebuild) a page using the FREE Elementor builder from a simple section spec — no Pro required. Pass "sections": an array of blocks. Supported block types: heading, text, image, button, spacer, divider, two_columns (with left/right text). The tool converts them into native Elementor JSON and marks the page to render with Elementor. Returns the edit + live URLs.',
			'risk'     => 'write',
			'schema'   => array(
				'title'      => array( 'type' => 'string' ),
				'page_id'    => array( 'type' => 'integer', 'description' => 'Existing page to overwrite. Omit to create new.' ),
				'status'     => array( 'type' => 'string', 'description' => 'publish or draft. Default draft.' ),
				'sections'   => array(
					'type'        => 'array',
					'description' => 'Ordered blocks. Each: {"type":"heading","text":"...","size":"xl"} | {"type":"text","text":"<p>..</p>"} | {"type":"image","url":"..","alt":".."} | {"type":"button","text":"..","link":".."} | {"type":"spacer","height":40} | {"type":"divider"} | {"type":"two_columns","left":"<p>..</p>","right":"<p>..</p>"}',
				),
			),
			'required' => array( 'sections' ),
			'handler'  => function ( $a ) {
				if ( ! defined( 'ELEMENTOR_VERSION' ) ) {
					throw new Exception( 'Elementor (free) is not active. Install it first, or use create_post for plain content.' );
				}

				$gen_id = function () {
					return substr( md5( uniqid( (string) wp_rand(), true ) ), 0, 7 );
				};

				$elementor = array();
				foreach ( (array) $a['sections'] as $block ) {
					$type    = $block['type'] ?? 'text';
					$widget  = null;

					switch ( $type ) {
						case 'heading':
							$widget = array(
								'id'         => $gen_id(),
								'elType'     => 'widget',
								'widgetType' => 'heading',
								'settings'   => array(
									'title'        => $block['text'] ?? '',
									'header_size'  => 'h2',
									'size'         => $block['size'] ?? 'default',
								),
							);
							break;
						case 'text':
							$widget = array(
								'id'         => $gen_id(),
								'elType'     => 'widget',
								'widgetType' => 'text-editor',
								'settings'   => array( 'editor' => $block['text'] ?? '' ),
							);
							break;
						case 'image':
							$widget = array(
								'id'         => $gen_id(),
								'elType'     => 'widget',
								'widgetType' => 'image',
								'settings'   => array(
									'image' => array( 'url' => $block['url'] ?? '', 'alt' => $block['alt'] ?? '' ),
								),
							);
							break;
						case 'button':
							$widget = array(
								'id'         => $gen_id(),
								'elType'     => 'widget',
								'widgetType' => 'button',
								'settings'   => array(
									'text' => $block['text'] ?? 'Click',
									'link' => array( 'url' => $block['link'] ?? '#' ),
								),
							);
							break;
						case 'spacer':
							$widget = array(
								'id'         => $gen_id(),
								'elType'     => 'widget',
								'widgetType' => 'spacer',
								'settings'   => array( 'space' => array( 'size' => (int) ( $block['height'] ?? 30 ), 'unit' => 'px' ) ),
							);
							break;
						case 'divider':
							$widget = array(
								'id'         => $gen_id(),
								'elType'     => 'widget',
								'widgetType' => 'divider',
								'settings'   => array(),
							);
							break;
						case 'two_columns':
							// A section with two 50% columns.
							$elementor[] = array(
								'id'       => $gen_id(),
								'elType'   => 'section',
								'settings' => array(),
								'elements' => array(
									array(
										'id'       => $gen_id(),
										'elType'   => 'column',
										'settings' => array( '_column_size' => 50 ),
										'elements' => array(
											array(
												'id'         => $gen_id(),
												'elType'     => 'widget',
												'widgetType' => 'text-editor',
												'settings'   => array( 'editor' => $block['left'] ?? '' ),
											),
										),
									),
									array(
										'id'       => $gen_id(),
										'elType'   => 'column',
										'settings' => array( '_column_size' => 50 ),
										'elements' => array(
											array(
												'id'         => $gen_id(),
												'elType'     => 'widget',
												'widgetType' => 'text-editor',
												'settings'   => array( 'editor' => $block['right'] ?? '' ),
											),
										),
									),
								),
							);
							continue 2; // already pushed a full section
					}

					if ( $widget ) {
						// Wrap single widget in a one-column section.
						$elementor[] = array(
							'id'       => $gen_id(),
							'elType'   => 'section',
							'settings' => array(),
							'elements' => array(
								array(
									'id'       => $gen_id(),
									'elType'   => 'column',
									'settings' => array( '_column_size' => 100 ),
									'elements' => array( $widget ),
								),
							),
						);
					}
				}

				// Create or update the page.
				$page_id = (int) ( $a['page_id'] ?? 0 );
				if ( $page_id ) {
					wp_update_post(
						array(
							'ID'          => $page_id,
							'post_title'  => $a['title'] ?? get_the_title( $page_id ),
							'post_status' => $a['status'] ?? 'draft',
						)
					);
				} else {
					$page_id = wp_insert_post(
						array(
							'post_title'  => $a['title'] ?? 'New Elementor Page',
							'post_type'   => 'page',
							'post_status' => $a['status'] ?? 'draft',
						),
						true
					);
					if ( is_wp_error( $page_id ) ) {
						throw new Exception( $page_id->get_error_message() );
					}
				}

				// Persist Elementor data + flags.
				update_post_meta( $page_id, '_elementor_data', wp_slash( wp_json_encode( $elementor ) ) );
				update_post_meta( $page_id, '_elementor_edit_mode', 'builder' );
				update_post_meta( $page_id, '_elementor_template_type', 'wp-page' );
				update_post_meta( $page_id, '_elementor_version', ELEMENTOR_VERSION );
				update_post_meta( $page_id, '_wp_page_template', 'elementor_header_footer' );

				// Tell Elementor to regenerate CSS for this page.
				if ( class_exists( '\Elementor\Plugin' ) ) {
					\Elementor\Plugin::$instance->files_manager->clear_cache();
				}

				return array(
					'page_id'  => $page_id,
					'sections' => count( $elementor ),
					'edit_url' => admin_url( 'post.php?post=' . $page_id . '&action=elementor' ),
					'view_url' => get_permalink( $page_id ),
					'status'   => get_post_status( $page_id ),
				);
			},
		);

		return $reg;
	}
}
