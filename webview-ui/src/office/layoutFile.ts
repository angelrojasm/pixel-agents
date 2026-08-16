// Browser-runtime layout export/import helpers.
//
// Export serializes the LAST-SAVED layout state — the raw `layoutLoaded`
// payload remembered below, never live (possibly unsaved) editor state. This
// matches the extension's export, which reads the saved layout file.
import { LAYOUT_EXPORT_FILENAME } from '../constants';

let savedLayout: unknown = null;

/** Remember the raw layoutLoaded payload (pre-migration, verbatim). */
export function rememberSavedLayout(layout: unknown): void {
  savedLayout = layout;
}

export function getSavedLayout(): unknown {
  return savedLayout;
}

export function isValidLayout(x: unknown): x is { version: 1; tiles: unknown[] } {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as { version?: unknown }).version === 1 &&
    Array.isArray((x as { tiles?: unknown }).tiles)
  );
}

/** Download the last-saved layout as a JSON file. Returns false when no layout
 *  has been received yet. */
export function downloadSavedLayout(doc: Document): boolean {
  if (!savedLayout) return false;
  const blob = new Blob([JSON.stringify(savedLayout, null, 2)], { type: 'application/json' });
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = LAYOUT_EXPORT_FILENAME;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

/** Open a file picker; parse + validate the chosen file and hand the layout to
 *  `onLayout`. Invalid or unparseable files are logged and dropped. */
export function pickLayoutFile(doc: Document, onLayout: (layout: unknown) => void): void {
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidLayout(parsed)) onLayout(parsed);
        else console.warn('[Pixel Agents] import: invalid layout file');
      } catch {
        console.warn('[Pixel Agents] import: unparseable layout file');
      }
    });
  };
  input.click();
}
