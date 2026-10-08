/**
 * 구조화 데이터(JSON-LD) 결정적 생성·검증 (Qshop P06).
 * - LLM을 쓰지 않는다. 입력받은 값만 직렬화하고 필수 필드 검사를 한다
 * - 가격·평점은 원본 URL(evidence) 없이는 만들지 않는다 (blocked)
 * - 표시 콘텐츠와 맞지 않거나 이미 페이지에 있는 엔티티는 발행 전에 알린다
 */

export const JSON_LD_TYPES = ["Organization", "WebSite", "WebPage", "Product", "BreadcrumbList", "BlogPosting"] as const;
export type JsonLdType = (typeof JSON_LD_TYPES)[number];
type JsonObject = Record<string, unknown>;

export interface BuildInput {
  name?: string; url?: string; description?: string; sameAs?: string[]; logo?: string;
  price?: string; priceCurrency?: string; ratingValue?: string; ratingCount?: string; availability?: string;
  headline?: string; datePublished?: string; authorName?: string;
  items?: Array<{ name: string; url: string }>;
  /** 필드별 원본 근거 URL — 가격·평점·재고에 필요 */
  evidence?: Record<string, string>;
}

export interface BuildResult {
  jsonLd: JsonObject | null;
  missing: string[];
  blocked: Array<{ field: string; reason: string }>;
}

const REQUIRED: Record<JsonLdType, string[]> = {
  Organization: ["name", "url"], WebSite: ["name", "url"], WebPage: ["name", "url"], Product: ["name"],
  BreadcrumbList: ["items"], BlogPosting: ["headline", "datePublished", "authorName"],
};
const EVIDENCE_FIELDS = new Set(["price", "ratingValue", "availability"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/;
const AVAILABILITY = new Set(["InStock", "OutOfStock", "PreOrder", "SoldOut", "Discontinued", "LimitedAvailability"]);

function origin(url: string | undefined) {
  try { return url ? new URL(url).origin : null; } catch { return null; }
}

function present(input: BuildInput, field: string) {
  const value = (input as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

export function buildJsonLd(type: JsonLdType, input: BuildInput): BuildResult {
  const missing = REQUIRED[type].filter((field) => !present(input, field));
  const blocked: BuildResult["blocked"] = [];
  const evidence = input.evidence ?? {};
  const allowed = (field: string) => {
    if (!present(input, field)) return false;
    if (EVIDENCE_FIELDS.has(field) && !evidence[field]) {
      blocked.push({ field, reason: "원본 근거 URL이 없어 만들지 않았습니다. 가격·평점·재고는 확인된 출처가 있어야 합니다." });
      return false;
    }
    return true;
  };
  if (missing.length) return { jsonLd: null, missing, blocked };

  const base: JsonObject = { "@context": "https://schema.org", "@type": type };
  const site = origin(input.url);
  const assign = (target: JsonObject, entries: Array<[string, unknown]>) => entries.forEach(([key, value]) => { if (value !== undefined && value !== "") target[key] = value; });

  if (type === "Organization") {
    if (site) base["@id"] = `${site}/#organization`;
    assign(base, [["name", input.name], ["url", input.url], ["description", input.description], ["logo", input.logo], ["sameAs", input.sameAs?.length ? input.sameAs : undefined]]);
  } else if (type === "WebSite" || type === "WebPage") {
    if (site) base["@id"] = `${input.url}#${type.toLowerCase()}`;
    assign(base, [["name", input.name], ["url", input.url], ["description", input.description]]);
  } else if (type === "Product") {
    assign(base, [["name", input.name], ["url", input.url], ["description", input.description]]);
    if (allowed("price")) {
      if (!input.priceCurrency) blocked.push({ field: "priceCurrency", reason: "가격에는 통화 코드(KRW 등)가 필요합니다." });
      else {
        const offer: JsonObject = { "@type": "Offer", price: input.price, priceCurrency: input.priceCurrency };
        if (input.url) offer.url = input.url;
        if (input.availability && allowed("availability") && AVAILABILITY.has(input.availability)) offer.availability = `https://schema.org/${input.availability}`;
        base.offers = offer;
      }
    }
    if (allowed("ratingValue")) {
      if (!input.ratingCount) blocked.push({ field: "ratingCount", reason: "평점에는 평가 수가 함께 필요합니다." });
      else base.aggregateRating = { "@type": "AggregateRating", ratingValue: input.ratingValue, ratingCount: input.ratingCount };
    }
  } else if (type === "BreadcrumbList") {
    base.itemListElement = (input.items ?? []).map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url }));
  } else if (type === "BlogPosting") {
    if (!ISO_DATE.test(input.datePublished!)) blocked.push({ field: "datePublished", reason: "발행일은 YYYY-MM-DD 형식이어야 합니다." });
    assign(base, [["headline", input.headline], ["url", input.url], ["description", input.description]]);
    base.datePublished = input.datePublished;
    base.author = { "@type": "Person", name: input.authorName };
    if (blocked.some((item) => item.field === "datePublished")) return { jsonLd: null, missing, blocked };
  }
  return { jsonLd: base, missing, blocked };
}

export interface ValidationIssue { code: string; severity: "error" | "warning"; message: string }

export function validateJsonLd(node: JsonObject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, severity: ValidationIssue["severity"] = "error") => issues.push({ code, severity, message });
  if (node["@context"] !== "https://schema.org") add("MISSING_CONTEXT", "@context는 https://schema.org여야 합니다.");
  const type = node["@type"];
  if (typeof type !== "string") return [...issues, { code: "MISSING_TYPE", severity: "error", message: "@type이 없습니다." }];
  if (["Product", "Organization", "WebSite", "WebPage"].includes(type) && !node.name) add("MISSING_NAME", `${type}에는 name이 필요합니다.`);
  if (type === "Product" && node.offers && !(node.offers as JsonObject).priceCurrency) add("MISSING_CURRENCY", "Offer에는 priceCurrency가 필요합니다.");
  if (type === "BlogPosting" && !node.headline) add("MISSING_HEADLINE", "BlogPosting에는 headline이 필요합니다.");
  if (type === "BreadcrumbList" && !Array.isArray(node.itemListElement)) add("MISSING_ITEMS", "BreadcrumbList에는 itemListElement가 필요합니다.");
  return issues;
}

