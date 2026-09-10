<?php
/**
 * Page-builder generation tools.
 *
 *  - page_builder_status  : which builders are available (Gutenberg core, Elementor, Kadence)
 *  - gutenberg_build_page : rich native-block pages — works everywhere (Gutenberg is core)
 *  - kadence_build_page   : Kadence Blocks layout (requires Kadence Blocks active)
 *
 * All three accept the SAME "sections" spec already used by elementor_build_page,
 * extended with visual blocks: hero (cover), columns, media_text, list, quote, gallery.
 * Block spec examples:
 *   {"type":"hero","heading":"..","text":"..","image":"URL","overlay":50,"button":{"text":"..","link":".."}}
 *   {"type":"heading","text":"..","level":2}
 *   {"type":"text","text":"<p>..</p>"}
 *   {"type":"image","url":"URL","alt":"..","sideload":true}
 *   {"type":"buttons","buttons":[{"text":"..","link":".."}]}
 *   {"type":"columns","columns":[{"heading":"..","text":"..","image":"URL","button":{...}}]}
 *   {"type":"media_text","image":"URL","heading":"..","text":"..","position":"left"}
 *   {"type":"list","items":["..",".."],"ordered":false}
 *   {"type":"quote","text":"..","cite":".."}
 *   {"type":"spacer","height":40}  | {"type":"divider"}
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_PageBuilder {

	/** Sideload an image URL into the media library, return [id,url]; fall back to the raw URL. */
	private static function image( string $url, bool $sideload, int $parent = 0 ): array {
		$url = esc_url_raw( $url );
		if ( ! $url ) {
			return array( 'id' => 0, 'url' => '' );
		}
		if ( $sideload ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
			$id = media_sideload_image( $url, $parent, null, 'id' );
			if ( ! is_wp_error( $id ) ) {
				return array( 'id' => (int) $id, 'url' => wp_get_attachment_url( $id ) ?: $url );
			}
		}
		return array( 'id' => 0, 'url' => $url );
	}

	/** Wrap plain text in a paragraph; leave existing HTML alone. */
	private static function as_html( string $t ): string {
		$t = trim( $t );
		if ( '' === $t ) {
			return '';
		}
		return ( '<' === substr( $t, 0, 1 ) ) ? $t : '<p>' . esc_html( $t ) . '</p>';
	}

	/** Persist the page and return urls. */
	private static function save_page( array $a, string $content, array $meta = array() ): array {
		$postarr = array(
			'post_title'   => sanitize_text_field( $a['title'] ?? 'Untitled' ),
			'post_status'  => in_array( ( $a['status'] ?? 'draft' ), array( 'publish', 'draft', 'pending', 'private' ), true ) ? $a['status'] : 'draft',
			'post_type'    => 'page',
			'post_content' => $content,
		);
		if ( ! empty( $a['page_id'] ) ) {
			$postarr['ID'] = (int) $a['page_id'];
			$id            = wp_update_post( $postarr, true );
		} else {
			$id = wp_insert_post( $postarr, true );
		}
		if ( is_wp_error( $id ) ) {
			throw new Exception( $id->get_error_message() );
		}
		foreach ( $meta as $k => $v ) {
			update_post_meta( $id, $k, $v );
		}
		return array(
			'page_id'  => $id,
			'edit_url' => admin_url( 'post.php?post=' . $id . '&action=edit' ),
			'view_url' => get_permalink( $id ),
			'status'   => get_post_status( $id ),
		);
	}

	// =====================================================================
	// GUTENBERG (core blocks — always available)
	// =====================================================================
	private static function gb_blocks( array $sections, int $parent = 0 ): string {
		$out = '';
		foreach ( (array) $sections as $b ) {
			$type = $b['type'] ?? 'text';
			switch ( $type ) {

				case 'hero':
				case 'cover':
					$img     = self::image( (string) ( $b['image'] ?? '' ), ! empty( $b['sideload'] ), $parent );
					$overlay = (int) ( $b['overlay'] ?? 50 );
					$inner   = '';
					if ( ! empty( $b['heading'] ) ) {
						$inner .= '<!-- wp:heading {"level":1,"textColor":"white"} --><h1 class="wp-block-heading has-white-color has-text-color">' . esc_html( $b['heading'] ) . '</h1><!-- /wp:heading -->';
					}
					if ( ! empty( $b['text'] ) ) {
						$inner .= '<!-- wp:paragraph {"textColor":"white"} --><p class="has-white-color has-text-color">' . esc_html( $b['text'] ) . '</p><!-- /wp:paragraph -->';
					}
					if ( ! empty( $b['button']['text'] ) ) {
						$inner .= self::gb_buttons( array( $b['button'] ) );
					}
					$bg = $img['url'] ? ' style="background-image:url(' . esc_url( $img['url'] ) . ')"' : '';
					$attrs = array( 'dimRatio' => $overlay, 'minHeight' => (int) ( $b['min_height'] ?? 420 ), 'minHeightUnit' => 'px', 'align' => 'full' );
					if ( $img['url'] ) {
						$attrs['url'] = $img['url'];
					}
					if ( $img['id'] ) {
						$attrs['id'] = $img['id'];
					}
					$out .= '<!-- wp:cover ' . wp_json_encode( $attrs ) . ' -->'
						. '<div class="wp-block-cover alignfull" style="min-height:' . (int) ( $b['min_height'] ?? 420 ) . 'px">'
						. '<span aria-hidden="true" class="wp-block-cover__background has-background-dim-' . $overlay . ' has-background-dim"></span>'
						. ( $img['url'] ? '<img class="wp-block-cover__image-background' . ( $img['id'] ? ' wp-image-' . $img['id'] : '' ) . '" alt="" src="' . esc_url( $img['url'] ) . '" data-object-fit="cover"/>' : '' )
						. '<div class="wp-block-cover__inner-container">' . $inner . '</div></div>'
						. '<!-- /wp:cover -->';
					break;

				case 'heading':
					$lvl  = max( 1, min( 6, (int) ( $b['level'] ?? 2 ) ) );
					$attr = 2 === $lvl ? '' : ' {"level":' . $lvl . '}';
					$out .= '<!-- wp:heading' . $attr . ' --><h' . $lvl . ' class="wp-block-heading">' . esc_html( $b['text'] ?? '' ) . '</h' . $lvl . '><!-- /wp:heading -->';
					break;

				case 'text':
				case 'paragraph':
					$html = self::as_html( (string) ( $b['text'] ?? '' ) );
					// Split into individual paragraph blocks if multiple <p> supplied.
					if ( preg_match_all( '/<p\b[^>]*>.*?<\/p>/is', $html, $m ) && count( $m[0] ) ) {
						foreach ( $m[0] as $p ) {
							$out .= '<!-- wp:paragraph -->' . $p . '<!-- /wp:paragraph -->';
						}
					} else {
						$out .= '<!-- wp:paragraph -->' . $html . '<!-- /wp:paragraph -->';
					}
					break;

				case 'image':
					$img = self::image( (string) ( $b['url'] ?? '' ), ! empty( $b['sideload'] ), $parent );
					if ( ! $img['url'] ) {
						break;
					}
					$cls  = $img['id'] ? ' {"id":' . $img['id'] . ',"sizeSlug":"large"}' : '';
					$imgc = $img['id'] ? ' class="wp-image-' . $img['id'] . '"' : '';
					$out .= '<!-- wp:image' . $cls . ' --><figure class="wp-block-image size-large"><img src="' . esc_url( $img['url'] ) . '" alt="' . esc_attr( $b['alt'] ?? '' ) . '"' . $imgc . '/></figure><!-- /wp:image -->';
					break;

				case 'button':
					$out .= self::gb_buttons( array( $b ) );
					break;
				case 'buttons':
					$out .= self::gb_buttons( (array) ( $b['buttons'] ?? array() ) );
					break;

				case 'columns':
					$cols = (array) ( $b['columns'] ?? array() );
					$out .= '<!-- wp:columns --><div class="wp-block-columns">';
					foreach ( $cols as $col ) {
						$stack = array();
						if ( ! empty( $col['image'] ) ) {
							$stack[] = array( 'type' => 'image', 'url' => $col['image'], 'alt' => $col['alt'] ?? '', 'sideload' => ! empty( $col['sideload'] ) );
						}
						if ( ! empty( $col['heading'] ) ) {
							$stack[] = array( 'type' => 'heading', 'text' => $col['heading'], 'level' => (int) ( $col['level'] ?? 3 ) );
						}
						if ( ! empty( $col['text'] ) ) {
							$stack[] = array( 'type' => 'text', 'text' => $col['text'] );
						}
						if ( ! empty( $col['button']['text'] ) ) {
							$stack[] = array( 'type' => 'buttons', 'buttons' => array( $col['button'] ) );
						}
						$out .= '<!-- wp:column --><div class="wp-block-column">' . self::gb_blocks( $stack, $parent ) . '</div><!-- /wp:column -->';
					}
					$out .= '</div><!-- /wp:columns -->';
					break;

				case 'media_text':
					$img = self::image( (string) ( $b['image'] ?? '' ), ! empty( $b['sideload'] ), $parent );
					$pos = ( 'right' === ( $b['position'] ?? 'left' ) ) ? 'right' : 'left';
					$body = '';
					if ( ! empty( $b['heading'] ) ) {
						$body .= '<!-- wp:heading --><h2 class="wp-block-heading">' . esc_html( $b['heading'] ) . '</h2><!-- /wp:heading -->';
					}
					if ( ! empty( $b['text'] ) ) {
						$body .= '<!-- wp:paragraph -->' . self::as_html( (string) $b['text'] ) . '<!-- /wp:paragraph -->';
					}
					if ( ! empty( $b['button']['text'] ) ) {
						$body .= self::gb_buttons( array( $b['button'] ) );
					}
					$attr = array( 'mediaType' => 'image', 'mediaPosition' => $pos );
					if ( $img['id'] ) {
						$attr['mediaId'] = $img['id'];
					}
					$cls = 'wp-block-media-text' . ( 'right' === $pos ? ' has-media-on-the-right' : '' ) . ' is-stacked-on-mobile';
					$out .= '<!-- wp:media-text ' . wp_json_encode( $attr ) . ' -->'
						. '<div class="' . $cls . '"><figure class="wp-block-media-text__media"><img src="' . esc_url( $img['url'] ) . '" alt="' . esc_attr( $b['alt'] ?? '' ) . '"' . ( $img['id'] ? ' class="wp-image-' . $img['id'] . '"' : '' ) . '/></figure>'
						. '<div class="wp-block-media-text__content">' . $body . '</div></div>'
						. '<!-- /wp:media-text -->';
					break;

				case 'list':
					$items = '';
					foreach ( (array) ( $b['items'] ?? array() ) as $it ) {
						$items .= '<!-- wp:list-item --><li>' . esc_html( $it ) . '</li><!-- /wp:list-item -->';
					}
					$ordered = ! empty( $b['ordered'] );
					$tag     = $ordered ? 'ol' : 'ul';
					$out    .= '<!-- wp:list' . ( $ordered ? ' {"ordered":true}' : '' ) . ' --><' . $tag . ' class="wp-block-list">' . $items . '</' . $tag . '><!-- /wp:list -->';
					break;

				case 'quote':
					$out .= '<!-- wp:quote --><blockquote class="wp-block-quote"><p>' . esc_html( $b['text'] ?? '' ) . '</p>'
						. ( ! empty( $b['cite'] ) ? '<cite>' . esc_html( $b['cite'] ) . '</cite>' : '' )
						. '</blockquote><!-- /wp:quote -->';
					break;

				case 'spacer':
					$h    = (int) ( $b['height'] ?? 40 );
					$out .= '<!-- wp:spacer {"height":"' . $h . 'px"} --><div style="height:' . $h . 'px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->';
					break;

				case 'divider':
				case 'separator':
					$out .= '<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->';
					break;

				case 'two_columns': // back-compat with elementor_build_page spec
					$out .= '<!-- wp:columns --><div class="wp-block-columns">'
						. '<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph -->' . self::as_html( (string) ( $b['left'] ?? '' ) ) . '<!-- /wp:paragraph --></div><!-- /wp:column -->'
						. '<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph -->' . self::as_html( (string) ( $b['right'] ?? '' ) ) . '<!-- /wp:paragraph --></div><!-- /wp:column -->'
						. '</div><!-- /wp:columns -->';
					break;
			}
		}
		return $out;
	}

	private static function gb_buttons( array $buttons ): string {
		$inner = '';
		foreach ( $buttons as $btn ) {
			if ( empty( $btn['text'] ) ) {
				continue;
			}
			$inner .= '<!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="' . esc_url( $btn['link'] ?? '#' ) . '">' . esc_html( $btn['text'] ) . '</a></div><!-- /wp:button -->';
		}
		return $inner ? '<!-- wp:buttons --><div class="wp-block-buttons">' . $inner . '</div><!-- /wp:buttons -->' : '';
	}

	// =====================================================================
	// KADENCE BLOCKS (requires the Kadence Blocks plugin)
	// =====================================================================
	private static function kb_uid(): string {
		return wp_rand( 100, 999 ) . '_' . substr( md5( uniqid( (string) wp_rand(), true ) ), 0, 6 ) . '-' . wp_rand( 10, 99 );
	}

	/**
	 * Kadence layout: wrap each section in a kadence/rowlayout + column, and place
	 * reliable inner blocks (kadence/advancedheading for headings, core blocks for the
	 * rest). This renders correctly on the front end and stays editable in Kadence.
	 */
	private static function kb_blocks( array $sections, int $parent = 0 ): string {
		$out = '';
		foreach ( (array) $sections as $b ) {
			$uid_row = self::kb_uid();
			$uid_col = self::kb_uid();
			$inner   = '';

			$type = $b['type'] ?? 'text';
			if ( 'heading' === $type || 'hero' === $type ) {
				$lvl   = 'hero' === $type ? 1 : max( 1, min( 6, (int) ( $b['level'] ?? 2 ) ) );
				$txt   = $b['heading'] ?? ( $b['text'] ?? '' );
				$uid_h = self::kb_uid();
				$inner .= '<!-- wp:kadence/advancedheading {"uniqueID":"' . $uid_h . '","level":' . $lvl . '} --><h' . $lvl . ' class="kt-adv-heading' . $uid_h . ' wp-block-kadence-advancedheading">' . esc_html( $txt ) . '</h' . $lvl . '><!-- /wp:kadence/advancedheading -->';
				if ( 'hero' === $type && ! empty( $b['text'] ) ) {
					$inner .= '<!-- wp:paragraph -->' . self::as_html( (string) $b['text'] ) . '<!-- /wp:paragraph -->';
				}
				if ( ! empty( $b['button']['text'] ) ) {
					$inner .= self::gb_buttons( array( $b['button'] ) );
				}
			} else {
				// Reuse the (reliable) Gutenberg renderer for the inner content.
				$inner = self::gb_blocks( array( $b ), $parent );
			}

			$row_attr = array( 'uniqueID' => $uid_row, 'columns' => 1, 'colLayout' => 'equal' );
			$out .= '<!-- wp:kadence/rowlayout ' . wp_json_encode( $row_attr ) . ' -->'
				. '<div class="wp-block-kadence-rowlayout alignnone"><div id="kt-layout-id' . $uid_row . '" class="kt-row-layout-inner kt-row-has-bg kt-layout-id' . $uid_row . '">'
				. '<!-- wp:kadence/column {"uniqueID":"' . $uid_col . '"} -->'
				. '<div class="wp-block-kadence-column kadence-column' . $uid_col . '"><div class="kt-inside-inner-col">' . $inner . '</div></div>'
				. '<!-- /wp:kadence/column --></div></div>'
				. '<!-- /wp:kadence/rowlayout -->';
		}
		return $out;
	}

	public static function all(): array {
		$reg = array();

		$reg['page_builder_status'] = array(
			'desc'    => 'Report which page builders are available so the client knows which *_build_page tools will work: Gutenberg (always, core), Elementor (free), and Kadence Blocks.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function () {
				return array(
					'gutenberg' => array( 'available' => true, 'note' => 'Core block editor — always works.' ),
					'elementor' => array( 'available' => defined( 'ELEMENTOR_VERSION' ), 'version' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null ),
					'kadence_blocks' => array( 'available' => ( defined( 'KADENCE_BLOCKS_VERSION' ) || class_exists( 'Kadence_Blocks_Frontend' ) ) ),
				);
			},
		);

		$reg['gutenberg_build_page'] = array(
			'desc'     => 'Build a beautiful page with native Gutenberg blocks — works on ANY WordPress site (no builder plugin needed). Pass "sections": an ordered array of blocks. Supports hero (full-width cover with background image, heading, text, button), heading, text, image, buttons, columns (cards with image+heading+text+button), media_text (image beside text), list, quote, spacer, divider. Set "sideload":true on any image to import it into the media library. Returns edit + view URLs.',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string' ),
				'page_id'  => array( 'type' => 'integer', 'description' => 'Existing page to overwrite. Omit to create new.' ),
				'status'   => array( 'type' => 'string', 'description' => 'publish | draft. Default draft.' ),
				'sections' => array( 'type' => 'array', 'description' => 'Ordered block spec (see description). e.g. [{"type":"hero","heading":"..","image":"URL","button":{"text":"Shop","link":"/shop"}},{"type":"columns","columns":[{"heading":"Fast","text":".."}]}]' ),
			),
			'required' => array( 'title', 'sections' ),
			'handler'  => function ( $a ) {
				$parent  = (int) ( $a['page_id'] ?? 0 );
				$content = self::gb_blocks( (array) $a['sections'], $parent );
				if ( '' === trim( $content ) ) {
					throw new Exception( 'No renderable sections were produced. Check the block spec.' );
				}
				$res            = self::save_page( $a, $content );
				$res['builder'] = 'gutenberg';
				$res['blocks']  = substr_count( $content, '<!-- wp:' );
				return $res;
			},
		);

		$reg['kadence_build_page'] = array(
			'desc'     => 'Build a page using Kadence Blocks row layouts (requires the free Kadence Blocks plugin). Uses the SAME sections spec as gutenberg_build_page; each section is wrapped in a Kadence row/column with a Kadence advanced heading, with reliable core blocks inside. Returns edit + view URLs.',
			'risk'     => 'write',
			'schema'   => array(
				'title'    => array( 'type' => 'string' ),
				'page_id'  => array( 'type' => 'integer' ),
				'status'   => array( 'type' => 'string', 'description' => 'publish | draft. Default draft.' ),
				'sections' => array( 'type' => 'array', 'description' => 'Same block spec as gutenberg_build_page.' ),
			),
			'required' => array( 'title', 'sections' ),
			'handler'  => function ( $a ) {
				if ( ! defined( 'KADENCE_BLOCKS_VERSION' ) && ! class_exists( 'Kadence_Blocks_Frontend' ) ) {
					throw new Exception( 'Kadence Blocks is not active. Install the free Kadence Blocks plugin, or use gutenberg_build_page (works everywhere).' );
				}
				$parent  = (int) ( $a['page_id'] ?? 0 );
				$content = self::kb_blocks( (array) $a['sections'], $parent );
				if ( '' === trim( $content ) ) {
					throw new Exception( 'No renderable sections were produced. Check the block spec.' );
				}
				$res            = self::save_page( $a, $content );
				$res['builder'] = 'kadence';
				$res['rows']    = substr_count( $content, 'wp:kadence/rowlayout' );
				return $res;
			},
		);

		return $reg;
	}
}
