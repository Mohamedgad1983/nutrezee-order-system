# 17 — A53: no cap on batch label count

Date: 2026-09-04 · Owner: "شيل أي ضوابط على موضوع عدد معين من الطباعة".

The only count control in the label path was `MAX_BATCH_LABELS = 500` in `LabelService.buildCandidateBatch`
(`batch_limit_exceeded`). Removed: a batch may now contain the whole day (Saturday 2026-09-05 = 695 orders).
Reprints were already unlimited (A48). No other numeric limit exists in the extension or API label routes
(Partner page size 1000 is a fetch page, not a print limit).

## Staging deploy (Verified 2026-09-04)

PR #66 CI 29/29 → merged `db78824`; `nutrezee-api:a53-c6acf63` running (no migration), admin nginx restarted,
`/health` 200 public, `/nz/health` 200; deployed bundle no longer contains `batch_limit_exceeded`.
Rollback `nutrezee-api:a51-01ede1e`.
