<?php
/**
 * Front-end output for SEO features:
 * - Injects per-post JSON-LD schema (_wpxmcp_schema, _wpxmcp_faq_schema) into <head>.
 * - Serves custom robots.txt (wpxmcp_robots_txt option) via the robots_txt filter.
 * - Serves /llms.txt (wpxmcp_llms_txt option) for AI crawlers.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Frontend {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'wp_head', array( $this, 'output_schema' ), 20 );
		add_filter( 'robots_txt', array( $this, 'filter_robots' ), 20, 1 );
		add_action( 'init', array( $this, 'maybe_serve_llms_txt' ) );
	}

	/**
	 * Print saved JSON-LD for the current singular post.
	 */
	public function output_schema(): void {
		if ( ! is_singular() ) {
			return;
		}
		$id = get_queried_object_id();
		foreach ( array( '_wpxmcp_schema', '_wpxmcp_faq_schema' ) as $key ) {
			$json = get_post_meta( $id, $key, true );
			if ( $json ) {
				// Stored slashed; unslash and validate before printing.
				$json    = wp_unslash( $json );
				$decoded = json_decode( $json, true );
				if ( null !== $decoded ) {
					echo "\n<script type=\"application/ld+json\">" . wp_json_encode( $decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "</script>\n";
				}
			}
		}
	}

	/**
	 * Replace robots.txt body if a custom one is saved.
	 */
	public function filter_robots( $output ) {
		$custom = get_option( 'wpxmcp_robots_txt', '' );
		return $custom ? $custom : $output;
	}

	/**
	 * Serve /llms.txt if requested and a body is saved.
	 */
	public function maybe_serve_llms_txt(): void {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) : '';
		if ( '/llms.txt' !== $uri ) {
			return;
		}
		$body = get_option( 'wpxmcp_llms_txt', '' );
		if ( ! $body ) {
			return;
		}
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}
}
