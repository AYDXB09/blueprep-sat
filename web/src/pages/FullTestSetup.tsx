import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './FullTestSetup.css';
import { useAuth } from '../lib/AuthContext';
import { createPracticeSession } from '../lib/practiceSessions';

// ---------------------------------------------------------------------------
// Storyboard screen 4 (/test/new). Unlike the Ad-hoc Builder, a full test's
// module structure is fixed — nothing here is user-configured, it's a
// confirmation + explanation screen. Module 2 tier routing is decided from
// Module 1 performance after the fact, not chosen up front.
// ---------------------------------------------------------------------------

const SECTION_ORDER = ['Reading & Writing — Module 1', 'Reading & Writing — Module 2', 'Break (~10 min)', 'Math — Module 1', 'Math — Module 2'];

export function FullTestSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(async () => {
    if (!user) {
      setError('Not signed in.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const session = await createPracticeSession({
        userId: user.id,
        mode: 'full_test',
        // TODO: Module 1's fixed question mix hasn't been assembled yet —
        // the real bank import + tier_difficulty_profiles sampling plugs in
        // here. Module 2's tier is decided after Module 1 completes, so it
        // isn't part of this initial session creation at all.
        questionIds: [],
        requestedCount: 54, // R&W module + Math module official full-test size, pre-adaptive
        timerMode: 'per_question',
        timerBasis: 'official_pace',
        feedbackMode: 'end_of_session',
        includeRetired: true,
      });
      navigate(`/practice/${session.id}/q/1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start test.');
    } finally {
      setStarting(false);
    }
  }, [user, navigate]);

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
