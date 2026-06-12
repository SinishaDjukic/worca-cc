# Help-mode prototype (W-061 alternative)

**Branch:** `prototype/W-061-help-mode-toggle`
**Status:** Prototype — for design evaluation, not for merge.
**Replaces:** the always-on inline `?` icon approach in `docs/plans/W-061-in-app-help-links.md`.

## What it does

A persistent **right-edge "Help" tab** (rotated label + `?` kbd hint) and the
**`?` keyboard shortcut** both toggle "help mode." When help mode is on, every
UI surface that registered a `helpFor(id)` call reveals a glowing primary-coloured
badge anchored to its top-right corner. Click the badge → opens the relevant
`docs.worca.dev` page in a new tab. `Escape` closes help mode.

When help mode is off, the UI is unchanged — zero baseline visual noise.

## Why prototype this instead of the inline-icon plan

The original W-061 plan placed ~22 always-on `?` icons across the UI (now
closer to ~30 after W-062 + W-063). That's defensible but visually heavy in
dense ops panels (dispatch governance, run-detail). This prototype tests
whether an opt-in reveal pattern works better.

Trade-off awareness (see also `.worca/analyses/issue-259.md`):
- **Win**: zero baseline noise; single discoverable affordance.
- **Loss**: two-click cost per lookup (toggle, then click); right-edge tabs
  carry "chat widget" association in users' muscle memory.
- **Novel**: this pattern is uncommon for ongoing docs discovery (it's the
  norm for one-shot product tours via Pendo/Appcues, less so for reference).

## Architecture

| File | Role |
|---|---|
| `app/utils/help-links.js` | Frozen `HELP_LINKS` registry (helpId → `{slug, title}`), `helpUrl(id)`, `helpFor(id)` lit-html template. |
| `app/utils/help-mode.js` | `isActive()` / `setActive()` / `toggle()` / `subscribe()`. Owns `body.help-mode-active`. Binds `?` and `Escape` globally with an input-focus guard. |
| `app/views/help-edge-tab.js` | The right-edge tab. Re-renders only when help-mode state flips (subscribed via `help-mode.subscribe`). Lives in its own fixed-position root outside the lit-html app, so route changes don't unmount it. |
| `app/styles.css` (appended block) | `.help-edge-tab` (rotated label, hover, active state), `.help-badge` (hidden until `body.help-mode-active`, absolute top-right of parent, glow pulse, `prefers-reduced-motion` fallback to static highlight), dark-mode tokens. |
| `app/main.js` | Bootstrap: mount the edge tab into `<div id="help-edge-tab-root">` appended to `<body>`, bind keyboard. |

## Instrumented surfaces — full UI sweep

After the initial 16-surface validation pass, the prototype was extended to cover every primary teaching surface across the UI. Total: **34 surfaces** across 14 view files, all mapping to existing pages under `docs-site/src/content/docs/`. The "one `?` per primary teaching surface" discipline rule still holds — no per-button / per-field placements.

### Settings (`settings.js`)

| Surface | helpId | Doc target |
|---|---|---|
| Global tab: Projects | `add-project` | getting-started/add-your-project |
| Global tab: Notifications | *(skip — no doc)* | — |
| Global tab: Preferences | `settings-overview` | configuration/settings-overview |
| Global tab: Integrations | `chat` | integrations/chat-integrations |
| Project tab: Models | `agents-models` | configuration/agents-and-models |
| Project tab: Pipeline | `stages-config` | configuration/stages |
| Project tab: Governance | `governance` | concepts/governance |
| Project tab: Pricing | *(skip — no doc)* | — |
| Project tab: Webhooks | `webhooks` | integrations/webhooks |
| Project tab: Graphify | `graphify` | advanced/knowledge-graph |
| Project tab: Code Review Graph | `crg` | advanced/code-review-graph |
| Inline anchor at `settings.js:96` | `configuration-precedence` (via `helpUrl`) | configuration/precedence |

### Run Detail (`run-detail.js`)

| Surface | helpId | Doc target |
|---|---|---|
| `.run-detail-overview` (lifecycle/run header) | `lifecycle` | concepts/lifecycle-and-state |
| `.stage-timeline` wrapper | `pipeline-stages` | concepts/the-pipeline-and-stages |
| `.plan-iter-selector` (plan revisions) | `plans-guides` | concepts/plans-work-requests-and-guides |
| `.dispatch-events-section` | `dispatch` | advanced/dispatch-governance |
| `.circuit-breaker-banner` (sl-alert) | `loops` | configuration/loops-and-circuit-breaker |
| `.agent-prompt-header` (sl-details summary) | `agent-prompt` | advanced/anatomy-of-an-agent-prompt |
| `.approval-panel` (sl-card PR approval) | `reviewing` | running-pipelines/reviewing-the-result |

