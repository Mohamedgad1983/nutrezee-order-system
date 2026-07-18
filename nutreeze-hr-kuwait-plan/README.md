# Nutreeze HR — Kuwait Localization on ERPNext v16

**Owner:** Tech Lead (Software Engineering)
**Status:** Implementation in progress — HRMS installed; Sprint 0 foundation and part of Sprint 1 scaffold deployed on staging
**Last updated:** 2026-06-18

> **In one line:** An engineering plan to deliver a Kuwait-compliant HR & Payroll system on
> ERPNext v16 using **Frappe HR** + a custom `nutreeze_hr` app — Kuwaiti Dinar, Arabic,
> PIFSS, end-of-service gratuity, and WPS export — **with no changes to ERPNext/Frappe core**,
> organized phase by phase and sprint by sprint.

---

## 1. Goal
Stand up **Frappe HR** on the existing ERPNext v16 bench and deliver a **Kuwait-compliant HR & Payroll** system through a dedicated custom app `nutreeze_hr`, covering:
- Kuwaiti Dinar (KWD, 3-decimal) payroll
- Arabic / bilingual UI and payslips
- PIFSS social-security contributions (Kuwaiti nationals)
- End-of-service gratuity per Kuwait Labour Law
- WPS (Wage Protection System) salary file export
- Attendance, shifts, leave, holidays for a restaurant / central-kitchen workforce

…with **zero changes to ERPNext / Frappe / HRMS core** (upgrade-safe) and **multi-tenant** delivery (every tenant site inherits the same localization via fixtures).

## 2. Scope
**In scope**
- `nutreeze_hr` custom app (config + fixtures + a small amount of code for WPS export & payslip).
- Salary structure/components, PIFSS, gratuity rule, custom fields, Arabic payslip, WPS file, attendance/leave config, payroll→GL reconciliation, basic HR reporting, REST API exposure for a future frontend.
- Standard **HR** desktop workspace only. The custom app is a technical implementation layer and must not create a separate desktop icon/workspace.

**Out of scope (for now)**
- Replacing the ERPNext desk UI (tracked separately in the frontend roadmap).
- Non-Kuwait jurisdictions.
- Editing ERPNext/Frappe/HRMS core (forbidden).
- Legal/accounting *authority* — statutory parameters are **provided & signed off by a Kuwait payroll SME**, not invented by engineering.

## 3. System context
- **Backend:** ERPNext v16 + Frappe HR (`hrms`) v16 on the same Frappe bench (VPS, runs as `frappe`).
- **Customization layer:** `nutreeze_hr` app (new) — holds all fixtures, print formats, reports, scripts.
- **Tenants:** `erp.13-140-159-201.sslip.io` (tenant 1), `client1.…` (tenant 2); fixtures apply per-site on `bench migrate`.
- Currency/Arabic already configured system-wide.
- **Desktop UX:** only the standard **HR** icon appears. HR staff see HR. Employees use self-service access only. Finance/accounting access is added later as narrow payroll/WPS/GL access, not full HR.

## 3.1 Current execution status
Verified on the VPS Frappe bench on 2026-06-18:

| Area | Status |
|---|---|
| HRMS app | Installed on `erp.13-140-159-201.sslip.io` and `client1.13-140-159-201.sslip.io` |
| `nutreeze_hr` app | Installed on both sites; latest local app commits include `9f242bf`, `cf79837`, `6b80331`, `4fa203c` |
| Desktop policy | One top-level **HR** workspace only; HR child workspaces nested inside it; HR indicator color green |
| Kuwait settings | `Kuwait HR Settings` single DocType deployed with `PENDING_SME` status for PIFSS, gratuity, WPS, leave, and overtime |
| Employee data | Nutreeze Kuwait payroll custom fields added to Employee: Arabic full name, Civil ID, nationality, Kuwaiti flag, PIFSS number, bank code, WPS employee reference |
| Employee documents | Upload table added on Employee for Civil ID front/back, passport, personal photo, residency/work permit, contracts, certificates, medical reports, and other documents |
| Sick leave evidence | Medical certificate attachment fields added to Leave Application |
| Payroll scaffold | KWD salary components added; statutory components are disabled placeholders; `Nutrezee Kuwait Payroll Template - PENDING SME` draft/inactive template created where company data exists |
| WPS | `Kuwait WPS Export` report shell deployed and intentionally blocked until bank format is signed off |
| Readiness report | `Kuwait Payroll Readiness` report deployed for HR data cleanup |
| Runtime guards | `Payroll Entry` and `Salary Slip` submit paths blocked while settings remain `PENDING_SME` |
| Tests | `nutreeze_hr` foundation/document tests passed on staging: 4/4 |

