<?php
/**
 * Additional Elementor Pro tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's Elementor Pro tool set into wp-x-mcp's
 * procedural tool registry style. 35 tools covering:
 *
 *   - Form Submissions (5): list/get/update/delete submissions, list forms
 *   - Theme Builder (4): list/create theme templates, get/save conditions
 *   - Popups (4): list/get/create/delete popups
 *   - Custom Code (5): list/get/create/update/delete code snippets
 *   - Global Widgets (3): list/get/create
 *   - Dynamic Tags Discovery (1)
 *   - Loop Templates (2): list/create
 *   - Notes (3): list/create/delete
 *   - Custom Fonts & Icons (2): list each
 *   - WooCommerce Settings (2): get/update page assignments
 *   - Element Permissions (2): get/update by role
 *   - Role Manager (2): get/update editor access by role
 *
 * Tools register only when Elementor Pro is active. Each handler also
 * runtime-guards on the specific module it needs (Forms\Submissions Query,
 * Notes\Models\Note, etc.) since modules can be individually unavailable.
 *
 * NAMING: This file is called *-pro-extra.php to avoid colliding with the
 * existing tools-elementor-pro.php which holds the data-model-based element
 * manipulation tools. There are NO name collisions between MountDev's
 * elementor_pro_* tools and any existing wp-x-mcp tools.
 *
 * Reuses Elementor core access via WPXMCP_Tools_Elementor_Extra::elementor().
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Elementor_Pro_Extra {

	/* -------------------------------------------------------------------------
	 * Plugin detection.
	 * ---------------------------------------------------------------------- */

	public static function is_active(): bool {
		return class_exists( '\ElementorPro\Plugin' ) || defined( 'ELEMENTOR_PRO_VERSION' );
	}

	/** Throw if Elementor Pro is not loaded. */
	public static function require_pro(): void {
		if ( ! self::is_active() ) {
			throw new Exception( 'Elementor Pro is not active.' );
		}
	}

	/** Throw if a module-specific class is not loaded. */
	public static function require_class( string $class, string $module_name ): void {
		if ( ! class_exists( $class ) ) {
			throw new Exception( "Elementor Pro $module_name module is not available." );
		}
	}

	/** Access Elementor core (delegates to Elementor_Extra). */
	public static function elementor() {
		return WPXMCP_Tools_Elementor_Extra::elementor();
	}

	/* -------------------------------------------------------------------------
	 * Registry.
	 * ---------------------------------------------------------------------- */

	public static function all(): array {
		if ( ! self::is_active() ) {
			return array();
		}

		$reg = array();

		// ============================================================
		// Form Submissions (5)
		// ============================================================

		$reg['elementor_pro_list_submissions'] = array(
			'desc'    => 'List Elementor Pro form submissions with optional filtering by post, form, status, and read state.',
			'risk'    => 'read',
			'schema'  => array(
				'post_id'  => array( 'type' => 'integer', 'description' => 'Filter by page post ID.' ),
				'form_id'  => array( 'type' => 'string', 'description' => 'Filter by form element_id.' ),
				'status'   => array( 'type' => 'string', 'description' => 'new | trash | any (default).' ),
				'is_read'  => array( 'type' => 'boolean', 'description' => 'Filter by read state.' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( '\ElementorPro\Modules\Forms\Submissions\Database\Query', 'Forms' );
				$q = \ElementorPro\Modules\Forms\Submissions\Database\Query::get_instance();

				$post_id  = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				$form_id  = isset( $a['form_id'] ) ? sanitize_text_field( $a['form_id'] ) : '';
				$status   = isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'any';
				$is_read  = isset( $a['is_read'] ) ? (bool) $a['is_read'] : null;
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$qa = array( 'per_page' => $per_page, 'page' => $page );
				if ( $post_id > 0 )                                                       $qa['post_id']    = $post_id;
				if ( '' !== $form_id )                                                    $qa['element_id'] = $form_id;
				if ( 'any' !== $status && in_array( $status, array( 'new', 'trash' ), true ) ) $qa['status']     = $status;
				if ( null !== $is_read )                                                  $qa['is_read']    = $is_read ? 1 : 0;

				$subs  = $q->get_submissions( $qa );
				$total = $q->count_submissions_by_status( $qa );

				$items = array();
				foreach ( $subs as $s ) {
					$items[] = array(
						'id'         => (int) $s->id,
						'form_name'  => sanitize_text_field( $s->form_name ?? '' ),
						'status'     => sanitize_text_field( $s->status ?? 'new' ),
						'is_read'    => (bool) ( $s->is_read ?? false ),
						'referer'    => esc_url_raw( $s->referer ?? '' ),
						'user_ip'    => sanitize_text_field( $s->user_ip ?? '' ),
						'created_at' => sanitize_text_field( $s->created_at ?? '' ),
						'post_id'    => (int) ( $s->post_id ?? 0 ),
						'element_id' => sanitize_text_field( $s->element_id ?? '' ),
					);
				}
				return array(
					'total' => (int) $total,
					'pages' => $per_page > 0 ? (int) ceil( $total / $per_page ) : 0,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_get_submission'] = array(
			'desc'     => 'Get a single form submission with all field values and the action execution log.',
			'risk'     => 'read',
			'schema'   => array(
				'submission_id' => array( 'type' => 'integer', 'description' => 'Submission ID.' ),
			),
			'required' => array( 'submission_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( '\ElementorPro\Modules\Forms\Submissions\Database\Query', 'Forms' );
				$id  = absint( $a['submission_id'] );
				$q   = \ElementorPro\Modules\Forms\Submissions\Database\Query::get_instance();
				$sub = $q->get_submission( $id );
				if ( ! $sub ) {
					throw new Exception( 'Submission not found.' );
				}
				$values = $q->get_submissions_meta( array( 'submission_id' => $id ) );
				$log    = $q->get_submissions_actions_log( $id );

				$vals = array();
				foreach ( $values as $v ) {
					$vals[] = array(
						'key'   => sanitize_text_field( $v->key ?? '' ),
						'value' => sanitize_text_field( $v->value ?? '' ),
					);
				}
				return array(
					'id'          => (int) $sub->id,
					'form_name'   => sanitize_text_field( $sub->form_name ?? '' ),
					'status'      => sanitize_text_field( $sub->status ?? 'new' ),
					'is_read'     => (bool) ( $sub->is_read ?? false ),
					'referer'     => esc_url_raw( $sub->referer ?? '' ),
					'user_ip'     => sanitize_text_field( $sub->user_ip ?? '' ),
					'user_agent'  => sanitize_text_field( $sub->user_agent ?? '' ),
					'created_at'  => sanitize_text_field( $sub->created_at ?? '' ),
					'post_id'     => (int) ( $sub->post_id ?? 0 ),
					'element_id'  => sanitize_text_field( $sub->element_id ?? '' ),
					'values'      => $vals,
					'actions_log' => $log ?? array(),
				);
			},
		);

		$reg['elementor_pro_update_submission'] = array(
			'desc'     => 'Update a submission: mark as read/unread, or restore from trash (status="new").',
			'risk'     => 'write',
			'schema'   => array(
				'submission_id' => array( 'type' => 'integer', 'description' => 'Submission ID.' ),
				'is_read'       => array( 'type' => 'boolean', 'description' => 'Mark read (true) or unread (false).' ),
				'status'        => array( 'type' => 'string', 'description' => 'Pass "new" to restore from trash.' ),
			),
			'required' => array( 'submission_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( '\ElementorPro\Modules\Forms\Submissions\Database\Query', 'Forms' );
				$id  = absint( $a['submission_id'] );
				$q   = \ElementorPro\Modules\Forms\Submissions\Database\Query::get_instance();
				$sub = $q->get_submission( $id );
				if ( ! $sub ) {
					throw new Exception( 'Submission not found.' );
				}
				$data = array();
				if ( isset( $a['is_read'] ) ) $data['is_read'] = (bool) $a['is_read'] ? 1 : 0;
				if ( isset( $a['status'] ) && 'new' === $a['status'] ) $data['status'] = 'new';
				if ( empty( $data ) ) {
					throw new Exception( 'No valid update data provided.' );
				}
				$q->update_submission( $id, $data );
				return array( 'submission_id' => $id, 'updated' => true );
			},
		);

		$reg['elementor_pro_delete_submission'] = array(
			'desc'     => 'Trash or permanently delete a form submission.',
			'risk'     => 'destructive',
			'schema'   => array(
				'submission_id' => array( 'type' => 'integer', 'description' => 'Submission ID.' ),
				'force'         => array( 'type' => 'boolean', 'description' => 'true = permanent delete, false = trash (default).' ),
			),
			'required' => array( 'submission_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( '\ElementorPro\Modules\Forms\Submissions\Database\Query', 'Forms' );
				$id    = absint( $a['submission_id'] );
				$force = ! empty( $a['force'] );
				$q     = \ElementorPro\Modules\Forms\Submissions\Database\Query::get_instance();
				if ( ! $q->get_submission( $id ) ) {
					throw new Exception( 'Submission not found.' );
				}
				if ( $force ) {
					$q->delete_submission( $id );
					$action = 'deleted';
				} else {
					$q->move_to_trash_submission( $id );
					$action = 'trashed';
				}
				return array( 'submission_id' => $id, 'action' => $action );
			},
		);

		$reg['elementor_pro_list_forms'] = array(
			'desc'    => 'List all forms that have received submissions (grouped by page/form). Reads directly from the e_submissions table.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				global $wpdb;
				$tbl = $wpdb->prefix . 'e_submissions';
				if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $tbl ) ) !== $tbl ) {
					throw new Exception( 'Form submissions table not found. Ensure Elementor Pro Forms module is properly installed.' );
				}

				$total = (int) $wpdb->get_var(
					"SELECT COUNT(DISTINCT CONCAT(post_id, '-', element_id)) FROM {$tbl} WHERE status != 'trash'"
				);
				$rows = $wpdb->get_results( $wpdb->prepare(
					"SELECT post_id, element_id, form_name, COUNT(*) as submission_count
					 FROM {$tbl} WHERE status != 'trash'
					 GROUP BY post_id, element_id, form_name
					 ORDER BY submission_count DESC LIMIT %d OFFSET %d",
					$per_page,
					$offset
				) );

				$items = array();
				foreach ( $rows as $r ) {
					$items[] = array(
						'post_id'          => (int) $r->post_id,
						'element_id'       => sanitize_text_field( $r->element_id ),
						'form_name'        => sanitize_text_field( $r->form_name ),
						'submission_count' => (int) $r->submission_count,
						'permalink'        => get_permalink( (int) $r->post_id ),
					);
				}
				return array( 'total' => $total, 'items' => $items );
			},
		);

		// ============================================================
		// Theme Builder (4)
		// ============================================================

		$reg['elementor_pro_list_theme_templates'] = array(
			'desc'    => 'List theme builder templates (header, footer, single, archive, etc.) with optional location-type filter.',
			'risk'    => 'read',
			'schema'  => array(
				'type'     => array( 'type' => 'string', 'description' => 'header | footer | single-post | single-page | single | archive | search-results | error-404 | any.' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$type     = isset( $a['type'] ) ? sanitize_key( $a['type'] ) : 'any';
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$pro_types = array( 'header', 'footer', 'single-post', 'single-page', 'single', 'archive', 'search-results', 'error-404' );

				$qa = array(
					'post_type'      => 'elementor_library',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
				);
				if ( 'any' !== $type ) {
					if ( ! in_array( $type, $pro_types, true ) ) {
						throw new Exception( 'Invalid theme template type.' );
					}
					$qa['meta_query'] = array(
						array( 'key' => '_elementor_template_type', 'value' => $type ),
					);
				} else {
					$qa['meta_query'] = array(
						array( 'key' => '_elementor_template_type', 'value' => $pro_types, 'compare' => 'IN' ),
					);
				}

				$el    = WPXMCP_Tools_Elementor_Pro_Extra::elementor();
				$q     = new WP_Query( $qa );
				$items = array();
				foreach ( $q->posts as $p ) {
					$doc  = $el->documents->get( $p->ID );
					$tt   = get_post_meta( $p->ID, '_elementor_template_type', true );
					$cnds = get_post_meta( $p->ID, '_elementor_conditions', true );
					$items[] = array(
						'id'               => $p->ID,
						'title'            => $p->post_title,
						'type'             => $tt,
						'status'           => $p->post_status,
						'date'             => $p->post_date,
						'modified'         => $p->post_modified,
						'edit_url'         => $doc ? $doc->get_edit_url() : '',
						'conditions_count' => is_array( $cnds ) ? count( $cnds ) : 0,
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_create_theme_template'] = array(
			'desc'     => 'Create a new theme builder template.',
			'risk'     => 'write',
			'schema'   => array(
				'title' => array( 'type' => 'string', 'description' => 'Template title.' ),
				'type'  => array( 'type' => 'string', 'description' => 'header | footer | single-post | single-page | archive | search-results | error-404.' ),
			),
			'required' => array( 'title', 'type' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$title = sanitize_text_field( $a['title'] );
				$type  = sanitize_key( $a['type'] );

				$valid = array( 'header', 'footer', 'single-post', 'single-page', 'archive', 'search-results', 'error-404' );
				if ( ! in_array( $type, $valid, true ) ) {
					throw new Exception( 'Invalid theme template type.' );
				}

				$id = wp_insert_post( array(
					'post_title'  => $title,
					'post_type'   => 'elementor_library',
					'post_status' => 'publish',
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}

				update_post_meta( $id, '_elementor_edit_mode', 'builder' );
				update_post_meta( $id, '_elementor_template_type', $type );
				update_post_meta( $id, '_elementor_data', '[]' );
				wp_set_object_terms( $id, $type, 'elementor_library_type' );

				$doc = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->documents->get( $id, false );
				return array(
					'id'       => $id,
					'title'    => $title,
					'type'     => $type,
					'edit_url' => $doc ? $doc->get_edit_url() : '',
					'created'  => true,
				);
			},
		);

		$reg['elementor_pro_get_theme_conditions'] = array(
			'desc'     => 'Get display conditions assigned to a theme template (e.g. include/general, include/singular/post/5, exclude/singular).',
			'risk'     => 'read',
			'schema'   => array(
				'template_id' => array( 'type' => 'integer', 'description' => 'Theme template post ID.' ),
			),
			'required' => array( 'template_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id   = absint( $a['template_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Theme template not found.' );
				}
				$cnds = get_post_meta( $id, '_elementor_conditions', true );
				if ( ! is_array( $cnds ) ) $cnds = array();
				return array( 'template_id' => $id, 'conditions' => $cnds );
			},
		);

		$reg['elementor_pro_save_theme_conditions'] = array(
			'desc'     => 'Save display conditions for a theme template. Each condition must match: (include|exclude)/[a-zA-Z0-9_/-]+',
			'risk'     => 'write',
			'schema'   => array(
				'template_id' => array( 'type' => 'integer', 'description' => 'Theme template post ID.' ),
				'conditions'  => array( 'type' => 'array', 'description' => 'Array of condition strings.' ),
			),
			'required' => array( 'template_id', 'conditions' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id   = absint( $a['template_id'] );
				$cnds = is_array( $a['conditions'] ) ? $a['conditions'] : array();
				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Theme template not found.' );
				}
				$clean = array();
				foreach ( $cnds as $c ) {
					$c = sanitize_text_field( $c );
					if ( preg_match( '/^(include|exclude)\/[a-zA-Z0-9_\/-]+$/', $c ) ) {
						$clean[] = $c;
					}
				}
				update_post_meta( $id, '_elementor_conditions', $clean );
				return array( 'template_id' => $id, 'saved' => true );
			},
		);

		// ============================================================
		// Popups (4)
		// ============================================================

		$reg['elementor_pro_list_popups'] = array(
			'desc'    => 'List all Elementor popup templates.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$el       = WPXMCP_Tools_Elementor_Pro_Extra::elementor();
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$q     = new WP_Query( array(
					'post_type'      => 'elementor_library',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
					'meta_query'     => array(
						array( 'key' => '_elementor_template_type', 'value' => 'popup' ),
					),
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$doc = $el->documents->get( $p->ID );
					$items[] = array(
						'id'       => $p->ID,
						'title'    => $p->post_title,
						'status'   => $p->post_status,
						'date'     => $p->post_date,
						'modified' => $p->post_modified,
						'edit_url' => $doc ? $doc->get_edit_url() : '',
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_get_popup'] = array(
			'desc'     => 'Get popup details, elements tree, and display settings (triggers, timing).',
			'risk'     => 'read',
			'schema'   => array(
				'popup_id' => array( 'type' => 'integer', 'description' => 'Popup template post ID.' ),
			),
			'required' => array( 'popup_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id   = absint( $a['popup_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Popup not found.' );
				}
				$tt = get_post_meta( $id, '_elementor_template_type', true );
				if ( 'popup' !== $tt ) {
					throw new Exception( 'This template is not a popup.' );
				}
				$doc      = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->documents->get( $id );
				$data     = $doc ? ( $doc->get_elements_data() ?? array() ) : array();
				$settings = get_post_meta( $id, '_elementor_popup_display_settings', true );
				if ( ! is_array( $settings ) ) $settings = array();
				return array(
					'id'               => $id,
					'title'            => $post->post_title,
					'status'           => $post->post_status,
					'date'             => $post->post_date,
					'modified'         => $post->post_modified,
					'edit_url'         => $doc ? $doc->get_edit_url() : '',
					'elements'         => $data,
					'display_settings' => $settings,
				);
			},
		);

		$reg['elementor_pro_create_popup'] = array(
			'desc'     => 'Create a new popup template.',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string', 'description' => 'Popup title.' ),
				'elements' => array( 'type' => 'array', 'description' => 'Optional initial elements tree.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$title    = sanitize_text_field( $a['title'] );
				$elements = isset( $a['elements'] ) && is_array( $a['elements'] ) ? $a['elements'] : array();

				$id = wp_insert_post( array(
					'post_title'  => $title,
					'post_type'   => 'elementor_library',
					'post_status' => 'publish',
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				update_post_meta( $id, '_elementor_edit_mode', 'builder' );
				update_post_meta( $id, '_elementor_template_type', 'popup' );
				update_post_meta( $id, '_elementor_data', wp_json_encode( $elements ) );
				wp_set_object_terms( $id, 'popup', 'elementor_library_type' );

				$doc = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->documents->get( $id, false );
				return array(
					'id'       => $id,
					'title'    => $title,
					'type'     => 'popup',
					'edit_url' => $doc ? $doc->get_edit_url() : '',
					'created'  => true,
				);
			},
		);

		$reg['elementor_pro_delete_popup'] = array(
			'desc'     => 'Trash or permanently delete a popup.',
			'risk'     => 'destructive',
			'schema'   => array(
				'popup_id' => array( 'type' => 'integer', 'description' => 'Popup template post ID.' ),
				'force'    => array( 'type' => 'boolean', 'description' => 'true = permanent delete, false = trash (default).' ),
			),
			'required' => array( 'popup_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id    = absint( $a['popup_id'] );
				$force = ! empty( $a['force'] );

				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Popup not found.' );
				}
				$tt = get_post_meta( $id, '_elementor_template_type', true );
				if ( 'popup' !== $tt ) {
					throw new Exception( 'This template is not a popup.' );
				}
				$result = $force ? wp_delete_post( $id, true ) : wp_trash_post( $id );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete the popup.' );
				}
				return array( 'popup_id' => $id, 'action' => $force ? 'deleted' : 'trashed' );
			},
		);

		// ============================================================
		// Custom Code Snippets (5)
		// ============================================================

		$reg['elementor_pro_list_custom_code'] = array(
			'desc'    => 'List custom code snippets (head/body_start/body_end injection) with optional location filter.',
			'risk'    => 'read',
			'schema'  => array(
				'location' => array( 'type' => 'string', 'description' => 'head | body_start | body_end | any (default).' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$loc      = isset( $a['location'] ) ? sanitize_key( $a['location'] ) : 'any';
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$qa = array(
					'post_type'      => 'elementor_snippet',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
				);
				if ( 'any' !== $loc && in_array( $loc, array( 'head', 'body_start', 'body_end' ), true ) ) {
					$qa['meta_query'] = array(
						array( 'key' => '_elementor_location', 'value' => $loc ),
					);
				}

				$q     = new WP_Query( $qa );
				$items = array();
				foreach ( $q->posts as $p ) {
					$lm = get_post_meta( $p->ID, '_elementor_location', true );
					$pr = get_post_meta( $p->ID, '_elementor_priority', true );
					$items[] = array(
						'id'       => $p->ID,
						'title'    => $p->post_title,
						'location' => $lm ? $lm : 'head',
						'priority' => $pr ? (int) $pr : 5,
						'status'   => $p->post_status,
						'date'     => $p->post_date,
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_get_custom_code'] = array(
			'desc'     => 'Get a custom code snippet with full content.',
			'risk'     => 'read',
			'schema'   => array(
				'snippet_id' => array( 'type' => 'integer', 'description' => 'Snippet post ID.' ),
			),
			'required' => array( 'snippet_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id   = absint( $a['snippet_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_snippet' !== $post->post_type ) {
					throw new Exception( 'Custom code snippet not found.' );
				}
				$code = get_post_meta( $id, '_elementor_code', true );
				$loc  = get_post_meta( $id, '_elementor_location', true );
				$pr   = get_post_meta( $id, '_elementor_priority', true );
				return array(
					'id'       => $id,
					'title'    => $post->post_title,
					'code'     => $code ? $code : '',
					'location' => $loc ? $loc : 'head',
					'priority' => $pr ? (int) $pr : 5,
					'status'   => $post->post_status,
					'date'     => $post->post_date,
				);
			},
		);

		$reg['elementor_pro_create_custom_code'] = array(
			'desc'     => 'Create a new custom code snippet (HTML/CSS/JS injection).',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string', 'description' => 'Snippet title.' ),
				'code'     => array( 'type' => 'string', 'description' => 'Raw HTML/CSS/JS code.' ),
				'location' => array( 'type' => 'string', 'description' => 'head (default) | body_start | body_end.' ),
				'priority' => array( 'type' => 'integer', 'description' => '1-10. Default 5.' ),
				'status'   => array( 'type' => 'string', 'description' => 'publish (active) | draft (inactive, default).' ),
			),
			'required' => array( 'title', 'code' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$title = sanitize_text_field( $a['title'] );
				$code  = isset( $a['code'] ) ? wp_unslash( $a['code'] ) : '';
				$loc   = isset( $a['location'] ) ? sanitize_key( $a['location'] ) : 'head';
				$pr    = isset( $a['priority'] ) ? absint( $a['priority'] ) : 5;
				$st    = isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'draft';

				if ( ! in_array( $loc, array( 'head', 'body_start', 'body_end' ), true ) ) $loc = 'head';
				if ( $pr < 1 || $pr > 10 ) $pr = 5;
				if ( ! in_array( $st, array( 'publish', 'draft' ), true ) ) $st = 'draft';

				$id = wp_insert_post( array(
					'post_title'  => $title,
					'post_type'   => 'elementor_snippet',
					'post_status' => $st,
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				update_post_meta( $id, '_elementor_code', $code );
				update_post_meta( $id, '_elementor_location', $loc );
				update_post_meta( $id, '_elementor_priority', $pr );

				return array(
					'id'       => $id,
					'title'    => $title,
					'location' => $loc,
					'priority' => $pr,
					'status'   => $st,
					'created'  => true,
				);
			},
		);

		$reg['elementor_pro_update_custom_code'] = array(
			'desc'     => 'Update a custom code snippet. Any subset of title, code, location, priority, status.',
			'risk'     => 'write',
			'schema'   => array(
				'snippet_id' => array( 'type' => 'integer', 'description' => 'Snippet post ID.' ),
				'title'      => array( 'type' => 'string', 'description' => 'New title.' ),
				'code'       => array( 'type' => 'string', 'description' => 'New code.' ),
				'location'   => array( 'type' => 'string', 'description' => 'head | body_start | body_end.' ),
				'priority'   => array( 'type' => 'integer', 'description' => '1-10.' ),
				'status'     => array( 'type' => 'string', 'description' => 'publish | draft.' ),
			),
			'required' => array( 'snippet_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id   = absint( $a['snippet_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_snippet' !== $post->post_type ) {
					throw new Exception( 'Custom code snippet not found.' );
				}
				$upd = array( 'ID' => $id );
				if ( isset( $a['title'] ) ) {
					$upd['post_title'] = sanitize_text_field( $a['title'] );
				}
				if ( isset( $a['status'] ) ) {
					$st = sanitize_key( $a['status'] );
					if ( in_array( $st, array( 'publish', 'draft' ), true ) ) {
						$upd['post_status'] = $st;
					}
				}
				if ( count( $upd ) > 1 ) {
					$r = wp_update_post( $upd, true );
					if ( is_wp_error( $r ) ) {
						throw new Exception( $r->get_error_message() );
					}
				}
				if ( isset( $a['code'] ) ) {
					update_post_meta( $id, '_elementor_code', wp_unslash( $a['code'] ) );
				}
				if ( isset( $a['location'] ) ) {
					$loc = sanitize_key( $a['location'] );
					if ( in_array( $loc, array( 'head', 'body_start', 'body_end' ), true ) ) {
						update_post_meta( $id, '_elementor_location', $loc );
					}
				}
				if ( isset( $a['priority'] ) ) {
					$pr = absint( $a['priority'] );
					if ( $pr >= 1 && $pr <= 10 ) {
						update_post_meta( $id, '_elementor_priority', $pr );
					}
				}
				return array( 'snippet_id' => $id, 'updated' => true );
			},
		);

		$reg['elementor_pro_delete_custom_code'] = array(
			'desc'     => 'Trash or permanently delete a custom code snippet.',
			'risk'     => 'destructive',
			'schema'   => array(
				'snippet_id' => array( 'type' => 'integer', 'description' => 'Snippet post ID.' ),
				'force'      => array( 'type' => 'boolean', 'description' => 'true = permanent delete, false = trash (default).' ),
			),
			'required' => array( 'snippet_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id    = absint( $a['snippet_id'] );
				$force = ! empty( $a['force'] );
				$post  = get_post( $id );
				if ( ! $post || 'elementor_snippet' !== $post->post_type ) {
					throw new Exception( 'Custom code snippet not found.' );
				}
				$result = $force ? wp_delete_post( $id, true ) : wp_trash_post( $id );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete the custom code snippet.' );
				}
				return array( 'snippet_id' => $id, 'action' => $force ? 'deleted' : 'trashed' );
			},
		);

		// ============================================================
		// Global Widgets (3)
		// ============================================================

		$reg['elementor_pro_list_global_widgets'] = array(
			'desc'    => 'List all global widget templates.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$el       = WPXMCP_Tools_Elementor_Pro_Extra::elementor();
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$q     = new WP_Query( array(
					'post_type'      => 'elementor_library',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
					'meta_query'     => array(
						array( 'key' => '_elementor_template_type', 'value' => 'widget' ),
					),
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$wt  = get_post_meta( $p->ID, '_elementor_template_widget_type', true );
					$doc = $el->documents->get( $p->ID );
					$items[] = array(
						'id'          => $p->ID,
						'title'       => $p->post_title,
						'widget_type' => $wt ? $wt : '',
						'status'      => $p->post_status,
						'date'        => $p->post_date,
						'edit_url'    => $doc ? $doc->get_edit_url() : '',
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_get_global_widget'] = array(
			'desc'     => 'Get global widget details and elements tree.',
			'risk'     => 'read',
			'schema'   => array(
				'widget_id' => array( 'type' => 'integer', 'description' => 'Global widget template post ID.' ),
			),
			'required' => array( 'widget_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$id   = absint( $a['widget_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Global widget not found.' );
				}
				$tt = get_post_meta( $id, '_elementor_template_type', true );
				if ( 'widget' !== $tt ) {
					throw new Exception( 'This template is not a global widget.' );
				}
				$doc  = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->documents->get( $id );
				$wt   = get_post_meta( $id, '_elementor_template_widget_type', true );
				$data = $doc ? $doc->get_elements_data() : array();
				return array(
					'id'          => $id,
					'title'       => $post->post_title,
					'widget_type' => $wt ? $wt : '',
					'status'      => $post->post_status,
					'date'        => $post->post_date,
					'edit_url'    => $doc ? $doc->get_edit_url() : '',
					'elements'    => $data,
				);
			},
		);

		$reg['elementor_pro_create_global_widget'] = array(
			'desc'     => 'Create a new global widget template.',
			'risk'     => 'write',
			'schema'   => array(
				'title'       => array( 'type' => 'string', 'description' => 'Widget title.' ),
				'widget_type' => array( 'type' => 'string', 'description' => 'Widget type slug (e.g. heading, button).' ),
				'elements'    => array( 'type' => 'array', 'description' => 'Optional initial element tree.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$title    = sanitize_text_field( $a['title'] );
				$wt       = isset( $a['widget_type'] ) ? sanitize_text_field( $a['widget_type'] ) : '';
				$elements = isset( $a['elements'] ) ? $a['elements'] : array();

				$id = wp_insert_post( array(
					'post_title'  => $title,
					'post_type'   => 'elementor_library',
					'post_status' => 'publish',
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				update_post_meta( $id, '_elementor_template_type', 'widget' );
				update_post_meta( $id, '_elementor_edit_mode', 'builder' );
				if ( $wt ) {
					update_post_meta( $id, '_elementor_template_widget_type', $wt );
				}
				if ( ! empty( $elements ) && is_array( $elements ) ) {
					update_post_meta( $id, '_elementor_data', wp_json_encode( $elements ) );
				}
				wp_set_object_terms( $id, 'widget', 'elementor_library_type' );

				$doc      = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->documents->get( $id );
				$edit_url = $doc ? $doc->get_edit_url() : get_permalink( $id );
				return array(
					'id'          => $id,
					'title'       => $title,
					'widget_type' => $wt,
					'edit_url'    => $edit_url,
					'created'     => true,
				);
			},
		);

		// ============================================================
		// Dynamic Tags (1)
		// ============================================================

		$reg['elementor_pro_list_dynamic_tags'] = array(
			'desc'    => 'List all registered dynamic tags with their groups and supported control types.',
			'risk'    => 'read',
			'schema'  => array(
				'group' => array( 'type' => 'string', 'description' => 'Filter by group name (optional).' ),
			),
			'handler' => function ( $a ) {
				$group = isset( $a['group'] ) ? sanitize_text_field( $a['group'] ) : '';
				$dt    = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->dynamic_tags;
				if ( ! $dt ) {
					throw new Exception( 'Dynamic tags manager is not available.' );
				}
				$tags_cfg = $dt->get_tags_config();
				$groups   = $dt->get_tag_groups();

				$gdata = array();
				foreach ( $groups as $gn => $gl ) {
					$gdata[] = array( 'name' => $gn, 'label' => $gl );
				}
				$tdata = array();
				foreach ( $tags_cfg as $tn => $tc ) {
					if ( $group && isset( $tc['group'] ) && $tc['group'] !== $group ) continue;
					$tdata[] = array(
						'name'       => $tn,
						'title'      => $tc['title'] ?? $tn,
						'group'      => $tc['group'] ?? '',
						'categories' => $tc['categories'] ?? array(),
					);
				}
				return array(
					'total'  => count( $tdata ),
					'groups' => $gdata,
					'tags'   => $tdata,
				);
			},
		);

		// ============================================================
		// Loop Templates (2)
		// ============================================================

		$reg['elementor_pro_list_loop_templates'] = array(
			'desc'    => 'List all loop builder templates.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$el       = WPXMCP_Tools_Elementor_Pro_Extra::elementor();
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$q     = new WP_Query( array(
					'post_type'      => 'elementor_library',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
					'meta_query'     => array(
						array( 'key' => '_elementor_template_type', 'value' => 'loop-item' ),
					),
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$src = get_post_meta( $p->ID, '_elementor_source', true );
					$doc = $el->documents->get( $p->ID );
					$items[] = array(
						'id'       => $p->ID,
						'title'    => $p->post_title,
						'status'   => $p->post_status,
						'date'     => $p->post_date,
						'modified' => $p->post_modified,
						'edit_url' => $doc ? $doc->get_edit_url() : get_permalink( $p->ID ),
						'source'   => $src ? $src : 'post',
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_create_loop_template'] = array(
			'desc'     => 'Create a new loop builder template.',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string', 'description' => 'Template title.' ),
				'source'   => array( 'type' => 'string', 'description' => 'post (default) | product | post_taxonomy.' ),
				'elements' => array( 'type' => 'array', 'description' => 'Optional initial elements tree.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$title    = sanitize_text_field( $a['title'] );
				$source   = isset( $a['source'] ) ? sanitize_key( $a['source'] ) : 'post';
				$elements = isset( $a['elements'] ) ? $a['elements'] : array();
				if ( ! in_array( $source, array( 'post', 'product', 'post_taxonomy' ), true ) ) $source = 'post';

				$id = wp_insert_post( array(
					'post_title'  => $title,
					'post_type'   => 'elementor_library',
					'post_status' => 'publish',
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				update_post_meta( $id, '_elementor_template_type', 'loop-item' );
				update_post_meta( $id, '_elementor_edit_mode', 'builder' );
				update_post_meta( $id, '_elementor_source', $source );
				if ( ! empty( $elements ) && is_array( $elements ) ) {
					update_post_meta( $id, '_elementor_data', wp_json_encode( $elements ) );
				}
				wp_set_object_terms( $id, 'loop-item', 'elementor_library_type' );

				$doc      = WPXMCP_Tools_Elementor_Pro_Extra::elementor()->documents->get( $id );
				$edit_url = $doc ? $doc->get_edit_url() : get_permalink( $id );
				return array(
					'id'       => $id,
					'title'    => $title,
					'source'   => $source,
					'edit_url' => $edit_url,
					'created'  => true,
				);
			},
		);

		// ============================================================
		// Notes (3)
		// ============================================================

		$reg['elementor_pro_list_notes'] = array(
			'desc'    => 'List notes for an Elementor document. Filters: post_id, is_resolved. Only top-level notes (replies excluded).',
			'risk'    => 'read',
			'schema'  => array(
				'post_id'     => array( 'type' => 'integer', 'description' => 'Filter by document post ID.' ),
				'is_resolved' => array( 'type' => 'boolean', 'description' => 'Filter by resolved state.' ),
				'per_page'    => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'        => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( 'ElementorPro\Modules\Notes\Models\Note', 'Notes' );

				$post_id     = isset( $a['post_id'] ) ? absint( $a['post_id'] ) : 0;
				$is_resolved = isset( $a['is_resolved'] ) ? (bool) $a['is_resolved'] : null;
				$per_page    = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page        = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$query = \ElementorPro\Modules\Notes\Models\Note::query();
				if ( $post_id > 0 )      $query->where( 'post_id', '=', $post_id );
				if ( null !== $is_resolved ) $query->where( 'is_resolved', '=', $is_resolved ? 1 : 0 );
				$query->where( 'parent_id', '=', 0 );

				$offset = ( $page - 1 ) * $per_page;
				$query->limit( $per_page )->offset( $offset );
				$query->order_by( 'created_at', 'DESC' );

				$notes = $query->get();

				// Count total (same filters)
				$tq = \ElementorPro\Modules\Notes\Models\Note::query();
				if ( $post_id > 0 )      $tq->where( 'post_id', '=', $post_id );
				if ( null !== $is_resolved ) $tq->where( 'is_resolved', '=', $is_resolved ? 1 : 0 );
				$tq->where( 'parent_id', '=', 0 );
				$total = $tq->count();

				$items = array();
				foreach ( $notes as $n ) {
					$replies_count = \ElementorPro\Modules\Notes\Models\Note::query()
						->where( 'parent_id', '=', $n->id )
						->count();
					$items[] = array(
						'id'            => $n->id,
						'post_id'       => $n->post_id,
						'element_id'    => $n->element_id,
						'content'       => $n->content,
						'author_id'     => $n->author_id,
						'is_resolved'   => (bool) $n->is_resolved,
						'is_public'     => (bool) $n->is_public,
						'created_at'    => $n->created_at,
						'replies_count' => $replies_count,
					);
				}
				return array( 'total' => $total, 'items' => $items );
			},
		);

		$reg['elementor_pro_create_note'] = array(
			'desc'     => 'Create a new note on an Elementor element. Can be a reply via parent_id.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'    => array( 'type' => 'integer', 'description' => 'Document post ID.' ),
				'element_id' => array( 'type' => 'string', 'description' => 'Element ID.' ),
				'content'    => array( 'type' => 'string', 'description' => 'Note content.' ),
				'position'   => array( 'type' => 'object', 'description' => 'Optional {x, y} canvas position.' ),
				'parent_id'  => array( 'type' => 'integer', 'description' => 'Parent note ID for replies (optional).' ),
			),
			'required' => array( 'post_id', 'element_id', 'content' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( 'ElementorPro\Modules\Notes\Models\Note', 'Notes' );

				$post_id    = absint( $a['post_id'] );
				$element_id = sanitize_text_field( $a['element_id'] );
				$content    = sanitize_text_field( $a['content'] );
				$position   = isset( $a['position'] ) ? $a['position'] : array();
				$parent_id  = isset( $a['parent_id'] ) ? absint( $a['parent_id'] ) : 0;
				$author_id  = get_current_user_id();

				$data = array(
					'post_id'    => $post_id,
					'element_id' => $element_id,
					'content'    => $content,
					'author_id'  => $author_id,
					'parent_id'  => $parent_id,
					'status'     => 'publish',
				);
				if ( ! empty( $position ) && is_array( $position ) && isset( $position['x'], $position['y'] ) ) {
					$data['position'] = wp_json_encode( array(
						'x' => floatval( $position['x'] ),
						'y' => floatval( $position['y'] ),
					) );
				}

				$n = \ElementorPro\Modules\Notes\Models\Note::create( $data );
				if ( ! $n ) {
					throw new Exception( 'Failed to create note.' );
				}
				return array(
					'id'         => $n->id,
					'post_id'    => $n->post_id,
					'element_id' => $n->element_id,
					'content'    => $n->content,
					'created_at' => $n->created_at,
					'created'    => true,
				);
			},
		);

		$reg['elementor_pro_delete_note'] = array(
			'desc'     => 'Delete a note. If force=true, replies are also deleted.',
			'risk'     => 'destructive',
			'schema'   => array(
				'note_id' => array( 'type' => 'integer', 'description' => 'Note ID.' ),
				'force'   => array( 'type' => 'boolean', 'description' => 'Also delete replies. Default false.' ),
			),
			'required' => array( 'note_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				WPXMCP_Tools_Elementor_Pro_Extra::require_class( 'ElementorPro\Modules\Notes\Models\Note', 'Notes' );

				$id    = absint( $a['note_id'] );
				$force = ! empty( $a['force'] );

				$n = \ElementorPro\Modules\Notes\Models\Note::query()
					->where( 'id', '=', $id )
					->first();
				if ( ! $n ) {
					throw new Exception( 'Note not found.' );
				}
				if ( ! $n->delete() ) {
					throw new Exception( 'Failed to delete note.' );
				}
				if ( $force ) {
					$replies = \ElementorPro\Modules\Notes\Models\Note::query()
						->where( 'parent_id', '=', $id )
						->get();
					foreach ( $replies as $r ) {
						$r->delete();
					}
				}
				return array( 'note_id' => $id, 'deleted' => true );
			},
		);

		// ============================================================
		// Custom Fonts & Icons (2)
		// ============================================================

		$reg['elementor_pro_list_custom_fonts'] = array(
			'desc'    => 'List all custom font families registered via Elementor Pro Custom Fonts.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$q     = new WP_Query( array(
					'post_type'      => 'elementor_font',
					'post_status'    => 'publish',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$ft_terms = get_the_terms( $p->ID, 'elementor_font_type' );
					$ft       = ( $ft_terms && ! is_wp_error( $ft_terms ) ) ? $ft_terms[0]->name : '';
					$items[]  = array(
						'id'        => $p->ID,
						'title'     => $p->post_title,
						'font_type' => $ft,
						'date'      => $p->post_date,
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_pro_list_custom_icons'] = array(
			'desc'    => 'List all custom icon sets registered via Elementor Pro Custom Icons.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$q     = new WP_Query( array(
					'post_type'      => 'elementor_icons',
					'post_status'    => 'publish',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$cfg    = get_post_meta( $p->ID, 'elementor_custom_icon_set_config', true );
					$prefix = '';
					$count  = 0;
					if ( $cfg && is_array( $cfg ) ) {
						$prefix = $cfg['prefix'] ?? '';
						$count  = absint( $cfg['count'] ?? 0 );
					}
					$items[] = array(
						'id'     => $p->ID,
						'title'  => $p->post_title,
						'prefix' => $prefix,
						'count'  => $count,
						'date'   => $p->post_date,
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		// ============================================================
		// WooCommerce Settings (2) — also requires WooCommerce
		// ============================================================

		$reg['elementor_pro_get_woo_settings'] = array(
			'desc'    => 'Get WooCommerce page assignments (cart, checkout, my account, shop, terms, purchase summary). Requires both Elementor Pro and WooCommerce.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				if ( ! class_exists( 'WooCommerce' ) ) {
					throw new Exception( 'WooCommerce is not active.' );
				}
				$map = array(
					'cart_page_id'             => 'woocommerce_cart_page_id',
					'checkout_page_id'         => 'woocommerce_checkout_page_id',
					'myaccount_page_id'        => 'woocommerce_myaccount_page_id',
					'shop_page_id'             => 'woocommerce_shop_page_id',
					'terms_page_id'            => 'woocommerce_terms_page_id',
					'purchase_summary_page_id' => 'elementor_woocommerce_purchase_summary_page_id',
				);
				$out = array();
				foreach ( $map as $key => $opt ) {
					$pid       = (int) get_option( $opt, 0 );
					$out[ $key ] = array(
						'id'        => $pid,
						'title'     => $pid ? get_the_title( $pid ) : '',
						'permalink' => $pid ? get_permalink( $pid ) : '',
					);
				}
				return $out;
			},
		);

		$reg['elementor_pro_update_woo_settings'] = array(
			'desc'    => 'Update WooCommerce page assignments. Only provided keys are updated. Each ID must be an existing page.',
			'risk'    => 'write',
			'schema'  => array(
				'cart_page_id'             => array( 'type' => 'integer', 'description' => 'Cart page ID.' ),
				'checkout_page_id'         => array( 'type' => 'integer', 'description' => 'Checkout page ID.' ),
				'myaccount_page_id'        => array( 'type' => 'integer', 'description' => 'My account page ID.' ),
				'shop_page_id'             => array( 'type' => 'integer', 'description' => 'Shop page ID.' ),
				'terms_page_id'            => array( 'type' => 'integer', 'description' => 'Terms and conditions page ID.' ),
				'purchase_summary_page_id' => array( 'type' => 'integer', 'description' => 'Elementor Pro purchase summary page ID.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				if ( ! class_exists( 'WooCommerce' ) ) {
					throw new Exception( 'WooCommerce is not active.' );
				}
				$map = array(
					'cart_page_id'             => 'woocommerce_cart_page_id',
					'checkout_page_id'         => 'woocommerce_checkout_page_id',
					'myaccount_page_id'        => 'woocommerce_myaccount_page_id',
					'shop_page_id'             => 'woocommerce_shop_page_id',
					'terms_page_id'            => 'woocommerce_terms_page_id',
					'purchase_summary_page_id' => 'elementor_woocommerce_purchase_summary_page_id',
				);
				$updated = array();
				foreach ( $map as $arg => $opt ) {
					if ( ! isset( $a[ $arg ] ) ) continue;
					$pid = absint( $a[ $arg ] );
					if ( $pid > 0 ) {
						$post = get_post( $pid );
						if ( ! $post || 'page' !== $post->post_type ) {
							throw new Exception( "Invalid page ID for '$arg': post not found or not a page." );
						}
					}
					update_option( $opt, $pid );
					$updated[] = $arg;
				}
				if ( empty( $updated ) ) {
					throw new Exception( 'No valid WooCommerce page settings provided.' );
				}
				return array( 'updated_keys' => $updated, 'updated' => true );
			},
		);

		// ============================================================
		// Element Manager Permissions (2)
		// ============================================================

		$reg['elementor_pro_get_element_permissions'] = array(
			'desc'    => 'Get Elementor Pro element manager role restrictions for every WordPress role.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$stored = get_option( 'elementor_pro_element_manager_role_permission', array() );
				$roles  = wp_roles()->get_names();
				$out    = array();
				foreach ( $roles as $slug => $label ) {
					$out[] = array(
						'role'         => $slug,
						'role_label'   => translate_user_role( $label ),
						'restrictions' => isset( $stored[ $slug ] ) ? (array) $stored[ $slug ] : array(),
					);
				}
				return array( 'permissions' => $out );
			},
		);

		$reg['elementor_pro_update_element_permissions'] = array(
			'desc'     => 'Update element manager restrictions for a specific WordPress role. Pass empty restrictions array to clear restrictions for that role.',
			'risk'     => 'write',
			'schema'   => array(
				'role'         => array( 'type' => 'string', 'description' => 'WordPress role slug (editor, contributor, etc.).' ),
				'restrictions' => array( 'type' => 'array', 'description' => 'Restriction keys (e.g. ["design"]). Empty array clears.' ),
			),
			'required' => array( 'role', 'restrictions' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$role = sanitize_key( $a['role'] );
				$res  = array_map( 'sanitize_key', (array) $a['restrictions'] );

				if ( ! array_key_exists( $role, wp_roles()->get_names() ) ) {
					throw new Exception( "WordPress role '$role' does not exist." );
				}

				$stored = get_option( 'elementor_pro_element_manager_role_permission', array() );
				if ( empty( $res ) ) {
					unset( $stored[ $role ] );
				} else {
					$stored[ $role ] = $res;
				}
				update_option( 'elementor_pro_element_manager_role_permission', $stored );

				return array( 'role' => $role, 'restrictions' => $res, 'updated' => true );
			},
		);

		// ============================================================
		// Role Manager (2)
		// ============================================================

		$reg['elementor_pro_get_role_manager'] = array(
			'desc'    => 'Get Elementor Pro editor role manager restrictions for every WordPress role.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$stored = get_option( 'elementor_role-manager', array() );
				$roles  = wp_roles()->get_names();
				$out    = array();
				foreach ( $roles as $slug => $label ) {
					$out[] = array(
						'role'         => $slug,
						'role_label'   => translate_user_role( $label ),
						'restrictions' => isset( $stored[ $slug ] ) ? (array) $stored[ $slug ] : array(),
					);
				}
				return array( 'roles' => $out );
			},
		);

		$reg['elementor_pro_update_role_manager'] = array(
			'desc'     => 'Update editor access restrictions for a specific WordPress role. Pass empty restrictions array to clear.',
			'risk'     => 'write',
			'schema'   => array(
				'role'         => array( 'type' => 'string', 'description' => 'WordPress role slug.' ),
				'restrictions' => array( 'type' => 'array', 'description' => 'Restriction keys. Empty array clears.' ),
			),
			'required' => array( 'role', 'restrictions' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Pro_Extra::require_pro();
				$role = sanitize_key( $a['role'] );
				$res  = array_map( 'sanitize_key', (array) $a['restrictions'] );

				if ( ! array_key_exists( $role, wp_roles()->get_names() ) ) {
					throw new Exception( "WordPress role '$role' does not exist." );
				}

				$stored = get_option( 'elementor_role-manager', array() );
				if ( empty( $res ) ) {
					unset( $stored[ $role ] );
				} else {
					$stored[ $role ] = $res;
				}
				update_option( 'elementor_role-manager', $stored );

				return array( 'role' => $role, 'restrictions' => $res, 'updated' => true );
			},
		);

		return $reg;
	}
}
