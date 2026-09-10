<?php
/**
 * Kadence Blocks Pro + Kadence Theme Pro tools for WP x MCP.
 *
 * Pro-only block discovery, extract/update, and Theme Pro options
 * (conditional headers, dark mode, related mods). Plugin/theme gated.
 * Default OFF in Managed Tools.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Kadence_Pro {

	/** Known Kadence Blocks Pro block names (from Pro package). */
	private static function pro_block_names(): array {
		return array(
			'kadence/dynamichtml',
			'kadence/dynamiclist',
			'kadence/imageoverlay',
			'kadence/modal',
			'kadence/portfoliogrid',
			'kadence/postgrid',
			'kadence/productcarousel',
			'kadence/query',
			'kadence/repeater',
			'kadence/repeatertemplate',
			'kadence/slide',
			'kadence/slider',
			'kadence/splitcontent',
			'kadence/userinfo',
			'kadence/videopopup',
			// Query children (often nested).
			'kadence/query-pagination',
			'kadence/query-card',
			'kadence/query-filter',
		);
	}

	private static function blocks_pro_active(): bool {
		return defined( 'KADENCE_BLOCKS_PRO_VERSION' )
			|| class_exists( 'Kadence_Blocks_Pro' )
			|| defined( 'KTP_VERSION' ) // occasional define
			|| file_exists( WP_PLUGIN_DIR . '/kadence-blocks-pro/kadence-blocks-pro.php' )
			|| function_exists( 'is_plugin_active' ) && is_plugin_active( 'kadence-blocks-pro/kadence-blocks-pro.php' );
	}

	private static function theme_pro_active(): bool {
		return defined( 'KADENCE_PRO_VERSION' )
			|| class_exists( 'Kadence_Theme_Pro' )
			|| class_exists( 'Kadence\Theme_Pro' )
			|| file_exists( WP_PLUGIN_DIR . '/kadence-pro/kadence-pro.php' )
			|| ( function_exists( 'is_plugin_active' ) && is_plugin_active( 'kadence-pro/kadence-pro.php' ) );
	}

	public static function all(): array {
		$reg = array();

		// Always register a status tool if either free Kadence Blocks or Pro might be checked.
		$reg['kadence_pro_status'] = array(
			'desc'    => 'Report whether Kadence Blocks Pro and Kadence Theme Pro are active (versions if available). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				if ( ! function_exists( 'is_plugin_active' ) ) {
					require_once ABSPATH . 'wp-admin/includes/plugin.php';
				}
				return array(
					'blocks_pro_active' => self::blocks_pro_active(),
					'blocks_pro_version' => defined( 'KADENCE_BLOCKS_PRO_VERSION' ) ? KADENCE_BLOCKS_PRO_VERSION : null,
					'theme_pro_active'  => self::theme_pro_active(),
					'theme_pro_version' => defined( 'KADENCE_PRO_VERSION' ) ? KADENCE_PRO_VERSION : null,
					'kadence_blocks_free' => defined( 'KADENCE_BLOCKS_VERSION' ) ? KADENCE_BLOCKS_VERSION : null,
				);
			},
		);

		if ( self::blocks_pro_active() || defined( 'KADENCE_BLOCKS_VERSION' ) ) {
			$reg = array_merge( $reg, self::blocks_pro_tools() );
		}

		if ( self::theme_pro_active() || self::is_kadence_theme() ) {
			$reg = array_merge( $reg, self::theme_pro_tools() );
		}

		return $reg;
	}

	private static function is_kadence_theme(): bool {
		$theme = wp_get_theme();
		$tmpl  = strtolower( (string) $theme->get_template() );
		return 'kadence' === $tmpl || false !== stripos( $theme->get( 'Name' ), 'kadence' );
	}

	// ─── Blocks Pro ────────────────────────────────────────────────

	private static function blocks_pro_tools(): array {
		$reg = array();

		$reg['kbp_list_pro_block_types'] = array(
			'desc'    => 'List known Kadence Blocks Pro block types (modal, slider, query, postgrid, etc.). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'pro_active' => self::blocks_pro_active(),
					'blocks'     => self::pro_block_names(),
				);
			},
		);

		$reg['kbp_list_posts_with_pro_blocks'] = array(
			'desc'    => 'Find posts/pages that contain Kadence Blocks Pro blocks (query, slider, modal, postgrid…). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'post_type' => array( 'type' => 'string' ),
				'per_page'  => array( 'type' => 'integer' ),
				'block'     => array( 'type' => 'string', 'description' => 'Optional filter e.g. kadence/modal' ),
			),
			'handler' => function ( $a ) {
				$per   = min( 50, max( 1, (int) ( $a['per_page'] ?? 20 ) ) );
				$needle = ! empty( $a['block'] ) ? (string) $a['block'] : 'kadence/';
				$q = new WP_Query( array(
					'post_type'      => ! empty( $a['post_type'] ) ? sanitize_key( $a['post_type'] ) : array( 'post', 'page' ),
					'posts_per_page' => $per,
					'post_status'    => array( 'publish', 'draft' ),
					's'              => $needle,
				) );
				$pro   = self::pro_block_names();
				$out   = array();
				foreach ( $q->posts as $p ) {
					$content = (string) $p->post_content;
					$hits    = array();
					foreach ( $pro as $bn ) {
						if ( false !== strpos( $content, $bn ) ) {
							$hits[] = $bn;
						}
					}
					if ( empty( $hits ) ) {
						continue;
					}
					if ( ! empty( $a['block'] ) && ! in_array( $a['block'], $hits, true ) ) {
						continue;
					}
					$out[] = array(
						'id'          => (int) $p->ID,
						'title'       => $p->post_title,
						'type'        => $p->post_type,
						'status'      => $p->post_status,
						'pro_blocks'  => $hits,
						'link'        => get_permalink( $p ),
					);
				}
				return array( 'count' => count( $out ), 'posts' => $out );
			},
		);

		$reg['kbp_extract_pro_blocks'] = array(
			'desc'     => 'Parse Kadence Pro blocks from a post (name, attrs summary, uniqueID). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'block'   => array( 'type' => 'string', 'description' => 'Optional only this blockName.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$all   = self::walk_blocks( parse_blocks( $post->post_content ) );
				$pro   = array_flip( self::pro_block_names() );
				$found = array();
				foreach ( $all as $b ) {
					$name = $b['blockName'] ?? '';
					if ( ! $name ) {
						continue;
					}
					$is_pro = isset( $pro[ $name ] ) || ( 0 === strpos( $name, 'kadence/' ) && (
						false !== strpos( $name, 'query' ) || false !== strpos( $name, 'slider' )
						|| false !== strpos( $name, 'modal' ) || false !== strpos( $name, 'grid' )
					) );
					if ( ! $is_pro ) {
						continue;
					}
					if ( ! empty( $a['block'] ) && $name !== $a['block'] ) {
						continue;
					}
					$attrs = is_array( $b['attrs'] ?? null ) ? $b['attrs'] : array();
					$found[] = array(
						'blockName' => $name,
						'uniqueID'  => $attrs['uniqueID'] ?? ( $attrs['uniqueId'] ?? null ),
						'attrs'     => $attrs,
						'innerHTML_len' => strlen( $b['innerHTML'] ?? '' ),
					);
				}
				return array( 'post_id' => (int) $post->ID, 'count' => count( $found ), 'blocks' => $found );
			},
		);

		$reg['kbp_count_pro_blocks'] = array(
			'desc'     => 'Count Kadence Pro block types on a post. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				$post = get_post( (int) $a['post_id'] );
				if ( ! $post ) {
					throw new Exception( 'Post not found.' );
				}
				$all   = self::walk_blocks( parse_blocks( $post->post_content ) );
				$pro   = array_flip( self::pro_block_names() );
				$counts = array();
				foreach ( $all as $b ) {
					$name = $b['blockName'] ?? '';
					if ( isset( $pro[ $name ] ) ) {
						$counts[ $name ] = ( $counts[ $name ] ?? 0 ) + 1;
					}
				}
				return array( 'post_id' => (int) $post->ID, 'by_type' => $counts, 'total' => array_sum( $counts ) );
			},
		);

		$reg['kbp_update_block_attrs'] = array(
			'desc'     => 'Merge attributes into Kadence Pro blocks on a post (by blockName and optional uniqueID). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'   => array( 'type' => 'integer' ),
				'blockName' => array( 'type' => 'string', 'description' => 'e.g. kadence/modal, kadence/slider' ),
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
					throw new Exception( 'attrs object required.' );
				}
				$updated = 0;
				$blocks  = self::map_blocks( parse_blocks( $post->post_content ), function ( $b ) use ( $a, &$updated ) {
					if ( ( $b['blockName'] ?? '' ) !== $a['blockName'] ) {
						return $b;
					}
					$attrs = is_array( $b['attrs'] ?? null ) ? $b['attrs'] : array();
					if ( ! empty( $a['uniqueID'] ) ) {
						$uid = $attrs['uniqueID'] ?? ( $attrs['uniqueId'] ?? '' );
						if ( (string) $uid !== (string) $a['uniqueID'] ) {
							return $b;
						}
					}
					$b['attrs'] = array_merge( $attrs, $a['attrs'] );
					$updated++;
					return $b;
				} );
				if ( ! $updated ) {
					throw new Exception( 'No matching blocks updated.' );
				}
				$r = wp_update_post( array(
					'ID'           => $post->ID,
					'post_content' => serialize_blocks( $blocks ),
				), true );
				if ( is_wp_error( $r ) ) {
					throw new Exception( $r->get_error_message() );
				}
				return array( 'post_id' => (int) $post->ID, 'blocks_updated' => $updated );
			},
		);

		$reg['kbp_get_options'] = array(
			'desc'    => 'Read Kadence Blocks (Pro-related) options: config, colors, global, cloud meta. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$cloud = get_option( 'kadence_blocks_cloud', null );
				if ( is_string( $cloud ) ) {
					$decoded = json_decode( $cloud, true );
					if ( $decoded ) {
						$cloud = $decoded;
					}
				}
				return array(
					'kadence_blocks_config_blocks'   => get_option( 'kadence_blocks_config_blocks', null ),
					'kadence_blocks_settings_blocks' => get_option( 'kadence_blocks_settings_blocks', null ),
					'kadence_blocks_colors'          => get_option( 'kadence_blocks_colors', null ),
					'kadence_blocks_global'          => get_option( 'kadence_blocks_global', null ),
					'kadence_blocks_cloud'           => $cloud,
					'kt_blocks_unregistered_blocks'  => get_option( 'kt_blocks_unregistered_blocks', null ),
				);
			},
		);

		return $reg;
	}

	// ─── Theme Pro ─────────────────────────────────────────────────

	private static function theme_pro_tools(): array {
		$reg = array();

		$reg['ktp_status'] = array(
			'desc'    => 'Kadence Theme Pro active modules hint (dark mode, conditional headers files present). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$base = WP_PLUGIN_DIR . '/kadence-pro/dist';
				return array(
					'theme_pro_active' => self::theme_pro_active(),
					'modules_detected' => array(
						'dark_mode'            => file_exists( $base . '/dark-mode.php' ),
						'conditional_headers'  => file_exists( $base . '/conditional-headers.php' ),
						'header_addons'        => file_exists( $base . '/header-addons.php' ),
						'mega_menu'            => is_dir( $base . '/mega-menu' ),
						'woocommerce_addons'   => file_exists( $base . '/woocommerce-addons.php' ),
						'infinite_scroll'      => file_exists( $base . '/infinite-scroll.php' ),
					),
				);
			},
		);

		$reg['ktp_get_dark_mode'] = array(
			'desc'    => 'Get Kadence Theme Pro dark mode related theme mods / options if set. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$mods = get_theme_mods();
				$dark = array();
				foreach ( (array) $mods as $k => $v ) {
					$lk = strtolower( (string) $k );
					if ( false !== strpos( $lk, 'dark' ) || false !== strpos( $lk, 'color_scheme' ) ) {
						$dark[ $k ] = $v;
					}
				}
				return array(
					'dark_related_mods' => $dark,
					'options'           => array(
						'kadence_pro_dark_mode' => get_option( 'kadence_pro_dark_mode', null ),
					),
				);
			},
		);

		$reg['ktp_get_conditional_headers'] = array(
			'desc'    => 'Get conditional header related theme mods / options (Kadence Theme Pro). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$mods = get_theme_mods();
				$hf   = array();
				foreach ( (array) $mods as $k => $v ) {
					$lk = strtolower( (string) $k );
					if ( false !== strpos( $lk, 'conditional' ) || false !== strpos( $lk, 'header' )
						|| false !== strpos( $lk, 'transparent' ) ) {
						$hf[ $k ] = $v;
					}
				}
				return array(
					'related_mods' => $hf,
					'option_keys_sample' => array(
						'kadence_pro_conditional_headers' => get_option( 'kadence_pro_conditional_headers', null ),
					),
				);
			},
		);

		$reg['ktp_list_theme_mod_keys'] = array(
			'desc'    => 'List Kadence-related theme_mod keys (header, footer, dark, mega, transparent). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				$mods = get_theme_mods();
				$keys = array();
				foreach ( array_keys( (array) $mods ) as $k ) {
					$lk = strtolower( (string) $k );
					if ( false !== strpos( $lk, 'kadence' ) || false !== strpos( $lk, 'header' )
						|| false !== strpos( $lk, 'footer' ) || false !== strpos( $lk, 'dark' )
						|| false !== strpos( $lk, 'mega' ) || false !== strpos( $lk, 'transparent' ) ) {
						$keys[] = $k;
					}
				}
				sort( $keys );
				return array( 'count' => count( $keys ), 'keys' => $keys );
			},
		);

		$reg['ktp_get_mods'] = array(
			'desc'    => 'Get selected or all filtered Kadence Theme Pro related theme mods. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'keys' => array( 'type' => 'array', 'description' => 'Optional specific keys.' ),
			),
			'handler' => function ( $a ) {
				$mods = get_theme_mods();
				if ( ! is_array( $mods ) ) {
					$mods = array();
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$out = array();
					foreach ( $a['keys'] as $key ) {
						$key = (string) $key;
						if ( array_key_exists( $key, $mods ) ) {
							$out[ $key ] = $mods[ $key ];
						}
					}
					return array( 'mods' => $out );
				}
				$out = array();
				foreach ( $mods as $k => $v ) {
					$lk = strtolower( (string) $k );
					if ( false !== strpos( $lk, 'kadence' ) || false !== strpos( $lk, 'header' )
						|| false !== strpos( $lk, 'footer' ) || false !== strpos( $lk, 'dark' ) ) {
						$out[ $k ] = $v;
					}
				}
				return array( 'mods' => $out );
			},
		);

		$reg['ktp_set_mod'] = array(
			'desc'     => 'Set one Kadence Theme Pro related theme_mod. [risk: write]',
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

		$reg['ktp_update_mods'] = array(
			'desc'     => 'Bulk update Kadence-related theme_mods. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'mods' => array( 'type' => 'object' ),
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

	private static function walk_blocks( array $blocks ): array {
		$out = array();
		foreach ( $blocks as $b ) {
			$out[] = $b;
			if ( ! empty( $b['innerBlocks'] ) && is_array( $b['innerBlocks'] ) ) {
				$out = array_merge( $out, self::walk_blocks( $b['innerBlocks'] ) );
			}
		}
		return $out;
	}

	private static function map_blocks( array $blocks, callable $cb ): array {
		$out = array();
		foreach ( $blocks as $b ) {
			if ( ! empty( $b['innerBlocks'] ) && is_array( $b['innerBlocks'] ) ) {
				$b['innerBlocks'] = self::map_blocks( $b['innerBlocks'], $cb );
			}
			$out[] = $cb( $b );
		}
		return $out;
	}
}
