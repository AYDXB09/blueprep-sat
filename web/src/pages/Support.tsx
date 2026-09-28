import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { submitPublicSupportMessage } from '../lib/contactMessages';
import './Legal.css';
import './Contact.css';

// ---------------------------------------------------------------------------
// Public support page — reachable without an account (unlike /contact, which
// sits behind RequireAuth). Exists because Terms/Privacy already document
// "Contact support" as the one support channel, but someone who can't sign
// up in the first place (the exact kind of bug they'd want to report) had no
// way to reach it. Same table + email-notification trigger as the in-app
// Contact page, via submitPublicSupportMessage (user_id left null).
// ---------------------------------------------------------------------------

export function Support() {
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot: real visitors never see or fill this field (aria-hidden, off-screen).
  // A filled value means a bot filled every input it found — silently drop it
  // rather than telling the bot it worked, without adding a CAPTCHA dependency.
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (website.trim()) {
      setSent(true);
      return;
    }
    setSending(true);
    try {
      await submitPublicSupportMessage(email, subject, message);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong sending your message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-brand">
          <b>Blue</b>Prep
        </Link>
      </header>

      <h1>Support</h1>
      <p className="contact-intro">
        Found a bug, can't sign in, or have a question before creating an account? Send it here — no
        account needed, and every message goes straight to the person who built BluePrep.
      </p>

      {sent ? (
        <p className="contact-success">Sent — thanks for the report. We'll get back to you at the email you gave.</p>
      ) : (
        <form className="contact-card" onSubmit={(e) => void handleSubmit(e)}>
          <label className="contact-field">
            <span className="contact-label">Your email</span>
            <input
              className="contact-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="contact-field">
            <span className="contact-label">Subject</span>
            <input
              className="contact-input"
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. I can't finish signing up"
            />
          </label>
          <label className="contact-field">
            <span className="contact-label">Message</span>
            <textarea
              className="contact-textarea"
              required
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, and what were you expecting?"
            />
          </label>

          <label style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
            Website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>

          {error && <p className="contact-error">{error}</p>}

          {/* Not .btn.primary: that class lives in Player.css, which a first-time
              visitor to this public page will never have loaded (unlike the
              in-app Contact page, which only ever renders after Player.css has
              already loaded elsewhere in the same session). Self-contained
              instead, matching Login.tsx's submit button. */}
          <button
            type="submit"
            disabled={sending}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--navy)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: sending ? 'default' : 'pointer',
              opacity: sending ? 0.7 : 1,
              alignSelf: 'flex-start',
            }}
          >
            {sending ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 24 }}>
        Already have an account? <Link to="/login">Sign in</Link> and use Contact support from the sidebar to see
        your message history.
      </p>

      <p style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 32 }}>
        <Link to="/terms" style={{ color: 'var(--ink-dim)' }}>
          Terms of Service
        </Link>
        {' · '}
        <Link to="/privacy" style={{ color: 'var(--ink-dim)' }}>
          Privacy Policy
        </Link>
      </p>
    </div>
  );
}
