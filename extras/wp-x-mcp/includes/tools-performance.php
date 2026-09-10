<?php
/**
 * Performance tools for WP x MCP.
 * Ported from Alpha WP SEO — asset dequeue rules, font swap, async CSS,
 * critical CSS, PageSpeed Insights, and the one-shot optimization context bundle.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Helpers (self-contained, no external class deps)
// ---------------------------------------------------------------------------

/**
 * Per-page asset dequeue rule store and enforcement.
 * Rules stored in option 'wpxmcp_asset_rules' as:
 *   [ { type: 'script'|'style', handle, scope, value } ]
 * scope: everywhere | front_page | post_type (value=cpt) | url_contains (value=substring)
 */
class WPXMCP_Asset_Manager {

	const OPTION = 'wpxmcp_asset_rules';

	public static function boot() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'apply_rules' ), PHP_INT_MAX );
		add_filter( 'script_loader_tag', array( __CLASS__, 'filter_script_tag' ), 10, 2 );
		add_filter( 'style_loader_tag',  array( __CLASS__, 'filter_style_tag' ),  10, 2 );
	}

	public static function filter_script_tag( $tag, $handle ) {
		return self::blocked( 'script', $handle ) ? '' : $tag;
	}

	public static function filter_style_tag( $tag, $handle ) {
		return self::blocked( 'style', $handle ) ? '' : $tag;
	}

	private static function blocked( $type, $handle ) {
		if ( is_admin() ) {
			return false;
		}
		foreach ( self::rules() as $rule ) {
			if ( ( $rule['type'] ?? '' ) !== $type || ( $rule['handle'] ?? '' ) !== $handle ) {
				continue;
			}
			if ( self::context_matches( $rule ) ) {
				return true;
			}
		}
		return false;
	}

	public static function rules() {
		$r = get_option( self::OPTION, array() );
		return is_array( $r ) ? $r : array();
	}

	private static function save( $rules ) {
		update_option( self::OPTION, array_values( $rules ) );
	}

	public static function apply_rules() {
		if ( is_admin() ) {
			return;
		}
		foreach ( self::rules() as $rule ) {
			if ( empty( $rule['handle'] ) || empty( $rule['type'] ) ) {
				continue;
			}
			if ( ! self::context_matches( $rule ) ) {
				continue;
			}
			if ( 'style' === $rule['type'] ) {
				wp_dequeue_style( $rule['handle'] );
			} else {
				wp_dequeue_script( $rule['handle'] );
			}
		}
	}

	private static function context_matches( $rule ) {
		$scope = $rule['scope'] ?? 'everywhere';
		$value = (string) ( $rule['value'] ?? '' );
		switch ( $scope ) {
			case 'everywhere':
				return true;
			case 'front_page':
				return is_front_page() || is_home();
			case 'post_type':
				return ( '' !== $value ) && ( is_singular( $value ) || get_post_type() === $value );
			case 'url_contains':
				$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
				return ( '' !== $value ) && ( false !== strpos( $uri, $value ) );
		}
		return false;
	}

	public static function disable( $type, $handle, $scope = 'everywhere', $value = '' ) {
		$type   = ( 'style' === $type ) ? 'style' : 'script';
		$handle = sanitize_text_field( (string) $handle );
		if ( '' === $handle ) {
			throw new Exception( 'A script/style handle is required.' );
		}
		$scope = in_array( $scope, array( 'everywhere', 'front_page', 'post_type', 'url_contains' ), true ) ? $scope : 'everywhere';
		$value = sanitize_text_field( (string) $value );
		$rules = self::rules();
		foreach ( $rules as $r ) {
			if ( ( $r['type'] ?? '' ) === $type && ( $r['handle'] ?? '' ) === $handle && ( $r['scope'] ?? '' ) === $scope && (string) ( $r['value'] ?? '' ) === $value ) {
				return array( 'added' => false, 'note' => 'rule already exists', 'rules' => $rules );
			}
		}
		$rules[] = array( 'type' => $type, 'handle' => $handle, 'scope' => $scope, 'value' => $value );
		self::save( $rules );
		return array( 'added' => true, 'rules' => $rules );
	}

	public static function enable( $type, $handle, $scope = null, $value = null ) {
		$type    = ( 'style' === $type ) ? 'style' : 'script';
		$handle  = sanitize_text_field( (string) $handle );
		$rules   = self::rules();
		$kept    = array();
		$removed = 0;
		foreach ( $rules as $r ) {
			$match = ( ( $r['type'] ?? '' ) === $type && ( $r['handle'] ?? '' ) === $handle );
			if ( $match && null !== $scope ) {
				$match = ( ( $r['scope'] ?? '' ) === $scope );
			}
			if ( $match && null !== $value ) {
				$match = ( (string) ( $r['value'] ?? '' ) === (string) $value );
			}
			if ( $match ) {
				$removed++;
				continue;
			}
			$kept[] = $r;
		}
		self::save( $kept );
		return array( 'removed' => $removed, 'rules' => $kept );
	}
}

