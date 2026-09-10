import { AppError } from "@/lib/errors";
import { normalizeText, schemaEntities, stableJson } from "./snapshots";
import { PAGE_TYPES, type PageMetadata, type PageType } from "./types";

const schemaError = (message: string) =>
  new AppError(message, 422, "SCHEMA_EVIDENCE_REQUIRED");
const textFields = new Set([
  "name",
  "headline",
  "description",
  "sku",
  "price",
  "priceCurrency",
  "ratingValue",
  "reviewCount",
  "ratingCount",
  "datePublished",
  "dateModified",
]);
const allowedFields = new Set([
  "@context",
  "@type",
  "@id",
  "url",
  "name",
  "headline",
  "description",
  "sku",
  "offers",
  "price",
  "priceCurrency",
  "availability",
  "aggregateRating",
  "ratingValue",
  "reviewCount",
  "ratingCount",
  "author",
  "datePublished",
  "dateModified",
  "itemListElement",
  "position",
  "item",
]);

/** A conservative gate: exact visible facts or previously visible, unchanged source facts only. */
export function validateStructuredData(
  input: string,
  page: PageMetadata,
  url: string,
) {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw schemaError("올바른 JSON-LD를 입력하세요.");
  }
  const checkContexts = (node: unknown, depth = 0) => {
    if (depth > 12) throw schemaError("구조화 데이터 중첩이 너무 깊습니다.");
    if (Array.isArray(node)) {
      node.forEach((item) => checkContexts(item, depth + 1));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, val] of Object.entries(node)) {
      if (
        key === "@context" &&
        val !== "https://schema.org" &&
        val !== "https://schema.org/"
      )
        throw schemaError("schema.org 컨텍스트만 사용할 수 있습니다.");
      if (val && typeof val === "object") checkContexts(val, depth + 1);
    }
  };
  checkContexts(value);
  const entities = schemaEntities([value]);
  if (!entities.length || entities.length > 20)
    throw schemaError("1~20개의 구조화 데이터 엔티티가 필요합니다.");
  const ids = new Set<string>();
  const types = new Set<string>();
  const evidence = normalizeText(page.bodyText).toLowerCase();
  for (const entity of entities) {
    const type = entity["@type"];
    if (typeof type !== "string" || !PAGE_TYPES.includes(type as PageType))
      throw schemaError(
        "지원 유형: Product, Organization, WebSite, WebPage, BreadcrumbList, BlogPosting",
      );
    if (types.has(type))
      throw schemaError(
        `${type} 엔티티가 중복됩니다. 기존 @id를 사용해 한 엔티티로 정리하세요.`,
      );
    types.add(type);
    const id = entity["@id"];
    if (
      typeof id !== "string" ||
      (!id.startsWith(`${url}#`) &&
        !page.jsonLd.some((entry) => entry["@id"] === id))
    )
      throw schemaError(
        "@id는 현재 페이지 URL의 fragment 또는 원본에서 확인된 엔티티 ID로 지정하세요.",
      );
    if (ids.has(id)) throw schemaError("동일한 @id가 중복됩니다.");
    ids.add(id);
    const existing = page.jsonLd.filter((entry) => entry["@type"] === type);
    if (existing.length > 1)
      throw schemaError(
        "원본에 동일 유형이 중복됩니다. 큐샵 자동 생성 엔티티부터 정리하세요.",
      );
    if (existing[0]?.["@id"] && existing[0]["@id"] !== id)
      throw schemaError(
        "원본과 다른 @id로 중복 생성할 수 없습니다. 기존 엔티티 연결을 확인하세요.",
      );
    if (
      type !== "BreadcrumbList" &&
      !entity[type === "BlogPosting" ? "headline" : "name"]
    )
      throw schemaError(
        `${type}의 ${type === "BlogPosting" ? "headline" : "name"}이 필요합니다.`,
      );
    if (type === "BreadcrumbList" && !Array.isArray(entity.itemListElement))
      throw schemaError("BreadcrumbList에 실제 경로 항목이 필요합니다.");
    const walk = (record: unknown, depth = 0) => {
      if (depth > 12) throw schemaError("구조화 데이터 중첩이 너무 깊습니다.");
      if (Array.isArray(record)) {
        record.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (!record || typeof record !== "object") return;
      for (const [key, val] of Object.entries(record)) {
        if (!allowedFields.has(key))
          throw schemaError(
            `${key}은 현재 검증 범위에 포함되지 않습니다. 확인된 기본 필드만 사용하세요.`,
          );
        if (
          key === "@context" &&
          val !== "https://schema.org" &&
          val !== "https://schema.org/"
        )
          throw schemaError("schema.org 컨텍스트만 사용할 수 있습니다.");
        if (
          key === "availability" &&
          !existing.some((entry) =>
            stableJson(entry.offers).includes(JSON.stringify(val)),
          )
        )
          throw schemaError(
            "재고 상태는 원본 상품 데이터에서 확인해야 합니다.",
          );
        if (["aggregateRating", "review", "offers", "author"].includes(key)) {
          // These claims must already exist on the source, and all textual facts are checked below.
          if (
            !existing.some(
              (entry) => stableJson(entry[key]) === stableJson(val),
            )
          )
            throw schemaError(
              `${key}은 원본에서 확인된 정보만 사용할 수 있습니다.`,
            );
        }
        if (
          textFields.has(key) &&
          (typeof val === "string" || typeof val === "number")
        ) {
          const fact = normalizeText(String(val)).toLowerCase();
          if (!fact || !evidence.includes(fact))
            throw schemaError(
              `${key} 값의 근거가 공개 본문에 없습니다: ${String(val).slice(0, 80)}`,
            );
        }
        if (typeof val === "string" && /^(?:https?:)?\/\//i.test(val)) {
          let target: URL;
          try {
            target = new URL(val, url);
          } catch {
            throw schemaError("스키마 URL이 잘못되었습니다.");
          }
          if (target.username || target.password)
            throw schemaError("자격증명 URL을 포함할 수 없습니다.");
        }
        if (val && typeof val === "object") walk(val, depth + 1);
      }
    };
    walk(entity);
  }
  return entities;
}

export function generateStructuredData(
  page: PageMetadata,
  url: string,
  type: PageType,
) {
  const name = page.heading || page.bodyText.split(/[.!?。]/)[0]?.slice(0, 120);
  if (!name)
    throw schemaError("공개 본문에서 이름 또는 제목을 확인하지 못했습니다.");
  const existing = page.jsonLd.find((item) => item["@type"] === type);
  const entity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": existing?.["@id"] ?? `${url}#${type.toLowerCase()}`,
    url,
    [type === "BlogPosting" ? "headline" : "name"]: name,
  };
  if (type === "BreadcrumbList") {
    delete entity.name;
    entity.itemListElement = [
      { "@type": "ListItem", position: 1, name, item: url },
    ];
  }
  const document = JSON.stringify(entity, null, 2);
  validateStructuredData(document, page, url);
  return {
    document,
    evidence: { url, quote: name },
    missingFields:
      type === "Product"
        ? [
            "가격·재고·평점은 추측하지 않았습니다. 검증된 원본이 있어야 추가할 수 있습니다.",
          ]
        : [],
  };
}
