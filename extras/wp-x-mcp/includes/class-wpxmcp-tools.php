<?php
/**
 * Tool registry and handlers for the WP x MCP server.
 *
 * Each tool entry:
 *   'desc'        => string  human/agent description
 *   'risk'        => read|write|destructive
 *   'schema'      => array   JSON-schema 'properties'
 *   'required'    => array   required property names
 *   'handler'     => callable( array $args ): mixed
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools {

	/**
	 * Build the full registry. Defined as a method so handlers can be closures
	 * with access to helper methods.
	 */
	public static function registry(): array {
		static $reg = null;
		if ( null !== $reg ) {
			return $reg;
		}

		$reg = array();

		// ============================================================
		// SITE / DIAGNOSTICS
		// ============================================================
		$reg['site_info'] = array(
			'desc'    => 'Get general site information: name, URL, WP & WooCommerce versions, theme, timezone, active plugin count.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wp_version;
				$wc = defined( 'WC_VERSION' ) ? WC_VERSION : null;
				return array(
					'name'           => get_bloginfo( 'name' ),
					'description'    => get_bloginfo( 'description' ),
					'url'            => home_url(),
					'admin_email'    => get_bloginfo( 'admin_email' ),
					'wp_version'     => $wp_version,
					'wc_version'     => $wc,
					'php_version'    => PHP_VERSION,
					'theme'          => wp_get_theme()->get( 'Name' ),
					'language'       => get_bloginfo( 'language' ),
					'timezone'       => wp_timezone_string(),
					'active_plugins' => count( (array) get_option( 'active_plugins', array() ) ),
				);
			},
		);

		// ============================================================
		// POSTS / PAGES / ANY POST TYPE
		// ============================================================
		$reg['list_posts'] = array(
			'desc'     => 'List posts/pages/any post type. Filter by post_type, status, search, author, per_page, page, orderby.',
			'risk'     => 'read',
			'schema'   => array(
				'post_type' => array( 'type' => 'string', 'description' => 'post, page, product, or any registered type. Default: post' ),
				'status'    => array( 'type' => 'string', 'description' => 'publish, draft, pending, private, any. Default: any' ),
				'search'    => array( 'type' => 'string' ),
				'author'    => array( 'type' => 'integer' ),
				'per_page'  => array( 'type' => 'integer', 'description' => 'Default 20, max 100' ),
				'page'      => array( 'type' => 'integer', 'description' => 'Default 1' ),
				'orderby'   => array( 'type' => 'string', 'description' => 'date, title, modified, menu_order, ID' ),
				'order'     => array( 'type' => 'string', 'description' => 'ASC or DESC' ),
			),
			'handler'  => function ( $a ) {
				$q = new WP_Query(
					array(
						'post_type'      => $a['post_type'] ?? 'post',
						'post_status'    => $a['status'] ?? 'any',
						's'              => $a['search'] ?? '',
						'author'         => $a['author'] ?? '',
						'posts_per_page' => min( (int) ( $a['per_page'] ?? 20 ), 100 ),
						'paged'          => max( 1, (int) ( $a['page'] ?? 1 ) ),
						'orderby'        => $a['orderby'] ?? 'date',
						'order'          => $a['order'] ?? 'DESC',
					)
				);
				$out = array();
				foreach ( $q->posts as $p ) {
					$out[] = array(
						'id'       => $p->ID,
						'title'    => $p->post_title,
						'status'   => $p->post_status,
						'type'     => $p->post_type,
						'slug'     => $p->post_name,
						'author'   => (int) $p->post_author,
						'date'     => $p->post_date,
						'modified' => $p->post_modified,
						'link'     => get_permalink( $p->ID ),
					);
				}
				return array(
					'total'       => (int) $q->found_posts,
					'total_pages' => (int) $q->max_num_pages,
					'items'       => $out,
				);
			},
		);

		$reg['get_post'] = array(
			'desc'     => 'Get full content and meta of a single post/page/product by ID.',
			'risk'     => 'read',
			'schema'   => array( 'id' => array( 'type' => 'integer' ) ),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$p = get_post( (int) $a['id'] );
				if ( ! $p ) {
					throw new Exception( 'Post not found.' );
				}
				return array(
					'id'        => $p->ID,
					'title'     => $p->post_title,
					'content'   => $p->post_content,
					'excerpt'   => $p->post_excerpt,
					'status'    => $p->post_status,
					'type'      => $p->post_type,
					'slug'      => $p->post_name,
					'author'    => (int) $p->post_author,
					'date'      => $p->post_date,
					'modified'  => $p->post_modified,
					'parent'    => $p->post_parent,
					'menu_order'=> $p->menu_order,
					'link'      => get_permalink( $p->ID ),
					'meta'      => get_post_meta( $p->ID ),
				);
			},
		);

		$reg['create_post'] = array(
			'desc'     => 'Create a post/page/any post type. Returns the new ID and link.',
			'risk'     => 'write',
			'schema'   => array(
				'title'     => array( 'type' => 'string' ),
				'content'   => array( 'type' => 'string' ),
				'post_type' => array( 'type' => 'string', 'description' => 'Default: post' ),
				'status'    => array( 'type' => 'string', 'description' => 'Default: draft' ),
				'excerpt'   => array( 'type' => 'string' ),
				'slug'      => array( 'type' => 'string' ),
				'author'    => array( 'type' => 'integer' ),
				'parent'    => array( 'type' => 'integer' ),
				'meta'      => array( 'type' => 'object', 'description' => 'Key/value meta to set' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				$id = wp_insert_post(
					array(
						'post_title'   => $a['title'],
						'post_content' => $a['content'] ?? '',
						'post_excerpt' => $a['excerpt'] ?? '',
						'post_type'    => $a['post_type'] ?? 'post',
						'post_status'  => $a['status'] ?? 'draft',
						'post_name'    => $a['slug'] ?? '',
						'post_author'  => (int) ( $a['author'] ?? get_current_user_id() ?: 1 ),
						'post_parent'  => (int) ( $a['parent'] ?? 0 ),
					),
					true
				);
				if ( is_wp_error( $id ) ) {
					throw new Exception( $id->get_error_message() );
				}
				if ( ! empty( $a['meta'] ) && is_array( $a['meta'] ) ) {
					foreach ( $a['meta'] as $k => $v ) {
						update_post_meta( $id, sanitize_key( $k ), $v );
					}
				}
				return array( 'id' => $id, 'link' => get_permalink( $id ), 'status' => get_post_status( $id ) );
			},
		);

		$reg['update_post'] = array(
			'desc'     => 'Update fields of an existing post/page/product by ID.',
			'risk'     => 'write',
			'schema'   => array(
				'id'      => array( 'type' => 'integer' ),
				'title'   => array( 'type' => 'string' ),
				'content' => array( 'type' => 'string' ),
				'excerpt' => array( 'type' => 'string' ),
				'status'  => array( 'type' => 'string' ),
				'slug'    => array( 'type' => 'string' ),
				'meta'    => array( 'type' => 'object' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$data = array( 'ID' => (int) $a['id'] );
				foreach ( array( 'title' => 'post_title', 'content' => 'post_content', 'excerpt' => 'post_excerpt', 'status' => 'post_status', 'slug' => 'post_name' ) as $in => $col ) {
					if ( isset( $a[ $in ] ) ) {
						$data[ $col ] = $a[ $in ];
					}
				}
				$res = wp_update_post( $data, true );
				if ( is_wp_error( $res ) ) {
					throw new Exception( $res->get_error_message() );
				}
				if ( ! empty( $a['meta'] ) && is_array( $a['meta'] ) ) {
					foreach ( $a['meta'] as $k => $v ) {
						update_post_meta( (int) $a['id'], sanitize_key( $k ), $v );
					}
				}
				return array( 'id' => (int) $a['id'], 'updated' => true, 'link' => get_permalink( (int) $a['id'] ) );
			},
		);

		$reg['delete_post'] = array(
			'desc'     => 'Delete a post/page/product. Trashes by default; set force=true to permanently delete.',
			'risk'     => 'destructive',
			'schema'   => array(
				'id'    => array( 'type' => 'integer' ),
				'force' => array( 'type' => 'boolean', 'description' => 'Permanently delete (skip trash). Default false.' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				$res = wp_delete_post( (int) $a['id'], ! empty( $a['force'] ) );
				if ( ! $res ) {
					throw new Exception( 'Delete failed (post may not exist).' );
				}
				return array( 'id' => (int) $a['id'], 'deleted' => true, 'forced' => ! empty( $a['force'] ) );
			},
		);

		// Merge in the other tool groups (defined in companion classes).
		$reg = array_merge(
			$reg,
			WPXMCP_Tools_Content::taxonomy_tools(),
			WPXMCP_Tools_Content::media_tools(),
			WPXMCP_Tools_Content::menu_tools(),
			WPXMCP_Tools_Content::user_tools(),
			WPXMCP_Tools_Site::option_tools(),
			WPXMCP_Tools_Site::theme_plugin_tools(),
			WPXMCP_Tools_Site::css_tools(),
			WPXMCP_Tools_Site::db_tools(),
			WPXMCP_Tools_Site_Pro::all(),       // ← plugin/theme search + install + delete + auto-update + rollback + bulk + WP-Cron
			WPXMCP_Tools_WooCommerce::all(),
			WPXMCP_Tools_WooCommerce_Pro::all(), // ← coupons, bulk price/stock, variations, refunds, imagery, reports
			WPXMCP_Tools_Advanced::all(),       // ← db_search_replace, diagnose_output, manage_cron, db_optimize, wc_sales_range
			WPXMCP_Tools_PageBuilder::all(),    // ← gutenberg_build_page, kadence_build_page, page_builder_status
			WPXMCP_Tools_Prompts::all(),        // ← list_prompts, get_prompt (SEO prompt library)
			WPXMCP_Tools_SEO::all(),
			WPXMCP_Tools_SEO_Pro::all(),     // ← AI title/desc, broken links, redirects, schema validator, llms.txt, CWV, hreflang, canonical, OG, malware scan, backup, etc.
			WPXMCP_Tools_SEO_AEO_GEO_Pro::all(),  // ← readability, SERP preview, schema builders (video/breadcrumb/product/org/speakable), PAA, cannibalization, clickbait, FAQ seed, topical authority
			WPXMCP_Tools_Content_Gen::all(),
			WPXMCP_Tools_Audit::all(),          // ← audit, alt, db-health
			WPXMCP_Tools_Audit_Pro::all(),   // ← 404, orphan media, oversized images, mixed content, redirect chains, security headers, DNS/SSL, a11y, perf, sitemap diff, indexability
			WPXMCP_Tools_FileManager::all(),    // ← File Manager: browse, read, write, edit, delete, copy, move, archive, chmod
			WPXMCP_Tools_Elementor_Pro::all(),  // ← Elementor: read/write pages, widgets, content, containers, revisions
			WPXMCP_Tools_ChildTheme::all(),     // ← Child theme scaffold, file write, activate, plan/approve/apply
			WPXMCP_Tools_Performance::all(),    // ← Asset dequeue rules, font swap, async CSS, critical CSS, PSI, optimization context
			WPXMCP_Tools_CF7::all(),            // ← Contact Form 7: list/get/create/update/duplicate/delete forms, mail templates, messages, settings, integrations
			WPXMCP_Tools_Comments::all(),       // ← Comments full CRUD (list, get, create, update, delete, single-comment moderate). Complements bulk comment_moderator in tools-seo-pro.php.
			WPXMCP_Tools_Utilities::all(),      // ← ping, fetch (HTTP), search, get_post_types, get_taxonomies, delete_post_meta, get_post_revisions, restore_post_revision, assign_terms, list_roles, check_capability, get_user_meta, get_site_health
			WPXMCP_Tools_Yoast::all(),          // ← Yoast SEO: 23 free (post/social/canonical/schema/robots/breadcrumb/term/global/sitemap) + 6 premium (redirects, multiple keywords, inclusive language). Plugin-gated, premium-tier gated.
			WPXMCP_Tools_Elementor_Extra::all(),     // ← Elementor FREE extras (32 tools): pages/documents, widgets, kit globals (colors/fonts), site settings, template library, plugin settings, experiments, system info, maintenance. Plugin-gated. Skips 4 collisions with existing tools-elementor-pro.php.
			WPXMCP_Tools_Elementor_Pro_Extra::all(),  // ← Elementor PRO extras (35 tools): form submissions, theme builder, popups, custom code snippets, global widgets, dynamic tags, loop templates, notes, custom fonts/icons, WooCommerce page assignments, element permissions, role manager. Plugin-gated on Elementor Pro.
			WPXMCP_Tools_Woo_Orders::all(),    // ← WooCommerce Orders (11 tools): full order CRUD + batch update, order notes, refunds. Plugin-gated on WooCommerce. No collisions with existing wc_* tools.
			WPXMCP_Tools_Woo_Products::all(),  // ← WooCommerce Products (34 tools): products list/batch/low-stock, categories, tags, brands (requires WC Brands ext), global attributes+terms, variations, reviews, stock. Plugin-gated. Skips 3 collisions (wc_create/update/delete_product).
			WPXMCP_Tools_Woo_Store::all(),     // ← WooCommerce Store (23 tools): coupons list, shipping zones+methods, tax rates+classes, webhooks, payment gateways, sales/top-sellers reports, allowlisted settings, system status+maintenance. Plugin-gated. Skips 3 collisions (wc_create/update/delete_coupon).
			WPXMCP_Tools_RankMath::all(),     // ← Rank Math SEO (78 tools): per-post meta/social/canonical/schema, content analysis, redirects, 404 monitor, global/local/social/homepage/post-type/taxonomy settings, sitemap settings, plus Rank Math Pro (Link Genius, Keyword Tracking, Multi-Location SEO, News/Video sitemaps, Keyword Maps, Analytics, Email Reports, Schema Templates, Video metadata, Image SEO). Plugin-gated; Pro-only tools additionally gate on Rank Math Pro.
			WPXMCP_Tools_Aliases::all(),       // ← WordPress core compatibility/aliases
			WPXMCP_Tools_Advanced_Pro::all(),  // ← execute_php, run_wp_cli, create_admin_access_link (HIGH RISK — default OFF)
			WPXMCP_Tools_Gutenberg::all(),     // ← gutenberg_parse, gutenberg_write, list_design_patterns
			WPXMCP_Tools_Novamira_Core::all(), // ← alternate filesystem tools (default OFF)
			WPXMCP_Tools_Novamira_Gutenberg::all(), // ← gutenberg batch tools
			WPXMCP_Tools_Novamira_Design::all(),    // ← design library
			WPXMCP_Tools_ACF::all(),                // ← ACF field groups + get/update (plugin-gated)
			WPXMCP_Tools_Forms_Extra::all(),        // ← Gravity Forms / WPForms / Fluent Forms
			WPXMCP_Tools_Code_Snippets::all(),      // ← Code Snippets list/create/activate
			WPXMCP_Tools_Blocks_Themes::all(),      // ← GenerateBlocks, Kadence Blocks, Spectra, Astra, GP, Kadence theme
			WPXMCP_Tools_Kadence_Pro::all(),        // ← Kadence Blocks Pro + Theme Pro
			WPXMCP_Tools_GP_Premium::all()          // ← GeneratePress Premium Elements + modules
		);

		return $reg;
	}

	/**
	 * Default enabled tools for Grok / limited clients (~90 tools).
	 * Everything else starts disabled; admin can toggle in Settings.
	 */
	public static function default_enabled_tools(): array {
		return array(
			// Core site
			'site_info', 'get_site_info', 'get_settings', 'update_settings',
			'get_option', 'update_option', 'list_plugins', 'list_themes',
			// Posts & pages
			'list_posts', 'get_post', 'create_post', 'update_post', 'delete_post',
			'search_posts', 'get_pages', 'create_page', 'update_page', 'delete_page',
			'get_post_meta', 'update_post_meta',
			// Terms
			'list_terms', 'get_term', 'create_term', 'update_term', 'delete_term',
			'get_categories', 'get_tags', 'assign_terms',
			// Media
			'list_media', 'get_media', 'upload_media', 'update_media', 'delete_media',
			'upload_image', 'upload_image_from_url',
			// Menus
			'list_menus', 'get_menu_items', 'create_menu', 'create_menu_item',
			'update_menu_item', 'delete_menu_item', 'assign_menu_location', 'get_menu_locations',
			// Users & comments
			'list_users', 'get_user', 'create_user', 'update_user',
			'list_comments', 'get_comment', 'moderate_comment', 'create_comment',
			// File manager
			'fm_list_directory', 'fm_read_file', 'fm_write_file', 'fm_edit_file',
			'fm_get_file_info', 'fm_search', 'fm_create_folder', 'fm_rename',
			'fm_copy', 'fm_move', 'fm_delete', 'fm_syntax_check',
			// WooCommerce essentials
			'wc_list_products', 'wc_get_product', 'wc_create_product', 'wc_update_product',
			'wc_list_orders', 'wc_get_order', 'wc_update_order_status',
			'wc_list_customers', 'wc_get_customer',
			'wc_list_coupons', 'wc_create_coupon', 'wc_sales_report',
			// SEO light
			'seo_get_meta', 'seo_set_meta', 'seo_audit_post', 'seo_sitemap_status',
			'rankmath_update_post_meta', 'rankmath_list_redirects', 'rankmath_add_redirect',
			'yoast_update_post_meta',
			// Plugins / themes
			'activate_plugin', 'deactivate_plugin', 'activate_theme',
			'install_wp_plugin', 'search_wp_plugin',
		);
	}

	/**
	 * Currently enabled tool names (from option, or defaults on first run).
	 */
	public static function enabled_tools(): array {
		$saved = get_option( 'wpxmcp_enabled_tools', null );
		if ( null === $saved || ! is_array( $saved ) ) {
			return self::default_enabled_tools();
		}
		return array_values( array_unique( array_map( 'strval', $saved ) ) );
	}

	/**
	 * Whether a tool is currently enabled.
	 */
	public static function is_tool_enabled( string $name ): bool {
		return in_array( $name, self::enabled_tools(), true );
	}

	/**
	 * Convert the registry into the MCP tools/list payload (only enabled tools).
	 */
	public static function list_tools(): array {
		$enabled = array_flip( self::enabled_tools() );
		$out     = array();
		foreach ( self::registry() as $name => $def ) {
			if ( ! isset( $enabled[ $name ] ) ) {
				continue;
			}
			$props    = $def['schema'] ?? array();
			$required = $def['required'] ?? array();
			$risk     = $def['risk'] ?? 'read';
			$out[]    = array(
				'name'        => $name,
				'description' => $def['desc'] . ' [risk: ' . $risk . ']',
				'inputSchema' => array(
					'type'       => 'object',
					'properties' => empty( $props ) ? new stdClass() : $props,
					'required'   => array_values( $required ),
				),
				'annotations' => array(
					'readOnlyHint'    => 'read' === $risk,
					'destructiveHint' => 'destructive' === $risk,
				),
			);
		}
		return $out;
	}

	// Tool group methods are defined in the trait-like includes below.
	// (Loaded via require in this same file for single-file simplicity.)
}

require_once WPXMCP_DIR . 'includes/tools-content.php';
require_once WPXMCP_DIR . 'includes/tools-site.php';
require_once WPXMCP_DIR . 'includes/tools-site-pro.php';
require_once WPXMCP_DIR . 'includes/tools-woocommerce.php';
require_once WPXMCP_DIR . 'includes/tools-woocommerce-pro.php';
require_once WPXMCP_DIR . 'includes/tools-advanced.php';
require_once WPXMCP_DIR . 'includes/tools-pagebuilder.php';
require_once WPXMCP_DIR . 'includes/tools-prompts.php';
require_once WPXMCP_DIR . 'includes/tools-seo.php';
require_once WPXMCP_DIR . 'includes/tools-seo-pro.php';
require_once WPXMCP_DIR . 'includes/tools-seo-aeo-geo-pro.php';
require_once WPXMCP_DIR . 'includes/tools-content-gen.php';
require_once WPXMCP_DIR . 'includes/tools-audit.php';
require_once WPXMCP_DIR . 'includes/tools-audit-pro.php';
require_once WPXMCP_DIR . 'includes/tools-filemanager.php';
require_once WPXMCP_DIR . 'includes/tools-elementor-pro.php';
require_once WPXMCP_DIR . 'includes/tools-child-theme.php';
require_once WPXMCP_DIR . 'includes/tools-performance.php';
require_once WPXMCP_DIR . 'includes/tools-cf7.php';
require_once WPXMCP_DIR . 'includes/tools-comments.php';
require_once WPXMCP_DIR . 'includes/tools-utilities.php';
require_once WPXMCP_DIR . 'includes/tools-yoast.php';
require_once WPXMCP_DIR . 'includes/tools-elementor-extra.php';
require_once WPXMCP_DIR . 'includes/tools-elementor-pro-extra.php';
require_once WPXMCP_DIR . 'includes/tools-woo-orders.php';
require_once WPXMCP_DIR . 'includes/tools-woo-products.php';
require_once WPXMCP_DIR . 'includes/tools-woo-store.php';
require_once WPXMCP_DIR . 'includes/tools-rankmath.php';
require_once WPXMCP_DIR . 'includes/tools-aliases.php';
require_once WPXMCP_DIR . 'includes/tools-advanced-pro.php';
require_once WPXMCP_DIR . 'includes/tools-gutenberg.php';
require_once WPXMCP_DIR . 'includes/tools-novamira-core.php';
require_once WPXMCP_DIR . 'includes/tools-novamira-gutenberg.php';
require_once WPXMCP_DIR . 'includes/tools-novamira-design.php';
require_once WPXMCP_DIR . 'includes/tools-acf.php';
require_once WPXMCP_DIR . 'includes/tools-forms-extra.php';
require_once WPXMCP_DIR . 'includes/tools-code-snippets.php';
require_once WPXMCP_DIR . 'includes/tools-blocks-themes.php';
require_once WPXMCP_DIR . 'includes/tools-kadence-pro.php';
require_once WPXMCP_DIR . 'includes/tools-gp-premium.php';
