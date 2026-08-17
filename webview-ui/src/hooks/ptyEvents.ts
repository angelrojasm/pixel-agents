/** Pure mapping from server wire messages to typed pty events. Kept free of
 *  React/DOM so the five-message protocol has direct unit coverage. */

export interface PtyEvent {
  kind: 'data' | 'exit' | 'scrollback' | 'crashed' | 'restarted';
  id: number;
  data?: string;
  lines?: string[];
  code?: number;
  signal?: string;
}

const KIND_BY_TYPE: Record<string, PtyEvent['kind']> = {
  ptyData: 'data',
  ptyExit: 'exit',
  ptyScrollback: 'scrollback',
  agentCrashed: 'crashed',
  agentRestarted: 'restarted',
};

/** Map one of the five pty wire messages to a PtyEvent, or null for anything else. */
export function toPtyEvent(msg: Record<string, unknown>): PtyEvent | null {
  const kind = KIND_BY_TYPE[String(msg.type ?? '')];
  if (!kind) return null;
  if (typeof msg.id !== 'number') return null;
  const event: PtyEvent = { kind, id: msg.id };
  if (typeof msg.data === 'string') event.data = msg.data;
  if (Array.isArray(msg.lines)) event.lines = msg.lines.filter((l) => typeof l === 'string');
  if (typeof msg.code === 'number') event.code = msg.code;
  if (typeof msg.signal === 'string') event.signal = msg.signal;
  return event;
}
