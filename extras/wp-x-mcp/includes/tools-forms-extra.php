<?php
/**
 * Gravity Forms, WPForms, and Fluent Forms tools for WP x MCP.
 *
 * Forms list, entries, basic notification info. Each family is plugin-gated.
 * Default OFF in Managed Tools.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Forms_Extra {

	public static function all(): array {
		return array_merge(
			self::gravity_forms(),
			self::wpforms(),
			self::fluent_forms()
		);
	}

	// ─── Gravity Forms ───────────────────────────────────────────────

	private static function gf_active(): bool {
		return class_exists( 'GFAPI' ) || class_exists( 'GFForms' );
	}

	private static function gravity_forms(): array {
		if ( ! self::gf_active() ) {
			return array();
		}
		$reg = array();

		$reg['gf_list_forms'] = array(
			'desc'    => 'List Gravity Forms (id, title, entries count, active status). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'active_only' => array( 'type' => 'boolean', 'description' => 'Only active forms (default false).' ),
			),
			'handler' => function ( $a ) {
				if ( ! class_exists( 'GFAPI' ) ) {
					throw new Exception( 'Gravity Forms GFAPI not available.' );
				}
				$forms = GFAPI::get_forms( true, true );
				$out   = array();
				foreach ( (array) $forms as $f ) {
					if ( ! empty( $a['active_only'] ) && empty( $f['is_active'] ) ) {
						continue;
					}
					$out[] = array(
						'id'        => (int) ( $f['id'] ?? 0 ),
						'title'     => $f['title'] ?? '',
						'is_active' => ! empty( $f['is_active'] ),
						'entries'   => isset( $f['entries'] ) ? (int) $f['entries'] : null,
					);
				}
				return array( 'count' => count( $out ), 'forms' => $out );
			},
		);

		$reg['gf_get_form'] = array(
			'desc'     => 'Get one Gravity Form: title, fields summary, notifications list. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				if ( ! class_exists( 'GFAPI' ) ) {
					throw new Exception( 'Gravity Forms GFAPI not available.' );
				}
				$form = GFAPI::get_form( (int) $a['form_id'] );
				if ( ! $form || is_wp_error( $form ) ) {
					throw new Exception( 'Form not found.' );
				}
				$fields = array();
				foreach ( (array) ( $form['fields'] ?? array() ) as $field ) {
					$fields[] = array(
						'id'    => is_object( $field ) ? ( $field->id ?? null ) : ( $field['id'] ?? null ),
						'label' => is_object( $field ) ? ( $field->label ?? '' ) : ( $field['label'] ?? '' ),
						'type'  => is_object( $field ) ? ( $field->type ?? '' ) : ( $field['type'] ?? '' ),
					);
				}
				$notices = array();
				foreach ( (array) ( $form['notifications'] ?? array() ) as $nid => $n ) {
					$notices[] = array(
						'id'      => $nid,
						'name'    => $n['name'] ?? '',
						'to'      => $n['to'] ?? '',
						'subject' => $n['subject'] ?? '',
						'isActive'=> ! empty( $n['isActive'] ),
					);
				}
				return array(
					'id'            => (int) $form['id'],
					'title'         => $form['title'] ?? '',
					'fields'        => $fields,
					'notifications' => $notices,
				);
			},
		);

		$reg['gf_list_entries'] = array(
			'desc'     => 'List Gravity Forms entries for a form (paging). Returns entry id, date, status, and field values. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'form_id'  => array( 'type' => 'integer' ),
				'page_size'=> array( 'type' => 'integer', 'description' => 'Default 20, max 100.' ),
				'offset'   => array( 'type' => 'integer' ),
				'status'   => array( 'type' => 'string', 'description' => 'active, spam, trash, or all.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				if ( ! class_exists( 'GFAPI' ) ) {
					throw new Exception( 'Gravity Forms GFAPI not available.' );
				}
				$form_id = (int) $a['form_id'];
				$size    = min( 100, max( 1, (int) ( $a['page_size'] ?? 20 ) ) );
				$offset  = max( 0, (int) ( $a['offset'] ?? 0 ) );
				$search  = array();
				if ( ! empty( $a['status'] ) && 'all' !== $a['status'] ) {
					$search['status'] = sanitize_key( $a['status'] );
				}
				$total   = 0;
				$entries = GFAPI::get_entries( $form_id, $search, null, array( 'offset' => $offset, 'page_size' => $size ), $total );
				if ( is_wp_error( $entries ) ) {
					throw new Exception( $entries->get_error_message() );
				}
				return array(
					'form_id' => $form_id,
					'total'   => (int) $total,
					'count'   => count( $entries ),
					'entries' => $entries,
				);
			},
		);

		$reg['gf_get_entry'] = array(
			'desc'     => 'Get a single Gravity Forms entry by ID. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'entry_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'entry_id' ),
			'handler'  => function ( $a ) {
				if ( ! class_exists( 'GFAPI' ) ) {
					throw new Exception( 'Gravity Forms GFAPI not available.' );
				}
				$entry = GFAPI::get_entry( (int) $a['entry_id'] );
				if ( is_wp_error( $entry ) || ! $entry ) {
					throw new Exception( 'Entry not found.' );
				}
				return $entry;
			},
		);

		return $reg;
	}

	// ─── WPForms ─────────────────────────────────────────────────────

	private static function wpforms_active(): bool {
		return function_exists( 'wpforms' ) || class_exists( 'WPForms' );
	}

	private static function wpforms(): array {
		if ( ! self::wpforms_active() ) {
			return array();
		}
		$reg = array();

		$reg['wpforms_list_forms'] = array(
			'desc'    => 'List WPForms forms (id, title, created). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$forms = array();
				if ( function_exists( 'wpforms' ) && isset( wpforms()->form ) ) {
					$posts = wpforms()->form->get( '', array( 'order' => 'DESC' ) );
					foreach ( (array) $posts as $p ) {
						$forms[] = array(
							'id'      => (int) $p->ID,
							'title'   => $p->post_title,
							'created' => $p->post_date,
							'status'  => $p->post_status,
						);
					}
				} else {
					$q = new WP_Query( array(
						'post_type'      => 'wpforms',
						'posts_per_page' => 100,
						'post_status'    => array( 'publish', 'draft' ),
					) );
					foreach ( $q->posts as $p ) {
						$forms[] = array(
							'id'      => (int) $p->ID,
							'title'   => $p->post_title,
							'created' => $p->post_date,
							'status'  => $p->post_status,
						);
					}
				}
				return array( 'count' => count( $forms ), 'forms' => $forms );
			},
		);

		$reg['wpforms_get_form'] = array(
			'desc'     => 'Get WPForms form content/settings JSON (fields, notifications if present). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['form_id'] );
				if ( ! $post || 'wpforms' !== $post->post_type ) {
					throw new Exception( 'WPForms form not found.' );
				}
				$data = array();
				if ( function_exists( 'wpforms_decode' ) ) {
					$data = wpforms_decode( $post->post_content );
				} else {
					$decoded = json_decode( $post->post_content, true );
					$data    = is_array( $decoded ) ? $decoded : array();
				}
				$fields = array();
				foreach ( (array) ( $data['fields'] ?? array() ) as $fid => $field ) {
					$fields[] = array(
						'id'    => $fid,
						'label' => $field['label'] ?? '',
						'type'  => $field['type'] ?? '',
					);
				}
				$notifications = array();
				foreach ( (array) ( $data['settings']['notifications'] ?? array() ) as $nid => $n ) {
					$notifications[] = array(
						'id'      => $nid,
						'email'   => $n['email'] ?? '',
						'subject' => $n['subject'] ?? '',
					);
				}
				return array(
					'id'            => (int) $post->ID,
					'title'         => $post->post_title,
					'fields'        => $fields,
					'notifications' => $notifications,
				);
			},
		);

		$reg['wpforms_list_entries'] = array(
			'desc'     => 'List WPForms entries for a form (requires WPForms + entries DB). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'form_id'  => array( 'type' => 'integer' ),
				'page_size'=> array( 'type' => 'integer' ),
				'offset'   => array( 'type' => 'integer' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form_id = (int) $a['form_id'];
				$size    = min( 100, max( 1, (int) ( $a['page_size'] ?? 20 ) ) );
				$offset  = max( 0, (int) ( $a['offset'] ?? 0 ) );
				if ( function_exists( 'wpforms' ) && isset( wpforms()->entry ) ) {
					$entries = wpforms()->entry->get_entries( array(
						'form_id' => $form_id,
						'number'  => $size,
						'offset'  => $offset,
					) );
					return array(
						'form_id' => $form_id,
						'count'   => is_array( $entries ) ? count( $entries ) : 0,
						'entries' => $entries ? $entries : array(),
					);
				}
				throw new Exception( 'WPForms entries API not available (license/DB may be required).' );
			},
		);

		return $reg;
	}

	// ─── Fluent Forms ────────────────────────────────────────────────

	private static function fluent_active(): bool {
		return defined( 'FLUENTFORM' ) || function_exists( 'wpFluentForm' ) || class_exists( 'FluentForm\App\Models\Form' );
	}

	private static function fluent_forms(): array {
		if ( ! self::fluent_active() ) {
			return array();
		}
		$reg = array();

		$reg['fluent_list_forms'] = array(
			'desc'    => 'List Fluent Forms (id, title, status). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				global $wpdb;
				$table = $wpdb->prefix . 'fluentform_forms';
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
					throw new Exception( 'Fluent Forms table not found.' );
				}
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$rows = $wpdb->get_results( "SELECT id, title, status, created_at FROM {$table} ORDER BY id DESC LIMIT 100", ARRAY_A );
				return array( 'count' => count( (array) $rows ), 'forms' => $rows ? $rows : array() );
			},
		);

		$reg['fluent_get_form'] = array(
			'desc'     => 'Get Fluent Form meta/fields/notifications summary. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				$id    = (int) $a['form_id'];
				$table = $wpdb->prefix . 'fluentform_forms';
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$form = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id ), ARRAY_A );
				if ( ! $form ) {
					throw new Exception( 'Fluent Form not found.' );
				}
				$meta_table = $wpdb->prefix . 'fluentform_form_meta';
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$metas = $wpdb->get_results( $wpdb->prepare( "SELECT meta_key, meta_value FROM {$meta_table} WHERE form_id = %d", $id ), ARRAY_A );
				$meta  = array();
				foreach ( (array) $metas as $m ) {
					$meta[ $m['meta_key'] ] = maybe_unserialize( $m['meta_value'] );
				}
				return array(
					'id'     => (int) $form['id'],
					'title'  => $form['title'],
					'status' => $form['status'],
					'form_fields' => isset( $form['form_fields'] ) ? json_decode( $form['form_fields'], true ) : null,
					'notifications' => $meta['notifications'] ?? $meta['formSettings'] ?? null,
				);
			},
		);

		$reg['fluent_list_entries'] = array(
			'desc'     => 'List Fluent Forms submissions/entries for a form. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'form_id'  => array( 'type' => 'integer' ),
				'page_size'=> array( 'type' => 'integer' ),
				'offset'   => array( 'type' => 'integer' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				$form_id = (int) $a['form_id'];
				$size    = min( 100, max( 1, (int) ( $a['page_size'] ?? 20 ) ) );
				$offset  = max( 0, (int) ( $a['offset'] ?? 0 ) );
				$table   = $wpdb->prefix . 'fluentform_submissions';
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
					throw new Exception( 'Fluent Forms submissions table not found.' );
				}
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE form_id = %d", $form_id ) );
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$rows  = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT id, form_id, serial_number, response, status, created_at FROM {$table} WHERE form_id = %d ORDER BY id DESC LIMIT %d OFFSET %d",
						$form_id,
						$size,
						$offset
					),
					ARRAY_A
				);
				foreach ( (array) $rows as &$r ) {
					if ( isset( $r['response'] ) ) {
						$r['response'] = json_decode( $r['response'], true );
					}
				}
				return array(
					'form_id' => $form_id,
					'total'   => $total,
					'count'   => count( (array) $rows ),
					'entries' => $rows ? $rows : array(),
				);
			},
		);

		return $reg;
	}
}
