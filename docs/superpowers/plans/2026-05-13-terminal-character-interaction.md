# Terminal ↔ Character Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the canvas character and the in-panel terminal into a single first-class control surface — focus halos, pty-driven typing animation, sub-agent parent-lines, crashed glyph, hook-health surfacing, restart, and canvas keyboard shortcuts.

**Architecture:** New pure modules (`characterHalo`, `desaturateSprites`, `ptyActivityReducer`, `crashReducer`, `healthMonitor`) own all the logic; React/canvas wrappers are thin and manually-QA'd. Three new ext→webview messages (`agentCrashed`, `hookHealthChanged`, plus an existing-style `agentStatus` re-emit) flow through `broadcastSink`; two webview→ext messages (`acknowledgeCrash`, `restartAgent`) round-trip through `handleWebviewMessage`. The `PtyEventBus` grows a thin `subscribeActivity` channel so a per-character React hook can bump `Character.ptyActivityUntil` without going through React state. The renderer pipes a new `characterHalo` selector + sub-agent line + crashed glyph into the existing entity z-sort pass; the sprite cache gains a `:crashed` cache-key suffix so desaturation is one-time per crash.

**Tech Stack:** React + TypeScript (Vite, webview), xterm.js v6 (already loaded), Node test runner (`node --import tsx/esm --test`) for webview, Vitest for server, VS Code Extension API for messaging + pty exit surfacing.

**Spec:** `docs/ux/terminal-character-interaction.md`

**Testing approach:** Pure modules get failing-test-first TDD via the existing harnesses (`webview-ui/test/*.test.ts` for the webview, `server/__tests__/*.test.ts` for the server). React-coupled wrappers (`useCharacterPtyActivity` hook, `HookHealthToast`, `PanelHeader` dot, `TerminalPane` restart button) are manual-QA only — JSDOM cannot render xterm and standing up a wired-DOM rig for one bundle is not warranted. Existing tests stay green throughout.

---

## File Structure

| File                                                           | Responsibility                                                                                            | Task  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----- |
| `webview-ui/src/constants.ts`                                  | Add focus-halo, glyph, sub-agent-line, pty-activity, hook-health constants (sizing/timing/dash patterns). | 1     |
| `server/src/constants.ts`                                      | Add `HOOK_HEARTBEAT_MISS_*` and `HOOK_HEALTH_BOOT_GRACE_MS` shared with extension/server.                 | 1     |
| `webview-ui/src/office/types.ts`                               | Add `ptyActivityUntil`, `crashed`, `crashedAcknowledged` to `Character`.                                  | 2     |
| `webview-ui/src/office/engine/characters.ts`                   | Initialize new Character fields in `createCharacter`.                                                     | 2     |
| `webview-ui/src/office/engine/desaturateSprites.ts` (new)      | Pure HSL saturation cut on a `CharacterSprites` set.                                                      | 3     |
| `webview-ui/test/desaturate-sprites.test.ts` (new)             | Unit tests for `desaturateSprites`.                                                                       | 3     |
| `webview-ui/src/office/sprites/spriteData.ts`                  | Extend cache key for `:crashed` variant via new param to `getCharacterSprites`.                           | 3     |
| `webview-ui/src/office/engine/characterHalo.ts` (new)          | Pure selector `getFocusHaloStyle(ch, isFocused, isAwaitingUser)` → `{ color, dash, width } \| null`.      | 4     |
| `webview-ui/test/character-halo.test.ts` (new)                 | Selector-matrix unit tests for `characterHalo`.                                                           | 4     |
| `webview-ui/src/office/panel/ptyEventBus.ts`                   | Add `subscribeActivity(agentId, cb)` channel.                                                             | 5     |
| `webview-ui/test/pty-event-bus.test.ts`                        | Extend tests to cover `subscribeActivity` + debounce window.                                              | 5     |
| `webview-ui/src/office/panel/ptyActivityReducer.ts` (new)      | Pure debounce reducer: pty bytes → `ptyActivityUntil` timestamp.                                          | 5     |
| `webview-ui/test/pty-activity-reducer.test.ts` (new)           | Unit tests for the reducer.                                                                               | 5     |
| `webview-ui/src/office/panel/useCharacterPtyActivity.ts` (new) | React hook that subscribes via the bus and writes `ptyActivityUntil` onto the character.                  | 5     |
| `webview-ui/src/office/engine/renderer.ts`                     | Render focus halo (before sprite), crashed glyph (after sprite), sub-agent line (under floor entities).   | 6     |
| `webview-ui/src/office/engine/officeState.ts`                  | `setAgentCrashed(id, true/false)`, `acknowledgeCrash(id)`, edit-mode-aware reads.                         | 6     |
| `src/PixelAgentsViewProvider.ts`                               | Dispatch `acknowledgeCrash` + `restartAgent`; emit `agentCrashed` + `hookHealthChanged` via broadcast.    | 7,10  |
| `src/agentManager.ts`                                          | Surface pty exit code → broadcast `agentCrashed`; expose `restartPty(id)`.                                | 7,12  |
| `src/pty/ptyManager.ts`                                        | Add a non-zero-exit-aware callback path on top of existing `onExit`.                                      | 7     |
| `webview-ui/src/hooks/crashReducer.ts` (new)                   | Pure reducer for `agentCrashed`/`acknowledgeCrash` slice.                                                 | 8     |
| `webview-ui/test/crash-reducer.test.ts` (new)                  | Round-trip unit tests for the reducer.                                                                    | 8     |
| `webview-ui/src/hooks/useExtensionMessages.ts`                 | Wire `agentCrashed`/`hookHealthChanged`; expose `acknowledgeCrash` + `restartAgent` callbacks.            | 8,11  |
| `server/src/healthMonitor.ts` (new)                            | Hook-health state machine (boot grace → `ok` → `degraded` → `down`).                                      | 9     |
| `server/__tests__/healthMonitor.test.ts` (new)                 | Full transition matrix.                                                                                   | 9     |
| `server/src/server.ts`                                         | Embed `HealthMonitor`; emit `hookHealthChanged` payloads on transitions.                                  | 10    |
| `webview-ui/src/office/panel/HookHealthToast.tsx` (new)        | Sticky toast bound to webview root, dismissible.                                                          | 11    |
| `webview-ui/src/office/panel/PanelHeader.tsx`                  | Gear-icon dot overlay (rendered when `hookHealth !== 'ok'`).                                              | 11    |
| `webview-ui/src/App.tsx`                                       | Mount `HookHealthToast`, wire canvas keyboard shortcuts.                                                  | 11,13 |
| `webview-ui/src/office/panel/TerminalPane.tsx`                 | Restart button rendered when `ptyExit` was observed.                                                      | 12    |
| `webview-ui/src/office/components/OfficeCanvas.tsx`            | Keyboard-shortcut wiring for `Cmd+1..9` and `Cmd+'`.                                                      | 13    |

---

## Task 1: Add constants

**Files:**

- Modify: `webview-ui/src/constants.ts`
- Modify: `server/src/constants.ts`

- [ ] **Step 1: Append focus-halo / glyph / sub-agent-line / pty-activity / hook-health constants to `webview-ui/src/constants.ts`**

Append to the end of `webview-ui/src/constants.ts`:

```ts
// ── Terminal ↔ Character Interaction ────────────────────────
// Focus halo
export const FOCUS_HALO_WIDTH_PX = 2;
export const FOCUS_HALO_INSET_PX = 2;
export const FOCUS_HALO_DOTTED_DASH: [number, number] = [1, 1];
export const FOCUS_HALO_SOLID_DASH: number[] = [];
export const FOCUS_HALO_COLOR_ACCENT = PANEL_ACCENT;
export const FOCUS_HALO_COLOR_MUTED = PANEL_MUTED;
export const FOCUS_HALO_COLOR_AWAITING = PANEL_WAITING;
export const FOCUS_HALO_COLOR_WARNING = 'var(--color-warning)';

// Crashed glyph
export const CRASHED_GLYPH_SIZE_PX = 5;
export const CRASHED_GLYPH_OFFSET_X_PX = TILE_SIZE - 6;
export const CRASHED_GLYPH_OFFSET_Y_PX = -6;
export const CRASHED_GLYPH_BG = 'var(--color-danger)';
export const CRASHED_GLYPH_BORDER = '#0a0a14';
export const CRASHED_DESATURATION_PCT = 60;

// Sub-agent parent-link line
export const SUBAGENT_LINK_DASH: [number, number] = [2, 2];
export const SUBAGENT_LINK_WIDTH_PX = 1;
export const SUBAGENT_LINK_FLASH_DURATION_MS = 250;
export const SUBAGENT_LINK_COLOR = PANEL_MUTED;

// PTY → animation timing
export const PTY_ACTIVITY_HOLD_MS = 200;
export const PTY_SILENCE_TO_READING_MS = 1000;

// Hook-health UI
export const HOOK_HEALTH_DOT_SIZE_PX = 4;
export const HOOK_HEALTH_TOAST_DURATION_MS = 0;
export const HOOK_HEALTH_DOT_COLOR_DOWN = 'var(--color-danger)';
export const HOOK_HEALTH_DOT_COLOR_DEGRADED = 'var(--color-warning)';
```

- [ ] **Step 2: Append hook-health timing constants to `server/src/constants.ts`**

Append to the end of `server/src/constants.ts`:

```ts
// ── Hook Health Monitor ─────────────────────────────────────
/** Missed heartbeats before ok → degraded */
export const HOOK_HEARTBEAT_MISS_DEGRADED = 2;
/** Missed heartbeats before degraded → down */
export const HOOK_HEARTBEAT_MISS_DOWN = 3;
/** Suppress `down` events while the webview is booting */
export const HOOK_HEALTH_BOOT_GRACE_MS = 3000;
/** Interval between heartbeat checks */
export const HOOK_HEARTBEAT_INTERVAL_MS = 5000;
```

- [ ] **Step 3: Typecheck both packages**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && cd ../server && npx tsc --noEmit -p tsconfig.test.json && cd /Users/angel/Desktop/pixel-agents
```

Expected: PASS for both.

- [ ] **Step 4: Lint**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/constants.ts server/src/constants.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: add focus halo + glyph + pty-activity + hook-health constants

Adds the full constant set for the Terminal ↔ Character Interaction
bundle: focus-halo width/inset/dash + accent/muted/warning color
aliases, crashed-glyph size/offset/desaturation, sub-agent line dash
pattern + flash duration, PTY activity hold + silence-to-reading
thresholds, hook-health dot/toast sizing, and the server-side
heartbeat miss thresholds + boot grace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend Character struct

**Files:**

- Modify: `webview-ui/src/office/types.ts`
- Modify: `webview-ui/src/office/engine/characters.ts`

- [ ] **Step 1: Add three new fields to the `Character` interface**

In `webview-ui/src/office/types.ts`, locate the `Character` interface (currently ending at `outputTokens: number;`). Insert the new fields directly above `inputTokens`:

```ts
/** ms-since-epoch timestamp until which the character is considered "actively
 *  typing" because the focused pty emitted bytes recently. 0 means inactive.
 *  Bumped by useCharacterPtyActivity; read by getCharacterSprite via FSM. */
ptyActivityUntil: number;
/** True when this agent's pty exited with non-zero code; flips off on restart
 *  or on user acknowledgement. Drives desaturation + glyph in the renderer. */
crashed: boolean;
/** Ephemeral: true once the user clicked the crashed glyph or × to ack. Resets
 *  on next ptyExit, on webview reload, and on matrixEffect='despawn'. */
crashedAcknowledged: boolean;
```

- [ ] **Step 2: Initialize the new fields in `createCharacter`**

In `webview-ui/src/office/engine/characters.ts`, locate the return object inside `createCharacter` (currently ending `outputTokens: 0,`). Insert the three new fields immediately above `inputTokens`:

```ts
    ptyActivityUntil: 0,
    crashed: false,
    crashedAcknowledged: false,
    inputTokens: 0,
    outputTokens: 0,
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && cd ..
```

Expected: PASS.

- [ ] **Step 4: Run existing webview tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test && cd ..
```

Expected: PASS — no behavior change yet.

- [ ] **Step 5: Lint**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/office/types.ts webview-ui/src/office/engine/characters.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: extend Character with ptyActivityUntil + crash flags

Adds three new fields to Character — ptyActivityUntil (timestamp,
ms), crashed (boolean), crashedAcknowledged (boolean, ephemeral) —
and initializes them in createCharacter. No behavior change yet;
later tasks consume these fields from the renderer + FSM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: desaturateSprites module + sprite-cache crash variant (TDD)

**Files:**

- Create: `webview-ui/src/office/engine/desaturateSprites.ts`
- Create: `webview-ui/test/desaturate-sprites.test.ts`
- Modify: `webview-ui/src/office/sprites/spriteData.ts`

The desaturation lives in a pure module so the test can run in node without canvas. Cache key extension uses the existing string-keyed `spriteCache` — adds a `:crashed` suffix when desaturation is requested.

