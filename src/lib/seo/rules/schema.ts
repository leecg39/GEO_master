import type { PageSnapshot } from "@/lib/site-ops/types";
import { schemaTypes } from "../normalize";
import type { RuleObservation } from "./technical";

export const SCHEMA_VERSION = "schema/1";
export function schemaRules(snapshot: PageSnapshot): RuleObservation[] {
  const page = snapshot.dataState === "live" && snapshot.fetchState === "fetched" ? snapshot.metadata : null;
  const entities = page?.jsonLd ?? [];
  // @id-only references are valid JSON-LD, not duplicate entity definitions.
  const definitions = entities.filter((entity) => Object.keys(entity).some((key) => !["@id", "@context"].includes(key)));
  const ids = definitions.map((entity) => entity["@id"]).filter((id): id is string => typeof id === "string" && id.length > 0);
  const duplicate = new Set(ids).size !== ids.length;
  const declaredTypes = definitions.filter((entity) => "@type" in entity);
  const validTypes = declaredTypes.every((entity) => schemaTypes(entity).length > 0 &&
    (!Array.isArray(entity["@type"]) || entity["@type"].every((type) => typeof type === "string" && type.trim())));
  const readiness = !page || page.jsonLdErrors > 0 ? "unknown" : entities.length ? null : "not_applicable";
  return [
    {
      ruleId: "jsonld-syntax", category: "technical", severity: "high", method: "parser_rule",
      status: !page ? "unknown" : page.jsonLdErrors > 0 ? "fail" : entities.length ? "pass" : "not_applicable",
      evidence: page ? ["metadata.jsonLdErrors", "metadata.jsonLd"] : [],
      explanation: !page ? "HTML 수집 근거가 없어 JSON-LD를 판단할 수 없습니다." : page.jsonLdErrors ? `JSON-LD 파싱 오류 ${page.jsonLdErrors}건입니다.` : entities.length ? "JSON-LD 문법을 확인했습니다." : "JSON-LD가 없어 문법 검사를 적용하지 않습니다. 스키마 부재 자체는 필수 오류가 아닙니다.",
    },
    {
      ruleId: "jsonld-identity", category: "technical", severity: "medium", method: "parser_rule",
      status: readiness ?? (duplicate ? "fail" : "pass"), evidence: page ? ["metadata.jsonLd"] : [],
      explanation: readiness ? "유효한 JSON-LD가 있을 때 동일 @id 중복을 검사합니다." : duplicate ? "동일 @id의 엔티티가 중복됩니다. 원본 구조를 확인하세요." : "동일 @id 중복이 없습니다. 같은 유형의 서로 다른 엔티티는 허용합니다.",
    },
    {
      ruleId: "jsonld-type", category: "technical", severity: "medium", method: "parser_rule",
      status: readiness ?? (!validTypes ? "fail" : declaredTypes.length === definitions.length && definitions.length > 0 ? "pass" : "unknown"), evidence: page ? ["metadata.jsonLd"] : [],
      explanation: readiness ? "유효한 JSON-LD가 있을 때 유형 형식을 검사합니다." : !validTypes ? "명시된 @type 형식이 올바르지 않은 엔티티가 있습니다." : declaredTypes.length === definitions.length && definitions.length > 0 ? "명시된 엔티티 유형 형식을 확인했습니다. @graph와 복수 @type을 포함합니다." : "직접 명시된 유형만 검사합니다. 참조·문맥에서 추론되는 유형은 미확인으로 남깁니다.",
    },
  ];
}
