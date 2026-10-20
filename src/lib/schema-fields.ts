/**
 * JSON-LD 타입별 필수·권장 속성 검사 (RankSEO REA G1).
 * - 기준: Google 검색 센터 구조화 데이터 문서 (2026-10-13 확인, 문서 최종 수정 2026-09-08~09-24).
 *   RankSEO의 표는 Article·Organization에 필수 속성을 두는 등 Google 문서와 달라 쓰지 않는다
 * - 최상위 엔티티와 @graph 항목만 검사한다. 다른 엔티티 안에 든 Review 등은 부모가 대상이라 Google 규칙상 요건이 다르다
 * - 필수 속성 충족은 Google 리치 결과 '대상 자격'일 뿐 노출·AI 인용을 보장하지 않는다
 * - 표에 없는 타입은 판정하지 않는다 (RankSEO는 알 수 없는 타입을 valid로 처리)
 */
import type { PageFinding } from "./page-snapshots";

const G = "https://developers.google.com/search/docs/appearance/structured-data";
const CHECKED_AT = "2026-10-13";
const MAX_NODES = 100;
const MAX_UNCHECKED = 20;

type JsonObject = Record<string, unknown>;

export interface SchemaSpec {
  id: string;
  types: readonly string[];
  docUrl: string;
  checkedAt: string;
  required: readonly string[];
  /** 그룹마다 하나 이상 있어야 한다 */
  anyOf?: readonly (readonly string[])[];
  recommended: readonly string[];
  /** 문서에 적힌 조건부 요건. 빠진 경로 목록을 돌려준다 */
  extra?: (node: JsonObject) => string[];
  /** Google 검색이 더 이상 표시하지 않는 기능 */
  notShown?: string;
}

export interface SchemaNodeResult {
  type: string;
  specId: string;
  status: "ok" | "missing-required" | "not-shown-by-google";
  missingRequired: string[];
  missingRecommended: string[];
  docUrl: string;
  note: string | null;
}

export interface SchemaFieldReport {
  nodes: SchemaNodeResult[];
  /** 표에 없어 판정하지 않은 타입 */
  unchecked: string[];
}

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isPresent);
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

/** 점 경로의 값. 중간에 배열이 있으면 항목 중 하나라도 있으면 있다고 본다. */
function hasPath(node: unknown, path: string): boolean {
  const [head, ...rest] = path.split(".");
  if (Array.isArray(node)) return node.some((item) => hasPath(item, path));
  if (!isObject(node) || !Object.hasOwn(node, head!)) return false;
  const value = node[head!];
  return rest.length === 0 ? isPresent(value) : hasPath(value, rest.join("."));
}

const SCHEMA_IRI = /^(?:https?:\/\/schema\.org\/|schema:)/i;
/** "https://schema.org/Product", "schema:Product" → "Product" */
const shortType = (type: string) => type.replace(SCHEMA_IRI, "");

function hasType(value: unknown, target: string): boolean {
  if (!isObject(value)) return false;
  const type = value["@type"];
  const list = typeof type === "string" ? [type] : Array.isArray(type) ? type.filter((entry): entry is string => typeof entry === "string") : [];
  return list.map(shortType).includes(target);
}

function offersShape(node: JsonObject): string[] {
  const offers = node.offers;
  if (!isPresent(offers)) return [];
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (!isObject(first)) return [];
  if (hasType(first, "AggregateOffer")) {
    return ["lowPrice", "priceCurrency"].filter((key) => !hasPath(first, key)).map((key) => `offers.${key}`);
  }
  return hasPath(first, "price") || hasPath(first, "priceSpecification.price") ? [] : ["offers.price"];
}

function eventVenue(node: JsonObject): string[] {
  const location = Array.isArray(node.location) ? node.location[0] : node.location;
  if (typeof location === "string") return ["location.address"];
  if (!isObject(location) || hasType(location, "VirtualLocation")) return [];
  return hasPath(location, "address") ? [] : ["location.address"];
}

function breadcrumbItems(node: JsonObject): string[] {
  const items = node.itemListElement;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item, index) => {
    const prefix = `itemListElement[${index + 1}]`;
    const isLast = index === items.length - 1;
    const keys = isLast ? ["position", "name"] : ["position", "name", "item"];
    return keys.filter((key) => !hasPath(item, key) && !(key === "name" && hasPath(item, "item.name"))).map((key) => `${prefix}.${key}`);
  });
}

