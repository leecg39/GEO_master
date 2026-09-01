# Full-stack CRUD contract

This document is the implementation contract for CRUD work across all 12 GEO Master menu pages.

## Resource semantics

- Mutable resources (`projects`, question sets/questions, schedules, strategy items, llms.txt documents, report presets, workspace backups) support create, list/detail read, full-field update, and confirmed delete.
- Evidence resources (audits, measurement runs/results, multimodal audits, generated studio outputs) keep generated evidence immutable. Update is limited to user metadata or a new content revision; delete removes the resource under the documented FK policy.
- Derived views (dashboard metrics and rendered JSON/CSV/PDF reports) are read-only projections. CRUD applies to their source resources and saved presets, never to calculated values.

## Project scope

- `projects` is the canonical brand profile source.
- `settings.active_project_id` selects the current project; provider credentials and model defaults remain global.
- Every project-owned list/detail/mutation verifies that the row belongs to the requested or active project.
- A project with dependent data returns `409 PROJECT_HAS_DEPENDENCIES` and dependency counts unless the explicit cascade confirmation contract is satisfied.
- The active/last project cannot be deleted without a safe replacement.

## HTTP and response contract

- Collection: `GET` list, `POST` create.
- Item: `GET` detail, `PATCH` update, `DELETE` delete.
- Successful create returns `201`; reads/updates return `200`; successful bodyless delete returns `204`.
- Collection response: `{ "items": [...], "page": { "nextCursor": string | null, "hasMore": boolean } }`.
- Existing action endpoints may remain when the operation is not CRUD (run, validate, export, restore, cancel, retry).
- All mutation bodies are strict JSON validated with Zod. IDs are positive safe integers.
- List `limit` defaults to 20 and is bounded to 1–100. Ordering is stable by `(created_at DESC, id DESC)` and cursors encode both fields.

## Errors and concurrency

- Errors keep the existing `{ error, code, issues? }` shape.
- Validation: `422`; missing row: `404`; ownership or state conflict: `409`; cross-origin/JSON guards: existing `403`/`415` behavior.
- Mutable rows expose `updatedAt`. PATCH requests include `expectedUpdatedAt`; stale writes return `409 STALE_WRITE` with no partial update.
- Expensive/external create actions accept a client request ID and return the existing resource for an identical retry rather than issuing a duplicate billable call.

## Deletion and transactions

- `audit_items` cascade with an audit; `measure_results` cascade with a run; content revisions cascade with content.
- Deleting a run leaves `measurement_jobs.run_id` null so automation history remains readable.
- Multi-row writes/deletes, project cascade, workspace import/restore, and migration steps are SQLite transactions.
- Destructive UI actions require an accessible confirmation dialog; project cascade/replace/restore require explicit typed or checkbox confirmation.

## Security and limits

- Public settings and every CRUD response exclude plaintext API keys and encrypted secret columns.
- Stored job/content payloads never include API keys.
- Audit, multimodal, and remote llms.txt actions keep public-URL, DNS rebinding, MIME, redirect, timeout, and size protections.
- User JSON/text fields have explicit size limits. Upstream error bodies are not returned.
- Workspace schema upgrades preserve API keys and exclude workspace backup payloads from their own snapshots.

## Verification gate

Each resource must have tests for create, list, detail, full allowed update, delete, reload persistence, invalid input, not found, project isolation, stale update, and FK policy. Final acceptance also requires migration fixtures, secret scans, full Vitest/typecheck/lint/build, real HTTP smoke tests on a temporary DB, and desktop/375px browser CRUD checks for all menu pages.
