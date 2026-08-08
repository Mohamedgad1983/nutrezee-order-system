# 01 — Architecture & Engineering Standards

## 1. Guiding principle: upgrade-safe customization
**Never modify ERPNext / Frappe / HRMS core.** Every change lives in a dedicated custom app, shipped as **fixtures** (and a little code for WPS/payslip). Core stays pristine so `bench update` to future v16.x / v17 is safe, and every tenant inherits the same localization via `bench migrate`.

## 2. The custom app: `nutreeze_hr`
A new Frappe app, separate from `mc_kitchen` (which stays for non-HR customizations) to keep concerns clean.

```
apps/nutreeze_hr/
  nutreeze_hr/
    hooks.py                     # fixtures registration, doc events, scheduler
    fixtures/                    # exported config (the heart of the localization)
      custom_field.json          # Employee/Salary fields (Civil ID, IBAN, Nationality, PIFSS no, Arabic name…)
      property_setter.json       # tweaks to existing fields
      salary_component.json      # Basic, allowances, PIFSS-Employee, PIFSS-Employer…
      salary_structure.json      # Kuwait salary structure(s)
      gratuity_rule.json         # Kuwait end-of-service rule
      print_format.json          # Arabic/bilingual payslip
      workflow.json / role.json  # approval workflows, HR roles (if needed)
    nutreeze_hr/
      report/                    # WPS SIF export (Query/Script Report)
      print_format/              # payslip template + Cairo/Amiri font assets
    public/fonts/                # Cairo / Amiri
    config/                      # desk module config
    patches.txt
```

**Policy — config vs. code:**
- **Prefer config (fixtures):** custom fields, property setters, salary components & formulas, salary structures, gratuity rules, print formats, leave/holiday/shift setup, workflows.
- **Code only where unavoidable:** WPS file generator (Report + Python), any payslip computation helpers, validation hooks (e.g. require Civil ID/IBAN before payroll). All via documented hooks/server scripts — never core edits.
- **Build-now / confirm-later:** implementation may start with configurable placeholders per [SPEC.md](SPEC.md), but statutory values remain blocked from live payroll/WPS until SME/bank sign-off.

**Desktop/workspace policy:**
- The ERPNext desktop shows only the standard **HR** workspace/icon for HR users.
- `nutreeze_hr` must not create a separate "Nutreeze HR", "Kuwait HR", or payroll desktop icon.
- Custom reports/pages such as WPS, PIFSS, gratuity, and Kuwait payroll tools live under the standard HR experience or are reachable by role/search.
- Employees do not get the HR workspace; they use Employee Self-Service for their own payslips, leave, and attendance.
- Accountants/finance users may later get narrow payroll-finance access for submitted Payroll Entries, WPS download/upload support, salary payment, and GL reconciliation, without default permission to edit Employee HR data.

**Expected HR workspace contents:**
The standard **HR** workspace should expose the operational HR/payroll surface for HR roles. Exact labels can follow Frappe HR defaults, but the user must be able to reach these areas from HR or search:

| Area | Expected contents |
|---|---|
| Employees & organization | Employee, Department, Designation, Branch/Location, Employment Type, Employee Grade, onboarding/offboarding if enabled |
| Attendance & shifts | Attendance, Employee Checkin, Shift Type, Shift Assignment, Holiday List, overtime configuration when enabled |
| Leave | Leave Application, Leave Allocation, Leave Type, Leave Policy, leave balances/reports |
| Payroll | Salary Component, Salary Structure, Salary Structure Assignment, Payroll Entry, Salary Slip, Additional Salary, Payroll Period, Payroll Settings |
| Kuwait payroll | Civil ID/IBAN/bank data validation, PIFSS components/report, Gratuity Rule/calculation/report, WPS Export, payroll-to-GL reconciliation |
| Payslips & self-service | HR can access payslips by permission; employees can view/download only their own payslip through Employee Self-Service |
| Reports | Payroll Register, Salary Register, Attendance Report, Leave Balance Report, PIFSS Report, Gratuity Liability Report, WPS Export/History if persisted, GL Reconciliation Report |

**Workspace visibility matrix:**

| User type | HR desktop visibility | Allowed intent |
|---|---|---|
| HR Manager / HR User | Sees **HR** | Manage employee master data, attendance/leave, payroll preparation, payslips, statutory HR reports |
| Employee | Does not see full **HR** | Use self-service for own payslip, leave, attendance/check-in where enabled |
| Accountant / Finance (later) | No default full **HR** | Limited submitted payroll review, WPS handling, salary payment, and GL reconciliation only if explicitly approved |

