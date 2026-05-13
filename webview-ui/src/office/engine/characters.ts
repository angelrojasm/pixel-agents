import {
  STEP_OFF_PAUSE_MAX_SEC,
  STEP_OFF_PAUSE_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);

/** True if the given tile is a seat tile for any chair (work or rest). */
function isChairTile(col: number, row: number, seats: Map<string, Seat>): boolean {
  for (const seat of seats.values()) {
    if (seat.seatCol === col && seat.seatRow === row) return true;
  }
  return false;
}

/** @internal */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return READING_TOOLS.has(tool);
}

/** Character should be at their work seat (not wandering/resting) when they are
 *  actively working OR when the tier-2 awaiting-user state has latched. Both cases
 *  read visually as "at the desk"; the animation distinction (typing vs static
 *  vs waiting bubble) is handled in getCharacterSprite and the bubble renderer. */
function shouldBeSeated(ch: Character): boolean {
  return ch.isActive || ch.awaitingSince != null;
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  workSeatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    // New agents spawn idle. isActive flips true on UserPromptSubmit (first real
    // interaction). This keeps the overlay from reading "Working…" on a session
    // the user hasn't touched yet.
    isActive: false,
    workSeatId,
    restSeatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    awaitingSince: null,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    ptyActivityUntil: 0,
    crashed: false,
    crashedAcknowledged: false,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }

      // On a rest seat and should be working (active or awaiting user) → leave
      // the couch and head to work seat.
      if (shouldBeSeated(ch) && ch.restSeatId) {
        const rest = seats.get(ch.restSeatId);
        if (rest) rest.assigned = false;
        ch.restSeatId = null;
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // No longer meant to be seated: stand up and start wandering (after seatTimer
      // expires). Exception: if on a rest seat, stay seated — rest-seated characters
      // only leave when they become active again.
      if (!shouldBeSeated(ch)) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        if (ch.restSeatId) break;
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        // Short "step-off" pause: the character is currently standing on their
        // chair tile, which visually reads as "working." Force a quick wander
        // hop to get them off the chair before the regular 2–20s roaming pace
        // kicks in on subsequent hops.
        ch.wanderTimer = randomRange(STEP_OFF_PAUSE_MIN_SEC, STEP_OFF_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.IDLE: {
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel

      // If should be seated (active or awaiting user), pathfind to work seat
      // (release any rest-seat claim).
      if (shouldBeSeated(ch)) {
        if (ch.restSeatId) {
          const rest = seats.get(ch.restSeatId);
          if (rest) rest.assigned = false;
          ch.restSeatId = null;
        }
        if (!ch.workSeatId) {
          // No work seat assigned — type in place.
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const seat = seats.get(ch.workSeatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          } else {
            ch.state = CharacterState.TYPE;
            ch.dir = seat.facingDir;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        break;
      }

      // Idle: countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Wander budget expired: try to claim a rest seat instead of going back to a computer.
        if (ch.wanderCount >= ch.wanderLimit && !ch.restSeatId) {
          const restUid = findNearestFreeRestSeat(ch, seats);
          if (restUid) {
            const rest = seats.get(restUid)!;
            rest.assigned = true;
            ch.restSeatId = restUid;
            // The rest-seat tile is in blockedTiles (chair footprint). Unblock it
            // for this pathfinding call so we can actually reach the couch.
            const restKey = `${rest.seatCol},${rest.seatRow}`;
            const wasBlocked = blockedTiles.has(restKey);
            if (wasBlocked) blockedTiles.delete(restKey);
            const path = findPath(
              ch.tileCol,
              ch.tileRow,
              rest.seatCol,
              rest.seatRow,
              tileMap,
              blockedTiles,
            );
            if (wasBlocked) blockedTiles.add(restKey);
            if (path.length > 0) {
              ch.path = path;
              ch.moveProgress = 0;
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
            // No path — release the claim and fall through to wander.
            rest.assigned = false;
            ch.restSeatId = null;
          }
        }

        if (walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        if (shouldBeSeated(ch)) {
          // Should-be-seated arrival: at work seat → TYPE (static pose if no tool
          // or if awaiting the user), otherwise type-in-place or IDLE.
          if (!ch.workSeatId) {
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.workSeatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else if (ch.restSeatId) {
          // Idle arrival at a claimed rest seat → sit.
          const rest = seats.get(ch.restSeatId);
          if (rest && ch.tileCol === rest.seatCol && ch.tileRow === rest.seatRow) {
            ch.state = CharacterState.TYPE;
            ch.dir = rest.facingDir;
            // Reset wander budget so we sit for a while before roaming again.
            ch.wanderCount = 0;
            ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
          } else {
            // We lost the rest seat during travel (shouldn't usually happen).
            if (rest) rest.assigned = false;
            ch.restSeatId = null;
            ch.state = CharacterState.IDLE;
          }
        } else {
          ch.state = CharacterState.IDLE;
          // If we happen to have landed on a chair tile (e.g. isActive flipped
          // false mid-walk to a work seat), use the short step-off pause so we
          // don't idle on the chair and imply "working."
          const onChair = isChairTile(ch.tileCol, ch.tileRow, seats);
          ch.wanderTimer = onChair
            ? randomRange(STEP_OFF_PAUSE_MIN_SEC, STEP_OFF_PAUSE_MAX_SEC)
            : randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If should be seated (became active OR awaiting user) while wandering,
      // repath to work seat.
      if (shouldBeSeated(ch) && ch.workSeatId) {
        const seat = seats.get(ch.workSeatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            // Release any rest-seat claim — we're diverting to the desk.
            if (ch.restSeatId) {
              const rest = seats.get(ch.restSeatId);
              if (rest) rest.assigned = false;
              ch.restSeatId = null;
            }
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      // Seated but not active: static pose (resting on a couch, or between turns at a desk).
      if (!ch.isActive) {
        return sprites.walk[ch.dir][1];
      }
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Resolve the display label for a character, in priority order:
 *  customTitle (user /name) → agentName (team role) → terminalName → "Agent #id" */
export function characterLabel(ch: {
  customTitle?: string;
  agentName?: string;
  terminalName?: string;
  id: number;
}): string {
  return ch.customTitle ?? ch.agentName ?? ch.terminalName ?? `Agent #${ch.id}`;
}

function findNearestFreeRestSeat(ch: Character, seats: Map<string, Seat>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [uid, seat] of seats) {
    if (seat.assigned) continue;
    if (seat.role !== 'rest') continue;
    const dist = Math.abs(seat.seatCol - ch.tileCol) + Math.abs(seat.seatRow - ch.tileRow);
    if (dist < bestDist) {
      bestDist = dist;
      best = uid;
    }
  }
  return best;
}
