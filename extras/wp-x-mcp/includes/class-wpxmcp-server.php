<?php
/**
 * MCP JSON-RPC server: routes, protocol handshake, tool dispatch.
 * Compatible with Streamable HTTP (2025-03-26+) and classic JSON-RPC clients.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Server {

	private static $instance = null;

	/** Default / fallback protocol version advertised by this server. */
	const PROTOCOL_VERSION = '2025-03-26';

	/** Protocol versions we accept from clients. */
	const SUPPORTED_PROTOCOLS = array(
		'2024-11-05',
		'2025-03-26',
		'2025-06-18',
		'2026-07-28',
	);

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		// CORS: runs before WordPress sends its own headers.
		add_action( 'rest_api_init', array( $this, 'cors_headers' ), 5 );
		// Handle OPTIONS preflight before WordPress processes the request.
		add_action( 'init', array( $this, 'handle_preflight' ), 1 );
	}

	/**
	 * Emit CORS + MCP-related headers for every REST response so browsers
	 * (Claude.ai, ChatGPT, Gemini, Grok, custom UIs) can reach the endpoint.
	 */
	public function cors_headers(): void {
		remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );
		add_filter(
			'rest_pre_serve_request',
			function ( $served ) {
				header( 'Access-Control-Allow-Origin: *' );
				header( 'Access-Control-Allow-Methods: POST, GET, OPTIONS, DELETE' );
				header( 'Access-Control-Allow-Headers: Authorization, Content-Type, Accept, X-WPXMCP-API-Key, X-API-Key, X-WP-Nonce, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID' );
				header( 'Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version' );
				header( 'Access-Control-Max-Age: 86400' );
				return $served;
			},
			15
		);
	}

	/**
	 * Answer OPTIONS preflight requests immediately (before any WP routing).
	 */
	public function handle_preflight(): void {
		if (
			isset( $_SERVER['REQUEST_METHOD'] ) &&
			'OPTIONS' === strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) &&
			isset( $_SERVER['REQUEST_URI'] ) &&
			false !== strpos( wp_unslash( $_SERVER['REQUEST_URI'] ), 'wp-x-mcp/v1/mcp' )
		) {
			header( 'Access-Control-Allow-Origin: *' );
			header( 'Access-Control-Allow-Methods: POST, GET, OPTIONS, DELETE' );
			header( 'Access-Control-Allow-Headers: Authorization, Content-Type, Accept, X-WPXMCP-API-Key, X-API-Key, X-WP-Nonce, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID' );
			header( 'Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version' );
			header( 'Access-Control-Max-Age: 86400' );
			header( 'Content-Length: 0' );
			header( 'Content-Type: text/plain' );
			status_header( 200 );
			exit();
		}
	}

	public function register_routes(): void {
		register_rest_route(
			WPXMCP_NAMESPACE,
			'/mcp',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle' ),
				'permission_callback' => '__return_true', // auth handled inside (JSON-RPC errors, not 403 HTML)
			)
		);

		// GET: health + optional SSE stream (Streamable HTTP clients may probe with GET).
		register_rest_route(
			WPXMCP_NAMESPACE,
			'/mcp',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_get' ),
				'permission_callback' => '__return_true',
			)
		);

		// DELETE: session termination (Streamable HTTP optional).
		register_rest_route(
			WPXMCP_NAMESPACE,
			'/mcp',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( $this, 'handle_delete' ),
				'permission_callback' => '__return_true',
			)
		);

		// Explicit OPTIONS so WP REST router doesn't 404 preflight.
		register_rest_route(
			WPXMCP_NAMESPACE,
			'/mcp',
			array(
				'methods'             => 'OPTIONS',
				'callback'            => function () {
					return new WP_REST_Response( null, 200 );
				},
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * GET handler — health check or SSE stream open.
	 * Clients that send Accept: text/event-stream get an SSE response;
	 * everyone else gets a simple JSON health payload.
	 */
	public function handle_get( WP_REST_Request $request ) {
		$accept = $request->get_header( 'accept' ) ?: '';

		// Streamable HTTP clients open an SSE stream with GET.
		if ( false !== stripos( $accept, 'text/event-stream' ) ) {
			// We are mostly request/response (stateless). Return 405 so the
			// client falls back to POST-only mode — fully valid per spec.
			$response = new WP_REST_Response(
				array(
					'jsonrpc' => '2.0',
					'error'   => array(
						'code'    => -32000,
						'message' => 'SSE stream not required; this server is stateless Streamable HTTP (POST only).',
					),
				),
				405
			);
			$response->header( 'Allow', 'POST, OPTIONS' );
			return $response;
		}

		// Plain health / discovery.
		return new WP_REST_Response(
			array(
				'server'            => 'WP x MCP',
				'version'           => WPXMCP_VERSION,
				'protocol'          => self::PROTOCOL_VERSION,
				'supportedProtocols'=> self::SUPPORTED_PROTOCOLS,
				'transport'         => 'streamable-http',
				'status'            => 'ok',
			),
			200
		);
	}

	/**
	 * DELETE — optional session termination. Stateless server → always 200.
	 */
	public function handle_delete( WP_REST_Request $request ) {
		return new WP_REST_Response( null, 200 );
	}

	/**
	 * Main JSON-RPC / Streamable HTTP entry point (POST).
	 */
	public function handle( WP_REST_Request $request ) {
		// Ensure we always speak JSON even if something upstream already sent headers.
		if ( ! headers_sent() ) {
			header( 'Content-Type: application/json; charset=utf-8' );
		}

		$body = json_decode( $request->get_body(), true );
		if ( ! is_array( $body ) ) {
			return $this->rpc_error( null, -32700, 'Parse error' );
		}

		// Support both single messages and JSON-RPC batches (array of messages).
		if ( array_keys( $body ) === range( 0, count( $body ) - 1 ) ) {
			$results = array();
			foreach ( $body as $msg ) {
				if ( ! is_array( $msg ) ) {
					continue;
				}
				$resp = $this->dispatch_message( $msg, $request );
				$data = $resp->get_data();
				if ( null !== $data ) {
					$results[] = $data;
				}
			}
			return new WP_REST_Response( $results, 200 );
		}

		return $this->dispatch_message( $body, $request );
	}

	/**
	 * Process one JSON-RPC message and return a WP_REST_Response.
	 */
	private function dispatch_message( array $body, WP_REST_Request $request ) {
		$id     = $body['id'] ?? null;
		$method = $body['method'] ?? '';
		$params = $body['params'] ?? array();

		// Notifications have no id and must not return a body (202 Accepted).
		$is_notification = ! array_key_exists( 'id', $body );

		// ── initialize (no auth required) ──────────────────────────────────
		if ( 'initialize' === $method ) {
			$client_proto = isset( $params['protocolVersion'] ) && is_string( $params['protocolVersion'] )
				? $params['protocolVersion']
				: self::PROTOCOL_VERSION;

			// Echo a version we support; prefer the client's if we know it.
			$negotiated = in_array( $client_proto, self::SUPPORTED_PROTOCOLS, true )
				? $client_proto
				: self::PROTOCOL_VERSION;

			$result = array(
				'protocolVersion' => $negotiated,
				'capabilities'    => array(
					'tools'     => new stdClass(),
					// Empty objects keep clients happy that expect these keys.
					'resources' => new stdClass(),
					'prompts'   => new stdClass(),
				),
				'serverInfo'      => array(
					'name'    => 'WP x MCP',
					'version' => WPXMCP_VERSION,
				),
			);

			$response = $this->rpc_result( $id, $result );
			// Optional session id for clients that want one (stateless still works).
			$response->header( 'Mcp-Session-Id', 'wpxmcp-' . wp_generate_password( 16, false ) );
			$response->header( 'MCP-Protocol-Version', $negotiated );
			return $response;
		}

		// ── notifications (no response body) ───────────────────────────────
		if ( $is_notification || 'notifications/initialized' === $method || str_starts_with( (string) $method, 'notifications/' ) ) {
			return new WP_REST_Response( null, 202 );
		}

		// Everything else requires a valid API key.
		$auth = WPXMCP_Auth::instance();
		$key  = $auth->get_request_key();
		if ( ! $auth->validate( $key ) ) {
			return $this->rpc_error(
				$id,
				-32001,
				'Unauthorized: missing or invalid API key. Send it via X-WPXMCP-API-Key header, Authorization: Bearer, or ?key= query param.'
			);
		}

		switch ( $method ) {
			case 'tools/list':
				return $this->rpc_result( $id, array( 'tools' => WPXMCP_Tools::list_tools() ) );

			case 'tools/call':
				$name = $params['name'] ?? '';
				$args = $params['arguments'] ?? array();
				return $this->call_tool( $id, $name, $args, $auth );

			case 'ping':
				return $this->rpc_result( $id, new stdClass() );

			case 'resources/list':
				return $this->rpc_result( $id, array( 'resources' => array() ) );

			case 'prompts/list':
				return $this->rpc_result( $id, array( 'prompts' => array() ) );

			default:
				return $this->rpc_error( $id, -32601, "Method not found: {$method}" );
		}
	}

	/**
	 * Dispatch a single tool call.
	 */
	private function call_tool( $id, string $name, array $args, WPXMCP_Auth $auth ) {
		$tools = WPXMCP_Tools::registry();
		if ( ! isset( $tools[ $name ] ) ) {
			return $this->rpc_error( $id, -32602, "Unknown tool: {$name}" );
		}

		if ( ! WPXMCP_Tools::is_tool_enabled( $name ) ) {
			return $this->rpc_tool_error( $id, "Tool '{$name}' is disabled in WP x MCP settings. Enable it under Settings → Managed Tools." );
		}

		$def  = $tools[ $name ];
		$risk = $def['risk'] ?? 'read';

		if ( ! $auth->can( $risk ) ) {
			WPXMCP_Logger::log( $name, $auth->scope(), false, 'blocked by scope' );
			return $this->rpc_tool_error( $id, "Your API key scope ('{$auth->scope()}') cannot perform a '{$risk}' action." );
		}

		try {
			$result  = call_user_func( $def['handler'], $args );
			$payload = is_string( $result ) ? $result : wp_json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
			WPXMCP_Logger::log( $name, $auth->scope(), true, 'ok' );
			return $this->rpc_result(
				$id,
				array(
					'content' => array(
						array(
							'type' => 'text',
							'text' => $payload,
						),
					),
				)
			);
		} catch ( Throwable $e ) {
			WPXMCP_Logger::log( $name, $auth->scope(), false, $e->getMessage() );
			return $this->rpc_tool_error( $id, 'Error: ' . $e->getMessage() );
		}
	}

	// ---- JSON-RPC response helpers ----

	private function rpc_result( $id, $result ): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'jsonrpc' => '2.0',
				'id'      => $id,
				'result'  => $result,
			),
			200
		);
	}

	private function rpc_error( $id, int $code, string $message ): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'jsonrpc' => '2.0',
				'id'      => $id,
				'error'   => array(
					'code'    => $code,
					'message' => $message,
				),
			),
			200
		);
	}

	/**
	 * Tool-level error returned as isError content (per MCP spec)
	 * so the model can read and react to it rather than failing the RPC.
	 */
	private function rpc_tool_error( $id, string $message ): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'jsonrpc' => '2.0',
				'id'      => $id,
				'result'  => array(
					'isError' => true,
					'content' => array(
						array(
							'type' => 'text',
							'text' => $message,
						),
					),
				),
			),
			200
		);
	}
}
