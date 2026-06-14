# UAT Execution Log

**Companion to:** `15_Testing/uat_pack.md` (the script) · **Environment:** `https://13-140-159-201.sslip.io`
**Instructions:** one row per UAT case per run. Status ∈ {PASS, FAIL, BLOCKED, N/A}. On FAIL, file a defect id and link it. `[NC]` cases: record the provisional value used and the real value the workshop must confirm. This log is the evidence the OM signs at UAT exit (`uat_pack.md §7`) and a go-live input (`16_Deployment/go_live_checklist.md`).

---

## Run header (fill per UAT session)

| Field | Value |
|---|---|
| Run date | _____ |
| Build / commit deployed | _____ |
| Staging URL | https://13-140-159-201.sslip.io |
| Seed state | _____ (e.g. uat-seed chain + provisioned finance/kitchen) |
| Personas present | Agent ☐ · Reviewer/OM ☐ · Finance ☐ · Kitchen ☐ · Admin ☐ |
| UAT lead (OM) | _____ |

## Case results

| WF | Case | Persona | Status | Defect id | Evidence (screenshot/note) | `[NC]` value used / to confirm |
|---|---|---|---|---|---|---|
| WF-01 | Manual intake | Agent | ☐ | | | mandatory-field set; submit-block rule |
| WF-02 | WhatsApp intake | Agent | ☐ | | | — |
| WF-03 | Draft review/claim | OM | ☐ | | | — |
| WF-04 | Approval | OM | ☐ | | | payment-on-submit policy |
| WF-05 | Rejection | OM | ☐ | | | reason-code set |
| WF-06 | Edit before approval | Agent/OM | ☐ | | | — |
| WF-07 | Kitchen routing | Kitchen/OM | ☐ | | | kitchen_cutoff_time; routing content (MG-D3/D4) |
| WF-08 | Preparation | Kitchen | ☐ | | | — |
| WF-12 | Cancellation | Agent/OM | ☐ | | | reason-code; refund policy |
| WF-13 | Failed payment / refund | Finance | ☐ | | | — |
| WF-14 | Complaint / exception | Agent/OM | ☐ | | | escalation reason code |
| WF-15 | Admin correction | OM/Admin | ☐ | | | — |
| WF-16 | Audit recording | Admin | ☐ | | | — |
| — | Customers + merge/undo | OM | ☐ | | | — |
| — | Catalog browse | Admin | ☐ | | | — |
| — | Reports + export | Admin | ☐ | | | — |
| — | Settings/masters | Admin | ☐ | | | — |
| — | Staff / RBAC | Admin | ☐ | | | — |
| — | Dashboard | Admin | ☐ | | | — |

## TS-S mandatory-scenario gate (must be 7/7 before pilot)

| # | Scenario | Status | Note |
|---|---|---|---|
| 1 | Allergy chain 1→7 (non-negotiable) | ☐ | |
| 2 | WhatsApp draft → review → approve | ☐ | |
| 3 | Same-day cancel | ☐ | |
| 4 | Change request impact cascade | ☐ | |
| 5 | Payment confirm/reject | ☐ | |
| 6 | Customer merge + undo | ☐ | |
| 7 | Reconciliation divergence flagged | ☐ | |

## Defect register (this run)

| Defect id | WF | Severity (Crit/High/Med/Low) | Description | Status |
|---|---|---|---|---|
| | | | | |

## Sign-off

| | Name | Date | Result (PASS / PASS-with-waivers / FAIL) |
|---|---|---|---|
| UAT lead (OM) | | | |
| QA | | | |

**Exit rule:** PASS requires every non-`[NC]` case PASS, every `[NC]` case PASS-behaviorally, TS-S 7/7, and **zero open Critical/High** defects on the slice. Waivers (Med/Low deferred) listed explicitly and carried to the go-live pack.
