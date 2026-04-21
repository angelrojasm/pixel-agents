# Remote-Office Vision — Phased Spec

**Date:** 2026-04-21
**Status:** Living document. Phase 1 shipped; Phases 2–3 are directional.

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

## Phase 2 — Terminal inside the office (on hold)

**Intent**
Click a character → that agent's terminal appears anchored in the office, rendered as `xterm.js` inside the webview. VS Code's native terminal strip goes away for pixel-agent sessions.

**Architectural path (the "A" path picked during scoping)**

- Spawn Claude via [`node-pty`](https://github.com/microsoft/node-pty) from the extension host instead of `vscode.window.createTerminal`. `node-pty` exposes raw stdin/stdout on a pseudo-terminal.
- Render [xterm.js](https://xtermjs.org) inside the webview. Pipe pty data + keystrokes over the existing `postMessage` channel (keystrokes go webview→extension; output chunks go extension→webview).
- Each agent's terminal is an overlay anchored to that character (or tabbed/stacked in a bottom pane of the office canvas — UX TBD).

**Alternative considered and rejected**
Tab-grouping hack that toggles native VS Code terminal visibility per agent click. Cheaper to build, but leaves the terminal in VS Code's terminal strip, so it does not deliver the "inside the office" experience.

**Open UX questions**

- Where does the terminal anchor visually? Above the character? A slide-up drawer? A stacked row of mini-terminals?
- How do multiple simultaneous terminals compose?
- Focus management (clicks on the office canvas vs. the terminal).
- Copy/paste integration with xterm.js.

**Known risks**

- `node-pty` is excellent on macOS/Linux. Windows uses ConPTY and has rougher edges; mitigate by shipping a Docker image (user accepted this).
- Loss of VS Code terminal affordances (the user's current shell integration, right-click menu, etc.). Acceptable trade-off for the UX payoff.

**Fallback / rollback**
Keep `vscode.window.createTerminal` spawning behind a per-agent opt-out (feature flag or setting) during the Phase 2 rollout. If `node-pty` + xterm.js misbehaves on a given agent or platform, the user can route that session through the native terminal path until the issue is fixed. Once Phase 2 is stable, the flag can be removed in a subsequent release.

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
