import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { getAllAttemptsForUser, getRecentSessions, type AttemptWithQuestion } from '../lib/practiceSessions';
import { fmtDate } from '../lib/format';
import type { Database } from '../lib/database.types';
import './Progress.css';

// ---------------------------------------------------------------------------
// Storyboard screen 8 (/progress). Aggregates every practice_sessions +
// question_attempts row for this user. Pace buckets (rushed / slow-right /
// slow-wrong / on-pace) compare each attempt's time_taken_seconds against the
// question's subject's official per-question pace (same PACE constants used
// in PracticeBuilder): Math ~95.45s/q, R&W ~71.1s/q.
// ---------------------------------------------------------------------------

type PracticeSessionRow = Database['public']['Tables']['practice_sessions']['Row'];
type Subject = 'math' | 'rw';

const PACE_SECONDS: Record<Subject, number> = { math: 95.45, rw: 71.1 };

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

function linePoints(values: number[], w: number, h: number): string {
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

interface DomainAccuracy {
  subject: Subject;
  label: string;
  correct: number;
  total: number;
  pct: number;
}

function domainAccuracyFrom(attempts: AttemptWithQuestion[]): DomainAccuracy[] {
  const stats = new Map<string, { subject: Subject; correct: number; total: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null) continue;
    const subj = toSubjectShort(a.questions.subject);
    if (subj === 'both') continue;
    const key = a.questions.domain;
    const entry = stats.get(key) ?? { subject: subj, correct: 0, total: 0 };
    entry.total += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(key, entry);
  }
  return Array.from(stats.entries())
    .map(([label, s]) => ({ subject: s.subject, label, correct: s.correct, total: s.total, pct: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => (a.subject === b.subject ? a.label.localeCompare(b.label) : a.subject.localeCompare(b.subject)));
}

interface PaceBucket {
  key: 'rushed' | 'slow-wrong' | 'slow-right' | 'on-pace';
  label: string;
  count: number;
  color: string;
}

function paceBucketsFrom(attempts: AttemptWithQuestion[]): PaceBucket[] {
  let rushed = 0;
  let slowWrong = 0;
  let slowRight = 0;
  let onPace = 0;
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null || a.time_taken_seconds === null) continue;
    const subj = toSubjectShort(a.questions.subject);
    if (subj === 'both') continue;
    const pace = PACE_SECONDS[subj];
    const isSlow = a.time_taken_seconds > pace;
    if (a.is_correct) {
      if (isSlow) slowRight += 1;
      else onPace += 1;
    } else {
      if (isSlow) slowWrong += 1;
      else rushed += 1;
    }
  }
  return [
    { key: 'rushed', label: 'Rushed (wrong, fast)', count: rushed, color: 'var(--red)' },
    { key: 'slow-wrong', label: 'Slow & wrong', count: slowWrong, color: 'var(--rw)' },
    { key: 'slow-right', label: 'Slow but right', count: slowRight, color: 'var(--navy)' },
    { key: 'on-pace', label: 'On-pace & right', count: onPace, color: 'var(--green)' },
  ];
}

