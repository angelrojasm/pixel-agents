/**
 * Rest-seat FSM (Task 3 of the m1.5 character-behaviors slice). Idle
 * characters wander then claim the nearest free REST seat (couch); active or
 * awaiting-user characters release any rest claim and walk to their work seat
 * (`seatId`). Drives `updateCharacter` directly with a synthetic seats map and
 * a tiny hand-built tileMap — no OfficeState needed.
 *
 * Run with: npm run test:webview -- test/rest-seat-fsm.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  createCharacter,
  findNearestFreeRestSeat,
  isChairTile,
  shouldBeSeated,
  updateCharacter,
} from '../src/office/engine/characters.js';
import { getWalkableTiles } from '../src/office/layout/tileMap.js';
import type { Seat } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

/** All-floor tileMap of the given size — every tile walkable unless a test
 *  overrides individual cells. */
function openTileMap(cols: number, rows: number): TileType[][] {
  return Array.from({ length: rows }, () => new Array<TileType>(cols).fill(TileType.FLOOR_1));
}

function makeSeat(
  uid: string,
  seatCol: number,
  seatRow: number,
  role: 'work' | 'rest',
  assigned = false,
  facingDir: Direction = Direction.DOWN,
): Seat {
  return { uid, seatCol, seatRow, facingDir, assigned, role };
}

describe('createCharacter', () => {
  it('spawns idle (isActive false)', () => {
    expect(createCharacter(1, 0, null, null).isActive).toBe(false);
  });
});

describe('shouldBeSeated', () => {
  it('is true when active OR awaiting', () => {
    const ch = createCharacter(1, 0, null, null);
    expect(shouldBeSeated(ch)).toBe(false);
    ch.isActive = true;
    expect(shouldBeSeated(ch)).toBe(true);
    ch.isActive = false;
    ch.awaitingSince = 123;
    expect(shouldBeSeated(ch)).toBe(true);
  });
});

describe('isChairTile', () => {
  it('is true for any seat tile (work or rest), false elsewhere', () => {
    const seats = new Map<string, Seat>([
      ['work-1', makeSeat('work-1', 2, 2, 'work')],
      ['rest-1', makeSeat('rest-1', 5, 5, 'rest')],
    ]);
    expect(isChairTile(2, 2, seats)).toBe(true);
    expect(isChairTile(5, 5, seats)).toBe(true);
    expect(isChairTile(0, 0, seats)).toBe(false);
  });
});

describe('findNearestFreeRestSeat', () => {
  it('picks nearest free rest seat, skips work and assigned', () => {
    const ch = createCharacter(1, 0, null, null); // tileCol=1, tileRow=1
    const seats = new Map<string, Seat>([
      ['work-1', makeSeat('work-1', 1, 2, 'work')], // distance 1 but work — skip
      ['rest-assigned', makeSeat('rest-assigned', 1, 0, 'rest', true)], // distance 1 but assigned — skip
      ['rest-far', makeSeat('rest-far', 4, 4, 'rest')], // distance 6
      ['rest-near', makeSeat('rest-near', 2, 1, 'rest')], // distance 1, free — nearest match
    ]);
    expect(findNearestFreeRestSeat(ch, seats)).toBe('rest-near');
  });
});

