# Thinking Presence — Design Spec

**Date:** 2026-04-20
**Status:** Draft

## Problem

The overlay shows "Idle" whenever no tool is active, including the gap between `UserPromptSubmit` and the first `PreToolUse` — the window in which the agent is thinking. Worse, characters currently sit at their assigned desk both when working _and_ when idle (the "return to seat for rest" behavior), so the visual state is ambiguous: a seated character could be thinking, running a tool, or doing nothing at all.

The user's intent: position should carry meaning. At a computer = working/thinking. Wandering or on a couch = idle.

## Goals

1. When an agent is actively processing a turn (post-prompt, pre-turn-end), the character should be at a computer.
2. When an agent is idle between turns, the character should wander or occupy a couch — never sit at a computer.
3. Hover overlay should not show "Idle" for an agent that is actively thinking with no tools running. It should show "Thinking…".
4. Honor existing layouts without requiring asset or catalog changes.

## Non-Goals

- Displaying elapsed thinking time.
- Distinct visual treatment for "outputting text" vs "thinking" (indistinguishable in real-time).
- Per-character rest-seat preferences, cooldowns, or break-room timers.
- A new catalog field for seat role (the adjacency rule is sufficient).
- Distinct couch-vs-chair sitting animations.
- Heuristic-mode parity — characters still only activate on first tool when hooks are off (acceptable degradation; hooks are the default).

## Behavior

### Activity lifecycle

`Character.isActive` becomes a first-class reflection of the agent's processing state:

- Set `true` on `UserPromptSubmit` (normalized as `userTurn`), in addition to the existing first-tool-use trigger.
- Cleared on `Stop` hook / `turn_duration` JSONL record, as today.

### Position as meaning

- **While `isActive` is true:** the character pathfinds to their **work seat** (a chair facing a computer). Once seated, standard typing/reading animations play as today.
- **While `isActive` is false:** the character wanders. After `wanderLimit` moves, instead of returning to their work seat, they pick the nearest free **rest seat** (couch/lounger). If no rest seats are free, they keep wandering.

### Overlay label

`getActivityText()` gains one rule:

- If `isActive` is true and no active tool exists → return `"Thinking…"`.
- Otherwise, existing logic applies (tool status, last-tool status mid-turn, else `"Idle"`).

This intentionally covers both the pre-first-tool gap and between-tool gaps; the literal rule "active + no tool = thinking" is simpler than excluding the between-tools case and matches how the user described it.

### Seat classification

Every chair seat carries a `role: 'work' | 'rest'`.

- **Work seat:** the chair's facing direction hits a desk tile that has a furniture item of category `electronics` on it within the adjacency window already used by `rebuildFurnitureInstances` for auto-state (3 tiles deep in facing direction × 1 tile to each side).
- **Rest seat:** any chair that is not a work seat (couches, loungers, standalone chairs, chairs facing empty desks).

Classification is recomputed on layout change only (not per frame).

### Seat assignment

- On character add/restore: assign the closest free work seat as `workSeatId`. If none are free (or none exist), `workSeatId` stays `null`; the character spawns on a random walkable tile and wanders. When `isActive` flips true, a character with no work seat stays wherever they are (the overlay still shows "Thinking…").
- Click-to-reassign (user flow): only work seats are valid targets. Clicking a rest seat is a no-op (no reassignment, no visual acknowledgement). Rest seats are a shared pool picked ad-hoc when the character chooses to rest.
- On reclassification (e.g., user moves a computer): if a character's `workSeatId` is no longer a work seat, reassign to the nearest free work seat automatically.
- On deletion (the chair itself is removed): clear `workSeatId`. The next time `isActive` becomes true, the closest-free-work-seat logic runs again.

## Data model

### Types (`webview-ui/src/office/types.ts`)

