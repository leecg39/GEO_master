<?php
/**
 * Built-in SEO / content-generation prompt library (Semantic SEO / Holistic SEO style).
 *
 *  - list_prompts : browse the library by category (names + descriptions)
 *  - get_prompt   : fetch one full prompt by id, ready to fill its {{selected_text}} slot
 *
 * Prompts are stored in /data/seo-prompts.json so they can be edited without code changes.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Prompts {

	private static function load(): array {
		$file = WPXMCP_DIR . 'data/seo-prompts.json';
		if ( ! is_readable( $file ) ) {
			return array();
		}
		$data = json_decode( (string) file_get_contents( $file ), true );
		return ( is_array( $data ) && ! empty( $data['prompts'] ) ) ? $data['prompts'] : array();
	}

	public static function all(): array {
		$reg = array();

		$reg['list_prompts'] = array(
			'desc'    => 'Browse the built-in SEO & content-generation prompt library (Semantic SEO / Holistic SEO templates: topical maps, content briefs, heading vectors, entity mapping, EEAT, competitor analysis, internal linking, brand SERP, and visualization prompts). Returns id, name, category and a short description for each. Use get_prompt to fetch the full text.',
			'risk'    => 'read',
			'schema'  => array(
				'category' => array( 'type' => 'string', 'description' => 'Optional — filter to one category (e.g. "Topical Authority", "Content Strategy", "Entity SEO").' ),
			),
			'handler' => function ( $a ) {
				$prompts = self::load();
				$cat     = isset( $a['category'] ) ? strtolower( trim( (string) $a['category'] ) ) : '';
				$out     = array();
				$cats    = array();
				foreach ( $prompts as $p ) {
					$cats[ $p['category'] ] = true;
					if ( $cat && strtolower( $p['category'] ) !== $cat ) {
						continue;
					}
					$out[] = array(
						'id'        => $p['id'],
						'name'      => $p['name'],
						'category'  => $p['category'],
						'shortDesc' => $p['shortDesc'] ?? '',
						'icon'      => $p['icon'] ?? '',
					);
				}
				return array(
					'count'      => count( $out ),
					'categories' => array_keys( $cats ),
					'prompts'    => $out,
				);
			},
		);

		$reg['get_prompt'] = array(
			'desc'     => 'Fetch one full prompt from the SEO prompt library by id. The returned text contains a {{selected_text}} placeholder — replace it with the page content, keyword list, SERP data, or dataset the prompt expects, then run it. Pass fill_with to get the placeholder substituted for you.',
			'risk'     => 'read',
			'schema'   => array(
				'id'        => array( 'type' => 'string', 'description' => 'Prompt id from list_prompts (e.g. "topical-map", "semantic-content-brief").' ),
				'fill_with' => array( 'type' => 'string', 'description' => 'Optional — text to substitute into the {{selected_text}} placeholder.' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$prompts = self::load();
				$id      = sanitize_title( $a['id'] );
				foreach ( $prompts as $p ) {
					if ( $p['id'] === $id ) {
						$text = $p['prompt'];
						if ( isset( $a['fill_with'] ) && '' !== (string) $a['fill_with'] ) {
							$text = str_replace( '{{selected_text}}', (string) $a['fill_with'], $text );
						}
						return array(
							'id'          => $p['id'],
							'name'        => $p['name'],
							'category'    => $p['category'],
							'placeholder' => $p['placeholder'] ?? '{{selected_text}}',
							'filled'      => isset( $a['fill_with'] ) && '' !== (string) $a['fill_with'],
							'prompt'      => $text,
						);
					}
				}
				throw new Exception( 'Prompt id "' . $id . '" not found. Call list_prompts to see available ids.' );
			},
		);

		return $reg;
	}
}
