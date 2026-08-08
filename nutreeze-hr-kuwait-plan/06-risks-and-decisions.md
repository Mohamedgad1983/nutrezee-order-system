# 06 — Risks, Decisions, Dependencies & Definition of Done

## 1. Definition of Done (DoD)
A story is **Done** when:
1. Implemented in `nutreeze_hr` as **fixtures** (or documented hook/report code) — **no ERPNext/Frappe/HRMS core edits**.
2. Fixtures re-export cleanly and reinstall on a **fresh site** (`install-app` + `migrate`).
3. Tests pass (unit + relevant integration); CI green.
4. Peer-reviewed (PR approved by Tech Lead).
5. Demoed on **staging**.
6. Docs/runbook updated.
7. **Compliance stories additionally:** values match SME worked examples **and SME has signed off**.

## 2. Risk register
| # | Risk | Impact | Likelihood | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Wrong statutory params (PIFSS/gratuity) → incorrect pay & legal exposure | High | Med | SME provides & signs off all numbers; unit tests vs worked examples; parallel run before go-live | SME/TL |
| R2 | WPS bank format varies / undocumented → file rejected | High | Med | Get exact spec + sample file from the bank in Sprint 0; byte-level validation in Sprint 4 | SME/ENG |
| R3 | SME unavailable → discovery & sign-off stall | High | Med | Book SME time up front (S0, S2, S4, S7); spec gate blocks build of unconfirmed items | TL/PO |
| R4 | Temptation to patch core for an edge case | High | Low | Architecture rule + review; find hook/override or raise a decision instead | TL |
| R5 | ERPNext/HRMS upgrade breaks customizations | Med | Low | All in custom app; run validation suite post-upgrade | ENG |
| R6 | Scope creep (rebuilding admin screens, extra modules) | Med | Med | Backlog discipline; P1 vs P2/P3; out-of-scope list in README | TL/PO |
| R7 | Real employee data quality (missing Civil ID/IBAN) → WPS/payroll errors | Med | High | Pre-payroll validation (HR-041); data-cleanup task before parallel run | PO/QA |
| R8 | Third-party Kuwait app considered but immature/unsupported on v16 | Med | Med | Evaluate (license/support/v16) before adopting; default to building in-house | TL |
| R9 | Multi-tenant drift (fixtures not applied to a tenant) | Low | Low | `bench migrate` in deploy checklist for every tenant; CI fresh-site test | ENG |
| R10 | HR workspace or sensitive payroll data exposed to non-HR users | High | Med | Only standard HR workspace for HR roles; employees use self-service; accountant access is narrow payroll-finance only when approved; role tests in CI/UAT | TL/QA |
| R11 | Sample statutory values accidentally treated as official | High | Med | `PENDING_SME` status, live payroll/WPS blockers, sample-value labels, SME/bank acceptance tests before sign-off | TL/QA |

## 3. Open decisions (decide before/at the noted sprint)
| # | Decision | Options | Owner | Needed by |
|---|---|---|---|---|
| D1 | Build in-house **vs** adopt a third-party Kuwait localization app | (a) build `nutreeze_hr` (full control, upgrade-safe) (b) buy regional app (faster, depends on vendor) | PO + TL | Sprint 0 |
| D2 | App naming + desktop icon policy | dedicated `nutreeze_hr` technical app; standard **HR** workspace only; no separate Nutreeze/Kuwait/payroll desktop icon | TL | Sprint 0 |
| D3 | "Wage" basis for PIFSS & gratuity | basic only vs basic+allowances (per law/SME) | SME | Sprint 0/2 |
| D4 | WPS submission | manual upload to bank portal vs automated SFTP | PO + ENG | Sprint 4 |
| D5 | Persist generated WPS files? | add a "WPS Batch" doctype vs on-demand download | TL | Sprint 4 |
| D6 | Attendance capture | mobile geolocation check-in vs biometric device integration | PO | Sprint 5 |
| D7 | Go-live cutover | big-bang vs parallel-run-then-switch (recommended) | PO + TL | Sprint 7 |
| D8 | Accountant payroll access | no default access vs limited payroll-finance role for submitted payroll, WPS, salary payment, and GL reconciliation | PO + TL | Sprint 4/6 |
| D9 | Pending statutory implementation strategy | build mechanisms now with `PENDING_SME` config vs wait for every value before coding | TL | Sprint 0 |

## 4. Dependencies (external)
- **Kuwait Payroll SME** — statutory params + sign-off (critical path).
- **The company's bank** — WPS file spec + sample (blocks Sprint 4).
- **Business / PO** — salary policy, employee master data, UAT acceptance.
- **PIFSS / Ministry of Labour** — authoritative rates & rules (via SME).

## 5. Assumptions
- ERPNext v16 + Accounts module already live on the bench (✅ true).
- KWD + Arabic already configured system-wide (✅ true).
- Frappe HR v16 is compatible & installable on this bench (✅ confirmed by research — coordinated v16 release).
- Workforce size is SMB-scale (restaurant/central kitchen) — REST API & payroll performance are not a concern at this scale (revisit if it grows).
- One legal entity / company per tenant initially.

## 6. Decision log (append sign-offs here)
| Date | Decision / sign-off | By |
|---|---|---|
| 2026-06-17 | Plan created; KWD + Arabic confirmed already configured | Tech Lead |
| 2026-06-17 | D2: custom app name is `nutreeze_hr`; ERPNext desktop shows only the standard HR workspace/icon, with no separate custom HR/payroll icon | Tech Lead |
| 2026-06-17 | HR visibility policy: HR roles see HR; employees use self-service only; accountant/payroll-finance access is deferred and must be limited if enabled | Tech Lead / PO direction |
| 2026-06-17 | D9: start implementation with configurable `PENDING_SME` statutory settings; block live payroll/WPS until SME/bank sign-off | Tech Lead / PO direction |
| _… | C3 PIFSS params approved | SME (pending) |
| _… | C4 gratuity tiers approved | SME (pending) |
| _… | C5 WPS format approved | SME/Bank (pending) |
| _… | UAT acceptance | PO (pending) |
