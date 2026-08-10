import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Per-question personal notes ("Add my notes" / "Edit my notes" in Player,
// per the approved sketch). One row per (user, question) — a note persists
// across retries, not tied to a single attempt or session, matching V1's
// index.html note behavior. Saving an empty string deletes the row instead
// of storing blank text, so "has a note" is always a real yes/no.
// ---------------------------------------------------------------------------

export async function getNote(userId: string, questionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('question_notes')
    .select('note')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .maybeSingle();
  if (error) throw error;
  return data?.note ?? null;
}

export async function saveNote(userId: string, questionId: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) {
    const { error } = await supabase
      .from('question_notes')
      .delete()
      .eq('user_id', userId)
      .eq('question_id', questionId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('question_notes')
    .upsert({ user_id: userId, question_id: questionId, note: trimmed, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export interface NotedQuestion {
  questionId: string;
  note: string;
  updatedAt: string;
}

/** Every note this user has saved, newest-first — backs Mistake Log's note
 * indicator and the "Copy my notes" export. */
export async function getAllNotes(userId: string): Promise<NotedQuestion[]> {
  const { data, error } = await supabase
    .from('question_notes')
    .select('question_id, note, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ questionId: r.question_id, note: r.note, updatedAt: r.updated_at }));
}

function stripHtmlPreview(markup: string, maxLen = 100): string {
  const text = markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export interface NotedQuestionContext extends NotedQuestion {
  subject: string;
  domain: string;
  sourceExternalId: string | null;
  stemPreview: string;
  /** null = this question was noted but never actually attempted (e.g. a
   * note added mid-review before submitting). */
  lastAttemptCorrect: boolean | null;
  lastAttemptedAt: string | null;
}

/**
 * Every noted question with enough real context to stand alone outside the
 * app — domain, subject, stem preview, and correct/incorrect on the user's
 * latest attempt. Deliberately NOT scoped to mistakes: Mistake Log's
 * getMistakes() only ever returns wrong-answered questions, so a note left
 * on a question the user got right would otherwise never surface in any
 * bulk view. Backs the "All my notes" tab, its Copy/Export CSV actions.
 */
export async function getAllNotesWithContext(userId: string): Promise<NotedQuestionContext[]> {
  const notes = await getAllNotes(userId);
  if (notes.length === 0) return [];
  const questionIds = notes.map((n) => n.questionId);

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, subject, domain, stem_markup, source_external_id')
    .in('id', questionIds);
  if (qErr) throw qErr;

  const { data: attempts, error: aErr } = await supabase
    .from('question_attempts')
    .select('question_id, is_correct, submitted_at')
    .eq('user_id', userId)
    .in('question_id', questionIds)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });
  if (aErr) throw aErr;

  const questionById = new Map((questions ?? []).map((q) => [q.id, q]));
  const latestAttemptByQuestion = new Map<string, { is_correct: boolean | null; submitted_at: string | null }>();
  for (const a of attempts ?? []) {
    if (!latestAttemptByQuestion.has(a.question_id)) latestAttemptByQuestion.set(a.question_id, a);
  }

  return notes.map((n) => {
    const q = questionById.get(n.questionId);
    const attempt = latestAttemptByQuestion.get(n.questionId);
    return {
      ...n,
      subject: q?.subject ?? '',
      domain: q?.domain ?? '',
      sourceExternalId: q?.source_external_id ?? null,
      stemPreview: q ? stripHtmlPreview(q.stem_markup) : '',
      lastAttemptCorrect: attempt ? attempt.is_correct : null,
      lastAttemptedAt: attempt?.submitted_at ?? null,
    };
  });
}
