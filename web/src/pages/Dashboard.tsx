import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './Dashboard.css';

// ---------------------------------------------------------------------------
// Storyboard screen 2 (/dashboard, mapped here to route "/"). Mock data only —
// TODO: replace with real reads from `practice_sessions` (score_summary jsonb,
// most-recent-first) + `question_attempts` (domain accuracy for weakest-skill,
// score trend sparkline) once the question bank is imported and sessions exist.
// ---------------------------------------------------------------------------

type Subject = 'math' | 'rw';

interface RecentSession {
  id: string;
  mode: string;
  subject: Subject | 'both';
  scorePct: number;
  questionCount: number;
  completedAt: string;
}

const SCORE_TREND = [61, 58, 64, 67, 65, 71, 74]; // last 7 completed sessions, % correct
const STREAK_DAYS = 4;
const WEAKEST_SKILL: { subject: Subject; label: string; accuracyPct: number } = {
  subject: 'rw',
  label: 'Standard English Conventions',
  accuracyPct: 52,
};

const RECENT_SESSIONS: RecentSession[] = [
  { id: 'sess-1', mode: 'Ad-hoc practice', subject: 'both', scorePct: 74, questionCount: 37, completedAt: '2026-08-04T18:20:00Z' },
  { id: 'sess-2', mode: 'Full test — Module 1', subject: 'both', scorePct: 68, questionCount: 27, completedAt: '2026-08-03T14:05:00Z' },
  { id: 'sess-3', mode: 'Retry mistakes', subject: 'rw', scorePct: 80, questionCount: 12, completedAt: '2026-08-02T20:40:00Z' },
  { id: 'sess-4', mode: 'Ad-hoc practice', subject: 'math', scorePct: 71, questionCount: 22, completedAt: '2026-08-01T16:15:00Z' },
];

function sparklinePoints(values: number[], w: number, h: number): string {
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Dashboard() {
  const navigate = useNavigate();
  const latest = SCORE_TREND[SCORE_TREND.length - 1];
  const prev = SCORE_TREND[SCORE_TREND.length - 2];
  const delta = latest - prev;

  return (
    <AppShell title="Dashboard">
      <div className="dash-grid">
        <div className="dash-card">
          <p className="dash-label">Score trend</p>
          <div className="dash-sparkline-row">
            <svg viewBox="0 0 100 32" className="dash-sparkline" preserveAspectRatio="none">
              <polyline points={sparklinePoints(SCORE_TREND, 100, 32)} fill="none" stroke="var(--navy)" strokeWidth="2" />
            </svg>
            <div>
              <div className="dash-big">{latest}%</div>
              <div className={`dash-delta${delta >= 0 ? ' up' : ' down'}`}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}pt vs. last session
              </div>
            </div>
          </div>
        </div>

        <div className="dash-card">
          <p className="dash-label">Streak</p>
          <div className="dash-big">{STREAK_DAYS} days</div>
          <p className="dash-sub">Practiced 4 days in a row — keep it going.</p>
        </div>

        <div className="dash-card">
          <p className="dash-label">Weakest skill</p>
          <span className={`subj-chip ${WEAKEST_SKILL.subject}`}>{WEAKEST_SKILL.subject === 'math' ? 'Math' : 'R&W'}</span>
          <div className="dash-big" style={{ marginTop: 6 }}>
            {WEAKEST_SKILL.accuracyPct}%
          </div>
          <p className="dash-sub">{WEAKEST_SKILL.label}</p>
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
        <div className="dash-session-list">
          {RECENT_SESSIONS.map((s) => (
            <Link key={s.id} to={`/sessions/${s.id}`} className="dash-session-row">
              <span className={`subj-chip ${s.subject === 'both' ? 'both' : s.subject}`}>
                {s.subject === 'both' ? 'Both' : s.subject === 'math' ? 'Math' : 'R&W'}
              </span>
              <span className="dash-session-mode">{s.mode}</span>
              <span className="dash-session-count mono">{s.questionCount}q</span>
              <span className="dash-session-date mono">{fmtDate(s.completedAt)}</span>
              <span className={`dash-session-score${s.scorePct >= 70 ? ' good' : ''}`}>{s.scorePct}%</span>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
