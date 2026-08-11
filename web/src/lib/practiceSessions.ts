import { supabase } from './supabase';
import type { Database, Json } from './database.types';

type PracticeSessionInsert = Database['public']['Tables']['practice_sessions']['Insert'];
type SessionModuleInsert = Database['public']['Tables']['session_modules']['Insert'];
type QuestionAttemptInsert = Database['public']['Tables']['question_attempts']['Insert'];
type QuestionAttemptUpdate = Database['public']['Tables']['question_attempts']['Update'];

/**
 * Data-access layer for practice sessions. Kept separate from the Player /
 * PracticeBuilder components so the UI port and the write-path can land
 * independently — components call these functions, they don't touch
 * `supabase` directly.
 *
 * All writes rely on RLS (auth.uid() = user_id) — never pass a user_id that
 * didn't come from the current session.
 */

// Exact values allowed by practice_sessions' CHECK constraints (verified live
// against the applied schema — do not add values here without also adding
// them to the DB constraint).
export type SessionMode = 'full_test' | 'practice_set' | 'ad_hoc' | 'retry_mistakes';
export type TimerMode = 'per_question' | 'session_only' | 'none';
export type TimerBasis = 'official_pace' | 'custom' | 'none';
export type FeedbackMode = 'immediate' | 'end_of_session';
export type SizePreset = 'quarter' | 'half' | 'module' | 'section';
export type SubjectFilter = 'Math' | 'Reading and Writing';

// Real TEST_BLUEPRINTS module pacing (index.html:1997-1998) — R&W module =
// 27q/32min, Math module = 22q/35min, same size/time whether it's Module 1
// (fixed mix) or Module 2 (tiered). Shared by FullTestSetup (assembling
// Module 1) and Player (assembling Modules 2-4 as the test progresses).
export const RW_MODULE_QUESTION_COUNT = 27;
export const MATH_MODULE_QUESTION_COUNT = 22;
export const RW_MODULE_SECONDS = 32 * 60;
export const MATH_MODULE_SECONDS = 35 * 60;

export interface CreateSessionArgs {
  userId: string;
  mode: SessionMode;
  questionIds: string[];
  requestedCount: number;
  timerMode: TimerMode;
  timerBasis: TimerBasis;
  feedbackMode: FeedbackMode;
  includeRetired: boolean;
  includeNewOnly?: boolean;
  excludePreviouslyCorrect?: boolean;
  subjectFilter?: SubjectFilter | null;
  domainFilter?: string[] | null;
  difficultyFilter?: string[] | null;
  sizePreset?: SizePreset | null;
  allottedSeconds?: number | null;
}

