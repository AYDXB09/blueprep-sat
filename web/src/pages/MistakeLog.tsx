import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { createPracticeSession, getMistakes, type Mistake, type SubjectFilter } from '../lib/practiceSessions';
import './MistakeLog.css';

// ---------------------------------------------------------------------------
// Storyboard screen 9 (/mistakes). Real query: `question_attempts` filtered
// to the latest attempt per question_id being incorrect, for this user (see
// getMistakes in practiceSessions.ts). "Retry all" creates a new
// practice_sessions row with mode='retry_mistakes', question_ids = the
// currently-filtered mistake list.
// ---------------------------------------------------------------------------

type Subject = 'math' | 'rw';
type SubjectFilterUi = 'all' | Subject;

function toSubjectShort(subject: string): Subject {
  return subject === 'Math' ? 'math' : 'rw';
}

function toSubjectFull(subject: Subject): SubjectFilter {
  return subject === 'math' ? 'Math' : 'Reading and Writing';
}

export function MistakeLog() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mistakes, setMistakes] = useState<Mistake[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilterUi>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMistakes(user.id)
      .then((m) => {
        if (!cancelled) setMistakes(m);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load mistakes.');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const domains = useMemo(() => Array.from(new Set((mistakes ?? []).map((m) => m.domain))), [mistakes]);

  const filtered = useMemo(() => {
    if (!mistakes) return [];
    return mistakes.filter(
      (m) =>
        (subjectFilter === 'all' || toSubjectShort(m.subject) === subjectFilter) &&
        (domainFilter === 'all' || m.domain === domainFilter)
    );
  }, [mistakes, subjectFilter, domainFilter]);

  const retryAll = async () => {
    if (!user || filtered.length === 0) return;
    setRetrying(true);
    setError(null);
    try {
      const session = await createPracticeSession({
        userId: user.id,
        mode: 'retry_mistakes',
        questionIds: filtered.map((m) => m.questionId),
        requestedCount: filtered.length,
        timerMode: 'per_question',
        timerBasis: 'none',
        feedbackMode: 'immediate',
        includeRetired: true,
        subjectFilter: subjectFilter === 'all' ? null : toSubjectFull(subjectFilter),
      });
      navigate(`/practice/${session.id}/q/1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start retry session.');
      setRetrying(false);
    }
  };

  const loading = mistakes === null;

  return (
    <AppShell title="Mistake Log">
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="ml-filter-bar">
        <button className={`ml-filter-btn math${subjectFilter === 'math' ? ' active' : ''}`} onClick={() => setSubjectFilter(subjectFilter === 'math' ? 'all' : 'math')}>
          Math{subjectFilter === 'math' ? ' ✓' : ''}
        </button>
        <button className={`ml-filter-btn rw${subjectFilter === 'rw' ? ' active' : ''}`} onClick={() => setSubjectFilter(subjectFilter === 'rw' ? 'all' : 'rw')}>
          R&amp;W{subjectFilter === 'rw' ? ' ✓' : ''}
        </button>
        <select className="ml-domain-select" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
          <option value="all">Filter: Domain</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button className="ml-retry-btn" onClick={() => void retryAll()} disabled={filtered.length === 0 || retrying}>
          {retrying ? 'Starting…' : `Retry all (${filtered.length})`}
        </button>
      </div>

      <div className="ml-card">
        <p className="ml-label">Mistake rows</p>
        {loading ? (
          <p className="ml-empty">Loading…</p>
        ) : (mistakes?.length ?? 0) === 0 ? (
          <p className="ml-empty">No mistakes yet — nice work.</p>
        ) : filtered.length === 0 ? (
          <p className="ml-empty">No mistakes match these filters — nice work.</p>
        ) : (
          <div className="ml-list">
            {filtered.map((m) => {
              const subj = toSubjectShort(m.subject);
              return (
                <Link key={m.questionId} to={`/practice/retry/q/${m.questionId}`} className="ml-row">
                  <span className={`subj-chip ${subj}`}>{subj === 'math' ? 'Math' : 'R&W'}</span>
                  <div className="ml-row-mid">
                    <span className="ml-row-domain">{m.domain}</span>
                    <span className="ml-row-stem">{m.stemPreview}</span>
                  </div>
                  <span className="ml-row-miss mono">missed {m.missCount}×</span>
                  <span className="ml-row-date mono">{new Date(m.lastAttemptedAt).toLocaleDateString()}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
