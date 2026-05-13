# UX Spec: Terminal ↔ Character Interaction

> **Status**: In Design
> **Last updated**: 2026-05-13
> **Touches**:
>
> - `webview-ui/src/office/panel/OfficePanel.tsx`
> - `webview-ui/src/office/panel/TerminalPane.tsx`
> - `webview-ui/src/office/panel/ptyEventBus.ts`
> - `webview-ui/src/office/panel/usePanelState.ts`
> - `webview-ui/src/office/components/OfficeCanvas.tsx`
> - `webview-ui/src/office/components/ToolOverlay.tsx`
> - `webview-ui/src/office/engine/characters.ts`
> - `webview-ui/src/office/engine/officeState.ts`
> - `webview-ui/src/office/engine/renderer.ts`
> - `webview-ui/src/hooks/useExtensionMessages.ts`
> - `webview-ui/src/App.tsx`
> - `webview-ui/src/constants.ts`
> - `src/PixelAgentsViewProvider.ts`
> - `src/types.ts` (message protocol additions)
> - `src/agentManager.ts` (hook-error surfacing)

## Purpose & User Need

The Phase 2 backend (PtyManager + xterm.js TerminalPane) and the visual chrome bundle landed the **plumbing** for the in-office terminal but left the **connection** between the canvas character and the terminal pane implicit. Today:

- Clicking a character calls `focusAgent`, which (for pty-backed agents) only updates the panel's `focusedAgentId`. There is no visual confirmation in either surface.
- The character's typing animation is driven entirely by JSONL transcript parsing — coarse-grained tool boundaries — even when a much finer signal (pty bytes hitting the screen) is sitting unused in `PtyEventBus`.
- Sub-agents and teammates from `Task` tool calls only have a re-routing rule (`focusAgent → parentAgentId`); the canvas doesn't show that the parent's pty _is_ the sub-agent's I/O.
- Hook-server failures (server crash, install rejection, port collision) are silent — the user sees agents not animating but cannot tell whether the hook is broken vs. the agent is actually idle.

**This bundle ties the two surfaces together** so the office and the terminal feel like one product:

1. **Click-as-focus** is bidirectional and unambiguous: clicking the character focuses the terminal _and_ visually confirms the link; clicking the terminal-pane header confirms which character it is bound to.
2. **PTY → animation** makes the character feel **alive in real time** instead of in JSONL-poll-cycle stutters.
3. **Parent ↔ sub-agent linkage** is visible: when a parent is pty-backed and spawns a sub-agent, the sub-agent character is tinted/styled to indicate "this character writes into THAT terminal."
4. **Hook errors surface** in a single discoverable place (the panel header chevron / a transient toast inside the panel), with optional per-agent escalation when an individual agent's hook stops delivering.

Without this layer the office is a pretty visualization on top of a terminal that doesn't know it exists. With it, the canvas becomes a **first-class control surface** for the terminal.

## Entry & Exit

| Entry trigger                                | Context carried                                     | Example                                                                                              |
| -------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Click character on canvas                    | `agentId` (sub-agents re-route to parent)           | `OfficeCanvas` `onAgentClick` → `App.handleClick` → `panel.focusOrToggle` + `focusAgent` postMessage |
| Click `AgentCell` in `LiteRail`              | `agentId`                                           | `LiteRail` → `onFocusAgent` → same path as above                                                     |
| Click tab in `PanelHeader`                   | `agentId`                                           | `PanelHeader` → `onFocusAgent`                                                                       |
| `ptyData` chunk arrives for focused agent    | `agentId`, byte chunk                               | `PtyEventBus.emitData` → `useCharacterPtyActivity` hook → bumps `Character.ptyActivityUntil`         |
| `ptyExit` for focused agent                  | `agentId`, `code`, `signal`                         | Drives "agent crashed" visual state on the character                                                 |
| `hookHealthChanged` broadcast from extension | `{ status: 'ok' \| 'degraded' \| 'down', reason? }` | Server emits when the hook endpoint stops receiving heartbeats; provider broadcasts to all webviews  |

