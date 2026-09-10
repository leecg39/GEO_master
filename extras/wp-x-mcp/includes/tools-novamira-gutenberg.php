<?php
/**
 * Advanced Gutenberg Batch system inspired by Novamira.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Novamira_Gutenberg {

	const POST_TYPE = 'wpxmcp_gb_change';

	public static function init() {
		// Must run on 'init' — calling register_post_type on plugins_loaded
		// can fatal with "Call to a member function add_rewrite_tag() on null".
		add_action( 'init', array( __CLASS__, 'register_cpt' ) );
	}

	public static function register_cpt() {
		register_post_type( self::POST_TYPE, array(
			'label'               => 'Gutenberg Changes',
			'public'              => false,
			'show_ui'             => false,
			'supports'            => array( 'title' ),
			'rewrite'             => false,
			'query_var'           => false,
			'exclude_from_search' => true,
			'publicly_queryable'  => false,
		) );
	}

	public static function all(): array {
		$tools = array();

		// ============================================================
		// CREATE PENDING BATCH
		// ============================================================
		$tools['gutenberg_create_batch'] = array(
			'desc'    => 'Create a batch of pending Gutenberg changes (apply later). Medium risk — can stage large content edits. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'label' => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$batch_id = wp_insert_post( array(
					'post_type'   => self::POST_TYPE,
					'post_title'  => $a['label'] ?? 'AI Batch ' . date( 'Y-m-d H:i' ),
					'post_status' => 'publish',
				) );
				update_post_meta( $batch_id, '_kind', 'batch' );
				update_post_meta( $batch_id, '_status', 'draft' );

				return array( 'batch_id' => $batch_id, 'status' => 'draft' );
			},
		);

		// ============================================================
		// ADD PENDING CHANGE
		// ============================================================
		$tools['gutenberg_add_change'] = array(
			'desc'    => 'Add a block change to a Gutenberg batch. Medium risk. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'batch_id' => array( 'type' => 'integer' ),
				'post_id'  => array( 'type' => 'integer' ),
				'blocks'   => array( 'type' => 'array' ),
			),
			'required' => array( 'batch_id', 'post_id', 'blocks' ),
			'handler'  => function ( $a ) {
				$item_id = wp_insert_post( array(
					'post_type'   => self::POST_TYPE,
					'post_parent' => (int) $a['batch_id'],
					'post_status' => 'publish',
				) );
				update_post_meta( $item_id, '_kind', 'item' );
				update_post_meta( $item_id, '_target_id', (int) $a['post_id'] );
				update_post_meta( $item_id, '_block_spec', wp_json_encode( $a['blocks'] ) );

				return array( 'item_id' => $item_id, 'success' => true );
			},
		);

		// ============================================================
		// LIST BATCHES
		// ============================================================
		$tools['gutenberg_list_batches'] = array(
			'desc'    => 'List pending Gutenberg change batches (read-only). Low risk. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler'  => function () {
				$posts = get_posts( array(
					'post_type'  => self::POST_TYPE,
					'meta_key'   => '_kind',
					'meta_value' => 'batch',
					'posts_per_page' => -1,
				) );
				$res = array();
				foreach ( $posts as $p ) {
					$res[] = array(
						'id'     => $p->ID,
						'label'  => $p->post_title,
						'status' => get_post_meta( $p->ID, '_status', true ),
					);
				}
				return $res;
			},
		);

		return $tools;
	}
}
