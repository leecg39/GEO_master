<?php
/**
 * Advanced tool group — the power tools.
 *
 *  - db_search_replace : serialized-safe find/replace across DB tables (dry-run by default)
 *  - diagnose_output   : find files emitting whitespace/BOM outside PHP tags
 *                        (the cause of "headers already sent" and broken XML sitemaps)
 *  - manage_cron       : inspect and clear WP-Cron events
 *  - db_optimize       : purge revisions / expired transients / spam, then OPTIMIZE TABLE
 *  - wc_sales_range    : WooCommerce revenue for an arbitrary date range (HPOS-safe)
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Advanced {

	/**
	 * Serialized-safe recursive string replace.
	 * Walks arrays/objects and re-serializes so serialized option/meta values
	 * (widgets, theme mods, Elementor data, etc.) stay valid after replacement.
	 */
	private static function deep_replace( $search, $replace, $data, int &$count ) {
		try {
			if ( is_string( $data ) && is_serialized( $data ) ) {
				$un = @unserialize( $data ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_unserialize
				if ( false !== $un || 'b:0;' === $data ) {
					return serialize( self::deep_replace( $search, $replace, $un, $count ) ); // phpcs:ignore
				}
			}
			if ( is_array( $data ) ) {
				$out = array();
				foreach ( $data as $k => $v ) {
					$out[ $k ] = self::deep_replace( $search, $replace, $v, $count );
				}
				return $out;
			}
			if ( is_object( $data ) ) {
				$out = clone $data;
				foreach ( get_object_vars( $data ) as $k => $v ) {
					$out->$k = self::deep_replace( $search, $replace, $v, $count );
				}
				return $out;
			}
			if ( is_string( $data ) && '' !== $search && false !== strpos( $data, $search ) ) {
				$count += substr_count( $data, $search );
				return str_replace( $search, $replace, $data );
			}
		} catch ( \Throwable $e ) {
			return $data; // never corrupt on error
		}
		return $data;
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// db_search_replace — safe migration-grade find/replace
		// ============================================================
		$reg['db_search_replace'] = array(
			'desc'     => 'Serialized-safe search & replace across database tables (great for fixing URLs after a migration or domain change). Walks serialized values so widgets/theme-mods/Elementor data stay valid. DRY-RUN BY DEFAULT — set dry_run=false to actually write. Defaults to the core content tables; pass tables[] to target specific ones.',
			'risk'     => 'destructive',
			'schema'   => array(
				'search'   => array( 'type' => 'string', 'description' => 'String to find (e.g. https://old-domain.com).' ),
				'replace'  => array( 'type' => 'string', 'description' => 'String to write in its place.' ),
				'tables'   => array( 'type' => 'array', 'description' => 'Specific tables (without prefix), e.g. ["posts","postmeta"]. Omit for the core content set.' ),
				'dry_run'  => array( 'type' => 'boolean', 'description' => 'Preview only. Default TRUE.' ),
				'max_rows' => array( 'type' => 'integer', 'description' => 'Safety cap on rows scanned per table. Default 50000.' ),
			),
			'required' => array( 'search', 'replace' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				if ( ! isset( $a['search'] ) || '' === (string) $a['search'] ) {
					throw new Exception( 'A non-empty "search" string is required.' );
				}
				$search  = (string) $a['search'];
				$replace = (string) ( $a['replace'] ?? '' );
				$dry     = array_key_exists( 'dry_run', $a ) ? (bool) $a['dry_run'] : true;
				$cap     = max( 1, (int) ( $a['max_rows'] ?? 50000 ) );

				if ( ! empty( $a['tables'] ) && is_array( $a['tables'] ) ) {
					$tables = array_map( function ( $t ) use ( $wpdb ) {
						$t = preg_replace( '/[^A-Za-z0-9_]/', '', (string) $t );
						return ( 0 === strpos( $t, $wpdb->prefix ) ) ? $t : $wpdb->prefix . $t;
					}, $a['tables'] );
				} else {
					$tables = array(
						$wpdb->posts, $wpdb->postmeta, $wpdb->options,
						$wpdb->comments, $wpdb->commentmeta, $wpdb->termmeta, $wpdb->usermeta,
					);
				}

				$report      = array();
				$grand_cells = 0;
				$grand_hits  = 0;

				foreach ( $tables as $table ) {
					// Resolve primary key + text columns.
					$cols = $wpdb->get_results( "SHOW COLUMNS FROM `{$table}`" ); // phpcs:ignore WordPress.DB
					if ( empty( $cols ) ) {
						continue;
					}
					$pk      = null;
					$textcol = array();
					foreach ( $cols as $c ) {
						if ( 'PRI' === $c->Key && null === $pk ) {
							$pk = $c->Field;
						}
						if ( preg_match( '/char|text|blob/i', $c->Type ) ) {
							$textcol[] = $c->Field;
						}
					}
					if ( null === $pk || empty( $textcol ) ) {
						continue;
					}

					$select = '`' . $pk . '`,`' . implode( '`,`', $textcol ) . '`';
					$rows   = $wpdb->get_results( "SELECT {$select} FROM `{$table}` LIMIT {$cap}", ARRAY_A ); // phpcs:ignore WordPress.DB
					$cells  = 0;
					$hits   = 0;
					$changed_rows = 0;

					foreach ( (array) $rows as $row ) {
						$updates = array();
						foreach ( $textcol as $col ) {
							if ( ! isset( $row[ $col ] ) || false === strpos( (string) $row[ $col ], $search ) && ! is_serialized( (string) $row[ $col ] ) ) {
								continue;
							}
							$before = (string) $row[ $col ];
							$local  = 0;
							$after  = self::deep_replace( $search, $replace, $before, $local );
							if ( $local > 0 && $after !== $before ) {
								$updates[ $col ] = $after;
								$hits          += $local;
								$cells++;
							}
						}
						if ( ! empty( $updates ) ) {
							$changed_rows++;
							if ( ! $dry ) {
								$wpdb->update( $table, $updates, array( $pk => $row[ $pk ] ) ); // phpcs:ignore WordPress.DB
							}
						}
					}

					$grand_cells += $cells;
					$grand_hits  += $hits;
					$report[]     = array(
						'table'         => $table,
						'rows_changed'  => $changed_rows,
						'cells_changed' => $cells,
						'replacements'  => $hits,
					);
				}

				return array(
					'dry_run'            => $dry,
					'search'             => $search,
					'replace'            => $replace,
					'total_replacements' => $grand_hits,
					'total_cells'        => $grand_cells,
					'tables'             => $report,
					'note'               => $dry ? 'Preview only — set dry_run=false to apply. Take a backup first.' : 'Applied. Flush caches if URLs changed.',
				);
			},
		);

		// ============================================================
		// diagnose_output — find stray output before headers / XML
		// ============================================================
		$reg['diagnose_output'] = array(
			'desc'    => 'Scan the files that load on every request (wp-config, mu-plugins, active plugin entry files, active theme + parent) for output emitted OUTSIDE the PHP tags: a UTF-8 BOM, whitespace before the opening <?php, or content after the final ?>. This is the usual cause of "headers already sent" warnings and broken XML sitemaps ("XML declaration allowed only at the start of the document").',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$targets = array();
				$root    = defined( 'ABSPATH' ) ? ABSPATH : '';

				// wp-config (root or one level up)
				foreach ( array( $root . 'wp-config.php', dirname( rtrim( $root, '/' ) ) . '/wp-config.php' ) as $cfg ) {
					if ( $cfg && is_readable( $cfg ) ) {
						$targets[] = $cfg;
						break;
					}
				}
				// mu-plugins
				foreach ( (array) glob( WP_CONTENT_DIR . '/mu-plugins/*.php' ) as $f ) {
					$targets[] = $f;
				}
				// active plugin entry files
				foreach ( (array) get_option( 'active_plugins', array() ) as $plugin ) {
					$f = WP_PLUGIN_DIR . '/' . $plugin;
					if ( is_readable( $f ) ) {
						$targets[] = $f;
					}
				}
				// active theme + parent functions.php
				foreach ( array( get_stylesheet_directory(), get_template_directory() ) as $dir ) {
					$f = $dir . '/functions.php';
					if ( is_readable( $f ) ) {
						$targets[] = $f;
					}
				}

				$issues = array();
				foreach ( array_unique( $targets ) as $file ) {
					$raw = @file_get_contents( $file );
					if ( false === $raw || '' === $raw ) {
						continue;
					}
					$rel  = str_replace( ABSPATH, '', $file );
					$file_issues = array();

					// UTF-8 BOM
					if ( "\xEF\xBB\xBF" === substr( $raw, 0, 3 ) ) {
						$file_issues[] = 'UTF-8 BOM at start of file';
					}
					// Whitespace / output before the opening PHP tag
					$pos = strpos( $raw, '<?php' );
					if ( false === $pos ) {
						$pos = strpos( $raw, '<?' );
					}
					if ( false !== $pos && $pos > 0 ) {
						$lead = substr( $raw, 0, $pos );
						$lead = preg_replace( '/^\xEF\xBB\xBF/', '', $lead );
						if ( '' !== $lead ) {
							$file_issues[] = 'Output before opening PHP tag (' . strlen( $lead ) . ' byte(s): ' . self::vis( $lead ) . ')';
						}
					}
					// Content after the final closing tag
					$last = strrpos( $raw, '?>' );
					if ( false !== $last ) {
						$trail = substr( $raw, $last + 2 );
						if ( '' !== trim( $trail, "\r\n\t " ) ) {
							$file_issues[] = 'Non-whitespace content after final ?>';
						} elseif ( '' !== $trail ) {
							$file_issues[] = 'Whitespace after final ?> (' . strlen( $trail ) . ' byte(s): ' . self::vis( $trail ) . ') — outputs on every load';
						}
					}

					if ( ! empty( $file_issues ) ) {
						$issues[] = array( 'file' => $rel, 'problems' => $file_issues );
					}
				}

				return array(
					'files_scanned' => count( array_unique( $targets ) ),
					'offenders'     => $issues,
					'verdict'       => empty( $issues )
						? 'No pre-output whitespace found in early-loading files. If a sitemap still breaks, the culprit may be a plugin file loaded conditionally — search those next.'
						: 'Remove the flagged whitespace/BOM. For PHP-only files the safe fix is to delete the closing ?> and any bytes after it.',
				);
			},
		);

		// ============================================================
		// manage_cron — inspect / clear WP-Cron events
		// ============================================================
		$reg['manage_cron'] = array(
			'desc'     => 'Inspect or clear WP-Cron events. action=list returns scheduled hooks with next-run times and schedules; action=clear removes ALL events for a given hook (useful for stuck or duplicated jobs).',
			'risk'     => 'write',
			'schema'   => array(
				'action' => array( 'type' => 'string', 'description' => 'list | clear' ),
				'hook'   => array( 'type' => 'string', 'description' => 'Hook name (required for clear).' ),
			),
			'handler'  => function ( $a ) {
				$action = $a['action'] ?? 'list';
				if ( 'clear' === $action ) {
					if ( empty( $a['hook'] ) ) {
						throw new Exception( 'A "hook" name is required to clear.' );
					}
					$removed = wp_clear_scheduled_hook( sanitize_text_field( $a['hook'] ) );
					return array( 'action' => 'clear', 'hook' => $a['hook'], 'events_removed' => (int) $removed );
				}

				$cron = _get_cron_array();
				$out  = array();
				if ( is_array( $cron ) ) {
					foreach ( $cron as $ts => $hooks ) {
						foreach ( (array) $hooks as $hook => $events ) {
							foreach ( (array) $events as $event ) {
								$out[] = array(
									'hook'      => $hook,
									'next_run'  => gmdate( 'Y-m-d H:i:s', $ts ) . ' UTC',
									'in'        => human_time_diff( time(), $ts ) . ( $ts < time() ? ' ago (overdue)' : '' ),
									'schedule'  => $event['schedule'] ?? 'one-time',
								);
							}
						}
					}
				}
				// Sort soonest first.
				usort( $out, function ( $x, $y ) { return strcmp( $x['next_run'], $y['next_run'] ); } );
				return array( 'action' => 'list', 'count' => count( $out ), 'events' => $out );
			},
		);

		// ============================================================
		// db_optimize — purge cruft + OPTIMIZE TABLE
		// ============================================================
		$reg['db_optimize'] = array(
			'desc'     => 'Reclaim database space: delete post revisions, auto-drafts and trashed posts, spam/trashed comments, and expired transients, then run OPTIMIZE TABLE. DRY-RUN BY DEFAULT — set dry_run=false to apply.',
			'risk'     => 'destructive',
			'schema'   => array(
				'dry_run'        => array( 'type' => 'boolean', 'description' => 'Preview counts only. Default TRUE.' ),
				'optimize_tables'=> array( 'type' => 'boolean', 'description' => 'Run OPTIMIZE TABLE on all tables. Default true.' ),
			),
			'handler'  => function ( $a ) {
				global $wpdb;
				$dry = array_key_exists( 'dry_run', $a ) ? (bool) $a['dry_run'] : true;

				$counts = array(
					'revisions'        => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='revision'" ),
					'auto_drafts'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status='auto-draft'" ),
					'trashed_posts'    => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status='trash'" ),
					'spam_comments'    => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_approved='spam'" ),
					'trashed_comments' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_approved='trash'" ),
					'expired_transients' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_timeout\_%' AND option_value < UNIX_TIMESTAMP()" ),
				);

				if ( ! $dry ) {
					// Revisions / auto-drafts / trashed posts (use WP API so meta & terms clean up too).
					foreach ( array(
						"SELECT ID FROM {$wpdb->posts} WHERE post_type='revision'",
						"SELECT ID FROM {$wpdb->posts} WHERE post_status='auto-draft'",
						"SELECT ID FROM {$wpdb->posts} WHERE post_status='trash'",
					) as $q ) {
						foreach ( (array) $wpdb->get_col( $q ) as $pid ) {
							wp_delete_post( (int) $pid, true );
						}
					}
					$wpdb->query( "DELETE FROM {$wpdb->comments} WHERE comment_approved IN ('spam','trash')" );
					// Expired transients (timeout + value rows).
					$wpdb->query( "DELETE a, b FROM {$wpdb->options} a JOIN {$wpdb->options} b ON b.option_name = REPLACE(a.option_name,'_transient_timeout_','_transient_') WHERE a.option_name LIKE '\_transient\_timeout\_%' AND a.option_value < UNIX_TIMESTAMP()" );

					if ( false !== ( $a['optimize_tables'] ?? true ) ) {
						$all = $wpdb->get_col( 'SHOW TABLES' );
						foreach ( (array) $all as $t ) {
							$wpdb->query( "OPTIMIZE TABLE `{$t}`" ); // phpcs:ignore WordPress.DB
						}
					}
				}

				return array(
					'dry_run'   => $dry,
					'found'     => $counts,
					'cleaned'   => $dry ? 'nothing (preview)' : 'revisions, auto-drafts, trashed posts, spam/trash comments, expired transients',
					'optimized' => $dry ? false : (bool) ( $a['optimize_tables'] ?? true ),
				);
			},
		);

		// ============================================================
		// wc_sales_range — revenue for an arbitrary date range
		// ============================================================
		$reg['wc_sales_range'] = array(
			'desc'     => 'WooCommerce revenue for a date range. Returns gross revenue, order count, average order value, and items sold for paid orders (processing/completed/on-hold by default). Dates as YYYY-MM-DD.',
			'risk'     => 'read',
			'schema'   => array(
				'from'     => array( 'type' => 'string', 'description' => 'Start date YYYY-MM-DD.' ),
				'to'       => array( 'type' => 'string', 'description' => 'End date YYYY-MM-DD (inclusive).' ),
				'statuses' => array( 'type' => 'array', 'description' => 'Order statuses to include. Default: processing, completed, on-hold.' ),
			),
			'required' => array( 'from', 'to' ),
			'handler'  => function ( $a ) {
				if ( ! function_exists( 'wc_get_orders' ) ) {
					throw new Exception( 'WooCommerce is not active on this site.' );
				}
				$statuses = ! empty( $a['statuses'] ) && is_array( $a['statuses'] )
					? array_map( 'sanitize_title', $a['statuses'] )
					: array( 'processing', 'completed', 'on-hold' );

				$orders = wc_get_orders( array(
					'limit'        => -1,
					'status'       => $statuses,
					'date_created' => sanitize_text_field( $a['from'] ) . '...' . sanitize_text_field( $a['to'] ),
					'return'       => 'objects',
				) );

				$revenue = 0.0;
				$items   = 0;
				$n       = 0;
				foreach ( (array) $orders as $o ) {
					$n++;
					$revenue += (float) $o->get_total();
					$items   += (int) $o->get_item_count();
				}

				return array(
					'from'            => $a['from'],
					'to'              => $a['to'],
					'statuses'        => $statuses,
					'order_count'     => $n,
					'gross_revenue'   => round( $revenue, 2 ),
					'items_sold'      => $items,
					'avg_order_value' => $n ? round( $revenue / $n, 2 ) : 0,
					'currency'        => get_woocommerce_currency(),
				);
			},
		);

		return $reg;
	}

	/** Render whitespace bytes visibly for diagnostics. */
	private static function vis( string $s ): string {
		return str_replace(
			array( "\r", "\n", "\t", ' ', "\xEF\xBB\xBF" ),
			array( '\\r', '\\n', '\\t', '·', '[BOM]' ),
			$s
		);
	}
}
