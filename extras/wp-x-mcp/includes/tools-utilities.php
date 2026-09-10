<?php
/**
 * Utility tools for WP x MCP.
 *
 * Ports the small "missing pieces" tool set from MountDev AI MCP Connector
 * into wp-x-mcp's procedural tool registry style.
 *
 * 13 tools across five themes:
 *   Connectivity & HTTP:   ping, fetch, search
 *   Schema introspection:  get_post_types, get_taxonomies
 *   Post extras:           delete_post_meta, get_post_revisions, restore_post_revision
 *   Taxonomy extras:       assign_terms
 *   User extras:           get_user_meta, list_roles, check_capability
 *   Site extras:           get_site_health
 *
 * SECURITY NOTE on `fetch`: this tool can make outbound HTTP requests via
 * wp_remote_request() through the site. There is NO SSRF allowlist —
 * private IPs and internal services are reachable. This matches MountDev's
 * original behaviour and is consistent with wp-x-mcp's "full control"
 * stance (db_query also has no sandbox), but operators with sensitive
 * internal services should be aware.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Utilities {

	public static function all(): array {
		$reg = array();

		// ============================================================
		// CONNECTIVITY & HTTP
		// ============================================================

		$reg['ping'] = array(
			'desc'    => 'Ping the MCP server to verify it is alive. Returns server timestamp and WordPress version.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				return array(
					'success'   => true,
					'message'   => 'Pong! MCP server is alive.',
					'timestamp' => current_time( 'mysql' ),
					'version'   => get_bloginfo( 'version' ),
				);
			},
		);

		$reg['fetch'] = array(
			'desc'     => 'Fetch a URL via WordPress wp_remote_request (supports GET and POST). NOTE: no SSRF allowlist — can reach internal/private hosts.',
			'risk'     => 'read',
			'schema'   => array(
				'url'     => array( 'type' => 'string', 'description' => 'URL to fetch.' ),
				'method'  => array( 'type' => 'string', 'description' => 'HTTP method (GET or POST). Default GET.' ),
				'headers' => array( 'type' => 'object', 'description' => 'HTTP headers as a key-value object.' ),
				'body'    => array( 'description' => 'Request body (used only for POST).' ),
			),
			'required' => array( 'url' ),
			'handler'  => function ( $a ) {
				$url     = esc_url_raw( $a['url'] );
				$method  = isset( $a['method'] ) ? strtoupper( sanitize_text_field( $a['method'] ) ) : 'GET';
				$headers = isset( $a['headers'] ) && is_array( $a['headers'] ) ? $a['headers'] : array();
				$body    = isset( $a['body'] ) ? $a['body'] : null;

				if ( ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
					throw new Exception( 'Invalid URL provided.' );
				}

				$request_args = array(
					'method'  => $method,
					'headers' => $headers,
					'timeout' => 30,
				);

				if ( 'POST' === $method && null !== $body ) {
					$request_args['body'] = $body;
				}

				$response = wp_remote_request( $url, $request_args );

				if ( is_wp_error( $response ) ) {
					throw new Exception( $response->get_error_message() );
				}

				$status_code      = wp_remote_retrieve_response_code( $response );
				$response_body    = wp_remote_retrieve_body( $response );
				$response_headers = wp_remote_retrieve_headers( $response );

				// WP_HTTP_Requests_Response_Headers has getAll(); array doesn't.
				if ( is_object( $response_headers ) && method_exists( $response_headers, 'getAll' ) ) {
					$response_headers = $response_headers->getAll();
				} elseif ( ! is_array( $response_headers ) ) {
					$response_headers = (array) $response_headers;
				}

				return array(
					'success'     => true,
					'status_code' => $status_code,
					'headers'     => $response_headers,
					'body'        => $response_body,
				);
			},
		);

		$reg['search'] = array(
			'desc'     => 'Search WordPress published content (posts, pages, or any post type) by free-text query. Distinct from list_posts which is structured filtering.',
			'risk'     => 'read',
			'schema'   => array(
				'query'     => array( 'type' => 'string', 'description' => 'Search query string.' ),
				'post_type' => array( 'type' => 'string', 'description' => 'Post type to search. Default any.' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Number of results. Default 10.' ),
			),
			'required' => array( 'query' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['query'] ) ) {
					throw new Exception( 'Search query is required.' );
				}

				$query_args = array(
					's'              => sanitize_text_field( $a['query'] ),
					'post_type'      => isset( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : 'any',
					'posts_per_page' => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10,
					'post_status'    => 'publish',
				);

				$query   = new WP_Query( $query_args );
				$results = array();

				if ( $query->have_posts() ) {
					while ( $query->have_posts() ) {
						$query->the_post();
						$results[] = array(
							'id'        => get_the_ID(),
							'title'     => get_the_title(),
							'excerpt'   => get_the_excerpt(),
							'type'      => get_post_type(),
							'permalink' => get_permalink(),
							'date'      => get_the_date( 'c' ),
						);
					}
					wp_reset_postdata();
				}

				return array(
					'results' => $results,
					'total'   => (int) $query->found_posts,
				);
			},
		);

		// ============================================================
		// SCHEMA INTROSPECTION
		// ============================================================

		$reg['get_post_types'] = array(
			'desc'    => 'List all registered post types with their labels, hierarchy flag, archive support, and feature supports.',
			'risk'    => 'read',
			'schema'  => array(
				'public_only' => array( 'type' => 'boolean', 'description' => 'Return only public post types. Default true.' ),
			),
			'handler' => function ( $a ) {
				$public_only = isset( $a['public_only'] ) ? (bool) $a['public_only'] : true;

				$post_types = get_post_types( array( 'public' => $public_only ), 'objects' );

				$formatted = array();
				foreach ( $post_types as $pt ) {
					$formatted[] = array(
						'name'         => $pt->name,
						'label'        => $pt->label,
						'labels'       => (array) $pt->labels,
						'description'  => $pt->description,
						'public'       => $pt->public,
						'hierarchical' => $pt->hierarchical,
						'has_archive'  => $pt->has_archive,
						'supports'     => get_all_post_type_supports( $pt->name ),
					);
				}

				return array(
					'post_types' => $formatted,
					'total'      => count( $formatted ),
				);
			},
		);

		$reg['get_taxonomies'] = array(
			'desc'    => 'List all registered taxonomies with their labels, hierarchy flag, and the object types they attach to.',
			'risk'    => 'read',
			'schema'  => array(
				'public_only' => array( 'type' => 'boolean', 'description' => 'Return only public taxonomies. Default true.' ),
			),
			'handler' => function ( $a ) {
				$public_only = isset( $a['public_only'] ) ? (bool) $a['public_only'] : true;

				$taxonomies = get_taxonomies( array( 'public' => $public_only ), 'objects' );

				$formatted = array();
				foreach ( $taxonomies as $tax ) {
					$formatted[] = array(
						'name'         => $tax->name,
						'label'        => $tax->label,
						'labels'       => (array) $tax->labels,
						'description'  => $tax->description,
						'public'       => $tax->public,
						'hierarchical' => $tax->hierarchical,
						'show_ui'      => $tax->show_ui,
						'object_types' => $tax->object_type,
					);
				}

				return array(
					'taxonomies' => $formatted,
					'total'      => count( $formatted ),
				);
			},
		);

		// ============================================================
		// POST EXTRAS
		// ============================================================

		$reg['delete_post_meta'] = array(
			'desc'     => 'Delete a single post meta key. Companion to existing get_post_meta and update_post_meta.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'meta_key' => array( 'type' => 'string', 'description' => 'Meta key to delete.' ),
			),
			'required' => array( 'post_id', 'meta_key' ),
			'handler'  => function ( $a ) {
				$post_id = absint( $a['post_id'] );
				$post    = get_post( $post_id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}

				$meta_key = sanitize_key( $a['meta_key'] );
				$result   = delete_post_meta( $post_id, $meta_key );

				if ( ! $result ) {
					throw new Exception( 'Failed to delete post meta (key may not exist).' );
				}

				return array(
					'success'  => true,
					'post_id'  => $post_id,
					'meta_key' => $meta_key,
				);
			},
		);

		$reg['get_post_revisions'] = array(
			'desc'     => 'Get all revisions for a post (id, date, author).',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Post ID.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post_id = absint( $a['post_id'] );
				$post    = get_post( $post_id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}

				$revisions = wp_get_post_revisions( $post_id );

				$formatted = array();
				foreach ( $revisions as $rev ) {
					$formatted[] = array(
						'id'       => $rev->ID,
						'date'     => $rev->post_date,
						'modified' => $rev->post_modified,
						'author'   => get_the_author_meta( 'display_name', $rev->post_author ),
					);
				}

				return array(
					'revisions' => $formatted,
					'total'     => count( $formatted ),
				);
			},
		);

		$reg['restore_post_revision'] = array(
			'desc'     => 'Restore a post to a specific revision. Returns the restored post summary.',
			'risk'     => 'write',
			'schema'   => array(
				'revision_id' => array( 'type' => 'integer', 'description' => 'Revision ID to restore.' ),
			),
			'required' => array( 'revision_id' ),
			'handler'  => function ( $a ) {
				$revision_id = absint( $a['revision_id'] );
				$revision    = wp_get_post_revision( $revision_id );
				if ( ! $revision ) {
					throw new Exception( 'Revision not found.' );
				}

				$restored = wp_restore_post_revision( $revision_id );
				if ( ! $restored ) {
					throw new Exception( 'Failed to restore revision.' );
				}

				$post = get_post( $restored );

				return array(
					'success' => true,
					'message' => 'Revision restored successfully.',
					'post'    => array(
						'id'       => $post->ID,
						'title'    => $post->post_title,
						'status'   => $post->post_status,
						'type'     => $post->post_type,
						'modified' => $post->post_modified,
					),
				);
			},
		);

		// ============================================================
		// TAXONOMY EXTRAS
		// ============================================================

		$reg['assign_terms'] = array(
			'desc'     => 'Replace all of a post\'s terms in a given taxonomy with the supplied term IDs (uses wp_set_object_terms).',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'  => array( 'type' => 'integer', 'description' => 'Post ID.' ),
				'taxonomy' => array( 'type' => 'string', 'description' => 'Taxonomy name (e.g. category, post_tag, product_cat).' ),
				'term_ids' => array(
					'type'        => 'array',
					'description' => 'Array of term IDs to assign (replaces existing).',
					'items'       => array( 'type' => 'integer' ),
				),
			),
			'required' => array( 'post_id', 'taxonomy', 'term_ids' ),
			'handler'  => function ( $a ) {
				$post_id  = absint( $a['post_id'] );
				$taxonomy = sanitize_key( $a['taxonomy'] );
				$term_ids = is_array( $a['term_ids'] ) ? array_map( 'absint', $a['term_ids'] ) : array();

				$post = get_post( $post_id );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				if ( ! taxonomy_exists( $taxonomy ) ) {
					throw new Exception( 'Invalid taxonomy.' );
				}

				$result = wp_set_object_terms( $post_id, $term_ids, $taxonomy );

				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}

				return array(
					'success'        => true,
					'post_id'        => $post_id,
					'taxonomy'       => $taxonomy,
					'assigned_terms' => $term_ids,
				);
			},
		);

		// ============================================================
		// USER EXTRAS
		// ============================================================

		$reg['list_roles'] = array(
			'desc'    => 'List all registered WordPress user roles with their display names and capability lists.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wp_roles;
				if ( ! isset( $wp_roles ) ) {
					$wp_roles = new WP_Roles();
				}

				$roles = array();
				foreach ( $wp_roles->roles as $role_key => $role_data ) {
					$roles[] = array(
						'name'         => $role_key,
						'display_name' => $role_data['name'],
						'capabilities' => array_keys( array_filter( $role_data['capabilities'] ) ),
					);
				}

				return array(
					'roles' => $roles,
					'total' => count( $roles ),
				);
			},
		);

		$reg['check_capability'] = array(
			'desc'     => 'Check whether a user has a specific WordPress capability. If user_id is omitted, checks the current authenticated user.',
			'risk'     => 'read',
			'schema'   => array(
				'capability' => array( 'type' => 'string', 'description' => 'Capability name to check (e.g. edit_posts, manage_options).' ),
				'user_id'    => array( 'type' => 'integer', 'description' => 'User ID. Optional — defaults to current user.' ),
			),
			'required' => array( 'capability' ),
			'handler'  => function ( $a ) {
				$capability = sanitize_key( $a['capability'] );

				if ( isset( $a['user_id'] ) ) {
					$user = get_userdata( absint( $a['user_id'] ) );
					if ( ! $user ) {
						throw new Exception( 'User not found.' );
					}
					$has_cap = $user->has_cap( $capability );
				} else {
					$has_cap = current_user_can( $capability );
				}

				return array(
					'capability' => $capability,
					'has_cap'    => (bool) $has_cap,
				);
			},
		);

		$reg['get_user_meta'] = array(
			'desc'     => 'Get user metadata. If meta_key is provided, returns just that key; otherwise returns all meta as a flat key-value object.',
			'risk'     => 'read',
			'schema'   => array(
				'user_id'  => array( 'type' => 'integer', 'description' => 'User ID.' ),
				'meta_key' => array( 'type' => 'string', 'description' => 'Meta key (optional — returns all meta if omitted).' ),
			),
			'required' => array( 'user_id' ),
			'handler'  => function ( $a ) {
				$user_id = absint( $a['user_id'] );
				$user    = get_userdata( $user_id );
				if ( ! $user ) {
					throw new Exception( 'User not found.' );
				}

				if ( isset( $a['meta_key'] ) && '' !== $a['meta_key'] ) {
					$meta_key   = sanitize_key( $a['meta_key'] );
					$meta_value = get_user_meta( $user_id, $meta_key, true );
					return array(
						'user_id'    => $user_id,
						'meta_key'   => $meta_key,
						'meta_value' => $meta_value,
					);
				}

				$all_meta  = get_user_meta( $user_id );
				$formatted = array();
				foreach ( $all_meta as $key => $values ) {
					$formatted[ $key ] = count( $values ) === 1 ? $values[0] : $values;
				}

				return array(
					'user_id' => $user_id,
					'meta'    => $formatted,
				);
			},
		);

		// ============================================================
		// SITE EXTRAS
		// ============================================================

		$reg['get_site_health'] = array(
			'desc'    => 'Return a snapshot of WordPress site health: PHP version, WP version, multisite flag, memory limit, max upload size.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! class_exists( 'WP_Site_Health' ) ) {
					require_once ABSPATH . 'wp-admin/includes/class-wp-site-health.php';
				}
				// Instantiate (may populate site_health_status option as side effect on some WP versions).
				$site_health = WP_Site_Health::get_instance();
				if ( method_exists( $site_health, 'get_tests' ) ) {
					$site_health->get_tests();
				}

				return array(
					'status'       => get_option( 'site_health_status', 'unknown' ),
					'php_version'  => phpversion(),
					'wp_version'   => get_bloginfo( 'version' ),
					'is_multisite' => is_multisite(),
					'memory_limit' => defined( 'WP_MEMORY_LIMIT' ) ? WP_MEMORY_LIMIT : ini_get( 'memory_limit' ),
					'max_upload'   => size_format( wp_max_upload_size() ),
				);
			},
		);

		return $reg;
	}
}
