import { useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

// ---------------------------------------------------------------------------
// Public marketing page for signed-out visitors (mapped to "/" by Home.tsx).
// The demo question below is real content pulled from the live question bank
// (id 54eed2e9-47bc-4ec4-a3ea-81d4a8cf0a81, College Board id 8545ccfe, Hard
// difficulty, Reading & Writing / Information and Ideas) -- a "weaken the
// hypothesis" question, along with its real trap-cue explanations -- so the
// pitch is grounded in what the app actually does, not generic marketing
// copy. Rendered the same way Player.tsx renders stimulus/stem content.
// ---------------------------------------------------------------------------

const DEMO_STEM_HTML = `
<p>Icebergs generally appear to be mostly white or blue, depending on how the ice reflects sunlight. Ice with air bubbles trapped in it looks white because much of the light reflects off the bubbles. Ice without air bubbles usually looks blue because the light travels deep into the ice and only a little of it is reflected. However, some icebergs in the sea around Antarctica appear to be green. One team of scientists hypothesized that this phenomenon is the result of yellow-tinted dissolved organic carbon in Antarctic waters mixing with blue ice to produce the color green.</p>
<p>Which finding, if true, would most directly weaken the team&rsquo;s hypothesis?</p>
`;

const DEMO_CHOICES = [
  {
    label: 'A',
    html: 'White ice doesn&rsquo;t change color when mixed with dissolved organic carbon due to the air bubbles in the ice.',
    correct: false,
    cue: 'True, but off-target: the hypothesis is about what turns blue ice green, not white ice.',
  },
  {
    label: 'B',
    html: 'Dissolved organic carbon has a stronger yellow color in Antarctic waters than it does in other places.',
    correct: false,
    cue: "True, but off-target: this is consistent with the hypothesis rather than weakening it, and only concerns Antarctic waters.",
  },
  {
    label: 'C',
    html: 'Blue icebergs and green icebergs are rarely found near each other.',
    correct: false,
    cue: 'Reversed direction: if carbon in the water turns blue ice green, nearby blue icebergs would also turn green — this fits the hypothesis rather than weakening it.',
  },
  {
    label: 'D',
    html: 'Blue icebergs and green icebergs contain similarly small traces of dissolved organic carbon.',
    correct: true,
  },
] as const;

const FEATURES = [
  {
    icon: '🎯',
    title: 'Trap-and-cue coaching',
    body: 'Explanations name the specific trap each wrong choice sets, not just that it’s incorrect.',
  },
  {
    icon: '💬',
    title: 'Ask AI, mid-question',
    body: 'A live chat tutor grounded in the actual question and passage in front of you.',
  },
  {
    icon: '🔁',
    title: 'Mistakes resurface',
    body: 'A persistent Mistake Log brings missed questions back until they actually stick.',
  },
  {
    icon: '📡',
    title: 'Skill map across devices',
    body: 'Progress is tied to your account, not a browser tab — pick up on any device.',
  },
];

export function Landing() {
  const [picked, setPicked] = useState<string | null>(null);
  const pickedChoice = DEMO_CHOICES.find((c) => c.label === picked);

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-wordmark">
          <b>Blue</b>Prep
        </div>
        <Link to="/login" className="landing-nav-signin">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-badges">
          <span className="landing-badge accent">3,252 real College Board questions</span>
          <span className="landing-badge">Math + Reading &amp; Writing</span>
          <span className="landing-badge">Free</span>
        </div>
        <h1>Practice the real SAT question bank. Learn from every trap.</h1>
        <p className="landing-subhead">
          BluePrep pulls straight from College Board's own question bank and coaches you on{' '}
          <b>why</b> a wrong answer is tempting, not just that it's wrong.
        </p>
        <div className="landing-cta-row">
          <Link to="/login?mode=signup" className="landing-cta-primary">
            Start practicing free
          </Link>
          <a href="#demo" className="landing-cta-secondary">
            See how it works
          </a>
        </div>
      </section>

      <section id="demo" className="landing-demo">
        <div className="landing-demo-label">
          <span className="landing-demo-dot" aria-hidden="true" />
          Try a real Hard-difficulty question — no account needed
        </div>
        {/* Real question content (MathML), rendered the same way Player.tsx
            renders stem_markup: raw HTML via native browser <math> support. */}
        <div className="landing-demo-stem" dangerouslySetInnerHTML={{ __html: DEMO_STEM_HTML }} />
        <div className="landing-demo-choices">
          {DEMO_CHOICES.map((c) => {
            const isPicked = picked === c.label;
            const showState = picked !== null;
            const state = !showState ? '' : c.correct ? 'correct' : isPicked ? 'incorrect' : '';
            return (
              <button
                key={c.label}
                type="button"
                className={`landing-demo-choice ${state}`}
                onClick={() => setPicked(c.label)}
                disabled={picked !== null}
              >
                <span className="landing-demo-letter">{c.label}</span>
                <span dangerouslySetInnerHTML={{ __html: c.html }} />
              </button>
            );
          })}
        </div>
        {pickedChoice && (
          <div className={`landing-demo-feedback ${pickedChoice.correct ? 'correct' : 'incorrect'}`}>
            {pickedChoice.correct ? (
              <p className="landing-demo-feedback-body">
                Correct — if both colors of iceberg have similarly little dissolved carbon, the carbon
                can't be what's making some icebergs green.
              </p>
            ) : (
              <>
                <p className="landing-demo-feedback-label">
                  <span aria-hidden="true">🎯</span> Trap-and-cue coaching, in action
                </p>
                <p className="landing-demo-feedback-body">{pickedChoice.cue}</p>
              </>
            )}
          </div>
        )}
      </section>

      <section className="landing-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="landing-feature-card">
            <span className="landing-feature-icon" aria-hidden="true">
              {f.icon}
            </span>
            <p className="landing-feature-title">{f.title}</p>
            <p className="landing-feature-body">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="landing-stats">
        <div>
          <p className="landing-stat-num">1,414</p>
          <p className="landing-stat-label">Math questions</p>
        </div>
        <div>
          <p className="landing-stat-num">1,838</p>
          <p className="landing-stat-label">R&amp;W questions</p>
        </div>
        <div>
          <p className="landing-stat-num">100%</p>
          <p className="landing-stat-label">College Board question bank</p>
        </div>
      </section>

      <footer className="landing-footer">
        <Link to="/terms">Terms of Service</Link>
        <span>·</span>
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}
