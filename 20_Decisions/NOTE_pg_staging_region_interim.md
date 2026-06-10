# Sponsor Note — Interim Managed PostgreSQL Staging Region
Date: 2026-06-10 · Author: Project Sponsor (recorded via sponsor instruction)

Interim managed-PostgreSQL **staging** region: **AWS me-south-1 (Bahrain)**.

- This is an interim staging/provisioning unblocker only: it satisfies the PG-region
  item gating the staging checklist in `16_Deployment/environment_plan.md` §3 and the
  WP-00 A5 carve-out (`build_progress_register.md`).
- The **final production region may be revisited before production launch** — the
  data-residency check for KSA/Gulf customer PII + health data (DEC-011 [NC]) remains
  open as a pre-production item; it is tracked toward the Phase 6 deployment-hardening
  gate, not silently closed by this note.
