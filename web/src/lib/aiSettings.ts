import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// BYOK (bring-your-own-key) AI settings. The actual API key is never stored
// in a plain, directly-selectable column — `save_ai_key`/`get_ai_key`/
// `disconnect_ai_key` are SECURITY DEFINER Postgres functions that read/
// write it through Supabase Vault (already-installed pgsodium-backed
// encryption), each scoped internally to auth.uid() so a caller can only
// ever reach their own key. `user_ai_settings` itself only ever holds
// display-safe data (provider, model, last 4 chars) — see the migration
// `create_user_ai_settings` for the full design.
// ---------------------------------------------------------------------------

export interface AiSettings {
  provider: string;
  model: string | null;
  keyLast4: string | null;
  connectedAt: string | null;
}

export async function getAiSettings(userId: string): Promise<AiSettings | null> {
  const { data, error } = await supabase
    .from('user_ai_settings')
    .select('provider, model, key_last4, connected_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { provider: data.provider, model: data.model, keyLast4: data.key_last4, connectedAt: data.connected_at };
}

export async function saveAiKey(provider: string, apiKey: string, model: string): Promise<void> {
  const { error } = await supabase.rpc('save_ai_key', { p_provider: provider, p_api_key: apiKey, p_model: model });
  if (error) throw error;
}

export async function disconnectAiKey(): Promise<void> {
  const { error } = await supabase.rpc('disconnect_ai_key');
  if (error) throw error;
}

/** The caller's own decrypted key, fetched fresh right before an AI request
 * — never cached beyond the in-memory lifetime of that request. Returns
 * null if nothing is connected. */
export async function getDecryptedAiKey(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_ai_key');
  if (error) throw error;
  return data ?? null;
}
