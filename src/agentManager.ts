import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Type-only: erased at build time, so this does NOT put `vscode` in the daemon's
// bundle graph. Only `sendLayout`'s ExtensionContext passthrough still needs it.
import type * as vscode from 'vscode';

import type {
  AgentsFile,
  PersistedAgent as PersistedAgentFile,
} from '../daemon/agentsPersistence.js';
import { writeAgents } from '../daemon/agentsPersistence.js';
import { JSONL_POLL_INTERVAL_MS, PTY_SCROLLBACK_MAX_LINES } from '../server/src/constants.js';
import { TERMINAL_NAME_PREFIX } from './constants.js';
import {
  ensureProjectScan,
  readNewLines,
  reassignAgentToFile,
  startFileWatching,
} from './fileWatcher.js';
import { host, type HostTerminal } from './hostBridge.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import type { PtyManager } from './pty/ptyManager.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState, MessageSink } from './types.js';

export function getProjectDirPath(cwd?: string): string {
  // Fall back to home directory when no workspace folder is open.
  // This is the common case on Linux/macOS when VS Code is launched without a folder
  // (e.g. `code` with no arguments). Claude Code writes JSONL files to
  // ~/.claude/projects/<hash>/ where <hash> is derived from the process cwd, so we
  // must use the same directory as the terminal's working directory.
  const workspacePath = cwd || host().workspaceFolders()[0] || os.homedir();
  const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
  console.log(`[Pixel Agents] Terminal: Project dir: ${workspacePath} → ${dirName}`);

  // Verify the directory exists; if not, try fuzzy matching against existing dirs
  if (!fs.existsSync(projectDir)) {
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
    try {
      if (fs.existsSync(projectsRoot)) {
        const candidates = fs.readdirSync(projectsRoot);
        // Try case-insensitive match (handles Windows drive letter casing)
        const lowerDirName = dirName.toLowerCase();
        const match = candidates.find((c) => c.toLowerCase() === lowerDirName);
        if (match && match !== dirName) {
          const matchedDir = path.join(projectsRoot, match);
          console.log(
            `[Pixel Agents] Project dir not found, using case-insensitive match: ${dirName} → ${match}`,
          );
          return matchedDir;
        }
        if (!match) {
          console.warn(
            `[Pixel Agents] Project dir does not exist: ${projectDir}. ` +
              `Available dirs (${candidates.length}): ${candidates.slice(0, 5).join(', ')}${candidates.length > 5 ? '...' : ''}`,
          );
        }
      }
    } catch {
      // Ignore scan errors
    }
  }
  return projectDir;
}

/** Resolve a user-configured defaultCwd string into an absolute path, or undefined.
 *  Expands leading `~` and validates the path exists on disk. Source-agnostic —
 *  the extension reads from globalState and passes the raw string in. */
export function resolveDefaultCwd(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return undefined;
  const expanded = trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
  try {
    if (fs.statSync(expanded).isDirectory()) return expanded;
  } catch {
    /* resolved path doesn't exist — ignore */
  }
  console.warn(`[Pixel Agents] Terminal: ignored defaultCwd "${raw}" — path not found`);
  return undefined;
}