const LOCAL_BUSINESS_TYPES = [
  "LocalBusiness", "Restaurant", "FoodEstablishment", "CafeOrCoffeeShop", "Bakery", "BarOrPub", "FastFoodRestaurant", "Store",
  "ClothingStore", "ElectronicsStore", "FurnitureStore", "GroceryStore", "HardwareStore", "BookStore", "ConvenienceStore",
  "Dentist", "MedicalBusiness", "MedicalClinic", "Physician", "Pharmacy", "HealthAndBeautyBusiness", "BeautySalon", "HairSalon",
  "DaySpa", "LodgingBusiness", "Hotel", "AutoRepair", "AutomotiveBusiness", "ProfessionalService", "LegalService", "Attorney",
  "AccountingService", "RealEstateAgent", "HomeAndConstructionBusiness",
] as const;

export const SCHEMA_SPECS: readonly SchemaSpec[] = Object.freeze([
  { id: "article", types: ["Article", "NewsArticle", "BlogPosting"], docUrl: `${G}/article`, checkedAt: CHECKED_AT,
    required: [], recommended: ["headline", "image", "datePublished", "dateModified", "author", "author.name"] },
  { id: "breadcrumb", types: ["BreadcrumbList"], docUrl: `${G}/breadcrumb`, checkedAt: CHECKED_AT,
    required: ["itemListElement"], recommended: [], extra: breadcrumbItems },
  { id: "event", types: ["Event"], docUrl: `${G}/event`, checkedAt: CHECKED_AT,
    required: ["name", "startDate", "location"], recommended: ["description", "endDate", "eventStatus", "image", "offers", "organizer"], extra: eventVenue },
  { id: "local-business", types: LOCAL_BUSINESS_TYPES, docUrl: `${G}/local-business`, checkedAt: CHECKED_AT,
    required: ["name", "address"], recommended: ["telephone", "url", "geo", "openingHoursSpecification", "priceRange"] },
  { id: "organization", types: ["Organization", "Corporation", "OnlineStore", "OnlineBusiness", "NGO", "NewsMediaOrganization"],
    docUrl: `${G}/organization`, checkedAt: CHECKED_AT, required: [], recommended: ["name", "url", "logo", "sameAs", "description"] },
  { id: "product", types: ["Product"], docUrl: `${G}/product-snippet`, checkedAt: CHECKED_AT,
    required: ["name"], anyOf: [["review", "aggregateRating", "offers"]], recommended: ["image", "description"], extra: offersShape },
  { id: "recipe", types: ["Recipe"], docUrl: `${G}/recipe`, checkedAt: CHECKED_AT,
    required: ["image", "name"], recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions", "totalTime"] },
  { id: "review", types: ["Review"], docUrl: `${G}/review-snippet`, checkedAt: CHECKED_AT,
    required: ["author", "itemReviewed", "itemReviewed.name", "reviewRating", "reviewRating.ratingValue"], recommended: ["datePublished"] },
  { id: "aggregate-rating", types: ["AggregateRating"], docUrl: `${G}/review-snippet`, checkedAt: CHECKED_AT,
    required: ["itemReviewed", "itemReviewed.name", "ratingValue"], anyOf: [["ratingCount", "reviewCount"]], recommended: ["bestRating", "worstRating"] },
  { id: "software-app", types: ["SoftwareApplication", "MobileApplication", "WebApplication", "VideoGame"], docUrl: `${G}/software-app`,
    checkedAt: CHECKED_AT, required: ["name", "offers.price"], anyOf: [["aggregateRating", "review"]], recommended: ["applicationCategory", "operatingSystem"] },
  { id: "video", types: ["VideoObject"], docUrl: `${G}/video`, checkedAt: CHECKED_AT,
    required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "duration", "contentUrl", "embedUrl"] },
  { id: "profile-page", types: ["ProfilePage"], docUrl: `${G}/profile-page`, checkedAt: CHECKED_AT,
    required: ["mainEntity", "mainEntity.name"], recommended: ["dateCreated", "dateModified"] },
  { id: "job-posting", types: ["JobPosting"], docUrl: `${G}/job-posting`, checkedAt: CHECKED_AT,
    required: ["datePosted", "description", "hiringOrganization", "title"], anyOf: [["jobLocation", "applicantLocationRequirements"]],
    recommended: ["baseSalary", "employmentType", "validThrough"] },
  { id: "course", types: ["Course"], docUrl: `${G}/course`, checkedAt: CHECKED_AT, required: ["name", "description"], recommended: ["provider"] },
  { id: "faq", types: ["FAQPage"], docUrl: "https://developers.google.com/search/updates#removing-faq-rich-result", checkedAt: CHECKED_AT,
    required: [], recommended: [], notShown: "Google 검색은 2026년 5월부터 FAQPage 리치 결과를 표시하지 않습니다." },
  { id: "howto", types: ["HowTo"], docUrl: "https://developers.google.com/search/updates", checkedAt: CHECKED_AT,
    required: [], recommended: [], notShown: "Google 검색은 HowTo 리치 결과를 표시하지 않습니다." },
] satisfies SchemaSpec[]);

