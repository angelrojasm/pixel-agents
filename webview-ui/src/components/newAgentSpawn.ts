export interface NewAgentSpawn {
  name?: string;
  folderPath?: string;
  bypassPermissions?: boolean;
}

/** Derive the openClaude payload from the New-agent form fields. Blank fields —
 *  and a folder left at the prefilled default — are omitted so the spawn uses
 *  the same defaults as a plain + Agent click (and the recents list stays free
 *  of the default folder). */
export function buildSpawnRequest(
  name: string,
  folder: string,
  defaultCwd: string,
  bypass: boolean,
): NewAgentSpawn {
  const trimmedName = name.trim();
  const trimmedFolder = folder.trim();
  return {
    name: trimmedName || undefined,
    folderPath: trimmedFolder && trimmedFolder !== defaultCwd.trim() ? trimmedFolder : undefined,
    bypassPermissions: bypass || undefined,
  };
}
