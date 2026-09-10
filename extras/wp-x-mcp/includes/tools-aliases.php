<?php
/**
 * WordPress core compatibility/alias tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's remaining generic WordPress core tools
 * into wp-x-mcp's procedural tool registry style. These fall into two groups:
 *
 *   1. TRUE ALIASES (7): same behavior as an existing tool under a different
 *      name, for naming-convention compatibility with clients expecting
 *      MountDev-style names: get_comments, get_users, get_media_item,
 *      update_media_item, delete_media_item, upload_image, get_nav_menus.
 *
 *   2. DISTINCT CORE TOOLS (25): genuinely new functionality not covered by
 *      wp-x-mcp's existing generic tools — page-specific wrappers
 *      (create/update/delete/get pages), category/tag-specific wrappers
 *      (create/update/delete/get categories and tags), single-term/menu
 *      getters, a whitelisted settings bundle (get/update_settings), site
 *      info, and theme/post-type/taxonomy/revision listings.
 *
 * Always-on (no plugin gate) — these are core WordPress capabilities.
 * No collisions with any existing wp-x-mcp tool (baseline or newly ported).
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Aliases {

	/* -------------------------------------------------------------------------
	 * Shared formatters.
	 * ---------------------------------------------------------------------- */

	public static function format_post( WP_Post $p ): array {
		return array(
			'id'       => $p->ID,
			'title'    => $p->post_title,
			'status'   => $p->post_status,
			'type'     => $p->post_type,
			'slug'     => $p->post_name,
			'author'   => (int) $p->post_author,
			'date'     => $p->post_date,
			'modified' => $p->post_modified,
			'link'     => get_permalink( $p->ID ),
		);
	}

	public static function format_term_full( $t ): array {
		return array(
			'id'          => $t->term_id,
			'name'        => $t->name,
			'slug'        => $t->slug,
			'taxonomy'    => $t->taxonomy,
			'parent'      => $t->parent,
			'description' => $t->description,
			'count'       => $t->count,
		);
	}

	public static function format_attachment( $post ): array {
		$meta = wp_get_attachment_metadata( $post->ID );
		return array(
			'id'          => $post->ID,
			'title'       => $post->post_title,
			'caption'     => $post->post_excerpt,
			'description' => $post->post_content,
			'alt_text'    => get_post_meta( $post->ID, '_wp_attachment_image_alt', true ),
			'mime_type'   => $post->post_mime_type,
			'url'         => wp_get_attachment_url( $post->ID ),
			'date'        => $post->post_date,
			'meta'        => $meta ?: array(),
		);
	}

	/* -------------------------------------------------------------------------
	 * Registry.
	 * ---------------------------------------------------------------------- */

	public static function all(): array {
		$reg = array();

		// ============================================================
		// Posts — search & pages wrappers (5)
		// ============================================================

		$reg['search_posts'] = array(
			'desc'     => 'Search posts by keyword.',
			'risk'     => 'read',
			'schema'   => array(
				'search_term' => array( 'type' => 'string', 'description' => 'Search term.' ),
				'post_type'   => array( 'type' => 'string', 'description' => 'Default post.' ),
				'per_page'    => array( 'type' => 'integer', 'description' => 'Default 10.' ),
			),
			'required' => array( 'search_term' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['search_term'] ) ) {
					throw new Exception( 'Search term is required.' );
				}
				$q = new WP_Query( array(
					's'              => sanitize_text_field( $a['search_term'] ),
					'post_type'      => isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : 'post',
					'posts_per_page' => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10,
					'post_status'    => 'publish',
				) );
				return array(
					'posts' => array_map( array( 'WPXMCP_Tools_Aliases', 'format_post' ), $q->posts ),
					'total' => $q->found_posts,
				);
			},
		);

		$reg['get_posts'] = array(
			'desc'    => 'Alias for list_posts — retrieve a list of posts.',
			'risk'    => 'read',
			'schema'  => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Default post.' ),
				'status'    => array( 'type' => 'string', 'description' => 'Default publish.' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Default 10.' ),
				'page'      => array( 'type' => 'integer', 'description' => 'Default 1.' ),
			),
			'handler' => function ( $a ) {
				$q = new WP_Query( array(
					'post_type'      => isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : 'post',
					'post_status'    => isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'publish',
					'posts_per_page' => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10,
					'paged'          => isset( $a['page'] ) ? absint( $a['page'] ) : 1,
				) );
				return array(
					'total'       => (int) $q->found_posts,
					'total_pages' => (int) $q->max_num_pages,
					'items'       => array_map( array( 'WPXMCP_Tools_Aliases', 'format_post' ), $q->posts ),
				);
			},
		);

		$reg['get_pages'] = array(
			'desc'    => 'Get a list of pages.',
			'risk'    => 'read',
			'schema'  => array(
				'status'   => array( 'type' => 'string', 'description' => 'Default publish.' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
			),
			'handler' => function ( $a ) {
				$q = new WP_Query( array(
					'post_type'      => 'page',
					'post_status'    => $a['status'] ?? 'publish',
					'posts_per_page' => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10,
					'paged'          => isset( $a['page'] ) ? absint( $a['page'] ) : 1,
				) );
				return array(
					'total'       => (int) $q->found_posts,
					'total_pages' => (int) $q->max_num_pages,
					'items'       => array_map( array( 'WPXMCP_Tools_Aliases', 'format_post' ), $q->posts ),
				);
			},
		);

		$reg['create_page'] = array(
			'desc'     => 'Create a new page.',
			'risk'     => 'write',
			'schema'   => array(
				'title'   => array( 'type' => 'string', 'description' => 'Page title.' ),
				'content' => array( 'type' => 'string', 'description' => 'Page content.' ),
				'status'  => array( 'type' => 'string', 'description' => 'Default draft.' ),
				'parent'  => array( 'type' => 'integer', 'description' => 'Parent page ID.' ),
			),
			'required' => array( 'title', 'content' ),
			'handler'  => function ( $a ) {
				$id = wp_insert_post( array(
					'post_title'   => sanitize_text_field( $a['title'] ),
					'post_content' => $a['content'],
					'post_type'    => 'page',
					'post_status'  => $a['status'] ?? 'draft',
					'post_parent'  => isset( $a['parent'] ) ? absint( $a['parent'] ) : 0,
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				return array( 'id' => $id, 'link' => get_permalink( $id ), 'status' => get_post_status( $id ) );
			},
		);

		$reg['update_page'] = array(
			'desc'     => 'Update an existing page.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Page ID.' ),
				'title'   => array( 'type' => 'string', 'description' => 'Page title.' ),
				'content' => array( 'type' => 'string', 'description' => 'Page content.' ),
				'status'  => array( 'type' => 'string', 'description' => 'Page status.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = absint( $a['post_id'] );
				$post    = get_post( $post_id );
				if ( ! $post || 'page' !== $post->post_type ) {
					throw new Exception( 'Page not found.' );
				}
				$data = array( 'ID' => $post_id );
				if ( isset( $a['title'] ) )   $data['post_title'] = sanitize_text_field( $a['title'] );
				if ( isset( $a['content'] ) ) $data['post_content'] = $a['content'];
				if ( isset( $a['status'] ) )  $data['post_status'] = sanitize_key( $a['status'] );
				$res = wp_update_post( $data, true );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				return array( 'id' => $post_id, 'updated' => true, 'link' => get_permalink( $post_id ) );
			},
		);

		$reg['delete_page'] = array(
			'desc'     => 'Delete a page.',
			'risk'     => 'destructive',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer', 'description' => 'Page ID.' ),
				'force_delete' => array( 'type' => 'boolean', 'description' => 'Bypass trash. Default false.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = absint( $a['post_id'] );
				$post    = get_post( $post_id );
				if ( ! $post || 'page' !== $post->post_type ) {
					throw new Exception( 'Page not found.' );
				}
				$force = ! empty( $a['force_delete'] );
				$res   = wp_delete_post( $post_id, $force );
				if ( ! $res ) {
					throw new Exception( 'Delete failed.' );
				}
				return array( 'id' => $post_id, 'deleted' => true, 'forced' => $force );
			},
		);

		// ============================================================
		// Taxonomy — single-term getter + category/tag wrappers (9)
		// ============================================================

		$reg['get_term'] = array(
			'desc'     => 'Get a single taxonomy term by ID.',
			'risk'     => 'read',
			'schema'   => array(
				'term_id'  => array( 'type' => 'integer', 'description' => 'Term ID.' ),
				'taxonomy' => array( 'type' => 'string', 'description' => 'Default category.' ),
			),
			'required' => array( 'term_id' ),
			'handler'  => function ( $a ) {
				$taxonomy = isset( $a['taxonomy'] ) ? sanitize_key( $a['taxonomy'] ) : 'category';
				$term     = get_term( absint( $a['term_id'] ), $taxonomy );
				if ( is_wp_error( $term ) ) {
					throw new Exception( $term->get_error_message() );
				}
				if ( ! $term ) {
					throw new Exception( 'Term not found.' );
				}
				return WPXMCP_Tools_Aliases::format_term_full( $term );
			},
		);

		$reg['get_categories'] = array(
			'desc'    => 'Get all categories.',
			'risk'    => 'read',
			'schema'  => array(
				'hide_empty' => array( 'type' => 'boolean', 'description' => 'Default false.' ),
				'search'     => array( 'type' => 'string' ),
			),
			'handler' => function ( $a ) {
				$ta = array( 'taxonomy' => 'category', 'hide_empty' => ! empty( $a['hide_empty'] ) );
				if ( ! empty( $a['search'] ) ) $ta['search'] = sanitize_text_field( $a['search'] );
				$terms = get_terms( $ta );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				return array( 'terms' => array_map( array( 'WPXMCP_Tools_Aliases', 'format_term_full' ), $terms ), 'total' => count( $terms ) );
			},
		);

		$reg['create_category'] = array(
			'desc'     => 'Create a new category.',
			'risk'     => 'write',
			'schema'   => array(
				'name'        => array( 'type' => 'string' ),
				'slug'        => array( 'type' => 'string' ),
				'parent'      => array( 'type' => 'integer' ),
				'description' => array( 'type' => 'string' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$ta = array();
				if ( isset( $a['slug'] ) )        $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['parent'] ) )       $ta['parent'] = absint( $a['parent'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );
				$result = wp_insert_term( sanitize_text_field( $a['name'] ), 'category', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array( 'success' => true, 'term' => WPXMCP_Tools_Aliases::format_term_full( get_term( $result['term_id'], 'category' ) ) );
			},
		);

		$reg['update_category'] = array(
			'desc'     => 'Update an existing category.',
			'risk'     => 'write',
			'schema'   => array(
				'term_id'     => array( 'type' => 'integer' ),
				'name'        => array( 'type' => 'string' ),
				'description' => array( 'type' => 'string' ),
				'parent'      => array( 'type' => 'integer' ),
			),
			'required' => array( 'term_id' ),
			'handler'  => function ( $a ) {
				$term_id = absint( $a['term_id'] );
				$ta = array();
				if ( isset( $a['name'] ) )         $ta['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['description'] ) )   $ta['description'] = sanitize_textarea_field( $a['description'] );
				if ( isset( $a['parent'] ) )         $ta['parent'] = absint( $a['parent'] );
				$result = wp_update_term( $term_id, 'category', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array( 'success' => true, 'term' => WPXMCP_Tools_Aliases::format_term_full( get_term( $term_id, 'category' ) ) );
			},
		);

		$reg['delete_category'] = array(
			'desc'     => 'Delete a category.',
			'risk'     => 'destructive',
			'schema'   => array(
				'term_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'term_id' ),
			'handler'  => function ( $a ) {
				$result = wp_delete_term( absint( $a['term_id'] ), 'category' );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete category.' );
				}
				return array( 'success' => true, 'message' => 'Category deleted successfully.' );
			},
		);

		$reg['get_tags'] = array(
			'desc'    => 'Get all tags.',
			'risk'    => 'read',
			'schema'  => array(
				'hide_empty' => array( 'type' => 'boolean', 'description' => 'Default false.' ),
				'search'     => array( 'type' => 'string' ),
			),
			'handler' => function ( $a ) {
				$ta = array( 'taxonomy' => 'post_tag', 'hide_empty' => ! empty( $a['hide_empty'] ) );
				if ( ! empty( $a['search'] ) ) $ta['search'] = sanitize_text_field( $a['search'] );
				$terms = get_terms( $ta );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				return array( 'terms' => array_map( array( 'WPXMCP_Tools_Aliases', 'format_term_full' ), $terms ), 'total' => count( $terms ) );
			},
		);

		$reg['create_tag'] = array(
			'desc'     => 'Create a new tag.',
			'risk'     => 'write',
			'schema'   => array(
				'name'        => array( 'type' => 'string' ),
				'slug'        => array( 'type' => 'string' ),
				'description' => array( 'type' => 'string' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$ta = array();
				if ( isset( $a['slug'] ) )        $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );
				$result = wp_insert_term( sanitize_text_field( $a['name'] ), 'post_tag', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array( 'success' => true, 'term' => WPXMCP_Tools_Aliases::format_term_full( get_term( $result['term_id'], 'post_tag' ) ) );
			},
		);

		$reg['update_tag'] = array(
			'desc'     => 'Update an existing tag.',
			'risk'     => 'write',
			'schema'   => array(
				'term_id'     => array( 'type' => 'integer' ),
				'name'        => array( 'type' => 'string' ),
				'description' => array( 'type' => 'string' ),
			),
			'required' => array( 'term_id' ),
			'handler'  => function ( $a ) {
				$term_id = absint( $a['term_id'] );
				$ta = array();
				if ( isset( $a['name'] ) )        $ta['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );
				$result = wp_update_term( $term_id, 'post_tag', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array( 'success' => true, 'term' => WPXMCP_Tools_Aliases::format_term_full( get_term( $term_id, 'post_tag' ) ) );
			},
		);

		$reg['delete_tag'] = array(
			'desc'     => 'Delete a tag.',
			'risk'     => 'destructive',
			'schema'   => array(
				'term_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'term_id' ),
			'handler'  => function ( $a ) {
				$result = wp_delete_term( absint( $a['term_id'] ), 'post_tag' );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete tag.' );
				}
				return array( 'success' => true, 'message' => 'Tag deleted successfully.' );
			},
		);

		// ============================================================
		// Media — distinct richer-shape tools + true aliases (7)
		// ============================================================

		$reg['get_media'] = array(
			'desc'     => 'Get a single media attachment by ID, with full attachment metadata.',
			'risk'     => 'read',
			'schema'   => array(
				'attachment_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'attachment_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( absint( $a['attachment_id'] ) );
				if ( ! $post || 'attachment' !== $post->post_type ) {
					throw new Exception( 'Attachment not found.' );
				}
				return WPXMCP_Tools_Aliases::format_attachment( $post );
			},
		);

		$reg['get_media_item'] = array(
			'desc'     => 'Alias for get_media — get a single media item by ID.',
			'risk'     => 'read',
			'schema'   => array(
				'attachment_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'attachment_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( absint( $a['attachment_id'] ) );
				if ( ! $post || 'attachment' !== $post->post_type ) {
					throw new Exception( 'Attachment not found.' );
				}
				return WPXMCP_Tools_Aliases::format_attachment( $post );
			},
		);

		$reg['update_media'] = array(
			'desc'     => 'Update media item metadata: title, caption, description, alt text.',
			'risk'     => 'write',
			'schema'   => array(
				'attachment_id' => array( 'type' => 'integer' ),
				'title'         => array( 'type' => 'string' ),
				'caption'       => array( 'type' => 'string' ),
				'description'   => array( 'type' => 'string' ),
				'alt_text'      => array( 'type' => 'string' ),
			),
			'required' => array( 'attachment_id' ),
			'handler'  => function ( $a ) {
				$id   = absint( $a['attachment_id'] );
				$post = get_post( $id );
				if ( ! $post || 'attachment' !== $post->post_type ) {
					throw new Exception( 'Attachment not found.' );
				}
				$data = array( 'ID' => $id );
				if ( isset( $a['title'] ) )       $data['post_title'] = sanitize_text_field( $a['title'] );
				if ( isset( $a['caption'] ) )      $data['post_excerpt'] = sanitize_text_field( $a['caption'] );
				if ( isset( $a['description'] ) )  $data['post_content'] = sanitize_textarea_field( $a['description'] );
				if ( count( $data ) > 1 ) {
					$res = wp_update_post( $data, true );
					if ( is_wp_error( $res ) ) {
						throw new Exception( $res->get_error_message() );
					}
				}
				if ( isset( $a['alt_text'] ) ) {
					update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $a['alt_text'] ) );
				}
				return array( 'success' => true, 'attachment' => WPXMCP_Tools_Aliases::format_attachment( get_post( $id ) ) );
			},
		);

		$reg['update_media_item'] = array(
			'desc'     => 'Alias for update_media — update media item metadata.',
			'risk'     => 'write',
			'schema'   => array(
				'attachment_id' => array( 'type' => 'integer' ),
				'title'         => array( 'type' => 'string' ),
				'caption'       => array( 'type' => 'string' ),
				'description'   => array( 'type' => 'string' ),
				'alt_text'      => array( 'type' => 'string' ),
			),
			'required' => array( 'attachment_id' ),
			'handler'  => function ( $a ) {
				$id   = absint( $a['attachment_id'] );
				$post = get_post( $id );
				if ( ! $post || 'attachment' !== $post->post_type ) {
					throw new Exception( 'Attachment not found.' );
				}
				$data = array( 'ID' => $id );
				if ( isset( $a['title'] ) )       $data['post_title'] = sanitize_text_field( $a['title'] );
				if ( isset( $a['caption'] ) )      $data['post_excerpt'] = sanitize_text_field( $a['caption'] );
				if ( isset( $a['description'] ) )  $data['post_content'] = sanitize_textarea_field( $a['description'] );
				if ( count( $data ) > 1 ) {
					$res = wp_update_post( $data, true );
					if ( is_wp_error( $res ) ) {
						throw new Exception( $res->get_error_message() );
					}
				}
				if ( isset( $a['alt_text'] ) ) {
					update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $a['alt_text'] ) );
				}
				return array( 'success' => true, 'attachment' => WPXMCP_Tools_Aliases::format_attachment( get_post( $id ) ) );
			},
		);

		$reg['delete_media_item'] = array(
			'desc'     => 'Alias for delete_media — delete a media item.',
			'risk'     => 'destructive',
			'schema'   => array(
				'attachment_id' => array( 'type' => 'integer' ),
				'force_delete'  => array( 'type' => 'boolean', 'description' => 'Default false.' ),
			),
			'required' => array( 'attachment_id' ),
			'handler'  => function ( $a ) {
				$id   = absint( $a['attachment_id'] );
				$post = get_post( $id );
				if ( ! $post || 'attachment' !== $post->post_type ) {
					throw new Exception( 'Attachment not found.' );
				}
				$force = ! empty( $a['force_delete'] );
				$res   = wp_delete_attachment( $id, $force );
				if ( ! $res ) {
					throw new Exception( 'Failed to delete attachment.' );
				}
				return array( 'success' => true, 'message' => 'Media deleted successfully.' );
			},
		);

		$reg['upload_image'] = array(
			'desc'     => 'Alias for media upload — upload an image to the media library from base64 file data.',
			'risk'     => 'write',
			'schema'   => array(
				'file_data' => array( 'type' => 'string', 'description' => 'Base64-encoded file content (optionally with data URI prefix).' ),
				'filename'  => array( 'type' => 'string' ),
				'alt_text'  => array( 'type' => 'string' ),
				'caption'   => array( 'type' => 'string' ),
			),
			'required' => array( 'file_data', 'filename' ),
			'handler'  => function ( $a ) {
				$file_data = $a['file_data'];
				$filename  = sanitize_file_name( $a['filename'] );

				if ( strpos( $file_data, 'base64,' ) !== false ) {
					$file_data = substr( $file_data, strpos( $file_data, 'base64,' ) + 7 );
				}
				$decoded = base64_decode( $file_data, true );
				if ( false === $decoded ) {
					throw new Exception( 'Invalid base64 file data.' );
				}

				require_once ABSPATH . 'wp-admin/includes/file.php';
				$upload = wp_upload_bits( $filename, null, $decoded );
				if ( $upload['error'] ) {
					throw new Exception( $upload['error'] );
				}

				$file_type = wp_check_filetype( $filename, null );
				$id = wp_insert_attachment( array(
					'post_mime_type' => $file_type['type'],
					'post_title'     => sanitize_file_name( pathinfo( $filename, PATHINFO_FILENAME ) ),
					'post_content'   => '',
					'post_status'    => 'inherit',
				), $upload['file'] );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}

				require_once ABSPATH . 'wp-admin/includes/image.php';
				wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );

				if ( isset( $a['alt_text'] ) ) update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $a['alt_text'] ) );
				if ( isset( $a['caption'] ) )  wp_update_post( array( 'ID' => $id, 'post_excerpt' => sanitize_text_field( $a['caption'] ) ) );

				return array( 'success' => true, 'attachment' => WPXMCP_Tools_Aliases::format_attachment( get_post( $id ) ) );
			},
		);

		$reg['upload_image_from_url'] = array(
			'desc'     => 'Upload an image from a URL to the media library.',
			'risk'     => 'write',
			'schema'   => array(
				'url'      => array( 'type' => 'string', 'description' => 'Source image URL.' ),
				'filename' => array( 'type' => 'string', 'description' => 'Defaults to basename of URL.' ),
				'alt_text' => array( 'type' => 'string' ),
				'caption'  => array( 'type' => 'string' ),
			),
			'required' => array( 'url' ),
			'handler'  => function ( $a ) {
				$url = esc_url_raw( $a['url'] );
				if ( ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
					throw new Exception( 'Invalid URL provided.' );
				}

				require_once ABSPATH . 'wp-admin/includes/file.php';
				require_once ABSPATH . 'wp-admin/includes/media.php';
				require_once ABSPATH . 'wp-admin/includes/image.php';

				$tmp = download_url( $url );
				if ( is_wp_error( $tmp ) ) {
					throw new Exception( $tmp->get_error_message() );
				}

				$filename = isset( $a['filename'] ) ? sanitize_file_name( $a['filename'] ) : basename( $url );
				$id = media_handle_sideload( array( 'name' => $filename, 'tmp_name' => $tmp ), 0 );
				if ( is_wp_error( $id ) ) {
					@unlink( $tmp );
					throw new Exception( $id->get_error_message() );
				}

				if ( isset( $a['alt_text'] ) ) update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $a['alt_text'] ) );
				if ( isset( $a['caption'] ) )  wp_update_post( array( 'ID' => $id, 'post_excerpt' => sanitize_text_field( $a['caption'] ) ) );

				return array( 'success' => true, 'attachment' => WPXMCP_Tools_Aliases::format_attachment( get_post( $id ) ) );
			},
		);

		// ============================================================
		// Menus — single getter + create + true alias (3)
		// ============================================================

		$reg['get_menus'] = array(
			'desc'    => 'Get all navigation menus.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$menus = wp_get_nav_menus();
				$out   = array();
				foreach ( $menus as $m ) {
					$out[] = array( 'id' => $m->term_id, 'name' => $m->name, 'slug' => $m->slug, 'count' => $m->count );
				}
				return array( 'menus' => $out, 'total' => count( $out ) );
			},
		);

		$reg['get_nav_menus'] = array(
			'desc'    => 'Alias for get_menus — get all navigation menus.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$menus = wp_get_nav_menus();
				$out   = array();
				foreach ( $menus as $m ) {
					$out[] = array( 'id' => $m->term_id, 'name' => $m->name, 'slug' => $m->slug, 'count' => $m->count );
				}
				return array( 'menus' => $out, 'total' => count( $out ) );
			},
		);

		$reg['get_menu'] = array(
			'desc'     => 'Get a single navigation menu by ID, including its items.',
			'risk'     => 'read',
			'schema'   => array(
				'menu_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'menu_id' ),
			'handler'  => function ( $a ) {
				$menu_id = absint( $a['menu_id'] );
				$menu    = wp_get_nav_menu_object( $menu_id );
				if ( ! $menu ) {
					throw new Exception( 'Menu not found.' );
				}
				$items     = wp_get_nav_menu_items( $menu_id );
				$formatted = array();
				if ( $items ) {
					foreach ( $items as $item ) {
						$formatted[] = array(
							'id'        => $item->ID,
							'title'     => $item->title,
							'url'       => $item->url,
							'target'    => $item->target,
							'classes'   => $item->classes,
							'parent'    => $item->menu_item_parent,
							'order'     => $item->menu_order,
							'type'      => $item->type,
							'object'    => $item->object,
							'object_id' => $item->object_id,
						);
					}
				}
				return array(
					'id'    => $menu->term_id,
					'name'  => $menu->name,
					'slug'  => $menu->slug,
					'count' => $menu->count,
					'items' => $formatted,
				);
			},
		);

		$reg['create_nav_menu'] = array(
			'desc'     => 'Create a new navigation menu.',
			'risk'     => 'write',
			'schema'   => array(
				'menu_name' => array( 'type' => 'string' ),
			),
			'required' => array( 'menu_name' ),
			'handler'  => function ( $a ) {
				$name    = sanitize_text_field( $a['menu_name'] );
				$menu_id = wp_create_nav_menu( $name );
				if ( is_wp_error( $menu_id ) ) {
					throw new Exception( $menu_id->get_error_message() );
				}
				$menu = wp_get_nav_menu_object( $menu_id );
				return array(
					'success' => true,
					'message' => 'Navigation menu created successfully.',
					'menu'    => array( 'id' => $menu->term_id, 'name' => $menu->name, 'slug' => $menu->slug ),
				);
			},
		);

		// ============================================================
		// Comments / Users — true aliases (2)
		// ============================================================

		$reg['get_comments'] = array(
			'desc'    => 'Alias for list_comments — list comments with optional filters (post_id, status, pagination).',
			'risk'    => 'read',
			'schema'  => array(
				'post_id'  => array( 'type' => 'integer' ),
				'status'   => array( 'type' => 'string', 'description' => 'approve | hold | spam | trash | all.' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 20.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
			),
			'handler' => function ( $a ) {
				$ca = array(
					'number' => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 20,
					'offset' => ( ( isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1 ) - 1 ) * ( isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 20 ),
				);
				if ( isset( $a['post_id'] ) ) $ca['post_id'] = absint( $a['post_id'] );
				if ( isset( $a['status'] ) && 'all' !== $a['status'] ) $ca['status'] = sanitize_key( $a['status'] );

				$comments = get_comments( $ca );
				$out = array();
				foreach ( $comments as $c ) {
					$out[] = array(
						'id'           => (int) $c->comment_ID,
						'post_id'      => (int) $c->comment_post_ID,
						'author'       => $c->comment_author,
						'author_email' => $c->comment_author_email,
						'content'      => $c->comment_content,
						'date'         => $c->comment_date,
						'status'       => wp_get_comment_status( $c->comment_ID ),
					);
				}
				return array( 'comments' => $out, 'total' => count( $out ) );
			},
		);

		$reg['get_users'] = array(
			'desc'    => 'Alias for list_users — list users with optional filters and pagination.',
			'risk'    => 'read',
			'schema'  => array(
				'role'     => array( 'type' => 'string' ),
				'search'   => array( 'type' => 'string' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
			),
			'handler' => function ( $a ) {
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;
				$ua = array(
					'number' => $per_page,
					'offset' => ( $page - 1 ) * $per_page,
				);
				if ( ! empty( $a['role'] ) )   $ua['role'] = sanitize_key( $a['role'] );
				if ( ! empty( $a['search'] ) ) $ua['search'] = '*' . sanitize_text_field( $a['search'] ) . '*';

				$users = get_users( $ua );
				$out = array();
				foreach ( $users as $u ) {
					$out[] = array( 'id' => $u->ID, 'login' => $u->user_login, 'email' => $u->user_email, 'name' => $u->display_name, 'roles' => $u->roles );
				}
				return array( 'users' => $out, 'total' => count( $out ) );
			},
		);

		// ============================================================
		// Site settings bundle + info + themes (3)
		// ============================================================

		$reg['get_settings'] = array(
			'desc'    => 'Get WordPress settings including homepage display options (show_on_front, page_on_front, page_for_posts) and other core site settings, from a fixed allowlist.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$keys = array(
					'blogname', 'blogdescription', 'admin_email', 'timezone_string', 'date_format', 'time_format',
					'posts_per_page', 'default_post_category', 'default_comment_status', 'default_ping_status',
					'show_on_front', 'page_on_front', 'page_for_posts', 'posts_per_rss', 'rss_use_excerpt', 'blog_public',
				);
				$settings = array();
				foreach ( $keys as $k ) {
					$settings[ $k ] = get_option( $k );
				}
				return array( 'settings' => $settings );
			},
		);

		$reg['update_settings'] = array(
			'desc'    => 'Update WordPress settings including homepage display options (show_on_front, page_on_front, page_for_posts). Only allowlisted keys are accepted; others are reported as failed.',
			'risk'    => 'write',
			'schema'  => array(
				'settings' => array( 'type' => 'object', 'description' => 'Map of option_name => value. Allowlisted keys: blogname, blogdescription, admin_email, timezone_string, date_format, time_format, posts_per_page, default_post_category, default_comment_status, default_ping_status, show_on_front, page_on_front, page_for_posts, posts_per_rss, rss_use_excerpt, blog_public.' ),
			),
			'required' => array( 'settings' ),
			'handler' => function ( $a ) {
				if ( ! is_array( $a['settings'] ) ) {
					throw new Exception( 'Settings object is required.' );
				}
				$allowlist = array(
					'blogname', 'blogdescription', 'admin_email', 'timezone_string', 'date_format', 'time_format',
					'posts_per_page', 'default_post_category', 'default_comment_status', 'default_ping_status',
					'show_on_front', 'page_on_front', 'page_for_posts', 'posts_per_rss', 'rss_use_excerpt', 'blog_public',
				);
				$updated = array();
				$failed  = array();
				foreach ( $a['settings'] as $key => $value ) {
					$key = sanitize_key( $key );
					if ( ! in_array( $key, $allowlist, true ) ) {
						$failed[ $key ] = 'Not whitelisted';
						continue;
					}
					$result = update_option( $key, $value );
					if ( $result || get_option( $key ) === $value ) {
						$updated[ $key ] = $value;
					} else {
						$failed[ $key ] = 'Update failed';
					}
				}
				return array(
					'success' => true,
					'message' => 'Updated ' . count( $updated ) . ' settings, ' . count( $failed ) . ' failed.',
					'updated' => $updated,
					'failed'  => $failed,
				);
			},
		);

		$reg['get_site_info'] = array(
			'desc'    => 'Get general site information: name, description, URL, admin email, language, version, charset, timezone, date/time formats, multisite flag.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				return array(
					'name'         => get_bloginfo( 'name' ),
					'description'  => get_bloginfo( 'description' ),
					'url'          => get_bloginfo( 'url' ),
					'admin_email'  => get_bloginfo( 'admin_email' ),
					'language'     => get_bloginfo( 'language' ),
					'version'      => get_bloginfo( 'version' ),
					'charset'      => get_bloginfo( 'charset' ),
					'timezone'     => get_option( 'timezone_string' ),
					'date_format'  => get_option( 'date_format' ),
					'time_format'  => get_option( 'time_format' ),
					'is_multisite' => is_multisite(),
				);
			},
		);

		$reg['get_themes'] = array(
			'desc'    => 'Get all installed themes with full metadata (URIs, author, version, template/stylesheet, active flag).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$current = wp_get_theme();
				$out     = array();
				foreach ( wp_get_themes() as $theme ) {
					$out[] = array(
						'name'        => $theme->get( 'Name' ),
						'theme_uri'   => $theme->get( 'ThemeURI' ),
						'description' => $theme->get( 'Description' ),
						'author'      => $theme->get( 'Author' ),
						'author_uri'  => $theme->get( 'AuthorURI' ),
						'version'     => $theme->get( 'Version' ),
						'template'    => $theme->get_template(),
						'stylesheet'  => $theme->get_stylesheet(),
						'is_active'   => $theme->get_stylesheet() === $current->get_stylesheet(),
					);
				}
				return array( 'themes' => $out, 'total' => count( $out ) );
			},
		);

		return $reg;
	}
}
