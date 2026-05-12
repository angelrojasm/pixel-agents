import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { PANEL_BG_CHROME } from '../../constants.js';
import { vscode } from '../../vscodeApi.js';
import type { PtyEventBus } from './ptyEventBus.js';

interface TerminalPaneProps {
  agentId: number;
  agentName: string | null;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  bus: PtyEventBus;
}

export function TerminalPane({
  agentId,
  agentName,
  fontSize,
  fontFamily,
  lineHeight,
  bus,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // One-time setup per agentId: create the xterm.js Terminal + addon, attach to DOM.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontSize,
      // xterm.js needs a true monospace font for cell-aligned terminal output;
      // FS Pixel Sans is a proportional UI font and is not suitable here.

      fontFamily,
      lineHeight,
      theme: {
        background: PANEL_BG_CHROME,
      },
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit + send dimensions to the extension so the pty matches.
    try {
      fit.fit();
    } catch {
      // open() races with first layout; ignore and let the ResizeObserver catch up.
    }
    const cols = term.cols;
    const rows = term.rows;
    vscode.postMessage({ type: 'ptyResize', agentId, cols, rows });

    // Subscribe to bus events.
    const dataSub = bus.subscribe(agentId, 'ptyData', (chunk) => {
      term.write(chunk);
    });
    const exitSub = bus.subscribe(agentId, 'ptyExit', ({ code, signal }) => {
      const msg = signal
        ? `\r\n[pty exited: signal ${signal}]\r\n`
        : `\r\n[pty exited: code ${code}]\r\n`;
      term.write(msg);
    });
    const scrollbackSub = bus.subscribe(agentId, 'ptyScrollback', (lines) => {
      for (const line of lines) term.write(line);
    });

    // Keystrokes → ptyInput.
    const keyDisposable = term.onData((data) => {
      vscode.postMessage({ type: 'ptyInput', agentId, data });
    });

    // Resize observer → fit + ptyResize (only when dimensions actually changed).
    let lastCols = cols;
    let lastRows = rows;
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
      } catch {
        return;
      }
      const c = termRef.current.cols;
      const r = termRef.current.rows;
      if (c !== lastCols || r !== lastRows) {
        lastCols = c;
        lastRows = r;
        vscode.postMessage({ type: 'ptyResize', agentId, cols: c, rows: r });
      }
    });
    ro.observe(el);

    // Signal ready so the extension replays scrollback.
    vscode.postMessage({ type: 'terminalPaneReady', agentId });

    return () => {
      dataSub.dispose();
      exitSub.dispose();
      scrollbackSub.dispose();
      keyDisposable.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // The bus is stable (ref'd in useExtensionMessages); fontSize changes are
    // handled by a separate effect below to avoid re-creating the terminal.
    // agentName is presentational only; doesn't change the underlying terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, bus]);

  // Apply font-size changes without recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;
    try {
      fit.fit();
    } catch {
      return;
    }
    const cols = term.cols;
    const rows = term.rows;
    vscode.postMessage({ type: 'ptyResize', agentId, cols, rows });
  }, [fontSize, agentId]);

  // Apply font-family and line-height changes without recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontFamily = fontFamily;
    term.options.lineHeight = lineHeight;
    try {
      fit.fit();
    } catch {
      /* container may be 0x0 mid-mount; ignore */
    }
    const cols = term.cols;
    const rows = term.rows;
    vscode.postMessage({ type: 'ptyResize', agentId, cols, rows });
  }, [agentId, fontFamily, lineHeight]);

  return (
    <div
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        background: PANEL_BG_CHROME,
        padding: 4,
      }}
      aria-label={agentName ? `Terminal for ${agentName}` : 'Terminal'}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
