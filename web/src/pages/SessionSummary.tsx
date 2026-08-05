import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import {
  createPracticeSession,
  getSessionWithAttempts,
  type AttemptWithQuestion,
} from '../lib/practiceSessions';
import type { Database } from '../lib/database.types';
import './SessionSummary.css';

// ---------------------------------------------------------------------------
// Storyboard screen 7 (/sessions/:sessionId). Reads this session's frozen
// `practice_sessions.score_summary` jsonb, joined against every
// `question_attempts` row with this session_id (question text/domain via
// `questions`). Missed questions link into /practice/:sessionId/q/:n — the
// same route the Player uses — since no separate review-card route exists
// yet.
// ---------------------------------------------------------------------------

type PracticeSessionRow = Database['public']['Tables']['practice_sessions']['Row'];
type Subject = 'math' | 'rw';

function toSubjectShort(subject: string): Subject {
  return subject === 'Math' ? 'math' : 'rw';
}

interface DomainBreakdown {
  subject: Subject;
  label: string;
  correct: number;
  total: number;
}

function domainBreakdownFrom(attempts: AttemptWithQuestion[]): DomainBreakdown[] {
  const stats = new Map<string, { subject: Subject; correct: number; total: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null) continue;
    const subj = toSubjectShort(a.questions.subject);
    const key = a.questions.domain;
    const entry = stats.get(key) ?? { subject: subj, correct: 0, total: 0 };
    entry.total += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(key, entry);
  }
  return Array.from(stats.entries())
    .map(([label, s]) => ({ subject: s.subject, label, correct: s.correct, total: s.total }))
    .sort((a, b) => (a.subject === b.subject ? a.label.localeCompare(b.label) : a.subject.localeCompare(b.subject)));
}

export function SessionSummary() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<{ session: PracticeSessionRow; attempts: AttemptWithQuestion[] } | null | undefined>(
    undefined
  );
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getSessionWithAttempts(sessionId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load session.');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const domainBreakdown = useMemo(() => (data ? domainBreakdownFrom(data.attempts) : []), [data]);

  const totals = useMemo(() => {
    if (!data) return { correct: 0, total: 0, pct: 0 };
    const scored = data.attempts.filter((a) => a.is_correct !== null);
    const correct = scored.filter((a) => a.is_correct).length;
    return { correct, total: scored.length, pct: scored.length > 0 ? Math.round((correct / scored.length) * 100) : 0 };
  }, [data]);

  const missed = useMemo(() => (data ? data.attempts.filter((a) => a.is_correct === false) : []), [data]);

  const retryMistakes = async () => {
    if (!user || missed.length === 0) return;
    setRetrying(true);
    setError(null);
    try {
      const session = await createPracticeSession({
        userId: user.id,
        mode: 'retry_mistakes',
        questionIds: missed.map((a) => a.question_id),
        requestedCount: missed.length,
        timerMode: 'per_question',
        timerBasis: 'none',
        feedbackMode: 'immediate',
        includeRetired: true,
      });
      navigate(`/practice/${session.id}/q/1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start retry session.');
      setRetrying(false);
    }
  };

  if (data === undefined) {
    return (
      <AppShell title="Session Summary">
        <p className="ss-session-id mono">session {sessionId}</p>
        <p>Loading…</p>
      </AppShell>
    );
  }

  if (data === null) {
    return (
      <AppShell title="Session Summary">
        <p className="ss-session-id mono">session {sessionId}</p>
        <div className="ss-card">
          <p className="ss-label">Session not found</p>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            This session doesn&apos;t exist, or you don&apos;t have access to it.
          </p>
          <Link to="/" className="ss-retry-btn" style={{ display: 'inline-block', marginTop: 12 }}>
            Back to Dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  const { attempts } = data;

  return (
    <AppShell title="Session Summary">
      <p className="ss-session-id mono">session {sessionId}</p>
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="ss-top-grid">
        <div className="ss-card ss-score-card">
          <p className="ss-label">Score</p>
          <div className="ss-score-big">{totals.pct}%</div>
          <p className="ss-score-sub">
            {totals.correct} of {totals.total} correct
          </p>
        </div>
        <div className="ss-card">
          <p className="ss-label">By domain</p>
          {domainBreakdown.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>No scored questions in this session yet.</p>
          ) : (
            <div className="ss-domain-list">
              {domainBreakdown.map((d) => (
                <div key={d.label} className="ss-domain-row">
                  <span className={`subj-chip ${d.subject}`}>{d.subject === 'math' ? 'Math' : 'R&W'}</span>
                  <span className="ss-domain-label">{d.label}</span>
                  <div className="ss-domain-bar-track">
                    <div className={`ss-domain-bar ${d.subject}`} style={{ width: `${(d.correct / d.total) * 100}%` }} />
                  </div>
                  <span className="ss-domain-frac mono">
                    {d.correct}/{d.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ss-card">
        <p className="ss-label">Question-by-question</p>
        {attempts.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>No attempts recorded for this session.</p>
        ) : (
          <div className="ss-qlist">
            {attempts.map((a) => {
              const subj = a.questions ? toSubjectShort(a.questions.subject) : 'math';
              const domain = a.questions?.domain ?? '—';
              const time = a.time_taken_seconds ?? 0;
              return a.is_correct ? (
                <div key={a.id} className="ss-qrow">
                  <span className="ss-qn mono">Q{a.attempt_number}</span>
                  <span className={`subj-chip ${subj}`}>{subj === 'math' ? 'Math' : 'R&W'}</span>
                  <span className="ss-qdomain">{domain}</span>
                  <span className="ss-qtime mono">{time}s</span>
                  <span className="ss-qresult correct">Correct</span>
                </div>
              ) : (
                <Link key={a.id} to={`/practice/${sessionId}/q/${a.attempt_number}`} className="ss-qrow missed">
                  <span className="ss-qn mono">Q{a.attempt_number}</span>
                  <span className={`subj-chip ${subj}`}>{subj === 'math' ? 'Math' : 'R&W'}</span>
                  <span className="ss-qdomain">{domain}</span>
                  <span className="ss-qtime mono">{time}s</span>
                  <span className="ss-qresult missed">Review →</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <button className="ss-retry-btn" onClick={() => void retryMistakes()} disabled={missed.length === 0 || retrying}>
        {retrying ? 'Starting…' : `Retry mistakes from this set (${missed.length})`}
      </button>
    </AppShell>
  );
}
