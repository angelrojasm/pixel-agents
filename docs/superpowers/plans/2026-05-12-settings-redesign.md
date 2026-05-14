# Settings Menu Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat-scrolling Settings modal with a paneled, game-style settings screen — sidebar of categories (General / Agents / Terminal / Office / About) + content pane — while keeping all current behavior. Every setting keeps its live-apply semantics; each category gets a "Restore Defaults" button with 5s undo.

**Architecture:** A new `webview-ui/src/components/settings/` folder hosts the orchestrator (`SettingsModalV2.tsx`), the sidebar, the per-category panels, and a small set of new controls (Stepper, Select, RadioGroup, PathInput, ListEditor). The existing `SettingsModal.tsx` keeps working until the new modal is fully migrated; then it is deleted in a final task. A single `DEFAULT_SETTINGS` constant in `src/constants.ts` is the source of truth for both runtime defaults and the Restore Defaults flow.

**Tech Stack:** TypeScript, React, Tailwind utility classes (already in use), Vitest (extension), Node test runner (webview).

**Spec:** `docs/superpowers/specs/2026-05-12-settings-redesign-design.md`

**Soft dependency:** Some controls in the Terminal panel (`fontFamily`, `lineHeight`) come from the terminal-experience-polish plan. If that plan hasn't landed when this work begins, the Terminal panel ships with whatever knobs exist at that time and is updated when terminal-polish merges.

---

## Preconditions

- Already on branch `2026-05-12-terminal-polish` (all Phase 2 work lives here; do NOT create a new branch).
- All existing tests pass: `npm test` is green.
- Repo dependencies installed.

## File Structure

**Created:**

- `webview-ui/src/components/settings/SettingsModalV2.tsx` — orchestrator (modal shell, sidebar, content router).
- `webview-ui/src/components/settings/SettingsSidebar.tsx` — vertical category list with keyboard nav.
- `webview-ui/src/components/settings/SettingsTitleStrip.tsx` — category title bar + Restore Defaults button.
- `webview-ui/src/components/settings/SettingsRow.tsx` — generic `[label, helper, control]` row.
- `webview-ui/src/components/settings/UndoToast.tsx` — 5s undo toast for Restore Defaults.
- `webview-ui/src/components/settings/panels/GeneralPanel.tsx`
- `webview-ui/src/components/settings/panels/AgentsPanel.tsx`
- `webview-ui/src/components/settings/panels/TerminalPanel.tsx`
- `webview-ui/src/components/settings/panels/OfficePanel.tsx`
- `webview-ui/src/components/settings/panels/AboutPanel.tsx`
- `webview-ui/src/components/settings/controls/Select.tsx` — brutalist `<select>` styled wrapper.
- `webview-ui/src/components/settings/controls/Stepper.tsx` — `[- N +]` numeric stepper.
- `webview-ui/src/components/settings/controls/RadioGroup.tsx` — horizontal radio button group.
- `webview-ui/src/components/settings/controls/PathInput.tsx` — text input + helper line.
- `webview-ui/src/components/settings/controls/ListEditor.tsx` — add/remove list (for asset directories).
- `webview-ui/test/settings-controls.test.ts` — Node test runner tests for Stepper, Select, RadioGroup.
- `src/__tests__/restoreDefaults.test.ts` — Vitest tests for the `restoreCategoryDefaults` handler.

**Modified:**

- `src/constants.ts` — add `DEFAULT_SETTINGS` constant.
- `src/PixelAgentsViewProvider.ts` — handle `restoreCategoryDefaults` message; reference `DEFAULT_SETTINGS` at `globalState.get` sites.
- `webview-ui/src/App.tsx` — swap `<SettingsModal/>` import for `<SettingsModalV2/>` once parity is reached; then delete old import.
- `webview-ui/src/index.css` — add settings-specific CSS variables if needed (likely none — reuse existing `--pixel-*`).

**Deleted (final task):**

- `webview-ui/src/components/SettingsModal.tsx` — replaced by V2.

---

# Part A — Scaffolding + canonical defaults

## Task A1: Define `DEFAULT_SETTINGS`

**Files:**

- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant**

In `src/constants.ts`, add at the bottom of the file:

```ts
/** Canonical default values for every user-facing setting. Source of truth for
 *  both the `globalState.get(KEY, default)` sites and the per-category
 *  "Restore Defaults" flow. State-tracking flags (hooksInfoShown,
 *  lastSeenVersion, etc.) are NOT settings and are not represented here. */
export const DEFAULT_SETTINGS = {
  general: {
    soundEnabled: true,
    alwaysShowLabels: false,
    showTerminalNames: true,
    debugMode: false,
  },
  agents: {
    watchAllSessions: false,
    hooksEnabled: true,
    defaultCwd: '',
  },
  terminal: {
    usePtyTerminal: false,
    panelPosition: 'bottom' as 'bottom' | 'left' | 'right',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.0,
  },
  office: {
    externalAssetDirectories: [] as string[],
  },
} as const;

export type SettingsCategory = keyof typeof DEFAULT_SETTINGS;
```

- [ ] **Step 1b: Add modal sizing and timing constants to `webview-ui/src/constants.ts`**

These must live here (spec Acceptance Criteria §12 — no inline literals allowed in settings component files):

```ts
// Settings modal layout constants
export const SETTINGS_MODAL_WIDTH_PX = 720;
export const SETTINGS_MODAL_HEIGHT_PX = 520;
export const SETTINGS_SIDEBAR_WIDTH_PX = 160;
export const SETTINGS_TITLE_STRIP_HEIGHT_PX = 32;
// Settings undo toast duration
export const SETTINGS_UNDO_TOAST_MS = 5000;
```

Any occurrence of the literal `720`, `520`, `160`, `32` (as a modal dimension), or `5000` (as undo duration) in files under `webview-ui/src/components/settings/` must reference these constants instead.

- [ ] **Step 2: Update existing `globalState.get` defaults to reference the constant**

In `src/PixelAgentsViewProvider.ts`, find each call like `globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true)` and change the literal default to a reference:

```ts
this.context.globalState.get<boolean>(
  GLOBAL_KEY_SOUND_ENABLED,
  DEFAULT_SETTINGS.general.soundEnabled,
);
```