| Exit trigger                                       | Effect                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Click another character / tab / rail cell          | `focusedAgentId` switches; the prior agent's link affordance fades                                                                 |
| Click `×` on the focused character's `ToolOverlay` | Agent closed; panel falls through to next-most-recent agent (existing behavior)                                                    |
| Click the panel's `[hide]` button                  | Panel collapses to rail. Focused agent's link affordance remains in office (collapsed-panel hint shown on character — see §States) |
| `ptyExit` for a non-focused agent                  | The agent's character renders the "crashed" state; user can click to confirm and close                                             |
| User dismisses the hook-health toast               | Toast disappears; the persistent gear-icon dot remains until hook health returns to `ok`                                           |

## Layout & Information Hierarchy

ASCII at 1× zoom, panel-position = `BOTTOM`:

```
┌────────────────────────────────────────────────────────────────────────────┐
│   ████  ▒    ░░░░  ░░░░  ░░░░  ▒    ████                                   │
│   ████  ▒    ░░░░  ░░░░  ░░░░  ▒    ████      ← canvas (OfficeCanvas)      │
│                                                                            │
│         ★(focus halo)        ●(active link)    ○(idle link)                │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤  ← Splitter (existing)
│ [Tab: agent-A]  Agent A • /Users/.../pixel-agents      [⚙] [⤢] [hide]      │  ← PanelHeader (existing) + new gear/health
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   $ claude --session-id ...                                                │
│   > Working on it...                                                       │
│                                                                            │
│   ← TerminalPane                                                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Information rank:**

| Rank         | What                                                | Where                                                                                  |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Primary      | "Which character is bound to the visible terminal?" | Focus halo on the canvas character + matching identity strip color in the panel header |
| Primary      | "Is the agent typing _right now_?"                  | Character typing animation + xterm cursor blink                                        |
| Secondary    | "Did the agent crash / exit?"                       | Crashed-character glyph + xterm pane "exited" message (existing)                       |
| Secondary    | "Is the parent–subagent link healthy?"              | Sub-agent character renders with `accent`-colored thin line back to parent's tile      |
| Discoverable | "Are hooks broken right now?"                       | Small dot on the gear icon in `PanelHeader` + toast on first failure                   |
| Discoverable | "What just happened to a non-focused agent?"        | `LiteRail` `AgentCell` status dot (existing) gains a `crashed` variant                 |

**Zones / z-indices** (new only — existing zones unchanged):

- Focus halo: canvas, z-sort same as character (drawn _under_ character sprite, _over_ floor).
- Crashed glyph: canvas, drawn _over_ character (small `!` in a red square, sharp 2px border, 4×4 px halo).
- Sub-agent parent line: canvas, drawn _under_ all characters (`z = floor + 1`).
- Hook-health dot on gear: panel-header overlay, `zIndex: 6` (above `PanelHeader` chrome, below modal layer).
- Hook-health toast: webview root, `zIndex: 1000`, anchored bottom-center of panel area (not over canvas).

## States & Variants

### Character link state (canvas)

| State                                | Visual                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle, not focused**                | Existing sprite, no halo                                                                                                                                                           |
| **Idle, focused**                    | Existing sprite + 1px dotted `--pixel-accent` halo around the chair tile (sharp corners, 2 px outside the chair footprint)                                                         |
| **Active, focused (pty emitting)**   | Existing typing animation + 2px solid `--pixel-accent` halo + the chair tile's seat color tints slightly brighter (1 frame at a time, see §Visual Chrome)                          |
| **Active, focused (pty silent ≥1s)** | Halo stays, animation throttles to "reading" pose to telegraph "thinking, not typing"                                                                                              |
| **Active, NOT focused**              | Existing typing animation + 2px solid muted halo (color `--pixel-muted`, not accent) — gives the user a peripheral cue that something else is happening without claiming the focus |
| **Awaiting user**                    | Existing amber bubble + halo becomes amber-tinted                                                                                                                                  |
| **Crashed** (new)                    | Sprite desaturates 60%, red `!` glyph (5×5 px, 2px border) appears top-right of the chair tile. Click to acknowledge — equivalent to clicking the `×` in ToolOverlay.              |
| **Pty stub (focused, not pty-yet)**  | Halo is yellow-tinted (`--pixel-warning`) to signal "panel cannot show this terminal" — pairs with `TerminalPaneStub` hint                                                         |

### Terminal pane state

| State                            | Visual                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No agent focused**             | Existing empty placeholder; panel header shows "No agent selected"                                                                                    |
| **Pty-backed agent, alive**      | xterm pane + existing chrome; identity strip in header shows agent name + cwd                                                                         |
| **Pty-backed agent, exited**     | xterm pane stays visible (read-only), identity strip gains `[exited]` suffix, header gains "Restart" button                                           |
| **Non-pty agent focused**        | `TerminalPaneStub` (existing) + new "Use in-panel terminal" hint (text + arrow pointing at Settings gear)                                             |
| **Hook-health: degraded / down** | Tiny red dot on the gear icon in PanelHeader; identity strip border bottom switches from `--pixel-accent` to `--pixel-warning`; xterm pane unaffected |

### Sub-agent / teammate variants

| State                                    | Visual                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Sub-agent, parent pty-backed**         | Character renders with a 1px dashed line back to parent's chair tile (only visible when parent is focused) |
| **Sub-agent, parent non-pty**            | Existing rendering, no extra line                                                                          |
| **Teammate (lead's terminal hosts I/O)** | Same dashed-line treatment as sub-agent; LEAD badge already exists                                         |

### Multi-webview

All visual states broadcast through `MessageSink` and re-derive client-side from the same `OfficeState`. Both side-panel and full-screen panel render the same halo/glyph/dashed-line state. **Focus is per-webview** (each panel has its own `focusedAgentId`), so the halo can be in one webview and absent in the other when the two are focused on different agents — this is the desired behavior (one user, two views, possibly two different agents-of-interest).

### Hook-health state machine

| From       | To         | Trigger                                                                    |
| ---------- | ---------- | -------------------------------------------------------------------------- |
| `ok`       | `degraded` | `HOOK_HEARTBEAT_MISS_DEGRADED` missed heartbeats (configurable; default 2) |
| `degraded` | `down`     | `HOOK_HEARTBEAT_MISS_DOWN` total missed (default 3)                        |
| `degraded` | `ok`       | Single successful heartbeat (immediate recovery)                           |
| `down`     | `ok`       | Single successful heartbeat (immediate recovery)                           |
| boot       | `ok`       | First successful heartbeat                                                 |
| boot       | `down`     | Only after `HOOK_HEALTH_BOOT_GRACE_MS` AND failed first health check       |

`degraded` is informational (gear-icon dot in `--color-warning`); `down` is actionable (gear-icon dot in `--color-danger` + toast). The single state-machine source-of-truth lives in `server/src/healthMonitor.ts` (new module); the webview only consumes broadcast events and never derives its own state.

### Crash-acknowledgement persistence

`Character.crashedAcknowledged` is **ephemeral** — it lives on the in-memory character struct in `OfficeState` and resets to `false` on:

- Webview reload (the office state is rebuilt from `existingAgents` and the canonical `agentStatus` broadcast).
- Receipt of a new `agentCrashed` broadcast for the same agent (a re-crash should re-glyph).
- The character despawning (matrix-effect: `'despawn'`).

This means: if the user closes and reopens the panel, agents still in `exited` state will re-glyph and prompt acknowledgment again. This is the intended behavior — the user has a fresh chance to notice across reload.

### Edit mode

In edit mode, the canvas is dedicated to layout work. **All interaction-layer visuals are suppressed**: no halos, no crashed glyphs, no dashed lines. The terminal pane keeps its existing visuals (edit mode does not touch the panel).

## Interaction Map

| Element                                     | Input      | Feedback                                  | Outcome                                                                                                |
| ------------------------------------------- | ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Character on canvas (focused or not)        | left click | white outline (existing) + new focus halo | `focusAgent` postMessage + `panel.focusOrToggle(id)`; opens panel if collapsed                         |
| Character with `crashed` glyph              | left click | white outline + glyph briefly flashes     | Same as above _plus_ flag `crashedAcknowledged` so the glyph hides until next `ptyExit`                |
| Sub-agent character                         | left click | brief dashed-line emphasis (3 frames)     | `focusAgent` postMessage with parent's id (existing) + new dashed-line flash                           |
| Terminal pane (xterm)                       | left click | xterm cursor regains focus (existing)     | No new behavior; affordance is documented for the user                                                 |
| `PanelHeader` gear icon (existing)          | left click | hover fade (existing)                     | Opens settings (existing). If hooks-down, **also** clears the toast dismissal so future toasts re-show |
| Hook-health toast `×`                       | left click | toast fades                               | Toast dismissed for the rest of this session; persistent gear dot remains                              |
| `LiteRail` `AgentCell` with `crashed` state | left click | same as character click                   | `focusAgent` + scroll the relevant `xterm` to the bottom to surface the exit message                   |

## Keyboard / Mouse Behavior

| Shortcut                    | When                             | Behavior                                                                        |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `Tab` inside xterm          | always                           | xterm consumes (existing)                                                       |
| `Cmd/Ctrl+F` inside xterm   | always                           | terminal search (shipped in QoL bundle)                                         |
| `Esc` inside xterm          | search open                      | close search (shipped)                                                          |
| `Esc` on canvas             | character selected, no edit mode | deselect (existing); **does not** unfocus the panel terminal                    |
| `Cmd/Ctrl+1..9`             | canvas focused                   | (new) focus the Nth agent in current rail order; mirrors the LiteRail tab order |
| `Cmd/Ctrl+'` (single-quote) | canvas focused                   | (new) toggle panel rail/open mode — equivalent to clicking `[hide]`             |

