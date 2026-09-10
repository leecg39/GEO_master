<?php
/**
 * WooCommerce PRO tool group — the revenue levers:
 * coupons, bulk price/stock updates, variable products & variations,
 * refunds, product imagery, category assignment, and sales-intelligence
 * reports (top sellers, low stock, single-customer lifetime value).
 *
 * All handlers throw cleanly if WooCommerce is inactive. HPOS-safe:
 * uses WC CRUD (WC_Order, WC_Coupon, wc_create_refund, wc_get_products)
 * and the wc_product_meta_lookup table — never raw order postmeta.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_WooCommerce_Pro {

	private static function ensure_wc(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			throw new Exception( 'WooCommerce is not active on this site.' );
		}
	}

	/**
	 * Resolve a list of product IDs from explicit ids OR a category slug.
	 */
	private static function resolve_product_ids( array $a ): array {
		if ( ! empty( $a['ids'] ) && is_array( $a['ids'] ) ) {
			return array_map( 'intval', $a['ids'] );
		}
		if ( ! empty( $a['category'] ) ) {
			$res = wc_get_products(
				array(
					'category' => array( sanitize_title( $a['category'] ) ),
					'limit'    => -1,
					'return'   => 'ids',
				)
			);
			return is_array( $res ) ? $res : array();
		}
		return array();
	}

	public static function all(): array {
		$reg = array();

		// ============================================================
		// BULK PRICE / STOCK — run sales, restock, clear-outs fast
		// ============================================================
		$reg['wc_bulk_update_prices'] = array(
			'desc'    => 'Bulk-update product prices across many products at once — by explicit ids[] or a category slug. Set regular_price and/or sale_price as a fixed value, OR apply a percentage change with percent (e.g. -15 = 15% off the regular price into sale_price). Returns per-product before/after. Run dry_run=true to preview.',
			'risk'    => 'write',
			'schema'  => array(
				'ids'           => array( 'type' => 'array', 'description' => 'Array of product IDs. Omit to use category.' ),
				'category'      => array( 'type' => 'string', 'description' => 'Category slug to target instead of ids.' ),
				'regular_price' => array( 'type' => 'string', 'description' => 'Fixed regular price to set on all targets.' ),
				'sale_price'    => array( 'type' => 'string', 'description' => 'Fixed sale price to set on all targets.' ),
				'percent'       => array( 'type' => 'number', 'description' => 'Percentage change applied to regular_price → sale_price. Negative = discount, e.g. -20.' ),
				'clear_sale'    => array( 'type' => 'boolean', 'description' => 'If true, removes the sale price (ends the promo).' ),
				'dry_run'       => array( 'type' => 'boolean', 'description' => 'Preview only, no writes. Default false.' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$ids = self::resolve_product_ids( $a );
				if ( empty( $ids ) ) {
					throw new Exception( 'No target products. Provide ids[] or a category slug.' );
				}
				$dry     = ! empty( $a['dry_run'] );
				$changed = array();
				foreach ( $ids as $pid ) {
					$p = wc_get_product( $pid );
					if ( ! $p ) {
						continue;
					}
					$before = array( 'regular' => $p->get_regular_price(), 'sale' => $p->get_sale_price() );
					$new_reg = isset( $a['regular_price'] ) ? (string) $a['regular_price'] : $p->get_regular_price();
					$new_sale = $p->get_sale_price();

					if ( ! empty( $a['clear_sale'] ) ) {
						$new_sale = '';
					} elseif ( isset( $a['sale_price'] ) ) {
						$new_sale = (string) $a['sale_price'];
					} elseif ( isset( $a['percent'] ) && '' !== $new_reg ) {
						$pct      = (float) $a['percent'];
						$new_sale = (string) round( (float) $new_reg * ( 1 + $pct / 100 ), wc_get_price_decimals() );
					}

					if ( ! $dry ) {
						if ( isset( $a['regular_price'] ) ) {
							$p->set_regular_price( $new_reg );
						}
						$p->set_sale_price( $new_sale );
						$p->save();
					}
					$changed[] = array(
						'id'     => $pid,
						'name'   => $p->get_name(),
						'before' => $before,
						'after'  => array( 'regular' => $new_reg, 'sale' => $new_sale ),
					);
				}
				return array( 'dry_run' => $dry, 'count' => count( $changed ), 'products' => $changed );
			},
		);

		$reg['wc_bulk_update_stock'] = array(
			'desc'    => 'Bulk-update stock across many products by ids[] or category. Set stock_qty (absolute) or adjust_by (delta, e.g. +50 restock / -10), and/or stock_status (instock|outofstock|onbackorder). dry_run to preview.',
			'risk'    => 'write',
			'schema'  => array(
				'ids'          => array( 'type' => 'array' ),
				'category'     => array( 'type' => 'string' ),
				'stock_qty'    => array( 'type' => 'integer', 'description' => 'Absolute quantity to set.' ),
				'adjust_by'    => array( 'type' => 'integer', 'description' => 'Delta to add/subtract from current stock.' ),
				'stock_status' => array( 'type' => 'string', 'description' => 'instock | outofstock | onbackorder' ),
				'dry_run'      => array( 'type' => 'boolean' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$ids = self::resolve_product_ids( $a );
				if ( empty( $ids ) ) {
					throw new Exception( 'No target products. Provide ids[] or a category slug.' );
				}
				$dry     = ! empty( $a['dry_run'] );
				$changed = array();
				foreach ( $ids as $pid ) {
					$p = wc_get_product( $pid );
					if ( ! $p ) {
						continue;
					}
					$before_qty    = $p->get_stock_quantity();
					$before_status = $p->get_stock_status();
					$new_qty       = $before_qty;
					if ( isset( $a['stock_qty'] ) ) {
						$new_qty = (int) $a['stock_qty'];
					} elseif ( isset( $a['adjust_by'] ) ) {
						$new_qty = (int) $before_qty + (int) $a['adjust_by'];
					}
					if ( ! $dry ) {
						if ( isset( $a['stock_qty'] ) || isset( $a['adjust_by'] ) ) {
							$p->set_manage_stock( true );
							$p->set_stock_quantity( $new_qty );
						}
						if ( ! empty( $a['stock_status'] ) ) {
							$p->set_stock_status( $a['stock_status'] );
						}
						$p->save();
					}
					$changed[] = array(
						'id'     => $pid,
						'name'   => $p->get_name(),
						'before' => array( 'qty' => $before_qty, 'status' => $before_status ),
						'after'  => array( 'qty' => $new_qty, 'status' => $a['stock_status'] ?? $before_status ),
					);
				}
				return array( 'dry_run' => $dry, 'count' => count( $changed ), 'products' => $changed );
			},
		);

		// ============================================================
		// COUPONS — the core marketing lever
		// ============================================================
		$reg['wc_list_coupons'] = array(
			'desc'    => 'List WooCommerce coupons with code, type, amount, usage, and expiry.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 50' ),
				'page'     => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$q = new WP_Query(
					array(
						'post_type'      => 'shop_coupon',
						'post_status'    => 'publish',
						'posts_per_page' => (int) ( $a['per_page'] ?? 50 ),
						'paged'          => max( 1, (int) ( $a['page'] ?? 1 ) ),
					)
				);
				$out = array();
				foreach ( $q->posts as $post ) {
					$c     = new WC_Coupon( $post->ID );
					$out[] = array(
						'id'            => $c->get_id(),
						'code'          => $c->get_code(),
						'discount_type' => $c->get_discount_type(),
						'amount'        => $c->get_amount(),
						'usage_count'   => $c->get_usage_count(),
						'usage_limit'   => $c->get_usage_limit(),
						'expiry'        => $c->get_date_expires() ? $c->get_date_expires()->date( 'Y-m-d' ) : null,
						'free_shipping' => $c->get_free_shipping(),
						'min_amount'    => $c->get_minimum_amount(),
					);
				}
				return array( 'total' => (int) $q->found_posts, 'items' => $out );
			},
		);

		$reg['wc_create_coupon'] = array(
			'desc'     => 'Create a coupon. discount_type: percent | fixed_cart | fixed_product. Optional: amount, expiry (YYYY-MM-DD), usage_limit, individual_use, free_shipping, minimum_amount, maximum_amount, product_ids[], exclude_product_ids[], email_restrictions[].',
			'risk'     => 'write',
			'schema'   => array(
				'code'             => array( 'type' => 'string' ),
				'discount_type'    => array( 'type' => 'string', 'description' => 'percent | fixed_cart | fixed_product' ),
				'amount'           => array( 'type' => 'string' ),
				'expiry'           => array( 'type' => 'string', 'description' => 'YYYY-MM-DD' ),
				'usage_limit'      => array( 'type' => 'integer' ),
				'individual_use'   => array( 'type' => 'boolean' ),
				'free_shipping'    => array( 'type' => 'boolean' ),
				'minimum_amount'   => array( 'type' => 'string' ),
				'maximum_amount'   => array( 'type' => 'string' ),
				'description'      => array( 'type' => 'string' ),
				'product_ids'      => array( 'type' => 'array' ),
				'exclude_product_ids' => array( 'type' => 'array' ),
				'email_restrictions'  => array( 'type' => 'array' ),
			),
			'required' => array( 'code' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$c = new WC_Coupon();
				$c->set_code( $a['code'] );
				$c->set_discount_type( $a['discount_type'] ?? 'percent' );
				if ( isset( $a['amount'] ) ) {
					$c->set_amount( $a['amount'] );
				}
				if ( ! empty( $a['expiry'] ) ) {
					$c->set_date_expires( $a['expiry'] );
				}
				if ( isset( $a['usage_limit'] ) ) {
					$c->set_usage_limit( (int) $a['usage_limit'] );
				}
				if ( isset( $a['individual_use'] ) ) {
					$c->set_individual_use( (bool) $a['individual_use'] );
				}
				if ( isset( $a['free_shipping'] ) ) {
					$c->set_free_shipping( (bool) $a['free_shipping'] );
				}
				if ( isset( $a['minimum_amount'] ) ) {
					$c->set_minimum_amount( $a['minimum_amount'] );
				}
				if ( isset( $a['maximum_amount'] ) ) {
					$c->set_maximum_amount( $a['maximum_amount'] );
				}
				if ( isset( $a['description'] ) ) {
					$c->set_description( $a['description'] );
				}
				if ( ! empty( $a['product_ids'] ) && is_array( $a['product_ids'] ) ) {
					$c->set_product_ids( array_map( 'intval', $a['product_ids'] ) );
				}
				if ( ! empty( $a['exclude_product_ids'] ) && is_array( $a['exclude_product_ids'] ) ) {
					$c->set_excluded_product_ids( array_map( 'intval', $a['exclude_product_ids'] ) );
				}
				if ( ! empty( $a['email_restrictions'] ) && is_array( $a['email_restrictions'] ) ) {
					$c->set_email_restrictions( array_map( 'sanitize_email', $a['email_restrictions'] ) );
				}
				$id = $c->save();
				return array( 'id' => $id, 'code' => $c->get_code(), 'created' => true );
			},
		);

		$reg['wc_update_coupon'] = array(
			'desc'     => 'Update an existing coupon by id. Same fields as create (amount, discount_type, expiry, usage_limit, free_shipping, minimum_amount, etc.).',
			'risk'     => 'write',
			'schema'   => array(
				'id'             => array( 'type' => 'integer' ),
				'amount'         => array( 'type' => 'string' ),
				'discount_type'  => array( 'type' => 'string' ),
				'expiry'         => array( 'type' => 'string', 'description' => 'YYYY-MM-DD, or empty string to clear.' ),
				'usage_limit'    => array( 'type' => 'integer' ),
				'free_shipping'  => array( 'type' => 'boolean' ),
				'minimum_amount' => array( 'type' => 'string' ),
				'description'    => array( 'type' => 'string' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$c = new WC_Coupon( (int) $a['id'] );
				if ( ! $c->get_id() ) {
					throw new Exception( 'Coupon not found.' );
				}
				if ( isset( $a['amount'] ) ) {
					$c->set_amount( $a['amount'] );
				}
				if ( ! empty( $a['discount_type'] ) ) {
					$c->set_discount_type( $a['discount_type'] );
				}
				if ( isset( $a['expiry'] ) ) {
					$c->set_date_expires( '' === $a['expiry'] ? null : $a['expiry'] );
				}
				if ( isset( $a['usage_limit'] ) ) {
					$c->set_usage_limit( (int) $a['usage_limit'] );
				}
				if ( isset( $a['free_shipping'] ) ) {
					$c->set_free_shipping( (bool) $a['free_shipping'] );
				}
				if ( isset( $a['minimum_amount'] ) ) {
					$c->set_minimum_amount( $a['minimum_amount'] );
				}
				if ( isset( $a['description'] ) ) {
					$c->set_description( $a['description'] );
				}
				$c->save();
				return array( 'id' => $c->get_id(), 'code' => $c->get_code(), 'updated' => true );
			},
		);

		$reg['wc_delete_coupon'] = array(
			'desc'     => 'Delete a coupon by id (trashes by default; force=true to permanently delete).',
			'risk'     => 'destructive',
			'schema'   => array(
				'id'    => array( 'type' => 'integer' ),
				'force' => array( 'type' => 'boolean' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$c = new WC_Coupon( (int) $a['id'] );
				if ( ! $c->get_id() ) {
					throw new Exception( 'Coupon not found.' );
				}
				$c->delete( ! empty( $a['force'] ) );
				return array( 'id' => (int) $a['id'], 'deleted' => true );
			},
		);

		// ============================================================
		// REFUNDS
		// ============================================================
		$reg['wc_refund_order'] = array(
			'desc'     => 'Refund an order. Provide amount (partial) or omit for a full refund of the order total. Optional reason. Note: this records the refund in WooCommerce; it does NOT call the payment gateway API unless the gateway supports programmatic refunds.',
			'risk'     => 'destructive',
			'schema'   => array(
				'order_id' => array( 'type' => 'integer' ),
				'amount'   => array( 'type' => 'string', 'description' => 'Refund amount. Omit for full order total.' ),
				'reason'   => array( 'type' => 'string' ),
			),
			'required' => array( 'order_id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$order = wc_get_order( (int) $a['order_id'] );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$amount = isset( $a['amount'] ) ? (float) $a['amount'] : (float) $order->get_total();
				$refund = wc_create_refund(
					array(
						'order_id' => (int) $a['order_id'],
						'amount'   => $amount,
						'reason'   => $a['reason'] ?? '',
					)
				);
				if ( is_wp_error( $refund ) ) {
					throw new Exception( $refund->get_error_message() );
				}
				return array(
					'order_id'    => (int) $a['order_id'],
					'refund_id'   => $refund->get_id(),
					'amount'      => $amount,
					'order_total' => $order->get_total(),
					'refunded'    => true,
				);
			},
		);

		// ============================================================
		// VARIABLE PRODUCTS & VARIATIONS
		// ============================================================
		$reg['wc_create_variable_product'] = array(
			'desc'     => 'Create a variable product with attributes used for variations. attributes is an object like {"Color":["Red","Blue"],"Size":["S","M","L"]}. After creating, add variations with wc_add_product_variation.',
			'risk'     => 'write',
			'schema'   => array(
				'name'        => array( 'type' => 'string' ),
				'sku'         => array( 'type' => 'string' ),
				'description' => array( 'type' => 'string' ),
				'short_desc'  => array( 'type' => 'string' ),
				'status'      => array( 'type' => 'string', 'description' => 'Default publish' ),
				'attributes'  => array( 'type' => 'object', 'description' => '{"Color":["Red","Blue"],"Size":["S","M"]}' ),
				'categories'  => array( 'type' => 'array', 'description' => 'Array of category IDs' ),
			),
			'required' => array( 'name', 'attributes' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$product = new WC_Product_Variable();
				$product->set_name( $a['name'] );
				if ( isset( $a['sku'] ) ) {
					$product->set_sku( $a['sku'] );
				}
				if ( isset( $a['description'] ) ) {
					$product->set_description( $a['description'] );
				}
				if ( isset( $a['short_desc'] ) ) {
					$product->set_short_description( $a['short_desc'] );
				}
				$product->set_status( $a['status'] ?? 'publish' );
				if ( ! empty( $a['categories'] ) && is_array( $a['categories'] ) ) {
					$product->set_category_ids( array_map( 'intval', $a['categories'] ) );
				}
				$attributes = array();
				foreach ( (array) $a['attributes'] as $name => $values ) {
					$attr = new WC_Product_Attribute();
					$attr->set_name( $name );
					$attr->set_options( (array) $values );
					$attr->set_visible( true );
					$attr->set_variation( true );
					$attributes[] = $attr;
				}
				$product->set_attributes( $attributes );
				$id = $product->save();
				return array( 'id' => $id, 'type' => 'variable', 'link' => get_permalink( $id ) );
			},
		);

		$reg['wc_add_product_variation'] = array(
			'desc'     => 'Add a single variation to a variable product. attributes is an object mapping each variation attribute to ONE value, e.g. {"Color":"Red","Size":"M"}. Set regular_price, optional sale_price, sku, stock_qty.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'    => array( 'type' => 'integer' ),
				'attributes'    => array( 'type' => 'object', 'description' => '{"Color":"Red","Size":"M"}' ),
				'regular_price' => array( 'type' => 'string' ),
				'sale_price'    => array( 'type' => 'string' ),
				'sku'           => array( 'type' => 'string' ),
				'stock_qty'     => array( 'type' => 'integer' ),
			),
			'required' => array( 'product_id', 'attributes' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$parent = wc_get_product( (int) $a['product_id'] );
				if ( ! $parent || ! $parent->is_type( 'variable' ) ) {
					throw new Exception( 'Parent is not a variable product.' );
				}
				$variation = new WC_Product_Variation();
				$variation->set_parent_id( (int) $a['product_id'] );
				$attrs = array();
				foreach ( (array) $a['attributes'] as $name => $value ) {
					$attrs[ sanitize_title( $name ) ] = $value;
				}
				$variation->set_attributes( $attrs );
				if ( isset( $a['regular_price'] ) ) {
					$variation->set_regular_price( $a['regular_price'] );
				}
				if ( isset( $a['sale_price'] ) ) {
					$variation->set_sale_price( $a['sale_price'] );
				}
				if ( isset( $a['sku'] ) ) {
					$variation->set_sku( $a['sku'] );
				}
				if ( isset( $a['stock_qty'] ) ) {
					$variation->set_manage_stock( true );
					$variation->set_stock_quantity( (int) $a['stock_qty'] );
				}
				$vid = $variation->save();
				return array( 'variation_id' => $vid, 'product_id' => (int) $a['product_id'], 'created' => true );
			},
		);

		// ============================================================
		// PRODUCT IMAGERY & MERCHANDISING
		// ============================================================
		$reg['wc_set_product_image'] = array(
			'desc'     => 'Set a product\'s featured image and/or gallery from image URLs. featured_url sets the main image; gallery_urls[] sets the gallery. Images are sideloaded into the media library.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'   => array( 'type' => 'integer' ),
				'featured_url' => array( 'type' => 'string' ),
				'gallery_urls' => array( 'type' => 'array', 'description' => 'Array of image URLs for the gallery.' ),
			),
			'required' => array( 'product_id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				require_once ABSPATH . 'wp-admin/includes/file.php';
				require_once ABSPATH . 'wp-admin/includes/media.php';
				require_once ABSPATH . 'wp-admin/includes/image.php';
				$p = wc_get_product( (int) $a['product_id'] );
				if ( ! $p ) {
					throw new Exception( 'Product not found.' );
				}
				$result = array( 'product_id' => (int) $a['product_id'] );
				if ( ! empty( $a['featured_url'] ) ) {
					$att = media_sideload_image( esc_url_raw( $a['featured_url'] ), (int) $a['product_id'], null, 'id' );
					if ( is_wp_error( $att ) ) {
						throw new Exception( 'Featured image: ' . $att->get_error_message() );
					}
					$p->set_image_id( $att );
					$result['featured_id'] = $att;
				}
				if ( ! empty( $a['gallery_urls'] ) && is_array( $a['gallery_urls'] ) ) {
					$gallery = array();
					foreach ( $a['gallery_urls'] as $url ) {
						$att = media_sideload_image( esc_url_raw( $url ), (int) $a['product_id'], null, 'id' );
						if ( ! is_wp_error( $att ) ) {
							$gallery[] = $att;
						}
					}
					$p->set_gallery_image_ids( $gallery );
					$result['gallery_ids'] = $gallery;
				}
				$p->save();
				$result['updated'] = true;
				return $result;
			},
		);

		$reg['wc_assign_product_category'] = array(
			'desc'     => 'Assign categories and/or tags to a product. category_ids[] / tag_ids[] replace by default; set append=true to add to existing.',
			'risk'     => 'write',
			'schema'   => array(
				'product_id'   => array( 'type' => 'integer' ),
				'category_ids' => array( 'type' => 'array' ),
				'tag_ids'      => array( 'type' => 'array' ),
				'append'       => array( 'type' => 'boolean' ),
			),
			'required' => array( 'product_id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$p = wc_get_product( (int) $a['product_id'] );
				if ( ! $p ) {
					throw new Exception( 'Product not found.' );
				}
				$append = ! empty( $a['append'] );
				if ( isset( $a['category_ids'] ) && is_array( $a['category_ids'] ) ) {
					$ids = array_map( 'intval', $a['category_ids'] );
					if ( $append ) {
						$ids = array_unique( array_merge( $p->get_category_ids(), $ids ) );
					}
					$p->set_category_ids( $ids );
				}
				if ( isset( $a['tag_ids'] ) && is_array( $a['tag_ids'] ) ) {
					$ids = array_map( 'intval', $a['tag_ids'] );
					if ( $append ) {
						$ids = array_unique( array_merge( $p->get_tag_ids(), $ids ) );
					}
					$p->set_tag_ids( $ids );
				}
				$p->save();
				return array(
					'product_id'  => (int) $a['product_id'],
					'category_ids'=> $p->get_category_ids(),
					'tag_ids'     => $p->get_tag_ids(),
					'updated'     => true,
				);
			},
		);

		// ============================================================
		// SALES INTELLIGENCE
		// ============================================================
		$reg['wc_top_sellers'] = array(
			'desc'    => 'Top-selling products by all-time units sold, from the WooCommerce product lookup table (fast). Returns rank, product, total_sales, current price and stock.',
			'risk'    => 'read',
			'schema'  => array(
				'limit' => array( 'type' => 'integer', 'description' => 'How many to return. Default 20, max 100.' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				global $wpdb;
				$limit = min( (int) ( $a['limit'] ?? 20 ), 100 );
				$table = $wpdb->prefix . 'wc_product_meta_lookup';
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$rows = $wpdb->get_results( $wpdb->prepare( "SELECT product_id, total_sales FROM {$table} WHERE total_sales > 0 ORDER BY total_sales DESC LIMIT %d", $limit ) );
				$out  = array();
				$rank = 1;
				foreach ( (array) $rows as $r ) {
					$p = wc_get_product( (int) $r->product_id );
					if ( ! $p ) {
						continue;
					}
					$out[] = array(
						'rank'         => $rank++,
						'id'           => $p->get_id(),
						'name'         => $p->get_name(),
						'sku'          => $p->get_sku(),
						'total_sales'  => (int) $r->total_sales,
						'price'        => $p->get_price(),
						'stock_status' => $p->get_stock_status(),
						'stock_qty'    => $p->get_stock_quantity(),
					);
				}
				return array( 'count' => count( $out ), 'items' => $out );
			},
		);

		$reg['wc_low_stock_report'] = array(
			'desc'    => 'Products at or below a stock threshold (plus out-of-stock), for restock planning. Only considers stock-managed products.',
			'risk'    => 'read',
			'schema'  => array(
				'threshold' => array( 'type' => 'integer', 'description' => 'Low-stock cutoff. Default 5.' ),
				'limit'     => array( 'type' => 'integer', 'description' => 'Max rows. Default 100.' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$threshold = (int) ( $a['threshold'] ?? 5 );
				$products  = wc_get_products(
					array(
						'limit'        => min( (int) ( $a['limit'] ?? 100 ), 500 ),
						'manage_stock' => true,
						'orderby'      => 'meta_value_num',
						'meta_key'     => '_stock',
						'order'        => 'ASC',
					)
				);
				$out = array();
				foreach ( (array) $products as $p ) {
					$qty = $p->get_stock_quantity();
					if ( null === $qty ) {
						continue;
					}
					if ( $qty <= $threshold ) {
						$out[] = array(
							'id'           => $p->get_id(),
							'name'         => $p->get_name(),
							'sku'          => $p->get_sku(),
							'stock_qty'    => (int) $qty,
							'stock_status' => $p->get_stock_status(),
						);
					}
				}
				return array( 'threshold' => $threshold, 'count' => count( $out ), 'items' => $out );
			},
		);

		$reg['wc_get_customer'] = array(
			'desc'     => 'Get a single customer with lifetime value: total spent, order count, average order value, last order date, and recent orders. Look up by customer_id or email.',
			'risk'     => 'read',
			'schema'   => array(
				'customer_id' => array( 'type' => 'integer' ),
				'email'       => array( 'type' => 'string' ),
			),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$cid = (int) ( $a['customer_id'] ?? 0 );
				if ( ! $cid && ! empty( $a['email'] ) ) {
					$user = get_user_by( 'email', sanitize_email( $a['email'] ) );
					if ( $user ) {
						$cid = $user->ID;
					}
				}
				if ( ! $cid ) {
					throw new Exception( 'Customer not found. Provide a valid customer_id or email.' );
				}
				$customer = new WC_Customer( $cid );
				$orders   = wc_get_orders(
					array(
						'customer_id' => $cid,
						'limit'       => 10,
						'orderby'     => 'date',
						'order'       => 'DESC',
					)
				);
				$recent = array();
				foreach ( $orders as $o ) {
					$recent[] = array(
						'id'     => $o->get_id(),
						'date'   => $o->get_date_created() ? $o->get_date_created()->date( 'Y-m-d' ) : null,
						'status' => $o->get_status(),
						'total'  => $o->get_total(),
					);
				}
				return array(
					'id'                  => $cid,
					'email'               => $customer->get_email(),
					'name'                => trim( $customer->get_first_name() . ' ' . $customer->get_last_name() ),
					'total_spent'         => wc_get_customer_total_spent( $cid ),
					'order_count'         => wc_get_customer_order_count( $cid ),
					'avg_order_value'     => wc_get_customer_order_count( $cid ) ? round( (float) wc_get_customer_total_spent( $cid ) / wc_get_customer_order_count( $cid ), 2 ) : 0,
					'last_order_date'     => isset( $recent[0]['date'] ) ? $recent[0]['date'] : null,
					'recent_orders'       => $recent,
				);
			},
		);

		return $reg;
	}
}
