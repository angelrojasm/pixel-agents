export interface NewAgentSpawn {
  name?: string;
  folderPath?: string;
  bypassPermissions?: boolean;
}

/** Derive the openClaude payload from the New-agent form fields. Blank fields
 *  are omitted so the spawn uses the same defaults as a plain + Agent click.
 *  Any non-blank folder is sent explicitly — the form never prefills a path it
 *  would not honor (the default is shown as placeholder text only). */
export function buildSpawnRequest(name: string, folder: string, bypass: boolean): NewAgentSpawn {
  const trimmedName = name.trim();
  const trimmedFolder = folder.trim();
  return {
    name: trimmedName || undefined,
    folderPath: trimmedFolder || undefined,
    bypassPermissions: bypass || undefined,
  };
}
