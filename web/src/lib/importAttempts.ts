import Papa from 'papaparse';
import { supabase } from './supabase';
import type { Database } from './database.types';

// ---------------------------------------------------------------------------
// Imports a CSV export of past question attempts from another tool into real
// question_attempts rows. Verified against a real sample row (2026-08-10):
// the export's `id` column is literally this bank's own `questions.id` UUID,
// and `code`/`questionId` matches `questions.source_external_id` — this is
// the same official question bank, not a foreign format needing fuzzy
// content-matching. Match-by-ID first, `code`/`questionId` fallback second;
// rows that match neither are reported as unmatched, never silently dropped.
// ---------------------------------------------------------------------------

type QuestionAttemptInsert = Database['public']['Tables']['question_attempts']['Insert'];

export interface ImportSummary {
  totalRows: number;
  matched: number;
  imported: number;
  unmatched: { row: number; id?: string; code?: string }[];
}

/** Parses the uploaded file into raw string-keyed rows — header names come
 * straight from the CSV, not normalized yet. */
export function parseAttemptsCsv(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: reject,
    });
  });
}

/**
 * Resolves each row to a real question, then writes one question_attempts
 * row per matched row with `session_id: null` (real column, nullable) — an
 * imported attempt was never part of a BluePrep session and shouldn't
 * pretend to be one. `attempt_number` continues from whatever this user's
 * highest existing attempt number is for that question, so importing never
 * collides with attempts already on record.
 */
export async function importAttempts(rows: Record<string, string>[], userId: string): Promise<ImportSummary> {
  const summary: ImportSummary = { totalRows: rows.length, matched: 0, imported: 0, unmatched: [] };
  if (rows.length === 0) return summary;

  const uuids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
  const codes = [...new Set(rows.map((r) => r.code || r.questionId).filter(Boolean))];

  const [uuidRes, codeRes] = await Promise.all([
    uuids.length
      ? supabase.from('questions').select('id, source_external_id, response_type').in('id', uuids)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from('questions').select('id, source_external_id, response_type').in('source_external_id', codes)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (uuidRes.error) throw uuidRes.error;
  if (codeRes.error) throw codeRes.error;

  const questionById = new Map((uuidRes.data ?? []).map((q) => [q.id, q]));
  const questionByCode = new Map((codeRes.data ?? []).map((q) => [q.source_external_id, q]));

  const matchedQuestionIds = new Set<string>();
  const resolvedRows: { row: Record<string, string>; questionId: string; responseType: string }[] = [];

  rows.forEach((row, i) => {
    const byId = row.id ? questionById.get(row.id) : undefined;
    const byCode = !byId ? questionByCode.get(row.code || row.questionId || '') : undefined;
    const match = byId ?? byCode;
    if (match) {
      summary.matched++;
      matchedQuestionIds.add(match.id);
      resolvedRows.push({ row, questionId: match.id, responseType: match.response_type });
    } else {
      summary.unmatched.push({ row: i + 1, id: row.id || undefined, code: row.code || row.questionId || undefined });
    }
  });

  if (resolvedRows.length === 0) return summary;

  const [{ data: choiceRows, error: choiceErr }, { data: existing, error: existErr }] = await Promise.all([
    supabase.from('choices').select('id, question_id, label').in('question_id', [...matchedQuestionIds]),
    supabase
      .from('question_attempts')
      .select('question_id, attempt_number')
      .eq('user_id', userId)
      .in('question_id', [...matchedQuestionIds]),
  ]);
  if (choiceErr) throw choiceErr;
  if (existErr) throw existErr;

  const choiceByQuestionLabel = new Map<string, string>();
  (choiceRows ?? []).forEach((c) => choiceByQuestionLabel.set(`${c.question_id}:${c.label}`, c.id));

  const nextAttemptNumber = new Map<string, number>();
  (existing ?? []).forEach((a) => {
    const cur = nextAttemptNumber.get(a.question_id) ?? 1;
    nextAttemptNumber.set(a.question_id, Math.max(cur, a.attempt_number + 1));
  });

  const inserts: QuestionAttemptInsert[] = resolvedRows.map(({ row, questionId, responseType }) => {
    const attemptNumber = nextAttemptNumber.get(questionId) ?? 1;
    nextAttemptNumber.set(questionId, attemptNumber + 1);

    const isMcq = responseType === 'mcq';
    const answerLabel = (row.answer || '').trim().toUpperCase();
    const selectedChoiceId = isMcq && answerLabel ? (choiceByQuestionLabel.get(`${questionId}:${answerLabel}`) ?? null) : null;
    const enteredValue = !isMcq ? row.answer || null : null;
    const isCorrect = (row.correct || '').trim().toLowerCase() === 'yes';
    const timeTakenSeconds = row.timeSeconds ? Math.round(Number(row.timeSeconds)) || null : null;
    const submittedAt = row.updatedAt || new Date().toISOString();

    return {
      user_id: userId,
      question_id: questionId,
      session_id: null,
      attempt_number: attemptNumber,
      selected_choice_id: selectedChoiceId,
      entered_value: enteredValue,
      is_correct: isCorrect,
      time_taken_seconds: timeTakenSeconds,
      started_at: submittedAt,
      submitted_at: submittedAt,
    };
  });

  // Batched so one giant CSV doesn't hit a single request's size limit.
  const BATCH = 200;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const { error } = await supabase.from('question_attempts').insert(batch);
    if (error) throw error;
    summary.imported += batch.length;
  }

  return summary;
}
