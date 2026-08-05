import { useNavigate, Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './Progress.css';

// ---------------------------------------------------------------------------
// Storyboard screen 8 (/progress). Mock data only — TODO: aggregate across
// every `practice_sessions` + `question_attempts` row for this user. Pace
// buckets (rushed / slow-right / slow-wrong) come from comparing each
// attempt's time_taken_seconds against the question's expected pace and its
// is_correct value — not stored directly, computed at query time.
// ---------------------------------------------------------------------------

type Subject = 'math' | 'rw';

const SCORE_HISTORY = [55, 58, 57, 61, 64, 63, 67, 65, 69, 71, 70, 74];

const DOMAIN_ACCURACY: { subject: Subject; label: string; pct: number }[] = [
  { subject: 'math', label: 'Algebra', pct: 78 },
  { subject: 'math', label: 'Advanced Math', pct: 61 },
  { subject: 'math', label: 'Problem-Solving & Data Analysis', pct: 70 },
  { subject: 'math', label: 'Geometry & Trig', pct: 66 },
  { subject: 'rw', label: 'Information and Ideas', pct: 73 },
  { subject: 'rw', label: 'Craft and Structure', pct: 69 },
  { subject: 'rw', label: 'Expression of Ideas', pct: 75 },
  { subject: 'rw', label: 'Standard English Conventions', pct: 52 },
];

const PACE_BUCKETS = [
  { key: 'rushed', label: 'Rushed (wrong, fast)', count: 14, color: 'var(--red)' },
  { key: 'slow-wrong', label: 'Slow & wrong', count: 9, color: 'var(--rw)' },
  { key: 'slow-right', label: 'Slow but right', count: 21, color: 'var(--navy)' },
  { key: 'on-pace', label: 'On-pace & right', count: 58, color: 'var(--green)' },
];

interface HistoryRow {
  id: string;
  date: string;
  mode: string;
  subject: Subject | 'both';
  scorePct: number;
  questionCount: number;
}

const HISTORY: HistoryRow[] = [
  { id: 'sess-1', date: '2026-08-04', mode: 'Ad-hoc practice', subject: 'both', scorePct: 74, questionCount: 37 },
  { id: 'sess-2', date: '2026-08-03', mode: 'Full test — Module 1', subject: 'both', scorePct: 68, questionCount: 27 },
  { id: 'sess-3', date: '2026-08-02', mode: 'Retry mistakes', subject: 'rw', scorePct: 80, questionCount: 12 },
  { id: 'sess-4', date: '2026-08-01', mode: 'Ad-hoc practice', subject: 'math', scorePct: 71, questionCount: 22 },
  { id: 'sess-5', date: '2026-07-30', mode: 'Ad-hoc practice', subject: 'rw', scorePct: 63, questionCount: 15 },
];

function linePoints(values: number[], w: number, h: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function Progress() {
  const navigate = useNavigate();
  const paceTotal = PACE_BUCKETS.reduce((s, b) => s + b.count, 0);
  const weakest = [...DOMAIN_ACCURACY].sort((a, b) => a.pct - b.pct)[0];

  return (
    <AppShell title="Progress & Score Tracking">
      <div className="prog-card">
        <p className="prog-label">Score over time (all sessions)</p>
        <svg viewBox="0 0 300 70" className="prog-linechart" preserveAspectRatio="none">
          <polyline points={linePoints(SCORE_HISTORY, 300, 70)} fill="none" stroke="var(--navy)" strokeWidth="2.5" />
        </svg>
        <div className="prog-linechart-labels">
          <span>{SCORE_HISTORY.length} sessions ago</span>
          <span>most recent</span>
        </div>
      </div>

      <div className="prog-grid">
        <div className="prog-card">
          <p className="prog-label">Accuracy by domain</p>
          <div className="prog-chip-row">
            <span className="subj-chip math">Math</span>
            <span className="subj-chip rw">R&amp;W</span>
          </div>
          <div className="prog-domain-list">
            {DOMAIN_ACCURACY.map((d) => (
              <button
                key={d.label}
                className="prog-domain-row"
                onClick={() => navigate('/practice/new')}
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
          <p className="prog-hint">Weakest: {weakest.label} ({weakest.pct}%) — click any row to practice it.</p>
        </div>

        <div className="prog-card">
          <p className="prog-label">Pace: rushed / slow-right / slow-wrong</p>
          <div className="prog-pace-bar">
            {PACE_BUCKETS.map((b) => (
              <div
                key={b.key}
                className="prog-pace-seg"
                style={{ width: `${(b.count / paceTotal) * 100}%`, background: b.color }}
                title={`${b.label}: ${b.count}`}
              />
            ))}
          </div>
          <div className="prog-pace-legend">
            {PACE_BUCKETS.map((b) => (
              <div key={b.key} className="prog-pace-legend-row">
                <span className="prog-pace-dot" style={{ background: b.color }} />
                <span className="prog-pace-legend-label">{b.label}</span>
                <span className="prog-pace-legend-count mono">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="prog-card">
        <p className="prog-label">Full session history</p>
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
            {HISTORY.map((h) => (
              <tr key={h.id}>
                <td className="mono">{h.date}</td>
                <td>{h.mode}</td>
                <td>
                  <span className={`subj-chip ${h.subject === 'both' ? 'both' : h.subject}`}>
                    {h.subject === 'both' ? 'Both' : h.subject === 'math' ? 'Math' : 'R&W'}
                  </span>
                </td>
                <td className="mono">{h.questionCount}</td>
                <td>
                  <Link to={`/sessions/${h.id}`} className="prog-table-score">
                    {h.scorePct}%
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