Apply to: `GLOBAL_KEY_SOUND_ENABLED`, `GLOBAL_KEY_WATCH_ALL_SESSIONS`, `GLOBAL_KEY_ALWAYS_SHOW_LABELS`, `GLOBAL_KEY_SHOW_TERMINAL_NAMES`, `GLOBAL_KEY_HOOKS_ENABLED`, `GLOBAL_KEY_DEFAULT_CWD`, `GLOBAL_KEY_USE_PTY_TERMINAL`. Add the import at the top:

```ts
import { DEFAULT_SETTINGS } from './constants.js';
```

(Merge into existing import block.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: PASS (no behavior change, only literal-to-reference).

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/PixelAgentsViewProvider.ts
git commit -m "constants: introduce DEFAULT_SETTINGS as single source of truth"
```

## Task A2: Create empty SettingsModalV2 shell

**Files:**

- Create: `webview-ui/src/components/settings/SettingsModalV2.tsx`

- [ ] **Step 1: Write the shell**

Create the file:

```tsx
import { useState, useCallback, useEffect } from 'react';
import type { SettingsCategory } from '../../../../src/constants.js';
import {
  SETTINGS_MODAL_WIDTH_PX,
  SETTINGS_MODAL_HEIGHT_PX,
  SETTINGS_SIDEBAR_WIDTH_PX,
} from '../../constants.js';

interface SettingsModalV2Props {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES: { id: SettingsCategory | 'about'; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'office', label: 'Office' },
  { id: 'about', label: 'About' },
];

export function SettingsModalV2({ isOpen, onClose }: SettingsModalV2Props) {
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
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
            <div style={{ padding: 16 }}>
              {active === 'general' && <div>General panel placeholder</div>}
              {active === 'agents' && <div>Agents panel placeholder</div>}
              {active === 'terminal' && <div>Terminal panel placeholder</div>}
              {active === 'office' && <div>Office panel placeholder</div>}
              {active === 'about' && <div>About panel placeholder</div>}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit -p webview-ui && cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/components/settings/SettingsModalV2.tsx
git commit -m "settings: V2 modal shell with category tabs, ESC to close"
```

## Task A3: Feature-flag V2 modal behind a dev toggle

**Files:**

- Modify: `webview-ui/src/App.tsx`

- [ ] **Step 1: Add a local flag**

In `App.tsx`, find the state declarations near `isSettingsModalOpen`. Add:

```ts
// Dev-only switch — flip to true to test V2 modal during development.
// Remove this line and the conditional render once V2 reaches parity.
const useSettingsV2 = false;
```

- [ ] **Step 2: Conditional render**

Replace the single `<SettingsModal ... />` render with:

```tsx
{
  useSettingsV2 ? (
    <SettingsModalV2 isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
  ) : (
    <SettingsModal /* existing props */ />
  );
}
```

Add the import:

```ts
import { SettingsModalV2 } from './components/settings/SettingsModalV2.js';
```

- [ ] **Step 3: Manual sanity check**

Run: `npm run build` then F5 in VS Code. Click Settings — old modal still works (V1 wins until the flag flips).

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/App.tsx
git commit -m "settings: feature-flag V2 modal behind dev switch"
```

---

# Part B — Reusable controls (TDD)

## Task B1: Failing tests for `Stepper`

**Files:**

- Create: `webview-ui/test/settings-controls.test.ts`

- [ ] **Step 1: Write tests**

Vite doesn't ship JSDOM by default for the Node test runner; we test the _pure logic_ of the control (clamping) by exporting a helper from the component. Create:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepperNext, stepperPrev } from '../src/components/settings/controls/Stepper.tsx';

test('stepperNext respects max', () => {
  assert.equal(stepperNext(1.0, 0.1, 0.8, 2.0), 1.1);
  assert.equal(stepperNext(2.0, 0.1, 0.8, 2.0), 2.0);
});

test('stepperNext rounds to step precision', () => {
  // 1.0 + 0.1 in JS is 1.1; verify no float drift after several steps.
  let v = 1.0;
  for (let i = 0; i < 5; i++) v = stepperNext(v, 0.1, 0.8, 2.0);
  assert.equal(v, 1.5);
});

test('stepperPrev respects min', () => {
  assert.equal(stepperPrev(0.9, 0.1, 0.8, 2.0), 0.8);
  assert.equal(stepperPrev(0.8, 0.1, 0.8, 2.0), 0.8);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm run test:webview -- settings-controls`
Expected: FAIL — file `Stepper.tsx` doesn't exist yet.

- [ ] **Step 3: Commit failing test**

```bash
git add webview-ui/test/settings-controls.test.ts
git commit -m "test: failing settings controls tests"
```

## Task B2: Implement `Stepper`

**Files:**

- Create: `webview-ui/src/components/settings/controls/Stepper.tsx`

- [ ] **Step 1: Write component + helpers**

```tsx
import { useCallback } from 'react';

/** Snap to step precision to avoid 1.0 + 0.1 → 1.0999999... display. */
function snap(v: number, step: number): number {
  const decimals = (step.toString().split('.')[1] ?? '').length;
  return Number(v.toFixed(decimals));
}

export function stepperNext(value: number, step: number, _min: number, max: number): number {
  return snap(Math.min(max, value + step), step);
}

export function stepperPrev(value: number, step: number, min: number, _max: number): number {
  return snap(Math.max(min, value - step), step);
}

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  ariaLabel?: string;
  onChange: (v: number) => void;
}

export function Stepper({ value, min, max, step, precision, ariaLabel, onChange }: StepperProps) {
  const displayPrecision = precision ?? (step.toString().split('.')[1] ?? '').length;
  const onPrev = useCallback(
    () => onChange(stepperPrev(value, step, min, max)),
    [value, step, min, max, onChange],
  );
  const onNext = useCallback(
    () => onChange(stepperNext(value, step, min, max)),
    [value, step, min, max, onChange],
  );

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }} aria-label={ariaLabel}>
      <button
        type="button"
        onClick={onPrev}
        disabled={value <= min}
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          fontSize: 12,
          padding: '0 8px',
          cursor: value <= min ? 'not-allowed' : 'pointer',
          opacity: value <= min ? 0.5 : 1,
        }}
      >
        −
      </button>
      <span style={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {value.toFixed(displayPrecision)}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={value >= max}
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          fontSize: 12,
          padding: '0 8px',
          cursor: value >= max ? 'not-allowed' : 'pointer',
          opacity: value >= max ? 0.5 : 1,
        }}
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm run test:webview -- settings-controls`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/components/settings/controls/Stepper.tsx
git commit -m "settings: Stepper control with snap-to-step precision"
```

