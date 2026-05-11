# Character Name Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable setting that surfaces each VS Code terminal's tab name (e.g. "Copyrighter Frontend") on the corresponding agent character's hover/select overlay in the Pixel Agents office.

**Architecture:** The extension already tracks `vscode.Terminal.name` in `agent.terminalRef.name`. We forward that string to the webview on agent creation, restoration, and rename (via 2s poll), store it on each `Character`, and render it as an extra line in the existing `ToolOverlay` React component when a new `showTerminalNames` global setting is enabled.

**Tech Stack:** VS Code Extension API (Node/TypeScript), React 18 + TypeScript + Vite (webview), `postMessage` protocol between extension host and webview.

**Spec:** `docs/superpowers/specs/2026-04-19-character-name-labels-design.md`

**Testing strategy:** No component tests exist for webview UI (only `webview-ui/test/dev-assets.test.ts` for asset loading). Adding React Testing Library for a single overlay change is YAGNI. Verification relies on: (a) `npm run check-types`, (b) `npm run lint`, (c) manual smoke in the Extension Development Host (F5), (d) install-and-reload in the user's real VS Code window.

---

## File Map

**Extension backend (TypeScript, Node):**

- `src/constants.ts` — add new `GLOBAL_KEY_SHOW_TERMINAL_NAMES` key.
- `src/agentManager.ts` — include `terminalName` in `agentCreated` and `existingAgents` messages.
- `src/PixelAgentsViewProvider.ts` — handle `setShowTerminalNames` message, include setting in `settingsLoaded`, start 2s terminal-rename poller.

**Webview (React + TypeScript):**

- `webview-ui/src/office/types.ts` — add `terminalName?: string` to `Character`.
- `webview-ui/src/office/engine/officeState.ts` — extend `addAgent()` to accept `terminalName`, add `setAgentTerminalName()`.
- `webview-ui/src/hooks/useExtensionMessages.ts` — buffer + apply `terminalName` from messages, expose `showTerminalNames` state.
- `webview-ui/src/App.tsx` — wire `showTerminalNames` state + toggle handler, pass to overlay + settings.
- `webview-ui/src/office/components/ToolOverlay.tsx` — render terminal-name line when setting is enabled.
- `webview-ui/src/components/SettingsModal.tsx` — add "Show Terminal Names" checkbox.

---

## Task 1: Add the persisted setting key

**Files:**

- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant**

Open `src/constants.ts`. In the "Settings Persistence (VS Code globalState keys)" block, add a new line after `GLOBAL_KEY_HOOKS_INFO_SHOWN`:

```typescript
export const GLOBAL_KEY_SHOW_TERMINAL_NAMES = 'pixel-agents.showTerminalNames';
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat(settings): add showTerminalNames globalState key"
```

---

