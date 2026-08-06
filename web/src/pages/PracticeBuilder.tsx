import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PracticeBuilder.css';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../lib/AuthContext';
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

// Math chips are domain-level filters; R&W chips are skill-level filters —
// the storyboard's "sections" are domains for Math but individual skills for
// R&W (verified against the live schema's domain/skill values).
const MATH_CHIP_TO_DOMAIN: Record<string, string> = {
  Algebra: 'Algebra',
  'Advanced Math': 'Advanced Math',
  Geometry: 'Geometry and Trigonometry',
  'Data Analysis': 'Problem-Solving and Data Analysis',
};
const RW_CHIP_TO_SKILL: Record<string, string> = {
  Boundaries: 'Boundaries',
  Transitions: 'Transitions',
  'Rhetorical Synthesis': 'Rhetorical Synthesis',
  Inferences: 'Inferences',
};
// Reverse of MATH_CHIP_TO_DOMAIN — used to pre-select a Math chip when
// arriving from Progress's "click a weak domain" (Math domains map 1:1 onto
// chips; R&W's chips are skill-level and don't have a matching domain-level
// preset, so only the subject gets pre-filled for R&W).
const MATH_DOMAIN_TO_CHIP: Record<string, string> = Object.fromEntries(
  Object.entries(MATH_CHIP_TO_DOMAIN).map(([chip, domain]) => [domain, chip])
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
const RW_SECTIONS = ['Boundaries', 'Transitions', 'Rhetorical Synthesis', 'Inferences'] as const;
const MATH_CHIP_LABELS: Record<(typeof MATH_SECTIONS)[number], string> = {
  Algebra: 'Algebra',
  'Advanced Math': 'Advanced Math',
  Geometry: 'Geometry & Trig',
  'Data Analysis': 'Data Analysis',
};

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
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [currentSubj, setCurrentSubj] = useState<Subject>('both');
  const [mathChips, setMathChips] = useState<Set<string>>(new Set(['Algebra', 'Geometry']));
  const [rwChips, setRwChips] = useState<Set<string>>(new Set(['Boundaries']));
  const [mathCount, setMathCount] = useState(22);
  const [rwCount, setRwCount] = useState(15);
  const [activePreset, setActivePreset] = useState<Preset | null>('module');
  const [timerBasis, setTimerBasis] = useState<TimerBasis>('official');
  const [customMinutes, setCustomMinutes] = useState(45);

  const [qTimerDisplay, setQTimerDisplay] = useState(true);
  const [feedback, setFeedback] = useState(true);
  const [includeRetired, setIncludeRetired] = useState(true);
  const [newOnly, setNewOnly] = useState(false);
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
    const setter = subj === 'math' ? setMathChips : setRwChips;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

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
    if (preset.presetSubject === 'math' && preset.presetDomainLabel) {
      const chip = MATH_DOMAIN_TO_CHIP[preset.presetDomainLabel];
      if (chip) setMathChips(new Set([chip]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [boundariesPool, setBoundariesPool] = useState<number | null>(null);

  // Pool-scarcity check for the R&W "Boundaries" skill specifically, matching
  // the warning banner's copy. Re-queries whenever the filters that affect
  // that pool's size change.
  useEffect(() => {
    if (!rwChips.has('Boundaries')) {
      setBoundariesPool(null);
      return;
    }
    let cancelled = false;
    countMatchingQuestions({
      subject: 'Reading and Writing',
      skills: ['Boundaries'],
      includeRetired,
      newOnlyUserId: newOnly ? (user?.id ?? null) : null,
    })
      .then((count) => {
        if (!cancelled) setBoundariesPool(count);
      })
      .catch(() => {
        if (!cancelled) setBoundariesPool(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rwChips, includeRetired, newOnly, user]);

  const startWithFewer = useCallback(() => {
    if (boundariesPool !== null) setRwCount(boundariesPool);
    setActivePreset(null);
    toast('Count adjusted to match the available pool.');
  }, [toast, boundariesPool]);

  const widenFilters = useCallback(() => {
    setRwChips(new Set(RW_SECTIONS));
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

  const boundariesOn = rwChips.has('Boundaries');
  const poolWarningShown =
    boundariesOn &&
    (currentSubj === 'rw' || currentSubj === 'both') &&
    boundariesPool !== null &&
    rwCount > boundariesPool;

  const buildFilters = useCallback(
    (subj: 'math' | 'rw'): QuestionFilters => {
      const chips = subj === 'math' ? mathChips : rwChips;
      const domains =
        subj === 'math' && chips.size > 0 ? Array.from(chips).map((c) => MATH_CHIP_TO_DOMAIN[c]).filter(Boolean) : null;
      const skills =
        subj === 'rw' && chips.size > 0 ? Array.from(chips).map((c) => RW_CHIP_TO_SKILL[c]).filter(Boolean) : null;
      return {
        subject: subj === 'math' ? 'Math' : 'Reading and Writing',
        domains,
        skills,
        includeRetired,
        newOnlyUserId: newOnly ? (user?.id ?? null) : null,
      };
    },
    [mathChips, rwChips, includeRetired, newOnly, user]
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
            <div className="chips">
              {MATH_SECTIONS.map((s) => {
                const on = mathChips.has(s);
                // These 4 chips map 1:1 onto real Math domains (unlike the
                // R&W chips below, which are skills, not domains) — so it's
                // safe to give each its own domain color here, matching
                // Mistake Log / Progress instead of one flat "math" color.
                const color = on ? domainColor(MATH_CHIP_TO_DOMAIN[s]) : null;
                return (
                  <div
                    key={s}
                    className={`chip math${on ? ' on' : ''}`}
                    style={color ? { borderColor: color.border, color: color.text, background: color.bg } : undefined}
                    onClick={() => toggleChip('math', s)}
                  >
                    {MATH_CHIP_LABELS[s]}
                  </div>
                );
              })}
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
            <div className="chips">
              {RW_SECTIONS.map((s) => (
                <div key={s} className={`chip rw${rwChips.has(s) ? ' on' : ''}`} onClick={() => toggleChip('rw', s)}>
                  {s}
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
            Only {boundariesPool ?? 0} R&amp;W &quot;Boundaries&quot; questions match your filters (you asked for{' '}
            {rwCount}).
          </p>
          <div className="wactions">
            <button className="wbtn" onClick={startWithFewer}>
              Start with {boundariesPool ?? 0}
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
