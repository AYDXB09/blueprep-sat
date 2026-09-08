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
  normalizeStoredHighlights,
  saveAttemptHighlights,
  saveAttemptStruckChoices,
  startQuestionAttempt,
  submitQuestionAttempt,
  MATH_MODULE_QUESTION_COUNT,
  MATH_MODULE_SECONDS,
  RW_MODULE_QUESTION_COUNT,
  RW_MODULE_SECONDS,
  type AttemptHighlights,
  type AttemptWithQuestion,
  type CueWithCategory,
  type HighlightColor,
  type HighlightUnderline,
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


// Where to place the highlight popover (position: fixed) for a given anchor
// rect. Settings' "Large" font size applies `zoom: 1.15` to :root, which
// scales a positioned element's own top/left when the browser renders it —
// so getBoundingClientRect() reads back ~15% larger than the `top`/`left` we
// set. Without dividing by the zoom here, the popover lands ~15% of its
// y-coordinate too low (≈100px down a full passage), sitting over unrelated
// text and making its small buttons unhittable — the actual "the underline
// does not work" report (the user had Large font on; the buttons were just
// somewhere else). `getComputedStyle(...).zoom` is "1"/"normal" at default
// size, "1.15" at Large.
function popoverPos(rect: DOMRect): { top: number; left: number } {
  const raw = getComputedStyle(document.documentElement).zoom;
  const zoom = Number.isFinite(parseFloat(raw)) && parseFloat(raw) > 0 ? parseFloat(raw) : 1;
  return {
    top: (rect.top - 54) / zoom,
    left: (rect.left + rect.width / 2 - 110) / zoom,
  };
}

// Finds the nearest BLOCK-level ancestor (paragraph, list item, table cell,
// etc.) of a node — walking up PAST inline elements like <mark>/<b>/<span>,
// so two points on either side of an inline tag boundary still count as
// "the same block." Used to reject a selection that spans two DIFFERENT
// blocks: the length cap in onSelectableMouseUp only catches implausibly
// LONG selections, but a selection that jumps from an earlier paragraph to
// a later one can still be short in characters if the earlier paragraph is
// short too — this catches that case regardless of length. A genuine
// "highlight a few words" selection is, without exception, entirely inside
// one paragraph or one list item.
function closestBlock(node: Node): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('p, li, td, th, blockquote, figcaption, dd, dt') ?? null;
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
 * never a crash.
 *
 * Used by cue marks (`cues.anchor_text` / `occurrence` come from the DB in
 * exactly this shape) and as the FALLBACK locator for user highlights saved
 * before the offset model existed. New user highlights use `applyOffsetMark`
 * instead — text search here can land on the wrong occurrence when the phrase
 * recurs, which is a non-issue for offsets.
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

  // Real bug found live, 2026-08-11 (generalized 2026-08-13 from <li>-only
  // to any block boundary — see closestBlock's doc comment): a match
  // spanning across block-element boundaries — e.g. a selection that drags
  // from one bullet/paragraph into the next — reached
  // range.surroundContents() below, which can partially mutate this shared
  // detached container before it throws on a malformed range. Since every
  // mark in a withAllMarks() pass walks the SAME container in sequence,
  // one such partial mutation silently shifted or corrupted the text-node
  // offsets for every mark applied after it in the same pass — symptoms
  // reported live: a highlight rendering several words offset from the
  // real selection, other marks (including underlines) vanishing
  // outright, and on the capture side, "highlight a few words" landing on
  // an entirely different, earlier paragraph. A <mark> can't legally wrap
  // sibling block elements anyway, so this is refused up front rather than
  // attempted. This is defense-in-depth for data saved before the matching
  // capture-time check existed — the capture path should already prevent
  // this from ever being saved for new highlights.
  if (closestBlock(startPos.node) !== closestBlock(endPos.node)) {
    console.warn(`[${logTag}] anchor spans multiple blocks — skipping to avoid corrupting the shared render pass: "${anchorText}"`);
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

/**
 * The cue `<mark>` pass, as a STRING transform on a detached container.
 *
 * User highlights are NOT applied here — they're stored per scope as the
 * scope's own HTML with the student's `<mark>`s already baked in (V1's
 * model, see `AttemptHighlights`), and THAT string is what this runs on top
 * of. So the render for a scope is `withCueMarks(storedUserHtml ?? rawMarkup,
 * cues)`: the student's marks are literal, and only the cue layer is
 * recomputed each render (cues are few per question and change only when
 * feedback is revealed).
 *
 * The string transform (not a live-DOM mutation) is still required because
 * React resets a `dangerouslySetInnerHTML` node's innerHTML to its declared
 * prop value on any re-render — so cue marks have to be part of the string
 * React renders, not bolted on after.
 */
function withCueMarks(html: string, cues: CueWithCategory[]): string {
  if (!html || cues.length === 0) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  for (const cue of cues) applyCueHighlight(container, cue);
  return container.innerHTML;
}

/** Parse `html`, run `mutate` on the container, return the new innerHTML. */
function editHtml(html: string, mutate: (root: HTMLElement) => void): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  mutate(root);
  return root.innerHTML;
}

