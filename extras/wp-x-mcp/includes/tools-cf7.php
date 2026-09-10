<?php
/**
 * Contact Form 7 tools for WP x MCP.
 *
 * Ports the Contact Form 7 tool set from MountDev AI MCP Connector
 * into wp-x-mcp's procedural tool registry style.
 *
 * 20 tools covering: list/get/create/update/duplicate/delete forms,
 * mail templates, response messages, additional_settings, mail tags,
 * SWV schema, config validation, plugin settings, and integrations.
 *
 * Tools register only when Contact Form 7 is active. Each handler also
 * performs a runtime guard so a deactivation between registration and
 * execution fails clean rather than fatal-ing on missing classes.
 *
 * @package WPxMCP
 */

defined( 'ABSPATH' ) || exit;

class WPXMCP_Tools_CF7 {

	/**
	 * Detect whether Contact Form 7 is active.
	 */
	public static function is_active(): bool {
		if ( class_exists( 'WPCF7' ) || defined( 'WPCF7_VERSION' ) ) {
			return true;
		}
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return is_plugin_active( 'contact-form-7/wp-contact-form-7.php' );
	}

	/**
	 * Resolve a CF7 form instance from $args['form_id'] or throw.
	 *
	 * @param array $a Tool arguments.
	 * @return WPCF7_ContactForm
	 * @throws Exception When CF7 is inactive, form_id missing/invalid, or form not found.
	 */
	public static function get_form_from_args( array $a ) {
		if ( ! self::is_active() ) {
			throw new Exception( 'Contact Form 7 is not active.' );
		}
		$form_id = isset( $a['form_id'] ) ? absint( $a['form_id'] ) : 0;
		if ( ! $form_id ) {
			throw new Exception( 'Invalid form ID provided.' );
		}
		$form = WPCF7_ContactForm::get_instance( $form_id );
		if ( ! $form ) {
			throw new Exception( 'Contact Form 7 form not found.' );
		}
		return $form;
	}

	/**
	 * Build the CF7 tool registry.
	 *
	 * Returns empty array if Contact Form 7 is not active so the tools/list
	 * payload stays clean and the agent never sees tools it cannot execute.
	 */
	public static function all(): array {
		if ( ! self::is_active() ) {
			return array();
		}

		$reg = array();

		// ============================================================
		// PHASE 1 — READ TOOLS
		// ============================================================

		$reg['cf7_list_forms'] = array(
			'desc'    => 'List all Contact Form 7 forms with pagination and optional search. Returns id, title, locale, hash, and shortcode for each form.',
			'risk'    => 'read',
			'schema'  => array(
				'per_page' => array( 'type' => 'integer', 'description' => 'Number of forms to return (1-100). Default 20.' ),
				'offset'   => array( 'type' => 'integer', 'description' => 'Number of forms to skip for pagination. Default 0.' ),
				'search'   => array( 'type' => 'string', 'description' => 'Search term to filter forms by title.' ),
				'orderby'  => array( 'type' => 'string', 'description' => 'Field to sort by: ID, title, date. Default ID.' ),
				'order'    => array( 'type' => 'string', 'description' => 'Sort direction: ASC or DESC. Default DESC.' ),
			),
			'handler' => function ( $a ) {
				if ( ! WPXMCP_Tools_CF7::is_active() ) {
					throw new Exception( 'Contact Form 7 is not active.' );
				}

				$per_page = max( 1, min( 100, isset( $a['per_page'] ) ? absint( $a['per_page'] ) : 20 ) );
				$offset   = isset( $a['offset'] ) ? absint( $a['offset'] ) : 0;
				$search   = isset( $a['search'] ) ? sanitize_text_field( $a['search'] ) : '';
				$orderby  = isset( $a['orderby'] ) ? sanitize_key( $a['orderby'] ) : 'ID';
				$order    = ( isset( $a['order'] ) && strtoupper( $a['order'] ) === 'ASC' ) ? 'ASC' : 'DESC';

				if ( ! in_array( $orderby, array( 'ID', 'title', 'date' ), true ) ) {
					$orderby = 'ID';
				}

				$query_args = array(
					'posts_per_page' => $per_page,
					'offset'         => $offset,
					'orderby'        => $orderby,
					'order'          => $order,
				);
				if ( $search ) {
					$query_args['s'] = $search;
				}

				$forms = WPCF7_ContactForm::find( $query_args );
				$total = WPCF7_ContactForm::count();

				$out = array();
				foreach ( $forms as $form ) {
					$out[] = array(
						'id'        => $form->id(),
						'title'     => $form->title(),
						'locale'    => $form->locale(),
						'hash'      => $form->hash(),
						'shortcode' => $form->shortcode(),
					);
				}

				return array(
					'forms'    => $out,
					'total'    => (int) $total,
					'per_page' => $per_page,
					'offset'   => $offset,
				);
			},
		);

		$reg['cf7_get_form'] = array(
			'desc'     => 'Get all properties of a single Contact Form 7 form including form HTML, mail templates, messages, and additional settings.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form       = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$properties = $form->get_properties();
				return array(
					'id'                  => $form->id(),
					'title'               => $form->title(),
					'locale'              => $form->locale(),
					'hash'                => $form->hash(),
					'shortcode'           => $form->shortcode(),
					'form'                => isset( $properties['form'] ) ? $properties['form'] : '',
					'mail'                => isset( $properties['mail'] ) ? $properties['mail'] : array(),
					'mail_2'              => isset( $properties['mail_2'] ) ? $properties['mail_2'] : array(),
					'messages'            => isset( $properties['messages'] ) ? $properties['messages'] : array(),
					'additional_settings' => isset( $properties['additional_settings'] ) ? $properties['additional_settings'] : '',
				);
			},
		);

