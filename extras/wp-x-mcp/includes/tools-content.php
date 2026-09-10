<?php
/**
 * Content tool groups: taxonomies, media, menus, users.
 *
 * Implemented as static methods on WPXMCP_Tools_Content and wired into
 * WPXMCP_Tools::registry() via direct static calls (PHP cannot reopen a class,
 * so the groups live in companion classes rather than on WPXMCP_Tools itself).
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

/**
 * Content tool implementations.
 */
class WPXMCP_Tools_Content {

	public static function taxonomy_tools(): array {
		$reg = array();

		$reg['list_terms'] = array(
			'desc'     => 'List taxonomy terms (categories, tags, product_cat, product_tag, or any taxonomy). Supports parent filter and search.',
			'risk'     => 'read',
			'schema'   => array(
				'taxonomy'   => array( 'type' => 'string', 'description' => 'category, post_tag, product_cat, product_tag, etc.' ),
				'parent'     => array( 'type' => 'integer', 'description' => 'Parent term ID to list children of' ),
				'search'     => array( 'type' => 'string' ),
				'hide_empty' => array( 'type' => 'boolean', 'description' => 'Default false' ),
				'per_page'   => array( 'type' => 'integer', 'description' => 'Default 100' ),
			),
			'required' => array( 'taxonomy' ),
			'handler'  => function ( $a ) {
				$args = array(
					'taxonomy'   => $a['taxonomy'],
					'hide_empty' => ! empty( $a['hide_empty'] ),
					'number'     => (int) ( $a['per_page'] ?? 100 ),
					'search'     => $a['search'] ?? '',
				);
				if ( isset( $a['parent'] ) ) {
					$args['parent'] = (int) $a['parent'];
				}
				$terms = get_terms( $args );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				return array_map(
					function ( $t ) {
						return array(
							'id'        => $t->term_id,
							'name'      => $t->name,
							'slug'      => $t->slug,
							'parent'    => $t->parent,
							'count'     => $t->count,
							'permalink' => get_term_link( $t ),
						);
					},
					$terms
				);
			},
		);

		$reg['create_term'] = array(
			'desc'     => 'Create a taxonomy term (category/tag/product_cat etc.).',
			'risk'     => 'write',
			'schema'   => array(
				'taxonomy'    => array( 'type' => 'string' ),
				'name'        => array( 'type' => 'string' ),
				'slug'        => array( 'type' => 'string' ),
				'parent'      => array( 'type' => 'integer' ),
				'description' => array( 'type' => 'string' ),
			),
			'required' => array( 'taxonomy', 'name' ),
			'handler'  => function ( $a ) {
				$res = wp_insert_term(
					$a['name'],
					$a['taxonomy'],
					array(
						'slug'        => $a['slug'] ?? '',
						'parent'      => (int) ( $a['parent'] ?? 0 ),
						'description' => $a['description'] ?? '',
					)
				);
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'term_id' => $res['term_id'] );
			},
		);

