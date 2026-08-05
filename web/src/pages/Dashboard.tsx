import { Link } from 'react-router-dom';
import { PageStub } from '../components/PageStub';

export function Dashboard() {
  return (
    <PageStub
      title="Dashboard"
      path="/"
      mockupNote="Score trend, weakest skill, quick actions. Reads from question_attempts + practice_sessions."
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link to="/practice/new" style={navButtonStyle}>
          Ad-hoc Practice Builder
        </Link>
        <Link to="/test/new" style={navButtonStyle}>
          Full Test Setup
        </Link>
        <Link to="/progress" style={navButtonStyle}>
          Progress
        </Link>
        <Link to="/mistakes" style={navButtonStyle}>
          Mistake Log
        </Link>
        <Link to="/settings" style={navButtonStyle}>
          Settings
        </Link>
      </div>
    </PageStub>
  );
}

const navButtonStyle = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1.5px solid var(--line)',
  color: 'var(--ink)',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
};
