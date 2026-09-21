# Privacy Policy

**Last updated: September 21, 2026**

This Privacy Policy explains what information BluePrep collects, how it's used, and who it's
shared with. BluePrep is a small, independently run project — this policy describes exactly what
the app actually does, not generic boilerplate.

## 1. Information We Collect

**Account information.** When you sign up, we collect your email address and password. Passwords
are handled entirely by our authentication provider, Supabase Auth — BluePrep never sees or stores
your password in plain text.

**Practice activity.** As you use BluePrep, we store the data needed to make the app work: your
practice sessions, question attempts and answers, timing, highlights, mark-for-review flags,
per-question notes, and your settings (theme, timer preferences, target score, test date, etc.).

**AI connection (optional).** If you choose to connect an AI provider key (via OpenRouter) to use
"Ask AI" or the "AI Performance Coach," we store which provider/model you selected and the last 4
characters of your key for display purposes only. The full key is encrypted at rest and is only
ever decrypted back to your own signed-in browser session — to make the actual AI request — never
read or logged by BluePrep's servers in the process. If you don't connect a key, none of this
applies to you.

**Contact messages.** If you use the in-app Contact support form, we store the email, subject, and
message you submit, along with your account ID.

**What we do *not* collect:** We do not use third-party analytics or advertising trackers of any
kind. We do not place tracking cookies. The only thing stored in your browser is your Supabase
authentication session (so you stay signed in), which is standard for any account-based web app.

## 2. How We Use Information

- To operate the core practice features — building sessions, grading answers, tracking your
  progress and mistake history over time
- To apply your settings (theme, timer, resurfacing interval, etc.) to your own account
- To respond to messages you send via Contact support — submitting one automatically notifies the
  person who runs BluePrep by email, so it can actually be read and acted on
- To send you account-related emails (sign-up confirmation, password reset) via our authentication
  provider

We do not use your data for advertising, and we do not sell or rent your information to anyone.

## 3. Third-Party Services We Use

Running BluePrep requires a small number of infrastructure providers, each used only for its
specific purpose:

| Service | What it's used for |
|---|---|
| **Supabase** | Database, authentication, and encrypted storage for your account and practice data |
| **Vercel** | Hosting the application itself |
| **Resend** | Delivering the one email notification triggered when you submit a Contact support message |
| **OpenRouter + your chosen AI provider** | Only if you connect an AI key — your question/prompt content is sent directly from your browser to fulfill that specific request |

None of these providers receive your data for any purpose beyond running the feature they support.

## 4. Data Retention and Deletion

Your data is retained for as long as your account exists. You can permanently delete your account
and everything tied to it — practice sessions, question attempts, mistake history, notes, and your
AI connection — at any time from **Settings → Danger zone**. This is immediate and cannot be
undone. Contact support messages you've sent are deleted along with the rest of your account, since
they're tied to your account, not kept separately.

## 5. Children's Privacy

BluePrep is intended for users 13 and older and does not knowingly collect personal information
from children under 13. If we become aware that a child under 13 has created an account, we will
delete it.

## 6. Security

Every table in our database is scoped with row-level security, so your data is only ever
accessible to your own authenticated account — not to other users. AI provider keys are encrypted
at rest and never displayed in full after you save them.

## 7. Your Choices

- You can change or remove your practice settings, target score, and AI connection at any time in
  **Settings** — changes apply immediately.
- You can permanently delete your account and all of its data yourself in **Settings → Danger
  zone**, or reach out via **Contact support** if you'd like a copy of your data first.

## 8. Changes to This Policy

If this policy changes in a meaningful way, we'll update the "Last updated" date above.

## 9. Contact

Questions about this policy or your data? Reach out via
[Contact support](https://blueprep-sat.vercel.app/contact) inside the app.
