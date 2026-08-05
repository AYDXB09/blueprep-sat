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
