<?php
/**
 * Plugin Name:       WP x MCP — Full Control AI Connector
 * Plugin URI:        https://www.mubashirhassan.com
 * Description:        Self-owned Model Context Protocol server for WordPress + WooCommerce. Exposes full read/write control over posts, pages, media, menus, users, products, orders, customers, plugins, themes, CSS, options, and direct SQL — for Claude, ChatGPT, Grok, and Perplexity. Includes broken link auditing, image alt-tag scanning, and database health fixing. No vendor lock-in.
 * Version:           1.21.8
 * Author:            Mubashir Hassan
 * Author URI:        https://www.mubashirhassan.com
 * License:           GPL-2.0+
 * License URI:       http://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain:       wp-x-mcp
 * Requires at least: 6.4
 * Requires PHP:      8.1
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

define( 'WPXMCP_VERSION', '1.21.8' );
define( 'WPXMCP_FILE', __FILE__ );
define( 'WPXMCP_DIR', plugin_dir_path( __FILE__ ) );
define( 'WPXMCP_URL', plugin_dir_url( __FILE__ ) );
define( 'WPXMCP_NAMESPACE', 'wp-x-mcp/v1' );

// ── Duplicate-copy conflict guard ───────────────────────────────────────────
// This codebase ships under several brand names (WP x MCP, Star Tech MCP,
// Royal MCP, Sekhlo MCP). They all declare the same WPXMCP_* classes, so running
// two at once causes a fatal "Cannot redeclare class WPXMCP_Server" on activation.
// Detect an already-loaded copy and bail gracefully with a clear notice instead
// of crashing the site.
if ( class_exists( 'WPXMCP_Server' ) || class_exists( 'WPXMCP_Tools' ) || class_exists( 'WPXMCP_Auth' ) ) {
	add_action(
		'admin_notices',
		function () {
			echo '<div class="notice notice-error"><p><strong>WP x MCP did not load.</strong> Another copy of this MCP plugin (such as <em>Star Tech MCP</em> or <em>Royal MCP</em>) is already active and defines the same classes. Keep only <strong>one</strong> MCP plugin active: deactivate the other one, then deactivate &amp; reactivate this plugin so it can finish setup.</p></div>';
		}
	);
	return; // Stop loading — prevents the fatal redeclaration / white screen.
}


require_once WPXMCP_DIR . 'includes/class-wpxmcp-auth.php';
require_once WPXMCP_DIR . 'includes/class-wpxmcp-logger.php';
require_once WPXMCP_DIR . 'includes/class-wpxmcp-tools.php';
require_once WPXMCP_DIR . 'includes/class-wpxmcp-server.php';
require_once WPXMCP_DIR . 'includes/class-wpxmcp-frontend.php';
require_once WPXMCP_DIR . 'includes/class-wpxmcp-admin.php';
require_once WPXMCP_DIR . 'includes/class-wpxmcp-guide.php';

/**
 * Boot the plugin.
 */
function wpxmcp_boot() {
	WPXMCP_Auth::instance();
	WPXMCP_Server::instance();
	WPXMCP_Frontend::instance();
	if ( is_admin() ) {
		WPXMCP_Admin::instance();
		WPXMCP_Guide::instance();
	}
}
add_action( 'plugins_loaded', 'wpxmcp_boot' );

/**
 * Activation: create the API key + log table.
 */
function wpxmcp_activate() {
	// Generate a first API key if none exists.
	if ( ! get_option( 'wpxmcp_api_keys' ) ) {
		$key = 'wpxmcp_' . bin2hex( random_bytes( 24 ) );
		update_option(
			'wpxmcp_api_keys',
			array(
				array(
					'key'     => $key,
					'label'   => 'Default key (created on activation)',
					'created' => current_time( 'mysql' ),
					'scope'   => 'full', // full | editor | readonly
				),
			)
		);
		// Stash for the one-time admin notice.
		set_transient( 'wpxmcp_new_key_notice', $key, 300 );
	}

	WPXMCP_Logger::create_table();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'wpxmcp_activate' );

/**
 * Deactivation.
 */
function wpxmcp_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'wpxmcp_deactivate' );
