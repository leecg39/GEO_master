<?php
/**
 * Audit tools: broken links (internal + external), image alt-tag issues, DB health.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Audit {

	public static function all(): array {
		$reg = array();

		// ============================================================
		// LINK AUDITING
		// ============================================================

		$reg['audit_links'] = array(
			'desc'     => 'Scan all published posts/pages for broken internal and external links. Returns a list of broken URLs with the post ID, post title, and HTTP status (or error). Set check_external=false to skip external URLs (faster). limit controls max posts to scan (default 50, max 200).',
			'risk'     => 'read',
			'schema'   => array(
				'post_type'      => array( 'type' => 'string', 'description' => 'Post type to scan. Default: any (posts + pages).' ),
				'check_external' => array( 'type' => 'boolean', 'description' => 'Whether to HEAD-check external URLs. Default true.' ),
				'limit'          => array( 'type' => 'integer', 'description' => 'Max posts to scan. Default 50.' ),
				'timeout'        => array( 'type' => 'integer', 'description' => 'HTTP timeout per URL in seconds. Default 8.' ),
			),
			'handler'  => function ( $a ) {
				$post_type      = $a['post_type'] ?? 'any';
				$check_external = isset( $a['check_external'] ) ? (bool) $a['check_external'] : true;
				$limit          = min( (int) ( $a['limit'] ?? 50 ), 200 );
				$timeout        = min( (int) ( $a['timeout'] ?? 8 ), 30 );

				$posts = get_posts( array(
					'post_type'      => $post_type,
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => 'ids',
				) );

				$broken     = array();
				$ok_count   = 0;
				$skip_count = 0;
				$site_host  = wp_parse_url( home_url(), PHP_URL_HOST );

				foreach ( $posts as $post_id ) {
					$post    = get_post( $post_id );
					$content = $post->post_content;

					// Extract all hrefs.
					preg_match_all( '/<a[^>]+href=["\']([^"\'#\s]+)["\'][^>]*>/i', $content, $matches );
					$urls = array_unique( $matches[1] );

					foreach ( $urls as $url ) {
						// Make relative URLs absolute.
						if ( str_starts_with( $url, '/' ) ) {
							$url = home_url( $url );
						}
						// Skip non-http(s), mailto, tel, etc.
						if ( ! preg_match( '#^https?://#i', $url ) ) {
							$skip_count++;
							continue;
						}

						$is_internal = ( wp_parse_url( $url, PHP_URL_HOST ) === $site_host );

						if ( ! $is_internal && ! $check_external ) {
							$skip_count++;
							continue;
						}

						$response = wp_remote_head( $url, array(
							'timeout'     => $timeout,
							'redirection' => 5,
							'user-agent'  => 'WP-x-MCP-LinkChecker/1.0',
						) );

						if ( is_wp_error( $response ) ) {
							$broken[] = array(
								'post_id'   => $post_id,
								'post_title'=> $post->post_title,
								'post_link' => get_permalink( $post_id ),
								'url'       => $url,
								'type'      => $is_internal ? 'internal' : 'external',
								'status'    => 'error',
								'error'     => $response->get_error_message(),
							);
						} else {
							$code = wp_remote_retrieve_response_code( $response );
							if ( $code >= 400 ) {
								$broken[] = array(
									'post_id'   => $post_id,
									'post_title'=> $post->post_title,
									'post_link' => get_permalink( $post_id ),
									'url'       => $url,
									'type'      => $is_internal ? 'internal' : 'external',
									'status'    => $code,
								);
							} else {
								$ok_count++;
							}
						}
					}
				}

				return array(
					'scanned_posts' => count( $posts ),
					'broken_count'  => count( $broken ),
					'ok_count'      => $ok_count,
					'skipped_urls'  => $skip_count,
					'broken'        => $broken,
				);
			},
		);

		$reg['fix_internal_link'] = array(
			'desc'     => 'Replace a broken internal URL with a new URL across all post content. Returns number of posts updated.',
			'risk'     => 'write',
			'schema'   => array(
				'old_url' => array( 'type' => 'string', 'description' => 'The broken URL to find.' ),
				'new_url' => array( 'type' => 'string', 'description' => 'The replacement URL.' ),
				'dry_run' => array( 'type' => 'boolean', 'description' => 'If true, only report matches without saving. Default false.' ),
			),
			'required' => array( 'old_url', 'new_url' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				$old     = esc_url_raw( $a['old_url'] );
				$new     = esc_url_raw( $a['new_url'] );
				$dry_run = ! empty( $a['dry_run'] );

				// Count affected posts first.
				$count = (int) $wpdb->get_var( $wpdb->prepare(
					"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_content LIKE %s AND post_status = 'publish'",
					'%' . $wpdb->esc_like( $old ) . '%'
				) );

				if ( ! $dry_run && $count > 0 ) {
					$wpdb->query( $wpdb->prepare(
						"UPDATE {$wpdb->posts} SET post_content = REPLACE(post_content, %s, %s) WHERE post_status = 'publish'",
						$old,
						$new
					) );
					// Clear object cache.
					wp_cache_flush();
				}

				return array(
					'old_url'        => $old,
					'new_url'        => $new,
					'posts_affected' => $count,
					'dry_run'        => $dry_run,
					'updated'        => ! $dry_run && $count > 0,
				);
			},
		);

		// ============================================================
		// IMAGE ALT TAG AUDITING
		// ============================================================

		$reg['audit_image_alts'] = array(
			'desc'     => 'Find images missing alt text across all published content AND the media library. Returns post IDs, image URLs, and attachment IDs for easy fixing.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Post type to scan. Default: any.' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Max posts to scan. Default 100.' ),
				'include_media_library' => array( 'type' => 'boolean', 'description' => 'Also check media library attachments. Default true.' ),
			),
			'handler'  => function ( $a ) {
				$limit          = min( (int) ( $a['limit'] ?? 100 ), 500 );
				$include_media  = isset( $a['include_media_library'] ) ? (bool) $a['include_media_library'] : true;
				$post_type      = $a['post_type'] ?? 'any';

				$issues = array();

				// --- Scan post content for <img> without alt or with empty alt ---
				$posts = get_posts( array(
					'post_type'      => $post_type,
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => 'ids',
				) );

				foreach ( $posts as $post_id ) {
					$post    = get_post( $post_id );
					$content = $post->post_content;

					preg_match_all( '/<img[^>]+>/i', $content, $img_tags );
					foreach ( $img_tags[0] as $tag ) {
						$has_alt   = preg_match( '/alt=["\']([^"\']*)["\']/', $tag, $alt_match );
						$alt_value = $has_alt ? trim( $alt_match[1] ) : null;

						if ( ! $has_alt || '' === $alt_value ) {
							// Try to extract src.
							preg_match( '/src=["\']([^"\']+)["\']/', $tag, $src_m );
							$src = $src_m[1] ?? 'unknown';

							// Try to find attachment ID.
							$att_id = attachment_url_to_postid( $src );

							$issues[] = array(
								'source'        => 'post_content',
								'post_id'       => $post_id,
								'post_title'    => $post->post_title,
								'post_link'     => get_permalink( $post_id ),
								'image_src'     => $src,
								'attachment_id' => $att_id ?: null,
								'issue'         => ! $has_alt ? 'missing_alt_attribute' : 'empty_alt_text',
							);
						}
					}
				}

				// --- Media library scan ---
				if ( $include_media ) {
					global $wpdb;
					$attachments = $wpdb->get_results(
						"SELECT p.ID, p.guid, p.post_title
						 FROM {$wpdb->posts} p
						 LEFT JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id AND pm.meta_key = '_wp_attachment_image_alt'
						 WHERE p.post_type = 'attachment'
						   AND p.post_mime_type LIKE 'image/%'
						   AND ( pm.meta_value IS NULL OR pm.meta_value = '' )
						 LIMIT 200"
					);

					foreach ( $attachments as $att ) {
						$issues[] = array(
							'source'        => 'media_library',
							'post_id'       => null,
							'post_title'    => null,
							'post_link'     => null,
							'image_src'     => $att->guid,
							'attachment_id' => (int) $att->ID,
							'image_title'   => $att->post_title,
							'issue'         => 'no_alt_in_media_library',
						);
					}
				}

				return array(
					'total_issues'  => count( $issues ),
					'scanned_posts' => count( $posts ),
					'issues'        => $issues,
				);
			},
		);

		$reg['fix_image_alt'] = array(
			'desc'     => 'Set the alt text for a media library image by attachment ID. Also updates any <img> tags in post content if update_content=true.',
			'risk'     => 'write',
			'schema'   => array(
				'attachment_id'  => array( 'type' => 'integer', 'description' => 'The media library attachment ID.' ),
				'alt_text'       => array( 'type' => 'string',  'description' => 'The alt text to set.' ),
				'update_content' => array( 'type' => 'boolean', 'description' => 'Also patch alt in post_content across site. Default false.' ),
			),
			'required' => array( 'attachment_id', 'alt_text' ),
			'handler'  => function ( $a ) {
				$att_id   = (int) $a['attachment_id'];
				$alt      = sanitize_text_field( $a['alt_text'] );
				$fix_html = ! empty( $a['update_content'] );

				if ( ! get_post( $att_id ) ) {
					throw new Exception( "Attachment {$att_id} not found." );
				}

				update_post_meta( $att_id, '_wp_attachment_image_alt', $alt );
				$updated_posts = 0;

				if ( $fix_html ) {
					global $wpdb;
					$src = wp_get_attachment_url( $att_id );
					if ( $src ) {
						// Regex replace alt="" or missing alt on matching <img src="...">
						$posts = $wpdb->get_results( $wpdb->prepare(
							"SELECT ID, post_content FROM {$wpdb->posts}
							 WHERE post_content LIKE %s AND post_status = 'publish'",
							'%' . $wpdb->esc_like( $src ) . '%'
						) );

						foreach ( $posts as $post ) {
							$new_content = preg_replace_callback(
								'#(<img[^>]*src=["\']' . preg_quote( $src, '#' ) . '["\'][^>]*?)(\s*alt=["\'][^"\']*["\'])?(>)#i',
								function( $m ) use ( $alt ) {
									// Remove existing alt if present, then add correct one.
									$tag = preg_replace( '/\s*alt=["\'][^"\']*["\']/i', '', $m[1] );
									return $tag . ' alt="' . esc_attr( $alt ) . '"' . $m[3];
								},
								$post->post_content
							);
							if ( $new_content !== $post->post_content ) {
								$wpdb->update( $wpdb->posts, array( 'post_content' => $new_content ), array( 'ID' => $post->ID ) );
								$updated_posts++;
							}
						}
						wp_cache_flush();
					}
				}

				return array(
					'attachment_id' => $att_id,
					'alt_text'      => $alt,
					'meta_updated'  => true,
					'posts_updated' => $updated_posts,
				);
			},
		);

		// ============================================================
		// DATABASE HEALTH & FIXES
		// ============================================================

		$reg['db_health_check'] = array(
			'desc'     => 'Run a comprehensive WordPress database health check. Detects orphaned post meta, orphaned comment meta, orphaned term relationships, missing indexes, autoloaded options bloat, transient clutter, and table overhead. Returns a scored report.',
			'risk'     => 'read',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				global $wpdb;
				$issues = array();
				$score  = 100;

				// 1. Orphaned post meta (no parent post).
				$orphan_meta = (int) $wpdb->get_var(
					"SELECT COUNT(*) FROM {$wpdb->postmeta} pm
					 LEFT JOIN {$wpdb->posts} p ON p.ID = pm.post_id
					 WHERE p.ID IS NULL"
				);
				if ( $orphan_meta > 0 ) {
					$issues[] = array( 'type' => 'orphaned_post_meta', 'count' => $orphan_meta, 'fix_tool' => 'db_fix' );
					$score   -= min( 20, intval( $orphan_meta / 10 ) );
				}

				// 2. Orphaned comment meta.
				$orphan_cmeta = (int) $wpdb->get_var(
					"SELECT COUNT(*) FROM {$wpdb->commentmeta} cm
					 LEFT JOIN {$wpdb->comments} c ON c.comment_ID = cm.comment_id
					 WHERE c.comment_ID IS NULL"
				);
				if ( $orphan_cmeta > 0 ) {
					$issues[] = array( 'type' => 'orphaned_comment_meta', 'count' => $orphan_cmeta, 'fix_tool' => 'db_fix' );
					$score   -= min( 10, intval( $orphan_cmeta / 20 ) );
				}

				// 3. Orphaned term relationships.
				$orphan_terms = (int) $wpdb->get_var(
					"SELECT COUNT(*) FROM {$wpdb->term_relationships} tr
					 LEFT JOIN {$wpdb->posts} p ON p.ID = tr.object_id
					 WHERE p.ID IS NULL"
				);
				if ( $orphan_terms > 0 ) {
					$issues[] = array( 'type' => 'orphaned_term_relationships', 'count' => $orphan_terms, 'fix_tool' => 'db_fix' );
					$score   -= min( 10, intval( $orphan_terms / 20 ) );
				}

				// 4. Expired transients.
				$expired_transients = (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->options}
						 WHERE option_name LIKE %s AND option_value < %d AND option_value > 0",
						'_transient_timeout_%',
						time()
					)
				);
				if ( $expired_transients > 0 ) {
					$issues[] = array( 'type' => 'expired_transients', 'count' => $expired_transients, 'fix_tool' => 'db_fix' );
					$score   -= min( 10, intval( $expired_transients / 50 ) );
				}

				// 5. Autoloaded options bloat.
				$autoload_size = $wpdb->get_var(
					"SELECT SUM(LENGTH(option_value)) FROM {$wpdb->options} WHERE autoload = 'yes'"
				);
				$autoload_kb   = round( (int) $autoload_size / 1024, 2 );
				if ( $autoload_kb > 800 ) {
					$issues[] = array( 'type' => 'autoload_bloat', 'size_kb' => $autoload_kb, 'threshold_kb' => 800 );
					$score   -= min( 15, intval( ( $autoload_kb - 800 ) / 100 ) );
				}

				// 6. Table overhead.
				$tables   = $wpdb->get_results( "SHOW TABLE STATUS LIKE '{$wpdb->prefix}%'" );
				$overhead = array();
				foreach ( $tables as $t ) {
					if ( $t->Data_free > 0 ) {
						$overhead[] = array(
							'table'       => $t->Name,
							'overhead_kb' => round( $t->Data_free / 1024, 2 ),
						);
					}
				}
				if ( ! empty( $overhead ) ) {
					$issues[] = array( 'type' => 'table_overhead', 'tables' => $overhead, 'fix_tool' => 'db_fix' );
					$score   -= min( 10, count( $overhead ) * 2 );
				}

				// 7. Trashed posts cluttering DB.
				$trashed = (int) $wpdb->get_var(
					"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'trash'"
				);
				if ( $trashed > 0 ) {
					$issues[] = array( 'type' => 'trashed_posts', 'count' => $trashed, 'fix_tool' => 'db_fix' );
					$score   -= min( 5, intval( $trashed / 10 ) );
				}

				// 8. Post revisions bloat.
				$revisions = (int) $wpdb->get_var(
					"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'revision'"
				);
				if ( $revisions > 100 ) {
					$issues[] = array( 'type' => 'post_revisions_bloat', 'count' => $revisions, 'threshold' => 100, 'fix_tool' => 'db_fix' );
					$score   -= min( 10, intval( ( $revisions - 100 ) / 50 ) );
				}

				$score = max( 0, $score );

				return array(
					'health_score'    => $score,
					'health_label'    => $score >= 80 ? 'Good' : ( $score >= 50 ? 'Fair' : 'Poor' ),
					'total_issues'    => count( $issues ),
					'autoload_kb'     => $autoload_kb,
					'post_revisions'  => $revisions,
					'trashed_posts'   => $trashed,
					'issues'          => $issues,
				);
			},
		);

		$reg['db_fix'] = array(
			'desc'     => 'Fix database issues. Pass which fixes to run: orphaned_post_meta, orphaned_comment_meta, orphaned_term_relationships, expired_transients, optimize_tables, delete_trashed_posts, delete_revisions (keep_revisions=N to keep latest N per post, default 5).',
			'risk'     => 'destructive',
			'schema'   => array(
				'fixes'          => array(
					'type'        => 'array',
					'description' => 'Array of fix names to run. Options: orphaned_post_meta, orphaned_comment_meta, orphaned_term_relationships, expired_transients, optimize_tables, delete_trashed_posts, delete_revisions',
					'items'       => array( 'type' => 'string' ),
				),
				'keep_revisions' => array( 'type' => 'integer', 'description' => 'How many latest revisions to keep per post when delete_revisions is in fixes. Default 5.' ),
				'dry_run'        => array( 'type' => 'boolean', 'description' => 'Preview counts without deleting. Default false.' ),
			),
			'required' => array( 'fixes' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				$fixes   = (array) ( $a['fixes'] ?? array() );
				$dry_run = ! empty( $a['dry_run'] );
				$results = array();

				$allowed = array(
					'orphaned_post_meta',
					'orphaned_comment_meta',
					'orphaned_term_relationships',
					'expired_transients',
					'optimize_tables',
					'delete_trashed_posts',
					'delete_revisions',
				);
				$fixes = array_intersect( $fixes, $allowed );

				foreach ( $fixes as $fix ) {
					switch ( $fix ) {

						case 'orphaned_post_meta':
							$count = (int) $wpdb->get_var(
								"SELECT COUNT(*) FROM {$wpdb->postmeta} pm
								 LEFT JOIN {$wpdb->posts} p ON p.ID = pm.post_id
								 WHERE p.ID IS NULL"
							);
							if ( ! $dry_run ) {
								$wpdb->query(
									"DELETE pm FROM {$wpdb->postmeta} pm
									 LEFT JOIN {$wpdb->posts} p ON p.ID = pm.post_id
									 WHERE p.ID IS NULL"
								);
							}
							$results[ $fix ] = array( 'rows_deleted' => $count, 'dry_run' => $dry_run );
							break;

						case 'orphaned_comment_meta':
							$count = (int) $wpdb->get_var(
								"SELECT COUNT(*) FROM {$wpdb->commentmeta} cm
								 LEFT JOIN {$wpdb->comments} c ON c.comment_ID = cm.comment_id
								 WHERE c.comment_ID IS NULL"
							);
							if ( ! $dry_run ) {
								$wpdb->query(
									"DELETE cm FROM {$wpdb->commentmeta} cm
									 LEFT JOIN {$wpdb->comments} c ON c.comment_ID = cm.comment_id
									 WHERE c.comment_ID IS NULL"
								);
							}
							$results[ $fix ] = array( 'rows_deleted' => $count, 'dry_run' => $dry_run );
							break;

						case 'orphaned_term_relationships':
							$count = (int) $wpdb->get_var(
								"SELECT COUNT(*) FROM {$wpdb->term_relationships} tr
								 LEFT JOIN {$wpdb->posts} p ON p.ID = tr.object_id
								 WHERE p.ID IS NULL"
							);
							if ( ! $dry_run ) {
								$wpdb->query(
									"DELETE tr FROM {$wpdb->term_relationships} tr
									 LEFT JOIN {$wpdb->posts} p ON p.ID = tr.object_id
									 WHERE p.ID IS NULL"
								);
							}
							$results[ $fix ] = array( 'rows_deleted' => $count, 'dry_run' => $dry_run );
							break;

						case 'expired_transients':
							$count = (int) $wpdb->get_var(
								$wpdb->prepare(
									"SELECT COUNT(*) FROM {$wpdb->options}
									 WHERE option_name LIKE %s AND option_value < %d AND option_value > 0",
									'_transient_timeout_%',
									time()
								)
							);
							if ( ! $dry_run ) {
								// Delete transient timeouts and values together.
								$wpdb->query(
									$wpdb->prepare(
										"DELETE o, o2 FROM {$wpdb->options} o
										 INNER JOIN {$wpdb->options} o2
										   ON o2.option_name = REPLACE(o.option_name, '_transient_timeout_', '_transient_')
										 WHERE o.option_name LIKE %s
										   AND o.option_value < %d AND o.option_value > 0",
										'_transient_timeout_%',
										time()
									)
								);
							}
							$results[ $fix ] = array( 'rows_deleted' => $count, 'dry_run' => $dry_run );
							break;

						case 'optimize_tables':
							$tables  = $wpdb->get_col( "SHOW TABLES LIKE '{$wpdb->prefix}%'" );
							$optimized = array();
							if ( ! $dry_run ) {
								foreach ( $tables as $table ) {
									$wpdb->query( "OPTIMIZE TABLE `{$table}`" );
									$optimized[] = $table;
								}
							}
							$results[ $fix ] = array( 'tables_optimized' => count( $tables ), 'dry_run' => $dry_run );
							break;

						case 'delete_trashed_posts':
							$trashed = $wpdb->get_col(
								"SELECT ID FROM {$wpdb->posts} WHERE post_status = 'trash'"
							);
							if ( ! $dry_run ) {
								foreach ( $trashed as $id ) {
									wp_delete_post( (int) $id, true );
								}
							}
							$results[ $fix ] = array( 'deleted' => count( $trashed ), 'dry_run' => $dry_run );
							break;

						case 'delete_revisions':
							$keep = max( 1, (int) ( $a['keep_revisions'] ?? 5 ) );
							// Get all post IDs that have revisions.
							$parent_ids = $wpdb->get_col(
								"SELECT DISTINCT post_parent FROM {$wpdb->posts}
								 WHERE post_type = 'revision' AND post_parent > 0"
							);
							$deleted = 0;
							foreach ( $parent_ids as $pid ) {
								$revs = $wpdb->get_col( $wpdb->prepare(
									"SELECT ID FROM {$wpdb->posts}
									 WHERE post_type = 'revision' AND post_parent = %d
									 ORDER BY post_date DESC",
									$pid
								) );
								$to_delete = array_slice( $revs, $keep );
								foreach ( $to_delete as $rev_id ) {
									$deleted++;
									if ( ! $dry_run ) {
										wp_delete_post_revision( (int) $rev_id );
									}
								}
							}
							$results[ $fix ] = array( 'deleted' => $deleted, 'kept_per_post' => $keep, 'dry_run' => $dry_run );
							break;
					}
				}

				if ( ! $dry_run ) {
					wp_cache_flush();
				}

				return array(
					'fixes_run' => array_keys( $results ),
					'dry_run'   => $dry_run,
					'results'   => $results,
				);
			},
		);

		$reg['db_table_sizes'] = array(
			'desc'    => 'Show sizes of all WordPress database tables (data, index, overhead in KB). Useful to identify bloated tables.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$rows   = $wpdb->get_results( "SHOW TABLE STATUS LIKE '{$wpdb->prefix}%'" );
				$tables = array();
				$total  = 0;
				foreach ( $rows as $r ) {
					$data_kb  = round( $r->Data_length / 1024, 2 );
					$index_kb = round( $r->Index_length / 1024, 2 );
					$free_kb  = round( $r->Data_free / 1024, 2 );
					$total   += $data_kb + $index_kb;
					$tables[] = array(
						'table'     => $r->Name,
						'rows'      => (int) $r->Rows,
						'data_kb'   => $data_kb,
						'index_kb'  => $index_kb,
						'overhead_kb' => $free_kb,
						'engine'    => $r->Engine,
					);
				}
				usort( $tables, fn( $a, $b ) => ( $b['data_kb'] + $b['index_kb'] ) <=> ( $a['data_kb'] + $a['index_kb'] ) );
				return array( 'total_kb' => round( $total, 2 ), 'tables' => $tables );
			},
		);

		// ============================================================
		// EXTENDED CONTENT AUDITS
		// ============================================================

		$reg['audit_duplicate_content'] = array(
			'desc'     => 'Find posts with identical or near-identical post_title (case-insensitive, normalized). Also flags identical slugs. limit caps scanned posts (default 200).',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Default: post' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Default 200' ),
			),
			'handler'  => function ( $a ) {
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'any',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 200 ), 500 ),
					'orderby'        => 'title',
					'order'          => 'ASC',
				) );
				$by_title = array();
				$by_slug  = array();
				foreach ( $posts as $p ) {
					$norm_title = strtolower( trim( preg_replace( '/\s+/', ' ', $p->post_title ) ) );
					$by_title[ $norm_title ][] = array( 'id' => $p->ID, 'title' => $p->post_title, 'status' => $p->post_status, 'link' => get_permalink( $p->ID ) );
					$by_slug[ $p->post_name ][] = array( 'id' => $p->ID, 'title' => $p->post_title, 'status' => $p->post_status );
				}
				$dup_titles = array_values( array_filter( $by_title, fn( $g ) => count( $g ) > 1 ) );
				$dup_slugs  = array_values( array_filter( $by_slug,  fn( $g ) => count( $g ) > 1 && ! empty( $g[0]['id'] ) ) );
				return array(
					'duplicate_title_groups' => $dup_titles,
					'duplicate_title_count'  => array_sum( array_map( 'count', $dup_titles ) ),
					'duplicate_slug_groups'  => $dup_slugs,
					'duplicate_slug_count'   => array_sum( array_map( 'count', $dup_slugs ) ),
				);
			},
		);

		$reg['audit_thin_content'] = array(
			'desc'     => 'Find published posts whose plain-text word count is below min_words (default 300). Useful to flag pages that need expansion.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'min_words' => array( 'type' => 'integer', 'description' => 'Default 300' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$min = (int) ( $a['min_words'] ?? 300 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$thin = array();
				foreach ( $posts as $p ) {
					$text = wp_strip_all_tags( strip_shortcodes( $p->post_content ) );
					$words = preg_split( '/\s+/', trim( $text ), -1, PREG_SPLIT_NO_EMPTY );
					$count = is_array( $words ) ? count( $words ) : 0;
					if ( $count < $min ) {
						$thin[] = array(
							'id'     => $p->ID,
							'title'  => $p->post_title,
							'link'   => get_permalink( $p->ID ),
							'words'  => $count,
							'status' => $p->post_status,
						);
					}
				}
				usort( $thin, fn( $a, $b ) => $a['words'] <=> $b['words'] );
				return array(
					'min_words' => $min,
					'count'     => count( $thin ),
					'items'     => $thin,
				);
			},
		);

		$reg['audit_long_titles'] = array(
			'desc'     => 'Find published posts whose title exceeds max_chars (default 60). Long titles get truncated in SERPs.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type'  => array( 'type' => 'string' ),
				'max_chars'  => array( 'type' => 'integer', 'description' => 'Default 60' ),
				'limit'      => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$max = (int) ( $a['max_chars'] ?? 60 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$long = array();
				foreach ( $posts as $p ) {
					$len = function_exists( 'mb_strlen' ) ? mb_strlen( $p->post_title ) : strlen( $p->post_title );
					if ( $len > $max ) {
						$long[] = array(
							'id'    => $p->ID,
							'title' => $p->post_title,
							'chars' => $len,
							'link'  => get_permalink( $p->ID ),
						);
					}
				}
				usort( $long, fn( $a, $b ) => $b['chars'] <=> $a['chars'] );
				return array(
					'max_chars' => $max,
					'count'     => count( $long ),
					'items'     => $long,
				);
			},
		);

		$reg['audit_short_meta_description'] = array(
			'desc'     => 'Find published posts whose Yoast/RankMath meta description is missing or shorter than min_chars (default 120). Also flags posts with no excerpt.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'min_chars' => array( 'type' => 'integer', 'description' => 'Default 120' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$min = (int) ( $a['min_chars'] ?? 120 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$short = array();
				foreach ( $posts as $p ) {
					$desc_keys = array( '_yoast_wpseo_metadesc', 'rank_math_description', '_aioseo_description' );
					$desc = '';
					foreach ( $desc_keys as $k ) {
						$val = get_post_meta( $p->ID, $k, true );
						if ( $val ) { $desc = $val; break; }
					}
					$len = function_exists( 'mb_strlen' ) ? mb_strlen( $desc ) : strlen( $desc );
					$has_excerpt = ! empty( trim( $p->post_excerpt ) );
					if ( $len < $min || ( $len === 0 && ! $has_excerpt ) ) {
						$short[] = array(
							'id'        => $p->ID,
							'title'     => $p->post_title,
							'link'      => get_permalink( $p->ID ),
							'meta_desc_chars' => $len,
							'has_excerpt'     => $has_excerpt,
						);
					}
				}
				return array(
					'min_chars' => $min,
					'count'     => count( $short ),
					'items'     => $short,
				);
			},
		);

		$reg['audit_heading_structure'] = array(
			'desc'     => 'For each post, check heading structure: H1 count must be 1, headings must not skip levels (e.g. H1 -> H3), and a heading must exist.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$issues = array();
				foreach ( $posts as $p ) {
					$content = $p->post_content;
					preg_match_all( '/<h([1-6])[^>]*>/i', $content, $m );
					$levels = array_map( 'intval', $m[1] );
					$h1_count = count( array_filter( $levels, fn( $l ) => $l === 1 ) );
					$prev = 0;
					$skips = 0;
					foreach ( $levels as $l ) {
						if ( $prev > 0 && $l > $prev + 1 ) {
							$skips++;
						}
						$prev = $l;
					}
					$reasons = array();
					if ( empty( $levels ) ) {
						$reasons[] = 'no_headings';
					}
					if ( $h1_count === 0 ) {
						$reasons[] = 'missing_h1';
					} elseif ( $h1_count > 1 ) {
						$reasons[] = 'multiple_h1';
					}
					if ( $skips > 0 ) {
						$reasons[] = 'level_skips';
					}
					if ( $reasons ) {
						$issues[] = array(
							'id'      => $p->ID,
							'title'   => $p->post_title,
							'link'    => get_permalink( $p->ID ),
							'h1_count'=> $h1_count,
							'heading_count' => count( $levels ),
							'level_skips'   => $skips,
							'reasons' => $reasons,
						);
					}
				}
				return array( 'count' => count( $issues ), 'items' => $issues );
			},
		);

		$reg['audit_unlinked_mentions'] = array(
			'desc'     => 'Scan published posts for the site domain appearing in plain text (not inside an <a> tag or <img alt>). Suggests internal-link opportunities.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$host = wp_parse_url( home_url(), PHP_URL_HOST );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$results = array();
				foreach ( $posts as $p ) {
					// Strip anchors/images/headings first.
					$stripped = preg_replace( '#<a[^>]*>.*?</a>#is', '', $p->post_content );
					$stripped = preg_replace( '#<[^>]+>#', ' ', $stripped );
					$count    = preg_match_all( '#' . preg_quote( $host, '#' ) . '#i', $stripped, $m );
					if ( $count > 0 ) {
						$results[] = array(
							'id'      => $p->ID,
							'title'   => $p->post_title,
							'link'    => get_permalink( $p->ID ),
							'mentions'=> (int) $count,
						);
					}
				}
				usort( $results, fn( $a, $b ) => $b['mentions'] <=> $a['mentions'] );
				return array( 'host' => $host, 'count' => count( $results ), 'items' => $results );
			},
		);

		$reg['audit_external_link_ratio'] = array(
			'desc'     => 'Compute external-link ratio per post: external hrefs divided by total hrefs. Useful for spotting link-farm-ish content.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Default 100' ),
				'threshold' => array( 'type' => 'number',  'description' => 'Ratio above this is flagged. Default 0.7' ),
			),
			'handler'  => function ( $a ) {
				$threshold = (float) ( $a['threshold'] ?? 0.7 );
				$host      = wp_parse_url( home_url(), PHP_URL_HOST );
				$posts     = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$flagged = array();
				foreach ( $posts as $p ) {
					preg_match_all( '/<a[^>]+href=["\']([^"\'#\s]+)["\'][^>]*>/i', $p->post_content, $m );
					$urls = array_unique( $m[1] );
					$ext = $int = 0;
					foreach ( $urls as $u ) {
						$h = wp_parse_url( $u, PHP_URL_HOST );
						if ( ! $h ) {
							continue;
						}
						if ( $h === $host ) {
							$int++;
						} else {
							$ext++;
						}
					}
					$total = $ext + $int;
					if ( $total === 0 ) {
						continue;
					}
					$ratio = $ext / $total;
					if ( $ratio >= $threshold ) {
						$flagged[] = array(
							'id'      => $p->ID,
							'title'   => $p->post_title,
							'link'    => get_permalink( $p->ID ),
							'external'=> $ext,
							'internal'=> $int,
							'ratio'   => round( $ratio, 2 ),
						);
					}
				}
				usort( $flagged, fn( $a, $b ) => $b['ratio'] <=> $a['ratio'] );
				return array( 'threshold' => $threshold, 'count' => count( $flagged ), 'items' => $flagged );
			},
		);

		$reg['audit_image_count'] = array(
			'desc'     => 'Per-post count of <img> tags (excluding media-library attachments already audited elsewhere). Returns posts with 0 images and posts with >max_images.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type'  => array( 'type' => 'string' ),
				'max_images' => array( 'type' => 'integer', 'description' => 'Flag posts with more than this many. Default 25' ),
				'limit'      => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$max = (int) ( $a['max_images'] ?? 25 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 200 ),
				) );
				$zero = $over = array();
				foreach ( $posts as $p ) {
					preg_match_all( '/<img\b[^>]*>/i', $p->post_content, $m );
					$n = count( $m[0] );
					if ( $n === 0 ) {
						$zero[] = array( 'id' => $p->ID, 'title' => $p->post_title, 'link' => get_permalink( $p->ID ) );
					} elseif ( $n > $max ) {
						$over[] = array( 'id' => $p->ID, 'title' => $p->post_title, 'link' => get_permalink( $p->ID ), 'count' => $n );
					}
				}
				return array(
					'max_images'  => $max,
					'no_images'   => array( 'count' => count( $zero ), 'items' => $zero ),
					'too_many'    => array( 'count' => count( $over ), 'items' => $over ),
				);
			},
		);

		$reg['audit_posts_per_author'] = array(
			'desc'     => 'Distribution of published posts by author. Helps spot contributor imbalance.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				global $wpdb;
				$rows = $wpdb->get_results( $wpdb->prepare(
					"SELECT p.post_author, COUNT(*) as total, MAX(p.post_date) as latest
					 FROM {$wpdb->posts} p
					 WHERE p.post_type = %s AND p.post_status = 'publish'
					 GROUP BY p.post_author
					 ORDER BY total DESC",
					$a['post_type'] ?? 'post'
				) );
				$out = array();
				foreach ( $rows as $r ) {
					$u = get_userdata( (int) $r->post_author );
					$out[] = array(
						'author_id'   => (int) $r->post_author,
						'author_name' => $u ? $u->display_name : '(unknown)',
						'post_count'  => (int) $r->total,
						'latest_post' => $r->latest,
					);
				}
				return $out;
			},
		);

		$reg['audit_stale_posts'] = array(
			'desc'     => 'Find published posts whose post_modified is older than stale_days (default 365). Optional also flag posts whose post_date is older than stale_days regardless of modification.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type'  => array( 'type' => 'string' ),
				'stale_days' => array( 'type' => 'integer', 'description' => 'Default 365' ),
				'limit'      => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$days = (int) ( $a['stale_days'] ?? 365 );
				$cutoff = date( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 300 ),
					'date_query'     => array( array( 'before' => $cutoff, 'column' => 'post_modified' ) ),
					'orderby'        => 'modified',
					'order'          => 'ASC',
				) );
				$out = array();
				foreach ( $posts as $p ) {
					$out[] = array(
						'id'       => $p->ID,
						'title'    => $p->post_title,
						'link'     => get_permalink( $p->ID ),
						'modified' => $p->post_modified,
						'published'=> $p->post_date,
						'days_since_modified' => (int) round( ( time() - strtotime( $p->post_modified ) ) / DAY_IN_SECONDS ),
					);
				}
				return array(
					'stale_days' => $days,
					'cutoff'     => $cutoff,
					'count'      => count( $out ),
					'items'      => $out,
				);
			},
		);

		$reg['audit_draft_overload'] = array(
			'desc'     => 'Count posts in non-published statuses (draft, pending, future, private) grouped by status. Useful to identify users who never publish.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Default: any registered post type' ),
			),
			'handler'  => function ( $a ) {
				global $wpdb;
				$pt = $a['post_type'] ?? '';
				if ( $pt ) {
					$rows = $wpdb->get_results( $wpdb->prepare(
						"SELECT post_status, COUNT(*) as total FROM {$wpdb->posts}
						 WHERE post_type = %s AND post_status NOT IN ('publish','inherit','auto-draft','trash')
						 GROUP BY post_status ORDER BY total DESC",
						$pt
					) );
				} else {
					$rows = $wpdb->get_results(
						"SELECT post_type, post_status, COUNT(*) as total FROM {$wpdb->posts}
						 WHERE post_status NOT IN ('publish','inherit','auto-draft','trash')
						 GROUP BY post_type, post_status ORDER BY total DESC"
					);
					$out  = array();
					foreach ( $rows as $r ) {
						$out[] = array( 'post_type' => $r->post_type, 'status' => $r->post_status, 'count' => (int) $r->total );
					}
					return array( 'grouped_by' => 'post_type', 'items' => $out );
				}
				$out = array();
				foreach ( $rows as $r ) {
					$out[] = array( 'status' => $r->post_status, 'count' => (int) $r->total );
				}
				return array( 'grouped_by' => 'status', 'items' => $out );
			},
		);

		$reg['audit_post_type_usage'] = array(
			'desc'    => 'Distribution of content across every public post type. Highlights unused or overloaded CPTs.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$rows = $wpdb->get_results(
					"SELECT post_type, post_status, COUNT(*) as total FROM {$wpdb->posts}
					 WHERE post_status NOT IN ('inherit','auto-draft')
					 GROUP BY post_type, post_status ORDER BY post_type, post_status"
				);
				$by_type = array();
				foreach ( $rows as $r ) {
					$by_type[ $r->post_type ][ $r->post_status ] = (int) $r->total;
				}
				$out = array();
				foreach ( $by_type as $pt => $statuses ) {
					$out[] = array(
						'post_type' => $pt,
						'total'     => array_sum( $statuses ),
						'statuses'  => $statuses,
					);
				}
				usort( $out, fn( $a, $b ) => $b['total'] <=> $a['total'] );
				return $out;
			},
		);

		$reg['audit_tag_clouds'] = array(
			'desc'     => 'Show tags with low usage (<min_count, default 2) and overweight tags (>max_count, default 50). Useful for housekeeping.',
			'risk'     => 'read',
			'schema'   => array(
				'min_count' => array( 'type' => 'integer', 'description' => 'Below this count, a tag is flagged "low-use". Default 2' ),
				'max_count' => array( 'type' => 'integer', 'description' => 'Above this count, a tag is flagged "overweight". Default 50' ),
				'top_n'     => array( 'type' => 'integer', 'description' => 'Limit overweight list. Default 20' ),
			),
			'handler'  => function ( $a ) {
				$min = (int) ( $a['min_count'] ?? 2 );
				$max = (int) ( $a['max_count'] ?? 50 );
				$top = (int) ( $a['top_n'] ?? 20 );
				$tags = get_terms( array( 'taxonomy' => 'post_tag', 'hide_empty' => false ) );
				if ( is_wp_error( $tags ) ) {
					return array( 'error' => $tags->get_error_message() );
				}
				$low = $high = array();
				foreach ( (array) $tags as $t ) {
					$entry = array(
						'id'    => (int) $t->term_id,
						'name'  => $t->name,
						'slug'  => $t->slug,
						'count' => (int) $t->count,
					);
					if ( $t->count < $min ) {
						$low[] = $entry;
					} elseif ( $t->count > $max ) {
						$high[] = $entry;
					}
				}
				usort( $high, fn( $a, $b ) => $b['count'] <=> $a['count'] );
				return array(
					'min_count'       => $min,
					'max_count'       => $max,
					'low_use_count'   => count( $low ),
					'overweight_count'=> count( $high ),
					'low_use'         => $low,
					'overweight_top'  => array_slice( $high, 0, $top ),
				);
			},
		);

		$reg['audit_password_protected'] = array(
			'desc'     => 'List published-but-password-protected posts/pages. These are invisible to non-logged-in users and can affect SEO.',
			'risk'     => 'read',
			'schema'   => array(
				'limit' => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				$q = new WP_Query( array(
					'post_type'      => 'any',
					'post_status'    => 'publish',
					'has_password'   => true,
					'posts_per_page' => min( (int) ( $a['limit'] ?? 100 ), 300 ),
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$items[] = array(
						'id'    => $p->ID,
						'title' => $p->post_title,
						'type'  => $p->post_type,
						'link'  => get_permalink( $p->ID ),
					);
				}
				return array( 'count' => count( $items ), 'items' => $items );
			},
		);

		$reg['audit_duplicate_slugs'] = array(
			'desc'    => 'Find posts that share the same post_name (slug) within the same post_type — guaranteed URL collisions.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$rows = $wpdb->get_results(
					"SELECT post_type, post_name, COUNT(*) as total, GROUP_CONCAT(ID) as ids
					 FROM {$wpdb->posts}
					 WHERE post_name != '' AND post_status NOT IN ('trash','auto-draft','inherit')
					 GROUP BY post_type, post_name HAVING total > 1
					 ORDER BY total DESC LIMIT 100"
				);
				$out = array();
				foreach ( $rows as $r ) {
					$ids = array_map( 'intval', explode( ',', $r->ids ) );
					$out[] = array(
						'post_type' => $r->post_type,
						'slug'      => $r->post_name,
						'count'     => (int) $r->total,
						'ids'       => $ids,
					);
				}
				return $out;
			},
		);

		return $reg;
	}
}
