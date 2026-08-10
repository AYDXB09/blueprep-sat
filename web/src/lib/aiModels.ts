import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// OpenRouter's real catalog is several hundred models, not a fixed handful —
// hardcoding 3 in Settings hid almost everything a user might want. Rather
// than hitting OpenRouter's public /models endpoint on every Settings visit,
// the catalog is cached in Supabase (ai_models_cache) and refreshed lazily:
// whenever it's missing or older than STALE_AFTER_DAYS, the next visitor's
// browser refetches and upserts it. No cron job, no edge function — a
// staleness check is enough for a catalog that doesn't change daily, and
// this is a small app with no background infra to run one anyway.
// ---------------------------------------------------------------------------

const STALE_AFTER_DAYS = 30;

export interface CachedModel {
  id: string;
  label: string;
  contextLength: number | null;
  pricingPrompt: number | null;
  pricingCompletion: number | null;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

async function fetchOpenRouterCatalog(): Promise<OpenRouterModel[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter model list failed (${res.status}).`);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function refreshCache(): Promise<void> {
  const models = await fetchOpenRouterCatalog();
  if (models.length === 0) return;
  const rows = models.map((m) => ({
    model_id: m.id,
    label: m.name || m.id,
    context_length: m.context_length ?? null,
    pricing_prompt: m.pricing?.prompt ? Number(m.pricing.prompt) : null,
    pricing_completion: m.pricing?.completion ? Number(m.pricing.completion) : null,
    updated_at: new Date().toISOString(),
  }));
  // Upsert in chunks — a single request with hundreds of rows is fine for
  // Postgres, but keeping chunks bounded avoids surprises if the catalog
  // grows a lot further.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('ai_models_cache').upsert(rows.slice(i, i + CHUNK));
    if (error) throw error;
  }
  const { error: metaError } = await supabase
    .from('ai_models_cache_meta')
    .update({ last_refreshed_at: new Date().toISOString() })
    .eq('id', true);
  if (metaError) throw metaError;
}

function isStale(lastRefreshedAt: string | null): boolean {
  if (!lastRefreshedAt) return true;
  const ageMs = Date.now() - new Date(lastRefreshedAt).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** Every cached model, refreshing first if the cache is empty or stale. A
 * failed refresh falls back to whatever's cached (even if stale) rather
 * than leaving the picker empty — a slightly outdated catalog is still far
 * more useful than none. */
export async function getModels(): Promise<CachedModel[]> {
  const { data: meta } = await supabase.from('ai_models_cache_meta').select('last_refreshed_at').eq('id', true).maybeSingle();
  if (isStale(meta?.last_refreshed_at ?? null)) {
    try {
      await refreshCache();
    } catch (err) {
      console.warn('OpenRouter model cache refresh failed, serving cached data:', err);
    }
  }
  const { data, error } = await supabase
    .from('ai_models_cache')
    .select('model_id, label, context_length, pricing_prompt, pricing_completion')
    .order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.model_id,
    label: r.label,
    contextLength: r.context_length,
    pricingPrompt: r.pricing_prompt,
    pricingCompletion: r.pricing_completion,
  }));
}