## Task 2: Extension reads, persists, and emits the setting

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts` (import block, `webviewReady` handler, `setShowTerminalNames` handler)

- [ ] **Step 1: Import the new constant**

In `src/PixelAgentsViewProvider.ts`, find the import block that starts with `import { GLOBAL_KEY_ALWAYS_SHOW_LABELS,` (around line 40-49) and add `GLOBAL_KEY_SHOW_TERMINAL_NAMES` alphabetically:

```typescript
import {
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_HOOKS_INFO_SHOWN,
  GLOBAL_KEY_LAST_SEEN_VERSION,
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
```

- [ ] **Step 2: Read the setting in `webviewReady` and include it in `settingsLoaded`**

In `resolveWebviewView`, inside the `else if (message.type === 'webviewReady')` branch, after the existing `const alwaysShowLabels = ...` read (around line 500), add:

```typescript
const showTerminalNames = this.context.globalState.get<boolean>(
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  false,
);
```

Then in the `this.webview?.postMessage({ type: 'settingsLoaded', ... })` call, add `showTerminalNames` alongside `alwaysShowLabels`:

```typescript
this.webview?.postMessage({
  type: 'settingsLoaded',
  soundEnabled,
  lastSeenVersion,
  extensionVersion,
  watchAllSessions,
  alwaysShowLabels,
  showTerminalNames,
  hooksEnabled,
  hooksInfoShown,
  externalAssetDirectories: config.externalAssetDirectories,
});
```

- [ ] **Step 3: Handle the `setShowTerminalNames` message from webview**

In the same `resolveWebviewView` message-dispatch chain, add a new branch right after the existing `else if (message.type === 'setAlwaysShowLabels')` handler:

```typescript
} else if (message.type === 'setShowTerminalNames') {
  this.context.globalState.update(GLOBAL_KEY_SHOW_TERMINAL_NAMES, message.enabled);
}
```

- [ ] **Step 4: Type-check**

Run:

```bash
cd /Users/angel/Desktop/pixel-agents && npm run check-types
```

Expected: passes with no errors. If TypeScript flags `showTerminalNames` as unused because no consumer yet, ignore — subsequent tasks add consumers.

- [ ] **Step 5: Commit**

```bash
git add src/PixelAgentsViewProvider.ts
git commit -m "feat(extension): persist and emit showTerminalNames setting"
```

---

## Task 3: Send `terminalName` on agent creation

**Files:**

- Modify: `src/agentManager.ts` (`launchNewTerminal`, around line 139)

- [ ] **Step 1: Include terminalName in `agentCreated` message**

In `src/agentManager.ts`, locate the `launchNewTerminal` function. Find the existing line:

```typescript
webview?.postMessage({ type: 'agentCreated', id, folderName });
```

Replace it with:

```typescript
webview?.postMessage({
  type: 'agentCreated',
  id,
  folderName,
  terminalName: terminal.name,
});
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run check-types
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/agentManager.ts
git commit -m "feat(extension): send terminalName in agentCreated message"
```

---

## Task 4: Send terminal names on restore

**Files:**

- Modify: `src/agentManager.ts` (`sendExistingAgents`, around line 517)

- [ ] **Step 1: Build a terminalNames map and include it in `existingAgents`**

In `sendExistingAgents`, find the block that builds `folderNames` and `externalAgents` (around line 535). After that block, add a parallel build for terminal names, then include it in the post:

```typescript
const terminalNames: Record<number, string> = {};
for (const [id, agent] of agents) {
  if (agent.terminalRef?.name) {
    terminalNames[id] = agent.terminalRef.name;
  }
}
```

Then update the `webview.postMessage` call to include `terminalNames`:

```typescript
webview.postMessage({
  type: 'existingAgents',
  agents: agentIds,
  agentMeta,
  folderNames,
  externalAgents,
  terminalNames,
});
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run check-types
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/agentManager.ts
git commit -m "feat(extension): send terminalNames map in existingAgents"
```

---

## Task 5: Poll terminal renames and push updates

VS Code has no terminal-rename event. We poll every 2 seconds and emit `agentTerminalNameChanged` when a name differs from the last-sent value.

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts` (new class field, poll lifecycle in `resolveWebviewView`, cleanup in `dispose`)
- Modify: `src/constants.ts` (interval constant)

- [ ] **Step 1: Add a poll interval constant**

In `src/constants.ts`, add under the "User-Level Layout Persistence" block or create a new block:

```typescript
// ── Terminal Name Polling ────────────────────────────────────
export const TERMINAL_NAME_POLL_INTERVAL_MS = 2000;
```

- [ ] **Step 2: Add class field for the poller**

In `src/PixelAgentsViewProvider.ts`, near the other timer fields (around line 87), add:

```typescript
// Terminal name rename detection
private terminalNamePollTimer: ReturnType<typeof setInterval> | null = null;
private lastSentTerminalNames = new Map<number, string>();
```

- [ ] **Step 3: Import the new constant**

Add `TERMINAL_NAME_POLL_INTERVAL_MS` to the import from `./constants.js` in the same file.

- [ ] **Step 4: Start the poller after agents are restored**

In `resolveWebviewView`, inside the `webviewReady` branch, after the existing `sendExistingAgents(this.agents, this.context, this.webview);` call (around line 693), add:

```typescript
// Seed last-sent snapshot so we only push real changes
for (const [id, agent] of this.agents) {
  if (agent.terminalRef?.name) {
    this.lastSentTerminalNames.set(id, agent.terminalRef.name);
  }
}
if (!this.terminalNamePollTimer) {
  this.terminalNamePollTimer = setInterval(() => {
    for (const [id, agent] of this.agents) {
      const current = agent.terminalRef?.name;
      if (!current) continue;
      const previous = this.lastSentTerminalNames.get(id);
      if (previous !== current) {
        this.lastSentTerminalNames.set(id, current);
        this.webview?.postMessage({
          type: 'agentTerminalNameChanged',
          id,
          terminalName: current,
        });
      }
    }
  }, TERMINAL_NAME_POLL_INTERVAL_MS);
}
```

- [ ] **Step 5: Clean up the poller in `dispose()`**

In the `dispose` method (around line 930), add before the loop over `this.agents.keys()`:

```typescript
if (this.terminalNamePollTimer) {
  clearInterval(this.terminalNamePollTimer);
  this.terminalNamePollTimer = null;
}
this.lastSentTerminalNames.clear();
```

- [ ] **Step 6: Seed snapshot on new agent creation**

After `launchNewTerminal` resolves in the `openClaude` handler (around line 355, inside the `for (const [id, agent] of this.agents)` loop that registers hook handlers), also seed the terminal name snapshot. Replace the existing loop body:

```typescript
for (const [id, agent] of this.agents) {
  if (!prevAgentIds.has(id)) {
    this.registerAgentHook(agent);
    if (agent.terminalRef?.name) {
      this.lastSentTerminalNames.set(id, agent.terminalRef.name);
    }
  }
}
```

- [ ] **Step 7: Type-check**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run check-types
```

Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src/PixelAgentsViewProvider.ts src/constants.ts
git commit -m "feat(extension): poll terminal renames and emit agentTerminalNameChanged"
```

---

## Task 6: Add `terminalName` to Character + OfficeState

**Files:**

- Modify: `webview-ui/src/office/types.ts` (Character interface)
- Modify: `webview-ui/src/office/engine/officeState.ts` (`addAgent` signature + new `setAgentTerminalName`)

- [ ] **Step 1: Extend the `Character` interface**

In `webview-ui/src/office/types.ts`, find the existing `folderName?: string;` declaration (around line 182) and add a sibling:

```typescript
/** Workspace folder name (only set for multi-root workspaces) */
folderName?: string;
/** VS Code terminal tab name (e.g. "Copyrighter Frontend") */
terminalName?: string;
```

- [ ] **Step 2: Extend `addAgent` to accept terminalName**

In `webview-ui/src/office/engine/officeState.ts`, change the `addAgent` signature (around line 263):

```typescript
addAgent(
  id: number,
  preferredPalette?: number,
  preferredHueShift?: number,
  preferredSeatId?: string,
  skipSpawnEffect?: boolean,
  folderName?: string,
  terminalName?: string,
): void {
```

Then, in the function body, right after the existing `if (folderName) { ch.folderName = folderName; }` block (around line 314), add:

```typescript
if (terminalName) {
  ch.terminalName = terminalName;
}
```

- [ ] **Step 3: Add a `setAgentTerminalName` method**

Still in `officeState.ts`, near other per-agent mutators (e.g. right after the method that sets team info around line 690, or before `addSubagent`), add:

```typescript
setAgentTerminalName(id: number, terminalName: string): void {
  const ch = this.characters.get(id);
  if (!ch) return;
  ch.terminalName = terminalName;
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/types.ts webview-ui/src/office/engine/officeState.ts
git commit -m "feat(webview): add terminalName field to Character + OfficeState"
```

---

## Task 7: Wire webview message handlers for terminalName

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`

- [ ] **Step 1: Add `terminalName` to the pending-agents buffer type**

Around line 112, find the `pendingAgents` declaration and add `terminalName` to its inline type:

```typescript
let pendingAgents: Array<{
  id: number;
  palette?: number;
  hueShift?: number;
  seatId?: string;
  folderName?: string;
  terminalName?: string;
}> = [];
```

- [ ] **Step 2: Pass `terminalName` when flushing buffered agents**

In the `layoutLoaded` branch, find the loop that applies `pendingAgents`:

```typescript
for (const p of pendingAgents) {
  os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
}
```

Replace with:

```typescript
for (const p of pendingAgents) {
  os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName, p.terminalName);
}
```

- [ ] **Step 3: Read `terminalName` from `agentCreated`**

In the `else if (msg.type === 'agentCreated')` branch, after `const folderName = msg.folderName as string | undefined;` (around line 154), add:

```typescript
const terminalName = msg.terminalName as string | undefined;
```

Then in the same branch, update the non-teammate `os.addAgent(...)` call (around line 179):

```typescript
os.addAgent(id, undefined, undefined, undefined, undefined, folderName, terminalName);
```

(The teammate branch does NOT need terminalName — teammates are tmux panes, not terminals.)

- [ ] **Step 4: Read `terminalNames` from `existingAgents`**

In the `else if (msg.type === 'existingAgents')` branch, find the `folderNames` destructure (around line 214) and add alongside it:

```typescript
const folderNames = (msg.folderNames || {}) as Record<number, string>;
const terminalNames = (msg.terminalNames || {}) as Record<number, string>;
```

Then update the push into `pendingAgents` to include terminalName:

```typescript
pendingAgents.push({
  id,
  palette: m?.palette,
  hueShift: m?.hueShift,
  seatId: m?.seatId,
  folderName: folderNames[id],
  terminalName: terminalNames[id],
});
```

- [ ] **Step 5: Handle `agentTerminalNameChanged`**

In the same `handler` function (near other `else if (msg.type === ...)` branches), add a new branch. A natural spot is right after the `agentClosed` branch:

```typescript
} else if (msg.type === 'agentTerminalNameChanged') {
  const id = msg.id as number;
  const terminalName = msg.terminalName as string;
  os.setAgentTerminalName(id, terminalName);
}
```

- [ ] **Step 6: Add `showTerminalNames` state + expose it**

Near the top of `useExtensionMessages`, next to `const [alwaysShowLabels, setAlwaysShowLabels] = useState(false);` (around line 103), add:

```typescript
const [showTerminalNames, setShowTerminalNames] = useState(false);
```

In the `settingsLoaded` handler (search for `if (msg.type === 'settingsLoaded')`), after `setAlwaysShowLabels(msg.alwaysShowLabels as boolean);` add:

```typescript
setShowTerminalNames(msg.showTerminalNames as boolean);
```

- [ ] **Step 7: Add `showTerminalNames` to the returned state shape**

Find `ExtensionMessageState` (around line 49) and add the field near `alwaysShowLabels`:

```typescript
alwaysShowLabels: boolean;
showTerminalNames: boolean;
```

At the end of `useExtensionMessages`, where the state object is returned, add `showTerminalNames` alongside `alwaysShowLabels`.

- [ ] **Step 8: Type-check**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "feat(webview): handle terminalName messages + expose showTerminalNames state"
```

