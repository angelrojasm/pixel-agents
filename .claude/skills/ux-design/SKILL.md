---
name: ux-design
description: Section-by-section UX spec authoring for a Pixel Agents surface — a modal (Settings, Info), a toolbar, an overlay (bubble, label, ghost tile), the layout editor flow, or the full-screen vs side-panel behavior. Produces a tight markdown spec at docs/ux/<name>.md that downstream implementation follows.
when_to_use: Before adding a new modal, toolbar, overlay, or interactive canvas behavior; before non-trivial changes to existing flows (Settings modal reorg, editor tool additions, full-screen panel tweaks); when you want the rules written down before touching React/canvas code.
---

# UX Design — Pixel Agents

Author a single-screen/flow UX spec. Output goes to `docs/ux/<kebab-name>.md`. One section at a time. Write as you go.

Pixel Agents surfaces you'll typically spec:

- **React modals**: `SettingsModal`, `InfoModal`, new popovers.
- **Toolbars**: `BottomToolbar`, `ZoomControls`, `EditorToolbar`, `EditActionBar`.
- **Canvas overlays**: `ToolOverlay`, speech bubbles, ghost tiles, selection outline, debug view.
- **Flows**: layout edit mode enter/exit, full-screen panel open/close, agent spawn/despawn.

---

## Phase 0: Resolve target

Argument is the name of the thing being designed (kebab-case, e.g. `settings-modal`, `agent-bubble`, `edit-mode-flow`). If no argument, ask which surface.

Normalize the filename: `docs/ux/<name>.md`.

---

## Phase 1: Gather context

Read before drafting:

1. `CLAUDE.md` — sections `Office UI`, `Layout Editor`, `Full-screen panel`, `Phased Roadmap`. UX must not contradict runtime behavior.
2. `docs/art-direction.md` (if present) — UI chrome rules (sharp corners, hard shadows, pixel font).
3. The existing component(s) the spec touches — e.g. for a new modal: `webview-ui/src/components/SettingsModal.tsx` and `InfoModal.tsx`.
4. `webview-ui/src/constants.ts` — existing magic numbers (keyboard shortcuts, timing, camera, zoom).
5. `webview-ui/src/index.css` — the `--pixel-*` CSS variables.
6. For canvas overlays: `webview-ui/src/office/engine/renderer.ts` and relevant overlay files.

**Retrofit check**: Glob `docs/ux/<name>.md`. If it exists, read it and build a section status table (Complete / Empty / Stale). Only author Empty or Stale sections.

---

## Phase 2: Skeleton

Confirm with user, then write a skeleton at `docs/ux/<name>.md`:

```markdown
# UX Spec: <Surface Name>

> **Status**: In Design
> **Last updated**: <date>
> **Touches**: <file paths in webview-ui/>

## Purpose & User Need

[To be designed]

## Entry & Exit

[To be designed]

## Layout & Information Hierarchy

[To be designed]

## States & Variants

[To be designed]

## Interaction Map

[To be designed]

## Keyboard / Mouse Behavior

[To be designed]

## Visual Chrome

[To be designed]

## Messaging (extension ↔ webview)

[To be designed]

## Edge Cases

[To be designed]

## Acceptance Criteria

[To be designed]
```

---

## Phase 3: Fill sections

For each section: discuss → draft in chat → get approval → Edit into the file → move on.

### Purpose & User Need

- Who triggers this surface? (user click, agent event, /clear)
- What are they trying to do when it appears?
- What would go wrong if it didn't exist?

### Entry & Exit

Two small tables:

| Entry trigger             | Context carried | Example                            |
| ------------------------- | --------------- | ---------------------------------- |
| Click "Settings" button   | none            | `BottomToolbar` → `onOpenSettings` |
| Hook event `SessionStart` | agent id        | `server.ts` → broadcast            |

| Exit trigger                 | Effect                       |
| ---------------------------- | ---------------------------- |
| Click X                      | close modal; no state change |
| Esc (stage 1 of multi-stage) | exit furniture pick          |

### Layout & Information Hierarchy

- Rank every piece of info: primary / secondary / discoverable.
- If applicable, include an ASCII wireframe at 1x zoom.
- Name every zone (header, body, footer, sidebar) and its z-index context.
- For canvas overlays: specify grid-space vs screen-space positioning.

### States & Variants

At minimum cover:

