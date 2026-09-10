<?php
/**
 * Core Novamira-inspired tools and helpers.
 * Includes robust filesystem management and path resolution.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

// Polyfill for PHP < 8.0
if ( ! function_exists( 'str_starts_with' ) ) {
	function str_starts_with( $haystack, $needle ) {
		return 0 === strpos( $haystack, $needle );
	}
}

class WPXMCP_Tools_Novamira_Core {

	/**
	 * Resolve a filesystem path, ensuring it stays within the allowed base directory.
	 */
	public static function resolve_path( $path, $must_exist = false ) {
		if ( ! str_starts_with( $path, '/' ) && ! str_starts_with( $path, '\\' ) ) {
			$path = ABSPATH . $path;
		}

		$base_dir = apply_filters( 'wpxmcp_filesystem_base_dir', ABSPATH );
		$resolved = self::normalize_path( $path );

		if ( $must_exist ) {
			$real = realpath( $path );
			if ( $real === false ) {
				throw new Exception( "Path does not exist: $path" );
			}
			$resolved = $real;
		}

		if ( $base_dir !== false ) {
			$real_base = realpath( $base_dir ) ?: rtrim( $base_dir, '/\\' );
			if ( ! str_starts_with( self::normalize_path( $resolved ), self::normalize_path( $real_base ) ) ) {
				throw new Exception( "Access denied: Path is outside base directory." );
			}
		}

		return $resolved;
	}

	private static function normalize_path( $path ) {
		$path = str_replace( '\\', '/', $path );
		$parts = array_filter( explode( '/', $path ), 'strlen' );
		$absolutes = array();
		foreach ( $parts as $part ) {
			if ( '.' == $part ) continue;
			if ( '..' == $part ) {
				array_pop( $absolutes );
			} else {
				$absolutes[] = $part;
			}
		}
		return ( str_starts_with( $path, '/' ) ? '/' : '' ) . implode( '/', $absolutes );
	}

	public static function all(): array {
		$tools = array();

		// ============================================================
		// LIST DIRECTORY
		// ============================================================
		$tools['list_directory'] = array(
			'desc'    => 'List files/folders at a path (alternate filesystem tool). Can expose sensitive paths. Medium risk. Prefer fm_list_directory when possible. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'path'      => array( 'type' => 'string', 'description' => 'Path relative to WP root.' ),
				'recursive' => array( 'type' => 'boolean', 'default' => false ),
				'pattern'   => array( 'type' => 'string', 'default' => '*' ),
			),
			'handler'  => function ( $a ) {
				$path = self::resolve_path( $a['path'] ?? '', true );
				if ( ! is_dir( $path ) ) throw new Exception( "Not a directory." );

				$entries = array();
				$dir = new DirectoryIterator( $path );
				foreach ( $dir as $fileinfo ) {
					if ( $fileinfo->isDot() ) continue;
					$entries[] = array(
						'name' => $fileinfo->getFilename(),
						'type' => $fileinfo->isDir() ? 'directory' : 'file',
						'size' => $fileinfo->isFile() ? $fileinfo->getSize() : 0,
						'modified' => date( 'c', $fileinfo->getMTime() ),
					);
				}

				return array( 'path' => $path, 'entries' => $entries );
			},
		);

		// ============================================================
		// READ FILE
		// ============================================================
		$tools['read_file'] = array(
			'desc'    => 'Read any file contents (config, code, backups). HIGH RISK if key leaks — secrets can be stolen. Prefer fm_read_file. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'path' => array( 'type' => 'string' ),
			),
			'required' => array( 'path' ),
			'handler'  => function ( $a ) {
				$path = self::resolve_path( $a['path'], true );
				if ( ! is_file( $path ) ) throw new Exception( "Not a file." );
				return array( 'content' => file_get_contents( $path ) );
			},
		);

		// ============================================================
		// WRITE FILE
		// ============================================================
		$tools['write_file'] = array(
			'desc'    => 'Overwrite any file on the server. CRITICAL RISK: can break the site or plant malware. Prefer fm_write_file with confirm. [risk: destructive]',
			'risk'    => 'destructive',
			'schema'  => array(
				'path'    => array( 'type' => 'string' ),
				'content' => array( 'type' => 'string' ),
				'append'  => array( 'type' => 'boolean', 'default' => false ),
			),
			'required' => array( 'path', 'content' ),
			'handler'  => function ( $a ) {
				$path = self::resolve_path( $a['path'] );
				$dir = dirname( $path );
				if ( ! is_dir( $dir ) ) wp_mkdir_p( $dir );
				
				$flags = ( ! empty( $a['append'] ) ) ? FILE_APPEND : 0;
				$res = file_put_contents( $path, $a['content'], $flags );
				if ( $res === false ) throw new Exception( "Failed to write file." );
				
				return array( 'success' => true, 'bytes' => $res );
			},
		);

		// ============================================================
		// EDIT FILE (STRING REPLACE)
		// ============================================================
		$tools['edit_file'] = array(
			'desc'    => 'Search-and-replace inside a file. HIGH RISK: can corrupt code or config. Prefer fm_edit_file. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'path'   => array( 'type' => 'string' ),
				'find'   => array( 'type' => 'string' ),
				'replace' => array( 'type' => 'string' ),
			),
			'required' => array( 'path', 'find', 'replace' ),
			'handler'  => function ( $a ) {
				$path = self::resolve_path( $a['path'], true );
				$content = file_get_contents( $path );
				$new_content = str_replace( $a['find'], $a['replace'], $content );
				file_put_contents( $path, $new_content );
				return array( 'success' => true );
			},
		);

		// ============================================================
		// DELETE FILE
		// ============================================================
		$tools['delete_file'] = array(
			'desc'    => 'Delete a file or folder permanently. CRITICAL RISK: irreversible data loss. Prefer fm_delete with confirm. [risk: destructive]',
			'risk'    => 'destructive',
			'schema'  => array(
				'path' => array( 'type' => 'string' ),
			),
			'required' => array( 'path' ),
			'handler'  => function ( $a ) {
				$path = self::resolve_path( $a['path'], true );
				if ( is_dir( $path ) ) {
					$res = shell_exec( "rm -rf " . escapeshellarg( $path ) );
				} else {
					$res = unlink( $path );
				}
				return array( 'success' => ( $res !== false ) );
			},
		);

		// ============================================================
		// CREATE UPLOAD LINK
		// ============================================================
		$tools['create_upload_link'] = array(
			'desc'    => 'Create a signed upload URL. Medium–high risk: can be abused to upload malicious files if the link is shared. [risk: write]',
			'risk'    => 'write',
			'schema'  => array(
				'path' => array( 'type' => 'string', 'description' => 'Target path for the uploaded file.' ),
			),
			'required' => array( 'path' ),
			'handler'  => function ( $a ) {
				$token = bin2hex( random_bytes( 32 ) );
				$upload_links = get_option( 'wpxmcp_upload_links', array() );
				$upload_links[ $token ] = array(
					'path'   => self::resolve_path( $a['path'] ),
					'expiry' => time() + 3600,
				);
				update_option( 'wpxmcp_upload_links', $upload_links );

				return array(
					'upload_url' => add_query_arg( 'wpxmcp_upload', $token, home_url() ),
					'method'     => 'POST',
					'header'     => 'X-WPXMCP-Upload-Token',
					'token'      => $token,
				);
			},
		);

		return $tools;
	}
}
