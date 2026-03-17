# W-025: Settings Editor Expansion

Add UI editors for 4 settings currently only editable via raw JSON: editable permissions, plan path template, default run parameters, and pricing.

## Problem

The Settings page covers agents, stages/loops, governance, preferences, and notifications — but several important `settings.json` fields have no UI:

- **`permissions.allow`** — shown read-only in Governance tab, not editable
- **`plan_path_template`** — no UI at all
- **`pricing`** — no UI at all; users must edit JSON to update token costs
- **Run defaults (`msize`, `mloops`)** — no concept of defaults; New Pipeline form hardcodes both to `1`

## Scope — 4 Features

### 1. Editable Permissions — Governance Tab

**Current:** Read-only `<code>` blocks at `settings.js:329-333`.
**Change:** Editable list — text input per row, remove button, "Add Permission" button.

**Files:**
- `app/views/settings.js` — replace read-only permissions block in `governanceTab()` with editable list
- `app/styles.css` — add `.settings-perm-item--editable` styles

**Details:**
- Add `readPermissionsFromDom()` that queries all `.perm-input` elements and returns `string[]`
- Each permission renders as: `<sl-input class="perm-input" value="...">` + remove icon-button (import `X` icon from `lucide`, add to `icons.js`)
- "Add Permission" button appends an empty input row
- Modify "Save Governance" handler (line 337) to include `permissions: { allow: readPermissionsFromDom() }`
- No validator changes needed — `permissions.allow` validation already exists at `settings-validator.js:147-162`

### 2. Plan Path Template — Pipeline Tab

**Current:** Not in UI. Value in `settings.json:105` = `"docs/plans/{timestamp}-{title_slug}.md"`.
**Change:** Text input in Pipeline tab between Loop Limits and Save button.

**Files:**
- `app/views/settings.js` — add section to `pipelineTab()` between lines 273 and 275
- `server/settings-validator.js` — add validation rule

**Details:**
- Single `<sl-input>` with id `plan-path-template`, pre-filled from `worca.plan_path_template`
- Hint text: `Placeholders: {timestamp}, {title_slug} — Default: docs/plans/{timestamp}-{title_slug}.md`
- Extend `readPipelineFromDom()` to read this field and return `{ loops, plan_path_template }`
- Include `plan_path_template` in Save Pipeline merge (line 279)
- Validator rule: must be non-empty string, max 500 chars
- Add default normalization in `loadSettings()`:
  ```js
  if (!settingsData.worca.plan_path_template) {
    settingsData.worca.plan_path_template = 'docs/plans/{timestamp}-{title_slug}.md';
  }
  ```

### 3. Default Run Parameters — Pipeline Tab

**Current:** Not in `settings.json`. `new-run.js:203-209` hardcodes both `msize` and `mloops` to `value="1"`.
**Change:** Two number inputs in Pipeline tab; New Pipeline form reads them as defaults.

**Files:**
- `app/views/settings.js` — add "Run Defaults" section to `pipelineTab()`, export `getDefaults()` helper
- `app/views/new-run.js` — import `getDefaults()`, use for initial form values
- `server/settings-validator.js` — add defaults validation block

**Details:**
- Two `<sl-input type="number">` fields (1-10) with ids `defaults-msize`, `defaults-mloops`
- Hints: "Scales max_turns per stage" / "Scales max loop iterations"
- Extend `readPipelineFromDom()` to include `defaults: { msize, mloops }`
- Include in Save Pipeline merge
- Export `getDefaults()` from `settings.js`:
  ```js
  export function getDefaults() {
    return settingsData?.worca?.defaults || { msize: 1, mloops: 1 };
  }
  ```
- In `new-run.js`, import `getDefaults` and replace hardcoded `value="1"` on lines 203 and 209 with `value="${getDefaults().msize}"` / `value="${getDefaults().mloops}"`
- Validator: `defaults.msize` and `defaults.mloops` must be integers 1-10
- Default normalization in `loadSettings()`:
  ```js
  if (!settingsData.worca.defaults) {
    settingsData.worca.defaults = { msize: 1, mloops: 1 };
  }
  ```

### 4. Pricing Editor — Preferences Tab

