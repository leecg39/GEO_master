<?php
/**
 * Authentication for the WP x MCP server.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Auth {

	private static $instance = null;
	private $current_scope   = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Extract the API key from the request, checking several header styles
	 * so the same plugin works with Claude, ChatGPT, Gemini and raw curl.
	 */
	public function get_request_key(): string {
		$candidates = array(
			'HTTP_X_WPXMCP_API_KEY',     // X-WPXMCP-API-Key
			'HTTP_X_API_KEY',           // X-API-Key
			'HTTP_X_ROYAL_MCP_API_KEY', // drop-in compatibility with Royal MCP clients
		);
		foreach ( $candidates as $srv ) {
			if ( ! empty( $_SERVER[ $srv ] ) ) {
				return sanitize_text_field( wp_unslash( $_SERVER[ $srv ] ) );
			}
		}
		// Authorization: Bearer <key>
		$auth = ! empty( $_SERVER['HTTP_AUTHORIZATION'] ) ? wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ) : '';
		if ( $auth && stripos( $auth, 'bearer ' ) === 0 ) {
			return sanitize_text_field( trim( substr( $auth, 7 ) ) );
		}
		// Some hosts (Apache/CGI/LiteSpeed) strip Authorization; check the redirected copy.
		if ( ! empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
			$ra = wp_unslash( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] );
			if ( stripos( $ra, 'bearer ' ) === 0 ) {
				return sanitize_text_field( trim( substr( $ra, 7 ) ) );
			}
		}
		// Query-string fallback: ?key= / ?api_key= / ?apikey= / ?token=
		// This is what makes the server connectable from clients (e.g. Claude.ai's
		// custom-connector UI) that cannot set a custom auth header — you paste a
		// self-authenticating URL and the key travels on every request.
		foreach ( array( 'key', 'api_key', 'apikey', 'token' ) as $qp ) {
			if ( ! empty( $_GET[ $qp ] ) ) {
				return sanitize_text_field( wp_unslash( $_GET[ $qp ] ) );
			}
		}
		return '';
	}

	/**
	 * Validate a key and remember its scope for this request.
	 * Uses hash_equals to avoid timing attacks.
	 */
	public function validate( string $key ): bool {
		if ( '' === $key ) {
			return false;
		}
		$keys = get_option( 'wpxmcp_api_keys', array() );
		foreach ( $keys as $entry ) {
			if ( isset( $entry['key'] ) && hash_equals( (string) $entry['key'], $key ) ) {
				// Expiry check (empty / 0 = never expires).
				$expires = isset( $entry['expires'] ) ? (int) $entry['expires'] : 0;
				if ( $expires > 0 && time() > $expires ) {
					return false;
				}
				$this->current_scope = $entry['scope'] ?? 'full';
				return true;
			}
		}
		return false;
	}

	/**
	 * Scope for the authenticated request: full | editor | readonly.
	 */
	public function scope(): string {
		return $this->current_scope ?? 'readonly';
	}

	/**
	 * Whether the current scope may perform a write of the given risk level.
	 *
	 * @param string $risk read | write | destructive
	 */
	public function can( string $risk ): bool {
		$scope = $this->scope();
		if ( 'full' === $scope ) {
			return true;
		}
		if ( 'editor' === $scope ) {
			return in_array( $risk, array( 'read', 'write' ), true );
		}
		// readonly
		return 'read' === $risk;
	}
}
