# 02 — Roadmap (Phases)

Nine phases (Phase 0–8), each mapped to one sprint, with a clear **goal**, **exit criteria**, and a **milestone** (see [03](03-sprint-plan.md)).

> Statutory parameters (PIFSS rates, gratuity tiers, WPS format) are **inputs from the Kuwait SME**, gathered in Phase 0 and signed off before they're hardcoded. Engineering builds the *mechanism*; the SME owns the *numbers*.
> Per [SPEC.md](SPEC.md), engineering may begin with configurable placeholders and dry-run/sample tests, but live statutory payroll/WPS is blocked until SME/bank sign-off.

---

## Phase 0 — Foundations & Discovery  · `Sprint 0`
**Goal:** A working HR install, a scaffolded app, and a Kuwait requirements tracker with confirmed values or owner-dated pending values.
- Install `hrms` v16 alongside ERPNext on the bench; verify on staging tenant.
- Scaffold `nutreeze_hr` app + git repo + CI skeleton.
- Confirm desktop policy: only the standard **HR** workspace/icon appears; no standalone custom HR/payroll icon.
- Confirm expected HR workspace contents: Employees, Attendance/Shifts, Leave, Payroll, Kuwait payroll tools, Payslips/Self-Service, and Reports are reachable for the right roles.
- Create the build-now / confirm-later settings shell for PIFSS, gratuity, WPS, leave, and overtime, with pending values clearly marked.
- Create the Company / payroll prerequisites (fiscal year, payroll payable & expense accounts).
- **Discovery:** SME collects PIFSS rates/ceiling, gratuity tiers (employer-termination vs resignation), WPS file spec (from the company's bank), Kuwait public-holiday list, leave entitlements, standard salary components.
- Confirm KWD (3-dec) + Arabic/RTL still correct under HR.

**Exit criteria:** HR reachable on staging for HR roles with the expected workspace contents; employees do not see full HR; `nutreeze_hr` installs cleanly; pending statutory settings are represented safely; **Kuwait Requirements Spec ([05](05-kuwait-compliance-spec.md)) filled or explicitly marked pending with owners/dates**.
**Milestone: M0 — "HR up + statutory settings safely tracked".**

## Phase 1 — Core Payroll Configuration (Kuwait)  · `Sprint 1`
**Goal:** Salary engine configured for Kuwait, as fixtures.
- Custom fields on Employee (Civil ID, IBAN, bank code, nationality/is-Kuwaiti, PIFSS no., Arabic name).
- Salary Components: Basic + allowances (housing, transport…) with GL accounts.
- Kuwait Salary Structure(s) + Salary Structure Assignment workflow.
- Seed test employees (Kuwaiti + expat) for dry runs.

**Exit criteria:** A test employee gets a correct Salary Slip in KWD (3-dec) via Payroll Entry; accrual JE posts to GL.
**Milestone: M1 — "Basic payroll runs in KWD".**

## Phase 2 — Statutory Calculations (PIFSS + Gratuity)  · `Sprint 2`
**Goal:** Kuwait social security + end-of-service computed correctly.
- PIFSS employee-share **deduction** component (formula + nationality condition) + employer-share component.
- Kuwait **Gratuity Rule** (tiers) + Gratuity computation validated on sample exits.
- GL account mapping for PIFSS & gratuity liabilities.
- Unit tests for the formulas vs. SME-provided worked examples.

**Exit criteria:** PIFSS & gratuity match SME's worked examples to the fils; tests green.
**Milestone: M2 — "Statutory math correct".**

## Phase 3 — Bilingual Payslip  · `Sprint 3`
**Goal:** A professional Arabic / bilingual payslip.
- Print Format (RTL, Cairo/Amiri font) showing earnings/deductions/PIFSS/net in Arabic + English, KWD 3-dec.
- PDF render verified (wkhtmltopdf patched-qt already installed).
- Employee self-service can view/download their own payslip without exposing the full HR workspace.

**Exit criteria:** Payslip PDF renders correctly in Arabic for a real salary structure; PO accepts the design.
**Milestone: M3 — "Payroll MVP" (run payroll + statutory + branded payslip end-to-end).** ✅ first business-usable slice.

## Phase 4 — WPS Export  · `Sprint 4`
**Goal:** Generate the Wage Protection System salary file in the bank's format.
- Report/Script that builds the WPS **SIF** from a submitted Payroll Entry (employer record + employee rows: Civil ID, IBAN, amount, days…).
- Pre-payroll validation (block run if Civil ID/IBAN missing).
- Byte-level validation against the bank's sample file.

**Exit criteria:** Generated WPS file passes the bank's format validation on a sample batch (SME/bank-confirmed).
**Milestone: M4 — "WPS file accepted".**

## Phase 5 — Attendance, Leave & Operations  · `Sprint 5`
**Goal:** Time & attendance fit for a restaurant/central kitchen.
- Shift Types (kitchen/branch shifts), check-in/out (mobile + geolocation), overtime.
- Leave types & policies per Kuwait law; Kuwait Holiday List; leave→payroll linkage.
- Attendance → payroll (working days / LOP / overtime) wired.

**Exit criteria:** A monthly cycle (attendance → leave → payroll) runs correctly for the test team.
**Milestone: M5 — "Full monthly cycle works".**

## Phase 6 — Reporting, Reconciliation & API  · `Sprint 6`
**Goal:** Visibility + integration readiness.
- Payroll register, PIFSS report, gratuity-liability report, salary cost by department.
- **GL reconciliation report** (payroll totals == GL postings).
- Confirm/document REST API access to HR doctypes for a future custom frontend, including role boundaries for HR, employee self-service, and future payroll-finance users.

**Exit criteria:** Reports match GL; API access documented & tested.
**Milestone: M6 — "Reporting & reconciled".**

## Phase 7 — UAT, Compliance Sign-off & Parallel Run  · `Sprint 7`
**Goal:** Prove correctness with real data before go-live.
- Load real employees; run payroll in **parallel** with the current process for ≥1 cycle.
- SME signs off PIFSS, gratuity, WPS, payslip; PO signs off UAT.
- Fix discrepancies; finalize runbook & training material.

**Exit criteria:** Parallel run matches; **SME + PO sign-off obtained**.
**Milestone: M7 — "Compliance signed off".**

## Phase 8 — Go-live & Hypercare  · `Sprint 8`
**Goal:** Production cutover + support.
- Deploy fixtures to prod tenant; run first live payroll under supervision.
- Train HR users; publish runbook; 2-week hypercare.

**Exit criteria:** First live payroll + WPS submitted successfully; handover complete.
**Milestone: M8 — "Go-live ✅".**

---

### MVP marker
**End of Phase 3 (Sprint 3)** = a usable payroll MVP: run payroll in KWD, with PIFSS + gratuity, and a branded Arabic payslip. WPS, attendance, and reporting harden it afterward.