/**
 * Wraps exactly the text of `range` in `<mark>` elements — one per text node
 * the range touches, all sharing the same `data-hl-id`. Unlike
 * `range.surroundContents`, this NEVER throws when the selection crosses an
 * inline element (`<b>`, `<sup>`, a cue `<mark>`) or a paragraph boundary —
 * it just wraps each segment. Returns the id, or null if the range held no
 * real text. Mutates the live DOM.
 */
function wrapRangeInMarks(range: Range, id: string, buildMark: () => HTMLElement): string | null {
  const sc = range.startContainer;
  const so = range.startOffset;
  const ec = range.endContainer;
  const eo = range.endOffset;
  const anc = range.commonAncestorContainer;
  const rootEl = (anc.nodeType === Node.TEXT_NODE ? anc.parentElement : (anc as Element)) as HTMLElement | null;
  if (!rootEl) return null;

  const targets: { node: Text; s: number; e: number }[] = [];
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = (t.nodeValue ?? '').length;
    if (len === 0) continue;
    const nr = document.createRange();
    nr.selectNodeContents(t);
    // Real overlap only — NOT Range.intersectsNode, which reports a node whose
    // start equals the selection's end as "intersecting", so a few-word
    // selection ending at a text-node boundary would swallow the whole next
    // node ("highlights large sentences"). compareBoundaryPoints has clean
    // "touching ≠ overlapping" semantics.
    if (range.compareBoundaryPoints(Range.START_TO_END, nr) <= 0) continue; // range ends at/before node start
    if (range.compareBoundaryPoints(Range.END_TO_START, nr) >= 0) continue; // range starts at/after node end
    const s = t === sc ? so : 0;
    const e = t === ec ? eo : len;
    if (s >= e) continue;
    if (!/\S/.test((t.nodeValue ?? '').slice(s, e))) continue; // whitespace-only edge segment
    targets.push({ node: t, s, e });
  }
  if (targets.length === 0) return null;

  for (const { node: t0, s, e } of targets) {
    let t = t0;
    if (e < (t.nodeValue ?? '').length) t.splitText(e); // t keeps [0, e)
    if (s > 0) t = t.splitText(s); // t becomes [s, e)
    const mark = buildMark();
    t.parentNode?.insertBefore(mark, t);
    mark.appendChild(t);
  }
  return id;
}

/** Unwrap every cue `<mark>` (they only ever wrap plain text) and re-merge
 * the split text nodes — used to recover the user-only layer from a string
 * that has had the cue pass applied. */
function stripCueMarks(root: HTMLElement): void {
  root.querySelectorAll('mark.cue-mark').forEach((m) => {
    m.replaceWith(...Array.from(m.childNodes));
  });
  root.normalize();
}

/** The class list of the user `<mark data-hl-id={id}>` across all scopes, or
 * null if not found — drives the popover's active colour/underline state. */
function findMarkClasses(highlights: AttemptHighlights, id: string): string[] | null {
  for (const html of Object.values(highlights)) {
    if (!html.includes(`data-hl-id="${id}"`)) continue;
    const root = document.createElement('div');
    root.innerHTML = html;
    const m = root.querySelector(`mark[data-hl-id="${id}"]`);
    if (m) return m.className.split(/\s+/).filter(Boolean);
  }
  return null;
}

