# Risk Register

**Status:** Living document · Review weekly · Scales: Likelihood/Impact = Low/Med/High. Exposure = L×I.

| ID | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | Project knowledge exists only on one machine — discovery repo has no git remote, outer repo uncommitted | High (certain) | High | Push both repos to private remote this week (ENH-QW-01) | PM | **OPEN — act now** |
| R2 | Source/staging access never granted; extend strategy unvalidatable | Med | High | Timebox access requests to 3 weeks in Phase 0; default DEC-001 to strangler-fig on expiry | PM | OPEN |
| R3 | Requirements built from single-day desk discovery, unvalidated by operations staff | High | High | Verification workshop is the Phase 0/1 gate; no modeling commitments from Assumed-grade evidence | PM/BA | OPEN |
| R4 | Production incident from existing unsafe surfaces (mutating GET auto-assign, leaked SQL exceptions, no logout) | Med | High | Quick wins ENH-QW-02/03/04 with old-system owner; until then, staff briefed not to open the auto-assign card | Tech Lead | OPEN |
| R5 | Scope overload: 34 of 44 BRs are P0; 51 catalog modules | High | Med | Force DEC-003 MVP cut; phase gates block parallel fragment-building | Sponsor | OPEN |
| R6 | PII/health/payment data exposure during transition (old system stays RBAC-less while in use) | Med | High | RBAC+audit first build (ENH-1-01); shrink old-admin account list (ENH-QW-07); access logging on new side | Security | OPEN |
| R7 | WhatsApp Business API feasibility unknown (account approval, template rules, cost) | Med | Med | Phase 0 spike; DEC-002 allows manual-assisted fallback so intake queue ships regardless | Tech Lead | OPEN |
| R8 | Kitchen/dispatch rules undocumented; automation could encode wrong rules | High | Med | DEC-006/007/008 are hard entry gates for Phase 3; rules live in settings (business-editable), not code | BA + Ops | OPEN |
| R9 | Shop-floor adoption failure (chefs/packing/drivers reject new tools) | Med | High | Pilot one section + one route first; tools must be faster than current practice; training track in roadmap | PM + Ops | OPEN |
| R10 | Double-entry/divergence during old/new coexistence | Med | Med | Per-workflow hard cutover (e.g., order creation only in new intake at G2); old screens set read-only at retirement | Tech Lead | OPEN |
