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
  questions: Pick<QuestionRow, 'subject' | 'domain' | 'domain_code' | 'skill' | 'skill_code' | 'stem_markup'> | null;
}

/**
 * Every question_attempts row for this user across all sessions, joined to
 * the question's subject/domain for accuracy aggregation. Ordered
 * oldest-first so callers can compute streaks/trends by walking forward.
 */
export async function getAllAttemptsForUser(userId: string): Promise<AttemptWithQuestion[]> {
  const { data, error } = await supabase
    .from('question_attempts')
    .select('*, questions(subject, domain, domain_code, skill, skill_code, stem_markup)')
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
}

async function questionIdsAlreadyAttempted(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('question_attempts').select('question_id').eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.question_id));
}

/** Count of questions matching the builder's current filter set. */
export async function countMatchingQuestions(filters: QuestionFilters): Promise<number> {
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
export async function selectQuestionIds(filters: QuestionFilters, count: number): Promise<string[]> {
  let query = supabase.from('questions').select('id, domain, skill, difficulty');
  if (filters.subject) query = query.eq('subject', filters.subject);
  if (filters.domains && filters.domains.length > 0) query = query.in('domain', filters.domains);
  if (filters.skills && filters.skills.length > 0) query = query.in('skill', filters.skills);
  if (filters.difficulty && filters.difficulty.length > 0) query = query.in('difficulty', filters.difficulty);
  if (!filters.includeRetired) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;
  let pool = (data ?? []).map((r) => r.id);

  if (filters.newOnlyUserId) {
    const attempted = await questionIdsAlreadyAttempted(filters.newOnlyUserId);
    pool = pool.filter((id) => !attempted.has(id));
  }

  // Fisher-Yates shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
