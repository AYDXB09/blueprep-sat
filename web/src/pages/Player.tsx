import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Player.css';
import { useAuth } from '../lib/AuthContext';
import {
  completeSession,
  getCuesForQuestion,
  getQuestionIdsWithCues,
  getQuestionWithChoices,
  getSessionWithAttempts,
  isSprAnswerCorrect,
  startQuestionAttempt,
  submitQuestionAttempt,
  type AttemptWithQuestion,
  type CueWithCategory,
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

// ---------------------------------------------------------------------------
// Cue highlighting — system-driven (trap/govern/assumption spans from the
// `cues` table), distinct from the student-driven manual highlighter above.
// Walks real DOM text nodes with a TreeWalker (never regexes the raw HTML
// string) so nested tags (<i>, <sup>, MathML) survive intact. Whitespace-only
// text nodes (pure formatting between tags, e.g. newlines inside <math>) are
// skipped entirely rather than treated as content, since `anchor_text` was
// captured against the question's meaningful rendered text, not raw markup
// whitespace.
// ---------------------------------------------------------------------------

function collectMeaningfulTextNodes(container: HTMLElement): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return /\S/.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  let n: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((n = walker.nextNode())) nodes.push(n as Text);
  return nodes;
}

/**
 * Finds the nth occurrence (cue.occurrence, 1-based) of cue.anchor_text as a
 * verbatim substring of the container's concatenated meaningful text, and
 * wraps the matched span in a <mark class="cue-mark cue-{type}"> carrying
 * data-cue-id, without disturbing surrounding markup. Returns false (and
 * console.warns) if the anchor can't be found or the wrap fails — callers
 * must treat that as "skip this cue's highlight," never a crash.
 */
function applyCueHighlight(container: HTMLElement, cue: CueWithCategory): boolean {
  const target = cue.anchor_text;
  if (!target) return false;

  const textNodes = collectMeaningfulTextNodes(container);
  if (textNodes.length === 0) return false;

  let concatenated = '';
  const offsets: Array<{ node: Text; start: number; end: number }> = [];
  for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    offsets.push({ node, start: concatenated.length, end: concatenated.length + text.length });
    concatenated += text;
  }

  const occurrence = Math.max(1, cue.occurrence || 1);
  let searchFrom = 0;
  let matchIndex = -1;
  for (let i = 0; i < occurrence; i++) {
    matchIndex = concatenated.indexOf(target, searchFrom);
    if (matchIndex === -1) break;
    searchFrom = matchIndex + 1;
  }
  if (matchIndex === -1) {
    console.warn(`[cues] anchor_text not found for cue ${cue.id} (question ${cue.question_id}): "${target}"`);
    return false;
  }

  const matchStart = matchIndex;
  const matchEnd = matchIndex + target.length;
  const startEntry = offsets.find((o) => matchStart >= o.start && matchStart < o.end);
  const endEntry = offsets.find((o) => matchEnd > o.start && matchEnd <= o.end);
  if (!startEntry || !endEntry) {
    console.warn(`[cues] could not map anchor_text offsets for cue ${cue.id}`);
    return false;
  }

  try {
    const range = document.createRange();
    range.setStart(startEntry.node, matchStart - startEntry.start);
    range.setEnd(endEntry.node, matchEnd - endEntry.start);

    const mark = document.createElement('mark');
    mark.className = `cue-mark cue-${cue.cue_type}`;
    mark.dataset.cueId = cue.id;
    mark.tabIndex = 0;
    range.surroundContents(mark);
    return true;
  } catch (err) {
    console.warn(`[cues] failed to wrap anchor for cue ${cue.id}:`, err);
    return false;
  }
}

/**
 * Returns `html` with every applicable cue's anchor wrapped in a
 * <mark class="cue-mark"> span, as a STRING — not a live-DOM mutation.
 *
 * This exists because React resets a dangerouslySetInnerHTML node's real
 * innerHTML back to its declared prop value on every re-render it processes
 * for that node (confirmed empirically — even a click on a wholly unrelated
 * button elsewhere in the page wipes marks injected by mutating the live
 * DOM after the fact). Any imperative "wrap the rendered text once" pass is
 * therefore inherently fragile: it survives only until the next re-render,
 * which can be triggered by literally anything in this component. Instead,
 * the marked-up markup is computed here (via a detached, unmounted
 * container element so the real DOM is never touched imperatively) and fed
 * back into React as the dangerouslySetInnerHTML value itself, memoized by
 * caller — so it's part of what React renders, not something bolted on
 * after, and it can never be wiped by an unrelated re-render again.
 */
