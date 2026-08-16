import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PixelAgentsServer } from '../server/src/server.js';
import { resolveDistRoot, resolveSpaRoot } from '../daemon/staticServer.js';
import { ensureHookScript } from '../daemon/hookScriptInstaller.js';
import { readAgents, writeAgents } from '../daemon/agentsPersistence.js';
import { pruneDeadAgents } from '../daemon/agentsBootCleanup.js';
import { createConfigStore } from '../daemon/configStore.js';
import { createOrchestrator } from '../daemon/orchestrator.js';

export async function startDaemon(opts: { open?: boolean } = {}): Promise<{
  server: PixelAgentsServer;
  stop: () => Promise<void>;
}> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Works from both layouts: source (bin/serve.ts via tsx) and bundled (dist/bin/serve.js).
  const distRoot = resolveDistRoot(here);
  const bundled = path.join(distRoot, 'hooks', 'claude-hook.js');
  ensureHookScript({ home: os.homedir(), bundledPath: bundled });

  // Prune agents whose pty is no longer alive on daemon startup
  const agentsFile = path.join(os.homedir(), '.pixel-agents', 'agents.json');
  const before = readAgents(agentsFile);
  const after = pruneDeadAgents(before, {
    // v1 doesn't track pty PIDs across daemon restarts, so every pty-backed
    // agent gets dropped on boot. External agents (no sessionId we own) stay.
    // A future PtyManager that persists PIDs would return real values here and
    // keep agents whose pty is genuinely alive.
    pidOf: () => undefined,
    alive: () => false,
  });
  if (after.agents.length !== before.agents.length) writeAgents(agentsFile, after);

  const server = new PixelAgentsServer({ spaRoot: resolveSpaRoot(here) });
  const cfg = await server.start();

  // Resolve bundled assetsRoot: dist/assets lives next to the compiled JS
  const assetsRoot = distRoot;

  // Wire up the host-agnostic orchestration (agent restore, file watchers,
  // hook handler, snapshot-on-WS-connect, asset loading, layout watcher).
  const configFile = path.join(os.homedir(), '.pixel-agents', 'config.json');
  const config = createConfigStore(configFile);
  const orchestrator = createOrchestrator({
    broadcastSink: server.getBroadcastSink(),
    server,
    config,
    agentsFilePath: agentsFile,
    assetsRoot: fs.existsSync(path.join(assetsRoot, 'assets')) ? assetsRoot : null,
    extensionVersion: '',
  });

  await orchestrator.start();

  if (opts.open ?? true) {
    const { default: open } = await import('open');
    await open(`http://127.0.0.1:${cfg.port}`);
  }
  console.log(`[Pixel Agents] daemon listening on http://127.0.0.1:${cfg.port}`);
  return {
    server,
    stop: async () => {
      orchestrator.dispose();
      server.stop();
    },
  };
}

interface HookInstaller {
  install?: () => Promise<void>;
  uninstall?: () => Promise<void>;
}

export async function runInstallHooks(deps: { installer: HookInstaller }): Promise<number> {
  await deps.installer.install?.();
  console.log('[Pixel Agents] hooks installed');
  return 0;
}

export async function runUninstallHooks(deps: { installer: HookInstaller }): Promise<number> {
  await deps.installer.uninstall?.();
  console.log('[Pixel Agents] hooks uninstalled');
  return 0;
}

interface ServerJson {
  port: number;
  pid: number;
  token: string;
  startedAt: number;
}

export async function runStatus(deps: {
  readServerJson: () => ServerJson | null;
  pidAlive: (pid: number) => boolean;
  log: (s: string) => void;
}): Promise<number> {
  const j = deps.readServerJson();
  if (!j || !deps.pidAlive(j.pid)) {
    deps.log('not running');
    return 1;
  }
  deps.log(`running on http://127.0.0.1:${j.port} (pid ${j.pid})`);
  return 0;
}

export async function runStop(deps: {
  readServerJson: () => ServerJson | null;
  kill: (pid: number, signal: 'SIGTERM') => void;
}): Promise<number> {
  const j = deps.readServerJson();
  if (!j) {
    console.error('not running');
    return 1;
  }
  deps.kill(j.pid, 'SIGTERM');
  return 0;
}

function defaultReadServerJson(): ServerJson | null {
  const p = path.join(os.homedir(), '.pixel-agents', 'server.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ServerJson;
  } catch {
    return null;
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function loadInstaller(): Promise<HookInstaller> {
  const mod = await import('../server/src/providers/hook/claude/claudeHookInstaller.js');
  return {
    install: mod.installHooks,
    uninstall: mod.uninstallHooks,
  };
}

/**
 * Pick the subcommand out of argv. `serve` is the default, and a leading flag
 * (`node dist/bin/serve.js --no-open`) means "serve with that flag" rather than
 * a subcommand literally named `--no-open`.
 */
export function parseCommand(argv: string[]): string {
  const first = argv[2];
  return !first || first.startsWith('-') ? 'serve' : first;
}

async function main() {
  const cmd = parseCommand(process.argv);
  switch (cmd) {
    case 'serve': {
      const noOpen = process.argv.includes('--no-open');
      const { stop } = await startDaemon({ open: !noOpen });
      process.on('SIGINT', () => {
        stop().then(() => process.exit(0));
      });
      process.on('SIGTERM', () => {
        stop().then(() => process.exit(0));
      });
      break;
    }
    case 'install-hooks':
      process.exit(await runInstallHooks({ installer: await loadInstaller() }));
    case 'uninstall-hooks':
      process.exit(await runUninstallHooks({ installer: await loadInstaller() }));
    case 'status':
      process.exit(
        await runStatus({
          readServerJson: defaultReadServerJson,
          pidAlive: defaultPidAlive,
          log: console.log,
        }),
      );
    case 'stop':
      process.exit(
        await runStop({
          readServerJson: defaultReadServerJson,
          kill: process.kill.bind(process),
        }),
      );
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
