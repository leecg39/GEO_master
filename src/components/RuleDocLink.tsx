import { ExternalLink } from "lucide-react";
import { ruleDocFor } from "@/lib/rule-docs";

/** 진단 규칙의 공식 문서 링크와 주의점. 문서가 없는 규칙은 아무것도 그리지 않는다. */
export function RuleDocLink({ code }: { code: string }) {
  const doc = ruleDocFor(code);
  if (!doc) return null;
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300/80 underline-offset-2 hover:text-cyan-200 hover:underline">
        <ExternalLink className="h-3 w-3" aria-hidden="true" />근거 문서 · {doc.source}
      </a>
      {doc.note && <span className="ml-1.5">{doc.note}</span>}
    </p>
  );
}