const digits = (text: string) => text.replace(/[^\d.]/g, "");

export interface PageCheck {
  blocking: ValidationIssue[];
  duplicates: Array<{ type: string; id: string | null; suggestion: "link" }>;
}

/** 표시 콘텐츠와의 일치 및 중복 엔티티 검사 — blocking이 있으면 발행하면 안 된다 */
export function checkAgainstPage(node: JsonObject, visibleText: string, existing: JsonObject[] = []): PageCheck {
  const blocking: ValidationIssue[] = [];
  const offer = node.offers as JsonObject | undefined;
  if (offer?.price !== undefined) {
    const price = String(offer.price);
    const compact = digits(visibleText.replace(/,/g, ""));
    if (!compact.includes(digits(price))) blocking.push({ code: "PRICE_NOT_VISIBLE", severity: "error", message: `가격 ${price}이(가) 페이지 본문에 보이지 않아 발행을 막습니다.` });
  }
  const rating = node.aggregateRating as JsonObject | undefined;
  if (rating?.ratingValue !== undefined && !visibleText.includes(String(rating.ratingValue))) {
    blocking.push({ code: "RATING_NOT_VISIBLE", severity: "error", message: "평점이 페이지 본문에 보이지 않아 발행을 막습니다." });
  }
  const duplicates = existing
    .filter((other) => other["@type"] === node["@type"] && (other["@id"] === node["@id"] || (other.name !== undefined && other.name === node.name)))
    .map((other) => ({ type: String(other["@type"]), id: typeof other["@id"] === "string" ? other["@id"] : null, suggestion: "link" as const }));
  return { blocking, duplicates };
}
