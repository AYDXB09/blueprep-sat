import { useState } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

// ---------------------------------------------------------------------------
// Public marketing page for signed-out visitors (mapped to "/" by Home.tsx).
// The demo question below is real content pulled from the live question bank
// (id 758fbc90-f07d-463d-9e8a-30c83122b3ce, College Board id 435809d8, Hard
// difficulty, Reading & Writing / Standard English Conventions) -- a real
// comma-splice/run-on punctuation question, along with its real trap-cue
// explanations -- so the pitch is grounded in what the app actually does,
// not generic marketing copy. Kept short (3 sentences) rather than a long
// stimulus paragraph, per feedback that a wall of text isn't inviting.
// ---------------------------------------------------------------------------

const DEMO_STEM_HTML = `
<p>On March 23, 2021, a gust of wind wreaked havoc on global trade. <em>Ever Given</em>, an international shipping container vessel, became lodged in Egypt&rsquo;s Suez Canal, a major shipping route between Europe and Asia. The vessel took six days to ______ it&rsquo;s as heavy as two thousand blue whales when fully loaded.</p>
<p>Which choice completes the text so that it conforms to the conventions of Standard English?</p>
`;

const MARK = (s: string) => `<mark class="landing-trap-mark">${s}</mark>`;
// Marks are only meaningful once the trap's been explained -- stripped out of
// the choice buttons themselves until an answer is picked, so trying the
// question isn't spoiled by the punctuation differences being pre-highlighted.
const stripMarks = (html: string) => html.replace(/<\/?mark[^>]*>/g, '');

const DEMO_CHOICES = [
  {
    label: 'A',
    html: `dislodge in part due to its sheer size${MARK(',')}`,
    correct: false,
    tempting: 'It reads as one smooth, flowing sentence — nothing about it jars the eye on a fast read.',
    issue:
      'There’s no punctuation marking where the aside ends and the next full sentence begins, so "size" runs straight into "it’s as heavy as…" as a comma splice.',
  },
  {
    label: 'B',
    html: `dislodge${MARK(',')} in part due to its sheer size${MARK(':')}`,
    correct: true,
    right:
      'The colon cleanly introduces the reason the ship took six days to dislodge — a supplement, not a second full sentence — so nothing splices or runs on.',
  },
  {
    label: 'C',
    html: `dislodge${MARK(',')} in part due to its sheer size${MARK(',')}`,
    correct: false,
    tempting:
      'The commas around "in part due to its sheer size" look like a textbook parenthetical aside — confident, grammatically dressed-up punctuation.',
    issue:
      'A comma alone still can’t join two independent clauses. What follows ("it’s as heavy as…") is a full sentence on its own, so this is a comma splice too.',
  },
  {
    label: 'D',
    html: `dislodge${MARK(',')} in part${MARK(',')} due to its sheer size`,
    correct: false,
    tempting: 'Boxing "in part" in commas looks like careful, deliberate punctuation — the kind a careful writer reaches for.',
    issue:
      'It leaves nothing at all — no comma, semicolon, or conjunction — before "it’s as heavy as…", so the two independent clauses fuse into a run-on.',
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
  const revealed = picked !== null;

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
            const state = !revealed ? '' : c.correct ? 'correct' : isPicked ? 'incorrect' : 'faded';
            return (
              <button
                key={c.label}
                type="button"
                className={`landing-demo-choice ${state}`}
                onClick={() => setPicked(c.label)}
                disabled={revealed}
              >
                <span className="landing-demo-letter">{c.label}</span>
                <span dangerouslySetInnerHTML={{ __html: revealed ? c.html : stripMarks(c.html) }} />
                {isPicked && !c.correct && <span className="landing-demo-your-pick">Your pick</span>}
              </button>
            );
          })}
        </div>
        {revealed && (
          <div className="landing-demo-breakdown">
            <p className="landing-demo-feedback-label">
              <span aria-hidden="true">🎯</span> Trap-and-cue coaching, in action — why every wrong choice is
              tempting
            </p>
            {DEMO_CHOICES.map((c) => (
              <div key={c.label} className={`landing-demo-breakdown-row ${c.correct ? 'correct' : 'incorrect'}`}>
                <span className="landing-demo-letter">{c.label}</span>
                <div>
                  <p className="landing-demo-breakdown-choice" dangerouslySetInnerHTML={{ __html: c.html }} />
                  {c.correct ? (
                    <p className="landing-demo-breakdown-body">{c.right}</p>
                  ) : (
                    <>
                      <p className="landing-demo-breakdown-body">
                        <b>Why it's tempting:</b> {c.tempting}
                      </p>
                      <p className="landing-demo-breakdown-body">
                        <b>Why it's wrong:</b> {c.issue}
                      </p>
                    </>
                  )}
                </div>
              </div>
            ))}
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
