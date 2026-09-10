<?php
/**
 * Child theme tools + Plan/Approve/Apply system for WP x MCP.
 * Ported from Alpha WP SEO.
 *
 * Includes:
 *  - WPXMCP_Sandbox            path guard for theme writes
 *  - WPXMCP_PHP_Linter         token_get_all() syntax check (no shell/eval)
 *  - WPXMCP_Activation_Guard   safe theme switch with auto-revert on 5xx
 *  - WPXMCP_Plan_Store         plan / apply / discard primitives
 *  - WPXMCP_Tools_ChildTheme   MCP tool group
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

class WPXMCP_Sandbox {

	const MAX_BYTES   = 1048576; // 1 MB.
	const ALLOWED_EXT = array( 'php', 'css', 'js', 'json', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'woff', 'woff2', 'md', 'txt' );

	public static function disallow_file_mods() {
		return defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS;
	}

	public static function child_theme_root( $child_slug ) {
		$slug = sanitize_key( $child_slug );
		if ( '' === $slug ) {
			throw new Exception( 'Child theme slug cannot be empty.' );
		}
		return trailingslashit( get_theme_root() ) . $slug . '/';
	}

	/**
	 * Resolve and validate an absolute path inside a child theme.
	 * @throws Exception on path traversal, bad extension, symlink escape.
	 */
	public static function resolve_target( $child_slug, $relative_path ) {
		$root = self::child_theme_root( $child_slug );

		$relative_path = str_replace( '\\', '/', (string) $relative_path );
		$relative_path = ltrim( $relative_path, '/' );

		if ( '' === $relative_path ) {
			throw new Exception( 'Relative path is required.' );
		}
		if ( false !== strpos( $relative_path, '..' ) ) {
			throw new Exception( 'Path traversal sequences (../) are not allowed.' );
		}
		if ( preg_match( '#[\x00-\x1f]#', $relative_path ) ) {
			throw new Exception( 'Control characters are not allowed in path.' );
		}

		$ext = strtolower( pathinfo( $relative_path, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, self::ALLOWED_EXT, true ) ) {
			throw new Exception( 'Extension .' . $ext . ' is not in the allowlist (' . implode( ', ', self::ALLOWED_EXT ) . ').' );
		}

		$absolute = $root . $relative_path;
		$parent   = dirname( $absolute );
		if ( file_exists( $parent ) ) {
			$real_parent = realpath( $parent );
			$real_root   = realpath( rtrim( $root, '/' ) );
			if ( $real_parent && $real_root && 0 !== strpos( $real_parent . DIRECTORY_SEPARATOR, $real_root . DIRECTORY_SEPARATOR ) ) {
				throw new Exception( 'Resolved path escapes the child theme root (symlink escape).' );
			}
		}
		return $absolute;
	}

	public static function ensure_parent_dir( $absolute_path ) {
		$parent = dirname( $absolute_path );
		if ( ! file_exists( $parent ) ) {
			if ( ! wp_mkdir_p( $parent ) ) {
				throw new Exception( 'Could not create directory: ' . $parent );
			}
		}
		return true;
	}

	public static function validate_size( $content ) {
		if ( strlen( $content ) > self::MAX_BYTES ) {
			throw new Exception( 'Write exceeds ' . self::MAX_BYTES . '-byte cap (1 MB).' );
		}
		return true;
	}
}

// ---------------------------------------------------------------------------
// PHP Linter
// ---------------------------------------------------------------------------

class WPXMCP_PHP_Linter {

	/**
	 * Check PHP source via token_get_all (no shell, no eval).
	 * @throws Exception on syntax error.
	 */
	public static function check( $php_source ) {
		$src = (string) $php_source;
		if ( '' === trim( $src ) ) {
			throw new Exception( 'Empty PHP source.' );
		}
		if ( false === strpos( $src, '<?php' ) ) {
			throw new Exception( 'PHP source must contain <?php.' );
		}
		try {
			$tokens = token_get_all( $src, TOKEN_PARSE );
		} catch ( \ParseError $e ) {
			throw new Exception( 'PHP parse error: ' . $e->getMessage() );
		} catch ( \Throwable $e ) {
			throw new Exception( 'Tokenisation failed: ' . $e->getMessage() );
		}
		if ( empty( $tokens ) ) {
			throw new Exception( 'No tokens produced from source.' );
		}
		self::check_balance( $src );
		return true;
	}

