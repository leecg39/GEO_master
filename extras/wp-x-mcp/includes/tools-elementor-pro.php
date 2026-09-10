<?php
/**
 * Deep Elementor editing tools for WP x MCP.
 * Ported from Alpha WP SEO.
 *
 * Tools: elementor_read_page, elementor_apply_to_page, elementor_flush_cache,
 *        elementor_revert_page, elementor_get_globals, elementor_list_widget_types,
 *        elementor_extract_content, elementor_patch_content,
 *        elementor_find_element, elementor_add_widget, elementor_add_container,
 *        elementor_update_element, elementor_remove_element,
 *        elementor_duplicate_element, elementor_move_element,
 *        elementor_reorder_children, list_elementor_posts
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Elementor Bridge
// ---------------------------------------------------------------------------

class WPXMCP_Elementor_Bridge {

	const REVISIONS_TABLE_KEY = 'wpxmcp_elementor_revisions';

	public static function revisions_table() {
		global $wpdb;
		return $wpdb->prefix . self::REVISIONS_TABLE_KEY;
	}

	public static function maybe_create_revisions_table() {
		global $wpdb;
		$table   = self::revisions_table();
		$charset = $wpdb->get_charset_collate();
		$sql     = "CREATE TABLE IF NOT EXISTS {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			post_id BIGINT(20) UNSIGNED NOT NULL,
			user_id BIGINT(20) UNSIGNED NOT NULL,
			label VARCHAR(255) NULL,
			elementor_data_before LONGTEXT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			KEY post_id (post_id),
			KEY created_at (created_at)
		) {$charset};";
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	public static function is_active() {
		return did_action( 'elementor/loaded' ) > 0 || class_exists( '\\Elementor\\Plugin' );
	}

	public static function assert_active() {
		if ( ! self::is_active() ) {
			throw new Exception( 'Elementor plugin is not active on this site.' );
		}
	}

	public static function read_page( $post_id ) {
		$post_id = (int) $post_id;
		if ( ! $post_id || ! get_post( $post_id ) ) {
			throw new Exception( 'Post not found.' );
		}
		$raw  = get_post_meta( $post_id, '_elementor_data', true );
		$json = is_string( $raw ) && '' !== $raw ? json_decode( $raw, true ) : null;
		if ( null === $json && '' !== (string) $raw ) {
			throw new Exception( '_elementor_data could not be JSON-decoded.' );
		}
		$autosave         = wp_get_post_autosave( $post_id );
		$autosave_warning = null;
		if ( $autosave && strtotime( $autosave->post_modified_gmt ) > ( time() - 30 ) ) {
			$autosave_warning = sprintf( 'A recent autosave exists (id=%d). Refusing writes until it ages out (wait 30s).', $autosave->ID );
		}
		return array(
			'post_id'          => $post_id,
			'json'             => $json ?: array(),
			'version'          => get_post_meta( $post_id, '_elementor_version', true ),
			'edit_mode'        => get_post_meta( $post_id, '_elementor_edit_mode', true ),
			'last_edited'      => get_post_modified_time( 'mysql', true, $post_id ),
			'autosave_warning' => $autosave_warning,
		);
	}

	public static function apply_to_page( $post_id, $json, $snapshot_label = null ) {
		self::assert_active();
		self::maybe_create_revisions_table();

		$post_id = (int) $post_id;
		if ( ! $post_id || ! get_post( $post_id ) ) {
			throw new Exception( 'Post not found.' );
		}
		if ( ! is_array( $json ) ) {
			throw new Exception( 'json (array) is required.' );
		}
		$autosave = wp_get_post_autosave( $post_id );
		if ( $autosave && strtotime( $autosave->post_modified_gmt ) > ( time() - 30 ) ) {
			throw new Exception( sprintf( 'Recent autosave exists (id=%d). Try again in 30s.', $autosave->ID ) );
		}

		global $wpdb;
		$before = get_post_meta( $post_id, '_elementor_data', true );
		$wpdb->insert( self::revisions_table(), array(
			'post_id'               => $post_id,
			'user_id'               => get_current_user_id(),
			'label'                 => $snapshot_label ? substr( (string) $snapshot_label, 0, 255 ) : null,
			'elementor_data_before' => is_string( $before ) ? $before : wp_json_encode( $before ),
			'created_at'            => current_time( 'mysql' ),
		) );
		$revision_id = (int) $wpdb->insert_id;

		$saved = false;
		if ( class_exists( '\\Elementor\\Plugin' ) ) {
			try {
				$document = \Elementor\Plugin::instance()->documents->get( $post_id );
				if ( $document ) {
					$document->save( array( 'elements' => $json ) );
					$saved = true;
				}
			} catch ( \Throwable $e ) {
				$saved = false;
			}
		}
		if ( ! $saved ) {
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $json ) ) );
		}

		return array(
			'post_id'     => $post_id,
			'revision_id' => $revision_id,
			'saved_via'   => $saved ? 'elementor_document_save' : 'meta_fallback',
		);
	}

	public static function flush_cache( $post_id = null ) {
		self::assert_active();
		if ( class_exists( '\\Elementor\\Plugin' ) ) {
			try {
				$files = \Elementor\Plugin::instance()->files_manager;
				if ( $post_id ) {
					$files->clear_cache( (int) $post_id );
				} else {
					$files->clear_cache();
				}
			} catch ( \Throwable $e ) {
				throw new Exception( 'flush_cache failed: ' . $e->getMessage() );
			}
		}
		wp_cache_flush();
		return array( 'cleared' => true, 'post_id' => $post_id );
	}

	public static function revert_page( $post_id, $revision_id ) {
		self::maybe_create_revisions_table();
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare(
			'SELECT * FROM ' . self::revisions_table() . ' WHERE id = %d AND post_id = %d',
			(int) $revision_id, (int) $post_id
		), ARRAY_A );
		if ( ! $row ) {
			throw new Exception( 'Revision not found for post ' . $post_id . '.' );
		}
		update_post_meta( $post_id, '_elementor_data', wp_slash( $row['elementor_data_before'] ) );
		self::flush_cache( $post_id );
		return array( 'post_id' => (int) $post_id, 'reverted_to_revision' => (int) $revision_id );
	}

	public static function list_widget_types() {
		self::assert_active();
		if ( ! class_exists( '\\Elementor\\Plugin' ) ) {
			throw new Exception( 'Elementor class not found.' );
		}
		$out = array();
		try {
			$widgets = \Elementor\Plugin::instance()->widgets_manager->get_widget_types();
			foreach ( $widgets as $name => $widget ) {
				$out[] = array(
					'name'       => $name,
					'title'      => method_exists( $widget, 'get_title' )      ? $widget->get_title()      : $name,
					'categories' => method_exists( $widget, 'get_categories' ) ? $widget->get_categories() : array(),
					'keywords'   => method_exists( $widget, 'get_keywords' )   ? $widget->get_keywords()   : array(),
				);
			}
		} catch ( \Throwable $e ) {
			throw new Exception( 'Could not enumerate widgets: ' . $e->getMessage() );
		}
		return $out;
	}

	public static function get_globals() {
		self::assert_active();
		$kit_id = get_option( 'elementor_active_kit' );
		if ( ! $kit_id ) {
			return array( 'colors' => array(), 'fonts' => array(), 'settings' => array() );
		}
		$settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
		if ( ! is_array( $settings ) ) {
			return array( 'colors' => array(), 'fonts' => array(), 'settings' => array() );
		}
		return array(
			'kit_id'            => (int) $kit_id,
			'system_colors'     => $settings['system_colors']     ?? array(),
			'custom_colors'     => $settings['custom_colors']     ?? array(),
			'system_typography' => $settings['system_typography'] ?? array(),
			'custom_typography' => $settings['custom_typography'] ?? array(),
		);
	}

	// ------------------------------------------------------------------
	// JSON manipulation helpers
	// ------------------------------------------------------------------

	/** Walk the elementor data tree depth-first, returning a flat list of all elements. */
	public static function flatten( array $elements, &$out = array() ) {
		foreach ( $elements as &$el ) {
			if ( ! is_array( $el ) ) { continue; }
			$out[] = &$el;
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				self::flatten( $el['elements'], $out );
			}
		}
		return $out;
	}

	/** Find a single element by id (recursive). Returns reference or null. */
	public static function &find_by_id( array &$elements, $id ) {
		foreach ( $elements as &$el ) {
			if ( ! is_array( $el ) ) { continue; }
			if ( isset( $el['id'] ) && $el['id'] === $id ) {
				return $el;
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				$found = &self::find_by_id( $el['elements'], $id );
				if ( null !== $found ) { return $found; }
			}
		}
		$null = null;
		return $null;
	}

	/** Find the parent array and index of element with given id. */
	public static function find_parent( array &$elements, $id, &$parent = null, &$index = null ) {
		foreach ( $elements as $i => &$el ) {
			if ( ! is_array( $el ) ) { continue; }
			if ( isset( $el['id'] ) && $el['id'] === $id ) {
				$parent = &$elements;
				$index  = $i;
				return true;
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				if ( self::find_parent( $el['elements'], $id, $parent, $index ) ) { return true; }
			}
		}
		return false;
	}

	private static function generate_id() {
		return substr( md5( uniqid( '', true ) ), 0, 8 );
	}
}

