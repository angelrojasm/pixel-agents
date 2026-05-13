# Terminal QoL — Design

**Date:** 2026-05-13
**Status:** Approved design.
**Parents:**

- [Roadmap](../../ROADMAP.md) — Phase 2 §2, second item in the "Recommended sequence (decided 2026-05-13)".
- [Visual Chrome](./2026-05-13-visual-chrome-design.md) — establishes the chrome tokens this bundle's search bar consumes (`PANEL_BG_CELL`, `PANEL_BORDER`, `PANEL_ACCENT`, FS Pixel Sans, sharp corners, hover utilities).
- [Phase 2 Backend PTY](../plans/2026-05-11-phase-2-backend-pty.md) and [xterm Terminal Pane](../plans/2026-05-11-xterm-terminal-pane.md) — the foundations this bundle layers QoL onto.

## Purpose

The in-panel xterm terminal is functionally usable but feels primitive next to VS Code's native terminal. Links printed by Claude are plain text. There is no scrollback search. Copy/paste leans on xterm.js defaults that have not been explicitly verified in the webview's CSP context. Keybindings are undefined — there is no documented precedence list for what overrides xterm versus what passes through.

This bundle closes those gaps. It uses the chrome tokens established by the visual-chrome bundle for any new UI (the search bar) and avoids adding new architectural concepts — xterm.js addons are the right mechanism, the extension's existing `MessageSink` is the right transport, and React component state is the right place for transient UI state.

## Decisions

D1. **Add two xterm.js addons:** `@xterm/addon-search` and `@xterm/addon-web-links`. Pin to the major versions compatible with `@xterm/xterm@^6.0.0` (confirmed during dependency-add step in the implementation plan). Both load eagerly inside `TerminalPane`'s `useEffect` per the existing addon pattern (`FitAddon` already does this).

D2. **Clickable links via `WebLinksAddon`.** The addon detects URL substrings at render time and overlays them with hover decoration + click handlers. The click callback posts an `openExternal` message to the extension. No URL regex lives in our code — xterm's default detector is sufficient.

D3. **`openExternal` is a new outbound message in the existing protocol.** Discriminated union case `{ type: 'openExternal'; uri: string }`. Handled in `src/PixelAgentsViewProvider.ts`'s existing message switch — calls `vscode.env.openExternal(vscode.Uri.parse(uri))`. Phase-3-compat: in a browser-only build a feature flag in `webLinkHandler` falls back to `window.open(uri, '_blank')`; that flag is introduced as a no-op constant now and wired later when Phase 3 starts.

D4. **Scrollback search via `SearchAddon` + a new `TerminalSearchBar.tsx` component.** Cmd+F (macOS) and Ctrl+F (Linux/Windows) open the bar. Esc closes it and returns focus to xterm. Enter = next match. Shift+Enter = previous match. Live match count `N of M`. Plain-text only — no regex, no case-sensitivity toggle, no whole-word toggle (YAGNI; can be promoted later if requested).

D5. **Search bar is an absolutely-positioned overlay inside `TerminalPane`'s outer wrapper.** Top-right of the wrapper, z-index 5, no layout shift on show/hide so the pty isn't resized. Width: 240px. Margin: 4px from the wrapper's top + right edges so it sits inside the 2px chrome frame established by the visual-chrome bundle.

D6. **Search state lives in a `useTerminalSearch` hook.** The hook owns: `open: boolean`, `query: string`, `currentMatch: number`, `totalMatches: number`. Exposes: `open()`, `close()`, `setQuery(q)`, `next()`, `previous()`. Subscribes to `searchAddon.onDidChangeResults` to keep match counters in sync. `TerminalSearchBar` is a dumb component driven by the hook's state.

D7. **Copy/paste relies on xterm.js v6 defaults.** No code change expected. Manual QA gates verify: Cmd/Ctrl+C copies when selection present and sends ^C otherwise; Cmd/Ctrl+V pastes via the system clipboard. If the webview's CSP prevents `navigator.clipboard.writeText` and xterm's copy path silently fails, the implementer adds `@xterm/addon-clipboard` as a follow-up (the bundle stays open until QA confirms). The plan calls this out as a real risk, not a guaranteed-fine assumption.

D8. **Keybinding precedence (canonical list).**

| Keys           | When                                | Action                                                 | Passes to xterm?        |
| -------------- | ----------------------------------- | ------------------------------------------------------ | ----------------------- |
| Cmd+F / Ctrl+F | terminal focused                    | Open search bar                                        | No                      |
| Esc            | search bar open                     | Close search bar + refocus xterm                       | No                      |
| Esc            | search bar closed                   | Pass through (shell uses Esc for prefixes / Vim modes) | Yes                     |
| Enter          | search input focused                | Next match                                             | n/a (focus is on input) |
| Shift+Enter    | search input focused                | Previous match                                         | n/a                     |
| Cmd/Ctrl+C     | terminal focused, selection present | Copy selection (xterm default)                         | Yes                     |
| Cmd/Ctrl+C     | terminal focused, no selection      | Send ^C (xterm default)                                | Yes                     |
| Cmd/Ctrl+V     | terminal focused                    | Paste (xterm default)                                  | Yes                     |
| Tab            | terminal focused                    | Pass to xterm (Claude TAB completion)                  | Yes                     |
| Anything else  | terminal focused                    | Pass to xterm                                          | Yes                     |