export async function launchNewTerminal(
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  knownJsonlFiles: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  webview: MessageSink | undefined,
  persistAgents: () => void,
  folderPath?: string,
  bypassPermissions?: boolean,
  defaultCwd?: string,
  ptyManager?: PtyManager | null,
): Promise<void> {
  const folders = host().workspaceFolders();
  // Resolution order:
  //   1. explicit folderPath argument (e.g. multi-root folder picker)
  //   2. first workspace folder, if any (never in daemon mode — the list is empty)
  //   3. user-configured defaultCwd (from the in-app Settings modal, supports `~`)
  //   4. home directory
  const cwd = folderPath || folders[0] || resolveDefaultCwd(defaultCwd) || os.homedir();
  const isMultiRoot = folders.length > 1;
  const idx = nextTerminalIndexRef.current++;

  const sessionId = crypto.randomUUID();
  const claudeArgs = bypassPermissions
    ? ['--session-id', sessionId, '--dangerously-skip-permissions']
    : ['--session-id', sessionId];

  const terminal: HostTerminal | undefined = undefined;
  const ptyAgentId = nextAgentIdRef.current;

  // Spawn via node-pty so the terminal renders inside the office panel.
  // Use a login shell so the user's PATH (where `claude` lives) is sourced.
  if (ptyManager) {
    const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh');
    ptyManager.start(ptyAgentId, {
      shell,
      args: ['-l', '-c', `claude ${claudeArgs.join(' ')}`],
      cwd,
      env: process.env as Record<string, string | undefined>,
      cols: 80,
      rows: 24,
      scrollbackCapacity: PTY_SCROLLBACK_MAX_LINES,
    });
  }

  const projectDir = getProjectDirPath(cwd);

  // Pre-register expected JSONL file so project scan won't treat it as a /clear file
  const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
  knownJsonlFiles.add(expectedFile);

  // Create agent immediately (before JSONL file exists)
  const id = nextAgentIdRef.current++;
  const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
  const agent: AgentState = {
    id,
    sessionId,
    terminalRef: terminal,
    isExternal: false,
    projectDir,
    jsonlFile: expectedFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    awaitingSince: null,
    ptyBacked: ptyManager !== null && ptyManager !== undefined,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    folderName,
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    palette: 0,
    hueShift: 0,
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgents();
  const terminalName = `${TERMINAL_NAME_PREFIX} #${idx}`;
  console.log(`[Pixel Agents] Terminal: Agent ${id} - created for terminal ${terminalName}`);
  webview?.postMessage({
    type: 'agentCreated',
    id,
    folderName,
    terminalName,
    ptyBacked: agent.ptyBacked === true,
  });

  ensureProjectScan(
    projectDir,
    knownJsonlFiles,
    projectScanTimerRef,
    activeAgentIdRef,
    nextAgentIdRef,
    agents,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    webview,
    persistAgents,
  );

  // Poll for the specific JSONL file to appear
  const createdAt = Date.now();
  let pollCount = 0;
  console.log(`[Pixel Agents] Terminal: Agent ${id} - waiting for JSONL at ${agent.jsonlFile}`);
  const pollTimer = setInterval(() => {
    pollCount++;
    try {
      if (fs.existsSync(agent.jsonlFile)) {
        console.log(
          `[Pixel Agents] Terminal: Agent ${id} - found JSONL file ${path.basename(agent.jsonlFile)} (after ${pollCount}s)`,
        );
        clearInterval(pollTimer);
        jsonlPollTimers.delete(id);
        startFileWatching(
          id,
          agent.jsonlFile,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
        );
        readNewLines(id, agents, waitingTimers, permissionTimers, webview);
      } else if (pollCount === 10) {
        // After 10s of polling, warn with path details to help diagnose path encoding mismatches
        const dirExists = fs.existsSync(projectDir);
        let dirContents = '';
        if (dirExists) {
          try {
            const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
            dirContents =
              files.length > 0
                ? `Dir has ${files.length} JSONL file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`
                : 'Dir exists but has no JSONL files';
          } catch {
            dirContents = 'Dir exists but unreadable';
          }
        } else {
          dirContents = 'Dir does not exist';
        }
        console.warn(
          `[Pixel Agents] Terminal: Agent ${id} - JSONL file not found after 10s. ` +
            `Expected: ${agent.jsonlFile}. ${dirContents}`,
        );
      } else if (pollCount > 10) {
        // Possible /resume: terminal started a different session than expected.
        // Check every tick for a file modified after the agent was created.
        try {
          const trackedFiles = new Set([...agents.values()].map((a) => path.resolve(a.jsonlFile)));
          const candidates = fs
            .readdirSync(projectDir)
            .filter((f) => f.endsWith('.jsonl'))
            .map((f) => {
              const full = path.join(projectDir, f);
              return { file: full, mtime: fs.statSync(full).mtimeMs };
            })
            .filter((c) => !trackedFiles.has(path.resolve(c.file)) && c.mtime > createdAt)
            .sort((a, b) => b.mtime - a.mtime); // newest first

          if (candidates.length > 0) {
            console.log(
              `[Pixel Agents] Terminal: Agent ${id} - /resume detected, reassigning to ${path.basename(candidates[0].file)}`,
            );
            clearInterval(pollTimer);
            jsonlPollTimers.delete(id);
            reassignAgentToFile(
              id,
              candidates[0].file,
              agents,
              fileWatchers,
              pollingTimers,
              waitingTimers,
              permissionTimers,
              webview,
              persistAgents,
            );
          }
        } catch {
          /* ignore scan errors */
        }
      }
    } catch {
      /* file may not exist yet */
    }
  }, JSONL_POLL_INTERVAL_MS);
  jsonlPollTimers.set(id, pollTimer);
}

export function removeAgent(
  agentId: number,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistAgents: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Stop JSONL poll timer
  const jpTimer = jsonlPollTimers.get(agentId);
  if (jpTimer) {
    clearInterval(jpTimer);
  }
  jsonlPollTimers.delete(agentId);

  // Stop file watching
  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);
  const pt = pollingTimers.get(agentId);
  if (pt) {
    clearInterval(pt);
  }
  pollingTimers.delete(agentId);

  // Cancel timers
  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  // Remove from maps
  agents.delete(agentId);
  persistAgents();
}

