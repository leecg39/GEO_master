<?php
/**
 * Gutenberg Block Editor tools.
 * Allows AI to parse, modify, and serialize Gutenberg blocks.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Gutenberg {

	public static function all(): array {
		$tools = array();

		// ============================================================
		// PARSE BLOCKS
		// ============================================================
		$tools['gutenberg_parse'] = array(
			'desc'    => 'Parse Gutenberg block structure from a post/page (read-only). Low risk. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'post_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$p = get_post( (int) $a['post_id'] );
				if ( ! $p ) throw new Exception( 'Post not found.' );
				
				$blocks = parse_blocks( $p->post_content );
				return array(
					'post_id' => $p->ID,
					'blocks'  => $blocks,
				);
			},
		);

		// ============================================================
		// WRITE BLOCKS
		// = :==========================================================
		$tools['gutenberg_write'] = array(
			'desc'    => 'Write Gutenberg blocks back to a post/page. Can overwrite page layout. Medium risk. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'post_id' => array( 'type' => 'integer' ),
				'blocks'  => array( 'type' => 'array', 'description' => 'Array of block objects {blockName, attrs, innerBlocks, innerHTML}.' ),
			),
			'required' => array( 'post_id', 'blocks' ),
			'handler'  => function ( $a ) {
				$content = serialize_blocks( $a['blocks'] );
				$res = wp_update_post( array(
					'ID'           => (int) $a['post_id'],
					'post_content' => $content,
				), true );

				if ( is_wp_error( $res ) ) throw new Exception( $res->get_error_message() );
				return array( 'success' => true, 'post_id' => $res );
			},
		);

		// ============================================================
		// LIST DESIGN PATTERNS
		// ============================================================
		$tools['list_design_patterns'] = array(
			'desc'    => 'List available Gutenberg block patterns/designs (read-only). Low risk. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'category' => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				$registry = WP_Block_Patterns_Registry::get_instance();
				$patterns = $registry->get_all_registered();
				
				if ( ! empty( $a['category'] ) ) {
					$patterns = array_filter( $patterns, function( $p ) use ( $a ) {
						return in_array( $a['category'], $p['categories'] ?? array() );
					} );
				}

				return array_values( $patterns );
			},
		);

		return $tools;
	}
}
