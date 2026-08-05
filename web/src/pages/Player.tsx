import { useCallback, useEffect, useRef, useState } from 'react';
import './Player.css';

// ---------------------------------------------------------------------------
// Ported faithfully from mockups/player.html. UI-only — demo/mock state below
// stands in for real Supabase-backed session/question data (TODO: wire to
// practice_sessions / session_modules / question_attempts once the player is
// connected to the backend).
// ---------------------------------------------------------------------------

const TOTAL_Q = 22;
const CURRENT_Q = 6;
const ANSWERED: number[] = [1, 2, 3, 4, 5, 6, 8, 9];
const FLAGGED: number[] = [9, 14];

const GATE_ANSWERED: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21];
const GATE_FLAGGED: number[] = [9, 14];
const GATE_TOTAL = 22;

type ChoiceLetter = 'A' | 'B' | 'C' | 'D';

interface Choice {
  letter: ChoiceLetter;
  text: string;
}

const CHOICES: Choice[] = [
  { letter: 'A', text: '6' },
  { letter: 'B', text: '8' },
  { letter: 'C', text: '9' },
  { letter: 'D', text: '12' },
];

type MainView = 'main' | 'gate' | 'break';

function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function Player() {
  // ---------------- timers ----------------
  const [sessionSeconds, setSessionSeconds] = useState(12 * 60 + 4);
  const [overtimeSeconds, setOvertimeSeconds] = useState(0);
  const [qSeconds, setQSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isOvertime, setIsOvertime] = useState(false);
  const [timeUpModalOpen, setTimeUpModalOpen] = useState(false);
  const timesUpShownRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (paused) return;
      setQSeconds((q) => q + 1);

      if (!isOvertimeRef.current) {
        setSessionSeconds((s) => {
          const next = s - 1;
          if (next <= 0 && !timesUpShownRef.current) {
            timesUpShownRef.current = true;
            setTimeUpModalOpen(true);
          }
          return next;
        });
      } else {
        setOvertimeSeconds((o) => o + 1);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // isOvertime needs a ref so the interval closure (captured once per `paused`
  // change) always sees the latest value without re-creating the interval.
  const isOvertimeRef = useRef(isOvertime);
  useEffect(() => {
    isOvertimeRef.current = isOvertime;
  }, [isOvertime]);

  // ---------------- toast ----------------
  const [toastMsg, setToastMsg] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastShow(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastShow(false), 2200);
  }, []);

  // ---------------- nav popover ----------------
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement | null>(null);
  const jumpBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (navRef.current && !navRef.current.contains(target) && target !== jumpBtnRef.current) {
        setNavOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // ---------------- calculator / reference sheet ----------------
  const [calcOpen, setCalcOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  // ---------------- choices / strikethrough / mark for review ----------------
  const [selected, setSelected] = useState<ChoiceLetter>('B');
  const [struck, setStruck] = useState<Set<ChoiceLetter>>(new Set());
  const [strikeMode, setStrikeMode] = useState(false);
  const [markedForReview, setMarkedForReview] = useState(false);

  const toggleStruck = useCallback(
    (letter: ChoiceLetter, e: React.MouseEvent) => {
      if (!strikeMode) return;
      e.stopPropagation();
      setStruck((prev) => {
        const next = new Set(prev);
        if (next.has(letter)) next.delete(letter);
        else next.add(letter);
        return next;
      });
    },
    [strikeMode],
  );

  // ---------------- view state: main / gate / break ----------------
  const [view, setView] = useState<MainView>('main');
  const [breakSeconds, setBreakSeconds] = useState(10 * 60);
  const breakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startBreakCountdown = useCallback(() => {
    setBreakSeconds(10 * 60);
    if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    breakTimerRef.current = setInterval(() => {
      setBreakSeconds((s) => {
        const next = s - 1;
        if (next <= 0 && breakTimerRef.current) {
          clearInterval(breakTimerRef.current);
        }
        return Math.max(next, 0);
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    };
  }, []);

  const finishModule = useCallback(() => setView('gate'), []);
  const gateBack = useCallback(() => setView('main'), []);
  const gateSubmit = useCallback(() => {
    setView('break');
    startBreakCountdown();
  }, [startBreakCountdown]);
  const continueFromBreak = useCallback(() => {
    if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    setView('main');
    toast('Would begin Math Module 1.');
  }, [toast]);
  const showBreak = useCallback(() => {
    setView('break');
    startBreakCountdown();
  }, [startBreakCountdown]);

  // ---------------- pause ----------------
  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);

  // ---------------- time's up modal ----------------
  const submitNow = useCallback(() => {
    setTimeUpModalOpen(false);
    setPaused(true);
    toast('Session submitted — would go to Session Summary.');
  }, [toast]);
  const keepGoing = useCallback(() => {
    setTimeUpModalOpen(false);
    setIsOvertime(true);
    setOvertimeSeconds(0);
  }, []);
  const skipToTimesUp = useCallback(() => setSessionSeconds(3), []);

  // ---------------- prev/next ----------------
  const goPrev = useCallback(() => toast('Would navigate to Question 5.'), [toast]);
  const goNext = useCallback(() => toast('Would navigate to Question 7.'), [toast]);

  // ---------------- highlighter (real Selection/Range API, kept imperative
  // via refs — this mirrors the mockup's actual DOM-surgery behavior, which
  // is the one part of this port that's legitimately not idiomatic React
  // state, matching the existing app's own highlighter mechanism). ----------
  const stimulusRef = useRef<HTMLDivElement | null>(null);
  const hlPopoverRef = useRef<HTMLDivElement | null>(null);
  const activeRangeRef = useRef<Range | null>(null);
  const [hlPopoverOpen, setHlPopoverOpen] = useState(false);
  const [hlPopoverPos, setHlPopoverPos] = useState({ top: 0, left: 0 });
  const [hlIsRemove, setHlIsRemove] = useState(false);

  const onStimulusMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
      setHlPopoverOpen(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const stimulus = stimulusRef.current;
    if (!stimulus || !stimulus.contains(range.commonAncestorContainer)) return;
    activeRangeRef.current = range;

    const rect = range.getBoundingClientRect();
    setHlPopoverPos({
      top: window.scrollY + rect.top - 42,
      left: window.scrollX + rect.left + rect.width / 2 - 40,
    });

    const parentEl = range.commonAncestorContainer.parentElement;
    const parentMark = parentEl ? parentEl.closest('mark.hl') : null;
    setHlIsRemove(!!parentMark);
    setHlPopoverOpen(true);
  }, []);

  const addHighlight = useCallback(() => {
    const range = activeRangeRef.current;
    if (!range) return;
    const mark = document.createElement('mark');
    mark.className = 'hl';
    try {
      range.surroundContents(mark);
    } catch {
      // selection spans multiple elements — acceptable, matches mockup behavior
    }
    setHlPopoverOpen(false);
    window.getSelection()?.removeAllRanges();
  }, []);

  const removeHighlight = useCallback(() => {
    const range = activeRangeRef.current;
    const el = range && range.commonAncestorContainer.parentElement;
    const mark = el ? el.closest('mark.hl') : null;
    if (mark && mark.parentNode) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
    setHlPopoverOpen(false);
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (hlPopoverRef.current && !hlPopoverRef.current.contains(e.target as Node)) {
        setHlPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // ---------------- derived ----------------
  const sessionLow = !isOvertime && sessionSeconds <= 60 && sessionSeconds > 0;
  const sessionDisplay = isOvertime ? `+${fmt(overtimeSeconds)}` : fmt(Math.max(sessionSeconds, 0));
  const progressPct = Math.round((CURRENT_Q / TOTAL_Q) * 100);

  return (
    <div className="player-root">
      <div className="topbar">
        <div className="brand">
          <b>Blue</b>Prep
        </div>
        <span className="subj-badge">Math</span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div style={{ position: 'relative' }}>
          <button
            ref={jumpBtnRef}
            className="progress-label mono"
            id="jumpBtn"
            onClick={(e) => {
              e.stopPropagation();
              setNavOpen((o) => !o);
            }}
          >
            Q{CURRENT_Q} of {TOTAL_Q} · Module 1 ▾
          </button>
          <div className={`nav-popover${navOpen ? ' open' : ''}`} ref={navRef}>
            <p className="nhead">Jump to question</p>
            <div className="nav-grid">
              {Array.from({ length: TOTAL_Q }, (_, i) => i + 1).map((n) => {
                const isAnswered = ANSWERED.includes(n);
                const isFlagged = FLAGGED.includes(n);
                const isCurrent = n === CURRENT_Q;
                return (
                  <div
                    key={n}
                    className={`nav-cell${isAnswered ? ' answered' : ''}${isCurrent ? ' current' : ''}${
                      isFlagged ? ' flagged' : ''
                    }`}
                    title={`Question ${n}${isAnswered ? ' — answered' : ' — unanswered'}${
                      isFlagged ? ', flagged' : ''
                    }`}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
            <div className="nav-legend">
              <span>
                <span className="sw a" />
                Answered
              </span>
              <span>
                <span className="sw" />
                Unanswered
              </span>
              <span>🔖 Flagged</span>
            </div>
          </div>
        </div>

        <div className="timers">
          <div className="timer-block">
            <p className="tlabel" style={isOvertime ? { color: 'var(--red)' } : undefined}>
              {isOvertime ? 'Overtime — session' : 'Time left, session'}
            </p>
            <p className={`tval mono${sessionLow ? ' low' : ''}${isOvertime ? ' over' : ''}`}>{sessionDisplay}</p>
          </div>
          <div className="timer-block">
            <p className="tlabel">Time on this question</p>
            <p className="tval mono" id="qTime">
              {fmt(qSeconds)}
            </p>
          </div>
          <button className="iconbtn wide" title="Reference sheet" aria-label="Open reference sheet" onClick={() => setRefOpen(true)}>
            📐 Reference
          </button>
          <button className="iconbtn wide" title="Desmos" aria-label="Open Desmos" onClick={() => setCalcOpen((o) => !o)}>
            Desmos
          </button>
          <button className="iconbtn" title="Ask AI" aria-label="Ask AI about this question" onClick={() => toast('Would open the live Ask AI chat for this question.')}>
            ✨
          </button>
          <button className="iconbtn" title="Pause" aria-label="Pause session" onClick={pause}>
            ⏸
          </button>
        </div>
      </div>

      <div className={`calc-panel${calcOpen ? ' open' : ''}`}>
        <div className="calc-head">
          <span>Desmos</span>
          <span className="x" onClick={() => setCalcOpen(false)}>
            ✕
          </span>
        </div>
        <div className="calc-body">
          <div className="cicon">📐</div>
          <p>
            An embedded Desmos calculator renders here in the real app — this preview&apos;s sandbox blocks loading a
            third-party embed directly, so it opens in a new tab instead.
          </p>
          <a className="btn primary" href="https://www.desmos.com/calculator" target="_blank" rel="noopener noreferrer">
            Open Desmos ↗
          </a>
        </div>
      </div>

      <div className={`modal-backdrop${refOpen ? ' open' : ''}`}>
        <div className="modal-card ref-card">
          <div className="calc-head">
            <span>Reference Sheet</span>
            <span className="x" onClick={() => setRefOpen(false)}>
              ✕
            </span>
          </div>
          <div className="ref-body">
            <div className="ref-grid">
              <div className="ref-item">
                <p className="rlabel">Circle</p>
                <p className="rformula">A = πr² &nbsp; C = 2πr</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Rectangle</p>
                <p className="rformula">A = lw</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Triangle</p>
                <p className="rformula">A = ½bh</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Right triangle</p>
                <p className="rformula">a² + b² = c²</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Rectangular solid</p>
                <p className="rformula">V = lwh</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Cylinder</p>
                <p className="rformula">V = πr²h</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Sphere</p>
                <p className="rformula">V = (4/3)πr³</p>
              </div>
              <div className="ref-item">
                <p className="rlabel">Cone</p>
                <p className="rformula">V = (1/3)πr²h</p>
              </div>
            </div>
            <p className="ref-note">Sum of angles in a triangle = 180°. A circle has 360°, or 2π radians.</p>
          </div>
        </div>
      </div>

      <div
        className={`hl-popover${hlPopoverOpen ? ' open' : ''}`}
        ref={hlPopoverRef}
        style={{ top: hlPopoverPos.top, left: hlPopoverPos.left }}
      >
        <button style={{ display: hlIsRemove ? 'none' : 'inline-block' }} onClick={addHighlight}>
          Highlight
        </button>
        <button style={{ display: hlIsRemove ? 'inline-block' : 'none' }} onClick={removeHighlight}>
          Remove highlight
        </button>
      </div>

      {view === 'main' && (
        <>
          <div className="content" id="mainContent">
            <div className="pane left">
              <div className="qmeta">
                <span className="qnum mono">Question {CURRENT_Q}</span>
                <span
                  className="retired-chip"
                  title="No longer in the source's live rotation — the skill it tests is still current, but you won't see this exact question on a real exam."
                >
                  Retired ⓘ
                </span>
              </div>
              <div className="stimulus serif" ref={stimulusRef} onMouseUp={onStimulusMouseUp}>
                <p>
                  A rectangular garden has a length that is 3 feet more than twice its width. If the perimeter of the
                  garden is 54 feet, what is the width, in feet, of the garden?
                </p>
                <p style={{ color: 'var(--ink-dim)', fontSize: '14px' }}>
                  Let <i>w</i> represent the width, in feet, of the garden. Select any text in this passage to try the
                  highlighter.
                </p>
              </div>
            </div>

            <div className="pane right">
              <div className="choices">
                {CHOICES.map((c) => (
                  <div
                    key={c.letter}
                    className={`choice${selected === c.letter ? ' selected' : ''}${struck.has(c.letter) ? ' struck' : ''}`}
                    onClick={() => setSelected(c.letter)}
                  >
                    <span className="letter" onClick={(e) => toggleStruck(c.letter, e)}>
                      {c.letter}
                    </span>
                    <span className="ctext">{c.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bottombar" id="mainBottombar">
            <button className="btn ghost" onClick={goPrev}>
              ← Prev
            </button>
            <button className={`btn ghost${markedForReview ? ' active' : ''}`} onClick={() => setMarkedForReview((m) => !m)}>
              🔖 Mark for Review
            </button>
            <button className={`btn ghost${strikeMode ? ' active' : ''}`} onClick={() => setStrikeMode((s) => !s)}>
              ✎ Strikethrough tool
            </button>
            <button className="btn primary" onClick={goNext}>
              Next →
            </button>
          </div>
        </>
      )}

      {view === 'gate' && (
        <div className="gate-view open">
          <h2>Review before you submit Module 1</h2>
          <p className="gsub">You can still go back and change any answer. Once you submit, Module 1 is final.</p>
          <div className="gate-summary">
            <div className="gstat">
              <p className="gnum">{GATE_ANSWERED.length}</p>
              <p className="glabel">Answered</p>
            </div>
            <div className="gstat">
              <p className="gnum warn">{GATE_TOTAL - GATE_ANSWERED.length}</p>
              <p className="glabel">Unanswered</p>
            </div>
            <div className="gstat">
              <p className="gnum">{GATE_FLAGGED.length}</p>
              <p className="glabel">Flagged</p>
            </div>
          </div>
          <div className="gate-grid">
            {Array.from({ length: GATE_TOTAL }, (_, i) => i + 1).map((n) => (
              <div
                key={n}
                className={`nav-cell${GATE_ANSWERED.includes(n) ? ' answered' : ''}${
                  GATE_FLAGGED.includes(n) ? ' flagged' : ''
                }`}
              >
                {n}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn ghost" onClick={gateBack}>
              ← Back to test
            </button>
            <button className="btn primary" style={{ margin: 0 }} onClick={gateSubmit}>
              Submit Module 1
            </button>
          </div>
        </div>
      )}

      {view === 'break' && (
        <div className="break-view open">
          <div className="bicon">☕</div>
          <h2>Break</h2>
          <p>Reading &amp; Writing is complete. Math starts after this break.</p>
          <p className="btime mono">{fmt(Math.max(breakSeconds, 0))}</p>
          <button className="btn primary" onClick={continueFromBreak}>
            Continue now →
          </button>
          <p className="break-caveat">
            10-minute figure is from general knowledge of the real exam&apos;s break structure, not verified against an
            official source in this session — confirm before treating as fact.
          </p>
        </div>
      )}

      <div className={`pause-overlay${paused ? ' open' : ''}`}>
        <div className="pause-card">
          <div className="picon">⏸</div>
          <h2>Paused</h2>
          <p>Both timers are frozen. Nothing here counts against you while paused.</p>
          <button className="btn primary" style={{ margin: 0, width: '100%' }} onClick={resume}>
            Resume
          </button>
        </div>
      </div>

      <div className={`modal-backdrop${timeUpModalOpen ? ' open' : ''}`}>
        <div className="modal-card">
          <div className="micon">⏱</div>
          <h2>Time&apos;s up</h2>
          <p>Submit now, or keep going and let the clock run past your allotted time? Nothing auto-submits — it&apos;s your call.</p>
          <div className="modal-actions">
            <button className="btn primary" style={{ margin: 0 }} onClick={submitNow}>
              Submit now
            </button>
            <button className="btn ghost" onClick={keepGoing}>
              Keep going
            </button>
          </div>
        </div>
      </div>

      <div className={`toast${toastShow ? ' show' : ''}`}>{toastMsg}</div>

      <div className="demo-controls">
        <span>demo:</span>
        <button onClick={skipToTimesUp}>skip to time&apos;s up</button>
        <button onClick={finishModule}>finish module (review gate)</button>
        <button onClick={showBreak}>show break screen</button>
      </div>
    </div>
  );
}
