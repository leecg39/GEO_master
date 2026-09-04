"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FolderCog, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, EmptyState } from "@/components/ui";

interface Project {
  id: number;
  name: string;
  brandName: string;
  category: string;
  competitors: string[];
  competitorNotes: string;
  externalResearchNotes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Dependencies {
  questionSets: number;
  measurementRuns: number;
  measurementSchedules: number;
  measurementJobs: number;
  audits: number;
  contents: number;
  checklistStates: number;
  strategyItems: number;
  llmsDocuments: number;
  reportPresets: number;
}

interface ProjectsPage {
  items: Project[];
  page: { nextCursor: string | null; hasMore: boolean };
  activeProject: Project;
}

interface ProjectDraft {
  id?: number;
  name: string;
  brandName: string;
  category: string;
  competitors: string;
  competitorNotes: string;
  externalResearchNotes: string;
  activate: boolean;
  expectedUpdatedAt?: string;
}

interface ApiFailure extends Error {
  code?: string;
  details?: unknown;
}

const projectChangedEvent = "geo-master:project-changed";
const dependencyLabels: Record<keyof Dependencies, string> = {
  questionSets: "질문 세트",
  measurementRuns: "측정 실행",
  measurementSchedules: "예약 측정",
  measurementJobs: "자동화 작업",
  audits: "GEO 진단",
  contents: "콘텐츠",
  checklistStates: "체크리스트 상태",
  strategyItems: "전략 항목",
  llmsDocuments: "llms.txt 문서",
  reportPresets: "리포트 프리셋",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string; details?: unknown };
    const error = new Error(body.error || "요청을 처리하지 못했습니다.") as ApiFailure;
    error.code = body.code;
    error.details = body.details;
    throw error;
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

function emptyDraft(): ProjectDraft {
  return { name: "", brandName: "", category: "", competitors: "", competitorNotes: "", externalResearchNotes: "", activate: true };
}

function draftFor(project: Project): ProjectDraft {
  return {
    id: project.id,
    name: project.name,
    brandName: project.brandName,
    category: project.category,
    competitors: project.competitors.join(", "),
    competitorNotes: project.competitorNotes ?? "",
    externalResearchNotes: project.externalResearchNotes ?? "",
    activate: false,
    expectedUpdatedAt: project.updatedAt,
  };
}

function competitorList(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

export function ProjectSwitcher() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ project: Project; dependencies: Dependencies } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const collected: Project[] = [];
      let cursor: string | null = null;
      let active: Project | null = null;
      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const page = await api<ProjectsPage>(`/api/projects?${query}`);
        collected.push(...page.items);
        active = page.activeProject;
        cursor = page.page.hasMore ? page.page.nextCursor : null;
      } while (cursor);
      if (active && !collected.some((project) => project.id === active!.id)) collected.unshift(active);
      setProjects(collected);
      setActiveProject(active);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener(projectChangedEvent, refresh);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener(projectChangedEvent, refresh);
    };
  }, [load]);

  const announceChange = useCallback(() => {
    window.dispatchEvent(new Event(projectChangedEvent));
    router.refresh();
  }, [router]);

  const activate = async (id: number) => {
    if (id === activeProject?.id || busy) return;
    try {
      setBusy(true);
      setError("");
      await api<{ project: Project }>(`/api/projects/${id}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      announceChange();
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "프로젝트를 전환하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft || busy) return;
    try {
      setBusy(true);
      setError("");
      const fields = {
        name: draft.name,
        brandName: draft.brandName,
        category: draft.category,
        competitors: competitorList(draft.competitors),
        competitorNotes: draft.competitorNotes,
        externalResearchNotes: draft.externalResearchNotes,
      };
      if (draft.id) {
        await api<{ project: Project }>(`/api/projects/${draft.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...fields, expectedUpdatedAt: draft.expectedUpdatedAt }),
        });
      } else {
        await api<{ project: Project }>("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...fields, activate: draft.activate }),
        });
      }
      setDraft(null);
      announceChange();
    } catch (saveError) {
      const failure = saveError as ApiFailure;
      setError(failure.code === "STALE_WRITE" ? "다른 화면에서 프로젝트가 수정되었습니다. 목록을 새로 불러왔습니다." : failure.message);
      if (failure.code === "STALE_WRITE") {
        setDraft(null);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  const prepareDelete = async (project: Project) => {
    try {
      setBusy(true);
      setError("");
      const detail = await api<{ project: Project; dependencies: Dependencies }>(`/api/projects/${project.id}`);
      setDeleteTarget(detail);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "프로젝트 상세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget || busy) return;
    const replacement = projects.find((project) => project.id !== deleteTarget.project.id);
    try {
      setBusy(true);
      setError("");
      await api<void>(`/api/projects/${deleteTarget.project.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: deleteTarget.project.updatedAt,
          cascadeConfirmed: true,
          ...(deleteTarget.project.active && replacement ? { replacementProjectId: replacement.id } : {}),
        }),
      });
      setDeleteTarget(null);
      setDraft(null);
      announceChange();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "프로젝트를 삭제하지 못했습니다.");
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const deleteDependencies = useMemo(() => deleteTarget
    ? Object.entries(deleteTarget.dependencies).filter((entry): entry is [keyof Dependencies, number] => entry[1] > 0)
    : [], [deleteTarget]);
  const replacement = deleteTarget ? projects.find((project) => project.id !== deleteTarget.project.id) : undefined;

  return <>
    <section className="mt-5" aria-label="활성 프로젝트">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Project</span>
        {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-cyan-400" aria-label="프로젝트 불러오는 중" />}
      </div>
      <div className="flex gap-2">
        <select
          className="min-w-0 py-2 text-xs"
          aria-label="활성 프로젝트 선택"
          value={activeProject?.id ?? ""}
          disabled={loading || busy || !projects.length}
          onChange={(event) => void activate(Number(event.target.value))}
        >
          {!projects.length && <option value="">프로젝트 없음</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button type="button" onClick={() => setManagerOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-cyan-300" aria-label="프로젝트 관리">
          <FolderCog className="h-4 w-4" />
        </button>
      </div>
      {activeProject && <p className="mt-1.5 truncate text-[10px] text-slate-600">{activeProject.brandName || "브랜드 미설정"}</p>}
      {error && !managerOpen && <p role="alert" className="mt-1.5 text-[10px] leading-4 text-rose-300">{error}</p>}
    </section>

    <DetailDrawer
      open={managerOpen}
      title="프로젝트 관리"
      description="브랜드 프로필과 프로젝트별 데이터를 분리해 관리합니다."
      busy={busy}
      onClose={() => { setManagerOpen(false); setDraft(null); setError(""); }}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">총 {projects.length}개</p>
        <Button type="button" onClick={() => setDraft(emptyDraft())}><Plus className="h-4 w-4" />새 프로젝트</Button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {draft && <form className="mb-5 space-y-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="flex items-center justify-between"><h3 className="font-semibold text-white">{draft.id ? "프로젝트 수정" : "프로젝트 만들기"}</h3><button type="button" className="text-xs text-slate-500 hover:text-white" onClick={() => setDraft(null)}>닫기</button></div>
        <label className="block text-xs">프로젝트 이름<input className="mt-1.5" required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="block text-xs">브랜드 이름<input className="mt-1.5" maxLength={120} value={draft.brandName} onChange={(event) => setDraft({ ...draft, brandName: event.target.value })} /></label>
        <label className="block text-xs">카테고리<input className="mt-1.5" maxLength={120} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
        <label className="block text-xs">경쟁사 도메인/이름 <span className="text-slate-600">(쉼표 또는 줄바꿈 · RankSEO Easy-Win·SERP에서 손으로 옮긴 값)</span><textarea className="mt-1.5 min-h-24" maxLength={2500} value={draft.competitors} onChange={(event) => setDraft({ ...draft, competitors: event.target.value })} placeholder="예: competitor.com, 경쟁사 B" /></label>
        <label className="block text-xs">경쟁사 메모 <span className="text-slate-600">(선택 · Easy-Win·키워드 힌트)</span><textarea className="mt-1.5 min-h-20" maxLength={5000} value={draft.competitorNotes} onChange={(event) => setDraft({ ...draft, competitorNotes: event.target.value })} placeholder="RankSEO에서 본 Easy-Win·SERP 메모를 붙여 넣으세요" /></label>
        <label className="block text-xs">외부 연구 메모 <span className="text-slate-600">(선택)</span><textarea className="mt-1.5 min-h-20" maxLength={10000} value={draft.externalResearchNotes} onChange={(event) => setDraft({ ...draft, externalResearchNotes: event.target.value })} placeholder="Glippy 준비도·기타 외부 연구 인사이트" /></label>
        <p className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-[11px] leading-5 text-amber-200/80">RankSEO DA/DR·GEO 배지는 참고용입니다. 실인용·점유율은 /share 측정과 GenRank를 기준으로 하세요.</p>
        {!draft.id && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.activate} onChange={(event) => setDraft({ ...draft, activate: event.target.checked })} />생성 후 활성 프로젝트로 전환</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDraft(null)}>취소</Button><Button type="submit" disabled={busy || !draft.name.trim()}>{busy ? "저장 중…" : "저장"}</Button></div>
      </form>}

      <div className="space-y-3">
        {!loading && !projects.length && <EmptyState>프로젝트가 없습니다.</EmptyState>}
        {projects.map((project) => <article key={project.id} className="rounded-2xl border border-white/8 bg-slate-900/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-white">{project.name}</h3>{project.active && <Badge tone="cyan"><Check className="mr-1 h-3 w-3" />활성</Badge>}</div>
              <p className="mt-1 text-xs text-slate-500">{project.brandName || "브랜드 미설정"}{project.category ? ` · ${project.category}` : ""}</p>
              {project.competitors.length > 0 && <p className="mt-2 line-clamp-2 text-xs text-slate-600">경쟁사: {project.competitors.join(", ")}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              {!project.active && <button type="button" disabled={busy} onClick={() => void activate(project.id)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/10">전환</button>}
              <button type="button" disabled={busy} onClick={() => setDraft(draftFor(project))} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label={`${project.name} 수정`}><Pencil className="h-4 w-4" /></button>
              <button type="button" disabled={busy || projects.length <= 1} onClick={() => void prepareDelete(project)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-30" aria-label={`${project.name} 삭제`}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        </article>)}
      </div>
    </DetailDrawer>

    <ConfirmDialog
      open={Boolean(deleteTarget)}
      title="프로젝트를 영구 삭제할까요?"
      description={deleteTarget && <div className="space-y-2">
        <p><strong className="text-white">{deleteTarget.project.name}</strong> 프로젝트를 삭제합니다.</p>
        {deleteDependencies.length > 0
          ? <div><p className="text-rose-300">연결된 데이터도 함께 삭제됩니다.</p><ul className="mt-1 list-inside list-disc">{deleteDependencies.map(([key, count]) => <li key={key}>{dependencyLabels[key]} {count}개</li>)}</ul></div>
          : <p>연결된 프로젝트 데이터는 없습니다.</p>}
        {deleteTarget.project.active && replacement && <p>활성 프로젝트는 <strong className="text-cyan-300">{replacement.name}</strong>(으)로 전환됩니다.</p>}
      </div>}
      requiredText={deleteTarget?.project.name}
      confirmLabel="프로젝트 삭제"
      destructive
      busy={busy}
      onClose={() => setDeleteTarget(null)}
      onConfirm={remove}
    />
  </>;
}