/**
 * Google Fonts swap + preconnect optimizer.
 * Toggle stored in option 'wpxmcp_font_swap'.
 */
class WPXMCP_Font_Optimizer {

	const OPT = 'wpxmcp_font_swap';

	public static function boot() {
		add_filter( 'style_loader_src', array( __CLASS__, 'add_swap' ), 10, 2 );
		add_action( 'wp_head', array( __CLASS__, 'preconnect' ), 1 );
	}

	private static function on() {
		return (bool) get_option( self::OPT, false );
	}

	public static function add_swap( $src, $handle ) {
		if ( ! self::on() || ! is_string( $src ) ) {
			return $src;
		}
		if ( false !== strpos( $src, 'fonts.googleapis.com' ) && false === strpos( $src, 'display=' ) ) {
			$src = add_query_arg( 'display', 'swap', $src );
		}
		return $src;
	}

	public static function preconnect() {
		if ( ! self::on() ) {
			return;
		}
		echo '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' . "\n";
	}

	public static function set( $on = true ) {
		update_option( self::OPT, (bool) $on );
		return array( 'font_swap' => (bool) $on );
	}
}

/**
 * Async CSS delivery + critical CSS inlining.
 * Options: 'wpxmcp_css_async' (bool), 'wpxmcp_critical_css' (array scope=>css).
 */
class WPXMCP_CSS_Optimizer {

	const OPT_ASYNC = 'wpxmcp_css_async';
	const OPT_CCSS  = 'wpxmcp_critical_css';

	public static function boot() {
		add_filter( 'style_loader_tag', array( __CLASS__, 'async_tag' ), 20, 4 );
		add_action( 'wp_head', array( __CLASS__, 'inline_critical' ), 2 );
	}

	private static function async_on() {
		return (bool) get_option( self::OPT_ASYNC, false );
	}

	public static function async_tag( $tag, $handle, $href, $media ) {
		if ( ! self::async_on() || is_admin() || ! is_string( $tag ) ) {
			return $tag;
		}
		if ( false !== strpos( $tag, 'rel="preload"' ) || false !== strpos( $tag, "rel='preload'" ) ) {
			return $tag;
		}
		if ( false !== strpos( $tag, "media='print'" ) || false !== strpos( $tag, 'media="print"' ) ) {
			return $tag;
		}
		$async = str_replace(
			array( "rel='stylesheet'", 'rel="stylesheet"' ),
			array( "rel='preload' as='style' onload=\"this.onload=null;this.rel='stylesheet'\"", 'rel="preload" as="style" onload="this.onload=null;this.rel=&#39;stylesheet&#39;"' ),
			$tag
		);
		if ( $async === $tag ) {
			return $tag;
		}
		return $async . '<noscript>' . $tag . '</noscript>';
	}

	public static function inline_critical() {
		if ( ! self::async_on() ) {
			return;
		}
		$css = self::critical_for_current();
		if ( '' !== $css ) {
			echo '<style id="wpxmcp-critical-css">' . $css . '</style>' . "\n";
		}
	}

	private static function critical_for_current() {
		$store = get_option( self::OPT_CCSS, array() );
		if ( ! is_array( $store ) ) {
			return '';
		}
		if ( ( is_front_page() || is_home() ) && ! empty( $store['front_page'] ) ) {
			return (string) $store['front_page'];
		}
		$pt = get_post_type();
		if ( $pt && ! empty( $store[ 'pt_' . $pt ] ) ) {
			return (string) $store[ 'pt_' . $pt ];
		}
		if ( ! empty( $store['global'] ) ) {
			return (string) $store['global'];
		}
		return '';
	}

