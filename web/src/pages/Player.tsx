import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './Player.css';
import { useAuth } from '../lib/AuthContext';
import {
  assembleFullTestModule,
  completeSession,
  decideModuleTier,
  getCuesForQuestion,
  getQuestionIdsWithCues,
  getQuestionWithChoices,
  getSessionModules,
  getSessionWithAttempts,
  isSprAnswerCorrect,
  saveAttemptHighlights,
  saveAttemptStruckChoices,
  startQuestionAttempt,
  submitQuestionAttempt,
  MATH_MODULE_QUESTION_COUNT,
  MATH_MODULE_SECONDS,
  RW_MODULE_QUESTION_COUNT,
  RW_MODULE_SECONDS,
  type AttemptWithQuestion,
  type CueWithCategory,
  type HighlightMark,
  type QuestionWithChoices,
  type SessionModuleRow,
} from '../lib/practiceSessions';
import { getOrCreateUserSettings } from '../lib/userSettings';
import { getNote, saveNote } from '../lib/questionNotes';
import { getSessionOrigin } from '../lib/sessionOrigin';
import { getAiSettings, type AiSettings } from '../lib/aiSettings';
import { AskAiPanel } from '../components/AskAiPanel';
import { AnchoredPortal } from '../components/AnchoredPortal';
import type { Database } from '../lib/database.types';

// Real full-test module sequence — R&W M1 → R&W M2 → (break) → Math M1 →
// Math M2. session_modules.module_number is scoped PER SUBJECT (DB CHECK
// restricts it to 1|2, unique per (session, subject, module_number)), so
// this fixed ordering — not module_number alone — is what turns a session's
// module rows into the real linear sequence a student walks through.
const MODULE_SEQUENCE: Array<{ subject: string; moduleNumber: number }> = [
  { subject: 'Reading and Writing', moduleNumber: 1 },
  { subject: 'Reading and Writing', moduleNumber: 2 },
  { subject: 'Math', moduleNumber: 1 },
  { subject: 'Math', moduleNumber: 2 },
];
function moduleSeqIndex(subject: string, moduleNumber: number): number {
  return MODULE_SEQUENCE.findIndex((s) => s.subject === subject && s.moduleNumber === moduleNumber);
}

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

// Collapses any run of whitespace (space, tab, newline) to a single space
// and trims the ends. Used on BOTH sides of every anchor-text comparison in
// this file (capture and render) so that whitespace differences — multiple
// spaces in source markup, or the synthetic newlines Selection.toString()
// is known to insert at some element boundaries — can never desync an
// anchor that's otherwise the same visible text.
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface TextIndexEntry {
  node: Text;
  offset: number;
}

// Builds a whitespace-NORMALIZED concatenation of a container's meaningful
// text, plus a 1:1 map from each character of that normalized string back
// to its real (Text node, offset) source position. Rewritten 2026-08-13
// after the previous raw (non-normalized) concatenation + manual offset
// arithmetic kept producing "highlighting a few characters highlights the
// whole passage from the beginning" — multiple targeted fixes to that
// arithmetic (comparePoint-based boundary resolution, a self-verification
// check) still didn't fully eliminate it. This replaces that whole
// approach: every consumer (cue marks AND user highlights, capture AND
// render) now goes through this single normalized index, so there's one
// definition of "position" instead of several manual ones that could
// disagree with each other.
function buildNormalizedTextIndex(container: HTMLElement): { text: string; positions: TextIndexEntry[] } {
  const textNodes = collectMeaningfulTextNodes(container);
  let text = '';
  const positions: TextIndexEntry[] = [];
  let pendingSpace = false;
  for (const node of textNodes) {
    const val = node.nodeValue ?? '';
    for (let i = 0; i < val.length; i++) {
      const ch = val[i];
      if (/\s/.test(ch)) {
        if (!pendingSpace && text.length > 0) {
          text += ' ';
          positions.push({ node, offset: i });
          pendingSpace = true;
        }
        continue;
      }
      pendingSpace = false;
      text += ch;
      positions.push({ node, offset: i });
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    positions.pop();
  }
  return { text, positions };
}

/**
 * Finds the nth occurrence (1-based) of `anchorTextRaw` (whitespace-
 * normalized before searching) within the container's normalized meaningful
 * text, wraps it in a <mark> built by `buildMark`, and returns true — or
 * false (with a console.warn tagged by `logTag`) if the anchor can't be
 * found or the wrap fails, which callers must treat as "skip this mark,"
 * never a crash. Shared by both the system-drawn cue marks and the
 * student's own highlights below — same anchor-by-text-match strategy
 * either way, since `cues.anchor_text`/`occurrence` and
 * `HighlightMark.anchorText`/`occurrence` are the same shape by design (see
 * HighlightMark's doc comment in practiceSessions.ts).
 */
function applyAnchoredMark(
  container: HTMLElement,
  anchorTextRaw: string,
  occurrence: number,
  buildMark: () => HTMLElement,
  logTag: string
): boolean {
  const anchorText = normalizeWs(anchorTextRaw);
  if (!anchorText) return false;

  const { text: concatenated, positions } = buildNormalizedTextIndex(container);
  if (positions.length === 0) return false;

  const occ = Math.max(1, occurrence || 1);
  let searchFrom = 0;
  let matchIndex = -1;
  for (let i = 0; i < occ; i++) {
    matchIndex = concatenated.indexOf(anchorText, searchFrom);
    if (matchIndex === -1) break;
    searchFrom = matchIndex + 1;
  }
  if (matchIndex === -1) {
    console.warn(`[${logTag}] anchor text not found: "${anchorText}"`);
    return false;
  }

  const matchStart = matchIndex;
  const matchEnd = matchIndex + anchorText.length;
  const startPos = positions[matchStart];
  const endPos = positions[matchEnd - 1];
  if (!startPos || !endPos) {
    console.warn(`[${logTag}] could not map anchor offsets for "${anchorText}"`);
    return false;
  }

  // Real bug found live, 2026-08-11: a match spanning across list-item
  // (<li>) boundaries — e.g. a selection that drags from one bullet into
  // the next — reached range.surroundContents() below, which can partially
  // mutate this shared detached container before it throws on a malformed
  // range. Since every mark in a withAllMarks() pass walks the SAME
  // container in sequence, one such partial mutation silently shifted or
  // corrupted the text-node offsets for every mark applied after it in the
  // same pass — symptoms reported live: a highlight rendering several
  // words offset from the real selection, and other marks vanishing
  // outright. A <mark> can't legally wrap sibling <li> elements anyway, so
  // this is refused up front rather than attempted.
  const closestLi = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest('li') ?? null;
  if (closestLi(startPos.node) !== closestLi(endPos.node)) {
    console.warn(`[${logTag}] anchor spans multiple list items — skipping to avoid corrupting the shared render pass: "${anchorText}"`);
    return false;
  }

  try {
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset + 1);
    range.surroundContents(buildMark());
    return true;
  } catch (err) {
    console.warn(`[${logTag}] failed to wrap anchor "${anchorText}":`, err);
    return false;
  }
}

