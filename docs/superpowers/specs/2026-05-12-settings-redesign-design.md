# Settings Menu Redesign — Design

> **Status**: In Design
> **Last updated**: 2026-05-13
> **Touches**:
>
> - `webview-ui/src/components/SettingsModal.tsx`
> - `webview-ui/src/components/settings/*` (new subfolder)
> - `webview-ui/src/components/BottomToolbar.tsx` (entry point unchanged)
> - `webview-ui/src/hooks/useExtensionMessages.ts` (new `restoreCategoryDefaults` round-trip)
> - `webview-ui/src/constants.ts` (modal/sidebar/title-strip sizing constants)
> - `src/constants.ts` (DEFAULT_SETTINGS source of truth)
> - `src/PixelAgentsViewProvider.ts` (`restoreCategoryDefaults` message handler)

## Purpose

The Settings modal today is a single vertically-scrolling list of checkboxes plus a few inputs. With the terminal-polish work adding 3 new knobs (font family, size, line height) and more user-facing toggles queued for Phase 2, the flat list will become unreadable. Reorganize into a game-style **paneled** settings screen — sidebar of categories + content pane — using the existing brutalist pixel-art aesthetic (FS Pixel Sans, 2px hard borders, sharp corners, hard offset shadows, `#1e1e2e` backgrounds). This is a UI restructure, not a behavior change: every existing setting keeps its current semantics.

## Decisions

