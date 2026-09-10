<?php
/**
 * Comment tools for WP x MCP.
 *
 * Ports the comment CRUD tool set from MountDev AI MCP Connector
 * into wp-x-mcp's procedural tool registry style.
 *
 * 6 tools: list_comments, get_comment, create_comment, update_comment,
 * delete_comment, moderate_comment.
 *
 * NOTE: wp-x-mcp already has a `comment_moderator` (bulk moderation) in
 * tools-seo-pro.php. The `moderate_comment` tool here is the single-comment
 * MountDev variant. Both coexist — bulk vs single-comment have distinct
 * call shapes, and removing either would break existing agent flows.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Comments {

	/**
	 * Format a WP_Comment into the standard MountDev-compatible shape.
	 */
	public static function format_comment( $comment ) {
		if ( ! $comment instanceof WP_Comment ) {
			return null;
		}
		return array(
			'id'           => $comment->comment_ID,
			'post_id'      => $comment->comment_post_ID,
			'author'       => $comment->comment_author,
			'author_email' => $comment->comment_author_email,
			'content'      => $comment->comment_content,
			'date'         => $comment->comment_date,
			'status'       => wp_get_comment_status( $comment->comment_ID ),
			'parent'       => $comment->comment_parent,
		);
	}

	public static function all(): array {
		$reg = array();

		$reg['list_comments'] = array(
			'desc'    => 'List comments with optional filters (post_id, status, pagination). Status default: approve. NOTE: distinct from comment_moderator which is bulk-action focused.',
			'risk'    => 'read',
			'schema'  => array(
				'post_id'  => array( 'type' => 'integer', 'description' => 'Filter by post ID.' ),
				'status'   => array( 'type' => 'string', 'description' => 'Comment status (approve, hold, spam, trash, all). Default approve.' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Number of comments per page. Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number (1-indexed). Default 1.' ),
			),
			'handler' => function ( $a ) {
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? max( 1, absint( $a['page'] ) ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				$comment_args = array(
					'status' => isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'approve',
					'number' => $per_page,
					'offset' => $offset,
				);
				if ( isset( $a['post_id'] ) ) {
					$comment_args['post_id'] = absint( $a['post_id'] );
				}

				$comments = get_comments( $comment_args );

				$count_args = $comment_args;
				unset( $count_args['number'], $count_args['offset'] );
				$count_args['count'] = true;
				$total              = get_comments( $count_args );

				return array(
					'comments' => array_map( array( 'WPXMCP_Tools_Comments', 'format_comment' ), $comments ),
					'total'    => (int) $total,
					'page'     => $page,
					'per_page' => $per_page,
				);
			},
		);

		$reg['get_comment'] = array(
			'desc'     => 'Get a single comment by ID.',
			'risk'     => 'read',
			'schema'   => array(
				'comment_id' => array( 'type' => 'integer', 'description' => 'Comment ID.' ),
			),
			'required' => array( 'comment_id' ),
			'handler'  => function ( $a ) {
				$comment = get_comment( absint( $a['comment_id'] ) );
				if ( ! $comment ) {
					throw new Exception( 'Comment not found.' );
				}
				return WPXMCP_Tools_Comments::format_comment( $comment );
			},
		);

		$reg['create_comment'] = array(
			'desc'     => 'Create a new comment on a post. Uses the current authenticated user if available; otherwise uses provided author_name + author_email.',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer', 'description' => 'Post ID to comment on.' ),
				'content'      => array( 'type' => 'string', 'description' => 'Comment content.' ),
				'author_name'  => array( 'type' => 'string', 'description' => 'Comment author name (used when not authenticated).' ),
				'author_email' => array( 'type' => 'string', 'description' => 'Comment author email (used when not authenticated).' ),
				'parent'       => array( 'type' => 'integer', 'description' => 'Parent comment ID for threaded replies. Default 0.' ),
			),
			'required' => array( 'post_id', 'content' ),
			'handler'  => function ( $a ) {
				$post = get_post( absint( $a['post_id'] ) );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}

				$user         = wp_get_current_user();
				$comment_data = array(
					'comment_post_ID' => absint( $a['post_id'] ),
					'comment_content' => wp_kses_post( $a['content'] ),
					'comment_parent'  => isset( $a['parent'] ) ? absint( $a['parent'] ) : 0,
				);

				if ( $user && $user->ID ) {
					$comment_data['user_id']              = $user->ID;
					$comment_data['comment_author']       = $user->display_name;
					$comment_data['comment_author_email'] = $user->user_email;
				} else {
					if ( isset( $a['author_name'] ) ) {
						$comment_data['comment_author'] = sanitize_text_field( $a['author_name'] );
					}
					if ( isset( $a['author_email'] ) ) {
						$comment_data['comment_author_email'] = sanitize_email( $a['author_email'] );
					}
				}

				$comment_id = wp_insert_comment( $comment_data );
				if ( ! $comment_id ) {
					throw new Exception( 'Failed to create comment.' );
				}

				return array(
					'success' => true,
					'comment' => WPXMCP_Tools_Comments::format_comment( get_comment( $comment_id ) ),
				);
			},
		);

		$reg['update_comment'] = array(
			'desc'     => "Update an existing comment's content and/or status.",
			'risk'     => 'write',
			'schema'   => array(
				'comment_id' => array( 'type' => 'integer', 'description' => 'Comment ID.' ),
				'content'    => array( 'type' => 'string', 'description' => 'New comment content.' ),
				'status'     => array( 'type' => 'string', 'description' => 'Approval status (e.g. approve, hold, spam, trash).' ),
			),
			'required' => array( 'comment_id' ),
			'handler'  => function ( $a ) {
				$comment_id = absint( $a['comment_id'] );
				$comment    = get_comment( $comment_id );
				if ( ! $comment ) {
					throw new Exception( 'Comment not found.' );
				}

				$data = array( 'comment_ID' => $comment_id );
				if ( isset( $a['content'] ) ) {
					$data['comment_content'] = wp_kses_post( $a['content'] );
				}
				if ( isset( $a['status'] ) ) {
					$data['comment_approved'] = sanitize_key( $a['status'] );
				}

				if ( ! wp_update_comment( $data ) ) {
					throw new Exception( 'Failed to update comment.' );
				}

				return array(
					'success' => true,
					'comment' => WPXMCP_Tools_Comments::format_comment( get_comment( $comment_id ) ),
				);
			},
		);

		$reg['delete_comment'] = array(
			'desc'     => 'Delete a comment. Trashes by default; set force_delete=true to permanently delete (bypasses trash).',
			'risk'     => 'destructive',
			'schema'   => array(
				'comment_id'   => array( 'type' => 'integer', 'description' => 'Comment ID.' ),
				'force_delete' => array( 'type' => 'boolean', 'description' => 'Bypass trash and force permanent deletion. Default false.' ),
			),
			'required' => array( 'comment_id' ),
			'handler'  => function ( $a ) {
				$comment_id   = absint( $a['comment_id'] );
				$force_delete = ! empty( $a['force_delete'] );

				$comment = get_comment( $comment_id );
				if ( ! $comment ) {
					throw new Exception( 'Comment not found.' );
				}

				if ( ! wp_delete_comment( $comment_id, $force_delete ) ) {
					throw new Exception( 'Failed to delete comment.' );
				}

				return array(
					'success'    => true,
					'comment_id' => $comment_id,
					'forced'     => $force_delete,
				);
			},
		);

		$reg['moderate_comment'] = array(
			'desc'     => 'Moderate a single comment: approve, spam, or trash. For bulk operations use comment_moderator.',
			'risk'     => 'write',
			'schema'   => array(
				'comment_id' => array( 'type' => 'integer', 'description' => 'Comment ID.' ),
				'action'     => array( 'type' => 'string', 'description' => 'Moderation action: approve, spam, or trash.' ),
			),
			'required' => array( 'comment_id', 'action' ),
			'handler'  => function ( $a ) {
				$comment_id = absint( $a['comment_id'] );
				$action     = sanitize_key( $a['action'] );

				$comment = get_comment( $comment_id );
				if ( ! $comment ) {
					throw new Exception( 'Comment not found.' );
				}

				switch ( $action ) {
					case 'approve':
						$result = wp_set_comment_status( $comment_id, 'approve' );
						break;
					case 'spam':
						$result = wp_spam_comment( $comment_id );
						break;
					case 'trash':
						$result = wp_trash_comment( $comment_id );
						break;
					default:
						throw new Exception( 'Invalid moderation action. Use approve, spam, or trash.' );
				}

				if ( ! $result ) {
					throw new Exception( 'Failed to moderate comment.' );
				}

				return array(
					'success'    => true,
					'comment_id' => $comment_id,
					'action'     => $action,
				);
			},
		);

		return $reg;
	}
}
