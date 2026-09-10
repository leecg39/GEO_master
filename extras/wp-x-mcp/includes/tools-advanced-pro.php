<?php
/**
 * Advanced Pro tools inspired by Novamira.
 * Includes Execute PHP, WP-CLI, and Admin Access Link.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Advanced_Pro {

	public static function all(): array {
		$tools = array();

		// ============================================================
		// EXECUTE PHP
		// ============================================================
		$tools['execute_php'] = array(
			'desc'    => 'Run arbitrary PHP code on the server (full WP access). CRITICAL RISK: can take over the whole site if the API key leaks. Keep disabled unless you fully trust the client. [risk: destructive]',
			'risk'    => 'destructive',
			'schema'  => array(
				'code' => array( 'type' => 'string', 'description' => 'PHP code without <?php tags. Use "return $val;" to see data.' ),
			),
			'required' => array( 'code' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Unauthorized.' );
				}

				$code = (string) $a['code'];
				$errors = array();

				set_error_handler( function ( $errno, $errstr, $errfile, $errline ) use ( &$errors ) {
					$errors[] = array( 'type' => $errno, 'message' => $errstr, 'file' => $errfile, 'line' => $errline );
					return true;
				} );

				ob_start();
				$start = microtime( true );
				$return_value = null;
				$success = true;
				$error_message = null;

				try {
					$return_value = eval( $code );
				} catch ( \Throwable $e ) {
					$success = false;
					$error_message = $e->getMessage();
				}

				$execution_time_ms = round( ( microtime( true ) - $start ) * 1000, 2 );
				$output = ob_get_clean();
				restore_error_handler();

				return array(
					'success'      => $success,
					'return_value' => $return_value,
					'output'       => $output,
					'errors'       => $errors,
					'error'        => $error_message,
					'time_ms'      => $execution_time_ms,
				);
			},
		);

		// ============================================================
		// RUN WP-CLI
		// ============================================================
		$tools['run_wp_cli'] = array(
			'desc'    => 'Run WP-CLI commands (install plugins, change users, DB ops). CRITICAL RISK: near root-level power. Keep disabled for shared or cloud AI connectors. [risk: destructive]',
			'risk'    => 'destructive',
			'schema'  => array(
				'command' => array( 'type' => 'string', 'description' => 'The WP-CLI command string.' ),
			),
			'required' => array( 'command' ),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Unauthorized.' );
				}

				$cmd = escapeshellcmd( 'wp ' . $a['command'] . ' --allow-root' );
				$output = shell_exec( $cmd . ' 2>&1' );

				return array(
					'command' => $cmd,
					'output'  => $output,
				);
			},
		);

		// ============================================================
		// ADMIN ACCESS LINK
		// ============================================================
		$tools['create_admin_access_link'] = array(
			'desc'    => 'Create a temporary one-time admin login link. CRITICAL RISK: anyone with the link becomes admin. Never enable for Grok/Claude public URLs. [risk: destructive]',
			'risk'    => 'write',
			'schema'  => array(
				'user_id' => array( 'type' => 'integer', 'description' => 'User ID to login as. Defaults to current admin.' ),
				'path'    => array( 'type' => 'string', 'description' => 'Redirect path after login (e.g. plugins.php).' ),
			),
			'handler'  => function ( $a ) {
				if ( ! current_user_can( 'manage_options' ) ) {
					throw new Exception( 'Unauthorized.' );
				}

				$user_id = ! empty( $a['user_id'] ) ? (int) $a['user_id'] : get_current_user_id();
				$user = get_userdata( $user_id );
				if ( ! $user || ! in_array( 'administrator', $user->roles ) ) {
					throw new Exception( 'Invalid user or not an administrator.' );
				}

				$token = bin2hex( random_bytes( 32 ) );
				$expiry = time() + 3600; // 1 hour
				
				$access_links = get_option( 'wpxmcp_access_links', array() );
				$access_links[ $token ] = array(
					'user_id' => $user_id,
					'expiry'  => $expiry,
					'path'    => ! empty( $a['path'] ) ? $a['path'] : 'index.php',
				);
				update_option( 'wpxmcp_access_links', $access_links );

				$login_url = add_query_arg( array(
					'wpxmcp_login' => $token,
				), home_url() );

				return array(
					'login_url' => $login_url,
					'expires'   => date( 'Y-m-d H:i:s', $expiry ),
					'one_time'  => true,
				);
			},
		);

		return $tools;
	}
}
