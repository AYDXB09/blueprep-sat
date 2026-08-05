import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Placeholder for a route that hasn't been built yet. Real routing, real
 * navigation — just no real screen behind it. Swap each one out for the
 * actual component as screens get ported from their HTML mockups.
 */
export function PageStub({
  title,
  path,
  mockupNote,
  children,
}: {
  title: string;
  path: string;
  mockupNote?: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ padding: '40px 32px', maxWidth: 640, margin: '0 auto' }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          margin: '0 0 6px',
        }}
      >
        Not built yet — placeholder route
      </p>
      <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 4px' }}>
        <code>{path}</code>
      </p>
      {mockupNote && (
        <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, margin: '16px 0' }}>
          {mockupNote}
        </p>
      )}
      {children}
      <p style={{ marginTop: 32 }}>
        <Link to="/" style={{ color: 'var(--navy)', fontSize: 13, fontWeight: 600 }}>
          ← Back to Dashboard
        </Link>
      </p>
    </div>
  );
}
