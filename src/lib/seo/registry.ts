import { technicalRules, TECHNICAL_VERSION } from "./rules/technical";
import { schemaRules, SCHEMA_VERSION } from "./rules/schema";

/** Fixed executable allowlist. Vendor documents never become executable skills. */
export const SEO_ANALYZERS = [
  { id: "technical", version: TECHNICAL_VERSION, run: technicalRules },
  { id: "schema", version: SCHEMA_VERSION, run: schemaRules },
] as const;
export const SEO_ANALYSIS_VERSION = "seo-analysis/1";