### Pipeline Templates (`pipelines.js`, `pipelines-editor.js`)

| Surface | helpId | Doc target |
|---|---|---|
| Templates list page | `templates` | concepts/pipeline-templates |
| Template editor (subheader) | `authoring-templates` | advanced/authoring-templates |
| Editor tab: Agents | `agents-models` | configuration/agents-and-models |
| Editor tab: Pipeline | `stages-config` | configuration/stages |
| Editor tab: Governance | `dispatch` | advanced/dispatch-governance |
| Editor → Pipeline → CLAUDE.md load mode section | `claude-md-mode` | configuration/claude-md-mode |

### Run Timeline (`run-timeline.js`)

| Surface | helpId | Doc target |
|---|---|---|
| Timeline view container | `timeline-view` | running-pipelines/timeline-view |

### Launchers (`new-run.js`, `fleet-launcher.js`, `workspace-create.js`)

| Surface | helpId | Doc target |
|---|---|---|
| New Run form | `launching` | running-pipelines/launching-a-run |
| New Run → CLAUDE.md Mode dropdown | `claude-md-mode` | configuration/claude-md-mode |
| Fleet Launcher form (fleet mode) | `fleet-runs` | advanced/fleet-runs |
| Fleet Launcher form (workspace mode) | `workspace-runs` | advanced/workspace-runs |
| Workspace Create form | `workspace-runs` | advanced/workspace-runs |

### Dashboard + sidebar + integrations (`dashboard.js`, `sidebar.js`, `integrations.js`, `webhook-inbox.js`)

| Surface | helpId | Doc target |
|---|---|---|
| Dashboard view | `monitoring` | running-pipelines/monitoring-a-run |
| Sidebar Worktrees item | `worktrees` | advanced/worktree-cleanup |
| Integrations panel (settings tab body) | `chat` | integrations/chat-integrations |
| Webhook inbox view | `webhooks` | integrations/webhooks |

### Detail + edit + listing views (`fleet-detail.js`, `workspace-detail.js`, `workspace-edit.js`, `workspaces-config.js`, `worktrees.js`)

| Surface | helpId | Doc target |
|---|---|---|
| Fleet Detail page | `fleet-runs` | advanced/fleet-runs |
| Workspace Detail page | `workspace-runs` | advanced/workspace-runs |
| Workspace Edit form | `workspace-runs` | advanced/workspace-runs |
| Workspaces Config table | `workspace-runs` | advanced/workspace-runs |
| Worktrees page | `worktrees` | advanced/worktree-cleanup |

### Dedup rule (2026-06): the sidebar wins

Every sidebar item carries a badge, so **in-page badges that would lead to
the same doc page were removed**: the content-header `SECTION_HELP_IDS`
chokepoint (all its targets duplicated the sidebar), the page-root badges on
worktrees / fleet-detail / workspace-detail / workspace-edit /
workspaces-config / fleet-launcher / workspace-create, and the launcher's
template-picker badge. In-page badges remain only where the target differs
from the sidebar's (webhook inbox → `webhooks` vs sidebar `events`) or where
there is no sidebar equivalent (run-detail panels, settings tabs, timeline,
Access Map, Prompts tab, New Run).

### Panel additions (2026-06 sweep)

| Surface | helpId | Doc target |
|---|---|---|
| Run Detail → Access Map panel (`run-file-access.js`) | `access-map` | running-pipelines/access-map *(new registry entry)* |
| Pipelines editor → Prompts tab legend | `agent-prompt` + `custom-flows` | advanced/anatomy-of-an-agent-prompt + advanced/custom-pipeline-flows *(new registry entry)* |
| New Run → Pipeline section title | `templates` | concepts/pipeline-templates |
| Settings → Notifications tab | `events` | integrations/events-overview |
| Project Settings → Costs & Budgets tab | `costs-budgets` | configuration/costs-and-budgets *(new page + registry entry — the models page covers per-alias rates only and itself defers budgets to this tab)* |

### Sidebar (full coverage, 2026-06 follow-up)

Every sidebar item now carries a compact (20px) inline badge: Running →
`monitoring`, History → `reviewing`, Worktrees → `worktrees`, Fleets →
`fleet-runs`, Workspaces (runs + config) → `workspace-runs`, Beads →
`pipeline-stages`, Costs → `costs-budgets`, Webhooks → `events`, Project
Settings → `settings-overview`, Pipeline Templates → `templates`, Models →
`models`.

### Placement mechanics (2026-06 fix)

