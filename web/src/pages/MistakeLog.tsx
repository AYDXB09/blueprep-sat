import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import {
  createPracticeSession,
  getMistakes,
  getQuestionIdsWithCues,
  type Mistake,
  type SubjectFilter,
} from '../lib/practiceSessions';
import { fmtDate } from '../lib/format';
import './MistakeLog.css';

// ---------------------------------------------------------------------------
// Storyboard screen 9 (/mistakes). Real query: `question_attempts` filtered
// to the latest attempt per question_id being incorrect, for this user (see
// getMistakes in practiceSessions.ts). "Retry all" creates a new
// practice_sessions row with mode='retry_mistakes', question_ids = the
// currently-filtered mistake list. Clicking a single mistake row does the
// same thing scoped to that one question — there's no standalone
// "review card" route, so this reuses the real Player instead of linking to
// a route that doesn't exist.
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
  const [search, setSearch] = useState('');
  const [cuedQuestionIds, setCuedQuestionIds] = useState<Set<string>>(new Set());

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

  // Which mistakes have any cues, for the row indicator.
  useEffect(() => {
    if (!mistakes || mistakes.length === 0) return;
    let cancelled = false;
    getQuestionIdsWithCues(mistakes.map((m) => m.questionId))
      .then((ids) => {
        if (!cancelled) setCuedQuestionIds(ids);
      })
      .catch(() => {
        if (!cancelled) setCuedQuestionIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [mistakes]);

  // Domain options are scoped to the selected subject — picking "Math" should
  // only ever offer Math domains in the dropdown, not R&W ones alongside them.
  const domains = useMemo(() => {
    const bySubject = (mistakes ?? []).filter((m) => subjectFilter === 'all' || toSubjectShort(m.subject) === subjectFilter);
    return Array.from(new Set(bySubject.map((m) => m.domain))).sort();
  }, [mistakes, subjectFilter]);

  // If the subject changes and the previously-selected domain no longer
  // applies (e.g. a Math domain while R&W is now selected), reset it rather
  // than silently filtering to zero results.
  useEffect(() => {
    if (domainFilter !== 'all' && !domains.includes(domainFilter)) setDomainFilter('all');
  }, [domains, domainFilter]);

  const searchNorm = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!mistakes) return [];
    return mistakes.filter((m) => {
      if (subjectFilter !== 'all' && toSubjectShort(m.subject) !== subjectFilter) return false;
      if (domainFilter !== 'all' && m.domain !== domainFilter) return false;
      if (searchNorm) {
        const idMatch = m.sourceExternalId?.toLowerCase().includes(searchNorm);
        const stemMatch = m.stemPreview.toLowerCase().includes(searchNorm);
        if (!idMatch && !stemMatch) return false;
      }
      return true;
    });
  }, [mistakes, subjectFilter, domainFilter, searchNorm]);

  const [startingQuestionId, setStartingQuestionId] = useState<string | null>(null);

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

  const retryOne = async (m: Mistake) => {
    if (!user || startingQuestionId) return;
    setStartingQuestionId(m.questionId);
    setError(null);
    try {
      const session = await createPracticeSession({
        userId: user.id,
        mode: 'retry_mistakes',
        questionIds: [m.questionId],
        requestedCount: 1,
        timerMode: 'per_question',
        timerBasis: 'none',
        feedbackMode: 'immediate',
        includeRetired: true,
        subjectFilter: toSubjectFull(toSubjectShort(m.subject)),
      });
      navigate(`/practice/${session.id}/q/1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start retry session.');
      setStartingQuestionId(null);
    }
  };

  const loading = mistakes === null;

  return (
    <AppShell title="Mistake Log">
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="ml-filter-bar">
        <div className="ml-seg" role="group" aria-label="Filter by subject">
          <button
            type="button"
            className={`ml-seg-btn math${subjectFilter === 'math' ? ' active' : ''}`}
            aria-pressed={subjectFilter === 'math'}
            onClick={() => setSubjectFilter('math')}
          >
            Math
          </button>
          <button
            type="button"
            className={`ml-seg-btn rw${subjectFilter === 'rw' ? ' active' : ''}`}
            aria-pressed={subjectFilter === 'rw'}
            onClick={() => setSubjectFilter('rw')}
          >
            R&amp;W
          </button>
          <button
            type="button"
            className={`ml-seg-btn both${subjectFilter === 'all' ? ' active' : ''}`}
            aria-pressed={subjectFilter === 'all'}
            onClick={() => setSubjectFilter('all')}
          >
            Both
          </button>
        </div>
        <select className="ml-domain-select" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
          <option value="all">Filter: Domain</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          className="ml-search"
          type="search"
          placeholder="Search by question ID or text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
              const starting = startingQuestionId === m.questionId;
              return (
                <button
                  key={m.questionId}
                  type="button"
                  className="ml-row"
                  onClick={() => void retryOne(m)}
                  disabled={startingQuestionId !== null}
                >
                  <span className={`subj-chip ${subj}`}>{subj === 'math' ? 'Math' : 'R&W'}</span>
                  <div className="ml-row-mid">
                    <span className="ml-row-domain">
                      {m.domain}
                      {m.sourceExternalId && <span className="ml-row-cbid mono"> · {m.sourceExternalId}</span>}
                      {cuedQuestionIds.has(m.questionId) && <span title="Has trap/cue analysis"> 💡</span>}
                    </span>
                    <span className="ml-row-stem">{m.stemPreview}</span>
                  </div>
                  <span className="ml-row-miss mono">missed {m.missCount}×</span>
                  <span className="ml-row-date mono">
                    {starting ? 'Starting…' : fmtDate(m.lastAttemptedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
