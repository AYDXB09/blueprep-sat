import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnchoredPortal } from './AnchoredPortal';
import './AiIconButton.css';

// ---------------------------------------------------------------------------
// Shared AI entry point for Player (Ask-AI) and Progress (Performance Coach)
// — a persistent, always-visible icon (not buried inside scrolled content)
// with three real states: locked (no AI key connected — amber background,
// not just a muted gray outline, so it doesn't disappear into the toolbar),
// connected (accent blue, ready), thinking (accent blue, pulsing, mid-request).
// Locked click opens a small anchored popover with a link to Settings,
// per the approved sketch — never a full inline panel. The popover renders
// through AnchoredPortal (see its doc comment) so it isn't clipped by
// Player's .bottombar, which forces overflow-y:auto as a side effect of its
// own overflow-x:auto.
// ---------------------------------------------------------------------------

export type AiIconState = 'locked' | 'connected' | 'thinking';

export function AiIconButton({
  state,
  label,
  onOpen,
  popoverPlacement = 'below',
}: {
  state: AiIconState;
  label: string;
  onOpen: () => void;
  /** 'above' for icons anchored near the bottom of the viewport (e.g.
   * Player's bottom toolbar), so the locked popover doesn't render
   * off-screen below the fold. */
  popoverPlacement?: 'below' | 'above';
}) {
  const [showLockedPopover, setShowLockedPopover] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showLockedPopover) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setShowLockedPopover(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [showLockedPopover]);

  return (
    <div className="ai-icon-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ai-icon-btn ${state}`}
        aria-label={state === 'locked' ? `${label}, locked` : label}
        onClick={() => {
          if (state === 'locked') setShowLockedPopover((s) => !s);
          else if (state === 'connected') onOpen();
          // 'thinking' — no-op, request already in flight.
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ai-icon-mark">
          <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          <ellipse cx="12" cy="12" rx="9.2" ry="4.4" stroke="currentColor" strokeWidth="1.5" />
          <ellipse cx="12" cy="12" rx="9.2" ry="4.4" stroke="currentColor" strokeWidth="1.5" transform="rotate(90 12 12)" />
        </svg>
      </button>
      <AnchoredPortal anchorRef={wrapRef} active={showLockedPopover} placement={popoverPlacement}>
        <div className="ai-icon-popover" ref={popoverRef}>
          <p>Add your AI key in Settings to unlock this.</p>
          <button
            type="button"
            className="ai-icon-popover-link"
            onClick={() => {
              setShowLockedPopover(false);
              navigate('/settings');
            }}
          >
            Go to settings ↗
          </button>
        </div>
      </AnchoredPortal>
    </div>
  );
}
