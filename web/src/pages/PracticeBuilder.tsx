import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PracticeBuilder.css';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
import { getOrCreateUserSettings } from '../lib/userSettings';
import {
  countMatchingQuestions,
  createPracticeSession,
  selectQuestionIds,
  type QuestionFilters,
  type SubjectFilter,
} from '../lib/practiceSessions';
import { setSessionOrigin } from '../lib/sessionOrigin';
import { domainColor } from '../lib/domainColors';

// ---------------------------------------------------------------------------
// Ported from mockups/ad-hoc-builder.html. Pool-scarcity check and
// question-selection now query the live `questions` table.
// ---------------------------------------------------------------------------

// Both Math's and R&W's chips are domain-level filters — matching the real
// domain taxonomy used everywhere else in the app (Mistake Log, Progress,
// Session Summary). R&W chips were previously the 4 *skills* (Boundaries,
// Transitions, Rhetorical Synthesis, Inferences) instead of the 4 real
// domains; those skill names are still real and valid, just a finer-grained
// axis than domain — switched here for site-wide consistency, per explicit
// request, not because the skill names were wrong.
const MATH_CHIP_TO_DOMAIN: Record<string, string> = {
  Algebra: 'Algebra',
  'Advanced Math': 'Advanced Math',
  Geometry: 'Geometry and Trigonometry',
  'Data Analysis': 'Problem-Solving and Data Analysis',
};
const RW_CHIP_TO_DOMAIN: Record<string, string> = {
  'Information and Ideas': 'Information and Ideas',
  'Craft and Structure': 'Craft and Structure',
  'Expression of Ideas': 'Expression of Ideas',
  'Standard English Conventions': 'Standard English Conventions',
};
// Reverse maps — used to pre-select a chip when arriving from Progress's
// "click a weak domain" (both subjects' domains map 1:1 onto chips now).
const MATH_DOMAIN_TO_CHIP: Record<string, string> = Object.fromEntries(
  Object.entries(MATH_CHIP_TO_DOMAIN).map(([chip, domain]) => [domain, chip])
);
const RW_DOMAIN_TO_CHIP: Record<string, string> = Object.fromEntries(
  Object.entries(RW_CHIP_TO_DOMAIN).map(([chip, domain]) => [domain, chip])
);

type Subject = 'math' | 'rw' | 'both';
type Preset = 'quarter' | 'half' | 'module' | 'section';
type TimerBasis = 'official' | 'custom' | 'none';

// Real College Board blueprint pacing (index.html:1997-1998), plus per-question
// rate for custom counts (interpolated from the nearest tier, labeled "estimated").
const PACE: Record<'math' | 'rw', { quarter: [number, number]; half: [number, number]; module: [number, number]; section: [number, number]; rate: number }> = {
  math: { quarter: [6, 9], half: [11, 17.5], module: [22, 35], section: [44, 70], rate: 95.45 },
  rw: { quarter: [7, 8], half: [14, 16], module: [27, 32], section: [54, 64], rate: 71.1 },
};

const MATH_SECTIONS = ['Algebra', 'Advanced Math', 'Geometry', 'Data Analysis'] as const;
const RW_SECTIONS = [
  'Information and Ideas',
  'Craft and Structure',
  'Expression of Ideas',
  'Standard English Conventions',
] as const;

// Real skill taxonomy per domain (verified live against `questions.skill`,
// 2026-08-08) — a finer axis than domain, selectable as sub-topics once a
// domain chip is on. Values must match the DB's `skill` column EXACTLY,
// including a few skills' real trailing spaces in the source data — do not
// "clean up" the whitespace, it would silently break the filter.
const SKILLS_BY_DOMAIN: Record<string, string[]> = {
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

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];
// Full real domain names, matching Mistake Log / Progress / Session Summary
// exactly — no abbreviations, so the same domain always reads identically
// everywhere it appears in the app.
const MATH_CHIP_LABELS: Record<(typeof MATH_SECTIONS)[number], string> = {
  Algebra: 'Algebra',
  'Advanced Math': 'Advanced Math',
  Geometry: 'Geometry and Trigonometry',
  'Data Analysis': 'Problem-Solving and Data Analysis',
};

