import type { SeoFinding, SeoScore } from "./contracts";

export function scoreFindings(findings: SeoFinding[]): SeoScore {
  const technical = findings.filter((finding) => finding.category === "technical" &&
    ["http_observation", "parser_rule"].includes(finding.method));
  const count = (status: SeoFinding["status"]) => technical.filter((finding) => finding.status === status).length;
  const passed = count("pass"), failed = count("fail"), unknown = count("unknown"), notApplicable = count("not_applicable");
  const measured = passed + failed;
  return { value: measured ? Math.round(100 * passed / measured) : null, passed, failed, unknown, notApplicable,
    coverage: measured + unknown ? Math.round(100 * measured / (measured + unknown)) : null };
}
