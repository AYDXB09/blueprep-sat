# BluePrep — Claude Code Context

## What is BluePrep
An SAT question-bank practice app — Bluebook-style test player built around a real, verified
question bank pulled from the source's own public question-bank API. Same V1→V2 shape as
Lumina: `index.html`/`server.js` is the working V1 (vanilla HTML/JS, single-file player, local
JSON storage). This session designed the full V2 rebuild — Supabase-backed, multi-user, real
practice-session tracking, and an AI-coaching trap/cue overlay system — but V2 has not been
built yet. Everything below is the design + a few real working mockups, not shipped code.

**Local path:** `/Users/ny/Downloads/CursorProjects/blueprep-sat/`
**GitHub:** `AYDXB09/blueprep-sat` (public — part of the college admissions portfolio cleanup, see workspace-root `CLAUDE.md`)
**Real question bank:** `data/questions.json` — 3,252 questions already downloaded via `scripts/download-questions.js`, confirmed real (not synthetic) by direct inspection.
**Frontend stack:** React + Vite + TypeScript, deployed on **Vercel**. Decision hinged on one question: does the AI chat need token-by-token SSE streaming (→ would require Railway, like Lumina)? Answered no — BluePrep's AI chat can be plain request/response, so Vercel's serverless model (static frontend + API routes) is simpler and cheaper than running a persistent backend process. If that requirement ever changes, revisit — Vercel functions have execution-time limits that kill real streaming.

