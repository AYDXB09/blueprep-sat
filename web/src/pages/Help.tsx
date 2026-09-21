import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './Help.css';

// ---------------------------------------------------------------------------
// In-app rendering of docs/HELP.md, reachable from every screen via the
// sidebar's "Help" link. Keep this in sync with docs/HELP.md by hand when
// either changes — it's the same content, just as a React page (cards, a
// TOC, colored swatches matching the real Player highlight colors) instead
// of a flat markdown file, so it reads as a real product page, not a wall of
// plain paragraphs.
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'different', label: 'What makes it different' },
  { id: 'modes', label: 'Practice modes' },
  { id: 'progress', label: 'Progress' },
  { id: 'ai', label: 'AI tutor' },
  { id: 'settings', label: 'Settings' },
];

export function Help() {
  return (
    <AppShell title="Help">
      <div className="help-page">
        <p className="help-intro">
          BluePrep is a digital SAT practice app built around a <b>real, verified question bank</b>{' '}
          — the same questions you'd see in the official Bluebook question bank — with a
          Bluebook-style test-taking experience layered on top. This page walks through what makes
          BluePrep worth using, screen by screen.
        </p>

        <nav className="help-toc" aria-label="Jump to section">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>

        <section className="help-section" id="different">
          <div className="help-section-head">
            <span className="help-section-icon">✨</span>
            <h2>What makes BluePrep different</h2>
          </div>
          <p>
            Most SAT practice tools give you a question, an answer, and maybe a paragraph of
            explanation. BluePrep adds two things most tools don't:
          </p>

          <div className="help-feature-grid">
            <div className="help-feature-card">
              <h3>💡 Trap &amp; Cue coaching</h3>
              <p>
                See <b>why</b> a wrong answer is tempting, not just that it's wrong. Some questions
                show a <span className="help-badge">💡 Has cue analysis</span> badge — open the
                explanation panel and the passage or choices highlight in two colors:
              </p>
              <div className="help-swatch-row">
                <div className="help-swatch">
                  <span className="help-swatch-dot governing" />
                  <span>
                    <b>Governing rule</b> — the exact phrase that determines the correct answer,
                    the evidence you're supposed to have caught.
                  </span>
                </div>
                <div className="help-swatch">
                  <span className="help-swatch-dot trap" />
                  <span>
                    <b>Trap</b> — a specific, named reason a wrong choice is tempting (e.g.{' '}
                    <i>reversed direction</i>, <i>unsupported leap</i>, <i>proximity bait</i>),
                    grounded in the official rationale, not a generic "this is wrong because."
                  </span>
                </div>
              </div>
              <p>
                This teaches you to recognize the <b>pattern</b> of trap that got you, so you start
                catching it on questions you've never seen before. Coverage is expanding over time;
                a question without the badge just doesn't have this layer yet.
              </p>
            </div>

            <div className="help-feature-card accent-red">
              <h3>🖥️ Real digital-SAT test experience</h3>
              <p>BluePrep's Practice Player is modeled on Bluebook, not a generic quiz app:</p>
              <ul>
                <li>
                  <b>Real timers</b> that match the actual test's per-module pacing, or off
                  entirely for untimed practice.
                </li>
                <li>
                  <b>🖍️ Highlight, mark-for-review, ABC cross-out</b> — the auto-highlight toggle
                  commits a color instantly; turn it off for full manual control.
                </li>
                <li>
                  <b>A real full-length test mode</b> — R&amp;W M1 → M2 → a 10-minute break → Math
                  M1 → M2, with real adaptive Module 2 routing off your Module 1 score.
                </li>
                <li>
                  <b>Review mode</b> — reopen any finished session exactly as you left it, no
                  retaking required.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="help-section" id="modes">
          <div className="help-section-head">
            <span className="help-section-icon">📝</span>
            <h2>Practice modes</h2>
          </div>
          <div className="help-card-grid">
            <div className="help-card">
              <h3>Ad-hoc Practice</h3>
              <p>
                Build a custom set by subject, domain, and sub-topic (e.g. Math → Advanced Math →
                Nonlinear functions), plus difficulty. Good for drilling a specific weak spot.
              </p>
            </div>
            <div className="help-card">
              <h3>Full Test</h3>
              <p>
                A complete, real-length, real-paced practice test with adaptive Module 2 routing,
                just like test day.
              </p>
            </div>
          </div>
          <p style={{ marginTop: 14 }}>
            Both modes automatically <b>resurface recent mistakes</b> — a question you got wrong is
            held back from new sets for a little while, then brought back once enough time has
            passed, so misses don't just disappear.
          </p>
        </section>

        <section className="help-section" id="progress">
          <div className="help-section-head">
            <span className="help-section-icon">📊</span>
            <h2>Tracking your progress</h2>
          </div>
          <div className="help-card-grid">
            <div className="help-card">
              <h3>Dashboard</h3>
              <p>Score trend (combined, Math, R&amp;W), current streak, and your weakest skill at a glance.</p>
            </div>
            <div className="help-card">
              <h3>Progress</h3>
              <p>
                A full skill map: radar charts per domain and skill, ranked strongest/weakest, and
                accuracy by difficulty. Click a domain to practice it directly.
              </p>
            </div>
            <div className="help-card">
              <h3>Mistake Log</h3>
              <p>Every wrong answer in one place, one click back into the exact question.</p>
            </div>
            <div className="help-card">
              <h3>All my notes</h3>
              <p>Every question you've left a note on — right or wrong — with Copy and CSV export.</p>
            </div>
          </div>
        </section>

        <section className="help-section" id="ai">
          <div className="help-section-head">
            <span className="help-section-icon">🤖</span>
            <h2>AI tutor (bring your own key)</h2>
          </div>
          <p>Two AI features unlock once you connect your own AI provider key in Settings:</p>
          <div className="help-card-grid">
            <div className="help-card">
              <h3>Ask AI (Player)</h3>
              <p>Ask about the problem you're looking at — won't reveal the answer before you've actually answered.</p>
            </div>
            <div className="help-card">
              <h3>AI Performance Coach (Progress)</h3>
              <p>A broader conversation about your patterns across many sessions — which skills, which trap types.</p>
            </div>
          </div>
          <p style={{ marginTop: 14 }}>
            BluePrep doesn't charge for AI usage or run its own AI infrastructure — you connect
            your own key (via OpenRouter: Claude, GPT, Gemini, and free open-weight models), stored
            encrypted and never shown back to you in full after you save it.
          </p>
        </section>

        <section className="help-section" id="settings">
          <div className="help-section-head">
            <span className="help-section-icon">⚙️</span>
            <h2>Settings</h2>
          </div>
          <p>
            Theme (light/dark/system), font size, timer defaults, how long a missed question stays
            out of rotation before resurfacing, your target score and test date, and your AI
            connection all live in <b>Settings</b> and take effect immediately — no separate save
            step.
          </p>
        </section>

        <section className="help-closing">
          <h2>Something wrong, or an idea?</h2>
          <p>
            Use <Link to="/contact">Contact support</Link> in the sidebar to send a message
            directly — a bug in a question, a confusing explanation, or a feature you wish existed.
            See your own message history right there after you send one.
          </p>
          <p className="help-legal">
            Bluebook® and College Board® are registered trademarks of College Board, which is not
            affiliated with, and does not endorse, BluePrep. References to Bluebook describe the
            test-taking experience BluePrep's Practice Player is modeled on; all questions come
            from College Board's own public question bank.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
