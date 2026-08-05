import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './MistakeLog.css';

// ---------------------------------------------------------------------------
// Storyboard screen 9 (/mistakes). Mock data only — TODO: query is a join of
// `question_attempts` filtered to the latest attempt per question_id being
// incorrect (not scoped to one session — persistent, matches
// user_settings.mistake_resurface_days). "Retry all" creates a new
// practice_sessions row with mode='retry_mistakes'.
// ---------------------------------------------------------------------------

type Subject = 'math' | 'rw';

interface Mistake {
  questionId: string;
  subject: Subject;
  domain: string;
  stemPreview: string;
  lastAttemptedAt: string;
  missCount: number;
}

const MISTAKES: Mistake[] = [
  { questionId: 'q-1', subject: 'math', domain: 'Advanced Math', stemPreview: 'Which of the following is equivalent to (x² − 9)/(x − 3)…', lastAttemptedAt: '2026-08-04', missCount: 2 },
  { questionId: 'q-2', subject: 'rw', domain: 'Standard English Conventions', stemPreview: 'Which choice completes the text with the most logical transition?', lastAttemptedAt: '2026-08-04', missCount: 1 },
  { questionId: 'q-3', subject: 'math', domain: 'Geometry & Trig', stemPreview: 'A right triangle has legs of length 6 and 8. What is…', lastAttemptedAt: '2026-08-03', missCount: 1 },
  { questionId: 'q-4', subject: 'rw', domain: 'Craft and Structure', stemPreview: 'As used in the text, "temper" most nearly means…', lastAttemptedAt: '2026-08-02', missCount: 3 },
  { questionId: 'q-5', subject: 'rw', domain: 'Standard English Conventions', stemPreview: 'Which choice completes the text so that it conforms to conventions…', lastAttemptedAt: '2026-08-01', missCount: 1 },
  { questionId: 'q-6', subject: 'math', domain: 'Problem-Solving & Data Analysis', stemPreview: 'The scatterplot shows the relationship between…', lastAttemptedAt: '2026-07-30', missCount: 1 },
];

type SubjectFilter = 'all' | Subject;

export function MistakeLog() {
  const navigate = useNavigate();
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');

  const domains = useMemo(() => Array.from(new Set(MISTAKES.map((m) => m.domain))), []);

  const filtered = MISTAKES.filter(
    (m) => (subjectFilter === 'all' || m.subject === subjectFilter) && (domainFilter === 'all' || m.domain === domainFilter)
  );

  const retryAll = () => {
    // TODO: new practice_sessions row, mode='retry_mistakes', question_ids
    // set to exactly `filtered`'s question ids.
    navigate('/practice/new');
  };

  return (
    <AppShell title="Mistake Log">
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
        <button className="ml-retry-btn" onClick={retryAll} disabled={filtered.length === 0}>
          Retry all ({filtered.length})
        </button>
      </div>

      <div className="ml-card">
        <p className="ml-label">Mistake rows</p>
        {filtered.length === 0 ? (
          <p className="ml-empty">No mistakes match these filters — nice work.</p>
        ) : (
          <div className="ml-list">
            {filtered.map((m) => (
              <Link key={m.questionId} to={`/practice/retry/q/${m.questionId}`} className="ml-row">
                <span className={`subj-chip ${m.subject}`}>{m.subject === 'math' ? 'Math' : 'R&W'}</span>
                <div className="ml-row-mid">
                  <span className="ml-row-domain">{m.domain}</span>
                  <span className="ml-row-stem">{m.stemPreview}</span>
                </div>
                <span className="ml-row-miss mono">
                  missed {m.missCount}×
                </span>
                <span className="ml-row-date mono">{m.lastAttemptedAt}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
