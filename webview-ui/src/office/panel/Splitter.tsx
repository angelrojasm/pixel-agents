import { useCallback, useEffect, useRef } from 'react';

import { isHorizontalAxis, PanelPosition } from './panelTypes.js';

interface SplitterProps {
  panelPosition: PanelPosition;
  /** Current bandSize in px (used as the drag base). */
  bandSize: number;
  /** Called with the new desired bandSize (unclamped — `computePanelBand` clamps). */
  onResize: (next: number) => void;
  /** Called on double-click to reset to the viewport-derived default. */
  onReset: () => void;
}

export function Splitter({ panelPosition, bandSize, onResize, onReset }: SplitterProps) {
  const horizontal = isHorizontalAxis(panelPosition);
  const dragRef = useRef<{ startCoord: number; startBand: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        startCoord: horizontal ? e.clientY : e.clientX,
        startBand: bandSize,
      };
    },
    [horizontal, bandSize],
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const coord = horizontal ? e.clientY : e.clientX;
      // For bottom panel: dragging up (negative delta) grows the band → invert sign.
      // For right panel: dragging left (negative delta) grows the band → invert sign.
      // For left panel: dragging right (positive delta) grows the band → keep sign.
      let delta = coord - d.startCoord;
      if (panelPosition === PanelPosition.BOTTOM || panelPosition === PanelPosition.RIGHT) {
        delta = -delta;
      }
      onResize(d.startBand + delta);
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [horizontal, panelPosition, onResize]);

  const style: React.CSSProperties = horizontal
    ? {
        position: 'absolute',
        top: -2,
        left: 0,
        right: 0,
        height: 4,
        cursor: 'ns-resize',
        zIndex: 10,
      }
    : {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 4,
        cursor: 'ew-resize',
        zIndex: 10,
        ...(panelPosition === PanelPosition.LEFT ? { right: -2 } : { left: -2 }),
      };

  return (
    <div
      style={style}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    />
  );
}
