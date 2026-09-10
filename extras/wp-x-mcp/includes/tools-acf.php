<?php
/**
 * Advanced Custom Fields (ACF) tools for WP x MCP.
 *
 * Field groups, get/update values on posts/users/terms/options.
 * Registers only when ACF is active. Default OFF in Managed Tools.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_ACF {

	public static function is_active(): bool {
		return function_exists( 'get_field' ) && function_exists( 'update_field' ) && function_exists( 'acf_get_field_groups' );
	}

	private static function require_acf(): void {
		if ( ! self::is_active() ) {
			throw new Exception( 'Advanced Custom Fields (ACF) is not active.' );
		}
	}

	/**
	 * Normalize post_id for ACF (int, user_X, term_X, option).
	 */
	private static function post_id( $raw ) {
		if ( is_numeric( $raw ) ) {
			return (int) $raw;
		}
		return (string) $raw;
	}

	public static function all(): array {
		if ( ! self::is_active() ) {
			return array();
		}

		$reg = array();

		$reg['acf_list_field_groups'] = array(
			'desc'    => 'List ACF field groups (title, key, active, location summary, field count). Optional post_id filters groups that apply to that object. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'post_id' => array( 'type' => 'string', 'description' => 'Optional. Post ID, user_X, term_X — only groups that match this location.' ),
			),
			'handler' => function ( $a ) {
				self::require_acf();
				$args = array();
				if ( ! empty( $a['post_id'] ) ) {
					$pid = self::post_id( $a['post_id'] );
					if ( is_numeric( $pid ) ) {
						$args['post_id'] = (int) $pid;
					}
				}
				$groups = acf_get_field_groups( $args );
				$out    = array();
				foreach ( (array) $groups as $g ) {
					$fields = function_exists( 'acf_get_fields' ) ? acf_get_fields( $g['key'] ) : array();
					$out[]  = array(
						'ID'         => $g['ID'] ?? 0,
						'key'        => $g['key'] ?? '',
						'title'      => $g['title'] ?? '',
						'active'     => ! empty( $g['active'] ),
						'menu_order' => $g['menu_order'] ?? 0,
						'location'   => $g['location'] ?? array(),
						'field_count'=> is_array( $fields ) ? count( $fields ) : 0,
					);
				}
				return array( 'count' => count( $out ), 'groups' => $out );
			},
		);

		$reg['acf_get_field_group'] = array(
			'desc'     => 'Get one ACF field group by key or ID, including field definitions (name, key, type, label, required). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'group' => array( 'type' => 'string', 'description' => 'Field group key (group_xxx) or numeric ID.' ),
			),
			'required' => array( 'group' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$group = acf_get_field_group( $a['group'] );
				if ( ! $group ) {
					throw new Exception( 'Field group not found.' );
				}
				$fields = function_exists( 'acf_get_fields' ) ? acf_get_fields( $group['key'] ) : array();
				$slim   = array();
				foreach ( (array) $fields as $f ) {
					$slim[] = array(
						'name'     => $f['name'] ?? '',
						'key'      => $f['key'] ?? '',
						'label'    => $f['label'] ?? '',
						'type'     => $f['type'] ?? '',
						'required' => ! empty( $f['required'] ),
						'instructions' => $f['instructions'] ?? '',
					);
				}
				return array(
					'key'    => $group['key'] ?? '',
					'title'  => $group['title'] ?? '',
					'active' => ! empty( $group['active'] ),
					'fields' => $slim,
				);
			},
		);

		$reg['acf_get_field'] = array(
			'desc'     => 'Get a single ACF field value. selector = field name or key. post_id = post ID, user_X, term_X, or option. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'selector' => array( 'type' => 'string', 'description' => 'Field name or field_xxx key.' ),
				'post_id'  => array( 'type' => 'string', 'description' => 'Post ID, user_5, term_12, or option.' ),
				'format'   => array( 'type' => 'boolean', 'description' => 'Format value (default true).' ),
			),
			'required' => array( 'selector', 'post_id' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$pid = self::post_id( $a['post_id'] );
				$val = get_field( $a['selector'], $pid, ! isset( $a['format'] ) || $a['format'] );
				return array(
					'selector' => $a['selector'],
					'post_id'  => $pid,
					'value'    => $val,
				);
			},
		);

		$reg['acf_get_fields'] = array(
			'desc'     => 'Get all ACF field values for a post/user/term/options (name => value map). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'string', 'description' => 'Post ID, user_X, term_X, or option.' ),
				'format'  => array( 'type' => 'boolean', 'description' => 'Format values (default true).' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$pid = self::post_id( $a['post_id'] );
				$val = get_fields( $pid, ! isset( $a['format'] ) || $a['format'] );
				return array(
					'post_id' => $pid,
					'fields'  => $val ? $val : new stdClass(),
				);
			},
		);

		$reg['acf_get_fields_for_post'] = array(
			'desc'     => 'Best agent helper: list field groups that apply to a post, each field name/key/type/label plus current value. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'string', 'description' => 'Numeric post/page/CPT ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$pid    = (int) $a['post_id'];
				$groups = acf_get_field_groups( array( 'post_id' => $pid ) );
				$out    = array();
				foreach ( (array) $groups as $g ) {
					$fields = function_exists( 'acf_get_fields' ) ? acf_get_fields( $g['key'] ) : array();
					$rows   = array();
					foreach ( (array) $fields as $f ) {
						$rows[] = array(
							'name'  => $f['name'] ?? '',
							'key'   => $f['key'] ?? '',
							'label' => $f['label'] ?? '',
							'type'  => $f['type'] ?? '',
							'value' => get_field( $f['key'], $pid, true ),
						);
					}
					$out[] = array(
						'group_title' => $g['title'] ?? '',
						'group_key'   => $g['key'] ?? '',
						'fields'      => $rows,
					);
				}
				return array( 'post_id' => $pid, 'groups' => $out );
			},
		);

		$reg['acf_get_field_object'] = array(
			'desc'     => 'Get ACF field object (definition + optional value): type, choices, instructions. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'selector' => array( 'type' => 'string' ),
				'post_id'  => array( 'type' => 'string', 'description' => 'Optional; if set, includes current value.' ),
			),
			'required' => array( 'selector' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$pid = ! empty( $a['post_id'] ) ? self::post_id( $a['post_id'] ) : false;
				$obj = get_field_object( $a['selector'], $pid, true, true );
				if ( ! $obj ) {
					throw new Exception( 'Field object not found.' );
				}
				return $obj;
			},
		);

		$reg['acf_update_field'] = array(
			'desc'     => 'Update one ACF field value. Image/file: attachment ID. Relationship: post ID(s). Date: Ymd. Gallery: array of IDs. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'selector' => array( 'type' => 'string', 'description' => 'Field name or key.' ),
				'value'    => array( 'description' => 'New value (type depends on field).' ),
				'post_id'  => array( 'type' => 'string', 'description' => 'Post ID, user_X, term_X, or option.' ),
			),
			'required' => array( 'selector', 'post_id' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				if ( ! array_key_exists( 'value', $a ) ) {
					throw new Exception( 'value is required.' );
				}
				$pid = self::post_id( $a['post_id'] );
				$ok  = update_field( $a['selector'], $a['value'], $pid );
				if ( false === $ok ) {
					throw new Exception( 'update_field failed (check selector and value format).' );
				}
				return array(
					'updated'  => true,
					'selector' => $a['selector'],
					'post_id'  => $pid,
					'value'    => get_field( $a['selector'], $pid, true ),
				);
			},
		);

		$reg['acf_update_fields'] = array(
			'desc'     => 'Bulk-update multiple ACF fields on one post. fields = object of name/key => value. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'string' ),
				'fields'  => array( 'type' => 'object', 'description' => 'Map of field selector => value.' ),
			),
			'required' => array( 'post_id', 'fields' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$pid    = self::post_id( $a['post_id'] );
				$fields = $a['fields'];
				if ( ! is_array( $fields ) || empty( $fields ) ) {
					throw new Exception( 'fields must be a non-empty object/map.' );
				}
				$results = array();
				foreach ( $fields as $sel => $val ) {
					$ok = update_field( (string) $sel, $val, $pid );
					$results[ (string) $sel ] = ( false !== $ok );
				}
				return array( 'post_id' => $pid, 'results' => $results );
			},
		);

		$reg['acf_delete_field_value'] = array(
			'desc'     => 'Delete (empty) an ACF field value on a post. [risk: destructive]',
			'risk'     => 'destructive',
			'schema'   => array(
				'selector' => array( 'type' => 'string' ),
				'post_id'  => array( 'type' => 'string' ),
			),
			'required' => array( 'selector', 'post_id' ),
			'handler'  => function ( $a ) {
				self::require_acf();
				$pid = self::post_id( $a['post_id'] );
				if ( function_exists( 'delete_field' ) ) {
					$ok = delete_field( $a['selector'], $pid );
				} else {
					$ok = update_field( $a['selector'], null, $pid );
				}
				return array( 'deleted' => (bool) $ok, 'selector' => $a['selector'], 'post_id' => $pid );
			},
		);

		return $reg;
	}
}
