import { useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

// ---------------------------------------------------------------------------
// Public marketing page for signed-out visitors (mapped to "/" by Home.tsx).
// The demo question below is real content pulled from the live question bank
// (id ba1a8be9-37d7-4a8f-80c3-300f4e67565d, College Board id 4fb8a648, Hard
// difficulty, Advanced Math) -- including its real MathML markup and its real
// trap-cue explanations -- so the pitch is grounded in what the app actually
// does, not generic marketing copy. It's rendered the same way Player.tsx
// renders question content: raw MathML via dangerouslySetInnerHTML, relying
// on the browser's native <math> support (same as the real Player screen).
// ---------------------------------------------------------------------------

const DEMO_STEM_HTML = `
<p style="text-align: center;"><math alttext="y equals x plus 9"><mrow>
	<mi>y</mi>
	<mo>=</mo>
	<mrow>
		<mi>x</mi>
		<mo>+</mo>
		<mn>9</mn>
	</mrow>
</mrow>
</math></p>
<p style="text-align: center;"><math alttext="y equals x squared plus 16 x plus 63"><mrow>
	<mi>y</mi>
	<mo>=</mo>
	<mrow>
		<msup>
			<mi>x</mi>
			<mn>2</mn>
		</msup>
		<mo>+</mo>
		<mrow>
			<mn>16</mn>
			<mi>x</mi>
		</mrow>
		<mo>+</mo>
		<mn>63</mn>
	</mrow>
</mrow>
</math></p>
<p style="text-align: left;">A solution to the given system of equations is <math alttext="left parenthesis x comma y right parenthesis"><mfenced><mrow><mi>x</mi><mo>,</mo><mi>y</mi></mrow></mfenced></math>. What is the greatest possible value of <math alttext="x"><mi>x</mi>
</math>?</p>
`;

const DEMO_CHOICES = [
  {
    label: 'A',
    html: '<math alttext="negative 6"><mo>-</mo><mn>6</mn></math>',
    correct: true,
  },
  {
    label: 'B',
    html: '<math alttext="7"><mn>7</mn></math>',
    correct: false,
    cue: 'This relates to a root of the second equation, not a solution x of the system.',
  },
  {
    label: 'C',
    html: '<math alttext="9"><mn>9</mn></math>',
    correct: false,
    cue: 'This is the y-value of the first equation at x = 0, not a solution x.',
  },
  {
    label: 'D',
    html: '<math alttext="63"><mn>63</mn></math>',
    correct: false,
    cue: 'This is the y-value of the second equation at x = 0, not a solution x.',
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
                Correct — substituting gives x² + 15x + 54 = 0, so x = −6 or x = −9. The greatest is −6.
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
          <p className="landing-stat-num">3,252</p>
          <p className="landing-stat-label">Total questions</p>
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
