import { useRef, useState } from 'react';
import { AiIconButton, type AiIconState } from './AiIconButton';
import { AnchoredPortal } from './AnchoredPortal';
import { getDecryptedAiKey } from '../lib/aiSettings';
import { chatCompletion, OpenRouterError } from '../lib/openrouter';
import './AiCoachPanel.css';

// ---------------------------------------------------------------------------
// Progress's "AI performance coach" — reuses buildDigest() (already built
// for the plain-text "Copy digest" export in SkillMap) as the prompt input,
// so the AI's advice is grounded in the same real numbers a student could
// already see, not a separate/inconsistent analysis. Icon lives in the page
// header, not scrolled inside Skill map, so it's discoverable without
// expanding anything first.
// ---------------------------------------------------------------------------

export function AiCoachPanel({
  isConnected,
  model,
  digest,
}: {
  isConnected: boolean;
  model: string | null;
  digest: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iconState: AiIconState = busy ? 'thinking' : isConnected ? 'connected' : 'locked';

  const run = async () => {
    if (busy || !model) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const apiKey = await getDecryptedAiKey();
      if (!apiKey) throw new OpenRouterError('No AI key connected.');
      const reply = await chatCompletion(apiKey, model, [
        {
          role: 'system',
          content:
            'You are an SAT prep coach. Given a student\'s real practice stats, give specific, encouraging advice: ' +
            'what to focus on next and why, grounded only in the numbers given. Keep it under 150 words, no generic filler.',
        },
        { role: 'user', content: digest },
      ]);
      setAdvice(reply);
    } catch (err) {
      setError(err instanceof OpenRouterError ? err.message : 'Something went wrong running the coach — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-coach-wrap" ref={wrapRef}>
      <AiIconButton
        state={iconState}
        label="AI performance coach"
        onOpen={() => {
          if (advice) setOpen((o) => !o);
          else void run();
        }}
      />
      <AnchoredPortal anchorRef={wrapRef} active={open && isConnected} placement="below">
        <div className="ai-coach-panel">
          <div className="ai-coach-head">
            <span>AI performance coach</span>
            <button type="button" className="ai-coach-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          {busy && <p className="ai-coach-loading">Reading your practice history…</p>}
          {error && <p className="ai-coach-error">{error}</p>}
          {advice && !busy && <p className="ai-coach-advice">{advice}</p>}
          {advice && !busy && (
            <button type="button" className="ai-coach-refresh" onClick={() => void run()}>
              Refresh
            </button>
          )}
        </div>
      </AnchoredPortal>
    </div>
  );
}