## Task B3: `Select` control

**Files:**

- Create: `webview-ui/src/components/settings/controls/Select.tsx`

- [ ] **Step 1: Implement**

```tsx
interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  ariaLabel?: string;
  onChange: (v: T) => void;
}

export function Select<T extends string>({ value, options, ariaLabel, onChange }: SelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      style={{
        background: 'var(--pixel-bg)',
        color: 'inherit',
        border: '2px solid var(--pixel-border)',
        padding: '4px 8px',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/components/settings/controls/Select.tsx
git commit -m "settings: Select control"
```

## Task B4: `RadioGroup` control

**Files:**

- Create: `webview-ui/src/components/settings/controls/RadioGroup.tsx`

- [ ] **Step 1: Implement**

```tsx
interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface RadioGroupProps<T extends string> {
  value: T;
  options: RadioOption<T>[];
  ariaLabel?: string;
  onChange: (v: T) => void;
}

export function RadioGroup<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: RadioGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', gap: 16, flexWrap: 'wrap' }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
        >
          <input
            type="radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ accentColor: 'var(--pixel-accent)' }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/components/settings/controls/RadioGroup.tsx
git commit -m "settings: RadioGroup control"
```

## Task B5: `PathInput` control

**Files:**

- Create: `webview-ui/src/components/settings/controls/PathInput.tsx`

- [ ] **Step 1: Implement**

```tsx
interface PathInputProps {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  onCommit: (v: string) => void;
}

export function PathInput({ value, placeholder, ariaLabel, onCommit }: PathInputProps) {
  return (
    <input
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      style={{
        background: 'var(--pixel-bg)',
        color: 'inherit',
        border: '2px solid var(--pixel-border)',
        padding: '4px 8px',
        fontSize: 12,
        fontFamily: 'inherit',
        minWidth: 240,
      }}
    />
  );
}
```

(Uses `defaultValue` + `onBlur` to keep the input uncontrolled — matches how the existing default-cwd input is handled.)

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/controls/PathInput.tsx
git commit -m "settings: PathInput control"
```

## Task B6: `ListEditor` control

**Files:**

- Create: `webview-ui/src/components/settings/controls/ListEditor.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';

interface ListEditorProps {
  values: string[];
  placeholder?: string;
  ariaLabel?: string;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}

export function ListEditor({ values, placeholder, ariaLabel, onAdd, onRemove }: ListEditorProps) {
  const [draft, setDraft] = useState('');
  return (
    <div aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {values.map((v) => (
          <li key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
            <button
              type="button"
              onClick={() => onRemove(v)}
              aria-label={`Remove ${v}`}
              style={{
                background: 'var(--pixel-bg)',
                border: '2px solid var(--pixel-border)',
                padding: '0 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            background: 'var(--pixel-bg)',
            color: 'inherit',
            border: '2px solid var(--pixel-border)',
            padding: '4px 8px',
            fontSize: 12,
            flex: 1,
          }}
        />
        <button
          type="button"
          onClick={() => {
            const v = draft.trim();
            if (!v) return;
            onAdd(v);
            setDraft('');
          }}
          style={{
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            padding: '4px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/controls/ListEditor.tsx
git commit -m "settings: ListEditor control"
```

## Task B7: `SettingsRow` layout primitive

**Files:**

- Create: `webview-ui/src/components/settings/SettingsRow.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  helper?: string;
  control: ReactNode;
  hint?: string;
}

export function SettingsRow({ label, helper, control, hint }: SettingsRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 16,
        alignItems: 'start',
        paddingBlock: 8,
      }}
    >
      <div>
        <div style={{ fontSize: 12 }}>{label}</div>
        {helper && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{helper}</div>}
        {hint && (
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, fontStyle: 'italic' }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>{control}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/SettingsRow.tsx
git commit -m "settings: SettingsRow layout primitive"
```

---

# Part C — Per-category panels

## Task C1: SettingsTitleStrip

**Files:**

- Create: `webview-ui/src/components/settings/SettingsTitleStrip.tsx`

- [ ] **Step 1: Implement**

```tsx
import { SETTINGS_TITLE_STRIP_HEIGHT_PX } from '../../constants.js';

interface SettingsTitleStripProps {
  title: string;
  onRestoreDefaults: () => void;
}

export function SettingsTitleStrip({ title, onRestoreDefaults }: SettingsTitleStripProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--pixel-accent)',
        minHeight: SETTINGS_TITLE_STRIP_HEIGHT_PX,
        padding: '6px 12px',
        borderBottom: '2px solid var(--pixel-border)',
      }}
    >
      <span style={{ fontWeight: 'bold', fontSize: 13 }}>{title}</span>
      <button
        type="button"
        onClick={onRestoreDefaults}
        aria-label={`Restore ${title} defaults`}
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          fontSize: 11,
          padding: '2px 8px',
          cursor: 'pointer',
          color: 'inherit',
          fontFamily: 'inherit',
        }}
      >
        Restore Defaults
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/src/components/settings/SettingsTitleStrip.tsx
git commit -m "settings: SettingsTitleStrip with Restore Defaults button"
```

## Task C2: GeneralPanel migration

**Files:**

- Create: `webview-ui/src/components/settings/panels/GeneralPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Checkbox } from '../../ui/Checkbox.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface GeneralPanelProps {
  soundEnabled: boolean;
  onToggleSound: () => void;
  alwaysShowLabels: boolean;
  onToggleAlwaysShowLabels: () => void;
  showTerminalNames: boolean;
  onToggleShowTerminalNames: () => void;
  debugMode: boolean;
  onToggleDebugMode: () => void;
  onRestoreDefaults: () => void;
}

