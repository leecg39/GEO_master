<?php
/**
 * WooCommerce Product tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's WooCommerce Product tool set into
 * wp-x-mcp's procedural tool registry style: products listing/batch/low-stock,
 * categories, tags, brands (requires WooCommerce Brands extension), global
 * attributes + terms, variations, reviews, and stock management.
 *
 * SKIPPED (3 collisions — existing tools-woo-commerce.php keeps these):
 *   wc_create_product, wc_update_product, wc_delete_product
 * Note: this file's wc_get_low_stock_products differs from the existing
 * wc_low_stock_report (different shape/threshold logic) — both kept.
 *
 * 34 tools register only when WooCommerce is active. Brand tools additionally
 * runtime-check for the product_brand taxonomy (WooCommerce Brands extension).
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Woo_Products {

	public static function is_active(): bool {
		if ( class_exists( 'WooCommerce' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'woocommerce/woocommerce.php' );
	}

	/* -------------------------------------------------------------------------
	 * Formatters / helpers.
	 * ---------------------------------------------------------------------- */

	public static function format_product( \WC_Product $p ): array {
		$cat_terms = get_the_terms( $p->get_id(), 'product_cat' ) ?: array();
		$tag_terms = get_the_terms( $p->get_id(), 'product_tag' ) ?: array();

		$categories = array_map( function ( $t ) {
			return array( 'id' => $t->term_id, 'name' => $t->name, 'slug' => $t->slug );
		}, $cat_terms );
		$tags = array_map( function ( $t ) {
			return array( 'id' => $t->term_id, 'name' => $t->name, 'slug' => $t->slug );
		}, $tag_terms );

		$product_id       = $p->get_id();
		$global_unique_id = method_exists( $p, 'get_global_unique_id' )
			? $p->get_global_unique_id()
			: get_post_meta( $product_id, '_global_unique_id', true );

		$created  = $p->get_date_created();
		$modified = $p->get_date_modified();

		return array(
			'id'                => $product_id,
			'name'              => $p->get_name(),
			'slug'              => $p->get_slug(),
			'type'              => $p->get_type(),
			'status'            => $p->get_status(),
			'description'       => $p->get_description(),
			'sku'               => $p->get_sku(),
			'global_unique_id'  => $global_unique_id ?: null,
			'price'             => $p->get_price(),
			'regular_price'     => $p->get_regular_price(),
			'sale_price'        => $p->get_sale_price(),
			'stock_status'      => $p->get_stock_status(),
			'stock_quantity'    => $p->get_stock_quantity(),
			'manage_stock'      => $p->get_manage_stock(),
			'low_stock_amount'  => $p->get_low_stock_amount(),
			'backorders'        => $p->get_backorders(),
			'sold_individually' => $p->get_sold_individually(),
			'weight'            => $p->get_weight(),
			'dimensions'        => array(
				'length' => $p->get_length(),
				'width'  => $p->get_width(),
				'height' => $p->get_height(),
			),
			'shipping_class_id' => $p->get_shipping_class_id(),
			'upsell_ids'        => $p->get_upsell_ids(),
			'cross_sell_ids'    => $p->get_cross_sell_ids(),
			'categories'        => array_values( $categories ),
			'tags'              => array_values( $tags ),
			'permalink'         => get_permalink( $product_id ),
			'date_created'      => $created ? $created->date( 'Y-m-d H:i:s' ) : null,
			'date_modified'     => $modified ? $modified->date( 'Y-m-d H:i:s' ) : null,
		);
	}

	public static function format_term( \WP_Term $t ): array {
		return array(
			'id'          => $t->term_id,
			'name'        => $t->name,
			'slug'        => $t->slug,
			'parent'      => $t->parent,
			'description' => $t->description,
			'count'       => $t->count,
		);
	}

	public static function format_brand( \WP_Term $t ): array {
		$thumb_id = (int) get_term_meta( $t->term_id, 'thumbnail_id', true );
		return array(
			'id'            => $t->term_id,
			'name'          => $t->name,
			'slug'          => $t->slug,
			'parent'        => $t->parent,
			'description'   => $t->description,
			'count'         => $t->count,
			'thumbnail_id'  => $thumb_id ?: null,
			'thumbnail_url' => $thumb_id ? wp_get_attachment_url( $thumb_id ) : null,
		);
	}

	public static function format_attribute( $a ): array {
		return array(
			'id'           => (int) $a->attribute_id,
			'name'         => $a->attribute_label,
			'slug'         => $a->attribute_name,
			'type'         => $a->attribute_type,
			'order_by'     => $a->attribute_orderby,
			'has_archives' => (bool) $a->attribute_public,
		);
	}

	public static function format_attribute_term( \WP_Term $t ): array {
		return array(
			'id'          => $t->term_id,
			'name'        => $t->name,
			'slug'        => $t->slug,
			'description' => $t->description,
			'count'       => $t->count,
		);
	}

	public static function format_variation( \WC_Product_Variation $v ): array {
		return array(
			'id'             => $v->get_id(),
			'product_id'     => $v->get_parent_id(),
			'sku'            => $v->get_sku(),
			'price'          => $v->get_price(),
			'regular_price'  => $v->get_regular_price(),
			'sale_price'     => $v->get_sale_price(),
			'stock_status'   => $v->get_stock_status(),
			'stock_quantity' => $v->get_stock_quantity(),
			'manage_stock'   => $v->get_manage_stock(),
			'weight'         => $v->get_weight(),
			'status'         => $v->get_status(),
			'attributes'     => $v->get_variation_attributes(),
		);
	}

	public static function format_review( \WP_Comment $c ): array {
		return array(
			'id'           => (int) $c->comment_ID,
			'product_id'   => (int) $c->comment_post_ID,
			'author'       => $c->comment_author,
			'author_email' => $c->comment_author_email,
			'content'      => $c->comment_content,
			'rating'       => (int) get_comment_meta( $c->comment_ID, 'rating', true ),
			'date'         => $c->comment_date,
			'status'       => wp_get_comment_status( $c->comment_ID ),
		);
	}

	public static function check_brand_taxonomy(): void {
		if ( ! taxonomy_exists( 'product_brand' ) ) {
			throw new Exception( 'The product_brand taxonomy is not registered. Please activate the WooCommerce Brands extension.' );
		}
	}

	public static function get_attribute_by_id( int $attribute_id ) {
		foreach ( wc_get_attribute_taxonomies() as $attribute ) {
			if ( (int) $attribute->attribute_id === $attribute_id ) {
				return $attribute;
			}
		}
		return null;
	}

	public static function apply_stock_args( \WC_Product $product, array $a ): void {
		if ( isset( $a['stock_status'] ) )     $product->set_stock_status( sanitize_key( $a['stock_status'] ) );
		if ( isset( $a['manage_stock'] ) )      $product->set_manage_stock( (bool) $a['manage_stock'] );
		if ( isset( $a['stock_quantity'] ) )    $product->set_stock_quantity( (int) $a['stock_quantity'] );
		if ( isset( $a['low_stock_amount'] ) )  $product->set_low_stock_amount( (int) $a['low_stock_amount'] );
		if ( isset( $a['backorders'] ) )         $product->set_backorders( sanitize_key( $a['backorders'] ) );
	}

	public static function apply_extended_args( \WC_Product $product, array $a ): void {
		if ( isset( $a['sold_individually'] ) ) $product->set_sold_individually( (bool) $a['sold_individually'] );
		if ( isset( $a['weight'] ) )             $product->set_weight( sanitize_text_field( $a['weight'] ) );
		if ( isset( $a['length'] ) )             $product->set_length( sanitize_text_field( $a['length'] ) );
		if ( isset( $a['width'] ) )              $product->set_width( sanitize_text_field( $a['width'] ) );
		if ( isset( $a['height'] ) )             $product->set_height( sanitize_text_field( $a['height'] ) );
		if ( isset( $a['shipping_class_id'] ) )  $product->set_shipping_class_id( absint( $a['shipping_class_id'] ) );
		if ( isset( $a['upsell_ids'] ) && is_array( $a['upsell_ids'] ) )         $product->set_upsell_ids( array_map( 'absint', $a['upsell_ids'] ) );
		if ( isset( $a['cross_sell_ids'] ) && is_array( $a['cross_sell_ids'] ) ) $product->set_cross_sell_ids( array_map( 'absint', $a['cross_sell_ids'] ) );
	}

	public static function apply_global_unique_id( int $product_id, \WC_Product $product, array $a ): void {
		if ( ! isset( $a['global_unique_id'] ) ) {
			return;
		}
		$value = sanitize_text_field( $a['global_unique_id'] );
		if ( method_exists( $product, 'set_global_unique_id' ) ) {
			$product->set_global_unique_id( $value );
			$product->save();
		} else {
			update_post_meta( $product_id, '_global_unique_id', $value );
		}
	}

	public static function apply_variation_args( \WC_Product_Variation $v, array $a ): void {
		if ( isset( $a['sku'] ) )            $v->set_sku( sanitize_text_field( $a['sku'] ) );
		if ( isset( $a['regular_price'] ) )   $v->set_regular_price( sanitize_text_field( $a['regular_price'] ) );
		if ( isset( $a['sale_price'] ) )      $v->set_sale_price( sanitize_text_field( $a['sale_price'] ) );
		if ( isset( $a['stock_quantity'] ) )  $v->set_stock_quantity( (int) $a['stock_quantity'] );
		if ( isset( $a['manage_stock'] ) )    $v->set_manage_stock( (bool) $a['manage_stock'] );
		if ( isset( $a['stock_status'] ) )    $v->set_stock_status( sanitize_key( $a['stock_status'] ) );
		if ( isset( $a['weight'] ) )          $v->set_weight( sanitize_text_field( $a['weight'] ) );
		if ( isset( $a['status'] ) )          $v->set_status( sanitize_key( $a['status'] ) );
		if ( isset( $a['attributes'] ) && is_array( $a['attributes'] ) ) {
			$clean = array();
			foreach ( $a['attributes'] as $k => $val ) {
				$clean[ sanitize_key( $k ) ] = sanitize_text_field( $val );
			}
			$v->set_attributes( $clean );
		}
	}

	/** Shared update logic for wc_update_product (this file's variant) and batch. */
	public static function apply_product_update( array $a ): array {
		$product_id = absint( $a['product_id'] );
		$product    = wc_get_product( $product_id );
		if ( ! $product ) {
			throw new Exception( 'Product not found.' );
		}

		if ( isset( $a['name'] ) )           $product->set_name( sanitize_text_field( $a['name'] ) );
		if ( isset( $a['description'] ) )     $product->set_description( wp_kses_post( $a['description'] ) );
		if ( isset( $a['status'] ) )          $product->set_status( sanitize_key( $a['status'] ) );
		if ( isset( $a['sku'] ) )             $product->set_sku( sanitize_text_field( $a['sku'] ) );
		if ( isset( $a['regular_price'] ) )    $product->set_regular_price( sanitize_text_field( $a['regular_price'] ) );
		if ( isset( $a['sale_price'] ) )       $product->set_sale_price( sanitize_text_field( $a['sale_price'] ) );
		if ( isset( $a['categories'] ) && is_array( $a['categories'] ) ) $product->set_category_ids( array_map( 'absint', $a['categories'] ) );
		if ( isset( $a['tags'] ) && is_array( $a['tags'] ) )             $product->set_tag_ids( array_map( 'absint', $a['tags'] ) );

		self::apply_stock_args( $product, $a );
		self::apply_extended_args( $product, $a );

		$product->save();
		self::apply_global_unique_id( $product_id, $product, $a );

		return array(
			'success' => true,
			'message' => 'Product updated successfully.',
			'product' => self::format_product( wc_get_product( $product_id ) ),
		);
	}

	/* -------------------------------------------------------------------------
	 * Registry.
	 * ---------------------------------------------------------------------- */

	public static function all(): array {
		if ( ! self::is_active() ) {
			return array();
		}

		$reg = array();

		// ============================================================
		// Products (2 read-only + low-stock; create/update/delete
		// collide with existing tools and are intentionally skipped)
		// ============================================================

		$reg['wc_get_products'] = array(
			'desc'    => 'List WooCommerce products with filters: search, status, category, tag, type, sku.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Products per page. Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'search'   => array( 'type' => 'string', 'description' => 'Search term.' ),
				'status'   => array( 'type' => 'string', 'description' => 'Product status. Default publish.' ),
				'category' => array( 'type' => 'string', 'description' => 'Category slug.' ),
				'tag'      => array( 'type' => 'string', 'description' => 'Tag slug.' ),
				'type'     => array( 'type' => 'string', 'description' => 'simple | variable | grouped | external.' ),
				'sku'      => array( 'type' => 'string', 'description' => 'Filter by SKU.' ),
			),
			'handler' => function ( $a ) {
				$qa = array(
					'limit'  => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10,
					'page'   => isset( $a['page'] ) ? absint( $a['page'] ) : 1,
					'status' => isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'publish',
					'return' => 'objects',
				);
				if ( isset( $a['search'] ) )    $qa['s']        = sanitize_text_field( $a['search'] );
				if ( isset( $a['category'] ) )   $qa['category'] = array( sanitize_key( $a['category'] ) );
				if ( isset( $a['tag'] ) )        $qa['tag']      = array( sanitize_key( $a['tag'] ) );
				if ( isset( $a['type'] ) )       $qa['type']     = sanitize_key( $a['type'] );
				if ( isset( $a['sku'] ) )        $qa['sku']      = sanitize_text_field( $a['sku'] );

				$products = wc_get_products( $qa );
				return array(
					'products' => array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_product' ), $products ),
					'total'    => count( $products ),
				);
			},
		);

		$reg['wc_batch_update_products'] = array(
			'desc'     => 'Batch update multiple WooCommerce products. Each update object needs product_id plus fields to change.',
			'risk'     => 'write',
			'schema'   => array(
				'updates' => array( 'type' => 'array', 'description' => 'Array of update objects; each must include product_id.' ),
			),
			'required' => array( 'updates' ),
			'handler'  => function ( $a ) {
				$results = array();
				foreach ( $a['updates'] as $update ) {
					if ( ! isset( $update['product_id'] ) ) {
						$results[] = array( 'success' => false, 'error' => 'Missing product_id.' );
						continue;
					}
					try {
						WPXMCP_Tools_Woo_Products::apply_product_update( $update );
						$results[] = array( 'product_id' => absint( $update['product_id'] ), 'success' => true );
					} catch ( Exception $e ) {
						$results[] = array(
							'product_id' => absint( $update['product_id'] ),
							'success'    => false,
							'error'      => $e->getMessage(),
						);
					}
				}
				return array( 'results' => $results );
			},
		);

		$reg['wc_get_low_stock_products'] = array(
			'desc'    => 'Get in-stock, stock-managed products at or below a quantity threshold (defaults to the WooCommerce low-stock setting).',
			'risk'    => 'read',
			'schema'  => array(
				'threshold' => array( 'type' => 'integer', 'description' => 'Stock threshold. Defaults to the WooCommerce low-stock amount setting.' ),
			),
			'handler' => function ( $a ) {
				$threshold = isset( $a['threshold'] ) ? absint( $a['threshold'] ) : absint( get_option( 'woocommerce_notify_low_stock_amount', 2 ) );

				$products = wc_get_products( array(
					'manage_stock' => true,
					'stock_status' => 'instock',
					'limit'        => -1,
					'return'       => 'objects',
				) );

				$low = array_filter( $products, function ( $p ) use ( $threshold ) {
					$qty = $p->get_stock_quantity();
					return null !== $qty && $qty <= $threshold;
				} );

				return array(
					'threshold' => $threshold,
					'products'  => array_values( array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_product' ), $low ) ),
					'total'     => count( $low ),
				);
			},
		);

		// ============================================================
		// Categories (4)
		// ============================================================

		$reg['wc_get_product_categories'] = array(
			'desc'    => 'List WooCommerce product categories.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page'   => array( 'type' => 'integer', 'description' => 'Items per page. Default 10.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'search'     => array( 'type' => 'string', 'description' => 'Search term.' ),
				'hide_empty' => array( 'type' => 'boolean', 'description' => 'Hide categories with no products. Default false.' ),
			),
			'handler' => function ( $a ) {
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$hide     = ! empty( $a['hide_empty'] );

				$ta = array(
					'taxonomy'   => 'product_cat',
					'number'     => $per_page,
					'offset'     => ( $page - 1 ) * $per_page,
					'hide_empty' => $hide,
				);
				if ( isset( $a['search'] ) ) $ta['search'] = sanitize_text_field( $a['search'] );

				$terms = get_terms( $ta );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				$ca = $ta;
				$ca['fields'] = 'count';
				unset( $ca['number'], $ca['offset'] );
				$total = (int) get_terms( $ca );

				return array(
					'categories' => array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_term' ), $terms ),
					'total'      => $total,
				);
			},
		);

		$reg['wc_create_product_category'] = array(
			'desc'     => 'Create a WooCommerce product category.',
			'risk'     => 'write',
			'schema'   => array(
				'name'        => array( 'type' => 'string', 'description' => 'Category name.' ),
				'slug'        => array( 'type' => 'string', 'description' => 'Category slug.' ),
				'parent'      => array( 'type' => 'integer', 'description' => 'Parent category ID.' ),
				'description' => array( 'type' => 'string', 'description' => 'Category description.' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$ta = array();
				if ( isset( $a['slug'] ) )        $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['parent'] ) )       $ta['parent'] = absint( $a['parent'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_insert_term( sanitize_text_field( $a['name'] ), 'product_cat', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array(
					'success'  => true,
					'message'  => 'Category created successfully.',
					'category' => WPXMCP_Tools_Woo_Products::format_term( get_term( $result['term_id'], 'product_cat' ) ),
				);
			},
		);

		$reg['wc_update_product_category'] = array(
			'desc'     => 'Update a WooCommerce product category.',
			'risk'     => 'write',
			'schema'   => array(
				'category_id' => array( 'type' => 'integer', 'description' => 'Category ID.' ),
				'name'        => array( 'type' => 'string', 'description' => 'Category name.' ),
				'slug'        => array( 'type' => 'string', 'description' => 'Category slug.' ),
				'parent'      => array( 'type' => 'integer', 'description' => 'Parent category ID.' ),
				'description' => array( 'type' => 'string', 'description' => 'Category description.' ),
			),
			'required' => array( 'category_id' ),
			'handler'  => function ( $a ) {
				$id = absint( $a['category_id'] );
				$ta = array();
				if ( isset( $a['name'] ) )        $ta['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['slug'] ) )         $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['parent'] ) )       $ta['parent'] = absint( $a['parent'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_update_term( $id, 'product_cat', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array(
					'success'  => true,
					'message'  => 'Category updated successfully.',
					'category' => WPXMCP_Tools_Woo_Products::format_term( get_term( $id, 'product_cat' ) ),
				);
			},
		);

		$reg['wc_delete_product_category'] = array(
			'desc'     => 'Delete a WooCommerce product category.',
			'risk'     => 'destructive',
			'schema'   => array(
				'category_id' => array( 'type' => 'integer', 'description' => 'Category ID.' ),
			),
			'required' => array( 'category_id' ),
			'handler'  => function ( $a ) {
				$result = wp_delete_term( absint( $a['category_id'] ), 'product_cat' );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete category.' );
				}
				return array( 'success' => true, 'message' => 'Category deleted successfully.' );
			},
		);

		// ============================================================
		// Tags (4)
		// ============================================================

		$reg['wc_get_product_tags'] = array(
			'desc'    => 'List WooCommerce product tags.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page'   => array( 'type' => 'integer', 'description' => 'Items per page. Default 10.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'search'     => array( 'type' => 'string', 'description' => 'Search term.' ),
				'hide_empty' => array( 'type' => 'boolean', 'description' => 'Hide tags with no products. Default false.' ),
			),
			'handler' => function ( $a ) {
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$hide     = ! empty( $a['hide_empty'] );

				$ta = array(
					'taxonomy'   => 'product_tag',
					'number'     => $per_page,
					'offset'     => ( $page - 1 ) * $per_page,
					'hide_empty' => $hide,
				);
				if ( isset( $a['search'] ) ) $ta['search'] = sanitize_text_field( $a['search'] );

				$terms = get_terms( $ta );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				$ca = $ta;
				$ca['fields'] = 'count';
				unset( $ca['number'], $ca['offset'] );
				$total = (int) get_terms( $ca );

				return array(
					'tags'  => array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_term' ), $terms ),
					'total' => $total,
				);
			},
		);

		$reg['wc_create_product_tag'] = array(
			'desc'     => 'Create a WooCommerce product tag.',
			'risk'     => 'write',
			'schema'   => array(
				'name'        => array( 'type' => 'string', 'description' => 'Tag name.' ),
				'slug'        => array( 'type' => 'string', 'description' => 'Tag slug.' ),
				'description' => array( 'type' => 'string', 'description' => 'Tag description.' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$ta = array();
				if ( isset( $a['slug'] ) )        $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_insert_term( sanitize_text_field( $a['name'] ), 'product_tag', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array(
					'success' => true,
					'message' => 'Tag created successfully.',
					'tag'     => WPXMCP_Tools_Woo_Products::format_term( get_term( $result['term_id'], 'product_tag' ) ),
				);
			},
		);

		$reg['wc_update_product_tag'] = array(
			'desc'     => 'Update a WooCommerce product tag.',
			'risk'     => 'write',
			'schema'   => array(
				'tag_id'      => array( 'type' => 'integer', 'description' => 'Tag ID.' ),
				'name'        => array( 'type' => 'string', 'description' => 'Tag name.' ),
				'slug'        => array( 'type' => 'string', 'description' => 'Tag slug.' ),
				'description' => array( 'type' => 'string', 'description' => 'Tag description.' ),
			),
			'required' => array( 'tag_id' ),
			'handler'  => function ( $a ) {
				$id = absint( $a['tag_id'] );
				$ta = array();
				if ( isset( $a['name'] ) )        $ta['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['slug'] ) )         $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_update_term( $id, 'product_tag', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array(
					'success' => true,
					'message' => 'Tag updated successfully.',
					'tag'     => WPXMCP_Tools_Woo_Products::format_term( get_term( $id, 'product_tag' ) ),
				);
			},
		);

		$reg['wc_delete_product_tag'] = array(
			'desc'     => 'Delete a WooCommerce product tag.',
			'risk'     => 'destructive',
			'schema'   => array(
				'tag_id' => array( 'type' => 'integer', 'description' => 'Tag ID.' ),
			),
			'required' => array( 'tag_id' ),
			'handler'  => function ( $a ) {
				$result = wp_delete_term( absint( $a['tag_id'] ), 'product_tag' );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete tag.' );
				}
				return array( 'success' => true, 'message' => 'Tag deleted successfully.' );
			},
		);

		// ============================================================
		// Brands (5) — require WooCommerce Brands extension
		// ============================================================

		$reg['wc_get_product_brands'] = array(
			'desc'    => 'List WooCommerce product brands (requires WooCommerce Brands extension).',
			'risk'    => 'read',
			'schema'  => array(
				'per_page'   => array( 'type' => 'integer', 'description' => 'Items per page. Default 10.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'search'     => array( 'type' => 'string', 'description' => 'Search term.' ),
				'hide_empty' => array( 'type' => 'boolean', 'description' => 'Hide brands with no products. Default false.' ),
			),
			'handler' => function ( $a ) {
				WPXMCP_Tools_Woo_Products::check_brand_taxonomy();
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$hide     = ! empty( $a['hide_empty'] );

				$ta = array(
					'taxonomy'   => 'product_brand',
					'number'     => $per_page,
					'offset'     => ( $page - 1 ) * $per_page,
					'hide_empty' => $hide,
				);
				if ( isset( $a['search'] ) ) $ta['search'] = sanitize_text_field( $a['search'] );

				$terms = get_terms( $ta );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				$ca = $ta;
				$ca['fields'] = 'count';
				unset( $ca['number'], $ca['offset'] );
				$total = (int) get_terms( $ca );

				return array(
					'brands' => array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_brand' ), $terms ),
					'total'  => $total,
				);
			},
		);

		$reg['wc_create_product_brand'] = array(
			'desc'     => 'Create a WooCommerce product brand (requires WooCommerce Brands extension).',
			'risk'     => 'write',
			'schema'   => array(
				'name'         => array( 'type' => 'string', 'description' => 'Brand name.' ),
				'slug'         => array( 'type' => 'string', 'description' => 'Brand slug.' ),
				'parent'       => array( 'type' => 'integer', 'description' => 'Parent brand ID.' ),
				'description'  => array( 'type' => 'string', 'description' => 'Brand description.' ),
				'thumbnail_id' => array( 'type' => 'integer', 'description' => 'Thumbnail attachment ID.' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Woo_Products::check_brand_taxonomy();
				$ta = array();
				if ( isset( $a['slug'] ) )        $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['parent'] ) )       $ta['parent'] = absint( $a['parent'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_insert_term( sanitize_text_field( $a['name'] ), 'product_brand', $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				$tid = $result['term_id'];
				if ( isset( $a['thumbnail_id'] ) ) {
					update_term_meta( $tid, 'thumbnail_id', absint( $a['thumbnail_id'] ) );
				}
				return array(
					'success' => true,
					'message' => 'Brand created successfully.',
					'brand'   => WPXMCP_Tools_Woo_Products::format_brand( get_term( $tid, 'product_brand' ) ),
				);
			},
		);

		$reg['wc_update_product_brand'] = array(
			'desc'     => 'Update a WooCommerce product brand (requires WooCommerce Brands extension).',
			'risk'     => 'write',
			'schema'   => array(
				'brand_id'     => array( 'type' => 'integer', 'description' => 'Brand ID.' ),
				'name'         => array( 'type' => 'string', 'description' => 'Brand name.' ),
				'slug'         => array( 'type' => 'string', 'description' => 'Brand slug.' ),
				'parent'       => array( 'type' => 'integer', 'description' => 'Parent brand ID.' ),
				'description'  => array( 'type' => 'string', 'description' => 'Brand description.' ),
				'thumbnail_id' => array( 'type' => 'integer', 'description' => 'Thumbnail attachment ID.' ),
			),
			'required' => array( 'brand_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Woo_Products::check_brand_taxonomy();
				$id = absint( $a['brand_id'] );
				$ta = array();
				if ( isset( $a['name'] ) )        $ta['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['slug'] ) )         $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['parent'] ) )       $ta['parent'] = absint( $a['parent'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				if ( ! empty( $ta ) ) {
					$result = wp_update_term( $id, 'product_brand', $ta );
					if ( is_wp_error( $result ) ) {
						throw new Exception( $result->get_error_message() );
					}
				}
				if ( isset( $a['thumbnail_id'] ) ) {
					update_term_meta( $id, 'thumbnail_id', absint( $a['thumbnail_id'] ) );
				}
				return array(
					'success' => true,
					'message' => 'Brand updated successfully.',
					'brand'   => WPXMCP_Tools_Woo_Products::format_brand( get_term( $id, 'product_brand' ) ),
				);
			},
		);

		$reg['wc_delete_product_brand'] = array(
			'desc'     => 'Delete a WooCommerce product brand (requires WooCommerce Brands extension). force=true reassigns child terms to parent.',
			'risk'     => 'destructive',
			'schema'   => array(
				'brand_id' => array( 'type' => 'integer', 'description' => 'Brand ID.' ),
				'force'    => array( 'type' => 'boolean', 'description' => 'Reassign child terms to parent before delete. Default false.' ),
			),
			'required' => array( 'brand_id' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Woo_Products::check_brand_taxonomy();
				$id    = absint( $a['brand_id'] );
				$force = ! empty( $a['force'] );

				if ( $force ) {
					$term = get_term( $id, 'product_brand' );
					if ( $term && ! is_wp_error( $term ) ) {
						foreach ( get_term_children( $id, 'product_brand' ) as $child_id ) {
							wp_update_term( $child_id, 'product_brand', array( 'parent' => $term->parent ) );
						}
					}
				}

				$result = wp_delete_term( $id, 'product_brand' );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete brand.' );
				}
				return array( 'success' => true, 'message' => 'Brand deleted successfully.' );
			},
		);

		$reg['wc_assign_product_brand'] = array(
			'desc'     => 'Assign brands to a WooCommerce product (requires WooCommerce Brands extension).',
			'risk'     => 'write',
			'schema'   => array(
				'product_id' => array( 'type' => 'integer', 'description' => 'Product ID.' ),
				'brand_ids'  => array( 'type' => 'array', 'description' => 'Array of brand term IDs.' ),
				'append'     => array( 'type' => 'boolean', 'description' => 'Append instead of replacing existing brands. Default false.' ),
			),
			'required' => array( 'product_id', 'brand_ids' ),
			'handler'  => function ( $a ) {
				WPXMCP_Tools_Woo_Products::check_brand_taxonomy();
				$product_id = absint( $a['product_id'] );
				$brand_ids  = array_map( 'absint', (array) $a['brand_ids'] );
				$append     = ! empty( $a['append'] );

				if ( ! wc_get_product( $product_id ) ) {
					throw new Exception( 'Product not found.' );
				}
				wp_set_object_terms( $product_id, $brand_ids, 'product_brand', $append );

				return array(
					'success'    => true,
					'message'    => 'Brands assigned successfully.',
					'product_id' => $product_id,
					'brand_ids'  => $brand_ids,
				);
			},
		);

		// ============================================================
		// Attributes (4) + Attribute Terms (4)
		// ============================================================

		$reg['wc_get_attributes'] = array(
			'desc'    => 'Get all global WooCommerce product attributes.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$attrs = wc_get_attribute_taxonomies();
				return array(
					'attributes' => array_values( array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_attribute' ), $attrs ) ),
					'total'      => count( $attrs ),
				);
			},
		);

		$reg['wc_create_attribute'] = array(
			'desc'     => 'Create a global WooCommerce product attribute.',
			'risk'     => 'write',
			'schema'   => array(
				'name'         => array( 'type' => 'string', 'description' => 'Attribute label.' ),
				'slug'         => array( 'type' => 'string', 'description' => 'Attribute slug (max 28 chars).' ),
				'order_by'     => array( 'type' => 'string', 'description' => 'menu_order | name | name_num | id.' ),
				'has_archives' => array( 'type' => 'boolean', 'description' => 'Enable attribute archives.' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$data = array( 'name' => sanitize_text_field( $a['name'] ) );
				if ( isset( $a['slug'] ) )         $data['slug'] = substr( sanitize_title( $a['slug'] ), 0, 28 );
				if ( isset( $a['order_by'] ) )      $data['order_by'] = sanitize_key( $a['order_by'] );
				if ( isset( $a['has_archives'] ) )  $data['has_archives'] = (bool) $a['has_archives'];

				$result = wc_create_attribute( $data );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				$attribute = WPXMCP_Tools_Woo_Products::get_attribute_by_id( $result );
				return array(
					'success'   => true,
					'message'   => 'Attribute created successfully.',
					'attribute' => $attribute ? WPXMCP_Tools_Woo_Products::format_attribute( $attribute ) : array( 'id' => $result ),
				);
			},
		);

		$reg['wc_update_attribute'] = array(
			'desc'     => 'Update a global WooCommerce product attribute.',
			'risk'     => 'write',
			'schema'   => array(
				'attribute_id' => array( 'type' => 'integer', 'description' => 'Attribute ID.' ),
				'name'         => array( 'type' => 'string', 'description' => 'Attribute label.' ),
				'slug'         => array( 'type' => 'string', 'description' => 'Attribute slug.' ),
				'order_by'     => array( 'type' => 'string', 'description' => 'menu_order | name | name_num | id.' ),
				'has_archives' => array( 'type' => 'boolean', 'description' => 'Enable attribute archives.' ),
			),
			'required' => array( 'attribute_id' ),
			'handler'  => function ( $a ) {
				$id   = absint( $a['attribute_id'] );
				$data = array();
				if ( isset( $a['name'] ) )         $data['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['slug'] ) )          $data['slug'] = substr( sanitize_title( $a['slug'] ), 0, 28 );
				if ( isset( $a['order_by'] ) )       $data['order_by'] = sanitize_key( $a['order_by'] );
				if ( isset( $a['has_archives'] ) )   $data['has_archives'] = (bool) $a['has_archives'];

				$result = wc_update_attribute( $id, $data );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				$attribute = WPXMCP_Tools_Woo_Products::get_attribute_by_id( $id );
				return array(
					'success'   => true,
					'message'   => 'Attribute updated successfully.',
					'attribute' => $attribute ? WPXMCP_Tools_Woo_Products::format_attribute( $attribute ) : null,
				);
			},
		);

		$reg['wc_delete_attribute'] = array(
			'desc'     => 'Delete a global WooCommerce product attribute and all its terms.',
			'risk'     => 'destructive',
			'schema'   => array(
				'attribute_id' => array( 'type' => 'integer', 'description' => 'Attribute ID.' ),
			),
			'required' => array( 'attribute_id' ),
			'handler'  => function ( $a ) {
				$result = wc_delete_attribute( absint( $a['attribute_id'] ) );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete attribute.' );
				}
				return array( 'success' => true, 'message' => 'Attribute deleted successfully.' );
			},
		);

		$reg['wc_get_attribute_terms'] = array(
			'desc'     => 'Get terms for a global WooCommerce product attribute.',
			'risk'     => 'read',
			'schema'   => array(
				'attribute_id' => array( 'type' => 'integer', 'description' => 'Attribute ID.' ),
				'per_page'     => array( 'type' => 'integer', 'description' => 'Items per page. Default 10.' ),
				'page'         => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'search'       => array( 'type' => 'string', 'description' => 'Search term.' ),
				'hide_empty'   => array( 'type' => 'boolean', 'description' => 'Hide unused terms. Default false.' ),
			),
			'required' => array( 'attribute_id' ),
			'handler'  => function ( $a ) {
				$attribute = WPXMCP_Tools_Woo_Products::get_attribute_by_id( absint( $a['attribute_id'] ) );
				if ( ! $attribute ) {
					throw new Exception( 'Attribute not found.' );
				}
				$taxonomy = 'pa_' . $attribute->attribute_name;
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$hide     = ! empty( $a['hide_empty'] );

				$ta = array(
					'taxonomy'   => $taxonomy,
					'number'     => $per_page,
					'offset'     => ( $page - 1 ) * $per_page,
					'hide_empty' => $hide,
				);
				if ( isset( $a['search'] ) ) $ta['search'] = sanitize_text_field( $a['search'] );

				$terms = get_terms( $ta );
				if ( is_wp_error( $terms ) ) {
					throw new Exception( $terms->get_error_message() );
				}
				$ca = $ta;
				$ca['fields'] = 'count';
				unset( $ca['number'], $ca['offset'] );
				$total = (int) get_terms( $ca );

				return array(
					'terms' => array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_attribute_term' ), $terms ),
					'total' => $total,
				);
			},
		);

		$reg['wc_create_attribute_term'] = array(
			'desc'     => 'Create a term for a global WooCommerce product attribute.',
			'risk'     => 'write',
			'schema'   => array(
				'attribute_id' => array( 'type' => 'integer', 'description' => 'Attribute ID.' ),
				'name'         => array( 'type' => 'string', 'description' => 'Term name.' ),
				'slug'         => array( 'type' => 'string', 'description' => 'Term slug.' ),
				'description'  => array( 'type' => 'string', 'description' => 'Term description.' ),
			),
			'required' => array( 'attribute_id', 'name' ),
			'handler'  => function ( $a ) {
				$attribute = WPXMCP_Tools_Woo_Products::get_attribute_by_id( absint( $a['attribute_id'] ) );
				if ( ! $attribute ) {
					throw new Exception( 'Attribute not found.' );
				}
				$taxonomy = 'pa_' . $attribute->attribute_name;
				$ta = array();
				if ( isset( $a['slug'] ) )        $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_insert_term( sanitize_text_field( $a['name'] ), $taxonomy, $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array(
					'success' => true,
					'message' => 'Attribute term created successfully.',
					'term'    => WPXMCP_Tools_Woo_Products::format_attribute_term( get_term( $result['term_id'], $taxonomy ) ),
				);
			},
		);

		$reg['wc_update_attribute_term'] = array(
			'desc'     => 'Update a term for a global WooCommerce product attribute.',
			'risk'     => 'write',
			'schema'   => array(
				'attribute_id' => array( 'type' => 'integer', 'description' => 'Attribute ID.' ),
				'term_id'      => array( 'type' => 'integer', 'description' => 'Term ID.' ),
				'name'         => array( 'type' => 'string', 'description' => 'Term name.' ),
				'slug'         => array( 'type' => 'string', 'description' => 'Term slug.' ),
				'description'  => array( 'type' => 'string', 'description' => 'Term description.' ),
			),
			'required' => array( 'attribute_id', 'term_id' ),
			'handler'  => function ( $a ) {
				$attribute = WPXMCP_Tools_Woo_Products::get_attribute_by_id( absint( $a['attribute_id'] ) );
				if ( ! $attribute ) {
					throw new Exception( 'Attribute not found.' );
				}
				$taxonomy = 'pa_' . $attribute->attribute_name;
				$term_id  = absint( $a['term_id'] );
				$ta = array();
				if ( isset( $a['name'] ) )        $ta['name'] = sanitize_text_field( $a['name'] );
				if ( isset( $a['slug'] ) )         $ta['slug'] = sanitize_title( $a['slug'] );
				if ( isset( $a['description'] ) )  $ta['description'] = sanitize_textarea_field( $a['description'] );

				$result = wp_update_term( $term_id, $taxonomy, $ta );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				return array(
					'success' => true,
					'message' => 'Attribute term updated successfully.',
					'term'    => WPXMCP_Tools_Woo_Products::format_attribute_term( get_term( $term_id, $taxonomy ) ),
				);
			},
		);

		$reg['wc_delete_attribute_term'] = array(
			'desc'     => 'Delete a term from a global WooCommerce product attribute.',
			'risk'     => 'destructive',
			'schema'   => array(
				'attribute_id' => array( 'type' => 'integer', 'description' => 'Attribute ID.' ),
				'term_id'      => array( 'type' => 'integer', 'description' => 'Term ID.' ),
			),
			'required' => array( 'attribute_id', 'term_id' ),
			'handler'  => function ( $a ) {
				$attribute = WPXMCP_Tools_Woo_Products::get_attribute_by_id( absint( $a['attribute_id'] ) );
				if ( ! $attribute ) {
					throw new Exception( 'Attribute not found.' );
				}
				$taxonomy = 'pa_' . $attribute->attribute_name;
				$result   = wp_delete_term( absint( $a['term_id'] ), $taxonomy );
				if ( is_wp_error( $result ) ) {
					throw new Exception( $result->get_error_message() );
				}
				if ( ! $result ) {
					throw new Exception( 'Failed to delete attribute term.' );
				}
				return array( 'success' => true, 'message' => 'Attribute term deleted successfully.' );
			},
		);

		// ============================================================
		// Variations (3)
		// ============================================================

		$reg['wc_get_product_variations'] = array(
			'desc'     => 'Get variations for a variable WooCommerce product.',
			'risk'     => 'read',
			'schema'   => array(
				'product_id' => array( 'type' => 'integer', 'description' => 'Parent product ID.' ),
				'per_page'   => array( 'type' => 'integer', 'description' => 'Items per page. Default 10.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
			),
			'required' => array( 'product_id' ),
			'handler'  => function ( $a ) {
				$product_id = absint( $a['product_id'] );
				$product    = wc_get_product( $product_id );
				if ( ! $product ) {
					throw new Exception( 'Product not found.' );
				}
				if ( ! $product->is_type( 'variable' ) ) {
					throw new Exception( 'Product is not a variable product.' );
				}
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$children = $product->get_children();
				$slice    = array_slice( $children, ( $page - 1 ) * $per_page, $per_page );

				$variations = array_filter( array_map( function ( $id ) {
					$v = wc_get_product( $id );
					return ( $v instanceof \WC_Product_Variation ) ? $v : null;
				}, $slice ) );

				return array(
					'variations' => array_values( array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_variation' ), $variations ) ),
					'total'      => count( $children ),
				);
			},
		);

		$reg['wc_create_product_variation'] = array(
			'desc'     => 'Create a variation for a variable WooCommerce product.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'     => array( 'type' => 'integer', 'description' => 'Parent product ID.' ),
				'sku'            => array( 'type' => 'string', 'description' => 'Variation SKU.' ),
				'regular_price'  => array( 'type' => 'string', 'description' => 'Regular price.' ),
				'sale_price'     => array( 'type' => 'string', 'description' => 'Sale price.' ),
				'stock_quantity' => array( 'type' => 'integer', 'description' => 'Stock quantity.' ),
				'manage_stock'   => array( 'type' => 'boolean', 'description' => 'Manage stock.' ),
				'stock_status'   => array( 'type' => 'string', 'description' => 'instock | outofstock | onbackorder.' ),
				'weight'         => array( 'type' => 'string', 'description' => 'Variation weight.' ),
				'status'         => array( 'type' => 'string', 'description' => 'Variation status. Default publish.' ),
				'attributes'     => array( 'type' => 'object', 'description' => 'attribute_name => term_slug pairs.' ),
			),
			'required' => array( 'product_id' ),
			'handler'  => function ( $a ) {
				$product_id = absint( $a['product_id'] );
				$product    = wc_get_product( $product_id );
				if ( ! $product ) {
					throw new Exception( 'Product not found.' );
				}
				if ( ! $product->is_type( 'variable' ) ) {
					throw new Exception( 'Product is not a variable product.' );
				}
				$variation = new \WC_Product_Variation();
				$variation->set_parent_id( $product_id );
				WPXMCP_Tools_Woo_Products::apply_variation_args( $variation, $a );

				$vid = $variation->save();
				if ( ! $vid ) {
					throw new Exception( 'Failed to create product variation.' );
				}
				return array(
					'success'   => true,
					'message'   => 'Variation created successfully.',
					'variation' => WPXMCP_Tools_Woo_Products::format_variation( wc_get_product( $vid ) ),
				);
			},
		);

		$reg['wc_update_product_variation'] = array(
			'desc'     => 'Update a WooCommerce product variation.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'     => array( 'type' => 'integer', 'description' => 'Parent product ID.' ),
				'variation_id'   => array( 'type' => 'integer', 'description' => 'Variation ID.' ),
				'sku'            => array( 'type' => 'string', 'description' => 'Variation SKU.' ),
				'regular_price'  => array( 'type' => 'string', 'description' => 'Regular price.' ),
				'sale_price'     => array( 'type' => 'string', 'description' => 'Sale price.' ),
				'stock_quantity' => array( 'type' => 'integer', 'description' => 'Stock quantity.' ),
				'manage_stock'   => array( 'type' => 'boolean', 'description' => 'Manage stock.' ),
				'stock_status'   => array( 'type' => 'string', 'description' => 'instock | outofstock | onbackorder.' ),
				'weight'         => array( 'type' => 'string', 'description' => 'Variation weight.' ),
				'status'         => array( 'type' => 'string', 'description' => 'Variation status.' ),
				'attributes'     => array( 'type' => 'object', 'description' => 'attribute_name => term_slug pairs.' ),
			),
			'required' => array( 'product_id', 'variation_id' ),
			'handler'  => function ( $a ) {
				$vid = absint( $a['variation_id'] );
				$v   = wc_get_product( $vid );
				if ( ! $v || ! ( $v instanceof \WC_Product_Variation ) ) {
					throw new Exception( 'Product variation not found.' );
				}
				WPXMCP_Tools_Woo_Products::apply_variation_args( $v, $a );
				$v->save();
				return array(
					'success'   => true,
					'message'   => 'Variation updated successfully.',
					'variation' => WPXMCP_Tools_Woo_Products::format_variation( wc_get_product( $vid ) ),
				);
			},
		);

		$reg['wc_delete_product_variation'] = array(
			'desc'     => 'Delete a WooCommerce product variation.',
			'risk'     => 'destructive',
			'schema'   => array(
				'product_id'   => array( 'type' => 'integer', 'description' => 'Parent product ID.' ),
				'variation_id' => array( 'type' => 'integer', 'description' => 'Variation ID.' ),
				'force'        => array( 'type' => 'boolean', 'description' => 'true = permanent delete. Default false.' ),
			),
			'required' => array( 'product_id', 'variation_id' ),
			'handler'  => function ( $a ) {
				$vid = absint( $a['variation_id'] );
				$v   = wc_get_product( $vid );
				if ( ! $v || ! ( $v instanceof \WC_Product_Variation ) ) {
					throw new Exception( 'Product variation not found.' );
				}
				$force  = ! empty( $a['force'] );
				$result = $v->delete( $force );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete variation.' );
				}
				return array(
					'success' => true,
					'message' => $force ? 'Variation permanently deleted.' : 'Variation moved to trash.',
				);
			},
		);

		// ============================================================
		// Reviews (4)
		// ============================================================

		$reg['wc_get_product_reviews'] = array(
			'desc'     => 'Get reviews for a WooCommerce product.',
			'risk'     => 'read',
			'schema'   => array(
				'product_id' => array( 'type' => 'integer', 'description' => 'Product ID.' ),
				'per_page'   => array( 'type' => 'integer', 'description' => 'Items per page. Default 10.' ),
				'page'       => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'status'     => array( 'type' => 'string', 'description' => 'approve | hold | spam | trash. Default approve.' ),
			),
			'required' => array( 'product_id' ),
			'handler'  => function ( $a ) {
				$product_id = absint( $a['product_id'] );
				if ( ! wc_get_product( $product_id ) ) {
					throw new Exception( 'Product not found.' );
				}
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$status   = isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'approve';

				$ca = array(
					'post_id' => $product_id,
					'type'    => 'review',
					'status'  => $status,
					'number'  => $per_page,
					'offset'  => ( $page - 1 ) * $per_page,
				);
				$reviews = get_comments( $ca );

				$counta = $ca;
				$counta['count'] = true;
				unset( $counta['number'], $counta['offset'] );
				$total = (int) get_comments( $counta );

				return array(
					'reviews' => array_map( array( 'WPXMCP_Tools_Woo_Products', 'format_review' ), $reviews ),
					'total'   => $total,
				);
			},
		);

		$reg['wc_create_product_review'] = array(
			'desc'     => 'Create a review for a WooCommerce product.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'   => array( 'type' => 'integer', 'description' => 'Product ID.' ),
				'content'      => array( 'type' => 'string', 'description' => 'Review text.' ),
				'rating'       => array( 'type' => 'integer', 'description' => 'Star rating 1-5.' ),
				'author_name'  => array( 'type' => 'string', 'description' => 'Reviewer name (used when not logged in).' ),
				'author_email' => array( 'type' => 'string', 'description' => 'Reviewer email (used when not logged in).' ),
			),
			'required' => array( 'product_id', 'content' ),
			'handler'  => function ( $a ) {
				$product_id = absint( $a['product_id'] );
				if ( ! wc_get_product( $product_id ) ) {
					throw new Exception( 'Product not found.' );
				}
				$user = wp_get_current_user();
				$data = array(
					'comment_post_ID'  => $product_id,
					'comment_content'  => wp_kses_post( $a['content'] ),
					'comment_type'     => 'review',
					'comment_approved' => 1,
				);
				if ( $user && $user->ID ) {
					$data['user_id']              = $user->ID;
					$data['comment_author']       = $user->display_name;
					$data['comment_author_email'] = $user->user_email;
				} else {
					if ( isset( $a['author_name'] ) )  $data['comment_author'] = sanitize_text_field( $a['author_name'] );
					if ( isset( $a['author_email'] ) ) $data['comment_author_email'] = sanitize_email( $a['author_email'] );
				}

				$review_id = wp_insert_comment( $data );
				if ( ! $review_id ) {
					throw new Exception( 'Failed to create review.' );
				}
				if ( isset( $a['rating'] ) ) {
					update_comment_meta( $review_id, 'rating', min( 5, max( 1, absint( $a['rating'] ) ) ) );
				}
				\WC_Comments::clear_transients( $product_id );

				return array(
					'success' => true,
					'message' => 'Review created successfully.',
					'review'  => WPXMCP_Tools_Woo_Products::format_review( get_comment( $review_id ) ),
				);
			},
		);

		$reg['wc_update_product_review'] = array(
			'desc'     => 'Update a WooCommerce product review.',
			'risk'     => 'write',
			'schema'   => array(
				'review_id' => array( 'type' => 'integer', 'description' => 'Review (comment) ID.' ),
				'content'   => array( 'type' => 'string', 'description' => 'Review text.' ),
				'rating'    => array( 'type' => 'integer', 'description' => 'Star rating 1-5.' ),
				'status'    => array( 'type' => 'string', 'description' => 'approve | hold | spam | trash.' ),
			),
			'required' => array( 'review_id' ),
			'handler'  => function ( $a ) {
				$review_id = absint( $a['review_id'] );
				$comment   = get_comment( $review_id );
				if ( ! $comment ) {
					throw new Exception( 'Review not found.' );
				}
				$data = array( 'comment_ID' => $review_id );
				if ( isset( $a['content'] ) ) $data['comment_content'] = wp_kses_post( $a['content'] );
				if ( isset( $a['status'] ) )  $data['comment_approved'] = sanitize_key( $a['status'] );

				wp_update_comment( $data );
				if ( isset( $a['rating'] ) ) {
					update_comment_meta( $review_id, 'rating', min( 5, max( 1, absint( $a['rating'] ) ) ) );
				}
				\WC_Comments::clear_transients( $comment->comment_post_ID );

				return array(
					'success' => true,
					'message' => 'Review updated successfully.',
					'review'  => WPXMCP_Tools_Woo_Products::format_review( get_comment( $review_id ) ),
				);
			},
		);

		$reg['wc_delete_product_review'] = array(
			'desc'     => 'Delete a WooCommerce product review.',
			'risk'     => 'destructive',
			'schema'   => array(
				'review_id' => array( 'type' => 'integer', 'description' => 'Review (comment) ID.' ),
				'force'     => array( 'type' => 'boolean', 'description' => 'true = permanent delete. Default false.' ),
			),
			'required' => array( 'review_id' ),
			'handler'  => function ( $a ) {
				$review_id = absint( $a['review_id'] );
				$comment   = get_comment( $review_id );
				if ( ! $comment ) {
					throw new Exception( 'Review not found.' );
				}
				$force  = ! empty( $a['force'] );
				$result = wp_delete_comment( $review_id, $force );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete review.' );
				}
				\WC_Comments::clear_transients( $comment->comment_post_ID );

				return array(
					'success' => true,
					'message' => $force ? 'Review permanently deleted.' : 'Review moved to trash.',
				);
			},
		);

		// ============================================================
		// Stock (2)
		// ============================================================

		$reg['wc_set_stock_status'] = array(
			'desc'     => 'Set the stock status of a WooCommerce product.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'   => array( 'type' => 'integer', 'description' => 'Product ID.' ),
				'stock_status' => array( 'type' => 'string', 'description' => 'instock | outofstock | onbackorder.' ),
			),
			'required' => array( 'product_id', 'stock_status' ),
			'handler'  => function ( $a ) {
				$product = wc_get_product( absint( $a['product_id'] ) );
				if ( ! $product ) {
					throw new Exception( 'Product not found.' );
				}
				$product->set_stock_status( sanitize_key( $a['stock_status'] ) );
				$product->save();
				return array(
					'success'      => true,
					'message'      => 'Stock status updated.',
					'product_id'   => $product->get_id(),
					'stock_status' => $product->get_stock_status(),
				);
			},
		);

		$reg['wc_update_stock'] = array(
			'desc'     => 'Update the stock quantity of a WooCommerce product (enables stock management).',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'     => array( 'type' => 'integer', 'description' => 'Product ID.' ),
				'stock_quantity' => array( 'type' => 'integer', 'description' => 'New stock quantity.' ),
			),
			'required' => array( 'product_id', 'stock_quantity' ),
			'handler'  => function ( $a ) {
				$product = wc_get_product( absint( $a['product_id'] ) );
				if ( ! $product ) {
					throw new Exception( 'Product not found.' );
				}
				$product->set_manage_stock( true );
				$product->set_stock_quantity( (int) $a['stock_quantity'] );
				$product->save();
				return array(
					'success'        => true,
					'message'        => 'Stock quantity updated.',
					'product_id'     => $product->get_id(),
					'stock_quantity' => $product->get_stock_quantity(),
				);
			},
		);

		return $reg;
	}
}