function applyCueHighlight(container: HTMLElement, cue: CueWithCategory): boolean {
  return applyAnchoredMark(
    container,
    cue.anchor_text,
    cue.occurrence,
    () => {
      const mark = document.createElement('mark');
      mark.className = `cue-mark cue-${cue.cue_type}`;
      mark.dataset.cueId = cue.id;
      mark.tabIndex = 0;
      return mark;
    },
    'cues'
  );
}

// Mirrors the capture-time cap in onSelectableMouseUp (MAX_HIGHLIGHT_CHARS)
// — a render-time guard too, since a highlight created BEFORE that cap
// existed can still be sitting in saved data. Applying a huge anchor's
// range.surroundContents() risks the same partial-mutation corruption the
// cross-<li> guard above exists for (just not scoped to list-item
// boundaries specifically), which was the likely cause of other marks —
// including underlines — appearing to "vanish" shortly after: a giant
// prior highlight silently corrupting the shared render pass for every
// mark applied after it.
const MAX_RENDERED_HIGHLIGHT_CHARS = 300;

function applyUserHighlight(container: HTMLElement, hl: HighlightMark): boolean {
  if (hl.anchorText.length > MAX_RENDERED_HIGHLIGHT_CHARS) {
    console.warn('[highlights] skipping render of an oversized saved highlight (likely a pre-fix selection artifact)', {
      id: hl.id,
      length: hl.anchorText.length,
    });
    return false;
  }
  return applyAnchoredMark(
    container,
    hl.anchorText,
    hl.occurrence,
    () => {
      const mark = document.createElement('mark');
      mark.className = `user-hl user-hl-${hl.color}${hl.underline !== 'none' ? ` user-hl-u-${hl.underline}` : ''}`;
      mark.dataset.hlId = hl.id;
      return mark;
    },
    'highlights'
  );
}

/**
 * Returns `html` with every applicable cue AND user highlight anchor
 * wrapped in a <mark>, as a STRING — not a live-DOM mutation.
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
 *
 * Cues are applied before highlights — both only ever wrap text nodes in
 * <mark> elements (never add/remove text), so the second pass's own text-
 * node walk still sees the same concatenated text either way; order only
 * affects which mark ends up as the outer element when two spans overlap
 * exactly, which doesn't happen in practice (cues and highlights are drawn
 * independently by different parties over different substrings).
 */
interface PendingHighlight {
  scope: HighlightMark['scope'];
  anchorText: string;
  occurrence: number;
}