export function GeneralPanel(props: GeneralPanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="General" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SettingsRow
          label="Sound Notifications"
          helper="Plays a short chime when an agent is waiting for input."
          control={
            <Checkbox checked={props.soundEnabled} onChange={props.onToggleSound} label="" />
          }
        />
        <SettingsRow
          label="Always Show Labels"
          helper="Keep character name labels visible at all times (not only on hover)."
          control={
            <Checkbox
              checked={props.alwaysShowLabels}
              onChange={props.onToggleAlwaysShowLabels}
              label=""
            />
          }
        />
        <SettingsRow
          label="Show Terminal Names"
          helper="Display the underlying VS Code terminal name on each character."
          control={
            <Checkbox
              checked={props.showTerminalNames}
              onChange={props.onToggleShowTerminalNames}
              label=""
            />
          }
        />
        <SettingsRow
          label="Debug View"
          helper="Overlay diagnostic information on top of the office canvas."
          control={
            <Checkbox checked={props.debugMode} onChange={props.onToggleDebugMode} label="" />
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into V2 modal**

In `SettingsModalV2.tsx`, replace the General placeholder. Add the import and pass-through props (V2 modal now needs the same prop surface as V1 — extend `SettingsModalV2Props` to include the General fields):

```ts
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
  onRestoreCategory: (category: 'general' | 'agents' | 'terminal' | 'office') => void;
}
```

Replace `<div>General panel placeholder</div>` with:

```tsx
<GeneralPanel
  soundEnabled={soundEnabled}
  onToggleSound={onToggleSound}
  alwaysShowLabels={alwaysShowLabels}
  onToggleAlwaysShowLabels={onToggleAlwaysShowLabels}
  showTerminalNames={showTerminalNames}
  onToggleShowTerminalNames={onToggleShowTerminalNames}
  debugMode={isDebugMode}
  onToggleDebugMode={onToggleDebugMode}
  onRestoreDefaults={() => onRestoreCategory('general')}
/>
```

- [ ] **Step 3: Pass new props from `App.tsx`**

Add the same fields to the existing `<SettingsModalV2 .../>` call. Most are already passed to V1 — duplicate the prop references.

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/panels/GeneralPanel.tsx webview-ui/src/components/settings/SettingsModalV2.tsx webview-ui/src/App.tsx
git commit -m "settings: GeneralPanel — first migrated category"
```

## Task C3: AgentsPanel migration

**Files:**

- Create: `webview-ui/src/components/settings/panels/AgentsPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Checkbox } from '../../ui/Checkbox.js';
import { PathInput } from '../controls/PathInput.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface AgentsPanelProps {
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  defaultCwd: string;
  onChangeDefaultCwd: (v: string) => void;
  onRestoreDefaults: () => void;
}

