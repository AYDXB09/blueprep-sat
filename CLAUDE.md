# BluePrep — Claude Code Context

## What is BluePrep
An SAT question-bank practice app — Bluebook-style test player built around a real, verified
question bank pulled from the source's own public question-bank API. Same V1→V2 shape as
Lumina: `index.html`/`server.js` is the original V1 (vanilla HTML/JS, single-file player, local
JSON storage) — still in the repo root, untouched. **V2 is built and live**: Supabase-backed,
multi-user, real practice-session tracking, and a real trap/cue coaching overlay system, deployed
to Vercel at **https://blueprep-sat.vercel.app**. This file tracks V2's actual current state, not
a design plan.

**Local path:** `/Users/ny/Downloads/CursorProjects/blueprep-sat/`
**GitHub:** `AYDXB09/blueprep-sat` (public — part of the college admissions portfolio cleanup, see workspace-root `CLAUDE.md`)
**Real question bank:** `data/questions.json` — 3,252 questions already downloaded via `scripts/download-questions.js`, confirmed real (not synthetic) by direct inspection.
**Frontend stack:** React + Vite + TypeScript, deployed on **Vercel**. Decision hinged on one question: does the AI chat need token-by-token SSE streaming (→ would require Railway, like Lumina)? Answered no — BluePrep's AI chat can be plain request/response, so Vercel's serverless model (static frontend + API routes) is simpler and cheaper than running a persistent backend process. If that requirement ever changes, revisit — Vercel functions have execution-time limits that kill real streaming.

