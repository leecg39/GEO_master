import type { GeoBlock, GeoPageSpec } from "./geo-page-spec";

/** Escape text for Gutenberg HTML attributes / body (not full HTML sanitizer). */
function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<!-- wp:paragraph -->\n<p>${esc(trimmed)}</p>\n<!-- /wp:paragraph -->\n`;
}

function heading(text: string, level: 1 | 2 | 3 = 2) {
  const tag = `h${level}`;
  return `<!-- wp:heading {"level":${level}} -->\n<${tag} class="wp-block-heading">${esc(text)}</${tag}>\n<!-- /wp:heading -->\n`;
}

function listBlock(items: string[], ordered = false) {
  if (!items.length) return "";
  const tag = ordered ? "ol" : "ul";
  const inner = items.map((item) => `<li>${esc(item)}</li>`).join("");
  return `<!-- wp:list${ordered ? ' {"ordered":true}' : ""} -->\n<${tag} class="wp-block-list">${inner}</${tag}>\n<!-- /wp:list -->\n`;
}

function buttons(label: string, href: string) {
  const safeHref = href.trim() || "#";
  const safeLabel = label.trim() || "자세히 보기";
  return `<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${esc(safeHref)}">${esc(safeLabel)}</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->\n`;
}

function quote(body: string, cite?: string) {
  const citeHtml = cite ? `<cite>${esc(cite)}</cite>` : "";
  return `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${esc(body)}</p>${citeHtml}</blockquote>\n<!-- /wp:quote -->\n`;
}

function customHtml(html: string) {
  return `<!-- wp:html -->\n${html}\n<!-- /wp:html -->\n`;
}

function blockToGutenberg(block: GeoBlock): string {
  switch (block.type) {
    case "HeroAnswer":
      return [
        heading(block.title || "핵심 답변", 2),
        paragraph(block.body),
      ].join("");
    case "KeyTakeaways":
      return [
        heading(block.title || "Key Takeaways", 2),
        customHtml(`<div class="geo-key-takeaways">${esc((block.items ?? []).join(" · "))}</div>`),
        listBlock(block.items ?? []),
      ].join("");
    case "FAQ": {
      const parts = [heading(block.title || "FAQ", 2)];
      for (const faq of block.faqs ?? []) {
        parts.push(heading(faq.question, 3), paragraph(faq.answer));
      }
      return parts.join("");
    }
    case "Speakable":
      return [
        heading(block.title || "Speakable", 2),
        customHtml(`<p class="geo-speakable">${esc(block.body)}</p>`),
      ].join("");
    case "EntityDefinition":
      return [
        heading(block.title || "엔티티 정의", 2),
        paragraph(`${block.entityName ? `${block.entityName} — ` : ""}${block.body}`),
        block.proof ? paragraph(`근거: ${block.proof}`) : "",
      ].join("");
    case "CTA":
      return [
        heading(block.title || "CTA", 2),
        buttons(block.ctaLabel || "자세히 보기", block.ctaHref || "#"),
      ].join("");
    case "CiteBlock":
      return quote(block.body, [block.source, block.sourceDate].filter(Boolean).join(" · ") || undefined);
    case "AltSuggestion":
      return [
        heading(block.title || "이미지 alt 제안", 2),
        listBlock([
          ...(block.imageUrl ? [`URL: ${block.imageUrl}`] : []),
          `alt: ${block.altText || block.body}`,
        ]),
      ].join("");
    default:
      return "";
  }
}

function jsonLdHtml(spec: GeoPageSpec) {
  const docs = [spec.jsonLd.blogPosting, spec.jsonLd.faqPage, spec.jsonLd.speakable].filter(Boolean);
  if (!docs.length) return "";
  return docs
    .map((doc) => customHtml(`<script type="application/ld+json">${JSON.stringify(doc)}</script>`))
    .join("");
}

/** GeoPageSpec → Gutenberg core block markup (WP x MCP builders 패턴의 얇은 번역). */
export function geoPageSpecToGutenberg(spec: GeoPageSpec): string {
  const parts = [
    heading(spec.topic, 1),
    spec.targetAudience ? paragraph(`대상: ${spec.targetAudience}`) : "",
    ...spec.blocks.map(blockToGutenberg),
    jsonLdHtml(spec),
  ];
  return parts.join("\n").trim() + "\n";
}

export function slugifyTopic(topic: string) {
  const ascii = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return ascii || `geo-draft-${Date.now()}`;
}