// ---------------------------------------------------------------------------
// Elementor Content (extract / patch text fields)
// ---------------------------------------------------------------------------

class WPXMCP_Elementor_Content {

	private static function field_map() {
		return array(
			'heading'       => array( array( 'key' => 'title',               'format' => 'html' ) ),
			'text-editor'   => array( array( 'key' => 'editor',              'format' => 'html' ) ),
			'button'        => array( array( 'key' => 'text',                'format' => 'text' ) ),
			'icon-box'      => array( array( 'key' => 'title_text',          'format' => 'text' ), array( 'key' => 'description_text', 'format' => 'html' ) ),
			'image-box'     => array( array( 'key' => 'title_text',          'format' => 'text' ), array( 'key' => 'description_text', 'format' => 'html' ) ),
			'icon-list'     => array( array( 'repeater' => 'icon_list',     'fields' => array( array( 'key' => 'text',         'format' => 'text' ) ) ) ),
			'accordion'     => array( array( 'repeater' => 'tabs',          'fields' => array( array( 'key' => 'tab_title',    'format' => 'text' ), array( 'key' => 'tab_content', 'format' => 'html' ) ) ) ),
			'toggle'        => array( array( 'repeater' => 'tabs',          'fields' => array( array( 'key' => 'tab_title',    'format' => 'text' ), array( 'key' => 'tab_content', 'format' => 'html' ) ) ) ),
			'tabs'          => array( array( 'repeater' => 'tabs',          'fields' => array( array( 'key' => 'tab_title',    'format' => 'text' ), array( 'key' => 'tab_content', 'format' => 'html' ) ) ) ),
			'testimonial'   => array( array( 'key' => 'testimonial_content', 'format' => 'html' ), array( 'key' => 'testimonial_name', 'format' => 'text' ), array( 'key' => 'testimonial_job', 'format' => 'text' ) ),
			'alert'         => array( array( 'key' => 'alert_title',         'format' => 'text' ), array( 'key' => 'alert_description', 'format' => 'html' ) ),
			'counter'       => array( array( 'key' => 'title',               'format' => 'text' ) ),
			'progress'      => array( array( 'key' => 'title',               'format' => 'text' ), array( 'key' => 'inner_text', 'format' => 'text' ) ),
			'star-rating'   => array( array( 'key' => 'title',               'format' => 'text' ) ),
			'html'          => array( array( 'key' => 'html',                'format' => 'html' ) ),
			'shortcode'     => array( array( 'key' => 'shortcode',           'format' => 'text' ) ),
			'text-path'     => array( array( 'key' => 'text',                'format' => 'text' ) ),
			'image'         => array( array( 'key' => 'caption',             'format' => 'text' ) ),
			// Pro widgets
			'call-to-action'       => array( array( 'key' => 'title', 'format' => 'text' ), array( 'key' => 'description', 'format' => 'html' ), array( 'key' => 'button', 'format' => 'text' ) ),
			'blockquote'           => array( array( 'key' => 'blockquote_content', 'format' => 'html' ), array( 'key' => 'author_name', 'format' => 'text' ) ),
			'flip-box'             => array( array( 'key' => 'title_text_a', 'format' => 'text' ), array( 'key' => 'description_text_a', 'format' => 'html' ), array( 'key' => 'title_text_b', 'format' => 'text' ), array( 'key' => 'description_text_b', 'format' => 'html' ) ),
			'price-table'          => array( array( 'key' => 'heading', 'format' => 'text' ), array( 'key' => 'sub_heading', 'format' => 'text' ), array( 'repeater' => 'features_list', 'fields' => array( array( 'key' => 'item_text', 'format' => 'text' ) ) ) ),
			'testimonial-carousel' => array( array( 'repeater' => 'slides', 'fields' => array( array( 'key' => 'content', 'format' => 'html' ), array( 'key' => 'name', 'format' => 'text' ), array( 'key' => 'title', 'format' => 'text' ) ) ) ),
		);
	}

