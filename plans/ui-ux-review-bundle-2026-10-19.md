# UI/UX review of the bundle — 2026-10-19

Reviewed on the bundle instance (`bundle/redesign-oct19` @ 5fc94958 = latest `dev` incl. Run Presets + Runs redesign
runs 1–4), port 4318, a copy of the real home, mock mode. Measured in the browser (button heights, radii, shadows,
bordered boxes, bar colours) on Chat, New run, Runs, run page, group page, Schedules, Workflows, Statistics, Settings;
light and dark; 1280px, ~560px and 375px. Not yet in the bundle: Shaper as chat cards, role reviews, redesign run 5.

Overall: the direction is right (4px corners, one button component, dividers, the run model). It still feels **boxy**,
and several controls sit **outside the size scale**. Most items below are the build not yet matching the agreed
design, plus a few new rules.

## A. Bugs (the build does not match the agreed design)

1. **Progress bars are blue** (`rgb(91,166,204)`, `--blue`) in the Runs list and on the run page. Spec §2.3: bars are
   neutral (the ink ramp; group bar `--ink-2`).
2. **Resting shadows** on `.gpage-card` (group page status card), `.rd-sheet` (run page status sheet), `.gs-pill`
   (Getting started) and `.tsearch-field` (top search). Spec §1.3: no resting shadows.
3. **Boxed tabs:** group page `.rd-tab` 43px filled/bordered, Settings tabs 55px boxed. Spec: underline tabs.
4. **The "Beta" flag chip renders as its own tab** in Settings (between Presets and Runs): `flags.mjs chip()` inserts
   the chip as a SIBLING of an interactive host, and in the tab bar it stretches to a full-height tinted box. Fix:
   inside a tab, render the chip within the label as a plain (non-link) chip.
5. **Off-scale sizes** (scale is 28 / 32 / 40):
   - every tab/segmented control is 36px: Chat home tabs, Schedules filters, Statistics ranges, New run
     Project/Workspace and Prompt/Markdown;
   - Workflows chips 26px, Workflows folders 44px, Schedules "Mark read" 26px, preset chips 31px;
   - Chat home quick-action tiles 78px (8 of them);
   - "i" info buttons 16px: below the 24px minimum touch target.
6. **Group page rows:** a bordered "Open" button on every row (in dark: bright white blocks that read as primary) and
   run titles as blue/violet underlined links. Spec: the row opens on click; titles in ink.
7. **Run page at mid width (~560px):** the stat boxes wrap "$40.05" over two lines and clip "−291". (Fine at 375 and
   1280.)
8. **Narrow New run:** a horizontal scrollbar appears under the Save-preset dialog at the narrow pane width.
9. **Unexpected jump:** right after a run finished and its page opened, the view jumped by itself to another group page
   (`#feature/…`) ~1.5 s later; not reproduced on a second load. Likely a "follow the newest / needs you" rule firing
   on the finish frame. Needs a look.

10. **Sidebar Runs count:** the amber **?** is drawn on top of the number (the icon overlaps "1" inside a tinted box).
   Spec: the count shows the **?** then the number, side by side (`? 1`, 12px icon, 4px gap, amber ink, no tinted box);
   `aria-label="1 needs you"`. Same in the collapsed sidebar (icon with the number as a small superscript).

11. **Selection on hover:** hovering a Runs row shows its checkbox, and the header holds a bare checkbox next to View.
   Spec §3.2 (updated 2026-10-19): no checkbox on hover; select with ⌘/Ctrl-click, Shift-click (range), long-press,
   or Select in the View menu / row ⋯; checkboxes and "☐ Select all" show only in selection mode; Esc/Cancel ends it.

12. **Who is challenging (role reviews), live:** the feature card shows only "Plan · role reviews". Show one row per
   role while reviewing (reviewing / no findings / 1 major / skipped) and "Refine · fixing N findings from …"
   (plans/shaper-role-review-design-spec.md §4a; mock board L).

13. **Group page run table order:** the state ("Ready to ship") sits in a middle column while PR, cost and Open sit
   right, so the row reads in no clear order. Spec §3.4 (2026-10-19): status line under the title on the left; PR chip,
   cost (tabular) and "›" right-aligned; the row is the click target (mock board F).

14. **Button labels too long:** "Continue with what you have" / "Approve another cycle" (cycle-limit gate). Labels are
   1–3 words, verb first; the card title says the situation. Use "Accept as is" (quiet) · "Run another cycle" (primary).
   Sweep every button for labels over 3 words ("Approve with 1 open issue" is the one allowed exception: the count is
   the point).

## B. Less boxy (new rule set, good-practice defaults)

1. **Borders only around what you act on** (inputs, buttons, the outermost chat card). Group everything else with
   spacing and headings.
2. **One border level per card:** nested cards (step card in the feature card, option boxes in a step card) use a tint,
   not another border.
3. **Sections, not cards:** Settings and the group page use heading → content → divider on one surface instead of a
   stack of bordered cards (Settings has a bordered card per section; Chat home shows 14 bordered boxes).
4. **Underline tabs everywhere** (Settings, group page, Chat home, Schedules, Statistics): text 13px, 2px ink
   underline on the selected one, 32px row.
5. **Segmented controls** (Appearance, Install, New run toggles, ranges): one container, the selected segment a filled
   background, no inner border; height 32 (28 in dense rows).
6. **Switches** keep a **pill track** (the one exception to 4px corners) with a round knob, 32×18; today the track is a
   4px rectangle, which reads as "a box with a ball".
