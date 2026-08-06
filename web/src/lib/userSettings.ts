import { supabase } from './supabase';
import type { Database } from './database.types';

export type UserSettingsRow = Database['public']['Tables']['user_settings']['Row'];
type UserSettingsUpdate = Database['public']['Tables']['user_settings']['Update'];

/**
 * Loads this user's settings row, creating it with schema defaults on first
 * load if none exists yet (RLS scopes everything to auth.uid() = user_id,
 * same pattern as AuthContext's ensureUserRow for the `users` table).
 */
export async function getOrCreateUserSettings(userId: string): Promise<UserSettingsRow> {
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await supabase
    .from('user_settings')
    .insert({ user_id: userId })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
}

/** Saves one or more fields immediately — Settings has no batched "Save"
 * step, each control writes on change. */
export async function updateUserSettings(userId: string, patch: UserSettingsUpdate): Promise<void> {
  const { error } = await supabase.from('user_settings').update(patch).eq('user_id', userId);
  if (error) throw error;
}
