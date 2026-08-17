# M1 QA — Standalone terminals + New-agent form (2026-08-17)

Branch: `m1-standalone-terminals` (upstream v1.4.1 base). Spec:
`docs/superpowers/specs/2026-08-17-m1-standalone-terminals-design.md`; plan:
`docs/superpowers/plans/2026-08-17-m1-standalone-terminals.md`.

## What was verified

### Live sessions (Playwright-driven against `dist/cli.js`, isolated HOME)

- **Spawn + terminal**: `launchAgent` over a tokened `/ws` → character spawns
  in the office, bottom terminal band appears with the agent's rail entry, a
  real `claude --session-id <uuid>` runs in the pty. Claude Code v2.1.233's
  onboarding (theme picker) rendered crisply in the xterm pane — real
  monospace (`Menlo`), not the pixel UI font.
- **Bidirectional I/O**: a keystroke sent into the xterm advanced Claude's
  onboarding from the theme picker to the login screen (ptyInput → pty →
  ptyData round-trip).
- **New-agent form**: `+ Agent` opens the modal; name + explicit folder spawn
  a named agent in that folder; Enter submits from a text field; the folder
  appears as a recents quick-pick on reopen.

### Automated (all green at the tip of the branch)

- `npm run compile` — 0 errors (asyncapi codegen, tsc, eslint, esbuild, vite).
- Server vitest: **596 tests / 34 files** (new: ptyManager ×9, ringBuffer,
  agentRuntime.pty ×5, launchAgentStandalone ×7, clientMessageHandler.pty ×13,
  httpServerWs pty-delivery ×3, store/config field tests).
- Webview vitest: **96 tests / 12 files** (new: pty-messages ×7,
  new-agent-spawn ×3).
- New e2e (`e2e/tests/standalone/`): **5 specs**
  - terminal: form spawn → character + band + mock-claude invocation log;
    typed keystrokes echo back as `ptyData`; scripted pty exit shows the
    Restart control and restarting logs a second mock invocation.
  - new-agent-form: named spawn → rail label, folder recorded at
    `standalone.recentAgentFolders` in `~/.pixel-agents/config.json`, listed
    on reopen; an **unprivileged** page (no `?token=`) sees the office and the
    character but receives zero `ptyData`/`ptyScrollback` frames.
- VS Code untouched gate: full `e2e/tests/claude/hooks-off/` slice —
  **38 tests pass** (App/BottomToolbar restructure did not disturb the
  extension surface; VS Code's + Agent hover flow is byte-identical).
- `npm run knip`, `npm run test:package-contract`, `npm run format:check`,
  `npm run asyncapi:validate`, messages.ts + e2e/README.md drift checks — all
  clean.

## Known M1 limits (deliberate, per spec)

- Terminal band is bottom-position only; no per-pane font-size stepper yet.
- Exit marker / Restart button state comes from live events; a pane mounted
  AFTER its pty exited shows the replayed `[pty exited…]` scrollback text but
  not the button (restart is still reachable by respawning).
- Unnamed agents show `Agent #<id>` in the rail — terminalName is not carried
  to the webview in M1.
- `/rename` → `agentRenamed` is wired end-to-end on the protocol but no
  provider emits it yet.
