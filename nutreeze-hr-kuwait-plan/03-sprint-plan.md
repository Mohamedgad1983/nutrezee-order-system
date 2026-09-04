# 03 — Sprint Plan (sprint by sprint)

2-week sprints (Sprint 0 = 1 week). Story IDs map to [04-backlog.md](04-backlog.md). Each sprint ends with a **demo on staging** and meets the **DoD** in [01](01-architecture-and-standards.md)/[06](06-risks-and-decisions.md).

Legend: 🎯 goal · 📦 deliverables · ✅ acceptance · ⛔ dependencies

---

## Sprint 0 — Foundations & Discovery  (Wk 1) · Phase 0
🎯 Working HR install, scaffolded app, and Kuwait statutory settings safely tracked as confirmed or owner-dated pending.
**Execution status 2026-06-18:** Engineering foundation deployed on staging. HRMS and `nutreeze_hr` are installed on both sites; the single **HR** workspace policy is active; `Kuwait HR Settings` is deployed with `PENDING_SME` blockers; `Kuwait WPS Export` shell is blocked by design; `Kuwait Payroll Readiness` report is live. SME/bank discovery remains pending for statutory acceptance.
**Stories:** HR-001, HR-002, HR-003, HR-004, HR-005, HR-010
**Tasks**
- Install `hrms` v16: `bench get-app hrms` → `bench --site <staging> install-app hrms`; verify desk HR workspace loads.
- Scaffold `nutreeze_hr` app (`bench new-app`), git repo, hooks, fixtures dir, CI skeleton.
- Create payroll prerequisites: company defaults, fiscal year, Payroll Payable + salary-expense accounts, Default Employee Advance Account.
- Verify KWD (3-dec) + Arabic/RTL under HR doctypes.
- Confirm workspace visibility: only standard **HR** appears for HR roles; no standalone `nutreeze_hr` desktop icon; employees do not see the full HR workspace.
- Confirm expected HR workspace contents for HR roles: Employees/Organization, Attendance/Shifts, Leave, Payroll, Kuwait payroll tools, Payslips/Self-Service, and Reports.
- Create configurable `PENDING_SME` settings shells for PIFSS, gratuity, WPS, leave, and overtime per [SPEC.md](SPEC.md).
- **SME discovery workshop** → fill [05-kuwait-compliance-spec.md](05-kuwait-compliance-spec.md): PIFSS rates/ceiling, gratuity tiers (termination vs resignation), WPS file spec + the company's bank, Kuwait holidays, leave entitlements, standard salary components.
✅ HR reachable on staging for HR roles with expected sections; employee self-service boundary verified; `nutreeze_hr` installs+migrates clean; pending statutory settings are blocked from live payroll/WPS; **Requirements Spec approved by SME or pending items have owners and dates**.
📦 Installed HR; app skeleton in git+CI; requirements spec with confirmed values or owner-dated pending values; live-use blockers in place. → **M0**
⛔ SME availability and the company's bank WPS specification block statutory acceptance/live use, but not safe foundation work.

## Sprint 1 — Core Payroll Config  (Wk 2–3) · Phase 1
🎯 Salary engine configured for Kuwait (config/fixtures only).
**Execution status 2026-06-18:** Partially started safely. Employee custom fields, employee document uploads, sick-leave medical certificate attachment, and KWD salary components are deployed. A draft/inactive `Nutrezee Kuwait Payroll Template - PENDING SME` exists on the site with company data. GL account mapping, real salary assignments, test employees, and a submitted payroll run remain pending.
**Stories:** HR-011, HR-012, HR-013, HR-014
**Tasks**
- Custom fields on Employee: `civil_id`, `iban`, `bank_code`, `nationality`/`is_kuwaiti`, `pifss_number`, `arabic_full_name` (fixtures).
- Salary Components: Basic + Housing + Transport (+ others per spec), each with GL account.
- Kuwait Salary Structure + assignment process; seed Kuwaiti + expat test employees.
- Export fixtures; write fixture-migration test.
✅ Test employee → correct Salary Slip in KWD via Payroll Entry; accrual JE posts to GL; fixtures reinstall on a fresh site.
📦 Employee custom fields, components, structure (all fixtures) + seeded test data. → **M1**
⛔ Spec from Sprint 0.

## Sprint 2 — PIFSS + Gratuity  (Wk 4–5) · Phase 2
🎯 Kuwait social security + end-of-service computed correctly.
**Stories:** HR-020, HR-021, HR-022, HR-023
**Tasks**
- PIFSS employee-share deduction component (formula + `is_kuwaiti` condition) + employer-share component; map GL liability accounts.
- Configure Kuwait **Gratuity Rule** (tiers) + validate Gratuity computation on sample exits (1/3/5/10-yr, termination vs resignation).
- Unit tests asserting PIFSS + gratuity == SME worked examples (to the fils).
✅ PIFSS & gratuity match SME examples exactly before compliance sign-off; mechanism tests may pass earlier with sample values only if marked non-official; values flow into Salary Slip & GL only after confirmed settings.
📦 PIFSS components, gratuity rule (fixtures), formula unit tests. → **M2**
⛔ Confirmed PIFSS rates/ceiling + gratuity tiers (SME).

