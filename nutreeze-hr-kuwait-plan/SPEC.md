# SPEC — Build-Now / Confirm-Later Contract

**Status:** Execution spec
**Project:** Nutreeze HR Kuwait localization on ERPNext v16
**App:** `nutreeze_hr`
**Rule:** Build mechanisms now; load official Kuwait values later. No statutory value is hardcoded without SME/bank sign-off.

**Execution note 2026-06-18:** The build-now shell is now deployed on staging: settings, employee fields, placeholder salary components, WPS/export blocker, payroll submit blocker, readiness report, and tests. Official statutory output remains blocked until SME/bank sign-off.

---

## 1. Purpose
This spec allows engineering to start implementation before every Kuwait statutory detail is final, while keeping the system safe and compliant.

We can build:
- Frappe HR installation and role setup.
- The `nutreeze_hr` technical app.
- Standard HR workspace visibility.
- Employee fields, payroll structures, reports, validation hooks, print formats, and export mechanisms.
- Configuration slots for Kuwait-specific values.

We cannot mark statutory payroll as complete, run live payroll, or generate final WPS output until official values are signed off.

## 2. Build now
These items do not require final legal numbers and can start immediately:

| Area | Can build now |
|---|---|
| App foundation | `nutreeze_hr`, hooks, fixtures, CI, fresh-site install/migrate test |
| HR workspace | Standard **HR** icon only, no custom desktop icon, HR-role visibility, employee self-service boundary |
| Employee data | Civil ID, IBAN, bank code, PIFSS number, Arabic full name, nationality/is-Kuwaiti fields |
| Employee documents | Upload/storage mechanism for Civil ID front/back, passport, personal photo, residency/work permit, contracts, certificates, medical reports, and other employee documents |
| Leave evidence | Medical certificate upload for sick leave / medical leave applications |
| Payroll basics | Salary Component, Salary Structure, Salary Structure Assignment, Payroll Entry dry run, Salary Slip layout |
| Generic mechanisms | PIFSS formula engine with configurable rates/ceilings, gratuity rule adapter, WPS exporter interface, validation hooks |
| Reports shell | Payroll register, PIFSS report, gratuity liability report, WPS export/history shell, GL reconciliation report |
| Tests | Mechanism tests using clearly marked sample values; official acceptance tests added after SME/bank values arrive |

## 3. Confirm later
These are intentionally left as configuration inputs until the owner signs off:

| Item | Owner | Required before |
|---|---|---|
| PIFSS employee/employer rates | SME | PIFSS acceptance / payroll MVP sign-off |
| PIFSS salary ceiling and applicable earning basis | SME | PIFSS acceptance / payroll MVP sign-off |
| PIFSS rounding rule | SME | PIFSS acceptance / payroll MVP sign-off |
| Gratuity tiers, caps, resignation reductions | SME | Gratuity acceptance / payroll MVP sign-off |
| Gratuity wage basis | SME | Gratuity acceptance / payroll MVP sign-off |
| WPS exact bank file format | Bank + SME | WPS export completion |
| WPS sample valid file | Bank + SME | WPS byte-level validation |
| Annual leave / sick leave / maternity rules | SME + PO | Leave configuration completion |
| Overtime / Ramadan / weekly rest rules | SME + PO | Attendance/overtime payroll completion |

## 4. Configuration slots
Engineering must create configuration surfaces instead of hardcoding values.

| Config slot | Example fields |
|---|---|
| PIFSS settings | employee rate, employer rate, salary ceiling, applicable components, rounding mode, effective date |
| Gratuity settings | rule name, wage basis, service-year slabs, cap, resignation reduction table, effective date |
| WPS settings | bank name, employer ID/MOL number, delimiter/fixed-width mode, encoding, header fields, employee row fields, file naming |
| Leave settings | annual leave entitlement, accrual policy, sick leave tiers, maternity/other statutory leave, holiday list year |
| Overtime settings | standard hours, overtime multipliers, Ramadan hours, weekly rest day rules |

Until official values are signed off, settings may exist with `PENDING_SME` status and must be blocked from live payroll/WPS use.

## 5. Runtime gates
The system must enforce these gates:

1. Payroll can run in demo/dry-run mode with sample values only when clearly marked as non-statutory.
2. Submitted payroll with statutory deductions is blocked if PIFSS/gratuity settings are `PENDING_SME`.
3. WPS export is blocked if bank format or required employee fields are incomplete.
4. Employee self-service never exposes the full HR workspace.
5. Accountant/finance access is off by default and only enabled through an approved limited role.
6. Go-live is blocked until SME signs off PIFSS, gratuity, WPS, leave, and overtime rules relevant to the first live payroll.

## 6. Testing approach
Use two classes of tests:

| Test class | Purpose |
|---|---|
| Mechanism tests | Prove formulas, validation hooks, exports, reports, and permissions behave correctly using sample values marked non-official |
| Acceptance tests | Prove output matches SME/bank worked examples and valid files exactly |

Mechanism tests can be written immediately. Acceptance tests are added as soon as official examples are provided.

## 7. Execution order
Start in this order:

1. Install Frappe HR and verify the standard HR workspace.
2. Scaffold `nutreeze_hr`.
3. Add Employee custom fields and role visibility checks.
4. Add configurable payroll/PIFSS/gratuity/WPS settings shells.
5. Add dry-run payroll and payslip flow.
6. Add validation gates so pending settings cannot be used for live output.
7. Fill official values from SME/bank and convert tests from sample to acceptance.

## 8. Definition of safe progress
Work is safe to continue while statutory values are pending if:

- No official-looking statutory output is generated from sample values.
- Pending values are visibly marked `PENDING_SME`.
- Live payroll/WPS paths are blocked until sign-off.
- The plan and compliance spec show which values remain unconfirmed.

If any item cannot be built without choosing a legal/business value, stop that item and continue only with unrelated safe work.
