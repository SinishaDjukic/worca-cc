# The gate

| Rule | What | Why | Held by |
|---|---|---|---|
| `gate.pages` | Every Rail page passes its sweeps in every case, at both widths, in both themes | A page is checked by running it | worca-sweep |
| `gate.controls` | Every control acts, or is disabled and says why | No dead controls | click-check |
| `gate.new-code` | New UI code that skips the library fails npm test; old pages shrink by a ratchet | The design system has force | rail-gate |
| `gate.docs` | Docs, catalog, library and gallery agree | One source, no drift | rail-docs |

Every Rail page passes its gate (`plans/rail/prototype/gates/run-page-sweep.mjs` for the run page, `gates/pulse-sweep.mjs` for Pulse) in every case, at 900 and 375px, in both themes: no sideways
scroll, no clipped text without a tooltip, no overlaps, every section on the text edge, contrast 4.5:1, every menu and
dialog inside the window, no page jump on any click, the top bar one row, one way back at a time (`‹ Settings` only
while the side menu is hidden); and every control does something. Every Rail page also passes
`plans/rail/prototype/gates/ds-check.mjs`: everything on it comes from the design system. A settings tab also passes its
alignment (`align-check.mjs`, in ds-check, at 900 and 400px): one left edge for every head, name and divider, one right
edge where every row's end stops (a quiet button by its text), and each row's name, sentence and end on one baseline.
The alignment is SettingsRow's and SettingsSection's, never a page's; `align-proof.mjs` shows the check catches each
fault.