---

## Task 8: Thread `showTerminalNames` through `App.tsx` and render it

**Files:**

- Modify: `webview-ui/src/App.tsx` (destructure, local state, prop plumbing)
- Modify: `webview-ui/src/office/components/ToolOverlay.tsx` (prop + render)

- [ ] **Step 1: Destructure + local state in App.tsx**

In `webview-ui/src/App.tsx`, inside `const { ... } = useExtensionMessages(...)` (around lines 54-74), add `showTerminalNames` next to `alwaysShowLabels`:

```typescript
alwaysShowLabels,
showTerminalNames,
```

Add a local state + handler next to `alwaysShowOverlay` (around line 85):

```typescript
const [showTerminalNamesLocal, setShowTerminalNamesLocal] = useState(false);

useEffect(() => {
  setShowTerminalNamesLocal(showTerminalNames);
}, [showTerminalNames]);

const handleToggleShowTerminalNames = useCallback(() => {
  setShowTerminalNamesLocal((prev) => {
    const newVal = !prev;
    vscode.postMessage({ type: 'setShowTerminalNames', enabled: newVal });
    return newVal;
  });
}, []);
```

- [ ] **Step 2: Pass `showTerminalNames` to `ToolOverlay`**

Update the `<ToolOverlay ... />` invocation (around line 241) to add `showTerminalNames={showTerminalNamesLocal}`:

