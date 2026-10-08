"use client";
import { useEffect, useState } from "react";
import type { MonitoringResponses } from "@/lib/monitoring-types";

export function useMonitoringResponses(query: string) {
  const [revision, setRevision] = useState(0);
  const key = `${query}:${revision}`;
  const [result, setResult] = useState<{ key: string; data?: MonitoringResponses; error?: string }>({ key: "" });
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void fetch(`/api/monitoring/responses?${query}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "저장된 응답을 불러오지 못했습니다.");
      const expected = new URLSearchParams(query);
      if (body.project.id !== Number(expected.get("projectId")) || body.run.id !== Number(expected.get("runId")) || body.question.key !== expected.get("question")) throw new Error("선택한 질문·실행의 응답이 아닙니다. 다시 불러와 주세요.");
      if (live) setResult({ key, data: body });
    }).catch((failure) => { if (live) setResult({ key, error: failure instanceof Error ? failure.message : "저장된 응답을 불러오지 못했습니다." }); });
    return () => { live = false; controller.abort(); };
  }, [query, key]);
  return { loading: result.key !== key, data: result.key === key ? result.data : undefined, error: result.key === key ? result.error : undefined, retry: () => setRevision((value) => value + 1) };
}
