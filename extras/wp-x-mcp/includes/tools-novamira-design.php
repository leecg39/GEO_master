<?php
/**
 * Design Library system inspired by Novamira.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Novamira_Design {

	const POST_TYPE = 'wpxmcp_design';

	public static function init() {
		// Must run on 'init' — calling register_post_type on plugins_loaded
		// can fatal with "Call to a member function add_rewrite_tag() on null".
		add_action( 'init', array( __CLASS__, 'register_cpt' ) );
	}

	public static function register_cpt() {
		register_post_type( self::POST_TYPE, array(
			'label'               => 'AI Designs',
			'public'              => false,
			'show_ui'             => true,
			'supports'            => array( 'title', 'editor', 'revisions' ),
			'menu_icon'           => 'dashicons-art',
			'rewrite'             => false,
			'query_var'           => false,
			'exclude_from_search' => true,
			'publicly_queryable'  => false,
		) );
	}

	public static function all(): array {
		$tools = array();

		// ============================================================
		// SAVE DESIGN
		// ============================================================
		$tools['design_save'] = array(
			'desc'    => 'Save a design specification file. Medium risk — writes files under the site. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'slug'    => array( 'type' => 'string' ),
				'content' => array( 'type' => 'string', 'description' => 'Markdown design spec.' ),
				'activate' => array( 'type' => 'boolean', 'default' => false ),
			),
			'required' => array( 'slug', 'content' ),
			'handler'  => function ( $a ) {
				$p = get_page_by_path( $a['slug'], OBJECT, self::POST_TYPE );
				$args = array(
					'post_type'    => self::POST_TYPE,
					'post_name'    => $a['slug'],
					'post_title'   => ucfirst( $a['slug'] ),
					'post_content' => $a['content'],
					'post_status'  => 'publish',
				);
				if ( $p ) $args['ID'] = $p->ID;
				
				$id = wp_insert_post( $args );
				if ( ! empty( $a['activate'] ) ) update_option( 'wpxmcp_active_design', $a['slug'] );
				
				return array( 'id' => $id, 'success' => true );
			},
		);

		// ============================================================
		// LIST DESIGNS
		// = :==========================================================
		$tools['design_list'] = array(
			'desc'    => 'List saved design specifications (read-only). Low risk. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler'  => function () {
				$posts = get_posts( array( 'post_type' => self::POST_TYPE, 'posts_per_page' => -1 ) );
				$active = get_option( 'wpxmcp_active_design', '' );
				$res = array();
				foreach ( $posts as $p ) {
					$res[] = array(
						'slug'   => $p->post_name,
						'active' => ( $p->post_name === $active ),
						'modified' => $p->post_modified,
					);
				}
				return $res;
			},
		);

		// ============================================================
		// ACTIVATE DESIGN
		// ============================================================
		$tools['design_activate'] = array(
			'desc'    => 'Activate a saved design as the site design. Medium risk — may change how the site is built. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'slug' => array( 'type' => 'string' ),
			),
			'required' => array( 'slug' ),
			'handler'  => function ( $a ) {
				update_option( 'wpxmcp_active_design', $a['slug'] );
				return array( 'success' => true, 'active' => $a['slug'] );
			},
		);

		return $tools;
	}
}