describe('updateCharacter — rest-seat FSM', () => {
  it('wanderLimit reached → claims rest seat and walks to it', () => {
    const tileMap = openTileMap(5, 5);
    const workSeat = makeSeat('work-1', 0, 0, 'work');
    const restSeat = makeSeat('rest-1', 3, 1, 'rest'); // Manhattan distance 2 from (1,1)
    const seats = new Map<string, Seat>([
      ['work-1', workSeat],
      ['rest-1', restSeat],
    ]);
    const blockedTiles = new Set<string>(['0,0', '3,1']);
    const walkableTiles = getWalkableTiles(tileMap, blockedTiles);

    const ch = createCharacter(2, 0, null, null); // tileCol=1, tileRow=1
    ch.state = CharacterState.IDLE;
    ch.wanderCount = ch.wanderLimit;
    ch.wanderTimer = 0.05;

    updateCharacter(ch, 0.1, walkableTiles, seats, tileMap, blockedTiles);

    expect(ch.restSeatId).toBe('rest-1');
    expect(restSeat.assigned).toBe(true);
    expect(ch.state).toBe(CharacterState.WALK);
    expect(ch.path.length).toBeGreaterThan(0);
    // Temporary unblock/reblock leaves blockedTiles exactly as it found it.
    expect(blockedTiles.has('3,1')).toBe(true);
  });

  it('claim rolls back when the rest seat is unreachable', () => {
    const tileMap = openTileMap(5, 5);
    // Wall off the rest seat at the grid corner (4,4): its only two neighbors
    // (3,4) and (4,3) are both walls, so it's unreachable even once unblocked.
    tileMap[3][4] = TileType.WALL; // row 3, col 4
    tileMap[4][3] = TileType.WALL; // row 4, col 3
    const restSeat = makeSeat('rest-iso', 4, 4, 'rest');
    const seats = new Map<string, Seat>([['rest-iso', restSeat]]);
    const blockedTiles = new Set<string>(['4,4']);
    const walkableTiles = getWalkableTiles(tileMap, blockedTiles);

    const ch = createCharacter(3, 0, null, null); // tileCol=1, tileRow=1
    ch.state = CharacterState.IDLE;
    ch.wanderCount = ch.wanderLimit;
    ch.wanderTimer = 0.05;

    updateCharacter(ch, 0.1, walkableTiles, seats, tileMap, blockedTiles);

    expect(ch.restSeatId).toBeNull();
    expect(restSeat.assigned).toBe(false);
    // No leaked unblock: the seat tile is blocked again after the failed probe.
    expect(blockedTiles.has('4,4')).toBe(true);
  });

  it('sub-agents never claim rest seats', () => {
    const tileMap = openTileMap(5, 5);
    const restSeat = makeSeat('rest-1', 3, 1, 'rest');
    const seats = new Map<string, Seat>([['rest-1', restSeat]]);
    const blockedTiles = new Set<string>(['3,1']);
    const walkableTiles = getWalkableTiles(tileMap, blockedTiles);

    const ch = createCharacter(4, 0, null, null); // tileCol=1, tileRow=1
    ch.isSubagent = true;
    ch.state = CharacterState.IDLE;
    ch.wanderCount = ch.wanderLimit;
    ch.wanderTimer = 0.05;

    updateCharacter(ch, 0.1, walkableTiles, seats, tileMap, blockedTiles);

    expect(ch.restSeatId).toBeNull();
    expect(restSeat.assigned).toBe(false);
  });

  it('work starting while resting releases the couch and walks to the work seat', () => {
    const tileMap = openTileMap(5, 5);
    const workSeat = makeSeat('work-1', 0, 0, 'work', true);
    const restSeat = makeSeat('rest-1', 3, 1, 'rest', true, Direction.RIGHT);
    const seats = new Map<string, Seat>([
      ['work-1', workSeat],
      ['rest-1', restSeat],
    ]);
    // The character's own work seat is temporarily unblocked (as OfficeState's
    // withOwnSeatUnblocked would do); the rest seat it's sitting on stays blocked.
    const blockedTiles = new Set<string>(['3,1']);
    const walkableTiles = getWalkableTiles(tileMap, blockedTiles);

    const ch = createCharacter(5, 0, 'work-1', workSeat);
    ch.tileCol = restSeat.seatCol;
    ch.tileRow = restSeat.seatRow;
    ch.state = CharacterState.TYPE;
    ch.restSeatId = 'rest-1';
    ch.isActive = false;

    // Work starts while resting on the couch.
    ch.isActive = true;

    updateCharacter(ch, 0.1, walkableTiles, seats, tileMap, blockedTiles); // TYPE branch: release couch
    expect(ch.restSeatId).toBeNull();
    expect(restSeat.assigned).toBe(false);
    expect(ch.state).toBe(CharacterState.IDLE);

    updateCharacter(ch, 0.1, walkableTiles, seats, tileMap, blockedTiles); // IDLE branch: path to work seat
    expect(ch.state).toBe(CharacterState.WALK);
    expect(ch.path.length).toBeGreaterThan(0);
  });

  it('awaitingSince alone keeps the character seated at the work seat', () => {
    const tileMap = openTileMap(5, 5);
    const workSeat = makeSeat('work-1', 2, 2, 'work', true);
    const seats = new Map<string, Seat>([['work-1', workSeat]]);
    const blockedTiles = new Set<string>();
    const walkableTiles = getWalkableTiles(tileMap, blockedTiles);

    const ch = createCharacter(6, 0, 'work-1', workSeat);
    ch.state = CharacterState.TYPE;
    ch.isActive = false;
    ch.awaitingSince = 123;
    ch.seatTimer = 0;

    for (let i = 0; i < 50; i++) {
      updateCharacter(ch, 1, walkableTiles, seats, tileMap, blockedTiles);
      expect(ch.state).toBe(CharacterState.TYPE);
    }
  });

  it('rest seat lost mid-travel → releases claim and goes IDLE', () => {
    const tileMap = openTileMap(5, 5);
    const restSeat = makeSeat('rest-1', 3, 1, 'rest', true);
    const seats = new Map<string, Seat>([['rest-1', restSeat]]);
    const blockedTiles = new Set<string>(['3,1']);
    const walkableTiles = getWalkableTiles(tileMap, blockedTiles);

    const ch = createCharacter(7, 0, null, null); // tileCol=1, tileRow=1
    ch.state = CharacterState.WALK;
    ch.restSeatId = 'rest-1';
    ch.path = [
      { col: 2, row: 1 },
      { col: 3, row: 1 },
    ];

    // dt=1 with WALK_SPEED_PX_PER_SEC=48 / TILE_SIZE=16 moves exactly one tile per call.
    updateCharacter(ch, 1, walkableTiles, seats, tileMap, blockedTiles); // -> (2,1), path=[{3,1}]
    expect(ch.tileCol).toBe(2);
    expect(ch.path.length).toBe(1);

    // Seat removed from the map mid-travel (e.g. furniture deleted via layout edit).
    seats.delete('rest-1');

    updateCharacter(ch, 1, walkableTiles, seats, tileMap, blockedTiles); // -> (3,1), path=[]
    expect(ch.tileCol).toBe(3);
    expect(ch.path.length).toBe(0);

    updateCharacter(ch, 1, walkableTiles, seats, tileMap, blockedTiles); // arrival: no seat found
    expect(ch.restSeatId).toBeNull();
    expect(ch.state).toBe(CharacterState.IDLE);
  });
});
