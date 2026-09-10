<?php
/**
 * Block plugins + popular theme helpers for WP x MCP.
 *
 * GenerateBlocks, Kadence Blocks, Spectra (UAG) — block content helpers.
 * Astra, GeneratePress, Kadence — theme mods / header-footer related settings.
 * Each family is plugin/theme-gated. Default OFF in Managed Tools.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Blocks_Themes {

	public static function all(): array {
		return array_merge(
			self::generateblocks(),
			self::kadence_blocks(),
			self::spectra(),
			self::astra(),
			self::generatepress(),
			self::kadence_theme()
		);
	}

	// ═══════════════════════════════════════════════════════════════
	// GenerateBlocks
	// ═══════════════════════════════════════════════════════════════

	private static function gb_active(): bool {
		return defined( 'GENERATEBLOCKS_VERSION' ) || class_exists( 'GenerateBlocks_Plugin' );
	}

	private static function generateblocks(): array {
		if ( ! self::gb_active() ) {
			return array();
		}
		$reg = array();

		$reg['gb_plugin_info'] = array(
			'desc'    => 'GenerateBlocks plugin status and version. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'active'  => true,
					'version' => defined( 'GENERATEBLOCKS_VERSION' ) ? GENERATEBLOCKS_VERSION : null,
				);
			},
		);

		$reg['gb_list_posts_with_blocks'] = array(
			'desc'    => 'Find posts/pages whose content contains GenerateBlocks blocks (wp:generateblocks). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'post_type' => array( 'type' => 'string', 'description' => 'Default any. e.g. page, post.' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Default 20, max 50.' ),
			),
			'handler' => function ( $a ) {
				$per = min( 50, max( 1, (int) ( $a['per_page'] ?? 20 ) ) );
				$args = array(
					'post_type'      => ! empty( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : array( 'post', 'page' ),
					'posts_per_page' => $per,
					'post_status'    => array( 'publish', 'draft' ),
					's'              => 'wp:generateblocks',
				);
				$q = new WP_Query( $args );
				$out = array();
				foreach ( $q->posts as $p ) {
					if ( false === strpos( (string) $p->post_content, 'wp:generateblocks' ) ) {
						continue;
					}
					$out[] = array(
						'id'    => (int) $p->ID,
						'title' => $p->post_title,
						'type'  => $p->post_type,
						'status'=> $p->post_status,
						'link'  => get_permalink( $p ),
					);
				}
				return array( 'count' => count( $out ), 'posts' => $out );
			},
		);

		$reg['gb_extract_blocks'] = array(
			'desc'     => 'Parse GenerateBlocks blocks from a post (block name, attrs summary, inner content length). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$blocks = parse_blocks( $post->post_content );
				$found  = self::filter_blocks_recursive( $blocks, 'generateblocks' );
				return array( 'post_id' => (int) $post->ID, 'count' => count( $found ), 'blocks' => $found );
			},
		);

		$reg['gb_get_css'] = array(
			'desc'    => 'Get GenerateBlocks CSS settings / generated CSS option if available. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'generateblocks_option' => get_option( 'generateblocks', null ),
					'generateblocks_settings' => get_option( 'generateblocks_settings', null ),
					'dynamic_css_posts' => get_option( 'generateblocks_dynamic_css_posts', null ),
				);
			},
		);

		$reg['gb_count_block_types'] = array(
			'desc'     => 'Count GenerateBlocks block types used in a post (container, grid, button, headline, image, etc.). [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$blocks = parse_blocks( $post->post_content );
				$found  = self::filter_blocks_recursive( $blocks, 'generateblocks' );
				$counts = array();
				foreach ( $found as $b ) {
					$name = $b['blockName'];
					$counts[ $name ] = ( $counts[ $name ] ?? 0 ) + 1;
				}
				return array( 'post_id' => (int) $post->ID, 'total' => count( $found ), 'by_type' => $counts );
			},
		);

		$reg['gb_update_block_attrs'] = array(
			'desc'     => 'Update attributes on GenerateBlocks blocks in a post by blockName match (optional uniqueId in attrs). Merges attrs into matching blocks and saves post. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'   => array( 'type' => 'integer' ),
				'blockName' => array( 'type' => 'string', 'description' => 'e.g. generateblocks/container or generateblocks/headline' ),
				'attrs'     => array( 'type' => 'object', 'description' => 'Attributes to merge into matching blocks.' ),
				'uniqueId'  => array( 'type' => 'string', 'description' => 'Optional: only update block with this uniqueId attr.' ),
			),
			'required' => array( 'post_id', 'blockName', 'attrs' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				if ( empty( $a['attrs'] ) || ! is_array( $a['attrs'] ) ) {
					throw new Exception( 'attrs object required.' );
				}
				$blocks = parse_blocks( $post->post_content );
				$updated = 0;
				$blocks  = self::map_blocks_recursive( $blocks, function ( $b ) use ( $a, &$updated ) {
					$name = $b['blockName'] ?? '';
					if ( $name !== $a['blockName'] ) {
						return $b;
					}
					if ( ! empty( $a['uniqueId'] ) ) {
						$uid = $b['attrs']['uniqueId'] ?? ( $b['attrs']['blockId'] ?? '' );
						if ( (string) $uid !== (string) $a['uniqueId'] ) {
							return $b;
						}
					}
					$b['attrs'] = array_merge( is_array( $b['attrs'] ?? null ) ? $b['attrs'] : array(), $a['attrs'] );
					$updated++;
					return $b;
				} );
				if ( ! $updated ) {
					throw new Exception( 'No matching GenerateBlocks blocks updated.' );
				}
				$content = serialize_blocks( $blocks );
				$r = wp_update_post( array( 'ID' => $post->ID, 'post_content' => $content ), true );
				if ( is_wp_error( $r ) ) {
					throw new Exception( $r->get_error_message() );
				}
				return array( 'post_id' => (int) $post->ID, 'blocks_updated' => $updated );
			},
		);

		$reg['gb_replace_block_html'] = array(
			'desc'     => 'Replace inner content/HTML for GenerateBlocks blocks matching blockName (optional uniqueId). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'    => array( 'type' => 'integer' ),
				'blockName'  => array( 'type' => 'string' ),
				'innerHTML'  => array( 'type' => 'string' ),
				'uniqueId'   => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'blockName', 'innerHTML' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$blocks = parse_blocks( $post->post_content );
				$updated = 0;
				$blocks  = self::map_blocks_recursive( $blocks, function ( $b ) use ( $a, &$updated ) {
					$name = $b['blockName'] ?? '';
					if ( $name !== $a['blockName'] ) {
						return $b;
					}
					if ( ! empty( $a['uniqueId'] ) ) {
						$uid = $b['attrs']['uniqueId'] ?? ( $b['attrs']['blockId'] ?? '' );
						if ( (string) $uid !== (string) $a['uniqueId'] ) {
							return $b;
						}
					}
					$b['innerHTML']    = (string) $a['innerHTML'];
					$b['innerContent'] = array( (string) $a['innerHTML'] );
					$updated++;
					return $b;
				} );
				if ( ! $updated ) {
					throw new Exception( 'No matching blocks found.' );
				}
				$r = wp_update_post( array( 'ID' => $post->ID, 'post_content' => serialize_blocks( $blocks ) ), true );
				if ( is_wp_error( $r ) ) {
					throw new Exception( $r->get_error_message() );
				}
				return array( 'post_id' => (int) $post->ID, 'blocks_updated' => $updated );
			},
		);

		return $reg;
	}

	// ═══════════════════════════════════════════════════════════════
	// Kadence Blocks
	// ═══════════════════════════════════════════════════════════════

	private static function kadence_blocks_active(): bool {
		return defined( 'KADENCE_BLOCKS_VERSION' ) || class_exists( 'Kadence_Blocks_Plugin' );
	}

	private static function kadence_blocks(): array {
		if ( ! self::kadence_blocks_active() ) {
			return array();
		}
		$reg = array();

		$reg['kadence_blocks_info'] = array(
			'desc'    => 'Kadence Blocks plugin status and version. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'active'  => true,
					'version' => defined( 'KADENCE_BLOCKS_VERSION' ) ? KADENCE_BLOCKS_VERSION : null,
				);
			},
		);

		$reg['kadence_blocks_list_posts'] = array(
			'desc'    => 'Find posts/pages with Kadence Blocks (wp:kadence). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'post_type' => array( 'type' => 'string' ),
				'per_page'  => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				$per = min( 50, max( 1, (int) ( $a['per_page'] ?? 20 ) ) );
				$q = new WP_Query( array(
					'post_type'      => ! empty( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : array( 'post', 'page' ),
					'posts_per_page' => $per,
					'post_status'    => array( 'publish', 'draft' ),
					's'              => 'wp:kadence',
				) );
				$out = array();
				foreach ( $q->posts as $p ) {
					if ( false === strpos( (string) $p->post_content, 'wp:kadence' ) ) {
						continue;
					}
					$out[] = array(
						'id'     => (int) $p->ID,
						'title'  => $p->post_title,
						'type'   => $p->post_type,
						'status' => $p->post_status,
						'link'   => get_permalink( $p ),
					);
				}
				return array( 'count' => count( $out ), 'posts' => $out );
			},
		);

		$reg['kadence_blocks_extract'] = array(
			'desc'     => 'Parse Kadence blocks from a post content. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$blocks = parse_blocks( $post->post_content );
				$found  = self::filter_blocks_recursive( $blocks, 'kadence' );
				return array( 'post_id' => (int) $post->ID, 'count' => count( $found ), 'blocks' => $found );
			},
		);

		$reg['kadence_blocks_settings'] = array(
			'desc'    => 'Get Kadence Blocks config options (defaults, colors, global, settings). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'kt_blocks_config_blocks' => get_option( 'kt_blocks_config_blocks', null ),
					'kadence_blocks_config_blocks' => get_option( 'kadence_blocks_config_blocks', null ),
					'kadence_blocks_settings_blocks' => get_option( 'kadence_blocks_settings_blocks', null ),
					'kadence_blocks_colors' => get_option( 'kadence_blocks_colors', null ),
					'kadence_blocks_global' => get_option( 'kadence_blocks_global', null ),
					'kt_blocks_unregistered_blocks' => get_option( 'kt_blocks_unregistered_blocks', null ),
				);
			},
		);

		$reg['kadence_blocks_count_types'] = array(
			'desc'     => 'Count Kadence block types used in a post. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$found  = self::filter_blocks_recursive( parse_blocks( $post->post_content ), 'kadence' );
				$counts = array();
				foreach ( $found as $b ) {
					$counts[ $b['blockName'] ] = ( $counts[ $b['blockName'] ] ?? 0 ) + 1;
				}
				return array( 'post_id' => (int) $post->ID, 'total' => count( $found ), 'by_type' => $counts );
			},
		);

		$reg['kadence_blocks_update_attrs'] = array(
			'desc'     => 'Merge attributes into Kadence blocks in a post by blockName (optional uniqueID). Saves post. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'   => array( 'type' => 'integer' ),
				'blockName' => array( 'type' => 'string', 'description' => 'e.g. kadence/rowlayout, kadence/advancedheading' ),
				'attrs'     => array( 'type' => 'object' ),
				'uniqueID'  => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'blockName', 'attrs' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				if ( empty( $a['attrs'] ) || ! is_array( $a['attrs'] ) ) {
					throw new Exception( 'attrs required.' );
				}
				$updated = 0;
				$blocks  = self::map_blocks_recursive( parse_blocks( $post->post_content ), function ( $b ) use ( $a, &$updated ) {
					if ( ( $b['blockName'] ?? '' ) !== $a['blockName'] ) {
						return $b;
					}
					if ( ! empty( $a['uniqueID'] ) ) {
						$uid = $b['attrs']['uniqueID'] ?? ( $b['attrs']['uniqueId'] ?? '' );
						if ( (string) $uid !== (string) $a['uniqueID'] ) {
							return $b;
						}
					}
					$b['attrs'] = array_merge( is_array( $b['attrs'] ?? null ) ? $b['attrs'] : array(), $a['attrs'] );
					$updated++;
					return $b;
				} );
				if ( ! $updated ) {
					throw new Exception( 'No matching Kadence blocks updated.' );
				}
				$r = wp_update_post( array( 'ID' => $post->ID, 'post_content' => serialize_blocks( $blocks ) ), true );
				if ( is_wp_error( $r ) ) {
					throw new Exception( $r->get_error_message() );
				}
				return array( 'post_id' => (int) $post->ID, 'blocks_updated' => $updated );
			},
		);

		$reg['kadence_blocks_list_design_library'] = array(
			'desc'    => 'List Kadence Blocks cloud/design library option data if present (connections meta only, not full templates). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$cloud = get_option( 'kadence_blocks_cloud', null );
				if ( is_string( $cloud ) ) {
					$decoded = json_decode( $cloud, true );
					$cloud   = $decoded ? $decoded : $cloud;
				}
				return array( 'kadence_blocks_cloud' => $cloud );
			},
		);

		return $reg;
	}

	// ═══════════════════════════════════════════════════════════════
	// Spectra (Ultimate Addons for Gutenberg / Spectra)
	// ═══════════════════════════════════════════════════════════════

	private static function spectra_active(): bool {
		return defined( 'UAGB_VER' ) || defined( 'SPECTRA_PRO_VER' ) || class_exists( 'UAGB_Loader' );
	}

	private static function spectra(): array {
		if ( ! self::spectra_active() ) {
			return array();
		}
		$reg = array();

		$reg['spectra_info'] = array(
			'desc'    => 'Spectra / UAG plugin status and version. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'active'  => true,
					'version' => defined( 'UAGB_VER' ) ? UAGB_VER : ( defined( 'SPECTRA_PRO_VER' ) ? SPECTRA_PRO_VER : null ),
				);
			},
		);

		$reg['spectra_list_posts'] = array(
			'desc'    => 'Find posts/pages with Spectra/UAG blocks (wp:uagb or wp:spectra). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'post_type' => array( 'type' => 'string' ),
				'per_page'  => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				$per = min( 50, max( 1, (int) ( $a['per_page'] ?? 20 ) ) );
				$q = new WP_Query( array(
					'post_type'      => ! empty( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : array( 'post', 'page' ),
					'posts_per_page' => $per,
					'post_status'    => array( 'publish', 'draft' ),
					's'              => 'wp:uagb',
				) );
				$out = array();
				foreach ( $q->posts as $p ) {
					$c = (string) $p->post_content;
					if ( false === strpos( $c, 'wp:uagb' ) && false === strpos( $c, 'wp:spectra' ) ) {
						continue;
					}
					$out[] = array(
						'id'     => (int) $p->ID,
						'title'  => $p->post_title,
						'type'   => $p->post_type,
						'status' => $p->post_status,
						'link'   => get_permalink( $p ),
					);
				}
				return array( 'count' => count( $out ), 'posts' => $out );
			},
		);

		$reg['spectra_extract_blocks'] = array(
			'desc'     => 'Parse Spectra/UAG blocks from a post. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$blocks = parse_blocks( $post->post_content );
				$found  = array_merge(
					self::filter_blocks_recursive( $blocks, 'uagb' ),
					self::filter_blocks_recursive( $blocks, 'spectra' )
				);
				return array( 'post_id' => (int) $post->ID, 'count' => count( $found ), 'blocks' => $found );
			},
		);

		$reg['spectra_settings'] = array(
			'desc'    => 'Get Spectra/UAG options if available. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'uagb_settings' => get_option( 'uagb_settings', null ),
					'spectra_options' => get_option( 'spectra_options', null ),
				);
			},
		);

		return $reg;
	}

	// ═══════════════════════════════════════════════════════════════
	// Astra theme
	// ═══════════════════════════════════════════════════════════════

	private static function astra_active(): bool {
		return defined( 'ASTRA_THEME_VERSION' ) || function_exists( 'astra_get_option' );
	}

	private static function astra(): array {
		if ( ! self::astra_active() ) {
			return array();
		}
		$reg = array();

		$reg['astra_info'] = array(
			'desc'    => 'Astra theme version and whether Astra Pro is active. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'theme'     => 'astra',
					'version'   => defined( 'ASTRA_THEME_VERSION' ) ? ASTRA_THEME_VERSION : wp_get_theme()->get( 'Version' ),
					'pro'       => defined( 'ASTRA_EXT_VER' ) || class_exists( 'Astra_Addon_Extension' ),
				);
			},
		);

		$reg['astra_get_mods'] = array(
			'desc'    => 'Get Astra-related theme mods / customizer values (header, footer, colors keys if present). Optional key filter. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'keys' => array( 'type' => 'array', 'description' => 'Optional list of theme_mod keys to return.' ),
			),
			'handler' => function ( $a ) {
				$mods = get_theme_mods();
				if ( ! is_array( $mods ) ) {
					$mods = array();
				}
				// Prefer Astra-looking keys + common header/footer.
				$prefer = array();
				foreach ( $mods as $k => $v ) {
					$lk = strtolower( (string) $k );
					if ( str_starts_with( $lk, 'astra-' ) || str_starts_with( $lk, 'astra_' )
						|| false !== strpos( $lk, 'header' ) || false !== strpos( $lk, 'footer' )
						|| false !== strpos( $lk, 'logo' ) ) {
						$prefer[ $k ] = $v;
					}
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$filtered = array();
					foreach ( $a['keys'] as $key ) {
						$key = (string) $key;
						if ( array_key_exists( $key, $mods ) ) {
							$filtered[ $key ] = $mods[ $key ];
						}
					}
					return array( 'mods' => $filtered );
				}
				// Also include astra options if helper exists.
				$astra_opts = function_exists( 'astra_get_option' ) ? null : get_option( 'astra-settings', null );
				return array(
					'astra_related_mods' => $prefer,
					'astra_settings_option' => $astra_opts,
				);
			},
		);

		$reg['astra_set_mod'] = array(
			'desc'     => 'Set a single theme_mod used by Astra (e.g. custom logo-related or header keys). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'key'   => array( 'type' => 'string' ),
				'value' => array( 'description' => 'New value (string, number, or JSON-serializable).' ),
			),
			'required' => array( 'key' ),
			'handler'  => function ( $a ) {
				if ( ! array_key_exists( 'value', $a ) ) {
					throw new Exception( 'value is required.' );
				}
				$key = sanitize_text_field( $a['key'] );
				set_theme_mod( $key, $a['value'] );
				return array( 'key' => $key, 'value' => get_theme_mod( $key ), 'updated' => true );
			},
		);

		$reg['astra_get_header_footer'] = array(
			'desc'    => 'Read Astra header/footer related theme mods and astra-settings. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$settings = get_option( 'astra-settings', array() );
				if ( ! is_array( $settings ) ) {
					$settings = array();
				}
				$hf = array();
				foreach ( $settings as $k => $v ) {
					$lk = strtolower( (string) $k );
					if ( false !== strpos( $lk, 'header' ) || false !== strpos( $lk, 'footer' )
						|| false !== strpos( $lk, 'hb-' ) || false !== strpos( $lk, 'menu' ) ) {
						$hf[ $k ] = $v;
					}
				}
				return array(
					'header_footer_settings' => $hf,
					'theme_mods_hf' => self::filter_mods_by_keywords( get_theme_mods(), array( 'header', 'footer', 'menu', 'logo' ) ),
				);
			},
		);

		$reg['astra_get_option'] = array(
			'desc'     => 'Get one or more Astra settings via astra_get_option() or astra-settings option keys. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'key'  => array( 'type' => 'string', 'description' => 'Single setting key.' ),
				'keys' => array( 'type' => 'array', 'description' => 'Multiple keys.' ),
			),
			'handler'  => function ( $a ) {
				$keys = array();
				if ( ! empty( $a['key'] ) ) {
					$keys[] = (string) $a['key'];
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$keys = array_merge( $keys, array_map( 'strval', $a['keys'] ) );
				}
				if ( empty( $keys ) ) {
					throw new Exception( 'Provide key or keys.' );
				}
				$out = array();
				foreach ( $keys as $key ) {
					if ( function_exists( 'astra_get_option' ) ) {
						$out[ $key ] = astra_get_option( $key );
					} else {
						$all = get_option( 'astra-settings', array() );
						$out[ $key ] = is_array( $all ) && array_key_exists( $key, $all ) ? $all[ $key ] : null;
					}
				}
				return array( 'options' => $out );
			},
		);

		$reg['astra_update_option'] = array(
			'desc'     => 'Update Astra setting(s) in astra-settings option (merge keys). Clears relevant caches if possible. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'settings' => array( 'type' => 'object', 'description' => 'Map of astra setting key => value.' ),
			),
			'required' => array( 'settings' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['settings'] ) || ! is_array( $a['settings'] ) ) {
					throw new Exception( 'settings object required.' );
				}
				$current = get_option( 'astra-settings', array() );
				if ( ! is_array( $current ) ) {
					$current = array();
				}
				$merged = array_merge( $current, $a['settings'] );
				update_option( 'astra-settings', $merged );
				if ( function_exists( 'astra_clear_all_assets_cache' ) ) {
					astra_clear_all_assets_cache();
				}
				return array( 'updated' => true, 'keys' => array_keys( $a['settings'] ) );
			},
		);

		$reg['astra_list_setting_keys'] = array(
			'desc'    => 'List all keys currently stored in astra-settings (names only). Useful before get/update. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$settings = get_option( 'astra-settings', array() );
				$keys     = is_array( $settings ) ? array_keys( $settings ) : array();
				sort( $keys );
				return array( 'count' => count( $keys ), 'keys' => $keys );
			},
		);

		return $reg;
	}

	// ═══════════════════════════════════════════════════════════════
	// GeneratePress
	// ═══════════════════════════════════════════════════════════════

	private static function gp_active(): bool {
		return defined( 'GENERATE_VERSION' ) || function_exists( 'generate_get_option' );
	}

	private static function generatepress(): array {
		if ( ! self::gp_active() ) {
			return array();
		}
		$reg = array();

		$reg['gp_info'] = array(
			'desc'    => 'GeneratePress theme version and GP Premium status. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'theme'   => 'generatepress',
					'version' => defined( 'GENERATE_VERSION' ) ? GENERATE_VERSION : wp_get_theme()->get( 'Version' ),
					'premium' => defined( 'GP_PREMIUM_VERSION' ) || class_exists( 'GeneratePress_Pro' ),
				);
			},
		);

		$reg['gp_get_settings'] = array(
			'desc'    => 'Get GeneratePress settings (generate_settings option) and related theme mods. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'keys' => array( 'type' => 'array', 'description' => 'Optional subset of generate_settings keys.' ),
			),
			'handler' => function ( $a ) {
				$settings = get_option( 'generate_settings', array() );
				if ( ! is_array( $settings ) ) {
					$settings = array();
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$filtered = array();
					foreach ( $a['keys'] as $key ) {
						$key = (string) $key;
						if ( array_key_exists( $key, $settings ) ) {
							$filtered[ $key ] = $settings[ $key ];
						}
					}
					return array( 'generate_settings' => $filtered );
				}
				return array(
					'generate_settings' => $settings,
					'theme_mods_sample' => self::filter_mods_by_keywords( get_theme_mods(), array( 'generate', 'header', 'footer', 'nav' ) ),
				);
			},
		);

		$reg['gp_update_settings'] = array(
			'desc'     => 'Merge and save GeneratePress generate_settings option keys (header/footer/layout related). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'settings' => array( 'type' => 'object', 'description' => 'Map of setting key => value to merge.' ),
			),
			'required' => array( 'settings' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['settings'] ) || ! is_array( $a['settings'] ) ) {
					throw new Exception( 'settings object required.' );
				}
				$current = get_option( 'generate_settings', array() );
				if ( ! is_array( $current ) ) {
					$current = array();
				}
				$merged = array_merge( $current, $a['settings'] );
				update_option( 'generate_settings', $merged );
				return array( 'updated' => true, 'keys' => array_keys( $a['settings'] ) );
			},
		);

		$reg['gp_get_header_footer'] = array(
			'desc'    => 'GeneratePress header/footer related settings and theme mods. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$settings = get_option( 'generate_settings', array() );
				$hf_keys  = array();
				foreach ( (array) $settings as $k => $v ) {
					$lk = strtolower( (string) $k );
					if ( false !== strpos( $lk, 'header' ) || false !== strpos( $lk, 'footer' )
						|| false !== strpos( $lk, 'nav' ) || false !== strpos( $lk, 'menu' ) ) {
						$hf_keys[ $k ] = $v;
					}
				}
				return array(
					'settings_header_footer' => $hf_keys,
					'mods' => self::filter_mods_by_keywords( get_theme_mods(), array( 'header', 'footer', 'nav', 'menu' ) ),
				);
			},
		);

		$reg['gp_get_option'] = array(
			'desc'     => 'Get GeneratePress option via generate_get_option() or generate_settings key. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'key'  => array( 'type' => 'string' ),
				'keys' => array( 'type' => 'array' ),
			),
			'handler'  => function ( $a ) {
				$keys = array();
				if ( ! empty( $a['key'] ) ) {
					$keys[] = (string) $a['key'];
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$keys = array_merge( $keys, array_map( 'strval', $a['keys'] ) );
				}
				if ( empty( $keys ) ) {
					throw new Exception( 'Provide key or keys.' );
				}
				$out = array();
				$all = get_option( 'generate_settings', array() );
				foreach ( $keys as $key ) {
					if ( function_exists( 'generate_get_option' ) ) {
						$out[ $key ] = generate_get_option( $key );
					} else {
						$out[ $key ] = is_array( $all ) && array_key_exists( $key, $all ) ? $all[ $key ] : null;
					}
				}
				return array( 'options' => $out );
			},
		);

		$reg['gp_list_setting_keys'] = array(
			'desc'    => 'List all keys in generate_settings. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$settings = get_option( 'generate_settings', array() );
				$keys     = is_array( $settings ) ? array_keys( $settings ) : array();
				sort( $keys );
				return array( 'count' => count( $keys ), 'keys' => $keys );
			},
		);

		$reg['gp_set_mod'] = array(
			'desc'     => 'Set a theme_mod used with GeneratePress. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'key'   => array( 'type' => 'string' ),
				'value' => array( 'description' => 'New value.' ),
			),
			'required' => array( 'key' ),
			'handler'  => function ( $a ) {
				if ( ! array_key_exists( 'value', $a ) ) {
					throw new Exception( 'value required.' );
				}
				$key = sanitize_text_field( $a['key'] );
				set_theme_mod( $key, $a['value'] );
				return array( 'key' => $key, 'value' => get_theme_mod( $key ), 'updated' => true );
			},
		);

		return $reg;
	}

	// ═══════════════════════════════════════════════════════════════
	// Kadence theme
	// ═══════════════════════════════════════════════════════════════

	private static function kadence_theme_active(): bool {
		$theme = wp_get_theme();
		$name  = strtolower( $theme->get( 'Name' ) );
		$tmpl  = strtolower( (string) $theme->get_template() );
		return 'kadence' === $tmpl || false !== strpos( $name, 'kadence' ) || defined( 'KADENCE_VERSION' );
	}

	private static function kadence_theme(): array {
		if ( ! self::kadence_theme_active() ) {
			return array();
		}
		$reg = array();

		$reg['kadence_theme_info'] = array(
			'desc'    => 'Kadence theme version info. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$theme = wp_get_theme();
				return array(
					'theme'   => $theme->get( 'Name' ),
					'version' => $theme->get( 'Version' ),
					'template'=> $theme->get_template(),
				);
			},
		);

		$reg['kadence_theme_get_mods'] = array(
			'desc'    => 'Get Kadence theme mods (header/footer/layout related keys). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'keys' => array( 'type' => 'array', 'description' => 'Optional specific theme_mod keys.' ),
			),
			'handler' => function ( $a ) {
				$mods = get_theme_mods();
				if ( ! is_array( $mods ) ) {
					$mods = array();
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$filtered = array();
					foreach ( $a['keys'] as $key ) {
						$key = (string) $key;
						if ( array_key_exists( $key, $mods ) ) {
							$filtered[ $key ] = $mods[ $key ];
						}
					}
					return array( 'mods' => $filtered );
				}
				return array(
					'mods' => self::filter_mods_by_keywords( $mods, array( 'kadence', 'header', 'footer', 'logo', 'nav' ) ),
					'kadence_global' => get_option( 'kadence_global_palette', null ),
				);
			},
		);

		$reg['kadence_theme_set_mod'] = array(
			'desc'     => 'Set a Kadence-related theme_mod key. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'key'   => array( 'type' => 'string' ),
				'value' => array( 'description' => 'New value.' ),
			),
			'required' => array( 'key' ),
			'handler'  => function ( $a ) {
				if ( ! array_key_exists( 'value', $a ) ) {
					throw new Exception( 'value is required.' );
				}
				$key = sanitize_text_field( $a['key'] );
				set_theme_mod( $key, $a['value'] );
				return array( 'key' => $key, 'value' => get_theme_mod( $key ), 'updated' => true );
			},
		);

		$reg['kadence_theme_header_footer'] = array(
			'desc'    => 'Kadence header/footer related theme mods. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'mods' => self::filter_mods_by_keywords( get_theme_mods(), array( 'header', 'footer', 'topbar', 'nav' ) ),
				);
			},
		);

		$reg['kadence_theme_list_mod_keys'] = array(
			'desc'    => 'List theme_mod keys relevant to Kadence (filtered by keywords). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$mods = self::filter_mods_by_keywords( get_theme_mods(), array( 'kadence', 'header', 'footer', 'logo', 'nav', 'palette' ) );
				$keys = array_keys( $mods );
				sort( $keys );
				return array( 'count' => count( $keys ), 'keys' => $keys );
			},
		);

		$reg['kadence_theme_get_palette'] = array(
			'desc'    => 'Get Kadence global palette / color options if stored. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'kadence_global_palette' => get_option( 'kadence_global_palette', null ),
					'theme_mods_palette'    => self::filter_mods_by_keywords( get_theme_mods(), array( 'palette', 'color', 'global' ) ),
				);
			},
		);

		$reg['kadence_theme_update_mods'] = array(
			'desc'     => 'Bulk set multiple Kadence-related theme_mods. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'mods' => array( 'type' => 'object', 'description' => 'Map of theme_mod key => value.' ),
			),
			'required' => array( 'mods' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['mods'] ) || ! is_array( $a['mods'] ) ) {
					throw new Exception( 'mods object required.' );
				}
				$updated = array();
				foreach ( $a['mods'] as $key => $val ) {
					$key = sanitize_text_field( (string) $key );
					set_theme_mod( $key, $val );
					$updated[ $key ] = get_theme_mod( $key );
				}
				return array( 'updated' => true, 'mods' => $updated );
			},
		);

		return $reg;
	}

	// ── helpers ────────────────────────────────────────────────────

	private static function filter_blocks_recursive( array $blocks, string $needle ): array {
		$out = array();
		foreach ( $blocks as $b ) {
			$name = $b['blockName'] ?? '';
			if ( $name && false !== strpos( $name, $needle ) ) {
				$out[] = array(
					'blockName'   => $name,
					'attrs'       => $b['attrs'] ?? new stdClass(),
					'innerHTML_len' => strlen( $b['innerHTML'] ?? '' ),
					'has_innerBlocks' => ! empty( $b['innerBlocks'] ),
				);
			}
			if ( ! empty( $b['innerBlocks'] ) && is_array( $b['innerBlocks'] ) ) {
				$out = array_merge( $out, self::filter_blocks_recursive( $b['innerBlocks'], $needle ) );
			}
		}
		return $out;
	}

	/**
	 * Map over block tree; callback receives each block array and must return block array.
	 */
	private static function map_blocks_recursive( array $blocks, callable $cb ): array {
		$out = array();
		foreach ( $blocks as $b ) {
			if ( ! empty( $b['innerBlocks'] ) && is_array( $b['innerBlocks'] ) ) {
				$b['innerBlocks'] = self::map_blocks_recursive( $b['innerBlocks'], $cb );
			}
			$out[] = $cb( $b );
		}
		return $out;
	}

	private static function filter_mods_by_keywords( $mods, array $keywords ): array {
		if ( ! is_array( $mods ) ) {
			return array();
		}
		$out = array();
		foreach ( $mods as $k => $v ) {
			$lk = strtolower( (string) $k );
			foreach ( $keywords as $kw ) {
				if ( false !== strpos( $lk, strtolower( $kw ) ) ) {
					$out[ $k ] = $v;
					break;
				}
			}
		}
		return $out;
	}
}
