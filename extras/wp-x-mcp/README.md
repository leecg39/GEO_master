# WP x MCP — Full Control AI Connector

A self-owned [Model Context Protocol](https://modelcontextprotocol.io) server for WordPress + WooCommerce. Gives Claude, ChatGPT, or Gemini full read/write control over your site — with no third-party vendor lock-in. Built by Mubashir Hassan.

## What it does

Exposes **70 tools** across every major WordPress and WooCommerce surface:

| Group | Tools |
|---|---|
| Site | `site_info` |
| Posts/Pages | list, get, create, update, delete (any post type) |
| Taxonomies | list, create, update, delete terms (category, product_cat, etc.) |
| Media | list, upload (URL or base64), delete |
| Menus | list, get items, create menu, create/update/delete items, assign location |
| Users | list, create, update, delete |
| Options/Meta | get/update/delete option (no allowlist), get/update post meta, flush cache |
| Plugins/Themes | list, activate, deactivate, update plugins; list/activate themes; theme mods |
| CSS | get/update Additional CSS |
| Database | direct SQL query, list tables with sizes |
| WooCommerce | products (CRUD), orders (list/get/status/notes), customers, sales report |
| **SEO / GEO / AEO** | get/set meta (title, desc, focus kw, canonical), on-page audit, attach JSON-LD schema, build FAQ schema, suggest + insert internal links, fix robots.txt, sitemap status, disable attachment sitemaps, generate llms.txt, bulk audit, auto-fix all missing meta |
| **Content / Elementor** | publish complete researched article (content + category + meta + Article schema + FAQ + featured image in one call), bulk-create categories, Elementor status, build Elementor pages with the **free** plugin |

## SEO / GEO / AEO features

- **Auto-detects Yoast SEO or Rank Math** and writes the correct meta keys — no config.
- **SEO**: meta titles/descriptions with length validation, focus keywords, canonicals, full on-page audit with a 0-100 score and prioritized issue list.
- **AEO (Answer Engine Optimization)**: one-call FAQ schema generation (FAQPage JSON-LD) that surfaces in Google AI Overviews and is parsed by ChatGPT/Perplexity — optionally appends a visible FAQ block too.
- **GEO (Generative Engine Optimization)**: attach any JSON-LD (Article, Product, HowTo, LocalBusiness, BreadcrumbList), and generate an `llms.txt` (served at `/llms.txt`) so AI crawlers cite the business accurately.
- **Internal linking**: scans the catalogue for relevant link targets and inserts contextual internal links.
- **Sitemap & robots.txt**: report sitemap health, set a correct custom robots.txt with the right `Sitemap:` directive, and one-click disable attachment sitemaps (the #1 crawl-budget fix for media-heavy stores).

Schema, robots.txt, and llms.txt saved by these tools are rendered on the front end automatically by the plugin — no separate SEO config needed.

## Content generation

`publish_article` takes researched content from the AI client and persists it as a fully SEO-complete post in one call: body, category, tags, meta title/description, focus keyword, Article schema, optional FAQ schema + visible block, and a sideloaded featured image. The research and writing happen in the model; the tool guarantees correct on-page structure.

## Elementor (free) page builder

`elementor_build_page` builds real Elementor pages from a simple block spec — **no Elementor Pro required**. Supported blocks: heading, text, image, button, spacer, divider, and two-column layouts. The tool emits native Elementor JSON and flags the page to render with Elementor, returning both the edit URL and the live URL.



## Installation

1. Zip the `wp-x-mcp` folder (or upload the provided zip).
2. WordPress admin → Plugins → Add New → Upload Plugin → choose the zip → Install → Activate.
3. On activation, a **Full-scope API key** is generated and shown once in an admin notice — copy it.
4. Go to **WP x MCP** in the admin sidebar to manage keys and view the activity log.

## Connecting an AI client

**Endpoint:** `https://your-site.com/wp-json/wp-x-mcp/v1/mcp`

**Auth header:** `X-WPXMCP-API-Key: <your key>` (also accepts `Authorization: Bearer <key>`)

The server speaks JSON-RPC 2.0 over Streamable HTTP. It is stateless — no `Mcp-Session-Id` handshake required (unlike some other connectors). A typical flow:

```bash
# tools/list
curl -s https://your-site.com/wp-json/wp-x-mcp/v1/mcp \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: wpxmcp_xxxxx" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# tools/call
curl -s https://your-site.com/wp-json/wp-x-mcp/v1/mcp \
  -H "Content-Type: application/json" \
  -H "X-WPXMCP-API-Key: wpxmcp_xxxxx" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"wc_sales_report","arguments":{"after":"2026-05-01"}}}'
```

## Scopes

Each API key has a scope:

- **full** — read + write + destructive (delete, raw SQL). Default.
- **editor** — read + write, no destructive actions.
- **readonly** — read only.

Create scoped keys from the admin page. Use `readonly` keys for dashboards/analytics, `full` only where you trust the holder.

## Security

- Keys are compared with `hash_equals()` (timing-safe).
- Every tool call is logged to `wp_wpxmcp_logs` (tool, scope, success, IP) — viewable in admin.
- The `db_query` tool has **no guardrails** by design (full control). Always run a backup before destructive operations.
- Rotate or revoke keys anytime from the admin page.
- Serve only over HTTPS.

## Drop-in compatibility

The server also accepts the `X-Royal-MCP-API-Key` header, so existing Royal MCP client configs work after swapping the endpoint URL.

## License

GPL-2.0+
