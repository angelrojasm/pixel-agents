import type { AgentsFile, PersistedAgent } from './agentsPersistence.js';

/** Drop persisted agents whose backing pty process is no longer alive.
 *
 *  - External agents (`isExternal: true`) never had a pty we own — always keep.
 *  - Pty-backed agents (`sessionId` present): keep iff `pidOf(sessionId)` returns
 *    a number AND `alive(pid)` is true. If we have no record of the PID (post
 *    daemon-restart case), drop the agent — it'll re-appear via the project-
 *    level JSONL scanner if its session is still alive.
 */
export function pruneDeadAgents(
  file: AgentsFile,
  deps: {
    pidOf: (sessionId: string) => number | undefined;
    alive: (pid: number) => boolean;
  },
): AgentsFile {
  const keep: PersistedAgent[] = [];
  for (const a of file.agents) {
    if (a.isExternal) {
      keep.push(a);
      continue;
    }
    const pid = a.sessionId ? deps.pidOf(a.sessionId) : undefined;
    if (pid !== undefined && deps.alive(pid)) {
      keep.push(a);
    }
    // else: drop (pty owner is dead or unknown)
  }
  return { ...file, agents: keep };
}