	private static function check_balance( $src ) {
		$braces = $parens = $brackets = 0;
		$in_string = false;
		$string_char = '';
		$len = strlen( $src );
		for ( $i = 0; $i < $len; $i++ ) {
			$ch   = $src[ $i ];
			$prev = $i > 0 ? $src[ $i - 1 ] : '';
			if ( $in_string ) {
				if ( $ch === $string_char && '\\' !== $prev ) {
					$in_string = false;
				}
				continue;
			}
			if ( '"' === $ch || "'" === $ch ) {
				$in_string   = true;
				$string_char = $ch;
				continue;
			}
			if ( '{' === $ch )      $braces++;
			elseif ( '}' === $ch ) $braces--;
			elseif ( '(' === $ch ) $parens++;
			elseif ( ')' === $ch ) $parens--;
			elseif ( '[' === $ch ) $brackets++;
			elseif ( ']' === $ch ) $brackets--;
		}
		if ( 0 !== $braces )   { throw new Exception( 'Brace imbalance: ' . $braces . '.' ); }
		if ( 0 !== $parens )   { throw new Exception( 'Paren imbalance: ' . $parens . '.' ); }
		if ( 0 !== $brackets ) { throw new Exception( 'Bracket imbalance: ' . $brackets . '.' ); }
	}
}

// ---------------------------------------------------------------------------
// Activation Guard
// ---------------------------------------------------------------------------

class WPXMCP_Activation_Guard {

	public static function activate( $child_slug ) {
		if ( WPXMCP_Sandbox::disallow_file_mods() ) {
			throw new Exception( 'DISALLOW_FILE_MODS is set; refusing theme switch.' );
		}
		$child_slug = sanitize_key( $child_slug );
		$target     = wp_get_theme( $child_slug );
		if ( ! $target->exists() ) {
			throw new Exception( 'Theme "' . $child_slug . '" not found.' );
		}
		$previous = get_stylesheet();
		if ( $previous === $child_slug ) {
			return array( 'previous_theme' => $previous, 'activated' => $child_slug, 'noop' => true );
		}
		switch_theme( $child_slug );

		// Sanity probe.
		$probe    = wp_remote_get( home_url( '/' ), array( 'timeout' => 15, 'sslverify' => false, 'headers' => array( 'Cache-Control' => 'no-cache' ) ) );
		$reverted = false;
		$error    = null;
		$code     = null;

		if ( is_wp_error( $probe ) ) {
			$reverted = true;
			$error    = $probe->get_error_message();
		} else {
			$code = wp_remote_retrieve_response_code( $probe );
			if ( $code >= 500 ) {
				$reverted = true;
				$error    = 'Front-end probe returned HTTP ' . $code . ' after theme switch.';
			}
		}
		if ( function_exists( 'wp_recovery_mode' ) && wp_recovery_mode()->is_active() ) {
			$reverted = true;
			$error    = 'WordPress recovery mode triggered.';
		}
		if ( $reverted ) {
			switch_theme( $previous );
			throw new Exception( 'Activation reverted: ' . $error );
		}
		return array( 'previous_theme' => $previous, 'activated' => $child_slug, 'probe_status' => $code );
	}

	public static function deactivate_to_parent() {
		$current = wp_get_theme();
		if ( ! is_child_theme() ) {
			throw new Exception( 'Current theme is not a child theme.' );
		}
		$parent = $current->parent();
		if ( ! $parent || ! $parent->exists() ) {
			throw new Exception( 'Parent theme not found.' );
		}
		$previous = get_stylesheet();
		switch_theme( $parent->get_stylesheet() );
		return array( 'previous' => $previous, 'reverted_to' => $parent->get_stylesheet() );
	}