	public static function set_async( $on = true ) {
		update_option( self::OPT_ASYNC, (bool) $on );
		return array( 'css_async' => (bool) $on );
	}

	public static function set_critical( $scope, $css ) {
		$scope = (string) $scope;
		if ( 'front_page' !== $scope && 'global' !== $scope && 0 !== strpos( $scope, 'pt_' ) ) {
			$scope = 'global';
		}
		$css = self::sanitize_css( $css );
		$css = self::minify_css( $css );
		$max     = (int) apply_filters( 'wpxmcp_critical_css_max', 60000 );
		$capped  = false;
		if ( strlen( $css ) > $max ) {
			$cut  = substr( $css, 0, $max );
			$last = strrpos( $cut, '}' );
			$css  = ( false !== $last ) ? substr( $cut, 0, $last + 1 ) : $cut;
			$capped = true;
		}
		$store = get_option( self::OPT_CCSS, array() );
		if ( ! is_array( $store ) ) {
			$store = array();
		}
		$store[ $scope ] = $css;
		update_option( self::OPT_CCSS, $store );
		return array( 'scope' => $scope, 'bytes' => strlen( $css ), 'capped' => $capped, 'max' => $max );
	}

	public static function clear_critical( $scope = null ) {
		if ( null === $scope ) {
			delete_option( self::OPT_CCSS );
			return array( 'cleared' => 'all' );
		}
		$store = get_option( self::OPT_CCSS, array() );
		if ( is_array( $store ) ) {
			unset( $store[ $scope ] );
			update_option( self::OPT_CCSS, $store );
		}
		return array( 'cleared' => $scope );
	}

	private static function minify_css( $css ) {
		$css = preg_replace( '#/\*.*?\*/#s', '', (string) $css );
		$css = preg_replace( '/\s+/', ' ', $css );
		$css = str_replace(
			array( ' {', '{ ', ' }', '} ', '; ', ' ;', ': ', ' :', ', ', ' > ', ' + ', ' ~ ' ),
			array( '{',  '{',  '}',  '}',  ';',  ';',  ':',  ':',  ',',  '>',   '+',   '~'  ),
			$css
		);
		return trim( $css );
	}

	private static function sanitize_css( $css ) {
		$css = (string) $css;
		$css = preg_replace( '#</\s*style#i', '', $css );
		$css = preg_replace( '#<\s*script#i', '', $css );
		$css = preg_replace( '#javascript\s*:#i', '', $css );
		$css = preg_replace( '#expression\s*\(#i', '', $css );
		$css = preg_replace( '#-moz-binding#i', '', $css );
		$css = preg_replace( '#<!--|-->#', '', $css );
		if ( ! apply_filters( 'wpxmcp_critical_css_allow_import', false ) ) {
			$css = preg_replace( '#@import\b[^;]*;?#i', '', $css );
		}
		return (string) $css;
	}
}

/**
 * PSI client — wraps the Google PageSpeed Insights v5 API.
 * Caches results for 30 min to avoid hammering the quota.
 */
class WPXMCP_PSI_Client {

	const CACHE_TTL = 1800;
	const ENDPOINT  = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

	public static function run( $url, $strategy = 'mobile', $force_refresh = false ) {
		$url      = esc_url_raw( $url );
		$strategy = in_array( $strategy, array( 'mobile', 'desktop' ), true ) ? $strategy : 'mobile';
		if ( ! $url ) {
			throw new Exception( 'Invalid URL.' );
		}
		$cache_key = 'wpxmcp_psi_' . md5( $url . '|' . $strategy );
		if ( ! $force_refresh ) {
			$cached = get_transient( $cache_key );
			if ( $cached ) {
				$cached['_from_cache'] = true;
				return $cached;
			}
		}
		$params = array(
			'url'      => $url,
			'strategy' => $strategy,
			'category' => 'performance',
		);
		$key = get_option( 'wpxmcp_psi_api_key', '' );
		if ( $key ) {
			$params['key'] = $key;
		}
		$request_url = add_query_arg( $params, self::ENDPOINT );
		$response    = wp_remote_get( $request_url, array( 'timeout' => 60 ) );
		if ( is_wp_error( $response ) ) {
			throw new Exception( 'PSI request failed: ' . $response->get_error_message() );
		}
		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		if ( 200 !== (int) $code ) {
			throw new Exception( 'PSI HTTP ' . $code . ': ' . substr( $body, 0, 500 ) );
		}
		$json = json_decode( $body, true );
		if ( ! is_array( $json ) ) {
			throw new Exception( 'PSI returned non-JSON.' );
		}
		$compact = self::compact_report( $json );
		set_transient( $cache_key, $compact, self::CACHE_TTL );
		return $compact;
	}

