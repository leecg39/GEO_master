import { compareSeoSnapshots, fieldValue } from "@/lib/seo/drift";
import { equalSeoValue as equal } from "@/lib/seo/normalize";
import { loadDriftEvents, persistDriftEvents } from "./drift-history";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertExpectedUpdatedAt } from "@/lib/crud";
import { requireActiveProject } from "@/lib/projects";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { ownedCampaign } from "@/lib/semforge/siteaudit";
import { isSamePublicSite, normalizePublicUrl } from "@/lib/url-security";
import { buildQshopDelivery } from "@/lib/integrations/qshop-manual";
import {
  capturePage,
  getSnapshot,
  latestSnapshots,
  persistSnapshot,
} from "./snapshots";
import {
  generateStructuredData,
  validateStructuredData,
} from "./structured-data";
import {
  PAGE_TYPES,
  type ChangeField,
  type ChangeItem,
  type ChangeSet,
  type Editor,
  type PageMetadata,
} from "./types";

const id = z.coerce.number().int().positive();
const timestamp = z.string().min(1).max(64);
const editorSchema = z.enum(["qshop_site", "qshop_blog", "generic"]);
const fieldSchema = z.enum([
  "title",
  "description",
  "canonical",
  "ogImage",
  "robots",
  "jsonLd",
]);
export const siteOpsActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("connection"),
      campaignId: id,
      editor: editorSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("capture"),
      campaignId: id,
      url: z.string().url().max(2048),
    })
    .strict(),
  z
    .object({
      action: z.literal("schema"),
      campaignId: id,
      snapshotId: id,
      type: z.enum(PAGE_TYPES),
    })
    .strict(),
  z
    .object({
      action: z.literal("draft"),
      campaignId: id,
      snapshotId: id,
      items: z
        .array(
          z
            .object({
              field: fieldSchema,
              after: z.string().max(30_000),
              reason: z.string().trim().min(1).max(1000),
            })
            .strict(),
        )
        .min(1)
        .max(6),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      campaignId: id,
      changeId: id,
      expectedUpdatedAt: timestamp,
      approvedBy: z.string().trim().min(1).max(120),
      policyConfirmed: z.boolean().optional().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("deliver"),
      campaignId: id,
      changeId: id,
      expectedUpdatedAt: timestamp,
    })
    .strict(),
  z
    .object({
      action: z.literal("verify"),
      campaignId: id,
      changeId: id,
      expectedUpdatedAt: timestamp,
    })
    .strict(),
]);
type Connection = {
  editor: Editor;
  origin: string;
  ownership: string;
  capabilities: string[];
};
function connection(campaignId: number): Connection {
  const campaign = ownedCampaign(campaignId);
  const row = getDatabase()
    .sqlite.prepare(
      "SELECT editor,origin,ownership,capabilities FROM site_connections WHERE campaign_id=? AND project_id=?",
    )
    .get(campaignId, campaign.projectId) as
    | (Omit<Connection, "capabilities"> & { capabilities: string })
    | undefined;
  return row
    ? { ...row, capabilities: JSON.parse(row.capabilities) }
    : {
        editor: "qshop_site",
        origin: `https://${campaign.domain}`,
        ownership: "unverified",
        capabilities: ["public_read", "manual_delivery"],
      };
}
export function getChangeSet(changeId: number, campaignId: number): ChangeSet {
  const campaign = ownedCampaign(campaignId);
  const row = getDatabase()
    .sqlite.prepare(
      `SELECT id,snapshot_id AS snapshotId,status,editor,approved_by AS approvedBy,approved_at AS approvedAt,
    delivered_at AS deliveredAt,verified_at AS verifiedAt,created_at AS createdAt,updated_at AS updatedAt,verification
    FROM change_sets WHERE id=? AND campaign_id=? AND project_id=?`,
    )
    .get(changeId, campaignId, campaign.projectId) as
    | (Omit<ChangeSet, "items" | "verification" | "driftEvents"> & { verification: string })
    | undefined;
  if (!row)
    throw new AppError(
      "활성 프로젝트의 변경안을 찾을 수 없습니다.",
      404,
      "CHANGE_NOT_FOUND",
    );
  const items = getDatabase()
    .sqlite.prepare(
      "SELECT field,before_value AS before,after_value AS after,reason,evidence FROM change_items WHERE change_set_id=? ORDER BY id",
    )
    .all(changeId) as ChangeItem[];
  return { ...row, items, verification: JSON.parse(row.verification), driftEvents: loadDriftEvents(campaign.projectId, campaignId, changeId) };
}
export function getSiteOpsWorkspace(campaignId: number) {
  const campaign = ownedCampaign(campaignId);
  const changes = (
    getDatabase()
      .sqlite.prepare(
        "SELECT id FROM change_sets WHERE project_id=? AND campaign_id=? ORDER BY id DESC LIMIT 50",
      )
      .all(campaign.projectId, campaignId) as { id: number }[]
  ).map((row) => getChangeSet(row.id, campaignId));
  return {
    connection: connection(campaignId),
    snapshots: latestSnapshots(campaignId, campaign.projectId),
    changes,
  };
}
export { fieldValue } from "@/lib/seo/drift";
function validateItem(
  field: ChangeField,
  after: string,
  page: PageMetadata,
  url: string,
) {
  if (field === "jsonLd") {
    validateStructuredData(after, page, url);
    return;
  }
  if (
    after.length >
    (field === "description" ? 500 : field === "title" ? 200 : 2048)
  )
    throw new AppError(
      "필드의 최대 길이를 초과했습니다.",
      422,
      "FIELD_TOO_LONG",
    );
  if (field === "title" && !after.trim())
    throw new AppError(
      "페이지 제목을 비울 수 없습니다.",
      422,
      "TITLE_REQUIRED",
    );
  if (field === "canonical" || field === "ogImage") {
    if (!after) return;
    const target = normalizePublicUrl(after);
    if (field === "canonical" && !isSamePublicSite(target, new URL(url).origin))
      throw new AppError(
        "대표 URL은 연결된 사이트 안에서 지정하세요.",
        422,
        "SITE_SCOPE_MISMATCH",
      );
  }
  if (
    field === "robots" &&
    !/^(?:(?:index|noindex|follow|nofollow|noarchive|nosnippet|none|all)(?:\s*,\s*|\s+|$))*$/i.test(
      after,
    )
  )
    throw new AppError(
      "지원하는 robots 지시어를 쉼표로 구분해 입력하세요.",
      422,
      "ROBOTS_INVALID",
    );
}
const nextTime = (old: string) =>
  new Date(Math.max(Date.now(), Date.parse(old) + 1)).toISOString();

