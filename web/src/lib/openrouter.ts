// ---------------------------------------------------------------------------
// OpenRouter adapter — one HTTP client covering every model OpenRouter
// proxies (Claude, GPT, Gemini, etc.) through a single key, per the approved
// BYOK plan (OpenRouter-first, not per-provider native adapters). CORS-
// enabled, so this runs as a plain browser fetch — no server round-trip,
// no BluePrep-side AI cost.
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OpenRouterError extends Error {}

async function openRouterFetch(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter uses these purely for its own public leaderboard —
      // required-ish by convention, not sensitive.
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://blueprep-sat.vercel.app',
      'X-Title': 'BluePrep',
    },
    body: JSON.stringify(body),
  });
}

export async function chatCompletion(apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await openRouterFetch(apiKey, { model, messages });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new OpenRouterError('That API key was rejected — check it in Settings.');
    throw new OpenRouterError(`AI request failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new OpenRouterError('AI returned an empty response.');
  return text;
}

/** Fires a minimal real request (not just a key-format check) so "Test
 * connection" actually proves the key works against OpenRouter. */
export async function testConnection(apiKey: string, model: string): Promise<void> {
  await chatCompletion(apiKey, model, [{ role: 'user', content: 'Reply with only the word OK.' }]);
}