The new shortcuts are **canvas-context-only**: when xterm has focus, they pass through to xterm. Custom-key handler in `TerminalPane` is unchanged.

> **Phase 3 caveat**: in the browser SPA runtime, `Cmd/Ctrl+1..9` is reserved by the browser for tab switching and will never reach the canvas. These bindings are effectively VS Code-only. When the Phase 3 SPA ships, an alternative chord (likely `Cmd/Ctrl+Alt+1..9`) replaces them via runtime detection (`isBrowserRuntime`). `Cmd/Ctrl+'` is not reserved by major browsers and works in both runtimes.

**Focus management:**

- Click character → canvas keeps DOM focus, character is `selectedAgentId`, panel becomes `focusedAgentId`. Xterm does NOT auto-focus on character click (would steal keyboard from canvas users mid-paint).
- Click anywhere inside `TerminalPane` → xterm focuses. This is the only path that moves DOM focus into xterm.
- Click the panel header tab → panel updates `focusedAgentId`; xterm does NOT auto-focus (consistent with character click).

## Visual Chrome

All new visuals are sharp-corner, 2px border, hard offset shadows, FS Pixel Sans. Colors **must** reference existing tokens — never inline hex.

**Token mapping** (constant name → existing token reused):

| Constant (new in `constants.ts`) | Reuses existing token                    | Purpose                      |
| -------------------------------- | ---------------------------------------- | ---------------------------- |
| `FOCUS_HALO_COLOR_ACCENT`        | `PANEL_ACCENT`                           | Active+focused halo          |
| `FOCUS_HALO_COLOR_MUTED`         | `PANEL_MUTED`                            | Active+non-focused halo      |
| `FOCUS_HALO_COLOR_AWAITING`      | `var(--color-status-permission)` (amber) | Awaiting-user halo tint      |
| `FOCUS_HALO_COLOR_WARNING`       | `var(--color-warning)`                   | Pty-stub state               |
| `CRASHED_GLYPH_BG`               | `var(--color-danger)`                    | Crashed `!` glyph background |
| `CRASHED_GLYPH_BORDER`           | `PIXEL_OUTLINE` (existing)               | Glyph border                 |
| `SUBAGENT_LINK_COLOR`            | `PANEL_MUTED`                            | Parent-link dashed line      |
| `HOOK_HEALTH_DOT_COLOR_DOWN`     | `var(--color-danger)`                    | Gear-icon dot                |
| `HOOK_HEALTH_DOT_COLOR_DEGRADED` | `var(--color-warning)`                   | Gear-icon dot                |