export function persistAgents(
  agents: Map<number, AgentState>,
  agentsFilePath: string,
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
): void {
  const persisted: PersistedAgentFile[] = [];
  for (const agent of agents.values()) {
    // Pty-backed agents are runtime-only in v1 — skip persistence so
    // restoreAgents never tries to recreate them. The user re-spawns
    // them manually with + Agent. Future: re-attach via `claude --resume <id>`.
    if (agent.ptyBacked === true) continue;
    persisted.push({
      id: agent.id,
      sessionId: agent.sessionId,
      terminalName: agent.terminalRef?.name ?? '',
      isExternal: agent.isExternal || undefined,
      jsonlFile: agent.jsonlFile,
      projectDir: agent.projectDir,
      // folderName intentionally not persisted (multi-root runtime info only)
      palette: agent.palette,
      hueShift: agent.hueShift,
      workSeatId: agent.workSeatId,
      teamName: agent.teamName,
      agentName: agent.agentName,
      customTitle: agent.customTitle,
      isTeamLead: agent.isTeamLead,
      leadAgentId: agent.leadAgentId,
      teamUsesTmux: agent.teamUsesTmux,
    });
  }
  writeAgents(agentsFilePath, {
    version: 1,
    nextAgentId: nextAgentIdRef.current,
    nextTerminalIndex: nextTerminalIndexRef.current,
    agents: persisted,
  });
}

