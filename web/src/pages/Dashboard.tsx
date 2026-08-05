import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { getAllAttemptsForUser, getRecentSessions, type AttemptWithQuestion } from '../lib/practiceSessions';
import type { Database } from '../lib/database.types';
import './Dashboard.css';

// ---------------------------------------------------------------------------
// Storyboard screen 2 (/dashboard, mapped here to route "/"). Reads
// practice_sessions (score trend, streak, recent list) and question_attempts
// joined to questions (weakest domain). All-new users see empty states
// instead of 0%/0-day placeholders — see EmptyDashboardCards below.
// ---------------------------------------------------------------------------

type PracticeSessionRow = Database['public']['Tables']['practice_sessions']['Row'];

type Subject = 'math' | 'rw';

function toSubjectShort(subject: string | null): Subject | 'both' {
  if (subject === 'Math') return 'math';
  if (subject === 'Reading and Writing') return 'rw';
  return 'both';
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'full_test':
      return 'Full test';
    case 'practice_set':
      return 'Practice set';
    case 'ad_hoc':
      return 'Ad-hoc practice';
    case 'retry_mistakes':
      return 'Retry mistakes';
    default:
      return mode;
  }
}

function scorePctOf(session: PracticeSessionRow): number | null {
  const summary = session.score_summary as { pct?: number; correct?: number; total?: number } | null;
  if (summary && typeof summary.pct === 'number') return Math.round(summary.pct);
  if (summary && typeof summary.correct === 'number' && typeof summary.total === 'number' && summary.total > 0) {
    return Math.round((summary.correct / summary.total) * 100);
  }
  return null;
}