const SPEC_BY_TYPE: ReadonlyMap<string, SchemaSpec> = new Map(SCHEMA_SPECS.flatMap((spec) => spec.types.map((type) => [type, spec] as const)));

function nodeTypes(node: JsonObject): string[] {
  const type = node["@type"];
  const list = typeof type === "string" ? [type] : Array.isArray(type) ? type.filter((entry): entry is string => typeof entry === "string") : [];
  return list.map(shortType);
}

function evaluateNode(node: JsonObject, type: string, spec: SchemaSpec): SchemaNodeResult {
  const base = { type, specId: spec.id, docUrl: spec.docUrl, missingRecommended: [] as string[] };
  if (spec.notShown) return { ...base, status: "not-shown-by-google", missingRequired: [], note: spec.notShown };
  const missingRequired = [
    ...spec.required.filter((path) => !hasPath(node, path)),
    ...(spec.anyOf ?? []).filter((group) => !group.some((path) => hasPath(node, path))).map((group) => group.join(" | ")),
    ...(spec.extra?.(node) ?? []),
  ];
  return {
    ...base,
    status: missingRequired.length ? "missing-required" : "ok",
    missingRequired,
    missingRecommended: spec.recommended.filter((path) => !hasPath(node, path)),
    note: null,
  };
}

function topLevelNodes(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(topLevelNodes);
  if (!isObject(value)) return [];
  const graph = value["@graph"];
  const own = nodeTypes(value).length ? [value] : [];
  return Array.isArray(graph) ? [...own, ...graph.filter(isObject)] : own;
}

/** JSON-LD script 본문 목록을 검사한다. 구문 오류 블록은 jsonld-parse 규칙이 따로 알리므로 건너뛴다. */
export function evaluateJsonLd(blockTexts: readonly string[]): SchemaFieldReport {
  const nodes = blockTexts.flatMap((text) => {
    try { return topLevelNodes(JSON.parse(text)); } catch { return []; }
  }).slice(0, MAX_NODES);
  const results: SchemaNodeResult[] = [];
  const unchecked = new Set<string>();
  for (const node of nodes) {
    const types = nodeTypes(node);
    const type = types.find((entry) => SPEC_BY_TYPE.has(entry));
    if (type) results.push(evaluateNode(node, type, SPEC_BY_TYPE.get(type)!));
    else types.forEach((entry) => unchecked.size < MAX_UNCHECKED && unchecked.add(entry));
  }
  return { nodes: results, unchecked: [...unchecked] };
}

const MAX_DETAIL = 600;
const clip = (text: string) => text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;

type FieldFinding = Pick<PageFinding, "code" | "tier" | "severity" | "passed" | "label" | "detail" | "evidence">;

/** 페이지 스냅샷 규칙: 필수 누락은 기술 경고(리치 결과 대상 제외), 권장 누락은 참고 */
export function schemaFindings(blockTexts: readonly string[]): FieldFinding[] {
  const report = evaluateJsonLd(blockTexts);
  const failing = report.nodes.filter((node) => node.status === "missing-required");
  const notShown = report.nodes.filter((node) => node.status === "not-shown-by-google");
  const recommended = report.nodes.filter((node) => node.status === "ok" && node.missingRecommended.length);
  const notes = [
    ...notShown.map((node) => `${node.type}: ${node.note}`),
    report.unchecked.length ? `판정 기준이 없어 검사하지 않은 타입: ${report.unchecked.join(", ")}` : "",
  ].filter(Boolean);
  const requiredDetail = failing.length
    ? `Google 리치 결과 필수 속성이 빠졌습니다 — ${failing.map((node) => `${node.type}: ${node.missingRequired.join(", ")}`).join(" / ")}`
    : report.nodes.length ? "검사한 타입의 필수 속성을 모두 갖췄습니다." : "검사 기준이 있는 구조화 데이터가 없습니다.";
  return [
    {
      code: "schema-required", tier: "technical", severity: failing.length ? "warning" : "notice", passed: failing.length === 0,
      label: "구조화 데이터 필수 속성", detail: clip([requiredDetail, ...notes].join(" · ")),
      evidence: report.nodes.length ? report.nodes.map((node) => node.type).join(", ") : null,
    },
    {
      code: "schema-recommended", tier: "recommendation", severity: "notice", passed: recommended.length === 0,
      label: "구조화 데이터 권장 속성",
      detail: clip(recommended.length ? `권장 속성 보완 — ${recommended.map((node) => `${node.type}: ${node.missingRecommended.join(", ")}`).join(" / ")}` : "권장 속성 누락이 없거나 검사 대상이 없습니다."),
      evidence: null,
    },
  ];
}