	public static function recovery_status() {
		$recovery = function_exists( 'wp_recovery_mode' ) ? wp_recovery_mode() : null;
		return array(
			'is_recovery'    => $recovery ? $recovery->is_active() : false,
			'debug_log_path' => defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG ? WP_CONTENT_DIR . '/debug.log' : null,
		);
	}
}

// ---------------------------------------------------------------------------
// Plan Store
// ---------------------------------------------------------------------------

class WPXMCP_Plan_Store {

	const TTL     = 3600; // 1h
	const ALLOWED = array(
		'create_child_theme',
		'write_child_theme_file',
		'activate_child_theme',
		'deactivate_to_parent',
	);

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'wpxmcp_plans';
	}

	public static function maybe_create_table() {
		global $wpdb;
		$table   = self::table();
		$charset = $wpdb->get_charset_collate();
		$sql     = "CREATE TABLE IF NOT EXISTS {$table} (
			plan_id VARCHAR(64) NOT NULL,
			user_id BIGINT(20) UNSIGNED NOT NULL,
			label VARCHAR(255) NULL,
			actions LONGTEXT NOT NULL,
			diff_summary LONGTEXT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			created_at DATETIME NOT NULL,
			expires_at DATETIME NOT NULL,
			applied_at DATETIME NULL,
			PRIMARY KEY (plan_id),
			KEY user_id (user_id),
			KEY status (status)
		) {$charset};";
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	public static function plan( array $actions, $label = null ) {
		if ( empty( $actions ) ) {
			throw new Exception( 'Plan must include at least one action.' );
		}
		$normalised = array();
		$diff_lines = array();
		foreach ( $actions as $i => $a ) {
			$ability = sanitize_key( $a['ability'] ?? '' );
			$args    = is_array( $a['args'] ?? null ) ? $a['args'] : array();
			if ( ! in_array( $ability, self::ALLOWED, true ) ) {
				throw new Exception( 'Action ' . $i . ': ability "' . $ability . '" cannot be planned. Allowed: ' . implode( ', ', self::ALLOWED ) );
			}
			$normalised[] = array( 'ability' => $ability, 'args' => $args );
			$diff_lines[] = self::describe( $ability, $args );
		}

		$plan_id    = wp_generate_uuid4();
		$user_id    = get_current_user_id();
		$created_at = current_time( 'mysql' );
		$expires_at = gmdate( 'Y-m-d H:i:s', strtotime( $created_at ) + self::TTL );

		global $wpdb;
		$wpdb->insert( self::table(), array(
			'plan_id'      => $plan_id,
			'user_id'      => $user_id,
			'label'        => $label ? substr( (string) $label, 0, 255 ) : null,
			'actions'      => wp_json_encode( $normalised ),
			'diff_summary' => wp_json_encode( $diff_lines ),
			'status'       => 'pending',
			'created_at'   => $created_at,
			'expires_at'   => $expires_at,
		) );

		return array(
			'plan_id'      => $plan_id,
			'label'        => $label,
			'actions'      => $normalised,
			'diff_summary' => $diff_lines,
			'expires_at'   => $expires_at,
			'created_at'   => $created_at,
		);
	}

	public static function apply( $plan_id, $selections = null ) {
		global $wpdb;
		$plan = $wpdb->get_row( $wpdb->prepare(
			'SELECT * FROM ' . self::table() . ' WHERE plan_id = %s',
			$plan_id
		), ARRAY_A );
		if ( ! $plan ) {
			throw new Exception( 'Plan "' . $plan_id . '" not found.' );
		}
		if ( 'pending' !== $plan['status'] ) {
			throw new Exception( 'Plan status is "' . $plan['status'] . '"; can only apply pending plans.' );
		}
		if ( strtotime( $plan['expires_at'] ) < time() ) {
			$wpdb->update( self::table(), array( 'status' => 'expired' ), array( 'plan_id' => $plan_id ) );
			throw new Exception( 'Plan has expired.' );
		}
		if ( (int) $plan['user_id'] !== get_current_user_id() ) {
			throw new Exception( 'Only the plan creator can apply it.' );
		}
		$actions = json_decode( $plan['actions'], true );
		if ( ! is_array( $actions ) ) {
			throw new Exception( 'Plan actions could not be decoded.' );
		}
		if ( is_array( $selections ) ) {
			$sel     = array_map( 'intval', $selections );
			$actions = array_values( array_filter( $actions, static function ( $_, $i ) use ( $sel ) {
				return in_array( $i, $sel, true );
			}, ARRAY_FILTER_USE_BOTH ) );
		}

		$results = array();
		$any_err = false;
		foreach ( $actions as $i => $action ) {
			try {
				$res       = self::dispatch( $action['ability'], $action['args'] );
				$results[] = array( 'index' => $i, 'ability' => $action['ability'], 'ok' => true, 'result' => $res );
			} catch ( Exception $e ) {
				$results[] = array( 'index' => $i, 'ability' => $action['ability'], 'ok' => false, 'error' => $e->getMessage() );
				$any_err   = true;
			}
		}

		$wpdb->update( self::table(), array(
			'status'     => $any_err ? 'partial' : 'applied',
			'applied_at' => current_time( 'mysql' ),
		), array( 'plan_id' => $plan_id ) );

		return array( 'plan_id' => $plan_id, 'results' => $results, 'status' => $any_err ? 'partial' : 'applied' );
	}

	public static function discard( $plan_id ) {
		global $wpdb;
		$rows = $wpdb->delete( self::table(), array( 'plan_id' => $plan_id ) );
		return array( 'discarded' => (bool) $rows );
	}

	public static function list_pending() {
		global $wpdb;
		$user_id = get_current_user_id();
		$rows    = $wpdb->get_results( $wpdb->prepare(
			'SELECT plan_id, label, status, created_at, expires_at FROM ' . self::table() . ' WHERE user_id = %d AND status = %s ORDER BY created_at DESC LIMIT 50',
			$user_id, 'pending'
		), ARRAY_A );
		return $rows ?: array();
	}

	private static function dispatch( $ability, $args ) {
		switch ( $ability ) {
			case 'create_child_theme':
				return WPXMCP_Tools_ChildTheme::do_create(
					$args['parent_slug'] ?? '',
					$args['child_slug']  ?? '',
					$args['name']        ?? null,
					$args['author']      ?? null
				);
			case 'write_child_theme_file':
				return WPXMCP_Tools_ChildTheme::do_write(
					$args['child_slug'] ?? '',
					$args['path']       ?? '',
					$args['content']    ?? '',
					$args['mode']       ?? 'overwrite'
				);
			case 'activate_child_theme':
				return WPXMCP_Activation_Guard::activate( $args['child_slug'] ?? '' );
			case 'deactivate_to_parent':
				return WPXMCP_Activation_Guard::deactivate_to_parent();
		}
		throw new Exception( 'Unknown ability in plan: ' . $ability );
	}

	private static function describe( $ability, $args ) {
		switch ( $ability ) {
			case 'create_child_theme':
				return sprintf( 'Create child theme "%s" from parent "%s".', $args['child_slug'] ?? '?', $args['parent_slug'] ?? '?' );
			case 'write_child_theme_file':
				return sprintf( 'Write %d bytes to %s/%s (%s).', strlen( (string) ( $args['content'] ?? '' ) ), $args['child_slug'] ?? '?', $args['path'] ?? '?', $args['mode'] ?? 'overwrite' );
			case 'activate_child_theme':
				return sprintf( 'Activate child theme "%s" (auto-revert on failure).', $args['child_slug'] ?? '?' );
			case 'deactivate_to_parent':
				return 'Deactivate current child theme; revert to parent.';
		}
		return $ability . '(' . wp_json_encode( $args ) . ')';
	}
}