function withCueMarks(html: string, cues: CueWithCategory[]): string {
  if (!html || cues.length === 0) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  for (const cue of cues) applyCueHighlight(container, cue);
  return container.innerHTML;
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

  // ---------------- trap/cue review ----------------
  const [cues, setCues] = useState<CueWithCategory[]>([]);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  // Which of this session's questions have cues at all — for the nav grid's
  // "has cue analysis" indicator, so it's visible before opening a question.
  const [cuedQuestionIds, setCuedQuestionIds] = useState<Set<string>>(new Set());

  const TOTAL_Q = session?.question_ids.length ?? 0;
  const CURRENT_Q = n;
  const questionId = session && Number.isFinite(n) ? session.question_ids[n - 1] : undefined;

  // A session with completed_at set was already finished — opening it again
  // (e.g. via Session Summary's "Review →" or Mistake Log) is read-only
  // review, not a live retake: no new attempts get written, the existing
  // answer is shown pre-filled with correct/incorrect feedback, and none of
  // the live-session chrome (countdown, pause, "leave session?" confirm)
  // applies.
  const isReviewMode = !!session?.completed_at;

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

  // Load the cues for the current question alongside it. Independent of the
  // question fetch so a cues failure never blocks rendering the question.
  useEffect(() => {
    // Clear immediately (synchronously, before the fetch resolves) rather
    // than leaving the previous question's cues in state — otherwise, if
    // canRevealFeedback is already true for the new question (e.g. review
    // mode with an existing submitted attempt), the DOM-highlight effect
    // below can fire with the OLD question's cues against the NEW
    // question's DOM: the anchors don't match, the pass fails silently, and
    // its "already processed this question" guard then permanently blocks
    // the real cues from ever being applied once they actually arrive.
    setCues([]);
    if (!questionId) return;
    let cancelled = false;
    getCuesForQuestion(questionId)
      .then((rows) => {
        if (!cancelled) setCues(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('getCuesForQuestion failed:', err);
          setCues([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  // Fetch once per session load — which of its questions have any cues,
  // for the nav grid's indicator.
  useEffect(() => {
    if (!session) {
      setCuedQuestionIds(new Set());
      return;
    }
    let cancelled = false;
    getQuestionIdsWithCues(session.question_ids)
      .then((ids) => {
        if (!cancelled) setCuedQuestionIds(ids);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('getQuestionIdsWithCues failed:', err);
          setCuedQuestionIds(new Set());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const refetchAttempts = useCallback(async () => {
    if (!sessionId) return;
    const result = await getSessionWithAttempts(sessionId);
    if (result) setAttempts(result.attempts);
  }, [sessionId]);

  // ---------------- current attempt tracking ----------------
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const attemptStartInFlightRef = useRef(false);

  const ensureAttemptStarted = useCallback(() => {
    if (isReviewMode || currentAttemptId || attemptStartInFlightRef.current || !user || !sessionId || !questionId) return;
    attemptStartInFlightRef.current = true;
    startQuestionAttempt({ userId: user.id, sessionId, questionId, attemptNumber: 1 })
      .then((row) => setCurrentAttemptId(row.id))
      .catch((err: unknown) => console.warn('startQuestionAttempt failed:', err))
      .finally(() => {
        attemptStartInFlightRef.current = false;
      });
  }, [isReviewMode, currentAttemptId, user, sessionId, questionId]);

  // Reset per-question answer/attempt state whenever the question changes.
  // In review mode, pre-fill from the existing (already-submitted) attempt
  // instead of starting blank — reviewing a finished session should show
  // what was actually answered, not prompt for a fresh answer.
  useEffect(() => {
    setCurrentAttemptId(null);
    if (isReviewMode) {
      const priorAttempt = attempts.find((a) => a.question_id === questionId && a.submitted_at);
      setSelectedChoiceId(priorAttempt?.selected_choice_id ?? null);
      setEnteredValue(priorAttempt?.entered_value ?? '');
    } else {
      setSelectedChoiceId(null);
      setEnteredValue('');
    }
    setStruck(new Set());
    setMarkedForReview(false);
    setQSeconds(0);
    setActiveCueId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, isReviewMode]);

  // ---------------- timers ----------------
  // A session created untimed (timer_basis='none', e.g. mistake retries —
  // see MistakeLog's retryOne/retryAll) or with timer_mode='none' has no
  // session countdown at all; timer_mode='none' also hides the per-question
  // clock, though qSeconds keeps counting internally either way since it
  // still feeds time_taken_seconds on submit.
  const hasSessionCountdown = !isReviewMode && !!session && session.timer_basis !== 'none' && session.timer_mode !== 'none';
  const showQuestionTimer = !isReviewMode && (!session || session.timer_mode !== 'none');

  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [overtimeSeconds, setOvertimeSeconds] = useState(0);
  const [qSeconds, setQSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isOvertime, setIsOvertime] = useState(false);
  const [timeUpModalOpen, setTimeUpModalOpen] = useState(false);
  const timesUpShownRef = useRef(false);

  // Seed the countdown from the session's real allotted_seconds once it
  // loads, instead of a fixed mockup placeholder.
  useEffect(() => {
    if (session) setSessionSeconds(session.allotted_seconds ?? 0);
  }, [session]);

  useEffect(() => {
    if (isReviewMode) return; // nothing to time when reviewing a finished session
    const id = setInterval(() => {
      if (paused) return;
      setQSeconds((q) => q + 1);

      if (!hasSessionCountdown) return;

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
  }, [paused, hasSessionCountdown, isReviewMode]);

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
        if (isReviewMode) {
          navigate(`/sessions/${sessionId}`);
        } else {
          await finishSession();
        }
      } else {
        await refetchAttempts();
        navigate(`/practice/${sessionId}/q/${CURRENT_Q + 1}`);
      }
    } finally {
      setNavBusy(false);
    }
  }, [sessionId, navBusy, CURRENT_Q, TOTAL_Q, isReviewMode, commitCurrentAnswer, finishSession, refetchAttempts, navigate]);

  // ---------------- exit control ----------------
  const exitToDashboard = useCallback(() => {
    // Nothing "in progress" to lose when reviewing an already-completed
    // session — the resumable-progress framing only makes sense mid-test.
    if (isReviewMode) {
      navigate('/');
      return;
    }
    if (window.confirm('Leave this session? Your progress is saved and you can resume later.')) {
      navigate('/');
    }
  }, [isReviewMode, navigate]);

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

  // ---------------- trap/cue reveal + DOM highlight pass ----------------
  // Cues are a spoiler until the student has committed an answer to THIS
  // question — either the session gives immediate feedback, or they're
  // revisiting a question they already have a submitted attempt for.
  const hasAnswered = question?.response_type === 'spr' ? enteredValue.trim() !== '' : !!selectedChoiceId;
  const hasSubmittedAttemptForQuestion = attempts.some((a) => a.question_id === questionId && !!a.submitted_at);
  const canRevealFeedback = hasAnswered && (session?.feedback_mode === 'immediate' || hasSubmittedAttemptForQuestion);
  const showCues = canRevealFeedback && cues.length > 0;
  // The real source (e.g. College Board) rationale — shown for every
  // question once answered, independent of whether it's one of the ones
  // with authored cues on top.
  const showRationale = canRevealFeedback && !!question?.source_rationale_markup;

  // Presentation-only transform: bold+upsize every "Choice A/B/C/D" mention in
  // the source's own rationale text so a skimming student can immediately see
  // which choice each sentence is talking about. Applied client-side (not
  // stored in the DB) since it's pure formatting of the source's real text.
  const rationaleHtml = useMemo(() => {
    const raw = question?.source_rationale_markup;
    if (!raw) return '';
    return raw.replace(/\bChoice [A-D]\b/g, (m) => `<strong class="choice-ref">${m}</strong>`);
  }, [question?.source_rationale_markup]);

  // Marked-up HTML, computed as plain strings (not a live-DOM mutation —
  // see withCueMarks' doc comment for why that approach doesn't survive
  // React re-renders). Recomputed only when the relevant cues/content
  // actually change, so this stays cheap on every unrelated re-render.
  const stimulusCues = useMemo(
    () => (showCues ? cues.filter((c) => c.anchor_scope === 'stimulus') : []),
    [showCues, cues],
  );
  const stemCues = useMemo(() => (showCues ? cues.filter((c) => c.anchor_scope === 'stem') : []), [showCues, cues]);
  const choiceCuesByChoiceId = useMemo(() => {
    const map = new Map<string, CueWithCategory[]>();
    if (!showCues) return map;
    for (const cue of cues) {
      if (cue.anchor_scope !== 'choice' || !cue.choice_id) continue;
      const arr = map.get(cue.choice_id) ?? [];
      arr.push(cue);
      map.set(cue.choice_id, arr);
    }
    return map;
  }, [showCues, cues]);

  const stimulusHtml = useMemo(
    () => (question?.stimulus_markup ? withCueMarks(question.stimulus_markup, stimulusCues) : ''),
    [question?.stimulus_markup, stimulusCues],
  );
  const stemHtml = useMemo(
    () => (question?.stem_markup ? withCueMarks(question.stem_markup, stemCues) : ''),
    [question?.stem_markup, stemCues],
  );
  const choiceHtmlById = useMemo(() => {
    const map = new Map<string, string>();
    if (!question) return map;
    for (const c of question.choices) {
      map.set(c.id, withCueMarks(c.content_markup, choiceCuesByChoiceId.get(c.id) ?? []));
    }
    return map;
  }, [question, choiceCuesByChoiceId]);

  const focusCue = useCallback((cueId: string) => {
    setActiveCueId(cueId);
    const mark = document.querySelector(`mark.cue-mark[data-cue-id="${cueId}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('cue-flash');
      setTimeout(() => mark.classList.remove('cue-flash'), 900);
    }
  }, []);

  // Click delegation for the imperatively-inserted <mark class="cue-mark">
  // spans — they aren't React elements, so they can't carry onClick props.
  // Routed through focusCue (not a bare setActiveCueId) so clicking the
  // highlighted word itself gives the same visible flash/scroll-into-view
  // confirmation as clicking its row in the panel below, instead of a
  // click that produces no visible feedback.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const markEl = target?.closest('mark.cue-mark') as HTMLElement | null;
      if (markEl?.dataset.cueId) focusCue(markEl.dataset.cueId);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [focusCue]);

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
                const hasCue = !!session && cuedQuestionIds.has(session.question_ids[pos - 1]);
                return (
                  <div
                    key={pos}
                    className={`nav-cell${isAnswered ? ' answered' : ''}${isCurrent ? ' current' : ''}${
                      isFlagged ? ' flagged' : ''
                    }${hasCue ? ' has-cue' : ''}`}
                    title={`Question ${pos}${isAnswered ? ' — answered' : ' — unanswered'}${
                      isFlagged ? ', flagged' : ''
                    }${hasCue ? ' — has trap/cue analysis' : ''}`}
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
              <span>💡 Has cue analysis</span>
            </div>
          </div>
        </div>

        <div className="timers">
          {isReviewMode ? (
            <div className="timer-block">
              <p className="tlabel">Status</p>
              <p className="tval mono">Reviewing</p>
            </div>
          ) : hasSessionCountdown ? (
            <div className="timer-block">
              <p className="tlabel" style={isOvertime ? { color: 'var(--red)' } : undefined}>
                {isOvertime ? 'Overtime — session' : 'Time left, session'}
              </p>
              <p className={`tval mono${sessionLow ? ' low' : ''}${isOvertime ? ' over' : ''}`}>{sessionDisplay}</p>
            </div>
          ) : (
            <div className="timer-block">
              <p className="tlabel">Session</p>
              <p className="tval mono">Untimed</p>
            </div>
          )}
          {showQuestionTimer && (
          <div className="timer-block">
            <p className="tlabel">Time on this question</p>
            <p className="tval mono" id="qTime">
              {fmt(qSeconds)}
            </p>
          </div>
          )}
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
          {!isReviewMode && (
          <button className="iconbtn" title="Ask AI" aria-label="Ask AI about this question" onClick={() => toast('Would open the live Ask AI chat for this question.')}>
            ✨
          </button>
          )}
          {!isReviewMode && (
          <button className="iconbtn" title="Pause" aria-label="Pause session" onClick={pause}>
            ⏸
          </button>
          )}
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
                {cues.length > 0 && (
                  <span className="cue-available-chip" title="This question has trap/cue analysis — answer it to reveal.">
                    💡 Has cue analysis
                  </span>
                )}
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
                  // Trusted first-party content from our own `questions` table, not user
                  // input — stimulusHtml is that same content with cue <mark> spans woven
                  // in as a string (see withCueMarks), so it survives every re-render.
                  <div dangerouslySetInnerHTML={{ __html: stimulusHtml }} />
                )}
                {/* eslint-disable-next-line react/no-danger */}
                <div dangerouslySetInnerHTML={{ __html: stemHtml }} />
              </div>
            </div>

            <div className="pane right">
              {question.response_type === 'spr' ? (
                <div className="spr-input-wrap">
                  <label htmlFor="sprInput" className="spr-label">
                    {isReviewMode ? 'Your answer' : 'Enter your answer'}
                  </label>
                  <input
                    id="sprInput"
                    className={`spr-input mono${isReviewMode ? (isSprAnswerCorrect(enteredValue, question.accepted_answers) ? ' correct' : ' incorrect') : ''}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 3/4 or 0.75"
                    value={enteredValue}
                    onChange={(e) => onEnteredValueChange(e.target.value)}
                    readOnly={isReviewMode}
                  />
                  {isReviewMode ? (
                    <p className="spr-hint">
                      Accepted: {(question.accepted_answers as string[] | null)?.join(', ') ?? '—'}
                    </p>
                  ) : (
                    <p className="spr-hint">Fractions (3/4) and decimals (0.75) are both accepted.</p>
                  )}
                </div>
              ) : (
                <div className="choices">
                  {question.choices.map((c) => {
                    const showFeedback = isReviewMode && !!selectedChoiceId;
                    const feedbackClass = showFeedback
                      ? c.is_correct
                        ? ' correct'
                        : selectedChoiceId === c.id
                          ? ' incorrect'
                          : ''
                      : '';
                    return (
                      <div
                        key={c.id}
                        className={`choice${selectedChoiceId === c.id ? ' selected' : ''}${struck.has(c.id) ? ' struck' : ''}${feedbackClass}`}
                        onClick={(e) => {
                          if (isReviewMode) return;
                          // A cue-marked word inside this choice's text has its own
                          // click behavior (focus/flash the cue) — don't also let
                          // that click bubble up and select the choice as the
                          // answer, which visually swallows the mark's underline
                          // under the "selected" style and looks like a bug.
                          if ((e.target as HTMLElement).closest('mark.cue-mark')) return;
                          selectChoice(c.id);
                        }}
                        style={isReviewMode ? { cursor: 'default' } : undefined}
                      >
                        <span className="letter" onClick={(e) => toggleStruck(c.id, e)}>
                          {c.label}
                        </span>
                        {/* Trusted first-party content from our own `choices` table, not user
                            input — choiceHtmlById carries the same cue-mark treatment as the
                            stimulus/stem above. */}
                        <span className="ctext" dangerouslySetInnerHTML={{ __html: choiceHtmlById.get(c.id) ?? c.content_markup }} />
                      </div>
                    );
                  })}
                </div>
              )}

              {showRationale && (
                <div className="rationale-panel">
                  <p className="rationale-title">Explanation</p>
                  {/* Trusted first-party content (the source's own official answer
                      rationale), not user input — rationaleHtml only adds bold/
                      upsize spans around "Choice X" mentions, see above. */}
                  <div className="rationale-body" dangerouslySetInnerHTML={{ __html: rationaleHtml }} />
                </div>
              )}

              {showCues && cues.length > 0 && (
                <div className="cue-panel">
                  <div className="cue-panel-head">
                    <span className="cue-panel-title">Trap &amp; cue analysis</span>
                    <div className="cue-legend">
                      <span className="cue-legend-item">
                        <span className="cue-swatch cue-govern" /> Governing rule
                      </span>
                      <span className="cue-legend-item">
                        <span className="cue-swatch cue-trap" /> Trap
                      </span>
                      <span className="cue-legend-item">
                        <span className="cue-swatch cue-assumption" /> Assumption
                      </span>
                    </div>
                  </div>
                  <div className="cue-list">
                    {cues.map((cue) => (
                      <div
                        key={cue.id}
                        className={`cue-row cue-${cue.cue_type}${activeCueId === cue.id ? ' active' : ''}`}
                        onClick={() => focusCue(cue.id)}
                      >
                        <div className="cue-row-head">
                          <span className={`cue-type-badge cue-${cue.cue_type}`}>
                            {cue.cue_type === 'govern' ? 'Governing rule' : cue.cue_type === 'trap' ? 'Trap' : 'Assumption'}
                          </span>
                          {cue.cue_type === 'trap' && cue.trap_categories?.label && (
                            <span className="cue-trap-label">{cue.trap_categories.label}</span>
                          )}
                        </div>
                        {(cue.explanation_title || cue.short_label) && (
                          <p className="cue-explanation-title">{cue.explanation_title ?? cue.short_label}</p>
                        )}
                        <p className="cue-explanation">{cue.explanation}</p>
                      </div>
                    ))}
                  </div>
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
              {CURRENT_Q >= TOTAL_Q ? (isReviewMode ? 'Back to Summary →' : 'Finish →') : 'Next →'}
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
