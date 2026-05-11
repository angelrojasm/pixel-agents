import { AWAITING_USER_GRACE_MS, PERMISSION_TIMER_DELAY_MS } from '../server/src/constants.js';
import type { AgentState, MessageSink } from './types.js';

/** Module-scoped awaiting-user escalation timers, one per agent. Kept here rather
 *  than threaded through call sites because the timer is purely an internal escalation
 *  of the "waiting" state — its lifecycle mirrors waitingTimers but at a longer delay. */
const awaitingUserTimers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelAwaitingUserTimer(agentId: number): void {
  const t = awaitingUserTimers.get(agentId);
  if (t) {
    clearTimeout(t);
    awaitingUserTimers.delete(agentId);
  }
}

/** Cancel any pending awaiting-user escalation AND clear the latched timestamp
 *  on the agent. Called whenever the agent transitions to an active state. */
export function clearAwaitingUser(agentId: number, agent: AgentState | undefined): void {
  cancelAwaitingUserTimer(agentId);
  if (agent) agent.awaitingSince = null;
}

function scheduleAwaitingUserTimer(
  agentId: number,
  agents: Map<number, AgentState>,
  webview: MessageSink | undefined,
): void {
  cancelAwaitingUserTimer(agentId);
  const timer = setTimeout(() => {
    awaitingUserTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;
    agent.awaitingSince = Date.now();
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'awaitingUser',
      since: agent.awaitingSince,
    });
  }, AWAITING_USER_GRACE_MS);
  awaitingUserTimers.set(agentId, timer);
}

export function clearAgentActivity(
  agent: AgentState | undefined,
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: MessageSink | undefined,
): void {
  if (!agent) return;

  // Preserve background agent tools — only clear foreground state
  if (agent.backgroundAgentToolIds.size > 0) {
    for (const toolId of agent.activeToolIds) {
      if (agent.backgroundAgentToolIds.has(toolId)) continue;
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      const toolName = agent.activeToolNames.get(toolId);
      agent.activeToolNames.delete(toolId);
      if (toolName === 'Task' || toolName === 'Agent') {
        agent.activeSubagentToolIds.delete(toolId);
        agent.activeSubagentToolNames.delete(toolId);
      }
    }
  } else {
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
  }

  agent.isWaiting = false;
  agent.permissionSent = false;
  cancelPermissionTimer(agentId, permissionTimers);
  clearAwaitingUser(agentId, agent);
  webview?.postMessage({ type: 'agentToolsClear', id: agentId });
  // Re-send background agent tools so webview re-creates their sub-agents
  for (const toolId of agent.backgroundAgentToolIds) {
    const status = agent.activeToolStatuses.get(toolId);
    if (status) {
      webview?.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
  }
  webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function cancelWaitingTimer(
  agentId: number,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  const timer = waitingTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(agentId);
  }
}

export function startWaitingTimer(
  agentId: number,
  delayMs: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: MessageSink | undefined,
): void {
  cancelWaitingTimer(agentId, waitingTimers);
  const timer = setTimeout(() => {
    waitingTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (agent) {
      agent.isWaiting = true;
    }
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
    });
    // Tier 2: escalate to persistent awaitingUser after the grace window.
    scheduleAwaitingUserTimer(agentId, agents, webview);
  }, delayMs);
  waitingTimers.set(agentId, timer);
}

export function cancelPermissionTimer(
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  const timer = permissionTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    permissionTimers.delete(agentId);
  }
}

export function startPermissionTimer(
  agentId: number,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionExemptTools: Set<string>,
  webview: MessageSink | undefined,
): void {
  cancelPermissionTimer(agentId, permissionTimers);
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;

    // Only flag if there are still active non-exempt tools (parent or sub-agent)
    let hasNonExempt = false;
    for (const toolId of agent.activeToolIds) {
      const toolName = agent.activeToolNames.get(toolId);
      if (!permissionExemptTools.has(toolName || '')) {
        hasNonExempt = true;
        break;
      }
    }

    // Check sub-agent tools for non-exempt tools
    const stuckSubagentParentToolIds: string[] = [];
    for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subToolNames) {
        if (!permissionExemptTools.has(toolName)) {
          stuckSubagentParentToolIds.push(parentToolId);
          hasNonExempt = true;
          break;
        }
      }
    }

    if (hasNonExempt) {
      agent.permissionSent = true;
      console.log(`[Pixel Agents] Timer: Agent ${agentId} - possible permission wait detected`);
      webview?.postMessage({
        type: 'agentToolPermission',
        id: agentId,
      });
      // Also notify stuck sub-agents
      for (const parentToolId of stuckSubagentParentToolIds) {
        webview?.postMessage({
          type: 'subagentToolPermission',
          id: agentId,
          parentToolId,
        });
      }
    }
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, timer);
}
