<?php
/**
 * Site operations tool groups: options, plugins/themes, custom CSS, direct DB.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Site {

	public static function option_tools(): array {
		$reg = array();

		$reg['get_option'] = array(
			'desc'     => 'Get any WordPress option value by name. No allowlist — full access.',
			'risk'     => 'read',
			'schema'   => array( 'name' => array( 'type' => 'string' ) ),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$val = get_option( $a['name'], null );
				if ( null === $val ) {
					throw new Exception( "Option '{$a['name']}' not found." );
				}
				return array( 'name' => $a['name'], 'value' => maybe_serialize( $val ) === $val ? $val : $val );
			},
		);

		$reg['update_option'] = array(
			'desc'     => 'Set any WordPress option. Value may be a string, number, boolean, or JSON object/array. No allowlist.',
			'risk'     => 'write',
			'schema'   => array(
				'name'  => array( 'type' => 'string' ),
				'value' => array( 'description' => 'String, number, boolean, object, or array.' ),
			),
			'required' => array( 'name', 'value' ),
			'handler'  => function ( $a ) {
				$updated = update_option( $a['name'], $a['value'] );
				return array( 'name' => $a['name'], 'updated' => $updated );
			},
		);

		$reg['delete_option'] = array(
			'desc'     => 'Delete a WordPress option by name.',
			'risk'     => 'destructive',
			'schema'   => array( 'name' => array( 'type' => 'string' ) ),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				return array( 'name' => $a['name'], 'deleted' => delete_option( $a['name'] ) );
			},
		);

		$reg['get_post_meta'] = array(
			'desc'     => 'Get a post meta value (or all meta if key omitted).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'key'     => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				if ( ! empty( $a['key'] ) ) {
					return array( 'value' => get_post_meta( (int) $a['post_id'], $a['key'], true ) );
				}
				return get_post_meta( (int) $a['post_id'] );
			},
		);

		$reg['update_post_meta'] = array(
			'desc'     => 'Set a post meta key/value.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'key'     => array( 'type' => 'string' ),
				'value'   => array( 'description' => 'Any value' ),
			),
			'required' => array( 'post_id', 'key', 'value' ),
			'handler'  => function ( $a ) {
				$res = update_post_meta( (int) $a['post_id'], $a['key'], $a['value'] );
				return array( 'updated' => (bool) $res, 'post_id' => (int) $a['post_id'], 'key' => $a['key'] );
			},
		);

		$reg['flush_cache'] = array(
			'desc'    => 'Flush the object cache and rewrite rules. Also purges LiteSpeed/Object Cache Pro if active.',
			'risk'    => 'write',
			'schema'  => array(),
			'handler' => function ( $a ) {
				wp_cache_flush();
				flush_rewrite_rules();
				if ( class_exists( 'LiteSpeed\Purge' ) ) {
					do_action( 'litespeed_purge_all' );
				}
				do_action( 'wpxmcp_flush_cache' );
				return array( 'flushed' => true );
			},
		);

		return $reg;
	}

	public static function theme_plugin_tools(): array {
		$reg = array();

		$reg['list_plugins'] = array(
			'desc'    => 'List all installed plugins with version, active state, and available updates.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! function_exists( 'get_plugins' ) ) {
					require_once ABSPATH . 'wp-admin/includes/plugin.php';
				}
				$all     = get_plugins();
				$active  = (array) get_option( 'active_plugins', array() );
				$updates = get_site_transient( 'update_plugins' );
				$out     = array();
				foreach ( $all as $file => $data ) {
					$out[] = array(
						'file'    => $file,
						'name'    => $data['Name'],
						'version' => $data['Version'],
						'active'  => in_array( $file, $active, true ),
						'update'  => isset( $updates->response[ $file ] ) ? $updates->response[ $file ]->new_version : null,
					);
				}
				return $out;
			},
		);

		$reg['activate_plugin'] = array(
			'desc'     => 'Activate a plugin by its file path (e.g. woocommerce/woocommerce.php).',
			'risk'     => 'write',
			'schema'   => array( 'plugin' => array( 'type' => 'string' ) ),
			'required' => array( 'plugin' ),
			'handler'  => function ( $a ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
				$res = activate_plugin( $a['plugin'] );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'plugin' => $a['plugin'], 'activated' => true );
			},
		);

		$reg['deactivate_plugin'] = array(
			'desc'     => 'Deactivate a plugin by its file path.',
			'risk'     => 'write',
			'schema'   => array( 'plugin' => array( 'type' => 'string' ) ),
			'required' => array( 'plugin' ),
			'handler'  => function ( $a ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
				deactivate_plugins( $a['plugin'] );
				return array( 'plugin' => $a['plugin'], 'deactivated' => true );
			},
		);

		$reg['update_plugin'] = array(
			'desc'     => 'Update a plugin to its latest version by file path.',
			'risk'     => 'write',
			'schema'   => array( 'plugin' => array( 'type' => 'string' ) ),
			'required' => array( 'plugin' ),
			'handler'  => function ( $a ) {
				require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
				wp_update_plugins();
				$skin     = new WP_Ajax_Upgrader_Skin();
				$upgrader = new Plugin_Upgrader( $skin );
				$result   = $upgrader->upgrade( $a['plugin'] );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( false === $result ) {
					throw new Exception( 'Update failed or no update available.' );
				}
				return array( 'plugin' => $a['plugin'], 'updated' => true );
			},
		);

		$reg['list_themes'] = array(
			'desc'    => 'List installed themes and indicate the active one.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$active = wp_get_theme();
				$out    = array();
				foreach ( wp_get_themes() as $slug => $theme ) {
					$out[] = array(
						'slug'    => $slug,
						'name'    => $theme->get( 'Name' ),
						'version' => $theme->get( 'Version' ),
						'active'  => $slug === $active->get_stylesheet(),
						'parent'  => $theme->parent() ? $theme->parent()->get( 'Name' ) : null,
					);
				}
				return $out;
			},
		);

		$reg['activate_theme'] = array(
			'desc'     => 'Switch the active theme by slug.',
			'risk'     => 'write',
			'schema'   => array( 'slug' => array( 'type' => 'string' ) ),
			'required' => array( 'slug' ),
			'handler'  => function ( $a ) {
				switch_theme( $a['slug'] );
				return array( 'active_theme' => $a['slug'] );
			},
		);

		$reg['get_theme_mod'] = array(
			'desc'     => 'Get a theme modification (Customizer setting) value.',
			'risk'     => 'read',
			'schema'   => array( 'name' => array( 'type' => 'string' ) ),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				return array( 'name' => $a['name'], 'value' => get_theme_mod( $a['name'] ) );
			},
		);

		$reg['set_theme_mod'] = array(
			'desc'     => 'Set a theme modification (Customizer setting) value.',
			'risk'     => 'write',
			'schema'   => array(
				'name'  => array( 'type' => 'string' ),
				'value' => array( 'description' => 'Any value' ),
			),
			'required' => array( 'name', 'value' ),
			'handler'  => function ( $a ) {
				set_theme_mod( $a['name'], $a['value'] );
				return array( 'name' => $a['name'], 'updated' => true );
			},
		);

		return $reg;
	}

	public static function css_tools(): array {
		$reg = array();

		$reg['get_custom_css'] = array(
			'desc'    => 'Get the active theme\'s Additional CSS (Customizer).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				return array( 'css' => wp_get_custom_css(), 'theme' => get_stylesheet() );
			},
		);

		$reg['update_custom_css'] = array(
			'desc'     => 'Replace the active theme\'s Additional CSS (Customizer).',
			'risk'     => 'write',
			'schema'   => array( 'css' => array( 'type' => 'string' ) ),
			'required' => array( 'css' ),
			'handler'  => function ( $a ) {
				$res = wp_update_custom_css_post( $a['css'] );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'updated' => true, 'theme' => get_stylesheet(), 'bytes' => strlen( $a['css'] ) );
			},
		);

		return $reg;
	}

	public static function db_tools(): array {
		$reg = array();

		$reg['db_query'] = array(
			'desc'     => 'Run a direct SQL query. SELECT returns rows; INSERT/UPDATE/DELETE return affected row count. FULL POWER — no guardrails. Always back up first.',
			'risk'     => 'destructive',
			'schema'   => array(
				'sql' => array( 'type' => 'string', 'description' => 'Raw SQL. Use the real table prefix (e.g. wp_).' ),
			),
			'required' => array( 'sql' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				$sql     = trim( $a['sql'] );
				$verb    = strtoupper( strtok( $sql, " \t\n" ) );
				if ( in_array( $verb, array( 'SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'PRAGMA' ), true ) ) {
					$rows = $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB
					if ( $wpdb->last_error ) {
						throw new Exception( $wpdb->last_error );
					}
					return array( 'rows' => $rows, 'count' => count( (array) $rows ) );
				}
				$affected = $wpdb->query( $sql ); // phpcs:ignore WordPress.DB
				if ( false === $affected ) {
					throw new Exception( $wpdb->last_error ?: 'Query failed.' );
				}
				return array( 'affected_rows' => $affected, 'insert_id' => $wpdb->insert_id );
			},
		);

		$reg['db_tables'] = array(
			'desc'    => 'List all database tables with size and row count.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB
					"SELECT table_name AS name,
					        ROUND((data_length+index_length)/1024/1024, 2) AS size_mb,
					        table_rows AS approx_rows
					 FROM information_schema.TABLES
					 WHERE table_schema = DATABASE()
					 ORDER BY (data_length+index_length) DESC",
					ARRAY_A
				);
				return $rows;
			},
		);

		return $reg;
	}
}
