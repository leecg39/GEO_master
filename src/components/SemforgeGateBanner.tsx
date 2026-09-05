"use client";

import Link from "next/link";
import { CreditCard, Lock } from "lucide-react";
import { Badge, Card } from "@/components/ui";

export function SemforgeGateBanner({ message }: { message?: string }) {
  return (
    <Card className="border-amber-400/20 bg-amber-400/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400/10"><Lock className="h-5 w-5 text-amber-300" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-white">SEMForge Pro 필요</h2>
              <Badge tone="warn">월 300,000원</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              {message ?? "GEO Master 분석 결과를 바탕으로 SERP·크롤·GSC·GBP 기반 GEO 실행을 하려면 SEMForge Pro 구독이 필요합니다."}
            </p>
          </div>
        </div>
        <Link href="/subscription" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-cyan-300">
          <CreditCard className="h-4 w-4" />구독하기
        </Link>
      </div>
    </Card>
  );
}
