<?php
/**
 * WooCommerce tool group: products, orders, customers.
 * All handlers no-op gracefully if WooCommerce is not active.
 *
 * @package StarTechMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_WooCommerce {

	private static function ensure_wc(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			throw new Exception( 'WooCommerce is not active on this site.' );
		}
	}

	public static function all(): array {
		$reg = array();

		// ---- PRODUCTS ----
		$reg['wc_list_products'] = array(
			'desc'    => 'List WooCommerce products. Filter by search, status, category, stock_status, type, per_page, page.',
			'risk'    => 'read',
			'schema'  => array(
				'search'       => array( 'type' => 'string' ),
				'status'       => array( 'type' => 'string', 'description' => 'publish, draft, any' ),
				'category'     => array( 'type' => 'string', 'description' => 'category slug' ),
				'stock_status' => array( 'type' => 'string', 'description' => 'instock, outofstock, onbackorder' ),
				'type'         => array( 'type' => 'string', 'description' => 'simple, variable, grouped, external' ),
				'per_page'     => array( 'type' => 'integer', 'description' => 'Default 20, max 100' ),
				'page'         => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$args = array(
					'status'   => $a['status'] ?? 'any',
					'limit'    => min( (int) ( $a['per_page'] ?? 20 ), 100 ),
					'page'     => (int) ( $a['page'] ?? 1 ),
					's'        => $a['search'] ?? '',
					'paginate' => true,
				);
				if ( ! empty( $a['category'] ) ) {
					$args['category'] = array( $a['category'] );
				}
				if ( ! empty( $a['stock_status'] ) ) {
					$args['stock_status'] = $a['stock_status'];
				}
				if ( ! empty( $a['type'] ) ) {
					$args['type'] = $a['type'];
				}
				$res = wc_get_products( $args );
				$out = array();
				foreach ( $res->products as $p ) {
					$out[] = array(
						'id'           => $p->get_id(),
						'name'         => $p->get_name(),
						'sku'          => $p->get_sku(),
						'type'         => $p->get_type(),
						'status'       => $p->get_status(),
						'price'        => $p->get_price(),
						'regular_price'=> $p->get_regular_price(),
						'sale_price'   => $p->get_sale_price(),
						'stock_status' => $p->get_stock_status(),
						'stock_qty'    => $p->get_stock_quantity(),
						'link'         => get_permalink( $p->get_id() ),
					);
				}
				return array( 'total' => $res->total, 'total_pages' => $res->max_num_pages, 'items' => $out );
			},
		);

		$reg['wc_get_product'] = array(
			'desc'     => 'Get full details of a single product by ID, including variations and meta.',
			'risk'     => 'read',
			'schema'   => array( 'id' => array( 'type' => 'integer' ) ),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$p = wc_get_product( (int) $a['id'] );
				if ( ! $p ) {
					throw new Exception( 'Product not found.' );
				}
				$data = array(
					'id'            => $p->get_id(),
					'name'          => $p->get_name(),
					'sku'           => $p->get_sku(),
					'type'          => $p->get_type(),
					'status'        => $p->get_status(),
					'description'   => $p->get_description(),
					'short_desc'    => $p->get_short_description(),
					'price'         => $p->get_price(),
					'regular_price' => $p->get_regular_price(),
					'sale_price'    => $p->get_sale_price(),
					'stock_status'  => $p->get_stock_status(),
					'stock_qty'     => $p->get_stock_quantity(),
					'categories'    => wp_get_post_terms( $p->get_id(), 'product_cat', array( 'fields' => 'names' ) ),
					'attributes'    => array_keys( $p->get_attributes() ),
					'link'          => get_permalink( $p->get_id() ),
				);
				if ( $p->is_type( 'variable' ) ) {
					$data['variations'] = $p->get_children();
				}
				return $data;
			},
		);

		$reg['wc_create_product'] = array(
			'desc'     => 'Create a simple WooCommerce product.',
			'risk'     => 'write',
			'schema'   => array(
				'name'          => array( 'type' => 'string' ),
				'regular_price' => array( 'type' => 'string' ),
				'sku'           => array( 'type' => 'string' ),
				'description'   => array( 'type' => 'string' ),
				'short_desc'    => array( 'type' => 'string' ),
				'status'        => array( 'type' => 'string', 'description' => 'Default publish' ),
				'stock_qty'     => array( 'type' => 'integer' ),
				'categories'    => array( 'type' => 'array', 'description' => 'Array of category IDs' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$p = new WC_Product_Simple();
				$p->set_name( $a['name'] );
				$p->set_status( $a['status'] ?? 'publish' );
				if ( isset( $a['regular_price'] ) ) {
					$p->set_regular_price( (string) $a['regular_price'] );
				}
				if ( ! empty( $a['sku'] ) ) {
					$p->set_sku( $a['sku'] );
				}
				if ( isset( $a['description'] ) ) {
					$p->set_description( $a['description'] );
				}
				if ( isset( $a['short_desc'] ) ) {
					$p->set_short_description( $a['short_desc'] );
				}
				if ( isset( $a['stock_qty'] ) ) {
					$p->set_manage_stock( true );
					$p->set_stock_quantity( (int) $a['stock_qty'] );
				}
				if ( ! empty( $a['categories'] ) && is_array( $a['categories'] ) ) {
					$p->set_category_ids( array_map( 'intval', $a['categories'] ) );
				}
				$id = $p->save();
				return array( 'id' => $id, 'link' => get_permalink( $id ) );
			},
		);

		$reg['wc_update_product'] = array(
			'desc'     => 'Update fields of a product by ID (price, stock, status, name, description, sku).',
			'risk'     => 'write',
			'schema'   => array(
				'id'            => array( 'type' => 'integer' ),
				'name'          => array( 'type' => 'string' ),
				'regular_price' => array( 'type' => 'string' ),
				'sale_price'    => array( 'type' => 'string' ),
				'sku'           => array( 'type' => 'string' ),
				'description'   => array( 'type' => 'string' ),
				'short_desc'    => array( 'type' => 'string' ),
				'status'        => array( 'type' => 'string' ),
				'stock_qty'     => array( 'type' => 'integer' ),
				'stock_status'  => array( 'type' => 'string' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$p = wc_get_product( (int) $a['id'] );
				if ( ! $p ) {
					throw new Exception( 'Product not found.' );
				}
				if ( isset( $a['name'] ) ) {
					$p->set_name( $a['name'] );
				}
				if ( isset( $a['regular_price'] ) ) {
					$p->set_regular_price( (string) $a['regular_price'] );
				}
				if ( isset( $a['sale_price'] ) ) {
					$p->set_sale_price( (string) $a['sale_price'] );
				}
				if ( isset( $a['sku'] ) ) {
					$p->set_sku( $a['sku'] );
				}
				if ( isset( $a['description'] ) ) {
					$p->set_description( $a['description'] );
				}
				if ( isset( $a['short_desc'] ) ) {
					$p->set_short_description( $a['short_desc'] );
				}
				if ( isset( $a['status'] ) ) {
					$p->set_status( $a['status'] );
				}
				if ( isset( $a['stock_qty'] ) ) {
					$p->set_manage_stock( true );
					$p->set_stock_quantity( (int) $a['stock_qty'] );
				}
				if ( isset( $a['stock_status'] ) ) {
					$p->set_stock_status( $a['stock_status'] );
				}
				$p->save();
				return array( 'id' => (int) $a['id'], 'updated' => true );
			},
		);

		$reg['wc_delete_product'] = array(
			'desc'     => 'Delete a product by ID (trash or force-delete).',
			'risk'     => 'destructive',
			'schema'   => array(
				'id'    => array( 'type' => 'integer' ),
				'force' => array( 'type' => 'boolean' ),
			),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$p = wc_get_product( (int) $a['id'] );
				if ( ! $p ) {
					throw new Exception( 'Product not found.' );
				}
				$p->delete( ! empty( $a['force'] ) );
				return array( 'id' => (int) $a['id'], 'deleted' => true );
			},
		);

		// ---- ORDERS ----
		$reg['wc_list_orders'] = array(
			'desc'    => 'List WooCommerce orders. Filter by status, customer, search, date range, per_page, page.',
			'risk'    => 'read',
			'schema'  => array(
				'status'      => array( 'type' => 'string', 'description' => 'processing, completed, on-hold, pending, cancelled, refunded, failed' ),
				'customer_id' => array( 'type' => 'integer' ),
				'search'      => array( 'type' => 'string' ),
				'after'       => array( 'type' => 'string', 'description' => 'ISO date, orders created after' ),
				'before'      => array( 'type' => 'string', 'description' => 'ISO date, orders created before' ),
				'per_page'    => array( 'type' => 'integer', 'description' => 'Default 20' ),
				'page'        => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$args = array(
					'limit'    => (int) ( $a['per_page'] ?? 20 ),
					'page'     => (int) ( $a['page'] ?? 1 ),
					'paginate' => true,
				);
				if ( ! empty( $a['status'] ) ) {
					$args['status'] = $a['status'];
				}
				if ( ! empty( $a['customer_id'] ) ) {
					$args['customer_id'] = (int) $a['customer_id'];
				}
				if ( ! empty( $a['search'] ) ) {
					$args['s'] = $a['search'];
				}
				if ( ! empty( $a['after'] ) ) {
					$args['date_created'] = '>=' . strtotime( $a['after'] );
				}
				$res = wc_get_orders( $args );
				$out = array();
				foreach ( $res->orders as $o ) {
					$out[] = array(
						'id'       => $o->get_id(),
						'number'   => $o->get_order_number(),
						'status'   => $o->get_status(),
						'total'    => $o->get_total(),
						'currency' => $o->get_currency(),
						'customer' => $o->get_billing_first_name() . ' ' . $o->get_billing_last_name(),
						'email'    => $o->get_billing_email(),
						'date'     => $o->get_date_created() ? $o->get_date_created()->date( 'c' ) : null,
						'items'    => $o->get_item_count(),
					);
				}
				return array( 'total' => $res->total, 'total_pages' => $res->max_num_pages, 'items' => $out );
			},
		);

		$reg['wc_get_order'] = array(
			'desc'     => 'Get full details of an order by ID: line items, totals, customer, addresses, notes.',
			'risk'     => 'read',
			'schema'   => array( 'id' => array( 'type' => 'integer' ) ),
			'required' => array( 'id' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$o = wc_get_order( (int) $a['id'] );
				if ( ! $o ) {
					throw new Exception( 'Order not found.' );
				}
				$items = array();
				foreach ( $o->get_items() as $item ) {
					$items[] = array(
						'name'     => $item->get_name(),
						'product_id' => $item->get_product_id(),
						'quantity' => $item->get_quantity(),
						'total'    => $item->get_total(),
					);
				}
				return array(
					'id'             => $o->get_id(),
					'number'         => $o->get_order_number(),
					'status'         => $o->get_status(),
					'currency'       => $o->get_currency(),
					'total'          => $o->get_total(),
					'subtotal'       => $o->get_subtotal(),
					'shipping_total' => $o->get_shipping_total(),
					'payment_method' => $o->get_payment_method_title(),
					'customer'       => array(
						'first_name' => $o->get_billing_first_name(),
						'last_name'  => $o->get_billing_last_name(),
						'email'      => $o->get_billing_email(),
						'phone'      => $o->get_billing_phone(),
					),
					'billing_address'  => $o->get_formatted_billing_address(),
					'shipping_address' => $o->get_formatted_shipping_address(),
					'items'            => $items,
					'date'             => $o->get_date_created() ? $o->get_date_created()->date( 'c' ) : null,
				);
			},
		);

		$reg['wc_update_order_status'] = array(
			'desc'     => 'Change an order\'s status. Optionally add a note.',
			'risk'     => 'write',
			'schema'   => array(
				'id'     => array( 'type' => 'integer' ),
				'status' => array( 'type' => 'string', 'description' => 'processing, completed, on-hold, cancelled, refunded, etc.' ),
				'note'   => array( 'type' => 'string' ),
			),
			'required' => array( 'id', 'status' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$o = wc_get_order( (int) $a['id'] );
				if ( ! $o ) {
					throw new Exception( 'Order not found.' );
				}
				$o->update_status( $a['status'], $a['note'] ?? '' );
				return array( 'id' => (int) $a['id'], 'status' => $o->get_status() );
			},
		);

		$reg['wc_add_order_note'] = array(
			'desc'     => 'Add a note to an order (customer-facing or private).',
			'risk'     => 'write',
			'schema'   => array(
				'id'            => array( 'type' => 'integer' ),
				'note'          => array( 'type' => 'string' ),
				'customer_note' => array( 'type' => 'boolean', 'description' => 'If true, emailed to customer' ),
			),
			'required' => array( 'id', 'note' ),
			'handler'  => function ( $a ) {
				self::ensure_wc();
				$o = wc_get_order( (int) $a['id'] );
				if ( ! $o ) {
					throw new Exception( 'Order not found.' );
				}
				$note_id = $o->add_order_note( $a['note'], ! empty( $a['customer_note'] ) );
				return array( 'order_id' => (int) $a['id'], 'note_id' => $note_id );
			},
		);

		// ---- CUSTOMERS ----
		$reg['wc_list_customers'] = array(
			'desc'    => 'List WooCommerce customers. Search by name or email.',
			'risk'    => 'read',
			'schema'  => array(
				'search'   => array( 'type' => 'string' ),
				'per_page' => array( 'type' => 'integer', 'description' => 'Default 20' ),
				'page'     => array( 'type' => 'integer' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$users = get_users(
					array(
						'role'    => 'customer',
						'search'  => isset( $a['search'] ) ? '*' . $a['search'] . '*' : '',
						'number'  => (int) ( $a['per_page'] ?? 20 ),
						'paged'   => (int) ( $a['page'] ?? 1 ),
					)
				);
				$out = array();
				foreach ( $users as $u ) {
					$c     = new WC_Customer( $u->ID );
					$out[] = array(
						'id'          => $u->ID,
						'email'       => $u->user_email,
						'name'        => $u->display_name,
						'orders'      => $c->get_order_count(),
						'total_spent' => $c->get_total_spent(),
					);
				}
				return $out;
			},
		);

		// ---- REPORTS ----
		$reg['wc_sales_report'] = array(
			'desc'    => 'Get a quick sales summary: total revenue, order count, average order value for a date range.',
			'risk'    => 'read',
			'schema'  => array(
				'after'  => array( 'type' => 'string', 'description' => 'ISO date. Default 30 days ago.' ),
				'before' => array( 'type' => 'string', 'description' => 'ISO date. Default now.' ),
			),
			'handler' => function ( $a ) {
				self::ensure_wc();
				$after  = ! empty( $a['after'] ) ? strtotime( $a['after'] ) : strtotime( '-30 days' );
				$before = ! empty( $a['before'] ) ? strtotime( $a['before'] ) : time();
				$orders = wc_get_orders(
					array(
						'limit'        => -1,
						'status'       => array( 'processing', 'completed' ),
						'date_created' => $after . '...' . $before,
					)
				);
				$revenue = 0;
				$count   = 0;
				foreach ( $orders as $o ) {
					$revenue += (float) $o->get_total();
					$count++;
				}
				return array(
					'from'        => gmdate( 'Y-m-d', $after ),
					'to'          => gmdate( 'Y-m-d', $before ),
					'order_count' => $count,
					'revenue'     => round( $revenue, 2 ),
					'currency'    => get_woocommerce_currency(),
					'avg_order'   => $count ? round( $revenue / $count, 2 ) : 0,
				);
			},
		);

		return $reg;
	}
}