export async function performSiteOps(input: unknown, signal?: AbortSignal) {
  requireSemforgeSubscription();
  const action = siteOpsActionSchema.parse(input);
  const campaign = ownedCampaign(action.campaignId);
  const { sqlite } = getDatabase();
  const profile = connection(campaign.id);
  if (action.action === "connection") {
    sqlite
      .prepare(
        `INSERT INTO site_connections (project_id,campaign_id,origin,editor,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(campaign_id) DO UPDATE SET editor=excluded.editor,updated_at=excluded.updated_at`,
      )
      .run(
        campaign.projectId,
        campaign.id,
        profile.origin,
        action.editor,
        new Date().toISOString(),
      );
    return { connection: connection(campaign.id) };
  }
  if (action.action === "capture") {
    const target = normalizePublicUrl(action.url);
    if (!isSamePublicSite(target, profile.origin))
      throw new AppError(
        "캠페인에 등록한 도메인의 HTTPS URL을 입력하세요.",
        422,
        "SITE_SCOPE_MISMATCH",
      );
    const pages = sqlite
      .prepare(
        "SELECT DISTINCT url FROM page_snapshots WHERE campaign_id=? AND project_id=?",
      )
      .all(campaign.id, campaign.projectId) as { url: string }[];
    if (
      pages.length >= 50 &&
      !pages.some((page) => page.url === target.toString())
    )
      throw new AppError(
        "캠페인당 직접 수집은 50개 URL까지 지원합니다.",
        422,
        "PAGE_LIMIT",
      );
    const capture = await capturePage(
      campaign.projectId,
      campaign.id,
      target.toString(),
      profile.origin,
      signal,
    );
    requireActiveProject(campaign.projectId);
    return { snapshot: persistSnapshot(capture) };
  }
  if (action.action === "draft" || action.action === "schema") {
    const snapshot = getSnapshot(action.snapshotId, campaign.projectId);
    if (snapshot.campaignId !== campaign.id)
      throw new AppError(
        "다른 캠페인의 근거입니다.",
        409,
        "SNAPSHOT_SCOPE_MISMATCH",
      );
    if (
      snapshot.dataState !== "live" ||
      !snapshot.metadata ||
      snapshot.fetchState !== "fetched"
    )
      throw new AppError(
        "실제 HTML 수집에 성공한 페이지가 필요합니다.",
        422,
        "LIVE_EVIDENCE_REQUIRED",
      );
    const url = snapshot.finalUrl ?? snapshot.url;
    if (action.action === "schema")
      return generateStructuredData(snapshot.metadata, url, action.type);
    if (
      new Set(action.items.map((item) => item.field)).size !==
      action.items.length
    )
      throw new AppError(
        "같은 필드를 중복 수정할 수 없습니다.",
        422,
        "DUPLICATE_FIELD",
      );
    const items = action.items.filter(
      (item) =>
        !equal(
          item.field,
          fieldValue(snapshot.metadata!, item.field),
          item.after,
        ),
    );
    if (!items.length)
      throw new AppError(
        "현재 값과 다른 수정안을 입력하세요.",
        422,
        "NO_CHANGES",
      );
    for (const item of items)
      validateItem(item.field, item.after, snapshot.metadata, url);
    return sqlite.transaction(() => {
      const now = new Date().toISOString();
      const result = sqlite
        .prepare(
          `INSERT INTO change_sets (project_id,campaign_id,snapshot_id,status,editor,created_at,updated_at)
        VALUES (?,?,?,'draft',?,?,?)`,
        )
        .run(
          campaign.projectId,
          campaign.id,
          snapshot.id,
          profile.editor,
          now,
          now,
        );
      const changeId = Number(result.lastInsertRowid);
      for (const item of items)
        sqlite
          .prepare(
            "INSERT INTO change_items (change_set_id,field,before_value,after_value,reason,evidence) VALUES (?,?,?,?,?,?)",
          )
          .run(
            changeId,
            item.field,
            fieldValue(snapshot.metadata!, item.field),
            item.after,
            item.reason,
            JSON.stringify({
              url,
              capturedAt: snapshot.capturedAt,
              contentHash: snapshot.contentHash,
              quote:
                snapshot.metadata!.heading ||
                snapshot.metadata!.bodyText.slice(0, 500),
              parserVersion: snapshot.parserVersion,
            }),
          );
      return { change: getChangeSet(changeId, campaign.id) };
    })();
  }
  const change = getChangeSet(action.changeId, campaign.id);
  assertExpectedUpdatedAt(change.updatedAt, action.expectedUpdatedAt);
  const base = getSnapshot(change.snapshotId, campaign.projectId);
  if (!base.metadata)
    throw new AppError(
      "변경안의 원본 근거가 없습니다.",
      422,
      "EVIDENCE_MISSING",
    );
  if (action.action === "approve") {
    if (change.status !== "draft")
      throw new AppError(
        "초안 상태에서만 승인할 수 있습니다.",
        409,
        "INVALID_CHANGE_STATE",
      );
    if (
      change.items.some((item) => item.field === "robots") &&
      !action.policyConfirmed
    )
      throw new AppError(
        "검색 색인 정책 변경을 별도로 확인해 주세요.",
        422,
        "POLICY_CONFIRMATION_REQUIRED",
      );
  } else if (action.action === "deliver") {
    if (!["approved", "delivered"].includes(change.status))
      throw new AppError(
        "승인한 변경안만 전달할 수 있습니다.",
        409,
        "APPROVAL_REQUIRED",
      );
  } else if (
    !["delivered", "verification_pending", "failed", "verified"].includes(
      change.status,
    ) ||
    !change.deliveredAt || !change.approvedAt
  ) {
    throw new AppError(
      "전달한 변경안만 재검증할 수 있습니다.",
      409,
      "DELIVERY_REQUIRED",
    );
  }
  // Approval and delivery both re-read the public URL, detecting external edits before handoff.
  const capture = await capturePage(
    campaign.projectId,
    campaign.id,
    base.url,
    profile.origin,
    signal,
  );
  requireActiveProject(campaign.projectId);
  return sqlite.transaction(() => {
    const current = getChangeSet(change.id, campaign.id);
    assertExpectedUpdatedAt(current.updatedAt, action.expectedUpdatedAt);
    const remote = persistSnapshot(capture);
    const now = nextTime(change.updatedAt);
    let status: ChangeSet["status"] = change.status;
    let message = "";
    let fields: Record<string, boolean> = {};
    let drift: ReturnType<typeof compareSeoSnapshots> | undefined;
    if (action.action === "verify") {
      drift = compareSeoSnapshots(base, remote, change.items, change.approvedAt);
      fields = drift.fields;
      persistDriftEvents(campaign.projectId, campaign.id, change.id, drift, now);
    }
    if (!remote.metadata || remote.fetchState !== "fetched") {
      status = action.action === "verify" ? "failed" : change.status;
      message = `공개 페이지 수집 실패 (${remote.errorCode ?? "미확인"}). 재시도하세요.`;
    } else if (action.action !== "verify") {
      if (remote.revisionHash !== base.revisionHash || remote.finalUrl !== base.finalUrl) {
        status = "conflict";
        message =
          "원본 페이지가 변경되었습니다. 최신 수집 근거로 새 변경안을 만들어 재승인하세요.";
      } else if (action.action === "approve") {
        status = "approved";
        message = "원본이 유지되고 있음을 확인하고 승인했습니다.";
      } else {
        status = "delivered";
        message =
          "수동 적용 안내를 준비했습니다. 공개 URL에서 반영 여부를 재검증하세요.";
      }
    } else {
      const compared = drift!;
      status = !compared.comparable
        ? "failed"
        : compared.counts.unexpected
          ? "conflict"
          : change.items.length > 0 && Object.values(fields).every(Boolean)
            ? "verified"
            : "verification_pending";
      message = !compared.comparable
        ? compared.events.find((event) => event.classification === "unknown")?.detail ?? "비교할 근거가 부족합니다."
        : status === "conflict"
          ? "승인 범위 밖의 변경이 발견되었습니다. 변경 이력을 확인하고 최신 근거로 재승인하세요."
          : status === "verified"
            ? "공개 HTML의 대상 필드가 승인한 수정안과 일치합니다."
            : "일부 대상 필드가 아직 원본 값입니다. 게시 후 다시 확인하세요.";
    }
    sqlite
      .prepare(
        `UPDATE change_sets SET status=?,verification=?,verification_snapshot_id=?,
      approved_by=?,approved_at=?,delivered_at=?,verified_at=?,updated_at=? WHERE id=?`,
      )
      .run(
        status,
        JSON.stringify({ message, fields, snapshotId: remote.id, ...(drift ? { drift } : {}) }),
        remote.id,
        action.action === "approve" && status === "approved"
          ? action.approvedBy
          : change.approvedBy,
        action.action === "approve" && status === "approved"
          ? now
          : change.approvedAt,
        action.action === "deliver" && status === "delivered"
          ? (change.deliveredAt ?? now)
          : change.deliveredAt,
        status === "verified" ? now : null,
        now,
        change.id,
      );
    const updated = getChangeSet(change.id, campaign.id);
    return {
      change: updated,
      ...(action.action === "deliver" &&
      status === "delivered" &&
      remote.fetchState === "fetched"
        ? { delivery: buildQshopDelivery(updated, base) }
        : {}),
    };
  })();
}
