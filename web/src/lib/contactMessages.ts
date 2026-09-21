import { supabase } from './supabase';
import type { Database } from './database.types';

// ---------------------------------------------------------------------------
// The generic "Contact us" page's read/write logic — one row per report,
// keyed by (user_id) via RLS same as every other user-scoped table. Insert +
// select only: a submitted report isn't user-editable afterward (this is a
// support inbox, not a draft), only Anvith updates `status` once it's
// handled, via SQL/the Supabase MCP directly — there's no admin UI in this
// app, matching the "no exposed admin panel" pattern used everywhere else.
// ---------------------------------------------------------------------------

export type ContactMessageRow = Database['public']['Tables']['contact_messages']['Row'];

export async function submitContactMessage(
  userId: string,
  email: string,
  subject: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.from('contact_messages').insert({
    user_id: userId,
    email: email.trim(),
    subject: subject.trim(),
    message: message.trim(),
  });
  if (error) throw error;
}

/** This user's own report history, newest first — so submitting feels real, not a black hole. */
export async function getMyContactMessages(userId: string): Promise<ContactMessageRow[]> {
  const { data, error } = await supabase
    .from('contact_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
