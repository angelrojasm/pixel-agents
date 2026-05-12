/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_STEPS } from '../constants.js';

/** Compute a default zoom level snapped to the nearest ZOOM_STEPS value. */
export function defaultZoom(): number {
  const raw = Math.round(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1));
  // Snap to nearest ZOOM_STEPS value.
  let best: number = ZOOM_STEPS[0];
  let bestDelta = Math.abs(raw - best);
  for (const z of ZOOM_STEPS) {
    const d = Math.abs(raw - z);
    if (d < bestDelta) {
      best = z;
      bestDelta = d;
    }
  }
  return best;
}
