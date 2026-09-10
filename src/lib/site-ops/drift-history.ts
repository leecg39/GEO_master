import { getDatabase } from "@/lib/db";
import type { SeoDriftComparison, StoredDriftEvent } from "@/lib/seo/drift";

/** Caller owns the change set and wraps this and its state update in one transaction. */
export function persistDriftEvents(projectId: number, campaignId: number, changeId: number, comparison: SeoDriftComparison, now: string) {
  const { sqlite } = getDatabase();
  const insert = sqlite.prepare(`INSERT INTO seo_drift_events
    (project_id,campaign_id,change_set_id,baseline_snapshot_id,current_snapshot_id,
     field,classification,approved_change,before_value,after_value,expected_value,rule_id,rule_version,detail,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(change_set_id,current_snapshot_id,field,rule_version) DO NOTHING`);
  for (const event of comparison.events) insert.run(projectId, campaignId, changeId,
    comparison.baselineSnapshotId, comparison.currentSnapshotId, event.field, event.classification,
    event.approvedChange ? 1 : 0, event.before, event.after, event.expectedValue, event.ruleId, event.ruleVersion, event.detail, now);
}

export function loadDriftEvents(projectId: number, campaignId: number, changeId: number): StoredDriftEvent[] {
  const rows = getDatabase().sqlite.prepare(`SELECT id,baseline_snapshot_id AS baselineSnapshotId,current_snapshot_id AS currentSnapshotId,
    field,classification,approved_change AS approvedChange,before_value AS before,after_value AS after,expected_value AS expectedValue,
    rule_id AS ruleId,rule_version AS ruleVersion,detail,created_at AS createdAt
    FROM seo_drift_events WHERE project_id=? AND campaign_id=? AND change_set_id=? ORDER BY id DESC LIMIT 200`)
    .all(projectId, campaignId, changeId) as Array<Omit<StoredDriftEvent, "approvedChange"> & { approvedChange: number }>;
  return rows.map((row) => ({ ...row, approvedChange: Boolean(row.approvedChange) }));
}