	public static function extract( $post_id ) {
		WPXMCP_Elementor_Bridge::assert_active();
		$read  = WPXMCP_Elementor_Bridge::read_page( (int) $post_id );
		$items = array();
		$stats = array( 'html_widgets' => 0, 'native_widgets' => 0 );
		self::collect( $read['json'], $items, $stats );
		return array(
			'post_id'       => (int) $post_id,
			'content_model' => ( $stats['html_widgets'] > 0 && $stats['native_widgets'] === 0 ) ? 'html' : ( $stats['native_widgets'] > 0 && $stats['html_widgets'] === 0 ? 'native' : 'mixed' ),
			'count'         => count( $items ),
			'items'         => $items,
		);
	}

	private static function collect( $elements, &$items, &$stats ) {
		if ( ! is_array( $elements ) ) { return; }
		$map = self::field_map();
		foreach ( $elements as $el ) {
			if ( ! is_array( $el ) ) { continue; }
			$id       = $el['id'] ?? null;
			$settings = is_array( $el['settings'] ?? null ) ? $el['settings'] : array();
			$widget   = $el['widgetType'] ?? ( $el['elType'] ?? '' );
			$dynamic  = is_array( $settings['__dynamic__'] ?? null ) ? $settings['__dynamic__'] : array();

			if ( '' !== $widget && isset( $map[ $widget ] ) ) {
				foreach ( $map[ $widget ] as $spec ) {
					if ( isset( $spec['repeater'] ) ) {
						$rep = $spec['repeater'];
						if ( ! empty( $settings[ $rep ] ) && is_array( $settings[ $rep ] ) ) {
							foreach ( $settings[ $rep ] as $idx => $row ) {
								foreach ( $spec['fields'] as $f ) {
									$k = $f['key'];
									if ( isset( $row[ $k ] ) && '' !== (string) $row[ $k ] && ! isset( $dynamic[ $k ] ) ) {
										$items[] = array( 'id' => $id, 'widget' => $widget, 'field' => $rep . '.' . $idx . '.' . $k, 'format' => $f['format'], 'value' => $row[ $k ] );
									}
								}
							}
						}
					} else {
						$k = $spec['key'];
						if ( isset( $settings[ $k ] ) && '' !== (string) $settings[ $k ] && ! isset( $dynamic[ $k ] ) ) {
							if ( 'html' === $widget ) { $stats['html_widgets']++; } else { $stats['native_widgets']++; }
							$items[] = array( 'id' => $id, 'widget' => $widget, 'field' => $k, 'format' => $spec['format'], 'value' => $settings[ $k ] );
						}
					}
				}
			}

			if ( ! empty( $el['elements'] ) ) {
				self::collect( $el['elements'], $items, $stats );
			}
		}
	}

