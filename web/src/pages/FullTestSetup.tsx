import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './FullTestSetup.css';
import { useAuth } from '../lib/AuthContext';
import {
  createPracticeSession,
  createSessionModule,
  orderByOfficialSequence,
  selectTieredQuestionIds,
  MATH_MODULE_QUESTION_COUNT,
  RW_MODULE_QUESTION_COUNT,
  RW_MODULE_SECONDS,
} from '../lib/practiceSessions';
import { getOrCreateUserSettings } from '../lib/userSettings';
import { setSessionOrigin } from '../lib/sessionOrigin';

// ---------------------------------------------------------------------------
// Storyboard screen 4 (/test/new). Unlike the Ad-hoc Builder, a full test's
// module structure is fixed — nothing here is user-configured, it's a
// confirmation + explanation screen. Module 2 tier routing is decided from
// Module 1 performance after the fact, not chosen up front.
//
// Only R&W Module 1 is assembled here — the real exam runs R&W M1 → R&W M2
// → break → Math M1 → Math M2 in sequence (see SECTION_ORDER below), and
// each later module depends on the score of the one before it. Modules 2-4
// are assembled by Player.tsx as the test actually progresses (see its
// gateSubmit/continueFromBreak — session_modules + practice_sessions.
// question_ids both grow live via assembleFullTestModule), not decided
// up front.
// ---------------------------------------------------------------------------

const SECTION_ORDER = ['Reading & Writing — Module 1', 'Reading & Writing — Module 2', 'Break (~10 min)', 'Math — Module 1', 'Math — Module 2'];

export function FullTestSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mistakeResurfaceDays, setMistakeResurfaceDays] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getOrCreateUserSettings(user.id)
      .then((row) => {
        if (!cancelled) setMistakeResurfaceDays(row.mistake_resurface_days);
      })
      .catch(() => {
        // Non-critical — selectQuestionIds falls back to its own default.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const begin = useCallback(async () => {
    if (!user) {
      setError('Not signed in.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // R&W Module 1's mix is fixed difficulty weights (not adaptive — that's
      // Module 2 only), sampled per `tier_difficulty_profiles.module1` via
      // selectTieredQuestionIds, mistake-resurfacing-aware same as the
      // Ad-hoc Builder.
      const rwM1IdsRaw = await selectTieredQuestionIds({
        subject: 'Reading and Writing',
        tier: 'module1',
        count: RW_MODULE_QUESTION_COUNT,
        resurfaceForUserId: user.id,
        mistakeResurfaceDays,
      });
      // Real official domain order within the module (Craft and Structure ->
      // Information and Ideas -> Standard English Conventions -> Expression
      // of Ideas), per College Board's Assessment Framework Table 9 — applied
      // after difficulty-band sampling so the module's real 30/45/25
      // easy/medium/hard mix is preserved, just resequenced by domain.
      const rwM1Ids = await orderByOfficialSequence(rwM1IdsRaw);

      const session = await createPracticeSession({
        userId: user.id,
        mode: 'full_test',
        questionIds: rwM1Ids,
        // Full 4-module test size (R&W 27+27, Math 22+22 = 98), even though
        // only Module 1 is assembled yet — this is the session's eventual
        // total, matching TEST_BLUEPRINTS' section counts (R&W 54, Math 44).
        requestedCount: RW_MODULE_QUESTION_COUNT * 2 + MATH_MODULE_QUESTION_COUNT * 2,
        timerMode: 'per_question',
        timerBasis: 'official_pace',
        feedbackMode: 'end_of_session',
        includeRetired: true,
        // Module 1's own pacing — Player re-seeds this to each new module's
        // pacing as the test progresses (see updateSessionAllottedSeconds).
        allottedSeconds: RW_MODULE_SECONDS,
      });
      await createSessionModule({
        sessionId: session.id,
        moduleNumber: 1,
        subject: 'Reading and Writing',
        questionIds: rwM1Ids,
        tier: null,
      });
      setSessionOrigin(session.id, '/test/new');
      navigate(`/practice/${session.id}/q/1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test.');
    } finally {
      setStarting(false);
    }
  }, [user, navigate, mistakeResurfaceDays]);

  return (
    <AppShell title="Full Test Setup">
      <div className="fts-card">
        <p className="fts-label">Module structure — fixed, matches the real exam format</p>
        <div className="fts-diagram">
          <div className="fts-node m1">
            <span className="fts-node-title">Module 1</span>
            <span className="fts-node-sub">fixed mix, all difficulty levels</span>
          </div>
          <span className="fts-arrow">→</span>
          <div className="fts-branch">
            <div className="fts-node tier1">
              <span className="fts-node-title">Module 2 · Tier 1</span>
              <span className="fts-node-sub">harder pool</span>
              <span className="fts-branch-cond">if Module 1 score is strong</span>
            </div>
            <div className="fts-node tier2">
              <span className="fts-node-title">Module 2 · Tier 2</span>
              <span className="fts-node-sub">easier pool</span>
              <span className="fts-branch-cond">if Module 1 score is weaker</span>
            </div>
          </div>
        </div>
      </div>

      <div className="fts-card">
        <p className="fts-label">Section order</p>
        <ol className="fts-order">
          {SECTION_ORDER.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <div className="fts-warning">
        <p className="fts-warning-title">⚠ Unverified routing threshold</p>
        <p>
          The real Module 1 → Module 2 tier-routing cutoff isn&apos;t publicly documented by the source. BluePrep&apos;s
          threshold is a calibrated approximation, not a reverse-engineered exact match — treat the tier you land in as
          a reasonable estimate of difficulty, not a precise score cut.
        </p>
      </div>

      {error && <p className="fts-error">{error}</p>}
      <button className="fts-begin-btn" disabled={starting} onClick={() => void begin()}>
        {starting ? 'Starting…' : 'Begin full test → (Module 1)'}
      </button>
    </AppShell>
  );
}
