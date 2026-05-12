import { useEffect, useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  showTerminalNames: boolean;
  onToggleShowTerminalNames: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  usePtyTerminal: boolean;
  onToggleUsePtyTerminal: () => void;
  defaultCwd: string;
  onChangeDefaultCwd: (v: string) => void;
  panelPosition: 'bottom' | 'left' | 'right';
  onChangePanelPosition: (p: 'bottom' | 'left' | 'right') => void;
  terminalFontSize: number;
  onChangeTerminalFontSize: (n: number) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  showTerminalNames,
  onToggleShowTerminalNames,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksEnabled,
  onToggleHooksEnabled,
  usePtyTerminal,
  onToggleUsePtyTerminal,
  defaultCwd,
  onChangeDefaultCwd,
  panelPosition,
  onChangePanelPosition,
  terminalFontSize,
  onChangeTerminalFontSize,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const [cwdDraft, setCwdDraft] = useState(defaultCwd);
  // Keep the draft in sync when the canonical value arrives from the extension
  // (initial load or cross-window change), unless the user is mid-edit.
  useEffect(() => {
    if (document.activeElement?.tagName !== 'INPUT') {
      setCwdDraft(defaultCwd);
    }
  }, [defaultCwd]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <MenuItem
        onClick={() => {
          vscode.postMessage({ type: 'openSessionsFolder' });
          onClose();
        }}
      >
        Open Sessions Folder
      </MenuItem>
      <MenuItem
        onClick={() => {
          vscode.postMessage({ type: 'exportLayout' });
          onClose();
        }}
      >
        Export Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          vscode.postMessage({ type: 'importLayout' });
          onClose();
        }}
      >
        Import Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          vscode.postMessage({ type: 'addExternalAssetDirectory' });
          onClose();
        }}
      >
        Add Asset Directory
      </MenuItem>
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => vscode.postMessage({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0"
          >
            x
          </Button>
        </div>
      ))}
      <Checkbox
        label="Sound Notifications"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      <Checkbox
        label="Watch All Sessions"
        checked={watchAllSessions}
        onChange={onToggleWatchAllSessions}
      />
      <Checkbox
        label="Instant Detection (Hooks)"
        checked={hooksEnabled}
        onChange={onToggleHooksEnabled}
      />
      <Checkbox
        label="Use in-panel terminal (experimental)"
        checked={usePtyTerminal}
        onChange={onToggleUsePtyTerminal}
      />
      <Checkbox
        label="Always Show Labels"
        checked={alwaysShowOverlay}
        onChange={onToggleAlwaysShowOverlay}
      />
      <Checkbox
        label="Show Terminal Names"
        checked={showTerminalNames}
        onChange={onToggleShowTerminalNames}
      />
      <Checkbox label="Debug View" checked={isDebugMode} onChange={onToggleDebugMode} />
      <div className="flex flex-col gap-4 py-6 px-10">
        <span className="text-xs">Terminal Panel Position</span>
        <div className="flex gap-8">
          {(['bottom', 'left', 'right'] as const).map((p) => (
            <label key={p} className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="panel-position"
                value={p}
                checked={panelPosition === p}
                onChange={() => onChangePanelPosition(p)}
              />
              <span className="capitalize">{p}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 py-6 px-10">
        <label className="text-xs" htmlFor="terminal-font-size-input">
          Terminal Font Size (px)
        </label>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChangeTerminalFontSize(terminalFontSize - 1)}
            disabled={terminalFontSize <= 10}
            className="shrink-0"
          >
            –
          </Button>
          <input
            id="terminal-font-size-input"
            type="number"
            min={10}
            max={24}
            step={1}
            value={terminalFontSize}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v)) onChangeTerminalFontSize(v);
            }}
            className="w-16 bg-transparent border-2 border-white/30 rounded-none px-3 py-1 text-xs text-center outline-none focus:border-accent"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChangeTerminalFontSize(terminalFontSize + 1)}
            disabled={terminalFontSize >= 24}
            className="shrink-0"
          >
            +
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4 py-6 px-10">
        <label className="text-xs" htmlFor="default-cwd-input">
          Default terminal folder (used when no workspace is open)
        </label>
        <input
          id="default-cwd-input"
          type="text"
          value={cwdDraft}
          placeholder="~/Desktop"
          onChange={(e) => setCwdDraft(e.target.value)}
          onBlur={() => {
            if (cwdDraft !== defaultCwd) onChangeDefaultCwd(cwdDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setCwdDraft(defaultCwd);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full bg-transparent border-2 border-white/30 rounded-none px-4 py-2 text-xs outline-none focus:border-accent"
        />
      </div>
    </Modal>
  );
}