## 3. Data model strategy
- **Custom Fields on `Employee`:** `nationality` (or reuse existing), `is_gcc_national`/`is_kuwaiti`, `civil_id`, `iban`, `bank_code`, `pifss_number`, `arabic_full_name`. Shipped as `custom_field` fixtures.
- **Salary Components:** earnings (Basic, Housing, Transport…) + deductions (PIFSS employee share) + employer-cost component (PIFSS employer share) — each with formula/condition and mapped GL account.
- **Gratuity Rule:** ERPNext `Gratuity Rule` doctype configured with Kuwait tiers (slabs + fraction-of-applicable-earnings), referenced by the `Gratuity` doctype at exit.
- **No new business doctypes unless required** (e.g. a "WPS Batch" doctype may be added if we need to persist generated files — decision in [06](06-risks-and-decisions.md)).
- **Pending statutory settings:** PIFSS, gratuity, WPS, leave, and overtime settings can exist in a `PENDING_SME` state for development, but live statutory output must be blocked until confirmed.

## 4. Payroll → Accounting integration (uses ERPNext as-is)
- Salary components carry GL accounts; **bulk Payroll Entry** auto-creates the accrual Journal Entry (debit expense heads / credit Payroll Payable); Bank Entry settles cash. (Verified behavior — see research report.)
- **Engineering rule:** payroll must be run via **Payroll Entry (bulk)**, never slip-by-slip, so GL accrual posts automatically. Document & enforce in runbook.
- Reconciliation report (Sprint 6) proves payroll totals == GL postings.

## 5. Repo, branching & review
- `nutreeze_hr` in its own git repo (or a subdir under the bench's apps, version-controlled).
- **Branching:** `main` (deployable) ← short-lived `feature/HR-xxx-…` branches → PR → Tech Lead review → merge.
- **Commit/PR discipline:** reference story IDs (HR-xxx); no direct commits to `main`; no force-push to shared history.
- Fixtures are re-exported via `bench --site <site> export-fixtures --app nutreeze_hr` and committed.

## 6. CI / deployment
- **CI checks:** app installs cleanly on a fresh site; `bench migrate` applies fixtures without error; lint; unit tests; a **payroll dry-run smoke test** on seeded data.
- **Deploy flow:** merge → build → `bench --site <staging> migrate` → demo/QA → SME/PO sign-off → `bench --site <prod> migrate`.
- **Cache/assets:** `bench build` for any JS/CSS (payslip fonts); `clear-cache` + supervisor restart on deploy.

## 7. Testing strategy
| Layer | What | Tooling |
|---|---|---|
| Unit | PIFSS/gratuity formula helpers, WPS row formatting | Frappe test runner (pytest-style) |
| Integration | Run Payroll Entry on seeded employees → assert Salary Slip values, GL accrual JE | Frappe tests on a fresh site |
| Fixture/migration | Fresh site + `install-app nutreeze_hr` + `migrate` → all fixtures present | CI |
| Output validation | Payslip renders (PDF, Arabic/RTL); WPS file matches bank spec byte-for-byte on sample | QA + SME |
| UAT | Real employees, parallel run vs current process | PO + SME |

## 8. Security & permissions
- HR data is sensitive → rely on ERPNext **role permissions** (HR Manager / HR User / Employee Self-Service). The frontend/API enforce nothing extra; the server enforces everything.
- Workspace visibility is role-based: HR roles see **HR**; employees do not see HR and only access their own self-service documents.
- Civil ID / IBAN / salary masked per role; payslip access limited to the employee + HR.
- Accountant/finance access is not included by default. If enabled later, it is a limited payroll-finance role for submitted payroll, WPS handling, salary payment, and GL reconciliation only.
- Secrets (bank SFTP creds for WPS upload, if automated) never committed — env/site-config only.

## 9. Versioning & upgrade safety (the non-negotiable)
- All artifacts are fixtures/code in `nutreeze_hr`. After any ERPNext/HRMS upgrade: run the integration + output-validation suites; nothing should break because core was never patched.
- If a future requirement *seems* to need a core change, that's a **design smell** → find the hook/override path or raise a decision in [06](06-risks-and-decisions.md). Do not patch core.