// ---------------------------------------------------------------------------
// Tool group
// ---------------------------------------------------------------------------

class WPXMCP_Tools_ChildTheme {

	// ------------------------------------------------------------------
	// Internal implementation methods (called from tool handlers and from
	// WPXMCP_Plan_Store::dispatch)
	// ------------------------------------------------------------------

	public static function do_create( $parent_slug, $child_slug, $name = null, $author = null ) {
		if ( WPXMCP_Sandbox::disallow_file_mods() ) {
			throw new Exception( 'DISALLOW_FILE_MODS is set; child theme writes are disabled.' );
		}
		$parent_slug = sanitize_key( $parent_slug );
		$child_slug  = sanitize_key( $child_slug );
		if ( ! $parent_slug || ! $child_slug ) {
			throw new Exception( 'parent_slug and child_slug are both required.' );
		}
		$parent = wp_get_theme( $parent_slug );
		if ( ! $parent->exists() ) {
			throw new Exception( 'Parent theme "' . $parent_slug . '" not found.' );
		}
		$root = WPXMCP_Sandbox::child_theme_root( $child_slug );
		if ( ! file_exists( $root ) ) {
			if ( ! wp_mkdir_p( $root ) ) {
				throw new Exception( 'Could not create child theme directory.' );
			}
		}

		$name   = $name   ?: ( $parent->get( 'Name' ) . ' Child' );
		$author = $author ?: 'WP x MCP';

		// Strip chars that break WP theme header parser.
		$clean_name   = preg_replace( '/[\r\n*]/', ' ', (string) $name );
		$clean_author = preg_replace( '/[\r\n*]/', ' ', (string) $author );

		$style = "/*\nTheme Name:   {$clean_name}\nTemplate:     {$parent_slug}\nAuthor:       {$clean_author}\nVersion:      0.1.0\nDescription:  Child theme created via WP x MCP.\n*/\n";
		$funcs = "<?php\nif ( ! defined( 'ABSPATH' ) ) { exit; }\n\nadd_action( 'wp_enqueue_scripts', function () {\n\twp_enqueue_style( 'parent-style', get_parent_theme_file_uri( 'style.css' ), array(), wp_get_theme()->parent()->get( 'Version' ) );\n\twp_enqueue_style( 'child-style',  get_stylesheet_uri(), array( 'parent-style' ), wp_get_theme()->get( 'Version' ) );\n} );\n";

		$style_target = $root . 'style.css';
		$funcs_target = $root . 'functions.php';

		if ( ! file_exists( $style_target ) ) {
			file_put_contents( $style_target, $style );
		}
		if ( ! file_exists( $funcs_target ) ) {
			file_put_contents( $funcs_target, $funcs );
		}
		// Copy parent screenshot as a courtesy.
		$parent_ss = $parent->get_stylesheet_directory() . '/screenshot.png';
		if ( file_exists( $parent_ss ) && ! file_exists( $root . 'screenshot.png' ) ) {
			@copy( $parent_ss, $root . 'screenshot.png' );
		}

		return array(
			'child_slug'  => $child_slug,
			'parent_slug' => $parent_slug,
			'theme_root'  => $root,
			'files'       => array(
				'style.css'      => file_exists( $style_target ),
				'functions.php'  => file_exists( $funcs_target ),
				'screenshot.png' => file_exists( $root . 'screenshot.png' ),
			),
		);
	}

