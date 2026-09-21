import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { submitContactMessage, getMyContactMessages, type ContactMessageRow } from '../lib/contactMessages';
import './Contact.css';

// ---------------------------------------------------------------------------
// A generic "report an issue / ask a question" page, reachable from every
// screen via the sidebar's "Contact support" link (AppShell). Real
// Supabase-backed submission — no mailto:, no third-party form embed — into
// contact_messages, RLS-scoped to auth.uid() same as every other table.
// There's no admin UI anywhere in this app (by design, see CLAUDE.md), so a
// submitted report is reviewed and marked resolved directly in Supabase, not
// through a page here.
// ---------------------------------------------------------------------------

export function Contact() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentJustNow, setSentJustNow] = useState(false);
  const [history, setHistory] = useState<ContactMessageRow[] | null>(null);

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user?.email]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMyContactMessages(user.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, sentJustNow]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    if (!email.trim() || !subject.trim() || !message.trim()) {
      setError('Please fill in an email, a subject, and a message.');
      return;
    }
    setSending(true);
    try {
      await submitContactMessage(user.id, email, subject, message);
      setSubject('');
      setMessage('');
      setSentJustNow(true);
      setTimeout(() => setSentJustNow(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong sending your message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell title="Contact us">
      <p className="contact-intro">
        Found a bug, have a question about a question, or want to suggest something? Send it here — every message
        goes straight to the person who built BluePrep.
      </p>

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
            placeholder="e.g. A question's answer choices look wrong"
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
            placeholder="What happened, and what were you expecting? A question ID or screenshot description helps."
          />
        </label>

        {error && <p className="contact-error">{error}</p>}
        {sentJustNow && <p className="contact-success">Sent — thanks for the report.</p>}

        <button className="btn primary" type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send message'}
        </button>
      </form>

      {history && history.length > 0 && (
        <div className="contact-history">
          <p className="contact-label">Your previous messages</p>
          {history.map((row) => (
            <div key={row.id} className="contact-history-row">
              <div className="contact-history-top">
                <span className="contact-history-subject">{row.subject}</span>
                <span className={`contact-status contact-status-${row.status}`}>{row.status}</span>
              </div>
              <p className="contact-history-message">{row.message}</p>
              <span className="contact-history-date">{new Date(row.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