7. **Quiet buttons inside rows and sections** (no border; tint on hover); bordered secondary only at the page level;
   one primary per view.
8. **Rows are the click target:** remove per-row "Open" buttons; a quiet "›" appears on hover; titles in ink, underline
   on hover only.
9. **Chips** filled, no border, 2px corners; the kind chip and flag chips the same component.
10. **Quick-action tiles** on the Chat home: 56–64px tall, icon + label on one line, no border (hover tint).

## C. Size

- **Corners (decided 2026-10-19):** controls 6px (`--r-sm`), cards/dialogs 8px (`--r-md`), chips 4px (`--r-xs`), chat
  composer 12px (`--r-lg`); switches pill; dots round (spec §1.1). Replace every hard-coded radius with the tokens.
- Smaller page headings: run/group page h1 from ~40px to **24px** (28px max), weight 700, letter-spacing −0.02em.
- Buttons in rows **28px**, page/dialog **32px**, one **40px** primary per view (Start run). Nothing else at 36/43/55.
- Body 13px, meta 12px; chips 11px.

## D. Run titles (too long)

A feature's runs are titled "Runs Redesign: One Model, New Visual Language · 5/5: Customer perspective: upgrade
safety, empty/offline/error states, notifications, scale, What's new" — five lines as a page heading.
1. **At the source:** a feature run's title is `Run 5 · <short slice title>`; the feature name lives in the
   "Part of … · run 5 of 5" row; the long description stays in the plan. Cap every generated title at ~60 characters
   (`src/core/title.mjs sanitizeTitle`), slice titles at ~40.
2. **On the page:** heading clamped to 2 lines with "…", full title in the tooltip; list rows already ellipsize on one
   line (keep).

## E. Beta vs Experimental (flags)

Keep the existing flag model (docs/feature-flags.md): **experimental** = off, switched on only in Settings ›
Experimental; **beta** = may default **on**, lives in its normal place with a small **Beta** chip; the Experimental
page lists every flag (experimental and beta) as the one switchboard, so a beta feature can still be turned off. No
separate tab or box for "Beta" (A4).

## F. Keep awake → beta, with a setting under Settings › Runs

Today: `keepAwake` is an **experimental** flag (off), shown only in Settings › Experimental; when on, the server holds
a sleep assertion while runs work (`createKeepAwake`, `ui/server.mjs:586`).
1. Move it to **beta**, **default on** on a local machine (no effect in containers/hosted deployments, as today's
   `deployment` check does).
2. Add a visible switch in **Settings › Runs**: "Keep the computer awake while runs are working" + Beta chip + one line
   ("The display may still turn off."). It is the same flag (one source): toggling here or in Experimental is the same
   value.
3. Docs: docs/feature-flags.md entry and the Settings help text.

## G. Run Presets — validated in the bundle

| Check | Result |
|---|---|
| Save current setup… on New run (name, scope Any project) | ✓ saved and selected |
| Reload, pick the preset → the form takes its choices (guardrails Permissive → Normal) | ✓ |
| Start a run from it → the run's `run_setup` carries the preset's choices | ✓ (`guardrailsId: normal`) |
| Chat home "Start from a preset" chip → opens New run with the preset applied, focus in the prompt | ✓ |
| Finished run page → **Save setup as preset** (scope defaults to the run's project) | ✓ saved "From finished run" |
| CLI `worca run --preset "Quick fix" --prompt …` | ✓ started through the server with the preset |
| Schedule from a preset (scheduled run keeps `preset_id`) | ✓ |
| Ask Worca proposes runs from presets | not tested (needs a real model) |
| Look: preset buttons on the one button component after the bundle merge | ✓ (`btn btn-sm`); chips 31px off-scale (A5) |

Minor: a preset saved on a `--mock` server records `mock: true` (it is a preset key by design); only matters for test
instances. Picking a project can switch the workflow to the project's default before saving — expected, but say so in
the Save dialog ("Saved: workflow Auto (this project's default) …").

## H. Order of work (for the next Shaper run)

1. A1–A9 (bugs), D (titles), E/A4 (beta chip), F (keep awake).
2. B + C (less boxy, sizes) as one visual pass, with the existing design-language scan extended: no control height
   outside 28/32/40 (+16→24 for info tips), no resting shadow, no boxed tabs, one border level per card.
3. Re-run this review on the bundle (same measurements) as the acceptance check.

## I. Click-through of the polished bundle (2026-10-19, after run cc0dbf65)

Fixed in the consistency run (bb24339a): chat card member rows match the group page table; one wording per
state ("Paused · interrupted", no "Paused:" form); "Save setup as preset" → "Save as preset"; "Add tags" as a
quiet button.

Out of scope for the bundle (already on dev, follow-up later):
- Preset cards show `wf_auto · claude` (workflow and engine ids) instead of names.
- Run page shows the branch name under the title in Simple mode, and a raw timestamp (`10/19/2026 6:40:29 AM`).
- Chat run card shows a short run id (`worka-cc · #daaccc40`).
- Schedules feed shows raw errors (`claude exited with code 1: …`) instead of a plain sentence with Details.
- Settings › Memory lists snapshot ids (`20261018-185521-run-fcca8fcb`) instead of date + run title.
- Settings › General shows a debug option ("Log claude spawn details…") outside Expert mode.
- Run page stat boxes and Results rows, and the chat card's Elapsed/Cost boxes, are still tinted boxes (B).
- A guard test that fails when a workflow id, engine id or raw run id reaches visible text.
