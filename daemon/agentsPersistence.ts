import * as fs from 'node:fs';

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  terminalName: string;
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  workSeatId?: string;
  palette: number;
  hueShift: number;
  customTitle?: string;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentsFile {
  version: 1;
  nextAgentId: number;
  nextTerminalIndex: number;
  agents: PersistedAgent[];
}

const EMPTY: AgentsFile = { version: 1, nextAgentId: 1, nextTerminalIndex: 1, agents: [] };

export function readAgents(file: string): AgentsFile {
  if (!fs.existsSync(file)) return { ...EMPTY };
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentsFile;
  if (data.version !== 1) throw new Error(`agents.json: unsupported version ${data.version}`);
  return data;
}

export function writeAgents(file: string, data: AgentsFile): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
