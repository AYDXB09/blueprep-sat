import { useRef, useState } from 'react';
import { AiIconButton, type AiIconState } from './AiIconButton';
import { AnchoredPortal } from './AnchoredPortal';
import { getDecryptedAiKey } from '../lib/aiSettings';
import { chatCompletion, OpenRouterError, type ChatMessage } from '../lib/openrouter';
import './AskAiPanel.css';

// ---------------------------------------------------------------------------
// Player's "Ask AI about this question" feature. Anchored to the toolbar's
// AI icon (not an always-open inline panel — the icon is the discoverable
// affordance, the chat is what opens on demand). The key is fetched fresh
// per session-open (not cached across questions) and never leaves this
// component's state; `model`/`isConnected` decide the icon's locked/
// connected state without needing the raw key just to render.
// ---------------------------------------------------------------------------

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function AskAiPanel({
  isConnected,
  model,
  questionContext,
  placement = 'above',
}: {
  isConnected: boolean;
  model: string | null;
  questionContext: string;
  // 'above' (default) suits the bottombar it originally lived in; the
  // header sits too close to the viewport top for that to have room, so
  // Player passes 'below' when rendering this up there instead.
  placement?: 'above' | 'below';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iconState: AiIconState = busy ? 'thinking' : isConnected ? 'connected' : 'locked';

  const send = async () => {
    const question = draft.trim();
    if (!question || busy || !model) return;
    setDraft('');
    setError(null);
    const nextMessages: DisplayMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const apiKey = await getDecryptedAiKey();
      if (!apiKey) throw new OpenRouterError('No AI key connected.');
      const systemPrompt: ChatMessage = {
        role: 'system',
        content:
          `You are a concise SAT tutor helping a student understand ONE practice question. ` +
          `Explain reasoning, don't just restate the answer. Keep replies under 120 words.\n\nQuestion context:\n${questionContext}`,
      };
      const history: ChatMessage[] = nextMessages.map((m) => ({ role: m.role, content: m.content }));
      const reply = await chatCompletion(apiKey, model, [systemPrompt, ...history]);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof OpenRouterError ? err.message : 'Something went wrong asking AI — try again.');
      setMessages(nextMessages.slice(0, -1));
      setDraft(question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ask-ai-wrap" ref={wrapRef}>
      <AiIconButton
        state={iconState}
        label="Ask AI about this question"
        onOpen={() => setOpen((o) => !o)}
        popoverPlacement={placement}
      />
      <AnchoredPortal anchorRef={wrapRef} active={open && isConnected} placement={placement}>
        <div className="ask-ai-panel">
          <div className="ask-ai-head">
            <span>Ask AI about this question</span>
            <button type="button" className="ask-ai-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="ask-ai-messages">
            {messages.length === 0 && <p className="ask-ai-empty">Ask why an answer is right, or why you got it wrong.</p>}
            {messages.map((m, i) => (
              <div key={i} className={`ask-ai-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="ask-ai-bubble assistant thinking">Thinking…</div>}
          </div>
          {error && <p className="ask-ai-error">{error}</p>}
          <div className="ask-ai-input-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder="Ask a follow-up..."
              disabled={busy}
            />
            <button type="button" className="btn primary" style={{ margin: 0 }} onClick={() => void send()} disabled={busy || !draft.trim()}>
              Send
            </button>
          </div>
        </div>
      </AnchoredPortal>
    </div>
  );
}