Inline contexts (`.content-header-title`, `.new-run-section-title`,
`.prompt-legend`, `.sidebar-item`, `sl-tab`) render the badge in normal flow
after the text with `position: relative` — NOT `static`: the ::after sonar
wave is absolutely positioned against the badge, and a static badge stops
being its containing block, ballooning the pulse over the whole host (the
"giant ellipse over the title" bug). The root-level floating badges on the
templates/dashboard pages were removed in favor of the header chokepoint.

### Surfaces deliberately uninstrumented

- `beads-panel.js`, `token-costs.js`, `learnings-panel.js`, `live-output.js`, `log-viewer.js` — no dedicated doc page yet; the skip-if-no-doc rule prevents `?` icons that would link to 404s or thin pages. (The beads/costs *sections* now carry header badges to the nearest concept pages; the per-run panels stay bare.)
- `settings-graphify.js`, `settings-code-review-graph.js` — covered transitively via the parent settings tabs.
- `dispatch-section.js`, `stage-timeline.js` — covered transitively via `run-detail.js`.
- `add-project-dialog.js` — dialog; help-mode activation is unlikely while modal-focused. Available as `add-project` helpId if desired later.
- `dag-graph.js`, `fleet-card.js`, `run-card.js`, `workspace-card.js`, `run-list.js`, `group-rendering.js`, `agent-names.js`, `dispatch-tag-state.js`, `launcher-shared.js`, `stage-tab-memory.js` — utility / card / shared components; not primary teaching surfaces.

### Registry coverage

All 34 placements map to entries already in `HELP_LINKS` (the registry was sized for ~25 ids during the initial prototype; the full UI sweep added zero new entries). Doc pages currently in the tree but unused by any UI surface (preserved in the registry for future use): `effort`, `secrets`, `controlling`, `first-run`, `events`. Doc pages not in the registry but available as future targets: adding-models, anatomy-of-an-agent-prompt (already used), authoring-templates (already used), overriding-agent-prompts, running-from-the-cli, guides, agents-models-and-effort, fleet-and-workspace-runs, installation, prerequisites, the four introduction/* pages, the four reference/* pages, and upgrading/upgrading.

## How to evaluate

1. `cd worca-ui && pnpm worca:ui:restart` (or `npm run build && pnpm worca:ui:restart`).
2. Look for the vertical **"Help (?)"** tab on the right edge of the viewport. It should be muted-neutral idle, primary when active.
3. Press `?` (Shift+/ on US keyboards) or click the edge tab.
4. Navigate to Settings → Pipeline Templates and watch every instrumented tab reveal a glowing badge in its top-right corner.
5. Open a run → Run Detail. Every panel header listed above should sprout a badge.
6. Click any badge → opens `docs.worca.dev/<slug>/` in a new tab.
7. Press `Escape` or click the edge tab again to close.
8. Test reduced-motion: enable "Reduce motion" in macOS System Settings → Accessibility → Display. Reload. Help mode should still reveal badges but with no pulse animation.

## Known limitations / things to evaluate

- **`:has()` selector dependency.** The CSS uses `body.help-mode-active *:has(> .help-badge)` to auto-`position: relative` any direct parent of a badge. Supported in Chrome 105+, Safari 15.4+, Firefox 121+. Older browsers will see the badge mis-position to the nearest positioned ancestor (degraded but not broken).
- **sl-tab badge placement.** Inside sl-tab label slots, the badge is nudged outward (`top: -6px; right: -6px`) so it sits at the tab's corner rather than overlapping the label text. Visually evaluate this on Settings tabs — it may need further tuning per Shoelace version.
- **No tests.** This is a prototype; if the pattern survives evaluation, write `help-links.test.js` (L1 source-resolution), `help-mode.test.js` (state machine + keyboard), and `e2e/help-mode.spec.js` (toggle → reveal → click).
- **No L2 release check.** The `scripts/check-help-links-live.py` from the original plan is unimplemented in this prototype.
- **No build-time `WORCA_DOCS_BASE` override.** The original plan's esbuild `define` is also unimplemented; the registry defaults to production docs.
- **Not all surfaces instrumented.** Launchers, dashboard, sidebar, Pipeline Templates page, and Run Timeline header are deliberately uncovered so they don't dilute the evaluation. The pattern works regardless; fan-out is mechanical.

## Decision points for "should we merge this approach"

After clicking through, the question to answer is:

> Is the **opt-in reveal** discoverable enough for new users, given that the edge tab is the only persistent affordance? Or do users actually want the always-on inline `?` from the original plan, density cost included?

If opt-in survives, the follow-ups are: (1) instrument remaining surfaces, (2) write the test suite, (3) implement L1 + L2 sync checks, (4) reconcile with the W-061 plan file.

If opt-in does not survive, fall back to the inline-icon plan but apply the **coarser placement discipline** (Option A from the analysis): one `?` per route/section rather than per panel, dropping the inventory from ~30 to ~12.
