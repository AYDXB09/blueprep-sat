import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './FullTestSetup.css';
import { useAuth } from '../lib/AuthContext';
import { createPracticeSession, selectTieredQuestionIds } from '../lib/practiceSessions';
import { getOrCreateUserSettings } from '../lib/userSettings';
import { setSessionOrigin } from '../lib/sessionOrigin';

// ---------------------------------------------------------------------------
// Storyboard screen 4 (/test/new). Unlike the Ad-hoc Builder, a full test's
// module structure is fixed — nothing here is user-configured, it's a
// confirmation + explanation screen. Module 2 tier routing is decided from
// Module 1 performance after the fact, not chosen up front.
// ---------------------------------------------------------------------------

const SECTION_ORDER = ['Reading & Writing — Module 1', 'Reading & Writing — Module 2', 'Break (~10 min)', 'Math — Module 1', 'Math — Module 2'];

// TEST_BLUEPRINTS module pacing (index.html:1997-1998): R&W module = 27q,
// Math module = 22q — Module 1 is fixed-mix at these sizes regardless of
// tier (tier only affects Module 2's difficulty pool).
const RW_MODULE1_COUNT = 27;
const MATH_MODULE1_COUNT = 22;

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
      // Module 1's mix is fixed difficulty weights (not adaptive — that's
      // Module 2 only), sampled per `tier_difficulty_profiles.module1` via
      // selectTieredQuestionIds, mistake-resurfacing-aware same as the
      // Ad-hoc Builder. Module 2's tier (and its own question set) is
      // decided after Module 1 completes, so it isn't assembled here.
      const [rwIds, mathIds] = await Promise.all([
        selectTieredQuestionIds({
          subject: 'Reading and Writing',
          tier: 'module1',
          count: RW_MODULE1_COUNT,
          resurfaceForUserId: user.id,
          mistakeResurfaceDays,
        }),
        selectTieredQuestionIds({
          subject: 'Math',
          tier: 'module1',
          count: MATH_MODULE1_COUNT,
          resurfaceForUserId: user.id,
          mistakeResurfaceDays,
        }),
      ]);
      const questionIds = [...rwIds, ...mathIds];

      const session = await createPracticeSession({
        userId: user.id,
        mode: 'full_test',
        questionIds,
        requestedCount: RW_MODULE1_COUNT + MATH_MODULE1_COUNT,
        timerMode: 'per_question',
        timerBasis: 'official_pace',
        feedbackMode: 'end_of_session',
        includeRetired: true,
        // R&W Module 1 (32 min) + Math Module 1 (35 min) official blueprint pacing.
        allottedSeconds: (32 + 35) * 60,
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
