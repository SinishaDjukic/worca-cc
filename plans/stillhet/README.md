# Stillhet

Stillhet is Worca's new design: classic's functions on one design system, every page built from the same parts. It is
behind the `stillhet` flag; with the flag off, Worca is classic, unchanged.

| What | Where | Says |
|---|---|---|
| The rules | [`docs/stillhet/`](../../docs/stillhet/README.md) | Each rule once: an id, one line, why, and what enforces it |
| The library | `ui/public/design-system/components/` | The components and shared logic every page calls (`docs/design-system-catalog.json` says which meets which need) |
| The gallery | [`prototype/components.html`](prototype/components.html) | Every component, drawn from the library's code |
| The prototype | [`prototype/index.html`](prototype/index.html) | The working design on demo data. Its page code is `ui/public/stillhet/` |
| The build spec | [`spec/`](spec/) | What a fresh, full build of the live app needs: gaps, lessons, wiring, server work, build order and the gate |
| What was removed | [`PRUNED.md`](PRUNED.md) | Every file this branch deleted, and why |

**To open the prototype:** `npm run stillhet -- --serve` builds it, serves the repository on `127.0.0.1:4610` (another port:
`--serve 4700`) and opens `http://127.0.0.1:4610/plans/stillhet/prototype/index.html`. `npm run stillhet` alone builds it and
opens the file directly, with no server.
`prototype/run-page.html` and `prototype/pulse.html` show the task page's and Pulse's cases one by one.

**Which wins.** The prototype is the design. A rule and the prototype agree; where they differ, the prototype wins and
the rule is corrected in the same change. A real conflict is a question for a person.

**To change the design:** the rule in `docs/stillhet/`, the catalog entry, the component, its test, its gallery example,
then the pages ([`docs/stillhet/build.md`](../../docs/stillhet/build.md)).

**To build the live app:** start at [`spec/`](spec/).

**Tests.** The tests that guard the design system and the flag pass:
`node --test test/design-system-*.test.mjs test/stillhet-docs.test.mjs test/stillhet-library-gate.test.mjs test/stillhet-default.test.mjs test/stillhet-look-options.test.mjs test/stillhet-state-contrast.test.mjs test/stillhet-css-fit.test.mjs test/run-page-model.test.mjs test/stillhet-boot.test.mjs test/stillhet.test.mjs test/flags-api.test.mjs test/ui-flags.test.mjs test/index-html.test.mjs`
and `node tools/test.mjs test/stillhet-flag-off.test.mjs test/ui-stillhet.test.mjs`. The host tests of the first live
wiring are not all settled: see [`PRUNED.md`](PRUNED.md), Tests not settled yet.

