import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PixelAgentsServer } from '../server/src/server.js';

export async function startDaemon(opts: { open?: boolean } = {}): Promise<{
  server: PixelAgentsServer;
  stop: () => Promise<void>;
}> {
  const server = new PixelAgentsServer();
  const cfg = await server.start();
  if (opts.open ?? true) {
    const { default: open } = await import('open');
    await open(`http://127.0.0.1:${cfg.port}`);
  }
  console.log(`[Pixel Agents] daemon listening on http://127.0.0.1:${cfg.port}`);
  return {
    server,
    stop: async () => {
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

async function main() {
  const cmd = process.argv[2] ?? 'serve';
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