	public static function do_write( $child_slug, $path, $content, $mode = 'overwrite' ) {
		if ( WPXMCP_Sandbox::disallow_file_mods() ) {
			throw new Exception( 'DISALLOW_FILE_MODS is set; refusing write.' );
		}
		$absolute = WPXMCP_Sandbox::resolve_target( $child_slug, $path );
		WPXMCP_Sandbox::validate_size( $content );

		$ext = strtolower( pathinfo( $absolute, PATHINFO_EXTENSION ) );
		if ( 'php' === $ext ) {
			WPXMCP_PHP_Linter::check( $content );
		}

		$exists = file_exists( $absolute );
		if ( $exists && 'create' === $mode ) {
			throw new Exception( 'File already exists and mode=create was requested.' );
		}
		$sha_before = $exists ? sha1_file( $absolute ) : null;

		WPXMCP_Sandbox::ensure_parent_dir( $absolute );
		$bytes = file_put_contents( $absolute, $content );
		if ( false === $bytes ) {
			throw new Exception( 'file_put_contents returned false — check directory permissions.' );
		}
		return array(
			'bytes_written' => $bytes,
			'sha1_before'   => $sha_before,
			'sha1_after'    => sha1_file( $absolute ),
			'path'          => $absolute,
		);
	}

	public static function do_read( $child_slug, $path ) {
		$absolute = WPXMCP_Sandbox::resolve_target( $child_slug, $path );
		if ( ! file_exists( $absolute ) ) {
			throw new Exception( 'File not found: ' . $path );
		}
		$content = file_get_contents( $absolute );
		$ext     = strtolower( pathinfo( $absolute, PATHINFO_EXTENSION ) );
		$binary  = in_array( $ext, array( 'png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'woff', 'woff2' ), true );
		return array(
			'path'     => $absolute,
			'content'  => $binary ? base64_encode( $content ) : $content,
			'encoding' => $binary ? 'base64' : 'utf8',
			'bytes'    => strlen( $content ),
			'sha1'     => sha1( $content ),
		);
	}

	// ------------------------------------------------------------------
	// MCP tool registry
	// ------------------------------------------------------------------

	public static function all(): array {
		$reg = array();

		// ---- Child theme management ------------------------------------

		$reg['create_child_theme'] = array(
			'desc'     => 'Scaffold a new child theme directory with style.css and functions.php. Idempotent — skips existing files. Args: parent_slug (installed theme slug), child_slug (new theme folder name), name (optional display name), author (optional). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'parent_slug' => array( 'type' => 'string', 'description' => 'Slug of the installed parent theme (e.g. twentytwentyfour).' ),
				'child_slug'  => array( 'type' => 'string', 'description' => 'Folder name for the new child theme (e.g. twentytwentyfour-child).' ),
				'name'        => array( 'type' => 'string', 'description' => 'Optional display name. Defaults to "<Parent> Child".' ),
				'author'      => array( 'type' => 'string', 'description' => 'Optional Theme Author field.' ),
			),
			'required' => array( 'parent_slug', 'child_slug' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Tools_ChildTheme::do_create(
					$a['parent_slug'] ?? '',
					$a['child_slug']  ?? '',
					$a['name']        ?? null,
					$a['author']      ?? null
				);
			},
		);

		$reg['write_child_theme_file'] = array(
			'desc'     => 'Write a file inside a child theme directory. PHP files are syntax-checked before writing. Path is sandboxed (no ../, symlink escapes, or disallowed extensions). Capped at 1 MB. Args: child_slug, path (relative, e.g. "functions.php" or "css/custom.css"), content, mode (overwrite|create, default overwrite). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'child_slug' => array( 'type' => 'string', 'description' => 'Child theme folder name.' ),
				'path'       => array( 'type' => 'string', 'description' => 'Relative path inside the theme, e.g. "style.css" or "inc/hooks.php".' ),
				'content'    => array( 'type' => 'string', 'description' => 'File content to write.' ),
				'mode'       => array( 'type' => 'string', 'description' => 'overwrite (default) or create (fails if file exists).' ),
			),
			'required' => array( 'child_slug', 'path', 'content' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Tools_ChildTheme::do_write(
					$a['child_slug'] ?? '',
					$a['path']       ?? '',
					$a['content']    ?? '',
					$a['mode']       ?? 'overwrite'
				);
			},
		);

		$reg['read_child_theme_file'] = array(
			'desc'     => 'Read a file inside a child theme directory (useful to verify a write). Binary files (images, fonts) returned as base64. Args: child_slug, path. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'child_slug' => array( 'type' => 'string' ),
				'path'       => array( 'type' => 'string', 'description' => 'Relative path inside the child theme.' ),
			),
			'required' => array( 'child_slug', 'path' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Tools_ChildTheme::do_read( $a['child_slug'] ?? '', $a['path'] ?? '' );
			},
		);

