import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Player.css';
import { useAuth } from '../lib/AuthContext';
import {
  completeSession,
  getQuestionWithChoices,
  getSessionWithAttempts,
  isSprAnswerCorrect,
  startQuestionAttempt,
  submitQuestionAttempt,
  type AttemptWithQuestion,
  type QuestionWithChoices,
} from '../lib/practiceSessions';
import type { Database } from '../lib/database.types';

// ---------------------------------------------------------------------------
// Ported from mockups/player.html, then wired to real Supabase-backed
// session/question/attempt data. The interactive shell below (timers, pause,
// highlighter, strikethrough, mark-for-review, nav popover, module gate,
// break screen, time's-up modal) is unchanged from the mockup port — only the
// DATA layer (question content, choices, answered/flag state, attempt
// writes, prev/next navigation) is real.
// ---------------------------------------------------------------------------

type PracticeSessionRow = Database['public']['Tables']['practice_sessions']['Row'];

type MainView = 'main' | 'gate' | 'break';

function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function Player() {
  const { sessionId, n: nParam } = useParams<{ sessionId: string; n: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const n = Number(nParam);

  // ---------------- session / question data ----------------
  const [session, setSession] = useState<PracticeSessionRow | null>(null);
  const [attempts, setAttempts] = useState<AttemptWithQuestion[]>([]);
  const [question, setQuestion] = useState<QuestionWithChoices | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const TOTAL_Q = session?.question_ids.length ?? 0;
  const CURRENT_Q = n;
  const questionId = session && Number.isFinite(n) ? session.question_ids[n - 1] : undefined;

  // Load the session once (or whenever sessionId changes).
  useEffect(() => {
    if (!sessionId) {
      setErrorMsg('No session specified.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    getSessionWithAttempts(sessionId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setErrorMsg("This session couldn't be found, or you don't have access to it.");
          setSession(null);
          return;
        }
        setSession(result.session);
        setAttempts(result.attempts);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load this session.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Load the current question whenever the session or position changes.
  useEffect(() => {
    if (!session) return;
    if (!Number.isFinite(n) || n < 1 || n > session.question_ids.length) {
      setErrorMsg('No more questions in this session.');
      setQuestion(null);
      return;
    }
    const qid = session.question_ids[n - 1];
    let cancelled = false;
    setQuestion(null);
    getQuestionWithChoices(qid)
      .then((q) => {
        if (cancelled) return;
        if (!q) {
          setErrorMsg('This question could not be loaded.');
          return;
        }
        setQuestion(q);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load this question.');
      });
    return () => {
      cancelled = true;
    };
  }, [session, n]);

  const refetchAttempts = useCallback(async () => {
    if (!sessionId) return;
    const result = await getSessionWithAttempts(sessionId);
    if (result) setAttempts(result.attempts);
  }, [sessionId]);

  // ---------------- current attempt tracking ----------------
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const attemptStartInFlightRef = useRef(false);

  const ensureAttemptStarted = useCallback(() => {
    if (currentAttemptId || attemptStartInFlightRef.current || !user || !sessionId || !questionId) return;
    attemptStartInFlightRef.current = true;
    startQuestionAttempt({ userId: user.id, sessionId, questionId, attemptNumber: 1 })
      .then((row) => setCurrentAttemptId(row.id))
      .catch((err: unknown) => console.warn('startQuestionAttempt failed:', err))
      .finally(() => {
        attemptStartInFlightRef.current = false;
      });
  }, [currentAttemptId, user, sessionId, questionId]);

  // Reset per-question answer/attempt state whenever the question changes.
  useEffect(() => {
    setCurrentAttemptId(null);
    setSelectedChoiceId(null);
    setEnteredValue('');
    setStruck(new Set());
    setMarkedForReview(false);
    setQSeconds(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

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
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [enteredValue, setEnteredValue] = useState('');
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const [strikeMode, setStrikeMode] = useState(false);
  const [markedForReview, setMarkedForReview] = useState(false);
  // Flagged-for-review state isn't persisted in the schema (no column for it)
  // — kept as in-memory state per session, keyed by question position.
  const [flaggedPositions, setFlaggedPositions] = useState<Set<number>>(new Set());

  useEffect(() => {
    setFlaggedPositions((prev) => {
      const next = new Set(prev);
      if (markedForReview) next.add(CURRENT_Q);
      else next.delete(CURRENT_Q);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markedForReview]);

  const toggleStruck = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!strikeMode) return;
      e.stopPropagation();
      setStruck((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [strikeMode],
  );

  const selectChoice = useCallback(
    (id: string) => {
      setSelectedChoiceId(id);
      ensureAttemptStarted();
    },
    [ensureAttemptStarted],
  );

  const onEnteredValueChange = useCallback(
    (value: string) => {
      setEnteredValue(value);
      ensureAttemptStarted();
    },
    [ensureAttemptStarted],
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

  // ---------------- answer commit + prev/next navigation ----------------
  const [navBusy, setNavBusy] = useState(false);

  const isMcqCorrect = useCallback(
    (choiceId: string | null): boolean => {
      if (!choiceId || !question) return false;
      const choice = question.choices.find((c) => c.id === choiceId);
      return choice?.is_correct ?? false;
    },
    [question],
  );

  /** Writes the current answer to the in-flight attempt, if one was started. */
  const commitCurrentAnswer = useCallback(async () => {
    if (!currentAttemptId || !question) return;
    const isSpr = question.response_type === 'spr';
    const isCorrect = isSpr ? isSprAnswerCorrect(enteredValue, question.accepted_answers) : isMcqCorrect(selectedChoiceId);
    try {
      await submitQuestionAttempt(currentAttemptId, {
        selectedChoiceId: isSpr ? null : selectedChoiceId,
        enteredValue: isSpr ? enteredValue : null,
        isCorrect,
        timeTakenSeconds: qSeconds,
      });
    } catch (err) {
      console.warn('submitQuestionAttempt failed:', err);
    }
  }, [currentAttemptId, question, enteredValue, selectedChoiceId, isMcqCorrect, qSeconds]);

  const finishSession = useCallback(async () => {
    if (!sessionId) return;
    const result = await getSessionWithAttempts(sessionId);
    const finalAttempts = result?.attempts ?? [];
    const submitted = finalAttempts.filter((a) => a.submitted_at);
    const correctCount = submitted.filter((a) => a.is_correct === true).length;
    await completeSession(sessionId, {
      actualCount: submitted.length,
      overtimeSeconds,
      scoreSummary: {
        total: TOTAL_Q,
        answered: submitted.length,
        correct: correctCount,
      },
    });
    navigate(`/sessions/${sessionId}`);
  }, [sessionId, overtimeSeconds, TOTAL_Q, navigate]);

  const goPrev = useCallback(async () => {
    if (!sessionId || navBusy || CURRENT_Q <= 1) return;
    setNavBusy(true);
    try {
      await commitCurrentAnswer();
      await refetchAttempts();
      navigate(`/practice/${sessionId}/q/${CURRENT_Q - 1}`);
    } finally {
      setNavBusy(false);
    }
  }, [sessionId, navBusy, CURRENT_Q, commitCurrentAnswer, refetchAttempts, navigate]);

  const goNext = useCallback(async () => {
    if (!sessionId || navBusy) return;
    setNavBusy(true);
    try {
      await commitCurrentAnswer();
      if (CURRENT_Q >= TOTAL_Q) {
        await finishSession();
      } else {
        await refetchAttempts();
        navigate(`/practice/${sessionId}/q/${CURRENT_Q + 1}`);
      }
    } finally {
      setNavBusy(false);
    }
  }, [sessionId, navBusy, CURRENT_Q, TOTAL_Q, commitCurrentAnswer, finishSession, refetchAttempts, navigate]);

  // ---------------- exit control ----------------
  const exitToDashboard = useCallback(() => {
    if (window.confirm('Leave this session? Your progress is saved and you can resume later.')) {
      navigate('/');
    }
  }, [navigate]);

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
  const progressPct = TOTAL_Q > 0 ? Math.round((CURRENT_Q / TOTAL_Q) * 100) : 0;

  const answeredPositions = useMemo(() => {
    if (!session) return new Set<number>();
    const positions = new Set<number>();
    for (const a of attempts) {
      if (!a.submitted_at) continue;
      const idx = session.question_ids.indexOf(a.question_id);
      if (idx >= 0) positions.add(idx + 1);
    }
    return positions;
  }, [attempts, session]);

  const isMath = question?.subject === 'Math';
  const subjectLabel = question ? (isMath ? 'Math' : 'R&W') : '';

  // ---------------- loading / error states ----------------
  if (loading) {
    return (
      <div className="player-root player-status">
        <p>Loading session…</p>
      </div>
    );
  }
  if (errorMsg || !session) {
    return (
      <div className="player-root player-status">
        <p>{errorMsg ?? 'This session could not be loaded.'}</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }
  if (!question) {
    return (
      <div className="player-root player-status">
        <p>Loading question…</p>
      </div>
    );
  }

  return (
    <div className="player-root">
      <div className="topbar">
        <button className="iconbtn" title="Exit to Dashboard" aria-label="Exit to Dashboard" onClick={exitToDashboard}>
          ←
        </button>
        <div className="brand">
          <b>Blue</b>Prep
        </div>
        <span className={`subj-badge${isMath ? '' : ' rw'}`}>{subjectLabel}</span>
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
            Q{CURRENT_Q} of {TOTAL_Q} ▾
          </button>
          <div className={`nav-popover${navOpen ? ' open' : ''}`} ref={navRef}>
            <p className="nhead">Jump to question</p>
            <div className="nav-grid">
              {Array.from({ length: TOTAL_Q }, (_, i) => i + 1).map((pos) => {
                const isAnswered = answeredPositions.has(pos);
                const isFlagged = flaggedPositions.has(pos);
                const isCurrent = pos === CURRENT_Q;
                return (
                  <div
                    key={pos}
                    className={`nav-cell${isAnswered ? ' answered' : ''}${isCurrent ? ' current' : ''}${
                      isFlagged ? ' flagged' : ''
                    }`}
                    title={`Question ${pos}${isAnswered ? ' — answered' : ' — unanswered'}${
                      isFlagged ? ', flagged' : ''
                    }`}
                    onClick={() => {
                      setNavOpen(false);
                      if (sessionId) navigate(`/practice/${sessionId}/q/${pos}`);
                    }}
                  >
                    {pos}
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
          {isMath && (
            <button className="iconbtn wide" title="Reference sheet" aria-label="Open reference sheet" onClick={() => setRefOpen(true)}>
              📐 Reference
            </button>
          )}
          {isMath && (
            <button className="iconbtn wide" title="Desmos" aria-label="Open Desmos" onClick={() => setCalcOpen((o) => !o)}>
              Desmos
            </button>
          )}
          <button className="iconbtn" title="Ask AI" aria-label="Ask AI about this question" onClick={() => toast('Would open the live Ask AI chat for this question.')}>
            ✨
          </button>
          <button className="iconbtn" title="Pause" aria-label="Pause session" onClick={pause}>
            ⏸
          </button>
        </div>
      </div>

      {isMath && (
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
      )}

      {isMath && (
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
      )}

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
                {!question.is_active && (
                  <span
                    className="retired-chip"
                    title="No longer in the source's live rotation — the skill it tests is still current, but you won't see this exact question on a real exam."
                  >
                    Retired ⓘ
                  </span>
                )}
              </div>
              <div className="stimulus serif" ref={stimulusRef} onMouseUp={onStimulusMouseUp}>
                {question.stimulus_markup && (
                  // Trusted first-party content from our own `questions` table, not user input.
                  <div dangerouslySetInnerHTML={{ __html: question.stimulus_markup }} />
                )}
                {/* eslint-disable-next-line react/no-danger */}
                <div dangerouslySetInnerHTML={{ __html: question.stem_markup }} />
              </div>
            </div>

            <div className="pane right">
              {question.response_type === 'spr' ? (
                <div className="spr-input-wrap">
                  <label htmlFor="sprInput" className="spr-label">
                    Enter your answer
                  </label>
                  <input
                    id="sprInput"
                    className="spr-input mono"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 3/4 or 0.75"
                    value={enteredValue}
                    onChange={(e) => onEnteredValueChange(e.target.value)}
                  />
                  <p className="spr-hint">Fractions (3/4) and decimals (0.75) are both accepted.</p>
                </div>
              ) : (
                <div className="choices">
                  {question.choices.map((c) => (
                    <div
                      key={c.id}
                      className={`choice${selectedChoiceId === c.id ? ' selected' : ''}${struck.has(c.id) ? ' struck' : ''}`}
                      onClick={() => selectChoice(c.id)}
                    >
                      <span className="letter" onClick={(e) => toggleStruck(c.id, e)}>
                        {c.label}
                      </span>
                      {/* Trusted first-party content from our own `choices` table, not user input. */}
                      <span className="ctext" dangerouslySetInnerHTML={{ __html: c.content_markup }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bottombar" id="mainBottombar">
            <button className="btn ghost" onClick={goPrev} disabled={navBusy || CURRENT_Q <= 1}>
              ← Prev
            </button>
            <button className={`btn ghost${markedForReview ? ' active' : ''}`} onClick={() => setMarkedForReview((m) => !m)}>
              🔖 Mark for Review
            </button>
            <button className={`btn ghost${strikeMode ? ' active' : ''}`} onClick={() => setStrikeMode((s) => !s)}>
              ✎ Strikethrough tool
            </button>
            <button className="btn primary" onClick={goNext} disabled={navBusy}>
              {CURRENT_Q >= TOTAL_Q ? 'Finish →' : 'Next →'}
            </button>
          </div>
        </>
      )}

      {view === 'gate' && (
        <div className="gate-view open">
          <h2>Review before you submit this module</h2>
          <p className="gsub">You can still go back and change any answer. Once you submit, this module is final.</p>
          <div className="gate-summary">
            <div className="gstat">
              <p className="gnum">{answeredPositions.size}</p>
              <p className="glabel">Answered</p>
            </div>
            <div className="gstat">
              <p className="gnum warn">{TOTAL_Q - answeredPositions.size}</p>
              <p className="glabel">Unanswered</p>
            </div>
            <div className="gstat">
              <p className="gnum">{flaggedPositions.size}</p>
              <p className="glabel">Flagged</p>
            </div>
          </div>
          <div className="gate-grid">
            {Array.from({ length: TOTAL_Q }, (_, i) => i + 1).map((pos) => (
              <div
                key={pos}
                className={`nav-cell${answeredPositions.has(pos) ? ' answered' : ''}${
                  flaggedPositions.has(pos) ? ' flagged' : ''
                }`}
              >
                {pos}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn ghost" onClick={gateBack}>
              ← Back to test
            </button>
            <button className="btn primary" style={{ margin: 0 }} onClick={gateSubmit}>
              Submit module
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

      {import.meta.env.DEV && (
        <div className="demo-controls">
          <span>demo:</span>
          <button onClick={skipToTimesUp}>skip to time&apos;s up</button>
          <button onClick={finishModule}>finish module (review gate)</button>
          <button onClick={showBreak}>show break screen</button>
        </div>
      )}
    </div>
  );
}
