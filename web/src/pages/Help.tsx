import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import './Help.css';

// ---------------------------------------------------------------------------
// In-app rendering of docs/HELP.md, reachable from every screen via the
// sidebar's "Help" link. Keep this in sync with docs/HELP.md by hand when
// either changes — it's the same content, just as a React page instead of a
// markdown file, so it's reachable without leaving the app or knowing GitHub
// exists.
// ---------------------------------------------------------------------------

export function Help() {
  return (
    <AppShell title="Help">
      <div className="help-page">
        <p className="help-intro">
          BluePrep is a digital SAT practice app built around a real, verified question bank — the
          same questions you'd see in the official Bluebook question bank, with a Bluebook-style
          test-taking experience layered on top. This page walks through what makes BluePrep worth
          using, screen by screen.
        </p>

        <section className="help-section">
          <h2>What makes BluePrep different</h2>
          <p>
            Most SAT practice tools give you a question, an answer, and maybe a paragraph of
            explanation. BluePrep adds two things most tools don't:
          </p>

          <h3>1. Trap &amp; Cue coaching — see why a wrong answer is tempting, not just that it's wrong</h3>
          <p>
            After you answer a question (or when reviewing a past session), some questions show a{' '}
            <b>💡 Has cue analysis</b> badge. Open the explanation panel and you'll see the passage
            or answer choices highlighted in two colors:
          </p>
          <ul>
            <li>
              <b>Governing rule</b> (blue) — the exact phrase in the passage or problem that
              determines the correct answer. This is the piece of evidence you're supposed to have
              caught.
            </li>
            <li>
              <b>Trap</b> (red) — a specific reason a wrong choice is tempting, tied to a real trap
              category (e.g. <i>reversed direction</i>, <i>unsupported leap</i>, <i>wrong operation
              substitution</i>, <i>proximity bait</i>). Every trap explanation is grounded in the
              official rationale for that question, not a generic "this is wrong because."
            </li>
          </ul>
          <p>
            This is BluePrep's core differentiator: it teaches you to recognize the <b>pattern</b>{' '}
            of trap that got you (or almost got you), so you start catching it on questions you've
            never seen before — not just memorizing the answer to one question. Coverage is
            expanding over time (currently a few hundred questions and growing); a question without
            the badge just doesn't have this layer yet, the question itself is always the real one
            from the source bank.
          </p>

          <h3>2. A test-taking experience that matches the real digital SAT</h3>
          <p>BluePrep's Practice Player is modeled on Bluebook, not a generic quiz app:</p>
          <ul>
            <li>
              <b>Real timers</b> — per-module countdowns that match the actual test's pacing (a
              Reading &amp; Writing module and a Math module tick at different rates, and Module 1
              vs. Module 2 pace differently too), or turn timing off entirely for untimed practice.
            </li>
            <li>
              <b>Highlighting, mark-for-review, and answer cross-out</b> — drag to highlight
              passages the way you would in the real test. Turn on the <b>🖍️ Highlight</b> toggle
              in the header and a selection highlights immediately in one color, no extra click —
              turn it off and you get full control over color and underline style instead, with a
              small popover after each selection.
            </li>
            <li>
              <b>A real full-length test mode</b> — Reading &amp; Writing Module 1 → Module 2 → a
              10-minute break → Math Module 1 → Module 2, with real adaptive routing: how you do on
              Module 1 changes the difficulty mix of Module 2, the same way the actual digital SAT
              adapts.
            </li>
            <li>
              <b>Review mode</b> — reopen any finished session exactly as you left it, with your
              answers, the trap/cue analysis, and your own notes all intact — no retaking required
              just to look back.
            </li>
          </ul>
        </section>

        <section className="help-section">
          <h2>Practice modes</h2>
          <ul>
            <li>
              <b>Ad-hoc Practice</b> (Practice in the sidebar) — build a custom set by subject,
              domain, and sub-topic (e.g. Math → Advanced Math → Nonlinear functions), plus
              difficulty. Good for drilling a specific weak spot.
            </li>
            <li>
              <b>Full Test</b> — a complete, real-length, real-paced practice test with adaptive
              Module 2 routing, just like test day.
            </li>
          </ul>
          <p>
            Both modes automatically <b>resurface recent mistakes</b> — a question you got wrong is
            held back from new sets for a little while (so you're not immediately re-answering it
            from memory) and then brought back once enough time has passed, so misses don't just
            disappear.
          </p>
        </section>

        <section className="help-section">
          <h2>Tracking your progress</h2>
          <ul>
            <li>
              <b>Dashboard</b> — your score trend (combined, Math, and Reading &amp; Writing
              separately), your current streak, and your single weakest skill at a glance.
            </li>
            <li>
              <b>Progress</b> — a full skill map: radar charts per domain and per skill, ranked
              strongest/weakest skills, and accuracy broken down by difficulty. Click any domain to
              jump straight to practicing it.
            </li>
            <li>
              <b>Mistake Log</b> — every question you've gotten wrong, in one place, with a
              one-click "Review" back into the exact question. A second tab, <b>All my notes</b>,
              collects every question you've left a personal note on — including ones you got right
              — with Copy and CSV export.
            </li>
          </ul>
        </section>

        <section className="help-section">
          <h2>AI tutor (bring your own key)</h2>
          <p>
            Two AI features are available once you connect your own AI provider key in{' '}
            <b>Settings</b>:
          </p>
          <ul>
            <li>
              <b>Ask AI</b>, inside the Practice Player — ask a question about the problem you're
              looking at. It won't reveal the answer before you've actually answered.
            </li>
            <li>
              <b>AI Performance Coach</b>, on the Progress page — a broader conversation about your
              patterns across many sessions (which skills, which trap types, etc.).
            </li>
          </ul>
          <p>
            BluePrep doesn't charge for AI usage or run its own AI infrastructure — you connect
            your own key (via OpenRouter, which supports Claude, GPT, Gemini, and free open-weight
            models) and it's stored encrypted, never shown back to you in full after you save it.
          </p>
        </section>

        <section className="help-section">
          <h2>Settings</h2>
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
        </section>
      </div>
    </AppShell>
  );
}
