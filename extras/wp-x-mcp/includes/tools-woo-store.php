<?php
/**
 * WooCommerce Store tools for WP x MCP.
 *
 * Ports MountDev AI MCP Connector's WooCommerce Store tool set into
 * wp-x-mcp's procedural tool registry style: shipping zones + methods, tax
 * rates + classes, webhooks, payment gateways, sales/top-sellers reports,
 * store settings (allowlisted), and system status + maintenance tools.
 *
 * SKIPPED (3 collisions — existing tools-woo-commerce.php keeps these):
 *   wc_create_coupon, wc_update_coupon, wc_delete_coupon
 * (wc_get_coupons from MountDev is NOT skipped — existing tool is
 *  wc_list_coupons, a different name, so both are kept.)
 *
 * 23 tools register only when WooCommerce is active. Settings/system tools
 * use hard allowlists (copied verbatim from MountDev) to prevent arbitrary
 * option writes or arbitrary SQL/maintenance execution.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_Woo_Store {

	/** Allowlisted WC option keys for wc_get_settings / wc_update_setting_option. */
	private static $settings_allowlist = array(
		'woocommerce_currency',
		'woocommerce_currency_pos',
		'woocommerce_price_thousand_sep',
		'woocommerce_price_decimal_sep',
		'woocommerce_price_num_decimals',
		'woocommerce_store_address',
		'woocommerce_store_address_2',
		'woocommerce_store_city',
		'woocommerce_default_country',
		'woocommerce_store_postcode',
		'woocommerce_calc_taxes',
		'woocommerce_enable_guest_checkout',
		'woocommerce_enable_checkout_login_reminder',
		'woocommerce_enable_signup_and_login_from_checkout',
		'woocommerce_enable_myaccount_registration',
		'woocommerce_registration_generate_username',
		'woocommerce_registration_generate_password',
		'woocommerce_email_from_name',
		'woocommerce_email_from_address',
		'woocommerce_notify_low_stock_amount',
		'woocommerce_notify_no_stock_amount',
		'woocommerce_stock_email_recipient',
		'woocommerce_manage_stock',
		'woocommerce_hold_stock_minutes',
		'woocommerce_notify_low_stock',
		'woocommerce_notify_no_stock',
		'woocommerce_weight_unit',
		'woocommerce_dimension_unit',
		'woocommerce_reviews_rating_required',
		'woocommerce_review_rating_verification_label',
		'woocommerce_prices_include_tax',
		'woocommerce_tax_based_on',
		'woocommerce_shipping_tax_class',
		'woocommerce_tax_round_at_subtotal',
		'woocommerce_tax_classes',
		'woocommerce_tax_display_shop',
		'woocommerce_tax_display_cart',
		'woocommerce_price_display_suffix',
		'woocommerce_tax_total_display',
	);

	/** Allowlisted system status maintenance tool IDs for wc_run_system_status_tool. */
	private static $system_tools_allowlist = array(
		'clear_transients',
		'clear_expired_transients',
		'delete_orphaned_variations',
		'recount_terms',
		'clear_ratings',
		'reset_roles',
	);

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

	public static function format_coupon( \WC_Coupon $c ): array {
		$expires  = $c->get_date_expires();
		$created  = $c->get_date_created();
		$modified = $c->get_date_modified();

		return array(
			'id'                          => $c->get_id(),
			'code'                        => $c->get_code(),
			'description'                 => $c->get_description(),
			'discount_type'               => $c->get_discount_type(),
			'amount'                      => $c->get_amount(),
			'free_shipping'               => $c->get_free_shipping(),
			'expiry_date'                 => $expires ? $expires->date( 'Y-m-d' ) : null,
			'minimum_amount'              => $c->get_minimum_amount(),
			'maximum_amount'              => $c->get_maximum_amount(),
			'individual_use'              => $c->get_individual_use(),
			'exclude_sale_items'          => $c->get_exclude_sale_items(),
			'product_ids'                 => $c->get_product_ids(),
			'excluded_product_ids'        => $c->get_excluded_product_ids(),
			'product_categories'          => $c->get_product_categories(),
			'excluded_product_categories' => $c->get_excluded_product_categories(),
			'email_restrictions'          => $c->get_email_restrictions(),
			'product_brands'              => (array) get_post_meta( $c->get_id(), 'product_brands', true ),
			'excluded_product_brands'     => (array) get_post_meta( $c->get_id(), 'exclude_product_brands', true ),
			'usage_limit'                 => $c->get_usage_limit(),
			'usage_limit_per_user'        => $c->get_usage_limit_per_user(),
			'usage_count'                 => $c->get_usage_count(),
			'date_created'                => $created ? $created->date( 'Y-m-d H:i:s' ) : null,
			'date_modified'               => $modified ? $modified->date( 'Y-m-d H:i:s' ) : null,
		);
	}

	public static function format_shipping_zone( \WC_Shipping_Zone $zone ): array {
		return array(
			'id'        => $zone->get_id(),
			'name'      => $zone->get_zone_name(),
			'order'     => $zone->get_zone_order(),
			'locations' => $zone->get_zone_locations(),
		);
	}

	public static function format_shipping_zone_method( $method ): array {
		return array(
			'instance_id' => $method->get_instance_id(),
			'id'          => $method->id,
			'title'       => $method->get_title(),
			'enabled'     => $method->is_enabled(),
			'order'       => isset( $method->method_order ) ? $method->method_order : null,
		);
	}

	public static function format_tax_rate( array $rate ): array {
		return array(
			'id'       => (int) $rate['tax_rate_id'],
			'country'  => $rate['tax_rate_country'],
			'state'    => $rate['tax_rate_state'],
			'rate'     => $rate['tax_rate'],
			'name'     => $rate['tax_rate_name'],
			'priority' => (int) $rate['tax_rate_priority'],
			'compound' => (bool) $rate['tax_rate_compound'],
			'shipping' => (bool) $rate['tax_rate_shipping'],
			'order'    => (int) $rate['tax_rate_order'],
			'class'    => $rate['tax_rate_class'],
		);
	}

	public static function get_tax_rate_by_id( int $rate_id ) {
		global $wpdb;
		$rate = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_id = %d", $rate_id ),
			ARRAY_A
		);
		return $rate ? self::format_tax_rate( $rate ) : null;
	}

	public static function format_webhook( \WC_Webhook $w ): array {
		$created  = $w->get_date_created();
		$modified = $w->get_date_modified();
		return array(
			'id'            => $w->get_id(),
			'name'          => $w->get_name(),
			'status'        => $w->get_status(),
			'topic'         => $w->get_topic(),
			'delivery_url'  => $w->get_delivery_url(),
			'date_created'  => $created ? $created->date( 'Y-m-d H:i:s' ) : null,
			'date_modified' => $modified ? $modified->date( 'Y-m-d H:i:s' ) : null,
		);
	}

	public static function format_payment_gateway( \WC_Payment_Gateway $gw ): array {
		return array(
			'id'                 => $gw->id,
			'title'              => $gw->get_title(),
			'description'        => $gw->get_description(),
			'method_title'       => $gw->get_method_title(),
			'method_description' => $gw->get_method_description(),
			'enabled'            => 'yes' === $gw->enabled,
			'supports'           => $gw->supports,
		);
	}

	public static function apply_zone_locations( \WC_Shipping_Zone $zone, array $locations ): void {
		$zone->clear_locations();
		foreach ( $locations as $loc ) {
			if ( ! isset( $loc['code'], $loc['type'] ) ) continue;
			$zone->add_location( sanitize_text_field( $loc['code'] ), sanitize_key( $loc['type'] ) );
		}
	}

	public static function apply_coupon_args( \WC_Coupon $coupon, array $a ): void {
		if ( isset( $a['description'] ) )      $coupon->set_description( sanitize_textarea_field( $a['description'] ) );
		if ( isset( $a['discount_type'] ) )     $coupon->set_discount_type( sanitize_key( $a['discount_type'] ) );
		if ( isset( $a['amount'] ) )            $coupon->set_amount( sanitize_text_field( $a['amount'] ) );
		if ( isset( $a['free_shipping'] ) )     $coupon->set_free_shipping( (bool) $a['free_shipping'] );

		// Use array_key_exists so an explicit empty string clears the date.
		if ( array_key_exists( 'expiry_date', $a ) ) {
			if ( '' === $a['expiry_date'] || null === $a['expiry_date'] ) {
				$coupon->set_date_expires( '' );
			} else {
				$ts = strtotime( sanitize_text_field( $a['expiry_date'] ) );
				if ( $ts ) $coupon->set_date_expires( $ts );
			}
		}

		if ( isset( $a['minimum_amount'] ) )       $coupon->set_minimum_amount( sanitize_text_field( $a['minimum_amount'] ) );
		if ( isset( $a['maximum_amount'] ) )        $coupon->set_maximum_amount( sanitize_text_field( $a['maximum_amount'] ) );
		if ( isset( $a['individual_use'] ) )        $coupon->set_individual_use( (bool) $a['individual_use'] );
		if ( isset( $a['exclude_sale_items'] ) )    $coupon->set_exclude_sale_items( (bool) $a['exclude_sale_items'] );
		if ( isset( $a['product_ids'] ) && is_array( $a['product_ids'] ) )                         $coupon->set_product_ids( array_map( 'absint', $a['product_ids'] ) );
		if ( isset( $a['excluded_product_ids'] ) && is_array( $a['excluded_product_ids'] ) )         $coupon->set_excluded_product_ids( array_map( 'absint', $a['excluded_product_ids'] ) );
		if ( isset( $a['product_categories'] ) && is_array( $a['product_categories'] ) )             $coupon->set_product_categories( array_map( 'absint', $a['product_categories'] ) );
		if ( isset( $a['excluded_product_categories'] ) && is_array( $a['excluded_product_categories'] ) ) $coupon->set_excluded_product_categories( array_map( 'absint', $a['excluded_product_categories'] ) );
		if ( isset( $a['email_restrictions'] ) && is_array( $a['email_restrictions'] ) )             $coupon->set_email_restrictions( array_map( 'sanitize_email', $a['email_restrictions'] ) );
		if ( isset( $a['usage_limit'] ) )            $coupon->set_usage_limit( absint( $a['usage_limit'] ) );
		if ( isset( $a['usage_limit_per_user'] ) )    $coupon->set_usage_limit_per_user( absint( $a['usage_limit_per_user'] ) );
	}

	public static function apply_coupon_brand_meta( int $coupon_id, array $a ): void {
		if ( isset( $a['product_brands'] ) && is_array( $a['product_brands'] ) ) {
			update_post_meta( $coupon_id, 'product_brands', array_map( 'absint', $a['product_brands'] ) );
		}
		if ( isset( $a['excluded_product_brands'] ) && is_array( $a['excluded_product_brands'] ) ) {
			update_post_meta( $coupon_id, 'exclude_product_brands', array_map( 'absint', $a['excluded_product_brands'] ) );
		}
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
		// Coupons (1 — list only; create/update/delete collide and
		// are intentionally skipped in favor of existing tools)
		// ============================================================

		$reg['wc_get_coupons'] = array(
			'desc'    => 'List WooCommerce coupons with optional search filter (matches coupon code). Complements the existing wc_list_coupons tool with a richer coupon shape (restrictions, usage limits, brand meta).',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Coupons per page. Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'search'   => array( 'type' => 'string', 'description' => 'Search term (matches coupon code).' ),
			),
			'handler' => function ( $a ) {
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;

				$qa = array(
					'post_type'      => 'shop_coupon',
					'post_status'    => 'publish',
					'posts_per_page' => $per_page,
					'paged'          => $page,
				);
				if ( isset( $a['search'] ) ) $qa['s'] = sanitize_text_field( $a['search'] );

				$q       = new WP_Query( $qa );
				$coupons = array();
				foreach ( $q->posts as $post ) {
					$coupons[] = WPXMCP_Tools_Woo_Store::format_coupon( new \WC_Coupon( $post->ID ) );
				}
				return array( 'coupons' => $coupons, 'total' => $q->found_posts );
			},
		);

		// ============================================================
		// Shipping (4)
		// ============================================================

		$reg['wc_get_shipping_zones'] = array(
			'desc'    => 'Get all WooCommerce shipping zones, including the "Rest of the World" zone (ID 0).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$zones  = \WC_Shipping_Zones::get_zones();
				$result = array( WPXMCP_Tools_Woo_Store::format_shipping_zone( new \WC_Shipping_Zone( 0 ) ) );
				foreach ( $zones as $zd ) {
					$zone = \WC_Shipping_Zones::get_zone( $zd['zone_id'] );
					if ( $zone ) {
						$result[] = WPXMCP_Tools_Woo_Store::format_shipping_zone( $zone );
					}
				}
				return array( 'zones' => $result, 'total' => count( $result ) );
			},
		);

		$reg['wc_create_shipping_zone'] = array(
			'desc'     => 'Create a WooCommerce shipping zone with optional locations.',
			'risk'     => 'write',
			'schema'   => array(
				'name'      => array( 'type' => 'string', 'description' => 'Zone name.' ),
				'order'     => array( 'type' => 'integer', 'description' => 'Zone display order. Default 0.' ),
				'locations' => array( 'type' => 'array', 'description' => 'Each object needs code (e.g. US, US:CA, 90210) and type (country, state, postcode, continent).' ),
			),
			'required' => array( 'name' ),
			'handler'  => function ( $a ) {
				$zone = new \WC_Shipping_Zone();
				$zone->set_zone_name( sanitize_text_field( $a['name'] ) );
				if ( isset( $a['order'] ) ) {
					$zone->set_zone_order( absint( $a['order'] ) );
				}
				$zone_id = $zone->save();
				if ( ! $zone_id ) {
					throw new Exception( 'Failed to create shipping zone.' );
				}
				if ( isset( $a['locations'] ) && is_array( $a['locations'] ) ) {
					WPXMCP_Tools_Woo_Store::apply_zone_locations( $zone, $a['locations'] );
					$zone->save();
				}
				return array(
					'success' => true,
					'message' => 'Shipping zone created successfully.',
					'zone'    => WPXMCP_Tools_Woo_Store::format_shipping_zone( \WC_Shipping_Zones::get_zone( $zone_id ) ),
				);
			},
		);

		$reg['wc_update_shipping_zone'] = array(
			'desc'     => 'Update a WooCommerce shipping zone. Passing locations replaces the existing set entirely.',
			'risk'     => 'write',
			'schema'   => array(
				'zone_id'   => array( 'type' => 'integer', 'description' => 'Zone ID.' ),
				'name'      => array( 'type' => 'string', 'description' => 'Zone name.' ),
				'order'     => array( 'type' => 'integer', 'description' => 'Zone display order.' ),
				'locations' => array( 'type' => 'array', 'description' => 'Replaces existing locations; each object needs code and type.' ),
			),
			'required' => array( 'zone_id' ),
			'handler'  => function ( $a ) {
				$zone = \WC_Shipping_Zones::get_zone( absint( $a['zone_id'] ) );
				if ( ! $zone ) {
					throw new Exception( 'Shipping zone not found.' );
				}
				if ( isset( $a['name'] ) )  $zone->set_zone_name( sanitize_text_field( $a['name'] ) );
				if ( isset( $a['order'] ) ) $zone->set_zone_order( absint( $a['order'] ) );
				if ( isset( $a['locations'] ) && is_array( $a['locations'] ) ) {
					WPXMCP_Tools_Woo_Store::apply_zone_locations( $zone, $a['locations'] );
				}
				$zone->save();
				return array(
					'success' => true,
					'message' => 'Shipping zone updated successfully.',
					'zone'    => WPXMCP_Tools_Woo_Store::format_shipping_zone( $zone ),
				);
			},
		);

		$reg['wc_delete_shipping_zone'] = array(
			'desc'     => 'Delete a WooCommerce shipping zone and all its methods.',
			'risk'     => 'destructive',
			'schema'   => array(
				'zone_id' => array( 'type' => 'integer', 'description' => 'Zone ID.' ),
			),
			'required' => array( 'zone_id' ),
			'handler'  => function ( $a ) {
				$zone = \WC_Shipping_Zones::get_zone( absint( $a['zone_id'] ) );
				if ( ! $zone ) {
					throw new Exception( 'Shipping zone not found.' );
				}
				$zone->delete();
				return array( 'success' => true, 'message' => 'Shipping zone deleted.' );
			},
		);

		$reg['wc_get_shipping_zone_methods'] = array(
			'desc'     => 'Get shipping methods configured for a WooCommerce shipping zone (zone_id 0 = Rest of the World).',
			'risk'     => 'read',
			'schema'   => array(
				'zone_id' => array( 'type' => 'integer', 'description' => 'Zone ID (0 = Rest of the World).' ),
			),
			'required' => array( 'zone_id' ),
			'handler'  => function ( $a ) {
				$zone = \WC_Shipping_Zones::get_zone( absint( $a['zone_id'] ) );
				if ( ! $zone ) {
					throw new Exception( 'Shipping zone not found.' );
				}
				$methods = $zone->get_shipping_methods();
				return array(
					'zone_id' => $zone->get_id(),
					'methods' => array_values( array_map( array( 'WPXMCP_Tools_Woo_Store', 'format_shipping_zone_method' ), $methods ) ),
					'total'   => count( $methods ),
				);
			},
		);

		// ============================================================
		// Tax (4)
		// ============================================================

		$reg['wc_get_tax_rates'] = array(
			'desc'    => 'List WooCommerce tax rates with optional class filter.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Rates per page. Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'class'    => array( 'type' => 'string', 'description' => 'Tax class slug; empty string = standard rate.' ),
			),
			'handler' => function ( $a ) {
				global $wpdb;
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$offset   = ( $page - 1 ) * $per_page;

				$where = '';
				if ( isset( $a['class'] ) ) {
					$where = $wpdb->prepare( ' WHERE tax_rate_class = %s', sanitize_text_field( $a['class'] ) );
				}

				$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}woocommerce_tax_rates{$where}" );
				$rates = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT * FROM {$wpdb->prefix}woocommerce_tax_rates{$where} ORDER BY tax_rate_order ASC LIMIT %d OFFSET %d",
						$per_page,
						$offset
					),
					ARRAY_A
				);

				return array(
					'rates' => array_map( array( 'WPXMCP_Tools_Woo_Store', 'format_tax_rate' ), $rates ),
					'total' => $total,
				);
			},
		);

		$reg['wc_create_tax_rate'] = array(
			'desc'     => 'Create a WooCommerce tax rate.',
			'risk'     => 'write',
			'schema'   => array(
				'country'  => array( 'type' => 'string', 'description' => 'Two-letter country code; empty = all countries.' ),
				'state'    => array( 'type' => 'string', 'description' => 'State code; * = all states.' ),
				'rate'     => array( 'type' => 'string', 'description' => 'Tax rate as a decimal (e.g. "20.0000").' ),
				'name'     => array( 'type' => 'string', 'description' => 'Rate label.' ),
				'priority' => array( 'type' => 'integer', 'description' => 'Priority. Default 1.' ),
				'compound' => array( 'type' => 'boolean', 'description' => 'Compound rate. Default false.' ),
				'shipping' => array( 'type' => 'boolean', 'description' => 'Apply rate to shipping. Default true.' ),
				'order'    => array( 'type' => 'integer', 'description' => 'Display order. Default 0.' ),
				'class'    => array( 'type' => 'string', 'description' => 'Tax class slug; empty = standard rate.' ),
			),
			'required' => array( 'rate', 'name' ),
			'handler'  => function ( $a ) {
				$tr = array(
					'tax_rate_country'  => isset( $a['country'] ) ? strtoupper( sanitize_text_field( $a['country'] ) ) : '',
					'tax_rate_state'    => isset( $a['state'] ) ? strtoupper( sanitize_text_field( $a['state'] ) ) : '*',
					'tax_rate'          => isset( $a['rate'] ) ? number_format( (float) $a['rate'], 4, '.', '' ) : '0.0000',
					'tax_rate_name'     => isset( $a['name'] ) ? sanitize_text_field( $a['name'] ) : 'Tax',
					'tax_rate_priority' => isset( $a['priority'] ) ? absint( $a['priority'] ) : 1,
					'tax_rate_compound' => ( isset( $a['compound'] ) && $a['compound'] ) ? 1 : 0,
					'tax_rate_shipping' => ( ! isset( $a['shipping'] ) || $a['shipping'] ) ? 1 : 0,
					'tax_rate_order'    => isset( $a['order'] ) ? absint( $a['order'] ) : 0,
					'tax_rate_class'    => isset( $a['class'] ) ? sanitize_text_field( $a['class'] ) : '',
				);
				$id = \WC_Tax::_insert_tax_rate( $tr );
				if ( ! $id ) {
					throw new Exception( 'Failed to create tax rate.' );
				}
				return array(
					'success' => true,
					'message' => 'Tax rate created successfully.',
					'rate'    => WPXMCP_Tools_Woo_Store::get_tax_rate_by_id( $id ),
				);
			},
		);

		$reg['wc_update_tax_rate'] = array(
			'desc'     => 'Update an existing WooCommerce tax rate.',
			'risk'     => 'write',
			'schema'   => array(
				'rate_id'  => array( 'type' => 'integer', 'description' => 'Tax rate ID.' ),
				'country'  => array( 'type' => 'string', 'description' => 'Two-letter country code.' ),
				'state'    => array( 'type' => 'string', 'description' => 'State code.' ),
				'rate'     => array( 'type' => 'string', 'description' => 'Tax rate as a decimal.' ),
				'name'     => array( 'type' => 'string', 'description' => 'Rate label.' ),
				'priority' => array( 'type' => 'integer', 'description' => 'Priority.' ),
				'compound' => array( 'type' => 'boolean', 'description' => 'Compound rate.' ),
				'shipping' => array( 'type' => 'boolean', 'description' => 'Apply to shipping.' ),
				'order'    => array( 'type' => 'integer', 'description' => 'Display order.' ),
				'class'    => array( 'type' => 'string', 'description' => 'Tax class slug.' ),
			),
			'required' => array( 'rate_id' ),
			'handler'  => function ( $a ) {
				$id = absint( $a['rate_id'] );
				$tr = array();
				if ( isset( $a['country'] ) )   $tr['tax_rate_country']  = strtoupper( sanitize_text_field( $a['country'] ) );
				if ( isset( $a['state'] ) )      $tr['tax_rate_state']    = strtoupper( sanitize_text_field( $a['state'] ) );
				if ( isset( $a['rate'] ) )       $tr['tax_rate']          = number_format( (float) $a['rate'], 4, '.', '' );
				if ( isset( $a['name'] ) )       $tr['tax_rate_name']     = sanitize_text_field( $a['name'] );
				if ( isset( $a['priority'] ) )    $tr['tax_rate_priority'] = absint( $a['priority'] );
				if ( isset( $a['compound'] ) )    $tr['tax_rate_compound'] = $a['compound'] ? 1 : 0;
				if ( isset( $a['shipping'] ) )    $tr['tax_rate_shipping'] = $a['shipping'] ? 1 : 0;
				if ( isset( $a['order'] ) )       $tr['tax_rate_order']    = absint( $a['order'] );
				if ( isset( $a['class'] ) )       $tr['tax_rate_class']    = sanitize_text_field( $a['class'] );

				\WC_Tax::_update_tax_rate( $id, $tr );
				return array(
					'success' => true,
					'message' => 'Tax rate updated successfully.',
					'rate'    => WPXMCP_Tools_Woo_Store::get_tax_rate_by_id( $id ),
				);
			},
		);

		$reg['wc_delete_tax_rate'] = array(
			'desc'     => 'Delete a WooCommerce tax rate.',
			'risk'     => 'destructive',
			'schema'   => array(
				'rate_id' => array( 'type' => 'integer', 'description' => 'Tax rate ID.' ),
			),
			'required' => array( 'rate_id' ),
			'handler'  => function ( $a ) {
				\WC_Tax::_delete_tax_rate( absint( $a['rate_id'] ) );
				return array( 'success' => true, 'message' => 'Tax rate deleted.' );
			},
		);

		$reg['wc_get_tax_classes'] = array(
			'desc'    => 'Get all WooCommerce tax classes, including the standard rate.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$classes = \WC_Tax::get_tax_classes();
				$out     = array( array( 'slug' => '', 'name' => 'Standard rate' ) );
				foreach ( $classes as $c ) {
					$out[] = array( 'slug' => sanitize_title( $c ), 'name' => $c );
				}
				return array( 'classes' => $out, 'total' => count( $out ) );
			},
		);

		// ============================================================
		// Webhooks (4)
		// ============================================================

		$reg['wc_get_webhooks'] = array(
			'desc'    => 'List WooCommerce webhooks.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Webhooks per page. Default 10.' ),
				'page'     => array( 'type' => 'integer', 'description' => 'Page number. Default 1.' ),
				'status'   => array( 'type' => 'string', 'description' => 'active | paused | disabled.' ),
			),
			'handler' => function ( $a ) {
				$per_page = isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 10;
				$page     = isset( $a['page'] ) ? absint( $a['page'] ) : 1;
				$qa = array( 'limit' => $per_page, 'offset' => ( $page - 1 ) * $per_page );
				if ( isset( $a['status'] ) ) $qa['status'] = sanitize_key( $a['status'] );

				$webhooks = wc_get_webhooks( $qa );
				return array(
					'webhooks' => array_map( array( 'WPXMCP_Tools_Woo_Store', 'format_webhook' ), $webhooks ),
					'total'    => count( $webhooks ),
				);
			},
		);

		$reg['wc_create_webhook'] = array(
			'desc'     => 'Create a WooCommerce webhook.',
			'risk'     => 'write',
			'schema'   => array(
				'name'         => array( 'type' => 'string', 'description' => 'Webhook name.' ),
				'topic'        => array( 'type' => 'string', 'description' => 'e.g. order.created, product.updated.' ),
				'delivery_url' => array( 'type' => 'string', 'description' => 'URL to deliver payloads to.' ),
				'secret'       => array( 'type' => 'string', 'description' => 'Secret key for HMAC-SHA256 signature.' ),
				'status'       => array( 'type' => 'string', 'description' => 'active (default) | paused | disabled.' ),
			),
			'required' => array( 'topic', 'delivery_url' ),
			'handler'  => function ( $a ) {
				$w = new \WC_Webhook();
				$w->set_name( isset( $a['name'] ) ? sanitize_text_field( $a['name'] ) : 'Webhook' );
				$w->set_topic( sanitize_text_field( $a['topic'] ) );
				$w->set_delivery_url( esc_url_raw( $a['delivery_url'] ) );
				$w->set_status( isset( $a['status'] ) ? sanitize_key( $a['status'] ) : 'active' );
				if ( isset( $a['secret'] ) ) $w->set_secret( sanitize_text_field( $a['secret'] ) );

				$id = $w->save();
				if ( ! $id ) {
					throw new Exception( 'Failed to create webhook.' );
				}
				return array(
					'success' => true,
					'message' => 'Webhook created successfully.',
					'webhook' => WPXMCP_Tools_Woo_Store::format_webhook( wc_get_webhook( $id ) ),
				);
			},
		);

		$reg['wc_update_webhook'] = array(
			'desc'     => 'Update a WooCommerce webhook.',
			'risk'     => 'write',
			'schema'   => array(
				'webhook_id'   => array( 'type' => 'integer', 'description' => 'Webhook ID.' ),
				'name'         => array( 'type' => 'string', 'description' => 'Webhook name.' ),
				'topic'        => array( 'type' => 'string', 'description' => 'Webhook topic.' ),
				'delivery_url' => array( 'type' => 'string', 'description' => 'Delivery URL.' ),
				'secret'       => array( 'type' => 'string', 'description' => 'HMAC-SHA256 secret key.' ),
				'status'       => array( 'type' => 'string', 'description' => 'active | paused | disabled.' ),
			),
			'required' => array( 'webhook_id' ),
			'handler'  => function ( $a ) {
				$w = wc_get_webhook( absint( $a['webhook_id'] ) );
				if ( ! $w ) {
					throw new Exception( 'Webhook not found.' );
				}
				if ( isset( $a['name'] ) )         $w->set_name( sanitize_text_field( $a['name'] ) );
				if ( isset( $a['topic'] ) )         $w->set_topic( sanitize_text_field( $a['topic'] ) );
				if ( isset( $a['delivery_url'] ) )  $w->set_delivery_url( esc_url_raw( $a['delivery_url'] ) );
				if ( isset( $a['secret'] ) )         $w->set_secret( sanitize_text_field( $a['secret'] ) );
				if ( isset( $a['status'] ) )         $w->set_status( sanitize_key( $a['status'] ) );
				$w->save();
				return array(
					'success' => true,
					'message' => 'Webhook updated successfully.',
					'webhook' => WPXMCP_Tools_Woo_Store::format_webhook( wc_get_webhook( $w->get_id() ) ),
				);
			},
		);

		$reg['wc_delete_webhook'] = array(
			'desc'     => 'Delete a WooCommerce webhook.',
			'risk'     => 'destructive',
			'schema'   => array(
				'webhook_id' => array( 'type' => 'integer', 'description' => 'Webhook ID.' ),
			),
			'required' => array( 'webhook_id' ),
			'handler'  => function ( $a ) {
				$w = wc_get_webhook( absint( $a['webhook_id'] ) );
				if ( ! $w ) {
					throw new Exception( 'Webhook not found.' );
				}
				$w->delete( true );
				return array( 'success' => true, 'message' => 'Webhook deleted.' );
			},
		);

		// ============================================================
		// Payments (2)
		// ============================================================

		$reg['wc_get_payment_gateways'] = array(
			'desc'    => 'Get all registered WooCommerce payment gateways and their enabled status.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$gws = WC()->payment_gateways()->payment_gateways();
				return array(
					'gateways' => array_values( array_map( array( 'WPXMCP_Tools_Woo_Store', 'format_payment_gateway' ), $gws ) ),
					'total'    => count( $gws ),
				);
			},
		);

		$reg['wc_update_payment_gateway'] = array(
			'desc'     => 'Update a WooCommerce payment gateway: enable/disable, title, description.',
			'risk'     => 'write',
			'schema'   => array(
				'gateway_id'  => array( 'type' => 'string', 'description' => 'Gateway ID (e.g. bacs, cheque, paypal, stripe).' ),
				'enabled'     => array( 'type' => 'boolean', 'description' => 'Enable or disable the gateway.' ),
				'title'       => array( 'type' => 'string', 'description' => 'Customer-facing title shown at checkout.' ),
				'description' => array( 'type' => 'string', 'description' => 'Customer-facing description shown at checkout.' ),
			),
			'required' => array( 'gateway_id' ),
			'handler'  => function ( $a ) {
				$id  = sanitize_key( $a['gateway_id'] );
				$gws = WC()->payment_gateways()->payment_gateways();
				if ( ! isset( $gws[ $id ] ) ) {
					throw new Exception( 'Payment gateway not found.' );
				}
				$settings = get_option( "woocommerce_{$id}_settings", array() );
				if ( isset( $a['enabled'] ) )      $settings['enabled'] = $a['enabled'] ? 'yes' : 'no';
				if ( isset( $a['title'] ) )         $settings['title'] = sanitize_text_field( $a['title'] );
				if ( isset( $a['description'] ) )   $settings['description'] = sanitize_textarea_field( $a['description'] );
				update_option( "woocommerce_{$id}_settings", $settings );
				WC()->payment_gateways()->init();

				$updated = WC()->payment_gateways()->payment_gateways();
				return array(
					'success' => true,
					'message' => 'Payment gateway updated successfully.',
					'gateway' => WPXMCP_Tools_Woo_Store::format_payment_gateway( $updated[ $id ] ?? $gws[ $id ] ),
				);
			},
		);

		// ============================================================
		// Reports (2)
		// ============================================================

		$reg['wc_get_sales_report'] = array(
			'desc'    => 'Get a WooCommerce sales report for a date range: orders, sales, net revenue, tax, shipping, refunds, items.',
			'risk'    => 'read',
			'schema'  => array(
				'start_date' => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Defaults to 30 days ago.' ),
				'end_date'   => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Defaults to today.' ),
				'status'     => array( 'type' => 'array', 'description' => 'Order statuses to include. Defaults to wc-completed, wc-processing.' ),
			),
			'handler' => function ( $a ) {
				$start = isset( $a['start_date'] ) ? sanitize_text_field( $a['start_date'] ) : gmdate( 'Y-m-d', strtotime( '-30 days' ) );
				$end   = isset( $a['end_date'] ) ? sanitize_text_field( $a['end_date'] ) : gmdate( 'Y-m-d' );
				$st    = isset( $a['status'] ) && is_array( $a['status'] ) ? array_map( 'sanitize_key', $a['status'] ) : array( 'wc-completed', 'wc-processing' );

				$start_ts = strtotime( $start . ' 00:00:00' );
				$end_ts   = strtotime( $end . ' 23:59:59' );

				$orders = wc_get_orders( array(
					'limit'        => -1,
					'status'       => $st,
					'date_created' => $start_ts . '...' . $end_ts,
					'return'       => 'objects',
				) );

				$total_sales = 0.0; $total_tax = 0.0; $total_shipping = 0.0; $total_refunds = 0.0; $total_items = 0;
				foreach ( $orders as $order ) {
					$total_sales    += (float) $order->get_total();
					$total_tax      += (float) $order->get_total_tax();
					$total_shipping += (float) $order->get_shipping_total();
					$total_refunds  += (float) $order->get_total_refunded();
					foreach ( $order->get_items() as $item ) {
						$total_items += $item->get_quantity();
					}
				}
				$net = $total_sales - $total_tax - $total_shipping - $total_refunds;

				return array(
					'period'         => array( 'start' => $start, 'end' => $end ),
					'total_orders'   => count( $orders ),
					'total_sales'    => round( $total_sales, 2 ),
					'net_revenue'    => round( $net, 2 ),
					'total_tax'      => round( $total_tax, 2 ),
					'total_shipping' => round( $total_shipping, 2 ),
					'total_refunds'  => round( $total_refunds, 2 ),
					'total_items'    => $total_items,
					'currency'       => get_option( 'woocommerce_currency' ),
				);
			},
		);

		$reg['wc_get_top_sellers_report'] = array(
			'desc'    => 'Get top-selling WooCommerce products for a date range, ranked by quantity sold.',
			'risk'    => 'read',
			'schema'  => array(
				'start_date' => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Defaults to 30 days ago.' ),
				'end_date'   => array( 'type' => 'string', 'description' => 'YYYY-MM-DD. Defaults to today.' ),
				'limit'      => array( 'type' => 'integer', 'description' => 'Number of top sellers to return. Default 10.' ),
				'status'     => array( 'type' => 'array', 'description' => 'Order statuses to include.' ),
			),
			'handler' => function ( $a ) {
				$start = isset( $a['start_date'] ) ? sanitize_text_field( $a['start_date'] ) : gmdate( 'Y-m-d', strtotime( '-30 days' ) );
				$end   = isset( $a['end_date'] ) ? sanitize_text_field( $a['end_date'] ) : gmdate( 'Y-m-d' );
				$limit = isset( $a['limit'] ) ? absint( $a['limit'] ) : 10;
				$st    = isset( $a['status'] ) && is_array( $a['status'] ) ? array_map( 'sanitize_key', $a['status'] ) : array( 'wc-completed', 'wc-processing' );

				$start_ts = strtotime( $start . ' 00:00:00' );
				$end_ts   = strtotime( $end . ' 23:59:59' );

				$orders = wc_get_orders( array(
					'limit'        => -1,
					'status'       => $st,
					'date_created' => $start_ts . '...' . $end_ts,
					'return'       => 'objects',
				) );

				$totals = array();
				foreach ( $orders as $order ) {
					foreach ( $order->get_items() as $item ) {
						$pid = $item->get_product_id();
						if ( ! isset( $totals[ $pid ] ) ) {
							$totals[ $pid ] = array(
								'product_id'    => $pid,
								'product_name'  => $item->get_name(),
								'quantity_sold' => 0,
								'gross_revenue' => 0.0,
							);
						}
						$totals[ $pid ]['quantity_sold'] += $item->get_quantity();
						$totals[ $pid ]['gross_revenue']  += (float) $item->get_total();
					}
				}

				usort( $totals, function ( $a, $b ) {
					return $b['quantity_sold'] - $a['quantity_sold'];
				} );

				$top = array_slice( array_values( $totals ), 0, $limit );
				foreach ( $top as &$seller ) {
					$seller['gross_revenue'] = round( $seller['gross_revenue'], 2 );
				}
				unset( $seller );

				return array(
					'period'      => array( 'start' => $start, 'end' => $end ),
					'top_sellers' => $top,
					'total'       => count( $top ),
				);
			},
		);

		// ============================================================
		// Settings (2) — hard allowlist
		// ============================================================

		$reg['wc_get_settings'] = array(
			'desc'    => 'Get WooCommerce store settings (currency, address, tax, stock, etc.) — allowlisted keys only.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				$settings = array();
				foreach ( WPXMCP_Tools_Woo_Store::$settings_allowlist as $key ) {
					$settings[ $key ] = get_option( $key );
				}
				return array( 'settings' => $settings );
			},
		);

		$reg['wc_update_setting_option'] = array(
			'desc'     => 'Update a single WooCommerce setting option by key. Key must be in the hard allowlist.',
			'risk'     => 'write',
			'schema'   => array(
				'key'   => array( 'type' => 'string', 'description' => 'WooCommerce option key (must be in the allowed list).' ),
				'value' => array( 'description' => 'New setting value.' ),
			),
			'required' => array( 'key', 'value' ),
			'handler'  => function ( $a ) {
				$key = sanitize_key( $a['key'] );
				if ( ! in_array( $key, WPXMCP_Tools_Woo_Store::$settings_allowlist, true ) ) {
					throw new Exception( "Setting key '$key' is not in the allowed list." );
				}
				$value = $a['value'];
				if ( is_string( $value ) ) {
					$value = sanitize_text_field( $value );
				}
				update_option( $key, $value );
				return array(
					'success' => true,
					'message' => 'Setting updated successfully.',
					'key'     => $key,
					'value'   => get_option( $key ),
				);
			},
		);

		// ============================================================
		// System (2) — hard allowlist for maintenance tools
		// ============================================================

		$reg['wc_get_system_status'] = array(
			'desc'    => 'Get WooCommerce system status: PHP/WP/WC/MySQL versions, memory limits, debug flags, theme, active plugin count, currency, store address.',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				global $wpdb;
				$theme   = wp_get_theme();
				$plugins = (array) get_option( 'active_plugins', array() );

				return array(
					'wp_version'             => get_bloginfo( 'version' ),
					'wc_version'             => defined( 'WC_VERSION' ) ? WC_VERSION : 'unknown',
					'wc_database_version'    => get_option( 'woocommerce_db_version', 'unknown' ),
					'php_version'            => PHP_VERSION,
					'php_max_execution_time' => ini_get( 'max_execution_time' ),
					'php_memory_limit'       => ini_get( 'memory_limit' ),
					'mysql_version'          => $wpdb->db_version(),
					'server_software'        => isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ) : '',
					'wp_memory_limit'        => WP_MEMORY_LIMIT,
					'wp_max_memory_limit'    => WP_MAX_MEMORY_LIMIT,
					'wp_debug_mode'          => defined( 'WP_DEBUG' ) && WP_DEBUG,
					'wp_cron_disabled'       => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
					'active_plugins_count'   => count( $plugins ),
					'theme'                  => array(
						'name'    => $theme->get( 'Name' ),
						'version' => $theme->get( 'Version' ),
						'author'  => $theme->get( 'Author' ),
					),
					'currency'        => get_option( 'woocommerce_currency' ),
					'store_address'   => get_option( 'woocommerce_store_address' ),
					'default_country' => get_option( 'woocommerce_default_country' ),
				);
			},
		);

		$reg['wc_run_system_status_tool'] = array(
			'desc'     => 'Run a WooCommerce system status maintenance tool. tool_id must be in the hard allowlist: clear_transients, clear_expired_transients, delete_orphaned_variations, recount_terms, clear_ratings, reset_roles.',
			'risk'     => 'destructive',
			'schema'   => array(
				'tool_id' => array( 'type' => 'string', 'description' => 'clear_transients | clear_expired_transients | delete_orphaned_variations | recount_terms | clear_ratings | reset_roles.' ),
			),
			'required' => array( 'tool_id' ),
			'handler'  => function ( $a ) {
				global $wpdb;
				$tool_id = sanitize_key( $a['tool_id'] );
				if ( ! in_array( $tool_id, WPXMCP_Tools_Woo_Store::$system_tools_allowlist, true ) ) {
					throw new Exception( 'Invalid tool ID. Allowed tools: ' . implode( ', ', WPXMCP_Tools_Woo_Store::$system_tools_allowlist ) );
				}

				$message = '';
				switch ( $tool_id ) {
					case 'clear_transients':
						$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_wc\_%' OR option_name LIKE '\_transient\_timeout\_wc\_%'" );
						$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_woocommerce\_%' OR option_name LIKE '\_transient\_timeout\_woocommerce\_%'" );
						\WC_Cache_Helper::invalidate_cache_group( 'product' );
						\WC_Cache_Helper::invalidate_cache_group( 'orders' );
						$message = 'WooCommerce transients cleared.';
						break;

					case 'clear_expired_transients':
						$time = time();
						$wpdb->query(
							"DELETE a, b FROM {$wpdb->options} a
							 JOIN {$wpdb->options} b ON b.option_name = REPLACE(a.option_name, '_transient_timeout_', '_transient_')
							 WHERE a.option_name LIKE '\_transient\_timeout\_%'
							 AND a.option_value < {$time}"
						);
						$message = 'Expired transients cleared.';
						break;

					case 'delete_orphaned_variations':
						$ids = $wpdb->get_col(
							"SELECT ID FROM {$wpdb->posts} p
							 WHERE p.post_type = 'product_variation'
							 AND p.post_parent NOT IN (
							     SELECT ID FROM {$wpdb->posts}
							     WHERE post_type = 'product' AND post_status != 'trash'
							 )"
						);
						$count = 0;
						foreach ( $ids as $id ) {
							wp_delete_post( absint( $id ), true );
							$count++;
						}
						$message = "Deleted $count orphaned variation(s).";
						break;

					case 'recount_terms':
						$cats = get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false, 'fields' => 'ids' ) );
						if ( ! is_wp_error( $cats ) ) {
							_wc_term_recount( $cats, get_taxonomy( 'product_cat' ), true, false );
						}
						$tags = get_terms( array( 'taxonomy' => 'product_tag', 'hide_empty' => false, 'fields' => 'ids' ) );
						if ( ! is_wp_error( $tags ) ) {
							_wc_term_recount( $tags, get_taxonomy( 'product_tag' ), true, false );
						}
						$message = 'Term counts recalculated.';
						break;

					case 'clear_ratings':
						$pids = get_posts( array( 'post_type' => 'product', 'numberposts' => -1, 'fields' => 'ids' ) );
						foreach ( $pids as $pid ) {
							\WC_Comments::clear_transients( $pid );
						}
						$message = 'Product rating caches cleared.';
						break;

					case 'reset_roles':
						\WC_Install::remove_roles();
						\WC_Install::create_roles();
						$message = 'WooCommerce user roles reset to defaults.';
						break;
				}

				return array( 'success' => true, 'tool_id' => $tool_id, 'message' => $message );
			},
		);

		return $reg;
	}
}