	public static function patch( $post_id, array $edits, $snapshot_label = null ) {
		WPXMCP_Elementor_Bridge::assert_active();
		$page    = WPXMCP_Elementor_Bridge::read_page( (int) $post_id );
		$data    = $page['json'];
		$applied = array();
		$skipped = array();

		foreach ( $edits as $edit ) {
			$id    = $edit['id']    ?? null;
			$field = $edit['field'] ?? null;
			$value = $edit['value'] ?? null;
			if ( null === $id || null === $field ) {
				$skipped[] = $edit;
				continue;
			}

			$el = &WPXMCP_Elementor_Bridge::find_by_id( $data, $id );
			if ( null === $el ) {
				$skipped[] = array_merge( (array) $edit, array( 'reason' => 'element not found' ) );
				continue;
			}

			// Support repeater paths: rep.idx.key
			$parts = explode( '.', (string) $field );
			if ( 3 === count( $parts ) ) {
				list( $rep, $idx, $key ) = $parts;
				if ( isset( $el['settings'][ $rep ][ (int) $idx ][ $key ] ) ) {
					$el['settings'][ $rep ][ (int) $idx ][ $key ] = $value;
					$applied[] = $edit;
				} else {
					$skipped[] = array_merge( (array) $edit, array( 'reason' => 'repeater field path not found' ) );
				}
			} else {
				if ( array_key_exists( $field, $el['settings'] ?? array() ) ) {
					$el['settings'][ $field ] = $value;
					$applied[] = $edit;
				} else {
					$skipped[] = array_merge( (array) $edit, array( 'reason' => 'field not found in element settings' ) );
				}
			}
		}

		$save = WPXMCP_Elementor_Bridge::apply_to_page( (int) $post_id, $data, $snapshot_label );
		WPXMCP_Elementor_Bridge::flush_cache( (int) $post_id );

		return array(
			'post_id'     => (int) $post_id,
			'revision_id' => $save['revision_id'],
			'applied'     => count( $applied ),
			'skipped'     => count( $skipped ),
			'applied_edits' => $applied,
			'skipped_edits' => $skipped,
		);
	}
}

