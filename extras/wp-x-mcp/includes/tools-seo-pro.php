<?php
/**
 * SEO Pro / GEO / AEO v2 tool group — advanced content + technical SEO automation.
 *
 * 25 tools in this group:
 *  - ai_seo_title_generator         (AI-style title generation, length-aware)
 *  - ai_meta_description_generator  (AI-style description generation)
 *  - broken_link_checker            (single-URL or batch broken-link scan)
 *  - image_alt_bulk_updater         (bulk regenerate / fill alt text)
 *  - redirect_manager               (create / list / delete 301 redirects)
 *  - sitemap_regenerator            (force-flush sitemaps)
 *  - user_role_manager              (inspect / change WP user roles & capabilities)
 *  - comment_moderator              (approve / spam / trash comments in bulk)
 *  - backup_creator                 (on-demand DB / file backup artifact)
 *  - malware_scanner                (signature-based PHP/Webshell pattern scan)
 *  - speed_test_integrator          (PageSpeed Insights / GTmetrix-style pull)
 *  - keyword_density_analyzer       (single-page keyword density audit)
 *  - featured_snippet_optimizer     (snippet-shaped content blocks)
 *  - entity_density_checker         (named-entity coverage per post)
 *  - content_freshness_checker      (staleness scan + suggested update dates)
 *  - internal_link_gap_finder       (orphan / under-linked pages)
 *  - schema_validator               (validate JSON-LD against schema.org rules)
 *  - robots_txt_editor              (live edit robots.txt via filter)
 *  - llms_txt_manager               (read / write / regenerate llms.txt)
 *  - core_web_vitals_auditor        (LCP / CLS / INP probes)
 *  - mobile_usability_checker       (viewport / tap target / font size audit)
 *  - hreflang_manager               (read / set hreflang per post)
 *  - canonical_url_manager          (read / set canonical per post)
 *  - duplicate_content_finder       (near-duplicate post detection)
 *  - social_meta_generator          (OG / Twitter card meta injection)
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_SEO_Pro {

	/**
	 * Word / token helpers.
	 */
	private static function tokens( string $text ): array {
		$text = strtolower( wp_strip_all_tags( $text ) );
		$text = preg_replace( '/[^\p{L}\p{N}\s]+/u', ' ', $text );
		$parts = preg_split( '/\s+/u', $text, -1, PREG_SPLIT_NO_EMPTY );
		$stop = array(
			'the','a','an','and','or','of','to','in','on','for','with','is','are','was','were',
			'be','been','being','it','this','that','these','those','as','at','by','from','but',
			'not','your','you','we','our','they','their','them','i','my','me','he','she','his',
			'her','its','will','can','should','would','could','have','has','had','do','does',
			'did','if','then','than','so','such','about','into','out','up','down','over','under',
		);
		$out = array();
		foreach ( $parts as $p ) {
			if ( mb_strlen( $p ) < 3 ) {
				continue;
			}
			if ( in_array( $p, $stop, true ) ) {
				continue;
			}
			$out[] = $p;
		}
		return $out;
	}

	private static function word_count( string $text ): int {
		return str_word_count( wp_strip_all_tags( $text ) );
	}

	private static function meta_keys(): array {
		if ( 'rankmath' === WPXMCP_Tools_SEO::seo_plugin() ) {
			return array(
				'title'     => 'rank_math_title',
				'desc'      => 'rank_math_description',
				'canonical' => 'rank_math_canonical_url',
			);
		}
		return array(
			'title'     => '_yoast_wpseo_title',
			'desc'      => '_yoast_wpseo_metadesc',
			'canonical' => '_yoast_wpseo_canonical',
		);
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// 1. AI SEO TITLE GENERATOR
		// ============================================================
		$reg['ai_seo_title_generator'] = array(
			'desc'     => 'Generate SEO-optimized title tags for a post or product. Uses the post content + focus keyword to propose 3-5 title variants within the 50-60 char sweet spot. Optionally apply one variant directly to Yoast/Rank Math.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer' ),
				'focus_keyword'=> array( 'type' => 'string', 'description' => 'Target keyword to weave in.' ),
				'brand_suffix' => array( 'type' => 'string', 'description' => 'Optional brand to append, e.g. " | MyBrand".' ),
				'apply_index'  => array( 'type' => 'integer', 'description' => 'If set, save the Nth variant (1-based) as the meta title. Omit to only return suggestions.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$brand  = $a['brand_suffix'] ?? '';
				$focus  = $a['focus_keyword'] ?? '';
				$tokens = self::tokens( $post->post_title . ' ' . wp_strip_all_tags( $post->post_content ) );
				$freq   = array_count_values( $tokens );
				arsort( $freq );
				$top    = array_slice( array_keys( $freq ), 0, 6 );
				$kw     = $focus ?: ( $top ? implode( ' ', array_slice( $top, 0, 2 ) ) : $post->post_title );

				$base = $post->post_title;
				$variants = array_filter( array(
					$base . ' — ' . ucwords( $kw ) . ( $brand ? $brand : '' ),
					ucwords( $kw ) . ': ' . $base . $brand,
					$base . ' | ' . ucwords( $kw ) . $brand,
					'The Ultimate Guide to ' . $base . ( $brand ? $brand : '' ),
					$base . ' — Everything You Need to Know' . $brand,
				) );

				$variants = array_values( array_unique( array_map( function ( $v ) {
					$v = trim( preg_replace( '/\s+/', ' ', $v ) );
					if ( mb_strlen( $v ) > 60 ) {
						$v = mb_substr( $v, 0, 57 ) . '…';
					}
					return $v;
				}, $variants ) ) );

				$out = array(
					'post_id'  => $id,
					'focus_keyword' => $kw,
					'variants' => $variants,
					'lengths'  => array_map( 'mb_strlen', $variants ),
				);

				if ( ! empty( $a['apply_index'] ) ) {
					$idx = max( 1, (int) $a['apply_index'] ) - 1;
					if ( isset( $variants[ $idx ] ) ) {
						$keys = self::meta_keys();
						update_post_meta( $id, $keys['title'], $variants[ $idx ] );
						$out['applied'] = $variants[ $idx ];
					}
				}
				return $out;
			},
		);

		// ============================================================
		// 2. AI META DESCRIPTION GENERATOR
		// ============================================================
		$reg['ai_meta_description_generator'] = array(
			'desc'     => 'Generate a meta description (140-160 chars) for a post or product, using the post content / excerpt / focus keyword. Pass apply=true to write it to the active SEO plugin.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer' ),
				'focus_keyword'=> array( 'type' => 'string' ),
				'tone'         => array( 'type' => 'string', 'description' => 'informational | commercial | transactional. Default informational.' ),
				'apply'        => array( 'type' => 'boolean' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$focus = $a['focus_keyword'] ?? '';
				$tone  = $a['tone'] ?? 'informational';
				$src   = $post->post_excerpt ?: wp_strip_all_tags( $post->post_content );
				$src   = trim( preg_replace( '/\s+/', ' ', $src ) );
				$name  = get_bloginfo( 'name' );

				$prefix = match ( $tone ) {
					'commercial'   => 'Compare',
					'transactional'=> 'Buy',
					default        => 'Learn about',
				};

				$lead = $prefix . ' ' . ( $focus ?: $post->post_title ) . '. ';
				$body = $src ? mb_substr( $src, 0, 155 - mb_strlen( $lead ) - 3 ) : ( $post->post_title . ' on ' . $name );
				$gen  = $lead . $body;
				if ( mb_strlen( $gen ) > 160 ) {
					$gen = mb_substr( $gen, 0, 157 ) . '…';
				}
				$out = array(
					'post_id' => $id,
					'description' => $gen,
					'length'  => mb_strlen( $gen ),
				);
				if ( ! empty( $a['apply'] ) ) {
					$keys = self::meta_keys();
					update_post_meta( $id, $keys['desc'], $gen );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 3. BROKEN LINK CHECKER
		// ============================================================
		$reg['broken_link_checker'] = array(
			'desc'     => 'Find broken internal + external links. If url is passed, checks that single URL. Otherwise scans up to "limit" published posts (default 30, max 200) and returns every link with status code or connection error.',
			'risk'     => 'read',
			'schema'   => array(
				'url'         => array( 'type' => 'string', 'description' => 'Optional. If set, only this URL is checked.' ),
				'post_type'   => array( 'type' => 'string' ),
				'limit'       => array( 'type' => 'integer' ),
				'timeout'     => array( 'type' => 'integer' ),
				'check_external' => array( 'type' => 'boolean' ),
			),
			'handler'  => function ( $a ) {
				$timeout = min( (int) ( $a['timeout'] ?? 8 ), 30 );
				$site    = wp_parse_url( home_url(), PHP_URL_HOST );

				if ( ! empty( $a['url'] ) ) {
					$url = $a['url'];
					$resp = wp_remote_head( $url, array(
						'timeout'     => $timeout,
						'redirection' => 5,
						'user-agent'  => 'WP-x-MCP-BrokenLinkChecker/1.0',
					) );
					if ( is_wp_error( $resp ) ) {
						return array( 'url' => $url, 'ok' => false, 'error' => $resp->get_error_message() );
					}
					return array(
						'url'    => $url,
						'ok'     => wp_remote_retrieve_response_code( $resp ) < 400,
						'status' => (int) wp_remote_retrieve_response_code( $resp ),
					);
				}

				$check_external = isset( $a['check_external'] ) ? (bool) $a['check_external'] : true;
				$limit          = min( (int) ( $a['limit'] ?? 30 ), 200 );
				$posts          = get_posts( array(
					'post_type'      => $a['post_type'] ?? array( 'post', 'page' ),
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => 'ids',
				) );

				$rows = array();
				$ok = 0; $broken = 0; $skipped = 0;
				foreach ( $posts as $pid ) {
					$p = get_post( $pid );
					preg_match_all( '/<a[^>]+href=["\']([^"\'#\s]+)["\'][^>]*>/i', $p->post_content, $m );
					$urls = array_unique( $m[1] );
					foreach ( $urls as $u ) {
						if ( str_starts_with( $u, '/' ) ) {
							$u = home_url( $u );
						}
						if ( ! preg_match( '#^https?://#i', $u ) ) {
							$skipped++;
							continue;
						}
						$host = wp_parse_url( $u, PHP_URL_HOST );
						$is_int = ( $host === $site );
						if ( ! $is_int && ! $check_external ) {
							$skipped++;
							continue;
						}
						$resp = wp_remote_head( $u, array( 'timeout' => $timeout, 'redirection' => 5, 'user-agent' => 'WP-x-MCP-BrokenLinkChecker/1.0' ) );
						if ( is_wp_error( $resp ) ) {
							$broken++;
							$rows[] = array( 'post_id' => $pid, 'url' => $u, 'type' => $is_int ? 'internal' : 'external', 'status' => 'error', 'error' => $resp->get_error_message() );
						} else {
							$code = (int) wp_remote_retrieve_response_code( $resp );
							if ( $code >= 400 ) {
								$broken++;
								$rows[] = array( 'post_id' => $pid, 'url' => $u, 'type' => $is_int ? 'internal' : 'external', 'status' => $code );
							} else {
								$ok++;
							}
						}
					}
				}
				return array(
					'ok'      => $ok,
					'broken'  => $broken,
					'skipped' => $skipped,
					'rows'    => $rows,
				);
			},
		);

		// ============================================================
		// 4. IMAGE ALT BULK UPDATER
		// ============================================================
		$reg['image_alt_bulk_updater'] = array(
			'desc'     => 'Bulk-update image alt text. Pass images = [{id, alt}] to apply explicit alts, or set auto_from = "title" | "filename" to auto-generate missing alts. Set dry_run=true to preview.',
			'risk'     => 'write',
			'schema'   => array(
				'images'      => array( 'type' => 'array', 'description' => 'Array of {id: int, alt: string}.' ),
				'auto_from'   => array( 'type' => 'string', 'description' => 'title | filename. If set, fills blanks on media library images.' ),
				'limit'       => array( 'type' => 'integer' ),
				'dry_run'     => array( 'type' => 'boolean' ),
			),
			'handler'  => function ( $a ) {
				$dry = ! empty( $a['dry_run'] );
				$changes = array();

				if ( ! empty( $a['images'] ) && is_array( $a['images'] ) ) {
					foreach ( $a['images'] as $row ) {
						$id  = (int) ( $row['id'] ?? 0 );
						$alt = (string) ( $row['alt'] ?? '' );
						if ( ! $id ) {
							continue;
						}
						if ( ! $dry ) {
							update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
						}
						$changes[] = array( 'id' => $id, 'alt' => $alt, 'mode' => 'explicit' );
					}
				}

				if ( ! empty( $a['auto_from'] ) ) {
					$limit = min( (int) ( $a['limit'] ?? 100 ), 500 );
					$q = new WP_Query( array(
						'post_type'      => 'attachment',
						'post_mime_type' => 'image',
						'post_status'    => 'inherit',
						'posts_per_page' => $limit,
						'no_found_rows'  => true,
					) );
					foreach ( $q->posts as $att ) {
						$existing = get_post_meta( $att->ID, '_wp_attachment_image_alt', true );
						if ( $existing ) {
							continue;
						}
						$alt = '';
						if ( 'title' === $a['auto_from'] ) {
							$alt = $att->post_title;
						} elseif ( 'filename' === $a['auto_from'] ) {
							$alt = pathinfo( $att->post_title ?: $att->post_name, PATHINFO_FILENAME );
							$alt = str_replace( array( '-', '_' ), ' ', $alt );
						}
						if ( ! $alt ) {
							continue;
						}
						$alt = ucwords( $alt );
						if ( ! $dry ) {
							update_post_meta( $att->ID, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
						}
						$changes[] = array( 'id' => $att->ID, 'alt' => $alt, 'mode' => 'auto_from_' . $a['auto_from'] );
					}
				}

				return array( 'dry_run' => $dry, 'updated' => count( $changes ), 'changes' => $changes );
			},
		);

		// ============================================================
		// 5. REDIRECT MANAGER
		// ============================================================
		$reg['redirect_manager'] = array(
			'desc'     => 'Create / list / delete 301 redirects stored in the wpxmcp_redirects option (enforced via template_redirect). Pass action=create|list|delete. Use the SEO plugin\'s built-in redirect tools if available, this is a standalone fallback.',
			'risk'     => 'write',
			'schema'   => array(
				'action'    => array( 'type' => 'string', 'description' => 'create | list | delete. Default list.' ),
				'from'      => array( 'type' => 'string' ),
				'to'        => array( 'type' => 'string' ),
				'code'      => array( 'type' => 'integer', 'description' => 'HTTP code. Default 301.' ),
				'index'     => array( 'type' => 'integer', 'description' => 'For action=delete, 1-based index of stored redirect.' ),
			),
			'handler'  => function ( $a ) {
				$opt   = 'wpxmcp_redirects';
				$list  = get_option( $opt, array() );
				$act   = $a['action'] ?? 'list';

				if ( 'create' === $act ) {
					if ( empty( $a['from'] ) || empty( $a['to'] ) ) {
						throw new Exception( 'from and to are required for create.' );
					}
					$list[] = array(
						'from' => esc_url_raw( $a['from'] ),
						'to'   => esc_url_raw( $a['to'] ),
						'code' => (int) ( $a['code'] ?? 301 ),
						'at'   => current_time( 'mysql' ),
					);
					update_option( $opt, $list );
					return array( 'created' => true, 'count' => count( $list ) );
				}
				if ( 'delete' === $act ) {
					$idx = (int) ( $a['index'] ?? 0 ) - 1;
					if ( $idx < 0 || $idx >= count( $list ) ) {
						throw new Exception( 'index out of range.' );
					}
					array_splice( $list, $idx, 1 );
					update_option( $opt, $list );
					return array( 'deleted' => true, 'count' => count( $list ) );
				}
				return array( 'count' => count( $list ), 'redirects' => $list );
			},
		);

		// ============================================================
		// 6. SITEMAP REGENERATOR
		// ============================================================
		$reg['sitemap_regenerator'] = array(
			'desc'     => 'Force-flush / regenerate the XML sitemap. Supports Yoast, Rank Math, and WP core. For Yoast/RM this calls their internal cache-flush; for WP core it re-saves rewrites.',
			'risk'     => 'write',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				$plugin = WPXMCP_Tools_SEO::seo_plugin();
				$done = array();
				if ( 'yoast' === $plugin && class_exists( 'WPSEO_Sitemaps_Cache' ) ) {
					YoastSEO()->helpers->sitemap->cache->clear();
					$done[] = 'Yoast sitemap cache cleared.';
				} elseif ( 'rankmath' === $plugin && class_exists( '\\RankMath\\Sitemap\\Sitemap' ) ) {
					\RankMath\Sitemap\Sitemap::reset();
					$done[] = 'Rank Math sitemap reset.';
				} else {
					// WP core fallback.
					delete_transient( 'wp_sitemap_stylesheet' );
					$done[] = 'WP core sitemap transient cleared.';
				}
				flush_rewrite_rules( false );
				$done[] = 'rewrite rules flushed.';
				return array( 'regenerated' => true, 'provider' => $plugin, 'actions' => $done, 'sitemap_url' => home_url( '/sitemap_index.xml' ) );
			},
		);

		// ============================================================
		// 7. USER ROLE MANAGER
		// ============================================================
		$reg['user_role_manager'] = array(
			'desc'     => 'Inspect or change WP user roles and capabilities. action=list_roles / list_users / change_role / add_cap / remove_cap.',
			'risk'     => 'write',
			'schema'   => array(
				'action' => array( 'type' => 'string' ),
				'user_id'=> array( 'type' => 'integer' ),
				'role'   => array( 'type' => 'string' ),
				'cap'    => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				global $wp_roles;
				$act = $a['action'] ?? 'list_roles';

				if ( 'list_roles' === $act ) {
					return array( 'roles' => $wp_roles->roles );
				}
				if ( 'list_users' === $act ) {
					$users = get_users( array( 'number' => 50 ) );
					$out = array();
					foreach ( $users as $u ) {
						$out[] = array( 'id' => $u->ID, 'login' => $u->user_login, 'email' => $u->user_email, 'roles' => $u->roles );
					}
					return array( 'count' => count( $out ), 'users' => $out );
				}
				if ( 'change_role' === $act ) {
					$uid = (int) ( $a['user_id'] ?? 0 );
					$u = get_userdata( $uid );
					if ( ! $u ) {
						throw new Exception( 'User not found.' );
					}
					$u->set_role( $a['role'] );
					return array( 'changed' => true, 'user_id' => $uid, 'new_roles' => $u->roles );
				}
				if ( 'add_cap' === $act || 'remove_cap' === $act ) {
					$uid = (int) ( $a['user_id'] ?? 0 );
					$role_name = $a['role'] ?? '';
					$cap = $a['cap'] ?? '';
					if ( ! $role_name || ! $cap ) {
						throw new Exception( 'role and cap are required.' );
					}
					$role = get_role( $role_name );
					if ( ! $role ) {
						throw new Exception( 'Role not found.' );
					}
					if ( 'add_cap' === $act ) {
						$role->add_cap( $cap );
					} else {
						$role->remove_cap( $cap );
					}
					return array( 'ok' => true, 'role' => $role_name, 'cap' => $cap, 'action' => $act );
				}
				throw new Exception( 'Unknown action.' );
			},
		);

		// ============================================================
		// 8. COMMENT MODERATOR
		// ============================================================
		$reg['comment_moderator'] = array(
			'desc'     => 'Bulk moderate comments. action=approve|spam|trash|list with optional post_id / status / limit filters.',
			'risk'     => 'write',
			'schema'   => array(
				'action' => array( 'type' => 'string' ),
				'status' => array( 'type' => 'string', 'description' => 'hold | approve | spam | trash. Default hold for list.' ),
				'limit'  => array( 'type' => 'integer' ),
				'comment_ids' => array( 'type' => 'array' ),
			),
			'handler'  => function ( $a ) {
				$act = $a['action'] ?? 'list';
				if ( 'list' === $act ) {
					$cs = get_comments( array(
						'status' => $a['status'] ?? 'hold',
						'number' => min( (int) ( $a['limit'] ?? 50 ), 200 ),
					) );
					$out = array();
					foreach ( $cs as $c ) {
						$out[] = array(
							'id' => $c->comment_ID,
							'author' => $c->comment_author,
							'post_id' => $c->comment_post_ID,
							'date' => $c->comment_date,
							'excerpt' => wp_trim_words( $c->comment_content, 18 ),
						);
					}
					return array( 'count' => count( $out ), 'comments' => $out );
				}
				if ( empty( $a['comment_ids'] ) || ! is_array( $a['comment_ids'] ) ) {
					throw new Exception( 'comment_ids (array) is required for non-list actions.' );
				}
				$map = array( 'approve' => 'approve_comment', 'spam' => 'spam_comment', 'trash' => 'trash_comment' );
				if ( ! isset( $map[ $act ] ) ) {
					throw new Exception( 'Unknown action.' );
				}
				$fn = $map[ $act ];
				$ok = 0;
				foreach ( $a['comment_ids'] as $cid ) {
					if ( $fn( (int) $cid ) ) {
						$ok++;
					}
				}
				return array( 'action' => $act, 'ok' => $ok, 'requested' => count( $a['comment_ids'] ) );
			},
		);

		// ============================================================
		// 9. BACKUP CREATOR
		// ============================================================
		$reg['backup_creator'] = array(
			'desc'     => 'Create a downloadable SQL-dump-style backup artifact. scope=db dumps all core tables to a .sql file in wp-content/uploads; scope=manifest returns a JSON manifest of posts/users/options; scope=full = both. Returns path + size + checksum.',
			'risk'     => 'write',
			'schema'   => array(
				'scope' => array( 'type' => 'string', 'description' => 'db | manifest | full. Default db.' ),
			),
			'handler'  => function ( $a ) {
				$scope = $a['scope'] ?? 'db';
				$upload = wp_upload_dir();
				$dir = $upload['basedir'] . '/wpxmcp-backups';
				if ( ! is_dir( $dir ) ) {
					wp_mkdir_p( $dir );
				}
				$stamp = date( 'Ymd-His' );
				$out_files = array();

				if ( 'db' === $scope || 'full' === $scope ) {
					$file = $dir . "/db-{$stamp}.sql";
					$fh = fopen( $file, 'w' );
					global $wpdb;
					fwrite( $fh, "-- WP x MCP DB dump {$stamp}\n-- site: " . home_url() . "\n\n" );
					$tables = $wpdb->get_results( "SHOW TABLES", ARRAY_N );
					foreach ( $tables as $t ) {
						$tbl = $t[0];
						$create = $wpdb->get_row( "SHOW CREATE TABLE `$tbl`", ARRAY_N );
						fwrite( $fh, "DROP TABLE IF EXISTS `$tbl`;\n" . $create[1] . ";\n\n" );
						$rows = $wpdb->get_results( "SELECT * FROM `$tbl`", ARRAY_A );
						foreach ( $rows as $r ) {
							$vals = array_map( function ( $v ) use ( $wpdb ) {
								return is_null( $v ) ? 'NULL' : "'" . $wpdb->_real_escape( $v ) . "'";
							}, array_values( $r ) );
							fwrite( $fh, "INSERT INTO `$tbl` VALUES (" . implode( ',', $vals ) . ");\n" );
						}
					}
					fclose( $fh );
					$out_files[] = $file;
				}
				if ( 'manifest' === $scope || 'full' === $scope ) {
					$file = $dir . "/manifest-{$stamp}.json";
					$posts = get_posts( array( 'post_type' => 'any', 'post_status' => 'any', 'posts_per_page' => -1, 'fields' => 'ids' ) );
					$users = get_users( array( 'fields' => array( 'ID', 'user_login', 'user_email' ) ) );
					file_put_contents( $file, wp_json_encode( array(
						'site' => home_url(),
						'created' => current_time( 'mysql' ),
						'counts' => array( 'posts' => count( $posts ), 'users' => count( $users ) ),
						'options' => array_keys( wp_load_alloptions() ),
					), JSON_PRETTY_PRINT ) );
					$out_files[] = $file;
				}

				$rows = array();
				foreach ( $out_files as $f ) {
					$rows[] = array(
						'path' => $f,
						'size' => filesize( $f ),
						'md5'  => md5_file( $f ),
					);
				}
				return array( 'scope' => $scope, 'files' => $rows );
			},
		);

		// ============================================================
		// 10. MALWARE SCANNER
		// ============================================================
		$reg['malware_scanner'] = array(
			'desc'     => 'Signature-based PHP webshell / malware scan. Walks wp-content (and optionally the active theme + mu-plugins) looking for known patterns (eval/base64_decode/gzinflate/assert/exec/system/passthru/shell_exec/popen). Returns matches with file path + line. Heuristic — false positives possible.',
			'risk'     => 'read',
			'schema'   => array(
				'paths'  => array( 'type' => 'array', 'description' => 'Optional list of absolute paths to scan. Defaults to wp-content + active theme + mu-plugins.' ),
				'limit'  => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$paths = ! empty( $a['paths'] ) && is_array( $a['paths'] ) ? $a['paths'] : array(
					WP_CONTENT_DIR,
					get_template_directory(),
					WPMU_PLUGIN_DIR,
				);
				$patterns = array(
					'/(eval\s*\(\s*(base64_decode|gzinflate|gzuncompress|str_rot13|gzdecode|hex2bin)/i',
					'/(assert\s*\(\s*["\'].*?["\']\s*\)\s*;)/i',
					'/(passthru|shell_exec|system|exec|popen|proc_open)\s*\(\s*\$_(GET|POST|REQUEST)/i',
					'/(file_put_contents|fwrite)\s*\([^,]+,\s*\$_(GET|POST|REQUEST)/i',
					'/<\?php\s+@?\s*eval\s*\(/i',
				);
				$limit = (int) ( $a['limit'] ?? 200 );
				$hits = array();
				$iter = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $paths[0] ) );
				$count = 0;
				foreach ( $iter as $file ) {
					if ( $count >= $limit ) {
						break;
					}
					if ( $file->isDir() || pathinfo( $file, PATHINFO_EXTENSION ) !== 'php' ) {
						continue;
					}
					$content = @file_get_contents( $file->getPathname() );
					if ( ! $content || strlen( $content ) > 2 * 1024 * 1024 ) {
						continue;
					}
					foreach ( $patterns as $p ) {
						if ( preg_match_all( $p, $content, $m, PREG_OFFSET_CAPTURE ) ) {
							foreach ( $m[0] as $hit ) {
								$line = substr_count( substr( $content, 0, $hit[1] ), "\n" ) + 1;
								$hits[] = array(
									'file' => $file->getPathname(),
									'line' => $line,
									'snippet' => trim( substr( $content, max( 0, $hit[1] - 20 ), 80 ) ),
									'pattern' => $p,
								);
							}
						}
					}
					$count++;
				}
				return array( 'scanned' => $count, 'hits' => $hits, 'severity' => count( $hits ) > 0 ? 'review' : 'clean' );
			},
		);

		// ============================================================
		// 11. SPEED TEST INTEGRATOR
		// ============================================================
		$reg['speed_test_integrator'] = array(
			'desc'     => 'Pull a PageSpeed-style score for a given URL using the public Google PageSpeed Insights API (no key required, rate-limited). Returns performanceScore, FCP, LCP, CLS, TBT from the lab data. Set strategy=mobile|desktop. Returns "skipped" if the remote call fails.',
			'risk'     => 'read',
			'schema'   => array(
				'url'      => array( 'type' => 'string' ),
				'strategy' => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$strategy = ! empty( $a['strategy'] ) ? $a['strategy'] : 'mobile';
				$api = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' . rawurlencode( $url ) . '&strategy=' . $strategy;
				$resp = wp_remote_get( $api, array( 'timeout' => 30 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$body = json_decode( wp_remote_retrieve_body( $resp ), true );
				if ( empty( $body['lighthouseResult'] ) ) {
					return array( 'skipped' => true, 'reason' => 'No lighthouseResult in response.' );
				}
				$cats = $body['lighthouseResult']['categories'] ?? array();
				$audits = $body['lighthouseResult']['audits'] ?? array();
				return array(
					'url'      => $url,
					'strategy' => $strategy,
					'performance_score' => isset( $cats['performance']['score'] ) ? (int) round( $cats['performance']['score'] * 100 ) : null,
					'fcp'      => $audits['first-contentful-paint']['displayValue'] ?? null,
					'lcp'      => $audits['largest-contentful-paint']['displayValue'] ?? null,
					'cls'      => $audits['cumulative-layout-shift']['displayValue'] ?? null,
					'tbt'      => $audits['total-blocking-time']['displayValue'] ?? null,
				);
			},
		);

		// ============================================================
		// 12. KEYWORD DENSITY ANALYZER
		// ============================================================
		$reg['keyword_density_analyzer'] = array(
			'desc'     => 'Compute keyword / n-gram density for a single post or product. Returns top 25 terms with count, density %, and a flag if any are over-stuffed (>3%).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'top_n'   => array( 'type' => 'integer' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$tokens = self::tokens( $post->post_title . ' ' . wp_strip_all_tags( $post->post_content ) );
				$total  = max( 1, count( $tokens ) );
				$freq   = array_count_values( $tokens );
				arsort( $freq );
				$top_n  = (int) ( $a['top_n'] ?? 25 );
				$rows = array();
				$overstuffed = array();
				foreach ( array_slice( $freq, 0, $top_n, true ) as $term => $count ) {
					$density = round( ( $count / $total ) * 100, 2 );
					if ( $density > 3 ) {
						$overstuffed[] = $term;
					}
					$rows[] = array( 'term' => $term, 'count' => $count, 'density_pct' => $density );
				}
				return array( 'post_id' => $id, 'total_tokens' => $total, 'overstuffed' => $overstuffed, 'rows' => $rows );
			},
		);

		// ============================================================
		// 13. FEATURED SNIPPET OPTIMIZER
		// ============================================================
		$reg['featured_snippet_optimizer'] = array(
			'desc'     => 'Analyze a post and propose / insert snippet-shaped blocks (40-60 word definition, 3-step ordered list, comparison table, FAQ pair) for the target query. Pass apply=true to inject the chosen block at the top of the content.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer' ),
				'target_query' => array( 'type' => 'string' ),
				'block_type'   => array( 'type' => 'string', 'description' => 'definition | steps | table | faq. Default definition.' ),
				'definition'   => array( 'type' => 'string', 'description' => 'For block_type=definition, the 40-60 word answer.' ),
				'steps'        => array( 'type' => 'array' ),
				'rows'         => array( 'type' => 'array' ),
				'faq'          => array( 'type' => 'array' ),
				'apply'        => array( 'type' => 'boolean' ),
			),
			'required' => array( 'post_id', 'target_query' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$type = $a['block_type'] ?? 'definition';
				$block_html = '';
				switch ( $type ) {
					case 'definition':
						$text = $a['definition'] ?? ( $post->post_excerpt ?: mb_substr( wp_strip_all_tags( $post->post_content ), 0, 300 ) );
						$block_html = '<!-- wp:paragraph --><p><strong>' . esc_html( $a['target_query'] ) . ':</strong> ' . esc_html( $text ) . '</p><!-- /wp:paragraph -->';
						break;
					case 'steps':
						$steps = $a['steps'] ?? array();
						$items = '';
						foreach ( $steps as $i => $s ) {
							$items .= '<li>' . esc_html( $s ) . '</li>';
						}
						$block_html = '<!-- wp:list {"ordered":true} --><ol>' . $items . '</ol><!-- /wp:list -->';
						break;
					case 'table':
						$rows = $a['rows'] ?? array();
						$table = '<table class="wp-block-table"><thead><tr><th>Option</th><th>Notes</th></tr></thead><tbody>';
						foreach ( $rows as $r ) {
							$table .= '<tr><td>' . esc_html( $r[0] ?? '' ) . '</td><td>' . esc_html( $r[1] ?? '' ) . '</td></tr>';
						}
						$table .= '</tbody></table>';
						$block_html = '<!-- wp:table -->' . $table . '<!-- /wp:table -->';
						break;
					case 'faq':
						$faq = $a['faq'] ?? array( array( 'q' => $a['target_query'], 'a' => $a['definition'] ?? '' ) );
						$block_html = '<!-- wp:heading --><h2>FAQ</h2><!-- /wp:heading -->';
						foreach ( $faq as $f ) {
							$block_html .= '<!-- wp:heading {"level":3} --><h3>' . esc_html( $f['q'] ) . '</h3><!-- /wp:heading -->';
							$block_html .= '<!-- wp:paragraph --><p>' . esc_html( $f['a'] ) . '</p><!-- /wp:paragraph -->';
						}
						break;
				}
				$out = array( 'post_id' => $id, 'block_type' => $type, 'preview' => $block_html );
				if ( ! empty( $a['apply'] ) ) {
					$new = $block_html . "\n" . $post->post_content;
					wp_update_post( array( 'ID' => $id, 'post_content' => $new ) );
					$out['applied'] = true;
				}
				return $out;
			},
		);

		// ============================================================
		// 14. ENTITY DENSITY CHECKER
		// ============================================================
		$reg['entity_density_checker'] = array(
			'desc'     => 'Estimate named-entity coverage for a post. Pulls capitalized multi-word phrases and unique Proper-Noun tokens; returns counts and a "richness" score (entities per 100 words). Good proxy for E-E-A-T / GEO coverage.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$text = wp_strip_all_tags( $post->post_content );
				$words = str_word_count( $text, 1, '0..9' );
				$entities = array();
				// Bigrams of capitalized tokens.
				for ( $i = 0; $i < count( $words ) - 1; $i++ ) {
					if ( preg_match( '/^[A-Z][a-z]+/', $words[ $i ] ) && preg_match( '/^[A-Z][a-z]+/', $words[ $i + 1 ] ) ) {
						$key = $words[ $i ] . ' ' . $words[ $i + 1 ];
						$entities[ $key ] = ( $entities[ $key ] ?? 0 ) + 1;
					}
				}
				arsort( $entities );
				$top = array_slice( $entities, 0, 30, true );
				$total_entities = array_sum( $entities );
				$total_words    = max( 1, count( $words ) );
				$richness       = round( ( $total_entities / $total_words ) * 100, 2 );
				return array(
					'post_id'          => $id,
					'total_entities'   => $total_entities,
					'total_words'      => $total_words,
					'richness_per_100' => $richness,
					'top_entities'     => $top,
				);
			},
		);

		// ============================================================
		// 15. CONTENT FRESHNESS CHECKER
		// ============================================================
		$reg['content_freshness_checker'] = array(
			'desc'     => 'Scan published posts and flag stale ones based on last-modified date. buckets = fresh (<90d) | aging (90-365d) | stale (>365d). Useful for content-refresh campaigns.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 100 ), 500 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'orderby'        => 'modified',
					'order'          => 'ASC',
				) );
				$now = time();
				$fresh = $aging = $stale = array();
				foreach ( $posts as $p ) {
					$age_days = (int) round( ( $now - strtotime( $p->post_modified_gmt ) ) / DAY_IN_SECONDS );
					$row = array( 'id' => $p->ID, 'title' => $p->post_title, 'age_days' => $age_days, 'modified' => $p->post_modified );
					if ( $age_days > 365 ) {
						$stale[] = $row;
					} elseif ( $age_days > 90 ) {
						$aging[] = $row;
					} else {
						$fresh[] = $row;
					}
				}
				return array(
					'scanned' => count( $posts ),
					'fresh'   => $fresh,
					'aging'   => $aging,
					'stale'   => $stale,
				);
			},
		);

		// ============================================================
		// 16. INTERNAL LINK GAP FINDER
		// ============================================================
		$reg['internal_link_gap_finder'] = array(
			'desc'     => 'Find orphan / under-linked pages: posts that receive zero internal links from other published posts. Helps prioritize internal-linking passes.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 200 ), 1000 );
				$candidates = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => 'ids',
				) );
				$inbound = array_fill_keys( $candidates, 0 );
				$others = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => array( 'ID', 'post_content' ),
				) );
				foreach ( $others as $o ) {
					if ( ! preg_match_all( '/href=["\']([^"\']+)["\']/i', $o->post_content, $m ) ) {
						continue;
					}
					foreach ( $m[1] as $href ) {
						$id = url_to_postid( $href );
						if ( $id && isset( $inbound[ $id ] ) ) {
							$inbound[ $id ]++;
						}
					}
				}
				$orphans = array();
				foreach ( $inbound as $id => $count ) {
					if ( 0 === $count ) {
						$title = get_the_title( $id );
						$orphans[] = array( 'id' => $id, 'title' => $title, 'url' => get_permalink( $id ) );
					}
				}
				return array( 'scanned' => count( $candidates ), 'orphans' => $orphans );
			},
		);

		// ============================================================
		// 17. SCHEMA VALIDATOR
		// ============================================================
		$reg['schema_validator'] = array(
			'desc'     => 'Validate JSON-LD stored on a post (via wpxmcp tool seo_set_schema or SEO plugin). Returns parse status, @type, required-field checks for Article/Product/FAQPage/Organization. Heuristic — not a full schema.org validator.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$raw = get_post_meta( $id, '_wpxmcp_schema', true );
				$issues = array();
				if ( ! $raw ) {
					return array( 'post_id' => $id, 'has_schema' => false, 'issues' => array( 'No custom JSON-LD attached.' ) );
				}
				$decoded = json_decode( $raw, true );
				if ( null === $decoded ) {
					return array( 'post_id' => $id, 'has_schema' => true, 'parse_ok' => false, 'issues' => array( 'JSON parse error: ' . json_last_error_msg() ) );
				}
				$type = $decoded['@type'] ?? ( $decoded[0]['@type'] ?? null );
				if ( ! $type ) {
					$issues[] = 'Missing @type.';
				}
				if ( 'Article' === $type || 'BlogPosting' === $type ) {
					foreach ( array( 'headline', 'author', 'datePublished' ) as $req ) {
						if ( empty( $decoded[ $req ] ) ) {
							$issues[] = "Article missing '{$req}'.";
						}
					}
				}
				if ( 'Product' === $type ) {
					foreach ( array( 'name', 'image', 'description' ) as $req ) {
						if ( empty( $decoded[ $req ] ) ) {
							$issues[] = "Product missing '{$req}'.";
						}
					}
				}
				if ( 'FAQPage' === $type && empty( $decoded['mainEntity'] ) ) {
					$issues[] = "FAQPage missing 'mainEntity'.";
				}
				return array(
					'post_id'  => $id,
					'has_schema' => true,
					'parse_ok'   => true,
					'type'       => $type,
					'issues'     => $issues,
					'valid'      => empty( $issues ),
				);
			},
		);

		// ============================================================
		// 18. ROBOTS.TXT EDITOR
		// ============================================================
		$reg['robots_txt_editor'] = array(
			'desc'     => 'Read or replace the virtual robots.txt (action=read | set). Pass content to set; pass append_sitemap to auto-append a Sitemap: directive.',
			'risk'     => 'write',
			'schema'   => array(
				'action'         => array( 'type' => 'string' ),
				'content'        => array( 'type' => 'string' ),
				'append_sitemap' => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$act = $a['action'] ?? 'read';
				$opt = 'wpxmcp_robots_txt';
				if ( 'set' === $act ) {
					if ( empty( $a['content'] ) ) {
						throw new Exception( 'content is required for set.' );
					}
					$body = $a['content'];
					if ( ! empty( $a['append_sitemap'] ) && false === stripos( $body, 'sitemap:' ) ) {
						$body .= "\nSitemap: " . esc_url_raw( $a['append_sitemap'] ) . "\n";
					}
					update_option( $opt, $body );
					return array( 'set' => true, 'body' => $body );
				}
				$current = get_option( $opt, "User-agent: *\nDisallow:\n" );
				return array( 'body' => $current );
			},
		);

		// ============================================================
		// 19. LLMS.TXT MANAGER
		// ============================================================
		$reg['llms_txt_manager'] = array(
			'desc'     => 'Read, generate, or delete the llms.txt file used by AI crawlers. action=read | generate | delete. Generates a fresh file from the most recent posts / categories.',
			'risk'     => 'write',
			'schema'   => array(
				'action' => array( 'type' => 'string' ),
				'summary'=> array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$opt  = 'wpxmcp_llms_txt';
				$act  = $a['action'] ?? 'read';
				if ( 'delete' === $act ) {
					delete_option( $opt );
					return array( 'deleted' => true );
				}
				if ( 'generate' === $act ) {
					$name    = get_bloginfo( 'name' );
					$summary = $a['summary'] ?? get_bloginfo( 'description' );
					$body    = "# {$name}\n\n> {$summary}\n\n## Key pages\n";
					$cats = get_categories( array( 'number' => 20 ) );
					foreach ( $cats as $c ) {
						$body .= '- [' . $c->name . '](' . get_category_link( $c->term_id ) . ")\n";
					}
					update_option( $opt, $body );
					return array( 'generated' => true, 'url' => home_url( '/llms.txt' ), 'preview' => $body );
				}
				$current = get_option( $opt, '' );
				return array( 'body' => $current, 'url' => home_url( '/llms.txt' ) );
			},
		);

		// ============================================================
		// 20. CORE WEB VITALS AUDITOR
		// ============================================================
		$reg['core_web_vitals_auditor'] = array(
			'desc'     => 'Surface locally observable Core Web Vitals signals: largest image (LCP proxy), total above-the-fold image weight, script count, style count, render-blocking count. Pairs with speed_test_integrator for remote lab data.',
			'risk'     => 'read',
			'schema'   => array(
				'url' => array( 'type' => 'string', 'description' => 'Optional. Defaults to home.' ),
			),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 15 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				preg_match_all( '/<img[^>]+src=["\']([^"\']+)["\'][^>]*>/i', $html, $imgs );
				$lcp = null; $img_count = count( $imgs[1] ?? array() );
				if ( $img_count ) {
					$lcp = $imgs[1][0];
				}
				$render_blocking = preg_match_all( '/<link[^>]+rel=["\']stylesheet["\'][^>]*>/i', $html );
				$scripts = preg_match_all( '/<script[^>]+src=/i', $html );
				return array(
					'url' => $url,
					'images' => $img_count,
					'first_image' => $lcp,
					'render_blocking_css' => (int) $render_blocking,
					'scripts' => (int) $scripts,
				);
			},
		);

		// ============================================================
		// 21. MOBILE USABILITY CHECKER
		// ============================================================
		$reg['mobile_usability_checker'] = array(
			'desc'     => 'Fetch a URL and run cheap mobile-usability heuristics: viewport meta present, font-size hints, tap-target density (anchors > 200px wide counted), and inline-width styles. Heuristic — not a Lighthouse substitute.',
			'risk'     => 'read',
			'schema'   => array(
				'url' => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 15 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				$has_viewport = (bool) preg_match( '/<meta[^>]+name=["\']viewport["\'][^>]*width=device-width/i', $html );
				$has_font_responsive = (bool) preg_match( '/font-size\s*:\s*[^;]*v(w|h)\b/i', $html );
				$small_targets = preg_match_all( '/<a[^>]+style=["\'][^"\']*width\s*:\s*([0-9]+)px/i', $html, $m );
				$wide = 0;
				foreach ( ( $m[1] ?? array() ) as $w ) {
					if ( (int) $w < 48 ) {
						$wide++;
					}
				}
				return array(
					'url' => $url,
					'has_viewport' => $has_viewport,
					'responsive_font_size' => $has_font_responsive,
					'small_tap_targets' => $wide,
					'ok' => $has_viewport && 0 === $wide,
				);
			},
		);

		// ============================================================
		// 22. HREFLANG MANAGER
		// ============================================================
		$reg['hreflang_manager'] = array(
			'desc'     => 'Read or set hreflang links for a post. Pass hreflangs = [{lang, url}]. Stored in post meta _wpxmcp_hreflang and rendered in <head> on singular views.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'   => array( 'type' => 'integer' ),
				'hreflangs' => array( 'type' => 'array' ),
			),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$key = '_wpxmcp_hreflang';
				if ( empty( $a['hreflangs'] ) ) {
					$cur = get_post_meta( $id, $key, true );
					return array( 'hreflangs' => $cur ? json_decode( $cur, true ) : array() );
				}
				$clean = array();
				foreach ( $a['hreflangs'] as $row ) {
					if ( empty( $row['lang'] ) || empty( $row['url'] ) ) {
						continue;
					}
					$clean[] = array( 'lang' => sanitize_text_field( $row['lang'] ), 'url' => esc_url_raw( $row['url'] ) );
				}
				update_post_meta( $id, $key, wp_json_encode( $clean ) );
				return array( 'saved' => true, 'count' => count( $clean ) );
			},
		);

		// ============================================================
		// 23. CANONICAL URL MANAGER
		// ============================================================
		$reg['canonical_url_manager'] = array(
			'desc'     => 'Read or set the canonical URL for a post. Writes to Yoast/Rank Math meta when present, otherwise falls back to _wpxmcp_canonical.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer' ),
				'canonical'=> array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$keys = self::meta_keys();
				if ( empty( $a['canonical'] ) ) {
					return array(
						'post_id'   => $id,
						'canonical' => get_post_meta( $id, $keys['canonical'], true ) ?: get_permalink( $id ),
					);
				}
				$canon = esc_url_raw( $a['canonical'] );
				update_post_meta( $id, $keys['canonical'], $canon );
				return array( 'saved' => true, 'canonical' => $canon );
			},
		);

		// ============================================================
		// 24. DUPLICATE CONTENT FINDER
		// ============================================================
		$reg['duplicate_content_finder'] = array(
			'desc'     => 'Find near-duplicate posts by Jaccard similarity of word sets. Pass threshold (0-1, default 0.7). Pairs of (id_a, id_b, score).',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
				'threshold' => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit  = min( (int) ( $a['limit'] ?? 60 ), 200 );
				$th     = max( 0, min( 1, (int) ( $a['threshold'] ?? 70 ) / 100 ) );
				$posts  = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'post',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
				) );
				$sets = array();
				foreach ( $posts as $p ) {
					$tok = array_unique( self::tokens( wp_strip_all_tags( $p->post_content ) ) );
					$sets[ $p->ID ] = array( 'title' => $p->post_title, 'set' => array_flip( $tok ) );
				}
				$ids = array_keys( $sets );
				$dupes = array();
				for ( $i = 0; $i < count( $ids ); $i++ ) {
					for ( $j = $i + 1; $j < count( $ids ); $j++ ) {
						$ia = $ids[ $i ]; $ib = $ids[ $j ];
						$inter = count( array_intersect_key( $sets[ $ia ]['set'], $sets[ $ib ]['set'] ) );
						$union = count( $sets[ $ia ]['set'] ) + count( $sets[ $ib ]['set'] ) - $inter;
						$j_score = $union > 0 ? $inter / $union : 0;
						if ( $j_score >= $th ) {
							$dupes[] = array(
								'id_a' => $ia, 'title_a' => $sets[ $ia ]['title'],
								'id_b' => $ib, 'title_b' => $sets[ $ib ]['title'],
								'score' => round( $j_score, 3 ),
							);
						}
					}
				}
				usort( $dupes, function ( $x, $y ) {
					return $y['score'] <=> $x['score'];
				} );
				return array( 'scanned' => count( $posts ), 'threshold' => $th, 'pairs' => $dupes );
			},
		);

		// ============================================================
		// 25. SOCIAL META GENERATOR
		// ============================================================
		$reg['social_meta_generator'] = array(
			'desc'     => 'Set Open Graph + Twitter Card meta for a post. og_title, og_description, og_image (attachment id or URL), twitter_card (summary|summary_large_image). Writes to _wpxmcp_social and renders via wp_head.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'         => array( 'type' => 'integer' ),
				'og_title'        => array( 'type' => 'string' ),
				'og_description'  => array( 'type' => 'string' ),
				'og_image'        => array( 'type' => 'string', 'description' => 'URL or attachment ID.' ),
				'twitter_card'    => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$id = (int) $a['post_id'];
				$post = get_post( $id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$og_image = $a['og_image'] ?? '';
				if ( is_numeric( $og_image ) ) {
					$og_image = wp_get_attachment_url( (int) $og_image );
				}
				$payload = array(
					'og_title'       => $a['og_title'] ?? $post->post_title,
					'og_description' => $a['og_description'] ?? ( $post->post_excerpt ?: wp_trim_words( wp_strip_all_tags( $post->post_content ), 30 ) ),
					'og_image'       => $og_image,
					'twitter_card'   => $a['twitter_card'] ?? 'summary_large_image',
				);
				update_post_meta( $id, '_wpxmcp_social', wp_json_encode( $payload ) );
				return array( 'saved' => true, 'payload' => $payload );
			},
		);

		return $reg;
	}
}
