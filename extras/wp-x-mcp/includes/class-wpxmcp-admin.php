<?php
/**
 * Admin UI: settings page for API keys, scopes, and audit log.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Admin {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'handle_actions' ) );
		add_action( 'admin_notices', array( $this, 'new_key_notice' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	public function menu(): void {
		add_menu_page(
			'WP x MCP',
			'WP x MCP',
			'manage_options',
			'wp-x-mcp',
			array( $this, 'render' ),
			'dashicons-rest-api',
			80
		);

		add_submenu_page(
			'wp-x-mcp',
			'WP x MCP — Settings',
			'⚙️ Settings',
			'manage_options',
			'wp-x-mcp',
			array( $this, 'render' )
		);
	}

	public function enqueue_assets( $hook ): void {
		if ( 'toplevel_page_wp-x-mcp' !== $hook ) {
			return;
		}
		// Inline CSS only — no external files, keeps UI simple.
		$css = '
			.wpxmcp-wrap { max-width: 960px; }
			.wpxmcp-card {
				background: #fff;
				border: 1px solid #c3c4c7;
				border-radius: 4px;
				padding: 20px 24px;
				margin: 0 0 20px;
				box-shadow: 0 1px 1px rgba(0,0,0,.04);
			}
			.wpxmcp-card h2 {
				margin: 0 0 8px;
				font-size: 1.15em;
				font-weight: 600;
			}
			.wpxmcp-card p.desc {
				margin: 0 0 16px;
				color: #646970;
				font-size: 13px;
			}
			.wpxmcp-form-row {
				display: flex;
				flex-wrap: wrap;
				gap: 10px;
				align-items: center;
				margin-bottom: 4px;
			}
			.wpxmcp-form-row input[type="text"] {
				min-width: 220px;
				max-width: 320px;
			}
			.wpxmcp-form-row select {
				min-width: 200px;
			}
			.wpxmcp-tokens-table {
				width: 100%;
				border-collapse: collapse;
				margin: 0;
			}
			.wpxmcp-tokens-table th {
				text-align: left;
				padding: 10px 12px;
				border-bottom: 1px solid #c3c4c7;
				font-weight: 600;
				font-size: 12px;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				color: #1d2327;
			}
			.wpxmcp-tokens-table td {
				padding: 12px;
				border-bottom: 1px solid #f0f0f1;
				vertical-align: middle;
			}
			.wpxmcp-tokens-table tr:last-child td {
				border-bottom: none;
			}
			.wpxmcp-token-preview {
				font-family: Consolas, Monaco, monospace;
				font-size: 12px;
				background: #f6f7f7;
				padding: 3px 8px;
				border-radius: 3px;
				display: inline-block;
			}
			.wpxmcp-scope {
				display: inline-block;
				padding: 2px 8px;
				border-radius: 3px;
				font-size: 11px;
				font-weight: 600;
				text-transform: uppercase;
				background: #f0f0f1;
				color: #1d2327;
			}
			.wpxmcp-scope-full { background: #edfaef; color: #00a32a; }
			.wpxmcp-scope-editor { background: #f0f6fc; color: #2271b1; }
			.wpxmcp-scope-readonly { background: #f6f7f7; color: #50575e; }
			.wpxmcp-actions {
				display: flex;
				gap: 6px;
				flex-wrap: wrap;
			}
			.wpxmcp-actions .button {
				margin: 0;
			}
			.wpxmcp-copy-feedback {
				display: none;
				margin-left: 8px;
				color: #00a32a;
				font-size: 12px;
				font-weight: 500;
			}
			.wpxmcp-base-endpoint {
				font-family: Consolas, Monaco, monospace;
				font-size: 12px;
				background: #f6f7f7;
				padding: 8px 12px;
				border-radius: 3px;
				word-break: break-all;
				margin: 8px 0 0;
			}
			.wpxmcp-hint {
				font-size: 12px;
				color: #646970;
				margin-top: 10px;
			}
		';
		wp_add_inline_style( 'wp-admin', $css );
	}

	public function new_key_notice(): void {
		$key = get_transient( 'wpxmcp_new_key_notice' );
		if ( $key ) {
			delete_transient( 'wpxmcp_new_key_notice' );
			$endpoint = rest_url( WPXMCP_NAMESPACE . '/mcp' );
			$self_url = $endpoint . '?key=' . rawurlencode( $key );
			echo '<div class="notice notice-success is-dismissible"><p>';
			echo '<strong>New API key created.</strong> Copy it now — it will not be shown in full again.<br>';
			echo '<code style="user-select:all">' . esc_html( $key ) . '</code><br><br>';
			echo '<strong>Self-auth URL (for Claude.ai / header-less clients):</strong><br>';
			echo '<code style="user-select:all;word-break:break-all">' . esc_html( $self_url ) . '</code>';
			echo '</p></div>';
		}
	}

	public function handle_actions(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		// Create key.
		if ( isset( $_POST['wpxmcp_action'] ) && 'create_key' === $_POST['wpxmcp_action'] && check_admin_referer( 'wpxmcp_create_key' ) ) {
			$keys  = get_option( 'wpxmcp_api_keys', array() );
			$key   = 'wpxmcp_' . bin2hex( random_bytes( 24 ) );
			$ttl   = sanitize_text_field( wp_unslash( $_POST['expires_in'] ?? '0' ) );
			$ttl_map = array(
				'0'      => 0,
				'1h'     => HOUR_IN_SECONDS,
				'24h'    => DAY_IN_SECONDS,
				'7d'     => WEEK_IN_SECONDS,
				'30d'    => 30 * DAY_IN_SECONDS,
				'90d'    => 90 * DAY_IN_SECONDS,
				'365d'   => YEAR_IN_SECONDS,
			);
			$seconds = $ttl_map[ $ttl ] ?? 0;
			$expires = $seconds > 0 ? ( time() + $seconds ) : 0;
			$keys[] = array(
				'key'     => $key,
				'label'   => sanitize_text_field( wp_unslash( $_POST['label'] ?? 'New key' ) ),
				'created' => current_time( 'mysql' ),
				'scope'   => in_array( $_POST['scope'] ?? '', array( 'full', 'editor', 'readonly' ), true ) ? $_POST['scope'] : 'full',
				'expires' => $expires,
			);
			update_option( 'wpxmcp_api_keys', $keys );
			set_transient( 'wpxmcp_new_key_notice', $key, 300 );
			wp_safe_redirect( admin_url( 'admin.php?page=wp-x-mcp' ) );
			exit;
		}

		// Revoke key.
		if ( isset( $_POST['wpxmcp_action'] ) && 'revoke_key' === $_POST['wpxmcp_action'] && check_admin_referer( 'wpxmcp_revoke_key' ) ) {
			$target = sanitize_text_field( wp_unslash( $_POST['key'] ?? '' ) );
			$keys   = array_values(
				array_filter(
					get_option( 'wpxmcp_api_keys', array() ),
					function ( $k ) use ( $target ) {
						return ( $k['key'] ?? '' ) !== $target;
					}
				)
			);
			update_option( 'wpxmcp_api_keys', $keys );
			wp_safe_redirect( admin_url( 'admin.php?page=wp-x-mcp' ) );
			exit;
		}

		// Save enabled tools.
		if ( isset( $_POST['wpxmcp_action'] ) && 'save_tools' === $_POST['wpxmcp_action'] && check_admin_referer( 'wpxmcp_save_tools' ) ) {
			$registry = array_keys( WPXMCP_Tools::registry() );
			$posted   = isset( $_POST['enabled_tools'] ) && is_array( $_POST['enabled_tools'] )
				? array_map( 'sanitize_text_field', wp_unslash( $_POST['enabled_tools'] ) )
				: array();
			$enabled  = array_values( array_intersect( $posted, $registry ) );
			update_option( 'wpxmcp_enabled_tools', $enabled, false );
			wp_safe_redirect( admin_url( 'admin.php?page=wp-x-mcp&tools_saved=1' ) );
			exit;
		}

		// Reset tools to defaults.
		if ( isset( $_POST['wpxmcp_action'] ) && 'reset_tools' === $_POST['wpxmcp_action'] && check_admin_referer( 'wpxmcp_save_tools' ) ) {
			update_option( 'wpxmcp_enabled_tools', WPXMCP_Tools::default_enabled_tools(), false );
			wp_safe_redirect( admin_url( 'admin.php?page=wp-x-mcp&tools_saved=1' ) );
			exit;
		}

		// Enable all tools.
		if ( isset( $_POST['wpxmcp_action'] ) && 'enable_all_tools' === $_POST['wpxmcp_action'] && check_admin_referer( 'wpxmcp_save_tools' ) ) {
			update_option( 'wpxmcp_enabled_tools', array_keys( WPXMCP_Tools::registry() ), false );
			wp_safe_redirect( admin_url( 'admin.php?page=wp-x-mcp&tools_saved=1' ) );
			exit;
		}
	}

	public function render(): void {
		$keys     = get_option( 'wpxmcp_api_keys', array() );
		$endpoint = rest_url( WPXMCP_NAMESPACE . '/mcp' );
		$logs     = WPXMCP_Logger::recent( 50 );
		?>
		<div class="wrap wpxmcp-wrap">
			<h1>WP x MCP — Full Control AI Connector</h1>
			<p>Self-owned MCP server. Create tokens below and connect Claude, ChatGPT, Gemini or any MCP client.</p>

			<!-- Create New Token -->
			<div class="wpxmcp-card">
				<h2>Create New Token</h2>
				<p class="desc">Give the token a label and choose a scope. After creation you can copy the full self-auth URL in one click.</p>
				<form method="post">
					<?php wp_nonce_field( 'wpxmcp_create_key' ); ?>
					<input type="hidden" name="wpxmcp_action" value="create_key" />
					<div class="wpxmcp-form-row">
						<input type="text" name="label" placeholder="Label (e.g. Claude desktop)" required />
						<select name="scope">
							<option value="full">Full (read + write + destructive)</option>
							<option value="editor">Editor (read + write)</option>
							<option value="readonly">Read-only</option>
						</select>
						<select name="expires_in" title="How long this token stays valid">
							<option value="0">Never expires</option>
							<option value="1h">Expires in 1 hour</option>
							<option value="24h">Expires in 24 hours</option>
							<option value="7d" selected>Expires in 7 days</option>
							<option value="30d">Expires in 30 days</option>
							<option value="90d">Expires in 90 days</option>
							<option value="365d">Expires in 1 year</option>
						</select>
						<button type="submit" class="button button-primary">Create Token</button>
					</div>
					<p class="desc" style="margin-top:8px">Tip: For Grok / Claude public connectors prefer a short expiry (7–30 days) and a limited scope.</p>
				</form>
			</div>

			<!-- Managed Access Tokens -->
			<div class="wpxmcp-card">
				<h2>Managed Access Tokens</h2>
				<p class="desc">Copy the self-auth URL (includes the key) for header-less clients such as Claude.ai. Prefer a limited-scope key for URL use.</p>

				<?php if ( empty( $keys ) ) : ?>
					<p style="margin:12px 0 0;color:#646970">No tokens yet. Create one above.</p>
				<?php else : ?>
					<table class="wpxmcp-tokens-table">
						<thead>
							<tr>
								<th>Label</th>
								<th>Token</th>
								<th>Scope</th>
								<th>Created</th>
								<th>Expires</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
						<?php foreach ( $keys as $k ) :
							$full_key  = $k['key'] ?? '';
							$preview   = substr( $full_key, 0, 12 ) . '…' . substr( $full_key, -4 );
							$scope     = $k['scope'] ?? 'full';
							$self_url  = $endpoint . '?key=' . rawurlencode( $full_key );
							$scope_cls = 'wpxmcp-scope wpxmcp-scope-' . esc_attr( $scope );
							$exp_ts    = isset( $k['expires'] ) ? (int) $k['expires'] : 0;
							if ( $exp_ts > 0 ) {
								$exp_label = $exp_ts < time()
									? '<span style="color:#b32d2e">Expired</span>'
									: esc_html( wp_date( 'Y-m-d H:i', $exp_ts ) );
							} else {
								$exp_label = '<span style="color:#646970">Never</span>';
							}
							?>
							<tr>
								<td>
									<strong><?php echo esc_html( $k['label'] ?? '' ); ?></strong>
								</td>
								<td>
									<span class="wpxmcp-token-preview"><?php echo esc_html( $preview ); ?></span>
								</td>
								<td>
									<span class="<?php echo $scope_cls; ?>"><?php echo esc_html( $scope ); ?></span>
								</td>
								<td style="white-space:nowrap;font-size:13px;color:#646970">
									<?php echo esc_html( $k['created'] ?? '' ); ?>
								</td>
								<td style="white-space:nowrap;font-size:13px">
									<?php echo $exp_label; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
								</td>
								<td>
									<div class="wpxmcp-actions">
										<button type="button"
											class="button button-small wpxmcp-copy-btn"
											data-copy="<?php echo esc_attr( $self_url ); ?>"
											title="Copy self-auth URL (includes key)">
											Copy URL
										</button>
										<button type="button"
											class="button button-small wpxmcp-copy-btn"
											data-copy="<?php echo esc_attr( $full_key ); ?>"
											title="Copy raw API key">
											Copy Key
										</button>
										<form method="post" style="display:inline;margin:0">
											<?php wp_nonce_field( 'wpxmcp_revoke_key' ); ?>
											<input type="hidden" name="wpxmcp_action" value="revoke_key" />
											<input type="hidden" name="key" value="<?php echo esc_attr( $full_key ); ?>" />
											<button type="submit" class="button button-small" style="color:#b32d2e" onclick="return confirm('Revoke this token permanently?')">Revoke</button>
										</form>
										<span class="wpxmcp-copy-feedback">Copied!</span>
									</div>
								</td>
							</tr>
						<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>

				<div class="wpxmcp-hint">
					<strong>Base endpoint</strong> (for clients that support custom headers — send key in <code>X-WPXMCP-API-Key</code> or <code>Authorization: Bearer</code>):
					<div class="wpxmcp-base-endpoint" id="wpxmcp-base-endpoint"><?php echo esc_html( $endpoint ); ?></div>
					<button type="button" class="button button-small wpxmcp-copy-btn" data-copy="<?php echo esc_attr( $endpoint ); ?>" style="margin-top:8px">Copy Base Endpoint</button>
					<span class="wpxmcp-copy-feedback">Copied!</span>
				</div>
			</div>

			<!-- Managed Tools -->
			<div class="wpxmcp-card" style="margin-top:20px">
				<h2>Managed Tools</h2>
				<p class="desc">
					Only <strong>enabled</strong> tools are exposed to MCP clients (Grok, Claude, etc.).
					Default set is optimized for Grok (~90 tools). Enable more as needed.
				</p>
				<div style="background:#fcf0f1;border:1px solid #f1aeb5;border-radius:4px;padding:10px 12px;margin:0 0 12px;font-size:13px;line-height:1.5">
					<strong>Security note — Advanced / High-Risk tools</strong><br>
					Tools like <code>execute_php</code>, <code>run_wp_cli</code>, <code>create_admin_access_link</code>, and unrestricted file write/delete can fully take over the site if an API key leaks.
					They stay <strong>disabled by default</strong>. Only enable them for trusted local clients, never for public Grok/Claude connector URLs.
					Safer alternatives: use the <code>fm_*</code> File Manager tools (path-limited + confirm gates).
				</div>
				<?php
				if ( ! empty( $_GET['tools_saved'] ) ) {
					echo '<div class="notice notice-success is-dismissible" style="margin:0 0 12px"><p>Tool settings saved.</p></div>';
				}
				$all_tools     = WPXMCP_Tools::registry();
				$enabled_list  = WPXMCP_Tools::enabled_tools();
				$enabled_flip  = array_flip( $enabled_list );
				$enabled_count = count( $enabled_list );
				$total_count   = count( $all_tools );
				// Group tools by prefix for easier browsing.
				$groups = array(
					'Advanced / High-Risk' => array(),
					'Core / Site'     => array(),
					'Posts & Pages'   => array(),
					'Terms'           => array(),
					'Media'           => array(),
					'Menus'           => array(),
					'Users & Comments'=> array(),
					'File Manager'    => array(),
					'WooCommerce'     => array(),
					'SEO'             => array(),
					'Elementor'       => array(),
					'Plugins & Themes'=> array(),
					'Gutenberg & Design' => array(),
					'ACF (Custom Fields)' => array(),
					'Forms (GF / WPForms / Fluent)' => array(),
					'Code Snippets'   => array(),
					'Blocks (GB / Kadence / Spectra)' => array(),
					'Themes (Astra / GP / Kadence)' => array(),
					'Kadence Pro (Blocks + Theme)' => array(),
					'GeneratePress Premium' => array(),
					'Other'           => array(),
				);
				$high_risk_names = array(
					'execute_php', 'run_wp_cli', 'create_admin_access_link',
					'list_directory', 'read_file', 'write_file', 'edit_file', 'delete_file', 'create_upload_link',
				);
				$gutenberg_design = array(
					'gutenberg_parse', 'gutenberg_write', 'list_design_patterns',
					'gutenberg_create_batch', 'gutenberg_add_change', 'gutenberg_list_batches',
					'design_save', 'design_list', 'design_activate',
				);
				foreach ( $all_tools as $tname => $tdef ) {
					if ( in_array( $tname, $high_risk_names, true ) ) {
						$groups['Advanced / High-Risk'][ $tname ] = $tdef;
					} elseif ( in_array( $tname, $gutenberg_design, true ) ) {
						$groups['Gutenberg & Design'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'acf_' ) ) {
						$groups['ACF (Custom Fields)'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'gf_' ) || str_starts_with( $tname, 'wpforms_' ) || str_starts_with( $tname, 'fluent_' ) ) {
						$groups['Forms (GF / WPForms / Fluent)'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'snippets_' ) ) {
						$groups['Code Snippets'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'gb_' ) || str_starts_with( $tname, 'kadence_blocks_' ) || str_starts_with( $tname, 'spectra_' ) ) {
						$groups['Blocks (GB / Kadence / Spectra)'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'astra_' ) || str_starts_with( $tname, 'gp_' ) || str_starts_with( $tname, 'kadence_theme_' ) ) {
						$groups['Themes (Astra / GP / Kadence)'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'kbp_' ) || str_starts_with( $tname, 'ktp_' ) || $tname === 'kadence_pro_status' ) {
						$groups['Kadence Pro (Blocks + Theme)'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'gpp_' ) ) {
						$groups['GeneratePress Premium'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'fm_' ) ) {
						$groups['File Manager'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'wc_' ) || str_starts_with( $tname, 'woo_' ) ) {
						$groups['WooCommerce'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'elementor' ) || false !== strpos( $tname, 'elementor' ) ) {
						$groups['Elementor'][ $tname ] = $tdef;
					} elseif ( str_starts_with( $tname, 'rankmath' ) || str_starts_with( $tname, 'yoast' ) || str_starts_with( $tname, 'seo_' ) ) {
						$groups['SEO'][ $tname ] = $tdef;
					} elseif ( in_array( $tname, array( 'list_posts', 'get_post', 'create_post', 'update_post', 'delete_post', 'search_posts', 'get_pages', 'create_page', 'update_page', 'delete_page', 'get_post_meta', 'update_post_meta', 'delete_post_meta', 'get_posts', 'get_post_types', 'get_post_revisions', 'restore_post_revision', 'bulk_publish_posts' ), true ) ) {
						$groups['Posts & Pages'][ $tname ] = $tdef;
					} elseif ( false !== strpos( $tname, 'term' ) || false !== strpos( $tname, 'categor' ) || false !== strpos( $tname, 'tag' ) || 'assign_terms' === $tname ) {
						$groups['Terms'][ $tname ] = $tdef;
					} elseif ( false !== strpos( $tname, 'media' ) || false !== strpos( $tname, 'image' ) || false !== strpos( $tname, 'upload' ) ) {
						$groups['Media'][ $tname ] = $tdef;
					} elseif ( false !== strpos( $tname, 'menu' ) ) {
						$groups['Menus'][ $tname ] = $tdef;
					} elseif ( false !== strpos( $tname, 'user' ) || false !== strpos( $tname, 'comment' ) ) {
						$groups['Users & Comments'][ $tname ] = $tdef;
					} elseif ( false !== strpos( $tname, 'plugin' ) || false !== strpos( $tname, 'theme' ) ) {
						$groups['Plugins & Themes'][ $tname ] = $tdef;
					} elseif ( in_array( $tname, array( 'site_info', 'get_site_info', 'get_settings', 'update_settings', 'get_option', 'update_option', 'delete_option', 'list_plugins', 'list_themes' ), true ) ) {
						$groups['Core / Site'][ $tname ] = $tdef;
					} else {
						$groups['Other'][ $tname ] = $tdef;
					}
				}
				?>
				<p style="margin:0 0 12px;font-size:13px">
					<strong><?php echo (int) $enabled_count; ?></strong> of <strong><?php echo (int) $total_count; ?></strong> tools enabled
					&nbsp;·&nbsp;
					<button type="button" class="button button-small" id="wpxmcp-tools-select-all">Select all visible</button>
					<button type="button" class="button button-small" id="wpxmcp-tools-deselect-all">Deselect all visible</button>
				</p>
				<form method="post" id="wpxmcp-tools-form">
					<?php wp_nonce_field( 'wpxmcp_save_tools' ); ?>
					<input type="hidden" name="wpxmcp_action" value="save_tools" />
					<div style="max-height:420px;overflow:auto;border:1px solid #c3c4c7;border-radius:4px;padding:8px 12px;background:#fff">
						<?php foreach ( $groups as $gname => $gtools ) :
							if ( empty( $gtools ) ) {
								continue;
							}
							$g_enabled = 0;
							foreach ( array_keys( $gtools ) as $tn ) {
								if ( isset( $enabled_flip[ $tn ] ) ) {
									++$g_enabled;
								}
							}
							?>
							<details style="margin-bottom:8px" open>
								<summary style="cursor:pointer;font-weight:600;padding:4px 0">
									<?php echo esc_html( $gname ); ?>
									<span style="font-weight:400;color:#646970;font-size:12px">(<?php echo (int) $g_enabled; ?>/<?php echo count( $gtools ); ?>)</span>
								</summary>
								<div style="padding:4px 0 8px 8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:2px 12px">
									<?php foreach ( $gtools as $tname => $tdef ) :
										$checked = isset( $enabled_flip[ $tname ] );
										$risk    = $tdef['risk'] ?? 'read';
										?>
										<label style="display:flex;align-items:flex-start;gap:6px;font-size:13px;padding:2px 0;cursor:pointer">
											<input type="checkbox" name="enabled_tools[]" value="<?php echo esc_attr( $tname ); ?>" <?php checked( $checked ); ?> style="margin-top:3px" />
											<span>
												<code style="font-size:12px"><?php echo esc_html( $tname ); ?></code>
												<span style="color:#646970;font-size:11px"> · <?php echo esc_html( $risk ); ?></span>
												<?php if ( ! empty( $tdef['desc'] ) ) : ?>
													<br><span style="color:#646970;font-size:11px;line-height:1.35"><?php echo esc_html( wp_html_excerpt( $tdef['desc'], 140, '…' ) ); ?></span>
												<?php endif; ?>
											</span>
										</label>
									<?php endforeach; ?>
								</div>
							</details>
						<?php endforeach; ?>
					</div>
					<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
						<button type="submit" class="button button-primary">Save Tool Settings</button>
						<button type="submit" name="wpxmcp_action" value="reset_tools" class="button" onclick="return confirm('Reset to default Grok-optimized tool set (~90 tools)?')">Reset to Defaults</button>
						<button type="submit" name="wpxmcp_action" value="enable_all_tools" class="button" onclick="return confirm('Enable ALL <?php echo (int) $total_count; ?> tools? Grok may fail if over ~128.')">Enable All</button>
					</div>
				</form>
			</div>

			<hr style="margin:30px 0" />

			<h2>📁 File Manager Tools</h2>
			<p>WP x MCP v<?php echo esc_html( WPXMCP_VERSION ); ?> includes a full-featured File Manager exposed as MCP tools.
			All <strong>write</strong> and <strong>destructive</strong> operations require <code>confirm: true</code> from the AI agent — a built-in confirmation gate before any file is changed.</p>

			<table class="widefat striped" style="max-width:900px">
				<thead>
					<tr><th style="width:220px">Tool</th><th style="width:90px">Risk</th><th>Description</th></tr>
				</thead>
				<tbody>
					<tr><td><code>fm_list_directory</code></td><td>🟢 read</td><td>Browse a directory — name, size, permissions, mime, modified date.</td></tr>
					<tr><td><code>fm_get_file_info</code></td><td>🟢 read</td><td>Full file details: permissions, owner, timestamps, mime, md5 hash. (Right-click → Get Info)</td></tr>
					<tr><td><code>fm_read_file</code></td><td>🟢 read</td><td>Read a text file or a specific line range.</td></tr>
					<tr><td><code>fm_syntax_check</code></td><td>🟢 read</td><td>Lint code (PHP/JSON/XML/CSS/JS) without saving.</td></tr>
					<tr><td><code>fm_download_file</code></td><td>🟢 read</td><td>Download any file as base64 (max 10 MB).</td></tr>
					<tr><td><code>fm_search</code></td><td>🟢 read</td><td>Search files by filename pattern and/or content string.</td></tr>
					<tr><td><code>fm_write_file</code></td><td>🟡 write</td><td>Create or overwrite a file. Syntax-checked before save. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_edit_file</code></td><td>🟡 write</td><td>Targeted search-and-replace inside a file. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_rename</code></td><td>🟡 write</td><td>Rename a file or folder. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_copy</code></td><td>🟡 write</td><td>Copy file or folder (recursive). Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_move</code></td><td>🟡 write</td><td>Move (cut + paste) a file or folder. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_create_folder</code></td><td>🟡 write</td><td>Create a new directory. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_chmod</code></td><td>🟡 write</td><td>Change permissions (chmod), optionally recursive. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_upload_file</code></td><td>🟡 write</td><td>Upload a file via base64 content. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_create_archive</code></td><td>🟡 write</td><td>Create a ZIP archive from files/folders. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_extract_archive</code></td><td>🟡 write</td><td>Extract ZIP / tar / tar.gz / bz2 / xz archives. Requires <code>confirm=true</code>.</td></tr>
					<tr><td><code>fm_delete</code></td><td>🔴 destructive</td><td>Delete a file or folder (irreversible). Requires <code>confirm=true</code>.</td></tr>
				</tbody>
			</table>
			<p class="description" style="margin-top:8px">
				⚠️ <strong>Security:</strong> All paths are restricted to <code>ABSPATH</code> and <code>wp-content/</code>. Read-only API keys can only use the 🟢 read tools.
				Use the <code>wpxmcp_fm_allowed_roots</code> filter to adjust accessible roots.
			</p>

			<h2 style="margin-top:30px">Recent Activity (last 50)</h2>
			<table class="widefat striped" style="max-width:900px">
				<thead><tr><th>Time</th><th>Tool</th><th>Scope</th><th>Result</th><th>IP</th></tr></thead>
				<tbody>
				<?php if ( empty( $logs ) ) : ?>
					<tr><td colspan="5">No activity yet.</td></tr>
				<?php else : ?>
					<?php foreach ( $logs as $row ) : ?>
						<tr>
							<td><?php echo esc_html( $row['created'] ); ?></td>
							<td><code><?php echo esc_html( $row['tool'] ); ?></code></td>
							<td><?php echo esc_html( $row['scope'] ); ?></td>
							<td><?php echo $row['success'] ? '✅' : '<span style="color:#b32d2e">⚠ ' . esc_html( $row['summary'] ) . '</span>'; ?></td>
							<td><?php echo esc_html( $row['ip'] ); ?></td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
				</tbody>
			</table>
		</div>

		<script>
		(function () {
			document.querySelectorAll('.wpxmcp-copy-btn').forEach(function (btn) {
				btn.addEventListener('click', function () {
					var text = this.getAttribute('data-copy') || '';
					if (!text) return;
					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(text).then(function () {
							showFeedback(btn);
						}).catch(function () {
							fallbackCopy(text, btn);
						});
					} else {
						fallbackCopy(text, btn);
					}
				});
			});

			function showFeedback(btn) {
				var fb = btn.parentElement.querySelector('.wpxmcp-copy-feedback');
				if (!fb) {
					// for the base-endpoint button which is outside the actions div
					fb = btn.nextElementSibling;
				}
				if (fb && fb.classList.contains('wpxmcp-copy-feedback')) {
					fb.style.display = 'inline';
					setTimeout(function () { fb.style.display = 'none'; }, 1800);
				}
			}

			function fallbackCopy(text, btn) {
				var ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.left = '-9999px';
				document.body.appendChild(ta);
				ta.select();
				try {
					document.execCommand('copy');
					showFeedback(btn);
				} catch (e) {}
				document.body.removeChild(ta);
			}

			var selAll = document.getElementById('wpxmcp-tools-select-all');
			var desAll = document.getElementById('wpxmcp-tools-deselect-all');
			if (selAll) {
				selAll.addEventListener('click', function () {
					document.querySelectorAll('#wpxmcp-tools-form input[type=checkbox]').forEach(function (c) { c.checked = true; });
				});
			}
			if (desAll) {
				desAll.addEventListener('click', function () {
					document.querySelectorAll('#wpxmcp-tools-form input[type=checkbox]').forEach(function (c) { c.checked = false; });
				});
			}
		})();
		</script>
		<?php
	}
}