// Fixed row grouping for the domain-chip accordion — chunking explicitly
// (rather than relying on flex-wrap's own dynamic line-breaking) means
// expanding one domain's panel only grows ITS row; it can't regroup which
// chips share a line with which, which is what happened when a plain
// flex-basis:100% panel item was inserted mid-flow (every chip after it
// got recalculated onto a different line depending on which chip was
// currently expanded — chips visibly "jumped" between rows).
function chunk2<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2) as T[]);
  return rows;
}

function fmtMin(min: number): string {
  if (min < 1) return `${Math.round(min * 60)} sec`;
  return `${Math.round(min * 10) / 10} min`;
}

function computeTimeFor(subj: 'math' | 'rw', count: number, preset: Preset | null): { min: number; estimated: boolean } {
  const p = PACE[subj];
  if (preset) {
    const vals = p[preset];
    return { min: vals[1], estimated: false };
  }
  return { min: (count * p.rate) / 60, estimated: true };
}

export function PracticeBuilder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getOrCreateUserSettings(user.id)
      .then((row) => {
        if (!cancelled) setMistakeResurfaceDays(row.mistake_resurface_days);
      })
      .catch(() => {
        // Non-critical — selectQuestionIds falls back to its own default.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [currentSubj, setCurrentSubj] = useState<Subject>('both');
  const [mathChips, setMathChips] = useState<Set<string>>(new Set(['Algebra', 'Geometry']));
  const [rwChips, setRwChips] = useState<Set<string>>(new Set(['Information and Ideas']));
  // Sub-topic (skill) selection, one level finer than the domain chips above
  // — empty means "every skill within whichever domains are selected", not
  // "no questions match". Values are the real DB domain names' skills, so
  // toggling a domain chip off must also drop any of its now-orphaned
  // skills (see the cleanup effects below).
  const [mathSkills, setMathSkills] = useState<Set<string>>(new Set());
  const [rwSkills, setRwSkills] = useState<Set<string>>(new Set());
  // Accordion — AT MOST ONE domain's sub-topic panel open per subject, not a
  // Set. Selecting a domain opens its panel and closes whichever other
  // domain's panel was open; the chevron does the same switch without
  // touching selection (so a student can peek at a different selected
  // domain's sub-topics, or collapse the panel, without deselecting it).
  const [mathExpandedDomain, setMathExpandedDomain] = useState<string | null>(null);
  const [rwExpandedDomain, setRwExpandedDomain] = useState<string | null>(null);
  // Shared across both subjects — Easy/Medium/Hard, empty = all difficulties.
  const [difficulty, setDifficulty] = useState<Set<Difficulty>>(new Set());
  const [mathCount, setMathCount] = useState(22);
  const [rwCount, setRwCount] = useState(15);
  const [activePreset, setActivePreset] = useState<Preset | null>('module');
  const [timerBasis, setTimerBasis] = useState<TimerBasis>('official');
  const [customMinutes, setCustomMinutes] = useState(45);

  const [qTimerDisplay, setQTimerDisplay] = useState(true);
  const [feedback, setFeedback] = useState(true);
  const [includeRetired, setIncludeRetired] = useState(true);
  const [newOnly, setNewOnly] = useState(false);
  // Loaded once for the mistake-resurfacing fallback ceiling in
  // selectQuestionIds — falls back to that function's own default (14) if
  // the settings row hasn't loaded yet by the time a session starts.
  const [mistakeResurfaceDays, setMistakeResurfaceDays] = useState<number | null>(null);
  // Click/tap-triggered (not just hover) so the explanation is reachable on
  // touch devices — a native `title` tooltip never fires on tap.
  const [newOnlyTipOpen, setNewOnlyTipOpen] = useState(false);
  useEffect(() => {
    if (!newOnlyTipOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.info-tip-wrap')) setNewOnlyTipOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [newOnlyTipOpen]);

  const [toastMsg, setToastMsg] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastShow(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastShow(false), 2200);
  }, []);

  const toggleChip = useCallback((subj: 'math' | 'rw', name: string) => {
    setActivePreset(null);
    const chipsSetter = subj === 'math' ? setMathChips : setRwChips;
    const expandedSetter = subj === 'math' ? setMathExpandedDomain : setRwExpandedDomain;
    let turnedOn = false;
    chipsSetter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        turnedOn = true;
      }
      return next;
    });
    // Selecting a domain opens its sub-topic panel immediately (closing
    // whichever other domain's panel was open); deselecting it closes its
    // own panel if it was the one open. Both are the same "click the main
    // topic" gesture the student just performed.
    expandedSetter((prevExpanded) => {
      if (turnedOn) return name;
      return prevExpanded === name ? null : prevExpanded;
    });
  }, []);

  const toggleExpandedDomain = useCallback((subj: 'math' | 'rw', name: string) => {
    const setter = subj === 'math' ? setMathExpandedDomain : setRwExpandedDomain;
    setter((prev) => (prev === name ? null : name));
  }, []);

  const toggleSkill = useCallback((subj: 'math' | 'rw', skill: string) => {
    const setter = subj === 'math' ? setMathSkills : setRwSkills;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }, []);

  const toggleDifficulty = useCallback((d: Difficulty) => {
    setDifficulty((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }, []);

  // Dropping a domain chip should drop any of its skills too — a selected
  // skill whose parent domain is no longer active would otherwise silently
  // keep narrowing the pool from a chip the student can no longer see.
  useEffect(() => {
    const domainToChip = MATH_CHIP_TO_DOMAIN;
    const activeSkills = new Set(Array.from(mathChips).flatMap((chip) => SKILLS_BY_DOMAIN[domainToChip[chip]] ?? []));
    setMathSkills((prev) => {
      const next = new Set(Array.from(prev).filter((s) => activeSkills.has(s)));
      return next.size === prev.size ? prev : next;
    });
    setMathExpandedDomain((prev) => (prev && !mathChips.has(prev) ? null : prev));
  }, [mathChips]);

  useEffect(() => {
    const activeSkills = new Set(Array.from(rwChips).flatMap((chip) => SKILLS_BY_DOMAIN[RW_CHIP_TO_DOMAIN[chip]] ?? []));
    setRwSkills((prev) => {
      const next = new Set(Array.from(prev).filter((s) => activeSkills.has(s)));
      return next.size === prev.size ? prev : next;
    });
    setRwExpandedDomain((prev) => (prev && !rwChips.has(prev) ? null : prev));
  }, [rwChips]);

  const step = useCallback((target: 'math' | 'rw', delta: number) => {
    setActivePreset(null);
    const setter = target === 'math' ? setMathCount : setRwCount;
    setter((v) => Math.max(1, Math.min(100, v + delta)));
  }, []);

  const onCountInput = useCallback((target: 'math' | 'rw', value: string) => {
    setActivePreset(null);
    const n = parseInt(value, 10) || 0;
    if (target === 'math') setMathCount(n);
    else setRwCount(n);
  }, []);

  const pickPreset = useCallback((preset: Preset) => {
    setActivePreset(preset);
    setMathCount(PACE.math[preset][0]);
    setRwCount(PACE.rw[preset][0]);
  }, []);

  // Pre-fill from Progress's "click a weak domain → practice it" (state is
  // only present when arriving that way, so this only ever runs once, on
  // whichever mount actually carries it).
  useEffect(() => {
    const preset = location.state as { presetSubject?: 'math' | 'rw'; presetDomainLabel?: string } | null;
    if (!preset?.presetSubject) return;
    setCurrentSubj(preset.presetSubject);
    if (preset.presetDomainLabel) {
      const chip =
        preset.presetSubject === 'math'
          ? MATH_DOMAIN_TO_CHIP[preset.presetDomainLabel]
          : RW_DOMAIN_TO_CHIP[preset.presetDomainLabel];
      if (chip) (preset.presetSubject === 'math' ? setMathChips : setRwChips)(new Set([chip]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rwPool, setRwPool] = useState<number | null>(null);

  // Pool-scarcity check for whatever R&W domains are currently selected —
  // generalized from a single hardcoded skill now that R&W filters by
  // domain like Math does. Re-queries whenever the filters that affect the
  // pool's size change.
  useEffect(() => {
    if (rwChips.size === 0) {
      setRwPool(null);
      return;
    }
    let cancelled = false;
    countMatchingQuestions({
      subject: 'Reading and Writing',
      domains: Array.from(rwChips).map((c) => RW_CHIP_TO_DOMAIN[c]).filter(Boolean),
      skills: rwSkills.size > 0 ? Array.from(rwSkills) : null,
      difficulty: difficulty.size > 0 ? Array.from(difficulty) : null,
      includeRetired,
      newOnlyUserId: newOnly ? (user?.id ?? null) : null,
    })
      .then((count) => {
        if (!cancelled) setRwPool(count);
      })
      .catch(() => {
        if (!cancelled) setRwPool(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rwChips, rwSkills, difficulty, includeRetired, newOnly, user]);

  const startWithFewer = useCallback(() => {
    if (rwPool !== null) setRwCount(rwPool);
    setActivePreset(null);
    toast('Count adjusted to match the available pool.');
  }, [toast, rwPool]);

  const widenFilters = useCallback(() => {
    setRwChips(new Set(RW_SECTIONS));
    // Sub-topic and difficulty filters narrow the pool the same way domain
    // chips do — clear them too, or "widen filters" wouldn't actually widen.
    setRwSkills(new Set());
    setDifficulty(new Set());
    toast('All R&W sections selected — pool widened.');
  }, [toast]);

  // ---------------- derived (recomputed every render — no imperative sync needed) ----------------
  const mTime = computeTimeFor('math', mathCount, activePreset);
  const rTime = computeTimeFor('rw', rwCount, activePreset);

  let totalCount = 0;
  let totalTime = 0;
  if (currentSubj === 'math' || currentSubj === 'both') {
    totalCount += mathCount;
    totalTime += mTime.min;
  }
  if (currentSubj === 'rw' || currentSubj === 'both') {
    totalCount += rwCount;
    totalTime += rTime.min;
  }

  let startLabel: string;
  if (timerBasis === 'official') {
    startLabel = `Start ${totalCount}-question set → (${fmtMin(totalTime)})`;
  } else if (timerBasis === 'custom') {
    startLabel = `Start ${totalCount}-question set → (${customMinutes || 0} min, your time)`;
  } else {
    startLabel = `Start ${totalCount}-question set → (untimed)`;
  }

  const poolWarningShown =
    rwChips.size > 0 && (currentSubj === 'rw' || currentSubj === 'both') && rwPool !== null && rwCount > rwPool;

  const buildFilters = useCallback(
    (subj: 'math' | 'rw'): QuestionFilters => {
      const chips = subj === 'math' ? mathChips : rwChips;
      const chipToDomain = subj === 'math' ? MATH_CHIP_TO_DOMAIN : RW_CHIP_TO_DOMAIN;
      const domains = chips.size > 0 ? Array.from(chips).map((c) => chipToDomain[c]).filter(Boolean) : null;
      const skills = subj === 'math' ? mathSkills : rwSkills;
      return {
        subject: subj === 'math' ? 'Math' : 'Reading and Writing',
        domains,
        skills: skills.size > 0 ? Array.from(skills) : null,
        difficulty: difficulty.size > 0 ? Array.from(difficulty) : null,
        includeRetired,
        newOnlyUserId: newOnly ? (user?.id ?? null) : null,
        // Mistake-resurfacing: irrelevant when newOnly is on (that toggle
        // already excludes every attempted question, missed or not), but
        // harmless to pass either way.
        resurfaceForUserId: user?.id ?? null,
        mistakeResurfaceDays,
      };
    },
    [mathChips, rwChips, mathSkills, rwSkills, difficulty, includeRetired, newOnly, user, mistakeResurfaceDays]
  );

  const startSession = useCallback(async () => {
    if (!user) {
      setStartError('Not signed in.');
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const subjectFilter: SubjectFilter | null =
        currentSubj === 'math' ? 'Math' : currentSubj === 'rw' ? 'Reading and Writing' : null;

      const questionIds: string[] = [];
      if (currentSubj === 'math' || currentSubj === 'both') {
        questionIds.push(...(await selectQuestionIds(buildFilters('math'), mathCount)));
      }
      if (currentSubj === 'rw' || currentSubj === 'both') {
        questionIds.push(...(await selectQuestionIds(buildFilters('rw'), rwCount)));
      }

      const session = await createPracticeSession({
        userId: user.id,
        mode: 'ad_hoc',
        questionIds,
        requestedCount: totalCount,
        timerMode: qTimerDisplay ? 'per_question' : 'session_only',
        timerBasis: timerBasis === 'official' ? 'official_pace' : timerBasis === 'custom' ? 'custom' : 'none',
        feedbackMode: feedback ? 'immediate' : 'end_of_session',
        includeRetired,
        includeNewOnly: newOnly,
        subjectFilter,
        sizePreset: activePreset,
        allottedSeconds:
          timerBasis === 'custom' ? customMinutes * 60 : timerBasis === 'official' ? Math.round(totalTime * 60) : null,
      });
      setSessionOrigin(session.id, '/practice/new');
      navigate(`/practice/${session.id}/q/1`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start session.');
    } finally {
      setStarting(false);
    }
  }, [
    user,
    currentSubj,
    totalCount,
    mathCount,
    rwCount,
    buildFilters,
    qTimerDisplay,
    timerBasis,
    feedback,
    includeRetired,
    newOnly,
    activePreset,
    customMinutes,
    navigate,
  ]);

  return (
    <AppShell title="Build a practice set">
    <div className="builder-root">
      <div className="page">
        <p className="sub">Every count and every minute below is computed live — nothing here is a fixed number.</p>

        <div className="card">
          <h2>Subject</h2>
          <div className="seg">
            <div
              className={`seg-btn math${currentSubj === 'math' ? ' active' : ''}`}
              onClick={() => setCurrentSubj('math')}
            >
              Math
            </div>
            <div className={`seg-btn rw${currentSubj === 'rw' ? ' active' : ''}`} onClick={() => setCurrentSubj('rw')}>
              Reading &amp; Writing
            </div>
            <div
              className={`seg-btn both${currentSubj === 'both' ? ' active' : ''}`}
              onClick={() => setCurrentSubj('both')}
            >
              <span className="seg-both-chip math">Math</span>
              <span className="seg-both-chip rw">R&amp;W</span>
            </div>
          </div>
        </div>

        {currentSubj !== 'rw' && (
          <div className="subject-block math">
            <h3>Math</h3>
            <div className="chips-accordion">
              {chunk2(MATH_SECTIONS).map((row) => (
                <div key={row.join('|')} className="chip-fixed-row">
                  <div className="chips">
                    {row.map((s) => {
                      const on = mathChips.has(s);
                      // These 4 chips map 1:1 onto real Math domains (unlike
                      // the R&W chips below, which are skills, not domains)
                      // — so it's safe to give each its own domain color
                      // here, matching Mistake Log / Progress instead of one
                      // flat "math" color.
                      const color = on ? domainColor(MATH_CHIP_TO_DOMAIN[s]) : null;
                      const skills = SKILLS_BY_DOMAIN[MATH_CHIP_TO_DOMAIN[s]] ?? [];
                      const skillCount = Array.from(mathSkills).filter((sk) => skills.includes(sk)).length;
                      const expanded = on && mathExpandedDomain === s;
                      return (
                        <div
                          key={s}
                          className={`chip math${on ? ' on' : ''}`}
                          style={color ? { borderColor: color.border, color: color.text, background: color.bg } : undefined}
                          onClick={() => toggleChip('math', s)}
                        >
                          {MATH_CHIP_LABELS[s]}
                          {on && (
                            <>
                              {skillCount > 0 && <span className="chip-skill-badge">{skillCount}</span>}
                              <span
                                className="chip-chevron"
                                aria-label={expanded ? 'Hide sub-topics' : 'Show sub-topics'}
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpandedDomain('math', s);
                                }}
                              >
                                {expanded ? '▴' : '▾'}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Fixed row grouping (chunk2), not flex-wrap's own dynamic
                      line-breaking — so expanding one domain's panel only
                      grows ITS row and never regroups which chips share a
                      line with which. */}
                  {row
                    .filter((s) => mathChips.has(s) && mathExpandedDomain === s)
                    .map((s) => {
                      const skills = SKILLS_BY_DOMAIN[MATH_CHIP_TO_DOMAIN[s]] ?? [];
                      return (
                        <div key={s} className="skill-chips">
                          {skills.map((skill) => (
                            <div
                              key={skill}
                              className={`chip skill${mathSkills.has(skill) ? ' on' : ''}`}
                              onClick={() => toggleSkill('math', skill)}
                            >
                              {skill.trim()}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
            <div className="stepper">
              <button onClick={() => step('math', -1)}>−</button>
              <input
                type="number"
                value={mathCount}
                min={1}
                max={100}
                onChange={(e) => onCountInput('math', e.target.value)}
              />
              <button onClick={() => step('math', 1)}>+</button>
              <span className="est mono">
                {(mTime.estimated ? '~' : '') + fmtMin(mTime.min) + (mTime.estimated ? ', estimated' : '')}
              </span>
            </div>
          </div>
        )}

        {currentSubj !== 'math' && (
          <div className="subject-block rw">
            <h3>Reading &amp; Writing</h3>
            <div className="chips-accordion">
              {chunk2(RW_SECTIONS).map((row) => (
                <div key={row.join('|')} className="chip-fixed-row">
                  <div className="chips">
                    {row.map((s) => {
                      const on = rwChips.has(s);
                      const color = on ? domainColor(RW_CHIP_TO_DOMAIN[s]) : null;
                      const skills = SKILLS_BY_DOMAIN[RW_CHIP_TO_DOMAIN[s]] ?? [];
                      const skillCount = Array.from(rwSkills).filter((sk) => skills.includes(sk)).length;
                      const expanded = on && rwExpandedDomain === s;
                      return (
                        <div
                          key={s}
                          className={`chip rw${on ? ' on' : ''}`}
                          style={color ? { borderColor: color.border, color: color.text, background: color.bg } : undefined}
                          onClick={() => toggleChip('rw', s)}
                        >
                          {s}
                          {on && (
                            <>
                              {skillCount > 0 && <span className="chip-skill-badge">{skillCount}</span>}
                              <span
                                className="chip-chevron"
                                aria-label={expanded ? 'Hide sub-topics' : 'Show sub-topics'}
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpandedDomain('rw', s);
                                }}
                              >
                                {expanded ? '▴' : '▾'}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {row
                    .filter((s) => rwChips.has(s) && rwExpandedDomain === s)
                    .map((s) => {
                      const skills = SKILLS_BY_DOMAIN[RW_CHIP_TO_DOMAIN[s]] ?? [];
                      return (
                        <div key={s} className="skill-chips">
                          {skills.map((skill) => (
                            <div
                              key={skill}
                              className={`chip skill${rwSkills.has(skill) ? ' on' : ''}`}
                              onClick={() => toggleSkill('rw', skill)}
                            >
                              {skill.trim()}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
            <div className="stepper">
              <button onClick={() => step('rw', -1)}>−</button>
              <input
                type="number"
                value={rwCount}
                min={1}
                max={100}
                onChange={(e) => onCountInput('rw', e.target.value)}
              />
              <button onClick={() => step('rw', 1)}>+</button>
              <span className="est mono">
                {(rTime.estimated ? '~' : '') + fmtMin(rTime.min) + (rTime.estimated ? ', estimated' : '')}
              </span>
            </div>
          </div>
        )}

        <div className="card">
          <h2>Difficulty</h2>
          <p className="sub" style={{ marginBottom: 10 }}>
            Leave all unselected to include every difficulty.
          </p>
          <div className="chips">
            {DIFFICULTIES.map((d) => (
              <div
                key={d}
                className={`chip difficulty diff-${d.toLowerCase()}${difficulty.has(d) ? ' on' : ''}`}
                onClick={() => toggleDifficulty(d)}
              >
                {d}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Quick-pick a standard length</h2>
          <div className="quickpicks">
            {(['quarter', 'half', 'module', 'section'] as Preset[]).map((p) => (
              <div key={p} className={`qp${activePreset === p ? ' active' : ''}`} onClick={() => pickPreset(p)}>
                {p[0].toUpperCase() + p.slice(1)}
              </div>
            ))}
          </div>
        </div>

        <div className={`warn-banner${poolWarningShown ? ' show' : ''}`}>
          <p className="wtitle">⚠ Pool check</p>
          <p>
            Only {rwPool ?? 0} R&amp;W questions match your selected domain{rwChips.size === 1 ? '' : 's'} (you asked
            for {rwCount}).
          </p>
          <div className="wactions">
            <button className="wbtn" onClick={startWithFewer}>
              Start with {rwPool ?? 0}
            </button>
            <button className="wbtn" onClick={widenFilters}>
              Widen filters
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Timer</h2>
          <div className="timer-opts">
            <div className={`timer-opt${timerBasis === 'official' ? ' active' : ''}`} onClick={() => setTimerBasis('official')}>
              Official pace
            </div>
            <div className={`timer-opt${timerBasis === 'custom' ? ' active' : ''}`} onClick={() => setTimerBasis('custom')}>
              Custom time
            </div>
            <div className={`timer-opt${timerBasis === 'none' ? ' active' : ''}`} onClick={() => setTimerBasis('none')}>
              Untimed
            </div>
          </div>
          <div className={`custom-time-input${timerBasis === 'custom' ? ' show' : ''}`}>
            <input
              type="number"
              value={customMinutes}
              min={1}
              onChange={(e) => setCustomMinutes(parseInt(e.target.value, 10) || 0)}
            />
            <span className="mono" style={{ fontSize: '12px' }}>
              minutes total
            </span>
          </div>
        </div>

        <div className="card">
          <h2>Session options</h2>
          <div className="toggle-row">
            <span className="tlabel">Per-question timer display</span>
            <button className={`switch${qTimerDisplay ? ' on' : ''}`} onClick={() => setQTimerDisplay((v) => !v)} />
          </div>
          <div className="toggle-row">
            <span className="tlabel">Immediate feedback (vs. end of session)</span>
            <button className={`switch${feedback ? ' on' : ''}`} onClick={() => setFeedback((v) => !v)} />
          </div>
          <div className="toggle-row">
            <span className="tlabel">Include retired questions</span>
            <button className={`switch${includeRetired ? ' on' : ''}`} onClick={() => setIncludeRetired((v) => !v)} />
          </div>
          <div className="toggle-row">
            {/* "New" = never attempted by this user before, in any past session — not a bank-freshness/release-date
                concept. Distinct from "exclude previously correct": this excludes a question even if the user
                got it wrong last time. Implemented via selectQuestionIds/countMatchingQuestions's newOnlyUserId
                filter (an anti-join against question_attempts for this user_id/question_id). */}
            <span className="tlabel">
              New questions only{' '}
              <span className="info-tip-wrap">
                <button
                  type="button"
                  className="info-tip-btn"
                  aria-label="What does 'new questions only' mean?"
                  onClick={() => setNewOnlyTipOpen((v) => !v)}
                >
                  ⓘ
                </button>
                {newOnlyTipOpen && (
                  <span className="info-tip-bubble">
                    Questions you haven&apos;t attempted before, in any past session — whether you got them right or
                    wrong.
                  </span>
                )}
              </span>
            </span>
            <button className={`switch${newOnly ? ' on' : ''}`} onClick={() => setNewOnly((v) => !v)} />
          </div>
        </div>

        <div className="start-bar">
          <button className="start-btn" disabled={starting} onClick={startSession}>
            {starting ? 'Starting…' : startLabel}
          </button>
          {startError && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{startError}</p>}
          <p className="start-note">Math and R&amp;W time sum separately — they pace differently, so this is never a blended average.</p>
        </div>
      </div>

      <div className={`toast${toastShow ? ' show' : ''}`}>{toastMsg}</div>
    </div>
    </AppShell>
  );
}