Not complete yet: official PIFSS formulas, gratuity formulas, final WPS file generation, leave/overtime statutory configuration, Arabic payslip, GL reconciliation, UAT, parallel run, and live payroll.

## 4. Team & roles
| Role | Responsibility |
|---|---|
| **Tech Lead** | Architecture, code review, sprint planning, DoD enforcement, risk owner |
| **Frappe Developer(s)** (1–2) | Build app, fixtures, print formats, WPS report, tests |
| **QA** | Test payroll runs, payslip/WPS validation, regression, UAT support |
| **Kuwait Payroll SME** (external/advisory) | Provides & signs off statutory params: PIFSS rates/ceilings, gratuity tiers, WPS bank format, leave law |
| **Product Owner** (business / Nutreeze) | Priorities, salary policy, employee data, UAT acceptance, go-live sign-off |
| **Accountant / Finance** (later, limited) | Reviews payroll totals/GL, handles bank payment or WPS upload if approved; no default access to employee master HR data |

## 5. Ways of working
- **Sprints:** 2 weeks (Sprint 0 is a 1-week foundation sprint).
- **Ceremonies:** sprint planning, daily async standup, sprint review/demo on staging, retro.
- **Definition of Ready (DoR):** story has clear acceptance criteria, dependencies identified, statutory inputs (if any) confirmed by SME.
- **Definition of Done (DoD):** see [06](06-risks-and-decisions.md) & [01](01-architecture-and-standards.md) — code in `nutreeze_hr` as fixtures, **no core edits**, tests green, peer-reviewed, demoed on staging, docs updated; compliance items additionally require **SME sign-off**.
- **Environments:** `dev` (local/bench) → `staging` (current VPS tenant) → `prod` (go-live tenant). No statutory output goes live without SME sign-off + a parallel run.

## 6. Documents in this plan
| File | What it covers |
|---|---|
| [SPEC.md](SPEC.md) | Build-now / confirm-later execution contract for starting safely before all statutory details are signed off |
| [01-architecture-and-standards.md](01-architecture-and-standards.md) | Technical approach, app structure, branching/CI, testing, config-vs-code policy |
| [02-roadmap-phases.md](02-roadmap-phases.md) | Phases 0–5, milestones, MVP, timeline |
| [03-sprint-plan.md](03-sprint-plan.md) | **Sprint-by-sprint** goals, stories, acceptance, deliverables |
| [04-backlog.md](04-backlog.md) | Epics → user stories with estimates & priorities |
| [05-kuwait-compliance-spec.md](05-kuwait-compliance-spec.md) | Kuwait statutory requirements, implementation & sign-off gates |
| [06-risks-and-decisions.md](06-risks-and-decisions.md) | Risk register, open decisions, dependencies, assumptions |

## 7. High-level timeline (relative; absolute dates set at kickoff)
```
Sprint 0  (Wk 1)      Foundations & discovery
Sprint 1  (Wk 2–3)    Core payroll config (KWD/Arabic, components, structures)
Sprint 2  (Wk 4–5)    PIFSS + gratuity rule + GL mapping
Sprint 3  (Wk 6–7)    Arabic/bilingual payslip      ── MVP payroll demo ──
Sprint 4  (Wk 8–9)    WPS file export
Sprint 5  (Wk 10–11)  Attendance, shifts, leave, holidays, overtime
Sprint 6  (Wk 12–13)  Reporting, GL reconciliation, API
Sprint 7  (Wk 14–15)  UAT + compliance sign-off + parallel run
Sprint 8  (Wk 16)     Go-live + training + hypercare
```
~16 weeks to full go-live; **usable payroll MVP by end of Sprint 3.**
