# One button scale: Shaper surfaces before and after

Every Shaper button sits on one scale: sm 28px, md 34px (the default) and lg 42px, with an 8px radius and a 1px border.
Hover tints the background and does not lift the button. Under a coarse pointer, every button is at least 40px tall.
`npm run verify:feature-page -- --out DIR` writes these clips: 1280px wide, scale 1.

| Surface | Before, light | After, light | Before, dark | After, dark |
|---|---|---|---|---|
| Feature page | ![feature, before, light](before-feature-light.png) | ![feature, after, light](after-feature-light.png) | ![feature, before, dark](before-feature-dark.png) | ![feature, after, dark](after-feature-dark.png) |
| Run page slice line | ![slice-line, before, light](before-slice-line-light.png) | ![slice-line, after, light](after-slice-line-light.png) | ![slice-line, before, dark](before-slice-line-dark.png) | ![slice-line, after, dark](after-slice-line-dark.png) |
| Gate | ![gate, before, light](before-gate-light.png) | ![gate, after, light](after-gate-light.png) | ![gate, before, dark](before-gate-dark.png) | ![gate, after, dark](after-gate-dark.png) |
| Recovery | ![recovery, before, light](before-recovery-light.png) | ![recovery, after, light](after-recovery-light.png) | ![recovery, before, dark](before-recovery-dark.png) | ![recovery, after, dark](after-recovery-dark.png) |
| Clarify questions | ![clarify, before, light](before-clarify-light.png) | ![clarify, after, light](after-clarify-light.png) | ![clarify, before, dark](before-clarify-dark.png) | ![clarify, after, dark](after-clarify-dark.png) |
| Plan approval | ![plan, before, light](before-plan-light.png) | ![plan, after, light](after-plan-light.png) | ![plan, before, dark](before-plan-dark.png) | ![plan, after, dark](after-plan-dark.png) |
| Outline approval | ![outline, before, light](before-outline-light.png) | ![outline, after, light](after-outline-light.png) | ![outline, before, dark](before-outline-dark.png) | ![outline, after, dark](after-outline-dark.png) |

## Every other view on the same three heights

Every main view draws its buttons at 28, 34 or 42px, with at most one 42px button per view: Start run on New run and the PR button on the run page.
`npm run verify:buttons -- --out DIR --prefix before|after` writes these: 1280×900 viewport, scale 1.

| View | Before, light | After, light | Before, dark | After, dark |
|---|---|---|---|---|
| Chat home | ![chat-home, before, light](views/before-chat-home-light.png) | ![chat-home, after, light](views/after-chat-home-light.png) | ![chat-home, before, dark](views/before-chat-home-dark.png) | ![chat-home, after, dark](views/after-chat-home-dark.png) |
| Chat run card | ![chat-run-card, before, light](views/before-chat-run-card-light.png) | ![chat-run-card, after, light](views/after-chat-run-card-light.png) | ![chat-run-card, before, dark](views/before-chat-run-card-dark.png) | ![chat-run-card, after, dark](views/after-chat-run-card-dark.png) |
| Live run page | ![run-live, before, light](views/before-run-live-light.png) | ![run-live, after, light](views/after-run-live-light.png) | ![run-live, before, dark](views/before-run-live-dark.png) | ![run-live, after, dark](views/after-run-live-dark.png) |
| Saved run page | ![run-saved, before, light](views/before-run-saved-light.png) | ![run-saved, after, light](views/after-run-saved-light.png) | ![run-saved, before, dark](views/before-run-saved-dark.png) | ![run-saved, after, dark](views/after-run-saved-dark.png) |
| Runs list | ![runs, before, light](views/before-runs-light.png) | ![runs, after, light](views/after-runs-light.png) | ![runs, before, dark](views/before-runs-dark.png) | ![runs, after, dark](views/after-runs-dark.png) |
| New run | ![new, before, light](views/before-new-light.png) | ![new, after, light](views/after-new-light.png) | ![new, before, dark](views/before-new-dark.png) | ![new, after, dark](views/after-new-dark.png) |
| Schedules | ![schedules, before, light](views/before-schedules-light.png) | ![schedules, after, light](views/after-schedules-light.png) | ![schedules, before, dark](views/before-schedules-dark.png) | ![schedules, after, dark](views/after-schedules-dark.png) |
| Projects | ![projects, before, light](views/before-projects-light.png) | ![projects, after, light](views/after-projects-light.png) | ![projects, before, dark](views/before-projects-dark.png) | ![projects, after, dark](views/after-projects-dark.png) |
| Models | ![models, before, light](views/before-models-light.png) | ![models, after, light](views/after-models-light.png) | ![models, before, dark](views/before-models-dark.png) | ![models, after, dark](views/after-models-dark.png) |
| Statistics | ![stats, before, light](views/before-stats-light.png) | ![stats, after, light](views/after-stats-light.png) | ![stats, before, dark](views/before-stats-dark.png) | ![stats, after, dark](views/after-stats-dark.png) |
| Settings | ![settings, before, light](views/before-settings-light.png) | ![settings, after, light](views/after-settings-light.png) | ![settings, before, dark](views/before-settings-dark.png) | ![settings, after, dark](views/after-settings-dark.png) |
| Stop dialog | ![dialog, before, light](views/before-dialog-light.png) | ![dialog, after, light](views/after-dialog-light.png) | ![dialog, before, dark](views/before-dialog-dark.png) | ![dialog, after, dark](views/after-dialog-dark.png) |
