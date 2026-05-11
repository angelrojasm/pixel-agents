import {
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_SIDE_PEEK_PX,
} from '../../constants.js';
import type { PanelPosition } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';

interface RailPeekProps {
  panelPosition: PanelPosition;
  onRestore: () => void;
}

export function RailPeek({ panelPosition, onRestore }: RailPeekProps) {
  const horizontal = isHorizontalAxis(panelPosition);
  const horizontalStyle = {
    height: PANEL_BOTTOM_PEEK_PX,
    width: '100%',
    borderTop: `2px solid ${PANEL_BORDER}`,
  };
  const verticalStyle = {
    width: PANEL_SIDE_PEEK_PX,
    height: '100%',
    borderLeft: panelPosition === 'right' ? `2px solid ${PANEL_BORDER}` : undefined,
    borderRight: panelPosition === 'left' ? `2px solid ${PANEL_BORDER}` : undefined,
  };

  return (
    <button
      type="button"
      onClick={onRestore}
      aria-label="Show rail"
      title="Show rail"
      style={{
        ...(horizontal ? horizontalStyle : verticalStyle),
        background: PANEL_BG_CHROME,
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}
