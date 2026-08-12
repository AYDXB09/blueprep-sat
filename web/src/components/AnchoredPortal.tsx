import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Renders a popover/panel into document.body instead of in place — needed
// because the Ask-AI icon and its popover live inside Player's .bottombar,
// which has overflow-x:auto for narrow-viewport scrolling. Per the CSS spec,
// setting overflow-x to anything but visible forces overflow-y to compute
// as auto too — even if overflow-y:visible is set explicitly — which
// silently clipped an absolutely-positioned popover extending above the
// bar's own box (confirmed live: the popover existed in the DOM with
// correct text/rect, but was invisible). A portal escapes that ancestor
// clipping entirely; position is computed from the anchor's real
// getBoundingClientRect() and kept in sync on resize/scroll.
// ---------------------------------------------------------------------------

function useAnchorRect(anchorRef: RefObject<HTMLElement | null>, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active || !anchorRef.current) {
      setRect(null);
      return;
    }
    const update = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, anchorRef]);
  return rect;
}

export function AnchoredPortal({
  anchorRef,
  active,
  placement,
  align = 'right',
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  active: boolean;
  placement: 'above' | 'below';
  // 'right' (default) keeps the existing AI-popover behavior (right edge
  // flush with the anchor's right edge). 'center' centers the popover on
  // the anchor's horizontal midpoint instead — used by the bottombar
  // question-navigator trigger, which (like Bluebook's own) needs to open
  // dead-center above a pill sitting in the middle of the bar, not flush
  // to one edge.
  align?: 'right' | 'center';
  children: ReactNode;
}) {
  const rect = useAnchorRect(anchorRef, active);
  if (!active || !rect) return null;

  const style: CSSProperties = {
    position: 'fixed',
    zIndex: 1000,
  };
  if (align === 'center') {
    style.left = rect.left + rect.width / 2;
    style.transform = 'translateX(-50%)';
  } else {
    style.right = Math.max(8, window.innerWidth - rect.right);
  }
  if (placement === 'above') style.bottom = window.innerHeight - rect.top + 8;
  else style.top = rect.bottom + 8;

  return createPortal(<div style={style}>{children}</div>, document.body);
}