```tsx
<ToolOverlay
  officeState={officeState}
  agents={agents}
  agentTools={agentTools}
  subagentCharacters={subagentCharacters}
  containerRef={containerRef}
  zoom={editor.zoom}
  panRef={editor.panRef}
  onCloseAgent={handleCloseAgent}
  alwaysShowOverlay={alwaysShowOverlay}
  showTerminalNames={showTerminalNamesLocal}
/>
```

- [ ] **Step 3: Pass `showTerminalNames` + handler to `SettingsModal`**

Update the `<SettingsModal ... />` invocation (around line 344) to add the two new props:

```tsx
<SettingsModal
  isOpen={isSettingsOpen}
  onClose={() => setIsSettingsOpen(false)}
  isDebugMode={isDebugMode}
  onToggleDebugMode={handleToggleDebugMode}
  alwaysShowOverlay={alwaysShowOverlay}
  onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
  showTerminalNames={showTerminalNamesLocal}
  onToggleShowTerminalNames={handleToggleShowTerminalNames}
  externalAssetDirectories={externalAssetDirectories}
  watchAllSessions={watchAllSessions}
  onToggleWatchAllSessions={() => {
    const newVal = !watchAllSessions;
    setWatchAllSessions(newVal);
    vscode.postMessage({ type: 'setWatchAllSessions', enabled: newVal });
  }}
  hooksEnabled={hooksEnabled}
  onToggleHooksEnabled={() => {
    const newVal = !hooksEnabled;
    setHooksEnabled(newVal);
    vscode.postMessage({ type: 'setHooksEnabled', enabled: newVal });
  }}
/>
```

