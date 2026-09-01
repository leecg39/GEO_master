"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CircleDollarSign, Clock3, LoaderCircle, Pause, Pencil, Play, RefreshCw, RotateCcw, Save, Trash2, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";
import { formatDate } from "@/lib/utils";

type Provider = "openai" | "anthropic" | "gemini" | "grok";
type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "blocked";
interface Policy { monthlyBudgetUsd: number; maxRunCostUsd: number; providerCallCosts: Record<Provider, number>; alertThreshold: number }
interface Budget { period: string; usedUsd: number; reservedUsd: number; consumedUsd: number; remainingUsd: number; usagePercent: number; alert: boolean }
interface Schedule { id: number; name: string; questions: string[]; providers: Provider[]; repetitions: number; intervalMinutes: number; nextRunAt: string; enabled: boolean; lastErrorCode: string | null; createdAt: string; updatedAt: string; estimate: { baseCalls: number; maximumCalls: number; estimatedCostUsd: number } }
interface Job { id: number; scheduleId: number | null; runId: number | null; attemptOfId: number | null; status: JobStatus; providers: Provider[]; questionCount: number; repetitions: number; estimatedCostUsd: number; incurredCostUsd: number; budgetPeriod: string; errorCode: string | null; cancelRequested: boolean; availableAt: string; createdAt: string; startedAt: string | null; completedAt: string | null }
interface AutomationState { policy: Policy; budget: Budget; schedules: Schedule[]; jobs: Job[] }

const providerLabels: Record<Provider, string> = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", grok: "Grok" };
const providers = Object.keys(providerLabels) as Provider[];
const statusLabels: Record<JobStatus, string> = { queued: "대기", running: "실행 중", completed: "완료", failed: "실패", canceled: "취소", blocked: "비용 차단" };
const errorLabels: Record<string, string> = {
  COST_POLICY_DISABLED: "비용 정책이 비활성 상태입니다.",
  RUN_COST_LIMIT_EXCEEDED: "건별 비용 상한을 초과했습니다.",
  MONTHLY_BUDGET_EXCEEDED: "월 예산을 초과합니다.",
  STALE_LEASE: "서버 중단으로 작업을 안전하게 격리했습니다.",
  JOB_CANCELED: "사용자가 실행을 취소했습니다.",
  USER_CANCELED: "대기 중 사용자가 취소했습니다.",
  INVALID_JOB_PAYLOAD: "저장된 작업 입력이 손상되었습니다.",
  JOB_EXECUTION_FAILED: "측정 실행에 실패했습니다.",
  INVALID_SCHEDULE_DATA: "저장된 예약 데이터가 손상되어 안전하게 정지했습니다.",
  SCHEDULE_ENQUEUE_FAILED: "예약 작업 생성에 실패해 다음 주기에 다시 시도합니다.",
  API_KEY_REQUIRED: "필요한 API 키가 설정되지 않았습니다.",
  LLM_AUTH_FAILED: "LLM 인증에 실패했습니다.",
  LLM_REQUEST_FAILED: "LLM 요청에 실패했습니다.",
};
const intervalOptions = [
  { value: 1_440, label: "매일" },
  { value: 10_080, label: "매주" },
  { value: 43_200, label: "30일마다" },
];

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
  return data;
}

function localInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function usd(value: number) { return `$${value.toFixed(value < 1 ? 3 : 2)}`; }
function jobTone(status: JobStatus): "default" | "good" | "warn" | "bad" | "cyan" {
  if (status === "completed") return "good";
  if (status === "running") return "cyan";
  if (status === "queued" || status === "blocked") return "warn";
  if (status === "failed") return "bad";
  return "default";
}