## Sprint 3 — Bilingual Payslip  (Wk 6–7) · Phase 3  ← **MVP**
🎯 Professional Arabic/bilingual payslip.
**Stories:** HR-030, HR-031, HR-032
**Tasks**
- Print Format (RTL, Cairo/Amiri) — earnings/deductions/PIFSS/net, bilingual labels, KWD 3-dec; ship font in `public/fonts`.
- Validate PDF render (wkhtmltopdf patched-qt); employee self-service download for own payslip only.
- PO design review + tweaks.
✅ Payslip PDF renders correctly in Arabic for a real structure; PO accepts; **end-to-end payroll MVP demo** (run → statutory → payslip).
📦 Payslip print format + font + ESS access. → **M3 (MVP)**
⛔ Sprint 2 outputs.

## Sprint 4 — WPS Export  (Wk 8–9) · Phase 4
🎯 Generate the WPS salary file in the bank's format.
**Stories:** HR-040, HR-041, HR-042
**Tasks**
- WPS SIF generator (Report/Script): employer record + employee rows (Civil ID, IBAN, amount, days, deductions) per bank spec.
- Pre-payroll validation: block/flag employees missing Civil ID/IBAN.
- Byte-level compare against the bank's sample file; iterate to exact match.
✅ Generated WPS file passes the bank's validation on a sample batch (SME/bank-confirmed).
📦 WPS report + validation hook + format doc. → **M4**
⛔ Bank WPS spec + sample file.

## Sprint 5 — Attendance, Leave & Operations  (Wk 10–11) · Phase 5
🎯 Time & attendance for restaurant/central kitchen.
**Stories:** HR-050, HR-051, HR-052, HR-053
**Tasks**
- Shift Types (kitchen/branch) + check-in/out (mobile + geolocation) + overtime rules.
- Leave types/policies per Kuwait law; Kuwait Holiday List; leave→payroll (LOP) linkage.
- Attendance → payroll working-days/overtime wiring.
✅ Full monthly cycle (attendance → leave → payroll) correct for the test team.
📦 Shift/attendance/leave/holiday config (fixtures). → **M5**
⛔ Leave-law params (SME); device/geolocation policy (PO).

## Sprint 6 — Reporting, Reconciliation & API  (Wk 12–13) · Phase 6
🎯 Visibility + integration readiness.
**Stories:** HR-060, HR-061, HR-062, HR-063
**Tasks**
- Payroll register, PIFSS report, gratuity-liability report, salary-cost-by-department.
- **GL reconciliation report** (payroll totals == GL postings).
- Confirm the final HR Reports area includes Payroll Register, Salary Register, Attendance Report, Leave Balance Report, PIFSS Report, Gratuity Liability Report, WPS Export/History if persisted, and GL Reconciliation Report.
- Verify + document REST API for HR doctypes (Employee, Salary Slip, Attendance…) for a future custom frontend, with explicit HR vs employee vs future payroll-finance permissions.
✅ Reports reconcile to GL; API access tested & documented.
📦 Reports + reconciliation + API doc. → **M6**
⛔ Sprints 2–4 data.

## Sprint 7 — UAT, Compliance Sign-off & Parallel Run  (Wk 14–15) · Phase 7
🎯 Prove correctness with real data.
**Stories:** HR-070, HR-071, HR-072
**Tasks**
- Load real employees; run payroll **in parallel** with the current process for ≥1 cycle.
- SME signs off PIFSS/gratuity/WPS/payslip; PO signs off UAT; log & fix discrepancies.
- Finalize runbook + training material.
✅ Parallel run matches the current process; **SME + PO sign-off** recorded.
📦 UAT report, sign-off, runbook. → **M7**
⛔ Real employee data; SME + PO time.

## Sprint 8 — Go-live & Hypercare  (Wk 16) · Phase 8
🎯 Production cutover + support.
**Stories:** HR-080, HR-081, HR-082
**Tasks**
- Deploy fixtures to prod tenant (`bench migrate`); run first **live** payroll supervised; submit WPS.
- Train HR users; publish runbook; document any approved accountant/payroll-finance handoff; 2-week hypercare; capture backlog for v2.
✅ First live payroll + WPS submitted successfully; handover complete.
📦 Live system, trained users, hypercare log. → **M8 (Go-live)**
⛔ Go/no-go from PO + SME.

---

### Capacity note (team lead)
Plan assumes 1 Tech Lead (part-time review) + 1–2 Frappe devs + QA, with the SME available for discovery (S0), validation (S2/S4), and sign-off (S7). If only 1 dev, Sprints 5–6 may extend by a sprint. Re-baseline at each sprint planning.
