import { Link } from 'react-router-dom';
import './Legal.css';

// ---------------------------------------------------------------------------
// Public route (no RequireAuth) — linked from Login.tsx's signup mode before
// an account exists, so this can't sit behind auth. Mirrors docs/PRIVACY.md;
// keep the two in sync by hand when either changes, same convention as
// Help.tsx / docs/HELP.md.
// ---------------------------------------------------------------------------

export function Privacy() {
  return (
    <div className="legal-page">
      <div className="legal-header">
        <Link to="/login" className="legal-brand">
          <b>Blue</b>Prep
        </Link>
      </div>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated: September 21, 2026</p>

      <p>
        This Privacy Policy explains what information BluePrep collects, how it's used, and who
        it's shared with. BluePrep is a small, independently run project — this policy describes
        exactly what the app actually does, not generic boilerplate.
      </p>

      <h2>1. Information We Collect</h2>
      <p>
        <b>Account information.</b> When you sign up, we collect your email address and password.
        Passwords are handled entirely by our authentication provider, Supabase Auth — BluePrep
        never sees or stores your password in plain text.
      </p>
      <p>
        <b>Practice activity.</b> As you use BluePrep, we store the data needed to make the app
        work: your practice sessions, question attempts and answers, timing, highlights,
        mark-for-review flags, per-question notes, and your settings (theme, timer preferences,
        target score, test date, etc.).
      </p>
      <p>
        <b>AI connection (optional).</b> If you choose to connect an AI provider key (via
        OpenRouter) to use &quot;Ask AI&quot; or the &quot;AI Performance Coach,&quot; we store
        which provider/model you selected and the last 4 characters of your key for display
        purposes only. The full key is encrypted at rest and is only ever decrypted back to your
        own signed-in browser session — to make the actual AI request — never read or logged by
        BluePrep's servers in the process. If you don't connect a key, none of this applies to you.
      </p>
      <p>
        <b>Contact messages.</b> If you use the in-app Contact support form, we store the email,
        subject, and message you submit, along with your account ID.
      </p>
      <p>
        <b>What we do <i>not</i> collect:</b> We do not use third-party analytics or advertising
        trackers of any kind. We do not place tracking cookies. The only thing stored in your
        browser is your Supabase authentication session (so you stay signed in), which is standard
        for any account-based web app.
      </p>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>To operate the core practice features — building sessions, grading answers, tracking your progress and mistake history over time</li>
        <li>To apply your settings (theme, timer, resurfacing interval, etc.) to your own account</li>
        <li>To respond to messages you send via Contact support — submitting one automatically notifies the person who runs BluePrep by email, so it can actually be read and acted on</li>
        <li>To send you account-related emails (sign-up confirmation, password reset) via our authentication provider</li>
      </ul>
      <p>We do not use your data for advertising, and we do not sell or rent your information to anyone.</p>

      <h2>3. Third-Party Services We Use</h2>
      <p>
        Running BluePrep requires a small number of infrastructure providers, each used only for
        its specific purpose:
      </p>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>What it's used for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>Supabase</b></td>
            <td>Database, authentication, and encrypted storage for your account and practice data</td>
          </tr>
          <tr>
            <td><b>Vercel</b></td>
            <td>Hosting the application itself</td>
          </tr>
          <tr>
            <td><b>Resend</b></td>
            <td>Delivering the one email notification triggered when you submit a Contact support message</td>
          </tr>
          <tr>
            <td><b>OpenRouter + your chosen AI provider</b></td>
            <td>Only if you connect an AI key — your question/prompt content is sent directly from your browser to fulfill that specific request</td>
          </tr>
        </tbody>
      </table>
      <p>None of these providers receive your data for any purpose beyond running the feature they support.</p>

      <h2>4. Data Retention and Deletion</h2>
      <p>
        Your data is retained for as long as your account exists. You can permanently delete your
        account and everything tied to it — practice sessions, question attempts, mistake history,
        notes, and your AI connection — at any time from <b>Settings → Danger zone</b>. This is
        immediate and cannot be undone. Contact support messages you've sent are deleted along with
        the rest of your account, since they're tied to your account, not kept separately.
      </p>

      <h2>5. Children's Privacy</h2>
      <p>
        BluePrep is intended for users 13 and older and does not knowingly collect personal
        information from children under 13. If we become aware that a child under 13 has created
        an account, we will delete it.
      </p>

      <h2>6. Security</h2>
      <p>
        Every table in our database is scoped with row-level security, so your data is only ever
        accessible to your own authenticated account — not to other users. AI provider keys are
        encrypted at rest and never displayed in full after you save them.
      </p>

      <h2>7. Your Choices</h2>
      <ul>
        <li>You can change or remove your practice settings, target score, and AI connection at any time in <b>Settings</b> — changes apply immediately.</li>
        <li>You can permanently delete your account and all of its data yourself in <b>Settings → Danger zone</b>, or reach out via <b>Contact support</b> if you'd like a copy of your data first.</li>
      </ul>

      <h2>8. Changes to This Policy</h2>
      <p>If this policy changes in a meaningful way, we'll update the &quot;Last updated&quot; date above.</p>

      <h2>9. Contact</h2>
      <p>
        Questions about this policy or your data? Reach out via{' '}
        <Link to="/contact">Contact support</Link> inside the app.
      </p>
    </div>
  );
}
