# Quick Design: Settings modal font legibility

**Type**: Tweak
**Surface**: `webview-ui/src/components/settings/*` (one surface; mechanical size sweep)
**Date**: 2026-08-16

## Change summary

Settings text is hard to read: FS Pixel Sans is a pixel-grid font that degrades
badly below ~14px, and the settings UI hard-codes inline `fontSize: 10–13`.
Raise all settings text to grid-friendly sizes via three centralized constants.
(Dogfood feedback 2026-08-16: "up the font on the settings because I can't
really read what they're trying to say".)

## Current behavior

Inline sizes: row labels 12, helpers 11, meta 10, controls (Select/Stepper/
PathInput/ListEditor) 12, title strip 13/11, About 13/12, undo toast 12/11,
close button 14. No constants; violates the centralize-constants rule.

## New behavior

Three constants in `webview-ui/src/constants.ts`:

| Constant                 | Value | Used for                                           |
| ------------------------ | ----- | -------------------------------------------------- |
| `SETTINGS_FONT_LABEL_PX` | 16    | row labels, section/title-strip titles, close ×    |
| `SETTINGS_FONT_BODY_PX`  | 14    | helpers, control text, About values, toast body    |
| `SETTINGS_FONT_META_PX`  | 12    | italic meta line, title-strip subtext, toast small |

Helper opacity 0.7 → 0.8. `SETTINGS_MODAL_HEIGHT_PX` 520 → 560 to absorb the
taller rows (panels already scroll).

## Affected files

- `webview-ui/src/constants.ts` — add 3 constants; bump modal height
- `settings/SettingsRow.tsx`, `SettingsTitleStrip.tsx`, `SettingsModalV2.tsx`,
  `UndoToast.tsx`, `panels/AboutPanel.tsx`,
  `controls/{Select,Stepper,PathInput,ListEditor}.tsx` — replace inline sizes

## Messaging impact

None.

## Multi-webview impact

N/A — pure presentation; identical in side panel, full-screen, and browser.

## Persistence impact

None.

## CLAUDE.md impact

No change needed (no documented sizes).

## Acceptance

- [ ] No inline `fontSize:` literals remain under `components/settings/`
- [ ] Labels/helpers legible at 100% zoom in the browser tab (dogfood confirm)
- [ ] Modal still fits: no clipped rows; panels scroll where needed
- [ ] Terminal Font size stepper (already existing) is readable and usable
