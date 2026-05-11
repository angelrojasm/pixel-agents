# Character Name Labels — Design Spec

**Date:** 2026-04-19
**Status:** Approved for implementation planning

## Problem

When multiple agents are open, the pixel-art office shows animated characters, but there is no visible mapping between a character and its VS Code terminal tab (e.g. "Copyrighter Frontend", "misc", "Budget"). Users cannot tell at a glance which character corresponds to which terminal/conversation.

## Goal

Allow the user to identify which character belongs to which terminal tab by displaying the terminal name on the character's existing overlay, behind an opt-in setting.

## Non-Goals

- Renaming terminals from the pixel office.
- Editing a separate nickname/alias for a character.
- Always-on nameplates baked into the canvas (out of scope; existing "Always Show Labels" setting already covers the always-visible use case).

## Design Summary

Add a single boolean setting, **"Show Terminal Names"** (default: off), in the existing Settings modal. When enabled, the terminal's name (e.g. `Copyrighter Frontend`) is rendered as an extra line on the character's hover/select overlay, reusing the existing `ToolOverlay` React component.

## User Experience

- With the setting **off**: no behavior change. Existing overlay shows activity/team/folder info only.
- With the setting **on**:
  - Hovering a character shows its terminal name on the overlay.
  - Selecting (clicking) a character keeps the overlay open with the terminal name visible.
  - If "Always Show Labels" is also on, terminal names show permanently on every character overlay.
- The terminal name is truncated/ellipsized if it exceeds the existing overlay width (same treatment as folder name today).

## Architecture

### Data source

`vscode.Terminal.name` is already accessible in the extension via `agent.terminalRef.name`. The extension currently tracks this (it's even persisted as `PersistedAgent.terminalName` in workspace state), but never forwards it to the webview for display.

### Extension → Webview message flow

1. On agent creation (`launchNewTerminal` in `src/agentManager.ts:139`): include `terminalName: terminal.name` in the `agentCreated` message.
2. On agent restoration (`sendExistingAgents` in `src/agentManager.ts:517`): add a `terminalNames: Record<number, string>` map alongside the existing `folderNames` map.
3. On rename detection: VS Code has no terminal-rename event, so poll `vscode.window.terminals[].name` every 2 seconds. If any agent's live terminal name differs from its last-sent value, push a new `agentTerminalNameChanged` message with `{ id, terminalName }`.
4. Persist nothing new — `PersistedAgent.terminalName` already exists and is restored on reload.

### Webview state

1. Extend `Character` (in `webview-ui/src/office/types.ts`) to carry an optional `terminalName?: string` field, similar to the existing `folderName?` and `teamName?` fields.
2. Handle the three messages in `useExtensionMessages.ts`:
   - `agentCreated` — set `terminalName` on the new character.
   - `existingAgents` — iterate `terminalNames` map and set each character's `terminalName`.
   - `agentTerminalNameChanged` — update the named character in place.

### Rendering

`webview-ui/src/office/components/ToolOverlay.tsx` renders one label per visible agent. Add a conditional line when the setting is on and `ch.terminalName` is present, styled the same as the existing folder-name line (`text-2xs leading-none`, ellipsized).

Order in the overlay (top to bottom):

1. Team role label (existing)
2. Activity text (existing, primary)
3. **Terminal name** (new, only when setting on)
4. Folder name (existing)

### Setting

New boolean setting `pixel-agents.showTerminalNames` persisted to extension `globalState` (user-level, like `pixel-agents.soundEnabled`). Initial value defaults to `false`.

Wiring:

- Extension stores it in `globalState`.
- `settingsLoaded` message extended with `showTerminalNames: boolean`.
- Webview adds a `showTerminalNames` prop to `App.tsx`, passed down to both `SettingsModal.tsx` (checkbox) and `ToolOverlay.tsx` (render guard).
- New message `setShowTerminalNames: { enabled: boolean }` updates `globalState` and echoes back.

## Error Handling

- Missing terminal reference (restored dead terminal, external agent): `terminalName` is undefined and the line is not rendered.
- Empty string terminal name: treated as absent (same guard).
- Terminal name shorter than visual minimum: no special case — CSS handles rendering.

## Testing

- Unit test in `webview-ui/test/` (if one exists for overlay component state; check first): verify that `terminalName` appears in the overlay output when `showTerminalNames` is true and absent when false.
- Manual verification in Extension Development Host and in the user's real VS Code window:
  - Create multiple agents with distinct terminal names.
  - Toggle setting on → names appear on hover.
  - Rename a terminal in VS Code → name updates in overlay within ~2s.
  - Toggle off → names disappear.

## Scope Boundary

- No changes to the canvas renderer, sprite system, or game loop.
- No changes to layout persistence or server code.
- No new assets.
- Only touches: `src/agentManager.ts`, `src/PixelAgentsViewProvider.ts`, `src/types.ts`, `src/constants.ts` (new globalState key), `webview-ui/src/App.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts`, `webview-ui/src/office/types.ts`, `webview-ui/src/office/components/ToolOverlay.tsx`, `webview-ui/src/components/SettingsModal.tsx`.

## Open Questions

None.
