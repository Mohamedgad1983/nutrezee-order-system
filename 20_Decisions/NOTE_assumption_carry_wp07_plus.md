# NOTE - Assumption Carry for WP-07+

**Date:** 2026-06-10
**Status:** Sponsor/user directive recorded for build execution

The sponsor/user directed that the project must not stop at WP-07 solely because business questions remain unresolved. Every missing business decision must be captured as an explicit assumption, assigned a risk level, marked sponsor-review-required, and used for implementation until revised.

This note does **not** close DEC-002, DEC-004, DEC-005, DEC-006, DEC-007, DEC-008, DEC-009, DEC-010, DEC-012, or any other OPEN decision. It authorizes assumption-based continuation only under the controls in `ASSUMPTION_REGISTER.md`.

Implementation limits remain:

1. Assumptions must stay traceable and easy to revise.
2. Workshop-owned values must remain configurable where the architecture requires config-over-code.
3. Dormant modules remain forbidden unless the MVP cut is amended.
4. Real legacy apply still needs legacy access/export.
5. WP-14 still needs a live smoke-tested staging environment; missing cloud credentials cannot be assumed away.

Related sponsor-review package: `22_Meeting_Notes/sponsor_review_package_unresolved_business_questions.md`.