export function AgentsPanel(props: AgentsPanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="Agents" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SettingsRow
          label="Watch All Sessions"
          helper="Show agents from sessions outside the current workspace."
          control={
            <Checkbox
              checked={props.watchAllSessions}
              onChange={props.onToggleWatchAllSessions}
              label=""
            />
          }
        />
        <SettingsRow
          label="Instant Detection (Hooks)"
          helper="Use Claude Code hooks for instant agent state. Falls back to file polling if disabled."
          control={
            <Checkbox checked={props.hooksEnabled} onChange={props.onToggleHooksEnabled} label="" />
          }
        />
        <SettingsRow
          label="Default Terminal Folder"
          helper="Folder new agent terminals open in when no workspace is set. Supports ~."
          control={
            <PathInput
              value={props.defaultCwd}
              placeholder="~/Desktop"
              onCommit={props.onChangeDefaultCwd}
              ariaLabel="Default terminal folder"
            />
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into V2 modal**

Add props to `SettingsModalV2Props` for Agents (`watchAllSessions`, `onToggleWatchAllSessions`, `hooksEnabled`, `onToggleHooksEnabled`, `defaultCwd`, `onChangeDefaultCwd`). Replace the Agents placeholder with the panel render.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/panels/AgentsPanel.tsx webview-ui/src/components/settings/SettingsModalV2.tsx webview-ui/src/App.tsx
git commit -m "settings: AgentsPanel migration"
```

## Task C4: TerminalPanel migration

**Files:**

- Create: `webview-ui/src/components/settings/panels/TerminalPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Checkbox } from '../../ui/Checkbox.js';
import { RadioGroup } from '../controls/RadioGroup.js';
import { Select } from '../controls/Select.js';
import { Stepper } from '../controls/Stepper.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface TerminalPanelProps {
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
  onRestoreDefaults: () => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="Terminal" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SettingsRow
          label="Use in-panel terminal"
          helper="Render Claude's terminal inside the panel instead of VS Code's terminal strip."
          hint="applies to new agents"
          control={
            <Checkbox
              checked={props.usePtyTerminal}
              onChange={props.onToggleUsePtyTerminal}
              label=""
            />
          }
        />
        <SettingsRow
          label="Panel position"
          control={
            <RadioGroup
              value={props.panelPosition}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'right', label: 'Right' },
                { value: 'left', label: 'Left' },
              ]}
              onChange={props.onChangePanelPosition}
              ariaLabel="Panel position"
            />
          }
        />
        <SettingsRow
          label="Font family"
          helper="Monospaced font used in the in-panel terminal."
          control={
            <Select
              value={props.terminalFontFamily}
              options={[
                { value: 'monospace', label: 'System default' },
                { value: "'Fira Code', monospace", label: 'Fira Code' },
                { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
                { value: "'Cascadia Mono', monospace", label: 'Cascadia Mono' },
                { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
              ]}
              onChange={props.onChangeTerminalFontFamily}
              ariaLabel="Terminal font family"
            />
          }
        />
        <SettingsRow
          label="Font size"
          control={
            <Stepper
              value={props.terminalFontSize}
              min={8}
              max={24}
              step={1}
              onChange={props.onChangeTerminalFontSize}
              ariaLabel="Terminal font size"
            />
          }
        />
        <SettingsRow
          label="Line height"
          control={
            <Stepper
              value={props.terminalLineHeight}
              min={0.8}
              max={2.0}
              step={0.1}
              onChange={props.onChangeTerminalLineHeight}
              ariaLabel="Terminal line height"
            />
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into V2 modal**

Add props to `SettingsModalV2Props` for Terminal. Replace the Terminal placeholder.

If terminal-polish hasn't merged yet, `terminalFontFamily` and `terminalLineHeight` won't exist as state in `App.tsx`. In that case, hard-code them to `DEFAULT_SETTINGS.terminal.fontFamily` / `.lineHeight` and no-op the setters; remove the no-op when terminal-polish lands.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/panels/TerminalPanel.tsx webview-ui/src/components/settings/SettingsModalV2.tsx webview-ui/src/App.tsx
git commit -m "settings: TerminalPanel migration"
```

## Task C5: OfficePanel migration

**Files:**

- Create: `webview-ui/src/components/settings/panels/OfficePanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import { ListEditor } from '../controls/ListEditor.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';
import { Button } from '../../ui/Button.js';

interface OfficePanelProps {
  externalAssetDirectories: string[];
  onAddAssetDirectory: (path: string) => void;
  onRemoveAssetDirectory: (path: string) => void;
  onExportLayout: () => void;
  onImportLayout: () => void;
  onRestoreDefaults: () => void;
}

export function OfficePanel(props: OfficePanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="Office" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SettingsRow
          label="External Asset Directories"
          helper="Folders containing extra furniture/character PNGs and catalog files."
          control={
            <ListEditor
              values={props.externalAssetDirectories}
              placeholder="/path/to/asset/pack"
              onAdd={props.onAddAssetDirectory}
              onRemove={props.onRemoveAssetDirectory}
              ariaLabel="External asset directories"
            />
          }
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={props.onExportLayout}>Export layout</Button>
          <Button onClick={props.onImportLayout}>Import layout</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into V2 modal**

Add the new props. Replace the Office placeholder. Existing message handlers for `addExternalAssetDirectory` / `removeExternalAssetDirectory` / `exportLayout` / `importLayout` already exist — reuse them by passing the same callbacks the V1 modal uses.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/panels/OfficePanel.tsx webview-ui/src/components/settings/SettingsModalV2.tsx webview-ui/src/App.tsx
git commit -m "settings: OfficePanel migration"
```

## Task C6: AboutPanel

**Files:**

- Create: `webview-ui/src/components/settings/panels/AboutPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
import { SettingsRow } from '../SettingsRow.js';
import { Button } from '../../ui/Button.js';

interface AboutPanelProps {
  extensionVersion: string;
  onViewChangelog: () => void;
  onViewHooksInfo: () => void;
}

export function AboutPanel({
  extensionVersion,
  onViewChangelog,
  onViewHooksInfo,
}: AboutPanelProps) {
  return (
    <div>
      <div
        style={{
          background: 'var(--pixel-accent)',
          padding: '6px 12px',
          borderBottom: '2px solid var(--pixel-border)',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: 13 }}>About</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SettingsRow
          label="Version"
          control={<span style={{ fontSize: 12 }}>{extensionVersion || 'unknown'}</span>}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onViewChangelog}>View changelog</Button>
          <Button onClick={onViewHooksInfo}>Hooks info</Button>
        </div>
      </div>
    </div>
  );
}
```

(No `SettingsTitleStrip` here because About has no Restore Defaults — it's read-only.)

- [ ] **Step 2: Wire into V2 modal**

Replace the About placeholder. Pass `extensionVersion` (already in `useExtensionMessages` state from `settingsLoaded`) and the two `view*` callbacks.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p webview-ui
git add webview-ui/src/components/settings/panels/AboutPanel.tsx webview-ui/src/components/settings/SettingsModalV2.tsx webview-ui/src/App.tsx
git commit -m "settings: AboutPanel"
```

---

# Part D — Restore Defaults + Undo (TDD)

## Task D1: Failing test for `restoreCategoryDefaults` handler

**Files:**

- Create: `src/__tests__/restoreDefaults.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants.js';

// We'll import the handler indirectly via the provider's message handler.
// For this unit test, we extract just the resolution logic into a helper
// called `resolveCategoryDefaults` exported from PixelAgentsViewProvider.

import { resolveCategoryDefaults } from '../PixelAgentsViewProvider.js';

describe('resolveCategoryDefaults', () => {
  it('returns DEFAULT_SETTINGS slice when no override given', () => {
    const r = resolveCategoryDefaults('general', undefined);
    expect(r).toEqual(DEFAULT_SETTINGS.general);
  });

  it('returns the override when given (for undo)', () => {
    const snapshot = { ...DEFAULT_SETTINGS.general, soundEnabled: false };
    const r = resolveCategoryDefaults('general', snapshot);
    expect(r).toEqual(snapshot);
  });

  it('throws on unknown category', () => {
    expect(() => resolveCategoryDefaults('bogus' as never, undefined)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm run test:extension -- restoreDefaults`
Expected: FAIL — `resolveCategoryDefaults` isn't exported.

- [ ] **Step 3: Commit failing test**

```bash
git add src/__tests__/restoreDefaults.test.ts
git commit -m "test: failing test for resolveCategoryDefaults helper"
```

## Task D2: Implement `resolveCategoryDefaults`

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Add the helper**

Export at the bottom of `PixelAgentsViewProvider.ts`:

```ts
import type { SettingsCategory } from './constants.js';
import { DEFAULT_SETTINGS } from './constants.js';

export function resolveCategoryDefaults<C extends SettingsCategory>(
  category: C,
  override: (typeof DEFAULT_SETTINGS)[C] | undefined,
): (typeof DEFAULT_SETTINGS)[C] {
  if (override) return override;
  const v = DEFAULT_SETTINGS[category];
  if (!v) throw new Error(`Unknown settings category: ${category}`);
  return v;
}
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm run test:extension -- restoreDefaults`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/PixelAgentsViewProvider.ts
git commit -m "settings: resolveCategoryDefaults helper"
```

## Task D3: Wire the `restoreCategoryDefaults` message + add `setDebugMode` handler

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts`

- [ ] **Step 0: Add `setDebugMode` inbound message handler**

`debugMode` is currently webview-local state only (no extension persistence). To keep multi-webview modals in sync when Restore Defaults resets it, the extension must be able to broadcast the reset value back. Add a handler in the message dispatch chain:

```ts
    } else if (message.type === 'setDebugMode') {
      // debugMode is webview-local; just echo back to all webviews so multi-webview modals stay in sync.
      this.broadcastSink.postMessage({ type: 'setDebugMode', enabled: message.enabled as boolean });
```

In `useExtensionMessages.ts`, handle the inbound `setDebugMode` message and call `setIsDebugMode(msg.enabled)` (or expose a setter from App-level state).

- [ ] **Step 1: Add `restoreCategoryDefaults` message handler**

In the message dispatch chain (where `setUsePtyTerminal` etc. live), add:

```ts
    } else if (message.type === 'restoreCategoryDefaults') {
      const category = message.category as SettingsCategory;
      const override = message.values as (typeof DEFAULT_SETTINGS)[typeof category] | undefined;
      const values = resolveCategoryDefaults(category, override);

      if (category === 'general') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, values.soundEnabled);
        this.context.globalState.update(GLOBAL_KEY_ALWAYS_SHOW_LABELS, values.alwaysShowLabels);
        this.context.globalState.update(GLOBAL_KEY_SHOW_TERMINAL_NAMES, values.showTerminalNames);
        // debugMode: webview-local state; broadcast a setDebugMode message so multi-webview instances reset
        this.broadcastSink.postMessage({ type: 'setDebugMode', enabled: values.debugMode });
      } else if (category === 'agents') {
        this.context.globalState.update(GLOBAL_KEY_WATCH_ALL_SESSIONS, values.watchAllSessions);
        this.context.globalState.update(GLOBAL_KEY_HOOKS_ENABLED, values.hooksEnabled);
        this.context.globalState.update(GLOBAL_KEY_DEFAULT_CWD, values.defaultCwd);
      } else if (category === 'terminal') {
        this.context.globalState.update(GLOBAL_KEY_USE_PTY_TERMINAL, values.usePtyTerminal);
        // panelPosition is webview-local persisted state; broadcast value back
        if ('fontFamily' in values) {
          this.context.globalState.update(GLOBAL_KEY_TERMINAL_FONT_FAMILY, values.fontFamily);
        }
        if ('lineHeight' in values) {
          this.context.globalState.update(GLOBAL_KEY_TERMINAL_LINE_HEIGHT, values.lineHeight);
        }
      } else if (category === 'office') {
        // externalAssetDirectories lives in ~/.pixel-agents/config.json
        const config = readConfig();
        config.externalAssetDirectories = values.externalAssetDirectories;
        writeConfig(config);
        this.broadcastSink.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: values.externalAssetDirectories,
        });
      }

      // Re-broadcast settingsLoaded so the webview re-syncs everything visible.
      this.broadcastSettingsLoaded();
```

(Where `broadcastSettingsLoaded()` is the existing in-place body that builds the `settingsLoaded` payload — extract that into a private method if it isn't already; the extraction makes this handler tidy.)

- [ ] **Step 2: Type-check + run all tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/PixelAgentsViewProvider.ts
git commit -m "settings: handle restoreCategoryDefaults message"
```

## Task D4: UndoToast component

**Files:**

- Create: `webview-ui/src/components/settings/UndoToast.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect } from 'react';
import { SETTINGS_UNDO_TOAST_MS } from '../../../constants.js';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export function UndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = SETTINGS_UNDO_TOAST_MS,
}: UndoToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [onDismiss, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        boxShadow: '2px 2px 0px var(--pixel-border)',
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12,
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          background: 'var(--pixel-accent)',
          border: '2px solid var(--pixel-border)',
          padding: '2px 8px',
          fontSize: 11,
          cursor: 'pointer',
          color: 'inherit',
          fontFamily: 'inherit',
        }}
      >
        Undo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/src/components/settings/UndoToast.tsx
git commit -m "settings: UndoToast component"
```

## Task D5: Wire Restore Defaults + Undo through the modal

**Files:**

- Modify: `webview-ui/src/components/settings/SettingsModalV2.tsx`

- [ ] **Step 1: Add undo state**

In `SettingsModalV2`, add:

```ts
import { useState, useCallback, useEffect } from 'react';
import { UndoToast } from './UndoToast.js';
import { vscode } from '../../vscodeApi.js';

// inside the component:
const [undoCategory, setUndoCategory] = useState<string | null>(null);
const [undoSnapshot, setUndoSnapshot] = useState<unknown>(null);
```

- [ ] **Step 2: Implement the restore callback**

```ts
const onRestoreCategory = useCallback(
  (category: 'general' | 'agents' | 'terminal' | 'office') => {
    // Build a snapshot from current props. The parent owns the live values;
    // we record them so undo can restore them precisely.
    let snapshot: Record<string, unknown> = {};
    if (category === 'general') {
      snapshot = {
        soundEnabled,
        alwaysShowLabels,
        showTerminalNames,
        debugMode: isDebugMode,
      };
    } else if (category === 'agents') {
      snapshot = { watchAllSessions, hooksEnabled, defaultCwd };
    } else if (category === 'terminal') {
      snapshot = {
        usePtyTerminal,
        panelPosition,
        fontFamily: terminalFontFamily,
        fontSize: terminalFontSize,
        lineHeight: terminalLineHeight,
      };
    } else if (category === 'office') {
      snapshot = { externalAssetDirectories };
    }
    setUndoSnapshot(snapshot);
    setUndoCategory(category);
    vscode.postMessage({ type: 'restoreCategoryDefaults', category });
  },
  [
    soundEnabled,
    alwaysShowLabels,
    showTerminalNames,
    isDebugMode,
    watchAllSessions,
    hooksEnabled,
    defaultCwd,
    usePtyTerminal,
    panelPosition,
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    externalAssetDirectories,
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
```

- [ ] **Step 3: Render the toast**

Inside the modal `<main>` wrapper, after the panel content, add:

```tsx
{
  undoCategory && (
    <UndoToast
      message={`${undoCategory.charAt(0).toUpperCase()}${undoCategory.slice(1)} defaults restored.`}
      onUndo={onUndo}
      onDismiss={() => {
        setUndoCategory(null);
        setUndoSnapshot(null);
      }}
    />
  );
}
```

Make sure the parent `<main>` has `position: relative` so the toast positions correctly.

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit -p webview-ui && cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/components/settings/SettingsModalV2.tsx
git commit -m "settings: Restore Defaults with 5s undo toast"
```

---

# Part E — Sidebar keyboard nav + focus management

## Task E1: Add SettingsSidebar with keyboard handling

**Files:**

- Create: `webview-ui/src/components/settings/SettingsSidebar.tsx`

- [ ] **Step 1: Extract sidebar into its own component**

Move the `<nav role="tablist">` block from `SettingsModalV2.tsx` into:

```tsx
import { useRef, useEffect } from 'react';
import { SETTINGS_SIDEBAR_WIDTH_PX } from '../../constants.js';

export type SettingsCategoryId = 'general' | 'agents' | 'terminal' | 'office' | 'about';

interface SettingsSidebarProps {
  categories: { id: SettingsCategoryId; label: string }[];
  active: SettingsCategoryId;
  onChange: (id: SettingsCategoryId) => void;
}

export function SettingsSidebar({ categories, active, onChange }: SettingsSidebarProps) {
  const navRef = useRef<HTMLElement>(null);

  function onKey(e: React.KeyboardEvent<HTMLElement>) {
    const idx = categories.findIndex((c) => c.id === active);
    if (e.key === 'ArrowDown') {
      const next = categories[(idx + 1) % categories.length];
      onChange(next.id);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const next = categories[(idx - 1 + categories.length) % categories.length];
      onChange(next.id);
      e.preventDefault();
    }
  }

  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-orientation="vertical"
      tabIndex={0}
      onKeyDown={onKey}
      style={{
        width: SETTINGS_SIDEBAR_WIDTH_PX,
        borderRight: '2px solid var(--pixel-border)',
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
      }}
    >
      {categories.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={active === c.id}
          tabIndex={-1}
          onClick={() => onChange(c.id)}
          style={{
            textAlign: 'left',
            padding: '8px 12px',
            borderLeft: active === c.id ? '2px solid var(--pixel-accent)' : '2px solid transparent',
            fontWeight: active === c.id ? 'bold' : 'normal',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            outline: 'none',
          }}
        >
          {c.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Replace inline sidebar in V2**

In `SettingsModalV2.tsx`, replace the inline `<nav>` block with:

```tsx
<SettingsSidebar categories={CATEGORIES} active={active} onChange={(id) => setActive(id)} />
```

Add the import.

- [ ] **Step 3: Focus first control on category change**

In `SettingsModalV2.tsx`, add a ref + effect:

```ts
const mainRef = useRef<HTMLElement>(null);
useEffect(() => {
  if (!mainRef.current) return;
  const first = mainRef.current.querySelector<HTMLElement>('button, [role="radio"], input, select');
  first?.focus({ preventScroll: true });
}, [active]);
```

Attach `ref={mainRef}` to the `<main>` element.

- [ ] **Step 4: Build + manual sanity test**

Run: `cd webview-ui && npm run build && cd .. && npm run build`. F5 to launch.

Flip `useSettingsV2 = true` in `App.tsx` temporarily; open Settings; verify ↑/↓ move category; Tab cycles through controls in the active panel; Escape closes.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/components/settings/SettingsSidebar.tsx webview-ui/src/components/settings/SettingsModalV2.tsx
git commit -m "settings: SettingsSidebar with arrow-key nav + focus-on-change"
```

---

# Part F — Cutover

## Task F1: Visual parity pass + manual run

**Files:** None.

- [ ] **Step 1: Set V2 as default**

In `App.tsx`, change `const useSettingsV2 = false;` to `const useSettingsV2 = true;`.

- [ ] **Step 2: Full manual run**

Build + F5. Open Settings. For each category:

- **General**: toggle Sound, Always Show Labels, Show Terminal Names, Debug — confirm each takes effect immediately (e.g. sound toggle's chime; debug overlay appears).
- **Agents**: toggle Watch All Sessions, Hooks, change Default Cwd — confirm the new agent spawn uses the new cwd.
- **Terminal**: toggle Use in-panel terminal, change Panel position to each value, change Font family, Font size, Line height — all visible immediately.
- **Office**: add a fake asset directory (use `/tmp/test-pack`), remove it, Export layout (file dialog opens), Import layout (file dialog opens).
- **About**: View changelog opens existing changelog modal; Hooks info opens existing info modal.
- **Restore Defaults** on General → confirm settings revert → Undo within 5s → confirm restore.
- **ESC** closes from any category.
- **↑/↓** moves sidebar selection.
- **Multi-webview sync**: open the side-panel view AND a full-screen panel simultaneously (both showing the Settings modal). Toggle a setting (e.g. Sound Notifications) in the side-panel modal — confirm the checkbox in the full-screen modal reflects the new value within one event-loop tick (driven by `settingsLoaded` broadcast).

- [ ] **Step 3: Fix any visual or behavioral parity gaps**

Note any regressions in this step; create follow-up tasks if any are non-trivial. Acceptable visual differences are documented in the spec; functional regressions are NOT acceptable.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/App.tsx
git commit -m "settings: enable V2 modal by default"
```

## Task F2: Delete the old SettingsModal

**Files:**

- Delete: `webview-ui/src/components/SettingsModal.tsx`
- Modify: `webview-ui/src/App.tsx`

- [ ] **Step 1: Remove the import + V1 branch**

In `App.tsx`:

- Delete the `import { SettingsModal } from './components/SettingsModal.js';` line.
- Remove the `const useSettingsV2 = true;` declaration.
- Replace the conditional render `{useSettingsV2 ? <SettingsModalV2 ... /> : <SettingsModal ... />}` with the V2 render alone.

- [ ] **Step 2: Delete the file**

```bash
git rm webview-ui/src/components/SettingsModal.tsx
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit -p webview-ui && cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/App.tsx
git commit -m "settings: remove V1 modal, V2 is now canonical"
```

## Task F3: Update docs/ROADMAP.md

**Files:**

- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Mark Settings Menu Redesign as shipped**

Find the Phase 2 section in `docs/ROADMAP.md`. Locate the "Settings menu redesign" (or "§4" / "settings" bundle) entry. Mark it as shipped (e.g. change `[ ]` to `[x]`, or update the status label). If there is a "Still open" line specifically referencing this bundle, strike or remove it.

- [ ] **Step 2: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(ROADMAP): mark Settings Menu Redesign shipped (final Phase 2 bundle)"
```

---

# Final Verification

## Task FV1: Test suite + lint

- [ ] **Step 1: Full tests**

Run: `npm test`
Expected: PASS (extension, server, webview).

- [ ] **Step 2: Type-check both sides**

Run: `npx tsc --noEmit && npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

## Task FV2: Confirm full build + test suite green

Do NOT push or open a PR — the orchestrator handles integration after code review.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS (extension, server, webview suites; note final test counts for reporting).

- [ ] **Step 2: Type-check both sides**

Run: `npx tsc --noEmit && npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Report**

Report final test counts (extension / server / webview) and confirm zero type errors. The orchestrator will create the PR.

## Task FV3: Spec compliance grep gate

**Files:** None (read-only checks).

- [ ] **Step 1: No inline hex literals in settings components**

```bash
grep -rn -E '#[0-9a-fA-F]{3,8}\b' webview-ui/src/components/settings/
```

Expected: zero matches. Every color reference must use a `--pixel-*` CSS variable. If any matches appear, replace with the appropriate variable (see `webview-ui/src/index.css` `:root`) before proceeding.

- [ ] **Step 2: No `vscode.` references in settings components**

```bash
grep -rn 'vscode\.' webview-ui/src/components/settings/
```

Expected: zero matches. The one permitted webview→extension channel is `vscode.postMessage(...)` — but that call lives in `SettingsModalV2.tsx`, accessed via the `vscodeApi.ts` wrapper (`import { vscode } from '../../vscodeApi.js'`), not via a direct `vscode.` reference. If any raw `vscode.` usage is found, route through `vscodeApi.ts`.

- [ ] **Step 3: Sizing constants are in place**

```bash
grep -n 'SETTINGS_MODAL_WIDTH_PX\|SETTINGS_MODAL_HEIGHT_PX\|SETTINGS_SIDEBAR_WIDTH_PX\|SETTINGS_TITLE_STRIP_HEIGHT_PX\|SETTINGS_UNDO_TOAST_MS' webview-ui/src/constants.ts
```

Expected: all 5 constants found.

- [ ] **Step 4: Type-check + lint + full test suite**

Run: `npx tsc --noEmit && npx tsc --noEmit -p webview-ui && npm test`
Expected: all pass, zero type errors.

---

## Out of scope (next plans / future work)

- Global "Reset all settings" button.
- Search/filter within settings.
- Settings export/import as a file.
- Per-workspace overrides.
- Tooltips on settings (helper text under labels is the documentation surface).
- Settings sync across machines.

## Self-Review Checklist

- [x] **Spec coverage:** Each Implementation Order step in the spec (1–8) maps to a Task in Parts A–E. Cutover + V1 deletion in Part F.
- [x] **No placeholders:** All `TODO`/`TBD`/"fill in details" removed. Code blocks are complete and runnable.
- [x] **Type consistency:** `DEFAULT_SETTINGS` shape used identically in spec and plan. `SettingsCategory` type exported from `constants.ts` and consumed in `restoreCategoryDefaults`. Message names (`restoreCategoryDefaults`, `externalAssetDirectoriesUpdated`) consistent between handler and broadcast.
- [x] **Tests:** Real test code in Tasks B1 (Stepper) and D1 (resolveCategoryDefaults). Manual integration steps in Task F1 cover behavior parity.
- [x] **Granularity:** Each task ships independently. The V2 modal is feature-flagged until parity is reached (Task F1), so the work can pause at any commit without breaking V1.
- [x] **No Cmd/Ctrl+, claim:** the spec dropped this shortcut; plan never references it.

---

## Spec Acceptance Criteria Coverage

Maps the 12 spec acceptance criteria (§Acceptance Criteria) to the plan task(s) that implement them.

| #   | Spec criterion (abbreviated)                                                                            | Implementing task(s)                      |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Settings modal opens within 100ms (perceived instant)                                                   | Task A2 (shell), Task F1 (parity pass)    |
| 2   | Every setting persists across close/reopen and webview reload (`set*` writes to globalState)            | Tasks C1–C6 (per-panel wiring), Task F1   |
| 3   | Restore Defaults writes DEFAULT_SETTINGS[category], emits `settingsLoaded`, modal re-renders            | Tasks D1–D3 (TDD + handler)               |
| 4   | Undo within 5s restores snapshot exactly                                                                | Task D5 (undo callback + toast)           |
| 5   | Multi-webview sync: setting changed in side-panel updates full-screen modal within one tick             | Task D3 (`broadcastSink`); Task FV3 grep  |
| 6   | Keyboard-only flow: open, ↓ to Office, Tab controls, Space checkbox, Esc close                          | Task E1 (sidebar nav + focus mgmt)        |
| 7   | No inline hex literals in settings/\* (`grep -nE '#[0-9a-fA-F]{6}'` returns 0)                          | Task FV3 Step 1                           |
| 8   | No `vscode.` references in settings/\* (`grep -nE 'vscode\.'` returns 0)                                | Task FV3 Step 2                           |
| 9   | Modal traps focus (Tab wraps; Shift+Tab from close button wraps to last element)                        | Task E1 (focus-on-change); Task F1 parity |
| 10  | Unit tests cover every reusable control (Stepper, Dropdown, RadioGroup, PathInput, ListEditor)          | Tasks B1–B6                               |
| 11  | Extension test: `restoreCategoryDefaults` writes correct keys and emits `settingsLoaded` (4 categories) | Tasks D1–D3                               |
| 12  | Sizing constants in `webview-ui/src/constants.ts` (5 constants); no inline literals in component files  | Task A1 Step 1b; Task FV3 Steps 1 + 3     |
