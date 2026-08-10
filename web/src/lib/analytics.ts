import type { AttemptWithQuestion } from './practiceSessions';
import { ALL_DOMAINS } from './domainColors';

// ---------------------------------------------------------------------------
// Progress's "Skill map" section. Aggregates the same getAllAttemptsForUser
// rows Progress already loads — no separate query. Mirrors V1's real chart
// inventory (overallRadar/strandCharts/skillCharts in index.html): 1 overall
// radar + 2 strand radars (Math/R&W, 4 axes each) + up to 8 per-domain radars,
// gated on 3+ skills — Expression of Ideas and Standard English Conventions
// only have 2 real skills each (a structural fact of the taxonomy, not a
// data-volume issue), so those two always render as a 2-bar comparison
// instead of a permanently-degenerate "radar" that can never be a polygon.
// ---------------------------------------------------------------------------

// Real skill taxonomy, matching SKILLS_BY_DOMAIN in PracticeBuilder.tsx
// exactly (including the real trailing-space skill strings some source rows
// use) — keep in sync if that list ever changes.
export const SKILLS_BY_DOMAIN: Record<string, string[]> = {
  Algebra: [
    'Linear equations in one variable',
    'Linear equations in two variables',
    'Linear functions',
    'Linear inequalities in one or two variables',
    'Systems of two linear equations in two variables',
  ],
  'Advanced Math': [
    'Equivalent expressions',
    'Nonlinear equations in one variable and systems of equations in two variables ',
    'Nonlinear functions',
  ],
  'Geometry and Trigonometry': ['Area and volume', 'Circles', 'Lines, angles, and triangles', 'Right triangles and trigonometry'],
  'Problem-Solving and Data Analysis': [
    'Evaluating statistical claims: Observational studies and experiments ',
    'Inference from sample statistics and margin of error ',
    'One-variable data: Distributions and measures of center and spread',
    'Percentages',
    'Probability and conditional probability',
    'Ratios, rates, proportional relationships, and units',
    'Two-variable data: Models and scatterplots',
  ],
  'Information and Ideas': ['Central Ideas and Details', 'Command of Evidence', 'Inferences'],
  'Craft and Structure': ['Cross-Text Connections', 'Text Structure and Purpose', 'Words in Context'],
  'Expression of Ideas': ['Rhetorical Synthesis', 'Transitions'],
  'Standard English Conventions': ['Boundaries', 'Form, Structure, and Sense'],
};

export interface AccuracyPoint {
  key: string;
  label: string;
  correct: number;
  attempts: number;
  pct: number;
}

function shortSkillLabel(skill: string, maxLen = 22): string {
  const trimmed = skill.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

/** Accuracy per real skill, one point per skill IN the given domains (0%
 * shown for a skill never attempted, so radar axes stay a fixed shape). */
export function skillAccuracyForDomains(attempts: AttemptWithQuestion[], domains: string[]): AccuracyPoint[] {
  const stats = new Map<string, { correct: number; attempts: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null) continue;
    if (!a.questions.skill || !domains.includes(a.questions.domain)) continue;
    const entry = stats.get(a.questions.skill) ?? { correct: 0, attempts: 0 };
    entry.attempts += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(a.questions.skill, entry);
  }
  const skills = domains.flatMap((d) => SKILLS_BY_DOMAIN[d] ?? []);
  return skills.map((skill) => {
    const s = stats.get(skill) ?? { correct: 0, attempts: 0 };
    return {
      key: skill,
      label: shortSkillLabel(skill),
      correct: s.correct,
      attempts: s.attempts,
      pct: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0,
    };
  });
}

export function skillAccuracyForDomain(attempts: AttemptWithQuestion[], domain: string): AccuracyPoint[] {
  return skillAccuracyForDomains(attempts, [domain]);
}

/** Accuracy per domain within a subject, 4 axes (Math or R&W's 4 domains). */
export function domainAccuracyForSubject(attempts: AttemptWithQuestion[], subject: 'math' | 'rw'): AccuracyPoint[] {
  const domains = ALL_DOMAINS.filter((d) => d.subject === subject).map((d) => d.domain);
  const stats = new Map<string, { correct: number; attempts: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null) continue;
    if (!domains.includes(a.questions.domain)) continue;
    const entry = stats.get(a.questions.domain) ?? { correct: 0, attempts: 0 };
    entry.attempts += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(a.questions.domain, entry);
  }
  return domains.map((domain) => {
    const s = stats.get(domain) ?? { correct: 0, attempts: 0 };
    return {
      key: domain,
      label: domain,
      correct: s.correct,
      attempts: s.attempts,
      pct: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0,
    };
  });
}

/** Every real skill across both subjects with 1+ attempt — the overall
 * skill-map radar. Unlike the per-domain versions, this omits never-attempted
 * skills (with 44 real skills total, a full axis set would be unreadable). */
