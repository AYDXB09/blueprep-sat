import { Link } from 'react-router-dom';
import './Legal.css';

// ---------------------------------------------------------------------------
// Public route (no RequireAuth) — linked from Login.tsx's signup mode before
// an account exists, so this can't sit behind auth. Mirrors docs/TERMS.md;
// keep the two in sync by hand when either changes, same convention as
// Help.tsx / docs/HELP.md.
// ---------------------------------------------------------------------------

export function Terms() {
  return (
    <div className="legal-page">
      <div className="legal-header">
        <Link to="/login" className="legal-brand">
          <b>Blue</b>Prep
        </Link>
      </div>
      <h1>Terms of Service</h1>
      <p className="legal-updated">Last updated: September 21, 2026</p>

      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of BluePrep (the
        &quot;Service&quot;), a free digital SAT practice application. By creating an account or
        using BluePrep, you agree to these Terms.
      </p>

      <h2>1. What BluePrep Is</h2>
      <p>
        BluePrep is an independent SAT practice tool. It uses a real, publicly available question
        bank sourced from College Board's own public question-bank API. <b>BluePrep is not
        affiliated with, endorsed by, or sponsored by College Board.</b> &quot;Bluebook®&quot; and
        &quot;College Board®&quot; are registered trademarks of College Board — references to
        Bluebook in BluePrep describe the test-taking experience BluePrep's Practice Player is
        modeled on, nothing more.
      </p>
      <p>
        BluePrep is a practice and coaching tool. It does not guarantee any particular score, score
        improvement, or outcome on the actual SAT, and it is not a substitute for official College
        Board resources, a school counselor, or a tutor.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        BluePrep is intended for users <b>13 years of age or older</b>. If you are under 18, you
        should have a parent or guardian's permission to use the Service. BluePrep does not
        knowingly collect information from children under 13 — see the{' '}
        <Link to="/privacy">Privacy Policy</Link> for details.
      </p>

      <h2>3. Your Account</h2>
      <p>
        You're responsible for the accuracy of the information you provide (including your email)
        and for keeping your account credentials secure. You're responsible for all activity that
        happens under your account. Let us know right away via <Link to="/contact">Contact
        support</Link> if you believe your account has been compromised.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Scrape, bulk-download, redistribute, or resell the question bank or any other content served by BluePrep</li>
        <li>Attempt to circumvent, disable, or interfere with the Service's security or access controls</li>
        <li>Use the Service to harass, abuse, or harm another person</li>
        <li>Use automated means (bots, scripts) to create accounts or generate practice sessions at a scale inconsistent with normal individual use</li>
        <li>
          Reverse engineer BluePrep's non-public systems (the application's own source code is
          separately open-sourced under the MIT License — see the repository's <code>LICENSE</code>{' '}
          file — and that license governs reuse of the code itself)
        </li>
      </ul>
      <p>We reserve the right to suspend or terminate accounts that violate these Terms.</p>

      <h2>5. AI Features Are Bring-Your-Own-Key</h2>
      <p>
        BluePrep's &quot;Ask AI&quot; and &quot;AI Performance Coach&quot; features are optional
        and require you to connect your own API key from a third-party AI provider (via
        OpenRouter). If you use these features:
      </p>
      <ul>
        <li>You are responsible for your own usage, costs, and compliance with that provider's own terms of service</li>
        <li>Requests go directly from your browser to that provider — BluePrep does not proxy, store, or review the content of your AI conversations</li>
        <li>
          AI-generated responses may be inaccurate, incomplete, or wrong. Don't treat them as a
          substitute for verifying the correct answer through the question's own explanation, which
          comes directly from the question source, not the AI
        </li>
      </ul>

      <h2>6. No Warranty</h2>
      <p>
        BluePrep is provided <b>&quot;as is&quot; and &quot;as available,&quot;</b> free of charge,
        without warranties of any kind, express or implied — including, without limitation,
        warranties of merchantability, fitness for a particular purpose, or that the Service will
        be uninterrupted, error-free, or secure. Content accuracy is based on the underlying source
        question bank; while we make a good-faith effort to catch errors, we don't guarantee every
        question, answer key, or explanation is free of mistakes.
      </p>

      <h2>7. Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, BluePrep and its operator are not liable for any
        indirect, incidental, special, or consequential damages arising from your use of, or
        inability to use, the Service — including any impact on your actual SAT performance or
        score.
      </p>

      <h2>8. Changes to the Service or These Terms</h2>
      <p>
        BluePrep is an evolving, independently run project. We may change, suspend, or discontinue
        the Service (in whole or in part) at any time, and we may update these Terms from time to
        time. If we make material changes, we'll update the &quot;Last updated&quot; date above.
        Continuing to use BluePrep after a change means you accept the updated Terms.
      </p>

      <h2>9. Governing Law</h2>
      <p>
        These Terms are governed by the laws of <b>India</b>, without regard to its
        conflict-of-laws principles.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these Terms? Reach out via <Link to="/contact">Contact support</Link>{' '}
        inside the app.
      </p>
    </div>
  );
}
