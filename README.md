<h1 align="center">
    <img src="webview-ui/public/banner.png" alt="Pixel Agents">
</h1>

<h2 align="center" style="padding-bottom: 20px;">
  The game interface where AI agents build real things
</h2>

Pixel Agents turns multi-agent AI systems into something you can actually see and manage. Each agent becomes a character in a pixel art office. They walk around, sit at their desk, and visually reflect what they are doing — typing when writing code, reading when searching files, waiting when it needs your attention.

> This is an internal fork of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents), extended with an in-office terminal, a standalone browser runtime, and more. It is not published to any marketplace — install from source below.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Two ways to run it

**VS Code extension** — the office lives in a panel (or a full-screen editor tab) next to your code. Agent terminals render _inside the office_: click a character, get its terminal.

**Standalone daemon + browser** — no VS Code needed. A local daemon serves the same office as a browser tab at `http://127.0.0.1:<port>`, with live terminals, the layout editor, and settings — everything the extension has. Both runtimes are first-class, share the same state under `~/.pixel-agents/`, and can run at the same time.

## Features

- **One agent, one character** — every Claude Code session gets its own animated character
- **Terminals inside the office** — agents run in embedded xterm.js terminals (node-pty); click a character to focus its terminal, with search (Alt+F), clickable links, and per-agent restart
- **New agent form** — hover **+ Agent** → _New agent…_ to pick a name and starting folder (with a remembered recent-folders list); plain click still spawns instantly with defaults
- **Hooks-first status tracking** — Claude Code hooks give instant, reliable agent status; heuristic JSONL watching remains as fallback
- **Live activity animations** — typing when writing code, reading when searching files, plus a focus halo, crash indicator, and sub-agent characters linked to their parent
- **Office layout editor** — floors, walls, and furniture with full color control, undo/redo, and an expandable grid up to 64×64
- **Layout export/import** — share office designs as JSON files (native dialogs in VS Code, download/file-picker in the browser); compatible with layouts exported from upstream Pixel Agents
- **Speech bubbles & sound** — visual indicators when an agent needs input, optional chime on turn completion
- **Persistent everything** — layout, agents, and settings live in `~/.pixel-agents/`, shared across windows, tabs, and both runtimes
- **External asset directories** — load custom or third-party furniture packs from any folder on your machine
- **Diverse characters** — 6 diverse characters, based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- Node.js 18+ (daemon) and/or VS Code 1.105.0+ (extension)
- **Platform**: macOS and Linux are the tested paths; Windows should work but the embedded pty terminal is less battle-tested there

## Getting Started

### Build from source (both runtimes)

```bash
git clone <your-org-fork-url>/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
cd server && npm install && cd ..
npm run build
```

### Run the standalone daemon (browser office)

```bash
node dist/bin/serve.js        # starts the daemon and opens your browser
```

Useful subcommands: `status`, `stop`, `serve --no-open`, `install-hooks`, `uninstall-hooks`.

> If a Pixel Agents-enabled VS Code window is already running, it owns `~/.pixel-agents/server.json` and the daemon will attach to it instead of starting its own server — quit VS Code first for a purely standalone session.

### Run the VS Code extension

Open the repo in VS Code and press **F5** to launch the Extension Development Host (or package a `.vsix` with `vsce package` and install it manually).

### Usage

1. Open the **Pixel Agents** panel (bottom panel area in VS Code, or just the browser tab in daemon mode)
2. Click **+ Agent** to spawn a Claude Code session and its character — or hover it and choose **New agent…** to set a name and starting folder
3. Start coding with Claude — watch the character react in real time; click it to open its terminal
4. Click a character, then click a work seat to reassign it
5. Click **Layout** to open the office editor and customize your space

## Layout Editor

- **Floor** — full HSB color control
- **Walls** — auto-tiling walls with color customization
- **Tools** — select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels (Ctrl+Z / Ctrl+Y in VS Code, Alt+Z / Alt+Shift+Z in the browser)
- **Export/Import** — share layouts as JSON files via Settings → Office; layouts from upstream Pixel Agents forks import cleanly

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

All office assets (furniture, floors, walls) are fully open-source and included under `webview-ui/public/assets/`. Each furniture item lives in its own folder with a `manifest.json` declaring sprites, rotation groups, state groups (on/off), and animation frames.

To add furniture, create a folder in `webview-ui/public/assets/furniture/` with your PNGs and a `manifest.json`, then rebuild. The asset manager (`scripts/asset-manager.html`) provides a visual editor for manifests. To use furniture from an external directory, open Settings → **Add Asset Directory** (see [docs/external-assets.md](docs/external-assets.md)).

## How It Works

Pixel Agents receives Claude Code hook events for instant status, and watches the JSONL transcript files for tool-level detail — purely observational, no modifications to Claude Code. Agent terminals are real ptys owned by the host (extension or daemon) and rendered in the webview over a message protocol; the same protocol travels `postMessage` in VS Code and WebSocket in the browser, so both runtimes run the identical UI.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension / daemon**: TypeScript, node-pty, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D, xterm.js

## Known Limitations

- **Windows** — the embedded pty terminal uses ConPTY and is less tested than macOS/Linux
- **Browser runtime** — folder pickers don't exist in a browser: adding external asset directories is VS-Code-only for now, and `Cmd/Ctrl` shortcuts are remapped to `Alt` (the browser owns `Cmd+F` etc.)
- **Agent names live for the session** — creation-time names (and `/rename`) persist across tab reloads, but pty agents are not resumed across a daemon/window restart

## Troubleshooting

1. **Hook health** — a red dot on the panel's hide button plus a toast means hook events stopped flowing; restart the daemon/window or run `node dist/bin/serve.js install-hooks`
2. **Debug View** — Settings → toggle **Debug View** for per-agent connection diagnostics: JSONL file status, lines parsed, last data timestamp
3. **Logs** — daemon: watch the terminal you started it from; extension: **View > Debug Console**, search `[Pixel Agents]`

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for phase status and queued ideas. Descoped-but-planned: LAN/remote access to the daemon, and resumable agents via `claude --resume`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Credits

Forked from [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) — thanks to Pablo De Lucca, Florin Timbuc, and all upstream contributors. Character sprites are based on [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

## License

This project is licensed under the [MIT License](LICENSE).