export function restoreAgents(
  readAgentsFile: () => AgentsFile,
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  knownJsonlFiles: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  activeAgentIdRef: { current: number | null },
  webview: MessageSink | undefined,
  doPersist: () => void,
): void {
  const file = readAgentsFile();
  const persisted = file.agents;
  if (persisted.length === 0) return;

  const liveTerminals = host().terminals();
  let maxId = 0;
  let maxIdx = 0;
  let restoredProjectDir: string | null = null;

  for (const p of persisted) {
    // Skip agents already in the map — prevents duplicate file watchers on re-entry
    // (webviewReady fires on every panel focus, re-calling restoreAgents each time)
    if (agents.has(p.id)) {
      knownJsonlFiles.add(p.jsonlFile);
      continue;
    }

    let terminal: HostTerminal | undefined;
    const isExternal = p.isExternal ?? false;

    if (isExternal) {
      // External agents — restore if JSONL file still exists on disk
      try {
        if (!fs.existsSync(p.jsonlFile)) continue;
      } catch {
        continue;
      }
    } else {
      // Terminal agents — find matching terminal by name
      terminal = liveTerminals.find((t) => t.name === p.terminalName);
      if (!terminal) continue;
    }

    const agent: AgentState = {
      id: p.id,
      sessionId: p.sessionId || path.basename(p.jsonlFile, '.jsonl'),
      terminalRef: terminal,
      isExternal,
      projectDir: p.projectDir,
      jsonlFile: p.jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      awaitingSince: null,
      ptyBacked: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      // folderName is not persisted in agents.json (multi-root runtime info only)
      folderName: undefined,
      hookDelivered: false,
      inputTokens: 0,
      outputTokens: 0,
      palette: p.palette ?? 0,
      hueShift: p.hueShift ?? 0,
      workSeatId: p.workSeatId,
      teamName: p.teamName,
      agentName: p.agentName,
      customTitle: p.customTitle,
      isTeamLead: p.isTeamLead,
      leadAgentId: p.leadAgentId,
      teamUsesTmux: p.teamUsesTmux,
    };

    agents.set(p.id, agent);
    knownJsonlFiles.add(p.jsonlFile);
    if (isExternal) {
      console.log(
        `[Pixel Agents] Terminal: Agent ${p.id} - restored external → ${path.basename(p.jsonlFile)}`,
      );
    } else {
      console.log(
        `[Pixel Agents] Terminal: Agent ${p.id} - restored → terminal "${p.terminalName}"`,
      );
    }

    if (p.id > maxId) maxId = p.id;
    // Extract terminal index from name like "Claude Code #3"
    const match = p.terminalName.match(/#(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxIdx) maxIdx = idx;
    }

    restoredProjectDir = p.projectDir;

    // Start file watching if JSONL exists, skipping to end of file
    try {
      if (fs.existsSync(p.jsonlFile)) {
        const stat = fs.statSync(p.jsonlFile);
        agent.fileOffset = stat.size;
        startFileWatching(
          p.id,
          p.jsonlFile,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
        );
      } else {
        // Poll for the file to appear
        const pollTimer = setInterval(() => {
          try {
            if (fs.existsSync(agent.jsonlFile)) {
              console.log(`[Pixel Agents] Terminal: Agent ${p.id} - found JSONL file`);
              clearInterval(pollTimer);
              jsonlPollTimers.delete(p.id);
              const stat = fs.statSync(agent.jsonlFile);
              agent.fileOffset = stat.size;
              startFileWatching(
                p.id,
                agent.jsonlFile,
                agents,
                fileWatchers,
                pollingTimers,
                waitingTimers,
                permissionTimers,
                webview,
              );
            }
          } catch {
            /* file may not exist yet */
          }
        }, JSONL_POLL_INTERVAL_MS);
        jsonlPollTimers.set(p.id, pollTimer);
      }
    } catch {
      /* ignore errors during restore */
    }
  }

  // After a short delay, remove restored terminal agents that never received data.
  // These are dead terminals restored by VS Code (e.g., after /clear or restart)
  // where Claude is no longer running.
  const restoredTerminalIds = [...agents.entries()]
    .filter(([, a]) => !a.isExternal && a.terminalRef)
    .map(([id]) => id);
  if (restoredTerminalIds.length > 0) {
    setTimeout(() => {
      for (const id of restoredTerminalIds) {
        const agent = agents.get(id);
        if (agent && !agent.isExternal && agent.linesProcessed === 0) {
          console.log(
            `[Pixel Agents] Terminal: Agent ${id} - removing restored agent, no data received`,
          );
          agent.terminalRef?.dispose();
          removeAgent(
            id,
            agents,
            fileWatchers,
            pollingTimers,
            waitingTimers,
            permissionTimers,
            jsonlPollTimers,
            doPersist,
          );
          webview?.postMessage({ type: 'agentClosed', id });
        }
      }
    }, 10_000); // 10 seconds grace period
  }

  // Advance counters past restored IDs.
  // Use the larger of: the file's persisted next-ID, and the max scanned ID + 1.
  const fileNextId = file.nextAgentId ?? 1;
  const fileNextIdx = file.nextTerminalIndex ?? 1;
  const computedNextId = maxId > 0 ? maxId + 1 : 1;
  const computedNextIdx = maxIdx > 0 ? maxIdx + 1 : 1;
  if (Math.max(fileNextId, computedNextId) >= nextAgentIdRef.current) {
    nextAgentIdRef.current = Math.max(fileNextId, computedNextId);
  }
  if (Math.max(fileNextIdx, computedNextIdx) >= nextTerminalIndexRef.current) {
    nextTerminalIndexRef.current = Math.max(fileNextIdx, computedNextIdx);
  }

  // Re-persist cleaned-up list (removes entries whose terminals are gone)
  doPersist();

  // Start project scan for /clear detection
  if (restoredProjectDir) {
    ensureProjectScan(
      restoredProjectDir,
      knownJsonlFiles,
      projectScanTimerRef,
      activeAgentIdRef,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      webview,
      doPersist,
    );
  }
}