Implementation: `term.attachCustomKeyEventHandler((event) => boolean)` returns `false` for Cmd/Ctrl+F and for Esc-when-search-open. Everything else returns `true`.

D9. **Focus behavior is explicit.** Click on the xterm container → xterm focuses (xterm default). Click on the search input → React focuses the input. Click outside both → xterm blurs (browser default). Closing the search bar via Esc or the close button → `term.focus()` is called explicitly to return focus.

D10. **No new persistence.** Search query and open/closed state are component-local. Reopening the bar starts empty (matches VS Code's terminal-find behavior).

## Component Tree

```
OfficePanel.tsx (unchanged)
└── TerminalPane.tsx  ← extended
    ├── (absolute) TerminalSearchBar.tsx  ← new
    └── (xterm container, unchanged structure)
```

New files:

- `webview-ui/src/office/panel/TerminalSearchBar.tsx` — presentational. Input field + 4 buttons (prev / next / close / match-count display). Receives `query`, `currentMatch`, `totalMatches`, `onQueryChange`, `onNext`, `onPrevious`, `onClose` props. ~80 lines.
- `webview-ui/src/office/panel/useTerminalSearch.ts` — custom hook. Owns search state, wraps `SearchAddon` calls, subscribes to `onDidChangeResults`. Returns the search state + actions object. ~60 lines.
- `webview-ui/src/office/panel/webLinkHandler.ts` — pure function. `handleWebLinkClick(_event, uri)` posts `{ type: 'openExternal', uri }` via the existing `vscode` shim. ~15 lines.

Modified files:

- `webview-ui/src/office/panel/TerminalPane.tsx` — load `SearchAddon` and `WebLinksAddon` in the existing setup `useEffect`, install `attachCustomKeyEventHandler`, render `TerminalSearchBar` as overlay, wire `useTerminalSearch`. Net ~30 lines.
- `webview-ui/package.json` — two new dependencies, pinned versions.
- `src/PixelAgentsViewProvider.ts` — one new `case 'openExternal':` arm in the message dispatch (calls `vscode.env.openExternal`).

No file renames. No file deletes.

## Message Protocol Additions

**Outbound (webview → extension):**

```ts
{
  type: 'openExternal';
  uri: string;
}
```

Extension handler:

```ts
case 'openExternal':
  vscode.env.openExternal(vscode.Uri.parse(message.uri));
  break;
```

`vscode.Uri.parse` throws on truly malformed input (rare with xterm's detector); the catch is the existing `try/catch` already wrapping the message dispatch. No new validation needed.

**No inbound messages.** Search and links are entirely webview-local.

## Search Bar UI

Layout (left → right inside the 240px bar):

```
[ input field ........................ ]  [3/12]  [↑]  [↓]  [×]
```

Styling tokens (from visual-chrome bundle):

- Outer frame: `background: PANEL_BG_CELL`, `border: 1px solid PANEL_BORDER`, sharp corners, FS Pixel Sans.
- Input: transparent background, no border, `color: PANEL_ACCENT` text, 10px font.
- Buttons: 16×16 px, no border, transparent bg, `color: PANEL_MUTED`, `panel-icon-hover` class (existing from visual-chrome bundle) for the 80ms color fade on hover.
- Match count: 10px text, `color: PANEL_MUTED` when matches exist, `color: var(--color-status-error)` when query has no matches.
- `aria-label` on input ("Search terminal"), `title` on buttons ("Previous match", "Next match", "Close search").

## Behavior

**Open flow.** User presses Cmd/Ctrl+F while xterm is focused. `attachCustomKeyEventHandler` returns `false` (block xterm) and dispatches the hook's `open()` action. React renders `TerminalSearchBar`. `useEffect` in the search bar auto-focuses the input on mount.

**Type-to-search.** Every keystroke in the input updates `query` and calls `searchAddon.findNext(query, { incremental: true })`. xterm highlights all matches. `onDidChangeResults` fires with `{ resultIndex, resultCount }` → hook stores them → match-count display updates.

**Navigate matches.** Enter / next-button → `searchAddon.findNext(query)`. Shift+Enter / previous-button → `searchAddon.findPrevious(query)`. Both update `currentMatch` via the addon's event.

**Close flow.** Esc (in input) or close-button click → hook's `close()` → React unrenders the bar → `term.focus()` returns focus to xterm. Search highlights clear via `searchAddon.clearDecorations()` on close.

**Link click flow.** User hovers a URL in xterm output → `WebLinksAddon` shows hover decoration. User clicks → `handleWebLinkClick(_event, uri)` runs → posts `openExternal` message → extension opens the URL in the user's default browser.

**Copy flow (xterm default, verified).** User drags to select → xterm shows selection. User presses Cmd/Ctrl+C → if selection exists, xterm calls the browser's clipboard write API. If no selection, xterm sends `\x03` (^C) through `onData` → `ptyInput` → pty's stdin → Claude receives SIGINT.

**Paste flow (xterm default, verified).** User presses Cmd/Ctrl+V → browser fires a `paste` event on the xterm container → xterm reads `event.clipboardData.getData('text')` → emits via `onData` → `ptyInput` → pty stdin.

## State & Persistence

None. The bundle is entirely component-local + addon-driven. No `vscode.setState`, no new persisted fields, no new globalState keys.

## Testing

**Unit tests** (`webview-ui/test/`):

- `useTerminalSearch.test.ts` — open/close transitions, query updates, match navigation. Mocks the SearchAddon interface (small surface: `findNext`, `findPrevious`, `clearDecorations`, `onDidChangeResults`).
- `webLinkHandler.test.ts` — single case: callback posts `{ type: 'openExternal', uri: '<url>' }` via the `vscode` shim's `postMessage`.

**No xterm integration tests.** JSDOM doesn't render xterm; adding a real-DOM test infra for one bundle is overkill. The existing pattern is "unit-test pure modules, manual-QA the rest" — we keep that.

**Manual QA in the Extension Dev Host** is the load-bearing check for: clickable links, search bar appearance + behavior, Cmd/Ctrl+C/V working, focus transitions between input and xterm, Esc precedence, keybinding intercepts.

## Out of Scope

- ANSI color palette tuning (separate bundle if surfaced).
- Cursor style / bell / scrollback-size knobs (xterm defaults are fine).
- Image, sixel, ligatures, unicode11 addons (not needed for Claude output).
- Right-click context menu (xterm + browser defaults).
- Search history persistence (no clear win for the storage cost).
- RegExp / case-sensitivity / whole-word search modes (YAGNI v1).
- Tab-completion inside the search input.
- `TerminalPaneStub` changes (stub will be removed when `usePtyTerminal` defaults to on).
- Settings modal additions (no new user-facing settings — all behavior is keyboard-driven).
- Multi-terminal search (each agent's terminal has its own search state; not a separate concern).

## Implementation Order

1. Add `@xterm/addon-search` + `@xterm/addon-web-links` to `webview-ui/package.json`; run install; confirm version compatibility with `@xterm/xterm@6`.
2. Add `'openExternal'` case in `src/PixelAgentsViewProvider.ts` message dispatch.
3. Create `webview-ui/src/office/panel/webLinkHandler.ts` + its unit test.
4. Create `webview-ui/src/office/panel/useTerminalSearch.ts` + its unit test.
5. Create `webview-ui/src/office/panel/TerminalSearchBar.tsx` (presentational, no test — visual chrome covers it).
6. Wire `TerminalPane.tsx`: load addons, install `attachCustomKeyEventHandler`, render `TerminalSearchBar` overlay, thread the hook.
7. Full build + tests (`npm run build && npm test`).
8. Manual QA: links (click, hover), search (open, type, navigate, close), copy/paste (Cmd+C/V), focus transitions, Esc precedence.

## Risks

- **xterm.js addon version compatibility.** Addons for `@xterm/xterm@6` should be available on npm but the major-version line moves fast. Mitigation: step 1 of the implementation plan installs and confirms before any code change. If compatible versions aren't published yet, the implementer pauses and reports.
- **Webview CSP + clipboard API.** If `navigator.clipboard.writeText` is blocked by the VS Code webview CSP, xterm's Cmd/Ctrl+C silently fails. Mitigation: QA gates it. Fallback is `@xterm/addon-clipboard` (adds ~5 KB and explicit clipboard event handling). The bundle is not declared complete until clipboard works.
- **Search overlay z-index against future panel chrome.** The overlay uses z-index 5; the splitter uses z-index 10. Future chrome that introduces higher z-indices needs to keep the overlay above the terminal but below the splitter. Documented here.
- **Search bar input swallowing modifier keys for the OS.** Cmd+A in the search input should select-all the input text, not the terminal output. This is the browser default; we don't intercept it. Manual QA verifies.
- **Phase 3 link handling.** In a browser context the `openExternal` postMessage has no receiver. `webLinkHandler` introduces a single conditional check (`if (PHASE_3_BROWSER) window.open(uri) else postMessage(...)`); the flag is a hard-coded `false` constant for now, wired correctly when Phase 3 starts. This keeps the call site future-proof without inventing new abstractions.

## Compatibility With Phase 3

- All new webview code stays `vscode`-free in `webview-ui/src/office/panel/`. `webLinkHandler` uses the existing `vscode` shim (`vscodeApi.ts`), not VS Code APIs directly.
- The `openExternal` message rides through `MessageSink` (outbound). A WebSocket-backed sink in Phase 3 passes the message to the daemon, which can choose to open the URL in the user's default browser via OS APIs — or the browser SPA can short-circuit with `window.open`.
- No new persistence — nothing to migrate when storage moves out of `vscode.setState`.
- No new VS Code-only settings — nothing to keep in `contributes.configuration` (the project rule is already to avoid that surface).
