import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';

import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_THEME_BACKGROUND,
} from '../../constants.js';
import type { PtyEventBus } from '../../office/panel/ptyEventBus.js';
import { transport } from '../../transport/index.js';
import { TerminalSearchBar } from './TerminalSearchBar.js';
import { useTerminalSearch } from './useTerminalSearch.js';
import { handleWebLinkClick } from './webLinkHandler.js';

interface TerminalPaneProps {
  agentId: number;
  agentName: string | null;
  bus: PtyEventBus;
  onRestartAgent: (id: number) => void;
}

function send(msg: Record<string, unknown>): void {
  transport.send(msg as never);
}

/**
 * One xterm.js terminal wired to a server-side pty via the transport.
 * Ported from v2-orchestrator's TerminalPane: transport singleton instead of
 * vscode.postMessage, frames keyed by `id` (upstream convention), plus
 * crash/restart channels for the restartAgent flow.
 */
export function TerminalPane({ agentId, agentName, bus, onRestartAgent }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

  const [exitInfo, setExitInfo] = useState<{ code?: number; signal?: string } | null>(null);
  const [crashed, setCrashed] = useState(false);

  const search = useTerminalSearch(searchRef);
  const searchHookRef = useRef(search);
  searchHookRef.current = search;

  // One-time setup per agentId: create the xterm.js Terminal + addons, attach to DOM.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontSize: TERMINAL_FONT_SIZE_PX,
      // xterm needs a true monospace font for cell-aligned output; the global
      // pixel font is proportional and unsuitable here (see index.css .xterm).
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: { background: TERMINAL_THEME_BACKGROUND },
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      convertEol: true,
    });
    const fit = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinks = new WebLinksAddon((event, uri) => handleWebLinkClick(event, uri));
    term.loadAddon(fit);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinks);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = searchAddon;

    // Subscribe to the addon's search-result events; dispatch through the live
    // hook (via the ref) to avoid stale-closure issues.
    const resultsSub = searchAddon.onDidChangeResults((e) => {
      searchHookRef.current.setResultsFromAddon(e.resultIndex, e.resultCount);
    });

    term.attachCustomKeyEventHandler((event) => {
      const s = searchHookRef.current;
      // Alt+F: open search bar (block xterm).
      if (event.type === 'keydown' && event.key === 'f' && event.altKey) {
        s.open();
        return false;
      }
      // Esc: close search bar if open (block xterm); otherwise pass through.
      if (event.type === 'keydown' && event.key === 'Escape' && s.state.open) {
        s.close();
        term.focus();
        return false;
      }
      return true;
    });

    // Initial fit + send dimensions so the pty matches.
    try {
      fit.fit();
    } catch {
      // open() races with first layout; the ResizeObserver below catches up.
    }
    let lastCols = term.cols;
    let lastRows = term.rows;
    send({ type: 'ptyResize', id: agentId, cols: lastCols, rows: lastRows });

    // Bus subscriptions.
    const dataSub = bus.subscribe(agentId, 'ptyData', (chunk) => {
      term.write(chunk);
    });
    const exitSub = bus.subscribe(agentId, 'ptyExit', ({ code, signal }) => {
      const msg = signal
        ? `\r\n[pty exited: signal ${signal}]\r\n`
        : `\r\n[pty exited: code ${String(code)}]\r\n`;
      term.write(msg);
      setExitInfo({ code, signal });
    });
    const scrollbackSub = bus.subscribe(agentId, 'ptyScrollback', (lines) => {
      for (const line of lines) term.write(line);
    });
    const crashedSub = bus.subscribe(agentId, 'agentCrashed', () => {
      setCrashed(true);
    });
    const restartedSub = bus.subscribe(agentId, 'agentRestarted', () => {
      setExitInfo(null);
      setCrashed(false);
    });

    // Keystrokes → ptyInput.
    const keyDisposable = term.onData((data) => {
      send({ type: 'ptyInput', id: agentId, data });
    });

    // Resize observer → fit + ptyResize (only when dimensions actually changed).
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
        send({ type: 'ptyResize', id: agentId, cols: c, rows: r });
      }
    });
    ro.observe(el);

    // Signal ready so the server replays scrollback.
    send({ type: 'terminalPaneReady', id: agentId });

    return () => {
      resultsSub.dispose();
      dataSub.dispose();
      exitSub.dispose();
      scrollbackSub.dispose();
      crashedSub.dispose();
      restartedSub.dispose();
      keyDisposable.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // The bus is stable (ref'd in useExtensionMessages); agentName is
    // presentational only and doesn't change the underlying terminal.
  }, [agentId, bus]);

  // Reset exit/crash state when switching agents.
  useEffect(() => {
    setExitInfo(null);
    setCrashed(false);
  }, [agentId]);

  return (
    <div
      className="flex-1 min-h-0 relative p-2"
      style={{ background: 'var(--color-bg-dark)' }}
      aria-label={agentName ? `Terminal for ${agentName}` : 'Terminal'}
    >
      <div ref={containerRef} className="w-full h-full" />
      {exitInfo && (
        <button
          type="button"
          onClick={() => {
            setExitInfo(null);
            setCrashed(false);
            onRestartAgent(agentId);
          }}
          className="absolute top-4 left-4 border-2 border-border bg-bg text-2xs cursor-pointer z-10 px-8 py-2 hover:text-text"
          style={{ color: crashed ? 'var(--color-status-error)' : 'var(--color-text-muted)' }}
          title={
            exitInfo.signal
              ? `Restart agent (exited: signal ${exitInfo.signal})`
              : `Restart agent (exited: code ${String(exitInfo.code)})`
          }
          aria-label="Restart agent"
        >
          ↻ Restart{crashed ? ' (crashed)' : ''}
        </button>
      )}
      {search.state.open && (
        <TerminalSearchBar
          query={search.state.query}
          currentMatch={search.state.currentMatch}
          totalMatches={search.state.totalMatches}
          onQueryChange={search.setQuery}
          onNext={search.next}
          onPrevious={search.previous}
          onClose={() => {
            search.close();
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
