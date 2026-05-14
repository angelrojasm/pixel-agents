# Pixel Agents — Roadmap

**Status:** Living document — canonical place for phase status, sequencing, and queued ideas. Update this file (not CLAUDE.md) whenever phase state changes.
**Origin:** Formerly `docs/superpowers/specs/2026-04-21-remote-office-vision.md`. Renamed and promoted to repo root on 2026-05-13 to be the single source of truth for the roadmap.

## The Vision

Today the extension is a pixel-art office panel _alongside_ VS Code's native terminal. The user's intent is to converge the two into a single **full-screen pixel office** where clicking an agent opens that agent's terminal _inside the office_. Eventually, the same experience runs as a **web app**, letting users reach their Claude Code agents remotely without VS Code at all.

### Why

The maintainer runs two VS Code windows today — one for work, one for personal — each with its own Pixel Agents panel. Screen real estate is split between the office view and the terminal strip, and remote access isn't possible. The phased plan addresses both: a single unified office (less clutter), and a trajectory toward using the same office from anywhere on the web.

Rather than a hard rewrite, this is executed in three phases. Each phase ships on its own and keeps the product usable.

## Phase 1 — Full-screen office (shipped)

**What changed**

- New `WebviewPanel` (editor-area tab) exposed via `pixel-agents.openFullScreen` and an icon button in the side-panel title bar.
- The side-panel `WebviewView` and the full-screen `WebviewPanel` can be open simultaneously; both are in a `Set<vscode.Webview>` on the provider.
- A `MessageSink` abstraction (`src/types.ts`) replaces direct `vscode.Webview` references in every downstream extension module. The provider implements a `broadcastSink` that posts to every live webview.
- User-configurable **default terminal folder** lives in the in-app Settings modal (not VS Code settings), because that settings surface must survive the move out of VS Code.
- Window-level listeners (`onDidChangeActiveTerminal`, `onDidCloseTerminal`) moved from inside `resolveWebviewView` to a dedicated constructor call, so they fire even if only the full-screen tab is ever opened.

**What did not change**

