import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './AppShell.css';
import { useAuth } from '../lib/AuthContext';

// ---------------------------------------------------------------------------
// Persistent sidebar nav, shared by every authenticated screen (Dashboard,
// Full Test Setup, Session Summary, Progress, Mistake Log, Settings) — per
// the storyboard's navmap ("Top-level navigation, persistent, all screens").
// ---------------------------------------------------------------------------

const NAV_ITEMS: { label: string; to: string; match: (path: string) => boolean }[] = [
  { label: 'Dashboard', to: '/', match: (p) => p === '/' },
  { label: 'Practice', to: '/practice/new', match: (p) => p.startsWith('/practice/new') || p.startsWith('/test/new') },
  { label: 'Progress', to: '/progress', match: (p) => p.startsWith('/progress') },
  { label: 'Mistake Log', to: '/mistakes', match: (p) => p.startsWith('/mistakes') },
  { label: 'Settings', to: '/settings', match: (p) => p.startsWith('/settings') },
];

export function AppShell({ title, children }: { title?: string; children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="shell-root">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <b>Blue</b>Prep
        </div>
        <nav className="shell-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`shell-navlink${item.match(location.pathname) ? ' active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="shell-account">
          <div className="shell-account-email" title={user?.email ?? undefined}>
            {user?.email ?? 'Signed in'}
          </div>
          <button className="shell-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="shell-main">
        {title && <h1 className="shell-title">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
