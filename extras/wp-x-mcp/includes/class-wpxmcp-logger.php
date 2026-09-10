<?php
/**
 * Lightweight audit logger.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Logger {

	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'wpxmcp_logs';
	}

	public static function create_table(): void {
		global $wpdb;
		$table   = self::table();
		$charset = $wpdb->get_charset_collate();
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			created DATETIME NOT NULL,
			tool VARCHAR(100) NOT NULL,
			scope VARCHAR(20) NOT NULL,
			success TINYINT(1) NOT NULL DEFAULT 0,
			ip VARCHAR(64) DEFAULT '',
			summary TEXT,
			PRIMARY KEY (id),
			KEY tool (tool),
			KEY created (created)
		) {$charset};";
		dbDelta( $sql );
	}

	public static function log( string $tool, string $scope, bool $success, string $summary = '' ): void {
		global $wpdb;
		// Keep logging best-effort; never block a tool call on a logging failure.
		$wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			self::table(),
			array(
				'created' => current_time( 'mysql' ),
				'tool'    => $tool,
				'scope'   => $scope,
				'success' => $success ? 1 : 0,
				'ip'      => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '',
				'summary' => mb_substr( $summary, 0, 2000 ),
			),
			array( '%s', '%s', '%s', '%d', '%s', '%s' )
		);
	}

	public static function recent( int $limit = 100 ): array {
		global $wpdb;
		$table = self::table();
		return $wpdb->get_results( // phpcs:ignore WordPress.DB
			$wpdb->prepare( "SELECT * FROM {$table} ORDER BY id DESC LIMIT %d", $limit ),
			ARRAY_A
		) ?: array();
	}
}
