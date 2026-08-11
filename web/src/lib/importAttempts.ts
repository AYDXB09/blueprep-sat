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
  /** Rows where `correct`/`type` held a value outside the schema's real
   * enum (yes/no, mcq/spr) — a real signature of column-shifted CSV rows
   * (see `chunk`'s doc comment: a 322-row real export had 28 rows where an
   * unescaped comma inside an HTML/JSON field shifted every column after
   * it). These are never imported with guessed/wrong data — reported here
   * instead, distinct from a row that simply didn't match any question. */
  malformed: { row: number; id?: string }[];
}

const VALID_CORRECT = new Set(['yes', 'no']);
const VALID_RESPONSE_TYPES = new Set(['mcq', 'spr']);

/** Splits an array into fixed-size chunks — used to keep every `.in()`
 * lookup below a size that's safe to pack into a GET request's query
 * string. A real 322-row import failed outright with no more detail than
 * "Import failed" until this was traced to exactly this: one `.in('id', …)`
 * call with 322 UUIDs (~12KB of query string) tripped a URL-length limit
 * somewhere in the request path. 100 per chunk keeps every request small
 * regardless of how large a real export gets. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const LOOKUP_CHUNK_SIZE = 100;

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
 * row per matched row, grouped into one real `practice_sessions` row per
 * calendar day of `submitted_at` (mode: 'imported'). A first pass of this
 * left `session_id: null` on the theory that an imported attempt was never
 * part of a real BluePrep session and shouldn't pretend to be one — that
 * was wrong in practice: `getMistakes()` requires a real `session_id`
 * (`!row.session_id` skips the row), and Progress's Full Session History /
 * Dashboard's streak and recent-sessions all read `practice_sessions`
 * directly, so a null-session import was completely invisible everywhere
 * except a raw DB query (confirmed live, 2026-08-10 — 294 real imported
 * rows, zero mistakes/sessions/streak credit anywhere in the app).
 * Day-grouping (not one giant session) mirrors how the source data actually
 * clusters and keeps each session's size honest, matching the identical
 * backfill this fix's own migration applied to the first import batch.
 * `attempt_number` continues from whatever this user's highest existing
 * attempt number is for that question, so importing never collides with
 * attempts already on record.
 */