export function buildExistingAgentsPayload(agents: Map<number, AgentState>): {
  agents: number[];
  agentMeta: Record<number, { palette: number; hueShift: number; workSeatId?: string }>;
  folderNames: Record<number, string>;
  externalAgents: Record<number, boolean>;
  terminalNames: Record<number, string>;
  ptyBackedAgents: Record<number, boolean>;
} {
  const agentIds: number[] = [];
  for (const id of agents.keys()) {
    agentIds.push(id);
  }
  agentIds.sort((a, b) => a - b);

  // Build agentMeta from the agents map — palette, hueShift, and workSeatId are now
  // stored on the runtime AgentState (populated from agents.json on restore).
  const agentMeta: Record<number, { palette: number; hueShift: number; workSeatId?: string }> = {};
  for (const [id, agent] of agents) {
    agentMeta[id] = {
      palette: agent.palette,
      hueShift: agent.hueShift,
      workSeatId: agent.workSeatId,
    };
  }

  // Include folderName and isExternal per agent
  const folderNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  const ptyBackedAgents: Record<number, boolean> = {};
  for (const [id, agent] of agents) {
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
    if (agent.ptyBacked === true) {
      ptyBackedAgents[id] = true;
    }
  }

  const terminalNames: Record<number, string> = {};
  for (const [id, agent] of agents) {
    if (agent.terminalRef?.name) {
      terminalNames[id] = agent.terminalRef.name;
    }
  }

  return {
    agents: agentIds,
    agentMeta,
    folderNames,
    externalAgents,
    terminalNames,
    ptyBackedAgents,
  };
}

export function sendExistingAgents(
  agents: Map<number, AgentState>,
  webview: MessageSink | undefined,
): void {
  if (!webview) return;
  const payload = buildExistingAgentsPayload(agents);
  console.log(
    `[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(payload.agents)}, meta=${JSON.stringify(payload.agentMeta)}`,
  );
  webview.postMessage({ type: 'existingAgents', ...payload });
  // Note: sendCurrentAgentStatuses is called separately AFTER layoutLoaded
  // so that agentStatus/agentToolStart messages arrive after characters are created.
}

export function sendCurrentAgentStatuses(
  agents: Map<number, AgentState>,
  webview: MessageSink | undefined,
): void {
  if (!webview) return;
  for (const [agentId, agent] of agents) {
    // Re-send active tools
    for (const [toolId, status] of agent.activeToolStatuses) {
      const toolName = agent.activeToolNames.get(toolId) ?? '';
      webview.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
        toolName,
      });
    }
    // Re-send waiting status
    if (agent.isWaiting) {
      webview.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
      });
    }
    // Re-send team metadata
    if (agent.teamName) {
      webview.postMessage({
        type: 'agentTeamInfo',
        id: agentId,
        teamName: agent.teamName,
        agentName: agent.agentName,
        isTeamLead: agent.isTeamLead,
        leadAgentId: agent.leadAgentId,
        teamUsesTmux: agent.teamUsesTmux,
      });
    }
    // Re-send custom title so renamed agents survive reload
    if (agent.customTitle) {
      webview.postMessage({
        type: 'agentRenamed',
        id: agentId,
        customTitle: agent.customTitle,
      });
    }
    // Re-send token usage
    if (agent.inputTokens > 0 || agent.outputTokens > 0) {
      webview.postMessage({
        type: 'agentTokenUsage',
        id: agentId,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
      });
    }
  }
}