**Scaffolded** at `blueprep-sat/web/` (own `package.json`, deliberately not the repo root — V1's `index.html`/`server.js`/`package.json` stay untouched there). Confirmed working: `npm run dev` serves real client-side routing across all 9 planned routes, `tsc --noEmit` compiles clean, verified live in-browser (not just "should work").
- `src/lib/supabase.ts` — client using the *publishable* key only (safe to commit; real access control is RLS, applied in `blueprep_schema.sql`)
- `src/lib/database.types.ts` — generated directly from the live schema via `generate_typescript_types`, not hand-written — regenerate the same way after any migration, never hand-edit
- `src/styles/tokens.css` — the exact design tokens validated in the HTML mockups (`--math`/`--rw`/`--navy`/`--red`), so the real app and the mockups stay visually consistent
- `src/pages/*.tsx` — one route per screen, all currently `PageStub` placeholders with real navigation between them. **Not started yet**: porting `mockups/player.html` and `mockups/ad-hoc-builder.html` into actual React components — those two mockups are behaviorally complete, this is a translation task, not a design task.

## Design mockups
`mockups/` — the standalone HTML design artifacts that preceded `web/`, kept as provenance (see `mockups/README.md` for what each one is). `player.html` and `ad-hoc-builder.html` are genuinely interactive, not static.
- `.env` / `.env.example` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` for the BluePrep project, `.env` gitignored (`.env.example` isn't — it's a publishable key, not a secret)

---

## V1 (current, working) vs. V2 (designed this session, not built)

| | V1 — what exists | V2 — what's designed |
|---|---|---|
| Frontend | Single `index.html`, vanilla JS | Not built — screens designed as standalone HTML mockups (see below) |
| Storage | Local JSON files (`data/progress.json`, `data/sessions.json`) | Supabase Postgres, full schema in `blueprep_schema.sql` |
| Users | None — single local user | Multi-user via Supabase Auth, RLS-scoped per table |
| AI coaching | Live "Ask AI" chat in-player + separate "AI Performance Coach" in Mistake Log review | Same two features, explicitly scoped narrower — see Open Decisions below |

## Real, confirmed facts about the question data (verified against `data/questions.json`, not assumed)
- **No images** — zero `<img>` tags anywhere. Diagrams are inline `<svg>` (300 questions have them, both subjects) and MathML (`<math><mfrac>...`) for Math notation. `sanitizeHtml()` in `server.js` already allow-lists both.
- **Underlines are real inline markup** — `<span role="region" aria-label="Referenced Content"><u>...</u></span>`, 78 questions use this.
- **`stimulus` and `stem` are separate HTML fields** already — shared passage vs. actual prompt. No need for a normalized "texts" table; V2's schema stores these as two markup columns directly on `questions`.
- **`type: "spr"`** (grid-in/student-produced-response) — 381 Math questions, zero `options`, single raw-string `correctAnswer`.
- **Grid-in equivalence bug — fixed, verified, committed to V1.** `normalize()` in both `download-questions.js` and `detect-new-questions.js` now captures the full `acceptedAnswers` array instead of discarding everything past the first form; `index.html`'s `isCorrect()` checks a submitted answer against all of them (numeric comparison, not string match), with a fallback to `[correctAnswer]` for legacy cached data with no `acceptedAnswers` field. Verified against the real live-API example (`.1764`/`.1765`/`3/17`) plus wrong-answer rejection, non-numeric input safety, and backward compatibility — all pass. `npm test` still green (12/12).
- **Domain/skill taxonomy confirmed exact**: R&W = `INI`/`CAS`/`EOI`/`SEC` (Information and Ideas / Craft and Structure / Expression of Ideas / Standard English Conventions). Math = `H`/`P`/`Q`/`S` (Algebra / Advanced Math / Problem-Solving and Data Analysis / Geometry and Trigonometry).
- **Real blueprint pacing already in `index.html:1997-1998`** (`TEST_BLUEPRINTS`): R&W quarter=7q/8min, half=14q/16min, module=27q/32min, section=54q/64min. Math quarter=6q/9min, half=11q/17.5min, module=22q/35min, section=44q/70min. **Not linear** — quarter/half and module/section pace at different sec/question rates within the same subject.

## V2 Schema — `blueprep_schema.sql`
Full DDL, applied to a live Supabase project (see below). 16 tables:
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
Two rebuilt as real, working, interactive HTML (not wireframes) — reusable design tokens: `--math` (teal) / `--rw` (amber) subject accent, `--navy` brand accent, `--red` for traps/warnings/retired-tags.
- **Practice Player** — dual timers (session countdown + per-question count-up, merges into a count-up "overtime" clock rather than a separate one), pause overlay, popup "time's up" modal (not forced auto-submit — student chooses submit vs. continue), real text-selection highlighter (`Selection`/`Range` API + `<mark>`, matching the existing app's own mechanism but adding remove-highlight, which the existing app lacks), Desmos link-out (true embed blocked by artifact sandbox CSP, not a real-app limitation), reference sheet modal, question-navigator jump grid, module-submission review gate, break screen between R&W and Math (10-min figure unverified — flagged in the UI itself, not just in docs).
- **Ad-hoc Practice Builder** — mixed-subject split (independent Math/R&W counts and timing, summed not blended, since the two subjects pace at genuinely different rates), free-typed count steppers (no forced snapping to presets), quick-pick standard-length chips, live pool-scarcity warning before the session is built.
- **Not yet built as real HTML** (still lo-fi wireframes in the original flow-storyboard artifact only): Login, Dashboard, Full Test Setup, Session Summary, Progress & Score Tracking, Mistake Log, Settings.

## Supabase
See workspace-root `CLAUDE.md` → Supabase Projects table for connection details and MCP setup — that's the single source of truth for credentials/connection status, not duplicated here.
**Schema not yet applied** — `blueprep_schema.sql` is ready; connection is verified live (`list_tables` succeeds, returns empty). Next real step is `apply_migration`.

## Open Decisions (unresolved, not just "future work")
- **AI coaching scope narrowed, not built.** Given most explanations are meant to be pre-authored in `cues`/`choices.explanation_markup`, live AI only earns its place for: (1) follow-up questions beyond the canned explanation, (2) any question without authored cues yet, (3) cross-session pattern synthesis ("Performance Coach"). `feature_flags` table seeds all three as `is_enabled = false` placeholders with this reasoning written into each row's `description` — not built, deliberately deferred.
- **Tab-switch/visibility detection** — explicitly rejected, not needed (practice tool, not a proctored exam).
- **Break interval (10 min) between R&W and Math** — recalled from general knowledge, never verified against an official source. Flagged directly in the break-screen mockup's copy, not just here.
- **Full Test's adaptive routing threshold** — not publicly documented by the source; `tier_difficulty_profiles` seed values are a first-pass guess needing real calibration.
