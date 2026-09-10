<?php
/**
 * File Manager tool group for WP x MCP.
 *
 * Provides full server-side file and folder management via MCP:
 *   - Browse/list directories
 *   - Read, write, edit, delete, rename, copy, move files
 *   - Create and delete folders
 *   - Upload (base64) and download (base64) files
 *   - Archive: create zip, extract zip/rar/tar/gzip
 *   - Code editor with PHP/JS/CSS syntax checking
 *   - Get detailed file info (permissions, size, mime, etc.)
 *   - Chmod (change permissions)
 *
 * All destructive and write operations require explicit `confirm: true`
 * in the arguments — giving the AI agent a built-in "are you sure?" gate.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_FileManager {

	/**
	 * Allowed roots for path resolution. Anything outside these is blocked.
	 * By default: ABSPATH (the entire WordPress install) and WP_CONTENT_DIR.
	 * An additional root can be whitelisted via the `wpxmcp_fm_allowed_roots`
	 * filter so site owners can extend or restrict access.
	 */
	private static function allowed_roots(): array {
		$roots = array(
			rtrim( ABSPATH, '/\\' ),
			rtrim( WP_CONTENT_DIR, '/\\' ),
		);
		return (array) apply_filters( 'wpxmcp_fm_allowed_roots', $roots );
	}

	/**
	 * Resolve and validate a user-supplied path.
	 * - Converts to absolute using ABSPATH as base if relative.
	 * - Strips null bytes.
	 * - Ensures it sits inside an allowed root (path-traversal guard).
	 *
	 * @throws Exception When path is unsafe or disallowed.
	 */
	private static function safe_path( string $path ): string {
		// Strip null bytes.
		$path = str_replace( "\0", '', $path );

		// Make absolute.
		if ( ! path_is_absolute( $path ) ) {
			$path = ABSPATH . ltrim( $path, '/\\' );
		}

		// Real-path check (works on existing paths; for non-existent targets
		// we resolve the parent then re-append the basename).
		if ( file_exists( $path ) ) {
			$real = realpath( $path );
		} else {
			$parent = realpath( dirname( $path ) );
			if ( false === $parent ) {
				throw new Exception( "Parent directory does not exist for: {$path}" );
			}
			$real = $parent . DIRECTORY_SEPARATOR . basename( $path );
		}

		foreach ( self::allowed_roots() as $root ) {
			$root_real = realpath( $root );
			if ( $root_real && str_starts_with( $real, $root_real ) ) {
				return $real;
			}
		}

		throw new Exception( "Access denied: path '{$path}' is outside allowed roots." );
	}

	/**
	 * Guard for write/destructive operations: caller must pass confirm=true.
	 *
	 * @throws Exception When confirm is not explicitly true.
	 */
	private static function require_confirm( array $a, string $operation ): void {
		if ( empty( $a['confirm'] ) || true !== $a['confirm'] ) {
			throw new Exception(
				"Permission required: to {$operation} you must pass confirm=true. " .
				"Review the operation details and confirm only if you are certain."
			);
		}
	}

	/**
	 * Format bytes into a human-readable string.
	 */
	private static function human_size( int $bytes ): string {
		if ( $bytes < 1024 ) {
			return "{$bytes} B";
		}
		if ( $bytes < 1048576 ) {
			return round( $bytes / 1024, 1 ) . ' KB';
		}
		if ( $bytes < 1073741824 ) {
			return round( $bytes / 1048576, 1 ) . ' MB';
		}
		return round( $bytes / 1073741824, 2 ) . ' GB';
	}

	/**
	 * Return a simplified mime type string.
	 */
	private static function mime( string $path ): string {
		if ( ! function_exists( 'mime_content_type' ) ) {
			return 'application/octet-stream';
		}
		return (string) mime_content_type( $path );
	}

	/**
	 * Check if a file is text-editable (not binary) by extension and mime.
	 */
	private static function is_text_file( string $path ): bool {
		$text_ext = array(
			'php', 'phtml', 'js', 'mjs', 'ts', 'tsx', 'jsx',
			'css', 'scss', 'sass', 'less',
			'html', 'htm', 'xml', 'svg', 'json', 'jsonc',
			'md', 'txt', 'log', 'csv', 'tsv',
			'sh', 'bash', 'zsh', 'htaccess', 'env',
			'yaml', 'yml', 'toml', 'ini', 'conf', 'config',
			'sql', 'py', 'rb', 'java', 'c', 'cpp', 'h',
		);
		$ext = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
		if ( in_array( $ext, $text_ext, true ) ) {
			return true;
		}
		if ( file_exists( $path ) ) {
			$mime = self::mime( $path );
			return str_starts_with( $mime, 'text/' ) || in_array( $mime, array( 'application/json', 'application/xml', 'application/javascript' ), true );
		}
		return false;
	}

	/**
	 * Very lightweight PHP syntax check (no disk write required).
	 * Returns array( 'ok' => bool, 'message' => string ).
	 */
	private static function php_syntax_check( string $code ): array {
		// 1) Pure-PHP parse check — no shell, works on hosts that disable exec()
		//    (Cloudways, Kinsta, hardened cPanel). token_get_all() with TOKEN_PARSE
		//    throws ParseError on a syntax error, which is what `php -l` catches too.
		if ( function_exists( 'token_get_all' ) && defined( 'TOKEN_PARSE' ) ) {
			try {
				token_get_all( $code, TOKEN_PARSE );
				return array( 'ok' => true, 'message' => 'PHP syntax OK (tokenizer).' );
			} catch ( \ParseError $e ) {
				return array(
					'ok'      => false,
					'message' => 'PHP parse error: ' . $e->getMessage() . ' on line ' . $e->getLine(),
				);
			} catch ( \Throwable $e ) {
				// Unexpected — fall through to the exec path if available.
				unset( $e );
			}
		}

		// 2) Fallback to `php -l` ONLY when exec() exists and isn't disabled.
		$disabled = array_map( 'trim', explode( ',', (string) ini_get( 'disable_functions' ) ) );
		if ( function_exists( 'exec' ) && ! in_array( 'exec', $disabled, true ) ) {
			$tmp = tempnam( sys_get_temp_dir(), 'wpxmcp_syntax_' ) . '.php';
			file_put_contents( $tmp, $code );
			$output     = array();
			$return_var = 0;
			@exec( 'php -l ' . escapeshellarg( $tmp ) . ' 2>&1', $output, $return_var );
			@unlink( $tmp );
			$message = str_replace( $tmp, '<file>', implode( "\n", $output ) );
			return array(
				'ok'      => 0 === $return_var,
				'message' => trim( $message ),
			);
		}

		// 3) No checker available — don't block the save, just say so.
		return array( 'ok' => true, 'message' => 'Syntax check skipped (no tokenizer or exec available).' );
	}

	/**
	 * Run JS/JSON/CSS lint using a regex-based heuristic when Node is unavailable.
	 * Returns array( 'ok' => bool, 'message' => string ).
	 * For PHP files, delegates to php_syntax_check().
	 */
	private static function syntax_check( string $code, string $extension ): array {
		switch ( strtolower( $extension ) ) {
			case 'php':
			case 'phtml':
				return self::php_syntax_check( $code );

			case 'json':
			case 'jsonc':
				$decoded = json_decode( $code );
				if ( null === $decoded && JSON_ERROR_NONE !== json_last_error() ) {
					return array( 'ok' => false, 'message' => 'JSON error: ' . json_last_error_msg() );
				}
				return array( 'ok' => true, 'message' => 'JSON is valid.' );

			case 'xml':
			case 'svg':
				libxml_use_internal_errors( true );
				simplexml_load_string( $code );
				$errors = libxml_get_errors();
				libxml_clear_errors();
				if ( ! empty( $errors ) ) {
					$msgs = array_map( fn( $e ) => trim( $e->message ) . ' (line ' . $e->line . ')', $errors );
					return array( 'ok' => false, 'message' => implode( '; ', $msgs ) );
				}
				return array( 'ok' => true, 'message' => 'XML is well-formed.' );

			case 'js':
			case 'mjs':
			case 'jsx':
			case 'ts':
			case 'tsx':
				// Check for obvious unclosed braces/brackets.
				$opens  = substr_count( $code, '{' ) + substr_count( $code, '[' ) + substr_count( $code, '(' );
				$closes = substr_count( $code, '}' ) + substr_count( $code, ']' ) + substr_count( $code, ')' );
				if ( $opens !== $closes ) {
					return array( 'ok' => false, 'message' => 'Possible unbalanced brackets/braces. Manual review recommended.' );
				}
				return array( 'ok' => true, 'message' => 'Basic bracket balance OK. Full AST lint requires Node.js.' );

			case 'css':
			case 'scss':
			case 'less':
				$opens  = substr_count( $code, '{' );
				$closes = substr_count( $code, '}' );
				if ( $opens !== $closes ) {
					return array( 'ok' => false, 'message' => "Unbalanced braces: {$opens} opening vs {$closes} closing." );
				}
				return array( 'ok' => true, 'message' => 'CSS brace balance OK.' );

			default:
				return array( 'ok' => true, 'message' => 'No syntax checker for this file type.' );
		}
	}

	// =========================================================================
	// PUBLIC TOOL REGISTRY
	// =========================================================================

	public static function all(): array {
		$reg = array();

		// -----------------------------------------------------------------
		// fm_list_directory  — Browse a folder
		// -----------------------------------------------------------------
		$reg['fm_list_directory'] = array(
			'desc'    => 'List files and folders in a directory. Returns name, type, size, permissions, modified date, and mime for each entry. Defaults to the WordPress root (ABSPATH). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'path'        => array( 'type' => 'string', 'description' => 'Absolute or ABSPATH-relative path. Default: WordPress root.' ),
				'show_hidden' => array( 'type' => 'boolean', 'description' => 'Include dot-files. Default false.' ),
			),
			'handler' => function ( $a ) {
				$dir    = isset( $a['path'] ) ? self::safe_path( $a['path'] ) : rtrim( ABSPATH, '/\\' );
				$hidden = ! empty( $a['show_hidden'] );

				if ( ! is_dir( $dir ) ) {
					throw new Exception( "Not a directory: {$dir}" );
				}

				$entries = array();
				$items   = scandir( $dir );
				foreach ( $items as $item ) {
					if ( '.' === $item || '..' === $item ) {
						continue;
					}
					if ( ! $hidden && str_starts_with( $item, '.' ) ) {
						continue;
					}
					$full     = $dir . DIRECTORY_SEPARATOR . $item;
					$is_dir   = is_dir( $full );
					$stat     = stat( $full );
					$entries[] = array(
						'name'        => $item,
						'type'        => $is_dir ? 'directory' : 'file',
						'size'        => $is_dir ? null : ( $stat['size'] ?? 0 ),
						'size_human'  => $is_dir ? null : self::human_size( $stat['size'] ?? 0 ),
						'permissions' => substr( sprintf( '%o', $stat['mode'] ?? 0 ), -4 ),
						'owner_uid'   => $stat['uid'] ?? null,
						'modified'    => date( 'Y-m-d H:i:s', $stat['mtime'] ?? 0 ),
						'mime'        => $is_dir ? 'inode/directory' : self::mime( $full ),
						'is_writable' => is_writable( $full ),
						'is_readable' => is_readable( $full ),
					);
				}

				// Folders first, then files, both alpha.
				usort( $entries, function ( $a, $b ) {
					if ( $a['type'] !== $b['type'] ) {
						return $a['type'] === 'directory' ? -1 : 1;
					}
					return strcasecmp( $a['name'], $b['name'] );
				} );

				return array(
					'path'      => $dir,
					'count'     => count( $entries ),
					'entries'   => $entries,
					'writable'  => is_writable( $dir ),
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_get_file_info  — Detailed properties of a single file/folder
		// -----------------------------------------------------------------
		$reg['fm_get_file_info'] = array(
			'desc'    => 'Get full details of a file or folder: size, permissions (octal), owner, timestamps, mime, md5 hash, editable flag, and archive type detection. Equivalent to right-click → Get Info.',
			'risk'    => 'read',
			'schema'  => array(
				'path' => array( 'type' => 'string', 'description' => 'Path to the file or folder.' ),
			),
			'required' => array( 'path' ),
			'handler'  => function ( $a ) {
				$path = self::safe_path( $a['path'] );
				if ( ! file_exists( $path ) ) {
					throw new Exception( "Path does not exist: {$path}" );
				}
				$stat    = stat( $path );
				$is_dir  = is_dir( $path );
				$is_link = is_link( $path );

				$info = array(
					'path'           => $path,
					'name'           => basename( $path ),
					'type'           => $is_link ? 'symlink' : ( $is_dir ? 'directory' : 'file' ),
					'extension'      => $is_dir ? null : pathinfo( $path, PATHINFO_EXTENSION ),
					'size_bytes'     => $is_dir ? null : filesize( $path ),
					'size_human'     => $is_dir ? null : self::human_size( filesize( $path ) ),
					'permissions'    => substr( sprintf( '%o', $stat['mode'] ), -4 ),
					'owner_uid'      => $stat['uid'],
					'group_gid'      => $stat['gid'],
					'is_readable'    => is_readable( $path ),
					'is_writable'    => is_writable( $path ),
					'is_executable'  => is_executable( $path ),
					'created'        => date( 'Y-m-d H:i:s', $stat['ctime'] ),
					'modified'       => date( 'Y-m-d H:i:s', $stat['mtime'] ),
					'accessed'       => date( 'Y-m-d H:i:s', $stat['atime'] ),
					'mime'           => $is_dir ? 'inode/directory' : self::mime( $path ),
					'is_text'        => $is_dir ? false : self::is_text_file( $path ),
					'md5'            => ( ! $is_dir && is_readable( $path ) ) ? md5_file( $path ) : null,
					'symlink_target' => $is_link ? readlink( $path ) : null,
				);

				// Detect archive type.
				if ( ! $is_dir ) {
					$ext = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
					$info['is_archive'] = in_array( $ext, array( 'zip', 'tar', 'gz', 'tgz', 'bz2', 'rar', 'xz' ), true );
					$info['archive_type'] = $info['is_archive'] ? $ext : null;
				}

				return $info;
			},
		);

		// -----------------------------------------------------------------
		// fm_read_file  — Read a text file
		// -----------------------------------------------------------------
		$reg['fm_read_file'] = array(
			'desc'    => 'Read the contents of a text file. Returns the file content as a string, with optional line-range slicing (start_line / end_line). Binary files are rejected.',
			'risk'    => 'read',
			'schema'  => array(
				'path'       => array( 'type' => 'string' ),
				'start_line' => array( 'type' => 'integer', 'description' => '1-based start line. Default: 1.' ),
				'end_line'   => array( 'type' => 'integer', 'description' => '1-based end line inclusive. Default: all.' ),
			),
			'required' => array( 'path' ),
			'handler'  => function ( $a ) {
				$path = self::safe_path( $a['path'] );
				if ( ! file_exists( $path ) ) {
					throw new Exception( "File does not exist: {$path}" );
				}
				if ( is_dir( $path ) ) {
					throw new Exception( "Path is a directory. Use fm_list_directory instead." );
				}
				if ( ! self::is_text_file( $path ) ) {
					throw new Exception( "File appears to be binary. Use fm_download_file to get a base64 copy." );
				}
				if ( ! is_readable( $path ) ) {
					throw new Exception( "File is not readable (check permissions)." );
				}

				$lines = file( $path, FILE_IGNORE_NEW_LINES );
				if ( false === $lines ) {
					throw new Exception( "Failed to read file." );
				}

				$total_lines = count( $lines );
				$start       = max( 1, (int) ( $a['start_line'] ?? 1 ) );
				$end         = isset( $a['end_line'] ) ? min( (int) $a['end_line'], $total_lines ) : $total_lines;

				$sliced = array_slice( $lines, $start - 1, $end - $start + 1 );

				return array(
					'path'        => $path,
					'total_lines' => $total_lines,
					'start_line'  => $start,
					'end_line'    => $end,
					'content'     => implode( "\n", $sliced ),
					'size_bytes'  => filesize( $path ),
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_write_file  — Create or overwrite a text file (with syntax check)
		// -----------------------------------------------------------------
		$reg['fm_write_file'] = array(
			'desc'    => 'Write (create or overwrite) a file with the supplied content. For PHP/JS/CSS/JSON files a syntax check is run first — if it fails the save is blocked unless force_save=true. Pass confirm=true to authorise the write.',
			'risk'    => 'write',
			'schema'  => array(
				'path'       => array( 'type' => 'string', 'description' => 'Target file path.' ),
				'content'    => array( 'type' => 'string', 'description' => 'New file content (UTF-8 text).' ),
				'force_save' => array( 'type' => 'boolean', 'description' => 'Save even if syntax check fails. Default false.' ),
				'confirm'    => array( 'type' => 'boolean', 'description' => 'Must be true to authorise the write.' ),
			),
			'required' => array( 'path', 'content', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'write a file' );
				$path    = self::safe_path( $a['path'] );
				$content = $a['content'];
				$ext     = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );

				// Syntax check before saving.
				$check = self::syntax_check( $content, $ext );
				if ( ! $check['ok'] && empty( $a['force_save'] ) ) {
					return array(
						'saved'         => false,
						'syntax_ok'     => false,
						'syntax_message'=> $check['message'],
						'note'          => 'File NOT saved. Fix the error or pass force_save=true to override.',
					);
				}

				// Create parent directory if needed.
				$parent = dirname( $path );
				if ( ! is_dir( $parent ) ) {
					wp_mkdir_p( $parent );
				}

				$bytes = file_put_contents( $path, $content );
				if ( false === $bytes ) {
					throw new Exception( "Failed to write file '{$path}'. Check directory permissions." );
				}

				return array(
					'saved'          => true,
					'path'           => $path,
					'bytes_written'  => $bytes,
					'syntax_ok'      => $check['ok'],
					'syntax_message' => $check['message'],
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_edit_file  — Targeted search-and-replace inside a file
		// -----------------------------------------------------------------
		$reg['fm_edit_file'] = array(
			'desc'    => 'Edit a file by replacing an exact string occurrence with new content. Safer than full overwrite for targeted edits. A syntax check runs after the replacement. Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'path'       => array( 'type' => 'string' ),
				'old_string' => array( 'type' => 'string', 'description' => 'Exact string to find and replace (must appear exactly once).' ),
				'new_string' => array( 'type' => 'string', 'description' => 'Replacement string.' ),
				'force_save' => array( 'type' => 'boolean', 'description' => 'Save even if syntax check fails. Default false.' ),
				'confirm'    => array( 'type' => 'boolean', 'description' => 'Must be true to authorise the edit.' ),
			),
			'required' => array( 'path', 'old_string', 'new_string', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'edit a file' );
				$path = self::safe_path( $a['path'] );

				if ( ! file_exists( $path ) ) {
					throw new Exception( "File does not exist: {$path}" );
				}
				if ( ! is_writable( $path ) ) {
					throw new Exception( "File is not writable." );
				}

				$original = file_get_contents( $path );
				$count    = substr_count( $original, $a['old_string'] );

				if ( 0 === $count ) {
					throw new Exception( "old_string not found in file. No changes made." );
				}
				if ( $count > 1 ) {
					throw new Exception( "old_string appears {$count} times — it must be unique. Refine the search string and try again." );
				}

				$new_content = str_replace( $a['old_string'], $a['new_string'], $original );
				$ext         = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
				$check       = self::syntax_check( $new_content, $ext );

				if ( ! $check['ok'] && empty( $a['force_save'] ) ) {
					return array(
						'saved'          => false,
						'syntax_ok'      => false,
						'syntax_message' => $check['message'],
						'note'           => 'File NOT saved. Fix the error or pass force_save=true to override.',
					);
				}

				file_put_contents( $path, $new_content );

				return array(
					'saved'          => true,
					'path'           => $path,
					'syntax_ok'      => $check['ok'],
					'syntax_message' => $check['message'],
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_syntax_check  — Check code without saving
		// -----------------------------------------------------------------
		$reg['fm_syntax_check'] = array(
			'desc'    => 'Run a syntax / lint check on a block of code without saving it. Supports PHP, JSON, XML/SVG, CSS, JS. Returns ok flag and error message. Use before fm_write_file to validate code.',
			'risk'    => 'read',
			'schema'  => array(
				'code'      => array( 'type' => 'string', 'description' => 'Code to check.' ),
				'extension' => array( 'type' => 'string', 'description' => 'File extension without dot, e.g. php, js, json, css.' ),
			),
			'required' => array( 'code', 'extension' ),
			'handler'  => function ( $a ) {
				return self::syntax_check( $a['code'], $a['extension'] );
			},
		);

		// -----------------------------------------------------------------
		// fm_delete  — Delete a file or folder (confirm required)
		// -----------------------------------------------------------------
		$reg['fm_delete'] = array(
			'desc'    => 'Delete a file or folder. Folders are deleted recursively if recursive=true. This is IRREVERSIBLE — pass confirm=true to authorise.',
			'risk'    => 'destructive',
			'schema'  => array(
				'path'      => array( 'type' => 'string' ),
				'recursive' => array( 'type' => 'boolean', 'description' => 'Required to delete a non-empty directory. Default false.' ),
				'confirm'   => array( 'type' => 'boolean', 'description' => 'Must be true to authorise deletion.' ),
			),
			'required' => array( 'path', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'delete' );
				$path = self::safe_path( $a['path'] );

				if ( ! file_exists( $path ) && ! is_link( $path ) ) {
					throw new Exception( "Path does not exist: {$path}" );
				}

				if ( is_dir( $path ) && ! is_link( $path ) ) {
					if ( empty( $a['recursive'] ) ) {
						throw new Exception( "'{$path}' is a directory. Pass recursive=true to delete it and all its contents." );
					}
					// Recursive delete using WP_Filesystem helper.
					global $wp_filesystem;
					if ( ! $wp_filesystem ) {
						require_once ABSPATH . 'wp-admin/includes/file.php';
						WP_Filesystem();
					}
					$result = $wp_filesystem->rmdir( $path, true );
					if ( ! $result ) {
						throw new Exception( "Failed to delete directory '{$path}'." );
					}
				} else {
					if ( ! unlink( $path ) ) {
						throw new Exception( "Failed to delete file '{$path}'." );
					}
				}

				return array( 'deleted' => true, 'path' => $path );
			},
		);

		// -----------------------------------------------------------------
		// fm_rename  — Rename a file or folder (confirm required)
		// -----------------------------------------------------------------
		$reg['fm_rename'] = array(
			'desc'    => 'Rename a file or folder within the same directory. Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'path'     => array( 'type' => 'string', 'description' => 'Current path.' ),
				'new_name' => array( 'type' => 'string', 'description' => 'New basename only (no slashes).' ),
				'confirm'  => array( 'type' => 'boolean' ),
			),
			'required' => array( 'path', 'new_name', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'rename' );
				$path     = self::safe_path( $a['path'] );
				$new_name = basename( $a['new_name'] ); // strip any path component

				if ( strpos( $new_name, '/' ) !== false || strpos( $new_name, '\\' ) !== false || '' === $new_name ) {
					throw new Exception( "new_name must be a plain filename, no slashes." );
				}

				$dest = dirname( $path ) . DIRECTORY_SEPARATOR . $new_name;
				$dest = self::safe_path( $dest );

				if ( file_exists( $dest ) ) {
					throw new Exception( "A file/folder named '{$new_name}' already exists in the same directory." );
				}

				if ( ! rename( $path, $dest ) ) {
					throw new Exception( "Rename failed." );
				}

				return array( 'renamed' => true, 'from' => $path, 'to' => $dest );
			},
		);

		// -----------------------------------------------------------------
		// fm_copy  — Copy a file or folder (confirm required)
		// -----------------------------------------------------------------
		$reg['fm_copy'] = array(
			'desc'    => 'Copy a file or folder to a new destination. Folders are copied recursively. Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'source'      => array( 'type' => 'string', 'description' => 'Source path.' ),
				'destination' => array( 'type' => 'string', 'description' => 'Destination path (including filename for files, or target folder).' ),
				'overwrite'   => array( 'type' => 'boolean', 'description' => 'Overwrite destination if it exists. Default false.' ),
				'confirm'     => array( 'type' => 'boolean' ),
			),
			'required' => array( 'source', 'destination', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'copy' );
				$src  = self::safe_path( $a['source'] );
				$dest = self::safe_path( $a['destination'] );

				if ( ! file_exists( $src ) ) {
					throw new Exception( "Source does not exist: {$src}" );
				}
				if ( file_exists( $dest ) && empty( $a['overwrite'] ) ) {
					throw new Exception( "Destination already exists. Pass overwrite=true to replace it." );
				}

				if ( is_dir( $src ) ) {
					// Recursive copy.
					self::recursive_copy( $src, $dest );
				} else {
					wp_mkdir_p( dirname( $dest ) );
					if ( ! copy( $src, $dest ) ) {
						throw new Exception( "Copy failed." );
					}
				}

				return array( 'copied' => true, 'from' => $src, 'to' => $dest );
			},
		);

		// -----------------------------------------------------------------
		// fm_move  — Move / cut-paste (confirm required)
		// -----------------------------------------------------------------
		$reg['fm_move'] = array(
			'desc'    => 'Move (rename/relocate) a file or folder to a new destination. Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'source'      => array( 'type' => 'string' ),
				'destination' => array( 'type' => 'string' ),
				'overwrite'   => array( 'type' => 'boolean', 'description' => 'Overwrite destination. Default false.' ),
				'confirm'     => array( 'type' => 'boolean' ),
			),
			'required' => array( 'source', 'destination', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'move' );
				$src  = self::safe_path( $a['source'] );
				$dest = self::safe_path( $a['destination'] );

				if ( ! file_exists( $src ) ) {
					throw new Exception( "Source does not exist: {$src}" );
				}
				if ( file_exists( $dest ) && empty( $a['overwrite'] ) ) {
					throw new Exception( "Destination already exists. Pass overwrite=true to replace." );
				}

				wp_mkdir_p( dirname( $dest ) );
				if ( ! rename( $src, $dest ) ) {
					throw new Exception( "Move failed (cross-device moves may require a copy+delete)." );
				}

				return array( 'moved' => true, 'from' => $src, 'to' => $dest );
			},
		);

		// -----------------------------------------------------------------
		// fm_create_folder  — Create a new directory
		// -----------------------------------------------------------------
		$reg['fm_create_folder'] = array(
			'desc'    => 'Create a new directory (and any missing parent directories). Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'path'    => array( 'type' => 'string', 'description' => 'Path of the directory to create.' ),
				'confirm' => array( 'type' => 'boolean' ),
			),
			'required' => array( 'path', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'create a folder' );
				$path = self::safe_path( $a['path'] );

				if ( file_exists( $path ) ) {
					throw new Exception( "Path already exists: {$path}" );
				}
				if ( ! wp_mkdir_p( $path ) ) {
					throw new Exception( "Failed to create directory '{$path}'." );
				}

				return array( 'created' => true, 'path' => $path );
			},
		);

		// -----------------------------------------------------------------
		// fm_chmod  — Change file/folder permissions
		// -----------------------------------------------------------------
		$reg['fm_chmod'] = array(
			'desc'    => 'Change the permissions (chmod) of a file or directory. Supply an octal string like "0644" or "0755". Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'path'        => array( 'type' => 'string' ),
				'permissions' => array( 'type' => 'string', 'description' => 'Octal string, e.g. "0644", "0755", "0777".' ),
				'recursive'   => array( 'type' => 'boolean', 'description' => 'Apply recursively to all contents of a directory.' ),
				'confirm'     => array( 'type' => 'boolean' ),
			),
			'required' => array( 'path', 'permissions', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'change permissions' );
				$path = self::safe_path( $a['path'] );

				if ( ! file_exists( $path ) ) {
					throw new Exception( "Path does not exist: {$path}" );
				}

				$perm = octdec( ltrim( $a['permissions'], '0' ) ?: '0' );
				if ( ! $perm ) {
					throw new Exception( "Invalid permissions value '{$a['permissions']}'. Use an octal string like '0644'." );
				}

				if ( ! chmod( $path, $perm ) ) {
					throw new Exception( "chmod failed on '{$path}'." );
				}

				if ( ! empty( $a['recursive'] ) && is_dir( $path ) ) {
					self::recursive_chmod( $path, $perm );
				}

				return array(
					'chmod'       => true,
					'path'        => $path,
					'permissions' => $a['permissions'],
					'recursive'   => ! empty( $a['recursive'] ),
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_upload_file  — Upload via base64 (confirm required)
		// -----------------------------------------------------------------
		$reg['fm_upload_file'] = array(
			'desc'    => 'Upload a file by providing its content as a base64-encoded string. Pass confirm=true to authorise. Overwrites if the file already exists and overwrite=true.',
			'risk'    => 'write',
			'schema'  => array(
				'path'      => array( 'type' => 'string', 'description' => 'Destination path (including filename).' ),
				'content'   => array( 'type' => 'string', 'description' => 'Base64-encoded file content.' ),
				'overwrite' => array( 'type' => 'boolean', 'description' => 'Overwrite existing file. Default false.' ),
				'confirm'   => array( 'type' => 'boolean' ),
			),
			'required' => array( 'path', 'content', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'upload a file' );
				$path = self::safe_path( $a['path'] );

				if ( file_exists( $path ) && empty( $a['overwrite'] ) ) {
					throw new Exception( "File already exists at '{$path}'. Pass overwrite=true to replace it." );
				}

				$binary = base64_decode( $a['content'], true );
				if ( false === $binary ) {
					throw new Exception( "Invalid base64 content." );
				}

				wp_mkdir_p( dirname( $path ) );
				$bytes = file_put_contents( $path, $binary );
				if ( false === $bytes ) {
					throw new Exception( "Failed to write file. Check directory permissions." );
				}

				return array(
					'uploaded'   => true,
					'path'       => $path,
					'bytes'      => $bytes,
					'size_human' => self::human_size( $bytes ),
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_download_file  — Download a file as base64
		// -----------------------------------------------------------------
		$reg['fm_download_file'] = array(
			'desc'    => 'Read any file (binary or text) and return its content as a base64-encoded string so the AI can transfer or inspect it. Capped at 10 MB.',
			'risk'    => 'read',
			'schema'  => array(
				'path' => array( 'type' => 'string' ),
			),
			'required' => array( 'path' ),
			'handler'  => function ( $a ) {
				$path = self::safe_path( $a['path'] );
				if ( ! file_exists( $path ) || is_dir( $path ) ) {
					throw new Exception( "File does not exist: {$path}" );
				}
				if ( ! is_readable( $path ) ) {
					throw new Exception( "File is not readable." );
				}

				$size = filesize( $path );
				if ( $size > 10 * 1024 * 1024 ) {
					throw new Exception( "File too large (" . self::human_size( $size ) . "). Maximum for download tool is 10 MB. Use fm_create_archive to compress it first." );
				}

				$binary = file_get_contents( $path );
				if ( false === $binary ) {
					throw new Exception( "Failed to read file." );
				}

				return array(
					'path'       => $path,
					'size_bytes' => $size,
					'mime'       => self::mime( $path ),
					'content'    => base64_encode( $binary ),
					'encoding'   => 'base64',
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_create_archive  — Create a zip archive
		// -----------------------------------------------------------------
		$reg['fm_create_archive'] = array(
			'desc'    => 'Create a ZIP archive from one or more files/folders. Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'sources'     => array(
					'type'        => 'array',
					'description' => 'Array of source paths to include in the archive.',
					'items'       => array( 'type' => 'string' ),
				),
				'destination' => array( 'type' => 'string', 'description' => 'Output .zip file path.' ),
				'overwrite'   => array( 'type' => 'boolean', 'description' => 'Overwrite if destination exists. Default false.' ),
				'confirm'     => array( 'type' => 'boolean' ),
			),
			'required' => array( 'sources', 'destination', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'create an archive' );

				if ( ! class_exists( 'ZipArchive' ) ) {
					throw new Exception( "PHP ZipArchive extension is not available on this server." );
				}

				$dest = self::safe_path( $a['destination'] );
				if ( file_exists( $dest ) && empty( $a['overwrite'] ) ) {
					throw new Exception( "Destination '{$dest}' already exists. Pass overwrite=true." );
				}

				wp_mkdir_p( dirname( $dest ) );
				$zip = new ZipArchive();
				$res = $zip->open( $dest, ZipArchive::CREATE | ZipArchive::OVERWRITE );
				if ( true !== $res ) {
					throw new Exception( "Could not create zip file (ZipArchive error code: {$res})." );
				}

				$added = 0;
				foreach ( (array) $a['sources'] as $src_raw ) {
					$src = self::safe_path( $src_raw );
					if ( is_dir( $src ) ) {
						$added += self::zip_add_dir( $zip, $src, basename( $src ) );
					} elseif ( file_exists( $src ) ) {
						$zip->addFile( $src, basename( $src ) );
						++$added;
					}
				}

				$zip->close();

				return array(
					'created'     => true,
					'destination' => $dest,
					'files_added' => $added,
					'size_human'  => self::human_size( filesize( $dest ) ),
				);
			},
		);

		// -----------------------------------------------------------------
		// fm_extract_archive  — Extract zip / tar / gzip (confirm required)
		// -----------------------------------------------------------------
		$reg['fm_extract_archive'] = array(
			'desc'    => 'Extract a ZIP, tar, tar.gz, or gzip archive to a destination folder. Pass confirm=true to authorise.',
			'risk'    => 'write',
			'schema'  => array(
				'path'        => array( 'type' => 'string', 'description' => 'Archive file path.' ),
				'destination' => array( 'type' => 'string', 'description' => 'Folder to extract into. Created if it does not exist.' ),
				'overwrite'   => array( 'type' => 'boolean', 'description' => 'Overwrite existing files. Default false.' ),
				'confirm'     => array( 'type' => 'boolean' ),
			),
			'required' => array( 'path', 'destination', 'confirm' ),
			'handler'  => function ( $a ) {
				self::require_confirm( $a, 'extract an archive' );

				$archive = self::safe_path( $a['path'] );
				$dest    = self::safe_path( $a['destination'] );

				if ( ! file_exists( $archive ) ) {
					throw new Exception( "Archive not found: {$archive}" );
				}

				wp_mkdir_p( $dest );

				$ext = strtolower( pathinfo( $archive, PATHINFO_EXTENSION ) );

				// ZIP.
				if ( 'zip' === $ext ) {
					if ( ! class_exists( 'ZipArchive' ) ) {
						throw new Exception( "PHP ZipArchive extension is not available." );
					}
					$zip = new ZipArchive();
					if ( true !== $zip->open( $archive ) ) {
						throw new Exception( "Failed to open zip file." );
					}
					$zip->extractTo( $dest );
					$zip->close();
					return array( 'extracted' => true, 'destination' => $dest, 'format' => 'zip' );
				}

				// Tar / tar.gz / tgz / gz — use WP_Filesystem + PclZip fallback.
				if ( in_array( $ext, array( 'gz', 'tgz', 'tar', 'bz2', 'xz' ), true ) ) {
					require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
					// Use PHP's Phar for tar if available; otherwise use exec.
					if ( class_exists( 'PharData' ) ) {
						try {
							$phar = new PharData( $archive );
							$phar->extractTo( $dest, null, ! empty( $a['overwrite'] ) );
							return array( 'extracted' => true, 'destination' => $dest, 'format' => $ext );
						} catch ( Exception $e ) {
							throw new Exception( "Extraction failed: " . $e->getMessage() );
						}
					}
					// Last resort: shell exec (available on most hosts).
					$cmd    = '';
					$dest_e = escapeshellarg( $dest );
					$arc_e  = escapeshellarg( $archive );
					if ( in_array( $ext, array( 'gz', 'tgz' ), true ) ) {
						$cmd = "tar -xzf {$arc_e} -C {$dest_e}";
					} elseif ( 'tar' === $ext ) {
						$cmd = "tar -xf {$arc_e} -C {$dest_e}";
					} elseif ( 'bz2' === $ext ) {
						$cmd = "tar -xjf {$arc_e} -C {$dest_e}";
					} elseif ( 'xz' === $ext ) {
						$cmd = "tar -xJf {$arc_e} -C {$dest_e}";
					}
					if ( $cmd ) {
						exec( $cmd . ' 2>&1', $out, $code );
						if ( 0 !== $code ) {
							throw new Exception( "Extraction failed: " . implode( "\n", $out ) );
						}
						return array( 'extracted' => true, 'destination' => $dest, 'format' => $ext );
					}
				}

				throw new Exception( "Unsupported archive format: .{$ext}. Supported: zip, tar, tar.gz, tgz, bz2, xz." );
			},
		);

		// -----------------------------------------------------------------
		// fm_search  — Search for files by name or content
		// -----------------------------------------------------------------
		$reg['fm_search'] = array(
			'desc'    => 'Search for files by filename pattern and/or content string within a directory tree. Returns matching paths with context lines for content matches.',
			'risk'    => 'read',
			'schema'  => array(
				'path'            => array( 'type' => 'string', 'description' => 'Root directory to search. Default: WordPress root.' ),
				'filename_pattern'=> array( 'type' => 'string', 'description' => 'Glob or partial filename, e.g. "*.php" or "functions".' ),
				'content_search'  => array( 'type' => 'string', 'description' => 'String to search inside file contents.' ),
				'max_results'     => array( 'type' => 'integer', 'description' => 'Maximum matches to return. Default 50.' ),
				'case_sensitive'  => array( 'type' => 'boolean', 'description' => 'Case-sensitive content search. Default false.' ),
			),
			'handler' => function ( $a ) {
				$root    = isset( $a['path'] ) ? self::safe_path( $a['path'] ) : rtrim( ABSPATH, '/\\' );
				$max     = min( (int) ( $a['max_results'] ?? 50 ), 200 );
				$results = array();
				$fnpat   = $a['filename_pattern'] ?? '';
				$cstr    = $a['content_search'] ?? '';
				$cs      = ! empty( $a['case_sensitive'] );

				$iter = new RecursiveIteratorIterator(
					new RecursiveDirectoryIterator( $root, RecursiveDirectoryIterator::SKIP_DOTS ),
					RecursiveIteratorIterator::LEAVES_ONLY
				);

				foreach ( $iter as $file ) {
					if ( count( $results ) >= $max ) {
						break;
					}
					$filepath = $file->getPathname();
					$basename = $file->getFilename();

					// Filename filter.
					if ( $fnpat ) {
						$match = str_contains( $fnpat, '*' ) || str_contains( $fnpat, '?' )
							? fnmatch( $fnpat, $basename )
							: ( $cs
								? str_contains( $basename, $fnpat )
								: str_contains( strtolower( $basename ), strtolower( $fnpat ) ) );
						if ( ! $match ) {
							continue;
						}
					}

					// Content filter.
					if ( $cstr && self::is_text_file( $filepath ) && is_readable( $filepath ) ) {
						$text = file_get_contents( $filepath );
						$found = $cs ? str_contains( $text, $cstr ) : str_contains( strtolower( $text ), strtolower( $cstr ) );
						if ( ! $found ) {
							continue;
						}
						// Extract context lines.
						$lines   = explode( "\n", $text );
						$ctx     = array();
						$search  = $cs ? $cstr : strtolower( $cstr );
						foreach ( $lines as $i => $line ) {
							$hay = $cs ? $line : strtolower( $line );
							if ( str_contains( $hay, $search ) ) {
								$ctx[] = array( 'line' => $i + 1, 'text' => trim( $line ) );
							}
						}
						$results[] = array( 'path' => $filepath, 'matches' => $ctx );
					} elseif ( empty( $cstr ) ) {
						$results[] = array( 'path' => $filepath );
					}
				}

				return array(
					'root'       => $root,
					'count'      => count( $results ),
					'results'    => $results,
					'truncated'  => count( $results ) >= $max,
				);
			},
		);

		return $reg;
	}

	// =========================================================================
	// PRIVATE HELPERS
	// =========================================================================

	/**
	 * Recursively copy a directory.
	 */
	private static function recursive_copy( string $src, string $dest ): void {
		wp_mkdir_p( $dest );
		$items = scandir( $src );
		foreach ( $items as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$s = $src . DIRECTORY_SEPARATOR . $item;
			$d = $dest . DIRECTORY_SEPARATOR . $item;
			if ( is_dir( $s ) ) {
				self::recursive_copy( $s, $d );
			} else {
				copy( $s, $d );
			}
		}
	}

	/**
	 * Recursively chmod a directory.
	 */
	private static function recursive_chmod( string $dir, int $perm ): void {
		$items = scandir( $dir );
		foreach ( $items as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$full = $dir . DIRECTORY_SEPARATOR . $item;
			chmod( $full, $perm );
			if ( is_dir( $full ) ) {
				self::recursive_chmod( $full, $perm );
			}
		}
	}

	/**
	 * Add a directory recursively to an open ZipArchive.
	 * Returns count of added files.
	 */
	private static function zip_add_dir( ZipArchive $zip, string $dir, string $zip_prefix ): int {
		$added = 0;
		$items = scandir( $dir );
		foreach ( $items as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$full       = $dir . DIRECTORY_SEPARATOR . $item;
			$zip_path   = $zip_prefix . '/' . $item;
			if ( is_dir( $full ) ) {
				$zip->addEmptyDir( $zip_path );
				$added += self::zip_add_dir( $zip, $full, $zip_path );
			} else {
				$zip->addFile( $full, $zip_path );
				++$added;
			}
		}
		return $added;
	}
}
