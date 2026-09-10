<?php
/**
 * Code Snippets plugin tools for WP x MCP.
 *
 * List / get / create / update / activate / deactivate snippets.
 * Works with the popular "Code Snippets" plugin (sheabunge / codesnippets).
 * Default OFF in Managed Tools.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Code_Snippets {

	public static function is_active(): bool {
		return class_exists( 'Code_Snippets\Plugin' )
			|| class_exists( 'Code_Snippets' )
			|| defined( 'CODE_SNIPPETS_FILE' )
			|| function_exists( 'code_snippets' );
	}

	private static function require_plugin(): void {
		if ( ! self::is_active() ) {
			throw new Exception( 'Code Snippets plugin is not active.' );
		}
	}

	/**
	 * Snippets table name (Code Snippets stores in custom table).
	 */
	private static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'snippets';
	}

	private static function table_exists(): bool {
		global $wpdb;
		$t = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $t ) ) === $t;
	}

	public static function all(): array {
		if ( ! self::is_active() ) {
			return array();
		}

		$reg = array();

		$reg['snippets_list'] = array(
			'desc'    => 'List Code Snippets (id, name, scope, active, modified). Optional filter by active state. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'active_only' => array( 'type' => 'boolean', 'description' => 'Only active snippets.' ),
				'search'      => array( 'type' => 'string', 'description' => 'Search in name/code.' ),
			),
			'handler' => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				$table = self::table();
				$sql   = "SELECT id, name, scope, active, modified FROM {$table} WHERE 1=1";
				$params = array();
				if ( ! empty( $a['active_only'] ) ) {
					$sql     .= ' AND active = 1';
				}
				if ( ! empty( $a['search'] ) ) {
					$sql     .= ' AND (name LIKE %s OR code LIKE %s)';
					$like     = '%' . $wpdb->esc_like( $a['search'] ) . '%';
					$params[] = $like;
					$params[] = $like;
				}
				$sql .= ' ORDER BY id DESC LIMIT 200';
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
				$rows = $params
					? $wpdb->get_results( $wpdb->prepare( $sql, $params ), ARRAY_A )
					: $wpdb->get_results( $sql, ARRAY_A );
				return array( 'count' => count( (array) $rows ), 'snippets' => $rows ? $rows : array() );
			},
		);

		$reg['snippets_get'] = array(
			'desc'     => 'Get one snippet including full code. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$row = $wpdb->get_row(
					$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', (int) $a['id'] ),
					ARRAY_A
				);
				if ( ! $row ) {
					throw new Exception( 'Snippet not found.' );
				}
				return $row;
			},
		);

		$reg['snippets_create'] = array(
			'desc'     => 'Create a new Code Snippet. scope: global, admin, front-end, single-use. active default false for safety. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'name'   => array( 'type' => 'string' ),
				'code'   => array( 'type' => 'string', 'description' => 'PHP code without opening <?php' ),
				'scope'  => array( 'type' => 'string', 'description' => 'global | admin | front-end | single-use' ),
				'active' => array( 'type' => 'boolean', 'description' => 'Default false (safer).' ),
				'desc'   => array( 'type' => 'string', 'description' => 'Optional description.' ),
			),
			'required' => array( 'name', 'code' ),
			'handler'  => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				$scope  = sanitize_key( $a['scope'] ?? 'global' );
				$allowed = array( 'global', 'admin', 'front-end', 'single-use' );
				if ( ! in_array( $scope, $allowed, true ) ) {
					$scope = 'global';
				}
				$active = ! empty( $a['active'] ) ? 1 : 0;
				$data   = array(
					'name'        => sanitize_text_field( $a['name'] ),
					'code'        => (string) $a['code'],
					'desc'        => isset( $a['desc'] ) ? sanitize_textarea_field( $a['desc'] ) : '',
					'tags'        => '',
					'scope'       => $scope,
					'active'      => $active,
					'priority'    => 10,
					'modified'    => current_time( 'mysql' ),
					'revision'    => 0,
					'cloud_id'    => 0,
				);
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->insert( self::table(), $data );
				if ( ! $ok ) {
					throw new Exception( 'Failed to create snippet: ' . $wpdb->last_error );
				}
				return array( 'id' => (int) $wpdb->insert_id, 'name' => $data['name'], 'active' => (bool) $active, 'scope' => $scope );
			},
		);

		$reg['snippets_update'] = array(
			'desc'     => 'Update snippet name, code, scope, or description. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'id'    => array( 'type' => 'integer' ),
				'name'  => array( 'type' => 'string' ),
				'code'  => array( 'type' => 'string' ),
				'scope' => array( 'type' => 'string' ),
				'desc'  => array( 'type' => 'string' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				$id   = (int) $a['id'];
				$data = array( 'modified' => current_time( 'mysql' ) );
				if ( isset( $a['name'] ) ) {
					$data['name'] = sanitize_text_field( $a['name'] );
				}
				if ( isset( $a['code'] ) ) {
					$data['code'] = (string) $a['code'];
				}
				if ( isset( $a['desc'] ) ) {
					$data['desc'] = sanitize_textarea_field( $a['desc'] );
				}
				if ( isset( $a['scope'] ) ) {
					$scope = sanitize_key( $a['scope'] );
					if ( in_array( $scope, array( 'global', 'admin', 'front-end', 'single-use' ), true ) ) {
						$data['scope'] = $scope;
					}
				}
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->update( self::table(), $data, array( 'id' => $id ) );
				if ( false === $ok ) {
					throw new Exception( 'Update failed: ' . $wpdb->last_error );
				}
				return array( 'id' => $id, 'updated' => true );
			},
		);

		$reg['snippets_activate'] = array(
			'desc'     => 'Enable (activate) a snippet so its code runs. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				$id = (int) $a['id'];
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->update(
					self::table(),
					array( 'active' => 1, 'modified' => current_time( 'mysql' ) ),
					array( 'id' => $id )
				);
				if ( false === $ok ) {
					throw new Exception( 'Activate failed.' );
				}
				return array( 'id' => $id, 'active' => true );
			},
		);

		$reg['snippets_deactivate'] = array(
			'desc'     => 'Disable (deactivate) a snippet. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				$id = (int) $a['id'];
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->update(
					self::table(),
					array( 'active' => 0, 'modified' => current_time( 'mysql' ) ),
					array( 'id' => $id )
				);
				if ( false === $ok ) {
					throw new Exception( 'Deactivate failed.' );
				}
				return array( 'id' => $id, 'active' => false );
			},
		);

		$reg['snippets_delete'] = array(
			'desc'     => 'Permanently delete a snippet. [risk: destructive]',
			'risk'     => 'destructive',
			'schema'   => array(
				'id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_plugin();
				if ( ! self::table_exists() ) {
					throw new Exception( 'Code Snippets database table not found.' );
				}
				global $wpdb;
				$id = (int) $a['id'];
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$ok = $wpdb->delete( self::table(), array( 'id' => $id ), array( '%d' ) );
				if ( ! $ok ) {
					throw new Exception( 'Delete failed or snippet not found.' );
				}
				return array( 'id' => $id, 'deleted' => true );
			},
		);

		return $reg;
	}
}