export function overallSkillAccuracy(attempts: AttemptWithQuestion[]): AccuracyPoint[] {
  const stats = new Map<string, { correct: number; attempts: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null || !a.questions.skill) continue;
    const entry = stats.get(a.questions.skill) ?? { correct: 0, attempts: 0 };
    entry.attempts += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(a.questions.skill, entry);
  }
  return Array.from(stats.entries())
    .map(([skill, s]) => ({
      key: skill,
      label: shortSkillLabel(skill),
      correct: s.correct,
      attempts: s.attempts,
      pct: Math.round((s.correct / s.attempts) * 100),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Real max is 9 per V1's inventory: 1 overall + 2 strand + up to 8 domain
 * (Expression of Ideas / Standard English Conventions render as a 2-bar
 * comparison instead of a radar — 2 axes can never be a real polygon). */
export const RADAR_ELIGIBLE_DOMAINS = ALL_DOMAINS.filter((d) => (SKILLS_BY_DOMAIN[d.domain]?.length ?? 0) >= 3).map(
  (d) => d.domain,
);
export const BAR_ONLY_DOMAINS = ALL_DOMAINS.filter((d) => (SKILLS_BY_DOMAIN[d.domain]?.length ?? 0) < 3).map((d) => d.domain);

export interface DifficultyAccuracy {
  difficulty: string;
  correct: number;
  attempts: number;
  pct: number;
}

const DIFFICULTY_ORDER = ['Easy', 'Medium', 'Hard'];

export function accuracyByDifficulty(attempts: AttemptWithQuestion[]): DifficultyAccuracy[] {
  const stats = new Map<string, { correct: number; attempts: number }>();
  for (const a of attempts) {
    if (!a.questions || a.is_correct === null || !a.questions.difficulty) continue;
    const entry = stats.get(a.questions.difficulty) ?? { correct: 0, attempts: 0 };
    entry.attempts += 1;
    if (a.is_correct) entry.correct += 1;
    stats.set(a.questions.difficulty, entry);
  }
  return DIFFICULTY_ORDER.filter((d) => stats.has(d)).map((difficulty) => {
    const s = stats.get(difficulty)!;
    return { difficulty, correct: s.correct, attempts: s.attempts, pct: Math.round((s.correct / s.attempts) * 100) };
  });
}

export interface RankedGroup {
  strongest: AccuracyPoint[];
  weakest: AccuracyPoint[];
}

/** Top/bottom N groups by accuracy, minimum-attempts filtered so a single
 * lucky/unlucky attempt doesn't dominate the ranking. */
export function rankByAccuracy(points: AccuracyPoint[], n = 5, minAttempts = 2): RankedGroup {
  const eligible = points.filter((p) => p.attempts >= minAttempts);
  const sorted = [...eligible].sort((a, b) => b.pct - a.pct || b.attempts - a.attempts);
  return { strongest: sorted.slice(0, n), weakest: sorted.slice(-n).reverse() };
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Plain-text digest for pasting into an AI coach — mirrors V1's
 * copyDigest(), same structure (totals, strongest/weakest skills, per-subject
 * domain breakdown). */
export function buildDigest(attempts: AttemptWithQuestion[]): string {
  const scored = attempts.filter((a) => a.is_correct !== null);
  const correct = scored.filter((a) => a.is_correct).length;
  const pct = scored.length > 0 ? Math.round((correct / scored.length) * 100) : 0;

  const overall = overallSkillAccuracy(attempts);
  const ranked = rankByAccuracy(overall, 5, 2);
  const mathDomains = domainAccuracyForSubject(attempts, 'math').filter((d) => d.attempts > 0);
  const rwDomains = domainAccuracyForSubject(attempts, 'rw').filter((d) => d.attempts > 0);

  const lines: string[] = [];
  lines.push(`BluePrep practice digest (${fmtDateShort(new Date().toISOString())})`);
  lines.push(`Totals: ${scored.length} attempts, ${correct} correct, ${pct}% accuracy.`);
  lines.push('');
  lines.push('Strongest skills:');
  ranked.strongest.forEach((s, i) => lines.push(`  ${i + 1}. ${s.key} — ${s.pct}% (${s.correct}/${s.attempts})`));
  lines.push('');
  lines.push('Weakest skills:');
  ranked.weakest.forEach((s, i) => lines.push(`  ${i + 1}. ${s.key} — ${s.pct}% (${s.correct}/${s.attempts})`));
  lines.push('');
  lines.push('Math strands by accuracy:');
  [...mathDomains].sort((a, b) => b.pct - a.pct).forEach((d) => lines.push(`  ${d.label}: ${d.pct}% (${d.correct}/${d.attempts})`));
  lines.push('');
  lines.push('Reading and Writing strands by accuracy:');
  [...rwDomains].sort((a, b) => b.pct - a.pct).forEach((d) => lines.push(`  ${d.label}: ${d.pct}% (${d.correct}/${d.attempts})`));
  return lines.join('\n');
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Full per-attempt CSV export — mirrors V1's "Export cumulative CSV". */
export function exportAttemptsCsv(attempts: AttemptWithQuestion[]): void {
  const header = ['date', 'subject', 'domain', 'skill', 'difficulty', 'correct', 'time_seconds'];
  const rows = attempts
    .filter((a) => a.questions)
    .map((a) =>
      [
        fmtDateShort(a.submitted_at),
        a.questions!.subject,
        a.questions!.domain,
        a.questions!.skill ?? '',
        a.questions!.difficulty ?? '',
        a.is_correct === null ? '' : a.is_correct ? 'true' : 'false',
        a.time_taken_seconds !== null ? String(a.time_taken_seconds) : '',
      ]
        .map(csvField)
        .join(','),
    );
  const csv = [header.map(csvField).join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blueprep-attempts.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