- [ ] **Step 4: Add the prop to `ToolOverlay`**

Open `webview-ui/src/office/components/ToolOverlay.tsx`. In `ToolOverlayProps` (around line 26), add:

```typescript
interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
  showTerminalNames: boolean;
}
```

Accept it in the function signature:

```typescript
export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
  showTerminalNames,
}: ToolOverlayProps) {
```

- [ ] **Step 5: Render the terminal name line**

Still in `ToolOverlay.tsx`, update `hasExtraLines` to account for the new line (around line 160):

```typescript
const hasExtraLines = !!(ch.folderName || teamRoleLabel || (showTerminalNames && ch.terminalName));
```

Inside the overlay JSX, immediately AFTER the activity text `<span>` (around line 194-202) and BEFORE the folder-name block, add:

```tsx
{
  showTerminalNames && ch.terminalName && !isSub && (
    <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
      {ch.terminalName}
    </span>
  );
}
```

The `!isSub` guard prevents showing terminal names on sub-agent characters (they share the parent's terminal; rendering it under the sub-agent label would be redundant and misleading).

- [ ] **Step 6: Type-check**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/App.tsx webview-ui/src/office/components/ToolOverlay.tsx
git commit -m "feat(webview): render terminal name in ToolOverlay behind setting"
```

---

## Task 9: Add the Settings checkbox

**Files:**

- Modify: `webview-ui/src/components/SettingsModal.tsx`

- [ ] **Step 1: Add props to `SettingsModalProps`**

Open `webview-ui/src/components/SettingsModal.tsx`. Extend the interface (around line 10):

```typescript
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  showTerminalNames: boolean;
  onToggleShowTerminalNames: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
}
```

Accept the new props in the function destructure:

```typescript
export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  showTerminalNames,
  onToggleShowTerminalNames,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksEnabled,
  onToggleHooksEnabled,
}: SettingsModalProps) {
```

- [ ] **Step 2: Add the checkbox**

Immediately after the existing `<Checkbox label="Always Show Labels" ... />` block (around line 111), add:

```tsx
<Checkbox
  label="Show Terminal Names"
  checked={showTerminalNames}
  onChange={onToggleShowTerminalNames}
/>
```

- [ ] **Step 3: Type-check + lint**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run check-types
cd /Users/angel/Desktop/pixel-agents && npm run lint
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/components/SettingsModal.tsx
git commit -m "feat(settings): add Show Terminal Names checkbox"
```

---

## Task 10: Full build + manual smoke (F5 dev host)

**Files:** none modified.

- [ ] **Step 1: Full build**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run build
```

Expected: build completes with no TypeScript or lint errors. Produces `dist/` directory.

- [ ] **Step 2: Launch Extension Development Host**

In VS Code with `pixel-agents/` open, press **F5** (or Cmd+Shift+P → "Debug: Start Debugging"). A new VS Code window titled "[Extension Development Host]" opens.

- [ ] **Step 3: Smoke-test the feature**

In the dev host window:

1. Open the Pixel Agents panel (View → Appearance → Panel, or the command `Pixel Agents: Show Panel`).
2. Click **+ Agent** twice to spawn two agents.
3. Rename one of the two terminal tabs in VS Code (right-click terminal tab → Rename) to something distinct like "TestAgent-1".
4. Click the Settings gear in Pixel Agents → toggle **Show Terminal Names** ON.
5. Hover each character → confirm the terminal name appears as a small line under the activity text. Expected: "TestAgent-1" on the renamed one; "Claude Code #1" or similar on the other.
6. Select one character (click) → confirm the terminal name stays visible as long as the character is selected.
7. Rename the terminal again while the overlay is visible → within ~2s, the label updates.
8. Toggle **Show Terminal Names** OFF → the line disappears; the rest of the overlay (activity, folder name, team info) is unchanged.
9. Reload the dev host window (Cmd+R in the dev host). Reopen Pixel Agents and confirm the setting persists (still ON if it was ON before reload).

- [ ] **Step 4: Commit if any fixes needed**

If the smoke test surfaces issues, fix them, re-run `npm run build`, repeat Step 3. Commit each fix separately with a descriptive message (e.g. `fix(webview): ...`).

---

## Task 11: Install into the user's real VS Code window

Only run this task after Task 10's smoke passes in the dev host.

- [ ] **Step 1: Package the `.vsix`**

```bash
cd /Users/angel/Desktop/pixel-agents && npm run package
```

The `package` npm script compiles extension + webview in production mode but does NOT produce a `.vsix` by itself. To produce one, run:

```bash
cd /Users/angel/Desktop/pixel-agents && npx @vscode/vsce package --no-dependencies
```

Expected: produces `pixel-agents-1.3.0.vsix` in the repo root.

If `@vscode/vsce` is not installed, install it globally once: `npm install -g @vscode/vsce`.

- [ ] **Step 2: Install into the main VS Code window**

```bash
code --uninstall-extension pablodelucca.pixel-agents
code --install-extension /Users/angel/Desktop/pixel-agents/pixel-agents-1.3.0.vsix
```

- [ ] **Step 3: Reload extensions (not the window)**

In the user's main VS Code window: Cmd+Shift+P → "Developer: Reload Extensions".

Do NOT reload the window — that would restart terminals and kill running `claude` sessions.

- [ ] **Step 4: Verify on the real agents**

Open the Pixel Agents panel. All existing agents should re-register and appear in their seats. Toggle "Show Terminal Names" ON and hover each character to confirm the terminal tab names ("Copyrighter Frontend", "misc", "Budget", etc.) appear correctly.

---

## Self-Review Checklist (completed before handoff)

1. **Spec coverage:**
   - ✅ Setting persisted in `globalState` with sensible default (Task 1, 2).
   - ✅ `terminalName` included in `agentCreated` (Task 3).
   - ✅ `terminalNames` map in `existingAgents` (Task 4).
   - ✅ 2s poll for rename detection (Task 5).
   - ✅ `Character.terminalName` field (Task 6).
   - ✅ Message handlers in webview (Task 7).
   - ✅ Prop wiring App → Overlay (Task 8).
   - ✅ Render guarded by `showTerminalNames && !isSub` (Task 8).
   - ✅ Settings UI (Task 9).
   - ✅ Verification path (Tasks 10–11).

2. **Placeholder scan:** No TBDs, TODOs, or "add appropriate X" phrases. Every step shows the code or exact command.

3. **Type consistency:**
   - `showTerminalNames` used consistently across extension, `settingsLoaded`, `useExtensionMessages`, App, SettingsModal, ToolOverlay.
   - `terminalName` (camelCase singular) on messages and on `Character`.
   - `terminalNames` (plural) only for the map in `existingAgents`.
   - Message types: `setShowTerminalNames`, `agentTerminalNameChanged`, `settingsLoaded.showTerminalNames` — no drift.

4. **Scope:** One feature, one implementation plan, no unrelated refactors.