		$reg['activate_child_theme'] = array(
			'desc'     => 'Switch the active theme to the named child theme. After switching, makes an HTTP probe to the homepage — if a 5xx is returned or WordPress recovery mode is triggered, the switch is automatically reverted. Args: child_slug. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'child_slug' => array( 'type' => 'string', 'description' => 'Theme folder slug to activate.' ),
			),
			'required' => array( 'child_slug' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Activation_Guard::activate( $a['child_slug'] ?? '' );
			},
		);

		$reg['deactivate_to_parent'] = array(
			'desc'     => 'If the currently active theme is a child theme, switch back to its parent. Useful for rolling back a child-theme activation. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				return WPXMCP_Activation_Guard::deactivate_to_parent();
			},
		);

		$reg['recovery_mode_status'] = array(
			'desc'     => 'Check whether WordPress recovery mode is currently active and return the debug log path. Useful after a failed theme or plugin activation. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				return WPXMCP_Activation_Guard::recovery_status();
			},
		);

		// ---- Plan / Approve / Apply ------------------------------------

		$reg['plan_changes'] = array(
			'desc'     => 'Stage a multi-step change set without executing it. Returns a plan_id and a human-readable diff_summary for review. Call apply_planned_changes to execute, or discard_plan to cancel. Plans expire after 1 hour. Allowed abilities: create_child_theme, write_child_theme_file, activate_child_theme, deactivate_to_parent. Args: actions (array of {ability, args}), label (optional name). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'actions' => array(
					'type'        => 'array',
					'description' => 'Array of {ability: string, args: object} steps.',
					'items'       => array( 'type' => 'object' ),
				),
				'label' => array( 'type' => 'string', 'description' => 'Optional label for the plan.' ),
			),
			'required' => array( 'actions' ),
			'handler'  => function ( $a ) {
				WPXMCP_Plan_Store::maybe_create_table();
				return WPXMCP_Plan_Store::plan( (array) ( $a['actions'] ?? array() ), $a['label'] ?? null );
			},
		);

		$reg['apply_planned_changes'] = array(
			'desc'     => 'Execute a pending plan created with plan_changes. Optionally pass selections (zero-based action indices) to apply only a subset. Returns per-action results. Args: plan_id (required), selections (optional array of int). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'plan_id'    => array( 'type' => 'string', 'description' => 'UUID returned by plan_changes.' ),
				'selections' => array( 'type' => 'array', 'description' => 'Optional zero-based indices of actions to apply (omit for all).', 'items' => array( 'type' => 'integer' ) ),
			),
			'required' => array( 'plan_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Plan_Store::maybe_create_table();
				return WPXMCP_Plan_Store::apply(
					$a['plan_id']    ?? '',
					isset( $a['selections'] ) ? (array) $a['selections'] : null
				);
			},
		);

		$reg['discard_plan'] = array(
			'desc'     => 'Delete a pending plan without executing it. Args: plan_id. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'plan_id' => array( 'type' => 'string' ),
			),
			'required' => array( 'plan_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Plan_Store::maybe_create_table();
				return WPXMCP_Plan_Store::discard( $a['plan_id'] ?? '' );
			},
		);

		$reg['list_pending_plans'] = array(
			'desc'     => 'List the current user\'s pending (not yet applied or expired) plans. Returns plan_id, label, status, created_at, expires_at for each. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				WPXMCP_Plan_Store::maybe_create_table();
				return WPXMCP_Plan_Store::list_pending();
			},
		);

		return $reg;
	}
}