function withAllMarks(
  html: string,
  cues: CueWithCategory[],
  highlights: HighlightMark[],
  pending?: PendingHighlight | null,
  pendingUnderline?: HighlightMark['underline'],
): string {
  if (!html || (cues.length === 0 && highlights.length === 0 && !pending)) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  for (const cue of cues) applyCueHighlight(container, cue);
  for (const hl of highlights) applyUserHighlight(container, hl);
  // A visible placeholder for a selection that's been captured (popover is
  // open) but not yet turned into a real HighlightMark — without this the
  // browser's own native blue selection is the only cue for what's about to
  // be highlighted, and it silently disappears the instant the user's mouse
  // leaves the text to click a color swatch or the underline select (browser
  // default: mousedown elsewhere collapses the current selection). Reported
  // live, 2026-08-11: "I don't know what words did I previously intend to
  // highlight." This dashed-outline mark is the substitute cue that survives
  // that collapse, since it's baked into the render pass, not the live
  // selection. It also renders whatever underline style has been picked so
  // far, even before a color is chosen — picking "Dashed underline" with no
  // color yet applied previously had zero visible effect anywhere, which is
  // exactly what was reported as "the underline is not happening."
  if (pending) {
    applyAnchoredMark(
      container,
      pending.anchorText,
      pending.occurrence,
      () => {
        const mark = document.createElement('mark');
        mark.className = `user-hl-pending${pendingUnderline && pendingUnderline !== 'none' ? ` user-hl-u-${pendingUnderline}` : ''}`;
        return mark;
      },
      'highlights',
    );
  }
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

  // ---------------- full-test module tracking ----------------
  // Empty for ad-hoc/practice_set/retry sessions (they never call
  // createSessionModule) — every module-aware branch below is a no-op for
  // those, same flat single-block behavior as before this feature existed.
  const [modules, setModules] = useState<SessionModuleRow[]>([]);
  const [mistakeResurfaceDays, setMistakeResurfaceDays] = useState<number | null>(null);
  const [moduleBusy, setModuleBusy] = useState(false);

  const isFullTest = session?.mode === 'full_test';

  const moduleRanges = useMemo(() => {
    const sorted = [...modules].sort(
      (a, b) => moduleSeqIndex(a.subject, a.module_number) - moduleSeqIndex(b.subject, b.module_number)
    );
    let start = 1;
    return sorted.map((m) => {
      const len = m.question_ids.length;
      const range = { module: m, start, end: start + len - 1 };
      start += len;
      return range;
    });
  }, [modules]);

  const currentModuleRange = isFullTest ? moduleRanges.find((r) => CURRENT_Q >= r.start && CURRENT_Q <= r.end) : undefined;
  // Every module boundary lands exactly at TOTAL_Q too, since the next
  // module isn't appended to question_ids until the gate is actually
  // submitted — so this alone is enough to intercept "next" at the end of
  // any module, including the last one (finishSession handles that case).
  const atModuleBoundary = isFullTest && !!currentModuleRange && CURRENT_Q === currentModuleRange.end;

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

  // ---------------- per-question personal notes ----------------
  // One note per (user, question), independent of session/attempt — see
  // questionNotes.ts. `note === null` means none saved yet ("Add my notes");
  // a real string (even "") mid-edit is the draft in the open editor.
  const [note, setNote] = useState<string | null>(null);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    setNote(null);
    setNoteEditing(false);
    setNoteDraft('');
    if (!questionId || !user) return;
    let cancelled = false;
    getNote(user.id, questionId)
      .then((value) => {
        if (!cancelled) setNote(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) console.warn('getNote failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId, user]);

  // ---------------- Ask-AI (BYOK) ----------------
  // Fetched once per signed-in user, not per-question — whether AI is
  // connected doesn't change while answering a session, only the question
  // context passed to AskAiPanel does.
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getAiSettings(user.id)
      .then((row) => {
        if (!cancelled) setAiSettings(row);
      })
      .catch(() => {
        if (!cancelled) setAiSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const openNoteEditor = useCallback(() => {
    setNoteDraft(note ?? '');
    setNoteEditing(true);
  }, [note]);

  const cancelNoteEditor = useCallback(() => setNoteEditing(false), []);

  const submitNote = useCallback(async () => {
    if (!user || !questionId) return;
    setNoteSaving(true);
    try {
      await saveNote(user.id, questionId, noteDraft);
      setNote(noteDraft.trim() || null);
      setNoteEditing(false);
    } catch (err) {
      console.warn('saveNote failed:', err);
    } finally {
      setNoteSaving(false);
    }
  }, [user, questionId, noteDraft]);

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

  // Reloads BOTH the session (so TOTAL_Q/question_ids/allotted_seconds pick
  // up a just-appended module) and attempts — used after a module
  // transition, where refetchAttempts alone wouldn't see the new questions.
  const reloadSession = useCallback(async () => {
    if (!sessionId) return null;
    const result = await getSessionWithAttempts(sessionId);
    if (result) {
      setSession(result.session);
      setAttempts(result.attempts);
    }
    return result;
  }, [sessionId]);

  const reloadModules = useCallback(async () => {
    if (!sessionId) return [] as SessionModuleRow[];
    const rows = await getSessionModules(sessionId);
    setModules(rows);
    return rows;
  }, [sessionId]);

  // Load this full test's module rows once per session (empty array for
  // non-full-test sessions, which never write any).
  useEffect(() => {
    void reloadModules();
  }, [reloadModules]);

  // Needed for the mistake-resurfacing fallback ceiling when assembling
  // Modules 2-4 live — same setting Ad-hoc Builder and Full Test Setup load.
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
  // what was actually answered, not prompt for a fresh answer. Highlights
  // and struck choices load from ANY existing attempt for this question
  // (test mode or review mode alike) — both can now be created before an
  // answer is ever submitted (see ensureMarkAttemptId below), so "existing
  // attempt" no longer implies "already answered" the way it used to.
  useEffect(() => {
    setCurrentAttemptId(null);
    const existingAttempt = attempts.find((a) => a.question_id === questionId);
    if (isReviewMode) {
      const priorAttempt = attempts.find((a) => a.question_id === questionId && a.submitted_at);
      setSelectedChoiceId(priorAttempt?.selected_choice_id ?? null);
      setEnteredValue(priorAttempt?.entered_value ?? '');
    } else {
      setSelectedChoiceId(null);
      setEnteredValue('');
    }
    setStruck(new Set(existingAttempt?.struck_choice_ids ?? []));
    setHighlights((existingAttempt?.highlights as unknown as HighlightMark[]) ?? []);
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

  // ---------------- choices / strikethrough / highlights / mark for review ----------------
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [enteredValue, setEnteredValue] = useState('');
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const [highlights, setHighlights] = useState<HighlightMark[]>([]);
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

  // Resolves the attempt row that highlights/strikethrough save to —
  // separate from ensureAttemptStarted (which only fires on actually
  // answering) because both marks are now reachable before an answer is
  // ever submitted, and both stay editable in review mode, where
  // ensureAttemptStarted is a no-op by design. Prefers any attempt already
  // on record for this question (review mode's submitted one, or test
  // mode's in-progress one from a prior visit); creates a fresh one only if
  // neither exists yet.
  const ensureMarkAttemptId = useCallback(async (): Promise<string | null> => {
    if (currentAttemptId) return currentAttemptId;
    const existing = attempts.find((a) => a.question_id === questionId);
    if (existing) {
      setCurrentAttemptId(existing.id);
      return existing.id;
    }
    if (!user || !sessionId || !questionId) return null;
    try {
      const row = await startQuestionAttempt({ userId: user.id, sessionId, questionId, attemptNumber: 1 });
      setCurrentAttemptId(row.id);
      return row.id;
    } catch (err) {
      console.warn('ensureMarkAttemptId failed:', err);
      return null;
    }
  }, [currentAttemptId, attempts, questionId, user, sessionId]);

  const toggleStruck = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const next = new Set(struck);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setStruck(next);
      const attemptId = await ensureMarkAttemptId();
      if (!attemptId) return;
      saveAttemptStruckChoices(attemptId, [...next]).catch((err) => console.warn('saveAttemptStruckChoices failed:', err));
    },
    [struck, ensureMarkAttemptId],
  );

  const addHighlightMark = useCallback(
    async (mark: HighlightMark) => {
      const next = [...highlights, mark];
      setHighlights(next);
      const attemptId = await ensureMarkAttemptId();
      if (!attemptId) return;
      saveAttemptHighlights(attemptId, next).catch((err) => console.warn('saveAttemptHighlights failed:', err));
    },
    [highlights, ensureMarkAttemptId],
  );

  const removeHighlightMark = useCallback(
    async (id: string) => {
      const next = highlights.filter((h) => h.id !== id);
      setHighlights(next);
      const attemptId = await ensureMarkAttemptId();
      if (!attemptId) return;
      saveAttemptHighlights(attemptId, next).catch((err) => console.warn('saveAttemptHighlights failed:', err));
    },
    [highlights, ensureMarkAttemptId],
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
  const showBreak = useCallback(() => {
    setView('break');
    startBreakCountdown();
  }, [startBreakCountdown]);

  // Clears the per-module clock/overtime state that reloadSession's
  // "seed sessionSeconds from session.allotted_seconds" effect doesn't
  // touch on its own (assembleFullTestModule already bumped that DB column
  // to the new module's pacing before this runs, so that effect re-fires
  // correctly once reloadSession's setSession lands).
  const resetModuleClock = useCallback(() => {
    setOvertimeSeconds(0);
    setIsOvertime(false);
    timesUpShownRef.current = false;
    setQSeconds(0);
  }, []);

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

  /**
   * Real module-gate submit for a full test: scores the module that just
   * finished off the live `attempts` state and decides what happens next —
   * R&W M1 → assemble R&W M2 (tiered) and continue straight in; R&W M2 →
   * break; Math M1 → assemble Math M2 (tiered) and continue straight in;
   * Math M2 → the whole test is actually done, real finishSession. Only
   * meaningful when currentModuleRange is set (full-test sessions) — the
   * gate is unreachable any other way for non-full-test sessions (goNext
   * never opens it for them; only the dev-only demo button can, and that
   * has no module to submit).
   */
  const gateSubmit = useCallback(async () => {
    if (!currentModuleRange || !sessionId || !user) {
      setView('main');
      return;
    }
    setModuleBusy(true);
    try {
      const finished = currentModuleRange.module;
      const finishedIds = finished.question_ids;
      const correct = attempts.filter(
        (a) => finishedIds.includes(a.question_id) && !!a.submitted_at && a.is_correct === true
      ).length;
      const tier = decideModuleTier(correct, finishedIds.length);

      if (finished.subject === 'Math' && finished.module_number === 2) {
        // Last module of the real test — this gate's submit is the actual finish.
        await finishSession();
        return;
      }

      if (finished.subject === 'Reading and Writing' && finished.module_number === 1) {
        await assembleFullTestModule({
          sessionId,
          subject: 'Reading and Writing',
          moduleNumber: 2,
          tier,
          count: RW_MODULE_QUESTION_COUNT,
          moduleSeconds: RW_MODULE_SECONDS,
          resurfaceForUserId: user.id,
          mistakeResurfaceDays,
        });
        const [freshSession] = await Promise.all([reloadSession(), reloadModules()]);
        resetModuleClock();
        setView('main');
        const nextStart = (freshSession?.session.question_ids.length ?? TOTAL_Q) - RW_MODULE_QUESTION_COUNT + 1;
        navigate(`/practice/${sessionId}/q/${nextStart}`);
        return;
      }

      if (finished.subject === 'Reading and Writing' && finished.module_number === 2) {
        // R&W is done — real break before Math starts, not the demo-only
        // "show break screen" button's disconnected version of this.
        setView('break');
        startBreakCountdown();
        return;
      }

      if (finished.subject === 'Math' && finished.module_number === 1) {
        await assembleFullTestModule({
          sessionId,
          subject: 'Math',
          moduleNumber: 2,
          tier,
          count: MATH_MODULE_QUESTION_COUNT,
          moduleSeconds: MATH_MODULE_SECONDS,
          resurfaceForUserId: user.id,
          mistakeResurfaceDays,
        });
        const [freshSession] = await Promise.all([reloadSession(), reloadModules()]);
        resetModuleClock();
        setView('main');
        const nextStart = (freshSession?.session.question_ids.length ?? TOTAL_Q) - MATH_MODULE_QUESTION_COUNT + 1;
        navigate(`/practice/${sessionId}/q/${nextStart}`);
      }
    } catch (err) {
      console.warn('Module transition failed:', err);
      toast('Something went wrong assembling the next module — please try again.');
      setView('main');
    } finally {
      setModuleBusy(false);
    }
  }, [
    currentModuleRange,
    sessionId,
    user,
    attempts,
    mistakeResurfaceDays,
    TOTAL_Q,
    finishSession,
    reloadSession,
    reloadModules,
    resetModuleClock,
    startBreakCountdown,
    navigate,
    toast,
  ]);

  /** Real transition out of the R&W→Math break: assembles Math Module 1
   * (fixed mix, same as R&W M1 — Math's tier decision only applies to its
   * own Module 2) and continues straight into it. */
  const continueFromBreak = useCallback(async () => {
    if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    if (!sessionId || !user) {
      setView('main');
      return;
    }
    setModuleBusy(true);
    try {
      await assembleFullTestModule({
        sessionId,
        subject: 'Math',
        moduleNumber: 1,
        tier: 'module1',
        count: MATH_MODULE_QUESTION_COUNT,
        moduleSeconds: MATH_MODULE_SECONDS,
        resurfaceForUserId: user.id,
        mistakeResurfaceDays,
      });
      const [freshSession] = await Promise.all([reloadSession(), reloadModules()]);
      resetModuleClock();
      setView('main');
      const nextStart = (freshSession?.session.question_ids.length ?? TOTAL_Q) - MATH_MODULE_QUESTION_COUNT + 1;
      navigate(`/practice/${sessionId}/q/${nextStart}`);
    } catch (err) {
      console.warn('Assembling Math Module 1 failed:', err);
      toast('Something went wrong starting Math — please try again.');
      setView('break');
    } finally {
      setModuleBusy(false);
    }
  }, [sessionId, user, mistakeResurfaceDays, TOTAL_Q, reloadSession, reloadModules, resetModuleClock, navigate, toast]);

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
      if (atModuleBoundary && !isReviewMode) {
        // Full-test module boundary (including the very last module) —
        // real review-before-submit gate, not a silent continue. gateSubmit
        // decides what happens next once the student actually submits it.
        await refetchAttempts();
        setView('gate');
      } else if (CURRENT_Q >= TOTAL_Q) {
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
  }, [
    sessionId,
    navBusy,
    CURRENT_Q,
    TOTAL_Q,
    isReviewMode,
    atModuleBoundary,
    commitCurrentAnswer,
    finishSession,
    refetchAttempts,
    navigate,
  ]);

  // ---------------- exit control ----------------
  // Returns to wherever this session was actually entered from (Mistake Log,
  // Session Summary, Dashboard, Practice Builder, Full Test Setup) rather
  // than a hardcoded '/' — see sessionOrigin.ts for why this can't just be
  // react-router location.state.
  const exitToDashboard = useCallback(() => {
    const origin = getSessionOrigin(sessionId) ?? '/';
    // Nothing "in progress" to lose when reviewing an already-completed
    // session — the resumable-progress framing only makes sense mid-test.
    if (isReviewMode) {
      navigate(origin);
      return;
    }
    if (window.confirm('Leave this session? Your progress is saved and you can resume later.')) {
      navigate(origin);
    }
  }, [isReviewMode, navigate, sessionId]);

  // ---------------- highlighter — real Selection/Range API to CAPTURE the
  // selection (anchor text + occurrence + which scope), but the actual mark
  // is never drawn by mutating that DOM directly — it's persisted to state,
  // then rendered the same safe string-transform way as cue marks (see
  // withAllMarks' doc comment for why a live-DOM "wrap it once" pass doesn't
  // survive React re-renders). ----------------------------------------------
  const stimulusRef = useRef<HTMLDivElement | null>(null);
  const hlPopoverRef = useRef<HTMLDivElement | null>(null);
  const [hlPopoverOpen, setHlPopoverOpen] = useState(false);
  const [hlPopoverPos, setHlPopoverPos] = useState({ top: 0, left: 0 });
  // The highlight under the cursor when the popover opened, if any (clicking
  // an existing mark to edit/remove it rather than starting a new one).
  const [hlEditingId, setHlEditingId] = useState<string | null>(null);
  // Kept as a ref (read synchronously by applyHighlightColor without waiting
  // on a re-render) AND mirrored into state (pendingHl) purely so its
  // presence can drive the visible placeholder mark in withAllMarks — see
  // that function's doc comment for why a plain ref alone isn't enough here.
  const pendingHlRef = useRef<PendingHighlight | null>(null);
  const [pendingHl, setPendingHl] = useState<PendingHighlight | null>(null);
  const setPendingHlBoth = useCallback((v: PendingHighlight | null) => {
    pendingHlRef.current = v;
    setPendingHl(v);
  }, []);
  // Underline style for a NOT-YET-created highlight — picking it shouldn't
  // require applying a color first. Reset on every fresh selection; once a
  // highlight actually exists (editingHighlight set), the select reads/
  // writes that highlight's own `underline` field instead of this.
  const [pendingUnderline, setPendingUnderline] = useState<HighlightMark['underline']>('none');

  const onSelectableMouseUp = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
      // Not a fresh selection — but a plain click landing directly on an
      // existing mark should still open the popover, in "edit" mode.
      const mark = (e.target as HTMLElement).closest('mark.user-hl') as HTMLElement | null;
      if (!mark || !mark.dataset.hlId) return;
      setHlEditingId(mark.dataset.hlId);
      setPendingHlBoth(null);
      const rect = mark.getBoundingClientRect();
      setHlPopoverPos({ top: window.scrollY + rect.top - 54, left: window.scrollX + rect.left + rect.width / 2 - 110 });
      setHlPopoverOpen(true);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
    )?.closest('[data-hl-scope]') as HTMLElement | null;
    if (!container) return;
    const scope = container.getAttribute('data-hl-scope') as HighlightMark['scope'] | null;
    if (!scope) return;

    // Rewritten 2026-08-13 — the previous approach (manually resolving
    // range.startContainer/endContainer to offsets into a hand-built
    // concatenation, via progressively more elaborate DOM-position
    // arithmetic) kept producing "highlighting a few characters highlights
    // the whole passage from the beginning" despite multiple targeted
    // fixes. Replaced with something structurally simpler and far less
    // prone to this class of bug: let the BROWSER resolve both pieces we
    // need, via its own battle-tested Range.toString().
    //
    // 1. anchorText = the selection's own text (normalized — see
    //    normalizeWs's doc comment for why).
    // 2. occurrence = count how many times that normalized text already
    //    appears in EVERYTHING BEFORE the selection start — built the same
    //    way, via a second Range spanning from the top of the container to
    //    the selection's start point, again using native toString()
    //    instead of manual offset math.
    //
    // This still lands on the exact same normalized-text-index that
    // applyAnchoredMark uses to search at render time (see
    // buildNormalizedTextIndex), so capture and render are guaranteed
    // consistent — but capture itself no longer does any manual DOM
    // position resolution at all, eliminating the whole bug class rather
    // than patching another edge case of it.
    const anchorText = normalizeWs(sel.toString());
    if (!anchorText) return;

    // Hard cap, added 2026-08-13 after live screenshots showed the
    // NATIVE browser selection (the OS-level blue highlight, visible
    // before any of our code runs) itself spanning from the very top of
    // the passage down to a point the student only meant to click near —
    // e.g. in Safari, clicking close to an existing <mark> or across list
    // markup can occasionally make the browser's own selection anchor
    // somewhere earlier than intended. That's not something our anchor
    // capture logic can detect or correct (by the time we read
    // window.getSelection(), the browser has already decided what's
    // selected) — but we CAN refuse to turn an implausibly large
    // selection into a highlight, so "highlight two words" can never
    // again silently become "the whole passage got highlighted." A
    // student highlighting a genuine full sentence or two stays well
    // under this; anything past it is far more likely a selection
    // artifact than an intentional highlight.
    const MAX_HIGHLIGHT_CHARS = 300;
    if (anchorText.length > MAX_HIGHLIGHT_CHARS) {
      console.warn('[highlights] selection too large, refusing to create — likely a browser selection artifact, not an intentional highlight', {
        length: anchorText.length,
        preview: anchorText.slice(0, 60) + '…',
      });
      toast('That selection was too large to highlight — try selecting just the words you want.');
      sel.removeAllRanges();
      return;
    }

    let beforeRange: Range;
    try {
      beforeRange = document.createRange();
      beforeRange.selectNodeContents(container);
      beforeRange.setEnd(range.startContainer, range.startOffset);
    } catch (err) {
      console.warn('[highlights] failed to build the "before" range for occurrence counting, skipping capture', err);
      return;
    }
    const beforeText = normalizeWs(beforeRange.toString());
    const occurrence = beforeText.split(anchorText).length; // 1-based count of prior matches + 1

    // Sanity check: this now exercises the SAME algorithm (and the SAME
    // normalized index) applyAnchoredMark will use at render time, so it's
    // a real consistency check — not the earlier tautological version that
    // re-derived from the same numbers it was supposed to be validating.
    const { text: fullNormalized } = buildNormalizedTextIndex(container);
    let verifyFrom = 0;
    let verifyMatch = -1;
    for (let i = 0; i < Math.max(1, occurrence); i++) {
      verifyMatch = fullNormalized.indexOf(anchorText, verifyFrom);
      if (verifyMatch === -1) break;
      verifyFrom = verifyMatch + 1;
    }
    if (verifyMatch === -1) {
      console.warn('[highlights] capture could not be relocated in the render-time index, skipping', { anchorText, occurrence });
      return;
    }

    setPendingHlBoth({ scope, anchorText, occurrence });
    setHlEditingId(null);
    setPendingUnderline('none');

    const rect = range.getBoundingClientRect();
    setHlPopoverPos({
      top: window.scrollY + rect.top - 54,
      left: window.scrollX + rect.left + rect.width / 2 - 110,
    });
    setHlPopoverOpen(true);
  }, [setPendingHlBoth, toast]);

  const editingHighlight = hlEditingId ? highlights.find((h) => h.id === hlEditingId) : null;

  const applyHighlightColor = useCallback(
    (color: HighlightMark['color']) => {
      if (editingHighlight) {
        const next = highlights.map((h) => (h.id === editingHighlight.id ? { ...h, color } : h));
        setHighlights(next);
        ensureMarkAttemptId().then((id) => {
          if (id) saveAttemptHighlights(id, next).catch((err) => console.warn('saveAttemptHighlights failed:', err));
        });
        return;
      }
      const pending = pendingHlRef.current;
      if (!pending) return;
      // Underline may already have been picked (select is never disabled —
      // see applyHighlightUnderline) before a color was chosen for a brand
      // new selection; use whatever's pending instead of always 'none'.
      const mark: HighlightMark = { id: crypto.randomUUID(), ...pending, color, underline: pendingUnderline };
      addHighlightMark(mark);
      setHlEditingId(mark.id);
      setPendingHlBoth(null);
      setPendingUnderline('none');
      window.getSelection()?.removeAllRanges();
    },
    [editingHighlight, highlights, ensureMarkAttemptId, addHighlightMark, pendingUnderline, setPendingHlBoth],
  );

  const applyHighlightUnderline = useCallback(
    (underline: HighlightMark['underline']) => {
      if (editingHighlight) {
        const next = highlights.map((h) => (h.id === editingHighlight.id ? { ...h, underline } : h));
        setHighlights(next);
        ensureMarkAttemptId().then((id) => {
          if (id) saveAttemptHighlights(id, next).catch((err) => console.warn('saveAttemptHighlights failed:', err));
        });
        return;
      }
      // No highlight created yet — a fresh selection can still set its
      // underline style ahead of picking a color (the select is never
      // disabled). Stashed here and consumed by applyHighlightColor.
      setPendingUnderline(underline);
    },
    [editingHighlight, highlights, ensureMarkAttemptId],
  );

  const deleteEditingHighlight = useCallback(() => {
    if (!editingHighlight) return;
    removeHighlightMark(editingHighlight.id);
    setHlPopoverOpen(false);
    setHlEditingId(null);
  }, [editingHighlight, removeHighlightMark]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (hlPopoverRef.current && !hlPopoverRef.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('mark.user-hl')) {
        setHlPopoverOpen(false);
        // A pending (not-yet-colored) selection abandoned by clicking away
        // should drop its placeholder mark too, not leave it visibly "stuck"
        // highlighted with no popover left to act on it.
        setPendingHlBoth(null);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [setPendingHlBoth]);

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
  // see withAllMarks' doc comment for why that approach doesn't survive
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

  const stimulusHighlights = useMemo(() => highlights.filter((h) => h.scope === 'stimulus'), [highlights]);
  const stemHighlights = useMemo(() => highlights.filter((h) => h.scope === 'stem'), [highlights]);
  const highlightsByChoiceLabel = useMemo(() => {
    const map = new Map<string, HighlightMark[]>();
    for (const h of highlights) {
      if (!h.scope.startsWith('choice:')) continue;
      const label = h.scope.slice('choice:'.length);
      const arr = map.get(label) ?? [];
      arr.push(h);
      map.set(label, arr);
    }
    return map;
  }, [highlights]);

  const stimulusHtml = useMemo(
    () =>
      question?.stimulus_markup
        ? withAllMarks(
            question.stimulus_markup,
            stimulusCues,
            stimulusHighlights,
            pendingHl?.scope === 'stimulus' ? pendingHl : null,
            pendingUnderline,
          )
        : '',
    [question?.stimulus_markup, stimulusCues, stimulusHighlights, pendingHl, pendingUnderline],
  );
  const stemHtml = useMemo(
    () =>
      question?.stem_markup
        ? withAllMarks(
            question.stem_markup,
            stemCues,
            stemHighlights,
            pendingHl?.scope === 'stem' ? pendingHl : null,
            pendingUnderline,
          )
        : '',
    [question?.stem_markup, stemCues, stemHighlights, pendingHl, pendingUnderline],
  );
  const choiceHtmlById = useMemo(() => {
    const map = new Map<string, string>();
    if (!question) return map;
    for (const c of question.choices) {
      const scope = `choice:${c.label}` as const;
      map.set(
        c.id,
        withAllMarks(
          c.content_markup,
          choiceCuesByChoiceId.get(c.id) ?? [],
          highlightsByChoiceLabel.get(c.label) ?? [],
          pendingHl?.scope === scope ? pendingHl : null,
          pendingUnderline,
        )
      );
    }
    return map;
  }, [question, choiceCuesByChoiceId, highlightsByChoiceLabel, pendingHl, pendingUnderline]);

  // Plain-text summary handed to the AI as prompt context — stripped of
  // markup since the model doesn't need HTML, just the real content. The
  // [correct] tag is withheld until canRevealFeedback (same gate as the
  // rationale panel) so Ask-AI can't be used to fish the answer out of the
  // AI before actually answering.
  const questionContextText = useMemo(() => {
    if (!question) return '';
    const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const parts: string[] = [];
    if (question.stimulus_markup) parts.push(stripHtml(question.stimulus_markup));
    parts.push(stripHtml(question.stem_markup));
    question.choices.forEach((c) => {
      parts.push(`${c.label}) ${stripHtml(c.content_markup)}${canRevealFeedback && c.is_correct ? ' [correct]' : ''}`);
    });
    return parts.join('\n');
  }, [question, canRevealFeedback]);

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

  // Review-mode only: per-position correct/incorrect, for the question
  // navigator's Bluebook-style modal (real exam review shows this; the live
  // navigator during an active section never does, matching the reference).
  const positionCorrectness = useMemo(() => {
    if (!session) return new Map<number, boolean>();
    const map = new Map<number, boolean>();
    for (const a of attempts) {
      if (!a.submitted_at || a.is_correct === null) continue;
      const idx = session.question_ids.indexOf(a.question_id);
      if (idx >= 0) map.set(idx + 1, a.is_correct);
    }
    return map;
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
        <div className="tb-left">
          <button className="iconbtn" title="Exit to Dashboard" aria-label="Exit to Dashboard" onClick={exitToDashboard}>
            ←
          </button>
          <div className="topbar-brand">
            <b>Blue</b>Prep
          </div>
          <span className={`subj-badge${isMath ? '' : ' rw'}`}>{subjectLabel}</span>
        </div>

        {/* Fills the space between the two fixed-width clusters — previously
            capped at max-width:260px with the right side pushed off via
            margin-left:auto, which left one big dead gap instead of the bar
            reading as evenly composed. Fixed 2026-08-12 per explicit
            feedback ("properly align the top bar"). */}
        <div className="tb-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="tb-right">
          {isReviewMode ? (
            <div className="timer-block">
              <p className="tlabel">Status</p>
              <p className="tval mono">Reviewing</p>
            </div>
          ) : hasSessionCountdown ? (
            <div className="timer-block">
              <p className="tlabel" style={isOvertime ? { color: 'var(--red)' } : undefined}>
                {isOvertime ? 'Overtime' : 'Session'}
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
            <p className="tlabel">Question</p>
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
          <div className="tb-divider" />
          {/* Real Ask-AI panel — moved up here from the bottombar (2026-08-12,
              explicit request), replacing what used to be just a placeholder
              icon that toasted a stub message. placement="below" since the
              header sits too close to the viewport top for the panel to open
              upward the way it does from the bottombar. */}
          {!isReviewMode && (
            <AskAiPanel
              isConnected={!!aiSettings}
              model={aiSettings?.model ?? null}
              questionContext={questionContextText}
              placement="below"
            />
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
        // Clicking a swatch/button would otherwise collapse the browser's
        // live text selection first — standard toolbar behavior elsewhere
        // too, kept as a second line of defense alongside the
        // .user-hl-pending placeholder mark. Excludes the <select> itself:
        // canceling its mousedown would also cancel the browser's default
        // action of opening its dropdown.
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName !== 'SELECT') e.preventDefault();
        }}
      >
        {(['yellow', 'blue', 'pink'] as const).map((color) => (
          <button
            key={color}
            type="button"
            className={`hl-swatch hl-swatch-${color}${editingHighlight?.color === color ? ' active' : ''}`}
            aria-label={`${color} highlight`}
            onClick={() => applyHighlightColor(color)}
          />
        ))}
        <span className="hl-sep" />
        <select
          className="hl-underline-select"
          value={editingHighlight?.underline ?? pendingUnderline}
          onChange={(e) => applyHighlightUnderline(e.target.value as HighlightMark['underline'])}
          title="Underline style"
        >
          <option value="none">No underline</option>
          <option value="solid">Solid underline</option>
          <option value="dashed">Dashed underline</option>
          <option value="dotted">Dotted underline</option>
        </select>
        <span className="hl-sep" />
        <button
          type="button"
          className="hl-icon-btn"
          title="Add a note to this question"
          onClick={() => {
            setHlPopoverOpen(false);
            openNoteEditor();
            document.getElementById('note-panel-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          ✎ Note
        </button>
        {editingHighlight && (
          <button type="button" className="hl-icon-btn" title="Remove this highlight" onClick={deleteEditingHighlight}>
            🗑
          </button>
        )}
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
              <div className="stimulus serif" ref={stimulusRef} onMouseUp={onSelectableMouseUp}>
                {question.stimulus_markup && (
                  // Trusted first-party content from our own `questions` table, not user
                  // input — stimulusHtml is that same content with cue <mark> spans woven
                  // in as a string (see withAllMarks). data-hl-scope tags this block so a
                  // selection inside it anchors as a "stimulus" highlight, not "stem".
                  <div data-hl-scope="stimulus" dangerouslySetInnerHTML={{ __html: stimulusHtml }} />
                )}
                {/* eslint-disable-next-line react/no-danger */}
                <div data-hl-scope="stem" dangerouslySetInnerHTML={{ __html: stemHtml }} />
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
                <div className="choices" onMouseUp={onSelectableMouseUp}>
                  {question.choices.map((c) => {
                    const showFeedback = isReviewMode && !!selectedChoiceId;
                    const feedbackClass = showFeedback
                      ? c.is_correct
                        ? ' correct'
                        : selectedChoiceId === c.id
                          ? ' incorrect'
                          : ''
                      : '';
                    const isStruck = struck.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className={`choice${selectedChoiceId === c.id ? ' selected' : ''}${isStruck ? ' struck' : ''}${feedbackClass}`}
                        onClick={(e) => {
                          if (isReviewMode) return;
                          // A cue-marked word inside this choice's text has its own
                          // click behavior (focus/flash the cue) — don't also let
                          // that click bubble up and select the choice as the
                          // answer, which visually swallows the mark's underline
                          // under the "selected" style and looks like a bug.
                          if ((e.target as HTMLElement).closest('mark.cue-mark')) return;
                          if ((e.target as HTMLElement).closest('.strike-btn')) return;
                          selectChoice(c.id);
                        }}
                        style={isReviewMode ? { cursor: 'default' } : undefined}
                      >
                        <span className="letter">{c.label}</span>
                        {/* Trusted first-party content from our own `choices` table, not user
                            input — choiceHtmlById carries the same cue-mark treatment as the
                            stimulus/stem above. */}
                        <span
                          className="ctext"
                          data-hl-scope={`choice:${c.label}`}
                          dangerouslySetInnerHTML={{ __html: choiceHtmlById.get(c.id) ?? c.content_markup }}
                        />
                        {/* Bluebook-style per-choice strikethrough — independent of which
                            choice is selected as the answer, works in test AND review mode
                            (real persisted state, see toggleStruck/ensureMarkAttemptId). */}
                        {isStruck ? (
                          <button
                            type="button"
                            className="strike-btn undo"
                            onClick={(e) => toggleStruck(c.id, e)}
                            title="Restore this choice"
                          >
                            Undo
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="strike-btn"
                            onClick={(e) => toggleStruck(c.id, e)}
                            title="Cross out this choice"
                            aria-label={`Cross out choice ${c.label}`}
                          >
                            ⊘
                          </button>
                        )}
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

              {
                // Reachable anytime, not just after answering — real change,
                // 2026-08-11 (Bluebook parity): notes used to be gated on
                // canRevealFeedback, so a question you hadn't answered yet
                // had no note panel at all. The gate is gone; canRevealFeedback
                // still controls the rationale/cues panels above, unrelated.
              }
              <div className="note-panel" id="note-panel-anchor">
                  {noteEditing ? (
                    <>
                      <textarea
                        className="note-textarea"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Explain in your own words why this answer is right or why you got it wrong."
                        autoFocus
                      />
                      <div className="note-actions">
                        <button className="btn ghost" onClick={cancelNoteEditor} disabled={noteSaving}>
                          Cancel
                        </button>
                        <button className="btn primary" style={{ margin: 0 }} onClick={() => void submitNote()} disabled={noteSaving}>
                          {noteSaving ? 'Saving…' : 'Save notes'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="note-summary">
                      {note && <span className="note-text">{note}</span>}
                      <button className="btn ghost note-edit-btn" onClick={openNoteEditor}>
                        {note ? 'Edit my notes' : 'Add my notes'}
                      </button>
                    </div>
                  )}
                </div>

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
            {/* Bluebook-style question navigator trigger — moved here from
                the topbar (2026-08-12, explicit request) to match the real
                exam's own bottom-bar placement. Popover renders through
                AnchoredPortal (see that file's doc comment) since this
                button lives inside .bottombar, which forces overflow-y:auto
                via its own overflow-x:auto — a plain absolutely-positioned
                popover here would be silently clipped the same way the
                Ask-AI popover originally was. */}
            <button
              ref={jumpBtnRef}
              className="nav-trigger-pill mono"
              onClick={(e) => {
                e.stopPropagation();
                setNavOpen((o) => !o);
              }}
            >
              Question {CURRENT_Q} of {TOTAL_Q} <span className="nav-trigger-caret">⌄</span>
            </button>
            {/* Ask-AI moved up to the header (2026-08-12, explicit request)
                — Next is now the only thing on the right, no longer sharing
                this margin-left:auto slot with the AI icon. */}
            <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={goNext} disabled={navBusy}>
              {CURRENT_Q >= TOTAL_Q ? (isReviewMode ? 'Back to Summary →' : 'Finish →') : 'Next →'}
            </button>
          </div>

          <AnchoredPortal anchorRef={jumpBtnRef} active={navOpen} placement="above" align="center">
            <div className="nav-modal" ref={navRef} onClick={(e) => e.stopPropagation()}>
              <div className="nav-modal-head">
                <h2>
                  {subjectLabel} Questions{isReviewMode ? ' — Review' : ''}
                </h2>
                <button className="nav-modal-close" aria-label="Close" onClick={() => setNavOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="nav-legend">
                {isReviewMode ? (
                  <>
                    <span>
                      <span className="nav-ico current-ico">📍</span>Current
                    </span>
                    <span>
                      <span className="nav-ico correct-ico">✓</span>Correct
                    </span>
                    <span>
                      <span className="nav-ico incorrect-ico">✕</span>Incorrect
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <span className="nav-ico current-ico">📍</span>Current
                    </span>
                    <span>
                      <span className="sw" />
                      Unanswered
                    </span>
                    <span>
                      <span className="nav-ico flag-ico" />
                      For Review
                    </span>
                  </>
                )}
              </div>
              <div className="nav-grid">
                {/* Scoped to the CURRENT MODULE only (real full-test sessions span
                    up to 98 questions across 4 modules) — matches the real exam's
                    own per-section navigator. Ad-hoc/practice sessions have no
                    module concept (currentModuleRange is undefined for them), so
                    the grid falls back to the whole session, same as before. */}
                {Array.from(
                  { length: (currentModuleRange?.end ?? TOTAL_Q) - (currentModuleRange?.start ?? 1) + 1 },
                  (_, i) => (currentModuleRange?.start ?? 1) + i
                ).map((pos) => {
                  const isAnswered = answeredPositions.has(pos);
                  const isFlagged = flaggedPositions.has(pos);
                  const isCurrent = pos === CURRENT_Q;
                  // Real bug found live, 2026-08-12: this was showing in TEST
                  // mode too — a lit-up 💡 on a not-yet-answered question is a
                  // flat-out spoiler ("this one has a trap"), the exact thing
                  // canRevealFeedback exists elsewhere to prevent. Cue/trap
                  // analysis is review-only information now, matching every
                  // other cue reveal in this app.
                  const hasCue = isReviewMode && !!session && cuedQuestionIds.has(session.question_ids[pos - 1]);
                  const correctness = isReviewMode ? positionCorrectness.get(pos) : undefined;
                  return (
                    <div
                      key={pos}
                      className={`nav-cell${isAnswered ? ' answered' : !isReviewMode ? ' unanswered' : ''}${
                        isCurrent ? ' current' : ''
                      }${isFlagged ? ' flagged' : ''}${hasCue ? ' has-cue' : ''}${correctness === true ? ' correct' : ''}${
                        correctness === false ? ' incorrect' : ''
                      }`}
                      title={`Question ${pos}${
                        isReviewMode
                          ? correctness === true
                            ? ' — correct'
                            : correctness === false
                              ? ' — incorrect'
                              : ' — not answered'
                          : isAnswered
                            ? ' — answered'
                            : ' — unanswered'
                      }${isFlagged ? ', flagged' : ''}${hasCue ? ' — has trap/cue analysis' : ''}`}
                      onClick={() => {
                        setNavOpen(false);
                        if (sessionId) navigate(`/practice/${sessionId}/q/${pos}`);
                      }}
                    >
                      {isCurrent && <span className="nav-cell-pin">📍</span>}
                      {pos}
                    </div>
                  );
                })}
              </div>
              {sessionId && (
                <button
                  className="nav-modal-review-btn"
                  onClick={() => {
                    setNavOpen(false);
                    navigate(`/sessions/${sessionId}`);
                  }}
                >
                  Go to Session Summary
                </button>
              )}
            </div>
          </AnchoredPortal>
        </>
      )}

      {view === 'gate' && (() => {
        // Scoped to just the module that's actually being submitted (its
        // own question range) for a full test — falls back to the whole
        // session for non-module sessions, where this gate is only ever
        // reached via the dev-only demo button.
        const gateStart = currentModuleRange?.start ?? 1;
        const gateEnd = currentModuleRange?.end ?? TOTAL_Q;
        const gateTotal = gateEnd - gateStart + 1;
        let gateAnswered = 0;
        let gateFlagged = 0;
        for (let pos = gateStart; pos <= gateEnd; pos++) {
          if (answeredPositions.has(pos)) gateAnswered++;
          if (flaggedPositions.has(pos)) gateFlagged++;
        }
        return (
        <div className="gate-view open">
          <h2>Review before you submit this module</h2>
          <p className="gsub">You can still go back and change any answer. Once you submit, this module is final.</p>
          <div className="gate-summary">
            <div className="gstat">
              <p className="gnum">{gateAnswered}</p>
              <p className="glabel">Answered</p>
            </div>
            <div className="gstat">
              <p className="gnum warn">{gateTotal - gateAnswered}</p>
              <p className="glabel">Unanswered</p>
            </div>
            <div className="gstat">
              <p className="gnum">{gateFlagged}</p>
              <p className="glabel">Flagged</p>
            </div>
          </div>
          <div className="gate-grid">
            {Array.from({ length: gateTotal }, (_, i) => gateStart + i).map((pos) => (
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
            <button className="btn ghost" onClick={gateBack} disabled={moduleBusy}>
              ← Back to test
            </button>
            <button className="btn primary" style={{ margin: 0 }} onClick={() => void gateSubmit()} disabled={moduleBusy}>
              {moduleBusy ? 'Submitting…' : 'Submit module'}
            </button>
          </div>
        </div>
        );
      })()}

      {view === 'break' && (
        <div className="break-view open">
          <div className="bicon">☕</div>
          <h2>Break</h2>
          <p>Reading &amp; Writing is complete. Math starts after this break.</p>
          <p className="btime mono">{fmt(Math.max(breakSeconds, 0))}</p>
          <button className="btn primary" onClick={() => void continueFromBreak()} disabled={moduleBusy}>
            {moduleBusy ? 'Starting Math…' : 'Continue now →'}
          </button>
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
