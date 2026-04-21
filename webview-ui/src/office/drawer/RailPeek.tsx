import { DRAWER_BG_CHROME, DRAWER_BORDER, PEEK_HEIGHT_PX } from '../../constants.js';

interface RailPeekProps {
  onRestore: () => void;
}

export function RailPeek({ onRestore }: RailPeekProps) {
  return (
    <button
      type="button"
      onClick={onRestore}
      aria-label="Show rail"
      title="Show rail"
      style={{
        height: PEEK_HEIGHT_PX,
        width: '100%',
        background: DRAWER_BG_CHROME,
        border: 'none',
        borderTop: `2px solid ${DRAWER_BORDER}`,
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}
