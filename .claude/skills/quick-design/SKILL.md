---
name: quick-design
description: Lightweight design note for small Pixel Agents changes — a constants tweak, a single-rule behavior change, a small addition that doesn't warrant a full UX spec. Produces a short markdown note you can reference in a commit or plan.
when_to_use: Before tuning a timing constant (animation speed, poll interval, bubble fade), before a 1-rule behavior change (e.g. "Esc also closes tooltips"), before a small addition (new keyboard shortcut, new tiny overlay). If the change affects a whole surface, use `/ux-design` instead.
---

# Quick Design — Pixel Agents

For small, low-risk changes that still deserve a written rationale. Output: `docs/quick-specs/<kebab>-<date>.md`.

Rule of thumb: if the change is under ~2 hours of work AND affects at most one file's behavior meaningfully, this is the right skill. If it touches multiple surfaces, use `/ux-design`. If it invents a new system, use `superpowers:brainstorming`.

---

## Phase 1: Classify

Based on the argument, pick one:

- **Tuning** — change a constant / threshold in `webview-ui/src/constants.ts`, `src/constants.ts`, or `server/src/constants.ts`. No behavior change beyond the new value.
  Examples: "bump `TEXT_IDLE_DELAY_MS` to 6s", "slow typing animation from 120ms to 150ms", "raise `PNG_ALPHA_THRESHOLD`".

- **Tweak** — a single-rule behavior change to an existing surface with no new state.
  Examples: "right-click in select tool does nothing (currently errors)", "waiting bubble fades after 1.5s instead of 2s", "agent click also focuses terminal when already selected".

- **Addition** — a tiny new capability, no new subsystem.
  Examples: "add `Cmd+B` shortcut to toggle toolbar", "add a 'reset camera' button next to zoom controls", "show agent count in bottom toolbar".

If the change doesn't fit — new surface, new message, cross-cutting — stop and redirect to `/ux-design` (surface-scoped) or `superpowers:brainstorming` (exploration).

Present the classification, confirm before drafting.

---

## Phase 2: Context scan

Read the affected area:

- For **Tuning**: the constants file + any direct consumer. Grep the old value to find every reference.
- For **Tweak**: the component + its tests (`webview-ui/src/__tests__/`, `server/__tests__/` where relevant).
- For **Addition**: the component where the new thing lives + relevant constants.
- Always: `CLAUDE.md` to check whether the change contradicts documented behavior.
- For UI changes: `docs/art-direction.md` if present.

Report what you found in one line: `"Found <X> in <file>. No conflicting specs. Touches <Y> consumers."`

---

## Phase 3: Draft the spec

### Tuning template

```markdown
# Quick Design: <title>

**Type**: Tuning
**File**: `<path/to/constants.ts>`
**Date**: <date>

## Change

| Constant        | Old  | New  | Rationale |
| --------------- | ---- | ---- | --------- |
| `CONSTANT_NAME` | 5000 | 7000 | <why>     |

## Consumers (grep results)

- `file.ts:123` — <how it's used, does the change affect it?>

## CLAUDE.md impact

- <"No change needed" | "Update section X to reflect new timing">

## Acceptance

- [ ] Constant value updated in canonical location only
- [ ] Observable behavior changes in <specific scenario>
- [ ] No regression in <related scenario>
- [ ] If timing: matches user perception (confirm via dogfood or playtest)
```

### Tweak / Addition template

```markdown
# Quick Design: <title>

**Type**: Tweak | Addition
**Surface**: `<component or path>`
**Date**: <date>

## Change summary

<1–2 sentences: what changes, why>

## Current behavior

<quote the rule from CLAUDE.md or describe from the code>

## New behavior

<precise, unambiguous — a dev should implement this without asking>

## Affected files

- `<file>` — <what changes>
- `<file>` — <what changes>

## Messaging impact

<New / changed postMessage? If yes, declare it here. Otherwise "None">

## Multi-webview impact

<Does this behave consistently in side-panel + full-screen? If stateful, state the sync story. Otherwise "N/A">

## Persistence impact

<Does this read/write globalState / workspaceState / config.json / layout.json? If yes, name the key/file>

## CLAUDE.md impact

<"No change needed" | "Update section X">

## Acceptance

- [ ] <specific testable 1>
- [ ] <specific testable 2>
- [ ] <no regression: rule the old behavior protected>
- [ ] <art-direction compliance if visual>
```

---

## Phase 4: Approval + write

Show the draft. Ask: "Write to `docs/quick-specs/<kebab-title>-<date>.md`?"

If yes, create `docs/quick-specs/` if missing, then write.

**If CLAUDE.md needs updating** (flagged in the spec), ask separately:

"The spec changes a rule documented in `CLAUDE.md` → section <name>. Want me to show the diff and update it too?"

Show old → new text. Get explicit approval before editing `CLAUDE.md`.

---

## Phase 5: Handoff

```
Quick Design written: docs/quick-specs/<filename>.md
Type: Tuning | Tweak | Addition
CLAUDE.md update: pending | applied | not needed

Next:
- Implement directly (1-liner) OR
- superpowers:test-driven-development if test coverage expected OR
- superpowers:writing-plans if >1 file touched
```

---

## Redirect cases

Stop and redirect if you discover:

- The change adds a new message to the ext ↔ webview protocol → use `/ux-design` instead.
- The change affects both side-panel and full-screen sync in non-trivial ways → `/ux-design`.
- The change invents a new persistence key or file → `superpowers:brainstorming` first.
- The change exceeds ~2 hours or touches >3 files → `/ux-design` or `superpowers:writing-plans`.

---

## Project adaptations

- Dropped balance / formulas / tuning-knob categories — not applicable to a non-game.
- Replaced `assets/data/*.json` tuning with `constants.ts` files (extension, server, webview).
- Added Pixel Agents-specific impact rows: Messaging, Multi-webview, Persistence.
- Added CLAUDE.md-sync step — in a solo project, the memory doc is load-bearing.
- Output path is `docs/quick-specs/` not `design/quick-specs/`.
- Removed GDD reference requirements — there are no GDDs here.