**Sizing / timing constants** (all new, all in `webview-ui/src/constants.ts`):

| Constant                          | Value           | Notes                                                 |
| --------------------------------- | --------------- | ----------------------------------------------------- |
| `FOCUS_HALO_WIDTH_PX`             | 2               | Matches `PANEL_BORDER` thickness                      |
| `FOCUS_HALO_INSET_PX`             | 2               | Inflated bounds around chair footprint                |
| `FOCUS_HALO_DOTTED_DASH`          | `[1, 1]`        | Dotted variant for idle-focused                       |
| `FOCUS_HALO_SOLID_DASH`           | `[]`            | Solid line for active-focused                         |
| `CRASHED_GLYPH_SIZE_PX`           | 5               | Visible at 1× zoom                                    |
| `CRASHED_GLYPH_OFFSET_X_PX`       | `TILE_SIZE - 6` | Top-right of chair tile                               |
| `CRASHED_GLYPH_OFFSET_Y_PX`       | -6              | Above chair tile baseline                             |
| `CRASHED_DESATURATION_PCT`        | 60              | HSL saturation cut applied via sprite-cache variant   |
| `SUBAGENT_LINK_DASH`              | `[2, 2]`        | Dashed line pattern                                   |
| `SUBAGENT_LINK_WIDTH_PX`          | 1               | Subtle, doesn't compete with sprites                  |
| `SUBAGENT_LINK_FLASH_DURATION_MS` | 250             | Brief emphasis on sub-agent click                     |
| `PTY_ACTIVITY_HOLD_MS`            | 200             | Bytes within this window keep character "typing"      |
| `PTY_SILENCE_TO_READING_MS`       | 1000            | 1s silence flips animation to "reading"               |
| `HOOK_HEALTH_DOT_SIZE_PX`         | 4               | Small enough to ride on gear icon                     |
| `HOOK_HEALTH_TOAST_DURATION_MS`   | 0               | 0 ⇒ sticky until dismissed                            |
| `HOOK_HEARTBEAT_MISS_DEGRADED`    | 2               | Missed heartbeats before `ok → degraded`              |
| `HOOK_HEARTBEAT_MISS_DOWN`        | 3               | Missed heartbeats before `degraded → down`            |
| `HOOK_HEALTH_BOOT_GRACE_MS`       | 3000            | Suppress `down` toast during first 3s of webview boot |

