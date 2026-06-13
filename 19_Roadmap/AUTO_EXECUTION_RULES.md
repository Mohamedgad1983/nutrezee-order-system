# AUTO_EXECUTION_RULES — Nutrezee OS Agent

**Purpose:** the deterministic rulebook the agent follows to choose and execute the next unit of work **without a new detailed prompt**. Triggered by `Continue Nutrezee OS Agent` (or any Sprint/Build session). Companion: `NEXT_ACTION_QUEUE.md` (what's next), `SPRINT_MODE.md` (the six modes), `00_AGENT_OPERATING_SYSTEM.md` (roles/lifecycle), `AGENTS.md` (entry index + discipline).

The guiding objective is fixed: **replace the legacy daily order operation** (Orders, Subscribers/intake, Customers, Packages, Products, Reports, Settings) — not satisfy MVP theory. When a rule is ambiguous, choose the action that most shortens the path to that replacement (`Legacy_Core_Gap_To_Cutover.md`).

---

## A. Session start — run this every time, in order

1. `git status` — working tree must be clean. If files are unexpectedly missing/modified, restore from git history and report; never silently absorb.
2. `git fetch origin` then `git pull --ff-only origin main` (or rebase the feature branch). Resolve before any new work.
3. Read **live, from disk** (never from memory or a prompt snapshot):
   - `19_Roadmap/build_progress_register.md` — WP status, gate snapshot, run log, amendment counter.
   - `07_BLOCKERS_AND_DECISIONS.md` — live blockers.
   - `ASSUMPTION_REGISTER.md` — assumptions in force (ASM-ids) and their sponsor-review status.
   - `19_Roadmap/NEXT_ACTION_QUEUE.md` — the ordered next-work cursor.
4. **Detect the current frontier automatically:** the frontier = the first item in the Engineering Queue whose `blocked_by` is empty, cross-checked against the register's WP status (a WP marked DONE in the register is never the frontier even if the queue is stale — fix the queue). State the detected frontier in one line before acting.
5. Confirm gate snapshot still holds for the frontier's Definition of Done (master-prompt STEP 0). A failed gate is a stop condition (§E).

---

## B. Choosing the next work (decision tree)

Apply top-to-bottom; take the first branch that matches.

1. **Is the current/top queue item blocked by a sponsor-owned item only?** → Skip to the next engineering item that is unblocked (the two tracks run in parallel). Record that the top item is sponsor-blocked; do not idle.
2. **Does the frontier need an API that does not exist yet, and that API blocks the UI?** → **Build the API first.** (Today: WP-API-01 before WP-UI-02 — the intake form cannot search customers without the M04 controller.)
3. **Does a screen's API already exist and only the UI is missing?** → **Build the UI.** Backend-complete + UI-missing (class B/C with live API) is always eligible UI work.
4. **Is the blocker staging/infra (deploy can't proceed)?** → Do not idle: prepare deploy docs, checklists, migration mappings, or the next buildable API/UI unit instead. Deployment work resumes when infra clears.
5. **Is the blocker a missing business answer?** → Do **not** stop. Apply the governing assumption (§D), log it, build to it, flag it `[NC]`. Stop only if no defensible assumption exists.
6. **No eligible engineering item remains?** → Move to WP-DATA-01 / WP-14 prep per the queue's "after the engineering queue empties" section, or QA/Deployment/UAT mode if their entry conditions hold.
7. **Truly nothing is executable** (all paths blocked on sponsor/infra)? → That is the only "ask the user" case. Stop per §E with the exact unblock.

**Never ask the user a question whose answer already exists** in the repo (discovery, architecture, decisions, assumptions, this queue). Grep first.

---

## C. Executing a unit safely

1. **Restate scope** (the WP/queue item's scope + out-of-scope) in your own words before coding. Drift is checked against this at commit time.
2. **Stay atomic** — one unit per branch (`build/<wp-id>-<slug>` for code; doc-only may commit direct to `main`). No "while I'm here."
3. **Respect the binding constraints** (full list in `AGENTS.md` / master prompt): no GET mutations · same-transaction audit · single write path per owning module · masking at serialization · transitions only via the config-seeded engine · bilingual EN/AR · money in minor units · server-side sessions, no JWTs · zero new npm deps without a recorded reason.
4. **No re-discovery, no re-architecture.** Phases 1–4 are frozen inputs. Only a genuine *contradiction* (code vs. frozen doc) justifies an amendment — log it as an A-id in the register; if structural, STOP for architect/sponsor review.
5. **Run the unit's tests + CI.** A unit is DONE only when its DoD suites are green in CI (14 jobs). Red suite = not done; never mark pending to get green.
6. **Adversarially verify** non-trivial code (the project pattern: multi-lens review of the diff before merge — auth/security, correctness, integration). Fix must-fix findings before push.
7. **Commit and push after each completed unit.** Code: branch → green → merge (PR if direct main push is gated) → register update. Doc: direct to `main`. Reference the WP/queue id in the message; never force-push; never rewrite pushed history.
8. **Update `build_progress_register.md`** (status row + run-log entry) and **re-write `NEXT_ACTION_QUEUE.md`** (strike done, promote next) as part of the same unit — the registers are the agent's durable memory.

---

## D. Assumptions (when a business answer is missing)

- The project is explicitly built under recorded assumptions (`ASSUMPTION_REGISTER.md`, ASM-001..050). Continuing on a defensible assumption is **expected**, not a deviation.
- Use the **most conservative** interpretation that keeps the system safe (fail-secure RBAC, block-don't-merge on duplicates, `not_enabled` over a guessed behavior).
- **Log every new assumption**: append an ASM-id to `ASSUMPTION_REGISTER.md` with the rule applied, the evidence gap, and `sponsor-review-required`. Workshop-owned values stay **config** (settings / reason codes / `transition_config`), never hard-coded.
- Never invent a *signed* decision. An OPEN decision stays OPEN; you build around it as config, you don't declare it resolved.

---

## E. Stop conditions (the only reasons to halt and ask)

Stop **only** for: a failed gate · an `[NC]`/blocker that affects the active unit's DoD and has no defensible assumption · a test failure not safely fixable within scope · a missing secret/credential · a genuinely required product/sponsor decision with no conservative default · forbidden scope reached · **no eligible unit remains**. A stop is itself work: update the register (row BLOCKED + run log + exact blocker), commit, push, and report with the single next unblock action. Everything else — long output, many files, tedium, multiple eligible WPs — is **not** a stop; continue automatically.

---

## F. End-of-session output (mandatory, every session)

Close every session with exactly this block so the next session (or the user) can continue with zero context:

```
NUTREZEE OS — SESSION REPORT
1. Mode:            <Review|Build|Sprint|Fix|Deployment|UAT> + gate-check result
2. Done:            <units completed, with merge commits + CI run ids>
3. Tests:           <suites run + pass/fail counts; CI job count>
4. Commits pushed:  <hashes + branch/PR>
5. Assumptions:     <new ASM-ids logged, if any>
6. Current blocker: <exact blocker or "none">
7. Next task:       <the now-top NEXT_ACTION_QUEUE item>
8. Continue with:   "Continue Nutrezee OS Agent"   (or the precise command if a specific mode is needed)
```

This report and the updated registers are the handoff. No other context is required to resume.
