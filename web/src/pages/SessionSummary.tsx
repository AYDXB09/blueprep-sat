import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './SessionSummary.css';

// ---------------------------------------------------------------------------
// Storyboard screen 7 (/sessions/:sessionId). Mock data only — TODO: replace
// with a read of this session's frozen `practice_sessions.score_summary`
// jsonb, joined against every `question_attempts` row with this session_id
// (question text/domain via `questions`). Every missed question links into
// its own review card (trap/cue overlay), which also lives outside this task.
// ---------------------------------------------------------------------------

type Subject = 'math' | 'rw';

interface DomainBreakdown {
  subject: Subject;
  label: string;
  correct: number;
  total: number;
}

interface AttemptRow {
  n: number;
  subject: Subject;
  domain: string;
  correct: boolean;
  timeTakenSeconds: number;
}

const DOMAIN_BREAKDOWN: DomainBreakdown[] = [
  { subject: 'math', label: 'Algebra', correct: 8, total: 10 },
  { subject: 'math', label: 'Advanced Math', correct: 5, total: 8 },
  { subject: 'rw', label: 'Craft and Structure', correct: 7, total: 9 },
  { subject: 'rw', label: 'Standard English Conventions', correct: 4, total: 10 },
];

const ATTEMPTS: AttemptRow[] = Array.from({ length: 37 }, (_, i) => {
  const subject: Subject = i % 2 === 0 ? 'math' : 'rw';
  const domain =
    subject === 'math'
      ? DOMAIN_BREAKDOWN.filter((d) => d.subject === 'math')[i % 2].label
      : DOMAIN_BREAKDOWN.filter((d) => d.subject === 'rw')[i % 2].label;
  const correct = (i * 7 + 3) % 10 > 2; // deterministic pseudo-random mock pattern
  return { n: i + 1, subject, domain, correct, timeTakenSeconds: 45 + ((i * 13) % 90) };
});

export function SessionSummary() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const totals = useMemo(() => {
    const correct = ATTEMPTS.filter((a) => a.correct).length;
    return { correct, total: ATTEMPTS.length, pct: Math.round((correct / ATTEMPTS.length) * 100) };
  }, []);

  const missed = ATTEMPTS.filter((a) => !a.correct);

  const retryMistakes = () => {
    // TODO: creates a new practice_sessions row with mode='retry_mistakes'
    // and question_ids set to this session's missed questions.
    navigate('/practice/new');
  };

  return (
    <AppShell title="Session Summary">
      <p className="ss-session-id mono">session {sessionId}</p>

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
          <div className="ss-domain-list">
            {DOMAIN_BREAKDOWN.map((d) => (
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
        </div>
      </div>

      <div className="ss-card">
        <p className="ss-label">Question-by-question</p>
        <div className="ss-qlist">
          {ATTEMPTS.map((a) =>
            a.correct ? (
              <div key={a.n} className="ss-qrow">
                <span className="ss-qn mono">Q{a.n}</span>
                <span className={`subj-chip ${a.subject}`}>{a.subject === 'math' ? 'Math' : 'R&W'}</span>
                <span className="ss-qdomain">{a.domain}</span>
                <span className="ss-qtime mono">{a.timeTakenSeconds}s</span>
                <span className="ss-qresult correct">Correct</span>
              </div>
            ) : (
              <Link key={a.n} to={`/practice/${sessionId}/q/${a.n}`} className="ss-qrow missed">
                <span className="ss-qn mono">Q{a.n}</span>
                <span className={`subj-chip ${a.subject}`}>{a.subject === 'math' ? 'Math' : 'R&W'}</span>
                <span className="ss-qdomain">{a.domain}</span>
                <span className="ss-qtime mono">{a.timeTakenSeconds}s</span>
                <span className="ss-qresult missed">Review →</span>
              </Link>
            )
          )}
        </div>
      </div>

      <button className="ss-retry-btn" onClick={retryMistakes}>
        Retry mistakes from this set ({missed.length})
      </button>
    </AppShell>
  );
}
