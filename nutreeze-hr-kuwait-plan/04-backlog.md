# 04 — Product Backlog (Epics → Stories)

Estimates in **story points (SP)** (Fibonacci). Priority: P1 (must, MVP) · P2 (should) · P3 (could).
Story IDs are referenced by the sprint plan ([03](03-sprint-plan.md)).

## Epic E1 — Foundations & Discovery
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-001 | Install Frappe HR v16 on the bench | `hrms` installed on staging; HR workspace loads; no core edits | 3 | P1 | 0 |
| HR-002 | Scaffold `nutreeze_hr` app + git + CI | App installs & migrates on a fresh site; CI runs; no standalone desktop workspace/icon is created | 3 | P1 | 0 |
| HR-003 | Payroll prerequisites (company/FY/GL accounts) | Payroll Payable, salary-expense, advance accounts exist | 2 | P1 | 0 |
| HR-004 | Verify standard HR workspace contents + role visibility | HR role can reach Employees/Organization, Attendance/Shifts, Leave, Payroll, Kuwait payroll placeholders/tools, Payslips/Self-Service, Reports; employee cannot see full HR | 2 | P1 | 0 |
| HR-005 | Build pending statutory settings shell | PIFSS/gratuity/WPS/leave/overtime settings exist as configurable placeholders; status `PENDING_SME` blocks live payroll/WPS | 3 | P1 | 0 |
| HR-010 | Kuwait Requirements Spec gathered or owner-dated pending | [05](05-kuwait-compliance-spec.md) filled where confirmed; pending PIFSS/gratuity/WPS/leave values have owners, due dates, and live-use blockers | 5 | P1 | 0 |

## Epic E2 — Core Payroll Configuration
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-011 | Employee custom fields (Civil ID, IBAN, nationality, PIFSS no., Arabic name) | Fields present as fixtures; reinstall on fresh site | 3 | P1 | 1 |
| HR-012 | Salary Components (Basic + allowances) with GL accounts | Components created; GL mapped | 3 | P1 | 1 |
| HR-013 | Kuwait Salary Structure + assignment | Structure assigns to employees; KWD 3-dec | 3 | P1 | 1 |
| HR-014 | Seed test employees (Kuwaiti + expat) + first Salary Slip | Slip generated via Payroll Entry; accrual JE posts | 2 | P1 | 1 |

## Epic E3 — Statutory Calculations (Kuwait)
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-020 | PIFSS employee-share deduction (Kuwaitis only) | Formula + nationality condition; matches SME example | 5 | P1 | 2 |
| HR-021 | PIFSS employer-share component + GL liability | Employer cost posts to correct GL | 3 | P1 | 2 |
| HR-022 | Kuwait end-of-service Gratuity Rule | Tiers per law; Gratuity computes on exit | 5 | P1 | 2 |
| HR-023 | Unit tests vs SME worked examples | Mechanism tests can use marked sample values; final PIFSS + gratuity acceptance tests match SME examples exact to the fils; CI green | 3 | P1 | 2 |

## Epic E4 — Bilingual Payslip
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-030 | Arabic/bilingual payslip Print Format (Cairo/Amiri) | RTL, bilingual labels, KWD 3-dec; renders PDF | 5 | P1 | 3 |
| HR-031 | Employee self-service payslip download | Employee can view/download own payslip only; employee does not see full HR workspace | 2 | P2 | 3 |
| HR-032 | PO design review & polish | PO accepts payslip design | 1 | P1 | 3 |

## Epic E5 — WPS Export
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-040 | WPS SIF generator (employer + employee rows) | File matches bank format on sample | 8 | P1 | 4 |
| HR-041 | Pre-payroll validation (Civil ID / IBAN required) | Run blocked/flagged if data missing | 3 | P1 | 4 |
| HR-042 | WPS format documentation | Format + field mapping documented | 2 | P2 | 4 |

## Epic E6 — Attendance, Leave & Operations
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-050 | Shift Types (kitchen/branch) + check-in/out + geolocation | Shifts defined; mobile check-in works | 5 | P2 | 5 |
| HR-051 | Leave types/policies per Kuwait law | Entitlements per spec; balances accrue | 3 | P2 | 5 |
| HR-052 | Kuwait Holiday List | Public holidays loaded; affects attendance/payroll | 2 | P2 | 5 |
| HR-053 | Attendance → payroll (working days / LOP / overtime) | Payroll reflects attendance & overtime | 5 | P2 | 5 |

## Epic E7 — Reporting, Reconciliation & API
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-060 | Payroll register + PIFSS + gratuity-liability reports | Reports produce correct totals and are reachable from HR Reports/search by permitted HR users | 5 | P2 | 6 |
| HR-061 | GL reconciliation report | Payroll totals == GL postings | 3 | P1 | 6 |
| HR-062 | Salary cost by department | Cost breakdown correct | 2 | P3 | 6 |
| HR-063 | REST API access for HR doctypes (documented) | API CRUD verified for Employee/Salary Slip/Attendance with HR, employee self-service, and future payroll-finance role boundaries documented | 2 | P2 | 6 |

## Epic E8 — UAT, Sign-off & Go-live
| ID | Story | AC (summary) | SP | Pri | Sprint |
|---|---|---|---|---|---|
| HR-070 | Load real employees + parallel run | ≥1 cycle parallel vs current process | 5 | P1 | 7 |
| HR-071 | Compliance sign-off (SME) + UAT sign-off (PO) | PIFSS/gratuity/WPS/payslip signed off | 3 | P1 | 7 |
| HR-072 | Runbook + training material | Documented; HR can operate; accountant/payroll-finance handoff documented if enabled | 3 | P1 | 7 |
| HR-080 | Production deploy + first live payroll | Fixtures migrated to prod; live run supervised | 5 | P1 | 8 |
| HR-081 | HR user training | Users trained; sign-off | 2 | P1 | 8 |
| HR-082 | Hypercare (2 weeks) | Issues triaged; v2 backlog captured | 2 | P2 | 8 |

---

### Totals (rough)
~**113 SP** across 9 sprints (Sprint 0–8). P1 (must) ≈ 83 SP concentrated in Sprints 0–4 and 7–8 — i.e. the compliance core + go-live. P2/P3 (attendance, extra reports) can flex if capacity is tight.
