---
name: ux-review
description: Validate a Pixel Agents UX spec (docs/ux/*.md) for completeness, art-direction alignment, message-protocol correctness, and multi-webview safety. Outputs APPROVED / NEEDS REVISION / MAJOR REVISION verdict with specific gaps. Read-only.
when_to_use: After `/ux-design` writes a spec, before turning it into an implementation plan. Also when reviewing a spec authored a while back before starting work on it.
---

# UX Review — Pixel Agents

Validate a UX spec at `docs/ux/<name>.md`. Read-only — never edit the spec.

---

## Phase 1: Resolve target

Argument is either:

- A path (`docs/ux/settings-modal.md`) — review that one.
- `all` — Glob `docs/ux/*.md`, review each, and produce a summary table first.
- No argument — ask which file.

---

## Phase 2: Load reference docs

1. `docs/art-direction.md` — visual chrome rules (sharp corners, hard shadows, `--pixel-*` variables, pixel font). If missing, note gap; continue.
2. `CLAUDE.md` → `Extension ↔ Webview` — the shipping postMessage protocol (authoritative list of messages).
3. `CLAUDE.md` → `Office UI`, `Layout Editor`, `Full-screen panel`, `Phased Roadmap`.
4. `webview-ui/src/constants.ts` — centralized magic numbers.
5. The components the spec claims to touch — glance at them to sanity-check claims.

---

## Phase 3: Run the checklist

### Completeness (required sections)

- [ ] Header with Status, Last updated, Touches
- [ ] Purpose & User Need (stated from user perspective, not "the code does X")
- [ ] Entry & Exit (both directions, trigger + context)
- [ ] Layout & Information Hierarchy (primary/secondary/discoverable ranking)
- [ ] States & Variants (at least Default + one more)
- [ ] Interaction Map (input → feedback → outcome table)
- [ ] Keyboard / Mouse Behavior (shortcuts, Esc stage if applicable)
- [ ] Visual Chrome (cites art-direction rules)
- [ ] Messaging (extension ↔ webview table or "N/A — canvas-only overlay")
- [ ] Edge Cases (first-run, no-workspace, multi-webview, `/clear`)
- [ ] Acceptance Criteria (≥5 testable items)

### Quality

**Purpose & User Need**

- [ ] Written from user / maintainer perspective, not from implementation.
- [ ] States what goes wrong without this surface.

**Interaction Map coverage**

- [ ] Only mouse + keyboard are covered (no gamepad/touch assumptions).
- [ ] Every interactive element has a feedback row (not "does nothing visibly").
- [ ] Middle-mouse pan, right-click erase (edit mode) noted where applicable.

**Esc handling**

- [ ] If the surface is in edit mode, it participates in the 5-stage Esc cascade (furniture pick → deselect catalog → close tool tab → deselect furniture → close editor). Spec names its stage.
- [ ] Modals close on Esc.

**Visual chrome**

- [ ] No rule contradicts `docs/art-direction.md`.
- [ ] No inline hex literals in the spec (all colors via `--pixel-*` variables).
- [ ] Sharp corners, 2px borders, hard offset shadows explicitly honored.

**Messaging (Pixel Agents-specific — important)**

- [ ] Every ext → webview message listed is in the known protocol (or flagged as new).
- [ ] Every webview → ext message likewise.
- [ ] If the surface is stateful: multi-webview broadcast behavior is stated (both surfaces update via `MessageSink`, or explicitly one-only).
- [ ] If Phase 3-relevant: the spec works without VS Code APIs (the `MessageSink` abstraction survives a WebSocket swap).

**Constants discipline**

- [ ] No raw timings, pixel sizes, or thresholds in the spec — cites `constants.ts` by name.

**Persistence**

- [ ] If the surface reads or writes user state: spec names the storage (`globalState` key, `~/.pixel-agents/config.json`, `~/.pixel-agents/layout.json`).
- [ ] If writing to `layout.json`: the atomic-write + `markOwnWrite` cycle is acknowledged.

**Edge cases**

- [ ] First-run / no-workspace / multi-webview / `/clear` all addressed or explicitly marked N/A.
- [ ] For canvas overlays: behavior during matrix spawn/despawn (character is not hit-testable during despawn) is noted.
- [ ] For list-driven surfaces: empty state is documented.

**Acceptance criteria**

- [ ] ≥1 performance criterion (opens in Xms, renders Y fps).
- [ ] ≥1 persistence criterion (survives reload).
- [ ] ≥1 multi-webview criterion (if stateful).
- [ ] No criterion requires reading the spec to evaluate.

---

## Phase 4: Output the verdict

```markdown
## UX Review: <spec name>

**Date**: <date>
**File**: docs/ux/<name>.md

### Completeness: <X>/<Y> required sections

### Quality issues: <N>

1. **<issue title>** [BLOCKING / ADVISORY]
   - What's wrong: …
   - Where: section X
   - Fix: …

### Messaging protocol check

- New messages proposed: <list, or none>
- Unknown messages referenced: <list, or none>

### Multi-webview: <SAFE / UNSPECIFIED / INCONSISTENT>

### Constants discipline: <CLEAN / INLINE VALUES FOUND>

### Verdict: APPROVED | NEEDS REVISION | MAJOR REVISION NEEDED

Blocking: <N> — must resolve before implementation
Advisory: <N> — recommended
```

**Verdict rules:**

- **APPROVED**: 0 blocking. Spec is implementation-ready.
- **NEEDS REVISION**: 1–3 blocking. Surgical fixes, not a redesign.
- **MAJOR REVISION NEEDED**: 4+ blocking, OR any of { Purpose missing, Messaging contract wrong, Multi-webview behavior contradicts `MessageSink` model }.

---

## Phase 5: Next steps

- **APPROVED**: suggest `superpowers:writing-plans` to turn the spec into an implementation plan.
- **NEEDS REVISION**: suggest re-running `/ux-design` on the specific sections.
- **MAJOR REVISION NEEDED**: suggest `superpowers:brainstorming` to rethink the direction before re-drafting.

This skill never edits files and never blocks the user — the verdict is advisory. Document risks, let the maintainer choose.

---

## Project adaptations

- Dropped accessibility-tier references, localization checks, GDD UI Requirements cross-refs — not applicable.
- Added first-class Messaging protocol check — references the authoritative list in `CLAUDE.md`.
- Added Multi-webview safety check (side-panel + full-screen coexist via `MessageSink`).
- Added Constants discipline check (the project centralizes all magic numbers).
- Added Phase 3 readiness check (does the spec survive a VS Code → WebSocket swap?).
- Removed team/agent delegation; single maintainer runs the review directly.