const HL_COLORS: HighlightColor[] = ['yellow', 'blue', 'pink'];
const HL_UNDERLINES: Exclude<HighlightUnderline, 'none'>[] = ['solid', 'dashed', 'dotted'];

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

  const deleteNote = useCallback(async () => {
    if (!user || !questionId) return;
    setNoteSaving(true);
    try {
      await saveNote(user.id, questionId, ''); // empty string deletes the row
      setNote(null);
      setNoteDraft('');
      setNoteEditing(false);
    } catch (err) {
      console.warn('deleteNote failed:', err);
    } finally {
      setNoteSaving(false);
    }
  }, [user, questionId]);

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
    // Drop any staged-but-never-committed highlight left in stored HTML (e.g.
    // navigated away with the popover open) — it has no colour, only a dashed
    // outline, so it should never survive the question load.
    const loadedHl = normalizeStoredHighlights(existingAttempt?.highlights);
    const cleanedHl: AttemptHighlights = {};
    for (const [k, v] of Object.entries(loadedHl)) {
      if (!v.includes('user-hl-pending')) {
        cleanedHl[k] = v;
        continue;
      }
      const stripped = editHtml(v, (root) => {
        root.querySelectorAll('mark.user-hl-pending').forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
        root.normalize();
      });
      if (/data-hl-id=/.test(stripped)) cleanedHl[k] = stripped;
    }
    pendingHlIdRef.current = null;
    setScopeHl(cleanedHl);
    setHlEditingId(null);
    setHlPopoverOpen(false);
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
  // Student highlights, V1's model: per scope, that scope's HTML with the
  // student's <mark>s baked in (see AttemptHighlights). `scopeHlRef` mirrors
  // it so a handler firing later in the same tick (recolour then underline)
  // reads the just-updated value.
  const [scopeHl, setScopeHl] = useState<AttemptHighlights>({});
  const scopeHlRef = useRef<AttemptHighlights>({});
  useEffect(() => {
    scopeHlRef.current = scopeHl;
  }, [scopeHl]);
  // Last colour the student picked — new highlights use it, so a drag makes a
  // highlight immediately (like V1) instead of forcing a popover round-trip.
  const lastColorRef = useRef<HighlightColor>('yellow');
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
  // De-dupes concurrent callers (picking a colour then an underline fires two
  // ensureMarkAttemptId calls in the same tick) so they don't each create a
  // separate attempt row and then race their saves — which is how an
  // underline could survive in the UI but be missing after a reload.
  const markAttemptPromiseRef = useRef<Promise<string | null> | null>(null);
  const ensureMarkAttemptId = useCallback((): Promise<string | null> => {
    if (currentAttemptId) return Promise.resolve(currentAttemptId);
    const existing = attempts.find((a) => a.question_id === questionId);
    if (existing) {
      setCurrentAttemptId(existing.id);
      return Promise.resolve(existing.id);
    }
    if (!user || !sessionId || !questionId) return Promise.resolve(null);
    if (markAttemptPromiseRef.current) return markAttemptPromiseRef.current;
    const p = startQuestionAttempt({ userId: user.id, sessionId, questionId, attemptNumber: 1 })
      .then((row) => {
        setCurrentAttemptId(row.id);
        return row.id;
      })
      .catch((err) => {
        console.warn('ensureMarkAttemptId failed:', err);
        return null;
      })
      .finally(() => {
        markAttemptPromiseRef.current = null;
      });
    markAttemptPromiseRef.current = p;
    return p;
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

  // Single write path for the highlight set: update the ref synchronously (so
  // a handler firing later in the same tick sees it), update state, and
  // persist. Saves run through a serial promise chain, each link writing the
  // LATEST ref value — two saves a microtask apart (recolour then underline)
  // are separate PATCHes to one row and, unserialised, the last to *arrive*
  // wins rather than the last *sent*, dropping the underline on reload.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const commitScopeHl = useCallback(
    (next: AttemptHighlights) => {
      scopeHlRef.current = next;
      setScopeHl(next);
      saveChainRef.current = saveChainRef.current
        .catch(() => {})
        .then(async () => {
          const id = await ensureMarkAttemptId();
          if (!id) return;
          await saveAttemptHighlights(id, scopeHlRef.current).catch((err) =>
            console.warn('saveAttemptHighlights failed:', err),
          );
        });
    },
    [ensureMarkAttemptId],
  );

  // Set (or, with null, clear) one scope's marked-up HTML.
  const setScopeMarkedHtml = useCallback(
    (scope: string, html: string | null) => {
      const next = { ...scopeHlRef.current };
      if (html == null || !/data-hl-id=/.test(html)) delete next[scope];
      else next[scope] = html;
      commitScopeHl(next);
    },
    [commitScopeHl],
  );

  // Find the scope holding this id and run `mutate` on EVERY <mark> segment
  // that carries it (a selection crossing inline markup is wrapped as several
  // segments sharing one id). `mutate` returning false unwraps them.
  const editMark = useCallback(
    (id: string, mutate: (mark: HTMLElement) => boolean) => {
      for (const [scope, html] of Object.entries(scopeHlRef.current)) {
        if (!html.includes(`data-hl-id="${id}"`)) continue;
        const nextHtml = editHtml(html, (root) => {
          const segs = [...root.querySelectorAll(`mark[data-hl-id="${id}"]`)] as HTMLElement[];
          if (segs.length === 0) return;
          let unwrap = false;
          for (const m of segs) if (mutate(m) === false) unwrap = true;
          if (unwrap) {
            for (const m of segs) m.replaceWith(...Array.from(m.childNodes));
          }
          root.normalize();
        });
        setScopeMarkedHtml(scope, nextHtml);
        return;
      }
    },
    [setScopeMarkedHtml],
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

  // ---------------- highlighter (V1's model) ----------------
  // On mouseup with a selection: wrap each touched text segment in a <mark>
  // RIGHT THERE in the live DOM, read the scope's new innerHTML, strip the
  // cue layer back off, and store the user layer as a string. The stored
  // string is rendered straight back via dangerouslySetInnerHTML — storage
  // IS the render output, so nothing can desync.
  //
  // A fresh selection is STAGED (class `user-hl-pending`, dashed outline, no
  // colour) — the popover opens and the student picks a colour to commit it,
  // or an underline first, or clicks away to discard. This matches Bluebook
  // (select → choose) rather than auto-applying a colour.
  const stimulusRef = useRef<HTMLDivElement | null>(null);
  const hlPopoverRef = useRef<HTMLDivElement | null>(null);
  const [hlPopoverOpen, setHlPopoverOpen] = useState(false);
  const [hlPopoverPos, setHlPopoverPos] = useState({ top: 0, left: 0 });
  // The mark whose popover is open (a staged one or an existing one).
  const [hlEditingId, setHlEditingId] = useState<string | null>(null);
  // The staged-but-not-committed highlight's id, if any.
  const pendingHlIdRef = useRef<string | null>(null);
  const [uMenuOpen, setUMenuOpen] = useState(false);
  useEffect(() => {
    if (!hlPopoverOpen) setUMenuOpen(false);
  }, [hlPopoverOpen]);

  // Unwrap a staged highlight the student walked away from without choosing a
  // colour. `editMark` finds all its segments by id and removes them.
  const discardPending = useCallback(() => {
    const pid = pendingHlIdRef.current;
    if (!pid) return;
    pendingHlIdRef.current = null;
    editMark(pid, () => false);
  }, [editMark]);

  const openMarkPopover = useCallback((markEl: HTMLElement) => {
    if (!markEl.dataset.hlId) return;
    setHlEditingId(markEl.dataset.hlId);
    setUMenuOpen(false);
    setHlPopoverPos(popoverPos(markEl.getBoundingClientRect()));
    setHlPopoverOpen(true);
  }, []);

  const onSelectableMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const sel = window.getSelection();

      // Plain click (no selection): open the popover if it landed on one of
      // the student's own marks; otherwise drop any staged highlight.
      if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
        const markEl = (e.target as HTMLElement).closest('mark.user-hl, mark.user-hl-pending') as HTMLElement | null;
        if (markEl && markEl.dataset.hlId !== pendingHlIdRef.current) {
          discardPending();
          openMarkPopover(markEl);
        } else if (!markEl) {
          discardPending();
        }
        return;
      }

      const range = sel.getRangeAt(0);
      const container = (
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement
      )?.closest('[data-hl-scope]') as HTMLElement | null;
      const scope = container?.getAttribute('data-hl-scope');
      if (!container || !scope || !container.contains(range.commonAncestorContainer)) {
        sel.removeAllRanges();
        return;
      }

      discardPending();
      const id = crypto.randomUUID();
      // Wrap each text segment the selection touches — never throws on inline
      // markup (a <b>, a cue mark) or a paragraph boundary. All segments share
      // the one data-hl-id.
      const wrapped = wrapRangeInMarks(range, id, () => {
        const m = document.createElement('mark');
        m.className = 'user-hl-pending';
        m.dataset.hlId = id;
        return m;
      });
      sel.removeAllRanges();
      if (!wrapped) return;
      pendingHlIdRef.current = id;

      setScopeMarkedHtml(scope, editHtml(container.innerHTML, stripCueMarks));

      const firstSeg = container.querySelector(`mark[data-hl-id="${id}"]`) as HTMLElement | null;
      if (firstSeg) openMarkPopover(firstSeg);
    },
    [openMarkPopover, discardPending, setScopeMarkedHtml],
  );

  const editingMarkClasses = useMemo(
    () => (hlEditingId ? findMarkClasses(scopeHl, hlEditingId) : null),
    [hlEditingId, scopeHl],
  );
  const editingColor = editingMarkClasses
    ?.map((c) => c.replace('user-hl-', ''))
    .find((c) => (HL_COLORS as string[]).includes(c)) as HighlightColor | undefined;
  const editingUnderline = ((editingMarkClasses?.find((c) => c.startsWith('user-hl-u-')) ?? '').replace(
    'user-hl-u-',
    '',
  ) || 'none') as HighlightUnderline;

  const applyHighlightColor = useCallback(
    (color: HighlightColor) => {
      const id = hlEditingId;
      if (!id) return;
      lastColorRef.current = color;
      if (pendingHlIdRef.current === id) pendingHlIdRef.current = null; // committed
      editMark(id, (m) => {
        const classes = new Set(m.className.split(/\s+/).filter(Boolean));
        classes.delete('user-hl-pending');
        HL_COLORS.forEach((c) => classes.delete(`user-hl-${c}`));
        classes.add('user-hl');
        classes.add(`user-hl-${color}`);
        m.className = [...classes].join(' ');
        return true;
      });
    },
    [hlEditingId, editMark],
  );

  const applyHighlightUnderline = useCallback(
    (underline: HighlightUnderline) => {
      const id = hlEditingId;
      if (!id) return;
      // Picking an underline COMMITS a staged highlight, same as picking a
      // colour — an underline-only mark (`user-hl` with no colour class = red
      // underline, no fill) is a valid highlight. Otherwise it stayed
      // `user-hl-pending` and the next click discarded it: "the underlines
      // are gone".
      const wasPending = pendingHlIdRef.current === id;
      if (wasPending && underline === 'none') {
        // staged mark with nothing chosen — drop it
        discardPending();
        setHlPopoverOpen(false);
        setHlEditingId(null);
        return;
      }
      if (wasPending) pendingHlIdRef.current = null;
      editMark(id, (m) => {
        const classes = new Set(m.className.split(/\s+/).filter(Boolean));
        HL_UNDERLINES.forEach((u) => classes.delete(`user-hl-u-${u}`));
        if (underline !== 'none') classes.add(`user-hl-u-${underline}`);
        if (wasPending) {
          classes.delete('user-hl-pending');
          classes.add('user-hl');
        }
        m.className = [...classes].join(' ');
        return true;
      });
    },
    [hlEditingId, editMark, discardPending],
  );

  const deleteEditingHighlight = useCallback(() => {
    const id = hlEditingId;
    if (!id) return;
    if (pendingHlIdRef.current === id) pendingHlIdRef.current = null;
    editMark(id, () => false); // returning false unwraps every segment
    setHlPopoverOpen(false);
    setHlEditingId(null);
  }, [hlEditingId, editMark]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!hlPopoverOpen) return;
      if (hlPopoverRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest('mark.user-hl, mark.user-hl-pending')) return; // its own mouseup handles it
      discardPending();
      setHlPopoverOpen(false);
      setHlEditingId(null);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [hlPopoverOpen, discardPending]);

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

  // Marked-up HTML per scope: the student's stored layer (their <mark>s baked
  // in) with the cue <mark> pass composed on top. Computed as a plain string
  // — dangerouslySetInnerHTML resets its node's innerHTML on every re-render,
  // so the marks have to be part of the string React renders.
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
    () =>
      question?.stimulus_markup
        ? withCueMarks(scopeHl['stimulus'] ?? question.stimulus_markup, stimulusCues)
        : '',
    [question?.stimulus_markup, scopeHl, stimulusCues],
  );
  const stemHtml = useMemo(
    () => (question?.stem_markup ? withCueMarks(scopeHl['stem'] ?? question.stem_markup, stemCues) : ''),
    [question?.stem_markup, scopeHl, stemCues],
  );
  const choiceHtmlById = useMemo(() => {
    const map = new Map<string, string>();
    if (!question) return map;
    for (const c of question.choices) {
      map.set(
        c.id,
        withCueMarks(scopeHl[`choice:${c.label}`] ?? c.content_markup, choiceCuesByChoiceId.get(c.id) ?? []),
      );
    }
    return map;
  }, [question, scopeHl, choiceCuesByChoiceId]);

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

  // Bluebook-style section title, derived from the session shape.
  const sectionTitle = useMemo(() => {
    const subj = question ? (isMath ? 'Math' : 'Reading and Writing') : '';
    if (isReviewMode) return subj ? `Reviewing · ${subj}` : 'Reviewing';
    if (isFullTest) {
      const m = currentModuleRange?.module;
      return subj ? `${subj}${m ? ` · Module ${m}` : ''}` : 'Full test';
    }
    const filter = session?.subject_filter;
    if (filter === 'Math') return 'Math practice';
    if (filter === 'Reading and Writing' || filter === 'R&W') return 'Reading and Writing practice';
    return subj ? `${subj} practice` : 'Practice';
  }, [question, isMath, isReviewMode, isFullTest, currentModuleRange, session?.subject_filter]);

  const studentName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email ||
    '';

  // Cross-out mode: while on, each choice shows its "cross out" control
  // (Bluebook gates it behind the ABC toggle). An already-crossed-out choice
  // always shows its Undo, regardless of the mode.
  const [crossOutMode, setCrossOutMode] = useState(false);
  // Hide the countdown (Bluebook lets you). The count-up question timer stays.
  const [timerHidden, setTimerHidden] = useState(false);

  // Resizable pane split — a plain 0..1 ratio (NOT pixels), so page zoom is a
  // non-issue: pointer clientX and the container rect are in the same space,
  // and flex-basis is a percentage.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [paneRatio, setPaneRatio] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('blueprep.paneRatio') ?? '');
      return Number.isFinite(v) && v >= 0.25 && v <= 0.75 ? v : 0.5;
    } catch {
      return 0.5;
    }
  });
  const draggingDivider = useRef(false);
  // Persist whenever the ratio settles — independent of pointerup firing
  // cleanly, so nothing about pointer capture can drop the saved value.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem('blueprep.paneRatio', String(paneRatio));
      } catch {
        /* private mode / storage disabled */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [paneRatio]);
  const onDividerDown = useCallback((e: React.PointerEvent) => {
    draggingDivider.current = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (synthetic event / edge case) — drag still works via the handlers */
    }
  }, []);
  const onDividerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingDivider.current || !contentRef.current) return;
    const r = contentRef.current.getBoundingClientRect();
    setPaneRatio(Math.min(0.75, Math.max(0.25, (e.clientX - r.left) / r.width)));
  }, []);
  const onDividerUp = useCallback((e: React.PointerEvent) => {
    draggingDivider.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* nothing captured */
    }
  }, []);

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
      {/* Bluebook-style header: section title left, timers centre, tools right.
          No progress bar / Directions / More / Highlights-and-Notes toggle. */}
      <div className="topbar">
        <div className="tb-left">
          <button className="iconbtn ghost-on-navy" title="Exit to Dashboard" aria-label="Exit to Dashboard" onClick={exitToDashboard}>
            ←
          </button>
          <div className="section-title">{sectionTitle}</div>
        </div>

        <div className="tb-center">
          {isReviewMode ? (
            <span className="tc-status">Reviewing</span>
          ) : hasSessionCountdown ? (
            <div className="tc-timer">
              {timerHidden ? (
                <button className="tc-toggle" onClick={() => setTimerHidden(false)}>Show time</button>
              ) : (
                <>
                  <span className={`tc-countdown mono${sessionLow ? ' low' : ''}${isOvertime ? ' over' : ''}`}>
                    {isOvertime ? `+${fmt(overtimeSeconds)}` : fmt(Math.max(sessionSeconds, 0))}
                  </span>
                  <button className="tc-toggle" onClick={() => setTimerHidden(true)}>Hide</button>
                </>
              )}
            </div>
          ) : (
            <span className="tc-status">Untimed</span>
          )}
          {showQuestionTimer && !isReviewMode && (
            <span className="tc-qtimer mono" title="Time on this question (counts up)">
              this question&nbsp;&nbsp;{fmt(qSeconds)}
            </span>
          )}
        </div>

        <div className="tb-right">
          {isMath && (
            <button className="iconbtn wide ghost-on-navy" title="Reference sheet" aria-label="Open reference sheet" onClick={() => setRefOpen(true)}>
              Reference
            </button>
          )}
          {isMath && (
            <button className="iconbtn wide ghost-on-navy" title="Desmos calculator" aria-label="Open Desmos" onClick={() => setCalcOpen((o) => !o)}>
              Calculator
            </button>
          )}
          {!isReviewMode && (
            <AskAiPanel
              isConnected={!!aiSettings}
              model={aiSettings?.model ?? null}
              questionContext={questionContextText}
              placement="below"
            />
          )}
          {!isReviewMode && (
            <button className="iconbtn ghost-on-navy" title="Pause" aria-label="Pause session" onClick={pause}>
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
        // A control's mousedown shouldn't count as clicking "outside" the mark.
        onMouseDown={(e) => e.preventDefault()}
      >
        {HL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`hl-swatch hl-swatch-${color}${editingColor === color ? ' active' : ''}`}
            aria-label={`${color} highlight`}
            onClick={() => {
              setUMenuOpen(false);
              applyHighlightColor(color);
            }}
          />
        ))}
        <span className="hl-sep" />
        <div className="hl-udrop">
          <button
            type="button"
            className={`hl-ubtn${editingUnderline !== 'none' ? ' has' : ''}`}
            aria-haspopup="menu"
            aria-expanded={uMenuOpen}
            title="Underline style"
            onClick={() => setUMenuOpen((o) => !o)}
          >
            <span className={`hl-ubtn-u hl-ubtn-u-${editingUnderline}`}>U</span>
            <span className="hl-ubtn-caret" aria-hidden="true">⌄</span>
          </button>
          {uMenuOpen && (
            <div className="hl-umenu" role="menu">
              {(['solid', 'dashed', 'dotted', 'none'] as HighlightUnderline[]).map((style) => (
                <button
                  key={style}
                  type="button"
                  role="menuitemradio"
                  aria-checked={editingUnderline === style}
                  className={`hl-umenu-item${editingUnderline === style ? ' on' : ''}`}
                  onClick={() => {
                    applyHighlightUnderline(style);
                    setUMenuOpen(false);
                  }}
                >
                  {style === 'none' ? (
                    <span className="hl-umenu-label">No underline</span>
                  ) : (
                    <span className={`hl-umenu-label hl-umenu-u-${style}`}>
                      {style[0].toUpperCase() + style.slice(1)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="hl-sep" />
        {hlEditingId && (
          <button type="button" className="hl-icon-btn" title="Remove this highlight" aria-label="Remove highlight" onClick={deleteEditingHighlight}>
            🗑
          </button>
        )}
        <button
          type="button"
          className="hl-icon-btn"
          title="Add a note to this question"
          aria-label="Add a note"
          onClick={() => {
            discardPending();
            setHlPopoverOpen(false);
            setHlEditingId(null);
            openNoteEditor();
            document.getElementById('note-panel-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          ✎
        </button>
      </div>

      {view === 'main' && (
        <>
          <div className="content" id="mainContent" ref={contentRef}>
            <div className="pane left" style={{ flexBasis: `${(paneRatio * 100).toFixed(2)}%` }}>
              {(cues.length > 0 || !question.is_active) && (
                <div className="qmeta">
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
              )}
              <div className="stimulus serif" ref={stimulusRef} onMouseUp={onSelectableMouseUp}>
                {question.stimulus_markup && (
                  // Trusted first-party content from our own `questions` table, not user
                  // input — stimulusHtml is that content with cue <mark> spans woven in
                  // as a string (see withCueMarks). data-hl-scope tags this block so a
                  // selection inside it anchors as a "stimulus" highlight, not "stem".
                  <div data-hl-scope="stimulus" dangerouslySetInnerHTML={{ __html: stimulusHtml }} />
                )}
                {/* eslint-disable-next-line react/no-danger */}
                <div data-hl-scope="stem" dangerouslySetInnerHTML={{ __html: stemHtml }} />
              </div>
            </div>

            <div
              className="pane-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
            >
              <span className="pane-divider-grip" />
            </div>

            <div className="pane right">
              <div className="qhead">
                <span className="qhead-num">{CURRENT_Q}</span>
                <button
                  type="button"
                  className={`qhead-mark${markedForReview ? ' on' : ''}`}
                  onClick={() => setMarkedForReview((m) => !m)}
                  aria-pressed={markedForReview}
                >
                  <span className="qhead-mark-ico" aria-hidden="true">{markedForReview ? '★' : '☆'}</span>
                  Mark for review
                </button>
                {question.response_type !== 'spr' && !isReviewMode && (
                  <button
                    type="button"
                    className={`qhead-abc${crossOutMode ? ' on' : ''}`}
                    onClick={() => setCrossOutMode((v) => !v)}
                    aria-pressed={crossOutMode}
                    title="Cross out answer choices you think are wrong"
                  >
                    <span className="abc-strike">ABC</span>
                  </button>
                )}
              </div>

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
                          // Clicking one's own highlight opens its edit popover
                          // (via onSelectableMouseUp) — don't also select the choice.
                          if ((e.target as HTMLElement).closest('mark.user-hl')) return;
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
                        {/* Bluebook-style per-choice cross-out. The "cross out"
                            control only shows while cross-out mode is on (the
                            ABC toggle in the question header); an already
                            crossed-out choice always shows its Undo so it can
                            be restored regardless of the mode. Real persisted
                            state — see toggleStruck / ensureMarkAttemptId. */}
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
                          (crossOutMode || isReviewMode) && (
                            <button
                              type="button"
                              className="strike-btn"
                              onClick={(e) => toggleStruck(c.id, e)}
                              title="Cross out this choice"
                              aria-label={`Cross out choice ${c.label}`}
                            >
                              <span className="strike-btn-letter">{c.label}</span>
                            </button>
                          )
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
                        {note && (
                          <button
                            className="btn ghost note-delete"
                            onClick={() => void deleteNote()}
                            disabled={noteSaving}
                          >
                            Delete
                          </button>
                        )}
                        <button className="btn ghost" onClick={cancelNoteEditor} disabled={noteSaving} style={{ marginLeft: 'auto' }}>
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

          {/* Bluebook-style footer: student name left, question navigator
              centre, prev/next right. Mark-for-review moved up to the
              question header. The navigator popover renders through
              AnchoredPortal (see that file's doc comment) since this bar's
              own overflow would otherwise clip an absolutely-positioned one. */}
          <div className="bottombar" id="mainBottombar">
            <span className="foot-name">{studentName}</span>
            <button
              ref={jumpBtnRef}
              className="nav-trigger-pill mono"
              onClick={(e) => {
                e.stopPropagation();
                setNavOpen((o) => !o);
              }}
            >
              Question {CURRENT_Q} of {TOTAL_Q} <span className="nav-trigger-caret">⌃</span>
            </button>
            <div className="foot-nav">
              <button className="btn ghost" onClick={goPrev} disabled={navBusy || CURRENT_Q <= 1}>
                ← Prev
              </button>
              <button className="btn primary" onClick={goNext} disabled={navBusy}>
                {CURRENT_Q >= TOTAL_Q ? (isReviewMode ? 'Back to Summary →' : 'Finish →') : 'Next →'}
              </button>
            </div>
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
