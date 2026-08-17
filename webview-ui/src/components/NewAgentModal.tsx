import { useEffect, useRef, useState } from 'react';

import type { NewAgentSpawn } from './newAgentSpawn.js';
import { buildSpawnRequest } from './newAgentSpawn.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
import { Modal } from './ui/Modal.js';

export type { NewAgentSpawn };

interface NewAgentModalProps {
  isOpen: boolean;
  /** MRU list from settingsLoaded (config.json), newest first. */
  recentFolders: string[];
  onSpawn: (spawn: NewAgentSpawn) => void;
  onClose: () => void;
}

/** "New agent" form — the browser runtime's + Agent flow. Both fields are
 *  optional; blank means the same defaults a plain spawn uses. Ported from
 *  v2-orchestrator's NewAgentPopover, re-skinned onto the shared Modal. */
export function NewAgentModal({ isOpen, recentFolders, onSpawn, onClose }: NewAgentModalProps) {
  // Folder starts EMPTY — the effective default is placeholder text only, so
  // the form never displays a path it would not honor.
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [bypass, setBypass] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setFolder('');
      setBypass(false);
      // Modal mounts its content on open; focus after that commit.
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const spawn = () => {
    onSpawn(buildSpawnRequest(name, folder, bypass));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New agent" className="w-340">
      <div
        role="dialog"
        aria-label="New agent"
        className="px-10 pb-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
          }
          // Enter submits only from the text fields — never from Cancel or the
          // recents quick-picks (those handle their own activation).
          if (
            e.key === 'Enter' &&
            e.target instanceof HTMLInputElement &&
            e.target.type === 'text'
          ) {
            e.preventDefault();
            spawn();
          }
        }}
      >
        <label className="block text-2xs text-text-muted mb-4">Name (optional)</label>
        <Input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Research Bot"
          aria-label="Agent name"
          className="mb-10"
        />

        <label className="block text-2xs text-text-muted mb-4">Starting folder (~ supported)</label>
        <Input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="default folder"
          aria-label="Starting folder"
          className={recentFolders.length ? 'mb-6' : 'mb-10'}
        />

        {recentFolders.length > 0 && (
          <div className="mb-10 overflow-y-auto" style={{ maxHeight: 120 }}>
            {recentFolders.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                title={f}
                className="block w-full text-left text-2xs px-6 py-3 bg-transparent border-none text-text-muted cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap hover:text-text"
              >
                {f}
              </button>
            ))}
          </div>
        )}

        <label className="flex items-center gap-6 text-2xs text-text-muted mb-10 cursor-pointer">
          <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
          Skip permissions mode <span className="text-warning">⚠</span>
        </label>

        <div className="flex gap-8 justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={spawn}>
            Spawn
          </Button>
        </div>
      </div>
    </Modal>
  );
}
