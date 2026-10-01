import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import './DesmosCalculator.css';

// ---------------------------------------------------------------------------
// Floating Desmos graphing calculator, Bluebook-style: an iframe of the public
// desmos.com/calculator page inside a draggable / resizable window, so students
// never leave the tab. (Deliberately not the Desmos API — that needs a paid
// key; the public page sends no frame-blocking headers.)
//
// The parent keeps this mounted once first opened and only toggles `visible`,
// so graphs survive Next/Back (and the Desmos page also autosaves locally).
// Narrow viewports get a bottom sheet instead of a free-floating window.
// ---------------------------------------------------------------------------

const DESMOS_URL = 'https://www.desmos.com/calculator';
const RECT_KEY = 'blueprep.calc.rect';
const MIN_W = 320;
const MIN_H = 280;
const HEADER_H = 38;
const NARROW_QUERY = '(max-width: 860px)';

type Rect = { x: number; y: number; w: number; h: number };

// The app applies a root-level CSS `zoom` (1.1 baseline, 1.3 for "Large" font
// size — see styles/tokens.css). Inline px and pointer deltas are then in
// different units from the viewport, so everything here works in zoomed
// layout units: viewport size and pointer movement are divided by this.
function pageZoom(): number {
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

function clampRect(r: Rect): Rect {
  const z = pageZoom();
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  const w = Math.min(Math.max(r.w, MIN_W), Math.max(MIN_W, vw - 16));
  const h = Math.min(Math.max(r.h, MIN_H), Math.max(MIN_H, vh - 16));
  const x = Math.min(Math.max(r.x, 0), Math.max(0, vw - w));
  const y = Math.min(Math.max(r.y, 0), Math.max(0, vh - HEADER_H));
  return { x, y, w, h };
}

function initialRect(): Rect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Rect;
      if ([p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return clampRect(p);
    }
  } catch {
    // storage unavailable — fall through to the default
  }
  const w = 440;
  return clampRect({ x: window.innerWidth / pageZoom() - w - 20, y: 70, w, h: 520 });
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

type Props = {
  visible: boolean;
  docked: boolean;
  onClose: () => void;
  onToggleDock: () => void;
};

export function DesmosCalculator({ visible, docked, onClose, onToggleDock }: Props) {
  const narrow = useNarrow();
  const [rect, setRect] = useState<Rect>(initialRect);
  const [minimized, setMinimized] = useState(false);
  // While dragging/resizing the iframe would swallow pointer events once the
  // cursor crosses it, so it's made inert for the duration.
  const [interacting, setInteracting] = useState(false);
  const gesture = useRef<{ mode: 'move' | 'resize'; px: number; py: number; start: Rect } | null>(null);

  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const begin = (mode: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (narrow || docked) return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { mode, px: e.clientX, py: e.clientY, start: rect };
    setInteracting(true);
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const z = pageZoom();
    const dx = (e.clientX - g.px) / z;
    const dy = (e.clientY - g.py) / z;
    setRect(
      clampRect(
        g.mode === 'move'
          ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy }
          : { ...g.start, w: g.start.w + dx, h: g.start.h + dy },
      ),
    );
  };

  const end = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = null;
    setInteracting(false);
    setRect((r) => {
      try {
        localStorage.setItem(RECT_KEY, JSON.stringify(r));
      } catch {
        // non-essential
      }
      return r;
    });
  }, []);

  const mode = narrow ? 'sheet' : docked ? 'dock' : 'float';
  const style =
    mode === 'float'
      ? { left: rect.x, top: rect.y, width: rect.w, height: minimized ? HEADER_H : rect.h }
      : mode === 'sheet'
        ? { height: Math.round((window.innerHeight / pageZoom()) * 0.55) }
        : undefined;

  return (
    <div
      className={`desmos-win ${mode}${minimized && mode === 'float' ? ' min' : ''}`}
      style={style}
      hidden={!visible}
      role="dialog"
      aria-label="Desmos graphing calculator"
    >
      <div
        className="desmos-head"
        onPointerDown={begin('move')}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => mode === 'float' && setMinimized((m) => !m)}
      >
        <span className="desmos-title">Desmos</span>
        <span className="desmos-actions" onPointerDown={(e) => e.stopPropagation()}>
          <a href={DESMOS_URL} target="_blank" rel="noopener noreferrer" title="Open in a new tab" aria-label="Open Desmos in a new tab">
            ↗
          </a>
          {!narrow && (
            <button
              title={docked ? 'Float' : 'Dock to the right'}
              aria-label={docked ? 'Float calculator' : 'Dock calculator to the right'}
              onClick={onToggleDock}
            >
              {docked ? '❐' : '◨'}
            </button>
          )}
          {mode === 'float' && (
            <button title={minimized ? 'Restore' : 'Minimize'} aria-label={minimized ? 'Restore calculator' : 'Minimize calculator'} onClick={() => setMinimized((m) => !m)}>
              {minimized ? '▢' : '–'}
            </button>
          )}
          <button title="Close" aria-label="Close calculator" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>
      <iframe
        className="desmos-frame"
        src={DESMOS_URL}
        title="Desmos graphing calculator"
        style={interacting ? { pointerEvents: 'none' } : undefined}
      />
      {mode === 'float' && !minimized && (
        <div className="desmos-grip" onPointerDown={begin('resize')} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} aria-hidden="true" />
      )}
    </div>
  );
}