- The multi-webview plumbing itself required no webview HTML/JS changes — the webview talks `vscode.postMessage` the same way whether hosted in a `WebviewView` or a `WebviewPanel`. (The batched-in default-folder setting did touch webview code, but that's an orthogonal feature that shipped in the same batch.)
- The hook server, JSONL parsing, and agent lifecycle are unaffected. Hook events continue to arrive on the shared `PixelAgentsServer`.

**Why it matters for Phase 3**
Every extension **outbound** message now flows through `MessageSink`. A WebSocket-backed `MessageSink` can replace the broadcast sink without touching any of the downstream modules (`agentManager`, `fileWatcher`, etc.).
**Gap for Phase 3**: the **inbound** path — `Webview.onDidReceiveMessage` inside `PixelAgentsViewProvider.resolveWebviewView` / `openFullScreenPanel` — is still VS Code-shaped. Replacing the transport means introducing an equivalent abstraction on that side (e.g. a `MessageSource` interface with `onMessage(handler)`) and routing both `WebviewView` events and future WebSocket events through it.

## Phase 2 — Terminal inside the office (in progress)

**Intent**
Click a character → that agent's terminal appears anchored in the office, rendered as `xterm.js` inside the webview. VS Code's native terminal strip goes away for pixel-agent sessions.

**Architectural path (the "A" path picked during scoping)**

- Spawn Claude via [`node-pty`](https://github.com/microsoft/node-pty) from the extension host instead of `vscode.window.createTerminal`. `node-pty` exposes raw stdin/stdout on a pseudo-terminal.
- Render [xterm.js](https://xtermjs.org) inside the webview. Pipe pty data + keystrokes over the existing `postMessage` channel (keystrokes go webview→extension; output chunks go extension→webview).
- Terminal anchors in the office panel (bottom / left / right, user-positioned). The user resizes the panel band with a drag handle (`Splitter.tsx`).

**Alternative considered and rejected**
Tab-grouping hack that toggles native VS Code terminal visibility per agent click. Cheaper to build, but leaves the terminal in VS Code's terminal strip, so it does not deliver the "inside the office" experience.

**Status (2026-05-13)**

Foundations (vsix 1.3.0):

- **D1 — `MessageSource`**: inbound message abstraction landed; mirrors `MessageSink` for Phase-3 WS readiness.
- **D2 — `node-pty` backend**: `PtyManager` + `PtyWorker` + scrollback ring buffer + pty protocol (`ptyData` / `ptyExit` / `ptyScrollback` outbound; `ptyInput` / `ptyResize` / `terminalPaneReady` inbound).
- **xterm.js pane**: `TerminalPane.tsx` consumes the protocol; `FitAddon` drives reflow on every container resize. Gated by the `usePtyTerminal` user setting (default off).

Polish bundle (2026-05-12, branch `2026-05-12-terminal-polish`):

- Agent **auto-rename** from Claude's `/rename` slash command — parses the `custom-title` JSONL record, persists `customTitle` on `AgentState` / `PersistedAgent`, replays on restore, renders in panel tab + character nameplate via `characterLabel()`.
- **Resizable panel band** — `Splitter.tsx` with sign-flipped drag math per panel position; `userBandSizePx` clamped in `computePanelBand`.
- **0.5 zoom increments** — `ZOOM_STEPS` array drives both `+/-` buttons and Ctrl+scroll.
- **Terminal font customization** — family / size / line-height surfaced in Settings; system-installed mono fonts (Menlo, SF Mono, Monaco, Cascadia Mono, Consolas, Courier New, generic monospace). No fonts bundled.

Visual chrome bundle (2026-05-13, same branch):

- **Pixel border on the terminal pane** — 2px `PANEL_BORDER` on left/right/bottom of the xterm wrapper; inner padding tightened 4→2 to match the project's pixel-art density.
- **Focused-agent identity strip in the header** — fills the full header thickness (`height: 100%` + `margin: '-4px 0'` in horizontal mode to absorb the outer padding), `PANEL_BG_CELL` background, accent text, 2px `PANEL_ACCENT` underline in bottom mode flush with the header/terminal boundary.
- **Tab-style focus state on rail cells** — `AgentCell` gains required `panelPosition` + `focusDropEdge` helper; focused cell drops the border on the edge facing the canvas (top for bottom rail, right/left for side rail).
- **Hover affordances** — `.panel-cell-hover` (80ms bg fade) on every agent cell, `.panel-icon-hover` (80ms color fade) on the panel + rail `[hide]` buttons.
- **Pixel-art scrollbar** — `.pixel-scrollbar` utility (paired with a global `.xterm-viewport` selector) gives the rail overflow, the tab-strip overflow, and the xterm scrollback viewport a unified 8px sharp-cornered thumb.
- **Splitter grip indicator** — 12×2 px centered bar fades in on hover (120ms) so the drag handle is discoverable without claiming permanent visual weight.

Resolved UX questions:

- Terminal anchors in the panel band (a drawer, user-resizable, user-positioned bottom/left/right). Not a per-character overlay.
- Multiple agents: the panel shows ONE focused terminal at a time; the rail/header lets the user pick which.
- Copy/paste: deferred — relies on xterm.js defaults for now.

Terminal QoL bundle (2026-05-13, same branch):

- **WebLinksAddon** wired to an `openExternal` outbound message → `vscode.env.openExternal()` in the provider; Phase-3-safe via `isBrowserRuntime` fallback in `webLinkHandler.ts`.
- **SearchAddon** + `useTerminalSearch` hook (pure reducer, unit-tested) + `TerminalSearchBar` overlay using the visual-chrome tokens. Cmd/Ctrl+F opens, Enter / Shift+Enter navigate, Esc closes. Custom-key handler in `TerminalPane` intercepts only Cmd/Ctrl+F and Esc-when-open so xterm passthrough is preserved.
- `onDidChangeResults` lives on `TerminalPane` (not inside the hook) to avoid double-subscription churn; `resultIndex === -1` is mapped to `currentMatch=0`.

Terminal ↔ character interaction bundle (2026-05-13, same branch):

- **Focus halo** around the focused agent's work-seat tile (dotted for idle-focused, solid for active-focused, muted-solid for active-not-focused, amber for awaiting-user). Selector lives in pure `characterHalo.ts` with full unit-test matrix.
- **PTY→animation bridge**: `PtyEventBus.subscribeActivity` channel + `ptyActivityReducer` + `useCharacterPtyActivity` hook bump `Character.ptyActivityUntil`; `getCharacterSprite` reads it (gated by `isActive`) so byte-level activity drives typing-vs-reading frames.
- **Crashed-agent glyph + acknowledgement**: pty exits with non-zero code or signal → `agentCrashed` broadcast → red `!` on the character + desaturated sprite (cached via `:crashed` key); click character to ack. Restart button surfaces in `TerminalPane` when exit observed; `PtyManager.intentionallyStopped` set suppresses spurious crash broadcasts on user-initiated restart.
- **Sub-agent parent line**: dashed muted line from sub-agent character back to parent's seat tile, visible only when parent is focused.
- **Hook health surfacing**: `server/src/healthMonitor.ts` ok → degraded → down state machine with boot-grace; `hookHealthChanged` broadcast; `HookHealthToast` (sticky, bottom-center) + dot on `PanelHeader` hide button. New webview gets a current-health snapshot on `webviewReady`.
- **Canvas keyboard shortcuts**: `Cmd/Ctrl+1..9` focuses the Nth rail agent; `Cmd/Ctrl+'` collapses the panel (matches `[hide]` button). Shortcuts respect xterm focus and form-field focus.

Still open:

- (none — all Phase 2 §1-4 bundles shipped.)

**Recommended sequence (decided 2026-05-13)**

1. ~~**Visual chrome**~~ — **shipped 2026-05-13** (8 commits on `2026-05-12-terminal-polish`). Established pixel-art tokens (borders, accent strip, focus state, scrollbar) for the next two bundles.
2. ~~**Terminal QoL**~~ — **shipped 2026-05-13** (9 commits on `2026-05-12-terminal-polish`). Search bar, web links, focus return on close. Manual copy/paste QA folded into the Phase 2 final QA pass.
3. ~~**Terminal ↔ character interaction**~~ — **shipped 2026-05-13** (14 commits + 1 review-fix commit on `2026-05-12-terminal-polish`). Focus halo, pty→animation, crashed glyph + ack, restart, sub-agent line, hook-health toast + dot, canvas shortcuts. 261 tests passing.
4. ~~**Settings menu redesign**~~ — **shipped 2026-05-13** (Parts A–F on `2026-05-12-terminal-polish`). Sectioned V2 modal (General / Agents / Terminal / Office / About) with Stepper, Select, RadioGroup, PathInput, ListEditor controls; restoreCategoryDefaults + 5s undo toast; sidebar keyboard navigation + focus trap; V1 modal deleted. 267 tests passing.

Rationale: doing chrome before character-interaction prevents rework on bubbles/indicators that would otherwise be designed against un-styled chrome. Doing settings last lets it absorb a known set of new settings in one migration instead of evolving the modal continuously.

**Known risks**

- `node-pty` is excellent on macOS/Linux. Windows uses ConPTY and has rougher edges; mitigate by shipping a Docker image (user accepted this).
- Loss of VS Code terminal affordances (the user's current shell integration, right-click menu, etc.). Acceptable trade-off for the UX payoff.

**Fallback / rollback**
The `vscode.window.createTerminal` path remains the default and runs in parallel for every agent. If `node-pty` + xterm.js misbehaves on a given agent or platform, the user toggles `usePtyTerminal` off and new agents route through the native terminal path. Once Phase 2 is stable, the flag can be flipped to default-on or removed entirely in a subsequent release.

## Phase 3 — Standalone remote app

**Intent**
Use Pixel Agents from a browser, away from VS Code, without always-on laptop requirement if feasible.

**Recommended initial pattern (for launch)**
**Daemon + relay.** A small service on the user's machine — the existing `PixelAgentsServer` from Phase 1, extended with Phase 2's `node-pty` workers — runs Claude locally. A coordinator in the cloud relays a WebSocket between the browser SPA and the daemon. Claude keeps reading `~/.claude/` for auth, so the user's company subscription flows through unchanged. Requires the laptop to be on (or a persistent machine the user owns).

**Aspirational pattern (post-launch, if feasible)**
**Hosted shell.** Spawn Claude in a per-user cloud container. Auth would have to be injected (OAuth, mounted `.claude/`, or similar). Depends on Anthropic TOS and on Claude Code supporting non-interactive auth for multi-tenant hosting.

**Architectural prerequisites already in place**

- `MessageSink` — broadcasts abstract over transport.
- `PixelAgentsServer` — HTTP endpoint with auth tokens, process PID discovery via `~/.pixel-agents/server.json`. Already designed to be the foundation (per existing `TODO(Standalone version)` comments).
- Layout, config, and default-cwd already live in user-level paths, not VS Code workspaceState (or are migrated out when it matters).

**Auth boundary for Phase 3 v1**

- Not in scope: a multi-tenant account system.
- In scope: single-user **browser ↔ daemon pairing** (e.g. a pairing code or signed token the daemon prints once, the browser caches) so the relay can't mix up sessions across users. This is the minimum auth that daemon/relay needs to be safe, not a full account system.

**Non-goals for Phase 3 v1**

- Multi-tenant accounts, billing, teams.
- Cloud-side layout sync.
- Mobile UI.

## Queued feature ideas

These are tracked in `CLAUDE.md` under "Queued feature ideas" and are orthogonal to the phase work:

- **Preselected agents / bookmarks**: named launch profiles `{ name, cwd, resumeSessionId? }`. Click → terminal in `cwd` running `claude --resume <id>` or `--session-id <uuid>`.
- **Multi-office layout**: one "big house" room pattern, or a named-office toggle (work vs. personal). Shapes the layout schema; defer until Phase 2 is concrete.
- **Terminal-auto-close investigation**: VS Code terminal sometimes closes after idle. Not caused by the extension; cause unknown (Claude CLI idle, VS Code shell-exit). Revisit if it reproduces with logs.

## Principles to keep compatibility

As future work lands, these rules keep the trajectory intact:

1. **Never route webview messages via `vscode.Webview` directly in extension modules.** Use `MessageSink`.
2. **Don't add settings to VS Code's `contributes.configuration`.** User-facing settings live in the in-app Settings modal (and their persistence layer — currently `globalState`, eventually the daemon's config file).
3. **Keep `PixelAgentsServer` independent of `vscode`.** It already is. Changes that reach into the server module must not import `vscode`.
4. **Keep the webview transport-agnostic.** It talks `postMessage`. Don't smuggle in VS Code-specific webview APIs unless absolutely necessary.
5. **Symmetric message abstractions.** `MessageSink` covers the outbound path. When Phase 2/3 work begins, introduce a matching **inbound** abstraction (e.g. `MessageSource`) before wiring WebSocket transport — don't let the provider's `Webview.onDidReceiveMessage` calls grow into more places than they already exist.