export async function createPracticeSession(args: CreateSessionArgs) {
  const insert: PracticeSessionInsert = {
    user_id: args.userId,
    mode: args.mode,
    question_ids: args.questionIds,
    requested_count: args.requestedCount,
    timer_mode: args.timerMode,
    timer_basis: args.timerBasis,
    feedback_mode: args.feedbackMode,
    include_retired: args.includeRetired,
    include_new_only: args.includeNewOnly ?? false,
    exclude_previously_correct: args.excludePreviouslyCorrect ?? false,
    subject_filter: args.subjectFilter ?? null,
    domain_filter: args.domainFilter ?? null,
    difficulty_filter: args.difficultyFilter ?? null,
    size_preset: args.sizePreset ?? null,
    allotted_seconds: args.allottedSeconds ?? null,
    started_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('practice_sessions')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createSessionModule(args: {
  sessionId: string;
  moduleNumber: number;
  subject: string;
  questionIds: string[];
  tier?: string | null;
}) {
  const insert: SessionModuleInsert = {
    session_id: args.sessionId,
    module_number: args.moduleNumber,
    subject: args.subject,
    question_ids: args.questionIds,
    tier: args.tier ?? null,
    started_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('session_modules').insert(insert).select().single();
  if (error) throw error;
  return data;
}

export type SessionModuleRow = Database['public']['Tables']['session_modules']['Row'];

/**
 * A full test's module rows for one session, ordered by module_number.
 * `module_number` is scoped per subject (DB CHECK restricts it to 1|2, and
 * (session_id, subject, module_number) is unique) — callers that need the
 * real R&W-M1 → R&W-M2 → Math-M1 → Math-M2 sequence must order by subject
 * too (see Player.tsx's MODULE_SEQUENCE), not by this column alone.
 */
export async function getSessionModules(sessionId: string): Promise<SessionModuleRow[]> {
  const { data, error } = await supabase
    .from('session_modules')
    .select('*')
    .eq('session_id', sessionId)
    .order('module_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Appends newly-assembled question ids to a live session's question list. */
export async function appendSessionQuestionIds(sessionId: string, newIds: string[]): Promise<void> {
  const { data: existing, error: fetchError } = await supabase
    .from('practice_sessions')
    .select('question_ids')
    .eq('id', sessionId)
    .single();
  if (fetchError) throw fetchError;
  const merged = [...(existing?.question_ids ?? []), ...newIds];
  const { error } = await supabase.from('practice_sessions').update({ question_ids: merged }).eq('id', sessionId);
  if (error) throw error;
}

/**
 * Re-seeds a live session's countdown basis to a newly-entered module's own
 * official pacing (Player's "seed sessionSeconds from session.allotted_seconds"
 * effect re-fires whenever the session reloads, so updating this here is
 * what actually resets the on-screen clock at each module transition).
 */
export async function updateSessionAllottedSeconds(sessionId: string, seconds: number): Promise<void> {
  const { error } = await supabase.from('practice_sessions').update({ allotted_seconds: seconds }).eq('id', sessionId);
  if (error) throw error;
}

/**
 * Module 1 → Module 2 tier cutoff. Uncalibrated placeholder — same
 * first-pass-guess status as `tier_difficulty_profiles` itself (see
 * CLAUDE.md's adaptive-threshold note: explicitly on hold pending real
 * multi-user usage data to calibrate against). >=60% correct routes to the
 * harder tier, matching the real exam's stronger-score-gets-harder-Module-2
 * shape without claiming to reverse-engineer the real cutoff.
 */
export function decideModuleTier(correct: number, total: number): 'tier1' | 'tier2' {
  if (total <= 0) return 'tier2';
  return correct / total >= 0.6 ? 'tier1' : 'tier2';
}

/**
 * Assembles and persists one full-test module: samples the question set
 * (difficulty-weighted + mistake-resurfacing-aware via
 * selectTieredQuestionIds), writes the session_modules row, appends the ids
 * to the live session, and re-seeds the session's timer basis to this
 * module's own official pacing. `tier` is the `tier_difficulty_profiles`
 * lookup key ('module1' for a fixed-mix Module 1, 'tier1'/'tier2' for an
 * adaptively-routed Module 2) — session_modules.tier itself only allows
 * 'tier1'/'tier2'/null (DB CHECK), so a 'module1' weighting key is stored as
 * tier: null there, matching "Module 1 has no adaptive tier" semantics.
 */
export async function assembleFullTestModule(args: {
  sessionId: string;
  subject: SubjectFilter;
  moduleNumber: 1 | 2;
  tier: 'module1' | 'tier1' | 'tier2';
  count: number;
  moduleSeconds: number;
  resurfaceForUserId?: string | null;
  mistakeResurfaceDays?: number | null;
  includeRetired?: boolean;
}): Promise<{ questionIds: string[] }> {
  const rawIds = await selectTieredQuestionIds({
    subject: args.subject,
    tier: args.tier,
    count: args.count,
    includeRetired: args.includeRetired ?? true,
    resurfaceForUserId: args.resurfaceForUserId,
    mistakeResurfaceDays: args.mistakeResurfaceDays,
  });
  // Real official R&W domain sequence (see orderByOfficialSequence) —
  // no-op for Math, which has no published fixed order.
  const questionIds = await orderByOfficialSequence(rawIds);
  await createSessionModule({
    sessionId: args.sessionId,
    moduleNumber: args.moduleNumber,
    subject: args.subject,
    questionIds,
    tier: args.tier === 'module1' ? null : args.tier,
  });
  await appendSessionQuestionIds(args.sessionId, questionIds);
  await updateSessionAllottedSeconds(args.sessionId, args.moduleSeconds);
  return { questionIds };
}

export async function completeSessionModule(
  moduleId: string,
  correctCount: number
) {
  const { error } = await supabase
    .from('session_modules')
    .update({ completed_at: new Date().toISOString(), correct_count: correctCount })
    .eq('id', moduleId);
  if (error) throw error;
}

export async function startQuestionAttempt(args: {
  userId: string;
  sessionId: string;
  questionId: string;
  attemptNumber: number;
}) {
  const insert: QuestionAttemptInsert = {
    user_id: args.userId,
    session_id: args.sessionId,
    question_id: args.questionId,
    attempt_number: args.attemptNumber,
    started_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('question_attempts').insert(insert).select().single();
  if (error) throw error;
  return data;
}

export async function submitQuestionAttempt(
  attemptId: string,
  args: {
    selectedChoiceId?: string | null;
    enteredValue?: string | null;
    isCorrect: boolean;
    timeTakenSeconds: number;
  }
) {
  const update: QuestionAttemptUpdate = {
    selected_choice_id: args.selectedChoiceId ?? null,
    entered_value: args.enteredValue ?? null,
    is_correct: args.isCorrect,
    time_taken_seconds: args.timeTakenSeconds,
    submitted_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('question_attempts').update(update).eq('id', attemptId);
  if (error) throw error;
}

/**
 * One highlight the student drew on a question's own content. Anchored by
 * `anchorText` + `occurrence` (which n-th match of that exact substring),
 * not raw character offsets — mirrors `cues.anchor_text`/`occurrence`
 * exactly, so both the system-drawn cue marks and these student-drawn
 * highlights can be re-applied to the same rendered text by one shared pass
 * (see `applyMarksToScope` in Player.tsx) instead of two incompatible
 * mechanisms.
 */
export interface HighlightMark {
  id: string;
  scope: 'stimulus' | 'stem' | `choice:${string}`;
  anchorText: string;
  occurrence: number;
  color: 'yellow' | 'blue' | 'pink';
  underline: 'none' | 'solid' | 'dashed' | 'dotted';
}

/** Persists this attempt's current highlight set. Called on every add/
 * edit/remove — small payload, no batching needed. */
export async function saveAttemptHighlights(attemptId: string, highlights: HighlightMark[]): Promise<void> {
  const { error } = await supabase
    .from('question_attempts')
    .update({ highlights: highlights as unknown as Json })
    .eq('id', attemptId);
  if (error) throw error;
}

/** Persists this attempt's current struck-choice set. Independent of
 * `selected_choice_id` — striking a choice never changes the answer. */
export async function saveAttemptStruckChoices(attemptId: string, struckChoiceIds: string[]): Promise<void> {
  const { error } = await supabase.from('question_attempts').update({ struck_choice_ids: struckChoiceIds }).eq('id', attemptId);
  if (error) throw error;
}

export async function completeSession(
  sessionId: string,
  args: { actualCount: number; overtimeSeconds?: number; scoreSummary?: Json }
) {
  const { error } = await supabase
    .from('practice_sessions')
    .update({
      completed_at: new Date().toISOString(),
      actual_count: args.actualCount,
      overtime_seconds: args.overtimeSeconds ?? 0,
      score_summary: args.scoreSummary ?? null,
    })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function getSession(sessionId: string) {
  const { data, error } = await supabase
    .from('practice_sessions')
    .select('*, session_modules(*), question_attempts(*)')
    .eq('id', sessionId)
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Read functions backing Dashboard / Progress / MistakeLog / SessionSummary /
// PracticeBuilder. Kept here alongside the write path per the existing
// "thin typed wrapper, no raw supabase calls in components" convention.
// ---------------------------------------------------------------------------

type PracticeSessionRow = Database['public']['Tables']['practice_sessions']['Row'];
type QuestionAttemptRow = Database['public']['Tables']['question_attempts']['Row'];
type QuestionRow = Database['public']['Tables']['questions']['Row'];

/** Most recent completed sessions for this user, newest first. */
export async function getRecentSessions(userId: string, limit: number): Promise<PracticeSessionRow[]> {
  const { data, error } = await supabase
    .from('practice_sessions')
    .select('*')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface AttemptWithQuestion extends QuestionAttemptRow {
  questions: Pick<QuestionRow, 'subject' | 'domain' | 'domain_code' | 'skill' | 'skill_code' | 'stem_markup' | 'difficulty'> | null;
}

/**
 * Every question_attempts row for this user across all sessions, joined to
 * the question's subject/domain/skill/difficulty for accuracy aggregation
 * (Progress's charts, the Skill map radars). Ordered oldest-first so callers
 * can compute streaks/trends by walking forward.
 */
export async function getAllAttemptsForUser(userId: string): Promise<AttemptWithQuestion[]> {
  const { data, error } = await supabase
    .from('question_attempts')
    .select('*, questions(subject, domain, domain_code, skill, skill_code, stem_markup, difficulty)')
    .eq('user_id', userId)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AttemptWithQuestion[];
}

/** One session plus every attempt in it, joined to question text/domain. */
export async function getSessionWithAttempts(sessionId: string): Promise<{
  session: PracticeSessionRow;
  attempts: AttemptWithQuestion[];
} | null> {
  const { data: session, error: sessionError } = await supabase
    .from('practice_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: attempts, error: attemptsError } = await supabase
    .from('question_attempts')
    .select('*, questions(subject, domain, domain_code, skill, skill_code, stem_markup)')
    .eq('session_id', sessionId)
    .order('attempt_number', { ascending: true });
  if (attemptsError) throw attemptsError;

  return { session, attempts: (attempts ?? []) as AttemptWithQuestion[] };
}

export interface MistakeHistoryEntry {
  date: string;
  mode: string;
}

export interface Mistake {
  questionId: string;
  sourceExternalId: string | null;
  subject: string;
  domain: string;
  skill: string | null;
  stemPreview: string;
  lastAttemptedAt: string;
  missCount: number;
  /** The session the most recent wrong attempt happened in — lets "Answer"
   * open that exact question in real review mode (pre-filled wrong answer,
   * rationale, cues) instead of forcing a fresh retake just to see the
   * explanation. Only usable if sessionCompleted (Player's review mode is
   * gated on practice_sessions.completed_at). */
  sessionId: string;
  sessionCompleted: boolean;
  positionInSession: number | null;
  /** Every wrong attempt on this question, newest first — date + which
   * session mode it happened in (ad-hoc, full test, retry, ...), for the
   * "missed Nx" expand in Mistake Log. */
  history: MistakeHistoryEntry[];
}

export interface MistakeFilters {
  subject?: SubjectFilter | null;
  domain?: string | null;
}

/**
 * Questions whose most recent attempt by this user was incorrect. Not scoped
 * to a session — mirrors user_settings.mistake_resurface_days intent (latest
 * attempt only, so a question later answered correctly drops off the list).
 */
export async function getMistakes(userId: string, filters: MistakeFilters = {}): Promise<Mistake[]> {
  const { data, error } = await supabase
    .from('question_attempts')
    .select('*, questions(subject, domain, stem_markup, skill, source_external_id), practice_sessions(completed_at, question_ids, mode)')
    .eq('user_id', userId)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });
  if (error) throw error;

  type MistakeAttemptRow = QuestionAttemptRow & {
    questions: Pick<QuestionRow, 'subject' | 'domain' | 'stem_markup' | 'skill' | 'source_external_id'> | null;
    practice_sessions: Pick<PracticeSessionRow, 'completed_at' | 'question_ids' | 'mode'> | null;
  };
  const rows = (data ?? []) as MistakeAttemptRow[];
  const latestByQuestion = new Map<string, MistakeAttemptRow>();
  for (const row of rows) {
    if (!latestByQuestion.has(row.question_id)) latestByQuestion.set(row.question_id, row);
  }

  const mistakes: Mistake[] = [];
  let missCounts: Map<string, number> | null = null;
  let historyByQuestion: Map<string, MistakeHistoryEntry[]> | null = null;
  for (const row of latestByQuestion.values()) {
    if (row.is_correct !== false || !row.questions || !row.session_id) continue;
    if (filters.subject && row.questions.subject !== filters.subject) continue;
    if (filters.domain && row.questions.domain !== filters.domain) continue;
    if (!missCounts || !historyByQuestion) {
      missCounts = new Map();
      historyByQuestion = new Map();
      for (const r of rows) {
        if (r.is_correct !== false) continue;
        missCounts.set(r.question_id, (missCounts.get(r.question_id) ?? 0) + 1);
        const entry: MistakeHistoryEntry = {
          date: r.submitted_at ?? r.created_at,
          mode: r.practice_sessions?.mode ?? 'unknown',
        };
        const arr = historyByQuestion.get(r.question_id) ?? [];
        arr.push(entry);
        historyByQuestion.set(r.question_id, arr);
      }
    }
    const session = row.practice_sessions;
    const position = session ? session.question_ids.indexOf(row.question_id) + 1 : 0;
    mistakes.push({
      questionId: row.question_id,
      sourceExternalId: row.questions.source_external_id,
      subject: row.questions.subject,
      domain: row.questions.domain,
      skill: row.questions.skill,
      stemPreview: stripHtmlPreview(row.questions.stem_markup),
      lastAttemptedAt: row.submitted_at ?? row.created_at,
      missCount: missCounts.get(row.question_id) ?? 1,
      sessionId: row.session_id,
      sessionCompleted: !!session?.completed_at,
      positionInSession: position > 0 ? position : null,
      history: historyByQuestion.get(row.question_id) ?? [],
    });
  }
  return mistakes;
}

export type ChoiceRow = Database['public']['Tables']['choices']['Row'];

export interface QuestionWithChoices extends QuestionRow {
  choices: ChoiceRow[];
}

/** One question plus its choices (ordered by label), for the Player. */
export async function getQuestionWithChoices(questionId: string): Promise<QuestionWithChoices | null> {
  const { data: question, error: questionError } = await supabase
    .from('questions')
    .select('*')
    .eq('id', questionId)
    .maybeSingle();
  if (questionError) throw questionError;
  if (!question) return null;

  const { data: choices, error: choicesError } = await supabase
    .from('choices')
    .select('*')
    .eq('question_id', questionId)
    .order('label', { ascending: true });
  if (choicesError) throw choicesError;

  return { ...question, choices: choices ?? [] };
}

/**
 * Numeric-equivalence check for grid-in (spr) answers — mirrors V1's
 * isCorrect()/normalizeNumber() in index.html. Accepts "3/4" style fractions
 * and tolerates up to 0.01 difference so a truncated-decimal accepted form
 * still matches an exact fraction entry (and vice versa).
 */
function normalizeNumber(value: string): number {
  const text = String(value || '').trim();
  if (text.includes('/')) {
    const [a, b] = text.split('/').map(Number);
    return b ? a / b : NaN;
  }
  const num = Number(text);
  return Number.isFinite(num) ? num : NaN;
}

export function isSprAnswerCorrect(enteredValue: string, acceptedAnswers: Json | null): boolean {
  const actual = normalizeNumber(enteredValue);
  if (!Number.isFinite(actual)) return false;
  const accepted = Array.isArray(acceptedAnswers) ? (acceptedAnswers as unknown[]) : [];
  if (accepted.length === 0) return false;
  return accepted.some((form) => {
    const expected = normalizeNumber(String(form));
    return Number.isFinite(expected) && Math.abs(expected - actual) <= 0.01;
  });
}

export type CueRow = Database['public']['Tables']['cues']['Row'];

export interface CueWithCategory extends CueRow {
  trap_categories: Pick<Database['public']['Tables']['trap_categories']['Row'], 'label' | 'description'> | null;
}

/**
 * All trap/cue rows for one question, joined to the trap category's real
 * display label (never render `trap_category`'s raw code). Ordered so
 * 'govern' cues surface first in any list UI — the correct-answer rationale
 * before the trap breakdown.
 */
export async function getCuesForQuestion(questionId: string): Promise<CueWithCategory[]> {
  const { data, error } = await supabase
    .from('cues')
    .select('*, trap_categories(label, description)')
    .eq('question_id', questionId)
    .order('cue_type', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CueWithCategory[];
}

/**
 * Which of the given question ids have any cues at all — used to render a
 * visible "has cue analysis" indicator wherever questions are listed
 * (Player's nav grid, Session Summary, Mistake Log), since otherwise there's
 * no way to tell which questions are worth opening before doing so.
 */
export async function getQuestionIdsWithCues(questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const { data, error } = await supabase.from('cues').select('question_id').in('question_id', questionIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.question_id));
}

function stripHtmlPreview(markup: string, maxLen = 100): string {
  const text = markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export interface QuestionFilters {
  subject?: SubjectFilter | null;
  domains?: string[] | null;
  skills?: string[] | null;
  difficulty?: string[] | null;
  includeRetired?: boolean;
  newOnlyUserId?: string | null;
  /**
   * Enables the mistake-resurfacing rule (see selectQuestionIds) — a missed
   * question is held back from selection until this user has exhausted the
   * other unseen/corrected questions at its same domain+difficulty, with
   * `mistakeResurfaceDaysById` (per-user `user_settings.mistake_resurface_days`)
   * acting as a fallback ceiling so a mistake doesn't wait forever in a large
   * pool. Independent of `newOnlyUserId` — that's a stricter "never attempted
   * at all" toggle; this is the default-case sequencing rule.
   */
  resurfaceForUserId?: string | null;
  mistakeResurfaceDays?: number | null;
}

async function questionIdsAlreadyAttempted(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('question_attempts').select('question_id').eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.question_id));
}

interface LatestAttemptStatus {
  isCorrect: boolean;
  submittedAt: string;
}

/**
 * This user's most-recent-attempt outcome per question, scoped to a given id
 * list — backs the mistake-resurfacing rule in selectQuestionIds. Only
 * submitted attempts count (an abandoned/never-submitted attempt shouldn't
 * mark a question as "seen").
 */
async function getLatestAttemptStatusForUser(
  userId: string,
  questionIds: string[]
): Promise<Map<string, LatestAttemptStatus>> {
  const result = new Map<string, LatestAttemptStatus>();
  if (questionIds.length === 0) return result;
  const { data, error } = await supabase
    .from('question_attempts')
    .select('question_id, is_correct, submitted_at')
    .eq('user_id', userId)
    .in('question_id', questionIds)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    // Sorted newest-first, so the first row seen per question is its latest.
    if (!result.has(row.question_id)) {
      result.set(row.question_id, { isCorrect: !!row.is_correct, submittedAt: row.submitted_at as string });
    }
  }
  return result;
}

/** Count of questions matching the builder's current filter set. */
export async function countMatchingQuestions(filters: QuestionFilters): Promise<number> {
  // An explicitly-empty (but non-null) skills array means "every sub-topic
  // for the selected domain(s) was deliberately deselected" — that's zero
  // matches by definition, not "no skill filter" (which is what a bare
  // `.in('skill', [])` query risks being read as, depending on the client
  // version — short-circuiting here is unambiguous either way).
  if (filters.skills && filters.skills.length === 0) return 0;
  let query = supabase.from('questions').select('id', { count: 'exact', head: true });
  if (filters.subject) query = query.eq('subject', filters.subject);
  if (filters.domains && filters.domains.length > 0) query = query.in('domain', filters.domains);
  if (filters.skills && filters.skills.length > 0) query = query.in('skill', filters.skills);
  if (filters.difficulty && filters.difficulty.length > 0) query = query.in('difficulty', filters.difficulty);
  if (!filters.includeRetired) query = query.eq('is_active', true);

  if (filters.newOnlyUserId) {
    const attempted = await questionIdsAlreadyAttempted(filters.newOnlyUserId);
    if (attempted.size === 0) {
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    }
    // Supabase JS has no NOT IN with a client-built set beyond a reasonable
    // size limit — fetch matching ids (with the SAME filters as `query`
    // above, not just subject/is_active) and subtract client-side instead.
    let idQuery = supabase.from('questions').select('id');
    if (filters.subject) idQuery = idQuery.eq('subject', filters.subject);
    if (filters.domains && filters.domains.length > 0) idQuery = idQuery.in('domain', filters.domains);
    if (filters.skills && filters.skills.length > 0) idQuery = idQuery.in('skill', filters.skills);
    if (filters.difficulty && filters.difficulty.length > 0) idQuery = idQuery.in('difficulty', filters.difficulty);
    if (!filters.includeRetired) idQuery = idQuery.eq('is_active', true);

    const { data, error } = await idQuery;
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.id).filter((id) => !attempted.has(id));
    return ids.length;
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Sample `count` question ids matching the filters, shuffled so the session
 * isn't front-loaded by insertion order. Fetches the full matching pool
 * client-side (question bank is small enough, ~3.2k rows total, and filtered
 * pools are far smaller) rather than relying on Postgres-side random ordering
 * through the JS client.
 */
function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const DEFAULT_MISTAKE_RESURFACE_DAYS = 14;

type PoolRow = { id: string; domain: string; difficulty: string | null };

/**
 * Sample `count` question ids matching the filters, shuffled so the session
 * isn't front-loaded by insertion order. Fetches the full matching pool
 * client-side (question bank is small enough, ~3.2k rows total, and filtered
 * pools are far smaller) rather than relying on Postgres-side random ordering
 * through the JS client.
 *
 * Mistake-resurfacing (`filters.resurfaceForUserId` set): a question whose
 * most recent attempt by this user was wrong is deprioritized until the
 * *other* unseen/corrected questions at its same domain+difficulty are
 * exhausted — real spaced sequencing, not a flat day-based cooldown. The
 * fallback ceiling (`mistakeResurfaceDays`, default 14) still resurfaces a
 * miss once that many days have passed even if its bucket isn't exhausted,
 * so a mistake in a huge pool doesn't wait forever.
 */
export async function selectQuestionIds(filters: QuestionFilters, count: number): Promise<string[]> {
  // Same "explicit empty skills array = zero matches, not no-filter" rule
  // as countMatchingQuestions above.
  if (filters.skills && filters.skills.length === 0) return [];
  let query = supabase.from('questions').select('id, domain, skill, difficulty');
  if (filters.subject) query = query.eq('subject', filters.subject);
  if (filters.domains && filters.domains.length > 0) query = query.in('domain', filters.domains);
  if (filters.skills && filters.skills.length > 0) query = query.in('skill', filters.skills);
  if (filters.difficulty && filters.difficulty.length > 0) query = query.in('difficulty', filters.difficulty);
  if (!filters.includeRetired) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;
  let pool: PoolRow[] = (data ?? []) as PoolRow[];

  if (filters.newOnlyUserId) {
    const attempted = await questionIdsAlreadyAttempted(filters.newOnlyUserId);
    pool = pool.filter((r) => !attempted.has(r.id));
  }

  if (!filters.resurfaceForUserId) {
    return shuffle(pool.map((r) => r.id)).slice(0, count);
  }

  // Mistake-resurfacing path: bucket by domain+difficulty (the "same
  // difficulty and topic" scope), split each bucket into fresh vs. missed,
  // and only let a missed question in once its own bucket's fresh supply is
  // gone (or the day ceiling has passed).
  const statusByQuestion = await getLatestAttemptStatusForUser(
    filters.resurfaceForUserId,
    pool.map((r) => r.id)
  );
  const ceilingDays = filters.mistakeResurfaceDays ?? DEFAULT_MISTAKE_RESURFACE_DAYS;
  const now = Date.now();
  const daysSince = (iso: string) => (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);

  const bucketKey = (r: PoolRow) => `${r.domain}|${r.difficulty ?? ''}`;
  const freshByBucket = new Map<string, PoolRow[]>();
  const missed: { row: PoolRow; submittedAt: string }[] = [];

  for (const row of pool) {
    const status = statusByQuestion.get(row.id);
    if (!status || status.isCorrect) {
      const key = bucketKey(row);
      const list = freshByBucket.get(key) ?? [];
      list.push(row);
      freshByBucket.set(key, list);
    } else {
      missed.push({ row, submittedAt: status.submittedAt });
    }
  }

  const bucketExhausted = (row: PoolRow) => (freshByBucket.get(bucketKey(row))?.length ?? 0) === 0;

  // Oldest-missed-first, so once a bucket empties out (or the ceiling hits)
  // the longest-waiting mistakes resurface before more recent ones.
  missed.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  const eligibleMissed = missed.filter(
    (m) => bucketExhausted(m.row) || daysSince(m.submittedAt) >= ceilingDays
  );
  const notYetEligibleMissed = missed.filter((m) => !eligibleMissed.includes(m));

  const fresh = shuffle(Array.from(freshByBucket.values()).flat());
  let candidates = fresh.concat(eligibleMissed.map((m) => m.row));

  // Not enough to fill the request even counting eligible mistakes — fall
  // back to the still-waiting ones (oldest first) rather than short the
  // session, since a session that can't be built is worse than an early
  // resurface.
  if (candidates.length < count) {
    candidates = candidates.concat(notYetEligibleMistakesRows(notYetEligibleMissed, count - candidates.length));
  }

  return shuffle(candidates)
    .map((r) => r.id)
    .slice(0, count);
}

function notYetEligibleMistakesRows(
  entries: { row: PoolRow; submittedAt: string }[],
  needed: number
): PoolRow[] {
  return entries.slice(0, needed).map((e) => e.row);
}

type TierDifficultyProfile = Database['public']['Tables']['tier_difficulty_profiles']['Row'];

/**
 * `tier_difficulty_profiles` row for a given tier ('module1' | 'tier1' |
 * 'tier2') — the (uncalibrated, first-pass — see CLAUDE.md's adaptive-
 * threshold note) easy/medium/hard sampling weights.
 */
async function getTierDifficultyProfile(tier: string): Promise<TierDifficultyProfile | null> {
  const { data, error } = await supabase.from('tier_difficulty_profiles').select('*').eq('tier', tier).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Splits `count` across Easy/Medium/Hard using *_pct weights (rounded, with
 * any rounding remainder absorbed by Medium so the total always matches
 * `count` exactly). Shared by the difficulty-only split below and the
 * domain x difficulty grid in `selectTieredQuestionIds`.
 */
function splitByDifficulty(
  weights: { Easy: number; Medium: number; Hard: number },
  count: number
): [string, number][] {
  const totalWeight = weights.Easy + weights.Medium + weights.Hard || 1;
  const easyCount = Math.round((weights.Easy / totalWeight) * count);
  const hardCount = Math.round((weights.Hard / totalWeight) * count);
  const mediumCount = Math.max(0, count - easyCount - hardCount);
  return [
    ['Easy', easyCount],
    ['Medium', mediumCount],
    ['Hard', hardCount],
  ];
}

/**
 * Real official per-domain operational question-share, from College Board's
 * "Assessment Framework for the Digital SAT Suite" (Tables 10 & 16 —
 * ≈26/28/20/26% R&W, ≈35/32.5/20/12.5% Math). Applied identically to both
 * modules of a subject (the framework documents these as a whole-section
 * share and — per Table 9 — the same domain *order* recurs in both modules,
 * so splitting the section share evenly across the two modules is the
 * closest defensible per-module target without inventing a number College
 * Board doesn't publish). Percentages sum to 100 within each subject.
 */
const DOMAIN_WEIGHTS: Record<SubjectFilter, Record<string, number>> = {
  'Reading and Writing': {
    'Craft and Structure': 28,
    'Information and Ideas': 26,
    'Standard English Conventions': 26,
    'Expression of Ideas': 20,
  },
  Math: {
    Algebra: 35,
    'Advanced Math': 32.5,
    'Problem-Solving and Data Analysis': 20,
    'Geometry and Trigonometry': 12.5,
  },
};

/**
 * Assembles one subject's question set for a given tier (Module 1's fixed
 * mix, or a Module 2 tier): weighted by domain per `DOMAIN_WEIGHTS` (real
 * official operational shares) and, within each domain, by difficulty per
 * `tier_difficulty_profiles` (module1 is real/calibrated — see the
 * `calibrate_module1_difficulty_from_official_data` migration; tier1/tier2
 * remain uncalibrated placeholders, see CLAUDE.md), mistake-resurfacing-aware
 * throughout via `selectQuestionIds`. Domain counts are rounded with any
 * remainder absorbed by the largest-share domain so the total always equals
 * `count` exactly; each domain's own count is then split across Easy/Medium/
 * Hard the same way. Sampling stays scoped to real domain+difficulty buckets
 * (rather than one flat unscoped pull) so the resurfacing rule and the real
 * bank's shape both stay meaningful per bucket, not blurred across the whole
 * subject.
 */
export async function selectTieredQuestionIds(args: {
  subject: SubjectFilter;
  tier: string;
  count: number;
  includeRetired?: boolean;
  resurfaceForUserId?: string | null;
  mistakeResurfaceDays?: number | null;
}): Promise<string[]> {
  const profile = await getTierDifficultyProfile(args.tier);
  // No profile row for this tier (shouldn't happen against the live schema,
  // but don't hard-fail a test start over it) — fall back to an even split.
  const diffWeights = profile
    ? { Easy: profile.easy_pct, Medium: profile.medium_pct, Hard: profile.hard_pct }
    : { Easy: 33, Medium: 34, Hard: 33 };

  const domainWeights = DOMAIN_WEIGHTS[args.subject];
  const domains = Object.keys(domainWeights);
  const totalDomainWeight = domains.reduce((sum, d) => sum + domainWeights[d], 0) || 1;

  // Round each domain's share, then hand any drift from rounding to the
  // largest-share domain so counts always sum to `count` exactly.
  const rawDomainCounts = domains.map((d) => (domainWeights[d] / totalDomainWeight) * args.count);
  const roundedDomainCounts = rawDomainCounts.map((n) => Math.round(n));
  const drift = args.count - roundedDomainCounts.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    const largestIdx = domains.reduce((best, _, i) => (domainWeights[domains[i]] > domainWeights[domains[best]] ? i : best), 0);
    roundedDomainCounts[largestIdx] += drift;
  }

  const ids: string[] = [];
  for (let i = 0; i < domains.length; i++) {
    const domainCount = roundedDomainCounts[i];
    if (domainCount <= 0) continue;
    for (const [difficulty, bandCount] of splitByDifficulty(diffWeights, domainCount)) {
      if (bandCount <= 0) continue;
      ids.push(
        ...(await selectQuestionIds(
          {
            subject: args.subject,
            domains: [domains[i]],
            difficulty: [difficulty],
            includeRetired: args.includeRetired ?? true,
            resurfaceForUserId: args.resurfaceForUserId,
            mistakeResurfaceDays: args.mistakeResurfaceDays,
          },
          bandCount
        ))
      );
    }
  }
  return ids;
}

/**
 * Same behavior as `selectQuestionIds`, except when the caller hasn't
 * specified a difficulty filter — in that case, instead of pulling the
 * unweighted pool (every difficulty equally likely regardless of the real
 * bank's shape), it splits `count` across Easy/Medium/Hard using the same
 * `tier_difficulty_profiles.module1` weights Full Test's Module 1 already
 * uses, so an ad-hoc set "defaults" to the same difficulty ratio a real
 * test module would rather than an arbitrary flat pull. If the caller *did*
 * specify a difficulty filter, that explicit choice is respected as-is —
 * this only fills in a sane default, it never overrides one.
 */
export async function selectQuestionIdsDefaultRatio(filters: QuestionFilters, count: number): Promise<string[]> {
  if (filters.difficulty && filters.difficulty.length > 0) {
    return selectQuestionIds(filters, count);
  }
  const profile = await getTierDifficultyProfile('module1');
  const weights = profile
    ? { Easy: profile.easy_pct, Medium: profile.medium_pct, Hard: profile.hard_pct }
    : { Easy: 33, Medium: 34, Hard: 33 };
  const totalWeight = weights.Easy + weights.Medium + weights.Hard || 1;

  const easyCount = Math.round((weights.Easy / totalWeight) * count);
  const hardCount = Math.round((weights.Hard / totalWeight) * count);
  const mediumCount = Math.max(0, count - easyCount - hardCount);

  const ids: string[] = [];
  for (const [difficulty, bandCount] of [
    ['Easy', easyCount],
    ['Medium', mediumCount],
    ['Hard', hardCount],
  ] as [string, number][]) {
    if (bandCount <= 0) continue;
    ids.push(...(await selectQuestionIds({ ...filters, difficulty: [difficulty] }, bandCount)));
  }
  return ids;
}

/**
 * Real official domain sequence within an R&W module — verified against
 * College Board's own "Assessment Framework for the Digital SAT Suite"
 * (Table 9, "Reading and Writing Section Question Sequence"; both modules
 * follow the same order): Craft and Structure -> Information and Ideas ->
 * Standard English Conventions -> Expression of Ideas. Math has no
 * equivalent published sequence in that document — Math domains are left in
 * whatever order they were selected/shuffled in.
 */
const RW_DOMAIN_SEQUENCE: Record<string, number> = {
  'Craft and Structure': 0,
  'Information and Ideas': 1,
  'Standard English Conventions': 2,
  'Expression of Ideas': 3,
};

/**
 * Reorders an already-selected id list so any R&W questions in it fall into
 * the real official domain sequence above, stably preserving the existing
 * (already-shuffled) relative order within each domain and leaving any
 * non-R&W (Math) ids exactly where they were. Safe to call on a
 * Math-only or mixed list — it's a no-op for domains it doesn't recognize.
 */
export async function orderByOfficialSequence(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids;
  const { data, error } = await supabase.from('questions').select('id, domain').in('id', ids);
  if (error) throw error;
  const domainById = new Map((data ?? []).map((r) => [r.id, r.domain as string]));
  // Array.prototype.sort is stable (guaranteed since ES2019), so ties (same
  // rank, including two non-R&W ids both at -1) keep their original relative
  // order — this only reshuffles the R&W ids among themselves into sequence.
  return ids
    .map((id) => ({ id, rank: RW_DOMAIN_SEQUENCE[domainById.get(id) ?? ''] ?? -1 }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.id);
}