export async function importAttempts(rows: Record<string, string>[], userId: string): Promise<ImportSummary> {
  const summary: ImportSummary = { totalRows: rows.length, matched: 0, imported: 0, unmatched: [], malformed: [] };
  if (rows.length === 0) return summary;

  const uuids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
  const codes = [...new Set(rows.map((r) => r.code || r.questionId).filter(Boolean))];

  type QuestionLookup = { id: string; source_external_id: string | null; response_type: string; subject: string };
  const questionById = new Map<string, QuestionLookup>();
  const questionByCode = new Map<string, QuestionLookup>();

  for (const idChunk of chunk(uuids, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase.from('questions').select('id, source_external_id, response_type, subject').in('id', idChunk);
    if (error) throw error;
    (data ?? []).forEach((q) => questionById.set(q.id, q));
  }
  for (const codeChunk of chunk(codes, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, source_external_id, response_type, subject')
      .in('source_external_id', codeChunk);
    if (error) throw error;
    (data ?? []).forEach((q) => questionByCode.set(q.source_external_id ?? '', q));
  }

  const matchedQuestionIds = new Set<string>();
  const resolvedRows: { row: Record<string, string>; questionId: string; responseType: string; subject: string }[] = [];

  rows.forEach((row, i) => {
    // Column-shift guard: a row whose `correct`/`type` fell outside the
    // real schema values almost certainly had its columns shifted by a
    // CSV-quoting issue upstream (see ImportSummary.malformed) — skip it
    // rather than import a guess dressed up as real history.
    const correctVal = (row.correct || '').trim().toLowerCase();
    const typeVal = (row.type || '').trim().toLowerCase();
    if ((row.correct && !VALID_CORRECT.has(correctVal)) || (row.type && !VALID_RESPONSE_TYPES.has(typeVal))) {
      summary.malformed.push({ row: i + 1, id: row.id || undefined });
      return;
    }

    const byId = row.id ? questionById.get(row.id) : undefined;
    const byCode = !byId ? questionByCode.get(row.code || row.questionId || '') : undefined;
    const match = byId ?? byCode;
    if (match) {
      summary.matched++;
      matchedQuestionIds.add(match.id);
      resolvedRows.push({ row, questionId: match.id, responseType: match.response_type, subject: match.subject });
    } else {
      summary.unmatched.push({ row: i + 1, id: row.id || undefined, code: row.code || row.questionId || undefined });
    }
  });

  if (resolvedRows.length === 0) return summary;

  const matchedIdsArr = [...matchedQuestionIds];
  const choiceByQuestionLabel = new Map<string, string>();
  const nextAttemptNumber = new Map<string, number>();

  for (const idChunk of chunk(matchedIdsArr, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase.from('choices').select('id, question_id, label').in('question_id', idChunk);
    if (error) throw error;
    (data ?? []).forEach((c) => choiceByQuestionLabel.set(`${c.question_id}:${c.label}`, c.id));
  }
  for (const idChunk of chunk(matchedIdsArr, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('question_attempts')
      .select('question_id, attempt_number')
      .eq('user_id', userId)
      .in('question_id', idChunk);
    if (error) throw error;
    (data ?? []).forEach((a) => {
      const cur = nextAttemptNumber.get(a.question_id) ?? 1;
      nextAttemptNumber.set(a.question_id, Math.max(cur, a.attempt_number + 1));
    });
  }

  type ResolvedInsert = { insert: Omit<QuestionAttemptInsert, 'session_id'>; submittedAtMs: number; isCorrect: boolean; subject: string };
  const resolvedInserts: ResolvedInsert[] = resolvedRows.map(({ row, questionId, responseType, subject }) => {
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
      submittedAtMs: new Date(submittedAt).getTime(),
      isCorrect,
      subject,
      insert: {
        user_id: userId,
        question_id: questionId,
        attempt_number: attemptNumber,
        selected_choice_id: selectedChoiceId,
        entered_value: enteredValue,
        is_correct: isCorrect,
        time_taken_seconds: timeTakenSeconds,
        started_at: submittedAt,
        submitted_at: submittedAt,
      },
    };
  });

  // Split by subject first, then gap-group within each subject's own
  // timeline — not a flat calendar day, and not mixed-subject either. A
  // first pass grouped purely by time gap across both subjects at once,
  // which produced sessions with no single subject and therefore no real
  // `subject_filter` — Dashboard's Math/R&W score trend tiles (and
  // anything else keyed off subject_filter) both filter on
  // `subject_filter === 'Math' | 'Reading and Writing'` exactly, so a null
  // subject_filter meant those tiles stayed empty despite 322 real
  // imported attempts existing (confirmed live, 2026-08-11). Splitting by
  // subject before gap-grouping makes every imported session subject-pure,
  // matching what subject_filter means everywhere else in the schema.
  const SESSION_GAP_MS = 45 * 60 * 1000;
  const bySubject = new Map<string, ResolvedInsert[]>();
  resolvedInserts.forEach((r) => {
    const list = bySubject.get(r.subject) ?? [];
    list.push(r);
    bySubject.set(r.subject, list);
  });

  const finalInserts: QuestionAttemptInsert[] = [];
  for (const [subject, subjectRows] of bySubject) {
    const sorted = [...subjectRows].sort((a, b) => a.submittedAtMs - b.submittedAtMs);
    const groups: ResolvedInsert[][] = [];
    for (const r of sorted) {
      const current = groups[groups.length - 1];
      if (!current || r.submittedAtMs - current[current.length - 1].submittedAtMs > SESSION_GAP_MS) {
        groups.push([r]);
      } else {
        current.push(r);
      }
    }

    for (const group of groups) {
      const questionIdsOrdered = group.map((r) => r.insert.question_id);
      const correctCount = group.filter((r) => r.isCorrect).length;
      const startedAt = new Date(group[0].submittedAtMs).toISOString();
      const completedAt = new Date(group[group.length - 1].submittedAtMs).toISOString();
      const { data: session, error: sessionErr } = await supabase
        .from('practice_sessions')
        .insert({
          user_id: userId,
          mode: 'imported',
          subject_filter: subject,
          question_ids: questionIdsOrdered,
          requested_count: group.length,
          actual_count: group.length,
          timer_mode: 'none',
          timer_basis: 'none',
          feedback_mode: 'immediate',
          include_retired: true,
          started_at: startedAt,
          completed_at: completedAt,
          score_summary: {
            total: group.length,
            correct: correctCount,
            answered: group.length,
            pct: Math.round((correctCount / group.length) * 100),
          },
        })
        .select('id')
        .single();
      if (sessionErr) throw sessionErr;

      group.forEach((r) => finalInserts.push({ ...r.insert, session_id: session.id }));
    }
  }

  // Batched so one giant CSV doesn't hit a single request's size limit.
  const BATCH = 200;
  for (let i = 0; i < finalInserts.length; i += BATCH) {
    const batch = finalInserts.slice(i, i + BATCH);
    const { error } = await supabase.from('question_attempts').insert(batch);
    if (error) throw error;
    summary.imported += batch.length;
  }

  return summary;
}
