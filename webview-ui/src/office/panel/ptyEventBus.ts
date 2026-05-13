type DataHandler = (data: string) => void;
type ExitHandler = (info: { code: number; signal?: string }) => void;
type ScrollbackHandler = (lines: string[]) => void;
type ActivityHandler = () => void;

interface AgentSubscribers {
  ptyData: Set<DataHandler>;
  ptyExit: Set<ExitHandler>;
  ptyScrollback: Set<ScrollbackHandler>;
  ptyActivity: Set<ActivityHandler>;
}

type Handler<E extends keyof AgentSubscribers> = E extends 'ptyData'
  ? DataHandler
  : E extends 'ptyExit'
    ? ExitHandler
    : E extends 'ptyScrollback'
      ? ScrollbackHandler
      : ActivityHandler;

/**
 * Per-agent event router for pty wire messages. xterm.js renderers subscribe
 * imperatively for an agentId; useExtensionMessages emits as messages arrive.
 * Keeps React state out of the per-keystroke render path.
 *
 * The `ptyActivity` channel fires *whenever* ptyData arrives — same dispatch
 * site, separate fan-out — so consumers that only care about "is bytes
 * flowing right now" don't have to subscribe to the full data stream.
 */
export class PtyEventBus {
  private agents = new Map<number, AgentSubscribers>();

  private slot(agentId: number): AgentSubscribers {
    let s = this.agents.get(agentId);
    if (!s) {
      s = {
        ptyData: new Set(),
        ptyExit: new Set(),
        ptyScrollback: new Set(),
        ptyActivity: new Set(),
      };
      this.agents.set(agentId, s);
    }
    return s;
  }

  subscribe<E extends keyof AgentSubscribers>(
    agentId: number,
    event: E,
    handler: Handler<E>,
  ): { dispose(): void } {
    const set = this.slot(agentId)[event] as Set<Handler<E>>;
    set.add(handler);
    return {
      dispose: () => {
        set.delete(handler);
      },
    };
  }

  subscribeActivity(agentId: number, handler: ActivityHandler): { dispose(): void } {
    return this.subscribe(agentId, 'ptyActivity', handler);
  }

  emitData(agentId: number, data: string): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyData) h(data);
    for (const h of s.ptyActivity) h();
  }

  emitExit(agentId: number, info: { code: number; signal?: string }): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyExit) h(info);
  }

  emitScrollback(agentId: number, lines: string[]): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyScrollback) h(lines);
  }
}
