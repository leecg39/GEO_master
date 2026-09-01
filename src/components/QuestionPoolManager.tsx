"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Database, LoaderCircle, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { ConfirmDialog, CrudListToolbar, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

interface QuestionSet {
  id: number;
  projectId: number;
  name: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Question {
  id: number;
  questionSetId: number;
  text: string;
  source: string;
  intent: string;
  segment: string;
  journeyStage: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface QuestionDraft {
  id?: number;
  questionSetId: number;
  text: string;
  source: string;
  intent: string;
  segment: string;
  journeyStage: string;
  expectedUpdatedAt?: string;
}

interface Page<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

interface ApiFailure extends Error { code?: string }

const projectChangedEvent = "geo-master:project-changed";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
    const error = new Error(body.error || "요청을 처리하지 못했습니다.") as ApiFailure;
    error.code = body.code;
    throw error;
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

function newQuestion(questionSetId: number): QuestionDraft {
  return {
    questionSetId,
    text: "",
    source: "직접 입력",
    intent: "정보 탐색형",
    segment: "전체",
    journeyStage: "탐색",
  };
}

function editQuestion(question: Question): QuestionDraft {
  return {
    id: question.id,
    questionSetId: question.questionSetId,
    text: question.text,
    source: question.source,
    intent: question.intent,
    segment: question.segment,
    journeyStage: question.journeyStage,
    expectedUpdatedAt: question.updatedAt,
  };
}

export function QuestionPoolManager({ onUseQuestions }: { onUseQuestions: (questions: string) => void }) {
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState("");
  const [newSetName, setNewSetName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [deleteSetTarget, setDeleteSetTarget] = useState<QuestionSet | null>(null);
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadSets = useCallback(async (preferredId?: number) => {
    try {
      const collected: QuestionSet[] = [];
      let cursor: string | null = null;
      do {
        const parameters = new URLSearchParams({ limit: "100" });
        if (cursor) parameters.set("cursor", cursor);
        const page = await api<Page<QuestionSet>>(`/api/question-sets?${parameters}`);
        collected.push(...page.items);
        cursor = page.page.hasMore ? page.page.nextCursor : null;
      } while (cursor);
      setSets(collected);
      setSelectedId((current) => {
        const requested = preferredId && collected.some((set) => set.id === preferredId) ? preferredId : current;
        return requested && collected.some((set) => set.id === requested) ? requested : collected[0]?.id ?? null;
      });
      if (!collected.length) setQuestions([]);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "질문 세트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQuestions = useCallback(async (questionSetId: number) => {
    try {
      setQuestionLoading(true);
      const collected: Question[] = [];
      let cursor: string | null = null;
      do {
        const parameters = new URLSearchParams({ limit: "100" });
        if (cursor) parameters.set("cursor", cursor);
        const page = await api<Page<Question>>(`/api/question-sets/${questionSetId}/questions?${parameters}`);
        collected.push(...page.items);
        cursor = page.page.hasMore ? page.page.nextCursor : null;
      } while (cursor);
      collected.sort((left, right) => left.position - right.position || left.id - right.id);
      setQuestions(collected);
    } catch (loadError) {
      setQuestions([]);
      setError(loadError instanceof Error ? loadError.message : "질문을 불러오지 못했습니다.");
    } finally {
      setQuestionLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadSets(), 0);
    const projectChanged = () => {
      setSelectedId(null);
      setQuestions([]);
      setDraft(null);
      void loadSets();
    };
    window.addEventListener(projectChangedEvent, projectChanged);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener(projectChangedEvent, projectChanged);
    };
  }, [loadSets]);

  useEffect(() => {
    if (!selectedId) return;
    const load = window.setTimeout(() => void loadQuestions(selectedId), 0);
    return () => window.clearTimeout(load);
  }, [loadQuestions, selectedId]);

  const selectedSet = sets.find((set) => set.id === selectedId) ?? null;
  const visibleSets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? sets.filter((set) => set.name.toLocaleLowerCase().includes(needle)) : sets;
  }, [query, sets]);

  const recover = async (failure: unknown, fallback: string) => {
    const apiFailure = failure as ApiFailure;
    setError(apiFailure.code === "STALE_WRITE" || apiFailure.code === "QUESTION_ORDER_CHANGED"
      ? "다른 화면에서 질문 풀이 변경되었습니다. 최신 목록을 불러왔습니다."
      : apiFailure.message || fallback);
    await loadSets(selectedId ?? undefined);
    if (selectedId) await loadQuestions(selectedId);
  };

  const createSet = async (event: FormEvent) => {
    event.preventDefault();
    if (!newSetName.trim() || busy) return;
    try {
      setBusy(true);
      setError("");
      const result = await api<{ questionSet: QuestionSet }>("/api/question-sets", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newSetName }),
      });
      setNewSetName("");
      await loadSets(result.questionSet.id);
    } catch (failure) {
      await recover(failure, "질문 세트를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const renameSet = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSet || !renameValue.trim() || busy) return;
    try {
      setBusy(true);
      const result = await api<{ questionSet: QuestionSet }>(`/api/question-sets/${selectedSet.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: renameValue, expectedUpdatedAt: selectedSet.updatedAt }),
      });
      setSets((current) => current.map((set) => set.id === result.questionSet.id ? result.questionSet : set));
      setRenaming(false);
    } catch (failure) {
      setRenaming(false);
      await recover(failure, "질문 세트 이름을 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const saveQuestion = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    try {
      setBusy(true);
      setError("");
      const fields = {
        questionSetId: draft.questionSetId,
        text: draft.text,
        source: draft.source,
        intent: draft.intent,
        segment: draft.segment,
        journeyStage: draft.journeyStage,
      };
      if (draft.id) {
        await api<{ question: Question }>(`/api/questions/${draft.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...fields, expectedUpdatedAt: draft.expectedUpdatedAt }),
        });
      } else {
        await api<{ question: Question }>(`/api/question-sets/${draft.questionSetId}/questions`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            text: draft.text,
            source: draft.source,
            intent: draft.intent,
            segment: draft.segment,
            journeyStage: draft.journeyStage,
          }),
        });
      }
      const originalSetId = selectedId;
      setDraft(null);
      await loadSets(originalSetId ?? draft.questionSetId);
      if (originalSetId) await loadQuestions(originalSetId);
    } catch (failure) {
      setDraft(null);
      await recover(failure, "질문을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const moveQuestion = async (index: number, direction: -1 | 1) => {
    if (!selectedSet || busy) return;
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      setBusy(true);
      const result = await api<{ questions: Question[]; questionSet: QuestionSet }>(`/api/question-sets/${selectedSet.id}/reorder`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIds: reordered.map((question) => question.id), expectedUpdatedAt: selectedSet.updatedAt }),
      });
      setQuestions(result.questions);
      setSets((current) => current.map((set) => set.id === result.questionSet.id ? result.questionSet : set));
    } catch (failure) {
      await recover(failure, "질문 순서를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const removeQuestion = async () => {
    if (!deleteQuestionTarget || busy) return;
    try {
      setBusy(true);
      await api<void>(`/api/questions/${deleteQuestionTarget.id}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: deleteQuestionTarget.updatedAt }),
      });
      setDeleteQuestionTarget(null);
      if (selectedId) {
        await loadSets(selectedId);
        await loadQuestions(selectedId);
      }
    } catch (failure) {
      setDeleteQuestionTarget(null);
      await recover(failure, "질문을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const removeSet = async () => {
    if (!deleteSetTarget || busy) return;
    try {
      setBusy(true);
      await api<void>(`/api/question-sets/${deleteSetTarget.id}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: deleteSetTarget.updatedAt, cascadeConfirmed: true }),
      });
      setDeleteSetTarget(null);
      setQuestions([]);
      setSelectedId(null);
      await loadSets();
    } catch (failure) {
      setDeleteSetTarget(null);
      await recover(failure, "질문 세트를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Card className="mb-5">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-400/10"><Database className="h-4 w-4 text-violet-300" /></span><div><h2 className="font-semibold text-white">저장된 질문 풀</h2><p className="mt-1 text-xs text-slate-500">활성 프로젝트별 질문과 소스·의도·고객 여정 메타데이터를 재사용합니다.</p></div></div>
        <form className="flex gap-2" onSubmit={createSet}><label className="sr-only" htmlFor="new-question-set">새 질문 세트 이름</label><input id="new-question-set" className="min-w-52" value={newSetName} maxLength={120} onChange={(event) => setNewSetName(event.target.value)} placeholder="새 질문 세트 이름" /><Button disabled={busy || !newSetName.trim()}><Plus className="h-4 w-4" />세트 추가</Button></form>
      </div>

      <CrudListToolbar query={query} onQueryChange={setQuery} placeholder="질문 세트 검색" />
      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {visibleSets.map((set) => <button key={set.id} type="button" onClick={() => setSelectedId(set.id)} className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs transition ${set.id === selectedId ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" : "border-white/8 bg-slate-950/30 text-slate-500 hover:text-slate-300"}`}><span className="block max-w-48 truncate font-semibold">{set.name}</span><span className="mt-0.5 block text-[10px] opacity-70">{set.questionCount}개 질문</span></button>)}
        {!loading && !visibleSets.length && <span className="py-3 text-xs text-slate-600">검색 결과가 없습니다.</span>}
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {selectedSet ? <div className="mt-4 border-t border-white/7 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {renaming ? <form className="flex flex-1 gap-2" onSubmit={renameSet}><input autoFocus maxLength={120} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /><Button disabled={busy || !renameValue.trim()}>이름 저장</Button><Button type="button" variant="secondary" onClick={() => setRenaming(false)}>취소</Button></form> : <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">{selectedSet.name}</h3><Badge>{questions.length}개</Badge></div><p className="mt-1 text-xs text-slate-600">위·아래 버튼으로 실행 순서를 정렬할 수 있습니다.</p></div>}
          {!renaming && <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={!questions.length} onClick={() => onUseQuestions(questions.map((question) => question.text).join("\n"))}><Upload className="h-4 w-4" />측정 입력에 사용</Button><Button type="button" variant="secondary" onClick={() => { setRenameValue(selectedSet.name); setRenaming(true); }}><Pencil className="h-4 w-4" />이름 변경</Button><Button type="button" variant="danger" onClick={() => setDeleteSetTarget(selectedSet)}><Trash2 className="h-4 w-4" />세트 삭제</Button><Button type="button" onClick={() => setDraft(newQuestion(selectedSet.id))}><Plus className="h-4 w-4" />질문 추가</Button></div>}
        </div>

        <div className="mt-4 space-y-2">
          {questionLoading && <div className="grid min-h-24 place-items-center"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-400" /></div>}
          {!questionLoading && questions.map((question, index) => <article key={question.id} className="rounded-xl border border-white/7 bg-slate-950/35 p-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-500">{index + 1}</span>
              <div className="min-w-0 flex-1"><p className="text-sm leading-6 text-slate-200">{question.text}</p><div className="mt-2 flex flex-wrap gap-1.5"><Badge>{question.source}</Badge><Badge tone="cyan">{question.intent}</Badge><Badge>{question.segment}</Badge><Badge>{question.journeyStage}</Badge></div></div>
              <div className="flex shrink-0 gap-1"><button type="button" disabled={busy || index === 0} onClick={() => void moveQuestion(index, -1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white disabled:opacity-25" aria-label={`${index + 1}번 질문 위로`}><ArrowUp className="h-4 w-4" /></button><button type="button" disabled={busy || index === questions.length - 1} onClick={() => void moveQuestion(index, 1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white disabled:opacity-25" aria-label={`${index + 1}번 질문 아래로`}><ArrowDown className="h-4 w-4" /></button><button type="button" disabled={busy} onClick={() => setDraft(editQuestion(question))} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${index + 1}번 질문 수정`}><Pencil className="h-4 w-4" /></button><button type="button" disabled={busy} onClick={() => setDeleteQuestionTarget(question)} className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-400/10 hover:text-rose-300" aria-label={`${index + 1}번 질문 삭제`}><Trash2 className="h-4 w-4" /></button></div>
            </div>
          </article>)}
          {!questionLoading && !questions.length && <EmptyState>질문을 추가하거나 아래 템플릿에서 측정 질문을 직접 입력하세요.</EmptyState>}
        </div>
      </div> : !loading && <div className="mt-4"><EmptyState>먼저 질문 세트를 만드세요.</EmptyState></div>}
    </Card>

    <DetailDrawer open={Boolean(draft)} title={draft?.id ? "질문 수정" : "질문 추가"} description="브랜드와 경쟁사 이름을 제외한 실제 고객 질문을 저장하세요." busy={busy} onClose={() => setDraft(null)} footer={draft && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDraft(null)}>취소</Button><Button type="submit" form="question-editor" disabled={busy || draft.text.trim().length < 5}>{busy ? "저장 중…" : "질문 저장"}</Button></div>}>
      {draft && <form id="question-editor" className="space-y-4" onSubmit={saveQuestion}>
        <label className="block text-sm">질문<textarea className="mt-2 min-h-28" required minLength={5} maxLength={500} value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
        {draft.id && <label className="block text-sm">질문 세트<select className="mt-2" value={draft.questionSetId} onChange={(event) => setDraft({ ...draft, questionSetId: Number(event.target.value) })}>{sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>}
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">질문 소스<input className="mt-2" required maxLength={120} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder="직접 입력, 검색, 고객 인터뷰" /></label><label className="text-sm">검색 의도<input className="mt-2" required maxLength={120} value={draft.intent} onChange={(event) => setDraft({ ...draft, intent: event.target.value })} placeholder="정보 탐색형, 비교형" /></label><label className="text-sm">고객 세그먼트<input className="mt-2" required maxLength={120} value={draft.segment} onChange={(event) => setDraft({ ...draft, segment: event.target.value })} placeholder="전체, B2B 마케터" /></label><label className="text-sm">구매 여정<input className="mt-2" required maxLength={120} value={draft.journeyStage} onChange={(event) => setDraft({ ...draft, journeyStage: event.target.value })} placeholder="탐색, 고려, 결정" /></label></div>
      </form>}
    </DetailDrawer>

    <ConfirmDialog open={Boolean(deleteQuestionTarget)} title="질문을 삭제할까요?" description={deleteQuestionTarget?.text} confirmLabel="질문 삭제" destructive busy={busy} onClose={() => setDeleteQuestionTarget(null)} onConfirm={removeQuestion} />
    <ConfirmDialog open={Boolean(deleteSetTarget)} title="질문 세트를 삭제할까요?" description={deleteSetTarget && <><strong className="text-white">{deleteSetTarget.name}</strong>의 질문 {deleteSetTarget.questionCount}개가 함께 삭제됩니다.</>} requiredText={deleteSetTarget?.name} confirmLabel="세트와 질문 삭제" destructive busy={busy} onClose={() => setDeleteSetTarget(null)} onConfirm={removeSet} />
  </>;
}
