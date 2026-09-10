<?php
/**
 * Site Pro tool group — advanced plugin / theme / cron management.
 *
 * Tools (all prefixed slug-agnostically for easy discovery):
 *  - search_wp_plugin             Search WordPress.org for a plugin by query.
 *  - search_wp_theme              Search WordPress.org for a theme by query.
 *  - install_wp_plugin            Download + install a plugin from WordPress.org (optionally activate).
 *  - install_wp_theme             Download + install a theme from WordPress.org (optionally activate).
 *  - delete_plugin                Delete an installed plugin (deactivate first if active).
 *  - delete_theme                 Delete an installed theme (refuses to delete the active one).
 *  - toggle_plugin_auto_update    Enable / disable WP auto-updates for a single plugin.
 *  - toggle_theme_auto_update     Enable / disable WP auto-updates for a single theme.
 *  - rollback_plugin              Roll a plugin back to a previous version (downgrade via WP.org).
 *  - bulk_activate_plugins        Activate many plugins in one call.
 *  - bulk_deactivate_plugins      Deactivate many plugins in one call.
 *  - list_cron_jobs               List all scheduled WP-Cron events with next-run + args.
 *  - run_cron_event               Manually fire a cron hook by hook name (with optional args).
 *  - delete_cron_event            Unschedule a cron hook (single or all recurrences).
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Site_Pro {

	/**
	 * Ensure WP plugin admin APIs are loaded.
	 */
	private static function load_plugin_api(): void {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		if ( ! function_exists( 'plugins_api' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
		}
	}

	/**
	 * Ensure WP theme admin APIs are loaded.
	 */
	private static function load_theme_api(): void {
		if ( ! function_exists( 'wp_get_themes' ) ) {
			require_once ABSPATH . 'wp-admin/includes/theme.php';
		}
		if ( ! function_exists( 'themes_api' ) ) {
			require_once ABSPATH . 'wp-admin/includes/theme-install.php';
		}
	}

	/**
	 * Ensure the upgrader classes are loaded.
	 */
	private static function load_upgrader(): void {
		if ( ! class_exists( 'WP_Upgrader' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		}
		if ( ! class_exists( 'Plugin_Upgrader' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-plugin-upgrader.php';
		}
		if ( ! class_exists( 'Theme_Upgrader' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-theme-upgrader.php';
		}
		if ( ! class_exists( 'WP_Ajax_Upgrader_Skin' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-ajax-upgrader-skin.php';
		}
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// 1. SEARCH WP PLUGIN
		// ============================================================
		$reg['search_wp_plugin'] = array(
			'desc'     => 'Search the WordPress.org plugin directory by keyword. Returns slug, name, version, rating, downloads, and a short description for each hit. Use the slug with install_wp_plugin.',
			'risk'     => 'read',
			'schema'   => array(
				'query'      => array( 'type' => 'string' ),
				'per_page'   => array( 'type' => 'integer', 'description' => '1-30, default 10.' ),
				'page'       => array( 'type' => 'integer' ),
			),
			'required' => array( 'query' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				$per_page = min( max( 1, (int) ( $a['per_page'] ?? 10 ) ), 30 );
				$api = plugins_api( 'query_plugins', array(
					'search'   => $a['query'],
					'per_page' => $per_page,
					'page'     => max( 1, (int) ( $a['page'] ?? 1 ) ),
					'fields'   => array(
						'short_description' => true,
						'sections'          => false,
						'description'       => false,
						'tested'            => true,
						'requires'          => true,
						'rating'            => true,
						'ratings'           => false,
						'downloaded'        => true,
						'downloadlink'      => false,
						'last_updated'      => true,
						'added'             => false,
						'tags'              => false,
						'homepage'          => false,
						'num_ratings'       => true,
						'slug'              => true,
						'icons'             => true,
					),
				) );
				if ( is_wp_error( $api ) ) {
					throw new Exception( $api->get_error_message() );
				}
				$out = array();
				foreach ( (array) ( $api->plugins ?? array() ) as $p ) {
					$out[] = array(
						'slug'              => $p['slug'] ?? '',
						'name'              => $p['name'] ?? '',
						'version'           => $p['version'] ?? '',
						'rating'            => isset( $p['rating'] ) ? (float) $p['rating'] : null,
						'num_ratings'       => $p['num_ratings'] ?? null,
						'active_installs'   => $p['active_installs'] ?? null,
						'downloaded'        => $p['downloaded'] ?? null,
						'last_updated'      => $p['last_updated'] ?? null,
						'short_description' => wp_strip_all_tags( $p['short_description'] ?? '' ),
					);
				}
				return array( 'count' => count( $out ), 'plugins' => $out, 'info' => array( 'page' => $api->info['page'] ?? 1, 'pages' => $api->info['pages'] ?? 1 ) );
			},
		);

		// ============================================================
		// 2. SEARCH WP THEME
		// ============================================================
		$reg['search_wp_theme'] = array(
			'desc'     => 'Search the WordPress.org theme directory by keyword. Returns slug, name, version, rating, downloads, screenshot URL.',
			'risk'     => 'read',
			'schema'   => array(
				'query'    => array( 'type' => 'string' ),
				'per_page' => array( 'type' => 'integer' ),
				'page'     => array( 'type' => 'integer' ),
			),
			'required' => array( 'query' ),
			'handler'  => function ( $a ) {
				self::load_theme_api();
				$per_page = min( max( 1, (int) ( $a['per_page'] ?? 10 ) ), 30 );
				$api = themes_api( 'query_themes', array(
					'search'   => $a['query'],
					'per_page' => $per_page,
					'page'     => max( 1, (int) ( $a['page'] ?? 1 ) ),
					'fields'   => array(
						'description'  => false,
						'sections'     => false,
						'tested'       => true,
						'requires'     => true,
						'rating'       => true,
						'ratings'      => false,
						'downloaded'   => true,
						'downloadlink' => false,
						'last_updated' => true,
						'homepage'     => false,
						'num_ratings'  => true,
						'screenshot_url' => true,
					),
				) );
				if ( is_wp_error( $api ) ) {
					throw new Exception( $api->get_error_message() );
				}
				$out = array();
				foreach ( (array) ( $api->themes ?? array() ) as $t ) {
					$out[] = array(
						'slug'         => $t->slug ?? '',
						'name'         => $t->name ?? '',
						'version'      => $t->version ?? '',
						'rating'       => isset( $t->rating ) ? (float) $t->rating : null,
						'num_ratings'  => $t->num_ratings ?? null,
						'downloaded'   => $t->downloaded ?? null,
						'last_updated' => $t->last_updated ?? null,
						'screenshot'   => $t->screenshot_url ?? '',
					);
				}
				return array( 'count' => count( $out ), 'themes' => $out );
			},
		);

		// ============================================================
		// 3. INSTALL WP PLUGIN
		// ============================================================
		$reg['install_wp_plugin'] = array(
			'desc'     => 'Download and install a plugin from WordPress.org by slug. Set activate=true to also activate it. Returns the installed plugin file (slug/slug.php or similar) on success.',
			'risk'     => 'write',
			'schema'   => array(
				'slug'     => array( 'type' => 'string' ),
				'activate' => array( 'type' => 'boolean', 'description' => 'Default false.' ),
			),
			'required' => array( 'slug' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				self::load_upgrader();
				$slug = sanitize_key( $a['slug'] );
				$api  = plugins_api( 'plugin_information', array( 'slug' => $slug, 'fields' => array( 'sections' => false ) ) );
				if ( is_wp_error( $api ) ) {
					throw new Exception( 'Plugin not found on WordPress.org: ' . $api->get_error_message() );
				}
				$skin     = new WP_Ajax_Upgrader_Skin();
				$upgrader = new Plugin_Upgrader( $skin );
				$result   = $upgrader->install( $api->download_link );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Install failed: ' . $upgrader->skin->get_error_messages() );
				}
				// Detect the installed plugin file.
				$installed_file = $upgrader->plugin_info();
				if ( ! empty( $a['activate'] ) && $installed_file ) {
					$act = activate_plugin( $installed_file );
					if ( is_wp_error( $act ) ) {
						throw new Exception( 'Installed but failed to activate: ' . $act->get_error_message() );
					}
				}
				return array(
					'slug'            => $slug,
					'plugin_file'     => $installed_file,
					'installed'       => true,
					'activated'       => ! empty( $a['activate'] ),
				);
			},
		);

		// ============================================================
		// 4. INSTALL WP THEME
		// ============================================================
		$reg['install_wp_theme'] = array(
			'desc'     => 'Download and install a theme from WordPress.org by slug. Set activate=true to switch the active theme.',
			'risk'     => 'write',
			'schema'   => array(
				'slug'     => array( 'type' => 'string' ),
				'activate' => array( 'type' => 'boolean' ),
			),
			'required' => array( 'slug' ),
			'handler'  => function ( $a ) {
				self::load_theme_api();
				self::load_upgrader();
				$slug = sanitize_key( $a['slug'] );
				$api  = themes_api( 'theme_information', array( 'slug' => $slug, 'fields' => array( 'sections' => false ) ) );
				if ( is_wp_error( $api ) ) {
					throw new Exception( 'Theme not found: ' . $api->get_error_message() );
				}
				$skin     = new WP_Ajax_Upgrader_Skin();
				$upgrader = new Theme_Upgrader( $skin );
				$result   = $upgrader->install( $api->download_link );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Install failed: ' . $upgrader->skin->get_error_messages() );
				}
				$activated = false;
				if ( ! empty( $a['activate'] ) ) {
					switch_theme( $slug );
					$activated = true;
				}
				return array( 'slug' => $slug, 'installed' => true, 'activated' => $activated );
			},
		);

		// ============================================================
		// 5. DELETE PLUGIN
		// ============================================================
		$reg['delete_plugin'] = array(
			'desc'     => 'Delete an installed plugin. Deactivates first if currently active. Pass the plugin file path (e.g. akismet/akismet.php) — list_plugins returns the file for each entry.',
			'risk'     => 'destructive',
			'schema'   => array(
				'plugin' => array( 'type' => 'string' ),
			),
			'required' => array( 'plugin' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				$plugin = $a['plugin'];
				if ( is_plugin_active( $plugin ) ) {
					deactivate_plugins( array( $plugin ) );
				}
				$deleted = delete_plugins( array( $plugin ) );
				if ( is_wp_error( $deleted ) ) {
					throw new Exception( $deleted->get_error_message() );
				}
				return array( 'plugin' => $plugin, 'deleted' => (bool) $deleted );
			},
		);

		// ============================================================
		// 6. DELETE THEME
		// ============================================================
		$reg['delete_theme'] = array(
			'desc'     => 'Delete an installed theme by slug. Refuses to delete the currently active theme (or its parent).',
			'risk'     => 'destructive',
			'schema'   => array(
				'slug' => array( 'type' => 'string' ),
			),
			'required' => array( 'slug' ),
			'handler'  => function ( $a ) {
				self::load_theme_api();
				$slug = sanitize_key( $a['slug'] );
				$current = get_stylesheet();
				$current_parent = get_template();
				if ( $slug === $current || $slug === $current_parent ) {
					throw new Exception( 'Cannot delete the active theme or its parent. Switch themes first.' );
				}
				$res = delete_theme( $slug );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				if ( false === $res ) {
					throw new Exception( 'Theme deletion failed (check filesystem permissions on wp-content/themes).' );
				}
				return array( 'slug' => $slug, 'deleted' => true );
			},
		);

		// ============================================================
		// 7. TOGGLE PLUGIN AUTO-UPDATE
		// ============================================================
		$reg['toggle_plugin_auto_update'] = array(
			'desc'     => 'Enable or disable WordPress auto-updates for a single plugin (plugin file path). enable=true turns it on, false turns it off. List-managed via the auto_update_plugins option.',
			'risk'     => 'write',
			'schema'   => array(
				'plugin' => array( 'type' => 'string' ),
				'enable' => array( 'type' => 'boolean' ),
			),
			'required' => array( 'plugin', 'enable' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				$plugin = $a['plugin'];
				$list   = (array) get_site_option( 'auto_update_plugins', array() );
				if ( $a['enable'] ) {
					$list = array_values( array_unique( array_merge( $list, array( $plugin ) ) ) );
				} else {
					$list = array_values( array_diff( $list, array( $plugin ) ) );
				}
				update_site_option( 'auto_update_plugins', $list );
				return array( 'plugin' => $plugin, 'auto_update_enabled' => (bool) $a['enable'], 'list' => $list );
			},
		);

		// ============================================================
		// 8. TOGGLE THEME AUTO-UPDATE
		// ============================================================
		$reg['toggle_theme_auto_update'] = array(
			'desc'     => 'Enable or disable WordPress auto-updates for a single theme (slug).',
			'risk'     => 'write',
			'schema'   => array(
				'slug'   => array( 'type' => 'string' ),
				'enable' => array( 'type' => 'boolean' ),
			),
			'required' => array( 'slug', 'enable' ),
			'handler'  => function ( $a ) {
				$slug = sanitize_key( $a['slug'] );
				$list = (array) get_site_option( 'auto_update_themes', array() );
				if ( $a['enable'] ) {
					$list = array_values( array_unique( array_merge( $list, array( $slug ) ) ) );
				} else {
					$list = array_values( array_diff( $list, array( $slug ) ) );
				}
				update_site_option( 'auto_update_themes', $list );
				return array( 'slug' => $slug, 'auto_update_enabled' => (bool) $a['enable'], 'list' => $list );
			},
		);

		// ============================================================
		// 9. ROLLBACK PLUGIN
		// ============================================================
		$reg['rollback_plugin'] = array(
			'desc'     => 'Roll a plugin back to a previous version. Pass the plugin file and target version (must exist on WordPress.org). Backs up the current version into the WP upgrader temp dir first.',
			'risk'     => 'write',
			'schema'   => array(
				'plugin'  => array( 'type' => 'string' ),
				'version' => array( 'type' => 'string' ),
			),
			'required' => array( 'plugin', 'version' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				self::load_upgrader();
				$plugin  = $a['plugin'];
				$version = $a['version'];
				// Use the WP.org plugin_information endpoint to fetch the chosen version's download URL.
				$slug    = explode( '/', $plugin )[0];
				$api     = plugins_api( 'plugin_information', array( 'slug' => $slug, 'fields' => array( 'versions' => true, 'sections' => false ) ) );
				if ( is_wp_error( $api ) ) {
					throw new Exception( $api->get_error_message() );
				}
				if ( empty( $api->versions[ $version ] ) ) {
					throw new Exception( "Version {$version} not available on WordPress.org for {$slug}." );
				}
				$skin     = new WP_Ajax_Upgrader_Skin();
				$upgrader = new Plugin_Upgrader( $skin );
				$result   = $upgrader->upgrade( $plugin, array( 'package' => $api->versions[ $version ] ) );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array( 'plugin' => $plugin, 'rolled_back_to' => $version, 'ok' => (bool) $result );
			},
		);

		// ============================================================
		// 10. BULK ACTIVATE PLUGINS
		// ============================================================
		$reg['bulk_activate_plugins'] = array(
			'desc'     => 'Activate many plugins in one call. Pass plugins = ["slug1/slug1.php","slug2/slug2.php"]. Stops on first fatal and reports the partial state.',
			'risk'     => 'write',
			'schema'   => array(
				'plugins' => array( 'type' => 'array' ),
			),
			'required' => array( 'plugins' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				$ok = array(); $err = array();
				foreach ( (array) $a['plugins'] as $p ) {
					$res = activate_plugin( $p );
					if ( is_wp_error( $res ) ) {
						$err[] = array( 'plugin' => $p, 'error' => $res->get_error_message() );
					} else {
						$ok[] = $p;
					}
				}
				return array( 'activated' => $ok, 'errors' => $err );
			},
		);

		// ============================================================
		// 11. BULK DEACTIVATE PLUGINS
		// ============================================================
		$reg['bulk_deactivate_plugins'] = array(
			'desc'     => 'Deactivate many plugins in one call. Useful before swapping a stack or troubleshooting conflicts.',
			'risk'     => 'write',
			'schema'   => array(
				'plugins' => array( 'type' => 'array' ),
			),
			'required' => array( 'plugins' ),
			'handler'  => function ( $a ) {
				self::load_plugin_api();
				deactivate_plugins( (array) $a['plugins'] );
				return array( 'deactivated' => (array) $a['plugins'] );
			},
		);

		// ============================================================
		// 12. LIST CRON JOBS
		// ============================================================
		$reg['list_cron_jobs'] = array(
			'desc'     => 'List all scheduled WP-Cron events. Returns hook, timestamp (next run), schedule, and args. Useful for finding what schedules wp-cron is sitting on.',
			'risk'     => 'read',
			'schema'   => array(
				'hook' => array( 'type' => 'string', 'description' => 'Optional. Filter to one hook name.' ),
			),
			'handler'  => function ( $a ) {
				$crons = _get_cron_array();
				$out = array();
				if ( ! is_array( $crons ) ) {
					return array( 'count' => 0, 'jobs' => array() );
				}
				ksort( $crons );
				foreach ( $crons as $timestamp => $hooks ) {
					foreach ( $hooks as $hook => $events ) {
						if ( ! empty( $a['hook'] ) && $hook !== $a['hook'] ) {
							continue;
						}
						foreach ( $events as $key => $event ) {
							$out[] = array(
								'hook'     => $hook,
								'time'     => (int) $timestamp,
								'time_h'   => date( 'Y-m-d H:i:s', (int) $timestamp ),
								'schedule' => $event['schedule'] ?? 'single',
								'interval' => $event['interval'] ?? null,
								'args'     => $event['args'] ?? array(),
							);
						}
					}
				}
				return array( 'count' => count( $out ), 'jobs' => $out );
			},
		);

		// ============================================================
		// 13. RUN CRON EVENT
		// ============================================================
		$reg['run_cron_event'] = array(
			'desc'     => 'Manually fire a scheduled cron hook immediately. Pass hook and (optional) args. The hooked callbacks run synchronously in the current request.',
			'risk'     => 'write',
			'schema'   => array(
				'hook' => array( 'type' => 'string' ),
				'args' => array( 'type' => 'array' ),
			),
			'required' => array( 'hook' ),
			'handler'  => function ( $a ) {
				$args = (array) ( $a['args'] ?? array() );
				do_action_ref_array( $a['hook'], $args );
				return array( 'hook' => $a['hook'], 'args' => $args, 'fired' => true );
			},
		);

		// ============================================================
		// 14. DELETE CRON EVENT
		// ============================================================
		$reg['delete_cron_event'] = array(
			'desc'     => 'Unschedule a cron hook. Pass hook + (optional) args to remove a specific event; pass hook only with clear_all=true to remove every recurrence of that hook.',
			'risk'     => 'write',
			'schema'   => array(
				'hook'      => array( 'type' => 'string' ),
				'args'      => array( 'type' => 'array' ),
				'clear_all' => array( 'type' => 'boolean', 'description' => 'Remove every occurrence of this hook. Default false.' ),
			),
			'required' => array( 'hook' ),
			'handler'  => function ( $a ) {
				$args = (array) ( $a['args'] ?? array() );
				if ( ! empty( $a['clear_all'] ) ) {
					$cleared = 0;
					$crons   = _get_cron_array();
					if ( is_array( $crons ) ) {
						foreach ( $crons as $timestamp => $hooks ) {
							if ( isset( $hooks[ $a['hook'] ] ) ) {
								$cleared += count( $hooks[ $a['hook'] ] );
								wp_unschedule_hook( $a['hook'] );
								break;
							}
						}
					}
					return array( 'hook' => $a['hook'], 'cleared' => $cleared, 'mode' => 'all' );
				}
				$res = wp_unschedule_event( wp_next_scheduled( $a['hook'], $args ), $a['hook'], $args );
				return array( 'hook' => $a['hook'], 'unscheduled' => (bool) $res, 'mode' => 'single' );
			},
		);

		return $reg;
	}
}