**Renderer integration:**

- Focus halo: drawn in `renderer.ts` inside the entity pass _before_ the character sprite, using the chair-tile rect inflated by `FOCUS_HALO_INSET_PX`. Halo color and dash pattern come from `getFocusHaloStyle(character, isFocused)` in a new `characterHalo.ts` module so the renderer stays thin.
- Crashed glyph: drawn after the character sprite, using `CRASHED_GLYPH_*` constants. Click-through hit-testing is handled by the existing `OfficeCanvas` character hit test (no new hit zone — clicking the chair tile counts as clicking the glyph).
- Sub-agent line: drawn in the entity pass before any character at `zY = floor + 1` so it sits behind everyone.
- **Desaturation strategy**: implemented as a new sprite-cache key suffix `:crashed` (existing cache is keyed `"palette:hueShift"`). `hueShiftSprites()` gets a sibling `desaturateSprites(spriteSet, pct)` that walks each frame's HSL and clamps saturation. Cache churn is one-time per agent crash; cached sprite is reused across frames. Avoids a per-pixel pass in the hot renderer loop.

## Messaging (extension ↔ webview)

| Direction         | Message                   | When                                                                                                                                                               | Payload                                                                                 |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| ext → webview     | `agentCrashed` (new)      | `ptyExit` arrives or `terminalRef.exitStatus` becomes available with non-zero code                                                                                 | `{ agentId: number, code: number, signal?: string }`                                    |
| webview → ext     | `acknowledgeCrash` (new)  | User clicks crashed glyph or `×` on crashed agent                                                                                                                  | `{ agentId: number }` — extension clears any pending crash banner and stops resurfacing |
| ext → webview     | `hookHealthChanged` (new) | Server emits when its internal health check changes status (boot, port collision, heartbeat lost)                                                                  | `{ status: 'ok' \| 'degraded' \| 'down', reason?: string, since?: number }`             |
| webview → ext     | `restartAgent` (new)      | User clicks "Restart" in `PanelHeader` of an exited pty agent                                                                                                      | `{ agentId: number }` — extension calls `agentManager.restartPty(id)`                   |
| webview ↔ webview | _(implicit)_              | PtyEventBus already broadcasts `ptyData` to the subscribed pane — the new bus method exposes a thin `subscribeActivity(agentId, cb)` for `useCharacterPtyActivity` | No new wire message; pure intra-webview                                                 |