export function AutomationClient() {
  const [state, setState] = useState<AutomationState | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [name, setName] = useState("월간 핵심 질문 측정");
  const [questions, setQuestions] = useState("");
  const [selected, setSelected] = useState<Record<Provider, boolean>>({ openai: false, anthropic: false, gemini: false, grok: false });
  const [repetitions, setRepetitions] = useState(1);
  const [intervalMinutes, setIntervalMinutes] = useState(43_200);
  const [nextRunAt, setNextRunAt] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    try {
      const data = await responseJson<AutomationState>(await fetch("/api/automation", { cache: "no-store" }));
      setState(data);
      setPolicy((current) => current ?? data.policy);
      setNextRunAt((current) => current || localInputValue(new Date(Date.now() + 24 * 60 * 60_000)));
      if (!quiet) setError("");
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "자동화 상태를 불러오지 못했습니다.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load(quiet: boolean) {
      try {
        const data = await responseJson<AutomationState>(await fetch("/api/automation", { cache: "no-store" }));
        if (!active) return;
        setState(data);
        setPolicy((current) => current ?? data.policy);
        setNextRunAt((current) => current || localInputValue(new Date(Date.now() + 24 * 60 * 60_000)));
        if (!quiet) setError("");
      } catch (cause) {
        if (active && !quiet) setError(cause instanceof Error ? cause.message : "자동화 상태를 불러오지 못했습니다.");
      } finally {
        if (active && !quiet) setLoading(false);
      }
    }
    void load(false);
    const timer = window.setInterval(() => { void load(true); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const questionList = useMemo(() => questions.split("\n").map((item) => item.trim()).filter(Boolean), [questions]);
  const selectedProviders = useMemo(() => providers.filter((provider) => selected[provider]), [selected]);
  const draftEstimate = useMemo(() => {
    if (!policy) return { baseCalls: 0, maximumCalls: 0, cost: 0 };
    const baseCalls = questionList.length * repetitions * selectedProviders.length;
    const cost = selectedProviders.reduce((sum, provider) => sum + questionList.length * repetitions * 2 * policy.providerCallCosts[provider], 0);
    return { baseCalls, maximumCalls: baseCalls * 2, cost };
  }, [policy, questionList.length, repetitions, selectedProviders]);

  async function action(body: Record<string, unknown>, label: string) {
    setBusy(label); setError(""); setMessage("");
    try {
      const data = await responseJson<{ state: AutomationState }>(await fetch("/api/automation", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      setState(data.state);
      setMessage(`${label} 작업을 완료했습니다.`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} 작업에 실패했습니다.`);
      return false;
    } finally { setBusy(""); }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;
    if (await action({ action: "policy.update", policy }, "비용 정책 저장")) setPolicy((current) => current);
  }

  function resetScheduleForm() {
    setEditingId(null); setName("월간 핵심 질문 측정"); setQuestions("");
    setSelected({ openai: false, anthropic: false, gemini: false, grok: false });
    setRepetitions(1); setIntervalMinutes(43_200); setNextRunAt(localInputValue(new Date(Date.now() + 24 * 60 * 60_000))); setEnabled(false);
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    const schedule = { name, questions: questionList, providers: selectedProviders, repetitions, intervalMinutes, nextRunAt: new Date(nextRunAt).toISOString(), enabled };
    const body = editingId ? { action: "schedule.update", id: editingId, schedule } : { action: "schedule.create", schedule };
    if (await action(body, editingId ? "예약 수정" : "예약 생성")) resetScheduleForm();
  }

  function editSchedule(schedule: Schedule) {
    setEditingId(schedule.id); setName(schedule.name); setQuestions(schedule.questions.join("\n"));
    setSelected(Object.fromEntries(providers.map((provider) => [provider, schedule.providers.includes(provider)])) as Record<Provider, boolean>);
    setRepetitions(schedule.repetitions); setIntervalMinutes(schedule.intervalMinutes); setNextRunAt(localInputValue(new Date(schedule.nextRunAt))); setEnabled(schedule.enabled);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  if (!state || !policy) return <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-300">{error || "자동화 상태를 불러오지 못했습니다."}</p>;

  return <div aria-busy={Boolean(busy)}>
    <PageHeader eyebrow="Persistent automation" title="예약 측정 자동화" description="SQLite 영속 큐가 응답 점유율 측정을 예약 실행합니다. 보수적 최대 호출 비용을 먼저 예약하고 월·건별 한도를 넘는 작업은 API 호출 전에 차단합니다." action={<Button variant="secondary" type="button" onClick={() => void refresh()} disabled={Boolean(busy)}><RefreshCw className="h-4 w-4" />새로고침</Button>} />

    <div aria-live="polite" className="mb-5 space-y-3">
      {state.budget.alert && <p role="alert" className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-200"><AlertTriangle className="h-4 w-4" />월 예산 알림 기준 {Math.round(policy.alertThreshold * 100)}%에 도달했습니다.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{message}</p>}
    </div>

    <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Card><div className="mb-5 flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-cyan-300" /><h2 className="font-semibold text-white">비용 안전장치</h2></div>
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-950/40 p-3"><span className="text-xs text-slate-500">{state.budget.period} 월 계상액</span><strong className="mt-1 block text-xl text-white">{usd(state.budget.usedUsd)}</strong><small className="text-[10px] text-slate-600">종료 정산 {usd(state.budget.consumedUsd)}</small></div><div className="rounded-xl bg-slate-950/40 p-3"><span className="text-xs text-slate-500">대기·실행 예약분</span><strong className="mt-1 block text-xl text-white">{usd(state.budget.reservedUsd)}</strong></div><div className="rounded-xl bg-slate-950/40 p-3"><span className="text-xs text-slate-500">남은 한도</span><strong className="mt-1 block text-xl text-white">{usd(state.budget.remainingUsd)}</strong></div></div>
        <Progress value={state.budget.usagePercent} ariaLabel="월 자동화 비용 한도 사용률" className="mt-4" />
        <form onSubmit={savePolicy} className="mt-5 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-300">월 한도 USD<input required type="number" min="0" max="100000" step="0.01" className="mt-2" value={policy.monthlyBudgetUsd} onChange={(event) => setPolicy({ ...policy, monthlyBudgetUsd: Number(event.target.value) })} /></label><label className="text-sm text-slate-300">건별 한도 USD<input required type="number" min="0" max="10000" step="0.01" className="mt-2" value={policy.maxRunCostUsd} onChange={(event) => setPolicy({ ...policy, maxRunCostUsd: Number(event.target.value) })} /></label></div>
          <div><p className="mb-2 text-sm text-slate-300">호출 1회 추정 단가 USD</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{providers.map((provider) => <label key={provider} className="text-xs text-slate-500">{providerLabels[provider]}<input required type="number" min="0.000001" max="100" step="0.001" className="mt-1.5" value={policy.providerCallCosts[provider]} onChange={(event) => setPolicy({ ...policy, providerCallCosts: { ...policy.providerCallCosts, [provider]: Number(event.target.value) } })} /></label>)}</div></div>
          <label className="text-sm text-slate-300">알림 기준 · {Math.round(policy.alertThreshold * 100)}%<input className="mt-2" type="range" min="0.5" max="0.99" step="0.01" value={policy.alertThreshold} onChange={(event) => setPolicy({ ...policy, alertThreshold: Number(event.target.value) })} /></label>
          <p className="text-xs leading-5 text-slate-500">단가는 실제 청구액이 아닌 사용자가 조정하는 추정치입니다. 대기·실행 중에는 문맥 분류까지 최대 2배를 예약하고, 완료·실패·취소 뒤에는 실제로 시작한 호출 횟수만 계상합니다. 한도가 0이면 자동 실행이 차단됩니다.</p><Button disabled={Boolean(busy)}><Save className="h-4 w-4" />비용 정책 저장</Button></form>
      </Card>

      <Card><div className="mb-5 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-violet-300" /><h2 className="font-semibold text-white">{editingId ? `예약 #${editingId} 수정` : "새 예약"}</h2></div>{editingId && <button type="button" onClick={resetScheduleForm} className="text-xs text-slate-400 hover:text-white"><XCircle className="mr-1 inline h-4 w-4" />수정 취소</button>}</div>
        <form onSubmit={saveSchedule} className="space-y-4"><label className="block text-sm text-slate-300">예약 이름<input required maxLength={100} className="mt-2" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="block text-sm text-slate-300">핵심 질문 · 한 줄에 하나, 최대 30개<textarea required rows={6} className="mt-2" value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder="국내에서 신뢰할 수 있는 분석 도구는 무엇인가요?" /></label>
          <fieldset><legend className="mb-2 text-sm text-slate-300">측정 모델</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{providers.map((provider) => <label key={provider} className={`rounded-xl border p-2.5 text-xs ${selected[provider] ? "border-cyan-400/30 bg-cyan-400/5 text-cyan-200" : "border-white/8 text-slate-400"}`}><input className="mr-2" type="checkbox" checked={selected[provider]} onChange={(event) => setSelected({ ...selected, [provider]: event.target.checked })} />{providerLabels[provider]}</label>)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm text-slate-300">질문당 반복<select className="mt-2" value={repetitions} onChange={(event) => setRepetitions(Number(event.target.value))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}회</option>)}</select></label><label className="text-sm text-slate-300">실행 주기<select className="mt-2" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{intervalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-sm text-slate-300">다음 실행<input required className="mt-2" type="datetime-local" value={nextRunAt} onChange={(event) => setNextRunAt(event.target.value)} /></label></div>
          <label className="flex items-start gap-3 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-sm text-amber-100"><input className="mt-1" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong className="block">저장 즉시 예약 활성화</strong><small className="text-amber-200/60">서버가 실행 중이고 비용 한도·API 키 조건을 만족하면 사용자 입력 없이 유료 호출할 수 있습니다.</small></span></label>
          <div className="rounded-xl bg-slate-950/45 p-3 text-xs leading-5 text-slate-400">기본 호출 {draftEstimate.baseCalls}회 · 최대 {draftEstimate.maximumCalls}회 · 보수적 상한 <strong className="text-white">{usd(draftEstimate.cost)}</strong></div><Button disabled={Boolean(busy) || !questionList.length || !selectedProviders.length || !nextRunAt}><Save className="h-4 w-4" />{editingId ? "예약 수정" : "예약 저장"}</Button></form>
      </Card>
    </section>

    <Card className="mt-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">예약 목록</h2><p className="mt-1 text-xs text-slate-500">중단 기간의 누락 슬롯은 한 건으로 합치며 대량 따라잡기를 실행하지 않습니다.</p></div><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void action({ action: "queue.process" }, "큐 1건 처리")}><Play className="h-4 w-4" />지금 큐 1건 처리</Button></div>
      {state.schedules.length ? <div className="grid gap-3 lg:grid-cols-2">{state.schedules.map((schedule) => <div key={schedule.id} className="rounded-xl border border-white/8 bg-slate-950/35 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><strong className="text-sm text-white">{schedule.name}</strong><Badge tone={schedule.enabled ? "good" : "default"}>{schedule.enabled ? "활성" : "일시 정지"}</Badge></div><p className="mt-1 text-xs text-slate-500">다음 {formatDate(schedule.nextRunAt)} · 질문 {schedule.questions.length}개 · 최대 {schedule.estimate.maximumCalls}회 / {usd(schedule.estimate.estimatedCostUsd)}</p>{schedule.lastErrorCode && <p className="mt-1 text-xs text-amber-300">{errorLabels[schedule.lastErrorCode] ?? schedule.lastErrorCode}</p>}</div><button type="button" aria-label={`${schedule.name} 수정`} className="p-1.5 text-slate-500 hover:text-white" onClick={() => editSchedule(schedule)}><Pencil className="h-4 w-4" /></button></div><div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void action({ action: "schedule.toggle", id: schedule.id, enabled: !schedule.enabled }, schedule.enabled ? "예약 일시 정지" : "예약 활성화")}>{schedule.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{schedule.enabled ? "일시 정지" : "활성화"}</Button><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => { if (window.confirm("비용 한도를 확인한 뒤 이 예약을 지금 큐에 추가할까요?")) void action({ action: "schedule.runNow", id: schedule.id }, "즉시 실행 예약"); }}><Clock3 className="h-4 w-4" />지금 실행</Button><Button type="button" variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm("예약을 삭제할까요? 기존 작업 이력은 보존됩니다.")) void action({ action: "schedule.delete", id: schedule.id }, "예약 삭제"); }}><Trash2 className="h-4 w-4" />삭제</Button></div></div>)}</div> : <EmptyState>예약을 저장하면 여기에 다음 실행 시각과 비용 상한이 표시됩니다.</EmptyState>}
    </Card>

    <Card className="mt-6"><div className="mb-5 flex items-center gap-2"><Clock3 className="h-4 w-4 text-slate-400" /><h2 className="font-semibold text-white">영속 작업 큐</h2></div>{state.jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-3">작업</th><th className="pb-3">상태</th><th className="pb-3">측정량</th><th className="pb-3">비용 계상</th><th className="pb-3">시각</th><th className="pb-3 text-right">제어</th></tr></thead><tbody className="divide-y divide-white/5">{state.jobs.map((job) => <tr key={job.id}><td className="py-3 text-slate-300">#{job.id}{job.attemptOfId ? <small className="ml-1 text-slate-600">재시도 #{job.attemptOfId}</small> : null}</td><td className="py-3"><Badge tone={jobTone(job.status)}>{statusLabels[job.status]}{job.cancelRequested ? " · 취소 대기" : ""}</Badge>{job.errorCode && <p className="mt-1 max-w-56 text-xs text-slate-500">{errorLabels[job.errorCode] ?? job.errorCode}</p>}</td><td className="py-3 text-xs text-slate-400">{job.questionCount}문항 × {job.providers.map((provider) => providerLabels[provider]).join(", ")} × {job.repetitions}회</td><td className="py-3 text-slate-300">{usd(job.status === "queued" || job.status === "running" ? job.estimatedCostUsd : job.incurredCostUsd)}<small className="block text-[10px] text-slate-600">상한 {usd(job.estimatedCostUsd)}</small></td><td className="py-3 text-xs text-slate-500">{formatDate(job.createdAt)}</td><td className="py-3 text-right">{(job.status === "queued" || job.status === "running") && <button type="button" disabled={Boolean(busy) || job.cancelRequested} onClick={() => void action({ action: "job.cancel", id: job.id }, "작업 취소")} className="mr-3 text-xs font-semibold text-rose-300 disabled:text-slate-600">취소</button>}{(["failed", "blocked", "canceled"] as JobStatus[]).includes(job.status) && <button type="button" disabled={Boolean(busy)} onClick={() => void action({ action: "job.retry", id: job.id }, "작업 재시도")} className="text-xs font-semibold text-cyan-300 disabled:text-slate-600"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />재시도</button>}</td></tr>)}</tbody></table></div> : <EmptyState>예약 실행 또는 지금 실행을 사용하면 작업 상태가 서버 재시작 후에도 보존됩니다.</EmptyState>}</Card>
  </div>;
}
