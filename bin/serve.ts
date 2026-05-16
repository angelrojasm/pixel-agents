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
