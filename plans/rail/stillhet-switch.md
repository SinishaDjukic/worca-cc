# The Stillhet switch as a top-bar icon, the toothed gear and the Pulse row mark

The owner decided on 2026-11-12 (`plans/rail/implementation-prompt.md`) that the "Stillhet UI" switch with its beta chip becomes
one 20px icon in the top bar's icon group, after Ask worca and Pulse. On 2026-11-14 they added two icon changes to the same
loop: the Settings gear (`gear`, `nav-settings`) reads as `sun` and becomes a real toothed gear, and the bolt on Pulse's
Updates and Limits rows becomes a smaller copy of the top-bar Pulse mark in the row's tone. This note holds the persona
review of the mock and the build plan for after the owner approves it.

- **The mock:** `plans/rail/prototype/stillhet-switch.html` (cases `closed`, `tip`, `menu`, `locked`, `icons`; `?on=0`,
  `?theme=dark`, `?w=360`, `?open=1`). Run `npm run stillhet:build` once first: the page loads the generated `components.js`.
- **The PNGs** (`plans/rail/mocks/`): `stillhet-switch-menu-light-1280`, `-menu-dark-1280`, `-menu-light-360`,
  `-menu-dark-360`, `-menu-off-light-1280`, `-tip-light-1280`, `-locked-light-1280`, `-icons-light-1280`,
  `-icons-dark-1280`. The `-360` shots are 500px wide: headless Chrome never opens narrower, so the page is pinned to 360px
  and the 140px strip on its right is blank by design.

## Persona review

Each persona walked the PNGs and the open page. A challenge ends in what changed in the mock, or why it did not.

### New user

- **Challenge:** At 20px the first glyph (a large circle resting on a short line) read as a person's head and shoulders, an account icon, not "a different UI". Changed: the sun is smaller and sits above a full-width horizon with a broken reflection under it, so it reads as a still sun on water; all 9 PNGs were re-shot.
- **Challenge:** "Try Stillhet" carries the check while Stillhet is already on; does "Try" read wrong once you are in it? Rejected: the two texts are the owner's acceptance, and the check plus the tip ("Worca's new calmer UI · beta") say which UI is current; the wording "Stillhet (on)" stays an open question for the owner.
- **Challenge:** Does the new gear say "Settings" at once, where today's gear looked like the weather? Rejected: no change needed; the 8 teeth around a hub ring are the common Settings gear, and in the `icons` panel it stands apart from `sun` at 20px and at 16px in the Pulse head.

### Daily user

- **Challenge:** Is going back to today's UI quick? Rejected: no change needed; it is one click on the icon and one pick, the same as the switch's one click plus a confirm-free reload, and the pick closes the menu at once.
- **Challenge:** Does the icon draw the eye on every page, against "only what needs you is lit"? Rejected: no change needed; it is grey (`ink-2`) like Ask worca and Pulse, carries no badge, chip or colour, and only its open state takes the hover fill.
- **Challenge:** Does the smaller Pulse mark on a Pulse row still say "an event" next to run marks, which carry a ring? Rejected: no change needed; the event mark has no ring, so the bare Pulse glyph in the row's tone reads apart from the ringed run marks, and it ties each row to the Pulse button it came from.

### UX reviewer against Rail