- `Seat.role: 'work' | 'rest'` — new field on the existing seat interface.
- `Character.workSeatId?: string` — replaces `seatId`. Persistent. A character's assigned desk.
- `Character.restSeatId?: string` — new, transient. The rest seat the character is currently occupying or walking toward. Never persisted; recomputed on idle.

### Persistence (`src/agentManager.ts`)

- Persist `workSeatId` in place of the existing `seatId` field inside the `pixel-agents.agents` workspaceState entry.
- One-time migration on load: if a persisted record has `seatId` but no `workSeatId`, read it as `workSeatId`. No explicit schema version bump; the shape is additive.

## Protocol

### Extension → webview (`server/src/hookEventHandler.ts`)

The `userTurn` case (currently dropped at lines 349–352) posts:

```ts
webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
```

No new message type; the webview already consumes `agentStatus: 'active'`.

### Shared helper (`webview-ui/src/office/engine/officeState.ts`)

Extract `computerAdjacencyWindow(pos, facing): {row, col}[]` — the set of tiles a seated character "looks at." Currently inline in `rebuildFurnitureInstances`; now called from both there and from `layoutToSeats`.

## File-by-file change list

1. `server/src/hookEventHandler.ts` — handle `userTurn`; emit `agentStatus: 'active'`.
2. `webview-ui/src/office/engine/officeState.ts` — extract `computerAdjacencyWindow` helper; use for both auto-state and seat classification. Update character-add and click-reassign flows to prefer work seats.
3. `webview-ui/src/office/layout/layoutSerializer.ts` — `layoutToSeats()` assigns `role` per seat using the shared helper.
4. `webview-ui/src/office/types.ts` — extend `Seat`; rename `Character.seatId` to `workSeatId`, add `restSeatId?`.
5. `webview-ui/src/office/engine/characters.ts` — FSM rest-seat selection when `!isActive` and wander budget expires; clear `restSeatId` on wander resume or when `isActive` flips true.
6. `webview-ui/src/office/components/ToolOverlay.tsx` — `getActivityText()`: `isActive && no-active-tool → "Thinking…"`.
7. `src/agentManager.ts` — migrate persisted `seatId` → `workSeatId` on load; persist `workSeatId`.

## Testing

### Unit

- `webview-ui` asset tests (Node test runner): `layoutToSeats` on three synthetic layouts
  - computer on desk + adjacent chair → chair seat is `work`.
  - bare desk + adjacent chair → chair seat is `rest`.
  - standalone couch → all seats are `rest`.
- `server` Vitest: `hookEventHandler` emits `agentStatus: 'active'` on a `UserPromptSubmit` event for a known session.

### Manual verification

- Submit a prompt to an idle agent → character walks to desk before any tool fires; hover reads "Thinking…".
- Text-only turn → character stays at desk until `Stop`; then wanders → rest seat.
- Layout with no `electronics` items on desks → all chairs classified `rest`; character never leaves wander-mode during activity; label still reads "Thinking…" (no work seat to move to).
- Existing decorated layout → migration preserves assignments where possible; any character whose old seat is now a rest seat reassigns to the nearest work seat automatically.

## Risks & known limitations

- **Rest-seat flocking:** multiple idle characters may converge on a nearby couch. Accept initially; tune only if visibly bad.
- **Non-standard electronics category:** external asset packs that ship monitors under `misc` or similar won't satisfy the work-seat rule. Document in `CLAUDE.md` under Asset System; users can re-categorize in `asset-manager.html`.
- **One-time migration drift:** on first load after shipping, some characters will reseat. Expected.
- **Heuristic-mode lag:** without hooks, `isActive` still only flips on first tool; the pre-first-tool move-to-desk and "Thinking…" label won't appear. Hooks are the default path.

## Out of scope (deferred)

- Elapsed thinking time display (`"Thinking 12s"`).
- Post-turn "Responded" flash derived from JSONL text content.
- `AskUserQuestion` as a distinct overlay state.
- Cross-window ghost-agent diagnosis (separate brainstorm per earlier discussion).