- **Default**
- **Empty** (if the surface displays list data; e.g. Settings with no external asset dirs yet)
- **Loading** (if async — usually rare here)
- **Error** (file write failed, hook registration failed)
- **Edit mode** (for canvas: what changes when `isEditing = true`)
- **Multi-webview** (side-panel + full-screen both open — does this surface appear on both? Stay in sync?)

### Interaction Map

For each interactive element:

| Element            | Input | Feedback       | Outcome                             |
| ------------------ | ----- | -------------- | ----------------------------------- |
| "Add Agent" button | click | button depress | `openClaude` message → new terminal |
| Character sprite   | click | white outline  | select + camera follow              |

Only include input methods the project supports: mouse, keyboard, (no gamepad, no touch).

### Keyboard / Mouse Behavior

- Shortcut bindings (match `webview-ui/src/hooks/useEditorKeyboard.ts` + constants).
- Mouse buttons: left (primary), middle (pan), right (context / erase in editor).
- Esc stages if multi-stage (edit mode has 5 stages — document which stage this surface participates in).
- Focus management: which element gets focus on open? Is focus trapped?

### Visual Chrome

Cite `docs/art-direction.md` rules:

- Sharp corners, 2px solid borders, hard offset shadows.
- Solid `#1e1e2e` bg, `--pixel-*` variables only.
- FS Pixel Sans, no fallbacks.
- Font sizes align to pixel grid where feasible.

### Messaging (extension ↔ webview)

This is Pixel Agents-specific: every webview surface either sends or receives `postMessage`s. List:

| Direction     | Message           | When   | Payload                                                                     |
| ------------- | ----------------- | ------ | --------------------------------------------------------------------------- |
| ext → webview | `settingsLoaded`  | boot   | `{ soundEnabled, hooksEnabled, externalAssetDirectories, defaultCwd, ... }` |
| webview → ext | `setSoundEnabled` | toggle | `{ value: boolean }`                                                        |

For multi-webview surfaces: note whether the message flows through `MessageSink` broadcast (both side-panel + full-screen update) or is addressed to one webview only.

### Edge Cases

- First-run state (no persisted layout, no external packs, no hooks installed).
- No workspace open (extension-host edge case; `defaultCwd` fallback chain).
- Unsaved edits when external file watcher pushes a new layout (last-save-wins rule — see `layoutPersistence.ts`).
- Full-screen panel + side-panel both open.
- `/clear` in the middle of the flow.

### Acceptance Criteria

5+ checkboxes, each testable without reading the spec:

```
- [ ] Opens in <200ms from click
- [ ] All styles pull from --pixel-* CSS variables (grep confirms no inline hex)
- [ ] Survives window reload via persisted state
- [ ] Appears identically in side-panel and full-screen panel
- [ ] Esc closes it (and only it, if multi-stage)
- [ ] <accessibility check if any>
```

---

## Phase 4: Cross-reference

Before marking complete:

- [ ] Every runtime constant referenced lives in `constants.ts`, not inlined.
- [ ] Every message name exists (or is flagged as new) in the shipping protocol list (see `CLAUDE.md` → `Extension ↔ Webview`).
- [ ] No visual rule contradicts `docs/art-direction.md`.
- [ ] Multi-webview behavior is explicit (or noted as N/A).
- [ ] If Phase 3-ready: the spec works in a WebSocket-bridged environment (`MessageSink` abstraction holds).

---

## Phase 5: Close

Suggest next steps:

- Run `/ux-review docs/ux/<name>.md` to validate before implementation.
- Hand off to `superpowers:writing-plans` to turn the spec into an implementation plan.
- If this spec invented a new pattern (e.g. a reusable popover), note it in `docs/art-direction.md` under UI chrome.

---

## Project adaptations

- Dropped sections that assume a full GDD ecosystem (Player Journey, Localization Considerations, Analytics Events).
- Added a first-class `Messaging` section — every Pixel Agents surface has postMessage contracts, and the `MessageSink` broadcast/Phase 3 story must be considered.
- Added a first-class `Multi-webview` edge case — side-panel + full-screen panel sync is a recurring source of bugs.
- Removed gamepad/touch from input coverage (not supported; kb+mouse only).
- Removed `ux-designer` subagent delegation; single maintainer authors directly, uses `superpowers:brainstorming` when direction is unclear.
- Output path is `docs/ux/` not `design/ux/`.
