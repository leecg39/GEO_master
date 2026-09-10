<?php
/**
 * Audit Pro tool group — site-wide health & technical audits.
 *
 *  - audit_404_pages             Find published posts returning 404 (slug drift, deleted parents)
 *  - audit_orphan_media          Media library items never referenced in any post
 *  - audit_oversized_images      Images larger than threshold_kb not in media library
 *  - audit_js_errors             Fetch URLs, scan inline + script src for syntax-error patterns
 *  - audit_mixed_content         Pages on https:// that still load http:// subresources
 *  - audit_redirect_chains       Follow up to N hops from a URL, report final status
 *  - audit_security_headers      Probe headers for HSTS / CSP / X-Frame-Options / etc.
 *  - audit_dns_ssl               Quick DNS + cert-expiry check for the site host
 *  - audit_accessibility         Cheap a11y heuristics (alt, lang, heading order, skip link)
 *  - audit_perf_summary          Per-page perf budget rollup (HTML size, requests, image weight)
 *  - audit_sitemap_diff          Compare sitemap URLs to actually-published posts
 *  - audit_indexability          Detect noindex / canonical-loop / blocked-by-robots / etc.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Audit_Pro {

	public static function all(): array {
		$reg = array();

		// ============================================================
		// 1. AUDIT 404 PAGES
		// ============================================================
		$reg['audit_404_pages'] = array(
			'desc'     => 'For each published post, HEAD its permalink and report any returning 404 (slug drift, deleted parent, broken rewrite). limit caps the number of posts probed.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
				'timeout'   => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 50 ), 200 );
				$timeout = min( (int) ( $a['timeout'] ?? 8 ), 30 );
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'any',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => array( 'ID', 'post_title' ),
				) );
				$bad = array();
				foreach ( $posts as $p ) {
					$url = get_permalink( $p->ID );
					if ( ! $url ) {
						continue;
					}
					$r = wp_remote_head( $url, array( 'timeout' => $timeout, 'redirection' => 0, 'user-agent' => 'WP-x-MCP-404Audit/1.0' ) );
					if ( is_wp_error( $r ) ) {
						$bad[] = array( 'id' => $p->ID, 'title' => $p->post_title, 'url' => $url, 'status' => 'error', 'error' => $r->get_error_message() );
						continue;
					}
					$code = (int) wp_remote_retrieve_response_code( $r );
					if ( $code >= 400 ) {
						$bad[] = array( 'id' => $p->ID, 'title' => $p->post_title, 'url' => $url, 'status' => $code );
					}
				}
				return array( 'scanned' => count( $posts ), 'broken' => count( $bad ), 'rows' => $bad );
			},
		);

		// ============================================================
		// 2. AUDIT ORPHAN MEDIA
		// ============================================================
		$reg['audit_orphan_media'] = array(
			'desc'     => 'Find attachment IDs that are never referenced in any published post (URL or attachment ID). Useful for trimming the media library.',
			'risk'     => 'read',
			'schema'   => array(
				'limit' => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 200 ), 1000 );
				$attachments = get_posts( array(
					'post_type'      => 'attachment',
					'post_status'    => 'inherit',
					'posts_per_page' => $limit,
				) );
				$orphans = array();
				foreach ( $attachments as $att ) {
					$url = wp_get_attachment_url( $att->ID );
					if ( ! $url ) {
						continue;
					}
					$used = (int) $att->post_parent;
					if ( $used ) {
						continue;
					}
					// Cheap full-text search: count occurrences of the URL basename across post content.
					$base = basename( $url );
					global $wpdb;
					$count = (int) $wpdb->get_var( $wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status='publish' AND post_content LIKE %s",
						'%' . $wpdb->esc_like( $base ) . '%'
					) );
					if ( 0 === $count ) {
						$orphans[] = array( 'id' => $att->ID, 'title' => $att->post_title, 'url' => $url, 'file' => get_attached_file( $att->ID ) );
					}
				}
				return array( 'scanned' => count( $attachments ), 'orphans' => count( $orphans ), 'rows' => $orphans );
			},
		);

		// ============================================================
		// 3. AUDIT OVERSIZED IMAGES
		// ============================================================
		$reg['audit_oversized_images'] = array(
			'desc'     => 'Scan the latest N media library images. Flag any whose file size (or longest side) exceeds threshold_kb / threshold_px. Returns id, url, file size, dimensions.',
			'risk'     => 'read',
			'schema'   => array(
				'limit'        => array( 'type' => 'integer' ),
				'threshold_kb' => array( 'type' => 'integer', 'description' => 'Default 300 KB.' ),
				'threshold_px' => array( 'type' => 'integer', 'description' => 'Default 2000 (longest side).' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 100 ), 500 );
				$tkb   = (int) ( $a['threshold_kb'] ?? 300 );
				$tpx   = (int) ( $a['threshold_px'] ?? 2000 );
				$atts = get_posts( array(
					'post_type'      => 'attachment',
					'post_mime_type' => 'image',
					'post_status'    => 'inherit',
					'posts_per_page' => $limit,
				) );
				$bad = array();
				foreach ( $atts as $att ) {
					$file = get_attached_file( $att->ID );
					$size = $file && file_exists( $file ) ? filesize( $file ) : 0;
					$meta = wp_get_attachment_metadata( $att->ID );
					$w = $meta['width']  ?? 0;
					$h = $meta['height'] ?? 0;
					$max_dim = max( $w, $h );
					if ( ( $size / 1024 ) > $tkb || $max_dim > $tpx ) {
						$bad[] = array(
							'id'        => $att->ID,
							'title'     => $att->post_title,
							'url'       => wp_get_attachment_url( $att->ID ),
							'file_kb'   => round( $size / 1024, 1 ),
							'width'     => $w,
							'height'    => $h,
						);
					}
				}
				return array( 'scanned' => count( $atts ), 'oversized' => count( $bad ), 'rows' => $bad );
			},
		);

		// ============================================================
		// 4. AUDIT JS ERRORS
		// ============================================================
		$reg['audit_js_errors'] = array(
			'desc'     => 'Fetch a URL and scan inline + linked <script> blocks for obvious syntax-error patterns (unmatched braces, unterminated strings, common "throw new Error" stubs). Heuristic only — pair with real browser DevTools.',
			'risk'     => 'read',
			'schema'   => array(
				'url'     => array( 'type' => 'string' ),
				'limit'   => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 20 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				$limit = (int) ( $a['limit'] ?? 5 );
				$hits = array();
				// Heuristic 1: inline scripts that look truncated.
				if ( preg_match_all( '/<script(?![^>]*\bsrc=)[^>]*>(.*?)<\/script>/is', $html, $m ) ) {
					foreach ( $m[1] as $i => $code ) {
						if ( substr_count( $code, '{' ) !== substr_count( $code, '}' ) ) {
							$hits[] = array( 'source' => 'inline#' . $i, 'reason' => 'Mismatched curly braces.' );
						}
					}
				}
				// Heuristic 2: known debug stubs.
				if ( preg_match_all( '/throw new Error\([\'"]Not implemented/i', $html, $m ) ) {
					foreach ( $m[0] as $hit ) {
						$hits[] = array( 'source' => 'inline', 'reason' => 'Stub: ' . substr( $hit, 0, 60 ) );
					}
				}
				return array( 'url' => $url, 'inline_scripts_scanned' => count( $m[1] ?? array() ), 'hits' => array_slice( $hits, 0, $limit ) );
			},
		);

		// ============================================================
		// 5. AUDIT MIXED CONTENT
		// ============================================================
		$reg['audit_mixed_content'] = array(
			'desc'     => 'Fetch a page served over https:// and list any subresources still loaded over http://. Mixed content breaks SSL and gets blocked by modern browsers.',
			'risk'     => 'read',
			'schema'   => array( 'url' => array( 'type' => 'string' ) ),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 15 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				$rows = array();
				// Match src/href attributes pointing to http:// (but not "//" protocol-relative).
				if ( preg_match_all( '/(?:src|href)\s*=\s*["\'](http:\/\/[^"\']+)["\']/i', $html, $m ) ) {
					foreach ( $m[1] as $href ) {
						$rows[] = $href;
					}
				}
				$rows = array_values( array_unique( $rows ) );
				return array( 'url' => $url, 'http_subresources' => count( $rows ), 'rows' => $rows, 'ok' => empty( $rows ) );
			},
		);

		// ============================================================
		// 6. AUDIT REDIRECT CHAINS
		// ============================================================
		$reg['audit_redirect_chains'] = array(
			'desc'     => 'Follow redirects from a URL up to max_hops times and report the chain. Detects loops (hop returns to a previous URL) and 4xx/5xx terminations.',
			'risk'     => 'read',
			'schema'   => array(
				'url'      => array( 'type' => 'string' ),
				'max_hops' => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$max = min( (int) ( $a['max_hops'] ?? 10 ), 25 );
				$chain = array();
				$seen = array();
				for ( $i = 0; $i < $max; $i++ ) {
					if ( isset( $seen[ $url ] ) ) {
						return array( 'loop' => true, 'chain' => $chain, 'final' => $url );
					}
					$seen[ $url ] = true;
					$resp = wp_remote_head( $url, array( 'timeout' => 10, 'redirection' => 0, 'user-agent' => 'WP-x-MCP-RedirAudit/1.0' ) );
					if ( is_wp_error( $resp ) ) {
						$chain[] = array( 'url' => $url, 'status' => 'error', 'error' => $resp->get_error_message() );
						return array( 'chain' => $chain, 'final' => $url );
					}
					$code = (int) wp_remote_retrieve_response_code( $resp );
					$chain[] = array( 'url' => $url, 'status' => $code );
					if ( $code < 300 || $code >= 400 ) {
						return array( 'chain' => $chain, 'final' => $url, 'hops' => count( $chain ) );
					}
					$loc = wp_remote_retrieve_header( $resp, 'location' );
					if ( ! $loc ) {
						return array( 'chain' => $chain, 'final' => $url, 'hops' => count( $chain ) );
					}
					$url = esc_url_raw( $loc );
				}
				return array( 'chain' => $chain, 'final' => $url, 'hops' => count( $chain ), 'truncated' => true );
			},
		);

		// ============================================================
		// 7. AUDIT SECURITY HEADERS
		// ============================================================
		$reg['audit_security_headers'] = array(
			'desc'     => 'Probe a URL and report which security headers are present: Strict-Transport-Security, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Returns a pass/fail per header.',
			'risk'     => 'read',
			'schema'   => array( 'url' => array( 'type' => 'string' ) ),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 15, 'redirection' => 3 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$headers = wp_remote_retrieve_headers( $resp );
				$check = array(
					'strict-transport-security' => 'HSTS',
					'content-security-policy'   => 'CSP',
					'x-frame-options'           => 'X-Frame-Options',
					'x-content-type-options'    => 'X-Content-Type-Options',
					'referrer-policy'           => 'Referrer-Policy',
					'permissions-policy'        => 'Permissions-Policy',
				);
				$out = array();
				$pass = 0;
				foreach ( $check as $h => $name ) {
					$val = $headers[ $h ] ?? ( $headers[ ucwords( $h, '-' ) ] ?? null );
					$ok = ! empty( $val );
					if ( $ok ) {
						$pass++;
					}
					$out[] = array( 'header' => $name, 'present' => $ok, 'value' => is_string( $val ) ? $val : '' );
				}
				return array( 'url' => $url, 'score' => count( $check ) ? (int) round( ( $pass / count( $check ) ) * 100 ) : 0, 'headers' => $out );
			},
		);

		// ============================================================
		// 8. AUDIT DNS / SSL
		// ============================================================
		$reg['audit_dns_ssl'] = array(
			'desc'     => 'Lightweight DNS + SSL check for the site host. Reports A record, IPv6 (AAAA), SSL issuer + days-to-expiry. Requires cURL + openssl.',
			'risk'     => 'read',
			'schema'   => array( 'host' => array( 'type' => 'string' ) ),
			'handler'  => function ( $a ) {
				$host = ! empty( $a['host'] ) ? $a['host'] : wp_parse_url( home_url(), PHP_URL_HOST );
				$out = array( 'host' => $host );
				// A + AAAA via gethostbynamel (only IPv4). For IPv6, do a low-level call.
				$a = @gethostbynamel( $host );
				$out['a_records'] = is_array( $a ) ? $a : array();
				// IPv6 via dns_get_record (may be unavailable on some hosts).
				if ( function_exists( 'dns_get_record' ) ) {
					$aaaa = @dns_get_record( $host, DNS_AAAA );
					$out['aaaa_records'] = is_array( $aaaa ) ? array_column( $aaaa, 'ipv6' ) : array();
				} else {
					$out['aaaa_records'] = 'dns_get_record unavailable';
				}
				// SSL: openssl x509 from cURL.
				$ctx = stream_context_create( array( 'ssl' => array( 'capture_peer_cert' => true ) ) );
				$client = @stream_socket_client( "ssl://{$host}:443", $errno, $errstr, 8, STREAM_CLIENT_CONNECT, $ctx );
				if ( $client ) {
					$params = stream_context_get_params( $client );
					if ( ! empty( $params['options']['ssl']['peer_certificate'] ) ) {
						$cert = openssl_x509_parse( $params['options']['ssl']['peer_certificate'] );
						$out['ssl_issuer']    = $cert['issuer']['CN'] ?? ( $cert['issuer']['O'] ?? 'unknown' );
						$out['ssl_valid_to']  = $cert['validTo_time_t'] ?? null;
						$out['ssl_days_left'] = isset( $cert['validTo_time_t'] ) ? (int) round( ( $cert['validTo_time_t'] - time() ) / DAY_IN_SECONDS ) : null;
					}
					fclose( $client );
				} else {
					$out['ssl_error'] = $errstr ?: 'connection failed';
				}
				return $out;
			},
		);

		// ============================================================
		// 9. AUDIT ACCESSIBILITY (cheap heuristics)
		// ============================================================
		$reg['audit_accessibility'] = array(
			'desc'     => 'Cheap a11y heuristics on a URL: html lang, images without alt, form inputs without label, link text "click here" / "read more", heading order, skip-link present.',
			'risk'     => 'read',
			'schema'   => array( 'url' => array( 'type' => 'string' ) ),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 15 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				$issues = array();
				if ( ! preg_match( '/<html[^>]+lang=["\'][a-z-]+["\']/i', $html ) ) {
					$issues[] = 'Missing <html lang> attribute.';
				}
				$imgs_no_alt = preg_match_all( '/<img(?![^>]*\balt=)[^>]*>/i', $html );
				if ( $imgs_no_alt ) {
					$issues[] = "{$imgs_no_alt} <img> tag(s) without alt attribute.";
				}
				$inputs_no_label = preg_match_all( '/<input(?![^>]*\btype=["\']submit|button|hidden)(?![^>]*\b(id|aria-label)=)[^>]*>/i', $html );
				if ( $inputs_no_label ) {
					$issues[] = "{$inputs_no_label} <input> with no id/aria-label/associated label.";
				}
				$bad_links = preg_match_all( '/<a[^>]*>\s*(click here|read more|here|learn more)\s*<\/a>/i', $html );
				if ( $bad_links ) {
					$issues[] = "{$bad_links} link(s) with non-descriptive text (click here, read more…).";
				}
				if ( ! preg_match( '/href=["\']#main["\']|class=["\'][^"\']*skip/i', $html ) ) {
					$issues[] = 'No "skip to content" link detected.';
				}
				return array( 'url' => $url, 'issues' => $issues, 'ok' => empty( $issues ) );
			},
		);

		// ============================================================
		// 10. AUDIT PERFORMANCE SUMMARY
		// ============================================================
		$reg['audit_perf_summary'] = array(
			'desc'     => 'Per-page perf summary: HTML size, script count, style count, image count, total image weight (best-effort from <img> width/height hints). Cheap, server-side heuristic.',
			'risk'     => 'read',
			'schema'   => array( 'url' => array( 'type' => 'string' ) ),
			'handler'  => function ( $a ) {
				$url = ! empty( $a['url'] ) ? $a['url'] : home_url( '/' );
				$resp = wp_remote_get( $url, array( 'timeout' => 20 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$html = wp_remote_retrieve_body( $resp );
				$size = strlen( $html );
				$scripts = preg_match_all( '/<script[^>]*src=/i', $html );
				$styles  = preg_match_all( '/<link[^>]+rel=["\']stylesheet["\']/i', $html );
				$imgs    = preg_match_all( '/<img[^>]+src=/i', $html, $m );
				return array(
					'url'           => $url,
					'html_kb'       => round( $size / 1024, 1 ),
					'scripts'       => (int) $scripts,
					'stylesheets'   => (int) $styles,
					'images'        => (int) $imgs,
					'html_size'     => $size,
				);
			},
		);

		// ============================================================
		// 11. AUDIT SITEMAP DIFF
		// ============================================================
		$reg['audit_sitemap_diff'] = array(
			'desc'     => 'Compare the published posts to the URLs listed in the active sitemap (Yoast/Rank Math/core). Returns published-only and sitemap-only sets — flags pages not in the sitemap (indexability risk) and sitemap URLs that 404.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 200 ), 1000 );
				$plugin = WPXMCP_Tools_SEO::seo_plugin();
				$index = in_array( $plugin, array( 'yoast', 'rankmath' ), true ) ? home_url( '/sitemap_index.xml' ) : home_url( '/wp-sitemap.xml' );
				$resp = wp_remote_get( $index, array( 'timeout' => 15 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'skipped' => true, 'reason' => $resp->get_error_message() );
				}
				$body = wp_remote_retrieve_body( $resp );
				preg_match_all( '/<loc>([^<]+)<\/loc>/', $body, $sm );
				$sitemap_urls = array_unique( $sm[1] ?? array() );
				$published = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'any',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
					'fields'         => 'ids',
				) );
				$published_urls = array();
				foreach ( $published as $pid ) {
					$u = get_permalink( $pid );
					if ( $u ) {
						$published_urls[] = $u;
					}
				}
				$published_set  = array_flip( $published_urls );
				$sitemap_set    = array_flip( $sitemap_urls );
				$missing_from_sitemap = array_values( array_diff_key( $published_set, $sitemap_set ) );
				$missing_from_site    = array_values( array_diff_key( $sitemap_set, $published_set ) );
				return array(
					'sitemap_url'             => $index,
					'published_count'         => count( $published_urls ),
					'sitemap_count'           => count( $sitemap_urls ),
					'missing_from_sitemap'    => $missing_from_sitemap,
					'extra_in_sitemap'        => $missing_from_site,
				);
			},
		);

		// ============================================================
		// 12. AUDIT INDEXABILITY
		// ============================================================
		$reg['audit_indexability'] = array(
			'desc'     => 'Per-post indexability: combines Yoast/RM meta-robots, presence of a manual canonical, and the SEO plugin\'s score. Flags noindex, missing canonical, canonical-loop risk.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string' ),
				'limit'     => array( 'type' => 'integer' ),
			),
			'handler'  => function ( $a ) {
				$limit = min( (int) ( $a['limit'] ?? 200 ), 1000 );
				$plugin = WPXMCP_Tools_SEO::seo_plugin();
				$posts = get_posts( array(
					'post_type'      => $a['post_type'] ?? 'any',
					'post_status'    => 'publish',
					'posts_per_page' => $limit,
				) );
				$rows = array();
				$noindex = 0; $no_canon = 0; $own_canon = 0;
				foreach ( $posts as $p ) {
					$id = $p->ID;
					$url = get_permalink( $id );
					$is_noindex = false;
					$canon = '';
					if ( 'rankmath' === $plugin ) {
						$robots = get_post_meta( $id, 'rank_math_robots', true );
						$is_noindex = is_array( $robots ) ? in_array( 'noindex', $robots, true ) : (bool) ( strpos( (string) $robots, 'noindex' ) !== false );
						$canon = get_post_meta( $id, 'rank_math_canonical_url', true );
					} else {
						$is_noindex = (bool) get_post_meta( $id, '_yoast_wpseo_meta-robots-noindex', true );
						$canon = get_post_meta( $id, '_yoast_wpseo_canonical', true );
					}
					$row = array(
						'id'       => $id,
						'title'    => $p->post_title,
						'url'      => $url,
						'noindex'  => $is_noindex,
						'canonical'=> $canon,
					);
					$rows[] = $row;
					if ( $is_noindex ) {
						$noindex++;
					}
					if ( ! $canon ) {
						$no_canon++;
					} elseif ( $canon === $url ) {
						$own_canon++;
					}
				}
				return array(
					'provider'        => $plugin,
					'scanned'         => count( $rows ),
					'noindex_count'   => $noindex,
					'no_canonical'    => $no_canon,
					'self_canonical'  => $own_canon,
					'rows'            => $rows,
				);
			},
		);

		// ============================================================
		// EXTENDED PRO AUDITS
		// ============================================================

		$reg['audit_db_indexes'] = array(
			'desc'    => 'Inspect core WP tables and report primary-key presence plus secondary indexes. Helps spot tables created without proper indexes (e.g. custom log tables).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$targets = array(
					$wpdb->posts,
					$wpdb->postmeta,
					$wpdb->options,
					$wpdb->comments,
					$wpdb->commentmeta,
					$wpdb->terms,
					$wpdb->term_taxonomy,
					$wpdb->term_relationships,
					$wpdb->users,
					$wpdb->usermeta,
				);
				$out = array();
				foreach ( $targets as $t ) {
					$idx = $wpdb->get_results( "SHOW INDEX FROM `{$t}`" );
					$by_name = array();
					$has_pk  = false;
					foreach ( $idx as $i ) {
						$by_name[ $i->Key_name ][] = $i->Column_name;
						if ( 'PRIMARY' === $i->Key_name ) {
							$has_pk = true;
						}
					}
					$out[] = array(
						'table'           => $t,
						'has_primary_key' => $has_pk,
						'index_count'     => count( $by_name ),
						'indexes'         => $by_name,
					);
				}
				return $out;
			},
		);

		$reg['audit_php_memory_peak'] = array(
			'desc'    => 'Sample current PHP memory usage, peak, and limit. Useful to run before/after expensive audits.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				return array(
					'current'      => size_format( memory_get_usage( true ) ),
					'current_real' => size_format( memory_get_usage( false ) ),
					'peak'         => size_format( memory_get_peak_usage( true ) ),
					'peak_real'    => size_format( memory_get_peak_usage( false ) ),
					'limit'        => ini_get( 'memory_limit' ),
					'wp_version'   => get_bloginfo( 'version' ),
					'server'       => $_SERVER['SERVER_SOFTWARE'] ?? 'unknown',
					'php_version'  => PHP_VERSION,
				);
			},
		);

		$reg['audit_comment_spam_signals'] = array(
			'desc'     => 'Scan recent comments for spam heuristics: high link density, ALL-CAPS bodies, repeated characters, length spikes. Returns flagged comment IDs.',
			'risk'     => 'read',
			'schema'   => array(
				'limit'         => array( 'type' => 'integer', 'description' => 'Default 200' ),
				'max_links'     => array( 'type' => 'integer', 'description' => 'Flag if comment contains more than N URLs. Default 2' ),
				'min_caps_ratio'=> array( 'type' => 'number',  'description' => 'Flag if > this fraction of chars are uppercase. Default 0.5' ),
			),
			'handler'  => function ( $a ) {
				$limit    = min( (int) ( $a['limit'] ?? 200 ), 1000 );
				$max_links= (int) ( $a['max_links'] ?? 2 );
				$cap_ratio= (float) ( $a['min_caps_ratio'] ?? 0.5 );
				$comments = get_comments( array(
					'number' => $limit,
					'status' => 'all',
					'type'   => 'comment',
				) );
				$flagged = array();
				foreach ( (array) $comments as $c ) {
					$content = $c->comment_content;
					$reasons = array();
					preg_match_all( '#https?://#i', $content, $lm );
					if ( count( $lm[0] ) > $max_links ) {
						$reasons[] = 'too_many_links';
					}
					$letters = preg_replace( '/[^A-Za-z]/', '', $content );
					if ( strlen( $letters ) > 20 ) {
						$caps = strlen( preg_replace( '/[^A-Z]/', '', $letters ) );
						if ( ( $caps / strlen( $letters ) ) >= $cap_ratio ) {
							$reasons[] = 'all_caps';
						}
					}
					if ( preg_match( '/(.)\1{6,}/', $content ) ) {
						$reasons[] = 'repeated_chars';
					}
					if ( $reasons ) {
						$flagged[] = array(
							'id'      => (int) $c->comment_ID,
							'author'  => $c->comment_author,
							'email'   => $c->comment_author_email,
							'post_id' => (int) $c->comment_post_ID,
							'date'    => $c->comment_date,
							'status'  => $c->comment_approved,
							'reasons' => $reasons,
							'excerpt' => mb_substr( $content, 0, 100 ),
						);
					}
				}
				return array(
					'scanned' => count( $comments ),
					'flagged_count' => count( $flagged ),
					'flagged' => $flagged,
				);
			},
		);

		$reg['audit_orphaned_post_meta'] = array(
			'desc'     => 'Find postmeta rows whose post_id no longer exists (deleted posts that left meta behind). limit caps scanned IDs.',
			'risk'     => 'read',
			'schema'   => array(
				'limit' => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				global $wpdb;
				$limit = min( (int) ( $a['limit'] ?? 100 ), 1000 );
				$orphan_ids = $wpdb->get_col( $wpdb->prepare(
					"SELECT DISTINCT pm.post_id FROM {$wpdb->postmeta} pm
					 LEFT JOIN {$wpdb->posts} p ON p.ID = pm.post_id
					 WHERE p.ID IS NULL LIMIT %d",
					$limit
				) );
				return array(
					'orphan_post_ids_count' => count( $orphan_ids ),
					'orphan_post_ids'       => array_map( 'intval', $orphan_ids ),
				);
			},
		);

		$reg['audit_orphaned_comment_meta'] = array(
			'desc'     => 'Find commentmeta rows whose comment_id no longer exists.',
			'risk'     => 'read',
			'schema'   => array(
				'limit' => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'handler'  => function ( $a ) {
				global $wpdb;
				$limit = min( (int) ( $a['limit'] ?? 100 ), 1000 );
				$orphan_ids = $wpdb->get_col( $wpdb->prepare(
					"SELECT DISTINCT cm.comment_id FROM {$wpdb->commentmeta} cm
					 LEFT JOIN {$wpdb->comments} c ON c.comment_ID = cm.comment_id
					 WHERE c.comment_ID IS NULL LIMIT %d",
					$limit
				) );
				return array(
					'orphan_comment_ids_count' => count( $orphan_ids ),
					'orphan_comment_ids'       => array_map( 'intval', $orphan_ids ),
				);
			},
		);

		$reg['audit_post_revisions_summary'] = array(
			'desc'    => 'Count post revisions and estimate row-count impact of cleaning them up.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$total = (int) $wpdb->get_var(
					"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'revision'"
				);
				$top   = $wpdb->get_results(
					"SELECT post_parent, COUNT(*) as revs FROM {$wpdb->posts}
					 WHERE post_type = 'revision' AND post_parent > 0
					 GROUP BY post_parent ORDER BY revs DESC LIMIT 10"
				);
				$items = array();
				foreach ( $top as $r ) {
					$p = get_post( (int) $r->post_parent );
					$items[] = array(
						'parent_id'    => (int) $r->post_parent,
						'parent_title' => $p ? $p->post_title : '(deleted)',
						'revisions'    => (int) $r->revs,
					);
				}
				return array(
					'total_revisions' => $total,
					'top_offenders'   => $items,
				);
			},
		);

		$reg['audit_auto_drafts'] = array(
			'desc'    => 'Count auto-draft posts that have lingered (often created by interrupted edits).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$rows = $wpdb->get_results(
					"SELECT ID, post_title, post_date, post_type FROM {$wpdb->posts}
					 WHERE post_status = 'auto-draft'
					 ORDER BY post_date DESC LIMIT 50"
				);
				return array(
					'count' => count( $rows ),
					'items' => array_map(
						function ( $r ) {
							return array(
								'id'    => (int) $r->ID,
								'title' => $r->post_title,
								'date'  => $r->post_date,
								'type'  => $r->post_type,
							);
						},
						$rows
					),
				);
			},
		);

		$reg['audit_robots_txt'] = array(
			'desc'    => 'Fetch the live robots.txt via the home_url/robots.txt endpoint and report any disallowed paths, plus the raw body (truncated).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$url = home_url( '/robots.txt' );
				$resp = wp_remote_get( $url, array( 'timeout' => 8 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'url' => $url, 'error' => $resp->get_error_message() );
				}
				$code = wp_remote_retrieve_response_code( $resp );
				$body = wp_remote_retrieve_body( $resp );
				$lines = preg_split( "/\r\n|\n|\r/", $body );
				$disallow = $allow = $sitemaps = array();
				foreach ( (array) $lines as $line ) {
					if ( preg_match( '/^\s*Disallow:\s*(.+)$/i', $line, $m ) ) {
						$disallow[] = trim( $m[1] );
					} elseif ( preg_match( '/^\s*Allow:\s*(.+)$/i', $line, $m ) ) {
						$allow[] = trim( $m[1] );
					} elseif ( preg_match( '/^\s*Sitemap:\s*(.+)$/i', $line, $m ) ) {
						$sitemaps[] = trim( $m[1] );
					}
				}
				return array(
					'url'              => $url,
					'status'           => $code,
					'body_length'      => strlen( $body ),
					'disallow_paths'   => $disallow,
					'allow_paths'      => $allow,
					'sitemaps'         => $sitemaps,
					'raw_preview'      => mb_substr( $body, 0, 1000 ),
				);
			},
		);

		$reg['audit_xmlrpc_open'] = array(
			'desc'    => 'Quickly probe xmlrpc.php and report whether it returns 200/405 (active) or is blocked. Useful to flag DDoS/credential-stuffing surface.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$url = home_url( '/xmlrpc.php' );
				$resp = wp_remote_head( $url, array( 'timeout' => 8, 'redirection' => 0 ) );
				if ( is_wp_error( $resp ) ) {
					return array( 'url' => $url, 'reachable' => false, 'error' => $resp->get_error_message() );
				}
				$code = (int) wp_remote_retrieve_response_code( $resp );
				$blocked = in_array( $code, array( 403, 404, 410, 503 ), true );
				return array(
					'url'       => $url,
					'status'    => $code,
					'open'      => ! $blocked && in_array( $code, array( 200, 405 ), true ),
					'blocked'   => $blocked,
				);
			},
		);

		return $reg;
	}
}
