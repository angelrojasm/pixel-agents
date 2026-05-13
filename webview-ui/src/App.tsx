import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { DebugView } from './components/DebugView.js';
import { EditActionBar } from './components/EditActionBar.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { characterLabel } from './office/engine/characters.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { HookHealthToast } from './office/panel/HookHealthToast.js';
import { OfficePanel } from './office/panel/OfficePanel.js';
import type { AgentSummary } from './office/panel/panelTypes.js';
import { useCharacterPtyActivity } from './office/panel/useCharacterPtyActivity.js';
import { usePanelState } from './office/panel/usePanelState.js';
import { EditTool } from './office/types.js';
import { isBrowserRuntime } from './runtime.js';
import { vscode } from './vscodeApi.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    if (isBrowserRuntime) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    showTerminalNames,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
    defaultCwd,
    setDefaultCwd,
    usePtyTerminal,
    setUsePtyTerminal,
    terminalFontFamily,
    setTerminalFontFamily,
    terminalLineHeight,
    setTerminalLineHeight,
    ptyBackedByAgent,
    ptyEventBus,
    agentRenameSeq,
    hookHealth,
    acknowledgeCrash,
    restartAgent,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    vscode.postMessage({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    vscode.postMessage({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      vscode.postMessage({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  const [showTerminalNamesLocal, setShowTerminalNamesLocal] = useState(true);

  useEffect(() => {
    setShowTerminalNamesLocal(showTerminalNames);
  }, [showTerminalNames]);

  const handleToggleShowTerminalNames = useCallback(() => {
    setShowTerminalNamesLocal((prev) => {
      const newVal = !prev;
      vscode.postMessage({ type: 'setShowTerminalNames', enabled: newVal });
      return newVal;
    });
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'focusAgent', id });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const officeState = getOfficeState();

  const panel = usePanelState(containerRef, editor.isEditMode);

  // Pty → character animation: bumps `Character.ptyActivityUntil` on bytes
  // from the focused agent's pty. Renderer reads the timestamp every frame.
  useCharacterPtyActivity(panel.state.focusedAgentId, ptyEventBus, officeState);

  const handleCloseAgent = useCallback(
    (id: number) => {
      // Pick the next agent to focus (most recent other agent id, if any)
      const others = agents.filter((a) => a !== id);
      const mostRecentOther = others.length > 0 ? Math.max(...others) : null;
      panel.closeAgent(id, mostRecentOther);
      vscode.postMessage({ type: 'closeAgent', id });
    },
    [agents, panel],
  );

  const agentSummaries = useMemo<AgentSummary[]>(() => {
    const os = getOfficeState();
    const chars = os.getCharacters();
    return agents
      .map((id) => chars.find((ch) => ch.id === id))
      .filter((ch): ch is NonNullable<typeof ch> => ch != null)
      .map((ch): AgentSummary => {
        const statusStr = agentStatuses[ch.id];
        const toolList = agentTools[ch.id];
        const uiStatus: AgentSummary['status'] =
          statusStr === 'waiting' ? 'waiting' : toolList && toolList.length > 0 ? 'active' : 'idle';
        return {
          id: ch.id,
          name: characterLabel(ch),
          palette: ch.palette,
          hueShift: ch.hueShift,
          status: uiStatus,
        };
      });
    // agentRenameSeq is an intentional re-render trigger (not consumed inside body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, agentStatuses, agentTools, agentRenameSeq]);

  // Auto-open the drawer when a new agent is spawned (+ Agent click).
  // Skip the initial population to keep the "collapsed on first run" contract.
  const seenMaxIdRef = useRef<number>(-Infinity);
  useEffect(() => {
    const maxId = agents.reduce((m, a) => Math.max(m, a), -Infinity);
    if (maxId > seenMaxIdRef.current) {
      if (seenMaxIdRef.current > -Infinity) {
        panel.openForNewAgent(maxId);
      }
      seenMaxIdRef.current = maxId;
    }
  }, [agents, panel]);

  const handleClick = useCallback(
    (agentId: number) => {
      const os = getOfficeState();
      const meta = os.subagentMeta.get(agentId);
      const focusId = meta ? meta.parentAgentId : agentId;
      // If the clicked character is currently crashed and unacknowledged, ack it.
      const ch = os.characters.get(agentId);
      if (ch?.crashed && !ch.crashedAcknowledged) {
        acknowledgeCrash(agentId);
      }
      vscode.postMessage({ type: 'focusAgent', id: focusId });
      panel.focusOrToggle(focusId);
    },
    [panel, acknowledgeCrash],
  );

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  const panelPos = panel.state.panelPosition;
  const outerFlexDirection: 'row' | 'column' = panelPos === 'bottom' ? 'column' : 'row';
  const panelFirst = panelPos === 'left';

  const panelEl = (
    <OfficePanel
      agents={agentSummaries}
      state={panel.state}
      band={panel.band}
      onFocusAgent={handleClick}
      onCollapse={panel.collapse}
      onToggleRailHidden={panel.toggleRailHidden}
      onSetUserBandSizePx={panel.setUserBandSizePx}
      ptyBackedByAgent={ptyBackedByAgent}
      ptyEventBus={ptyEventBus}
      terminalFontFamily={terminalFontFamily}
      terminalLineHeight={terminalLineHeight}
      hookHealth={hookHealth.status}
      onRestartAgent={restartAgent}
    />
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{ display: 'flex', flexDirection: outerFlexDirection }}
    >
      {panelFirst && panelEl}
      <div
        ref={canvasAreaRef}
        style={{ flex: '1 1 auto', position: 'relative', minWidth: 0, minHeight: 0 }}
      >
        <OfficeCanvas
          officeState={officeState}
          onClick={handleClick}
          isEditMode={editor.isEditMode}
          editorState={editorState}
          onEditorTileAction={editor.handleEditorTileAction}
          onEditorEraseAction={editor.handleEditorEraseAction}
          onEditorSelectionChange={editor.handleEditorSelectionChange}
          onDeleteSelected={editor.handleDeleteSelected}
          onRotateSelected={editor.handleRotateSelected}
          onDragMove={editor.handleDragMove}
          editorTick={editor.editorTick}
          zoom={editor.zoom}
          onZoomChange={editor.handleZoomChange}
          panRef={editor.panRef}
          focusedAgentId={panel.state.focusedAgentId}
          agentIds={agents}
          onFocusAgent={handleClick}
          onTogglePanel={panel.collapse}
        />

        {!isDebugMode ? (
          <>
            <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

            {/* Vignette overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'var(--vignette)' }}
            />

            {editor.isEditMode && editor.isDirty && (
              <EditActionBar editor={editor} editorState={editorState} />
            )}

            {showRotateHint && (
              <div
                className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
                style={{ top: editor.isDirty ? 64 : 8 }}
              >
                Rotate (R)
              </div>
            )}

            {editor.isEditMode &&
              (() => {
                const selUid = editorState.selectedFurnitureUid;
                const selColor = selUid
                  ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                  : null;
                return (
                  <EditorToolbar
                    activeTool={editorState.activeTool}
                    selectedTileType={editorState.selectedTileType}
                    selectedFurnitureType={editorState.selectedFurnitureType}
                    selectedFurnitureUid={selUid}
                    selectedFurnitureColor={selColor}
                    floorColor={editorState.floorColor}
                    wallColor={editorState.wallColor}
                    selectedWallSet={editorState.selectedWallSet}
                    onToolChange={editor.handleToolChange}
                    onTileTypeChange={editor.handleTileTypeChange}
                    onFloorColorChange={editor.handleFloorColorChange}
                    onWallColorChange={editor.handleWallColorChange}
                    onWallSetChange={editor.handleWallSetChange}
                    onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                    onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                    loadedAssets={loadedAssets}
                  />
                );
              })()}

            <ToolOverlay
              officeState={officeState}
              agents={agents}
              agentTools={agentTools}
              subagentCharacters={subagentCharacters}
              containerRef={canvasAreaRef}
              zoom={editor.zoom}
              panRef={editor.panRef}
              onCloseAgent={handleCloseAgent}
              alwaysShowOverlay={alwaysShowOverlay}
              showTerminalNames={showTerminalNamesLocal}
            />
          </>
        ) : (
          <DebugView
            agents={agents}
            selectedAgent={selectedAgent}
            agentTools={agentTools}
            agentStatuses={agentStatuses}
            subagentTools={subagentTools}
            onSelectAgent={handleSelectAgent}
          />
        )}

        {/* Hooks first-run tooltip */}
        {!hooksInfoShown && !hooksTooltipDismissed && (
          <Tooltip
            title="Instant Detection Active"
            position="top-right"
            onDismiss={() => {
              setHooksTooltipDismissed(true);
              vscode.postMessage({ type: 'setHooksInfoShown' });
            }}
          >
            <span className="text-sm text-text leading-none">
              Your agents now respond in real-time.{' '}
              <span
                className="text-accent cursor-pointer underline"
                onClick={() => {
                  setIsHooksInfoOpen(true);
                  setHooksTooltipDismissed(true);
                  vscode.postMessage({ type: 'setHooksInfoShown' });
                }}
              >
                View more
              </span>
            </span>
          </Tooltip>
        )}

        {/* Hooks info modal */}
        <Modal
          isOpen={isHooksInfoOpen}
          onClose={() => setIsHooksInfoOpen(false)}
          title="Instant Detection is ON"
          zIndex={52}
        >
          <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
            <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
            <ul className="mb-8 pl-18 list-disc m-0">
              <li className="text-sm mb-2">Permission prompts appear instantly</li>
              <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
              <li className="text-sm mb-2">Sound notifications play immediately</li>
            </ul>
            <p className="mb-12 text-text-muted">
              This works through Claude Code Hooks, small event listeners that notify Pixel Agents
              whenever something happens in your Claude sessions.
            </p>
            <div className="text-center">
              <button
                onClick={() => setIsHooksInfoOpen(false)}
                className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
              >
                Got it
              </button>
            </div>
            <p className="mt-8 text-xs text-text-muted text-center">
              To disable, go to Settings {'>'} Instant Detection
            </p>
          </div>
        </Modal>

        <BottomToolbar
          isEditMode={editor.isEditMode}
          onOpenClaude={editor.handleOpenClaude}
          onToggleEditMode={editor.handleToggleEditMode}
          isSettingsOpen={isSettingsOpen}
          onToggleSettings={() => setIsSettingsOpen((v) => !v)}
          workspaceFolders={workspaceFolders}
        />

        <VersionIndicator
          currentVersion={extensionVersion}
          lastSeenVersion={lastSeenVersion}
          onDismiss={handleWhatsNewDismiss}
          onOpenChangelog={handleOpenChangelog}
        />

        <ChangelogModal
          isOpen={isChangelogOpen}
          onClose={() => setIsChangelogOpen(false)}
          currentVersion={extensionVersion}
        />

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={handleToggleDebugMode}
          alwaysShowOverlay={alwaysShowOverlay}
          onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
          showTerminalNames={showTerminalNamesLocal}
          onToggleShowTerminalNames={handleToggleShowTerminalNames}
          externalAssetDirectories={externalAssetDirectories}
          watchAllSessions={watchAllSessions}
          onToggleWatchAllSessions={() => {
            const newVal = !watchAllSessions;
            setWatchAllSessions(newVal);
            vscode.postMessage({ type: 'setWatchAllSessions', enabled: newVal });
          }}
          hooksEnabled={hooksEnabled}
          onToggleHooksEnabled={() => {
            const newVal = !hooksEnabled;
            setHooksEnabled(newVal);
            vscode.postMessage({ type: 'setHooksEnabled', enabled: newVal });
          }}
          usePtyTerminal={usePtyTerminal}
          onToggleUsePtyTerminal={() => setUsePtyTerminal(!usePtyTerminal)}
          defaultCwd={defaultCwd}
          onChangeDefaultCwd={setDefaultCwd}
          panelPosition={panel.state.panelPosition}
          onChangePanelPosition={panel.setPanelPosition}
          terminalFontSize={panel.state.terminalFontSize}
          onChangeTerminalFontSize={panel.setTerminalFontSize}
          terminalFontFamily={terminalFontFamily}
          onSetTerminalFontFamily={setTerminalFontFamily}
          terminalLineHeight={terminalLineHeight}
          onSetTerminalLineHeight={setTerminalLineHeight}
        />

        {showMigrationNotice && (
          <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
        )}
      </div>
      {!panelFirst && panelEl}
      <HookHealthToast status={hookHealth.status} reason={hookHealth.reason} />
    </div>
  );
}

export default App;