// ---------------------------------------------------------------------------
// Tool group
// ---------------------------------------------------------------------------

class WPXMCP_Tools_Elementor_Pro {

	public static function all(): array {
		$reg = array();

		$reg['elementor_read_page'] = array(
			'desc'     => 'Read the full _elementor_data JSON, version, edit-mode, and last-edited timestamp for a post. Also warns if a recent autosave exists. Args: post_id. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				return WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
			},
		);

		$reg['elementor_apply_to_page'] = array(
			'desc'     => 'Replace _elementor_data on a post with new JSON. Snapshots the prior data first (revert with elementor_revert_page). Flush cache separately after writing. Args: post_id, json (array), snapshot_label (optional). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'json'           => array( 'type' => 'array',  'description' => 'The full Elementor elements array to write.' ),
				'snapshot_label' => array( 'type' => 'string', 'description' => 'Optional label for the revision.' ),
			),
			'required' => array( 'post_id', 'json' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $a['json'], $a['snapshot_label'] ?? null );
			},
		);

		$reg['elementor_flush_cache'] = array(
			'desc'     => 'Flush Elementor CSS cache. Provide post_id for a single-page flush, or omit for site-wide. Also flushes the WP object cache. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id' => array( 'type' => 'integer', 'description' => 'Optional. Omit for site-wide flush.' ),
			),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Bridge::flush_cache( $a['post_id'] ?? null );
			},
		);

		$reg['elementor_revert_page'] = array(
			'desc'     => 'Restore a previous _elementor_data snapshot. Get revision_id from the result of elementor_apply_to_page or elementor_patch_content. Also flushes the cache. Args: post_id, revision_id. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'     => array( 'type' => 'integer' ),
				'revision_id' => array( 'type' => 'integer' ),
			),
			'required' => array( 'post_id', 'revision_id' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Bridge::revert_page( (int) $a['post_id'], (int) $a['revision_id'] );
			},
		);

		$reg['elementor_list_widget_types'] = array(
			'desc'     => 'Return all registered Elementor widget types (name, title, categories, keywords). Run this before adding widgets to know what widget names are available. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Bridge::list_widget_types();
			},
		);

		$reg['elementor_get_globals'] = array(
			'desc'     => 'Return the active Elementor kit\'s system and custom colors and typography tokens. Use before writing to ensure colours/fonts match the global design system. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Bridge::get_globals();
			},
		);

		$reg['elementor_extract_content'] = array(
			'desc'     => 'Walk _elementor_data and return a flat, id-addressed list of every text-bearing field (headings, text editors, buttons, repeaters, etc.) stripped of design/layout info. Use this to read and improve copy without touching the layout. Dynamic-tag-bound fields are skipped. Args: post_id. [risk: read]',
			'risk'     => 'read',
			'schema'   => array( 'post_id' => array( 'type' => 'integer' ) ),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Content::extract( (int) $a['post_id'] );
			},
		);

		$reg['elementor_patch_content'] = array(
			'desc'     => 'Write improved text back to specific Elementor elements by id and field path (from elementor_extract_content). Preserves all layout and styling. Snapshots prior data for revert and flushes cache. edits = [{id, field, value}]. Only overwrites fields that already exist. Args: post_id, edits (array), snapshot_label (optional). [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'edits'          => array( 'type' => 'array', 'description' => 'Array of {id: string, field: string, value: string}.' ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'edits' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Elementor_Content::patch( (int) $a['post_id'], (array) $a['edits'], $a['snapshot_label'] ?? null );
			},
		);

		$reg['elementor_find_element'] = array(
			'desc'     => 'Search for Elementor elements matching a widget type, CSS class, or text snippet. Returns matching element ids and their context. Useful before targeted updates or moves. Args: post_id, widget_type (optional), css_class (optional), text_contains (optional). [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'post_id'      => array( 'type' => 'integer' ),
				'widget_type'  => array( 'type' => 'string', 'description' => 'Filter by widgetType (e.g. heading, button).' ),
				'css_class'    => array( 'type' => 'string', 'description' => 'Filter by custom CSS class in element settings.' ),
				'text_contains' => array( 'type' => 'string', 'description' => 'Filter by text content in settings values.' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page  = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$flat  = array();
				WPXMCP_Elementor_Bridge::flatten( $page['json'], $flat );
				$matches = array();
				foreach ( $flat as $el ) {
					if ( ! isset( $el['id'] ) ) { continue; }
					$pass = true;
					if ( isset( $a['widget_type'] ) && ( $el['widgetType'] ?? '' ) !== $a['widget_type'] ) { $pass = false; }
					if ( $pass && isset( $a['css_class'] ) ) {
						$classes = $el['settings']['css_classes'] ?? '';
						if ( false === strpos( (string) $classes, $a['css_class'] ) ) { $pass = false; }
					}
					if ( $pass && isset( $a['text_contains'] ) ) {
						$all_values = implode( ' ', array_map( 'strval', (array) ( $el['settings'] ?? array() ) ) );
						if ( false === stripos( $all_values, $a['text_contains'] ) ) { $pass = false; }
					}
					if ( $pass ) {
						$matches[] = array(
							'id'         => $el['id'],
							'elType'     => $el['elType'] ?? '',
							'widgetType' => $el['widgetType'] ?? null,
							'css_class'  => $el['settings']['css_classes'] ?? '',
						);
					}
				}
				return array( 'post_id' => (int) $a['post_id'], 'count' => count( $matches ), 'matches' => $matches );
			},
		);

		$reg['elementor_add_widget'] = array(
			'desc'     => 'Insert a new widget inside an existing container/section/column by parent element id. Args: post_id, parent_id (target container id), widget_type (e.g. heading), settings (object of widget settings), position (int, default appends), snapshot_label. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'parent_id'      => array( 'type' => 'string',  'description' => 'id of the container/section/column to insert into.' ),
				'widget_type'    => array( 'type' => 'string',  'description' => 'Elementor widget type name (e.g. heading, text-editor, button).' ),
				'settings'       => array( 'type' => 'object',  'description' => 'Widget settings object.' ),
				'position'       => array( 'type' => 'integer', 'description' => 'Index to insert at. Default appends.' ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'parent_id', 'widget_type' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page   = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data   = $page['json'];
				$parent = &WPXMCP_Elementor_Bridge::find_by_id( $data, $a['parent_id'] );
				if ( null === $parent ) {
					throw new Exception( 'Parent element "' . $a['parent_id'] . '" not found.' );
				}
				if ( ! isset( $parent['elements'] ) || ! is_array( $parent['elements'] ) ) {
					$parent['elements'] = array();
				}
				$new_id = substr( md5( uniqid( '', true ) ), 0, 8 );
				$widget = array(
					'id'         => $new_id,
					'elType'     => 'widget',
					'widgetType' => $a['widget_type'],
					'settings'   => is_array( $a['settings'] ?? null ) ? $a['settings'] : array(),
					'elements'   => array(),
				);
				if ( isset( $a['position'] ) ) {
					array_splice( $parent['elements'], (int) $a['position'], 0, array( $widget ) );
				} else {
					$parent['elements'][] = $widget;
				}
				$save = WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
				return array_merge( $save, array( 'new_element_id' => $new_id ) );
			},
		);

		$reg['elementor_add_container'] = array(
			'desc'     => 'Add a new container (Elementor Flexbox/Grid container or legacy section) at the root level or inside a parent. Args: post_id, container_type (container|section, default container), settings, position (int, default appends), parent_id (optional), snapshot_label. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'container_type' => array( 'type' => 'string',  'description' => 'container (default) or section.' ),
				'settings'       => array( 'type' => 'object',  'description' => 'Container settings.' ),
				'position'       => array( 'type' => 'integer', 'description' => 'Insert position. Default appends.' ),
				'parent_id'      => array( 'type' => 'string',  'description' => 'Optional parent container id (omit for root).' ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page        = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data        = $page['json'];
				$new_id      = substr( md5( uniqid( '', true ) ), 0, 8 );
				$ctype       = $a['container_type'] ?? 'container';
				$new_el      = array( 'id' => $new_id, 'elType' => $ctype, 'settings' => is_array( $a['settings'] ?? null ) ? $a['settings'] : array(), 'elements' => array() );
				if ( isset( $a['parent_id'] ) ) {
					$parent = &WPXMCP_Elementor_Bridge::find_by_id( $data, $a['parent_id'] );
					if ( null === $parent ) { throw new Exception( 'Parent element "' . $a['parent_id'] . '" not found.' ); }
					if ( ! isset( $parent['elements'] ) ) { $parent['elements'] = array(); }
					$target = &$parent['elements'];
				} else {
					$target = &$data;
				}
				if ( isset( $a['position'] ) ) {
					array_splice( $target, (int) $a['position'], 0, array( $new_el ) );
				} else {
					$target[] = $new_el;
				}
				$save = WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
				return array_merge( $save, array( 'new_element_id' => $new_id ) );
			},
		);

		$reg['elementor_update_element'] = array(
			'desc'     => 'Merge new settings into an existing element by id. Only provided keys are changed; the rest are untouched. Args: post_id, element_id, settings (object of keys to merge), snapshot_label. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'element_id'     => array( 'type' => 'string' ),
				'settings'       => array( 'type' => 'object', 'description' => 'Settings keys to merge into the element.' ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'element_id', 'settings' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data = $page['json'];
				$el   = &WPXMCP_Elementor_Bridge::find_by_id( $data, $a['element_id'] );
				if ( null === $el ) { throw new Exception( 'Element "' . $a['element_id'] . '" not found.' ); }
				if ( is_array( $a['settings'] ?? null ) ) {
					foreach ( $a['settings'] as $k => $v ) {
						$el['settings'][ $k ] = $v;
					}
				}
				return WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
			},
		);

		$reg['elementor_remove_element'] = array(
			'desc'     => 'Remove an element (widget, container, section) from the page by id. Args: post_id, element_id, snapshot_label. [risk: destructive]',
			'risk'     => 'destructive',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'element_id'     => array( 'type' => 'string' ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'element_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page   = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data   = $page['json'];
				$parent = null; $index = null;
				if ( ! WPXMCP_Elementor_Bridge::find_parent( $data, $a['element_id'], $parent, $index ) ) {
					throw new Exception( 'Element "' . $a['element_id'] . '" not found.' );
				}
				array_splice( $parent, $index, 1 );
				return WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
			},
		);

		$reg['elementor_duplicate_element'] = array(
			'desc'     => 'Duplicate an element (widget or container) by id and insert the copy immediately after the original. New element gets a fresh random id. Args: post_id, element_id, snapshot_label. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'element_id'     => array( 'type' => 'string' ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'element_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page   = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data   = $page['json'];
				$el     = WPXMCP_Elementor_Bridge::find_by_id( $data, $a['element_id'] );
				if ( null === $el ) { throw new Exception( 'Element "' . $a['element_id'] . '" not found.' ); }
				$copy       = $el;
				$new_id     = substr( md5( uniqid( '', true ) ), 0, 8 );
				$copy['id'] = $new_id;
				$parent = null; $index = null;
				WPXMCP_Elementor_Bridge::find_parent( $data, $a['element_id'], $parent, $index );
				array_splice( $parent, $index + 1, 0, array( $copy ) );
				$save = WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
				return array_merge( $save, array( 'new_element_id' => $new_id ) );
			},
		);

		$reg['elementor_move_element'] = array(
			'desc'     => 'Move an element to a new parent container at a specified position. Args: post_id, element_id, target_parent_id (destination container id), position (int, default appends), snapshot_label. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'          => array( 'type' => 'integer' ),
				'element_id'       => array( 'type' => 'string' ),
				'target_parent_id' => array( 'type' => 'string',  'description' => 'id of destination container.' ),
				'position'         => array( 'type' => 'integer', 'description' => 'Insert position. Default appends.' ),
				'snapshot_label'   => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'element_id', 'target_parent_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page   = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data   = $page['json'];
				$el     = WPXMCP_Elementor_Bridge::find_by_id( $data, $a['element_id'] );
				if ( null === $el ) { throw new Exception( 'Element "' . $a['element_id'] . '" not found.' ); }
				$copy = $el;
				// Remove from current parent.
				$src_parent = null; $src_idx = null;
				WPXMCP_Elementor_Bridge::find_parent( $data, $a['element_id'], $src_parent, $src_idx );
				array_splice( $src_parent, $src_idx, 1 );
				// Insert into target.
				$tgt = &WPXMCP_Elementor_Bridge::find_by_id( $data, $a['target_parent_id'] );
				if ( null === $tgt ) { throw new Exception( 'Target parent "' . $a['target_parent_id'] . '" not found.' ); }
				if ( ! isset( $tgt['elements'] ) ) { $tgt['elements'] = array(); }
				if ( isset( $a['position'] ) ) {
					array_splice( $tgt['elements'], (int) $a['position'], 0, array( $copy ) );
				} else {
					$tgt['elements'][] = $copy;
				}
				return WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
			},
		);

		$reg['elementor_reorder_children'] = array(
			'desc'     => 'Reorder the direct children of a container/section by providing a new ordered array of element ids. All ids must belong to that parent. Args: post_id, parent_id, order (array of element ids), snapshot_label. [risk: write]',
			'risk'     => 'write',
			'schema'   => array(
				'post_id'        => array( 'type' => 'integer' ),
				'parent_id'      => array( 'type' => 'string' ),
				'order'          => array( 'type' => 'array', 'description' => 'New ordered array of child element ids.', 'items' => array( 'type' => 'string' ) ),
				'snapshot_label' => array( 'type' => 'string' ),
			),
			'required' => array( 'post_id', 'parent_id', 'order' ),
			'handler'  => function ( $a ) {
				WPXMCP_Elementor_Bridge::assert_active();
				$page   = WPXMCP_Elementor_Bridge::read_page( (int) $a['post_id'] );
				$data   = $page['json'];
				$parent = &WPXMCP_Elementor_Bridge::find_by_id( $data, $a['parent_id'] );
				if ( null === $parent ) { throw new Exception( 'Parent element "' . $a['parent_id'] . '" not found.' ); }
				$children = $parent['elements'] ?? array();
				$by_id    = array();
				foreach ( $children as $child ) {
					if ( isset( $child['id'] ) ) { $by_id[ $child['id'] ] = $child; }
				}
				$new_order = array();
				foreach ( (array) $a['order'] as $id ) {
					if ( ! isset( $by_id[ $id ] ) ) { throw new Exception( 'Child id "' . $id . '" not found in parent "' . $a['parent_id'] . '".' ); }
					$new_order[] = $by_id[ $id ];
					unset( $by_id[ $id ] );
				}
				// Append any children not in the order list.
				foreach ( $by_id as $remaining ) { $new_order[] = $remaining; }
				$parent['elements'] = $new_order;
				return WPXMCP_Elementor_Bridge::apply_to_page( (int) $a['post_id'], $data, $a['snapshot_label'] ?? null );
			},
		);

		$reg['list_elementor_posts'] = array(
			'desc'     => 'List all posts/pages that are built with Elementor (_elementor_edit_mode = builder). Returns id, title, type, permalink, last modified. Args: per_page (default 50, max 200), page. [risk: read]',
			'risk'     => 'read',
			'schema'   => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 50, max 200.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Default 1.' ),
			),
			'handler'  => function ( $a ) {
				$q = new WP_Query( array(
					'post_type'      => 'any',
					'post_status'    => 'any',
					'posts_per_page' => min( (int) ( $a['per_page'] ?? 50 ), 200 ),
					'paged'          => max( 1, (int) ( $a['page'] ?? 1 ) ),
					'meta_key'       => '_elementor_edit_mode',
					'meta_value'     => 'builder',
				) );
				$items = array();
				foreach ( $q->posts as $p ) {
					$items[] = array(
						'id'        => $p->ID,
						'title'     => $p->post_title,
						'type'      => $p->post_type,
						'status'    => $p->post_status,
						'link'      => get_permalink( $p->ID ),
						'modified'  => $p->post_modified,
					);
				}
				return array(
					'total'       => (int) $q->found_posts,
					'total_pages' => (int) $q->max_num_pages,
					'items'       => $items,
				);
			},
		);

		return $reg;
	}
}
