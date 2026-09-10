<?php
/**
 * WooCommerce Order tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's WooCommerce Order tool set (orders,
 * order notes, refunds) into wp-x-mcp's procedural tool registry style.
 *
 * 11 tools: wc_get_orders, wc_create_order, wc_update_order, wc_delete_order,
 * wc_batch_update_orders, wc_get_order_notes, wc_create_order_note,
 * wc_delete_order_note, wc_get_refunds, wc_create_refund, wc_delete_refund.
 *
 * Complements the existing tools-woo-commerce.php (wc_get_order, wc_list_orders,
 * wc_update_order_status, wc_refund_order, wc_add_order_note) — no name
 * collisions; this file adds full create/update/delete/batch operations and
 * a richer order formatter (full address objects, line items, meta_data).
 *
 * Tools register only when WooCommerce is active.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Woo_Orders {

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

	public static function apply_address( \WC_Order $order, string $type, array $fields ): void {
		$allowed = array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country' );
		if ( 'billing' === $type ) {
			$allowed[] = 'email';
			$allowed[] = 'phone';
		}
		foreach ( $allowed as $field ) {
			if ( isset( $fields[ $field ] ) ) {
				$setter = 'set_' . $type . '_' . $field;
				if ( method_exists( $order, $setter ) ) {
					$order->$setter( sanitize_text_field( $fields[ $field ] ) );
				}
			}
		}
	}

	public static function format_order_line_items( \WC_Order $o ): array {
		$items = array();
		foreach ( $o->get_items() as $item_id => $item ) {
			$product = $item->get_product();
			$items[] = array(
				'id'         => $item_id,
				'product_id' => $item->get_product_id(),
				'name'       => $item->get_name(),
				'quantity'   => $item->get_quantity(),
				'total'      => $item->get_total(),
				'subtotal'   => $item->get_subtotal(),
				'sku'        => $product ? $product->get_sku() : '',
			);
		}
		return $items;
	}

	public static function format_order( \WC_Order $o ): array {
		$created  = $o->get_date_created();
		$modified = $o->get_date_modified();

		return array(
			'id'                   => $o->get_id(),
			'status'               => $o->get_status(),
			'currency'             => $o->get_currency(),
			'total'                => $o->get_total(),
			'subtotal'             => $o->get_subtotal(),
			'total_tax'            => $o->get_total_tax(),
			'shipping_total'       => $o->get_shipping_total(),
			'discount_total'       => $o->get_discount_total(),
			'customer_id'          => $o->get_customer_id(),
			'billing'              => array(
				'first_name' => $o->get_billing_first_name(),
				'last_name'  => $o->get_billing_last_name(),
				'company'    => $o->get_billing_company(),
				'address_1'  => $o->get_billing_address_1(),
				'address_2'  => $o->get_billing_address_2(),
				'city'       => $o->get_billing_city(),
				'state'      => $o->get_billing_state(),
				'postcode'   => $o->get_billing_postcode(),
				'country'    => $o->get_billing_country(),
				'email'      => $o->get_billing_email(),
				'phone'      => $o->get_billing_phone(),
			),
			'shipping'             => array(
				'first_name' => $o->get_shipping_first_name(),
				'last_name'  => $o->get_shipping_last_name(),
				'company'    => $o->get_shipping_company(),
				'address_1'  => $o->get_shipping_address_1(),
				'address_2'  => $o->get_shipping_address_2(),
				'city'       => $o->get_shipping_city(),
				'state'      => $o->get_shipping_state(),
				'postcode'   => $o->get_shipping_postcode(),
				'country'    => $o->get_shipping_country(),
			),
			'line_items'           => self::format_order_line_items( $o ),
			'customer_note'        => $o->get_customer_note(),
			'payment_method'       => $o->get_payment_method(),
			'payment_method_title' => $o->get_payment_method_title(),
			'date_created'         => $created ? $created->date( 'Y-m-d H:i:s' ) : null,
			'date_modified'        => $modified ? $modified->date( 'Y-m-d H:i:s' ) : null,
			'meta_data'            => array_values( array_map( function ( $meta ) {
				$d = $meta->get_data();
				return array( 'key' => $d['key'], 'value' => $d['value'] );
			}, $o->get_meta_data() ) ),
		);
	}

	public static function format_order_note( $note ): array {
		if ( $note instanceof WP_Comment ) {
			return array(
				'id'               => (int) $note->comment_ID,
				'note'             => $note->comment_content,
				'date'             => $note->comment_date,
				'author'           => $note->comment_author,
				'is_customer_note' => (bool) get_comment_meta( $note->comment_ID, 'is_customer_note', true ),
			);
		}
		// wc_get_order_notes() returns stdClass objects.
		return array(
			'id'               => isset( $note->id ) ? (int) $note->id : 0,
			'note'             => $note->content ?? '',
			'date'             => isset( $note->date_created ) ? $note->date_created->date( 'Y-m-d H:i:s' ) : '',
			'author'           => $note->added_by ?? '',
			'is_customer_note' => isset( $note->customer_note ) ? (bool) $note->customer_note : false,
		);
	}

	public static function format_refund( \WC_Order_Refund $r ): array {
		$created = $r->get_date_created();
		return array(
			'id'     => $r->get_id(),
			'amount' => $r->get_amount(),
			'reason' => $r->get_reason(),
			'date'   => $created ? $created->date( 'Y-m-d H:i:s' ) : null,
		);
	}

	/** Shared update logic used by both wc_update_order and wc_batch_update_orders. */
	public static function apply_order_update( array $a ): array {
		$order_id = absint( $a['order_id'] );
		$order    = wc_get_order( $order_id );
		if ( ! $order ) {
			throw new Exception( 'Order not found.' );
		}

		if ( isset( $a['status'] ) ) {
			$order->set_status( sanitize_key( $a['status'] ) );
		}
		if ( isset( $a['customer_note'] ) ) {
			$order->set_customer_note( sanitize_textarea_field( $a['customer_note'] ) );
		}
		if ( isset( $a['payment_method'] ) ) {
			$order->set_payment_method( sanitize_key( $a['payment_method'] ) );
		}
		if ( isset( $a['payment_method_title'] ) ) {
			$order->set_payment_method_title( sanitize_text_field( $a['payment_method_title'] ) );
		}
		if ( isset( $a['billing'] ) && is_array( $a['billing'] ) ) {
			self::apply_address( $order, 'billing', $a['billing'] );
		}
		if ( isset( $a['shipping'] ) && is_array( $a['shipping'] ) ) {
			self::apply_address( $order, 'shipping', $a['shipping'] );
		}
		if ( isset( $a['date_created'] ) ) {
			$ts = strtotime( sanitize_text_field( $a['date_created'] ) );
			if ( $ts ) {
				$order->set_date_created( $ts );
			}
		}
		if ( isset( $a['meta_data'] ) && is_array( $a['meta_data'] ) ) {
			foreach ( $a['meta_data'] as $meta ) {
				if ( ! isset( $meta['key'] ) ) continue;
				$order->update_meta_data( sanitize_text_field( $meta['key'] ), $meta['value'] ?? '' );
			}
		}

		$order->save();
		return array(
			'success' => true,
			'message' => 'Order updated successfully.',
			'order'   => self::format_order( wc_get_order( $order_id ) ),
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
		// Orders (5)
		// ============================================================

		$reg['wc_get_orders'] = array(
			'desc'    => 'List WooCommerce orders with filters: status, customer_id, date_after/before, search.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page'    => array( 'type' => 'integer', 'description' => 'Orders per page. Default 10.' ),
				'page'        => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'status'      => array( 'type' => 'string', 'description' => 'e.g. wc-pending, wc-processing, wc-completed.' ),
				'customer_id' => array( 'type' => 'integer', 'description' => 'Filter by customer user ID.' ),
				'date_after'  => array( 'type' => 'string', 'description' => 'ISO 8601 date — orders created after this date.' ),
				'date_before' => array( 'type' => 'string', 'description' => 'ISO 8601 date — orders created before this date.' ),
				'search'      => array( 'type' => 'string', 'description' => 'Matches order ID, customer name, email.' ),
			),
			'handler' => function ( $a ) {
				$qa = array(
					'limit'  => isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10,
					'page'   => isset( $a['page'] ) ? absint( $a['page'] ) : 1,
					'return' => 'objects',
				);
				if ( isset( $a['status'] ) )      $qa['status']      = sanitize_key( $a['status'] );
				if ( isset( $a['customer_id'] ) )  $qa['customer_id'] = absint( $a['customer_id'] );
				if ( isset( $a['date_after'] ) )   $qa['date_created'] = '>' . sanitize_text_field( $a['date_after'] );
				if ( isset( $a['date_before'] ) )  $qa['date_created'] = '<' . sanitize_text_field( $a['date_before'] );
				if ( isset( $a['search'] ) )       $qa['s']           = sanitize_text_field( $a['search'] );

				$orders = wc_get_orders( $qa );
				return array(
					'orders' => array_map( array( 'WPXMCP_Tools_Woo_Orders', 'format_order' ), $orders ),
					'total'  => count( $orders ),
				);
			},
		);

		$reg['wc_create_order'] = array(
			'desc'    => 'Create a new WooCommerce order with billing/shipping, line items, payment method, and custom meta.',
			'risk'    => 'write',
			'schema'  => array(
				'status'               => array( 'type' => 'string', 'description' => 'Order status. Default pending.' ),
				'customer_id'          => array( 'type' => 'integer', 'description' => 'Customer user ID (0 for guest). Default 0.' ),
				'customer_note'        => array( 'type' => 'string', 'description' => 'Customer-facing order note.' ),
				'payment_method'       => array( 'type' => 'string', 'description' => 'Payment method ID (bacs, cheque, paypal, etc.).' ),
				'payment_method_title' => array( 'type' => 'string', 'description' => 'Payment method display title.' ),
				'billing'              => array( 'type' => 'object', 'description' => 'Billing fields (first_name, last_name, email, phone, address_1, address_2, city, state, postcode, country).' ),
				'shipping'             => array( 'type' => 'object', 'description' => 'Shipping fields (first_name, last_name, address_1, address_2, city, state, postcode, country).' ),
				'line_items'           => array( 'type' => 'array', 'description' => 'Each object requires product_id and quantity.' ),
				'date_created'         => array( 'type' => 'string', 'description' => 'YYYY-MM-DD HH:MM:SS or YYYY-MM-DD.' ),
				'meta_data'            => array( 'type' => 'array', 'description' => 'Each object requires key and value.' ),
			),
			'handler' => function ( $a ) {
				$oa = array();
				if ( isset( $a['status'] ) )        $oa['status']        = sanitize_key( $a['status'] );
				if ( isset( $a['customer_id'] ) )    $oa['customer_id']   = absint( $a['customer_id'] );
				if ( isset( $a['customer_note'] ) )  $oa['customer_note'] = sanitize_textarea_field( $a['customer_note'] );

				$order = wc_create_order( $oa );
				if ( is_wp_error( $order ) ) {
					throw new Exception( $order->get_error_message() );
				}

				if ( isset( $a['payment_method'] ) )       $order->set_payment_method( sanitize_key( $a['payment_method'] ) );
				if ( isset( $a['payment_method_title'] ) ) $order->set_payment_method_title( sanitize_text_field( $a['payment_method_title'] ) );
				if ( isset( $a['billing'] ) && is_array( $a['billing'] ) )   WPXMCP_Tools_Woo_Orders::apply_address( $order, 'billing', $a['billing'] );
				if ( isset( $a['shipping'] ) && is_array( $a['shipping'] ) ) WPXMCP_Tools_Woo_Orders::apply_address( $order, 'shipping', $a['shipping'] );

				if ( isset( $a['line_items'] ) && is_array( $a['line_items'] ) ) {
					foreach ( $a['line_items'] as $item ) {
						if ( ! isset( $item['product_id'] ) ) continue;
						$product  = wc_get_product( absint( $item['product_id'] ) );
						$quantity = isset( $item['quantity'] ) ? absint( $item['quantity'] ) : 1;
						if ( $product ) {
							$order->add_product( $product, $quantity );
						}
					}
				}

				if ( isset( $a['date_created'] ) ) {
					$ts = strtotime( sanitize_text_field( $a['date_created'] ) );
					if ( $ts ) $order->set_date_created( $ts );
				}
				if ( isset( $a['meta_data'] ) && is_array( $a['meta_data'] ) ) {
					foreach ( $a['meta_data'] as $meta ) {
						if ( ! isset( $meta['key'] ) ) continue;
						$order->update_meta_data( sanitize_text_field( $meta['key'] ), $meta['value'] ?? '' );
					}
				}

				$order->calculate_totals();
				$order->save();

				return array(
					'success' => true,
					'message' => 'Order created successfully.',
					'order'   => WPXMCP_Tools_Woo_Orders::format_order( $order ),
				);
			},
		);

		$reg['wc_update_order'] = array(
			'desc'     => 'Update an existing WooCommerce order: status, customer note, payment method, addresses, date, meta.',
			'risk'     => 'write',
			'schema'   => array(
				'order_id'             => array( 'type' => 'integer', 'description' => 'Order ID.' ),
				'status'               => array( 'type' => 'string', 'description' => 'New order status.' ),
				'customer_note'        => array( 'type' => 'string', 'description' => 'Customer-facing order note.' ),
				'payment_method'       => array( 'type' => 'string', 'description' => 'Payment method ID.' ),
				'payment_method_title' => array( 'type' => 'string', 'description' => 'Payment method display title.' ),
				'billing'              => array( 'type' => 'object', 'description' => 'Billing fields to update.' ),
				'shipping'             => array( 'type' => 'object', 'description' => 'Shipping fields to update.' ),
				'date_created'         => array( 'type' => 'string', 'description' => 'Override creation date.' ),
				'meta_data'            => array( 'type' => 'array', 'description' => 'Adds/overwrites meta; never deletes other keys.' ),
			),
			'required' => array( 'order_id' ),
			'handler'  => function ( $a ) {
				return WPXMCP_Tools_Woo_Orders::apply_order_update( $a );
			},
		);

		$reg['wc_delete_order'] = array(
			'desc'     => 'Delete a WooCommerce order. Trashes by default; force=true permanently deletes.',
			'risk'     => 'destructive',
			'schema'   => array(
				'order_id' => array( 'type' => 'integer', 'description' => 'Order ID.' ),
				'force'    => array( 'type' => 'boolean', 'description' => 'true = permanent delete. Default false.' ),
			),
			'required' => array( 'order_id' ),
			'handler'  => function ( $a ) {
				$order = wc_get_order( absint( $a['order_id'] ) );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$force  = ! empty( $a['force'] );
				$result = $order->delete( $force );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete order.' );
				}
				return array(
					'success' => true,
					'message' => $force ? 'Order permanently deleted.' : 'Order moved to trash.',
				);
			},
		);

		$reg['wc_batch_update_orders'] = array(
			'desc'     => 'Batch update multiple WooCommerce orders. Each update object needs order_id plus fields to change.',
			'risk'     => 'write',
			'schema'   => array(
				'updates' => array( 'type' => 'array', 'description' => 'Array of update objects; each must include order_id.' ),
			),
			'required' => array( 'updates' ),
			'handler'  => function ( $a ) {
				$results = array();
				foreach ( $a['updates'] as $update ) {
					if ( ! isset( $update['order_id'] ) ) {
						$results[] = array( 'success' => false, 'error' => 'Missing order_id.' );
						continue;
					}
					try {
						WPXMCP_Tools_Woo_Orders::apply_order_update( $update );
						$results[] = array( 'order_id' => absint( $update['order_id'] ), 'success' => true );
					} catch ( Exception $e ) {
						$results[] = array(
							'order_id' => absint( $update['order_id'] ),
							'success'  => false,
							'error'    => $e->getMessage(),
						);
					}
				}
				return array( 'results' => $results );
			},
		);

		// ============================================================
		// Order Notes (3)
		// ============================================================

		$reg['wc_get_order_notes'] = array(
			'desc'     => 'Get notes for a WooCommerce order.',
			'risk'     => 'read',
			'schema'   => array(
				'order_id' => array( 'type' => 'integer', 'description' => 'Order ID.' ),
			),
			'required' => array( 'order_id' ),
			'handler'  => function ( $a ) {
				$order_id = absint( $a['order_id'] );
				$order    = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$notes = wc_get_order_notes( array( 'order_id' => $order_id ) );
				return array(
					'notes' => array_map( array( 'WPXMCP_Tools_Woo_Orders', 'format_order_note' ), $notes ),
					'total' => count( $notes ),
				);
			},
		);

		$reg['wc_create_order_note'] = array(
			'desc'     => 'Add a note to a WooCommerce order. Set is_customer_note=true to email the customer.',
			'risk'     => 'write',
			'schema'   => array(
				'order_id'         => array( 'type' => 'integer', 'description' => 'Order ID.' ),
				'note'             => array( 'type' => 'string', 'description' => 'Note content.' ),
				'is_customer_note' => array( 'type' => 'boolean', 'description' => 'Send note to customer via email. Default false.' ),
			),
			'required' => array( 'order_id', 'note' ),
			'handler'  => function ( $a ) {
				$order_id = absint( $a['order_id'] );
				$order    = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$is_customer = ! empty( $a['is_customer_note'] );
				$note_id     = $order->add_order_note( sanitize_textarea_field( $a['note'] ), (int) $is_customer );
				if ( ! $note_id ) {
					throw new Exception( 'Failed to create order note.' );
				}
				$note = get_comment( $note_id );
				return array(
					'success' => true,
					'message' => 'Order note created successfully.',
					'note'    => WPXMCP_Tools_Woo_Orders::format_order_note( $note ),
				);
			},
		);

		$reg['wc_delete_order_note'] = array(
			'desc'     => 'Delete a WooCommerce order note by its comment ID.',
			'risk'     => 'destructive',
			'schema'   => array(
				'note_id' => array( 'type' => 'integer', 'description' => 'Order note (comment) ID.' ),
			),
			'required' => array( 'note_id' ),
			'handler'  => function ( $a ) {
				$id     = absint( $a['note_id'] );
				$result = wc_delete_order_note( $id );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete order note.' );
				}
				return array( 'success' => true, 'message' => 'Order note deleted successfully.' );
			},
		);

		// ============================================================
		// Refunds (3)
		// ============================================================

		$reg['wc_get_refunds'] = array(
			'desc'     => 'Get refunds for a WooCommerce order.',
			'risk'     => 'read',
			'schema'   => array(
				'order_id' => array( 'type' => 'integer', 'description' => 'Order ID.' ),
			),
			'required' => array( 'order_id' ),
			'handler'  => function ( $a ) {
				$order_id = absint( $a['order_id'] );
				$order    = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$refunds = $order->get_refunds();
				return array(
					'refunds' => array_map( array( 'WPXMCP_Tools_Woo_Orders', 'format_refund' ), $refunds ),
					'total'   => count( $refunds ),
				);
			},
		);

		$reg['wc_create_refund'] = array(
			'desc'     => 'Create a refund for a WooCommerce order. Omit amount for full refund.',
			'risk'     => 'write',
			'schema'   => array(
				'order_id'      => array( 'type' => 'integer', 'description' => 'Order ID.' ),
				'amount'        => array( 'type' => 'string', 'description' => 'Refund amount (decimal string). Defaults to full order total.' ),
				'reason'        => array( 'type' => 'string', 'description' => 'Reason for the refund.' ),
				'restock_items' => array( 'type' => 'boolean', 'description' => 'Restock refunded items. Default false.' ),
				'line_items'    => array( 'type' => 'object', 'description' => 'Refund amounts keyed by order item ID; each value has qty and refund_total.' ),
			),
			'required' => array( 'order_id' ),
			'handler'  => function ( $a ) {
				$order_id = absint( $a['order_id'] );
				$order    = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$ra = array(
					'order_id'      => $order_id,
					'restock_items' => ! empty( $a['restock_items'] ),
				);
				if ( isset( $a['amount'] ) )     $ra['amount']     = sanitize_text_field( $a['amount'] );
				if ( isset( $a['reason'] ) )      $ra['reason']     = sanitize_textarea_field( $a['reason'] );
				if ( isset( $a['line_items'] ) && is_array( $a['line_items'] ) ) $ra['line_items'] = $a['line_items'];

				$refund = wc_create_refund( $ra );
				if ( is_wp_error( $refund ) ) {
					throw new Exception( $refund->get_error_message() );
				}
				return array(
					'success' => true,
					'message' => 'Refund created successfully.',
					'refund'  => WPXMCP_Tools_Woo_Orders::format_refund( $refund ),
				);
			},
		);

		$reg['wc_delete_refund'] = array(
			'desc'     => 'Permanently delete a WooCommerce order refund.',
			'risk'     => 'destructive',
			'schema'   => array(
				'order_id'  => array( 'type' => 'integer', 'description' => 'Parent order ID.' ),
				'refund_id' => array( 'type' => 'integer', 'description' => 'Refund ID.' ),
			),
			'required' => array( 'order_id', 'refund_id' ),
			'handler'  => function ( $a ) {
				$order_id  = absint( $a['order_id'] );
				$refund_id = absint( $a['refund_id'] );

				$order = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( 'Order not found.' );
				}
				$refund = wc_get_order( $refund_id );
				if ( ! $refund || ! ( $refund instanceof \WC_Order_Refund ) ) {
					throw new Exception( 'Refund not found.' );
				}
				$result = $refund->delete( true );
				if ( ! $result ) {
					throw new Exception( 'Failed to delete refund.' );
				}
				return array( 'success' => true, 'message' => 'Refund deleted successfully.' );
			},
		);

		return $reg;
	}
}