		$reg['update_term'] = array(
			'desc'     => 'Update a taxonomy term by ID.',
			'risk'     => 'write',
			'schema'   => array(
				'taxonomy'    => array( 'type' => 'string' ),
				'term_id'     => array( 'type' => 'integer' ),
				'name'        => array( 'type' => 'string' ),
				'slug'        => array( 'type' => 'string' ),
				'parent'      => array( 'type' => 'integer' ),
				'description' => array( 'type' => 'string' ),
			),
			'required' => array( 'taxonomy', 'term_id' ),
			'handler'  => function ( $a ) {
				$fields = array();
				foreach ( array( 'name', 'slug', 'description' ) as $f ) {
					if ( isset( $a[ $f ] ) ) {
						$fields[ $f ] = $a[ $f ];
					}
				}
				if ( isset( $a['parent'] ) ) {
					$fields['parent'] = (int) $a['parent'];
				}
				$res = wp_update_term( (int) $a['term_id'], $a['taxonomy'], $fields );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'term_id' => (int) $a['term_id'], 'updated' => true );
			},
		);

		$reg['delete_term'] = array(
			'desc'     => 'Delete a taxonomy term by ID.',
			'risk'     => 'destructive',
			'schema'   => array(
				'taxonomy' => array( 'type' => 'string' ),
				'term_id'  => array( 'type' => 'integer' ),
			),
			'required' => array( 'taxonomy', 'term_id' ),
			'handler'  => function ( $a ) {
				$res = wp_delete_term( (int) $a['term_id'], $a['taxonomy'] );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'term_id' => (int) $a['term_id'], 'deleted' => (bool) $res );
			},
		);

		return $reg;
	}

	public static function media_tools(): array {
		$reg = array();

		$reg['list_media'] = array(
			'desc'    => 'List media library attachments. Filter by search and mime type.',
			'risk'    => 'read',
			'schema'  => array(
				'search'    => array( 'type' => 'string' ),
				'mime_type' => array( 'type' => 'string', 'description' => 'e.g. image/jpeg, image, application/pdf' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Default 20' ),
				'page'      => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				$q = new WP_Query(
					array(
						'post_type'      => 'attachment',
						'post_status'    => 'inherit',
						's'              => $a['search'] ?? '',
						'post_mime_type' => $a['mime_type'] ?? '',
						'posts_per_page' => (int) ( $a['per_page'] ?? 20 ),
						'paged'          => (int) ( $a['page'] ?? 1 ),
					)
				);
				$out = array();
				foreach ( $q->posts as $p ) {
					$out[] = array(
						'id'    => $p->ID,
						'title' => $p->post_title,
						'url'   => wp_get_attachment_url( $p->ID ),
						'mime'  => $p->post_mime_type,
						'date'  => $p->post_date,
					);
				}
				return array( 'total' => (int) $q->found_posts, 'items' => $out );
			},
		);

		$reg['upload_media'] = array(
			'desc'     => 'Upload a file to the media library from a URL or base64 content.',
			'risk'     => 'write',
			'schema'   => array(
				'url'             => array( 'type' => 'string', 'description' => 'Remote URL to sideload' ),
				'content_base64'  => array( 'type' => 'string', 'description' => 'Base64 file content (alternative to url)' ),
				'filename'        => array( 'type' => 'string', 'description' => 'Required when using content_base64' ),
				'title'           => array( 'type' => 'string' ),
				'attach_to'       => array( 'type' => 'integer', 'description' => 'Post ID to attach to' ),
				'set_featured'    => array( 'type' => 'boolean', 'description' => 'Set as featured image of attach_to post' ),
			),
			'handler'  => function ( $a ) {
				require_once ABSPATH . 'wp-admin/includes/file.php';
				require_once ABSPATH . 'wp-admin/includes/media.php';
				require_once ABSPATH . 'wp-admin/includes/image.php';

				$attach_to = (int) ( $a['attach_to'] ?? 0 );

				if ( ! empty( $a['url'] ) ) {
					$tmp = download_url( $a['url'] );
					if ( is_wp_error( $tmp ) ) {
						throw new Exception( $tmp->get_error_message() );
					}
					$file = array(
						'name'     => $a['filename'] ?? basename( wp_parse_url( $a['url'], PHP_URL_PATH ) ),
						'tmp_name' => $tmp,
					);
					$id = media_handle_sideload( $file, $attach_to, $a['title'] ?? null );
					if ( is_wp_error( $id ) ) {
						@unlink( $tmp );
						throw new Exception( $id->get_error_message() );
					}
				} elseif ( ! empty( $a['content_base64'] ) && ! empty( $a['filename'] ) ) {
					$bytes  = base64_decode( $a['content_base64'] );
					$upload = wp_upload_bits( $a['filename'], null, $bytes );
					if ( $upload['error'] ) {
						throw new Exception( $upload['error'] );
					}
					$filetype = wp_check_filetype( $upload['file'] );
					$id       = wp_insert_attachment(
						array(
							'post_mime_type' => $filetype['type'],
							'post_title'     => $a['title'] ?? sanitize_file_name( $a['filename'] ),
							'post_status'    => 'inherit',
						),
						$upload['file'],
						$attach_to
					);
					if ( is_wp_error( $id ) ) {
						throw new Exception( $id->get_error_message() );
					}
					wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );
				} else {
					throw new Exception( 'Provide either url, or content_base64 + filename.' );
				}

				if ( $attach_to && ! empty( $a['set_featured'] ) ) {
					set_post_thumbnail( $attach_to, $id );
				}

				return array( 'id' => $id, 'url' => wp_get_attachment_url( $id ) );
			},
		);

		$reg['delete_media'] = array(
			'desc'     => 'Delete a media attachment by ID.',
			'risk'     => 'destructive',
			'schema'   => array(
				'id'    => array( 'type' => 'integer' ),
				'force' => array( 'type' => 'boolean', 'description' => 'Permanently delete. Default true for media.' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$force = isset( $a['force'] ) ? (bool) $a['force'] : true;
				$res   = wp_delete_attachment( (int) $a['id'], $force );
				if ( ! $res ) {
					throw new Exception( 'Delete failed.' );
				}
				return array( 'id' => (int) $a['id'], 'deleted' => true );
			},
		);

		return $reg;
	}

	public static function menu_tools(): array {
		$reg = array();

		$reg['list_menus'] = array(
			'desc'    => 'List all navigation menus with their IDs and item counts.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$menus = wp_get_nav_menus();
				return array_map(
					function ( $m ) {
						return array( 'id' => $m->term_id, 'name' => $m->name, 'slug' => $m->slug, 'count' => $m->count );
					},
					$menus
				);
			},
		);

		$reg['get_menu_items'] = array(
			'desc'     => 'Get all items in a menu (with parent/child structure) by menu ID.',
			'risk'     => 'read',
			'schema'   => array( 'menu_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'menu_id' ),
			'handler'  => function ( $a ) {
				$items = wp_get_nav_menu_items( (int) $a['menu_id'] );
				if ( false === $items ) {
					throw new Exception( 'Menu not found.' );
				}
				return array_map(
					function ( $i ) {
						return array(
							'id'     => $i->ID,
							'title'  => $i->title,
							'url'    => $i->url,
							'parent' => (string) $i->menu_item_parent,
							'order'  => $i->menu_order,
							'type'   => $i->type,
							'object' => $i->object,
						);
					},
					$items
				);
			},
		);

		$reg['create_menu'] = array(
			'desc'     => 'Create a new navigation menu.',
			'risk'     => 'write',
			'schema'   => array( 'name' => array( 'type' => 'string' ) ),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$id = wp_create_nav_menu( $a['name'] );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				return array( 'menu_id' => $id );
			},
		);

		$reg['create_menu_item'] = array(
			'desc'     => 'Add an item to a menu. object_type: custom (url), post_type (object_id=post/page ID), taxonomy (object_id=term ID).',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id'     => array( 'type' => 'integer' ),
				'title'       => array( 'type' => 'string' ),
				'url'         => array( 'type' => 'string', 'description' => 'For custom links' ),
				'object_type' => array( 'type' => 'string', 'description' => 'custom | post_type | taxonomy. Default custom' ),
				'object'      => array( 'type' => 'string', 'description' => 'e.g. page, category, product_cat (for non-custom)' ),
				'object_id'   => array( 'type' => 'integer', 'description' => 'Target post/term ID (for non-custom)' ),
				'parent_id'   => array( 'type' => 'integer', 'description' => 'Parent menu item ID for nesting' ),
				'position'    => array( 'type' => 'integer' ),
			),
			'required' => array( 'menu_id', 'title' ),
			'handler'  => function ( $a ) {
				$type = $a['object_type'] ?? 'custom';
				$data = array(
					'menu-item-title'     => $a['title'],
					'menu-item-status'    => 'publish',
					'menu-item-type'      => $type,
					'menu-item-parent-id' => (int) ( $a['parent_id'] ?? 0 ),
				);
				if ( isset( $a['position'] ) ) {
					$data['menu-item-position'] = (int) $a['position'];
				}
				if ( 'custom' === $type ) {
					$data['menu-item-url'] = $a['url'] ?? '#';
				} else {
					$data['menu-item-object']    = $a['object'] ?? '';
					$data['menu-item-object-id'] = (int) ( $a['object_id'] ?? 0 );
				}
				$id = wp_update_nav_menu_item( (int) $a['menu_id'], 0, $data );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				return array( 'menu_item_id' => $id, 'id' => $id );
			},
		);

		$reg['update_menu_item'] = array(
			'desc'     => 'Update an existing menu item (title, url, parent, position).',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id'      => array( 'type' => 'integer' ),
				'menu_item_id' => array( 'type' => 'integer' ),
				'title'        => array( 'type' => 'string' ),
				'url'          => array( 'type' => 'string' ),
				'parent_id'    => array( 'type' => 'integer' ),
				'position'     => array( 'type' => 'integer' ),
			),
			'required' => array( 'menu_id', 'menu_item_id' ),
			'handler'  => function ( $a ) {
				$item = wp_setup_nav_menu_item( get_post( (int) $a['menu_item_id'] ) );
				$data = array(
					'menu-item-title'     => $a['title'] ?? $item->title,
					'menu-item-url'       => $a['url'] ?? $item->url,
					'menu-item-status'    => 'publish',
					'menu-item-type'      => $item->type,
					'menu-item-object'    => $item->object,
					'menu-item-object-id' => $item->object_id,
					'menu-item-parent-id' => isset( $a['parent_id'] ) ? (int) $a['parent_id'] : $item->menu_item_parent,
				);
				if ( isset( $a['position'] ) ) {
					$data['menu-item-position'] = (int) $a['position'];
				}
				$id = wp_update_nav_menu_item( (int) $a['menu_id'], (int) $a['menu_item_id'], $data );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				return array( 'menu_item_id' => $id, 'updated' => true );
			},
		);

		$reg['delete_menu_item'] = array(
			'desc'     => 'Delete a menu item by ID.',
			'risk'     => 'destructive',
			'schema'   => array( 'menu_item_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'menu_item_id' ),
			'handler'  => function ( $a ) {
				$res = is_nav_menu_item( (int) $a['menu_item_id'] ) ? wp_delete_post( (int) $a['menu_item_id'], true ) : false;
				if ( ! $res ) {
					throw new Exception( 'Menu item not found or delete failed.' );
				}
				return array( 'menu_item_id' => (int) $a['menu_item_id'], 'deleted' => true );
			},
		);

		$reg['assign_menu_location'] = array(
			'desc'     => 'Assign a menu to a theme location (e.g. primary, main_menu).',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id'  => array( 'type' => 'integer' ),
				'location' => array( 'type' => 'string' ),
			),
			'required' => array( 'menu_id', 'location' ),
			'handler'  => function ( $a ) {
				$locations              = get_theme_mod( 'nav_menu_locations', array() );
				$locations[ $a['location'] ] = (int) $a['menu_id'];
				set_theme_mod( 'nav_menu_locations', $locations );
				return array( 'assigned' => true, 'location' => $a['location'], 'menu_id' => (int) $a['menu_id'] );
			},
		);

		// ============================================================
		// EXTENDED MENU TOOLS — adjust, fit, rename, mega menu, etc.
		// ============================================================

		$reg['update_menu'] = array(
			'desc'     => 'Rename a navigation menu (also updates its slug).',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id' => array( 'type' => 'integer' ),
				'name'    => array( 'type' => 'string' ),
			),
			'required' => array( 'menu_id', 'name' ),
			'handler'  => function ( $a ) {
				$res = wp_update_nav_menu_object(
					array(
						'ID'          => (int) $a['menu_id'],
						'menu-name'   => $a['name'],
					)
				);
				if ( is_wp_error( $res ) || ! $res ) {
					throw new Exception( 'Menu update failed (does the menu exist?).' );
				}
				return array( 'menu_id' => (int) $a['menu_id'], 'name' => $a['name'], 'updated' => true );
			},
		);

		$reg['delete_menu'] = array(
			'desc'     => 'Permanently delete a navigation menu and ALL its items. Unassigns it from every theme location first.',
			'risk'     => 'destructive',
			'schema'   => array( 'menu_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'menu_id' ),
			'handler'  => function ( $a ) {
				$menu_id = (int) $a['menu_id'];
				// Remove any theme locations pointing at this menu.
				$locations = get_theme_mod( 'nav_menu_locations', array() );
				if ( is_array( $locations ) ) {
					foreach ( $locations as $loc => $mid ) {
						if ( (int) $mid === $menu_id ) {
							unset( $locations[ $loc ] );
						}
					}
					set_theme_mod( 'nav_menu_locations', $locations );
				}
				$res = wp_delete_nav_menu( $menu_id );
				if ( is_wp_error( $res ) || ! $res ) {
					throw new Exception( 'Menu delete failed.' );
				}
				return array( 'menu_id' => $menu_id, 'deleted' => true );
			},
		);

		$reg['duplicate_menu'] = array(
			'desc'     => 'Clone an existing menu, including every item and its nested parent/child structure. New menu name defaults to "<original> Copy".',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id'   => array( 'type' => 'integer' ),
				'new_name'  => array( 'type' => 'string', 'description' => 'Optional new name. Default "<old> Copy"' ),
			),
			'required' => array( 'menu_id' ),
			'handler'  => function ( $a ) {
				$source_id  = (int) $a['menu_id'];
				$source_obj = wp_get_nav_menu_object( $source_id );
				if ( ! $source_obj ) {
					throw new Exception( 'Source menu not found.' );
				}
				$new_name = $a['new_name'] ?? ( $source_obj->name . ' Copy' );
				$new_id   = wp_create_nav_menu( $new_name );
				if ( is_wp_error( $new_id ) ) {
					throw new Exception( $new_id->get_error_message() );
				}
				$items = wp_get_nav_menu_items( $source_id );
				if ( empty( $items ) ) {
					return array( 'new_menu_id' => $new_id, 'name' => $new_name, 'items_copied' => 0 );
				}
				// First pass: build map of old_id => new_id, copy items with parent=0.
				$id_map = array();
				foreach ( $items as $item ) {
					if ( (int) $item->menu_item_parent !== 0 ) {
						continue;
					}
					$new_item_id = wp_update_nav_menu_item(
						$new_id,
						0,
						array(
							'menu-item-title'     => $item->title,
							'menu-item-url'       => $item->url,
							'menu-item-status'    => 'publish',
							'menu-item-type'      => $item->type,
							'menu-item-object'    => $item->object,
							'menu-item-object-id' => (int) $item->object_id,
							'menu-item-position'  => (int) $item->menu_order,
							'menu-item-attr-title' => $item->attr_title,
							'menu-item-target'    => $item->target,
							'menu-item-classes'   => implode( ' ', (array) $item->classes ),
							'menu-item-xfn'       => $item->xfn,
							'menu-item-description'=> $item->description,
						)
					);
					if ( ! is_wp_error( $new_item_id ) ) {
						$id_map[ (int) $item->ID ] = (int) $new_item_id;
						// Copy item meta.
						$meta = get_post_meta( $item->ID );
						if ( is_array( $meta ) ) {
							foreach ( $meta as $k => $vals ) {
								if ( strpos( $k, '_menu_item_' ) === 0 ) {
									continue;
								}
								foreach ( (array) $vals as $v ) {
									update_post_meta( $new_item_id, $k, maybe_unserialize( $v ) );
								}
							}
						}
					}
				}
				// Second pass: copy children, re-parenting to new IDs.
				foreach ( $items as $item ) {
					if ( (int) $item->menu_item_parent === 0 ) {
						continue;
					}
					$parent_new = $id_map[ (int) $item->menu_item_parent ] ?? 0;
					$new_item_id = wp_update_nav_menu_item(
						$new_id,
						0,
						array(
							'menu-item-title'     => $item->title,
							'menu-item-url'       => $item->url,
							'menu-item-status'    => 'publish',
							'menu-item-type'      => $item->type,
							'menu-item-object'    => $item->object,
							'menu-item-object-id' => (int) $item->object_id,
							'menu-item-parent-id' => $parent_new,
							'menu-item-position'  => (int) $item->menu_order,
						)
					);
					if ( ! is_wp_error( $new_item_id ) ) {
						$id_map[ (int) $item->ID ] = (int) $new_item_id;
					}
				}
				return array(
					'new_menu_id'  => $new_id,
					'name'         => $new_name,
					'items_copied' => count( $id_map ),
				);
			},
		);

		$reg['get_menu_locations'] = array(
			'desc'    => 'List all theme-registered menu locations, with the menu currently assigned (if any).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$registered = get_registered_nav_menus();
				$assigned   = get_theme_mod( 'nav_menu_locations', array() );
				$out        = array();
				foreach ( $registered as $slug => $label ) {
					$out[] = array(
						'location'   => $slug,
						'label'      => $label,
						'menu_id'    => isset( $assigned[ $slug ] ) ? (int) $assigned[ $slug ] : 0,
						'menu_name'  => isset( $assigned[ $slug ] ) ? wp_get_nav_menu_object( $assigned[ $slug ] )->name ?? null : null,
					);
				}
				return $out;
			},
		);

		$reg['unassign_menu_location'] = array(
			'desc'     => 'Remove any menu assigned to a theme location (location becomes empty).',
			'risk'     => 'write',
			'schema'   => array( 'location' => array( 'type' => 'string' ) ),
			'required' => array( 'location' ),
			'handler'  => function ( $a ) {
				$locations = get_theme_mod( 'nav_menu_locations', array() );
				if ( ! is_array( $locations ) || ! isset( $locations[ $a['location'] ] ) ) {
					return array( 'unassigned' => false, 'reason' => 'location was empty' );
				}
				unset( $locations[ $a['location'] ] );
				set_theme_mod( 'nav_menu_locations', $locations );
				return array( 'unassigned' => true, 'location' => $a['location'] );
			},
		);

		$reg['clear_menu'] = array(
			'desc'     => 'Permanently delete ALL items in a menu (keeps the menu itself).',
			'risk'     => 'destructive',
			'schema'   => array( 'menu_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'menu_id' ),
			'handler'  => function ( $a ) {
				$items = wp_get_nav_menu_items( (int) $a['menu_id'] );
				if ( ! $items ) {
					return array( 'menu_id' => (int) $a['menu_id'], 'removed' => 0 );
				}
				$removed = 0;
				foreach ( $items as $i ) {
					if ( wp_delete_post( (int) $i->ID, true ) ) {
						$removed++;
					}
				}
				return array( 'menu_id' => (int) $a['menu_id'], 'removed' => $removed );
			},
		);

		$reg['count_menu_items'] = array(
			'desc'     => 'Quick count of items in a menu (top-level vs nested).',
			'risk'     => 'read',
			'schema'   => array( 'menu_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'menu_id' ),
			'handler'  => function ( $a ) {
				$items = wp_get_nav_menu_items( (int) $a['menu_id'] );
				if ( false === $items ) {
					throw new Exception( 'Menu not found.' );
				}
				$top  = 0;
				$nest = 0;
				foreach ( (array) $items as $i ) {
					if ( (int) $i->menu_item_parent === 0 ) {
						$top++;
					} else {
						$nest++;
					}
				}
				return array(
					'menu_id'     => (int) $a['menu_id'],
					'top_level'   => $top,
					'nested'      => $nest,
					'total'       => $top + $nest,
				);
			},
		);

		$reg['reorder_menu_items'] = array(
			'desc'     => 'Bulk-reorder menu items in one call. Provide an ordered array of menu item IDs; their menu_order will be set to the array index. Optional menu_id limits the scope and re-parents as needed.',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id'    => array( 'type' => 'integer' ),
				'ordered_ids'=> array( 'type' => 'array',  'description' => 'Array of menu item IDs in desired order' ),
			),
			'required' => array( 'ordered_ids' ),
			'handler'  => function ( $a ) {
				$ids = (array) ( $a['ordered_ids'] ?? array() );
				if ( empty( $ids ) ) {
					throw new Exception( 'ordered_ids is required and must not be empty.' );
				}
				$updated = 0;
				$pos     = 1;
				foreach ( $ids as $id ) {
					$id = (int) $id;
					if ( ! is_nav_menu_item( $id ) ) {
						continue;
					}
					wp_update_post( array(
						'ID'         => $id,
						'menu_order' => $pos++,
					) );
					$updated++;
				}
				return array( 'updated' => $updated, 'requested' => count( $ids ) );
			},
		);

		$reg['bulk_create_menu_items'] = array(
			'desc'     => 'Add many items to a menu in one call. items: [{title, url, parent_id?, position?}, ...]',
			'risk'     => 'write',
			'schema'   => array(
				'menu_id' => array( 'type' => 'integer' ),
				'items'   => array( 'type' => 'array',  'description' => 'Array of {title, url, parent_id?, position?}' ),
			),
			'required' => array( 'menu_id', 'items' ),
			'handler'  => function ( $a ) {
				$menu_id = (int) $a['menu_id'];
				if ( ! wp_get_nav_menu_object( $menu_id ) ) {
					throw new Exception( 'Menu not found.' );
				}
				$created = array();
				foreach ( (array) ( $a['items'] ?? array() ) as $row ) {
					if ( empty( $row['title'] ) ) {
						continue;
					}
					$data = array(
						'menu-item-title'     => $row['title'],
						'menu-item-url'       => $row['url'] ?? '#',
						'menu-item-status'    => 'publish',
						'menu-item-type'      => 'custom',
						'menu-item-parent-id' => isset( $row['parent_id'] ) ? (int) $row['parent_id'] : 0,
					);
					if ( isset( $row['position'] ) ) {
						$data['menu-item-position'] = (int) $row['position'];
					}
					$id = wp_update_nav_menu_item( $menu_id, 0, $data );
					if ( ! is_wp_error( $id ) ) {
						$created[] = array( 'id' => (int) $id, 'title' => $row['title'] );
					}
				}
				return array( 'menu_id' => $menu_id, 'created' => $created, 'count' => count( $created ) );
			},
		);

		$reg['mega_menu_set_item_meta'] = array(
			'desc'     => 'Attach mega-menu metadata to a nav menu item. Common keys: mega_menu_enabled (yes/no), mega_menu_columns (int), mega_menu_widget_area (sidebar id), mega_menu_template (id of a saved layout). Any key/value pairs are stored as post meta on the menu item.',
			'risk'     => 'write',
			'schema'   => array(
				'menu_item_id' => array( 'type' => 'integer' ),
				'meta'         => array( 'type' => 'object', 'description' => 'Key/value pairs to save' ),
			),
			'required' => array( 'menu_item_id', 'meta' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['menu_item_id'];
				if ( ! is_nav_menu_item( $id ) ) {
					throw new Exception( 'Not a menu item.' );
				}
				$saved = array();
				foreach ( (array) ( $a['meta'] ?? array() ) as $k => $v ) {
					update_post_meta( $id, sanitize_key( $k ), $v );
					$saved[ $k ] = $v;
				}
				return array( 'menu_item_id' => $id, 'saved' => $saved );
			},
		);

		$reg['mega_menu_get_item_meta'] = array(
			'desc'     => 'Read all meta for a nav menu item, including mega-menu configuration.',
			'risk'     => 'read',
			'schema'   => array( 'menu_item_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'menu_item_id' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['menu_item_id'];
				if ( ! is_nav_menu_item( $id ) ) {
					throw new Exception( 'Not a menu item.' );
				}
				$raw = get_post_meta( $id );
				$clean = array();
				foreach ( $raw as $k => $vals ) {
					if ( strpos( $k, '_menu_item_' ) === 0 ) {
						continue;
					}
					$clean[ $k ] = count( $vals ) === 1 ? maybe_unserialize( $vals[0] ) : array_map( 'maybe_unserialize', $vals );
				}
				return array( 'menu_item_id' => $id, 'meta' => $clean );
			},
		);

		$reg['move_menu_item_to_menu'] = array(
			'desc'     => 'Move an existing menu item from its current menu to a different menu.',
			'risk'     => 'write',
			'schema'   => array(
				'menu_item_id' => array( 'type' => 'integer' ),
				'new_menu_id'  => array( 'type' => 'integer' ),
				'position'     => array( 'type' => 'integer' ),
			),
			'required' => array( 'menu_item_id', 'new_menu_id' ),
			'handler'  => function ( $a ) {
				$item_id  = (int) $a['menu_item_id'];
				$new_menu = (int) $a['new_menu_id'];
				if ( ! is_nav_menu_item( $item_id ) ) {
					throw new Exception( 'Not a menu item.' );
				}
				if ( ! wp_get_nav_menu_object( $new_menu ) ) {
					throw new Exception( 'Target menu not found.' );
				}
				// Set the new term relationship for nav_menu taxonomy.
				wp_set_object_terms( $item_id, $new_menu, 'nav_menu' );
				if ( isset( $a['position'] ) ) {
					wp_update_post( array( 'ID' => $item_id, 'menu_order' => (int) $a['position'] ) );
				}
				return array( 'menu_item_id' => $item_id, 'new_menu_id' => $new_menu, 'moved' => true );
			},
		);

		return $reg;
	}

	public static function user_tools(): array {
		$reg = array();

		$reg['list_users'] = array(
			'desc'    => 'List WordPress users. Filter by role and search.',
			'risk'    => 'read',
			'schema'  => array(
				'role'     => array( 'type' => 'string' ),
				'search'   => array( 'type' => 'string' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 50' ),
			),
			'handler' => function ( $a ) {
				$users = get_users(
					array(
						'role'    => $a['role'] ?? '',
						'search'  => isset( $a['search'] ) ? '*' . $a['search'] . '*' : '',
						'number'  => (int) ( $a['per_page'] ?? 50 ),
					)
				);
				return array_map(
					function ( $u ) {
						return array(
							'id'    => $u->ID,
							'login' => $u->user_login,
							'email' => $u->user_email,
							'name'  => $u->display_name,
							'roles' => $u->roles,
						);
					},
					$users
				);
			},
		);

		$reg['create_user'] = array(
			'desc'     => 'Create a WordPress user.',
			'risk'     => 'write',
			'schema'   => array(
				'username' => array( 'type' => 'string' ),
				'email'    => array( 'type' => 'string' ),
				'password' => array( 'type' => 'string', 'description' => 'Omit to auto-generate' ),
				'role'     => array( 'type' => 'string', 'description' => 'Default: subscriber' ),
				'name'     => array( 'type' => 'string' ),
			),
			'required' => array( 'username', 'email' ),
			'handler'  => function ( $a ) {
				$id = wp_insert_user(
					array(
						'user_login'   => $a['username'],
						'user_email'   => $a['email'],
						'user_pass'    => $a['password'] ?? wp_generate_password( 16 ),
						'role'         => $a['role'] ?? 'subscriber',
						'display_name' => $a['name'] ?? $a['username'],
					)
				);
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				return array( 'user_id' => $id );
			},
		);

		$reg['update_user'] = array(
			'desc'     => 'Update a user (email, role, name, password).',
			'risk'     => 'write',
			'schema'   => array(
				'id'       => array( 'type' => 'integer' ),
				'email'    => array( 'type' => 'string' ),
				'role'     => array( 'type' => 'string' ),
				'name'     => array( 'type' => 'string' ),
				'password' => array( 'type' => 'string' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$data = array( 'ID' => (int) $a['id'] );
				if ( isset( $a['email'] ) ) {
					$data['user_email'] = $a['email'];
				}
				if ( isset( $a['role'] ) ) {
					$data['role'] = $a['role'];
				}
				if ( isset( $a['name'] ) ) {
					$data['display_name'] = $a['name'];
				}
				if ( isset( $a['password'] ) ) {
					$data['user_pass'] = $a['password'];
				}
				$res = wp_update_user( $data );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'user_id' => (int) $a['id'], 'updated' => true );
			},
		);

		$reg['delete_user'] = array(
			'desc'     => 'Delete a user by ID. Optionally reassign their content to another user.',
			'risk'     => 'destructive',
			'schema'   => array(
				'id'           => array( 'type' => 'integer' ),
				'reassign_to'  => array( 'type' => 'integer', 'description' => 'User ID to reassign content to' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				require_once ABSPATH . 'wp-admin/includes/user.php';
				$res = wp_delete_user( (int) $a['id'], isset( $a['reassign_to'] ) ? (int) $a['reassign_to'] : null );
				if ( ! $res ) {
					throw new Exception( 'Delete failed.' );
				}
				return array( 'user_id' => (int) $a['id'], 'deleted' => true );
			},
		);

		// ============================================================
		// EXTENDED USER TOOLS
		// ============================================================

		$reg['get_user'] = array(
			'desc'     => 'Fetch a single user by ID with profile meta and capabilities.',
			'risk'     => 'read',
			'schema'   => array( 'id' => array( 'type' => 'integer' ) ),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$u = get_userdata( (int) $a['id'] );
				if ( ! $u ) {
					throw new Exception( 'User not found.' );
				}
				return array(
					'id'           => $u->ID,
					'login'        => $u->user_login,
					'email'        => $u->user_email,
					'name'         => $u->display_name,
					'first_name'   => $u->first_name,
					'last_name'    => $u->last_name,
					'nickname'     => $u->nickname,
					'registered'   => $u->user_registered,
					'url'          => $u->user_url,
					'description'  => $u->description,
					'roles'        => $u->roles,
					'caps'         => array_keys( (array) $u->allcaps ),
					'meta'         => get_user_meta( $u->ID ),
				);
			},
		);

		$reg['get_current_user'] = array(
			'desc'    => 'Return the user behind the current MCP request (id, login, roles, caps).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$u = wp_get_current_user();
				if ( ! $u->exists() ) {
					return array( 'authenticated' => false );
				}
				return array(
					'authenticated' => true,
					'id'            => $u->ID,
					'login'         => $u->user_login,
					'email'         => $u->user_email,
					'name'          => $u->display_name,
					'roles'         => $u->roles,
					'caps'          => array_keys( (array) $u->allcaps ),
				);
			},
		);

		$reg['search_users'] = array(
			'desc'     => 'Search users with extended filters (login/email/nickname contains query, or by meta_key/meta_value).',
			'risk'     => 'read',
			'schema'   => array(
				'query'      => array( 'type' => 'string',  'description' => 'Search string matched against login/email/display_name' ),
				'role'       => array( 'type' => 'string' ),
				'meta_key'   => array( 'type' => 'string' ),
				'meta_value' => array( 'type' => 'string' ),
				'per_page'   => array( 'type' => 'integer', 'description' => 'Default 50' ),
			),
			'handler'  => function ( $a ) {
				$args = array( 'number' => (int) ( $a['per_page'] ?? 50 ) );
				if ( ! empty( $a['role'] ) )     { $args['role'] = $a['role']; }
				if ( ! empty( $a['query'] ) )    { $args['search'] = '*' . $a['query'] . '*'; }
				if ( ! empty( $a['meta_key'] ) ) {
					$args['meta_key']   = $a['meta_key'];
					$args['meta_value'] = $a['meta_value'] ?? '';
					$args['meta_compare'] = '=';
				}
				$users = get_users( $args );
				return array(
					'count' => count( $users ),
					'items' => array_map(
						function ( $u ) {
							return array(
								'id'    => $u->ID,
								'login' => $u->user_login,
								'email' => $u->user_email,
								'name'  => $u->display_name,
								'roles' => $u->roles,
							);
						},
						$users
					),
				);
			},
		);

		$reg['set_user_role'] = array(
			'desc'     => 'Change a single user to a specific role. Replaces all current roles.',
			'risk'     => 'write',
			'schema'   => array(
				'id'   => array( 'type' => 'integer' ),
				'role' => array( 'type' => 'string' ),
			),
			'required' => array( 'id', 'role' ),
			'handler'  => function ( $a ) {
				$id   = (int) $a['id'];
				$role = $a['role'];
				$u    = get_userdata( $id );
				if ( ! $u ) {
					throw new Exception( 'User not found.' );
				}
				if ( null === get_role( $role ) ) {
					throw new Exception( 'Role does not exist.' );
				}
				$u->set_role( $role );
				return array( 'user_id' => $id, 'role' => $role, 'updated' => true );
			},
		);

		$reg['add_user_role'] = array(
			'desc'     => 'Add a secondary role to a user (WordPress supports multi-role).',
			'risk'     => 'write',
			'schema'   => array(
				'id'   => array( 'type' => 'integer' ),
				'role' => array( 'type' => 'string' ),
			),
			'required' => array( 'id', 'role' ),
			'handler'  => function ( $a ) {
				$u = get_userdata( (int) $a['id'] );
				if ( ! $u ) {
					throw new Exception( 'User not found.' );
				}
				if ( null === get_role( $a['role'] ) ) {
					throw new Exception( 'Role does not exist.' );
				}
				$u->add_role( $a['role'] );
				return array( 'user_id' => (int) $a['id'], 'role' => $a['role'], 'roles' => $u->roles );
			},
		);

		$reg['remove_user_role'] = array(
			'desc'     => 'Remove a secondary role from a user. Will refuse to remove the last remaining role.',
			'risk'     => 'write',
			'schema'   => array(
				'id'   => array( 'type' => 'integer' ),
				'role' => array( 'type' => 'string' ),
			),
			'required' => array( 'id', 'role' ),
			'handler'  => function ( $a ) {
				$u = get_userdata( (int) $a['id'] );
				if ( ! $u ) {
					throw new Exception( 'User not found.' );
				}
				if ( ! in_array( $a['role'], $u->roles, true ) ) {
					return array( 'user_id' => (int) $a['id'], 'removed' => false, 'reason' => 'role not assigned' );
				}
				if ( count( $u->roles ) <= 1 ) {
					throw new Exception( 'Refusing to remove the last role; use set_user_role instead.' );
				}
				$u->remove_role( $a['role'] );
				return array( 'user_id' => (int) $a['id'], 'role' => $a['role'], 'removed' => true, 'roles' => $u->roles );
			},
		);

		$reg['list_user_roles'] = array(
			'desc'    => 'Enumerate every registered role plus the count of users in each role.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wp_roles;
				if ( ! ( $wp_roles instanceof WP_Roles ) ) {
					return array();
				}
				$roles = $wp_roles->role_objects;
				$out   = array();
				foreach ( $roles as $slug => $role_obj ) {
					$count = is_array( $role_obj->capabilities ) ? count( array_keys( $role_obj->capabilities ) ) : 0;
					$users_in_role = count( get_users( array( 'role' => $slug, 'fields' => 'ID' ) ) );
					$out[] = array(
						'role'         => $slug,
						'name'         => $wp_roles->role_names[ $slug ] ?? $slug,
						'capabilities' => array_keys( (array) $role_obj->capabilities ),
						'user_count'   => $users_in_role,
					);
				}
				return $out;
			},
		);

		$reg['update_user_meta'] = array(
			'desc'     => 'Set arbitrary user meta key/value pairs (adds or updates).',
			'risk'     => 'write',
			'schema'   => array(
				'id'   => array( 'type' => 'integer' ),
				'meta' => array( 'type' => 'object', 'description' => 'Key/value pairs to set' ),
			),
			'required' => array( 'id', 'meta' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['id'];
				if ( ! get_userdata( $id ) ) {
					throw new Exception( 'User not found.' );
				}
				$saved = array();
				foreach ( (array) ( $a['meta'] ?? array() ) as $k => $v ) {
					update_user_meta( $id, sanitize_key( $k ), $v );
					$saved[ $k ] = $v;
				}
				return array( 'user_id' => $id, 'saved' => $saved );
			},
		);

		$reg['delete_user_meta'] = array(
			'desc'     => 'Delete one or more meta keys from a user.',
			'risk'     => 'write',
			'schema'   => array(
				'id'   => array( 'type' => 'integer' ),
				'keys' => array( 'type' => 'array', 'description' => 'Array of meta keys to delete' ),
			),
			'required' => array( 'id', 'keys' ),
			'handler'  => function ( $a ) {
				$id = (int) $a['id'];
				if ( ! get_userdata( $id ) ) {
					throw new Exception( 'User not found.' );
				}
				$deleted = array();
				foreach ( (array) ( $a['keys'] ?? array() ) as $k ) {
					if ( delete_user_meta( $id, $k ) ) {
						$deleted[] = $k;
					}
				}
				return array( 'user_id' => $id, 'deleted' => $deleted );
			},
		);

		$reg['get_user_posts'] = array(
			'desc'     => 'List posts/pages authored by a specific user. Filter by post_type and status.',
			'risk'     => 'read',
			'schema'   => array(
				'id'        => array( 'type' => 'integer' ),
				'post_type' => array( 'type' => 'string', 'description' => 'Default: any' ),
				'status'    => array( 'type' => 'string', 'description' => 'Default: publish' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Default 50' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$q = new WP_Query( array(
					'author'         => (int) $a['id'],
					'post_type'      => $a['post_type'] ?? 'any',
					'post_status'    => $a['status'] ?? 'publish',
					'posts_per_page' => min( (int) ( $a['per_page'] ?? 50 ), 200 ),
					'orderby'        => 'date',
					'order'          => 'DESC',
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$items[] = array(
						'id'      => $p->ID,
						'title'   => $p->post_title,
						'type'    => $p->post_type,
						'status'  => $p->post_status,
						'date'    => $p->post_date,
						'link'    => get_permalink( $p->ID ),
					);
				}
				return array(
					'total' => (int) $q->found_posts,
					'items' => $items,
				);
			},
		);

		$reg['bulk_delete_users'] = array(
			'desc'     => 'Delete multiple users in one call. Optional reassign_to applies to all deletions. Useful for cleanup after audit.',
			'risk'     => 'destructive',
			'schema'   => array(
				'ids'         => array( 'type' => 'array',  'description' => 'Array of user IDs' ),
				'reassign_to' => array( 'type' => 'integer' ),
			),
			'required' => array( 'ids' ),
			'handler'  => function ( $a ) {
				require_once ABSPATH . 'wp-admin/includes/user.php';
				$reassign = isset( $a['reassign_to'] ) ? (int) $a['reassign_to'] : null;
				$results  = array();
				foreach ( (array) ( $a['ids'] ?? array() ) as $id ) {
					$id = (int) $id;
					if ( ! get_userdata( $id ) ) {
						$results[] = array( 'id' => $id, 'deleted' => false, 'reason' => 'not found' );
						continue;
					}
					$ok = wp_delete_user( $id, $reassign );
					$results[] = array( 'id' => $id, 'deleted' => (bool) $ok );
				}
				return array( 'results' => $results, 'count' => count( $results ) );
			},
		);

		$reg['user_login_exists'] = array(
			'desc'     => 'Check whether a username or email is already registered. Useful before creating users.',
			'risk'     => 'read',
			'schema'   => array(
				'username' => array( 'type' => 'string' ),
				'email'    => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$out = array();
				if ( ! empty( $a['username'] ) ) {
					$out['username_exists'] = (bool) username_exists( $a['username'] );
				}
				if ( ! empty( $a['email'] ) ) {
					$out['email_exists'] = (bool) email_exists( $a['email'] );
				}
				return $out;
			},
		);

		return $reg;
	}
}

