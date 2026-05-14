import { useCallback, useEffect, useState } from 'react';

import type { SettingsCategory } from '../../../../src/constants.js';
import {
  SETTINGS_MODAL_HEIGHT_PX,
  SETTINGS_MODAL_WIDTH_PX,
  SETTINGS_SIDEBAR_WIDTH_PX,
} from '../../constants.js';
import { AboutPanel } from './panels/AboutPanel.js';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { GeneralPanel } from './panels/GeneralPanel.js';
import { OfficePanel } from './panels/OfficePanel.js';
import { TerminalPanel } from './panels/TerminalPanel.js';

interface SettingsModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  // General
  soundEnabled: boolean;
  onToggleSound: () => void;
  alwaysShowLabels: boolean;
  onToggleAlwaysShowLabels: () => void;
  showTerminalNames: boolean;
  onToggleShowTerminalNames: () => void;
  debugMode: boolean;
  onToggleDebugMode: () => void;
  // Agents
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  defaultCwd: string;
  onChangeDefaultCwd: (v: string) => void;
  // Terminal
  usePtyTerminal: boolean;
  onToggleUsePtyTerminal: () => void;
  panelPosition: 'bottom' | 'left' | 'right';
  onChangePanelPosition: (p: 'bottom' | 'left' | 'right') => void;
  terminalFontFamily: string;
  onChangeTerminalFontFamily: (v: string) => void;
  terminalFontSize: number;
  onChangeTerminalFontSize: (v: number) => void;
  terminalLineHeight: number;
  onChangeTerminalLineHeight: (v: number) => void;
  // Office
  externalAssetDirectories: string[];
  onAddAssetDirectory: (path: string) => void;
  onRemoveAssetDirectory: (path: string) => void;
  onExportLayout: () => void;
  onImportLayout: () => void;
  // About
  extensionVersion: string;
  onViewChangelog: () => void;
  onViewHooksInfo: () => void;
  // Restore defaults
  onRestoreCategory: (category: 'general' | 'agents' | 'terminal' | 'office') => void;
}

const CATEGORIES: { id: SettingsCategory | 'about'; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'office', label: 'Office' },
  { id: 'about', label: 'About' },
];

export function SettingsModalV2(props: SettingsModalV2Props) {
  const { isOpen, onClose } = props;
  const [active, setActive] = useState<(typeof CATEGORIES)[number]['id']>('general');

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
        e.preventDefault();
      }
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onKey]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="settings-title"
      onClick={onClose}
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: SETTINGS_MODAL_WIDTH_PX,
          height: SETTINGS_MODAL_HEIGHT_PX,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          boxShadow: '2px 2px 0px var(--pixel-border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '2px solid var(--pixel-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span id="settings-title" style={{ fontWeight: 'bold' }}>
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <nav
            role="tablist"
            aria-orientation="vertical"
            style={{
              width: SETTINGS_SIDEBAR_WIDTH_PX,
              borderRight: '2px solid var(--pixel-border)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={active === c.id}
                onClick={() => setActive(c.id)}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderLeft:
                    active === c.id ? '2px solid var(--pixel-accent)' : '2px solid transparent',
                  fontWeight: active === c.id ? 'bold' : 'normal',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <main role="tabpanel" style={{ flex: 1, padding: 0, overflowY: 'auto', minHeight: 0 }}>
            {active === 'general' && (
              <GeneralPanel
                soundEnabled={props.soundEnabled}
                onToggleSound={props.onToggleSound}
                alwaysShowLabels={props.alwaysShowLabels}
                onToggleAlwaysShowLabels={props.onToggleAlwaysShowLabels}
                showTerminalNames={props.showTerminalNames}
                onToggleShowTerminalNames={props.onToggleShowTerminalNames}
                debugMode={props.debugMode}
                onToggleDebugMode={props.onToggleDebugMode}
                onRestoreDefaults={() => props.onRestoreCategory('general')}
              />
            )}
            {active === 'agents' && (
              <AgentsPanel
                watchAllSessions={props.watchAllSessions}
                onToggleWatchAllSessions={props.onToggleWatchAllSessions}
                hooksEnabled={props.hooksEnabled}
                onToggleHooksEnabled={props.onToggleHooksEnabled}
                defaultCwd={props.defaultCwd}
                onChangeDefaultCwd={props.onChangeDefaultCwd}
                onRestoreDefaults={() => props.onRestoreCategory('agents')}
              />
            )}
            {active === 'terminal' && (
              <TerminalPanel
                usePtyTerminal={props.usePtyTerminal}
                onToggleUsePtyTerminal={props.onToggleUsePtyTerminal}
                panelPosition={props.panelPosition}
                onChangePanelPosition={props.onChangePanelPosition}
                terminalFontFamily={props.terminalFontFamily}
                onChangeTerminalFontFamily={props.onChangeTerminalFontFamily}
                terminalFontSize={props.terminalFontSize}
                onChangeTerminalFontSize={props.onChangeTerminalFontSize}
                terminalLineHeight={props.terminalLineHeight}
                onChangeTerminalLineHeight={props.onChangeTerminalLineHeight}
                onRestoreDefaults={() => props.onRestoreCategory('terminal')}
              />
            )}
            {active === 'office' && (
              <OfficePanel
                externalAssetDirectories={props.externalAssetDirectories}
                onAddAssetDirectory={props.onAddAssetDirectory}
                onRemoveAssetDirectory={props.onRemoveAssetDirectory}
                onExportLayout={props.onExportLayout}
                onImportLayout={props.onImportLayout}
                onRestoreDefaults={() => props.onRestoreCategory('office')}
              />
            )}
            {active === 'about' && (
              <AboutPanel
                extensionVersion={props.extensionVersion}
                onViewChangelog={props.onViewChangelog}
                onViewHooksInfo={props.onViewHooksInfo}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
