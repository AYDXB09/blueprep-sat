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
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  active: boolean;
  placement: 'above' | 'below';
  children: ReactNode;
}) {
  const rect = useAnchorRect(anchorRef, active);
  if (!active || !rect) return null;

  const style: CSSProperties = {
    position: 'fixed',
    right: Math.max(8, window.innerWidth - rect.right),
    zIndex: 1000,
  };
  if (placement === 'above') style.bottom = window.innerHeight - rect.top + 8;
  else style.top = rect.bottom + 8;

  return createPortal(<div style={style}>{children}</div>, document.body);
}