- [ ] **Step 1: Write the failing test**

Create `webview-ui/test/desaturate-sprites.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { desaturateSpriteData } from '../src/office/engine/desaturateSprites.ts';

test('desaturateSpriteData zeroes empty pixels untouched', () => {
  const sprite = [
    ['', '#ff0000', ''],
    ['', '', ''],
  ];
  const out = desaturateSpriteData(sprite, 60);
  assert.equal(out[0][0], '');
  assert.equal(out[0][2], '');
  assert.equal(out[1][1], '');
});

test('desaturateSpriteData cuts saturation by the given percentage', () => {
  // Pure red (#ff0000) is HSL(0, 100%, 50%). 60% cut → 40% saturation.
  // Approx RGB at HSL(0, 40%, 50%) ≈ (179, 77, 77) i.e. #b34d4d.
  const sprite = [['#ff0000']];
  const out = desaturateSpriteData(sprite, 60);
  const px = out[0][0];
  assert.equal(px.length, 7, `expected 7-char hex, got ${px}`);
  const r = parseInt(px.slice(1, 3), 16);
  const g = parseInt(px.slice(3, 5), 16);
  const b = parseInt(px.slice(5, 7), 16);
  assert.ok(r > g + 50, 'red still dominant');
  assert.ok(g > 50 && g < 120, 'green between mid range');
  assert.ok(Math.abs(g - b) < 10, 'green ≈ blue');
});

test('desaturateSpriteData preserves alpha suffix on 9-char hex', () => {
  const sprite = [['#ff000080']];
  const out = desaturateSpriteData(sprite, 60);
  assert.equal(out[0][0].length, 9);
  assert.equal(out[0][0].slice(7), '80');
});

test('desaturateSpriteData with 0% is a passthrough', () => {
  const sprite = [['#ff0000']];
  const out = desaturateSpriteData(sprite, 0);
  assert.equal(out[0][0].toLowerCase(), '#ff0000');
});

test('desaturateSpriteData with 100% pushes to grayscale', () => {
  const sprite = [['#ff0000']];
  const out = desaturateSpriteData(sprite, 100);
  const px = out[0][0];
  const r = parseInt(px.slice(1, 3), 16);
  const g = parseInt(px.slice(3, 5), 16);
  const b = parseInt(px.slice(5, 7), 16);
  assert.ok(Math.abs(r - g) < 3 && Math.abs(g - b) < 3, 'all channels equal at full desat');
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: FAIL with `Cannot find module '../src/office/engine/desaturateSprites.ts'`.

- [ ] **Step 3: Create `desaturateSprites.ts`**

Create `webview-ui/src/office/engine/desaturateSprites.ts`:

```ts
import { adjustSprite } from '../colorize.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import type { SpriteData } from '../types.js';
import { Direction as Dir } from '../types.js';

/** Cut saturation by `percent` (0..100). Operates on a single SpriteData; uses
 *  the existing `adjustSprite` HSL pipeline via a negative `s` shift. */
export function desaturateSpriteData(sprite: SpriteData, percent: number): SpriteData {
  if (percent <= 0) return sprite;
  // adjustSprite's `s` is a -100..100 shift; -percent gives a saturation cut.
  return adjustSprite(sprite, { h: 0, s: -percent, b: 0, c: 0 });
}