function sparklinePoints(values: number[], w: number, h: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/** Consecutive-day streak of completed sessions, counted back from today (or
 * yesterday, so a streak doesn't reset at midnight before the user has had a
 * chance to practice today). */
function computeStreak(sessions: PracticeSessionRow[]): number {
  const days = new Set(sessions.filter((s) => s.completed_at).map((s) => dayKey(s.completed_at as string)));
  if (days.size === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = new Date(today);
  if (!days.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(cursor.toDateString())) return 0;
  }

  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function weakestDomain(attempts: AttemptWithQuestion[]): { subject: Subject; label: string; accuracyPct: number } | null {
  const stats = new Map<string, { subject: Subject; correct: number; total: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null) continue;
    const key = a.questions.domain;
    const subj = toSubjectShort(a.questions.subject);
    if (subj === 'both') continue;
    const entry = stats.get(key) ?? { subject: subj, correct: 0, total: 0 };
    entry.total += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(key, entry);
  }
  let worst: { subject: Subject; label: string; accuracyPct: number } | null = null;
  for (const [label, s] of stats) {
    if (s.total < 3) continue; // not enough data to call it "weakest" yet
    const pct = Math.round((s.correct / s.total) * 100);
    if (!worst || pct < worst.accuracyPct) worst = { subject: s.subject, label, accuracyPct: pct };
  }
  return worst;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<PracticeSessionRow[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptWithQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getRecentSessions(user.id, 20), getAllAttemptsForUser(user.id)])
      .then(([s, a]) => {
        if (cancelled) return;
        setSessions(s);
        setAttempts(a);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const scoreTrend = useMemo(() => {
    if (!sessions) return [];
    return [...sessions]
      .reverse()
      .map(scorePctOf)
      .filter((v): v is number => v !== null)
      .slice(-7);
  }, [sessions]);

  const streak = useMemo(() => (sessions ? computeStreak(sessions) : 0), [sessions]);
  const weakest = useMemo(() => (attempts ? weakestDomain(attempts) : null), [attempts]);
  const recent = useMemo(() => (sessions ?? []).slice(0, 5), [sessions]);

  const loading = sessions === null || attempts === null;

  return (
    <AppShell title="Dashboard">
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="dash-grid">
        <div className="dash-card">
          <p className="dash-label">Score trend</p>
          {loading ? (
            <p className="dash-sub">Loading…</p>
          ) : scoreTrend.length === 0 ? (
            <div className="dash-empty">
              <p className="dash-empty-text">No completed sessions yet.</p>
              <button className="dash-empty-cta" onClick={() => navigate('/practice/new')}>
                Start your first practice set
              </button>
            </div>
          ) : (
            <div className="dash-sparkline-row">
              <svg viewBox="0 0 100 32" className="dash-sparkline" preserveAspectRatio="none">
                <polyline points={sparklinePoints(scoreTrend, 100, 32)} fill="none" stroke="var(--navy)" strokeWidth="2" />
              </svg>
              <div>
                <div className="dash-big">{scoreTrend[scoreTrend.length - 1]}%</div>
                {scoreTrend.length > 1 && (
                  <div className={`dash-delta${scoreTrend[scoreTrend.length - 1] >= scoreTrend[scoreTrend.length - 2] ? ' up' : ' down'}`}>
                    {scoreTrend[scoreTrend.length - 1] >= scoreTrend[scoreTrend.length - 2] ? '▲' : '▼'}{' '}
                    {Math.abs(scoreTrend[scoreTrend.length - 1] - scoreTrend[scoreTrend.length - 2])}pt vs. last session
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="dash-card">
          <p className="dash-label">Streak</p>
          {loading ? (
            <p className="dash-sub">Loading…</p>
          ) : streak === 0 ? (
            <div className="dash-empty">
              <p className="dash-empty-text">No streak yet — practice today to start one.</p>
            </div>
          ) : (
            <>
              <div className="dash-big">{streak} day{streak === 1 ? '' : 's'}</div>
              <p className="dash-sub">Practiced {streak} day{streak === 1 ? '' : 's'} in a row — keep it going.</p>
            </>
          )}
        </div>

        <div className="dash-card">
          <p className="dash-label">Weakest skill</p>
          {loading ? (
            <p className="dash-sub">Loading…</p>
          ) : !weakest ? (
            <div className="dash-empty">
              <p className="dash-empty-text">Not enough attempts yet to identify a weak spot.</p>
            </div>
          ) : (
            <>
              <span className={`subj-chip ${weakest.subject}`}>{weakest.subject === 'math' ? 'Math' : 'R&W'}</span>
              <div className="dash-big" style={{ marginTop: 6 }}>
                {weakest.accuracyPct}%
              </div>
              <p className="dash-sub">{weakest.label}</p>
            </>
          )}
        </div>
      </div>

      <div className="dash-actions">
        <button className="dash-action-btn navy" onClick={() => navigate('/test/new')}>
          <span className="dash-action-title">Start Full Test</span>
          <span className="dash-action-sub">Fixed module structure, adaptive Module 2</span>
        </button>
        <button className="dash-action-btn" onClick={() => navigate('/practice/new')}>
          <span className="dash-action-title">Ad-hoc Practice</span>
          <span className="dash-action-sub">Pick subjects, counts, and timing yourself</span>
        </button>
      </div>

      <div className="dash-card dash-recent">
        <p className="dash-label">Recent sessions</p>
        {loading ? (
          <p className="dash-sub">Loading…</p>
        ) : recent.length === 0 ? (
          <div className="dash-empty">
            <p className="dash-empty-text">You haven&apos;t completed a session yet.</p>
            <button className="dash-empty-cta" onClick={() => navigate('/practice/new')}>
              Start your first practice set
            </button>
          </div>
        ) : (
          <div className="dash-session-list">
            {recent.map((s) => {
              const subj = toSubjectShort(s.subject_filter);
              const pct = scorePctOf(s);
              return (
                <Link key={s.id} to={`/sessions/${s.id}`} className="dash-session-row">
                  <span className={`subj-chip ${subj}`}>{subj === 'both' ? 'Both' : subj === 'math' ? 'Math' : 'R&W'}</span>
                  <span className="dash-session-mode">{modeLabel(s.mode)}</span>
                  <span className="dash-session-count mono">{s.actual_count ?? s.requested_count}q</span>
                  <span className="dash-session-date mono">{fmtDate(s.completed_at as string)}</span>
                  <span className={`dash-session-score${pct !== null && pct >= 70 ? ' good' : ''}`}>
                    {pct !== null ? `${pct}%` : '—'}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