- **Challenge:** Does the icon's box match its neighbours (`nav.in-view`), not only its 20px glyph? Changed: the first shots drew it in the plain 32px `btn-sm` box with a 14px glyph from `.topnav-act svg`; the mock now gives it the same 36px box and 20px glyph as `#topnav-ask` and `.pz-pulse-b` (the rule the build adds to `shell.css`).
- **Challenge:** The menu showed no check on the current UI in the first shots. Changed: the mock's host now carries the `pz-app` scope, where CompactMenu's choice rows draw their check (`comp.menu`), as in Pulse's own menus.
- **Challenge:** At 360px, are the menu's rows at least 32px tall to tap? Rejected: the rows are CompactMenu's own height, the same in every Rail menu; a change belongs to the component (`comp.menu`), not to this icon. The menu fits inside the 360px page and its check stays legible.
- **Challenge:** Is the locked reason a third row? Rejected: no; both rows stay and are disabled, each with "Locked by WORCA_FLAGS" as its help, and the icon's tip adds the same words, so the menu keeps exactly 2 rows.
- **Challenge:** Do the gear and the Pulse row mark keep `look.one-icon` and the alert-ladder tones? Rejected: no change needed; the gear is one ink in every place, and each Pulse row mark keeps its row's tone (Updates `ask`/`idle`, Limits `fail`/`act`), as the `icons` PNGs show in both themes.

## Build after approval

Its own run, after the owner approves the mock, before the end of feature 3. Design first: rule, catalog, gallery, then live.

1. **Rules.** In `docs/rail/navigation.md` (`nav.design-switch`), replace the switch with the icon, its tip and its 2-row
   menu. Visibility does not change: the icon shows while `rail` is on (`frame.js`), and in today's app only when
   `status.stillhetAsk` (`mountDesignSwitch` in `ui/public/stillhet.mjs`). In `docs/rail/look.md`, record that the
   Settings gear is toothed and distinct from `sun`, and that an event row's mark is the Pulse glyph in the row's tone.
2. **Glyphs.** In `ui/public/design-system/components/icons.mjs`, add `stillhet-ui`, and redraw `gear` and `nav-settings`
   with the approved toothed gear. Callers use the names, so every Settings place follows: `pulse.js` (the Pulse head and
   Settings buttons), `run-state.mjs`, and the sidebar's `nav-settings`. Add the icon's 36px box and 20px glyph to
   `shell.css` beside `#topnav-ask` and `.pz-pulse-b`.
3. **Components.** A new component replaces `design-switch.mjs`. It keeps the `Locked by WORCA_FLAGS` reason and
   `aria-busy` while the call is out. Update the catalog (`docs/design-system-catalog.json`) for it and for the event mark,
   the gallery (`plans/rail/prototype/components.html`) with the new gear and row mark, and the test
   `test/design-system-design-switch.test.mjs`.
4. **Callers.**
   - `frame.js` draws the icon in place of `R.designSwitch`.
   - `host-app.js` replaces the `[data-design-switch]` click with the menu pick `Back to today's UI` →
     `host.setStillhet(false)`. It stays busy while the call is out and restores on failure.
   - `mountDesignSwitch` mounts the icon in today's app with the same gate and the same anchor (after Activity).
   - `pulse.js`'s Updates and Limits rows pass `icon: 'signal'` to their `kindMark({kind:'event'})`, keeping each row's tone.
5. **Tests to move.** `test/ui-stillhet.test.mjs` (mount once, busy, failure toast), the `test/stillhet-frame.test.mjs`
   golden, `test/stillhet-pulse-app-host.test.mjs` for the row mark, and `npm run stillhet:compare -- --parts design-switch`.
6. **Kept.** Settings › Labs keeps the `rail` row (`stillhetLabsRow`), `STILLHET_ASK_ON` stays `false`, and there is no
   migration. `test/stillhet-switch.test.mjs` keeps guarding both.

## Owner decision (2026-11-14)

Approved as shown: the sun-on-water Stillhet icon, the toothed gear and the Pulse row mark. The menu keeps "Try Stillhet" (checked while on) and "Back to today's UI". Build next, per the plan above.

## Open questions for the owner (answered above)

- The Stillhet glyph: is a still sun on water calm and clear enough beside `sun` and the new gear? Considered and set
  aside: a plain horizon line (too close to a minus), a half sun on the line (reads as sunrise, a weather mark), a leaf
  (says nothing about a UI).
- With Stillhet on, the menu checks `Try Stillhet` as the current UI. Should the checked row read "Stillhet (on)" instead?
