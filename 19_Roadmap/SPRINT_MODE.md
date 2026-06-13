# SPRINT_MODE — Nutrezee OS Agent execution modes

**Purpose:** the authoritative catalog of the six execution modes and the autonomous sprint loop. Extends and harmonizes the original `03_EXECUTION_MODES.md` (older naming: Discovery / Single WP / Sprint Build / QA Hardening / Release Readiness) — where they differ, the six modes below are canonical. Companion: `AUTO_EXECUTION_RULES.md` (decision logic), `NEXT_ACTION_QUEUE.md` (what's next).

The default for `Continue Nutrezee OS Agent` is **Sprint Mode** unless the queue's top item names a different mode (e.g. a deploy item → Deployment Mode).

---

## The six modes

| Mode | When | May write | Entry condition | Exit |
|---|---|---|---|---|
| **Review Mode** | Audits, status/gap questions, coverage matrices, code review of a diff | docs only (registers, `22_Meeting_Notes/`, analysis files under `19_Roadmap/`) | a question or audit ask | findings reported with Verified/Inferred/Assumed/NC labels + file:line evidence; no code |
| **Build Mode** | One reviewed unit (WP / queue item), human checkpoint wanted | `app/`, `db/migrations/`, `docker/`, `.github/`, admin SPA — on the unit's branch | gate ✅ for the unit's DoD | unit DONE + merged + register updated → **stop and report** |
| **Sprint Mode** | Maximum safe throughput; chain eligible units without asking between them | same as Build, across multiple units | gate ✅; ≥1 eligible queue item | no eligible unit remains, or a stop condition (`AUTO_EXECUTION_RULES.md` §E) |
| **Fix Mode** | A defect found in shipped/staged code (the D1–D7 pattern; a failing suite; a review must-fix) | the minimal fix on a `fix/<slug>` branch + its regression test | a named defect with repro/evidence | fix + regression test green in CI + deployed if it was a staging defect → register run-log note |
| **Deployment Mode** | Push merged `main` to staging and verify | staging only (via `nutrezee-vps` MCP: rsync repo → `compose build` → `up -d`); `docker/` config; never app logic | `main` green; deploy item at queue top | smoke/Playwright green on staging + register run-log entry |
| **UAT Mode** | Pre-pilot hardening + real-staff acceptance (maps to `phase_6_master_prompt.md`) | test artifacts, defect notes, training records; fixes ride Fix Mode | WP-01..14 + WP-UI DONE; workshop pack landed | UAT pass per persona + pilot exit review; **no production action before DEC-013 signed** |

**Mode selection quick rule:** question/audit → Review · one reviewed step → Build · "build as far as gates allow" → Sprint · "this is broken" → Fix · "put it on staging" → Deployment · "get to pilot/go-live" → UAT.

---

## The autonomous Sprint loop

```
┌─ START ─────────────────────────────────────────────────────────────┐
│ AUTO_EXECUTION_RULES §A: git status → pull → read registers +        │
│ blockers + assumptions + NEXT_ACTION_QUEUE → detect frontier → gate. │
└─────────────────────────────┬───────────────────────────────────────┘
                              ▼
        ┌──────────  pick next unit (§B decision tree)  ──────────┐
        │  blocked-by-sponsor? → next engineering item            │
        │  API missing & blocks UI? → build API first             │
        │  API exists & UI missing? → build UI                    │
        │  staging blocked? → docs/checklists, not idle           │
        │  business answer missing? → apply + log assumption (§D) │
        └─────────────────────────────┬───────────────────────────┘
                                      ▼
   restate scope → implement (scope-only, binding constraints, no re-arch)
                                      ▼
   run unit DoD suites + CI 14 jobs → adversarial review of the diff
                                      ▼
        green? ──no──► Fix Mode (fix + regression) ──┐
          │ yes                                       │
          ▼                                           │
   commit → merge (or PR if main push gated) → push ◄─┘
                                      ▼
   update build_progress_register (row + run log) + rewrite NEXT_ACTION_QUEUE
                                      ▼
        more eligible units & no stop condition? ──yes──► (loop back to "pick next unit")
          │ no
          ▼
   END: emit the mandatory SESSION REPORT (AUTO_EXECUTION_RULES §F)
```

---

## Sprint guardrails (non-negotiable inside the loop)

- **One unit per branch, atomic.** Loss from a dead session is bounded to one unit; the branch + register row reconstruct it.
- **Never weaken a test or gate** to keep moving. Red = not done. Placeholder ≠ verified.
- **Never build dormant modules** beyond `not_enabled` stubs (dispatch M09, drivers M10, cart/checkout M06, refunds, WhatsApp webhook, customer notifications) and never the deferred legacy modules (`NEXT_ACTION_QUEUE.md` Deferred list) without a new amendment.
- **Never touch Phases 1–4** except register/status/amendment writes. **Never** commit secrets, touch production, or write to the legacy system (bridge is read-only).
- **Commit + push after every completed unit** — the register is durable memory, not the conversation.
- **Do not ask between eligible units.** Asking is reserved for the genuine stop conditions (`AUTO_EXECUTION_RULES.md` §E).

---

## Current frontier (verify live each session)

Engineering critical path: **WP-API-01 → WP-UI-02 → WP-UI-03 → WP-UI-04** (`NEXT_ACTION_QUEUE.md`). Sprint Mode starting today picks up **WP-API-01** (size S, no blockers). Sponsor-owned parallel track (legacy access + workshop pack) gates the finish at WP-14 but blocks none of the engineering frontier.