export function Progress() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<PracticeSessionRow[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptWithQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getRecentSessions(user.id, 500), getAllAttemptsForUser(user.id)])
      .then(([s, a]) => {
        if (cancelled) return;
        setSessions(s);
        setAttempts(a);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load progress.');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const scoreHistory = useMemo(() => {
    if (!sessions) return [];
    return [...sessions]
      .reverse()
      .map(scorePctOf)
      .filter((v): v is number => v !== null);
  }, [sessions]);

  const domainAccuracy = useMemo(() => (attempts ? domainAccuracyFrom(attempts) : []), [attempts]);
  const paceBuckets = useMemo(() => (attempts ? paceBucketsFrom(attempts) : []), [attempts]);
  const paceTotal = paceBuckets.reduce((s, b) => s + b.count, 0);
  const weakest = domainAccuracy.length > 0 ? [...domainAccuracy].sort((a, b) => a.pct - b.pct)[0] : null;

  const loading = sessions === null || attempts === null;
  const history = sessions ?? [];

  return (
    <AppShell title="Progress & Score Tracking">
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="prog-card">
        <p className="prog-label">Score over time (all sessions)</p>
        {loading ? (
          <p className="prog-hint">Loading…</p>
        ) : scoreHistory.length === 0 ? (
          <div className="prog-empty">
            <p className="prog-empty-text">No completed sessions yet — your score trend will show up here.</p>
            <button className="prog-empty-cta" onClick={() => navigate('/practice/new')}>
              Start your first practice set
            </button>
          </div>
        ) : (
          <>
            <svg viewBox="0 0 300 70" className="prog-linechart" preserveAspectRatio="none">
              <polyline points={linePoints(scoreHistory, 300, 70)} fill="none" stroke="var(--navy)" strokeWidth="2.5" />
            </svg>
            <div className="prog-linechart-labels">
              <span>{scoreHistory.length} session{scoreHistory.length === 1 ? '' : 's'} ago</span>
              <span>most recent</span>
            </div>
          </>
        )}
      </div>

      <div className="prog-grid">
        <div className="prog-card">
          <p className="prog-label">Accuracy by domain</p>
          <div className="prog-chip-row">
            <span className="subj-chip math">Math</span>
            <span className="subj-chip rw">R&amp;W</span>
          </div>
          {loading ? (
            <p className="prog-hint">Loading…</p>
          ) : domainAccuracy.length === 0 ? (
            <p className="prog-empty-text">Answer some questions to see per-domain accuracy.</p>
          ) : (
            <>
              <div className="prog-domain-list">
                {domainAccuracy.map((d) => (
                  <button
                    key={d.label}
                    className="prog-domain-row"
                    onClick={() =>
                      navigate('/practice/new', {
                        state: { presetSubject: d.subject, presetDomainLabel: d.label },
                      })
                    }
                    title="Practice this domain"
                  >
                    <span className={`prog-domain-dot ${d.subject}`} />
                    <span className="prog-domain-label">{d.label}</span>
                    <div className="prog-domain-bar-track">
                      <div className={`prog-domain-bar ${d.subject}`} style={{ width: `${d.pct}%` }} />
                    </div>
                    <span className="prog-domain-pct mono">{d.pct}%</span>
                  </button>
                ))}
              </div>
              {weakest && (
                <p className="prog-hint">
                  Weakest: {weakest.label} ({weakest.pct}%) — click any row to practice it.
                </p>
              )}
            </>
          )}
        </div>

        <div className="prog-card">
          <p className="prog-label">Pace: rushed / slow-right / slow-wrong</p>
          {loading ? (
            <p className="prog-hint">Loading…</p>
          ) : paceTotal === 0 ? (
            <p className="prog-empty-text">Timed attempts will break down here once you have some.</p>
          ) : (
            <>
              <div className="prog-pace-bar">
                {paceBuckets.map((b) => (
                  <div
                    key={b.key}
                    className="prog-pace-seg"
                    style={{ width: `${(b.count / paceTotal) * 100}%`, background: b.color }}
                    title={`${b.label}: ${b.count}`}
                  />
                ))}
              </div>
              <div className="prog-pace-legend">
                {paceBuckets.map((b) => (
                  <div key={b.key} className="prog-pace-legend-row">
                    <span className="prog-pace-dot" style={{ background: b.color }} />
                    <span className="prog-pace-legend-label">{b.label}</span>
                    <span className="prog-pace-legend-count mono">{b.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="prog-card">
        <p className="prog-label">Full session history</p>
        {loading ? (
          <p className="prog-hint">Loading…</p>
        ) : history.length === 0 ? (
          <p className="prog-empty-text">No sessions yet.</p>
        ) : (
          <table className="prog-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Subject</th>
                <th>Questions</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const subj = toSubjectShort(h.subject_filter);
                const pct = scorePctOf(h);
                return (
                  <tr key={h.id}>
                    <td className="mono">{fmtDate(h.completed_at)}</td>
                    <td>{modeLabel(h.mode)}</td>
                    <td>
                      <span className={`subj-chip ${subj}`}>{subj === 'both' ? 'Both' : subj === 'math' ? 'Math' : 'R&W'}</span>
                    </td>
                    <td className="mono">{h.actual_count ?? h.requested_count}</td>
                    <td>
                      <Link to={`/sessions/${h.id}`} className="prog-table-score">
                        {pct !== null ? `${pct}%` : '—'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
