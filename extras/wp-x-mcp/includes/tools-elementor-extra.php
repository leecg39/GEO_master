<?php
/**
 * Additional Elementor tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's Elementor FREE tool set (minus the
 * 4 that collide with the existing tools-elementor-pro.php data-model
 * implementations) into wp-x-mcp's procedural tool registry style.
 *
 * 32 tools covering: page/document management, page editor read,
 * widget discovery, global design system (kit) read+write, site
 * settings read+write, document lifecycle, page editor write,
 * template library, plugin settings, experiments, maintenance.
 *
 * The existing tools-elementor-pro.php (data-model based) keeps
 * elementor_duplicate_element, elementor_move_element,
 * elementor_remove_element, and elementor_update_element. Those
 * 4 MountDev variants are intentionally NOT ported to avoid name
 * collisions and behavioral conflict.
 *
 * Tools register only when Elementor is active. Each handler also
 * runtime-guards to fail clean on missing classes.
 *
 * NOTE on elementor_clear_cache vs existing elementor_flush_cache:
 *   - elementor_flush_cache (existing) — flushes object cache and rewrite rules
 *   - elementor_clear_cache (this file) — clears Elementor CSS files + Elementor transients
 *   Different concerns; both useful.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Elementor_Extra {

	/* -------------------------------------------------------------------------
	 * Plugin detection.
	 * ---------------------------------------------------------------------- */

	public static function is_active(): bool {
		if ( class_exists( '\Elementor\Plugin' ) || defined( 'ELEMENTOR_VERSION' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'elementor/elementor.php' );
	}

	/** Returns \Elementor\Plugin::$instance, throwing if Elementor is not loaded. */
	public static function elementor() {
		if ( ! self::is_active() ) {
			throw new Exception( 'Elementor is not active.' );
		}
		return \Elementor\Plugin::$instance;
	}

	/** Resolve an Elementor document for a post or throw. */
	public static function doc_for_post( int $post_id ) {
		if ( ! $post_id ) {
			throw new Exception( 'Invalid post ID provided.' );
		}
		$doc = self::elementor()->documents->get( $post_id );
		if ( ! $doc ) {
			throw new Exception( 'Elementor document not found for this post.' );
		}
		return $doc;
	}

	/** Resolve the active Elementor kit or throw. */
	public static function active_kit( bool $for_frontend = false ) {
		$km = self::elementor()->kits_manager;
		$kit = $for_frontend ? $km->get_active_kit_for_frontend() : $km->get_active_kit();
		if ( ! $kit ) {
			throw new Exception( 'Active Elementor kit not found.' );
		}
		return $kit;
	}

	/* -------------------------------------------------------------------------
	 * Tree helpers.
	 * ---------------------------------------------------------------------- */

	public static function find_element_by_id( array $elements, $element_id ) {
		foreach ( $elements as $el ) {
			if ( isset( $el['id'] ) && $el['id'] === $element_id ) {
				return $el;
			}
			if ( ! empty( $el['elements'] ) ) {
				$found = self::find_element_by_id( $el['elements'], $element_id );
				if ( null !== $found ) {
					return $found;
				}
			}
		}
		return null;
	}

	public static function flatten_elements( array $elements, array &$flat ): void {
		foreach ( $elements as $el ) {
			$children          = $el['elements'] ?? array();
			$flat_el           = $el;
			unset( $flat_el['elements'] );
			$flat_el['children_count'] = count( $children );
			$flat[]                    = $flat_el;
			if ( $children ) {
				self::flatten_elements( $children, $flat );
			}
		}
	}

	public static function generate_element_id(): string {
		return substr( md5( uniqid( '', true ) ), 0, 7 );
	}

	public static function regenerate_element_ids( $element ) {
		$element['id'] = self::generate_element_id();
		if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
			foreach ( $element['elements'] as &$child ) {
				$child = self::regenerate_element_ids( $child );
			}
			unset( $child );
		}
		return $element;
	}

	public static function insert_element_into_tree( array $elements, array $new_element, string $parent_id, int $position ): array {
		if ( '' === $parent_id ) {
			if ( $position < 0 || $position >= count( $elements ) ) {
				$elements[] = $new_element;
			} else {
				array_splice( $elements, $position, 0, array( $new_element ) );
			}
			return $elements;
		}
		foreach ( $elements as $i => $el ) {
			if ( $el['id'] === $parent_id ) {
				$children = $el['elements'] ?? array();
				if ( $position < 0 || $position >= count( $children ) ) {
					$children[] = $new_element;
				} else {
					array_splice( $children, $position, 0, array( $new_element ) );
				}
				$elements[ $i ]['elements'] = $children;
				return $elements;
			}
			if ( ! empty( $el['elements'] ) ) {
				$elements[ $i ]['elements'] = self::insert_element_into_tree( $el['elements'], $new_element, $parent_id, $position );
			}
		}
		return $elements;
	}

	/* -------------------------------------------------------------------------
	 * Allowlists.
	 * ---------------------------------------------------------------------- */

	public static function site_settings_groups(): array {
		return array(
			'identity'    => array( 'site_name', 'site_description', 'site_logo', 'site_favicon' ),
			'background'  => array(
				'background_background', 'background_color', 'background_gradient_color',
				'background_image', 'background_position', 'background_attachment',
				'background_repeat', 'background_size',
			),
			'layout'      => array(
				'container_width', 'space_between_widgets', 'page_title_selector',
				'stretched_section_container',
			),
			'breakpoints' => array( 'viewport_md', 'viewport_lg', 'viewport_xl', 'viewport_xxl' ),
			'lightbox'    => array(
				'global_image_lightbox', 'lightbox_enable_counter', 'lightbox_enable_fullscreen',
				'lightbox_enable_zoom', 'lightbox_enable_share', 'lightbox_title_src',
				'lightbox_description_src',
			),
		);
	}

	public static function plugin_settings_allowlist(): array {
		return array(
			'elementor_cpt_support',
			'elementor_css_print_method',
			'elementor_editor_break_lines',
			'elementor_disable_color_schemes',
			'elementor_disable_typography_schemes',
			'elementor_allow_tracking',
			'elementor_load_fa4_shim',
			'elementor_google_font',
			'elementor_font_display',
		);
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
		// Group A — Page & Document Management
		// ============================================================

		$reg['elementor_list_pages'] = array(
			'desc'    => 'List all posts/pages built with Elementor (paginated). Returns id, title, post type, status, permalink, edit_url, and timestamps.',
			'risk'    => 'read',
			'schema'  => array(
				'post_type' => array( 'type' => 'string', 'description' => 'page, post, or any. Default any.' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Items per page (1-100). Default 20.' ),
				'page'      => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				$pt = isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : 'any';
				if ( ! in_array( $pt, array( 'page', 'post', 'any' ), true ) ) {
					$pt = 'any';
				}
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$q = new WP_Query( array(
					'post_type'      => $pt,
					'post_status'    => array( 'publish', 'draft', 'private' ),
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'meta_query'     => array(
						array( 'key' => '_elementor_edit_mode', 'value' => 'builder' ),
					),
				) );

				$el    = WPXMCP_Tools_Elementor_Extra::elementor();
				$items = array();
				foreach ( $q->posts as $p ) {
					$doc     = $el->documents->get( $p->ID );
					$items[] = array(
						'id'        => $p->ID,
						'title'     => $p->post_title,
						'type'      => $p->post_type,
						'status'    => $p->post_status,
						'permalink' => get_permalink( $p->ID ),
						'edit_url'  => $doc ? $doc->get_edit_url() : '',
						'date'      => $p->post_date,
						'modified'  => $p->post_modified,
					);
				}

				return array(
					'total' => (int) $q->found_posts,
					'pages' => (int) $q->max_num_pages,
					'items' => $items,
				);
			},
		);

		$reg['elementor_get_document'] = array(
			'desc'     => 'Get full metadata for an Elementor document: title, type, status, permalink, edit URL, page settings, is_built_with_elementor flag.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id   = absint( $a['post_id'] );
				$post = get_post( $id );
				if ( ! $post ) throw new Exception( 'Post not found.' );
				$doc = WPXMCP_Tools_Elementor_Extra::doc_for_post( $id );
				return array(
					'id'                      => $id,
					'title'                   => $post->post_title,
					'type'                    => $doc->get_name(),
					'status'                  => $post->post_status,
					'permalink'               => get_permalink( $id ),
					'edit_url'                => $doc->get_edit_url(),
					'is_built_with_elementor' => $doc->is_built_with_elementor(),
					'date'                    => $post->post_date,
					'modified'                => $post->post_modified,
					'settings'                => $doc->get_db_document_settings(),
				);
			},
		);

		$reg['elementor_get_document_types'] = array(
			'desc'    => 'List all registered Elementor document types (wp-post, wp-page, kit, etc.) with labels and capabilities.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$registered = WPXMCP_Tools_Elementor_Extra::elementor()->documents->get_document_types();
				$types      = array();
				foreach ( $registered as $type => $class ) {
					if ( ! class_exists( $class ) ) continue;
					$props   = $class::get_properties();
					$types[] = array(
						'type'            => $type,
						'label'           => $props['admin_label'] ?? $type,
						'show_in_finder'  => $props['show_in_finder'] ?? false,
						'edit_capability' => $props['edit_capability'] ?? 'edit_posts',
					);
				}
				return array( 'types' => $types );
			},
		);

		$reg['elementor_is_built_with_elementor'] = array(
			'desc'     => 'Check whether a specific post/page is built with the Elementor editor.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id  = absint( $a['post_id'] );
				$doc = WPXMCP_Tools_Elementor_Extra::elementor()->documents->get( $id );
				return array(
					'post_id'                 => $id,
					'is_built_with_elementor' => $doc ? $doc->is_built_with_elementor() : false,
				);
			},
		);

		// ============================================================
		// Group B — Page Editor (read)
		// ============================================================

		$reg['elementor_get_elements'] = array(
			'desc'     => 'Get the full elements tree for an Elementor page. flat=true returns a flat list with children_count instead of the nested tree.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
				'flat'    => array( 'type' => 'boolean', 'description' => 'Return flat array with children_count instead of nested tree.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$id  = absint( $a['post_id'] );
				$doc = WPXMCP_Tools_Elementor_Extra::doc_for_post( $id );
				if ( ! $doc->is_built_with_elementor() ) {
					throw new Exception( 'This post is not built with Elementor.' );
				}
				$data = $doc->get_elements_data() ?? array();
				if ( ! empty( $a['flat'] ) ) {
					$flat = array();
					WPXMCP_Tools_Elementor_Extra::flatten_elements( $data, $flat );
					return array( 'post_id' => $id, 'elements' => $flat );
				}
				return array( 'post_id' => $id, 'elements' => $data );
			},
		);

		$reg['elementor_get_element'] = array(
			'desc'     => 'Get a single Elementor element by ID within a page. Returns the element with all its settings and children.',
			'risk'     => 'read',
			'schema'   => array(
				'post_id'    => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
				'element_id' => array( 'type' => 'string', 'description' => 'Elementor element ID (7-char string).' ),
			),
			'required' => array( 'post_id', 'element_id' ),
			'handler'  => function ( $a ) {
				$id   = absint( $a['post_id'] );
				$eid  = sanitize_text_field( $a['element_id'] );
				$doc  = WPXMCP_Tools_Elementor_Extra::doc_for_post( $id );
				if ( ! $doc->is_built_with_elementor() ) {
					throw new Exception( 'This post is not built with Elementor.' );
				}
				$data = $doc->get_elements_data() ?? array();
				$el   = WPXMCP_Tools_Elementor_Extra::find_element_by_id( $data, $eid );
				if ( null === $el ) {
					throw new Exception( 'Element not found.' );
				}
				return $el;
			},
		);

		// ============================================================
		// Group C — Widget Discovery
		// ============================================================

		$reg['elementor_list_widgets'] = array(
			'desc'    => 'List all registered Elementor FREE widgets (name, title, icon, categories). Optionally filter by category.',
			'risk'    => 'read',
			'schema'  => array(
				'category' => array( 'type' => 'string', 'description' => 'Filter by category slug (e.g. basic, general).' ),
			),
			'handler' => function ( $a ) {
				$cat   = isset( $a['category'] ) ? sanitize_key( $a['category'] ) : '';
				$types = WPXMCP_Tools_Elementor_Extra::elementor()->widgets_manager->get_widget_types();
				$out   = array();
				foreach ( $types as $w ) {
					$cats = $w->get_categories();
					if ( $cat && ! in_array( $cat, $cats, true ) ) continue;
					$out[] = array(
						'name'       => $w->get_name(),
						'title'      => $w->get_title(),
						'icon'       => $w->get_icon(),
						'categories' => $cats,
					);
				}
				return array( 'total' => count( $out ), 'widgets' => $out );
			},
		);

		$reg['elementor_get_widget_schema'] = array(
			'desc'     => 'Get the full control schema for a specific Elementor widget — all controls, tabs, and options.',
			'risk'     => 'read',
			'schema'   => array(
				'widget_name' => array( 'type' => 'string', 'description' => 'Widget name/slug (e.g. heading, button, image).' ),
			),
			'required' => array( 'widget_name' ),
			'handler'  => function ( $a ) {
				$name = sanitize_key( $a['widget_name'] );
				$w    = WPXMCP_Tools_Elementor_Extra::elementor()->widgets_manager->get_widget_types( $name );
				if ( ! $w ) {
					throw new Exception( "Widget '$name' not found." );
				}
				$stack = $w->get_stack( false );
				return array(
					'name'     => $w->get_name(),
					'title'    => $w->get_title(),
					'controls' => array_values( $stack['controls'] ?? array() ),
				);
			},
		);

		// ============================================================
		// Group D — Global Design System (Kit) — read
		// ============================================================

		$reg['elementor_get_global_colors'] = array(
			'desc'    => 'Get the global color palette from the active Elementor kit: system_colors (Primary/Secondary/Text/Accent) and custom_colors.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$kit = WPXMCP_Tools_Elementor_Extra::active_kit();
				return array(
					'system_colors' => $kit->get_settings( 'system_colors' ) ?? array(),
					'custom_colors' => $kit->get_settings( 'custom_colors' ) ?? array(),
				);
			},
		);

		$reg['elementor_get_global_fonts'] = array(
			'desc'    => 'Get the global typography styles from the active Elementor kit: system_typography and custom_typography.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$kit = WPXMCP_Tools_Elementor_Extra::active_kit();
				return array(
					'system_typography' => $kit->get_settings( 'system_typography' ) ?? array(),
					'custom_typography' => $kit->get_settings( 'custom_typography' ) ?? array(),
				);
			},
		);

		// ============================================================
		// Group E — Site Settings (read)
		// ============================================================

		$reg['elementor_get_site_settings'] = array(
			'desc'    => 'Get Elementor FREE site settings from the active kit. group: identity | background | layout | breakpoints | lightbox | all (default).',
			'risk'    => 'read',
			'schema'  => array(
				'group' => array( 'type' => 'string', 'description' => 'identity | background | layout | breakpoints | lightbox | all.' ),
			),
			'handler' => function ( $a ) {
				$group  = isset( $a['group'] ) ? sanitize_key( $a['group'] ) : 'all';
				$groups = WPXMCP_Tools_Elementor_Extra::site_settings_groups();
				$kit    = WPXMCP_Tools_Elementor_Extra::active_kit();
				$all    = $kit->get_settings();

				if ( 'all' === $group ) {
					$allowed = array_merge( ...array_values( $groups ) );
					return array_intersect_key( $all, array_flip( $allowed ) );
				}
				if ( ! isset( $groups[ $group ] ) ) {
					throw new Exception( 'Invalid settings group. Valid: identity, background, layout, breakpoints, lightbox, all.' );
				}
				return array_intersect_key( $all, array_flip( $groups[ $group ] ) );
			},
		);

		// ============================================================
		// Group A write — Document lifecycle
		// ============================================================

		$reg['elementor_create_document'] = array(
			'desc'     => 'Create a new Elementor page or post, initialized as an empty Elementor document ready for editing.',
			'risk'     => 'write',
			'schema'   => array(
				'title'     => array( 'type' => 'string', 'description' => 'Page/post title.' ),
				'post_type' => array( 'type' => 'string', 'description' => 'page (default) or post.' ),
				'status'    => array( 'type' => 'string', 'description' => 'draft (default), publish, or private.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor();
				$title = sanitize_text_field( $a['title'] );
				$pt    = isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : 'page';
				$st    = isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'draft';
				if ( ! in_array( $pt, array( 'page', 'post' ), true ) ) $pt = 'page';
				if ( ! in_array( $st, array( 'draft', 'publish', 'private' ), true ) ) $st = 'draft';

				$id = wp_insert_post( array(
					'post_title'  => $title,
					'post_type'   => $pt,
					'post_status' => $st,
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}

				update_post_meta( $id, '_elementor_edit_mode', 'builder' );
				update_post_meta( $id, '_elementor_data', '[]' );
				update_post_meta( $id, '_elementor_template_type', 'wp-' . $pt );

				$doc = WPXMCP_Tools_Elementor_Extra::elementor()->documents->get( $id, false );
				return array(
					'id'        => $id,
					'title'     => $title,
					'type'      => $pt,
					'status'    => $st,
					'permalink' => get_permalink( $id ),
					'edit_url'  => $doc ? $doc->get_edit_url() : '',
				);
			},
		);

		$reg['elementor_delete_document'] = array(
			'desc'     => 'Delete an Elementor document. Trashes by default; set force=true to permanently delete.',
			'risk'     => 'destructive',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
				'force'   => array( 'type' => 'boolean', 'description' => 'true = permanent delete, false = trash (default).' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor();
				$id    = absint( $a['post_id'] );
				$force = ! empty( $a['force'] );

				$post = get_post( $id );
				if ( ! $post ) throw new Exception( 'Post not found.' );

				$result = $force ? wp_delete_post( $id, true ) : wp_trash_post( $id );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete the document.' );
				}

				return array(
					'post_id' => $id,
					'action'  => $force ? 'deleted' : 'trashed',
				);
			},
		);

		// ============================================================
		// Group B write — Page Editor
		// ============================================================

		$reg['elementor_save_document'] = array(
			'desc'     => 'Save an Elementor document with a complete elements tree. REPLACES the entire page structure. Use elementor_get_elements first to read, modify, then save.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
				'elements' => array( 'type' => 'array', 'description' => 'Full Elementor elements tree (array of top-level sections/containers).' ),
				'settings' => array( 'type' => 'object', 'description' => 'Optional page-level settings.' ),
			),
			'required' => array( 'post_id', 'elements' ),
			'handler'  => function ( $a ) {
				$id       = absint( $a['post_id'] );
				$elements = $a['elements'];
				$settings = isset( $a['settings'] ) && is_array( $a['settings'] ) ? $a['settings'] : array();

				$doc       = WPXMCP_Tools_Elementor_Extra::doc_for_post( $id );
				$save_data = array( 'elements' => $elements );
				if ( ! empty( $settings ) ) {
					$save_data['settings'] = $settings;
				}

				$result = $doc->save( $save_data );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}

				return array( 'post_id' => $id, 'saved' => true );
			},
		);

		$reg['elementor_add_element'] = array(
			'desc'     => 'Add a new element (section, container, or widget) to an Elementor page. Provide element definition with elType (section/column/widget/container) and for widgets widgetType. ID is auto-generated.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'   => array( 'type' => 'integer', 'description' => 'WordPress post ID.' ),
				'element'   => array( 'type' => 'object', 'description' => 'Element definition (elType, widgetType for widgets, settings).' ),
				'parent_id' => array( 'type' => 'string', 'description' => 'Parent element ID. Omit for root-level insert.' ),
				'position'  => array( 'type' => 'integer', 'description' => 'Zero-based index. -1 (default) appends.' ),
			),
			'required' => array( 'post_id', 'element' ),
			'handler'  => function ( $a ) {
				$id       = absint( $a['post_id'] );
				$element  = $a['element'];
				$parent   = isset( $a['parent_id'] ) ? sanitize_text_field( $a['parent_id'] ) : '';
				$position = isset( $a['position'] ) ? (int) $a['position'] : -1;

				if ( ! is_array( $element ) ) {
					throw new Exception( 'Element must be an object.' );
				}

				$doc      = WPXMCP_Tools_Elementor_Extra::doc_for_post( $id );
				$element  = WPXMCP_Tools_Elementor_Extra::regenerate_element_ids( $element );
				$added_id = $element['id'];

				$tree = $doc->get_elements_data() ?? array();
				$tree = WPXMCP_Tools_Elementor_Extra::insert_element_into_tree( $tree, $element, $parent, $position );

				$result = $doc->save( array( 'elements' => $tree ) );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}

				return array( 'post_id' => $id, 'element_id' => $added_id, 'added' => true );
			},
		);

		// ============================================================
		// Group D write — Global Design System
		// ============================================================

		$reg['elementor_update_global_colors'] = array(
			'desc'     => 'Update an existing global color in the Elementor active kit. Saves the kit and clears the CSS cache.',
			'risk'     => 'write',
			'schema'   => array(
				'color_id' => array( 'type' => 'string', 'description' => '_id of the global color to update.' ),
				'title'    => array( 'type' => 'string', 'description' => 'New label for the color.' ),
				'color'    => array( 'type' => 'string', 'description' => 'New hex/rgba value.' ),
			),
			'required' => array( 'color_id' ),
			'handler'  => function ( $a ) {
				$cid     = sanitize_text_field( $a['color_id'] );
				$kit     = WPXMCP_Tools_Elementor_Extra::active_kit( true );
				$updated = false;

				foreach ( array( 'system_colors', 'custom_colors' ) as $lk ) {
					$list = $kit->get_settings( $lk ) ?? array();
					foreach ( $list as $idx => $c ) {
						if ( $c['_id'] === $cid ) {
							if ( isset( $a['title'] ) ) {
								$list[ $idx ]['title'] = sanitize_text_field( $a['title'] );
							}
							if ( isset( $a['color'] ) ) {
								$list[ $idx ]['color'] = sanitize_text_field( $a['color'] );
							}
							$kit->update_settings( array( $lk => $list ) );
							$updated = true;
							break 2;
						}
					}
				}

				if ( ! $updated ) {
					throw new Exception( 'Global color not found.' );
				}

				$kit->save( array() );
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();
				return array( 'color_id' => $cid, 'updated' => true );
			},
		);

		$reg['elementor_add_global_color'] = array(
			'desc'     => 'Add a new custom global color to the Elementor active kit.',
			'risk'     => 'write',
			'schema'   => array(
				'title' => array( 'type' => 'string', 'description' => 'Label for the new color.' ),
				'color' => array( 'type' => 'string', 'description' => 'Hex or rgba value.' ),
			),
			'required' => array( 'title', 'color' ),
			'handler'  => function ( $a ) {
				$title  = sanitize_text_field( $a['title'] );
				$color  = sanitize_text_field( $a['color'] );
				$kit    = WPXMCP_Tools_Elementor_Extra::active_kit( true );
				$new_id = WPXMCP_Tools_Elementor_Extra::generate_element_id();

				$custom   = $kit->get_settings( 'custom_colors' ) ?? array();
				$custom[] = array( '_id' => $new_id, 'title' => $title, 'color' => $color );

				$kit->update_settings( array( 'custom_colors' => $custom ) );
				$kit->save( array() );
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();

				return array( 'color_id' => $new_id, 'title' => $title, 'color' => $color, 'added' => true );
			},
		);

		$reg['elementor_update_global_fonts'] = array(
			'desc'     => 'Update an existing global typography style in the Elementor active kit.',
			'risk'     => 'write',
			'schema'   => array(
				'typography_id'             => array( 'type' => 'string', 'description' => '_id of typography to update.' ),
				'title'                     => array( 'type' => 'string', 'description' => 'New label.' ),
				'typography_font_family'    => array( 'type' => 'string', 'description' => 'Font family.' ),
				'typography_font_size'      => array( 'type' => 'object', 'description' => 'e.g. {unit:"px", size:16}.' ),
				'typography_font_weight'    => array( 'type' => 'string', 'description' => '400 | 700 | bold | etc.' ),
				'typography_line_height'    => array( 'type' => 'object', 'description' => 'e.g. {unit:"em", size:1.5}.' ),
				'typography_letter_spacing' => array( 'type' => 'object', 'description' => 'e.g. {unit:"em", size:0.1}.' ),
			),
			'required' => array( 'typography_id' ),
			'handler'  => function ( $a ) {
				$tid     = sanitize_text_field( $a['typography_id'] );
				$kit     = WPXMCP_Tools_Elementor_Extra::active_kit( true );
				$fields  = array( 'title', 'typography_font_family', 'typography_font_size', 'typography_font_weight', 'typography_line_height', 'typography_letter_spacing' );
				$updated = false;

				foreach ( array( 'system_typography', 'custom_typography' ) as $lk ) {
					$list = $kit->get_settings( $lk ) ?? array();
					foreach ( $list as $idx => $e ) {
						if ( $e['_id'] === $tid ) {
							foreach ( $fields as $f ) {
								if ( isset( $a[ $f ] ) ) {
									$list[ $idx ][ $f ] = ( 'title' === $f ) ? sanitize_text_field( $a[ $f ] ) : $a[ $f ];
								}
							}
							$kit->update_settings( array( $lk => $list ) );
							$updated = true;
							break 2;
						}
					}
				}

				if ( ! $updated ) {
					throw new Exception( 'Global typography style not found.' );
				}

				$kit->save( array() );
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();
				return array( 'typography_id' => $tid, 'updated' => true );
			},
		);

		$reg['elementor_add_global_font'] = array(
			'desc'     => 'Add a new custom typography style to the Elementor active kit.',
			'risk'     => 'write',
			'schema'   => array(
				'title'                     => array( 'type' => 'string', 'description' => 'Label for the typography style.' ),
				'typography_font_family'    => array( 'type' => 'string', 'description' => 'Font family.' ),
				'typography_font_size'      => array( 'type' => 'object', 'description' => 'e.g. {unit:"px", size:16}.' ),
				'typography_font_weight'    => array( 'type' => 'string', 'description' => '400 | 700 | bold | etc.' ),
				'typography_line_height'    => array( 'type' => 'object', 'description' => 'e.g. {unit:"em", size:1.5}.' ),
				'typography_letter_spacing' => array( 'type' => 'object', 'description' => 'e.g. {unit:"em", size:0.1}.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				$kit    = WPXMCP_Tools_Elementor_Extra::active_kit( true );
				$new_id = WPXMCP_Tools_Elementor_Extra::generate_element_id();
				$entry  = array( '_id' => $new_id );

				$fields = array( 'title', 'typography_font_family', 'typography_font_size', 'typography_font_weight', 'typography_line_height', 'typography_letter_spacing' );
				foreach ( $fields as $f ) {
					if ( isset( $a[ $f ] ) ) {
						$entry[ $f ] = ( 'title' === $f ) ? sanitize_text_field( $a[ $f ] ) : $a[ $f ];
					}
				}

				$custom   = $kit->get_settings( 'custom_typography' ) ?? array();
				$custom[] = $entry;
				$kit->update_settings( array( 'custom_typography' => $custom ) );
				$kit->save( array() );
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();

				return array( 'typography_id' => $new_id, 'title' => $a['title'] ?? '', 'added' => true );
			},
		);

		// ============================================================
		// Group E write — Site Settings
		// ============================================================

		$reg['elementor_update_site_settings'] = array(
			'desc'     => 'Update Elementor FREE site settings in the active kit (identity, background, layout, breakpoints, lightbox). Only allowlisted FREE keys are applied.',
			'risk'     => 'write',
			'schema'   => array(
				'settings' => array( 'type' => 'object', 'description' => 'Key-value map of FREE site setting keys. Use elementor_get_site_settings to see available keys.' ),
			),
			'required' => array( 'settings' ),
			'handler'  => function ( $a ) {
				$in = $a['settings'];
				if ( ! is_array( $in ) ) {
					throw new Exception( 'Settings must be an object.' );
				}
				$allowed = array_merge( ...array_values( WPXMCP_Tools_Elementor_Extra::site_settings_groups() ) );
				$safe    = array_intersect_key( $in, array_flip( $allowed ) );
				if ( empty( $safe ) ) {
					throw new Exception( 'No valid FREE settings keys found.' );
				}

				$kit = WPXMCP_Tools_Elementor_Extra::active_kit( true );
				$kit->update_settings( $safe );
				$kit->save( array() );
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();

				return array( 'updated_keys' => array_keys( $safe ), 'updated' => true );
			},
		);

		// ============================================================
		// Group G — Template Library
		// ============================================================

		$reg['elementor_list_templates'] = array(
			'desc'    => 'List all templates in the Elementor local template library, optionally filtered by type.',
			'risk'    => 'read',
			'schema'  => array(
				'type'     => array( 'type' => 'string', 'description' => 'page | section | container | widget | any (default).' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Items per page (1-100). Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'handler' => function ( $a ) {
				$el       = WPXMCP_Tools_Elementor_Extra::elementor();
				$type     = isset( $a['type'] ) ? sanitize_key( $a['type'] ) : 'any';
				$per_page = isset( $a['per_page'] ) ? max( 1, min( 100, absint( $a['per_page'] ) ) ) : 20;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;

				$qa = array(
					'post_type'      => 'elementor_library',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
				);
				if ( 'any' !== $type ) {
					$qa['meta_query'] = array(
						array( 'key' => '_elementor_template_type', 'value' => $type ),
					);
				}

				$q     = new WP_Query( $qa );
				$items = array();
				foreach ( $q->posts as $p ) {
					$doc   = $el->documents->get( $p->ID );
					$tt    = get_post_meta( $p->ID, '_elementor_template_type', true );
					$items[] = array(
						'id'       => $p->ID,
						'title'    => $p->post_title,
						'type'     => $tt ?: 'section',
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

		$reg['elementor_get_template'] = array(
			'desc'     => 'Get the full details and elements data of a single Elementor template by ID.',
			'risk'     => 'read',
			'schema'   => array(
				'template_id' => array( 'type' => 'integer', 'description' => 'Template post ID.' ),
			),
			'required' => array( 'template_id' ),
			'handler'  => function ( $a ) {
				$el   = WPXMCP_Tools_Elementor_Extra::elementor();
				$id   = absint( $a['template_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Elementor template not found.' );
				}
				$doc  = $el->documents->get( $id );
				$tt   = get_post_meta( $id, '_elementor_template_type', true );
				$data = $doc ? ( $doc->get_elements_data() ?? array() ) : array();

				return array(
					'id'            => $id,
					'title'         => $post->post_title,
					'type'          => $tt ?: 'section',
					'status'        => $post->post_status,
					'date'          => $post->post_date,
					'modified'      => $post->post_modified,
					'edit_url'      => $doc ? $doc->get_edit_url() : '',
					'elements'      => $data,
					'page_settings' => $doc ? $doc->get_db_document_settings() : array(),
				);
			},
		);

		$reg['elementor_create_template'] = array(
			'desc'     => 'Create a new template in the Elementor local template library.',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string', 'description' => 'Template title.' ),
				'type'     => array( 'type' => 'string', 'description' => 'page | section (default) | container | widget.' ),
				'elements' => array( 'type' => 'array', 'description' => 'Optional initial elements tree.' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				$el       = WPXMCP_Tools_Elementor_Extra::elementor();
				$title    = sanitize_text_field( $a['title'] );
				$type     = isset( $a['type'] ) ? sanitize_key( $a['type'] ) : 'section';
				$elements = isset( $a['elements'] ) && is_array( $a['elements'] ) ? $a['elements'] : array();
				if ( ! in_array( $type, array( 'page', 'section', 'container', 'widget' ), true ) ) {
					$type = 'section';
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
				update_post_meta( $id, '_elementor_data', wp_json_encode( $elements ) );
				wp_set_object_terms( $id, $type, 'elementor_library_type' );

				$doc = $el->documents->get( $id, false );
				return array(
					'id'       => $id,
					'title'    => $title,
					'type'     => $type,
					'edit_url' => $doc ? $doc->get_edit_url() : '',
					'created'  => true,
				);
			},
		);

		$reg['elementor_delete_template'] = array(
			'desc'     => 'Delete an Elementor template. Trashes by default; force=true permanently deletes.',
			'risk'     => 'destructive',
			'schema'   => array(
				'template_id' => array( 'type' => 'integer', 'description' => 'Template post ID.' ),
				'force'       => array( 'type' => 'boolean', 'description' => 'true = permanent delete. Default false.' ),
			),
			'required' => array( 'template_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor();
				$id    = absint( $a['template_id'] );
				$force = ! empty( $a['force'] );
				$post  = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Elementor template not found.' );
				}
				$result = $force ? wp_delete_post( $id, true ) : wp_trash_post( $id );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete the template.' );
				}
				return array( 'template_id' => $id, 'action' => $force ? 'deleted' : 'trashed' );
			},
		);

		$reg['elementor_export_template'] = array(
			'desc'     => 'Export an Elementor template as structured JSON data (elements tree + page settings).',
			'risk'     => 'read',
			'schema'   => array(
				'template_id' => array( 'type' => 'integer', 'description' => 'Template post ID.' ),
			),
			'required' => array( 'template_id' ),
			'handler'  => function ( $a ) {
				$el   = WPXMCP_Tools_Elementor_Extra::elementor();
				$id   = absint( $a['template_id'] );
				$post = get_post( $id );
				if ( ! $post || 'elementor_library' !== $post->post_type ) {
					throw new Exception( 'Elementor template not found.' );
				}
				$doc      = $el->documents->get( $id );
				$tt       = get_post_meta( $id, '_elementor_template_type', true );
				$data     = $doc ? ( $doc->get_elements_data() ?? array() ) : array();
				$settings = $doc ? $doc->get_db_document_settings() : array();
				$ver      = defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '';

				return array(
					'template_id'       => $id,
					'title'             => $post->post_title,
					'type'              => $tt ?: 'section',
					'elementor_version' => $ver,
					'export_data'       => array(
						'content'       => $data,
						'page_settings' => $settings,
						'version'       => $ver,
						'title'         => $post->post_title,
						'type'          => $tt ?: 'section',
					),
				);
			},
		);

		// ============================================================
		// Group F — Plugin Settings & Experiments
		// ============================================================

		$reg['elementor_get_plugin_settings'] = array(
			'desc'    => 'Get Elementor FREE plugin settings (CPT support, CSS print method, font settings, editor options, tracking).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor();
				$out = array();
				foreach ( WPXMCP_Tools_Elementor_Extra::plugin_settings_allowlist() as $opt ) {
					$out[ $opt ] = get_option( $opt );
				}
				return $out;
			},
		);

		$reg['elementor_update_plugin_settings'] = array(
			'desc'     => 'Update Elementor FREE plugin settings. Only allowlisted FREE keys are accepted.',
			'risk'     => 'write',
			'schema'   => array(
				'settings' => array( 'type' => 'object', 'description' => 'Key-value map. Use elementor_get_plugin_settings to see available keys.' ),
			),
			'required' => array( 'settings' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor();
				$in = $a['settings'];
				if ( ! is_array( $in ) ) {
					throw new Exception( 'Settings must be an object.' );
				}
				$allow = WPXMCP_Tools_Elementor_Extra::plugin_settings_allowlist();
				$safe  = array_intersect_key( $in, array_flip( $allow ) );
				if ( empty( $safe ) ) {
					throw new Exception( 'No valid FREE plugin settings keys found.' );
				}
				$updated = array();
				foreach ( $safe as $opt => $val ) {
					update_option( $opt, $val );
					$updated[] = $opt;
				}
				return array( 'updated_keys' => $updated, 'updated' => true );
			},
		);

		$reg['elementor_list_experiments'] = array(
			'desc'    => 'List all registered Elementor experiments (feature flags) with their current state (active/inactive/default).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$el          = WPXMCP_Tools_Elementor_Extra::elementor();
				$experiments = array();

				if ( isset( $el->experiments ) && method_exists( $el->experiments, 'get_features' ) ) {
					foreach ( $el->experiments->get_features() as $name => $feature ) {
						$state         = get_option( 'elementor_experiment-' . $name, 'default' );
						$experiments[] = array(
							'name'        => $name,
							'title'       => $feature['title'] ?? $name,
							'description' => $feature['description'] ?? '',
							'state'       => $state,
							'default'     => $feature['default'] ?? 'inactive',
							'stable'      => ! empty( $feature['release_status'] ) && 'stable' === $feature['release_status'],
						);
					}
				} else {
					global $wpdb;
					$rows = $wpdb->get_results(
						"SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE 'elementor_experiment-%'",
						ARRAY_A
					);
					foreach ( $rows as $r ) {
						$experiments[] = array(
							'name'  => str_replace( 'elementor_experiment-', '', $r['option_name'] ),
							'state' => $r['option_value'],
						);
					}
				}

				return array( 'total' => count( $experiments ), 'experiments' => $experiments );
			},
		);

		$reg['elementor_toggle_experiment'] = array(
			'desc'     => 'Enable or disable an Elementor experiment by name. state: active | inactive | default (reset).',
			'risk'     => 'write',
			'schema'   => array(
				'experiment_name' => array( 'type' => 'string', 'description' => 'Experiment name from elementor_list_experiments.' ),
				'state'           => array( 'type' => 'string', 'description' => 'active | inactive | default.' ),
			),
			'required' => array( 'experiment_name', 'state' ),
			'handler'  => function ( $a ) {
				$el    = WPXMCP_Tools_Elementor_Extra::elementor();
				$name  = sanitize_key( $a['experiment_name'] );
				$state = sanitize_key( $a['state'] );

				if ( ! in_array( $state, array( 'active', 'inactive', 'default' ), true ) ) {
					throw new Exception( 'State must be active, inactive, or default.' );
				}
				if ( isset( $el->experiments ) && method_exists( $el->experiments, 'get_features' ) ) {
					$features = $el->experiments->get_features();
					if ( ! isset( $features[ $name ] ) ) {
						throw new Exception( "Experiment '$name' not found." );
					}
				}

				if ( 'default' === $state ) {
					delete_option( 'elementor_experiment-' . $name );
				} else {
					update_option( 'elementor_experiment-' . $name, $state );
				}

				return array( 'experiment_name' => $name, 'state' => $state, 'toggled' => true );
			},
		);

		// ============================================================
		// Group H — System Info + Maintenance
		// ============================================================

		$reg['elementor_get_system_info'] = array(
			'desc'    => 'Get Elementor system info: plugin version, Pro status, WP/PHP versions, supported post types, active kit ID, CSS print method, experiment states.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$el  = WPXMCP_Tools_Elementor_Extra::elementor();
				$kit = $el->kits_manager->get_active_id();
				$cpt = get_option( 'elementor_cpt_support', array( 'page', 'post' ) );
				$css = get_option( 'elementor_css_print_method', 'external' );

				global $wpdb;
				$rows = $wpdb->get_results(
					"SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE 'elementor_experiment-%'",
					ARRAY_A
				);
				$exps = array();
				foreach ( $rows as $r ) {
					$exps[] = array(
						'name'  => str_replace( 'elementor_experiment-', '', $r['option_name'] ),
						'state' => $r['option_value'],
					);
				}

				return array(
					'elementor_version'    => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : get_option( 'elementor_version', '' ),
					'elementor_pro_active' => (bool) did_action( 'elementor_pro/init' ),
					'wp_version'           => get_bloginfo( 'version' ),
					'php_version'          => PHP_VERSION,
					'post_types_supported' => (array) $cpt,
					'active_kit_id'        => (int) $kit,
					'css_print_method'     => $css,
					'experiments'          => $exps,
				);
			},
		);

		$reg['elementor_regenerate_css'] = array(
			'desc'    => 'Regenerate all Elementor CSS files and clear file cache. Use after bulk changes to globals or site settings.',
			'risk'    => 'write',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();
				return array( 'regenerated' => true, 'message' => 'Elementor CSS files regenerated and cache cleared.' );
			},
		);

		$reg['elementor_clear_cache'] = array(
			'desc'    => 'Clear Elementor CSS file cache and Elementor transients. Distinct from elementor_flush_cache (object cache + rewrite rules).',
			'risk'    => 'write',
			'schema'  => array(),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Elementor_Extra::elementor()->files_manager->clear_cache();
				global $wpdb;
				$wpdb->query(
					"DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_elementor_%' OR option_name LIKE '_transient_timeout_elementor_%'"
				);
				return array( 'cleared' => true, 'message' => 'Elementor CSS cache and transients cleared.' );
			},
		);

		return $reg;
	}
}