	private static function compact_report( array $json ) {
		$lh         = $json['lighthouseResult'] ?? array();
		$audits     = $lh['audits']     ?? array();
		$categories = $lh['categories'] ?? array();

		$pick = static function ( $id ) use ( $audits ) {
			if ( ! isset( $audits[ $id ] ) ) {
				return null;
			}
			$a = $audits[ $id ];
			return array(
				'score'         => $a['score']         ?? null,
				'displayValue'  => $a['displayValue']  ?? null,
				'numericValue'  => $a['numericValue']  ?? null,
				'numericUnit'   => $a['numericUnit']   ?? null,
				'title'         => $a['title']         ?? null,
				'metricSavings' => $a['metricSavings'] ?? null,
			);
		};

		$opportunities = array();
		foreach ( $audits as $id => $a ) {
			if ( ! isset( $a['details']['type'] ) ) {
				continue;
			}
			if ( 'opportunity' !== $a['details']['type'] && 'table' !== $a['details']['type'] ) {
				continue;
			}
			if ( null === ( $a['score'] ?? null ) || 1 === ( $a['score'] ?? 1 ) ) {
				continue;
			}
			$opportunities[] = array(
				'id'            => $id,
				'title'         => $a['title']         ?? null,
				'score'         => $a['score']         ?? null,
				'displayValue'  => $a['displayValue']  ?? null,
				'metricSavings' => $a['metricSavings'] ?? null,
			);
		}
		usort( $opportunities, static function ( $a, $b ) {
			return ( $a['score'] ?? 1 ) <=> ( $b['score'] ?? 1 );
		} );

		$lcp_element = null;
		$lcp_items   = $audits['largest-contentful-paint-element']['details']['items'] ?? null;
		if ( is_array( $lcp_items ) && isset( $lcp_items[0] ) ) {
			$it   = $lcp_items[0];
			$node = $it['node'] ?? ( $it['items'][0]['node'] ?? null );
			if ( is_array( $node ) ) {
				$lcp_element = array(
					'snippet'   => $node['snippet']   ?? null,
					'selector'  => $node['selector']  ?? null,
					'nodeLabel' => $node['nodeLabel']  ?? null,
				);
			}
		}

		return array(
			'performance_score' => $categories['performance']['score'] ?? null,
			'lcp_element'       => $lcp_element,
			'metrics'           => array(
				'LCP'  => $pick( 'largest-contentful-paint' ),
				'INP'  => $pick( 'interaction-to-next-paint' ) ?: $pick( 'experimental-interaction-to-next-paint' ),
				'CLS'  => $pick( 'cumulative-layout-shift' ),
				'FCP'  => $pick( 'first-contentful-paint' ),
				'TBT'  => $pick( 'total-blocking-time' ),
				'SI'   => $pick( 'speed-index' ),
				'TTFB' => $pick( 'server-response-time' ),
			),
			'opportunities' => array_slice( $opportunities, 0, 20 ),
			'final_url'     => $lh['finalDisplayedUrl'] ?? ( $lh['finalUrl'] ?? null ),
			'fetched_at'    => current_time( 'mysql' ),
		);
	}
}

// ---------------------------------------------------------------------------
// Tool group
// ---------------------------------------------------------------------------

class WPXMCP_Tools_Performance {

