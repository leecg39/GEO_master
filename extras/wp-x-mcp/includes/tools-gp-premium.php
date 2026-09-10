<?php
/**
 * GeneratePress Premium (GP Premium) tools for WP x MCP.
 *
 * Modules status, Elements CPT helpers, generate_settings / menu plus,
 * per-post disable elements. Plugin-gated. Default OFF in Managed Tools.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_GP_Premium {

	/** Common module option keys => define name (GP Premium pattern). */
	private static function modules_map(): array {
		return array(
			'generate_package_backgrounds'   => 'GENERATE_BACKGROUNDS',
			'generate_package_blog'          => 'GENERATE_BLOG',
			'generate_package_colors'        => 'GENERATE_COLORS',
			'generate_package_copyright'     => 'GENERATE_COPYRIGHT',
			'generate_package_disable_elements' => 'GENERATE_DISABLE_ELEMENTS',
			'generate_package_elements'      => 'GENERATE_ELEMENTS',
			'generate_package_hooks'         => 'GENERATE_HOOKS', // legacy
			'generate_package_menu_plus'     => 'GENERATE_MENU_PLUS',
			'generate_package_page_header'   => 'GENERATE_PAGE_HEADER', // legacy
			'generate_package_secondary_nav' => 'GENERATE_SECONDARY_NAV',
			'generate_package_sections'      => 'GENERATE_SECTIONS',
			'generate_package_spacing'       => 'GENERATE_SPACING',
			'generate_package_typography'    => 'GENERATE_TYPOGRAPHY',
			'generate_package_woocommerce'   => 'GENERATE_WOOCOMMERCE',
			'generate_package_site_library'  => 'GENERATE_SITE_LIBRARY',
		);
	}

	public static function is_active(): bool {
		if ( defined( 'GP_PREMIUM_VERSION' ) || defined( 'GENERATE_PREMIUM_VERSION' ) ) {
			return true;
		}
		if ( function_exists( 'generatepress_is_module_active' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'gp-premium/gp-premium.php' )
			|| file_exists( WP_PLUGIN_DIR . '/gp-premium/gp-premium.php' );
	}

	private static function require_premium(): void {
		if ( ! self::is_active() ) {
			throw new Exception( 'GP Premium (GeneratePress Premium) is not active.' );
		}
	}

	private static function is_gp_theme(): bool {
		$theme = wp_get_theme();
		$tmpl  = strtolower( (string) $theme->get_template() );
		return 'generatepress' === $tmpl || false !== stripos( $theme->get( 'Name' ), 'generatepress' );
	}

	/** Elements post type — GP Premium uses gp_elements in modern versions. */
	private static function elements_post_type(): string {
		if ( post_type_exists( 'gp_elements' ) ) {
			return 'gp_elements';
		}
		if ( post_type_exists( 'gpp_elements' ) ) {
			return 'gpp_elements';
		}
		// Fallback commonly used.
		return 'gp_elements';
	}

	public static function all(): array {
		// Status always available to diagnose; other tools need premium.
		$reg = array();

		$reg['gpp_status'] = array(
			'desc'    => 'GP Premium + GeneratePress theme status and version hints. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'premium_active' => self::is_active(),
					'premium_version'=> defined( 'GP_PREMIUM_VERSION' ) ? GP_PREMIUM_VERSION : ( defined( 'GENERATE_PREMIUM_VERSION' ) ? GENERATE_PREMIUM_VERSION : null ),
					'theme_is_generatepress' => self::is_gp_theme(),
					'theme_version'  => self::is_gp_theme() ? wp_get_theme()->get( 'Version' ) : null,
					'elements_cpt'   => post_type_exists( self::elements_post_type() ) ? self::elements_post_type() : null,
				);
			},
		);

		if ( ! self::is_active() ) {
			return $reg;
		}

		$reg['gpp_list_modules'] = array(
			'desc'    => 'List GP Premium modules and whether each is activated. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				self::require_premium();
				$out = array();
				foreach ( self::modules_map() as $option => $define ) {
					$active = false;
					if ( function_exists( 'generatepress_is_module_active' ) ) {
						$active = (bool) generatepress_is_module_active( $option, $define );
					} else {
						$active = ( 'activated' === get_option( $option ) ) || defined( $define );
					}
					$out[] = array(
						'option'   => $option,
						'define'   => $define,
						'active'   => $active,
						'label'    => str_replace( array( 'generate_package_', '_' ), array( '', ' ' ), $option ),
					);
				}
				return array( 'modules' => $out );
			},
		);

		// ── Elements ───────────────────────────────────────────────

		$reg['gpp_list_elements'] = array(
			'desc'    => 'List GP Premium Elements (headers, hooks, layouts, blocks). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'type'     => array( 'type' => 'string', 'description' => 'Optional filter: hook, header, layout, block, site-header, etc.' ),
				'per_page' => array( 'type' => 'integer' ),
				'status'   => array( 'type' => 'string', 'description' => 'publish, draft, or any.' ),
			),
			'handler' => function ( $a ) {
				self::require_premium();
				$pt = self::elements_post_type();
				if ( ! post_type_exists( $pt ) ) {
					throw new Exception( "Elements post type '{$pt}' not registered (is Elements module active?)." );
				}
				$per = min( 100, max( 1, (int) ( $a['per_page'] ?? 50 ) ) );
				$args = array(
					'post_type'      => $pt,
					'posts_per_page' => $per,
					'post_status'    => ! empty( $a['status'] ) ? sanitize_key( $a['status'] ) : array( 'publish', 'draft' ),
					'orderby'        => 'date',
					'order'          => 'DESC',
				);
				$q   = new WP_Query( $args );
				$out = array();
				foreach ( $q->posts as $p ) {
					$type = get_post_meta( $p->ID, '_generate_element_type', true );
					if ( ! $type ) {
						$type = get_post_meta( $p->ID, '_generate_type', true );
					}
					if ( ! empty( $a['type'] ) && strtolower( (string) $type ) !== strtolower( (string) $a['type'] ) ) {
						continue;
					}
					$out[] = array(
						'id'     => (int) $p->ID,
						'title'  => $p->post_title,
						'status' => $p->post_status,
						'type'   => $type,
						'hook'   => get_post_meta( $p->ID, '_generate_hook', true ),
						'priority' => get_post_meta( $p->ID, '_generate_hook_priority', true ),
					);
				}
				return array( 'count' => count( $out ), 'elements' => $out );
			},
		);

		$reg['gpp_get_element'] = array(
			'desc'     => 'Get one GP Element: content, type, hook, priority, display meta. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'id' => array( 'type' => 'integer' ) ),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				$p = get_post( (int) $a['id'] );
				if ( ! $p || $p->post_type !== self::elements_post_type() ) {
					throw new Exception( 'Element not found.' );
				}
				$meta = array();
				foreach ( array(
					'_generate_element_type',
					'_generate_type',
					'_generate_hook',
					'_generate_custom_hook',
					'_generate_hook_priority',
					'_generate_display_conditions',
					'_generate_exclude_conditions',
					'_generate_user_conditions',
					'_generate_execute_php',
					'_generate_disable_title',
					'_generate_disable_primary_navigation',
					'_generate_disable_secondary_navigation',
					'_generate_disable_featured_image',
					'_generate_disable_footer',
					'_generate_disable_site_header',
				) as $key ) {
					$val = get_post_meta( $p->ID, $key, true );
					if ( '' !== $val && null !== $val ) {
						$meta[ $key ] = maybe_unserialize( $val );
					}
				}
				return array(
					'id'      => (int) $p->ID,
					'title'   => $p->post_title,
					'status'  => $p->post_status,
					'content' => $p->post_content,
					'meta'    => $meta,
				);
			},
		);

		$reg['gpp_create_element'] = array(
			'desc'     => 'Create a GP Premium Element. type: hook|header|layout|block. Optional hook name + priority + content. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string' ),
				'type'     => array( 'type' => 'string', 'description' => 'hook, header, layout, block, site-header, site-footer…' ),
				'content'  => array( 'type' => 'string' ),
				'hook'     => array( 'type' => 'string', 'description' => 'e.g. generate_before_header, generate_after_footer' ),
				'priority' => array( 'type' => 'integer' ),
				'status'   => array( 'type' => 'string', 'description' => 'publish or draft (default draft).' ),
			),
			'required' => array( 'title', 'type' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				$pt = self::elements_post_type();
				if ( ! post_type_exists( $pt ) ) {
					throw new Exception( 'Elements CPT not registered.' );
				}
				$status = in_array( $a['status'] ?? '', array( 'publish', 'draft' ), true ) ? $a['status'] : 'draft';
				$id = wp_insert_post( array(
					'post_type'    => $pt,
					'post_title'   => sanitize_text_field( $a['title'] ),
					'post_content' => isset( $a['content'] ) ? (string) $a['content'] : '',
					'post_status'  => $status,
				), true );
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				$type = sanitize_text_field( $a['type'] );
				update_post_meta( $id, '_generate_element_type', $type );
				if ( ! empty( $a['hook'] ) ) {
					update_post_meta( $id, '_generate_hook', sanitize_text_field( $a['hook'] ) );
				}
				if ( isset( $a['priority'] ) ) {
					update_post_meta( $id, '_generate_hook_priority', (int) $a['priority'] );
				}
				return array( 'id' => (int) $id, 'title' => $a['title'], 'type' => $type, 'status' => $status );
			},
		);

		$reg['gpp_update_element'] = array(
			'desc'     => 'Update GP Element title, content, type, hook, priority, or status. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'id'       => array( 'type' => 'integer' ),
				'title'    => array( 'type' => 'string' ),
				'content'  => array( 'type' => 'string' ),
				'type'     => array( 'type' => 'string' ),
				'hook'     => array( 'type' => 'string' ),
				'priority' => array( 'type' => 'integer' ),
				'status'   => array( 'type' => 'string' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				$id = (int) $a['id'];
				$p  = get_post( $id );
				if ( ! $p || $p->post_type !== self::elements_post_type() ) {
					throw new Exception( 'Element not found.' );
				}
				$update = array( 'ID' => $id );
				if ( isset( $a['title'] ) ) {
					$update['post_title'] = sanitize_text_field( $a['title'] );
				}
				if ( isset( $a['content'] ) ) {
					$update['post_content'] = (string) $a['content'];
				}
				if ( isset( $a['status'] ) && in_array( $a['status'], array( 'publish', 'draft' ), true ) ) {
					$update['post_status'] = $a['status'];
				}
				$r = wp_update_post( $update, true );
				if ( is_wp_error( $r ) ) {
					throw new Exception( $r->get_error_message() );
				}
				if ( isset( $a['type'] ) ) {
					update_post_meta( $id, '_generate_element_type', sanitize_text_field( $a['type'] ) );
				}
				if ( isset( $a['hook'] ) ) {
					update_post_meta( $id, '_generate_hook', sanitize_text_field( $a['hook'] ) );
				}
				if ( isset( $a['priority'] ) ) {
					update_post_meta( $id, '_generate_hook_priority', (int) $a['priority'] );
				}
				return array( 'id' => $id, 'updated' => true );
			},
		);

		$reg['gpp_delete_element'] = array(
			'desc'     => 'Delete a GP Premium Element permanently. [risk: destructive]',
			'risk'     => 'destructive',
			'schema'   => array( 'id' => array( 'type' => 'integer' ) ),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				$id = (int) $a['id'];
				$p  = get_post( $id );
				if ( ! $p || $p->post_type !== self::elements_post_type() ) {
					throw new Exception( 'Element not found.' );
				}
				$r = wp_delete_post( $id, true );
				if ( ! $r ) {
					throw new Exception( 'Delete failed.' );
				}
				return array( 'id' => $id, 'deleted' => true );
			},
		);

		// ── Settings ───────────────────────────────────────────────

		$reg['gpp_get_settings'] = array(
			'desc'    => 'Get generate_settings (theme + many Premium keys). Optional keys filter. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'keys' => array( 'type' => 'array' ),
			),
			'handler' => function ( $a ) {
				self::require_premium();
				$settings = get_option( 'generate_settings', array() );
				if ( ! is_array( $settings ) ) {
					$settings = array();
				}
				if ( ! empty( $a['keys'] ) && is_array( $a['keys'] ) ) {
					$out = array();
					foreach ( $a['keys'] as $k ) {
						$k = (string) $k;
						if ( array_key_exists( $k, $settings ) ) {
							$out[ $k ] = $settings[ $k ];
						} elseif ( function_exists( 'generate_get_option' ) ) {
							$out[ $k ] = generate_get_option( $k );
						}
					}
					return array( 'settings' => $out );
				}
				return array( 'settings' => $settings );
			},
		);

		$reg['gpp_update_settings'] = array(
			'desc'     => 'Merge keys into generate_settings option. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'settings' => array( 'type' => 'object' ),
			),
			'required' => array( 'settings' ),
			'handler'  => function ( $a ) {
				self::require_premium();
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

		$reg['gpp_list_setting_keys'] = array(
			'desc'    => 'List all keys in generate_settings. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				self::require_premium();
				$settings = get_option( 'generate_settings', array() );
				$keys     = is_array( $settings ) ? array_keys( $settings ) : array();
				sort( $keys );
				return array( 'count' => count( $keys ), 'keys' => $keys );
			},
		);

		$reg['gpp_get_menu_plus'] = array(
			'desc'    => 'Get Menu Plus settings (sticky nav, off-canvas, mobile header). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				self::require_premium();
				return array(
					'generate_menu_plus_settings' => get_option( 'generate_menu_plus_settings', array() ),
				);
			},
		);

		$reg['gpp_update_menu_plus'] = array(
			'desc'     => 'Merge keys into generate_menu_plus_settings. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'settings' => array( 'type' => 'object' ),
			),
			'required' => array( 'settings' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				if ( empty( $a['settings'] ) || ! is_array( $a['settings'] ) ) {
					throw new Exception( 'settings object required.' );
				}
				$current = get_option( 'generate_menu_plus_settings', array() );
				if ( ! is_array( $current ) ) {
					$current = array();
				}
				update_option( 'generate_menu_plus_settings', array_merge( $current, $a['settings'] ) );
				return array( 'updated' => true, 'keys' => array_keys( $a['settings'] ) );
			},
		);

		// ── Per-post disable elements ──────────────────────────────

		$reg['gpp_get_post_disable_elements'] = array(
			'desc'     => 'Get Disable Elements style flags for a post (title, nav, footer, etc. meta). [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				$pid  = (int) $a['post_id'];
				if ( ! get_post( $pid ) ) {
					throw new Exception( 'Post not found.' );
				}
				$keys = array(
					'_generate-disable-headline',
					'_generate-disable-nav',
					'_generate-disable-secondary-nav',
					'_generate-disable-header',
					'_generate-disable-footer',
					'_generate-disable-top-bar',
					'generate-disable-headline',
					'generate-disable-nav',
					'generate-disable-footer',
				);
				$out = array();
				foreach ( $keys as $k ) {
					$v = get_post_meta( $pid, $k, true );
					if ( '' !== $v && null !== $v ) {
						$out[ $k ] = $v;
					}
				}
				// Also layout meta often used by Elements.
				foreach ( array( '_generate-sidebar-layout-meta', '_generate-footer-widget-meta', '_generate-full-width-content' ) as $k ) {
					$v = get_post_meta( $pid, $k, true );
					if ( '' !== $v && null !== $v ) {
						$out[ $k ] = $v;
					}
				}
				return array( 'post_id' => $pid, 'meta' => $out );
			},
		);

		$reg['gpp_set_post_disable_elements'] = array(
			'desc'     => 'Set per-post disable/layout meta flags (object of meta_key => value). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer' ),
				'meta'    => array( 'type' => 'object', 'description' => 'Map of meta keys to values (true/false or GP values).' ),
			),
			'required' => array( 'post_id', 'meta' ),
			'handler'  => function ( $a ) {
				self::require_premium();
				$pid = (int) $a['post_id'];
				if ( ! get_post( $pid ) ) {
					throw new Exception( 'Post not found.' );
				}
				if ( empty( $a['meta'] ) || ! is_array( $a['meta'] ) ) {
					throw new Exception( 'meta object required.' );
				}
				$updated = array();
				foreach ( $a['meta'] as $key => $val ) {
					$key = sanitize_text_field( (string) $key );
					update_post_meta( $pid, $key, $val );
					$updated[ $key ] = get_post_meta( $pid, $key, true );
				}
				return array( 'post_id' => $pid, 'updated' => $updated );
			},
		);

		return $reg;
	}
}