**Live** at `blueprep-sat/web/` (own `package.json`, deliberately not the repo root — V1's `index.html`/`server.js`/`package.json` stay untouched there). `npm run dev` / `npm run build` both clean, `tsc --noEmit` clean, all 9 routes real (no stubs), deployed to Vercel with auto-deploy on push to `main`.
- `src/lib/supabase.ts` — client using the *publishable* key only (safe to commit; real access control is RLS)
- `src/lib/database.types.ts` — generated directly from the live schema via `generate_typescript_types`, not hand-written — **regenerate the same way after any migration, never hand-edit** (the file's own header comment says this too)
- `src/lib/practiceSessions.ts` — all session/question/attempt/mistake read+write logic; components never call `supabase` directly
- `src/lib/userSettings.ts` — `user_settings` read/write (get-or-create-on-first-load pattern, same as `AuthContext`'s `ensureUserRow` for the `users` table)
- `src/lib/appearance.ts` — applies `user_settings.theme`/`font_size` to `<html>` (`data-theme`, `data-font-size`) — called on auth bootstrap (`AuthContext`) and instantly on Settings save. **Persisting a setting to the DB and applying it to the page are two different steps** — this file is the second one; don't assume a new `user_settings` column does anything visually until something calls `applyAppearance`-style code for it.
- `src/lib/domainColors.ts` — one hex color per real domain (4 Math + 4 R&W), shared across Mistake Log / Progress / Session Summary / Practice Builder so a domain reads the same color everywhere, not tied to subject (Math ≠ one color, R&W ≠ one color — each of the 8 domains is distinct)
- `src/lib/sessionOrigin.ts` — sessionStorage-keyed "where did this practice session get opened from" so Player's exit button returns to Mistake Log / Session Summary / Dashboard / Builder correctly instead of a hardcoded `/`
- `src/styles/tokens.css` — design tokens (`--math`/`--rw`/`--navy`/`--red`, light+dark), respects `data-theme` override
- `src/pages/*.tsx` — one real route per screen, see Screens status below

## Design mockups
`mockups/` — the standalone HTML design artifacts that preceded `web/`, kept as provenance (see `mockups/README.md` for what each one is). `player.html` and `ad-hoc-builder.html` are genuinely interactive, not static.
- `.env` / `.env.example` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` for the BluePrep project, `.env` gitignored (`.env.example` isn't — it's a publishable key, not a secret)

---

## V1 (original) vs. V2 (current, live)

| | V1 — `index.html`/`server.js` at repo root | V2 — `web/`, deployed |
|---|---|---|
| Frontend | Single `index.html`, vanilla JS | React + Vite + TypeScript, real routing |
| Storage | Local JSON files (`data/progress.json`, `data/sessions.json`) | Supabase Postgres, live schema (`blueprep_schema.sql` + later migrations) |
| Users | None — single local user | Multi-user via Supabase Auth, RLS-scoped per table |
| AI coaching | Live "Ask AI" chat in-player + separate "AI Performance Coach" in Mistake Log review | Narrower by design, not built yet — see Open Decisions. Pre-authored trap/cue coaching *is* built and live (see below) |

## Real, confirmed facts about the question data (verified against `data/questions.json`, not assumed)
- **No images** — zero `<img>` tags anywhere. Diagrams are inline `<svg>` (300 questions have them, both subjects) and MathML (`<math><mfrac>...`) for Math notation. `sanitizeHtml()` in `server.js` already allow-lists both.
- **Underlines are real inline markup** — `<span role="region" aria-label="Referenced Content"><u>...</u></span>`, 78 questions use this.
- **`stimulus` and `stem` are separate HTML fields** already — shared passage vs. actual prompt. No need for a normalized "texts" table; V2's schema stores these as two markup columns directly on `questions`.
- **`type: "spr"`** (grid-in/student-produced-response) — 381 Math questions, zero `options`, single raw-string `correctAnswer`.
- **Grid-in equivalence bug — fixed, verified, committed to V1.** `normalize()` in both `download-questions.js` and `detect-new-questions.js` now captures the full `acceptedAnswers` array instead of discarding everything past the first form; `index.html`'s `isCorrect()` checks a submitted answer against all of them (numeric comparison, not string match), with a fallback to `[correctAnswer]` for legacy cached data with no `acceptedAnswers` field. Verified against the real live-API example (`.1764`/`.1765`/`3/17`) plus wrong-answer rejection, non-numeric input safety, and backward compatibility — all pass. `npm test` still green (12/12).
- **Domain/skill taxonomy confirmed exact**: R&W = `INI`/`CAS`/`EOI`/`SEC` (Information and Ideas / Craft and Structure / Expression of Ideas / Standard English Conventions). Math = `H`/`P`/`Q`/`S` (Algebra / Advanced Math / Problem-Solving and Data Analysis / Geometry and Trigonometry).
- **Real blueprint pacing already in `index.html:1997-1998`** (`TEST_BLUEPRINTS`): R&W quarter=7q/8min, half=14q/16min, module=27q/32min, section=54q/64min. Math quarter=6q/9min, half=11q/17.5min, module=22q/35min, section=44q/70min. **Not linear** — quarter/half and module/section pace at different sec/question rates within the same subject.

## V2 Schema — `blueprep_schema.sql`
Full DDL, applied to a live Supabase project (project ref `qjoeqscehyjyrhtfexyg`, MCP server `supabase-blueprep`). 16 tables, plus one migration added later:
- `user_settings.feedback_mode_default` — added via `apply_migration` (not in the original DDL file) once Settings actually got wired to real reads/writes; mirrors `practice_sessions.feedback_mode`'s two values.
- **Content**: `question_sources`, `questions`, `choices`, `trap_categories`, `guides`, `cues`
- **Users**: `users`, `user_settings`
- **Practice**: `practice_sessions`, `session_modules`, `question_attempts`, `tier_difficulty_profiles`
- **SaaS**: `plans`, `subscriptions`, `ai_usage_log`, `guardian_links`, `feature_flags`

Key design decisions, in case they need re-deriving:
- **No brand names anywhere in schema or frontend** — `question_sources.code` uses `Official_CB` only as an internal DB identifier (never rendered); user-facing copy says "Verified Question Bank," never names the source. Applies to all UI copy, not just this table.
- **No per-question module/tier tag.** Adaptive routing (Module 1 → Module 2 Tier 1/Tier 2) is a dynamic difficulty-weighted *sample* computed per-session into `session_modules.question_ids`, never a stored property of `questions` — the same question can land in Module 1 for one student and Tier 2 for another. `tier_difficulty_profiles` holds the (approximate, uncalibrated) sampling weights.
- **Session-level overrides, not just user defaults** — `practice_sessions` has its own `timer_mode`/`timer_basis`/`include_retired`/`feedback_mode` columns, copied from `user_settings` at creation time but independently editable per session.
- **`is_active = false` is a tag, not a filter** — retired questions always show a visible "Retired" chip; only hidden if the student's session explicitly excludes them.
- **Grid-in grading needs a numeric-equivalence check**, not string match (`"0.75"` should match a stored `"3/4"`) — independent of whether `accepted_answers` ever captures CB's full array.
- **RLS**: every user-scoped table gated `auth.uid() = user_id`. Content tables (`questions`, `choices`, `cues`, etc.) get RLS *explicitly enabled* with an authenticated-read policy — not left RLS-off, since Supabase's "automatic RLS" project setting would otherwise silently deny all access to them.
- **Math trap categories are an unvalidated draft** — 7 categories derived from only 4 sample questions (one per domain), nowhere near the rigor the 9 R&W categories got (derived from real questions with adversarial back-and-forth). Needs a real validation pass before treating as final.

## Screens — status
All 9 routes are real React pages wired to live Supabase data (not stubs, not mockups) — reusable design tokens: `--math` (teal) / `--rw` (amber) subject accent, `--navy` brand accent, `--red` for traps/warnings/retired-tags, plus a per-domain 8-color palette (`domainColors.ts`) layered on top for anything domain-scoped.
- **Login** — real Supabase Auth (sign in/up/out), `RequireAuth` route guard.
- **Dashboard** (`/`) — score trend split into 3 tiles (Combined/Math/R&W, each its own sparkline), streak, weakest skill, recent sessions, then Start Full Test / Ad-hoc Practice buttons — in that order (trends → history → actions, per explicit feedback; the actions used to sit between the trend cards and the session list, which read backwards).
- **Practice Player** (`/practice/:sessionId/q/:n`) — fully real: live session/question/choice/attempt data, real SPR (grid-in) grading, real prev/next, timers that respect the session's actual `timer_mode`/`timer_basis` (not hardcoded), a real **review mode** for completed sessions (`isReviewMode = !!session.completed_at`: pre-filled answers, no new attempt writes, no countdown, real correct/incorrect coloring), the CB-source rationale panel (bolded "Choice A/B/C/D" mentions), and the full trap/cue highlighting system (see below). Exit control returns to wherever the session was actually opened from (`sessionOrigin.ts`), not a hardcoded `/`, and skips the "leave session?" confirm entirely in review mode.
- **Ad-hoc Practice Builder** (`/practice/new`) — Subject toggle shows Math+R&W chips together instead of the word "Both"; both subjects' chips are real domain-level filters now (R&W used to be 4 *skills* — Boundaries/Transitions/Rhetorical Synthesis/Inferences — switched to the 4 real domains for site-wide consistency; the skill names are still real, just a finer axis than domain, no longer surfaced here); each chip is colored by its real domain via `domainColors.ts`; pool-scarcity warning generalized to whatever domains are selected (was hardcoded to the R&W "Boundaries" skill).
- **Full Test Setup** (`/test/new`), **Session Summary** (`/sessions/:id`), **Progress** (`/progress`), **Mistake Log** (`/mistakes`), **Settings** (`/settings`) — all real, all Supabase-backed.

### The trap/cue coaching system (built, not deferred)
`cues` table rows (govern/trap/assumption, grounded in the source's own `source_rationale_markup`) render as inline `<mark class="cue-mark">` highlights in the stimulus/stem/choices, plus an expandable panel with the full breakdown. **Important architecture note**: the marks are computed as a memoized HTML string (`withCueMarks` in `Player.tsx`) via a *detached* DOM node, then fed to React as the `dangerouslySetInnerHTML` value — they are **not** injected by mutating the live rendered DOM after the fact. That was the original approach and it was wrong: React resets a `dangerouslySetInnerHTML` node's real `innerHTML` back to its declared prop value on *any* re-render of that node, including one triggered by something completely unrelated elsewhere on the page — confirmed by instrumenting `Element.prototype.innerHTML` and watching it fire from an unrelated button click. If you ever need to touch cue rendering again, keep it as a pure string transform, never a "wrap the rendered text once" DOM mutation.
- Coverage: as of this session, **455 questions cued (1,179 cue rows)** out of 3,252 in the bank. Explicit decision (see below) is to **not** blindly batch-generate the rest — cue generation happens on-demand, scoped to whatever questions actually appear in a real practice session, checked manually when asked (query: `select distinct qid from (select unnest(question_ids) as qid from practice_sessions) s where not exists (select 1 from cues c where c.question_id = s.qid)`).
- Content-quality note: a handful of early govern cues were anchored to meaningless stem boilerplate ("what does the word", "which choice completes the text") instead of real textual evidence — found and fixed (re-anchored to the actual passage phrase) via a direct query for that pattern. Worth spot-checking again if cue coverage grows a lot from here.

## Supabase
See workspace-root `CLAUDE.md` → Supabase Projects table for connection details and MCP setup — that's the single source of truth for credentials/connection status, not duplicated here. Project ref `qjoeqscehyjyrhtfexyg`, MCP server `supabase-blueprep`, schema fully applied and live, RLS + explicit GRANTs verified on every table (the missing-GRANTs bug — RLS policies existed but base Postgres privileges for `authenticated`/`anon` never included SELECT/INSERT/UPDATE/DELETE — was the real root cause of an earlier "Failed to load dashboard" class of errors; fixed).

## Decisions (resolved)
- **Break interval finalized at 10 min.** Kept the existing 10-minute figure (general knowledge of the real exam's break structure, not sourced from an official doc) as the permanent value — explicit call, 2026-08-07. Removed the "unverified, confirm before treating as fact" caveat from the break screen (`Player.tsx`) since it's no longer a pending question.
- **AI coaching scope** — parked, no change. Stays as three `is_enabled = false` `feature_flags` placeholders (follow-up Q&A, un-cued questions, cross-session Performance Coach); revisit later.
- **`show_ai_cues_default`** — parked, no change. Persists correctly, no downstream consumer yet; not being wired up right now.
- **Math trap categories — already done, CLAUDE.md was stale.** Verified live against the DB (2026-08-07): 11 categories exist (not 7), each one in real use across **all 4 Math domains** (Algebra, Advanced Math, Geometry and Trigonometry, Problem-Solving and Data Analysis) via real `cues` rows — e.g. `wrong_operation_substitution` appears 26x in Advanced Math, 13x in Algebra, 10x in Geometry, 5x in Problem-Solving. This already has the cross-domain grounding the old note said was missing. No further action needed; the "unvalidated draft" line below was outdated.
- **`docs/add-mockups-and-context` branch — already merged and pushed.** Verified live (2026-08-07): merged into `main` at `9b45d6c` and confirmed present on `origin/main`. The "not yet merged/pushed" line in the workspace-root `CLAUDE.md` was stale; nothing to do here.

## Open Decisions (unresolved, not just "future work")
- **Tab-switch/visibility detection** — explicitly rejected, not needed (practice tool, not a proctored exam).
- **Full Test's adaptive routing threshold — on hold.** Checked live usage data (2026-08-07): only 197 `question_attempts` total, from **1 user**, across 179 questions — not enough for real calibration (needs population-level pass-rate/item-difficulty data across many students). `tier_difficulty_profiles` (module1: 30/45/25 easy/med/hard, tier1: 15/45/40, tier2: 40/45/15) stays as the placeholder guess. Explicitly on hold, not being pursued now — revisit once usage grows.
- **Cue generation stays on-demand, not batch.** Explicitly decided over generating cues for the full 3,252-question bank upfront — most of those questions may never be seen by a real user, so it's wasted spend. No live infra (Edge Function/webhook) built for this either — user declined provisioning a separate Anthropic API key for that; top-ups happen manually via Claude Code when asked.
- **Settings persists and applies, but only theme/font_size have a real visual effect wired end-to-end.** Remaining columns:
  - `explanation_verbosity` (Brief/Detailed) — **decided: leave as-is, not building a real consumer.** Explicit call — not worth maintaining two rendered versions (short label vs. full explanation) of the same content for one toggle. Column keeps persisting to `user_settings` but stays cosmetically inert by design, not by gap.
  - `mistake_resurface_days` — **design decided, not built yet.** Not a pure day-based cooldown. Rule: a missed question is deprioritized until the student has exhausted the other unseen questions at the same difficulty + domain/topic — i.e. selection should prefer fresh same-difficulty/same-topic questions first, and only fall back to resurfacing a missed one once that pool is actually exhausted. `mistake_resurface_days` becomes a ceiling/fallback on top of that (still resurface after N days even if the pool isn't exhausted, so a mistake doesn't wait forever in a huge pool) rather than the primary gate. Needs implementing in the ad-hoc/full-test question-selection logic (`practiceSessions.ts` builder) — currently `getMistakes()` only reads "most recent attempt was wrong," no pool-exhaustion or day-based sequencing exists yet.
  - `show_ai_cues_default` — parked (see Decisions above).

## Workspace conventions this repo follows
- Never add "Co-Authored-By: Claude" to commits (explicit user preference, applies here too).
- **Show a sketch/mockup before implementing any UI/screen redesign** — get it approved first, don't jump straight to code for visual changes. (Doesn't apply to pure bug fixes or copy tweaks — sketch only for actual layout/visual redesigns.)
- Verify things live in-browser (via the `claude-in-chrome` MCP against the deployed Vercel URL) before reporting a fix as done — this project specifically had a case of a fix reported as complete because it compiled and the DB value persisted, without confirming the page actually looked different. Persisting a value and applying it are not the same claim.
