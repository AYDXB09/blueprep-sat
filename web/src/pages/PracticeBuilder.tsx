import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './PracticeBuilder.css';
import { useAuth } from '../lib/AuthContext';
import { createPracticeSession, type SubjectFilter } from '../lib/practiceSessions';

// ---------------------------------------------------------------------------
// Ported faithfully from mockups/ad-hoc-builder.html. UI-only — pool sizes
// and start-session action are demo/mock (TODO: wire pool-scarcity check and
// session creation to Supabase `questions`/`practice_sessions` once connected).
// ---------------------------------------------------------------------------

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

const AVAILABLE_BOUNDARIES_POOL = 11; // demo: simulated real pool size for this filter combo

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

  const startWithFewer = useCallback(() => {
    setRwCount(AVAILABLE_BOUNDARIES_POOL);
    setActivePreset(null);
    toast('Count adjusted to match the available pool.');
  }, [toast]);

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
    boundariesOn && (currentSubj === 'rw' || currentSubj === 'both') && rwCount > AVAILABLE_BOUNDARIES_POOL;

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

      const session = await createPracticeSession({
        userId: user.id,
        mode: 'ad_hoc',
        // TODO: the `questions` table hasn't been imported from
        // data/questions.json yet (0 rows live) — real question selection
        // against subject/domain/difficulty filters plugs in here once it is.
        questionIds: [],
        requestedCount: totalCount,
        timerMode: qTimerDisplay ? 'per_question' : 'session_only',
        timerBasis: timerBasis === 'official' ? 'official_pace' : timerBasis === 'custom' ? 'custom' : 'none',
        feedbackMode: feedback ? 'immediate' : 'end_of_session',
        includeRetired,
        includeNewOnly: newOnly,
        subjectFilter,
        sizePreset: activePreset,
        allottedSeconds: timerBasis === 'custom' ? customMinutes * 60 : null,
      });
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
    <div className="builder-root">
      <div className="page">
        <div className="brand">
          <b>Blue</b>Prep
        </div>
        <h1>Build a practice set</h1>
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
              Both
            </div>
          </div>
        </div>

        {currentSubj !== 'rw' && (
          <div className="subject-block math">
            <h3>Math</h3>
            <div className="chips">
              {MATH_SECTIONS.map((s) => (
                <div
                  key={s}
                  className={`chip math${mathChips.has(s) ? ' on' : ''}`}
                  onClick={() => toggleChip('math', s)}
                >
                  {MATH_CHIP_LABELS[s]}
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
            Only {AVAILABLE_BOUNDARIES_POOL} R&amp;W &quot;Boundaries&quot; questions match your filters (you asked for{' '}
            {rwCount}).
          </p>
          <div className="wactions">
            <button className="wbtn" onClick={startWithFewer}>
              Start with {AVAILABLE_BOUNDARIES_POOL}
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
            <span className="tlabel">New questions only</span>
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
  );
}
