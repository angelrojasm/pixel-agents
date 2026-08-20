import { AUTO_ON_FACING_DEPTH } from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import type { PlacedFurniture } from '../types.js';
import { Direction } from '../types.js';

/** Does this seat face an electronics tile (PC, monitor) within the
 *  auto-state adjacency window? Shared by seat-role classification. */
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
    } else if (
      electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
      electronicsTiles.has(`${tileCol + 1},${tileRow}`)
    ) {
      return true;
    }
  }
  return false;
}

/** Every tile of every electronics-category furniture item. */
export function collectElectronicsTiles(furniture: PlacedFurniture[]): Set<string> {
  const out = new Set<string>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || entry.category !== 'electronics') continue;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        out.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }
  return out;
}