/** Apply desaturation to every frame in a CharacterSprites set. */
export function desaturateCharacterSprites(
  sprites: CharacterSprites,
  percent: number,
): CharacterSprites {
  if (percent <= 0) return sprites;
  const cut = (s: SpriteData) => desaturateSpriteData(s, percent);
  const cutWalk = (
    arr: [SpriteData, SpriteData, SpriteData, SpriteData],
  ): [SpriteData, SpriteData, SpriteData, SpriteData] => [
    cut(arr[0]),
    cut(arr[1]),
    cut(arr[2]),
    cut(arr[3]),
  ];
  const cutPair = (arr: [SpriteData, SpriteData]): [SpriteData, SpriteData] => [
    cut(arr[0]),
    cut(arr[1]),
  ];
  return {
    walk: {
      [Dir.DOWN]: cutWalk(sprites.walk[Dir.DOWN]),
      [Dir.UP]: cutWalk(sprites.walk[Dir.UP]),
      [Dir.RIGHT]: cutWalk(sprites.walk[Dir.RIGHT]),
      [Dir.LEFT]: cutWalk(sprites.walk[Dir.LEFT]),
    },
    typing: {
      [Dir.DOWN]: cutPair(sprites.typing[Dir.DOWN]),
      [Dir.UP]: cutPair(sprites.typing[Dir.UP]),
      [Dir.RIGHT]: cutPair(sprites.typing[Dir.RIGHT]),
      [Dir.LEFT]: cutPair(sprites.typing[Dir.LEFT]),
    },
    reading: {
      [Dir.DOWN]: cutPair(sprites.reading[Dir.DOWN]),
      [Dir.UP]: cutPair(sprites.reading[Dir.UP]),
      [Dir.RIGHT]: cutPair(sprites.reading[Dir.RIGHT]),
      [Dir.LEFT]: cutPair(sprites.reading[Dir.LEFT]),
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: PASS — five new tests pass; existing tests unchanged.

- [ ] **Step 5: Extend `getCharacterSprites` cache key for crashed variant**

In `webview-ui/src/office/sprites/spriteData.ts`, change the `getCharacterSprites` signature and body. Replace the existing function (lines 121–190) with:

```ts
export function getCharacterSprites(
  paletteIndex: number,
  hueShift = 0,
  crashed = false,
): CharacterSprites {
  const cacheKey = `${paletteIndex}:${hueShift}${crashed ? ':crashed' : ''}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  let sprites: CharacterSprites;

  if (loadedCharacters) {
    const char = loadedCharacters[paletteIndex % loadedCharacters.length];
    const d = char.down;
    const u = char.up;
    const rt = char.right;
    const flip = flipSpriteHorizontal;

    sprites = {
      walk: {
        [Dir.DOWN]: [d[0], d[1], d[2], d[1]],
        [Dir.UP]: [u[0], u[1], u[2], u[1]],
        [Dir.RIGHT]: [rt[0], rt[1], rt[2], rt[1]],
        [Dir.LEFT]: [flip(rt[0]), flip(rt[1]), flip(rt[2]), flip(rt[1])],
      },
      typing: {
        [Dir.DOWN]: [d[3], d[4]],
        [Dir.UP]: [u[3], u[4]],
        [Dir.RIGHT]: [rt[3], rt[4]],
        [Dir.LEFT]: [flip(rt[3]), flip(rt[4])],
      },
      reading: {
        [Dir.DOWN]: [d[5], d[6]],
        [Dir.UP]: [u[5], u[6]],
        [Dir.RIGHT]: [rt[5], rt[6]],
        [Dir.LEFT]: [flip(rt[5]), flip(rt[6])],
      },
    };
  } else {
    const e = emptySprite(16, 32);
    const walkSet: [SpriteData, SpriteData, SpriteData, SpriteData] = [e, e, e, e];
    const pairSet: [SpriteData, SpriteData] = [e, e];
    sprites = {
      walk: {
        [Dir.DOWN]: walkSet,
        [Dir.UP]: walkSet,
        [Dir.RIGHT]: walkSet,
        [Dir.LEFT]: walkSet,
      },
      typing: {
        [Dir.DOWN]: pairSet,
        [Dir.UP]: pairSet,
        [Dir.RIGHT]: pairSet,
        [Dir.LEFT]: pairSet,
      },
      reading: {
        [Dir.DOWN]: pairSet,
        [Dir.UP]: pairSet,
        [Dir.RIGHT]: pairSet,
        [Dir.LEFT]: pairSet,
      },
    };
  }

  if (hueShift !== 0) {
    sprites = hueShiftSprites(sprites, hueShift);
  }
  if (crashed) {
    const { desaturateCharacterSprites } =
      require('../engine/desaturateSprites.js') as typeof import('../engine/desaturateSprites.js');
    const { CRASHED_DESATURATION_PCT } =
      require('../../constants.js') as typeof import('../../constants.js');
    sprites = desaturateCharacterSprites(sprites, CRASHED_DESATURATION_PCT);
  }

  spriteCache.set(cacheKey, sprites);
  return sprites;
}
```

The `require` calls inside the conditional avoid pulling `engine/` into `sprites/` at module-load time (which would create a circular import — `engine/renderer.ts` already imports from `sprites/`). Webpack/Vite handle CJS-style `require` in ESM via interop; this matches the existing project pattern in `webview-ui/src/office/engine/officeState.ts` for late binding.

If the runtime doesn't tolerate `require` (Vite is strict about CJS interop), replace the `require` calls with top-level `import` statements that point at sibling modules — the `desaturateSprites.ts` file imports only `colorize.js` and `types.js`, so there is no actual cycle. Run typecheck (next step) and fall back to top-level imports if needed.

- [ ] **Step 6: Typecheck — if `require` fails, switch to top-level imports**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit
```

If the typecheck fails with "Cannot find name 'require'", replace the conditional `require()` lines with top-level imports at the top of `spriteData.ts`:

```ts
import { CRASHED_DESATURATION_PCT } from '../../constants.js';
import { desaturateCharacterSprites } from '../engine/desaturateSprites.js';
```

and replace the conditional block body with:

```ts
if (crashed) {
  sprites = desaturateCharacterSprites(sprites, CRASHED_DESATURATION_PCT);
}
```

Re-run typecheck: it must PASS.

- [ ] **Step 7: Run tests, lint, and commit**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test && cd ..
npm run lint
```

Expected: both PASS.

```bash
git add webview-ui/src/office/engine/desaturateSprites.ts webview-ui/test/desaturate-sprites.test.ts webview-ui/src/office/sprites/spriteData.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: desaturateSprites + crashed cache variant

Adds a pure desaturateSpriteData / desaturateCharacterSprites pair
that walks each SpriteData via the existing adjustSprite HSL pipeline
with a negative saturation shift. Extends getCharacterSprites with
an optional `crashed` flag that appends ":crashed" to the cache key
and pipes the sprite set through desaturateCharacterSprites once
(cached for subsequent frames). Five unit tests cover empty pixels,
percentage scaling, alpha preservation, no-op at 0%, and grayscale
push at 100%.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: characterHalo selector (TDD)

**Files:**

- Create: `webview-ui/src/office/engine/characterHalo.ts`
- Create: `webview-ui/test/character-halo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `webview-ui/test/character-halo.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOCUS_HALO_COLOR_ACCENT,
  FOCUS_HALO_COLOR_AWAITING,
  FOCUS_HALO_COLOR_MUTED,
  FOCUS_HALO_COLOR_WARNING,
  FOCUS_HALO_DOTTED_DASH,
  FOCUS_HALO_SOLID_DASH,
} from '../src/constants.ts';
import { getFocusHaloStyle } from '../src/office/engine/characterHalo.ts';

interface HaloInput {
  isActive: boolean;
  isFocused: boolean;
  awaitingSince: number | null;
  ptyStubFocused?: boolean;
}

function input(overrides: Partial<HaloInput>): HaloInput {
  return { isActive: false, isFocused: false, awaitingSince: null, ...overrides };
}

test('idle + not focused → no halo', () => {
  assert.equal(getFocusHaloStyle(input({})), null);
});

test('idle + focused → dotted accent halo', () => {
  const style = getFocusHaloStyle(input({ isFocused: true }));
  assert.notEqual(style, null);
  assert.deepEqual(style!.dash, FOCUS_HALO_DOTTED_DASH);
  assert.equal(style!.color, FOCUS_HALO_COLOR_ACCENT);
});

test('active + focused → solid accent halo', () => {
  const style = getFocusHaloStyle(input({ isActive: true, isFocused: true }));
  assert.deepEqual(style!.dash, FOCUS_HALO_SOLID_DASH);
  assert.equal(style!.color, FOCUS_HALO_COLOR_ACCENT);
});

test('active + NOT focused → solid muted halo', () => {
  const style = getFocusHaloStyle(input({ isActive: true, isFocused: false }));
  assert.deepEqual(style!.dash, FOCUS_HALO_SOLID_DASH);
  assert.equal(style!.color, FOCUS_HALO_COLOR_MUTED);
});

test('awaiting user + focused → solid amber halo', () => {
  const style = getFocusHaloStyle(input({ isFocused: true, awaitingSince: Date.now() }));
  assert.equal(style!.color, FOCUS_HALO_COLOR_AWAITING);
  assert.deepEqual(style!.dash, FOCUS_HALO_SOLID_DASH);
});

test('pty stub + focused → solid warning halo', () => {
  const style = getFocusHaloStyle(input({ isFocused: true, ptyStubFocused: true }));
  assert.equal(style!.color, FOCUS_HALO_COLOR_WARNING);
});

test('pty stub overrides accent priority', () => {
  const style = getFocusHaloStyle(input({ isActive: true, isFocused: true, ptyStubFocused: true }));
  assert.equal(style!.color, FOCUS_HALO_COLOR_WARNING);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: FAIL with module-not-found for `characterHalo.ts`.

- [ ] **Step 3: Create `characterHalo.ts`**

Create `webview-ui/src/office/engine/characterHalo.ts`:

```ts
import {
  FOCUS_HALO_COLOR_ACCENT,
  FOCUS_HALO_COLOR_AWAITING,
  FOCUS_HALO_COLOR_MUTED,
  FOCUS_HALO_COLOR_WARNING,
  FOCUS_HALO_DOTTED_DASH,
  FOCUS_HALO_SOLID_DASH,
  FOCUS_HALO_WIDTH_PX,
} from '../../constants.js';

export interface FocusHaloInput {
  isActive: boolean;
  isFocused: boolean;
  awaitingSince: number | null;
  /** True only when the focused agent has usePtyTerminal=on but the pty hasn't
   *  produced its first byte yet (TerminalPaneStub is showing). */
  ptyStubFocused?: boolean;
}

export interface FocusHaloStyle {
  color: string;
  dash: readonly number[];
  width: number;
}

/** Pure selector — picks halo color/dash/width for a single character.
 *  Returns null when no halo should render. */
export function getFocusHaloStyle(input: FocusHaloInput): FocusHaloStyle | null {
  // PTY stub state overrides everything when focused.
  if (input.isFocused && input.ptyStubFocused) {
    return {
      color: FOCUS_HALO_COLOR_WARNING,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Awaiting-user + focused: amber.
  if (input.isFocused && input.awaitingSince != null) {
    return {
      color: FOCUS_HALO_COLOR_AWAITING,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Active + focused: solid accent.
  if (input.isActive && input.isFocused) {
    return {
      color: FOCUS_HALO_COLOR_ACCENT,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Active + NOT focused: solid muted (peripheral cue).
  if (input.isActive && !input.isFocused) {
    return {
      color: FOCUS_HALO_COLOR_MUTED,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Idle + focused: dotted accent.
  if (input.isFocused) {
    return {
      color: FOCUS_HALO_COLOR_ACCENT,
      dash: FOCUS_HALO_DOTTED_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Idle + not focused: no halo.
  return null;
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test && npx tsc --noEmit
```

Expected: PASS — seven new tests pass, typecheck clean.

- [ ] **Step 5: Lint and commit**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint
```

Expected: PASS.

```bash
git add webview-ui/src/office/engine/characterHalo.ts webview-ui/test/character-halo.test.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: characterHalo selector + tests

Pure selector that maps (isActive, isFocused, awaitingSince,
ptyStubFocused) → { color, dash, width } or null. PTY-stub state
overrides everything; awaiting-user overrides accent; active +
non-focused yields a muted halo for peripheral cue. Seven unit
tests cover the full matrix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PtyEventBus.subscribeActivity + ptyActivityReducer (TDD) + useCharacterPtyActivity

**Files:**

- Modify: `webview-ui/src/office/panel/ptyEventBus.ts`
- Modify: `webview-ui/test/pty-event-bus.test.ts`
- Create: `webview-ui/src/office/panel/ptyActivityReducer.ts`
- Create: `webview-ui/test/pty-activity-reducer.test.ts`
- Create: `webview-ui/src/office/panel/useCharacterPtyActivity.ts`

The bus addition is small but needs a test. The reducer is pure and TDD'd. The hook is a manual-QA-only wrapper.

- [ ] **Step 1: Extend `ptyEventBus.ts` — add `subscribeActivity` channel**

Modify `webview-ui/src/office/panel/ptyEventBus.ts`. Add the new event type to the union and slot, and add an `emitActivity` helper plus a debouncing wrapper. Replace the whole file with:

```ts
type DataHandler = (data: string) => void;
type ExitHandler = (info: { code: number; signal?: string }) => void;
type ScrollbackHandler = (lines: string[]) => void;
type ActivityHandler = () => void;

interface AgentSubscribers {
  ptyData: Set<DataHandler>;
  ptyExit: Set<ExitHandler>;
  ptyScrollback: Set<ScrollbackHandler>;
  ptyActivity: Set<ActivityHandler>;
}

type Handler<E extends keyof AgentSubscribers> = E extends 'ptyData'
  ? DataHandler
  : E extends 'ptyExit'
    ? ExitHandler
    : E extends 'ptyScrollback'
      ? ScrollbackHandler
      : ActivityHandler;

/**
 * Per-agent event router for pty wire messages. xterm.js renderers subscribe
 * imperatively for an agentId; useExtensionMessages emits as messages arrive.
 * Keeps React state out of the per-keystroke render path.
 *
 * The `ptyActivity` channel fires *whenever* ptyData arrives — same dispatch
 * site, separate fan-out — so consumers that only care about "is bytes
 * flowing right now" don't have to subscribe to the full data stream.
 */
export class PtyEventBus {
  private agents = new Map<number, AgentSubscribers>();

  private slot(agentId: number): AgentSubscribers {
    let s = this.agents.get(agentId);
    if (!s) {
      s = {
        ptyData: new Set(),
        ptyExit: new Set(),
        ptyScrollback: new Set(),
        ptyActivity: new Set(),
      };
      this.agents.set(agentId, s);
    }
    return s;
  }

  subscribe<E extends keyof AgentSubscribers>(
    agentId: number,
    event: E,
    handler: Handler<E>,
  ): { dispose(): void } {
    const set = this.slot(agentId)[event] as Set<Handler<E>>;
    set.add(handler);
    return {
      dispose: () => {
        set.delete(handler);
      },
    };
  }

  subscribeActivity(agentId: number, handler: ActivityHandler): { dispose(): void } {
    return this.subscribe(agentId, 'ptyActivity', handler);
  }

  emitData(agentId: number, data: string): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyData) h(data);
    for (const h of s.ptyActivity) h();
  }

  emitExit(agentId: number, info: { code: number; signal?: string }): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyExit) h(info);
  }

  emitScrollback(agentId: number, lines: string[]): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyScrollback) h(lines);
  }
}
```

- [ ] **Step 2: Add a test case to `webview-ui/test/pty-event-bus.test.ts`**

Append to the end of `webview-ui/test/pty-event-bus.test.ts`:

```ts
test('subscribeActivity fires on every emitData call', () => {
  const bus = new PtyEventBus();
  let count = 0;
  const sub = bus.subscribeActivity(1, () => {
    count++;
  });
  bus.emitData(1, 'first');
  bus.emitData(1, 'second');
  bus.emitData(1, 'third');
  assert.equal(count, 3);
  sub.dispose();
  bus.emitData(1, 'after-dispose');
  assert.equal(count, 3);
});

test('subscribeActivity is scoped per agent', () => {
  const bus = new PtyEventBus();
  let countAgent1 = 0;
  let countAgent2 = 0;
  bus.subscribeActivity(1, () => countAgent1++);
  bus.subscribeActivity(2, () => countAgent2++);
  bus.emitData(1, 'hi');
  assert.equal(countAgent1, 1);
  assert.equal(countAgent2, 0);
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: PASS — new bus tests + existing tests stay green.

- [ ] **Step 4: TDD the activity reducer**

Create `webview-ui/test/pty-activity-reducer.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PTY_ACTIVITY_HOLD_MS } from '../src/constants.ts';
import {
  ptyActivityInitialState,
  ptyActivityReducer,
  type PtyActivityState,
} from '../src/office/panel/ptyActivityReducer.ts';

test('initial state has 0 lastActivityAt + 0 ptyActivityUntil', () => {
  assert.deepEqual(ptyActivityInitialState, { lastActivityAt: 0, ptyActivityUntil: 0 });
});

test('activity bump sets ptyActivityUntil = now + HOLD_MS', () => {
  const now = 1_000;
  const next = ptyActivityReducer(ptyActivityInitialState, { type: 'bump', now });
  assert.equal(next.lastActivityAt, now);
  assert.equal(next.ptyActivityUntil, now + PTY_ACTIVITY_HOLD_MS);
});

test('activity bump within HOLD_MS extends the deadline', () => {
  const s1 = ptyActivityReducer(ptyActivityInitialState, { type: 'bump', now: 1_000 });
  const s2 = ptyActivityReducer(s1, { type: 'bump', now: 1_100 });
  assert.equal(s2.ptyActivityUntil, 1_100 + PTY_ACTIVITY_HOLD_MS);
});

test('reset returns to initial state', () => {
  const s1 = ptyActivityReducer(ptyActivityInitialState, { type: 'bump', now: 1_000 });
  const s2 = ptyActivityReducer(s1, { type: 'reset' });
  assert.deepEqual(s2, ptyActivityInitialState);
});

test('bump preserves monotonicity of lastActivityAt', () => {
  const s1: PtyActivityState = { lastActivityAt: 2_000, ptyActivityUntil: 2_000 + 200 };
  const s2 = ptyActivityReducer(s1, { type: 'bump', now: 1_500 });
  assert.equal(s2.lastActivityAt, 2_000, 'older bump cannot rewind lastActivityAt');
  assert.equal(s2.ptyActivityUntil, 2_000 + 200, 'deadline preserved');
});
```

- [ ] **Step 5: Run test to confirm it fails**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 6: Create `ptyActivityReducer.ts`**

Create `webview-ui/src/office/panel/ptyActivityReducer.ts`:

```ts
import { PTY_ACTIVITY_HOLD_MS } from '../../constants.js';

export interface PtyActivityState {
  /** ms-since-epoch of the most recent bump */
  lastActivityAt: number;
  /** ms-since-epoch until which the character should be considered typing */
  ptyActivityUntil: number;
}

export type PtyActivityAction = { type: 'bump'; now: number } | { type: 'reset' };

export const ptyActivityInitialState: PtyActivityState = {
  lastActivityAt: 0,
  ptyActivityUntil: 0,
};

/** Pure reducer: a 'bump' action with a newer timestamp pushes the deadline
 *  forward by PTY_ACTIVITY_HOLD_MS; an older-or-equal timestamp is ignored
 *  (defensive against out-of-order delivery). 'reset' returns to initial. */
export function ptyActivityReducer(
  state: PtyActivityState,
  action: PtyActivityAction,
): PtyActivityState {
  switch (action.type) {
    case 'bump':
      if (action.now <= state.lastActivityAt) return state;
      return {
        lastActivityAt: action.now,
        ptyActivityUntil: action.now + PTY_ACTIVITY_HOLD_MS,
      };
    case 'reset':
      return ptyActivityInitialState;
  }
}
```

- [ ] **Step 7: Run tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: PASS — five reducer tests + bus tests + previous tests all green.

- [ ] **Step 8: Create `useCharacterPtyActivity.ts` (React-coupled, manual QA only)**

Create `webview-ui/src/office/panel/useCharacterPtyActivity.ts`:

```ts
import { useEffect, useRef } from 'react';

import type { OfficeState } from '../engine/officeState.js';
import type { PtyEventBus } from './ptyEventBus.js';

/**
 * Subscribes to PtyEventBus activity for a single agent and writes the
 * resulting `ptyActivityUntil` timestamp directly onto the character struct
 * in OfficeState. Bypasses React state on purpose: the renderer reads
 * `ch.ptyActivityUntil` every frame, so we don't want to re-render on every
 * byte. The hook only re-installs on (agentId, bus, officeState) change.
 *
 * Falls through harmlessly when the bus has no data (e.g. usePtyTerminal=off).
 */
export function useCharacterPtyActivity(
  agentId: number | null,
  bus: PtyEventBus,
  officeState: OfficeState,
): void {
  const lastBumpRef = useRef(0);
  useEffect(() => {
    if (agentId === null) return;
    const sub = bus.subscribeActivity(agentId, () => {
      const now = performance.now();
      // Cheap throttle: re-write at most every PTY_ACTIVITY_HOLD_MS / 4 ms;
      // the rendering side cares about the deadline, not the bump count.
      if (now - lastBumpRef.current < 50) return;
      lastBumpRef.current = now;
      const ch = officeState.characters.get(agentId);
      if (!ch) return;
      // Use wall-clock (Date.now) so the renderer's Date.now() comparison
      // is in the same epoch. performance.now is just for throttle.
      ch.ptyActivityUntil = Date.now() + 200; // PTY_ACTIVITY_HOLD_MS — kept inline so the renderer doesn't have to import.
    });
    return () => sub.dispose();
  }, [agentId, bus, officeState]);
}
```

The literal `200` matches `PTY_ACTIVITY_HOLD_MS` — if the constant ever changes, this hook needs updating. The hook is the single place where the wall-clock-vs-performance.now boundary is crossed, so the literal is documented inline.

- [ ] **Step 9: Lint + typecheck**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint && cd webview-ui && npx tsc --noEmit && cd ..
```

Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add webview-ui/src/office/panel/ptyEventBus.ts webview-ui/test/pty-event-bus.test.ts webview-ui/src/office/panel/ptyActivityReducer.ts webview-ui/test/pty-activity-reducer.test.ts webview-ui/src/office/panel/useCharacterPtyActivity.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: PtyEventBus.subscribeActivity + activity reducer + hook

Adds a separate ptyActivity fan-out on PtyEventBus so consumers that
only care about "is bytes flowing" don't subscribe to the full data
stream. Adds a pure ptyActivityReducer with PTY_ACTIVITY_HOLD_MS
debounce + monotonicity guard, covered by 5 unit tests. Adds a
React hook that subscribes per-agent and writes ptyActivityUntil
straight onto the character — bypassing React state so the renderer
reads it every frame without re-render churn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Renderer additions (halo + glyph + sub-agent line) and officeState crash plumbing

**Files:**

- Modify: `webview-ui/src/office/engine/renderer.ts`
- Modify: `webview-ui/src/office/engine/officeState.ts`

- [ ] **Step 1: Add `setAgentCrashed` + `acknowledgeCrash` methods on `OfficeState`**

In `webview-ui/src/office/engine/officeState.ts`, insert these methods immediately after the existing `setAgentTool` method (around line 619):

```ts
  /** Set or clear the crash flag on a regular agent. Resets crashedAcknowledged
   *  to false so a re-crash re-glyphs even if the previous crash was ack'd. */
  setAgentCrashed(id: number, crashed: boolean): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.crashed = crashed;
    ch.crashedAcknowledged = false;
    // Crash also propagates to live sub-agents whose parent is this agent.
    if (crashed) {
      for (const [subId, meta] of this.subagentMeta) {
        if (meta.parentAgentId !== id) continue;
        const sub = this.characters.get(subId);
        if (!sub) continue;
        if (sub.matrixEffect === 'despawn') continue; // no-op for already-despawning
        sub.crashed = true;
        sub.crashedAcknowledged = false;
      }
    }
  }

  /** Mark a crashed agent's glyph as acknowledged (hide until next crash). */
  acknowledgeCrash(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.crashedAcknowledged = true;
  }
```

- [ ] **Step 2: Add focus-halo + glyph + sub-agent-line rendering to renderer.ts**

In `webview-ui/src/office/engine/renderer.ts`, update the imports at the top. Replace the existing import block (lines 2–35) with:

```ts
import type { ColorValue } from '../../components/ui/types.js';
import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  BUTTON_ICON_COLOR,
  BUTTON_ICON_SIZE_FACTOR,
  BUTTON_LINE_WIDTH_MIN,
  BUTTON_LINE_WIDTH_ZOOM_FACTOR,
  BUTTON_MIN_RADIUS,
  BUTTON_RADIUS_ZOOM_FACTOR,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  CRASHED_GLYPH_BG,
  CRASHED_GLYPH_BORDER,
  CRASHED_GLYPH_OFFSET_X_PX,
  CRASHED_GLYPH_OFFSET_Y_PX,
  CRASHED_GLYPH_SIZE_PX,
  DELETE_BUTTON_BG,
  FALLBACK_FLOOR_COLOR,
  FOCUS_HALO_INSET_PX,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  GHOST_BORDER_STROKE,
  GHOST_INVALID_TINT,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  GHOST_VALID_TINT,
  GRID_LINE_COLOR,
  HOVERED_OUTLINE_ALPHA,
  OUTLINE_Z_SORT_OFFSET,
  ROTATE_BUTTON_BG,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  SELECTION_DASH_PATTERN,
  SELECTION_HIGHLIGHT_COLOR,
  SUBAGENT_LINK_COLOR,
  SUBAGENT_LINK_DASH,
  SUBAGENT_LINK_WIDTH_PX,
  VOID_TILE_DASH_PATTERN,
  VOID_TILE_OUTLINE_COLOR,
} from '../../constants.js';
import { getColorizedFloorSprite, hasFloorSprites, WALL_COLOR } from '../floorTiles.js';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache.js';
import {
  BUBBLE_AWAITING_USER_SPRITE,
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, TILE_SIZE, TileType } from '../types.js';
import { getWallInstances, hasWallSprites, wallColorToHex } from '../wallTiles.js';
import { getFocusHaloStyle } from './characterHalo.js';
import { getCharacterSprite } from './characters.js';
import { renderMatrixEffect } from './matrixEffect.js';
```

- [ ] **Step 3: Replace `renderScene` to consume focused agent + crashed sprite variant + halo + glyph + sub-agent line**

Replace the existing `renderScene` function (currently lines 110–214) with:

```ts
/** @internal */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  focusedAgentId: number | null,
  isEditMode: boolean,
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }>,
): void {
  const drawables: ZDrawable[] = [];
  const charById = new Map<number, Character>();
  for (const ch of characters) charById.set(ch.id, ch);

  // Furniture
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = offsetX + f.x * zoom;
    const fy = offsetY + f.y * zoom;
    if (f.mirrored) {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.save();
          c.translate(fx + cached.width, fy);
          c.scale(-1, 1);
          c.drawImage(cached, 0, 0);
          c.restore();
        },
      });
    } else {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.drawImage(cached, fx, fy);
        },
      });
    }
  }

  // Sub-agent → parent dashed lines (only when parent is focused; suppressed in edit mode).
  if (!isEditMode && focusedAgentId != null) {
    for (const ch of characters) {
      if (!ch.isSubagent) continue;
      const meta = subagentMeta.get(ch.id);
      if (!meta || meta.parentAgentId !== focusedAgentId) continue;
      const parent = charById.get(meta.parentAgentId);
      if (!parent) continue;
      const sx = Math.round(offsetX + ch.x * zoom);
      const sy = Math.round(offsetY + ch.y * zoom);
      const ex = Math.round(offsetX + parent.x * zoom);
      const ey = Math.round(offsetY + parent.y * zoom);
      drawables.push({
        zY: 0, // under everything except floor
        draw: (c) => {
          c.save();
          c.strokeStyle = SUBAGENT_LINK_COLOR;
          c.lineWidth = SUBAGENT_LINK_WIDTH_PX;
          c.setLineDash(SUBAGENT_LINK_DASH);
          c.beginPath();
          c.moveTo(sx, sy);
          c.lineTo(ex, ey);
          c.stroke();
          c.restore();
        },
      });
    }
  }

  // Characters
  for (const ch of characters) {
    const sprites = getCharacterSprites(ch.palette, ch.hueShift, ch.crashed);
    const spriteData = getCharacterSprite(ch, sprites);
    const cached = getCachedSprite(spriteData, zoom);
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const drawX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const drawY = Math.round(offsetY + (ch.y + sittingOffset) * zoom - cached.height);
    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;

    if (ch.matrixEffect) {
      const mDrawX = drawX;
      const mDrawY = drawY;
      const mSpriteData = spriteData;
      const mCh = ch;
      drawables.push({
        zY: charZY,
        draw: (c) => {
          renderMatrixEffect(c, mCh, mSpriteData, mDrawX, mDrawY, zoom);
        },
      });
      continue;
    }

    // Focus halo (suppressed in edit mode).
    if (!isEditMode) {
      const isFocused = focusedAgentId != null && ch.id === focusedAgentId;
      const haloStyle = getFocusHaloStyle({
        isActive: ch.isActive,
        isFocused,
        awaitingSince: ch.awaitingSince,
      });
      if (haloStyle && !ch.isSubagent) {
        const tileX = offsetX + ch.tileCol * TILE_SIZE * zoom - FOCUS_HALO_INSET_PX;
        const tileY = offsetY + ch.tileRow * TILE_SIZE * zoom - FOCUS_HALO_INSET_PX;
        const tileW = TILE_SIZE * zoom + FOCUS_HALO_INSET_PX * 2;
        const tileH = TILE_SIZE * zoom + FOCUS_HALO_INSET_PX * 2;
        drawables.push({
          zY: charZY - OUTLINE_Z_SORT_OFFSET * 2,
          draw: (c) => {
            c.save();
            c.strokeStyle = haloStyle.color;
            c.lineWidth = haloStyle.width;
            c.setLineDash(haloStyle.dash as number[]);
            c.strokeRect(tileX, tileY, tileW, tileH);
            c.restore();
          },
        });
      }
    }

    const isSelected = selectedAgentId !== null && ch.id === selectedAgentId;
    const isHovered = hoveredAgentId !== null && ch.id === hoveredAgentId;
    if (isSelected || isHovered) {
      const outlineAlpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
      const outlineData = getOutlineSprite(spriteData);
      const outlineCached = getCachedSprite(outlineData, zoom);
      const olDrawX = drawX - zoom;
      const olDrawY = drawY - zoom;
      drawables.push({
        zY: charZY - OUTLINE_Z_SORT_OFFSET,
        draw: (c) => {
          c.save();
          c.globalAlpha = outlineAlpha;
          c.drawImage(outlineCached, olDrawX, olDrawY);
          c.restore();
        },
      });
    }

    drawables.push({
      zY: charZY,
      draw: (c) => {
        c.drawImage(cached, drawX, drawY);
      },
    });

    // Crashed glyph: drawn AFTER the character sprite (higher zY).
    if (!isEditMode && ch.crashed && !ch.crashedAcknowledged) {
      const tileX = offsetX + ch.tileCol * TILE_SIZE * zoom;
      const tileY = offsetY + ch.tileRow * TILE_SIZE * zoom;
      const gx = tileX + CRASHED_GLYPH_OFFSET_X_PX * zoom;
      const gy = tileY + CRASHED_GLYPH_OFFSET_Y_PX * zoom;
      const gs = CRASHED_GLYPH_SIZE_PX * zoom;
      drawables.push({
        zY: charZY + 1,
        draw: (c) => {
          c.save();
          c.fillStyle = CRASHED_GLYPH_BG;
          c.fillRect(gx, gy, gs, gs);
          c.strokeStyle = CRASHED_GLYPH_BORDER;
          c.lineWidth = Math.max(1, Math.floor(zoom * 0.3));
          c.strokeRect(gx + 0.5, gy + 0.5, gs - 1, gs - 1);
          c.restore();
        },
      });
    }
  }

  drawables.sort((a, b) => a.zY - b.zY);
  for (const d of drawables) d.draw(ctx);
}
```

- [ ] **Step 4: Update `renderFrame` to pass the new params**

In the same file, replace the existing call to `renderScene` inside `renderFrame` (around line 632). Find:

```ts
renderScene(ctx, allFurniture, characters, offsetX, offsetY, zoom, selectedId, hoveredId);
```

Replace with:

```ts
renderScene(
  ctx,
  allFurniture,
  characters,
  offsetX,
  offsetY,
  zoom,
  selectedId,
  hoveredId,
  selection?.focusedAgentId ?? null,
  editor != null,
  selection?.subagentMeta ?? new Map(),
);
```

- [ ] **Step 5: Extend `SelectionRenderState` interface**

In the same file, replace the existing `SelectionRenderState` interface (around line 571) with:

```ts
export interface SelectionRenderState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  /** Webview-local focused-agent id (panel.focusedAgentId). Drives focus halo. */
  focusedAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
  /** Parent→tool lookup so the renderer can draw the sub-agent parent line. */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }>;
}
```

- [ ] **Step 6: Update the OfficeCanvas call site to pass the two new fields**

In `webview-ui/src/office/components/OfficeCanvas.tsx`, find the `renderFrame` call (use grep `grep -n "selection: " webview-ui/src/office/components/OfficeCanvas.tsx` to locate). The current `selection` argument is constructed as a plain object literal; add the two new fields. Use `grep -n "hoveredAgentId:" webview-ui/src/office/components/OfficeCanvas.tsx` to find the exact construction site, then insert the two new lines next to `hoveredAgentId`:

```ts
            focusedAgentId: officeState.focusedAgentId,
            subagentMeta: officeState.subagentMeta,
```

If `OfficeState` doesn't already expose `focusedAgentId`, the canvas does not currently know which agent the _panel_ is focused on. **Resolution:** add a new prop to `OfficeCanvas` named `focusedAgentId: number | null` and pass `panel.state.focusedAgentId` from `App.tsx`. Apply the change in two places:

1. Add `focusedAgentId: number | null` to `OfficeCanvasProps` in `webview-ui/src/office/components/OfficeCanvas.tsx`.
2. In `webview-ui/src/App.tsx`, find the `<OfficeCanvas ... />` JSX and add the new prop: `focusedAgentId={panel.state.focusedAgentId}`.
3. Inside `OfficeCanvas`, replace `officeState.focusedAgentId` in the selection literal above with the prop `focusedAgentId`.

`subagentMeta` is already accessible via `officeState.subagentMeta` (existing public field; see `webview-ui/src/office/engine/officeState.ts:54`).

- [ ] **Step 7: Typecheck**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && cd ..
```

Expected: PASS. If it complains about an unused parameter (`isEditMode` flagged by `noUnusedParameters` on the early-exit path in `renderScene`), it will not — the parameter is consumed inside the function. Any other issue should be diagnosed directly from the compiler output.

- [ ] **Step 8: Run tests + lint**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test && cd .. && npm run lint
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add webview-ui/src/office/engine/renderer.ts webview-ui/src/office/engine/officeState.ts webview-ui/src/office/components/OfficeCanvas.tsx webview-ui/src/App.tsx
git commit -m "$(cat <<'EOF'
terminal-interaction: renderer focus halo + crashed glyph + sub-agent line

Threads focusedAgentId + subagentMeta + isEditMode into renderScene
via SelectionRenderState. Draws three new layers — focus halo (under
sprite, suppressed in edit mode), crashed glyph (over sprite, hides
on acknowledge), and sub-agent dashed line back to focused parent.
The crashed sprite variant arrives through the new getCharacterSprites
`crashed` param. OfficeState gains setAgentCrashed / acknowledgeCrash
helpers; setAgentCrashed propagates to live sub-agents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Extension surfaces `agentCrashed` + handles `acknowledgeCrash`

**Files:**

- Modify: `src/pty/ptyManager.ts`
- Modify: `src/agentManager.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

The pty worker already calls `sink.postMessage({ type: 'ptyExit', ... })` (see `src/pty/ptyManager.ts:70`). We add a separate broadcast for `agentCrashed` keyed on non-zero exit code so the renderer/glyph layer doesn't have to interpret pty exits inside the webview.

- [ ] **Step 1: Add a crash-broadcast call in `ptyManager.ts`**

In `src/pty/ptyManager.ts`, replace the `worker.onExit` block inside `start()` (currently lines 66–72) with:

```ts
worker.onExit(({ code, signal }) => {
  void this.opts.sink.postMessage({ type: 'ptyExit', agentId, code, signal });
  if ((typeof code === 'number' && code !== 0) || typeof signal === 'string') {
    void this.opts.sink.postMessage({ type: 'agentCrashed', agentId, code, signal });
  }
});
```

Both messages flow through the same `sink` — for the provider's `broadcastSink` this means every webview receives them.

- [ ] **Step 2: Add a `restartPty(id)` helper to `agentManager.ts`**

Open `src/agentManager.ts`. Find the existing exports (the file exports `launchNewTerminal`, `removeAgent`, etc.). Append at the end of the file:

```ts
/** Restart a pty-backed agent in place: kill the old worker, start a fresh one
 *  using the same agent's projectDir + sessionId. The caller owns triggering
 *  the new pty (this helper is a thin coordinator). */
export function restartPty(
  agentId: number,
  agents: Map<number, AgentState>,
  ptyManager: PtyManager | null,
  defaultCwd: string | undefined,
  bypassPermissions: boolean,
): boolean {
  if (!ptyManager) return false;
  const agent = agents.get(agentId);
  if (!agent || !agent.ptyBacked) return false;
  ptyManager.stop(agentId);
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders?.[0]?.uri.fsPath || resolveDefaultCwd(defaultCwd) || os.homedir();
  const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh');
  const claudeArgs = bypassPermissions
    ? ['--session-id', agent.sessionId, '--dangerously-skip-permissions']
    : ['--session-id', agent.sessionId];
  ptyManager.start(agentId, {
    shell,
    args: ['-l', '-c', `claude ${claudeArgs.join(' ')}`],
    cwd,
    env: process.env as Record<string, string | undefined>,
    cols: 80,
    rows: 24,
    scrollbackCapacity: PTY_SCROLLBACK_MAX_LINES,
  });
  return true;
}
```

If the file does not already import `os`, `vscode`, `PtyManager`, `resolveDefaultCwd`, or `PTY_SCROLLBACK_MAX_LINES`, the existing imports at the top of `agentManager.ts` already cover them (verify via `grep -n "import" /Users/angel/Desktop/pixel-agents/src/agentManager.ts | head -15`). If any are missing, add them next to the existing imports at the top of the file.

- [ ] **Step 3: Add `acknowledgeCrash` + `restartAgent` arms in `PixelAgentsViewProvider.ts`**

In `src/PixelAgentsViewProvider.ts`, locate the dispatch chain inside `handleWebviewMessage` — the last existing arm is `openExternal` (around line 981). Insert two new arms just after it (before the closing `}` of `handleWebviewMessage`):

```ts
    } else if (message.type === 'acknowledgeCrash') {
      const agentId = typeof message.agentId === 'number' ? message.agentId : null;
      if (agentId == null) return;
      this.broadcastSink.postMessage({ type: 'crashAcknowledged', agentId });
    } else if (message.type === 'restartAgent') {
      const agentId = typeof message.agentId === 'number' ? message.agentId : null;
      if (agentId == null) return;
      const bypass = !!this.context.workspaceState.get<boolean>(
        'pixel-agents.bypassPermissions',
        false,
      );
      const defaultCwd = this.context.globalState.get<string>(GLOBAL_KEY_DEFAULT_CWD, '');
      const ok = restartPty(agentId, this.agents, this.ptyManager, defaultCwd, bypass);
      if (ok) {
        this.broadcastSink.postMessage({ type: 'agentRestarted', agentId });
      }
```

Then add the `restartPty` import to the top of the file alongside the existing `agentManager` imports. Find the existing `import { ... } from './agentManager.js';` block and add `restartPty` to the import list (alphabetically positioned).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/angel/Desktop/pixel-agents && npx tsc --noEmit
```

Expected: PASS. If `restartPty` is reported as not exported from `./agentManager.js`, verify the export keyword is present in Step 2 and re-run.

- [ ] **Step 5: Lint + extension tests**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint && npm run test:extension
```

Expected: both PASS — no behavior-bearing tests for these new arms yet (covered by Task 8 reducer tests + Task 14 manual QA).

- [ ] **Step 6: Commit**

```bash
git add src/pty/ptyManager.ts src/agentManager.ts src/PixelAgentsViewProvider.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: emit agentCrashed + handle acknowledgeCrash/restartAgent

PtyManager broadcasts a separate agentCrashed message alongside the
existing ptyExit when a pty exits with a non-zero code or a signal.
Provider gains acknowledgeCrash (re-broadcast as crashAcknowledged
so all webviews clear the glyph) and restartAgent (delegates to
new agentManager.restartPty which stops + restarts the worker for
the same agent's sessionId). Both messages flow through broadcastSink.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Webview crashReducer + useExtensionMessages wiring (TDD)

**Files:**

- Create: `webview-ui/src/hooks/crashReducer.ts`
- Create: `webview-ui/test/crash-reducer.test.ts`
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`

- [ ] **Step 1: Write the failing test**

Create `webview-ui/test/crash-reducer.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyCrashAction, crashInitialState, type CrashState } from '../src/hooks/crashReducer.ts';

test('initial state has empty crashedAgents', () => {
  assert.deepEqual(crashInitialState, { crashedAgents: {} });
});

test('agentCrashed sets crashedAgents[id] = { code, signal }', () => {
  const next = applyCrashAction(crashInitialState, {
    type: 'agentCrashed',
    agentId: 5,
    code: 1,
    signal: undefined,
  });
  assert.deepEqual(next.crashedAgents, { 5: { code: 1, signal: null } });
});

test('agentCrashed with signal stores the signal string', () => {
  const next = applyCrashAction(crashInitialState, {
    type: 'agentCrashed',
    agentId: 5,
    code: 0,
    signal: 'SIGTERM',
  });
  assert.deepEqual(next.crashedAgents, { 5: { code: 0, signal: 'SIGTERM' } });
});

test('crashAcknowledged is a no-op on the reducer (renderer reads ack state)', () => {
  const prev: CrashState = { crashedAgents: { 5: { code: 1, signal: null } } };
  const next = applyCrashAction(prev, { type: 'crashAcknowledged', agentId: 5 });
  // Reducer keeps crash record so re-renders are consistent; the renderer reads
  // ch.crashedAcknowledged for the glyph, and acknowledgement happens directly
  // on the character mutation, not in this slice.
  assert.deepEqual(next, prev);
});

test('agentRestarted clears the crashed record for that agent', () => {
  const prev: CrashState = {
    crashedAgents: { 5: { code: 1, signal: null }, 7: { code: 2, signal: null } },
  };
  const next = applyCrashAction(prev, { type: 'agentRestarted', agentId: 5 });
  assert.deepEqual(next.crashedAgents, { 7: { code: 2, signal: null } });
});

test('agentClosed clears the crashed record for that agent', () => {
  const prev: CrashState = { crashedAgents: { 5: { code: 1, signal: null } } };
  const next = applyCrashAction(prev, { type: 'agentClosed', agentId: 5 });
  assert.deepEqual(next.crashedAgents, {});
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `crashReducer.ts`**

Create `webview-ui/src/hooks/crashReducer.ts`:

```ts
export interface CrashRecord {
  code: number;
  signal: string | null;
}

export interface CrashState {
  crashedAgents: Record<number, CrashRecord>;
}

export type CrashAction =
  | { type: 'agentCrashed'; agentId: number; code: number; signal: string | undefined }
  | { type: 'crashAcknowledged'; agentId: number }
  | { type: 'agentRestarted'; agentId: number }
  | { type: 'agentClosed'; agentId: number };

export const crashInitialState: CrashState = { crashedAgents: {} };

export function applyCrashAction(state: CrashState, action: CrashAction): CrashState {
  switch (action.type) {
    case 'agentCrashed':
      return {
        crashedAgents: {
          ...state.crashedAgents,
          [action.agentId]: { code: action.code, signal: action.signal ?? null },
        },
      };
    case 'crashAcknowledged':
      // Renderer reads ch.crashedAcknowledged for the glyph; reducer keeps
      // the crash record so a webview reload re-glyphs correctly.
      return state;
    case 'agentRestarted':
    case 'agentClosed': {
      if (!(action.agentId in state.crashedAgents)) return state;
      const next = { ...state.crashedAgents };
      delete next[action.agentId];
      return { crashedAgents: next };
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npm test
```

Expected: PASS — 6 reducer tests pass; previous tests stay green.

- [ ] **Step 5: Wire `agentCrashed` + `crashAcknowledged` + `agentRestarted` + `hookHealthChanged` into `useExtensionMessages.ts`**

Open `webview-ui/src/hooks/useExtensionMessages.ts`. Add a new state slice + four handler arms.

At the top of the file, after the existing imports, add:

```ts
import { applyCrashAction, crashInitialState, type CrashState } from './crashReducer.js';
```

Inside the `ExtensionMessageState` interface, append two new fields:

```ts
  crashState: CrashState;
  hookHealth: { status: 'ok' | 'degraded' | 'down'; reason?: string };
  acknowledgeCrash: (agentId: number) => void;
  restartAgent: (agentId: number) => void;
```

Inside the `useExtensionMessages` function body, alongside the existing `useState` calls, add:

```ts
const [crashState, setCrashState] = useState<CrashState>(crashInitialState);
const [hookHealth, setHookHealth] = useState<{
  status: 'ok' | 'degraded' | 'down';
  reason?: string;
}>({
  status: 'ok',
});

const acknowledgeCrash = useCallback(
  (agentId: number) => {
    const os = getOfficeState();
    os.acknowledgeCrash(agentId);
    setCrashState((prev) => applyCrashAction(prev, { type: 'crashAcknowledged', agentId }));
    vscode.postMessage({ type: 'acknowledgeCrash', agentId });
  },
  [getOfficeState],
);

const restartAgent = useCallback((agentId: number) => {
  vscode.postMessage({ type: 'restartAgent', agentId });
}, []);
```

Inside the `handler` function (the big `if/else if` chain in the `useEffect`), add four new arms just before the closing of the function (e.g. after the existing `ptyScrollback` arm at line 617–620):

```ts
      } else if (msg.type === 'agentCrashed') {
        const agentId = msg.agentId as number;
        const code = typeof msg.code === 'number' ? msg.code : 0;
        const signal = typeof msg.signal === 'string' ? (msg.signal as string) : undefined;
        // Drop if the agent has already been closed in the webview.
        if (!os.characters.has(agentId)) return;
        os.setAgentCrashed(agentId, true);
        setCrashState((prev) => applyCrashAction(prev, { type: 'agentCrashed', agentId, code, signal }));
      } else if (msg.type === 'crashAcknowledged') {
        const agentId = msg.agentId as number;
        os.acknowledgeCrash(agentId);
        setCrashState((prev) => applyCrashAction(prev, { type: 'crashAcknowledged', agentId }));
      } else if (msg.type === 'agentRestarted') {
        const agentId = msg.agentId as number;
        os.setAgentCrashed(agentId, false);
        setCrashState((prev) => applyCrashAction(prev, { type: 'agentRestarted', agentId }));
      } else if (msg.type === 'hookHealthChanged') {
        const status = msg.status as 'ok' | 'degraded' | 'down';
        const reason = typeof msg.reason === 'string' ? (msg.reason as string) : undefined;
        if (status === 'ok' || status === 'degraded' || status === 'down') {
          setHookHealth({ status, reason });
        }
      }
```

Also extend the existing `agentClosed` arm: directly after the `os.removeAgent(id);` line, add `setCrashState((prev) => applyCrashAction(prev, { type: 'agentClosed', agentId: id }));`.

Finally, extend the returned object at the end of `useExtensionMessages` to include the new fields:

```ts
    crashState,
    hookHealth,
    acknowledgeCrash,
    restartAgent,
```

- [ ] **Step 6: Typecheck + lint + tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && npm test && cd .. && npm run lint
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/hooks/crashReducer.ts webview-ui/test/crash-reducer.test.ts webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: crashReducer + useExtensionMessages wiring

Pure crashReducer covers agentCrashed (store record), crashAcknowledged
(no-op — renderer reads ch.crashedAcknowledged directly), agentRestarted
(clear record), agentClosed (clear record). 6 unit tests cover the
matrix. useExtensionMessages dispatches the four new server→webview
messages onto the reducer + into OfficeState (setAgentCrashed /
acknowledgeCrash), and exposes acknowledgeCrash + restartAgent
callbacks for downstream UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: healthMonitor module (TDD)

**Files:**

- Create: `server/src/healthMonitor.ts`
- Create: `server/__tests__/healthMonitor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/healthMonitor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  HOOK_HEALTH_BOOT_GRACE_MS,
  HOOK_HEARTBEAT_MISS_DEGRADED,
  HOOK_HEARTBEAT_MISS_DOWN,
} from '../src/constants.js';
import { HealthMonitor, type HealthState } from '../src/healthMonitor.js';

describe('HealthMonitor', () => {
  function setup(initialNow = 1_000): {
    monitor: HealthMonitor;
    events: HealthState[];
    advance: (ms: number) => void;
    now: () => number;
  } {
    let clock = initialNow;
    const events: HealthState[] = [];
    const monitor = new HealthMonitor({
      now: () => clock,
      onChange: (s) => events.push({ ...s }),
    });
    return {
      monitor,
      events,
      advance: (ms) => {
        clock += ms;
      },
      now: () => clock,
    };
  }

  it('first heartbeat transitions boot → ok', () => {
    const { monitor, events } = setup();
    monitor.heartbeat();
    expect(events.at(-1)?.status).toBe('ok');
  });

  it('staying in boot before grace expires does NOT emit down', () => {
    const { monitor, events, advance } = setup();
    advance(HOOK_HEALTH_BOOT_GRACE_MS - 100);
    monitor.tick();
    expect(events.find((e) => e.status === 'down')).toBeUndefined();
  });

  it('boot + grace expired + no heartbeat → down', () => {
    const { monitor, events, advance } = setup();
    advance(HOOK_HEALTH_BOOT_GRACE_MS + 100);
    monitor.tick();
    expect(events.at(-1)?.status).toBe('down');
  });

  it('HOOK_HEARTBEAT_MISS_DEGRADED missed → degraded', () => {
    const { monitor, events, advance } = setup();
    monitor.heartbeat();
    for (let i = 0; i < HOOK_HEARTBEAT_MISS_DEGRADED; i++) {
      advance(10_000); // bigger than HOOK_HEARTBEAT_INTERVAL_MS to count as a miss
      monitor.tick();
    }
    expect(events.at(-1)?.status).toBe('degraded');
  });

  it('HOOK_HEARTBEAT_MISS_DOWN total missed → down', () => {
    const { monitor, events, advance } = setup();
    monitor.heartbeat();
    for (let i = 0; i < HOOK_HEARTBEAT_MISS_DOWN; i++) {
      advance(10_000);
      monitor.tick();
    }
    expect(events.at(-1)?.status).toBe('down');
  });

  it('degraded → ok on a single heartbeat', () => {
    const { monitor, events, advance } = setup();
    monitor.heartbeat();
    for (let i = 0; i < HOOK_HEARTBEAT_MISS_DEGRADED; i++) {
      advance(10_000);
      monitor.tick();
    }
    expect(events.at(-1)?.status).toBe('degraded');
    monitor.heartbeat();
    expect(events.at(-1)?.status).toBe('ok');
  });

  it('down → ok on a single heartbeat', () => {
    const { monitor, events, advance } = setup();
    advance(HOOK_HEALTH_BOOT_GRACE_MS + 100);
    monitor.tick();
    expect(events.at(-1)?.status).toBe('down');
    monitor.heartbeat();
    expect(events.at(-1)?.status).toBe('ok');
  });

  it('repeated ok heartbeats do NOT re-emit ok events', () => {
    const { monitor, events } = setup();
    monitor.heartbeat();
    const baseline = events.length;
    monitor.heartbeat();
    monitor.heartbeat();
    expect(events.length).toBe(baseline);
  });

  it('dispose stops further events', () => {
    const { monitor, events, advance } = setup();
    monitor.dispose();
    advance(HOOK_HEALTH_BOOT_GRACE_MS + 1_000);
    monitor.tick();
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/angel/Desktop/pixel-agents/server && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `healthMonitor.ts`**

Create `server/src/healthMonitor.ts`:

```ts
import {
  HOOK_HEALTH_BOOT_GRACE_MS,
  HOOK_HEARTBEAT_INTERVAL_MS,
  HOOK_HEARTBEAT_MISS_DEGRADED,
  HOOK_HEARTBEAT_MISS_DOWN,
} from './constants.js';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthState {
  status: HealthStatus;
  reason?: string;
  since: number;
}

export interface HealthMonitorOptions {
  /** Injectable clock — tests pass a fake; default uses Date.now. */
  now?: () => number;
  /** Fires when the publicly-visible status changes. */
  onChange?: (state: HealthState) => void;
}

/**
 * Pure state machine for hook-health visibility.
 *
 * - `heartbeat()` records a successful hook event arrival (any provider).
 * - `tick()` is the periodic check that escalates missed heartbeats.
 * - Boot status starts as 'boot' (internal); grace window before exposing 'down'.
 *
 * Transitions are described in the UX spec § Hook-health state machine.
 */
export class HealthMonitor {
  private readonly now: () => number;
  private readonly onChange: ((state: HealthState) => void) | undefined;
  private disposed = false;
  private bootAt: number;
  private lastHeartbeatAt = 0;
  private status: HealthStatus | 'boot' = 'boot';
  private statusSince: number;
  private lastReason: string | undefined;

  constructor(opts: HealthMonitorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.bootAt = this.now();
    this.statusSince = this.bootAt;
  }

  heartbeat(reason?: string): void {
    if (this.disposed) return;
    this.lastHeartbeatAt = this.now();
    this.lastReason = reason;
    if (this.status !== 'ok') {
      this.transition('ok', reason);
    }
  }

  tick(): void {
    if (this.disposed) return;
    const now = this.now();
    // Boot path: nothing seen yet — grace before reporting down.
    if (this.status === 'boot') {
      if (now - this.bootAt >= HOOK_HEALTH_BOOT_GRACE_MS) {
        this.transition('down', 'boot-grace-elapsed-no-heartbeat');
      }
      return;
    }
    const sinceHeartbeat = now - this.lastHeartbeatAt;
    const intervals = Math.floor(sinceHeartbeat / HOOK_HEARTBEAT_INTERVAL_MS);
    if (intervals >= HOOK_HEARTBEAT_MISS_DOWN) {
      if (this.status !== 'down') this.transition('down', `missed ${intervals} heartbeats`);
    } else if (intervals >= HOOK_HEARTBEAT_MISS_DEGRADED) {
      if (this.status !== 'degraded') this.transition('degraded', `missed ${intervals} heartbeats`);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  getState(): HealthState | null {
    if (this.status === 'boot') return null;
    return { status: this.status, reason: this.lastReason, since: this.statusSince };
  }

  private transition(status: HealthStatus, reason: string | undefined): void {
    if (this.status === status) return;
    this.status = status;
    this.statusSince = this.now();
    this.lastReason = reason;
    this.onChange?.({ status, reason, since: this.statusSince });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/angel/Desktop/pixel-agents/server && npm test
```

Expected: PASS — all 10 healthMonitor tests pass; existing server tests stay green.

- [ ] **Step 5: Lint**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/healthMonitor.ts server/__tests__/healthMonitor.test.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: HealthMonitor state machine + tests

Pure HealthMonitor with injectable clock + onChange callback. States:
boot → ok (on first heartbeat) → degraded (on 2 missed) → down (on
3 missed). Boot grace suppresses down events for HOOK_HEALTH_BOOT_GRACE_MS.
Single heartbeat returns directly to ok from any state. Repeated
heartbeats while ok are no-ops (no spam). 10 Vitest cases cover the
full transition matrix + dispose lifecycle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire HealthMonitor into PixelAgentsServer; broadcast `hookHealthChanged`

**Files:**

- Modify: `server/src/server.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Embed `HealthMonitor` in `PixelAgentsServer`**

Open `server/src/server.ts`. Add the import at the top:

```ts
import { HOOK_HEARTBEAT_INTERVAL_MS } from './constants.js';
import { HealthMonitor, type HealthState } from './healthMonitor.js';
```

Modify the class body. Add the field declarations after the existing `private startTime`:

```ts
  private healthMonitor: HealthMonitor | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private healthListener: ((state: HealthState) => void) | null = null;
```

Add a public method:

```ts
  /** Register a listener that fires on every hook-health state change. */
  onHealthChange(cb: (state: HealthState) => void): void {
    this.healthListener = cb;
  }
```

Inside `start()`, immediately after `this.startTime = Date.now();`, add:

```ts
this.healthMonitor = new HealthMonitor({
  onChange: (s) => this.healthListener?.(s),
});
this.heartbeatTimer = setInterval(() => {
  this.healthMonitor?.tick();
}, HOOK_HEARTBEAT_INTERVAL_MS);
```

Inside `handleHookRequest()`, at the start (right after the auth-validation block but before parsing the body — i.e. at the very top of the function, no conditional), insert:

```ts
this.healthMonitor?.heartbeat();
```

Inside `stop()`, before `this.config = null;`, add:

```ts
if (this.heartbeatTimer) {
  clearInterval(this.heartbeatTimer);
  this.heartbeatTimer = null;
}
this.healthMonitor?.dispose();
this.healthMonitor = null;
this.healthListener = null;
```

- [ ] **Step 2: Wire the broadcast in `PixelAgentsViewProvider.ts`**

Open `src/PixelAgentsViewProvider.ts`. Locate the constructor block that wires `onHookEvent` (around line 281). Immediately after `this.pixelAgentsServer.onHookEvent(...);`, add:

```ts
this.pixelAgentsServer.onHealthChange((state) => {
  this.broadcastSink.postMessage({
    type: 'hookHealthChanged',
    status: state.status,
    reason: state.reason,
    since: state.since,
  });
});
```

- [ ] **Step 3: Typecheck (both packages)**

```bash
cd /Users/angel/Desktop/pixel-agents/server && npx tsc --noEmit -p tsconfig.test.json && cd .. && npx tsc --noEmit
```

Expected: PASS in both.

- [ ] **Step 4: Run server tests**

```bash
cd /Users/angel/Desktop/pixel-agents/server && npm test
```

Expected: PASS — existing server.test.ts continues to work (the new heartbeat call uses an injectable monitor that defaults to a no-op when no listener is wired). If `server.test.ts` constructs a `PixelAgentsServer` and starts/stops it, the new `setInterval` must be cleared on `stop()` — verify via the test passing without unref'd handle warnings.

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run lint
```

Expected: PASS.

```bash
git add server/src/server.ts src/PixelAgentsViewProvider.ts
git commit -m "$(cat <<'EOF'
terminal-interaction: PixelAgentsServer drives HealthMonitor + provider broadcasts

Server embeds a HealthMonitor; every valid hook POST calls heartbeat,
a HOOK_HEARTBEAT_INTERVAL_MS interval calls tick. Stop() disposes
the monitor + clears the timer. Provider registers an onHealthChange
listener and re-broadcasts as hookHealthChanged through broadcastSink.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: HookHealthToast + PanelHeader gear-icon dot + App.tsx mount

**Files:**

- Create: `webview-ui/src/office/panel/HookHealthToast.tsx`
- Modify: `webview-ui/src/office/panel/PanelHeader.tsx`
- Modify: `webview-ui/src/App.tsx`
- Modify: `webview-ui/src/office/panel/OfficePanel.tsx`

- [ ] **Step 1: Create `HookHealthToast.tsx`**

Create `webview-ui/src/office/panel/HookHealthToast.tsx`:

```tsx
import { useEffect, useState } from 'react';

import { PANEL_BG_CELL, PANEL_BORDER, PANEL_MUTED } from '../../constants.js';

interface HookHealthToastProps {
  status: 'ok' | 'degraded' | 'down';
  reason?: string;
}

/**
 * Sticky toast that appears when hook health is `down`. Shows the reason and a
 * dismiss button. Dismissal is per-session — when status returns to `ok` and
 * later drops back to `down`, the toast re-appears.
 */
export function HookHealthToast({ status, reason }: HookHealthToastProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when status recovers to ok (so a fresh down re-shows).
  useEffect(() => {
    if (status === 'ok') setDismissed(false);
  }, [status]);

  if (status !== 'down' || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: PANEL_BG_CELL,
        color: PANEL_MUTED,
        border: `2px solid ${PANEL_BORDER}`,
        boxShadow: '2px 2px 0px #0a0a14',
        padding: '8px 12px',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        zIndex: 1000,
        borderRadius: 0,
      }}
    >
      <span style={{ color: 'var(--color-danger)' }}>●</span>
      <span>Hook server: {reason ?? 'unreachable'}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="panel-icon-hover"
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: 11,
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add gear-icon dot to `PanelHeader.tsx`**

The current `PanelHeader` doesn't render a gear icon explicitly — the gear lives on the global toolbar. Per the spec, the dot rides on the gear icon. **Resolution:** since the gear icon lives outside `PanelHeader`, the dot ride is conceptually on the toolbar gear, not the panel header. Implement the dot as a small accent rendered next to the existing `[hide]` button in `PanelHeader` so it lives in the focused header chrome and is visible regardless of which webview is active.

Replace the existing `<button>` element at the end of the PanelHeader return (lines 105–121) with the following — and add a new prop `hookHealth` to the component signature:

```tsx
import {
  HOOK_HEALTH_DOT_COLOR_DEGRADED,
  HOOK_HEALTH_DOT_COLOR_DOWN,
  HOOK_HEALTH_DOT_SIZE_PX,
  PANEL_ACCENT,
  PANEL_BG_CELL,
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_HEADER_THICKNESS_PX,
  PANEL_MUTED,
  PANEL_SPRITE_PLACEHOLDER,
} from '../../constants.js';
```

Then in the props interface:

```ts
interface PanelHeaderProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  panelPosition: PanelPosition;
  hookHealth: 'ok' | 'degraded' | 'down';
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
}
```

Destructure `hookHealth` alongside the other props and replace the trailing `<button>` block with:

```tsx
<div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
  <button
    type="button"
    onClick={onCollapse}
    className="panel-icon-hover"
    style={{
      background: 'transparent',
      border: 'none',
      color: PANEL_MUTED,
      fontSize: 10,
      cursor: 'pointer',
      padding: '0 4px',
    }}
    title="Hide panel"
  >
    {collapseLabel}
  </button>
  {hookHealth !== 'ok' && (
    <span
      aria-label={`Hook server status: ${hookHealth}`}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: HOOK_HEALTH_DOT_SIZE_PX,
        height: HOOK_HEALTH_DOT_SIZE_PX,
        background:
          hookHealth === 'down' ? HOOK_HEALTH_DOT_COLOR_DOWN : HOOK_HEALTH_DOT_COLOR_DEGRADED,
        pointerEvents: 'none',
      }}
    />
  )}
</div>
```

- [ ] **Step 3: Thread `hookHealth` through `OfficePanel.tsx` → `PanelHeader.tsx`**

Open `webview-ui/src/office/panel/OfficePanel.tsx`. Add `hookHealth` to the props interface and pass it through:

```tsx
interface OfficePanelProps {
  agents: AgentSummary[];
  state: PanelState;
  band: Band;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
  onToggleRailHidden: () => void;
  onSetUserBandSizePx: (px: number | undefined) => void;
  ptyBackedByAgent: Record<number, boolean>;
  ptyEventBus: PtyEventBus;
  terminalFontFamily: string;
  terminalLineHeight: number;
  hookHealth: 'ok' | 'degraded' | 'down';
}
```

Destructure `hookHealth` and add it to the `<PanelHeader>` JSX:

```tsx
<PanelHeader
  agents={agents}
  focusedAgentId={state.focusedAgentId}
  panelPosition={state.panelPosition}
  hookHealth={hookHealth}
  onFocusAgent={onFocusAgent}
  onCollapse={onCollapse}
/>
```

- [ ] **Step 4: Mount `HookHealthToast` + pass `hookHealth` from `App.tsx`**

In `webview-ui/src/App.tsx`, destructure the new fields returned by `useExtensionMessages`:

```tsx
const {
  // ... existing fields ...
  hookHealth,
  crashState: _crashState,
  acknowledgeCrash,
  restartAgent,
} = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);
```

Add the toast import at the top:

```tsx
import { HookHealthToast } from './office/panel/HookHealthToast.js';
```

Pass `hookHealth` to `OfficePanel`. Find the `panelEl` definition and add the prop:

```tsx
const panelEl = (
  <OfficePanel
    agents={agentSummaries}
    state={panel.state}
    band={panel.band}
    onFocusAgent={handleClick}
    onCollapse={panel.collapse}
    onToggleRailHidden={panel.toggleRailHidden}
    onSetUserBandSizePx={panel.setUserBandSizePx}
    ptyBackedByAgent={ptyBackedByAgent}
    ptyEventBus={ptyEventBus}
    terminalFontFamily={terminalFontFamily}
    terminalLineHeight={terminalLineHeight}
    hookHealth={hookHealth.status}
  />
);
```

At the bottom of the App return JSX (just before the closing outer `</div>` of the main flex container), insert:

```tsx
<HookHealthToast status={hookHealth.status} reason={hookHealth.reason} />
```

Add a callback for clicks on the crashed glyph: extend the existing `handleClick` to dispatch `acknowledgeCrash`. Replace the existing `handleClick` body:

```tsx
const handleClick = useCallback(
  (agentId: number) => {
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    // If the clicked character is currently crashed and unacknowledged, ack it.
    const ch = os.characters.get(agentId);
    if (ch?.crashed && !ch.crashedAcknowledged) {
      acknowledgeCrash(agentId);
    }
    vscode.postMessage({ type: 'focusAgent', id: focusId });
    panel.focusOrToggle(focusId);
  },
  [panel, acknowledgeCrash],
);
```

Declare `restartAgent` as currently-unused (to silence eslint's no-unused-vars). It will be wired into `TerminalPane` in Task 12 by threading through `OfficePanel`. For now, prefix it with `_` if necessary:

```tsx
    restartAgent: _restartAgent,
```

— or thread it directly into `OfficePanel`. Choose the latter so Task 12 only changes the consumer. Pass it through `OfficePanel` props now: add `onRestartAgent: (id: number) => void;` to `OfficePanelProps`, destructure it, and pass it down. Defer the _use_ of `onRestartAgent` to Task 12.

- [ ] **Step 5: Add `onRestartAgent` plumbing to `OfficePanel`**

In `webview-ui/src/office/panel/OfficePanel.tsx`, add `onRestartAgent` to `OfficePanelProps`:

```ts
  onRestartAgent: (id: number) => void;
```

Destructure it alongside the other props. For now, drop it onto `TerminalPane` as an unused prop with the signature documented (Task 12 consumes it):

```tsx
        {state.focusedAgentId !== null && ptyBackedByAgent[state.focusedAgentId] ? (
          <TerminalPane
            agentId={state.focusedAgentId}
            agentName={focused?.name ?? null}
            fontSize={state.terminalFontSize}
            fontFamily={terminalFontFamily}
            lineHeight={terminalLineHeight}
            bus={ptyEventBus}
            onRestartAgent={onRestartAgent}
          />
        ) : (
```

Add the matching prop to `TerminalPaneProps` in `webview-ui/src/office/panel/TerminalPane.tsx`:

```tsx
interface TerminalPaneProps {
  agentId: number;
  agentName: string | null;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  bus: PtyEventBus;
  onRestartAgent: (id: number) => void;
}
```

Destructure it; leave the body untouched (Task 12 wires the button).

In `webview-ui/src/App.tsx`, pass it to `OfficePanel`:

```tsx
onRestartAgent = { restartAgent };
```

- [ ] **Step 6: Typecheck + lint + tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && npm test && cd .. && npm run lint
```

Expected: all PASS. If TS complains about unused `onRestartAgent` in `TerminalPane.tsx`, leave it unconsumed for now — Task 12 uses it. The TS rule fires on locals, not props, so this should not error.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/office/panel/HookHealthToast.tsx webview-ui/src/office/panel/PanelHeader.tsx webview-ui/src/office/panel/OfficePanel.tsx webview-ui/src/office/panel/TerminalPane.tsx webview-ui/src/App.tsx
git commit -m "$(cat <<'EOF'
terminal-interaction: HookHealthToast + gear dot + crashed-click ack

Adds HookHealthToast — a sticky bottom-center toast bound to the
webview root (z-index 1000, sharp corners, 2px border, hard offset
shadow). PanelHeader's [hide] button gets a 4px dot overlay when
hookHealth !== 'ok' (danger for down, warning for degraded). App
handleClick ack's the crashed flag when a crashed character is
clicked. Plumbs restartAgent down through OfficePanel → TerminalPane
(consumed in next task).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: TerminalPane Restart button + `agentExited` UI affordance

**Files:**

- Modify: `webview-ui/src/office/panel/TerminalPane.tsx`

The xterm pane already writes `[pty exited: code <n>]` (see TerminalPane.tsx line 107–110). Detection: subscribe to `ptyExit` once at setup, store the exit info in a ref, and render the Restart button when set.

- [ ] **Step 1: Wire exit tracking + Restart button into `TerminalPane.tsx`**

Open `webview-ui/src/office/panel/TerminalPane.tsx`. Add a `useState` for exit info just below the existing `useTerminalSearch(searchRef)` call:

```tsx
const [exitInfo, setExitInfo] = useState<{ code: number; signal?: string } | null>(null);
```

Add `useState` to the React imports at the top:

```tsx
import { useEffect, useRef, useState } from 'react';
```

Add the import of the warning color token from constants:

```tsx
import { PANEL_BG_CHROME, PANEL_BORDER, PANEL_MUTED } from '../../constants.js';
```

Inside the existing exit subscription block (the line `bus.subscribe(agentId, 'ptyExit', ({ code, signal }) => { ... })`), augment to also set state:

```tsx
const exitSub = bus.subscribe(agentId, 'ptyExit', ({ code, signal }) => {
  const msg = signal
    ? `\r\n[pty exited: signal ${signal}]\r\n`
    : `\r\n[pty exited: code ${code}]\r\n`;
  term.write(msg);
  setExitInfo({ code, signal });
});
```

When `agentId` changes, reset the exit state. Add this effect just after the existing font-family effect:

```tsx
useEffect(() => {
  setExitInfo(null);
}, [agentId]);
```

Finally, update the return JSX to render the Restart button. Replace the existing return block with:

```tsx
return (
  <div
    style={{
      flex: '1 1 auto',
      minHeight: 0,
      background: PANEL_BG_CHROME,
      padding: 2,
      borderLeft: `2px solid ${PANEL_BORDER}`,
      borderRight: `2px solid ${PANEL_BORDER}`,
      borderBottom: `2px solid ${PANEL_BORDER}`,
      position: 'relative',
    }}
    aria-label={agentName ? `Terminal for ${agentName}` : 'Terminal'}
  >
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    {exitInfo && (
      <button
        type="button"
        onClick={() => {
          setExitInfo(null);
          onRestartAgent(agentId);
        }}
        className="panel-icon-hover"
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          background: PANEL_BG_CHROME,
          border: `1px solid ${PANEL_BORDER}`,
          color: PANEL_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '2px 8px',
          zIndex: 5,
        }}
        title={
          exitInfo.signal
            ? `Restart agent (exited: signal ${exitInfo.signal})`
            : `Restart agent (exited: code ${exitInfo.code})`
        }
        aria-label="Restart agent"
      >
        ↻ Restart
      </button>
    )}
    {search.state.open && (
      <TerminalSearchBar
        query={search.state.query}
        currentMatch={search.state.currentMatch}
        totalMatches={search.state.totalMatches}
        onQueryChange={search.setQuery}
        onNext={search.next}
        onPrevious={search.previous}
        onClose={() => {
          search.close();
          termRef.current?.focus();
        }}
      />
    )}
  </div>
);
```

- [ ] **Step 2: Typecheck + lint + tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && npm test && cd .. && npm run lint
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/panel/TerminalPane.tsx
git commit -m "$(cat <<'EOF'
terminal-interaction: TerminalPane Restart button on pty exit

TerminalPane stores ptyExit info in local state (cleared when
agentId switches). When exit is observed, renders a "↻ Restart"
button top-left of the pane (z-index 5, sharp corners, 1px border
to match the existing search bar) that dispatches the onRestartAgent
prop wired from App.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Canvas keyboard shortcuts (Cmd+1..9 + Cmd+')

**Files:**

- Modify: `webview-ui/src/office/components/OfficeCanvas.tsx`

The canvas isn't focusable by default — keyboard events bubble from `window`. We install a `keydown` listener on `window` and check `document.activeElement` to ensure xterm doesn't have focus.

- [ ] **Step 1: Add canvas keyboard listener**

Open `webview-ui/src/office/components/OfficeCanvas.tsx`. Add three new props to `OfficeCanvasProps`:

```ts
  agentIds: number[];
  onFocusAgent: (id: number) => void;
  onTogglePanel: () => void;
```

Destructure them in the function signature alongside the existing props.

Add a new `useEffect` that installs the global keydown listener. Insert it near the bottom of the component body, right before the `return` statement:

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Bail if xterm or any text input has focus.
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.closest('.xterm'))) {
      return;
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key >= '1' && e.key <= '9') {
      const n = parseInt(e.key, 10) - 1;
      const id = agentIds[n];
      if (id !== undefined) {
        e.preventDefault();
        onFocusAgent(id);
      }
      return;
    }
    if (e.key === "'") {
      e.preventDefault();
      onTogglePanel();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [agentIds, onFocusAgent, onTogglePanel]);
```

- [ ] **Step 2: Pass the three new props from `App.tsx`**

In `webview-ui/src/App.tsx`, find the `<OfficeCanvas ... />` JSX and add the three new props:

```tsx
<OfficeCanvas
  officeState={officeState}
  onClick={handleClick}
  agentIds={agents}
  onFocusAgent={handleClick}
  onTogglePanel={panel.toggle}
  focusedAgentId={panel.state.focusedAgentId}
  // ... existing props ...
/>
```

If `panel.toggle` doesn't exist as-is, replace with the equivalent existing method. Verify via:

```bash
grep -n "toggle\|collapse\|toggleRailHidden\|focusOrToggle" /Users/angel/Desktop/pixel-agents/webview-ui/src/office/panel/usePanelState.ts
```

Use whichever method maps to "toggle panel rail/open mode" (the spec calls for `Cmd+'` = toggle hide). The closest existing method is `panel.toggleRailHidden`. Use that:

```tsx
          onTogglePanel={panel.toggleRailHidden}
```

- [ ] **Step 3: Typecheck + lint + tests + extension tests**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit && npm test && cd .. && npm run lint && npm run test:extension
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/office/components/OfficeCanvas.tsx webview-ui/src/App.tsx
git commit -m "$(cat <<'EOF'
terminal-interaction: Cmd+1..9 focus shortcuts + Cmd+' panel toggle

Installs a window-scope keydown listener inside OfficeCanvas that
bails when xterm/textarea/input has DOM focus. Cmd/Ctrl+1..9 maps
to agentIds[n-1] and calls onFocusAgent (same path as character
click). Cmd/Ctrl+' calls onTogglePanel (mapped to panel.toggleRailHidden).
Phase 3 caveat documented in the UX spec: numeric chord is reserved
by browsers and only fires in VS Code runtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Full build + automated tests + manual QA

**Files:** none (verification + smoke testing only).

- [ ] **Step 1: Full build**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run build
```

Expected: PASS — type-check, lint, esbuild (extension), Vite (webview) all clean.

- [ ] **Step 2: Full test suite**

```bash
cd /Users/angel/Desktop/pixel-agents && npm test
```

Expected: PASS — webview node tests (including `desaturate-sprites`, `character-halo`, `pty-activity-reducer`, `crash-reducer`, extended `pty-event-bus`), server Vitest (including `healthMonitor`), extension tests, all green.

- [ ] **Step 3: Manual QA — focus halo (deferred to Phase 2 final QA pass)**

Launch the Extension Dev Host (F5). Open the side panel. Spawn 2 agents, click each in turn:

- Confirm a dotted accent halo surrounds the chair tile of an idle focused agent.
- Issue a prompt to the focused agent. Confirm the halo switches to solid accent within 1 frame of pty bytes flowing.
- Switch focus to the other agent. The previously-focused agent's halo turns muted (peripheral cue); the newly-focused becomes solid accent.

- [ ] **Step 4: Manual QA — pty → animation (deferred)**

In the focused pty terminal, run:

```bash
for i in $(seq 1 200); do echo $i; sleep 0.05; done
```

Confirm:

- Character's typing animation is uninterrupted during the loop.
- 1s after the loop ends, animation switches to the "reading" pose (covered by `ch.ptyActivityUntil` falling behind `Date.now()`).

- [ ] **Step 5: Manual QA — crashed glyph + restart (deferred)**

In the focused pty terminal:

```bash
kill -9 $$
```

(or `exit 1` from the shell — anything that produces a non-zero exit code).

Confirm:

- Character sprite desaturates by ~60%.
- A red `!` glyph appears at the top-right of the chair tile.
- The xterm pane shows `[pty exited: code <n>]` and a "↻ Restart" button at the top-left.
- Clicking the character clears the glyph; sprite stays desaturated (acknowledgement only hides the glyph). Reloading the webview brings the glyph back (ephemeral acknowledge).
- Clicking "↻ Restart" relaunches the pty; sprite re-saturates and the button disappears.

- [ ] **Step 6: Manual QA — sub-agent dashed line (deferred)**

Trigger a `Task` tool from the focused agent. While the sub-agent is alive:

- Confirm a 1px dashed muted line draws from the sub-agent character to the parent's chair tile.
- Defocus the parent — line vanishes.
- Re-focus — line returns.

- [ ] **Step 7: Manual QA — hook health (deferred)**

With the dev host running, kill the hook server PID directly (look at `~/.pixel-agents/server.json`, `kill -9 <pid>`). Within ~30 s (3 missed heartbeats × 5 s interval):

- `[hide]` button gains a small red dot.
- A toast appears at bottom-center: "Hook server: missed N heartbeats" with a dismiss button.
- Dismissing hides the toast for the session.
- The dot persists until the server is restarted (it auto-restarts on the next webview boot).

- [ ] **Step 8: Manual QA — keyboard shortcuts (deferred, VS Code only)**

With 3+ agents spawned and the canvas focused (click empty grid area first):

- `Cmd+1` focuses agent in slot 1.
- `Cmd+3` focuses agent in slot 3.
- `Cmd+'` toggles panel rail/open.
- Click into xterm; `Cmd+1` no longer fires (xterm has focus).

- [ ] **Step 9: Manual QA — multi-webview (deferred)**

Open both side panel and full-screen panel. Click an agent in the side panel:

- Halo appears in BOTH webviews on the same character.
- Focus state is per-webview (full-screen panel's focused agent is unchanged).
- Kill the agent's pty: glyph appears in both webviews; acknowledging in one clears in both (via the `crashAcknowledged` broadcast).

- [ ] **Step 10: If any manual-QA-driven tweaks were needed, commit**

```bash
# Only if tweaks were needed:
git add <changed files>
git commit -m "$(cat <<'EOF'
terminal-interaction: <focused description of the tweak>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

The manual-QA steps above (3–9) are deferred to the Phase 2 final QA pass. Commits 1–13 stand on their own with automated test coverage.

---

## Spec Coverage Check

| Spec decision                                                                                | Implemented in   |
| -------------------------------------------------------------------------------------------- | ---------------- |
| Click-character → bidirectional focus + halo                                                 | Tasks 6, 8, 11   |
| `Character.ptyActivityUntil` field + initial zero                                            | Task 2           |
| `Character.crashed` + `crashedAcknowledged` ephemeral fields                                 | Task 2           |
| Focus-halo selector matrix (active/focused/awaiting/pty-stub/muted)                          | Task 4           |
| `PtyEventBus.subscribeActivity` channel                                                      | Task 5           |
| `ptyActivityReducer` debounce + monotonicity                                                 | Task 5           |
| `useCharacterPtyActivity` React hook (manual QA)                                             | Task 5           |
| `desaturateSprites` module + `:crashed` cache variant                                        | Task 3           |
| Focus halo rendered before sprite, under z-sort                                              | Task 6           |
| Crashed glyph rendered after sprite at top-right of chair                                    | Task 6           |
| Sub-agent dashed line under all characters, suppressed when parent not focused               | Task 6           |
| Edit mode suppresses all new visuals                                                         | Task 6           |
| `OfficeState.setAgentCrashed` propagates to live sub-agents                                  | Task 6           |
| `agentCrashed` outbound message from extension on non-zero pty exit                          | Task 7           |
| `acknowledgeCrash` inbound + re-broadcast as `crashAcknowledged`                             | Task 7, 8        |
| `restartAgent` inbound + `agentManager.restartPty`                                           | Task 7, 12       |
| `crashReducer` slice with agentCrashed/Acknowledged/Restarted/Closed                         | Task 8           |
| `useExtensionMessages` consumes new messages + exposes callbacks                             | Task 8, 11       |
| `HealthMonitor` state machine: boot → ok → degraded → down                                   | Task 9           |
| `HOOK_HEALTH_BOOT_GRACE_MS` suppresses early `down`                                          | Task 9           |
| `PixelAgentsServer` heartbeat on hook POST + interval tick                                   | Task 10          |
| `hookHealthChanged` broadcast via `broadcastSink`                                            | Task 10          |
| `HookHealthToast` sticky bottom-center, sharp corners, hard shadow                           | Task 11          |
| `PanelHeader` gear-icon dot (rendered on the [hide] button)                                  | Task 11          |
| `TerminalPane` Restart button visible after `ptyExit`                                        | Task 12          |
| Canvas `Cmd/Ctrl+1..9` shortcut → focus Nth agent                                            | Task 13          |
| Canvas `Cmd/Ctrl+'` shortcut → panel rail/open toggle                                        | Task 13          |
| Phase-3 caveat: numeric chord reserved by browsers (documented in spec)                      | Task 13 commit   |
| Multi-webview: all new messages flow through broadcastSink                                   | Tasks 7, 10      |
| All new constants live in `webview-ui/src/constants.ts` + `server/src/constants.ts`          | Task 1           |
| Token reuse (PANEL_ACCENT, PANEL_MUTED, PANEL_WAITING, `--color-danger`, `--color-warning`)  | Task 1           |
| Unit tests: halo selector, pty-activity reducer, crash reducer, health-monitor state machine | Tasks 4, 5, 8, 9 |
| `desaturateSprites` unit tests                                                               | Task 3           |
| `PtyEventBus.subscribeActivity` unit tests                                                   | Task 5           |

No spec gaps.

---

## Notes for the implementer

- **Sub-agents live in `OfficeState.subagentMeta`, not `agents`.** `useExtensionMessages` tracks regular agents in `agents: number[]`; sub-agents are in `subagentCharacters` (the React-state mirror) and `os.subagentMeta` (the imperative truth). The renderer reads `subagentMeta` for the dashed-line lookup — Task 6 wires this via the new `SelectionRenderState.subagentMeta` field. Do **not** try to discover sub-agents by scanning `characters` for `ch.isSubagent` inside `OfficeCanvas`; pass the live `Map` through.
- **Wall-clock vs `performance.now`.** `useCharacterPtyActivity` uses `Date.now()` for the deadline (`ch.ptyActivityUntil`) and `performance.now()` only for the throttle gate. The renderer's eventual `Date.now() < ch.ptyActivityUntil` comparison must match epoch.
- **Crashed sprite cache key is opaque to the renderer.** The renderer calls `getCharacterSprites(ch.palette, ch.hueShift, ch.crashed)` and trusts the sprite module to return either the un-desaturated set or the cached desaturated variant. If a future bundle desaturates for any other reason (e.g. "afk-tinted"), extend the cache key explicitly, not the `crashed` flag.
- **Edit mode suppression** is per-renderer. The `editor != null` check in `renderFrame` flows down as `isEditMode: editor != null` to `renderScene`. Do NOT thread a separate `isEditMode` prop into OfficeCanvas just for this — it's already available via the editor render state at the renderer boundary.
- **`broadcastSink` is the single fan-out point.** Every new outbound message (`agentCrashed`, `crashAcknowledged`, `agentRestarted`, `hookHealthChanged`) goes through `this.broadcastSink.postMessage(...)` so the side-panel and full-screen panel stay in sync. The pty manager already uses the sink wrapper passed to its constructor — verify with `grep "this.opts.sink.postMessage" src/pty/ptyManager.ts`.
- **Pre-commit hook (lefthook + prettier + eslint).** Runs on every commit. If prettier reformats a file, re-stage and the commit proceeds. Do NOT pass `--no-verify`.
- **`OfficeCanvas` keyboard listener is `window`-scope.** This is intentional — the canvas itself doesn't take DOM focus today and we don't want to introduce a focusable wrapper just for this. The listener bails when `document.activeElement` is inside `.xterm` or is an `INPUT`/`TEXTAREA`.
- **`restartAgent` thread-through:** App → OfficePanel → TerminalPane via prop drilling. The plan intentionally avoids a context here — there's exactly one consumer and the prop chain is short. Phase-3 SPA can replace the prop chain with a message dispatch if desired without changing the protocol.
- **Vitest vs node:test.** Server tests use Vitest (`describe`/`it`/`expect`/`vi`); webview tests use the node test runner (`test`, `assert.strict`). Do not mix.
- **`server.test.ts` lifecycle.** The new `setInterval` in `PixelAgentsServer.start()` MUST be cleared on `stop()`. If `npm run test:server` warns about open handles or leaks, the cleanup in Task 10 Step 1 is missing — re-verify.
- **`agentCrashed` drops messages for closed agents.** Task 8 step 5 guards: `if (!os.characters.has(agentId)) return;`. This prevents resurrecting an agent that was closed between the pty exit and the broadcast (per spec edge case).
- **The `crashed` cache variant uses a hex saturation cut, not a CSS filter.** This keeps the canvas pure-pixel and respects the project's "no CSS over the canvas" rule. Desaturation is a one-time HSL pass during cache build.
