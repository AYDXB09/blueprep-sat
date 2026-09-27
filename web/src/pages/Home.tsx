import { useAuth } from '../lib/AuthContext';
import { Dashboard } from './Dashboard';
import { Landing } from './Landing';

/** "/" itself: the public marketing page when signed out, the real
 *  Dashboard when signed in. Does its own auth check rather than wrapping
 *  in RequireAuth, since signed-out here is a valid page, not a redirect. */
export function Home() {
  const { session, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 40, color: 'var(--ink-dim)', fontSize: 13 }}>Loading…</div>;
  }

  return session ? <Dashboard /> : <Landing />;
}
