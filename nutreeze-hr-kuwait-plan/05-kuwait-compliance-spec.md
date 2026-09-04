# 05 — Kuwait Compliance Specification

> **Engineering builds the mechanism; the Kuwait Payroll SME owns the numbers.**
> Fields marked **[CONFIRM-SME]** should be gathered in Sprint 0 where possible. If still pending, engineering may implement only configurable mechanisms, not official statutory outputs. These values must be filled and signed off before live payroll/WPS use. **No statutory value is hardcoded from memory or web sources** — only from official Kuwait sources (PIFSS, Ministry of Labour, the company's bank) via the SME.
> Per [SPEC.md](SPEC.md), engineering can build configurable mechanisms and dry-run tests while values are pending, but live payroll/WPS output is blocked until sign-off.

Verification owners: **SME** = Kuwait payroll/legal expert · **ENG** = engineering · **PO** = business.

---

## C1 — Currency (KWD)  ✅ already configured
- **Requirement:** all payroll in Kuwaiti Dinar, **3 decimal places** (fils).
- **Implementation:** Global Defaults `default_currency = KWD`; System Settings `float_precision = 3`, `number_format = #,###.###`. Salary components/structures inherit company currency.
- **Acceptance:** every monetary value on Salary Slip, payslip, WPS, GL shows 3 decimals. **(ENG)**

## C2 — Arabic / bilingual  ✅ base configured
- **Requirement:** Arabic UI (RTL) + bilingual payslip; Arabic employee names.
- **Implementation:** system language `ar`; `arabic_full_name` custom field; bilingual payslip print format (Cairo/Amiri).
- **Acceptance:** HR screens render RTL for HR roles; employees use self-service only; payslip shows Arabic + English labels and Arabic name. **(ENG + PO)**

## C3 — PIFSS (social security)
- **Requirement:** social-security contributions for **Kuwaiti nationals** (expats excluded — they get end-of-service gratuity instead).
- **Parameters [CONFIRM-SME]:**
  - Employee contribution rate: `____ %`
  - Employer contribution rate: `____ %`
  - Applicable-salary ceiling (monthly): `____ KWD`
  - Which earnings are "applicable" (basic only vs basic+allowances): `____`
  - Rounding rule: `____`
- **Implementation:** deduction Salary Component (employee share) with formula + condition `is_kuwaiti == 1` and ceiling cap; separate employer-share component → GL liability. `pifss_number` on Employee.
- **Acceptance:** for SME worked examples (Kuwaiti at/above/below ceiling; expat = 0), computed PIFSS matches to the fils. **(SME signs off)**

## C4 — End-of-service gratuity (indemnity)
- **Requirement:** indemnity on contract end, per Kuwait Labour Law (Private Sector Law No. 6/2010).
- **General framework (illustrative — [CONFIRM-SME] exact tiers, caps, resignation reductions):**
  - Indefinite contract, employer termination: ~15 days' wage per year for first 5 years + ~1 month's wage per year thereafter; total cap commonly cited as ~1.5 years' wage.
  - Resignation: reduced entitlement based on years of service (tiered).
  - Definition of "wage" for the calc (last basic vs basic+allowances): `____`
- **Implementation:** ERPNext `Gratuity Rule` with the confirmed slabs/fractions; `Gratuity` doc computes on exit; minor server logic if cap/resignation rules exceed the rule's config.
- **Acceptance:** gratuity for sample tenures (1/3/5/10 yrs; termination vs resignation) matches SME examples exactly. **(SME signs off)**

## C5 — WPS (Wage Protection System) file
- **Requirement:** salaries paid via bank + a salary file (SIF) submitted in the prescribed format.
- **Parameters [CONFIRM-SME / BANK]:**
  - The company's WPS bank + **exact file spec** (delimiter/fixed-width, header/employer record, employee record fields & order, encoding): `____`
  - Required fields (typical): employer ID/MOL no., bank code, Civil ID, IBAN, net salary, basic, allowances, deductions, working days, pay period.
  - A **sample valid file** from the bank for byte-level comparison: `____`
- **Implementation:** Report/Script generates the SIF from a submitted Payroll Entry; pre-payroll validation requires Civil ID + IBAN; custom fields `civil_id`, `iban`, `bank_code`.
- **Access:** HR owns payroll preparation. Accountant/payroll-finance access, if approved later, is limited to submitted payroll/WPS handling and GL/payment tasks, not full Employee HR data.
- **Acceptance:** generated file passes the bank's validation on a sample batch. **(SME/bank confirm)**

## C6 — Leave & holidays
- **Parameters [CONFIRM-SME]:**
  - Annual leave entitlement & accrual rule: `____`
  - Sick leave tiers (full/partial/unpaid) per law: `____`
  - Maternity / other statutory leave: `____`
  - Kuwait public holiday list for the year: `____`
- **Implementation:** Leave Types + Leave Policy + Holiday List (fixtures); leave→payroll (LOP) linkage.
- **Acceptance:** balances accrue correctly; holidays reflected in attendance/payroll. **(SME + PO)**

## C7 — Working hours & overtime
- **Parameters [CONFIRM-SME]:** standard hours, overtime multipliers, Ramadan hours, weekly rest. `____`
- **Implementation:** Shift Types + overtime salary component/rule.
- **Acceptance:** overtime computes per confirmed rules. **(SME)**

---

## Sign-off gate (blocks go-live)
Go-live (Phase 8) is blocked until the SME has signed off **C3 (PIFSS), C4 (gratuity), C5 (WPS)** and the PO has signed off **C2 (payslip)** and UAT. Record sign-offs in [06](06-risks-and-decisions.md) decision log.

| Item | Owner | Status |
|---|---|---|
| C1 KWD | ENG | ✅ done |
| C2 Arabic/payslip | ENG + PO | ⬜ |
| C3 PIFSS | SME | ⬜ [CONFIRM-SME] |
| C4 Gratuity | SME | ⬜ [CONFIRM-SME] |
| C5 WPS | SME + Bank | ⬜ [CONFIRM-SME] |
| C6 Leave/holidays | SME + PO | ⬜ |
| C7 Hours/overtime | SME | ⬜ |