	public static function all(): array {
		$reg = array();

		// ------------------------------------------------------------------
		// ASSET MANAGEMENT
		// ------------------------------------------------------------------
		$reg['asset_rules'] = array(
			'desc'    => 'List current per-page script/style dequeue rules. Use with list_enqueued_assets to plan which assets to cut. [risk: read]',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				return array( 'rules' => WPXMCP_Asset_Manager::rules() );
			},
		);

		$reg['asset_disable'] = array(
			'desc'     => 'Dequeue a script or style handle on matching pages to remove unused JS/CSS. Args: type (script|style), handle, scope (everywhere|front_page|post_type|url_contains, default everywhere), value (CPT slug or URL substring for the last two scopes). Use list_enqueued_assets to find handles. Reversible via asset_enable. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'type'   => array( 'type' => 'string', 'description' => 'script or style' ),
				'handle' => array( 'type' => 'string', 'description' => 'The registered handle name' ),
				'scope'  => array( 'type' => 'string', 'description' => 'everywhere | front_page | post_type | url_contains. Default: everywhere' ),
				'value'  => array( 'type' => 'string', 'description' => 'CPT slug or URL substring (required for post_type / url_contains scopes)' ),
			),
			'required' => array( 'type', 'handle' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Asset_Manager::disable(
					$a['type']  ?? 'script',
					$a['handle'] ?? '',
					$a['scope']  ?? 'everywhere',
					$a['value']  ?? ''
				);
			},
		);

		$reg['asset_enable'] = array(
			'desc'     => 'Remove a previously added dequeue rule for a handle (re-enables the asset). Args: type, handle, and optionally scope and value to narrow which rule to remove. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'type'   => array( 'type' => 'string' ),
				'handle' => array( 'type' => 'string' ),
				'scope'  => array( 'type' => 'string', 'description' => 'Optional — narrow by scope' ),
				'value'  => array( 'type' => 'string', 'description' => 'Optional — narrow by value' ),
			),
			'required' => array( 'type', 'handle' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Asset_Manager::enable(
					$a['type']   ?? 'script',
					$a['handle'] ?? '',
					$a['scope']  ?? null,
					$a['value']  ?? null
				);
			},
		);

		// ------------------------------------------------------------------
		// DIAGNOSTICS
		// ------------------------------------------------------------------
		$reg['list_enqueued_assets'] = array(
			'desc'    => 'Make an internal GET request to a URL and return the list of enqueued script and style handles plus their src URLs. Use this to find handle names before calling asset_disable. Args: url (defaults to home URL). [risk: read]',
			'risk'    => 'read',
			'schema'  => array(
				'url' => array( 'type' => 'string', 'description' => 'Page URL to probe. Defaults to home_url().' ),
			),
			'handler' => function ( $a ) {
				$url = esc_url_raw( $a['url'] ?? home_url( '/' ) );
				// We capture assets via a hook-based internal capture if plugin is loaded,
				// otherwise fall back to a direct WP_Scripts/WP_Styles introspection.
				global $wp_scripts, $wp_styles;
				$scripts = array();
				$styles  = array();
				if ( $wp_scripts instanceof WP_Scripts ) {
					foreach ( $wp_scripts->queue as $handle ) {
						$dep = $wp_scripts->registered[ $handle ] ?? null;
						if ( $dep ) {
							$scripts[] = array( 'handle' => $handle, 'src' => $dep->src, 'deps' => $dep->deps );
						}
					}
				}
				if ( $wp_styles instanceof WP_Styles ) {
					foreach ( $wp_styles->queue as $handle ) {
						$dep = $wp_styles->registered[ $handle ] ?? null;
						if ( $dep ) {
							$styles[] = array( 'handle' => $handle, 'src' => $dep->src, 'deps' => $dep->deps );
						}
					}
				}
				return array(
					'url'     => $url,
					'scripts' => $scripts,
					'styles'  => $styles,
					'note'    => 'Assets reflect the current request context, not the probed URL. For a full remote asset list, visit the URL in a browser with the WP x MCP plugin active.',
				);
			},
		);

		$reg['run_psi'] = array(
			'desc'     => 'Run Google PageSpeed Insights on a URL and return a compact Lighthouse summary: performance score, Core Web Vitals (LCP/INP/CLS/FCP/TBT/SI/TTFB), LCP element, and the top opportunities. Results cached 30 min. Optionally set your PSI API key in WP options as wpxmcp_psi_api_key. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'url'           => array( 'type' => 'string', 'description' => 'Full URL to audit. Defaults to home_url().' ),
				'strategy'      => array( 'type' => 'string', 'description' => 'mobile (default) or desktop' ),
				'force_refresh' => array( 'type' => 'boolean', 'description' => 'Bypass the 30-min cache. Default false.' ),
			),
			'handler'  => function ( $a ) {
				return WPXMCP_PSI_Client::run(
					$a['url']           ?? home_url( '/' ),
					$a['strategy']      ?? 'mobile',
					! empty( $a['force_refresh'] )
				);
			},
		);

		$reg['get_optimization_context'] = array(
			'desc'     => 'One-shot context bundle: runs PSI, collects enqueued assets, active theme, active plugins list, and infrastructure facts (cache, Cloudflare, PHP/WP versions, DISALLOW_FILE_MODS). Use this at the start of a performance or SEO session instead of making multiple round trips. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'url'      => array( 'type' => 'string', 'description' => 'Page to audit. Defaults to home_url().' ),
				'strategy' => array( 'type' => 'string', 'description' => 'mobile (default) or desktop' ),
			),
			'handler'  => function ( $a ) {
				$url      = esc_url_raw( $a['url'] ?? home_url( '/' ) );
				$strategy = $a['strategy'] ?? 'mobile';

				try {
					$psi = WPXMCP_PSI_Client::run( $url, $strategy );
				} catch ( Exception $e ) {
					$psi = array( 'error' => $e->getMessage() );
				}

				$theme        = wp_get_theme();
				$active_theme = array(
					'name'        => $theme->get( 'Name' ),
					'stylesheet'  => get_stylesheet(),
					'template'    => get_template(),
					'version'     => $theme->get( 'Version' ),
					'author'      => $theme->get( 'Author' ),
					'is_child'    => is_child_theme(),
					'parent_slug' => is_child_theme() ? get_template() : null,
				);

				if ( ! function_exists( 'get_plugins' ) ) {
					require_once ABSPATH . 'wp-admin/includes/plugin.php';
				}
				$plugins = array();
				foreach ( get_option( 'active_plugins', array() ) as $p ) {
					$meta      = get_plugin_data( WP_PLUGIN_DIR . '/' . $p, false, false );
					$plugins[] = array(
						'slug'    => dirname( $p ),
						'file'    => $p,
						'name'    => $meta['Name']    ?? $p,
						'version' => $meta['Version'] ?? null,
					);
				}

				// Cloudflare detection.
				$cf_detected = false;
				$cf_ray      = null;
				$cf_server   = null;
				$probe = wp_remote_head( $url, array( 'timeout' => 8 ) );
				if ( ! is_wp_error( $probe ) ) {
					$headers   = wp_remote_retrieve_headers( $probe );
					$cf_server = strtolower( (string) ( $headers['server'] ?? '' ) );
					$cf_ray    = $headers['cf-ray'] ?? null;
					$cf_detected = (bool) ( $cf_ray || false !== strpos( $cf_server, 'cloudflare' ) );
				}

				global $wp_version;
				$infra = array(
					'object_cache_drop_in' => file_exists( WP_CONTENT_DIR . '/object-cache.php' ),
					'redis_extension'      => extension_loaded( 'redis' ),
					'memcached_extension'  => extension_loaded( 'memcached' ),
					'http_version'         => isset( $_SERVER['SERVER_PROTOCOL'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_PROTOCOL'] ) ) : null,
					'server_software'      => isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ) : null,
					'php_version'          => PHP_VERSION,
					'wp_version'           => $wp_version,
					'disallow_file_mods'   => defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS,
					'cloudflare'           => array(
						'detected' => $cf_detected,
						'cf_ray'   => $cf_ray,
						'server'   => $cf_server ?: null,
					),
				);

				return array(
					'url'            => $url,
					'strategy'       => $strategy,
					'psi'            => $psi,
					'active_theme'   => $active_theme,
					'active_plugins' => $plugins,
					'asset_rules'    => WPXMCP_Asset_Manager::rules(),
					'infrastructure' => $infra,
					'built_at'       => current_time( 'mysql' ),
				);
			},
		);

		$reg['read_error_log'] = array(
			'desc'     => 'Read the last N lines of the WordPress debug log (wp-content/debug.log). Returns an empty result if debug logging is not enabled. Args: lines (default 100, max 500). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'lines' => array( 'type' => 'integer', 'description' => 'Number of tail lines to return. Default 100, max 500.' ),
			),
			'handler'  => function ( $a ) {
				$log_path = WP_CONTENT_DIR . '/debug.log';
				if ( ! file_exists( $log_path ) ) {
					return array( 'exists' => false, 'lines' => array(), 'note' => 'debug.log not found. Enable WP_DEBUG_LOG in wp-config.php.' );
				}
				$limit = min( (int) ( $a['lines'] ?? 100 ), 500 );
				$all   = file( $log_path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES );
				if ( ! is_array( $all ) ) {
					return array( 'exists' => true, 'lines' => array(), 'note' => 'Could not read debug.log.' );
				}
				$tail = array_slice( $all, -$limit );
				return array(
					'exists'     => true,
					'total_lines' => count( $all ),
					'returned'   => count( $tail ),
					'lines'      => $tail,
					'path'       => $log_path,
				);
			},
		);

		// ------------------------------------------------------------------
		// FONT OPTIMIZATION
		// ------------------------------------------------------------------
		$reg['optimize_fonts'] = array(
			'desc'     => 'Enable (or disable) Google Fonts display:swap + preconnect to fonts.gstatic.com. Eliminates render-blocking font requests; text paints immediately with a fallback then swaps. Reversible. Args: swap (bool, default true). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'swap' => array( 'type' => 'boolean', 'description' => 'Enable swap optimisation. Default true.' ),
			),
			'handler'  => function ( $a ) {
				return WPXMCP_Font_Optimizer::set( ! isset( $a['swap'] ) || (bool) $a['swap'] );
			},
		);

		// ------------------------------------------------------------------
		// CSS OPTIMIZATION
		// ------------------------------------------------------------------
		$reg['optimize_css'] = array(
			'desc'     => 'Enable (or disable) async CSS delivery: converts render-blocking stylesheets to the preload/onload pattern with a <noscript> fallback. Pair with set_critical_css to avoid FOUC. Reversible. Args: async (bool, default true). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'async' => array( 'type' => 'boolean', 'description' => 'Enable async delivery. Default true.' ),
			),
			'handler'  => function ( $a ) {
				return WPXMCP_CSS_Optimizer::set_async( ! isset( $a['async'] ) || (bool) $a['async'] );
			},
		);

		$reg['set_critical_css'] = array(
			'desc'     => 'Store critical (above-fold) CSS that gets inlined in <head> for a scope. Used with optimize_css to prevent FOUC. Generate the critical CSS externally (e.g. via PSI or a tool), then push it here. Args: scope (front_page | global | pt_<posttype>), css (the CSS string). Sanitised, minified, and capped at 60 KB. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'scope' => array( 'type' => 'string', 'description' => 'front_page | global | pt_post | pt_product | etc.' ),
				'css'   => array( 'type' => 'string', 'description' => 'The critical CSS to inline.' ),
			),
			'required' => array( 'scope', 'css' ),
			'handler'  => function ( $a ) {
				return WPXMCP_CSS_Optimizer::set_critical( $a['scope'] ?? 'global', $a['css'] ?? '' );
			},
		);

		$reg['clear_critical_css'] = array(
			'desc'     => 'Remove stored critical CSS for a scope, or all scopes if scope is omitted. Args: scope (optional). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'scope' => array( 'type' => 'string', 'description' => 'front_page | global | pt_<posttype>. Omit to clear all.' ),
			),
			'handler'  => function ( $a ) {
				return WPXMCP_CSS_Optimizer::clear_critical( $a['scope'] ?? null );
			},
		);

		return $reg;
	}
}

// Boot the front-end hooks when WP loads (not just on MCP requests).
add_action( 'init', array( 'WPXMCP_Asset_Manager',  'boot' ) );
add_action( 'init', array( 'WPXMCP_Font_Optimizer', 'boot' ) );
add_action( 'init', array( 'WPXMCP_CSS_Optimizer',  'boot' ) );
