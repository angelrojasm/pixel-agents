import { useCallback, useEffect, useRef, useState } from 'react';

import type { SettingsCategory } from '../../../../src/constants.js';
import {
  SETTINGS_FONT_LABEL_PX,
  SETTINGS_MODAL_HEIGHT_PX,
  SETTINGS_MODAL_WIDTH_PX,
} from '../../constants.js';
import { vscode } from '../../vscodeApi.js';
import { AboutPanel } from './panels/AboutPanel.js';
import { AgentsPanel } from './panels/AgentsPanel.js';
import { GeneralPanel } from './panels/GeneralPanel.js';
import { OfficePanel } from './panels/OfficePanel.js';
import { TerminalPanel } from './panels/TerminalPanel.js';
import { SettingsSidebar } from './SettingsSidebar.js';
import { UndoToast } from './UndoToast.js';

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

  // Undo state for Restore Defaults
  const [undoCategory, setUndoCategory] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<unknown>(null);

  const mainRef = useRef<HTMLElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
        e.preventDefault();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [role="tab"], input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onKey]);

  // On open, focus the close button so the user lands inside the modal.
  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  useEffect(() => {
    if (!mainRef.current) return;
    const first = mainRef.current.querySelector<HTMLElement>(
      'button, [role="radio"], input, select',
    );
    first?.focus({ preventScroll: true });
  }, [active]);

  const onRestoreCategory = useCallback(
    (category: 'general' | 'agents' | 'terminal' | 'office') => {
      // Build a snapshot from current props. The parent owns the live values;
      // we record them so undo can restore them precisely.
      let snapshot: Record<string, unknown> = {};
      if (category === 'general') {
        snapshot = {
          soundEnabled: props.soundEnabled,
          alwaysShowLabels: props.alwaysShowLabels,
          showTerminalNames: props.showTerminalNames,
          debugMode: props.debugMode,
        };
      } else if (category === 'agents') {
        snapshot = {
          watchAllSessions: props.watchAllSessions,
          hooksEnabled: props.hooksEnabled,
          defaultCwd: props.defaultCwd,
        };
      } else if (category === 'terminal') {
        // panelPosition + fontSize are webview-local (panelPersistence) and not
        // covered by Restore Defaults / Undo. See src/constants.ts comment.
        snapshot = {
          fontFamily: props.terminalFontFamily,
          lineHeight: props.terminalLineHeight,
        };
      } else if (category === 'office') {
        snapshot = { externalAssetDirectories: props.externalAssetDirectories };
      }
      setUndoSnapshot(snapshot);
      setUndoCategory(category);
      vscode.postMessage({ type: 'restoreCategoryDefaults', category });
    },
    [
      props.soundEnabled,
      props.alwaysShowLabels,
      props.showTerminalNames,
      props.debugMode,
      props.watchAllSessions,
      props.hooksEnabled,
      props.defaultCwd,
      props.terminalFontFamily,
      props.terminalLineHeight,
      props.externalAssetDirectories,
    ],
  );

  const onUndo = useCallback(() => {
    if (undoCategory && undoSnapshot) {
      vscode.postMessage({
        type: 'restoreCategoryDefaults',
        category: undoCategory,
        values: undoSnapshot,
      });
    }
    setUndoCategory(null);
    setUndoSnapshot(null);
  }, [undoCategory, undoSnapshot]);

  // Stable dismiss handler so UndoToast's auto-dismiss timer is created once
  // per toast appearance instead of resetting on every parent re-render.
  const handleUndoToastDismiss = useCallback(() => {
    setUndoCategory(null);
    setUndoSnapshot(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: 100 }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: SETTINGS_MODAL_WIDTH_PX,
          height: SETTINGS_MODAL_HEIGHT_PX,
          // Short webviews (narrow side panel): clamp instead of clipping the
          // header/footer out of reach.
          maxWidth: '100%',
          maxHeight: '100%',
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
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: SETTINGS_FONT_LABEL_PX,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <SettingsSidebar
            categories={CATEGORIES}
            active={active}
            onChange={(id) => setActive(id)}
          />
          <main
            ref={mainRef}
            role="tabpanel"
            id={`settings-panel-${active}`}
            aria-labelledby={`settings-tab-${active}`}
            style={{ flex: 1, padding: 0, overflowY: 'auto', minHeight: 0, position: 'relative' }}
          >
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
                onRestoreDefaults={() => onRestoreCategory('general')}
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
                onRestoreDefaults={() => onRestoreCategory('agents')}
              />
            )}
            {active === 'terminal' && (
              <TerminalPanel
                panelPosition={props.panelPosition}
                onChangePanelPosition={props.onChangePanelPosition}
                terminalFontFamily={props.terminalFontFamily}
                onChangeTerminalFontFamily={props.onChangeTerminalFontFamily}
                terminalFontSize={props.terminalFontSize}
                onChangeTerminalFontSize={props.onChangeTerminalFontSize}
                terminalLineHeight={props.terminalLineHeight}
                onChangeTerminalLineHeight={props.onChangeTerminalLineHeight}
                onRestoreDefaults={() => onRestoreCategory('terminal')}
              />
            )}
            {active === 'office' && (
              <OfficePanel
                externalAssetDirectories={props.externalAssetDirectories}
                onAddAssetDirectory={props.onAddAssetDirectory}
                onRemoveAssetDirectory={props.onRemoveAssetDirectory}
                onExportLayout={props.onExportLayout}
                onImportLayout={props.onImportLayout}
                onRestoreDefaults={() => onRestoreCategory('office')}
              />
            )}
            {active === 'about' && (
              <AboutPanel
                extensionVersion={props.extensionVersion}
                onViewChangelog={props.onViewChangelog}
                onViewHooksInfo={props.onViewHooksInfo}
              />
            )}
            {undoCategory && (
              <UndoToast
                message={`${undoCategory.charAt(0).toUpperCase()}${undoCategory.slice(1)} defaults restored.`}
                onUndo={onUndo}
                onDismiss={handleUndoToastDismiss}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