- **Sidebar + content pane** (not top tabs, not bento, not skeuomorphic). Cross-checked against `ui-ux-pro-max` §4 `style-match` / `consistency` / `effects-match-style`: a brutalist product should stay brutalist. Game-UI flavor comes from chrome details (chunky title strip per panel, accent left-bar on the active category), not from a different style family. Bento is wrong (it's a showcase grid pattern, not navigation). Skeuomorphic chunky beveled buttons would clash with the otherwise flat pixel-art surfaces.
- **Live-apply throughout. No Apply / Cancel ceremony.** Every setting takes effect immediately, just like today. Risky/restart-required settings (e.g. `usePtyTerminal`) get an inline `applies to new agents` muted tag, not a staged-apply pattern. Justification: most settings here are cheap toggles; the cost of staged-apply (dirty tracking, confirm-on-close dialogs, unsaved-state bugs) outweighs the benefit. Game UIs use staged-apply for _expensive_ changes like graphics; we don't have those.
- **Per-section Restore Defaults.** Each panel gets a `Restore Defaults` button in its title strip that resets only that category's values. Triggered via webview→extension message. No global "Reset All Settings" button in v1 — too easy to misfire.
- **Keyboard-first navigation.** ESC closes; ↑/↓ moves between sidebar items; Tab cycles controls within the content pane; focus jumps to the first control when the category changes. **No global "open settings" shortcut in v1** — the Settings button in the bottom toolbar is the canonical entry. (Cmd/Ctrl+, was considered and rejected: it's already bound to VS Code's own Settings, and intercepting it from the webview would surprise users who expect that shortcut to open VS Code's settings even when the office panel has focus.)
- **Fixed-size centered modal at 720×520.** No resize handle. Settings doesn't need it. If a category ever overflows, the content pane scrolls; the chrome stays put.
- **5 categories** (General / Agents / Terminal / Office / About). Derived from the existing settings inventory plus the queued terminal knobs. About is mostly inert (version, changelog link, hooks info, doc links).
- **One canonical defaults table.** A `DEFAULT_SETTINGS` constant in `src/constants.ts` is the single source of truth used both by the `globalState.get(key, DEFAULT)` calls today and by the Restore Defaults handler. No defaults drift.

## Style Cross-Check (ui-ux-pro-max guidance applied)

- §4 `primary-action` — for live-apply there's no primary CTA, only a close button. ✓
- §4 `state-clarity` — sidebar entries have distinct rest / hover / active / disabled states.
- §9 `nav-state-active` — active category shows a 2px accent left-bar + bold label.
- §9 `nav-label-icon` — each sidebar entry has a small SVG glyph + a text label (no emojis, per the "no-emoji icons" rule).
- §1 `escape-routes` — ESC closes the modal.
- §8 `focus-management` — after switching category, focus jumps to the first interactive element in the new panel.
- §8 `input-helper-text` — each control row has a one-line helper below the label.
- §8 `undo-support` — Restore Defaults shows an inline toast with a 5-second Undo affordance (one captured-state snapshot per click).
- §1 `keyboard-nav` — full keyboard support, no mouse-required actions.
- §6 `weight-hierarchy` — FS Pixel Sans at one size, with weight differentiating category headers (bold) from body labels (regular) from helper text (regular + 70% opacity).

## Layout

```
┌─ Settings ─────────────────────────────────────────────────── × ─┐
│┌──────────────┬────────────────────────────────────────────────┐│
││▎● General    │ ━━ Terminal ━━━━━━━━━━━━━━ [Restore Defaults] ││
││  Agents      │                                                ││
││▎  Terminal   │ Use in-panel terminal      [✓]                ││
││  Office      │   Renders the agent's terminal in the panel    ││
││  About       │   instead of VS Code.                          ││
││              │   applies to new agents                        ││
││              │                                                ││
││              │ Font family               [System default ▾]   ││
││              │   Monospaced font used in the terminal pane.   ││
││              │                                                ││
││              │ Font size                 [-  13  +]           ││
││              │                                                ││
││              │ Line height               [- 1.0  +]           ││
││              │                                                ││
││              │ ─── Panel position ────────────────────────    ││
││              │ ○ Bottom  ● Right  ○ Left                     ││
│└──────────────┴────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

- Sidebar width: 160px.
- Content pane: 560px wide, ~480px tall (modal minus header).
- Title strip inside content pane: 32px tall, accent background, bold category name on the left, `Restore Defaults` button right-aligned.
- Section dividers within a panel: 1px horizontal rule with a 10px gap on either side.

## Categories

Mapping from current settings → new homes:

| Category     | Settings (existing)                                                                                      | Settings (added by terminal-polish) |
| ------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **General**  | Sound notifications, Always show labels, Show terminal names, Debug view                                 | —                                   |
| **Agents**   | Watch all sessions, Instant detection (hooks), Default terminal folder                                   | —                                   |
| **Terminal** | Use in-panel terminal, Terminal panel position                                                           | Font family, font size, line height |
| **Office**   | Sessions actions (clear dismissed, etc.), Layout actions (export/import), Asset directories (add/remove) | —                                   |
| **About**    | Extension version, View changelog link, View hooks info link                                             | —                                   |

Sub-agent / teammate naming (which uses `agentName`) is a function of behavior, not a setting — no entry needed.

## Component Tree

```
webview-ui/src/components/
  SettingsModal.tsx          — orchestrator: modal shell, sidebar, content pane, category state
  settings/
    SettingsSidebar.tsx      — vertical category list, keyboard handler
    SettingsTitleStrip.tsx   — title + "Restore Defaults" button
    SettingsRow.tsx          — generic <Label, Control, Helper> row (used by every panel)
    panels/
      GeneralPanel.tsx
      AgentsPanel.tsx
      TerminalPanel.tsx
      OfficePanel.tsx
      AboutPanel.tsx
    controls/
      Checkbox.tsx           — reused (already exists in current modal)
      Dropdown.tsx           — NEW: brutalist styled <select> replacement
      Stepper.tsx            — NEW: `[- N +]` numeric stepper (used for font size, line height)
      RadioGroup.tsx         — NEW: horizontal radio with the pixel chrome (panel position uses this)
      PathInput.tsx          — NEW: text input + browse button (default cwd uses this)
      ListEditor.tsx         — NEW: add/remove list (asset directories uses this)

src/
  constants.ts               — DEFAULT_SETTINGS = { ... } single source of truth
  PixelAgentsViewProvider.ts — handle `restoreCategoryDefaults` message
```

The existing `Checkbox` is reused. Everything else under `controls/` is new, but each is small (≤80 LOC) and styled consistently via the pixel CSS variables already in `index.css`.

## State & Persistence

- **Active category** lives only in component state (not persisted across modal opens — every open starts on `General`). Rationale: settings is rarely revisited, and starting at the top is more predictable than restoring last-viewed.
- **All actual setting values** keep their existing persistence (extension `globalState` for user-wide, `workspaceState` for per-workspace). No schema change.
- **`DEFAULT_SETTINGS` constant**: declared once in `src/constants.ts`, exported. The `globalState.get<T>(KEY, DEFAULT)` sites are updated to reference `DEFAULT_SETTINGS.<field>`. The webview gets the same constants via the shared types file. Restore Defaults pulls from this.

  Scope: `DEFAULT_SETTINGS` only contains _user-facing_ settings (the ones surfaced in the modal). State-tracking flags like `hooksInfoShown` and `lastSeenVersion` stay where they are today and are not resettable by the Restore Defaults flow — they're not settings, they're UI state.

```ts
// src/constants.ts
export const DEFAULT_SETTINGS = {
  general: {
    soundEnabled: true,
    alwaysShowLabels: false,
    showTerminalNames: true,
    debugMode: false,
  },
  agents: {
    watchAllSessions: false,
    hooksEnabled: true,
    defaultCwd: '',
  },
  terminal: {
    usePtyTerminal: false,
    panelPosition: 'bottom' as const,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.0,
  },
  office: {
    externalAssetDirectories: [] as string[],
  },
} as const;
```

## Entry & Exit

| Entry trigger                                 | Context carried  | Example                                           |
| --------------------------------------------- | ---------------- | ------------------------------------------------- |
| Click Settings button in `BottomToolbar`      | none             | `BottomToolbar` → `onOpenSettings` → modal mounts |
| `restoreCategoryDefaults` broadcast (refresh) | updated settings | Extension → `settingsLoaded` → modal re-renders   |
| `externalAssetDirectoriesUpdated` broadcast   | new dir list     | Extension → modal Office panel re-renders         |

| Exit trigger              | Effect                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| Click `×` button          | Close modal; no state change beyond what live-apply already wrote |
| Esc key                   | Close modal; no state change                                      |
| Click outside modal panel | Close modal; no state change                                      |
| Click inside modal panel  | No-op (does not close)                                            |

## Messaging (extension ↔ webview)

| Direction     | Message                                      | When                                                      | Payload                                                                                                                                        |
| ------------- | -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ext → webview | `settingsLoaded` (existing)                  | Boot + after every accepted set/restore                   | Full settings shape (all categories)                                                                                                           |
| ext → webview | `externalAssetDirectoriesUpdated` (existing) | After add/remove                                          | `{ dirs: string[] }`                                                                                                                           |
| webview → ext | `setSoundEnabled` (existing)                 | General toggle                                            | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setAlwaysShowLabels` (existing)             | General toggle                                            | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setShowTerminalNames` (existing)            | General toggle                                            | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setDebugMode` (existing or new — verify)    | General toggle                                            | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setWatchAllSessions` (existing)             | Agents toggle                                             | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setHooksEnabled` (existing)                 | Agents toggle                                             | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setDefaultCwd` (existing)                   | Agents path input commit                                  | `{ value: string }`                                                                                                                            |
| webview → ext | `setUsePtyTerminal` (existing)               | Terminal toggle                                           | `{ enabled: boolean }`                                                                                                                         |
| webview → ext | `setPanelPosition` (existing)                | Terminal radio                                            | `{ position: 'bottom' \| 'left' \| 'right' }`                                                                                                  |
| webview → ext | `setTerminalFontFamily` (existing)           | Terminal dropdown                                         | `{ value: string }`                                                                                                                            |
| webview → ext | `setTerminalFontSize` (existing)             | Terminal stepper                                          | `{ value: number }`                                                                                                                            |
| webview → ext | `setTerminalLineHeight` (existing)           | Terminal stepper                                          | `{ value: number }`                                                                                                                            |
| webview → ext | `addExternalAssetDirectory` (existing)       | Office "Add Asset Directory"                              | `{ path: string }`                                                                                                                             |
| webview → ext | `removeExternalAssetDirectory` (existing)    | Office "Remove" per row                                   | `{ path: string }`                                                                                                                             |
| webview → ext | `restoreCategoryDefaults` (NEW)              | Click "Restore Defaults" or "Undo" inside the title strip | `{ category: 'general' \| 'agents' \| 'terminal' \| 'office', values?: Partial<Settings[Category]> }` (values present ⇒ Undo restore-snapshot) |

**Multi-webview behavior**: every `set*` message and `restoreCategoryDefaults` causes the extension to write storage and emit `settingsLoaded` via `broadcastSink`, which both side-panel and full-screen webviews receive. **Settings modal opened in both webviews stays in sync** — toggling a checkbox in one updates the other modal's rendered value on the next tick.

**Undo snapshot scope**: each modal instance owns its own undo snapshot (it's in component state, not broadcast). If the user clicks Restore Defaults in the side-panel modal, only that modal shows the Undo toast; the full-screen modal will not show one for the same action. This is intentional — the toast is a transient confirmation, not a state machine.

## Behavior

### Opening / closing

- Settings button in `BottomToolbar` opens the modal (existing behavior).
- ESC closes. Click outside the modal panel closes. Click inside doesn't close.
- Modal traps focus while open (verify the existing modal does this; if not, add a focus trap as part of step 1 scaffolding).

### Category switching

- Click sidebar entry → switches category.
- ↑/↓ when sidebar has focus → moves selection and switches category.
- After switch, focus jumps to the first interactive element in the new panel (per §8 `focus-management`).
- Active category: 2px accent left-bar visible; label rendered bold.

### Restore Defaults

- Each panel's title strip has a `Restore Defaults` button.
- On click: snapshot current values for this category → send `restoreCategoryDefaults { category }` message → extension writes defaults into globalState + emits `settingsLoaded` so the webview rerenders → inline toast appears at the bottom of the content pane: `"Defaults restored. [Undo]"` with a 5s timeout.
- Undo: send `restoreCategoryDefaults { category, values: <snapshot> }` (same message, with the snapshot as override).
- One snapshot at a time — clicking Restore Defaults twice replaces the snapshot; the second Undo only undoes the second click.

### Live-apply

Every control writes its value to the extension on change, just like today. No "dirty" state, no save button. The "applies to new agents" muted tag appears beside `usePtyTerminal` because flipping it doesn't migrate existing agents; that's informational, not a deferred-apply pattern.

### Keyboard surface (full table)

| Key             | Where            | Effect                                                                                                                      |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Esc             | Modal            | Close                                                                                                                       |
| ↑ / ↓           | Sidebar focused  | Move selection (auto-switches category)                                                                                     |
| Tab / Shift+Tab | Anywhere         | Cycle interactive elements in order: close button → sidebar → content pane controls top-to-bottom → Restore Defaults button |
| Space / Enter   | Checkbox         | Toggle                                                                                                                      |
| Enter           | Restore Defaults | Trigger                                                                                                                     |
| Enter           | Undo toast       | Trigger undo                                                                                                                |

### A11y

- Modal has `role="dialog"`, `aria-labelledby` pointing at the "Settings" header.
- Sidebar has `role="tablist"`; each entry `role="tab"` with `aria-selected`.
- Each panel has `role="tabpanel"` with `aria-labelledby` pointing at its sidebar entry.
- Restore Defaults uses `aria-label="Restore <Category> defaults"`.
- Undo toast uses `aria-live="polite"` (per `ui-ux-pro-max` §8 `toast-accessibility`).

## Visual Tokens

All from existing `:root` variables in `index.css`. Anything new gets added there, not inlined.

| Token            | Use                                        | Value                                                                     |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `--pixel-bg`     | modal + panel backgrounds                  | `#1e1e2e`                                                                 |
| `--pixel-border` | 2px borders                                | `#0a0a14`                                                                 |
| `--pixel-accent` | active sidebar bar, title strip background | existing accent                                                           |
| `--pixel-muted`  | helper text, "applies to new agents" tag   | existing muted                                                            |
| `--pixel-shadow` | hard offset shadows                        | `2px 2px 0px var(--pixel-border)`                                         |
| Border-radius    | everywhere                                 | `0`                                                                       |
| Font             | everywhere                                 | `FS Pixel Sans` (terminal font is its own thing, configurable separately) |

The Terminal _content_ (xterm) uses its own configurable font from the terminal-polish spec; the Settings UI itself stays on FS Pixel Sans regardless.

## Edge Cases

- **First-run (no persisted settings)**: extension boots with no `globalState` values for any key; `globalState.get(KEY, DEFAULT_SETTINGS.<group>.<key>)` returns the canonical defaults. Settings modal reads them via `settingsLoaded` and renders defaults visibly checked/filled. Restore Defaults button is a no-op visually but still records a snapshot (so Undo can revert if the user mid-flow flipped something).
- **No workspace open**: `defaultCwd` becomes load-bearing (it's the cwd used for new agents). The PathInput control validates by sending the value to the extension; the extension's `resolveDefaultCwd()` does existence-check + `~` expansion. Invalid paths show a muted helper line `Path does not exist — will fall back to home dir` below the input but do not block save (existing behavior preserved).
- **Multi-webview open** (side-panel + full-screen): both modals can be open at once. All settings stay in sync via `settingsLoaded` broadcasts. Undo toasts are per-modal (see §Messaging note). Active-category state is per-modal (each remembers what tab it was on independently — but every fresh open starts on General per the existing decision).
- **`/clear` mid-flow**: settings modal is independent of any agent session, so a `/clear` on any agent has no effect on the modal. The modal is not dismissed by any agent event.
- **Layout file watcher fires while Settings is open**: layout changes affect Office panel actions (export/import). The settings modal does not read layout state, so a layout reload from another VS Code window is a no-op for the modal itself.
- **Hook server `down` while Settings is open**: the `HookHealthToast` from the character-interaction bundle continues to render in the panel area; the Settings modal sits above it (modal `zIndex` > toast `zIndex`). Restoring `hooksEnabled` to its default does NOT toggle the runtime hook installer state — that's a separate manual button under Agents → "Reinstall hooks" (existing).
- **External asset directory removed while present in `ListEditor`**: send `removeExternalAssetDirectory` immediately on click; extension responds with `externalAssetDirectoriesUpdated` carrying the new list; modal re-renders with the row gone. Empty state shows `No external asset directories — drop a furniture pack folder here.` muted text.
- **Restore Defaults clicked twice quickly**: each click replaces the snapshot. Only the most-recent snapshot is restorable via Undo. Spec accepts this; alternative (snapshot stack) is YAGNI.
- **Restore Defaults clicked during the 5-second Undo window**: clicking another Restore Defaults dismisses the existing toast and starts a new one.

## Acceptance Criteria

- [ ] Settings modal opens within 100ms of clicking the toolbar Settings button (perceived as instant).
- [ ] Every existing setting value persists across modal close/reopen and across webview reload (each `set*` message writes to extension `globalState`).
- [ ] Restore Defaults on each category writes `DEFAULT_SETTINGS[category]` to extension `globalState`, emits `settingsLoaded`, and the modal re-renders with the default values within one tick.
- [ ] Undo within 5 seconds restores the snapshot exactly (same values that were displayed pre-restore).
- [ ] Sound notifications setting changed in the side-panel modal updates the visible checkbox state in a simultaneously-open full-screen panel modal within one event-loop tick.
- [ ] Keyboard-only flow: click Settings, ↓ to Office, Tab through every Office control, Space to flip a checkbox, Esc to close — completes without touching the mouse.
- [ ] No new inline hex literals in any settings/\* component (`grep -nE '#[0-9a-fA-F]{6}' webview-ui/src/components/settings/` returns 0).
- [ ] No new VS Code-specific APIs in the settings webview code (`grep -nE 'vscode\\.' webview-ui/src/components/settings/` returns 0) — Phase 3 compatibility.
- [ ] Modal traps focus: Tab from the last interactive element cycles back to the close button; Shift+Tab from the close button cycles to the last interactive element.
- [ ] Unit tests cover every reusable control (`Stepper`, `Dropdown`, `RadioGroup`, `PathInput`, `ListEditor`) at the boundary cases listed in §Testing.
- [ ] Extension test confirms `restoreCategoryDefaults` for each of the 4 categories writes the correct keys to `globalState` and emits `settingsLoaded` (4 cases).
- [ ] Modal sizing (`SETTINGS_MODAL_WIDTH_PX = 720`, `SETTINGS_MODAL_HEIGHT_PX = 520`, `SETTINGS_SIDEBAR_WIDTH_PX = 160`, `SETTINGS_TITLE_STRIP_HEIGHT_PX = 32`) and timing (`SETTINGS_UNDO_TOAST_MS = 5000`) live in `webview-ui/src/constants.ts`; no inline literals in component files.

## Out of Scope

- Global "Reset all settings" button.
- Search/filter within settings.
- Settings export/import.
- Per-workspace overrides of global settings.
- Configurable category order or sidebar visibility.
- Tablet/mobile layout — this is a desktop webview, no responsive variant needed.
- Tooltips on settings (helper text under each label is the documentation surface).
- Settings sync across machines.

## Implementation Order

1. **Scaffolding** — create `settings/` subfolder, declare `DEFAULT_SETTINGS`, build `SettingsModal` shell (sidebar + content pane, no real content yet, just placeholders for each category).
2. **`SettingsRow` + reusable controls** — `Dropdown`, `Stepper`, `RadioGroup`. These are small and unit-testable on their own.
3. **General panel + Debug panel migration** — move the simplest existing settings into the new layout. Verify live-apply still works end-to-end.
4. **Agents panel** — `defaultCwd` is the trickiest existing input (text + validation). Migrate using `PathInput`.
5. **Terminal panel** — depends on terminal-polish spec landing (it adds the font knobs). If terminal-polish hasn't shipped yet, only the existing `usePtyTerminal` + panel position move; add font knobs when terminal-polish ships.
6. **Office panel** — migrate asset directories (`ListEditor`) + layout export/import buttons.
7. **About panel** — last; lowest stakes. Wires up version, changelog modal, hooks info link.
8. **Restore Defaults + Undo** — per-category messages + toast. Land after every panel is migrated so the message handler is generic.

Each step is shippable on its own; the user can experience the new shell with old contents during the migration.

## Testing

- **Unit (webview, Node test runner):**
  - `Stepper` — increment/decrement at min/max boundaries; respects step size.
  - `Dropdown` — keyboard nav (↑/↓ in open state), Enter selects.
  - `SettingsSidebar` — ↑/↓ wraps; Enter no-op (selection is on focus change); active state matches prop.
- **Unit (extension, Vitest):**
  - `restoreCategoryDefaults` message: with no `values` override → writes `DEFAULT_SETTINGS[category]`. With `values` override → writes those.
  - `DEFAULT_SETTINGS` shape: every key referenced by the live `globalState.get(KEY, DEFAULT)` sites is present in the constant.
- **Integration (manual):**
  - Open settings → click each category → confirm panel switches, focus jumps.
  - Toggle every control in every category → confirm value persists across modal close/reopen.
  - Restore Defaults on each category → confirm reset; click Undo within 5s → confirm restore.
  - ESC closes from any category.
  - Keyboard-only: open with the Settings button → focus enters the modal → ↓ to last category → Tab through every control → flip a checkbox with Space → Esc to close. No mouse after opening.

## Compatibility With Phase 3

- The redesign is a webview-internal change. No `MessageSink` schema change beyond adding `restoreCategoryDefaults`, which is a tiny additive message.
- `DEFAULT_SETTINGS` is plain data; the future daemon can serve the same defaults to a remote web SPA without any port.

## Resolved Choices Worth Noting

- **Default-layout export stays command-palette-only.** It's a developer affordance for shipping a new bundled layout, not a user setting; including it in the Office panel would muddy "settings = preferences."
- **Sidebar icons**: Lucide line icons (BSD-licensed, single stroke weight, fits the brutalist line-drawing feel). Exact icons per category get picked during implementation; not blocking.
