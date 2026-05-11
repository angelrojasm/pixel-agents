import { AUTO_ON_FACING_DEPTH } from '../../constants.js';
import { Direction } from '../types.js';

/**
 * True if a chair at (seatCol, seatRow) facing `facingDir` has a computer
 * (electronics-category item) within the auto-state adjacency window:
 * AUTO_ON_FACING_DEPTH tiles deep in the facing direction, plus 1 tile to
 * each side perpendicular to the facing direction.
 *
 * The `electronicsTiles` set contains "col,row" keys for every tile covered
 * by an electronics-category furniture item.
 *
 * Kept in its own module so both layoutToSeats (role classification) and
 * officeState.rebuildFurnitureInstances (auto-on lighting) reuse one rule.
 */
export function facesComputer(
  seatCol: number,
  seatRow: number,
  facingDir: Direction,
  electronicsTiles: Set<string>,
): boolean {
  const dCol = facingDir === Direction.RIGHT ? 1 : facingDir === Direction.LEFT ? -1 : 0;
  const dRow = facingDir === Direction.DOWN ? 1 : facingDir === Direction.UP ? -1 : 0;

  for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
    const tileCol = seatCol + dCol * d;
    const tileRow = seatRow + dRow * d;
    if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
    if (dCol !== 0) {
      if (
        electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
        electronicsTiles.has(`${tileCol},${tileRow + 1}`)
      ) {
        return true;
      }
    } else {
      if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Build the set of "col,row" tile keys covered by every electronics-category item. */
export function collectElectronicsTiles(
  furniture: Array<{ type: string; col: number; row: number }>,
  getCategory: (type: string) => string | undefined,
  getFootprint: (type: string) => { footprintW: number; footprintH: number } | null,
): Set<string> {
  const tiles = new Set<string>();
  for (const item of furniture) {
    if (getCategory(item.type) !== 'electronics') continue;
    const fp = getFootprint(item.type);
    if (!fp) continue;
    for (let dr = 0; dr < fp.footprintH; dr++) {
      for (let dc = 0; dc < fp.footprintW; dc++) {
        tiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }
  return tiles;
}
