---
name: playtest-report
description: Structured template for recording a self-dogfooding session with Pixel Agents. Captures first impressions, friction points, bugs, feel issues, and prioritized follow-ups. Outputs a report at docs/playtests/<date>-<focus>.md.
when_to_use: After dogfooding a build for a real work session (writing code with Claude while watching agents), after trying a new feature end-to-end, after enabling hooks on a fresh machine, or when a release candidate is about to ship.
---

# Playtest Report — Pixel Agents

Pixel Agents is self-dogfooded — the maintainer uses it while working. This skill turns a use session into a structured report so observations don't get lost.

Two modes:

- `new` — output a blank template to fill in during/after the session.
- `analyze <path>` — read raw notes at `<path>` and turn them into the structured template.

No argument → ask.

---

## Phase 1: Template mode

Output this template (and offer to write it to `docs/playtests/<date>-<focus>.md`):

```markdown
# Playtest — <date> — <focus>

## Session info

- **Date**: <YYYY-MM-DD>
- **Build**: <git sha or version>
- **Duration**: <minutes>
- **Platform**: macOS / Windows / Linux
- **VS Code version**:
- **Context**: normal work session / targeted test of <feature>

## Setup

- Number of agents launched:
- Terminal count simultaneously open:
- Hooks enabled: yes / no
- Side-panel + full-screen both open? yes / no
- External asset packs loaded: <count or "bundled only">
- Layout: bundled default / custom

## First impressions (first 5 minutes)

- Did the office render as expected on launch?
- Did existing agents restore correctly?
- Any visual glitches at startup (missing sprites, wrong z-order, matrix-effect issues)?
- Emotional response: <delighted / neutral / annoyed / frustrated>

## What worked

- <observation>

## Friction points

| #   | Observation                                                                      | Severity | Repro? |
| --- | -------------------------------------------------------------------------------- | -------- | ------ |
| 1   | <e.g. "Settings modal closes when I click outside it but I was editing a field"> | M        | always |

## Bugs encountered

| #   | Description | Severity | Reproducible | Console errors? |
| --- | ----------- | -------- | ------------ | --------------- |

## Feel issues (non-bugs, subjective)

- Camera follow: <too snappy / too slow / right>
- Sprite sit offset: <looks correct / floating / clipping>
- Matrix spawn/despawn: <crisp / muddy / too long / too short>
- Bubble timings: <right / too fast / too slow>
- Notification chime: <on-brand / annoying / missed>

## Agent behavior

- Did work-seat vs rest-seat assignment match expectation?
- Did characters wander and claim rest seats after `wanderLimit`?
- Did sub-agents spawn at expected positions?
- Did `/clear` produce a new character (terminal adoption working)?
- Did hooks deliver instantly, or did you notice heuristic-mode fallbacks?

## Multi-webview behavior

- Side-panel and full-screen stayed in sync?
- Any surface that only updated on one?
- Was anything lost when closing/reopening the full-screen panel?

## Layout editor (if used)

- Which tools did you use?
- Did undo/redo behave?
- Did Esc stages work as expected?
- Did grid expansion feel discoverable?

## Performance

- Any dropped frames? During what action?
- Any noticeable extension-host lag? During what event?
- Memory seem reasonable over session length?

## Top 3 priorities from this session

1. <most impactful finding>
2. <next>
3. <next>
```

Ask: "Write this template to `docs/playtests/<date>-<focus>.md`?"

---

## Phase 2: Analyze mode

Read the raw notes file. Organize into the template. Flag observations that:

- Contradict behavior described in `CLAUDE.md` (these are bugs or a CLAUDE.md update is needed).
- Contradict `docs/art-direction.md` visual rules (these are polish gaps).
- Contradict `docs/ux/*.md` specs (these are UX compliance gaps).

---

## Phase 3: Categorize findings

Bucket each finding into one of:

- **Bug** — clear defect, reproducible → create a GitHub issue (or add to whatever tracker you use). Include console logs + repro steps.
- **Feel / polish** — subjective, non-blocking → add to a `docs/polish-backlog.md` list.
- **Design change** — the intended behavior in `CLAUDE.md` / a spec needs to change → update the doc first; then maybe fix the code.
- **Missing feature** — new capability needed → start a `superpowers:brainstorming` session.
- **Performance** — perceived or measured → hand off to `/perf-profile` for static analysis.
- **Doc drift** — `CLAUDE.md` doesn't match reality → fix the doc (solo project, docs are for future-you).

Present the categorized list to the user before closing.

---

## Phase 4: Save report

Ask: "Write to `docs/playtests/<date>-<focus>.md`?" Create the directory if needed.

---

## Phase 5: Next steps

Offer based on what surfaced:

- Bugs → file them (hand to `gh issue create` or the maintainer's tracker).
- Perf concerns → run `/perf-profile <scope>`.
- UX compliance gaps → run `/ux-review` on the relevant spec.
- Doc drift → patch `CLAUDE.md` or the relevant `docs/*.md`.
- Big design rethinks → `superpowers:brainstorming`.

---

## Project adaptations

- Replaced "tester role / QA / reporter" with single-maintainer dogfooding.
- Replaced generic game sections (first-5-min, pacing, difficulty) with Pixel Agents-specific ones (multi-webview sync, hooks vs heuristic, work/rest seats, `/clear` handling).
- Dropped `creative-director` gate and playtest/gate-check pipeline — no studio hierarchy.
- Output to `docs/playtests/` not `production/qa/playtests/`.
- Added "doc drift" as a finding category — solo project, `CLAUDE.md` accuracy matters.
- Dropped agent delegation; maintainer categorizes findings directly.