**Current:** Not in UI. Token costs at `settings.json:107-123` used by `token_usage.py`.
**Change:** Editable table in Preferences tab with per-model cost fields.

**Files:**
- `app/views/settings.js` — add "Pricing" section to `preferencesTab()`, change its signature
- `app/styles.css` — add pricing table styles
- `server/settings-validator.js` — add pricing validation block

**Details:**
- Constants:
  ```js
  const PRICING_MODELS = ['opus', 'sonnet'];
  const PRICING_FIELDS = [
    { key: 'input_per_mtok', label: 'Input/MTok' },
    { key: 'output_per_mtok', label: 'Output/MTok' },
    { key: 'cache_write_per_mtok', label: 'Cache Write/MTok' },
    { key: 'cache_read_per_mtok', label: 'Cache Read/MTok' },
  ];
  const DEFAULT_PRICING = {
    models: {
      opus: { input_per_mtok: 15, output_per_mtok: 75, cache_write_per_mtok: 18.75, cache_read_per_mtok: 1.5 },
      sonnet: { input_per_mtok: 3, output_per_mtok: 15, cache_write_per_mtok: 3.75, cache_read_per_mtok: 0.3 },
    },
    currency: 'USD',
    last_updated: '2025-05-01',
  };
  ```
- Render a compact table: model rows x 4 cost columns, all `<sl-input type="number" step="0.01">`
- Read-only info fields for `currency` and `last_updated` below the table
- Change `preferencesTab()` signature from `(preferences, onThemeToggle)` to `(preferences, worca, { onThemeToggle, rerender })`
- Update call site at line 506: `preferencesTab(preferences, worca, { onThemeToggle, rerender })`
- Add `readPricingFromDom()` that reads all pricing inputs and returns a pricing object
- Add "Save Pricing" button (dark mode toggle remains instant)
- Validator: `pricing.models.*.{field}` must be non-negative finite numbers; `currency` and `last_updated` must be strings
- Default normalization in `loadSettings()` with deep merge for models:
  ```js
  if (!settingsData.worca.pricing) {
    settingsData.worca.pricing = { ...DEFAULT_PRICING };
  } else {
    for (const model of PRICING_MODELS) {
      settingsData.worca.pricing.models[model] = {
        ...DEFAULT_PRICING.models[model],
        ...(settingsData.worca.pricing.models?.[model] || {}),
      };
    }
  }
  ```

## Implementation Order

1. **Editable permissions** — zero backend changes, highest user value, lowest risk
2. **Plan path template** — one validator rule, one text input, clean
3. **Default run params** — cross-view wiring (`settings.js` → `new-run.js`)
4. **Pricing editor** — largest scope (table layout, validator block, signature change)

## Critical Files

| File | Changes |
|---|---|
| `.claude/worca-ui/app/views/settings.js` | All 4 features — new sections, read functions, save handlers, exported `getDefaults()` |
| `.claude/worca-ui/server/settings-validator.js` | 3 new validation blocks (plan_path_template, pricing, defaults) |
| `.claude/worca-ui/app/views/new-run.js` | Import `getDefaults()`, use for default msize/mloops values |
| `.claude/worca-ui/app/styles.css` | New classes: editable permission rows, pricing table |
| `.claude/worca-ui/app/utils/icons.js` | Import and export `X` icon for permission remove button |

## Out of Scope

- **Milestone toggles** (`plan_approval`, `pr_approval`, `deploy_approval`) — Python hooks don't read these from settings.json yet
- **Info badges for governance settings** — guards/dispatch/test_gate stored but not enforced; separate UX issue
- **Making governance settings functional** — Python hook changes, not UI

## Verification

1. `cd .claude/worca-ui && node bin/worca-ui.js start --open`
2. Settings → Governance: permissions editable, add/remove works, save persists
3. Settings → Pipeline: plan_path_template field shows current value, edit + save round-trips
4. Settings → Pipeline: Run Defaults section, change msize to 3, save, open New Pipeline — pre-fills 3
5. Settings → Preferences: pricing table shows current rates, edit + save round-trips
6. After each save: `cat .claude/settings.json | jq .worca` reflects changes
7. Run tests: `npx vitest run .claude/worca-ui/server/`
8. Rebuild: `cd .claude/worca-ui && npm run build`
