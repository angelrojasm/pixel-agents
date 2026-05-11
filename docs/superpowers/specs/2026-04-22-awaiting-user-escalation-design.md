# Awaiting-User Escalation — Design

**Date:** 2026-04-22
**Status:** Approved design.

## The Problem

Agents can stop with an open question for the user ("should I do A or B?", "which file did you mean?") and this is _not_ a tool-permission prompt. The current signal — an `agentStatus: 'waiting'` message that renders a 2-second green-check bubble — is transient. If the user glances away during those 2 seconds, or walks off entirely, the character transitions to normal idle/wander behavior and there is no lingering indication that the agent actually needs a response. A user can (and has) spent a full day unaware that an agent paused on them.

## The Signal

`Stop` (hooks mode) and `Notification(idle_prompt)` both normalize to `turnEnd` in `server/src/hookEventHandler.ts` and call `markAgentWaiting`. In heuristic mode, the 5s text-idle timer calls the same path via `startWaitingTimer`. All three already fire on exactly the situations where a user _might_ need to respond. We trust the existing signal — no new detection, no message-shape heuristics.

## Two-Tier Behavior

**Tier 1 (unchanged, the first 5 minutes after turnEnd):** transient waiting bubble (2s), character goes to idle, wanders, may claim a rest seat. The office breathes.

**Tier 2 (after grace window elapses with no UserPromptSubmit):** escalate to a persistent `awaitingUser` state:

- Character walks back to its work seat (if not already there).
- A **persistent** bubble stays above the character — a distinct sprite from the permission and waiting bubbles (proposed: a `?` mark). No auto-fade.
- The overlay label reads `Awaiting reply — {elapsed}` where elapsed is humanized (`5m`, `12m`, `2h`, `1d 3h`).

**Clearing tier 2:**

- `UserPromptSubmit` → back to `active`.
- Any tool use → back to `active` (agent resumed on its own).
- Click on the character's bubble → dismiss to normal idle (does **not** send a user prompt); character is free to wander again, no re-escalation unless a _new_ turn ends.

## State & Messages

**New `agentStatus` value:** `awaitingUser` (joins existing `active` | `waiting` | `idle` | string in `agentStatuses`).

**New webview-side character fields:**

- `bubbleType: 'permission' | 'waiting' | 'awaiting-user' | null` (extended union).
- `awaitingSince: number | null` — `Date.now()` when tier 2 latched. Used to render elapsed.

**New extension timer:** `awaitingUserTimers: Map<number, NodeJS.Timeout>`. Scheduled on turnEnd after `markAgentWaiting`. Cleared whenever active state returns or on explicit dismissal.

**New webview→extension message:** `dismissAwaitingUser` with `{ id: number }` — lets the user click-dismiss without triggering an agent prompt. Extension responds by clearing the timer, the state, and sending `agentStatus: 'idle'` back to the webview for symmetry.

## Constants

- `AWAITING_USER_GRACE_MS = 5 * 60 * 1000` — 5 minutes.
- `awaiting-user` bubble sprite in `spriteData.ts`, same 8×8 grid as existing bubbles (tentative: a stylized `?` on amber).

## Character Behavior

- On `awaitingUser` entry (tier 2 latch):
  - Cancel any in-flight wander pause / rest-seat claim.
  - Path the character back to its `workSeatId` (if assignable).
  - Set `bubbleType = 'awaiting-user'`, `awaitingSince = now`.
  - Character stays at desk, static pose (same as `seated-but-not-active` behavior today — reuses the existing rule from CLAUDE.md).
- On exit (any of the clear paths):
  - `bubbleType = null`, `awaitingSince = null`.
  - Resume normal FSM: idle → wander → rest.

## Overlay Label

`ToolOverlay` today picks a status label based on `agentStatus` + tool activity. Add a branch: if `agentStatus === 'awaitingUser'`, render `Awaiting reply — {elapsed}` in an amber-tinted style matching the bubble. Elapsed recomputed from `awaitingSince` each render tick (`ToolOverlay` already re-renders per rAF via the `setTick` pattern).

## Dismissal UX

The close-button (red X) on `ToolOverlay` that today closes the terminal becomes context-dependent when the agent is `awaitingUser`: still a red X, but it dismisses the awaiting state instead of closing the terminal. A second icon isn't worth the pixels; the label change makes the distinction clear.

Alternative (if the overload feels wrong during review): the bubble itself becomes clickable and dismisses; the close button keeps its terminal-close behavior. Default: overload the close button. Revisit if it feels wrong in practice.

## Out of Scope

- Sound re-trigger on tier-2 latch. The initial `waiting` sound already plays at turnEnd; a second ding 5 minutes later is easy to add later if latency still matters.
- OS-level notification (`vscode.window.showInformationMessage`). Same — easy follow-up, not required for the core fix.
- Per-agent tuning of the grace window. One global constant is enough.
- Persistence across VS Code restarts. `awaitingSince` is in-memory only; if VS Code restarts, the next `Stop` (if any) or the user's own action re-evaluates state. Not worth the complexity for v1.

## Implementation Order

1. Extension constants + `AgentState.awaitingSince` + `awaitingUserTimers` map.
2. `markAgentWaiting` schedules tier-2 timer; all "went active" paths cancel it.
3. Webview: extend `bubbleType` union, add `awaiting-user` sprite, renderer cases.
4. `agentStatuses` webview state handles `awaitingUser` → sets bubble + triggers return-to-seat.
5. ToolOverlay label branch + elapsed formatter.
6. `dismissAwaitingUser` message round-trip + character-click/X-click handler.
7. Manual verify: spawn an agent, prompt it with "stop and ask me a question", wait past grace, observe escalation; click to dismiss; prompt again → observe escalation re-arms.

## Testing

- `server/__tests__/hookEventHandler.test.ts`: new test — turnEnd schedules an awaitingUserTimer, UserPromptSubmit cancels it.
- `webview-ui/test/` (Node test runner): no direct test for the React pieces (no test harness); cover the elapsed formatter as a pure function.
