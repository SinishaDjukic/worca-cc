# PR #361 merge-conflict resolution plan

**PR:** #361 `feat/chat-connectivity` → `dev` (NOT master) — https://github.com/SinishaDjukic/worca-cc/pull/361
**Status:** `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`
**Date:** 2026-08-16

## Situation

Conflict cause: `dev` merged #360 "configurable models" (16 commits, `527d29da` and ancestors) after this branch's merge base (`3587cd6e`). Both features extended the same plugin surfaces: manifest contributions, plugin-store inventory/consent, config API, Plugins view, CSS.

**9 files, 18 hunks. All are "both added" collisions — zero logic contention.** Resolution = union nearly everywhere, plus 4 spots needing real stitching (marked ⚠ below).

Analysis was done via a scratch-worktree merge probe (`git merge-tree` + real `git merge --no-commit` in a temp worktree); the main tree was never touched.

## Strategy

`git merge origin/dev` into the branch (merge commit, **not** rebase — 13 branch commits would replay conflicts repeatedly). Resolve per file below, commit, push.

## Per-file resolutions

### 1. `src/core/plugin-manifest.mjs` (4 hunks)

- **Imports** ⚠: keep branch's `WORCA_PLUGIN_APIS` (branch rewrote `apiSatisfies`/`negotiatedApi` to the plural API set `[1, 2]`; dev never touched `plugin-api.mjs`), **add** dev's `import { EFFORTS, isReservedModelEnvKey } from './model-env.mjs'`. Drop dev's singular `WORCA_PLUGIN_API` import — nothing references it post-merge.
- **`KNOWN_TOP`**: union — include both `'chatChannels'` and `'models', 'modelSecrets'`:
  ```js
  const KNOWN_TOP = new Set(['name', 'version', 'description', 'author', 'homepage', 'license', 'engines', 'taskSources', 'chatChannels', 'setup', 'models', 'modelSecrets']);
  ```
- **Validation blocks**: keep both, sequential — branch's chatChannels block, then dev's modelSecrets+models block.
- **Return object**: `engines: { worcaApi }, setup, taskSources, chatChannels, models, modelSecrets,`

### 2. `src/core/plugin-store.mjs` (3 hunks) — pure unions

- Inventory: keep both mapping blocks (branch's `chatChannels` + dev's `models`/`modelSecrets`).
- Return: `{ agents, taskSources, chatChannels, models, modelSecrets, skills: skills.sort(), workflows, depCount, setupCommands }`.
- Contributions counts: both ternary arms get `chatChannels` **and** `models` keys:
  ```js
  ? { agents: inv.agents.length, taskSources: inv.taskSources.length, chatChannels: inv.chatChannels.length, models: inv.models.length, skills: inv.skills.length, workflows: inv.workflows.length }
  : { agents: 0, taskSources: 0, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
  ```

### 3. `ui/server.mjs` (2 hunks) ⚠ real stitching

- **GET `/api/plugins/:name/config`**: keep branch's `channels` mapping **and** dev's `msSchema`:
  ```js
  const channels = (manifest.chatChannels || []).map((c) => ({
    id: c.id, displayName: c.displayName, platform: c.platform,
    schema: c.configSchema, values: redactedConfig(name, c.configSchema),
  }));
  const msSchema = modelSecretsSchema(name);
  res.json({
    sources, channels,
    ...(msSchema.length ? { models: { schema: msSchema, values: redactedConfig(name, msSchema) } } : {}),
  });
  ```
- **PUT `/api/plugins/:name/config`**: dev's `body.target === 'modelSecrets'` early-return block **first**, then branch's `let schema` + channelId/sourceId routing verbatim. The shared tail (`writePluginConfig(name, schema, …)` + `reloadChatWorkers(name)`) is already correct as merged — the model-secrets path returns before the worker reload, which is right (model secrets don't touch chat workers).

### 4. `ui/public/app.js` (2 hunks) ⚠ real stitching

- **Config body**: branch call first, then dev's model-secrets append block **verbatim**:
  ```js
  const body = renderConfigForm({ sources, channels: data.channels || [] });
  // Model secrets (design §9.7): one extra form, marked with data-target so the
  // save loop routes it through the { target: 'modelSecrets' } write.
  if (data.models && Array.isArray(data.models.schema) && data.models.schema.length) {
    // ... dev block unchanged — renderConfigForm([...]) array call still works
    // because branch's renderConfigForm kept array back-compat (plugins-view.mjs:203)
  }
  ```
- **Save loop**:
  ```js
  const collected = collectConfigForm(f); // { sourceId | channelId, values }
  const payload = f.dataset.target === 'modelSecrets'
    ? { target: 'modelSecrets', values: collected.values }
    : collected;
  const r = await pluginApi('PUT', `/api/plugins/${encodeURIComponent(name)}/config`, payload);
  ```

### 5. `ui/public/plugins-view.mjs` (2 hunks) — unions

- `contribSummary`: both rows — `[n(c && c.chatChannels), 'chat channel'], [n(c && c.models), 'model'],` before skills/workflows. Zero counts are filtered by `n()`, so both sides' tests still pass.
- Install consent: keep both sections (branch's chat-channels section with security warning + dev's models section with verbatim base URLs).

### 6. `ui/public/style.css` (1 hunk) — keep both blocks

Chat-connectivity block (`.pl-channels`, `.chat-*`) + Models-view block (`.mv-*`, `.mvx-*`, `.pl-baseurl`). Note both sides define `.pl-config-h` — keep one (dev's `margin:14px 0 6px;font-size:13px;` wins if kept last; either is fine, pick dev's and drop branch's duplicate line).

### 7. Tests (4 hunks) — unions

- `test/plugin-manifest.test.mjs` empty fixture: `taskSources: [], chatChannels: [], models: [], modelSecrets: [],`; keep both test suites (chatChannels + models/modelSecrets).
- `test/plugin-store.test.mjs` assertion: `{ agents: 1, taskSources: 1, chatChannels: 0, models: 0, skills: 1, workflows: 1 }`.
- `test/plugins-view.test.mjs`: keep both suites (channel badges/config forms + model consent/delta/counts).

## Post-resolve checks (semantic drift, not marked as conflicts)

1. Confirm dev's `isSecretRef` arrow const auto-merged into plugin-manifest (sits near the `KNOWN_TOP` hunk, dev line 26).
2. Grep `contributions` in dev-added code for any 4th shape site expecting models-only counts.
3. Dev's model plugins declare `worca-cc-api >=1` — passes branch's `[1, 2]` set by design (any-member satisfies). Verify via tests, no action expected.
4. `node --check` each resolved `.mjs`.

## Verification

```bash
node --test test/plugin-manifest.test.mjs test/plugin-store.test.mjs test/plugins-view.test.mjs
npm test   # judge modulo the 4 known pre-existing imagegen-skill failures
```

## Mechanics

```bash
git fetch origin dev
git merge origin/dev     # 9 files conflict:
#   src/core/plugin-manifest.mjs   src/core/plugin-store.mjs
#   test/plugin-manifest.test.mjs  test/plugin-store.test.mjs  test/plugins-view.test.mjs
#   ui/public/app.js  ui/public/plugins-view.mjs  ui/public/style.css  ui/server.mjs
# resolve per plan above
git add <9 files> && git commit
git push
```

`docs/` stays untracked (never commit plans/specs). Effort ~30–45 min; every hunk's resolution is determined above.
