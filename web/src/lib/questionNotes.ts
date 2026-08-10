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
