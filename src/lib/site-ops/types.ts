import type { SeoAnalysis } from "@/lib/seo/contracts";
import type { SeoDriftComparison, StoredDriftEvent } from "@/lib/seo/drift";

export const PAGE_TYPES = [
  "WebPage",
  "WebSite",
  "Product",
  "Organization",
  "BlogPosting",
  "BreadcrumbList",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];
export type Editor = "qshop_site" | "qshop_blog" | "generic";
export const EDITOR_LABELS: Record<Editor, string> = {
  qshop_site: "큐샵 기존 사이트",
  qshop_blog: "큐샵 신형 블로그",
  generic: "일반 사이트",
};
export type ChangeField =
  | "title"
  | "description"
  | "canonical"
  | "ogImage"
  | "robots"
  | "jsonLd";
export const FIELD_LABELS: Record<ChangeField, string> = {
  title: "페이지 제목",
  description: "검색 설명",
  canonical: "대표 URL",
  ogImage: "메타 이미지",
  robots: "검색 색인 정책",
  jsonLd: "구조화 데이터",
};
export interface PageMetadata {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  robots: string;
  jsonLd: Record<string, unknown>[];
  jsonLdErrors: number;
  pageType: PageType;
  heading: string;
  bodyText: string;
  bodyHash: string;
  robotsHeader: string;
}
export interface PageRule {
  code: string;
  category: "technical" | "recommendation" | "experimental";
  passed: boolean;
  detail: string;
  version: string;
}
export interface PageSnapshot {
  id: number;
  projectId: number;
  campaignId: number;
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  contentType: string | null;
  fetchState: "fetched" | "failed";
  dataState: "live" | "mock" | "error";
  renderMode: "native_fetch" | "mock";
  capturedAt: string | null;
  contentHash: string | null;
  revisionHash: string | null;
  responseMs: number | null;
  bytes: number | null;
  metadata: PageMetadata | null;
  rules: PageRule[];
  parserVersion: string;
  errorCode: string | null;
  responseHeaders: Record<string, string>;
  /** Null on pre-v14 snapshots; never infer v2 findings from historical booleans. */
  analysis: SeoAnalysis | null;
}
export interface ChangeItem {
  field: ChangeField;
  before: string;
  after: string;
  reason: string;
  evidence: string;
}
export interface ChangeSet {
  id: number;
  snapshotId: number;
  status:
    | "draft"
    | "approved"
    | "delivered"
    | "verification_pending"
    | "verified"
    | "conflict"
    | "failed";
  editor: Editor;
  approvedBy: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChangeItem[];
  driftEvents: StoredDriftEvent[];
  verification: {
    message?: string;
    fields?: Record<string, boolean>;
    snapshotId?: number;
    drift?: SeoDriftComparison;
  };
}