All ext → webview messages flow through the **broadcastSink** so both webviews stay in sync. `restartAgent` and `acknowledgeCrash` are addressed at the extension and have no per-webview routing.

**Pty-activity → animation path (no new wire message):**

`PtyEventBus` already routes `ptyData`. A new `subscribeActivity(agentId, cb)` (no payload — fires once when bytes arrive, debounced at `PTY_ACTIVITY_HOLD_MS`) is added so `useCharacterPtyActivity` can drive `Character.ptyActivityUntil = Date.now() + PTY_ACTIVITY_HOLD_MS`. The character FSM (`characters.ts`) reads `ptyActivityUntil` when picking between TYPE and READ poses, **but only when `isActive` is true** — silence does NOT flip a non-active character to active, and JSONL-driven `isActive` is still the source of truth for the active/idle binary.

This means: removing `usePtyTerminal` (back to native terminal) gracefully degrades — the animation falls back to JSONL-driven tool boundaries because `ptyActivityUntil` is always 0.

## Edge Cases

- **Pty stub state with `usePtyTerminal=on`**: focused agent has no pty yet (waiting on `terminalPaneReady` round-trip). Halo renders yellow-tinted; `TerminalPaneStub` shows "Starting terminal…" rather than "Use in-panel terminal." Cleared on first `ptyData`.
- **`usePtyTerminal=off`**: never render halos in pty colors; the focus halo always uses the accent color. PTY activity hook subscribes anyway and just never fires (bus has no data).
- **Crashed glyph + agent already closed**: if `agentCrashed` arrives for an `agentId` not in `agentSummaries`, drop the message (do not resurrect a closed agent). This can happen if the user clicked `×` between the pty exit and the broadcast.
- **Hook-health toast + first-run**: don't show a `down` toast within the first 3 seconds of webview boot — the server may not have started yet. Use a `hookHealthChanged` `ok` event from the server to clear any boot-time skepticism.
- **Two webviews, same agent crashes**: both webviews receive `agentCrashed`; both render the glyph. Clicking in one webview broadcasts `acknowledgeCrash`; the extension responds with a fresh `agentStatus` (existing message) that both webviews consume to clear the glyph. **The glyph is server-of-truth driven**, not local.
- **Sub-agent crashes**: `ptyExit` is parent-scoped (sub-agents share the parent's pty). If the parent's pty exits with a non-zero code _during_ a sub-agent's Task tool, both characters render `crashed` (parent gets the glyph; sub-agent inherits via `subagentMeta.parentAgentId` lookup). **If the sub-agent character has already despawned** (Task tool_result landed first, sub-agent in matrix-effect `'despawn'` or already removed from `officeState.characters`), the inheritance is a no-op — only the parent shows the glyph.
- **`/clear` mid-flight**: existing /clear handling reassigns the JSONL file. The character's halo/glyph state must reset on `agentReassigned` (existing message) so a fresh session doesn't inherit old crashed flags. Tested in spec coverage.
- **Edit mode entered while crashed glyph is visible**: glyph hides (per "all interaction visuals suppressed" rule) and re-appears on edit-mode exit if the agent is still crashed.
- **No workspace open**: pty agents launched against `defaultCwd` — focus halo/glyph behave identically; identity-strip in header shows the resolved cwd (existing).
- **Full-screen panel only (side-panel never opened)**: all new messages still arrive via broadcastSink. No special-case routing needed.

## Acceptance Criteria

- [ ] Clicking a character on the canvas renders a 2px solid accent halo around that character's chair tile **and** opens the panel to focus that agent's terminal (or focuses an already-open panel). Verified visually in side-panel and full-screen panel.
- [ ] When `usePtyTerminal=on` and the focused pty is emitting bytes, the character's typing animation runs at full frame rate; 1s after the last byte the animation switches to the "reading" pose. Verified by running `for i in $(seq 1 200); do echo $i; sleep 0.05; done` in the focused agent.
- [ ] **Performance — pty→animation latency**: character typing animation begins within 1 frame (≤16ms at 60fps) of `ptyData` arrival for the focused agent, measured via a `performance.now()` instrument in `useCharacterPtyActivity`. The instrument is dev-only and stripped in production builds.
- [ ] **Performance — renderer cost**: the new halo + glyph + sub-agent-line passes add no more than 0.5ms per frame to the renderer's hot loop on a 20×11 grid with 6 agents (measured via the existing perf-profile skill's renderer benchmark).
- [ ] An agent whose pty exits with non-zero code renders a `!` glyph on its chair tile and its sprite desaturates via the cache-keyed sprite variant. Clicking the character clears the glyph and re-saturates the sprite. The exit code is visible in xterm (existing).
- [ ] **Persistence — crash glyph is ephemeral**: reloading the webview resets `crashedAcknowledged` to `false` for every character; any agent still in `exited` state on the extension side re-renders the glyph after `existingAgents` replay.
- [ ] **Persistence — hook health survives reload**: on webview boot, the server's current health status is broadcast in the first `hookHealthChanged` event within `HOOK_HEALTH_BOOT_GRACE_MS`; if `down` at boot, the toast and gear dot appear once the grace window elapses.
- [ ] Sub-agents whose parent is pty-backed render a 1px dashed muted line back to the parent's chair tile when the parent is focused. The line is suppressed when the parent is not focused.
- [ ] When the hook server's health changes to `down`, a sticky toast appears in the panel area (bottom-center, NOT over canvas) with the reason and a `×`; the gear icon in `PanelHeader` gains a 4×4 px dot in `--color-danger`. Toast dismissal hides the toast for the session; the dot persists until health returns to `ok`.
- [ ] All new constants live in `webview-ui/src/constants.ts` (and `src/constants.ts` for any extension-side timing). `grep -nE '#[0-9a-fA-F]{6}' webview-ui/src/office/components/OfficeCanvas.tsx webview-ui/src/office/engine/renderer.ts | grep -v constants.js` returns no inline hex except pre-existing entries.
- [ ] All new ext→webview messages flow through `broadcastSink`. `grep -n 'broadcastSink.postMessage' src/PixelAgentsViewProvider.ts` includes every new message type.
- [ ] All visuals suppress in edit mode (`officeState.isEditMode === true`).
- [ ] Cmd/Ctrl+1..9 from the canvas focuses the Nth rail agent and respects current rail order. (VS Code runtime only; see Phase 3 caveat.)
- [ ] Cmd/Ctrl+' from the canvas toggles the panel rail/open mode and does not steal input from xterm when xterm has DOM focus.
- [ ] Unit tests cover: `getFocusHaloStyle()` selector matrix, the pty-activity hook reducer (no DOM), the `agentCrashed`/`acknowledgeCrash` round-trip in `useExtensionMessages`, and the hook-health state machine transitions.
- [ ] **Multi-webview**: opening the side-panel and full-screen-panel simultaneously, clicking a character in one shows the halo on the same character in both, but the panel `focusedAgentId` updates independently per webview. The `agentCrashed` glyph appears in both webviews when an agent crashes; acknowledging in one clears it in both via the broadcast-back loop.

## Cross-reference

- [x] Every runtime constant lives in `constants.ts` (see Visual Chrome). No inline hex in renderer or OfficeCanvas.
- [x] New messages `agentCrashed`, `acknowledgeCrash`, `hookHealthChanged`, `restartAgent` flagged as additions to the protocol list in `CLAUDE.md` § Extension ↔ Webview.
- [x] No visual rule contradicts the established pixel-art chrome (sharp corners, 2px borders, hard shadows, FS Pixel Sans).
- [x] Multi-webview explicit (focus per-webview; visuals broadcast).
- [x] Phase-3 compatible: `MessageSink` carries every new outbound message; `MessageSource` carries every new inbound; `PtyEventBus` activity subscription is intra-webview only and survives a transport swap.
