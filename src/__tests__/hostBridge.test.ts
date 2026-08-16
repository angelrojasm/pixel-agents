import { afterEach, describe, expect, it } from 'vitest';

import {
  daemonHostBridge,
  host,
  type HostBridge,
  type HostTerminal,
  setHostBridge,
} from '../hostBridge.js';

afterEach(() => setHostBridge(daemonHostBridge));

describe('hostBridge', () => {
  it('defaults to the daemon bridge so a missing host never crashes', () => {
    expect(host()).toBe(daemonHostBridge);
  });

  it('reports no workspace folders and no terminals in daemon mode', () => {
    // The daemon owns ptys, not VS Code terminals, and has no workspace concept.
    // Every call site must fall back (to defaultCwd/homedir, or to "nothing to adopt").
    expect(daemonHostBridge.workspaceFolders()).toEqual([]);
    expect(daemonHostBridge.terminals()).toEqual([]);
    expect(daemonHostBridge.activeTerminal()).toBeUndefined();
  });

  it('routes through whichever bridge the host installed', () => {
    const term: HostTerminal = { name: 'Claude 1', show: () => {}, dispose: () => {} };
    const fake: HostBridge = {
      workspaceFolders: () => ['/repo/a', '/repo/b'],
      terminals: () => [term],
      activeTerminal: () => term,
    };

    setHostBridge(fake);

    expect(host().workspaceFolders()).toEqual(['/repo/a', '/repo/b']);
    expect(host().terminals()).toEqual([term]);
    expect(host().activeTerminal()).toBe(term);
  });
});
