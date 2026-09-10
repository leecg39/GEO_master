<?php
/**
 * Advanced Setup Guide submenu — Claude, ChatGPT, Grok, Perplexity, n8n, Cursor, VS Code.
 * Includes: live connection tester, prompt library, system prompt generator,
 * OpenAPI schema export, Node.js/Python bridge generators, and full tools reference.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Guide {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ), 20 );
		add_action( 'wp_ajax_wpxmcp_live_test', array( $this, 'ajax_live_test' ) );
		add_action( 'wp_ajax_wpxmcp_openapi_export', array( $this, 'ajax_openapi_export' ) );
	}

	public function menu(): void {
		add_submenu_page(
			'wp-x-mcp',
			'Setup Guide — Claude, ChatGPT, Grok & More',
			'🗺️ Setup Guide',
			'manage_options',
			'wp-x-mcp-guide',
			array( $this, 'render' )
		);
	}

	/** AJAX: live connection test */
	public function ajax_live_test(): void {
		check_ajax_referer( 'wpxmcp_guide_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'Unauthorized' );
		}
		$endpoint = rest_url( WPXMCP_NAMESPACE . '/mcp' );
		$keys     = get_option( 'wpxmcp_api_keys', array() );
		$key      = sanitize_text_field( wp_unslash( $_POST['api_key'] ?? ( $keys[0]['key'] ?? '' ) ) );

		$init = wp_remote_post( $endpoint, array(
			'timeout' => 10,
			'headers' => array(
				'Content-Type'      => 'application/json',
				'X-WPXMCP-API-Key'  => $key,
			),
			'body' => wp_json_encode( array(
				'jsonrpc' => '2.0', 'id' => 1,
				'method'  => 'initialize',
				'params'  => array( 'protocolVersion' => '2024-11-05', 'capabilities' => new stdClass(), 'clientInfo' => array( 'name' => 'wp-x-mcp-guide', 'version' => WPXMCP_VERSION ) ),
			) ),
		) );

		if ( is_wp_error( $init ) ) {
			wp_send_json_error( array( 'step' => 'initialize', 'error' => $init->get_error_message() ) );
		}

		$body = json_decode( wp_remote_retrieve_body( $init ), true );
		if ( empty( $body['result'] ) ) {
			wp_send_json_error( array( 'step' => 'initialize', 'raw' => $body ) );
		}

		// Now test tools/list
		$tools_resp = wp_remote_post( $endpoint, array(
			'timeout' => 10,
			'headers' => array(
				'Content-Type'     => 'application/json',
				'X-WPXMCP-API-Key' => $key,
			),
			'body' => wp_json_encode( array( 'jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list', 'params' => new stdClass() ) ),
		) );

		$tools_body = json_decode( wp_remote_retrieve_body( $tools_resp ), true );
		$tool_count = count( $tools_body['result']['tools'] ?? array() );

		wp_send_json_success( array(
			'protocol'    => $body['result']['protocolVersion'] ?? 'unknown',
			'server_name' => $body['result']['serverInfo']['name'] ?? 'unknown',
			'server_ver'  => $body['result']['serverInfo']['version'] ?? 'unknown',
			'tool_count'  => $tool_count,
			'status'      => 'connected',
		) );
	}

	/** AJAX: generate OpenAPI 3.0 schema for ChatGPT/Cursor/etc */
	public function ajax_openapi_export(): void {
		check_ajax_referer( 'wpxmcp_guide_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'Unauthorized' );
		}
		$endpoint = rest_url( WPXMCP_NAMESPACE . '/mcp' );
		$tools    = WPXMCP_Tools::list_tools();

		$paths = array();
		foreach ( $tools as $t ) {
			$clean_desc = preg_replace( '/\s*\[risk:[^\]]+\]/', '', $t['description'] );
			$paths[ '/tools/' . $t['name'] ] = array(
				'post' => array(
					'operationId' => $t['name'],
					'summary'     => $clean_desc,
					'requestBody' => array(
						'required' => true,
						'content'  => array(
							'application/json' => array(
								'schema' => $t['inputSchema'],
							),
						),
					),
					'responses' => array(
						'200' => array( 'description' => 'Tool result' ),
					),
				),
			);
		}

		$schema = array(
			'openapi' => '3.0.0',
			'info'    => array(
				'title'   => get_bloginfo( 'name' ) . ' WordPress MCP',
				'version' => WPXMCP_VERSION,
				'description' => 'Auto-generated OpenAPI schema for WP x MCP tools. Use with ChatGPT Custom GPTs or Cursor.',
			),
			'servers' => array( array( 'url' => home_url() ) ),
			'paths'   => $paths,
			'components' => array(
				'securitySchemes' => array(
					'ApiKeyAuth' => array(
						'type' => 'apiKey',
						'in'   => 'header',
						'name' => 'X-WPXMCP-API-Key',
					),
				),
			),
			'security' => array( array( 'ApiKeyAuth' => array() ) ),
		);

		wp_send_json_success( $schema );
	}

	public function render(): void {
		$endpoint  = rest_url( WPXMCP_NAMESPACE . '/mcp' );
		$keys      = get_option( 'wpxmcp_api_keys', array() );
		$first_key = ! empty( $keys ) ? $keys[0]['key'] : 'YOUR_API_KEY_HERE';
		$qs_url    = $endpoint . '?key=' . $first_key; // self-authenticating URL for header-less clients (Claude.ai custom connector, etc.)
		$nonce     = wp_create_nonce( 'wpxmcp_guide_nonce' );
		$site_name = get_bloginfo( 'name' );
		$ajax_url  = admin_url( 'admin-ajax.php' );
		?>
<!DOCTYPE html>
<style>
/* ── Reset & base ── */
.wpxmcp-guide *{box-sizing:border-box;}
.wpxmcp-guide{max-width:980px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d2327;padding-bottom:60px;}

/* ── Hero bar ── */
.wg-hero{border-bottom:2px solid #e2e8f0;padding:20px 4px 20px;margin-bottom:24px;color:#1d2327;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;}
.wg-hero h1{margin:0;font-size:22px;font-weight:700;color:#1d2327;}
.wg-hero p{margin:4px 0 0;color:#666;font-size:13.5px;}
.wg-status-pill{background:#f6f7f7;border:1px solid #c3c4c7;border-radius:20px;padding:6px 16px;font-size:13px;cursor:pointer;color:#1d2327;font-weight:600;transition:background .2s;white-space:nowrap;}
.wg-status-pill:hover{background:#f0f0f0;border-color:#2271b1;color:#2271b1;}
.wg-status-pill.connected{background:#f0fdf4;border-color:#16a34a;color:#16a34a;}
.wg-status-pill.error{background:#fef2f2;border-color:#dc2626;color:#dc2626;}

/* ── Quick info strip ── */
.wg-strip{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;}
.wg-strip-card{background:#f0f6fc;border:1px solid #c3d3e8;border-radius:8px;padding:12px 16px;}
.wg-strip-card label{display:block;font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;}
.wg-strip-card .val{font-family:monospace;font-size:12.5px;color:#1d2327;word-break:break-all;display:flex;align-items:center;gap:8px;}
.wg-copy-inline{background:#2271b1;color:#fff;border:none;border-radius:4px;padding:2px 9px;font-size:11px;cursor:pointer;flex-shrink:0;}
.wg-copy-inline:hover{background:#135e96;}

/* ── Section tabs ── */
.wg-tabs{display:flex;gap:0;margin-bottom:-1px;flex-wrap:wrap;}
.wg-tab{padding:10px 20px;border:1px solid #ddd;border-bottom:none;border-radius:6px 6px 0 0;cursor:pointer;font-size:13px;font-weight:600;background:#f6f7f7;color:#50575e;margin-right:4px;transition:all .15s;user-select:none;}
.wg-tab:hover{background:#f0f0f0;color:#2271b1;}
.wg-tab.active{background:#fff;border-color:#2271b1;color:#2271b1;position:relative;z-index:2;}
.wg-panel{display:none;background:#fff;border:1px solid #2271b1;border-radius:0 8px 8px 8px;padding:28px 32px;margin-bottom:32px;}
.wg-panel.active{display:block;}

/* ── Inner sub-tabs (Options A/B/C) ── */
.wg-subtabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}
.wg-subtab{padding:6px 14px;border:1.5px solid #ddd;border-radius:6px;cursor:pointer;font-size:12.5px;font-weight:600;color:#555;background:#fafafa;transition:all .15s;}
.wg-subtab.active{background:#eff6ff;border-color:#2271b1;color:#2271b1;}
.wg-subpanel{display:none;}
.wg-subpanel.active{display:block;}

/* ── Headings ── */
.wg-panel h2{font-size:18px;margin:0 0 6px;display:flex;align-items:center;gap:10px;}
.wg-panel .tagline{color:#666;font-size:13px;margin:0 0 20px;}
.wg-panel h3{font-size:13.5px;font-weight:700;color:#2271b1;margin:22px 0 10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0;}

/* ── Steps ── */
.wg-steps{counter-reset:step;display:flex;flex-direction:column;gap:12px;}
.wg-step{display:flex;gap:14px;align-items:flex-start;}
.wg-step-num{background:#2271b1;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:1px;}
.wg-step-body{flex:1;font-size:13.5px;line-height:1.65;color:#2c3338;}
.wg-step-body code{background:#f0f0f1;padding:1px 5px;border-radius:3px;font-size:12px;}
.wg-step-body a{color:#2271b1;}

/* ── Code blocks ── */
.wg-pre-wrap{position:relative;margin:12px 0;}
.wg-pre-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px;}
pre.wg-code{background:#0f1117;color:#e2e8f0;padding:18px 16px 18px 20px;border-radius:8px;overflow-x:auto;font-size:12.5px;line-height:1.75;margin:0;white-space:pre;}
pre.wg-code .kw{color:#c792ea;}
pre.wg-code .str{color:#c3e88d;}
pre.wg-code .cm{color:#546e7a;font-style:italic;}
pre.wg-code .key{color:#82aaff;}
pre.wg-code .num{color:#f78c6c;}
.wg-copy-btn{position:absolute;top:10px;right:10px;background:#374151;color:#d1d5db;border:none;border-radius:5px;padding:4px 12px;font-size:11.5px;cursor:pointer;transition:background .15s;}
.wg-copy-btn:hover{background:#4b5563;}
.wg-copy-btn.ok{background:#16a34a;color:#fff;}

/* ── Badges ── */
.wg-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:700;vertical-align:middle;}
.wg-badge-green{background:#dcfce7;color:#16a34a;}
.wg-badge-blue{background:#dbeafe;color:#1e40af;}
.wg-badge-amber{background:#fef3c7;color:#92400e;}
.wg-badge-purple{background:#ede9fe;color:#7c3aed;}
.wg-badge-red{background:#fee2e2;color:#dc2626;}

/* ── Notice / Alert boxes ── */
.wg-notice{border-radius:6px;padding:11px 15px;font-size:13px;line-height:1.55;margin:14px 0;display:flex;gap:10px;align-items:flex-start;}
.wg-notice-icon{font-size:16px;flex-shrink:0;margin-top:1px;}
.wg-notice.info{background:#eff6ff;border-left:3px solid #2271b1;}
.wg-notice.warn{background:#fffbeb;border-left:3px solid #f59e0b;}
.wg-notice.success{background:#f0fdf4;border-left:3px solid #16a34a;}
.wg-notice.danger{background:#fef2f2;border-left:3px solid #dc2626;}

/* ── Prompt library ── */
.wg-prompts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}
.wg-prompt-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;cursor:pointer;transition:all .15s;position:relative;}
.wg-prompt-card:hover{border-color:#2271b1;background:#eff6ff;}
.wg-prompt-card .pc-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#2271b1;margin-bottom:5px;}
.wg-prompt-card .pc-text{font-size:13px;color:#374151;line-height:1.5;}
.wg-prompt-card .pc-copy{position:absolute;top:8px;right:8px;opacity:0;font-size:11px;background:#2271b1;color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;transition:opacity .15s;}
.wg-prompt-card:hover .pc-copy{opacity:1;}

/* ── Connection tester ── */
.wg-tester{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0;}
.wg-tester h3{margin:0 0 14px;font-size:14px;color:#374151;border:none;padding:0;}
.wg-tester-row{display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;}
.wg-tester input{flex:1;min-width:200px;font-family:monospace;font-size:12.5px;}
.wg-tester-btn{background:#2271b1;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;}
.wg-tester-btn:hover{background:#135e96;}
.wg-tester-result{background:#0f1117;color:#e2e8f0;border-radius:6px;padding:14px;font-family:monospace;font-size:12.5px;line-height:1.7;min-height:60px;white-space:pre-wrap;}

/* ── Tools table ── */
.wg-tool-filter{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;}
.wg-tool-filter input{flex:1;max-width:280px;font-size:13px;}
.wg-tool-filter .filter-btn{padding:5px 12px;border:1.5px solid #ddd;border-radius:5px;background:#fff;font-size:12px;cursor:pointer;font-weight:600;}
.wg-tool-filter .filter-btn.active{background:#2271b1;color:#fff;border-color:#2271b1;}
.wg-tools-table{border-collapse:collapse;width:100%;font-size:12.5px;}
.wg-tools-table th{background:#f6f7f7;text-align:left;padding:8px 11px;border:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#50575e;text-transform:uppercase;letter-spacing:.04em;}
.wg-tools-table td{padding:7px 11px;border:1px solid #e2e8f0;vertical-align:top;}
.wg-tools-table tr:hover td{background:#f9fafb;}
.wg-tools-table .tool-name{font-family:monospace;font-weight:700;color:#2271b1;white-space:nowrap;}
.wg-group-row td{background:#f1f5f9;font-weight:700;font-size:12px;color:#475569;letter-spacing:.05em;text-transform:uppercase;padding:5px 11px;}

/* ── System prompt generator ── */
.wg-sysgen{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0;}
.wg-sysgen label{font-weight:700;font-size:13px;display:block;margin-bottom:6px;}
.wg-sysgen select,.wg-sysgen input[type=text]{width:100%;font-size:13px;margin-bottom:10px;}
.wg-sysgen .gen-output{background:#0f1117;color:#c3e88d;border-radius:6px;padding:14px;font-size:12.5px;font-family:monospace;line-height:1.7;white-space:pre-wrap;max-height:220px;overflow-y:auto;margin-top:10px;}

/* ── n8n / Zapier section ── */
.wg-workflow-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;}
.wg-wf-card{border:1px solid #e2e8f0;border-radius:8px;padding:16px;}
.wg-wf-card h4{margin:0 0 8px;font-size:14px;display:flex;align-items:center;gap:6px;}
.wg-wf-card p{margin:0;font-size:13px;color:#555;line-height:1.55;}

/* ── Responsive ── */
@media(max-width:700px){
  .wg-strip,.wg-prompts,.wg-workflow-cards{grid-template-columns:1fr;}
  .wg-hero{flex-direction:column;}
  .wg-panel{padding:18px 16px;}
}
</style>

<div class="wpxmcp-guide wrap">

<!-- Hero -->
<div class="wg-hero">
  <div>
    <h1>WP x MCP — Advanced Setup Guide</h1>
    <p>Connect your WordPress site to Claude, ChatGPT, Grok, Perplexity, n8n, Cursor &amp; more.</p>
  </div>
  <button class="wg-status-pill" id="wg-test-btn" onclick="wgRunTest()">🔌 Test Connection</button>
</div>

<!-- Quick Info Strip -->
<div class="wg-strip">
  <div class="wg-strip-card">
    <label>MCP Endpoint</label>
    <div class="val">
      <span id="wg-ep"><?php echo esc_html( $endpoint ); ?></span>
      <button class="wg-copy-inline" onclick="wgCopyText('wg-ep',this)">Copy</button>
    </div>
  </div>
  <div class="wg-strip-card">
    <label>Default API Key</label>
    <div class="val">
      <span id="wg-key"><?php echo esc_html( $first_key ); ?></span>
      <button class="wg-copy-inline" onclick="wgCopyText('wg-key',this)">Copy</button>
    </div>
  </div>
</div>

<!-- Main Tabs -->
<div class="wg-tabs">
  <div class="wg-tab active"  onclick="wgTab('claude',this)">Claude</div>
  <div class="wg-tab" onclick="wgTab('chatgpt',this)">ChatGPT</div>
  <div class="wg-tab" onclick="wgTab('grok',this)">Grok</div>
  <div class="wg-tab" onclick="wgTab('perplexity',this)">Perplexity</div>
  <div class="wg-tab" onclick="wgTab('cursor',this)">Cursor / VS Code</div>
  <div class="wg-tab" onclick="wgTab('automation',this)">n8n / Zapier</div>
  <div class="wg-tab" onclick="wgTab('prompts',this)">Prompt Library</div>
  <div class="wg-tab" onclick="wgTab('tools',this)">Tools</div>
</div>

<!-- ================================================================ -->
<!-- CLAUDE -->
<!-- ================================================================ -->
<div id="panel-claude" class="wg-panel active">
  <h2>Claude <span class="wg-badge wg-badge-green">✓ Full MCP Support</span></h2>
  <p class="tagline">Claude has native MCP support — the easiest and most powerful way to control your WordPress site with AI.</p>

  <div class="wg-subtabs">
    <div class="wg-subtab active" onclick="wgSub('claude','desktop',this)">Desktop App</div>
    <div class="wg-subtab" onclick="wgSub('claude','web',this)">Claude.ai Web</div>
    <div class="wg-subtab" onclick="wgSub('claude','api',this)">Anthropic API</div>
    <div class="wg-subtab" onclick="wgSub('claude','test',this)">🔌 Live Tester</div>
  </div>

  <div id="claude-desktop" class="wg-subpanel active">
    <h3>Claude Desktop — Config File Setup</h3>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">Install <strong>Claude Desktop</strong> from <a href="https://claude.ai/download" target="_blank">claude.ai/download</a> (Windows or macOS).</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body">Open or create the config file:<br>
        • <strong>Windows:</strong> <code>%APPDATA%\Claude\claude_desktop_config.json</code><br>
        • <strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code><br>
        • <strong>Linux:</strong> <code>~/.config/claude/claude_desktop_config.json</code>
      </div></div>
      <div class="wg-step"><div class="wg-step-num">3</div><div class="wg-step-body">Paste the config below. If file already has content, merge the <code>mcpServers</code> key into the root object.</div></div>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">claude_desktop_config.json</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">{
  <span class="key">"mcpServers"</span>: {
    <span class="key">"<?php echo esc_js( sanitize_title( $site_name ) ); ?>"</span>: {
      <span class="key">"url"</span>: <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>,
      <span class="key">"headers"</span>: {
        <span class="key">"X-WPXMCP-API-Key"</span>: <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>
      }
    }
  }
}</pre>
    </div>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">4</div><div class="wg-step-body">Fully <strong>quit and restart</strong> Claude Desktop (not just close the window).</div></div>
      <div class="wg-step"><div class="wg-step-num">5</div><div class="wg-step-body">Look for the 🔌 <strong>MCP plug icon</strong> in the chat input area. Click it — you should see <strong><?php echo esc_html( count( WPXMCP_Tools::list_tools() ) ); ?> WordPress tools</strong> listed.</div></div>
      <div class="wg-step"><div class="wg-step-num">6</div><div class="wg-step-body">Try these starter prompts:<br>
        <em>"What is the current state of my WordPress site?"</em><br>
        <em>"Run a full broken link audit and show me a summary."</em><br>
        <em>"Check my database health and fix any issues."</em>
      </div></div>
    </div>
    <div class="wg-notice warn"><div class="wg-notice-icon">⚠️</div><div>If you see <strong>server disconnected</strong>: verify the URL is reachable from your machine, check there are no firewall/VPN blocks, and ensure the plugin is active on WordPress.</div></div>
  </div>

  <div id="claude-web" class="wg-subpanel">
    <h3>Claude.ai Web &amp; Desktop — Custom Connector <span class="wg-badge wg-badge-green">Pro, Team &amp; Enterprise</span></h3>
    <div class="wg-notice success"><div class="wg-notice-icon">✅</div><div>The <strong>Add custom connector</strong> dialog works on <strong>Claude Pro</strong> too (not just Team/Enterprise). It only has a <strong>Name</strong> and <strong>URL</strong> field &mdash; there is <strong>no header field</strong>. So the API key must travel <strong>inside the URL</strong> as a query string.</div></div>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">In Claude, go to <strong>Settings → Connectors</strong> (or <strong>Settings → Integrations</strong>) → <strong>Add custom connector</strong>.</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body"><strong>Name:</strong> <?php echo esc_html( $site_name ); ?> WordPress</div></div>
      <div class="wg-step"><div class="wg-step-num">3</div><div class="wg-step-body"><strong>Remote MCP server URL</strong> &mdash; paste this whole self-authenticating line (key is already embedded):</div></div>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">Remote MCP server URL (key in query string)</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)"></button>
<pre class="wg-code"><?php echo esc_html( $qs_url ); ?></pre>
    </div>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">4</div><div class="wg-step-body">Leave the <strong>OAuth Client ID / Secret</strong> fields (under Advanced) <strong>blank</strong>. Click <strong>Add</strong>.</div></div>
      <div class="wg-step"><div class="wg-step-num">5</div><div class="wg-step-body">The connector shows <strong>Disconnect</strong> and lists <strong><?php echo esc_html( count( WPXMCP_Tools::list_tools() ) ); ?> tools</strong> under Tool permissions. Keep destructive tools on <strong>"Needs approval."</strong></div></div>
    </div>
    <div class="wg-notice warn"><div class="wg-notice-icon">🔒</div><div>Query-string keys can appear in server access logs. Use a <code>readonly</code> or <code>editor</code> scoped key for the connector URL, and reserve <code>full</code> keys for header-based clients (Desktop config, API).</div></div>
    <div class="wg-notice info"><div class="wg-notice-icon">ℹ️</div><div><strong>Header alternative (Desktop config / mcp-remote):</strong> clients that <em>can</em> set headers may instead send the key as <code>X-WPXMCP-API-Key</code> or <code>Authorization: Bearer</code> against the plain endpoint <code><?php echo esc_html( $endpoint ); ?></code>.</div></div>
  </div>

  <div id="claude-api" class="wg-subpanel">
    <h3>Anthropic API — Direct Tool Calling (Python)</h3>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">Python — Full bridge with tool loop</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code"><span class="kw">import</span> anthropic, requests, json

MCP_URL = <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>
MCP_KEY = <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>
MCP_HDR = {<span class="str">"X-WPXMCP-API-Key"</span>: MCP_KEY, <span class="str">"Content-Type"</span>: <span class="str">"application/json"</span>}

<span class="cm"># 1. Fetch tool schemas from your WordPress MCP server</span>
<span class="kw">def</span> get_tools():
    r = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">1</span>,<span class="str">"method"</span>:<span class="str">"tools/list"</span>,<span class="str">"params"</span>:{}}, headers=MCP_HDR)
    <span class="kw">return</span> r.json()[<span class="str">"result"</span>][<span class="str">"tools"</span>]

<span class="cm"># 2. Execute a tool call on WordPress</span>
<span class="kw">def</span> call_tool(name, args):
    r = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">2</span>,<span class="str">"method"</span>:<span class="str">"tools/call"</span>,<span class="str">"params"</span>:{<span class="str">"name"</span>:name,<span class="str">"arguments"</span>:args}}, headers=MCP_HDR)
    content = r.json().get(<span class="str">"result"</span>,{}).get(<span class="str">"content"</span>,[{}])
    <span class="kw">return</span> content[<span class="num">0</span>].get(<span class="str">"text"</span>,<span class="str">""</span>) <span class="kw">if</span> content <span class="kw">else</span> <span class="str">""</span>

<span class="cm"># 3. Agentic loop with Claude</span>
client = anthropic.Anthropic()  <span class="cm"># uses ANTHROPIC_API_KEY env var</span>
tools  = get_tools()
messages = [{<span class="str">"role"</span>:<span class="str">"user"</span>,<span class="str">"content"</span>:<span class="str">"Run a broken link audit on the site and give me a report."</span>}]

<span class="kw">while</span> <span class="kw">True</span>:
    resp = client.messages.create(model=<span class="str">"claude-sonnet-4-6"</span>, max_tokens=<span class="num">4096</span>, tools=tools, messages=messages)
    messages.append({<span class="str">"role"</span>:<span class="str">"assistant"</span>,<span class="str">"content"</span>:resp.content})
    <span class="kw">if</span> resp.stop_reason != <span class="str">"tool_use"</span>: <span class="kw">break</span>
    results = []
    <span class="kw">for</span> b <span class="kw">in</span> resp.content:
        <span class="kw">if</span> b.type == <span class="str">"tool_use"</span>:
            result = call_tool(b.name, b.input)
            results.append({<span class="str">"type"</span>:<span class="str">"tool_result"</span>,<span class="str">"tool_use_id"</span>:b.id,<span class="str">"content"</span>:result})
    messages.append({<span class="str">"role"</span>:<span class="str">"user"</span>,<span class="str">"content"</span>:results})

print(next(b.text <span class="kw">for</span> b <span class="kw">in</span> resp.content <span class="kw">if</span> b.type==<span class="str">"text"</span>))</pre>
    </div>
  </div>

  <div id="claude-test" class="wg-subpanel">
    <div class="wg-tester">
      <h3>🔌 Live Connection Tester</h3>
      <div class="wg-tester-row">
        <input type="text" id="wg-test-key" value="<?php echo esc_attr( $first_key ); ?>" placeholder="API Key" />
        <button class="wg-tester-btn" onclick="wgRunTest()">Test Now</button>
      </div>
      <div class="wg-tester-result" id="wg-test-result">Click "Test Now" to check the connection from your server...</div>
    </div>
  </div>
</div>

<!-- ================================================================ -->
<!-- CHATGPT -->
<!-- ================================================================ -->
<div id="panel-chatgpt" class="wg-panel">
  <h2>ChatGPT <span class="wg-badge wg-badge-blue">Custom GPT + API</span></h2>
    <div class="wg-notice info"><div class="wg-notice-icon">🔗</div><div><strong>Two ways to authenticate:</strong> send the key as the <code>X-WPXMCP-API-Key</code> header (used in the code below), <em>or</em> &mdash; for any client that cannot set a header &mdash; put it in the URL: <code><?php echo esc_html( $qs_url ); ?></code>. ChatGPT Custom GPT Actions also support an API-Key auth header in the Action settings.</div></div>
  <p class="tagline">Use your WordPress site as a Custom GPT via Actions, or call the MCP endpoint directly via the OpenAI API.</p>

  <div class="wg-subtabs">
    <div class="wg-subtab active" onclick="wgSub('chatgpt','gpt',this)">Custom GPT</div>
    <div class="wg-subtab" onclick="wgSub('chatgpt','openapi',this)">OpenAPI Schema</div>
    <div class="wg-subtab" onclick="wgSub('chatgpt','oai-api',this)">OpenAI API (Python)</div>
    <div class="wg-subtab" onclick="wgSub('chatgpt','sysprompt',this)">System Prompt</div>
  </div>

  <div id="chatgpt-gpt" class="wg-subpanel active">
    <h3>ChatGPT Custom GPT — Step by Step</h3>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">Go to <a href="https://chat.openai.com/gpts/editor" target="_blank">chat.openai.com/gpts/editor</a> and click <strong>Create a GPT</strong>.</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body">Switch to the <strong>Configure</strong> tab. Set a name like <em>"<?php echo esc_html( $site_name ); ?> Manager"</em>.</div></div>
      <div class="wg-step"><div class="wg-step-num">3</div><div class="wg-step-body">Scroll to <strong>Actions</strong> → click <strong>Create new action</strong> → click <strong>Import from URL</strong>.</div></div>
      <div class="wg-step"><div class="wg-step-num">4</div><div class="wg-step-body">Click <strong>"Download OpenAPI Schema"</strong> below, save the file, then upload it in the Actions editor.</div></div>
      <div class="wg-step"><div class="wg-step-num">5</div><div class="wg-step-body">Under <strong>Authentication</strong>: choose <strong>API Key</strong>, key location = <strong>Header</strong>, header name = <code>X-WPXMCP-API-Key</code>, value = your key.</div></div>
      <div class="wg-step"><div class="wg-step-num">6</div><div class="wg-step-body">Paste the System Prompt (see System Prompt tab), then click <strong>Save</strong>.</div></div>
    </div>
    <br>
    <button class="wg-tester-btn" onclick="wgDownloadOpenAPI()">⬇️ Download OpenAPI Schema</button>
    <div class="wg-notice warn" style="margin-top:12px"><div class="wg-notice-icon">⚠️</div><div>ChatGPT Actions use HTTP POST to a URL like <code><?php echo esc_html( home_url( '/wp-json/' . WPXMCP_NAMESPACE . '/tools/{name}' ) ); ?></code> — the schema wraps each tool as a separate endpoint for GPT compatibility.</div></div>
  </div>

  <div id="chatgpt-openapi" class="wg-subpanel">
    <h3>OpenAPI 3.0 Schema — Preview &amp; Download</h3>
    <p style="font-size:13px;color:#555">This schema is auto-generated from your live tool registry. Use it with ChatGPT Custom GPTs, Cursor, Postman, or any OpenAPI-compatible client.</p>
    <button class="wg-tester-btn" onclick="wgDownloadOpenAPI()">⬇️ Download openapi.json</button>
    <div id="wg-openapi-preview" style="margin-top:12px;background:#0f1117;color:#e2e8f0;border-radius:8px;padding:16px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;">Click Download to generate and preview the schema...</div>
  </div>

  <div id="chatgpt-oai-api" class="wg-subpanel">
    <h3>OpenAI API — Python Bridge</h3>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code"><span class="kw">import</span> openai, requests, json

MCP_URL = <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>
MCP_KEY = <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>
MCP_HDR = {<span class="str">"X-WPXMCP-API-Key"</span>: MCP_KEY, <span class="str">"Content-Type"</span>: <span class="str">"application/json"</span>}

<span class="kw">def</span> mcp_tools():
    data = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">1</span>,<span class="str">"method"</span>:<span class="str">"tools/list"</span>,<span class="str">"params"</span>:{}}, headers=MCP_HDR).json()
    <span class="kw">return</span> [{<span class="str">"type"</span>:<span class="str">"function"</span>,<span class="str">"function"</span>:{<span class="str">"name"</span>:t[<span class="str">"name"</span>],<span class="str">"description"</span>:t[<span class="str">"description"</span>],<span class="str">"parameters"</span>:t[<span class="str">"inputSchema"</span>]}} <span class="kw">for</span> t <span class="kw">in</span> data[<span class="str">"result"</span>][<span class="str">"tools"</span>]]

<span class="kw">def</span> call_tool(name, args):
    r = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">2</span>,<span class="str">"method"</span>:<span class="str">"tools/call"</span>,<span class="str">"params"</span>:{<span class="str">"name"</span>:name,<span class="str">"arguments"</span>:args}}, headers=MCP_HDR)
    <span class="kw">return</span> r.json().get(<span class="str">"result"</span>,{}).get(<span class="str">"content"</span>,[{}])[<span class="num">0</span>].get(<span class="str">"text"</span>,<span class="str">""</span>)

client  = openai.OpenAI()  <span class="cm"># uses OPENAI_API_KEY env var</span>
tools   = mcp_tools()
msgs    = [{<span class="str">"role"</span>:<span class="str">"user"</span>,<span class="str">"content"</span>:<span class="str">"List my 5 most recent published posts"</span>}]

<span class="kw">while</span> <span class="kw">True</span>:
    resp = client.chat.completions.create(model=<span class="str">"gpt-4o"</span>, tools=tools, messages=msgs)
    msg  = resp.choices[<span class="num">0</span>].message
    msgs.append(msg)
    <span class="kw">if</span> msg.role != <span class="str">"tool_calls"</span> <span class="kw">and not</span> msg.tool_calls: <span class="kw">break</span>
    <span class="kw">for</span> tc <span class="kw">in</span> (msg.tool_calls <span class="kw">or</span> []):
        result = call_tool(tc.function.name, json.loads(tc.function.arguments))
        msgs.append({<span class="str">"role"</span>:<span class="str">"tool"</span>,<span class="str">"tool_call_id"</span>:tc.id,<span class="str">"content"</span>:result})

print(resp.choices[<span class="num">0</span>].message.content)</pre>
    </div>
  </div>

  <div id="chatgpt-sysprompt" class="wg-subpanel">
    <h3>Recommended System Prompt for ChatGPT GPT</h3>
    <p style="font-size:13px;color:#555;margin-bottom:12px">Copy this into the <strong>Instructions</strong> field of your Custom GPT. It gives ChatGPT the right mindset, rules, and output style for managing a WordPress site.</p>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">You are a powerful WordPress site manager for "<?php echo esc_js( $site_name ); ?>".
You have direct access to the live site via <?php echo esc_js( count( WPXMCP_Tools::list_tools() ) ); ?> tools covering:
posts, pages, media, menus, users, WooCommerce (products, orders, customers),
SEO meta, GEO/local schema, FAQ/AEO schema, custom CSS, site options,
database health &amp; repair, broken link auditing, image alt-tag management,
full file &amp; folder management (read, write, edit, delete, archive, chmod),
and direct SQL queries.

BEHAVIOUR:
- Be proactive: when asked to audit, run the relevant tools immediately and present findings.
- Always confirm before executing destructive actions (delete, force-delete, db_fix, fm_delete).
- For file edits (fm_write_file, fm_edit_file): always run fm_syntax_check first. If it fails, report the error and ask for correction before saving.
- For file operations: always pass confirm=true explicitly once the user approves.
- When fixing broken links, run fix_internal_link with dry_run=true first, show results, then ask to apply.
- Use fm_read_file to inspect code before editing. Never overwrite a file you haven't read.

OUTPUT FORMAT:
- Present lists, posts, products, and tool results as clean markdown tables.
- Keep responses concise — lead with data, not filler text.
- After destructive operations, confirm what was done and show the new state.
- When reporting audit results, show a summary first, then details on request.

SAFETY:
- Never execute multiple destructive operations in a single turn without explicit per-action confirmation.
- If a file syntax check fails, stop and report — do not force-save PHP/JS/CSS errors to a live site.
- For db_query with INSERT/UPDATE/DELETE, always state what the query will do before executing.</pre>
    </div>
  </div>
</div>

<!-- ================================================================ -->
<!-- GROK -->
<!-- ================================================================ -->
<div id="panel-grok" class="wg-panel">
  <h2>Grok (xAI) <span class="wg-badge wg-badge-amber">API Bridge Required</span></h2>
    <div class="wg-notice info"><div class="wg-notice-icon">🔗</div><div><strong>Two ways to authenticate:</strong> send the key as the <code>X-WPXMCP-API-Key</code> header (used in the code below), <em>or</em> &mdash; for any client that cannot set a header &mdash; put it in the URL: <code><?php echo esc_html( $qs_url ); ?></code>. Either works from the bridge code.</div></div>
  <p class="tagline">Grok uses the xAI API with OpenAI-compatible tool calling. Build a bridge that fetches tools from your WordPress MCP server.</p>

  <div class="wg-subtabs">
    <div class="wg-subtab active" onclick="wgSub('grok','node',this)">Node.js Bridge</div>
    <div class="wg-subtab" onclick="wgSub('grok','python',this)">Python Bridge</div>
    <div class="wg-subtab" onclick="wgSub('grok','curl',this)">Quick cURL Test</div>
    <div class="wg-subtab" onclick="wgSub('grok','usecase',this)">Use Cases</div>
  </div>

  <div id="grok-node" class="wg-subpanel active">
    <h3>Node.js — Full agentic loop with Grok 3</h3>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code"><span class="cm">// npm install openai node-fetch</span>
<span class="kw">import</span> OpenAI <span class="kw">from</span> <span class="str">"openai"</span>;

<span class="kw">const</span> MCP_URL = <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>;
<span class="kw">const</span> MCP_KEY = <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>;
<span class="kw">const</span> mcp = (method, params={}) =>
  fetch(MCP_URL, { method:<span class="str">"POST"</span>, headers:{<span class="str">"Content-Type"</span>:<span class="str">"application/json"</span>,<span class="str">"X-WPXMCP-API-Key"</span>:MCP_KEY},
    body: JSON.stringify({jsonrpc:<span class="str">"2.0"</span>,id:<span class="num">1</span>,method,params}) }).then(r=>r.json());

<span class="kw">const</span> xai = <span class="kw">new</span> OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL:<span class="str">"https://api.x.ai/v1"</span> });

<span class="cm">// 1. Load WordPress tools</span>
<span class="kw">const</span> { result:{ tools:mcpTools } } = <span class="kw">await</span> mcp(<span class="str">"tools/list"</span>);
<span class="kw">const</span> tools = mcpTools.map(t => ({ type:<span class="str">"function"</span>, function:{ name:t.name, description:t.description, parameters:t.inputSchema }}));

<span class="cm">// 2. Chat loop</span>
<span class="kw">const</span> messages = [{ role:<span class="str">"user"</span>, content:<span class="str">"Check my WordPress DB health and fix expired transients."</span> }];
<span class="kw">while</span> (<span class="kw">true</span>) {
  <span class="kw">const</span> resp = <span class="kw">await</span> xai.chat.completions.create({ model:<span class="str">"grok-3"</span>, tools, messages });
  <span class="kw">const</span> msg = resp.choices[<span class="num">0</span>].message;
  messages.push(msg);
  <span class="kw">if</span> (!msg.tool_calls?.length) { console.log(msg.content); <span class="kw">break</span>; }
  <span class="kw">for</span> (<span class="kw">const</span> tc <span class="kw">of</span> msg.tool_calls) {
    <span class="kw">const</span> { result } = <span class="kw">await</span> mcp(<span class="str">"tools/call"</span>, { name:tc.function.name, arguments:JSON.parse(tc.function.arguments) });
    messages.push({ role:<span class="str">"tool"</span>, tool_call_id:tc.id, content: result?.content?.[<span class="num">0</span>]?.text ?? <span class="str">""</span> });
  }
}</pre>
    </div>
  </div>

  <div id="grok-python" class="wg-subpanel">
    <h3>Python — Grok 3 bridge</h3>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code"><span class="cm"># pip install openai requests</span>
<span class="kw">from</span> openai <span class="kw">import</span> OpenAI
<span class="kw">import</span> requests, json, os

MCP_URL = <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>
MCP_KEY = <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>
H = {<span class="str">"X-WPXMCP-API-Key"</span>: MCP_KEY, <span class="str">"Content-Type"</span>: <span class="str">"application/json"</span>}

xai = OpenAI(api_key=os.environ[<span class="str">"XAI_API_KEY"</span>], base_url=<span class="str">"https://api.x.ai/v1"</span>)

tools_raw = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">1</span>,<span class="str">"method"</span>:<span class="str">"tools/list"</span>,<span class="str">"params"</span>:{}}, headers=H).json()[<span class="str">"result"</span>][<span class="str">"tools"</span>]
tools = [{<span class="str">"type"</span>:<span class="str">"function"</span>,<span class="str">"function"</span>:{<span class="str">"name"</span>:t[<span class="str">"name"</span>],<span class="str">"description"</span>:t[<span class="str">"description"</span>],<span class="str">"parameters"</span>:t[<span class="str">"inputSchema"</span>]}} <span class="kw">for</span> t <span class="kw">in</span> tools_raw]

msgs = [{<span class="str">"role"</span>:<span class="str">"user"</span>,<span class="str">"content"</span>:<span class="str">"Audit image alt tags and fix missing ones with AI-generated descriptions."</span>}]
<span class="kw">while True</span>:
    r = xai.chat.completions.create(model=<span class="str">"grok-3"</span>, tools=tools, messages=msgs)
    m = r.choices[<span class="num">0</span>].message; msgs.append(m)
    <span class="kw">if not</span> m.tool_calls: print(m.content); <span class="kw">break</span>
    <span class="kw">for</span> tc <span class="kw">in</span> m.tool_calls:
        res = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">2</span>,<span class="str">"method"</span>:<span class="str">"tools/call"</span>,<span class="str">"params"</span>:{<span class="str">"name"</span>:tc.function.name,<span class="str">"arguments"</span>:json.loads(tc.function.arguments)}}, headers=H).json()
        msgs.append({<span class="str">"role"</span>:<span class="str">"tool"</span>,<span class="str">"tool_call_id"</span>:tc.id,<span class="str">"content"</span>:res.get(<span class="str">"result"</span>,{}).get(<span class="str">"content"</span>,[{}])[<span class="num">0</span>].get(<span class="str">"text"</span>,<span class="str">""</span>)})</pre>
    </div>
  </div>

  <div id="grok-curl" class="wg-subpanel">
    <h3>Quick cURL — Direct MCP tool calls</h3>
    <p style="font-size:13px;color:#555;margin-bottom:12px">Test any tool directly from your terminal without a bridge. Great for debugging or scripting one-off tasks.</p>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">List all tools</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">curl -s -X POST "<?php echo esc_js( $endpoint ); ?>" \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: <?php echo esc_js( $first_key ); ?>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -m json.tool</pre>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">DB health check</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">curl -s -X POST "<?php echo esc_js( $endpoint ); ?>" \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: <?php echo esc_js( $first_key ); ?>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"db_health_check","arguments":{}}}'</pre>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">Browse a directory (File Manager)</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">curl -s -X POST "<?php echo esc_js( $endpoint ); ?>" \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: <?php echo esc_js( $first_key ); ?>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fm_list_directory","arguments":{"path":"wp-content/","show_hidden":false}}}'</pre>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">Read a file (e.g. wp-config.php)</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">curl -s -X POST "<?php echo esc_js( $endpoint ); ?>" \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: <?php echo esc_js( $first_key ); ?>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fm_read_file","arguments":{"path":"wp-config.php","start_line":1,"end_line":30}}}'</pre>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">List recent posts</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">curl -s -X POST "<?php echo esc_js( $endpoint ); ?>" \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: <?php echo esc_js( $first_key ); ?>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_posts","arguments":{"post_type":"post","status":"publish","per_page":5}}}'</pre>
    </div>
  </div>

  <div id="grok-usecase" class="wg-subpanel">
    <h3>Powerful Use Cases — Grok + WordPress</h3>
    <p style="font-size:13px;color:#555;margin-bottom:14px">Grok 3 has live X/Twitter data baked in — combine that with your WordPress tools for real-time social-aware site management.</p>
    <div class="wg-prompts">
      <div class="wg-prompt-card"><div class="pc-label">Trending Topics → Posts</div><div class="pc-text">Search X/Twitter for what's trending in [your niche] right now. Pick the top 3 topics and create a draft post for each on my WordPress site with an SEO-optimised title and meta description.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Viral Content Repurpose</div><div class="pc-text">Find the most viral post about [topic] on X in the last 48 hours. Rewrite it as a full 600-word blog post, create it as a draft on my WordPress site, and add a relevant category and tags.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Competitor Social Audit</div><div class="pc-text">Look up recent posts by [competitor handle] on X. Identify their most-engaged content themes. Then review my WordPress posts and suggest which topics I should write about to compete.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Breaking News Post</div><div class="pc-text">There's breaking news about [topic]. Search X for the latest verified information, write a 400-word breaking news post, publish it immediately on my WordPress site, and generate a meta description.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Site Health + Commentary</div><div class="pc-text">Run a full DB health check and broken link audit on my site. Then search X to see if anyone is mentioning my site URL with complaints. Summarise both findings in a single report.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">WooCommerce Trend Pricing</div><div class="pc-text">Search X and the web for the current hype/demand around [product type]. Based on the sentiment, suggest whether I should raise or lower prices for my WooCommerce products in that category, then make the changes.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
    </div>
  </div>
</div>

<!-- ================================================================ -->
<!-- PERPLEXITY -->
<!-- ================================================================ -->
<div id="panel-perplexity" class="wg-panel">
  <h2>Perplexity <span class="wg-badge wg-badge-purple">API + Function Calling</span></h2>
    <div class="wg-notice info"><div class="wg-notice-icon">🔗</div><div><strong>Two ways to authenticate:</strong> send the key as the <code>X-WPXMCP-API-Key</code> header (used in the code below), <em>or</em> &mdash; for any client that cannot set a header &mdash; put it in the URL: <code><?php echo esc_html( $qs_url ); ?></code>. Either works from the bridge code.</div></div>
  <p class="tagline">Combine Perplexity's real-time web search with live WordPress site control via function calling.</p>

  <div class="wg-notice info"><div class="wg-notice-icon">ℹ️</div><div>Perplexity uses an <strong>OpenAI-compatible API</strong>. The bridge code is nearly identical to ChatGPT — just swap the base URL and model name.</div></div>

  <div class="wg-subtabs">
    <div class="wg-subtab active" onclick="wgSub('perplexity','py',this)">Python</div>
    <div class="wg-subtab" onclick="wgSub('perplexity','node',this)">Node.js</div>
    <div class="wg-subtab" onclick="wgSub('perplexity','usecase',this)">Use Cases</div>
  </div>

  <div id="perplexity-py" class="wg-subpanel active">
    <h3>Python — Perplexity Sonar + WordPress tools</h3>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code"><span class="cm"># pip install openai requests</span>
<span class="kw">from</span> openai <span class="kw">import</span> OpenAI
<span class="kw">import</span> requests, json, os

MCP_URL = <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>
MCP_KEY = <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>
H = {<span class="str">"X-WPXMCP-API-Key"</span>: MCP_KEY, <span class="str">"Content-Type"</span>: <span class="str">"application/json"</span>}

pplx = OpenAI(api_key=os.environ[<span class="str">"PERPLEXITY_API_KEY"</span>], base_url=<span class="str">"https://api.perplexity.ai"</span>)

<span class="cm"># Fetch WordPress tools</span>
wp_tools_raw = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">1</span>,<span class="str">"method"</span>:<span class="str">"tools/list"</span>,<span class="str">"params"</span>:{}}, headers=H).json()[<span class="str">"result"</span>][<span class="str">"tools"</span>]
tools = [{<span class="str">"type"</span>:<span class="str">"function"</span>,<span class="str">"function"</span>:{<span class="str">"name"</span>:t[<span class="str">"name"</span>],<span class="str">"description"</span>:t[<span class="str">"description"</span>],<span class="str">"parameters"</span>:t[<span class="str">"inputSchema"</span>]}} <span class="kw">for</span> t <span class="kw">in</span> wp_tools_raw]

<span class="cm"># Use Perplexity Sonar with WordPress tools</span>
msgs = [{<span class="str">"role"</span>:<span class="str">"user"</span>,<span class="str">"content"</span>:<span class="str">"Search the web for the latest WordPress SEO tips, then update my site's meta settings accordingly."</span>}]
<span class="kw">while True</span>:
    r = pplx.chat.completions.create(model=<span class="str">"sonar-pro"</span>, tools=tools, messages=msgs)
    m = r.choices[<span class="num">0</span>].message; msgs.append(m)
    <span class="kw">if not</span> getattr(m,<span class="str">"tool_calls"</span>,<span class="kw">None</span>): print(m.content); <span class="kw">break</span>
    <span class="kw">for</span> tc <span class="kw">in</span> m.tool_calls:
        res = requests.post(MCP_URL, json={<span class="str">"jsonrpc"</span>:<span class="str">"2.0"</span>,<span class="str">"id"</span>:<span class="num">2</span>,<span class="str">"method"</span>:<span class="str">"tools/call"</span>,<span class="str">"params"</span>:{<span class="str">"name"</span>:tc.function.name,<span class="str">"arguments"</span>:json.loads(tc.function.arguments)}}, headers=H).json()
        msgs.append({<span class="str">"role"</span>:<span class="str">"tool"</span>,<span class="str">"tool_call_id"</span>:tc.id,<span class="str">"content"</span>:res.get(<span class="str">"result"</span>,{}).get(<span class="str">"content"</span>,[{}])[<span class="num">0</span>].get(<span class="str">"text"</span>,<span class="str">""</span>)})</pre>
    </div>
  </div>

  <div id="perplexity-node" class="wg-subpanel">
    <h3>Node.js bridge</h3>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code"><span class="kw">import</span> OpenAI <span class="kw">from</span> <span class="str">"openai"</span>;

<span class="kw">const</span> MCP_URL = <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>;
<span class="kw">const</span> MCP_KEY = <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>;
<span class="kw">const</span> pplx = <span class="kw">new</span> OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: <span class="str">"https://api.perplexity.ai"</span> });
<span class="kw">const</span> mcp = (m,p={}) => fetch(MCP_URL,{method:<span class="str">"POST"</span>,headers:{<span class="str">"Content-Type"</span>:<span class="str">"application/json"</span>,<span class="str">"X-WPXMCP-API-Key"</span>:MCP_KEY},body:JSON.stringify({jsonrpc:<span class="str">"2.0"</span>,id:<span class="num">1</span>,method:m,params:p})}).then(r=>r.json());

<span class="kw">const</span> {result:{tools:t}} = <span class="kw">await</span> mcp(<span class="str">"tools/list"</span>);
<span class="kw">const</span> tools = t.map(x=>({type:<span class="str">"function"</span>,function:{name:x.name,description:x.description,parameters:x.inputSchema}}));
<span class="kw">const</span> msgs = [{role:<span class="str">"user"</span>,content:<span class="str">"Audit my site and give a full health report."</span>}];

<span class="kw">while</span>(<span class="kw">true</span>){
  <span class="kw">const</span> r = <span class="kw">await</span> pplx.chat.completions.create({model:<span class="str">"sonar-pro"</span>,tools,messages:msgs});
  <span class="kw">const</span> m = r.choices[<span class="num">0</span>].message; msgs.push(m);
  <span class="kw">if</span>(!m.tool_calls?.length){console.log(m.content);<span class="kw">break</span>;}
  <span class="kw">for</span>(<span class="kw">const</span> tc <span class="kw">of</span> m.tool_calls){
    <span class="kw">const</span> res = <span class="kw">await</span> mcp(<span class="str">"tools/call"</span>,{name:tc.function.name,arguments:JSON.parse(tc.function.arguments)});
    msgs.push({role:<span class="str">"tool"</span>,tool_call_id:tc.id,content:res?.result?.content?.[<span class="num">0</span>]?.text??<span class="str">""</span>});
  }
}</pre>
    </div>
  </div>

  <div id="perplexity-usecase" class="wg-subpanel">
    <h3>Powerful Use Cases — Perplexity + WordPress</h3>
    <p style="font-size:13px;color:#555;margin-bottom:14px">Perplexity's live web search + your WordPress tools = an AI that researches and acts in one shot. Use these prompts in any Perplexity-connected interface.</p>
    <div class="wg-prompts">
      <div class="wg-prompt-card"><div class="pc-label">SEO + Live Data</div><div class="pc-text">Search the web for the top 10 trending keywords in [your niche] right now. Then create 3 draft blog posts targeting those keywords — complete with title, meta description, and 500-word outline — directly on my WordPress site.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Competitive Gap Analysis</div><div class="pc-text">Search the web for the last 10 articles published by [competitor URL]. Then list my own posts and identify which topics they're covering that I'm not. Create a draft post for the biggest gap.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">News → Scheduled Post</div><div class="pc-text">Find today's top 5 news stories in [your industry]. Write a 400-word commentary/roundup post, create it as a draft on my WordPress site, and schedule it to publish tomorrow at 9am.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">WooCommerce Price Research</div><div class="pc-text">Search for the current market prices of [product category] from 5 competing stores. Then update my WooCommerce product descriptions and adjust pricing to stay competitive. Show me a before/after comparison.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Trend-Based Content Sprint</div><div class="pc-text">Look up what topics are trending on Reddit and Google Trends in [niche] this week. Then generate 5 post titles optimised for those trends and create them all as drafts on my site with SEO meta descriptions.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Live Fact-Check & Update</div><div class="pc-text">Read my post with ID [X]. Search the web to verify every statistic and claim in it. List any outdated facts, then update the post content with accurate, sourced figures and add a "Last updated" note.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Algorithm Update Response</div><div class="pc-text">Search for the most recent Google algorithm update details. Then audit my last 20 published posts and tell me which ones are most at risk based on the update's focus areas. Suggest specific changes.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Real-Time FAQ Builder</div><div class="pc-text">Search Google's "People Also Ask" for [your main keyword]. Pull the top 8 questions being asked. Then update my FAQ schema on the relevant WordPress post to include those questions with accurate, current answers.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
    </div>
  </div>
</div>

<!-- ================================================================ -->
<!-- CURSOR / VS CODE -->
<!-- ================================================================ -->
<div id="panel-cursor" class="wg-panel">
  <h2>Cursor &amp; VS Code <span class="wg-badge wg-badge-blue">MCP Native</span></h2>
    <div class="wg-notice info"><div class="wg-notice-icon">🔗</div><div><strong>Two ways to authenticate:</strong> send the key as the <code>X-WPXMCP-API-Key</code> header (used in the code below), <em>or</em> &mdash; for any client that cannot set a header &mdash; put it in the URL: <code><?php echo esc_html( $qs_url ); ?></code>. Cursor/Continue MCP configs accept a headers block, so the header form is preferred there.</div></div>
  <p class="tagline">Use your WordPress site as a data source directly inside your code editor. Great for developers building themes, plugins, or custom integrations.</p>

  <div class="wg-subtabs">
    <div class="wg-subtab active" onclick="wgSub('cursor','cursor-cfg',this)">Cursor Setup</div>
    <div class="wg-subtab" onclick="wgSub('cursor','vscode',this)">VS Code / Continue.dev</div>
    <div class="wg-subtab" onclick="wgSub('cursor','devprompts',this)">Dev Prompts</div>
  </div>

  <div id="cursor-cursor-cfg" class="wg-subpanel active">
    <h3>Cursor — MCP Config</h3>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">Open Cursor → <strong>Settings → Cursor Settings → MCP</strong> (or press <code>Cmd+Shift+P</code> → "Open MCP Config").</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body">Add or merge this config into <code>~/.cursor/mcp.json</code>:</div></div>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">~/.cursor/mcp.json</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">{
  <span class="key">"mcpServers"</span>: {
    <span class="key">"wordpress"</span>: {
      <span class="key">"url"</span>: <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>,
      <span class="key">"headers"</span>: {
        <span class="key">"X-WPXMCP-API-Key"</span>: <span class="str">"<?php echo esc_js( $first_key ); ?>"</span>
      }
    }
  }
}</pre>
    </div>
    <div class="wg-step"><div class="wg-step-num">3</div><div class="wg-step-body">Restart Cursor. In any chat, you can now reference WordPress tools by typing <code>@wordpress</code> or just asking naturally.</div></div>
  </div>

  <div id="cursor-vscode" class="wg-subpanel">
    <h3>VS Code — Continue.dev Extension</h3>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">Install the <a href="https://marketplace.visualstudio.com/items?itemName=Continue.continue" target="_blank"><strong>Continue</strong></a> extension from the VS Code marketplace.</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body">Open <code>~/.continue/config.json</code> and add under <code>mcpServers</code>:</div></div>
    </div>
    <div class="wg-pre-wrap">
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">{
  <span class="key">"mcpServers"</span>: [
    {
      <span class="key">"name"</span>: <span class="str">"wordpress"</span>,
      <span class="key">"transport"</span>: {
        <span class="key">"type"</span>: <span class="str">"http"</span>,
        <span class="key">"url"</span>: <span class="str">"<?php echo esc_js( $endpoint ); ?>"</span>,
        <span class="key">"headers"</span>: { <span class="key">"X-WPXMCP-API-Key"</span>: <span class="str">"<?php echo esc_js( $first_key ); ?>"</span> }
      }
    }
  ]
}</pre>
    </div>
  </div>

  <div id="cursor-devprompts" class="wg-subpanel">
    <h3>Developer-Focused Prompts</h3>
    <div class="wg-prompts">
      <div class="wg-prompt-card"><div class="pc-label">Theme Debug</div><div class="pc-text">Get my active theme name and version, read functions.php, and check the custom CSS for syntax issues or obviously unused selectors. Report findings.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Plugin Audit</div><div class="pc-text">List all active plugins with their versions. Flag any that haven't been updated in 6+ months, highlight those with known security advisories, and suggest lightweight alternatives.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">DB Query</div><div class="pc-text">Run a SELECT on wp_options to find all autoloaded options larger than 50KB. Show the option name and size. Then suggest which are safe to disable autoloading on.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">CRUD Smoke Test</div><div class="pc-text">Create a test post with title "MCP Smoke Test", update it with a custom meta field "test_key=passed", fetch it back to verify the meta, then trash and force-delete it. Show each step's result.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Read & Patch File</div><div class="pc-text">Read wp-content/themes/[theme]/functions.php. Find the function named [function_name]. Run a syntax check on the entire file first. Then replace only that function with the version I'm about to paste.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Plugin Scaffold</div><div class="pc-text">Create a new plugin scaffold at wp-content/plugins/my-feature-plugin/. Include: main PHP file with proper header, an includes/ folder, a class file with __construct and init() stub, and a readme.txt.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Debug Log Triage</div><div class="pc-text">Read the last 150 lines of wp-content/debug.log. Group errors by type and frequency. Identify the top 3 recurring issues and suggest what PHP/plugin code is likely responsible.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
      <div class="wg-prompt-card"><div class="pc-label">Pre-Deploy Checklist</div><div class="pc-text">Before I deploy: check WP_DEBUG is off in wp-config.php, verify .htaccess has correct permalink rules, confirm no plugins are deactivated that should be active, and run a DB health check.</div><button class="pc-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('.pc-text').innerText)">Copy</button></div>
    </div>
  </div>
</div>

<!-- ================================================================ -->
<!-- n8n / ZAPIER -->
<!-- ================================================================ -->
<div id="panel-automation" class="wg-panel">
  <h2>Automation — n8n, Zapier &amp; Make <span class="wg-badge wg-badge-green">No-Code</span></h2>
    <div class="wg-notice info"><div class="wg-notice-icon">🔗</div><div><strong>Two ways to authenticate:</strong> send the key as the <code>X-WPXMCP-API-Key</code> header (used in the code below), <em>or</em> &mdash; for any client that cannot set a header &mdash; put it in the URL: <code><?php echo esc_html( $qs_url ); ?></code>. In no-code tools the URL-key form is usually the quickest &mdash; no header config needed.</div></div>
  <p class="tagline">Automate WordPress workflows without writing any code. Trigger actions on schedule, on webhooks, or based on external events.</p>

  <div class="wg-subtabs">
    <div class="wg-subtab active" onclick="wgSub('automation','n8n',this)">n8n</div>
    <div class="wg-subtab" onclick="wgSub('automation','zapier',this)">Zapier / Make</div>
    <div class="wg-subtab" onclick="wgSub('automation','workflows',this)">Sample Workflows</div>
  </div>

  <div id="automation-n8n" class="wg-subpanel active">
    <h3>n8n — HTTP Request Node Setup</h3>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">In your n8n workflow, add an <strong>HTTP Request</strong> node.</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body">Set <strong>Method</strong> = POST, <strong>URL</strong> = <code><?php echo esc_html( $endpoint ); ?></code></div></div>
      <div class="wg-step"><div class="wg-step-num">3</div><div class="wg-step-body">Under <strong>Headers</strong>, add: <code>X-WPXMCP-API-Key</code> = <code><?php echo esc_html( $first_key ); ?></code></div></div>
      <div class="wg-step"><div class="wg-step-num">4</div><div class="wg-step-body">Set <strong>Body Type</strong> = JSON, paste the body below:</div></div>
    </div>
    <div class="wg-pre-wrap">
      <div class="wg-pre-label">n8n — List Posts Body</div>
      <button class="wg-copy-btn" onclick="wgCopyPre(this)">Copy</button>
<pre class="wg-code">{
  <span class="key">"jsonrpc"</span>: <span class="str">"2.0"</span>,
  <span class="key">"id"</span>: <span class="num">1</span>,
  <span class="key">"method"</span>: <span class="str">"tools/call"</span>,
  <span class="key">"params"</span>: {
    <span class="key">"name"</span>: <span class="str">"list_posts"</span>,
    <span class="key">"arguments"</span>: { <span class="key">"post_type"</span>: <span class="str">"post"</span>, <span class="key">"status"</span>: <span class="str">"publish"</span>, <span class="key">"per_page"</span>: <span class="num">10</span> }
  }
}</pre>
    </div>
    <div class="wg-notice success"><div class="wg-notice-icon">✅</div><div>n8n also has a native <strong>AI Agent node</strong> — connect it to your MCP endpoint as a custom tool to enable full agentic WordPress automation inside n8n workflows.</div></div>
  </div>

  <div id="automation-zapier" class="wg-subpanel">
    <h3>Zapier / Make — Webhook Setup</h3>
    <div class="wg-steps">
      <div class="wg-step"><div class="wg-step-num">1</div><div class="wg-step-body">In Zapier: add a <strong>Webhooks by Zapier</strong> action → choose <strong>POST</strong>.</div></div>
      <div class="wg-step"><div class="wg-step-num">2</div><div class="wg-step-body">In Make (Integromat): add an <strong>HTTP → Make a Request</strong> module.</div></div>
      <div class="wg-step"><div class="wg-step-num">3</div><div class="wg-step-body">Configure:<br>
        • <strong>URL:</strong> <code><?php echo esc_html( $endpoint ); ?></code><br>
        • <strong>Method:</strong> POST<br>
        • <strong>Headers:</strong> <code>X-WPXMCP-API-Key: <?php echo esc_html( $first_key ); ?></code><br>
        • <strong>Content-Type:</strong> <code>application/json</code>
      </div></div>
      <div class="wg-step"><div class="wg-step-num">4</div><div class="wg-step-body">Use the JSON body format from the n8n tab — same API, same format.</div></div>
    </div>
  </div>

  <div id="automation-workflows" class="wg-subpanel">
    <h3>Sample Automation Workflows</h3>
    <p style="font-size:13px;color:#555;margin-bottom:14px">Drop these into n8n, Zapier, or Make as a starting point. Each maps to real MCP tool calls you can wire up in minutes.</p>
    <div class="wg-workflow-cards">
      <div class="wg-wf-card"><h4>⏰ Daily DB Health Monitor</h4><p>Schedule: every day at 3 AM → call <code>db_health_check</code> → if score &lt; 70, call <code>db_fix</code> (safe mode) → send Slack/email with before/after counts and current score.</p></div>
      <div class="wg-wf-card"><h4>🔗 Weekly Broken Link Report</h4><p>Every Monday 8 AM → call <code>audit_links</code> → filter for broken entries → format as HTML table → send via email to site admin. Include post title, broken URL, and HTTP status.</p></div>
      <div class="wg-wf-card"><h4>📸 Auto Alt-Text on Upload</h4><p>Trigger: new media upload webhook → call <code>audit_image_alts</code> for the new attachment → if alt missing, send title+URL to an AI node → call <code>fix_image_alt</code> with the generated text.</p></div>
      <div class="wg-wf-card"><h4>🛒 Airtable → WooCommerce Sync</h4><p>Trigger: Airtable row updated → map fields to WooCommerce product fields → call <code>update_product</code> with new price/stock/description → log the result back to Airtable.</p></div>
      <div class="wg-wf-card"><h4>📦 Pre-Update Plugin Backup</h4><p>Daily: call <code>list_plugins</code> to check for updates → if any found, call <code>fm_create_archive</code> on wp-content/plugins/ → save to wp-content/backups/ → then notify admin with update list.</p></div>
      <div class="wg-wf-card"><h4>🔐 Security File Watch</h4><p>Hourly: call <code>fm_get_file_info</code> on wp-config.php and .htaccess → compare permissions to baseline → if changed, send an immediate alert via Slack/email with old vs new permissions.</p></div>
      <div class="wg-wf-card"><h4>✍️ Auto Content Pipeline</h4><p>Trigger: Google Sheet row added with topic → send topic to AI node → generate title + outline → call <code>create_post</code> as draft → call <code>generate_meta_description</code> → update post meta → notify editor via Slack.</p></div>
      <div class="wg-wf-card"><h4>📋 Monthly Site Report</h4><p>1st of every month → call <code>db_health_check</code>, <code>audit_links</code>, <code>audit_image_alts</code>, <code>list_posts</code> → compile results into a formatted PDF/email → send to client or stakeholder list.</p></div>
      <div class="wg-wf-card"><h4>🚨 WooCommerce Low-Stock Alert</h4><p>Every 6 hours → call <code>list_products</code> with stock filter → find products with stock &lt; 5 → send Slack alert with product name, SKU, and current stock count.</p></div>
      <div class="wg-wf-card"><h4>🗂️ Auto Archive Old Uploads</h4><p>Weekly: call <code>fm_list_directory</code> on wp-content/uploads/[year-1]/ → call <code>fm_create_archive</code> to zip the folder → move zip to cold storage path → call <code>fm_delete</code> on original folder (with confirm).</p></div>
    </div>
  </div>
</div>

<!-- ================================================================ -->
<!-- PROMPT LIBRARY -->
<!-- ================================================================ -->
<div id="panel-prompts" class="wg-panel">
  <h2>Prompt Library</h2>
  <p class="tagline">Ready-to-use prompts for every major WordPress management task. Click any card to copy.</p>

  <h3>🩺 Audit & Health</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Full Site Audit</div><div class="pc-text">Run a complete site audit: check database health, scan for broken links (internal and external), find images with missing alt text, and give me a prioritised action plan.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">DB Fix (Safe)</div><div class="pc-text">Check my database health score. If there are issues, fix only the safe ones: expired transients, orphaned post meta, and optimize tables. Show me before/after counts.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Broken Links Report</div><div class="pc-text">Scan all published posts and pages for broken links. Show me a table with: post title, broken URL, HTTP status, and whether it's internal or external.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Alt Text Audit</div><div class="pc-text">Find all images in my media library and post content that are missing alt text. Group them by post and tell me how many need fixing.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>✍️ Content & SEO</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Content Review</div><div class="pc-text">List my 10 most recently modified posts. For each one, check if it has a meta description and featured image. Tell me which ones need work.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Bulk Draft → Review</div><div class="pc-text">Show me all posts in draft status. Group them by how old they are. For posts older than 30 days, suggest whether to publish, update, or delete.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">SEO Meta Check</div><div class="pc-text">Get my last 20 published posts and check which ones are missing a Yoast/RankMath SEO title or description meta. List them so I can fix them.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Internal Linking</div><div class="pc-text">Look at my recent posts. Find opportunities where I should add internal links between related posts. Give me specific link text and target URL suggestions.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>🛒 WooCommerce</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Order Summary</div><div class="pc-text">Show me a summary of WooCommerce orders from the last 7 days: total revenue, number of orders, average order value, and top-selling product.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Low Stock Alert</div><div class="pc-text">List all WooCommerce products with stock quantity below 5. Sort by quantity ascending. Include product ID, name, price, and SKU.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Product Image Check</div><div class="pc-text">Find WooCommerce products that are published but have no featured image set. List them with their IDs so I can add images.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Customer Lookup</div><div class="pc-text">Look up the 5 most recent customers. For each one show their name, email, total spent, and number of orders.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>⚙️ Site Management</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Plugin Overview</div><div class="pc-text">List all active plugins with their names and versions. Flag any that are outdated and note which ones have the highest potential security risk.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Site Health Report</div><div class="pc-text">Generate a comprehensive site health report covering: WordPress version, PHP version, active plugins, theme, DB health score, and table sizes.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Cache & Performance</div><div class="pc-text">Check the autoloaded options size. If it's over 800KB, list the top 10 largest autoloaded options so I can decide which to disable autoloading on.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">User Audit</div><div class="pc-text">List all WordPress users with Administrator role. Show their username, email, and last login date. Flag any accounts that haven't logged in for 90+ days.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Plugin Conflict Check</div><div class="pc-text">List all active plugins. Group them by category (caching, SEO, page builder, security, WooCommerce). Flag any known plugin pairs that commonly conflict with each other.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Theme Customization Snapshot</div><div class="pc-text">Show me my current theme name, all saved theme mods (Customizer settings), and the contents of the Additional CSS editor. I want a full snapshot before making changes.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>📁 Files & Folders</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Browse wp-content</div><div class="pc-text">List the contents of my wp-content directory. Show folders and files with their sizes, permissions, and last-modified dates. Flag anything with suspicious write permissions (world-writable).</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Malware File Scan</div><div class="pc-text">Search my WordPress root and wp-content for PHP files containing any of these patterns: eval(base64_decode, exec(, shell_exec(, system(, passthru(. List every match with the file path and matching line.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Read & Review File</div><div class="pc-text">Read the file at wp-content/themes/[your-theme]/functions.php and give me a summary of what it does. List any hooks, filters, and custom functions defined in it.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Edit functions.php Safely</div><div class="pc-text">I want to add this code snippet to my active theme's functions.php: [paste your snippet]. First read the current file, run a syntax check on the combined result, and only save it if the check passes.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Backup Plugin Folder</div><div class="pc-text">Create a ZIP archive of my wp-content/plugins/[plugin-name] folder and save it to wp-content/backups/[plugin-name]-backup-[today's date].zip. Confirm the archive size when done.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Extract & Deploy</div><div class="pc-text">Extract the archive at wp-content/uploads/my-theme.zip into wp-content/themes/. Then list the contents of the extracted folder to confirm everything is in place.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Fix File Permissions</div><div class="pc-text">Check the permissions of my wp-config.php and .htaccess files. If they are not 0644 or stricter, fix them. Also check that my wp-content/uploads folder is 0755.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Find Large Files</div><div class="pc-text">Search wp-content/uploads for files larger than 5 MB. List them with their full paths, sizes, and last-modified dates so I can decide which to compress or delete.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Orphaned Upload Cleanup</div><div class="pc-text">List the 20 oldest files in wp-content/uploads. Cross-reference them against the media library. Tell me which ones have no corresponding attachment record so I can safely delete them.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Code Search Across Files</div><div class="pc-text">Search all PHP files inside wp-content/plugins for any that reference the string "your-api-key" or "API_KEY". List the matching files and the lines they appear on.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>🔐 Security</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">wp-config.php Audit</div><div class="pc-text">Read my wp-config.php file. Check that debug mode is off, that the database prefix is not "wp_", that secret keys are set, and that DISALLOW_FILE_EDIT is enabled. Report any issues.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">.htaccess Review</div><div class="pc-text">Read my root .htaccess file and tell me what rules it contains. Flag any rules that look insecure or that could be causing redirect loops. Show me the raw contents.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Admin User Cleanup</div><div class="pc-text">List all users with the Administrator role. For any that have a username of "admin" or "administrator", tell me so I can rename them. Also show accounts with no recent login.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Suspicious Options Check</div><div class="pc-text">Check these WordPress options for unexpected values: siteurl, home, admin_email, blogname, default_role, users_can_register. Show me their current values so I can spot any tampering.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>🧑‍💻 Developer & Code</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Syntax Check Before Save</div><div class="pc-text">Before saving any PHP file, run a syntax check on the new code and show me the result. If there are errors, do not save the file — show me the error and ask me to fix it first.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Child Theme Setup</div><div class="pc-text">Create a child theme for my active theme. Create the folder wp-content/themes/[parent-theme]-child/, write a valid style.css with the correct Template header, and create a functions.php that enqueues the parent stylesheet.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Custom Plugin Scaffold</div><div class="pc-text">Create a minimal WordPress plugin scaffold. Create the folder wp-content/plugins/my-custom-plugin/ with a main PHP file that has the correct plugin header, a readme.txt, and an includes/ subfolder with a placeholder class file.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Debug Log Review</div><div class="pc-text">Read the last 100 lines of wp-content/debug.log. Summarise the errors by type, tell me which errors appear most frequently, and suggest what might be causing the top 3 issues.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Option Cleanup</div><div class="pc-text">Run this SQL query to find orphaned plugin options: SELECT option_name FROM wp_options WHERE option_name LIKE '%deactivated_plugin%' OR autoload='yes' ORDER BY LENGTH(option_value) DESC LIMIT 20. Show the results.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Cron Jobs Overview</div><div class="pc-text">Run a SQL query to show all scheduled WP-Cron events from the cron option. List event hook names, next run timestamps, and recurrence intervals. Flag any events that are overdue by more than 1 hour.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>📦 Backup & Migration</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Pre-Update Backup</div><div class="pc-text">Before I update any plugins, archive my entire wp-content/plugins folder to wp-content/backups/plugins-backup-[date].zip. Then list all plugins with available updates and ask me which ones to update.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Theme Backup</div><div class="pc-text">Create a ZIP of my active theme folder and save it to wp-content/backups/theme-[theme-name]-[date].zip. Confirm the file was created and show me its size.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Export Site Settings</div><div class="pc-text">Export all key site settings to a summary: site URL, title, tagline, timezone, date format, default category, comments settings, and permalink structure. Save the summary as a text file in wp-content/backups/.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Migrate Custom CSS</div><div class="pc-text">Read the Additional CSS from my current Customizer. Save a backup copy to wp-content/backups/custom-css-[date].css. Then show me the full CSS so I can review it before any theme switch.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

  <h3>📊 Analytics & Reporting</h3>
  <div class="wg-prompts">
    <div class="wg-prompt-card"><div class="pc-label">Content Calendar</div><div class="pc-text">List all posts scheduled for the next 30 days. Show post title, scheduled date, author, and categories. If there are gaps of more than 7 days, flag them so I can fill in the content calendar.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Top Authors Report</div><div class="pc-text">Count the number of published posts per author. List authors ranked by post count. Include their display name, email, and total published posts. Flag anyone who has published nothing in the last 90 days.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Media Library Stats</div><div class="pc-text">Give me a breakdown of my media library: total attachment count, count by file type (images, PDFs, videos), total size if available, and the 5 most recently uploaded items.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
    <div class="wg-prompt-card"><div class="pc-label">Monthly WooCommerce Report</div><div class="pc-text">Pull WooCommerce orders from the past 30 days. Give me: total revenue, number of orders, average order value, refund total, and the top 5 products by quantity sold.</div><button class="pc-copy" onclick="wgCopyPrompt(this)">Copy</button></div>
  </div>

</div>

<!-- ================================================================ -->
<!-- TOOLS REFERENCE -->
<!-- ================================================================ -->
<div id="panel-tools" class="wg-panel">
  <h2>Tools — <?php echo count( WPXMCP_Tools::list_tools() ); ?> Tools Available</h2>
  <p class="tagline">Complete list of MCP tools. All accessible via <code>tools/call</code> with the appropriate key scope.</p>

  <div class="wg-tool-filter">
    <input type="text" id="wg-tool-search" placeholder="Search tools..." oninput="wgFilterTools()" />
    <button class="filter-btn active" id="wg-filter-all"  onclick="wgSetFilter('all',this)">All</button>
    <button class="filter-btn" id="wg-filter-read"        onclick="wgSetFilter('read',this)">🟢 Read</button>
    <button class="filter-btn" id="wg-filter-write"       onclick="wgSetFilter('write',this)">🔵 Write</button>
    <button class="filter-btn" id="wg-filter-destructive" onclick="wgSetFilter('destructive',this)">🔴 Destructive</button>
  </div>

  <table class="wg-tools-table" id="wg-tools-table">
    <thead><tr><th>Tool</th><th>Description</th><th>Risk</th><th>Required Params</th></tr></thead>
    <tbody>
    <?php
    $all_tools = WPXMCP_Tools::list_tools();
    // Group them
    $groups = array(
        'Site & Diagnostics' => array('site_info','flush_cache','get_option','update_option','delete_option','get_post_meta','update_post_meta'),
        'Posts & Pages'      => array('list_posts','get_post','create_post','update_post','delete_post'),
        'Taxonomy & Media'   => array('list_terms','get_term','create_term','delete_term','list_media','upload_media','delete_media'),
        'Menus & Users'      => array('list_menus','get_menu','update_menu','list_users','get_user','create_user','update_user','delete_user'),
        'Themes & Plugins'   => array('list_themes','activate_theme','get_custom_css','update_custom_css','list_plugins','activate_plugin','deactivate_plugin','delete_plugin','search_wp_plugin','search_wp_theme','install_wp_plugin','install_wp_theme','toggle_plugin_auto_update','toggle_theme_auto_update','rollback_plugin','bulk_activate_plugins','bulk_deactivate_plugins'),
        'WP-Cron'            => array('list_cron_jobs','run_cron_event','delete_cron_event'),
        'Database'           => array('db_query','db_health_check','db_fix','db_table_sizes'),
        'Audit'              => array('audit_links','fix_internal_link','audit_image_alts','fix_image_alt'),
        'WooCommerce'        => array('wc_list_products','wc_get_product','wc_create_product','wc_update_product','wc_delete_product','wc_list_orders','wc_get_order','wc_update_order','wc_list_customers','wc_get_customer'),
        'SEO / GEO / AEO'   => array('seo_get_meta','seo_update_meta','seo_bulk_audit','geo_get_schema','geo_update_schema','aeo_get_faq','aeo_update_faq','ai_seo_title_generator','ai_meta_description_generator','broken_link_checker','image_alt_bulk_updater','redirect_manager','sitemap_regenerator','keyword_density_analyzer','featured_snippet_optimizer','entity_density_checker','content_freshness_checker','internal_link_gap_finder','schema_validator','robots_txt_editor','llms_txt_manager','core_web_vitals_auditor','mobile_usability_checker','hreflang_manager','canonical_url_manager','duplicate_content_finder','social_meta_generator','readability_scorer','heading_outline','serp_preview','og_preview','video_schema_builder','breadcrumb_schema_builder','product_schema_builder','organization_schema_builder','speakable_schema_builder','ai_summary_block','people_also_ask_seed','keyword_cannibalization','clickbait_detector','faq_seed_generator','topical_authority_score'),
        'Content Generation' => array('generate_post','generate_product_description','generate_meta_description','generate_faq','generate_schema'),
        'File Manager'       => array('fm_list_directory','fm_get_file_info','fm_read_file','fm_write_file','fm_edit_file','fm_syntax_check','fm_delete','fm_rename','fm_copy','fm_move','fm_create_folder','fm_chmod','fm_upload_file','fm_download_file','fm_create_archive','fm_extract_archive','fm_search'),
        'Audit Pro'          => array('audit_404_pages','audit_orphan_media','audit_oversized_images','audit_js_errors','audit_mixed_content','audit_redirect_chains','audit_security_headers','audit_dns_ssl','audit_accessibility','audit_perf_summary','audit_sitemap_diff','audit_indexability'),
    );

    $tool_map = array();
    foreach ( $all_tools as $t ) { $tool_map[$t['name']] = $t; }

    $ungrouped = array();
    $placed    = array();
    foreach ( $all_tools as $t ) { $ungrouped[$t['name']] = true; }

    foreach ( $groups as $gname => $gtools ) :
        $has = array_filter( $gtools, fn($n) => isset( $tool_map[$n] ) );
        if ( empty($has) ) continue;
    ?>
        <tr class="wg-group-row" data-group="<?php echo esc_attr($gname); ?>"><td colspan="4"><?php echo esc_html($gname); ?></td></tr>
    <?php
        foreach ( $has as $tname ) :
            $t = $tool_map[$tname];
            $placed[$tname] = true;
            $risk  = str_contains( $t['description'], '[risk: destructive]' ) ? 'destructive'
                   : ( str_contains( $t['description'], '[risk: write]' ) ? 'write' : 'read' );
            $badge = match($risk){ 'read'=>'wg-badge-green','write'=>'wg-badge-blue', default=>'wg-badge-red' };
            $desc  = preg_replace( '/\s*\[risk:[^\]]+\]/', '', $t['description'] );
            $req   = implode( ', ', $t['inputSchema']['required'] ?? [] );
    ?>
            <tr data-risk="<?php echo esc_attr($risk); ?>" data-name="<?php echo esc_attr($tname); ?>" data-desc="<?php echo esc_attr(strtolower($desc)); ?>">
                <td><span class="tool-name"><?php echo esc_html($tname); ?></span></td>
                <td><?php echo esc_html($desc); ?></td>
                <td><span class="wg-badge <?php echo esc_attr($badge); ?>"><?php echo esc_html($risk); ?></span></td>
                <td><code><?php echo esc_html($req ?: '—'); ?></code></td>
            </tr>
    <?php
        endforeach;
    endforeach;

    // Remaining ungrouped tools
    $extra = array_diff_key( $tool_map, $placed );
    if ( ! empty($extra) ) : ?>
        <tr class="wg-group-row"><td colspan="4">Other</td></tr>
    <?php foreach ( $extra as $tname => $t ) :
            $risk  = str_contains($t['description'],'[risk: destructive]') ? 'destructive' : (str_contains($t['description'],'[risk: write]') ? 'write' : 'read');
            $badge = match($risk){'read'=>'wg-badge-green','write'=>'wg-badge-blue',default=>'wg-badge-red'};
            $desc  = preg_replace('/\s*\[risk:[^\]]+\]/','', $t['description']);
            $req   = implode(', ', $t['inputSchema']['required'] ?? []);
    ?>
            <tr data-risk="<?php echo esc_attr($risk); ?>" data-name="<?php echo esc_attr($tname); ?>" data-desc="<?php echo esc_attr(strtolower($desc)); ?>">
                <td><span class="tool-name"><?php echo esc_html($tname); ?></span></td>
                <td><?php echo esc_html($desc); ?></td>
                <td><span class="wg-badge <?php echo esc_attr($badge); ?>"><?php echo esc_html($risk); ?></span></td>
                <td><code><?php echo esc_html($req ?: '—'); ?></code></td>
            </tr>
    <?php endforeach; endif; ?>
    </tbody>
  </table>
</div>

</div><!-- .wpxmcp-guide -->

<script>
const WG_AJAX  = "<?php echo esc_js( $ajax_url ); ?>";
const WG_NONCE = "<?php echo esc_js( $nonce ); ?>";
let wgActiveFilter = 'all';

function wgTab(id, el) {
  document.querySelectorAll('.wg-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.wg-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panel-' + id).classList.add('active');
}

function wgSub(panel, sub, el) {
  const parent = document.getElementById('panel-' + panel);
  parent.querySelectorAll('.wg-subtab').forEach(t => t.classList.remove('active'));
  parent.querySelectorAll('.wg-subpanel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(panel + '-' + sub).classList.add('active');
}

function wgCopyText(id, btn) {
  const text = document.getElementById(id).innerText;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerText; btn.innerText = 'Copied!';
    setTimeout(() => btn.innerText = orig, 1800);
  });
}

function wgCopyPre(btn) {
  const pre  = btn.parentElement.querySelector('pre');
  const text = pre ? pre.innerText : btn.parentElement.innerText;
  navigator.clipboard.writeText(text.replace(/^Copy$|^Copied!$/gm,'').trim()).then(() => {
    btn.classList.add('ok'); btn.innerText = '✓ Copied';
    setTimeout(() => { btn.classList.remove('ok'); btn.innerText = 'Copy'; }, 1800);
  });
}

function wgCopyPrompt(btn) {
  const text = btn.parentElement.querySelector('.pc-text').innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.innerText = '✓'; setTimeout(() => btn.innerText = 'Copy', 1500);
  });
}

async function wgRunTest() {
  const btn    = document.getElementById('wg-test-btn');
  const result = document.getElementById('wg-test-result');
  const key    = document.getElementById('wg-test-key')?.value || '';
  btn.textContent = '⏳ Testing...';
  if (result) result.textContent = '⏳ Connecting to your WordPress MCP server...\n';

  const fd = new FormData();
  fd.append('action','wpxmcp_live_test');
  fd.append('nonce', WG_NONCE);
  fd.append('api_key', key);

  try {
    const resp = await fetch(WG_AJAX, { method:'POST', body:fd });
    const data = await resp.json();
    if (data.success) {
      const d = data.data;
      btn.className = 'wg-status-pill connected';
      btn.textContent = '✅ Connected';
      if (result) result.textContent =
        `✅ CONNECTION SUCCESSFUL\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Server:    ${d.server_name} v${d.server_ver}\n` +
        `Protocol:  MCP ${d.protocol}\n` +
        `Tools:     ${d.tool_count} tools available\n` +
        `Status:    ${d.status}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Your WordPress site is ready to accept AI commands.`;
    } else {
      btn.className = 'wg-status-pill error';
      btn.textContent = '❌ Failed';
      if (result) result.textContent = '❌ CONNECTION FAILED\n\n' + JSON.stringify(data.data, null, 2);
    }
  } catch(e) {
    btn.className = 'wg-status-pill error';
    btn.textContent = '❌ Error';
    if (result) result.textContent = '❌ Network error: ' + e.message;
  }
  setTimeout(() => { btn.className = 'wg-status-pill'; btn.textContent = '🔌 Test Connection'; }, 8000);
}

async function wgDownloadOpenAPI() {
  const preview = document.getElementById('wg-openapi-preview');
  if (preview) preview.textContent = '⏳ Generating schema from live tool registry...';
  const fd = new FormData();
  fd.append('action','wpxmcp_openapi_export');
  fd.append('nonce', WG_NONCE);
  try {
    const resp = await fetch(WG_AJAX, { method:'POST', body:fd });
    const data = await resp.json();
    if (data.success) {
      const json = JSON.stringify(data.data, null, 2);
      if (preview) preview.textContent = json;
      const blob = new Blob([json], { type:'application/json' });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'wp-x-mcp-openapi.json';
      a.click();
    } else {
      if (preview) preview.textContent = 'Error generating schema.';
    }
  } catch(e) {
    if (preview) preview.textContent = 'Error: ' + e.message;
  }
}

function wgFilterTools() {
  const q = document.getElementById('wg-tool-search').value.toLowerCase();
  document.querySelectorAll('#wg-tools-table tbody tr').forEach(row => {
    if (row.classList.contains('wg-group-row')) return;
    const risk = row.dataset.risk || '';
    const name = row.dataset.name || '';
    const desc = row.dataset.desc || '';
    const matchFilter = wgActiveFilter === 'all' || risk === wgActiveFilter;
    const matchSearch = !q || name.includes(q) || desc.includes(q);
    row.style.display = matchFilter && matchSearch ? '' : 'none';
  });
  // Hide group rows if all their children hidden
  document.querySelectorAll('#wg-tools-table tbody tr.wg-group-row').forEach(gr => {
    let next = gr.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('wg-group-row')) {
      if (next.style.display !== 'none') { hasVisible = true; break; }
      next = next.nextElementSibling;
    }
    gr.style.display = hasVisible ? '' : 'none';
  });
}

function wgSetFilter(f, btn) {
  wgActiveFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  wgFilterTools();
}
</script>

<?php
	}
}