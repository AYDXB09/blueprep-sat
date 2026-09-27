import { useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

// ---------------------------------------------------------------------------
// Public marketing page for signed-out visitors (mapped to "/" by Home.tsx).
// The demo question below is real content pulled from the live question
// bank (id e06a745d-b077-48ee-8763-fdfcd713b268, College Board id e9fb7774),
// including its actual trap-cue explanations, so the pitch is grounded in
// what the app really does rather than generic marketing copy.
// ---------------------------------------------------------------------------

const DEMO_CHOICES = [
  { label: 'A', text: '25%', correct: true },
  { label: 'B', text: '50%', correct: false, cue: '50% of 300 is 150, not 75.' },
  {
    label: 'C',
    text: '75%',
    correct: false,
    cue: 'This mistakes the given value 75 itself for the percentage; 75% of 300 is actually 225, not 75.',
  },
  { label: 'D', text: '225%', correct: false, cue: '225% of 300 is 675, not 75.' },
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
          Try one right now — no account needed
        </div>
        <p className="landing-demo-stem">What percentage of 300 is 75?</p>
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
                {c.text}
              </button>
            );
          })}
        </div>
        {pickedChoice && (
          <p className={`landing-demo-feedback ${pickedChoice.correct ? 'correct' : 'incorrect'}`}>
            {pickedChoice.correct
              ? 'Correct — 75 / 300 = 25%.'
              : pickedChoice.cue}
          </p>
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
          <p className="landing-stat-label">Real College Board bank</p>
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