		$reg['cf7_get_form_tags'] = array(
			'desc'     => 'Scan a Contact Form 7 form and return all form field tags with their type, name, options, and required status.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$tags = $form->scan_form_tags();
				$out  = array();
				foreach ( $tags as $tag ) {
					$out[] = array(
						'type'     => $tag->type,
						'basetype' => $tag->basetype,
						'name'     => $tag->name,
						'required' => $tag->is_required(),
						'options'  => $tag->options,
						'values'   => $tag->values,
						'labels'   => $tag->labels,
					);
				}
				return array(
					'form_id' => $form->id(),
					'tags'    => $out,
				);
			},
		);

		$reg['cf7_get_mail_template'] = array(
			'desc'     => 'Get the primary (mail) or auto-responder (mail_2) email template configuration for a Contact Form 7 form.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id'  => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
				'template' => array( 'type' => 'string', 'description' => 'Which mail template to retrieve: mail or mail_2. Default mail.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form     = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$template = isset( $a['template'] ) ? sanitize_key( $a['template'] ) : 'mail';
				if ( ! in_array( $template, array( 'mail', 'mail_2' ), true ) ) {
					$template = 'mail';
				}
				$mail = $form->prop( $template );
				if ( ! is_array( $mail ) ) {
					throw new Exception( 'Mail template not found.' );
				}
				$out = array(
					'form_id'            => $form->id(),
					'template'           => $template,
					'recipient'          => isset( $mail['recipient'] ) ? $mail['recipient'] : '',
					'sender'             => isset( $mail['sender'] ) ? $mail['sender'] : '',
					'subject'            => isset( $mail['subject'] ) ? $mail['subject'] : '',
					'body'               => isset( $mail['body'] ) ? $mail['body'] : '',
					'additional_headers' => isset( $mail['additional_headers'] ) ? $mail['additional_headers'] : '',
					'attachments'        => isset( $mail['attachments'] ) ? $mail['attachments'] : '',
					'use_html'           => ! empty( $mail['use_html'] ),
					'exclude_blank'      => ! empty( $mail['exclude_blank'] ),
				);
				if ( 'mail_2' === $template ) {
					$out['active'] = ! empty( $mail['active'] );
				}
				return $out;
			},
		);

		$reg['cf7_get_form_messages'] = array(
			'desc'     => 'Get all response message templates for a Contact Form 7 form (sent OK, failed, validation errors, spam, etc.).',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form     = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$messages = $form->prop( 'messages' );
				if ( ! is_array( $messages ) ) {
					$messages = array();
				}
				return array(
					'form_id'  => $form->id(),
					'messages' => $messages,
				);
			},
		);

		$reg['cf7_get_shortcode'] = array(
			'desc'     => 'Get the shortcode string for embedding a Contact Form 7 form in a page or post.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form = WPXMCP_Tools_CF7::get_form_from_args( $a );
				return array(
					'form_id'   => $form->id(),
					'title'     => $form->title(),
					'shortcode' => $form->shortcode(),
				);
			},
		);

		// ============================================================
		// PHASE 2 — WRITE TOOLS
		// ============================================================

		$reg['cf7_create_form'] = array(
			'desc'     => 'Create a new Contact Form 7 form. Uses the CF7 default template if no form HTML is provided.',
			'risk'     => 'write',
			'schema'   => array(
				'title'  => array( 'type' => 'string', 'description' => 'Form title.' ),
				'form'   => array( 'type' => 'string', 'description' => 'Form HTML with CF7 tags. Uses CF7 default template if omitted.' ),
				'locale' => array( 'type' => 'string', 'description' => 'Locale code (e.g. en_US).' ),
			),
			'required' => array( 'title' ),
			'handler'  => function ( $a ) {
				if ( ! WPXMCP_Tools_CF7::is_active() ) {
					throw new Exception( 'Contact Form 7 is not active.' );
				}
				$title  = sanitize_text_field( $a['title'] );
				$locale = isset( $a['locale'] ) ? sanitize_text_field( $a['locale'] ) : null;

				$template_options = array( 'title' => $title );
				if ( $locale ) {
					$template_options['locale'] = $locale;
				}

				$form = WPCF7_ContactForm::get_template( $template_options );

				if ( isset( $a['form'] ) && '' !== $a['form'] ) {
					$form->set_properties( array( 'form' => wp_kses_post( $a['form'] ) ) );
				}

				$post_id = $form->save();
				if ( ! $post_id ) {
					throw new Exception( 'Failed to create Contact Form 7 form.' );
				}

				return array(
					'id'        => $form->id(),
					'title'     => $form->title(),
					'locale'    => $form->locale(),
					'shortcode' => $form->shortcode(),
				);
			},
		);

		$reg['cf7_update_form'] = array(
			'desc'     => "Update a Contact Form 7 form's title, form HTML, and/or locale. All fields except form_id are optional.",
			'risk'     => 'write',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
				'title'   => array( 'type' => 'string', 'description' => 'New form title.' ),
				'form'    => array( 'type' => 'string', 'description' => 'Full form HTML content with CF7 tags.' ),
				'locale'  => array( 'type' => 'string', 'description' => 'Locale code (e.g. en_US).' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form    = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$updated = array();

				if ( isset( $a['title'] ) && '' !== $a['title'] ) {
					$form->set_title( sanitize_text_field( $a['title'] ) );
					$updated[] = 'title';
				}
				if ( isset( $a['form'] ) ) {
					$form->set_properties( array( 'form' => wp_kses_post( $a['form'] ) ) );
					$updated[] = 'form';
				}
				if ( isset( $a['locale'] ) && '' !== $a['locale'] ) {
					$form->set_locale( sanitize_text_field( $a['locale'] ) );
					$updated[] = 'locale';
				}

				if ( empty( $updated ) ) {
					throw new Exception( 'No fields provided to update.' );
				}

				$post_id = $form->save();
				if ( ! $post_id ) {
					throw new Exception( 'Failed to update Contact Form 7 form.' );
				}

				return array(
					'success'        => true,
					'form_id'        => $form->id(),
					'updated_fields' => $updated,
				);
			},
		);

		$reg['cf7_update_mail_template'] = array(
			'desc'     => 'Update the primary (mail) or auto-responder (mail_2) email template for a Contact Form 7 form. Only provided fields are updated.',
			'risk'     => 'write',
			'schema'   => array(
				'form_id'            => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
				'template'           => array( 'type' => 'string', 'description' => 'Which mail template to update: mail or mail_2. Default mail.' ),
				'recipient'          => array( 'type' => 'string', 'description' => 'Recipient email address(es).' ),
				'sender'             => array( 'type' => 'string', 'description' => 'Sender name and email.' ),
				'subject'            => array( 'type' => 'string', 'description' => 'Email subject line.' ),
				'body'               => array( 'type' => 'string', 'description' => 'Email body content.' ),
				'additional_headers' => array( 'type' => 'string', 'description' => 'Additional mail headers.' ),
				'attachments'        => array( 'type' => 'string', 'description' => 'File attachment paths.' ),
				'use_html'           => array( 'type' => 'boolean', 'description' => 'Send as HTML email.' ),
				'exclude_blank'      => array( 'type' => 'boolean', 'description' => 'Exclude blank fields from mail body.' ),
				'active'             => array( 'type' => 'boolean', 'description' => 'Whether mail_2 is active (mail_2 only).' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form     = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$template = isset( $a['template'] ) ? sanitize_key( $a['template'] ) : 'mail';
				if ( ! in_array( $template, array( 'mail', 'mail_2' ), true ) ) {
					$template = 'mail';
				}

				$current = $form->prop( $template );
				if ( ! is_array( $current ) ) {
					$current = array();
				}

				$string_fields  = array( 'recipient', 'sender', 'subject', 'body', 'additional_headers', 'attachments' );
				$boolean_fields = array( 'use_html', 'exclude_blank' );
				$updated        = array();

				foreach ( $string_fields as $field ) {
					if ( isset( $a[ $field ] ) ) {
						$current[ $field ] = sanitize_textarea_field( $a[ $field ] );
						$updated[]         = $field;
					}
				}
				foreach ( $boolean_fields as $field ) {
					if ( isset( $a[ $field ] ) ) {
						$current[ $field ] = (bool) $a[ $field ] ? '1' : '';
						$updated[]         = $field;
					}
				}
				if ( 'mail_2' === $template && isset( $a['active'] ) ) {
					$current['active'] = (bool) $a['active'] ? '1' : '';
					$updated[]         = 'active';
				}

				if ( empty( $updated ) ) {
					throw new Exception( 'No fields provided to update.' );
				}

				$form->set_properties( array( $template => $current ) );
				$post_id = $form->save();
				if ( ! $post_id ) {
					throw new Exception( 'Failed to update mail template.' );
				}

				return array(
					'success'        => true,
					'form_id'        => $form->id(),
					'template'       => $template,
					'updated_fields' => $updated,
				);
			},
		);

		$reg['cf7_update_form_messages'] = array(
			'desc'     => 'Update one or more response message strings for a Contact Form 7 form (e.g. mail_sent_ok, validation_error, spam).',
			'risk'     => 'write',
			'schema'   => array(
				'form_id'          => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
				'mail_sent_ok'     => array( 'type' => 'string', 'description' => 'Message shown when mail is sent successfully.' ),
				'mail_sent_ng'     => array( 'type' => 'string', 'description' => 'Message shown when mail sending fails.' ),
				'validation_error' => array( 'type' => 'string', 'description' => 'Message shown when validation fails.' ),
				'spam'             => array( 'type' => 'string', 'description' => 'Message shown when submission is detected as spam.' ),
				'accept_terms'     => array( 'type' => 'string', 'description' => 'Message for acceptance checkbox.' ),
				'invalid_required' => array( 'type' => 'string', 'description' => 'Message for empty required fields.' ),
				'invalid_email'    => array( 'type' => 'string', 'description' => 'Message for invalid email format.' ),
				'invalid_url'      => array( 'type' => 'string', 'description' => 'Message for invalid URL format.' ),
				'invalid_tel'      => array( 'type' => 'string', 'description' => 'Message for invalid telephone number.' ),
				'invalid_number'   => array( 'type' => 'string', 'description' => 'Message for invalid number.' ),
				'invalid_date'     => array( 'type' => 'string', 'description' => 'Message for invalid date.' ),
				'invalid_captcha'  => array( 'type' => 'string', 'description' => 'Message for failed CAPTCHA.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form    = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$current = $form->prop( 'messages' );
				if ( ! is_array( $current ) ) {
					$current = array();
				}

				$known   = array(
					'mail_sent_ok', 'mail_sent_ng', 'validation_error', 'spam',
					'accept_terms', 'invalid_required', 'invalid_email', 'invalid_url',
					'invalid_tel', 'invalid_number', 'invalid_date', 'invalid_captcha',
				);
				$updated = array();

				foreach ( $known as $key ) {
					if ( isset( $a[ $key ] ) ) {
						$current[ $key ] = sanitize_text_field( $a[ $key ] );
						$updated[]       = $key;
					}
				}

				if ( empty( $updated ) ) {
					throw new Exception( 'No message keys provided to update.' );
				}

				$form->set_properties( array( 'messages' => $current ) );
				$post_id = $form->save();
				if ( ! $post_id ) {
					throw new Exception( 'Failed to update form messages.' );
				}

				return array(
					'success'          => true,
					'form_id'          => $form->id(),
					'updated_messages' => $updated,
				);
			},
		);

		$reg['cf7_duplicate_form'] = array(
			'desc'     => 'Create a copy of an existing Contact Form 7 form.',
			'risk'     => 'write',
			'schema'   => array(
				'form_id'   => array( 'type' => 'integer', 'description' => 'ID of the form to copy.' ),
				'new_title' => array( 'type' => 'string', 'description' => 'Title for the new copy. Defaults to "Copy of {original title}".' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$copy = $form->copy();

				if ( isset( $a['new_title'] ) && '' !== $a['new_title'] ) {
					$copy->set_title( sanitize_text_field( $a['new_title'] ) );
				}

				$post_id = $copy->save();
				if ( ! $post_id ) {
					throw new Exception( 'Failed to duplicate Contact Form 7 form.' );
				}

				return array(
					'id'        => $copy->id(),
					'title'     => $copy->title(),
					'shortcode' => $copy->shortcode(),
				);
			},
		);

		$reg['cf7_delete_form'] = array(
			'desc'     => 'Permanently delete a Contact Form 7 form. Requires confirm: true to prevent accidental deletion.',
			'risk'     => 'destructive',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
				'confirm' => array( 'type' => 'boolean', 'description' => 'Must be true to confirm permanent deletion.' ),
			),
			'required' => array( 'form_id', 'confirm' ),
			'handler'  => function ( $a ) {
				if ( empty( $a['confirm'] ) ) {
					throw new Exception( 'Set confirm: true to permanently delete a form.' );
				}

				$form    = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$form_id = $form->id();
				$title   = $form->title();

				if ( ! $form->delete() ) {
					throw new Exception( 'Failed to delete Contact Form 7 form.' );
				}

				return array(
					'success' => true,
					'form_id' => $form_id,
					'title'   => $title,
				);
			},
		);

		// ============================================================
		// PHASE 3 — ADVANCED CONFIGURATION
		// ============================================================

		$reg['cf7_get_additional_settings'] = array(
			'desc'     => 'Get the additional_settings text and parsed key-value pairs for a Contact Form 7 form. Common settings: skip_mail, on_sent_ok, on_submit, subscribers_only, skip_spam_check.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form = WPXMCP_Tools_CF7::get_form_from_args( $a );

				$raw = $form->prop( 'additional_settings' );
				if ( ! is_string( $raw ) ) {
					$raw = '';
				}

				$known  = array( 'skip_mail', 'on_sent_ok', 'on_submit', 'subscribers_only', 'skip_spam_check' );
				$parsed = array_fill_keys( $known, null );

				if ( class_exists( 'WPCF7_AdditionalSettings' ) ) {
					$settings_obj = new WPCF7_AdditionalSettings( $raw );
					foreach ( $known as $key ) {
						$parsed[ $key ] = $settings_obj->read( $key );
					}
				} else {
					foreach ( explode( "\n", $raw ) as $line ) {
						$line = trim( $line );
						if ( preg_match( '/^([a-zA-Z_]\w*)\s*:\s*(.*)$/', $line, $m ) ) {
							$key = $m[1];
							if ( array_key_exists( $key, $parsed ) ) {
								$parsed[ $key ] = trim( $m[2] );
							}
						}
					}
				}

				return array(
					'form_id' => $form->id(),
					'raw'     => $raw,
					'parsed'  => $parsed,
				);
			},
		);

		$reg['cf7_update_additional_settings'] = array(
			'desc'     => 'Replace the additional_settings for a Contact Form 7 form. Each setting on its own line, e.g. "skip_mail: on".',
			'risk'     => 'write',
			'schema'   => array(
				'form_id'  => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
				'settings' => array( 'type' => 'string', 'description' => 'Full additional_settings text. Each setting on its own line.' ),
			),
			'required' => array( 'form_id', 'settings' ),
			'handler'  => function ( $a ) {
				$form     = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$settings = sanitize_textarea_field( $a['settings'] );

				$form->set_properties( array( 'additional_settings' => $settings ) );
				$post_id = $form->save();
				if ( ! $post_id ) {
					throw new Exception( 'Failed to update additional settings.' );
				}

				return array(
					'success'  => true,
					'form_id'  => $form->id(),
					'settings' => $settings,
				);
			},
		);

		$reg['cf7_get_mail_tags'] = array(
			'desc'     => 'Return all available mail tag placeholders for a Contact Form 7 form — form field tags and special system tags like [_remote_ip], [_url], and [_date].',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form       = WPXMCP_Tools_CF7::get_form_from_args( $a );
				$form_tags  = $form->scan_form_tags();
				$field_tags = array();
				foreach ( $form_tags as $tag ) {
					if ( ! empty( $tag->name ) ) {
						$field_tags[] = '[' . $tag->name . ']';
					}
				}
				$field_tags   = array_values( array_unique( $field_tags ) );
				$special_tags = array(
					'[_remote_ip]', '[_user_agent]', '[_url]', '[_date]', '[_time]',
					'[_invalid_fields]', '[_all_fields_table]', '[_submission_result]',
					'[_post_id]', '[_post_name]', '[_post_title]', '[_post_url]', '[_post_author]',
					'[_site_title]', '[_site_description]', '[_site_url]', '[_admin_email]',
				);
				return array(
					'form_id'      => $form->id(),
					'field_tags'   => $field_tags,
					'special_tags' => $special_tags,
				);
			},
		);

		$reg['cf7_get_form_schema'] = array(
			'desc'     => 'Get the SWV (Smart Validation for Web) JSON schema used for client-side field validation. Requires Contact Form 7 5.6 or later.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form = WPXMCP_Tools_CF7::get_form_from_args( $a );
				if ( ! class_exists( 'WPCF7_SWV_Schema' ) ) {
					throw new Exception( 'SWV schema requires Contact Form 7 5.6 or later.' );
				}
				$schema      = new WPCF7_SWV_Schema( $form );
				$schema_json = wp_json_encode( $schema );
				$schema_data = $schema_json ? json_decode( $schema_json, true ) : array();
				return array(
					'form_id' => $form->id(),
					'schema'  => $schema_data,
				);
			},
		);

		$reg['cf7_validate_form_config'] = array(
			'desc'     => 'Run the Contact Form 7 built-in configuration validator on a form and return all errors and warnings.',
			'risk'     => 'read',
			'schema'   => array(
				'form_id' => array( 'type' => 'integer', 'description' => 'Contact Form 7 form ID.' ),
			),
			'required' => array( 'form_id' ),
			'handler'  => function ( $a ) {
				$form = WPXMCP_Tools_CF7::get_form_from_args( $a );
				if ( ! class_exists( 'WPCF7_ConfigValidator' ) ) {
					throw new Exception( 'WPCF7_ConfigValidator is not available.' );
				}
				$validator = new WPCF7_ConfigValidator( $form );
				$validator->validate();

				$has_errors = method_exists( $validator, 'has_errors' ) ? (bool) $validator->has_errors() : false;
				$errors     = method_exists( $validator, 'collect_error_messages' ) ? $validator->collect_error_messages() : array();
				if ( ! is_array( $errors ) ) {
					$errors = array();
				}

				return array(
					'form_id'    => $form->id(),
					'has_errors' => $has_errors,
					'errors'     => $errors,
				);
			},
		);

		// ============================================================
		// PHASE 4 — PLUGIN SETTINGS & INTEGRATIONS
		// ============================================================

		$reg['cf7_get_plugin_settings'] = array(
			'desc'    => 'Get all global Contact Form 7 plugin options (CAPTCHA keys, nonce verification, acceptance validation, etc.).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! WPXMCP_Tools_CF7::is_active() ) {
					throw new Exception( 'Contact Form 7 is not active.' );
				}
				$known    = array(
					'dont_use_wptexturize',
					'verify_nonce',
					'acceptance_as_validation',
					'in_query_string',
					'subscribers_only',
					'recaptcha',
					'recaptcha_v3',
					'turnstile',
				);
				$settings = array();
				foreach ( $known as $key ) {
					$value = WPCF7::get_option( $key );
					if ( null !== $value ) {
						$settings[ $key ] = $value;
					}
				}
				return array( 'settings' => $settings );
			},
		);

		$reg['cf7_update_plugin_settings'] = array(
			'desc'    => 'Update one or more global Contact Form 7 plugin options. Only provided keys are changed.',
			'risk'    => 'write',
			'schema'  => array(
				'dont_use_wptexturize'     => array( 'type' => 'boolean', 'description' => 'Disable wptexturize for CF7 form content.' ),
				'verify_nonce'             => array( 'type' => 'boolean', 'description' => 'Enable nonce verification.' ),
				'acceptance_as_validation' => array( 'type' => 'boolean', 'description' => 'Treat acceptance checkbox as a validation field.' ),
				'in_query_string'          => array( 'type' => 'boolean', 'description' => 'Include submission status in query string.' ),
				'subscribers_only'         => array( 'type' => 'boolean', 'description' => 'Restrict form submissions to logged-in users.' ),
			),
			'handler' => function ( $a ) {
				if ( ! WPXMCP_Tools_CF7::is_active() ) {
					throw new Exception( 'Contact Form 7 is not active.' );
				}
				$boolean_options = array(
					'dont_use_wptexturize',
					'verify_nonce',
					'acceptance_as_validation',
					'in_query_string',
					'subscribers_only',
				);
				$updated         = array();
				foreach ( $boolean_options as $key ) {
					if ( isset( $a[ $key ] ) ) {
						WPCF7::update_option( $key, (bool) $a[ $key ] );
						$updated[] = $key;
					}
				}
				if ( empty( $updated ) ) {
					throw new Exception( 'No valid settings provided to update.' );
				}
				return array(
					'success'          => true,
					'updated_settings' => $updated,
				);
			},
		);

		$reg['cf7_get_integrations'] = array(
			'desc'    => 'List all registered Contact Form 7 integration services and their configuration/activation status (Akismet, reCAPTCHA, Turnstile, Flamingo, Stripe, etc.).',
			'risk'    => 'read',
			'schema'  => array(),
			'handler' => function ( $a ) {
				if ( ! WPXMCP_Tools_CF7::is_active() ) {
					throw new Exception( 'Contact Form 7 is not active.' );
				}
				if ( ! class_exists( 'WPCF7_Integration' ) || ! method_exists( 'WPCF7_Integration', 'get_instance' ) ) {
					return array( 'integrations' => array() );
				}

				try {
					$integration = WPCF7_Integration::get_instance();
					if ( ! is_object( $integration ) ) {
						return array( 'integrations' => array() );
					}

					$services = method_exists( $integration, 'list_services' ) ? $integration->list_services() : array();
					$out      = array();

					if ( is_array( $services ) ) {
						foreach ( $services as $name => $service ) {
							$entry = array( 'name' => $name );
							if ( is_object( $service ) ) {
								if ( method_exists( $service, 'get_title' ) ) {
									$entry['title'] = $service->get_title();
								}
								if ( method_exists( $service, 'get_categories' ) ) {
									$entry['categories'] = $service->get_categories();
								}
								if ( method_exists( $service, 'is_active' ) ) {
									$entry['active'] = (bool) $service->is_active();
								}
								if ( method_exists( $service, 'is_configured' ) ) {
									$entry['configured'] = (bool) $service->is_configured();
								}
							}
							$out[] = $entry;
						}
					}

					return array( 'integrations' => $out );
				} catch ( \Throwable $e ) {
					return array(
						'integrations' => array(),
						'note'         => 'Integration services could not be loaded in this environment.',
					);
				}
			},
		);

		return $reg;
	}
}