export function sendLayout(
  context: vscode.ExtensionContext,
  webview: MessageSink | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  if (!webview) return;
  const result = migrateAndLoadLayout(context, defaultLayout);
  webview.postMessage({
    type: 'layoutLoaded',
    layout: result?.layout ?? null,
    wasReset: result?.wasReset ?? false,
  });
}

/** Restart a pty-backed agent in place: kill the old worker, start a fresh one
 *  using the same agent's projectDir + sessionId. The caller owns triggering
 *  the new pty (this helper is a thin coordinator). */
export function restartPty(
  agentId: number,
  agents: Map<number, AgentState>,
  ptyManager: PtyManager | null,
  defaultCwd: string | undefined,
  bypassPermissions: boolean,
): boolean {
  if (!ptyManager) return false;
  const agent = agents.get(agentId);
  if (!agent || !agent.ptyBacked) return false;
  ptyManager.stop(agentId);
  const cwd = host().workspaceFolders()[0] || resolveDefaultCwd(defaultCwd) || os.homedir();
  const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh');
  const claudeArgs = bypassPermissions
    ? ['--session-id', agent.sessionId, '--dangerously-skip-permissions']
    : ['--session-id', agent.sessionId];
  ptyManager.start(agentId, {
    shell,
    args: ['-l', '-c', `claude ${claudeArgs.join(' ')}`],
    cwd,
    env: process.env as Record<string, string | undefined>,
    cols: 80,
    rows: 24,
    scrollbackCapacity: PTY_SCROLLBACK_MAX_LINES,
  });
  return true;
}

// ── Phase 3: snapshot helpers ────────────────────────────────────────────────
// These are called by PixelAgentsViewProvider.onWebSocketConnect to build the
// replaySnapshot deps. They read from the live agents Map directly; no caching.

/** Returns the sorted array of agent IDs (as numbers) for the `existingAgents`
 *  message. The SPA's existingAgents handler reconstructs characters from this list. */
export function getAgentIds(agents: Map<number, AgentState>): number[] {
  return Array.from(agents.keys()).sort((a, b) => a - b);
}

/** Returns per-agent rename entries (only agents with a customTitle). */
export function getRenamedAgentsSummary(
  agents: Map<number, AgentState>,
): Array<{ id: number; customTitle: string }> {
  const result: Array<{ id: number; customTitle: string }> = [];
  for (const [id, agent] of agents) {
    if (agent.customTitle) {
      result.push({ id, customTitle: agent.customTitle });
    }
  }
  return result;
}

/** Returns per-agent team info entries (only agents with teamName set). */
export function getTeamInfoSummary(agents: Map<number, AgentState>): Array<{
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
}> {
  const result: Array<{
    id: number;
    teamName?: string;
    agentName?: string;
    isTeamLead?: boolean;
    leadAgentId?: number;
  }> = [];
  for (const [id, agent] of agents) {
    if (agent.teamName) {
      result.push({
        id,
        teamName: agent.teamName,
        agentName: agent.agentName,
        isTeamLead: agent.isTeamLead,
        leadAgentId: agent.leadAgentId,
      });
    }
  }
  return result;
}

/** Returns per-agent terminal name entries for all agents with a known terminalRef name. */
export function getTerminalNamesSummary(
  agents: Map<number, AgentState>,
): Array<{ id: number; terminalName: string }> {
  const result: Array<{ id: number; terminalName: string }> = [];
  for (const [id, agent] of agents) {
    const name = agent.terminalRef?.name;
    if (name) {
      result.push({ id, terminalName: name });
    }
  }
  return result;
}

/** Returns per-agent status entries for agents that are currently waiting or active. */
export function getActiveAgentStatusesSummary(
  agents: Map<number, AgentState>,
): Array<{ id: number; status: string }> {
  const result: Array<{ id: number; status: string }> = [];
  for (const [id, agent] of agents) {
    if (agent.isWaiting) {
      result.push({ id, status: 'waiting' });
    }
  }
  return result;
}
