# Plugin Marketplaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the worca-cc repo itself into a plugin marketplace (plugins move from `examples/plugins/` to `plugins/`), add a persisted multi-marketplace registry (add/refresh/remove repos; all discovered plugins installable from the UI; removal keeps installed plugins working), with UI, API, and CLI support.

**Architecture:** A new `src/core/marketplaces.mjs` owns `<worcaHome>/plugins/marketplaces.json` (same atomic-JSON conventions as `plugins-lock.mjs`). Repo discovery in `src/core/plugin-repo.mjs` learns an optional root `worca-cc-marketplace.json` (explicit plugin dirs, any depth) with fallback to the existing depth 0–1 scan. Installs stay exactly as today (lock-held `repo`/`subdir`/`pinnedSha` provenance), which is what makes marketplace removal safe for installed plugins. The Plugins view grows Available + Marketplaces sections; the CLI grows a `worca marketplace` namespace.

**Tech Stack:** Node >=22.13 ESM (`.mjs`, plain JS — NO TypeScript syntax), `node --test`, jsdom for UI renderers, express, vanilla-JS UI (no build step), local git fixture repos in tests (no network).

**Spec:** `docs/superpowers/specs/2026-08-17-plugin-marketplaces-design.md` (read it first; it carries the locked user decisions and current-state file:line facts).

## Global Constraints

- **NEVER `git add -A` / `git add .`** — `docs/` (plans/specs) must stay untracked. Stage explicit paths only. Never commit anything under `docs/superpowers/`.
- Tests run with `npm test` = `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/*.mjs`. Judge results **modulo the 4 known pre-existing imagegen-skill failures** (project baseline). Everything else must pass.
- To run a single test file: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs` (WORCA_HOME is mandatory — `worcaHome()` throws under node:test without it; new test files must call `useTempHome(after)` from `test/helpers/temp-home.mjs`).
- All new core modules follow existing conventions: reads never throw, writes are temp+rename atomic, git via injectable `exec`, kebab-case names.
- Commit messages: conventional commits, each ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Manifest key is `"worca-cc-api"` in JSON, normalized internally to `engines.worcaApi`. The 4 chat plugins need API `>=2 <3`; github-source needs `>=1 <2` — both satisfied by host `WORCA_PLUGIN_APIS = [1, 2]`.
- Work on a new branch off `feat/chat-connectivity`: `git checkout -b feat/plugin-marketplaces`.

---

### Task 1: Repo restructure — `examples/plugins/` → `plugins/`, marketplace manifest, fix every reference

**Files:**
- Move: `examples/plugins/*` → `plugins/*` (github-source, telegram-chat, slack-chat, discord-chat, teams-chat)
- Create: `worca-cc-marketplace.json` (repo root)
- Modify: `test/github-source-connector.test.mjs:3,7`, `test/telegram-chat-worker.test.mjs:12-14`, `test/slack-chat-worker.test.mjs:8`, `test/discord-chat-worker.test.mjs:8-9`, `test/teams-chat-worker.test.mjs:9-11`, `test/chat-lib-drift.test.mjs:3,13`
- Modify: `.gitignore:3`, `package.json:22`, `README.md:160`, `scripts/smoke-workspace.mjs:15`, `chat-connectivity-design.md:22`
- Modify: `.claude/skills/creating-worca-cc-plugins/SKILL.md` (path pointer only)
- Modify: `plugins/github-source/README.md` (§Publishing + path), `plugins/github-source/worca-cc-plugin.json` (homepage), `plugins/github-source/connector/index.mjs:1`, `plugins/github-source/connector/github-api.mjs:1`, `plugins/{telegram,slack,discord,teams}-chat/README.md` (link lines)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `plugins/<name>/` layout + root `worca-cc-marketplace.json` — every later task assumes this layout. Manifest file name string `'worca-cc-marketplace.json'` is the constant Tasks 2/4/5 read.

- [ ] **Step 1: Branch + move**

```bash
git checkout -b feat/plugin-marketplaces
git mv examples/plugins plugins
mv examples/sandbox sandbox 2>/dev/null || true   # a hand-made local sandbox may exist; keep it usable
rmdir examples
```

- [ ] **Step 2: Create the marketplace manifest**

Create `worca-cc-marketplace.json` at the repo root:

```json
{
  "name": "Worca CC Official",
  "description": "Plugins bundled with the Worca CC repo",
  "plugins": [
    "plugins/github-source",
    "plugins/telegram-chat",
    "plugins/slack-chat",
    "plugins/discord-chat",
    "plugins/teams-chat"
  ]
}
```

- [ ] **Step 3: Fix the six hard test references**

In each file, replace the path segment `../examples/plugins/` → `../plugins/` on the listed import lines:
- `test/github-source-connector.test.mjs:7` (also update the line-3 comment "imports directly from examples/" → "imports directly from plugins/")
- `test/telegram-chat-worker.test.mjs:12,13,14`
- `test/slack-chat-worker.test.mjs:8`
- `test/discord-chat-worker.test.mjs:8,9`
- `test/teams-chat-worker.test.mjs:9,10,11`

In `test/chat-lib-drift.test.mjs`:
- line 13: `join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'plugins')` → `join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins')`
- line 3 comment: `every examples/plugins/*/lib file` → `every plugins/*/lib file`

(The canon assert `withLib.includes('telegram-chat')` at line 19 stays as-is; github-source has no `lib/` and is already filtered out by the `existsSync(join(..., 'lib'))` filter.)

- [ ] **Step 4: Run the moved tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/github-source-connector.test.mjs test/telegram-chat-worker.test.mjs test/slack-chat-worker.test.mjs test/discord-chat-worker.test.mjs test/teams-chat-worker.test.mjs test/chat-lib-drift.test.mjs`
Expected: ALL PASS.

- [ ] **Step 5: Sandbox + doc path fixes**

- `.gitignore` line 3: `examples/sandbox` → `/sandbox` (anchored: only the root-level sandbox).
- `package.json` line 22 smoke script: `--project examples/sandbox` → `--project sandbox`.
- `README.md:160`: `--project examples/sandbox` → `--project sandbox`.
- `scripts/smoke-workspace.mjs:15` comment: `never examples/sandbox` → `never sandbox/`.
- `chat-connectivity-design.md:22`: `in-repo under \`examples/plugins/\`` → `in-repo under \`plugins/\``.
- `.claude/skills/creating-worca-cc-plugins/SKILL.md`: in the section "## The one example worth reading", change `` `examples/plugins/github-source/` `` → `` `plugins/github-source/` `` (content additions come in Task 11).

- [ ] **Step 6: Plugin self-references**

- `plugins/github-source/worca-cc-plugin.json`: `"homepage": "https://github.com/denislavprinov/maestro-plugins"` → `"homepage": "https://github.com/denislavprinov/maestro"`.
- `plugins/github-source/connector/index.mjs:1` and `connector/github-api.mjs:1`: update the path-in-header comment `examples/plugins/github-source/...` → `plugins/github-source/...`.
- `plugins/github-source/README.md` — replace the whole `## Publishing` section (currently "This directory (`examples/plugins/github-source` …) is the SOURCE OF TRUTH. Publish by copying it verbatim into the `denislavprinov/maestro-plugins` repo …") with:

```markdown
## Publishing

This directory (`plugins/github-source` in the worca-cc repo) is the source of
truth AND the distribution point: the worca-cc repo is itself a plugin
marketplace (see the root `worca-cc-marketplace.json`), registered by default
in every worca-cc install. Users get this plugin from Plugins → Available, or:

    worca plugin install github-source
```

- `plugins/telegram-chat/README.md:19`, `plugins/slack-chat/README.md:26`, `plugins/discord-chat/README.md:27`, `plugins/teams-chat/README.md:43`: `worca plugin link examples/plugins/<name>` → `worca plugin link plugins/<name>` (grep each README for `examples/plugins` and fix all hits).

- [ ] **Step 7: Verify zero stale references**

Run: `grep -rn "examples/plugins\|examples/sandbox" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs . || echo CLEAN`
Expected: `CLEAN` (hits under `docs/` are historical plan text and stay).

- [ ] **Step 8: Full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: failures = only the 4 known imagegen-skill baseline failures.

- [ ] **Step 9: Commit**

```bash
git add plugins worca-cc-marketplace.json .gitignore package.json README.md scripts/smoke-workspace.mjs chat-connectivity-design.md .claude/skills/creating-worca-cc-plugins/SKILL.md test/github-source-connector.test.mjs test/telegram-chat-worker.test.mjs test/slack-chat-worker.test.mjs test/discord-chat-worker.test.mjs test/teams-chat-worker.test.mjs test/chat-lib-drift.test.mjs
git commit -m "refactor(plugins): move examples/plugins to plugins/, add marketplace manifest

The repo is now itself a plugin marketplace: worca-cc-marketplace.json at the
root declares the 5 bundled plugins. examples/ is gone; sandbox (smoke) moves
to /sandbox.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Note: `git mv` already staged the moves; the `git add plugins` covers the in-place edits to moved files.)

---

### Task 2: Marketplace-manifest discovery in `plugin-repo.mjs` + depth-2 regression tests

**Files:**
- Modify: `src/core/plugin-repo.mjs` (extend `addPluginRepo` at lines 56-83; extract `repoSlug` from `repoCacheDir` at 23-31; add `parseMarketplaceManifest`)
- Test: `test/plugin-repo.test.mjs` (append tests; existing helpers `makeRepo`/`writeTree`/`git`/`MANIFEST` at lines 22-46 are reused)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 4, 5, 7, 10):
  - `addPluginRepo(repoUrl, {exec}) → { repoUrl, sha, discovered: [{name, subdir, manifest}], warnings: string[], marketplace: {name: string, description: string} | null }` — the `marketplace` key is NEW; `subdir` may now be multi-level (e.g. `plugins/aa`).
  - `export function repoSlug(repoUrl): string` — the cache-dir slug, reused as marketplace id.
  - `export function parseMarketplaceManifest(raw) → {ok: true, name, description, plugins: string[]} | {ok: false, errors: string[]}`.

- [ ] **Step 1: Write failing tests** (append to `test/plugin-repo.test.mjs`)

```js
const MP_MANIFEST = (plugins, extra = {}) => JSON.stringify({
  name: 'Test Market', description: 'fixture marketplace', plugins, ...extra,
});

test('addPluginRepo: worca-cc-marketplace.json drives discovery (any depth) and suppresses the scan', async () => {
  const { root } = await makeRepo('mkt', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/aa', 'plugins/bb']),
    'plugins/aa/worca-cc-plugin.json': MANIFEST('aa-plugin'),
    'plugins/aa/index.mjs': 'export default () => ({});\n',
    'plugins/bb/worca-cc-plugin.json': MANIFEST('bb-plugin'),
    'plugins/bb/index.mjs': 'export default () => ({});\n',
    // depth-1 plugin NOT listed in the manifest -> must NOT be discovered
    'stray/worca-cc-plugin.json': MANIFEST('stray-plugin'),
    'stray/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.marketplace, { name: 'Test Market', description: 'fixture marketplace' });
  assert.deepEqual(
    r.discovered.map(({ name, subdir }) => ({ name, subdir })),
    [{ name: 'aa-plugin', subdir: 'plugins/aa' }, { name: 'bb-plugin', subdir: 'plugins/bb' }],
  );
});

test('addPluginRepo: no marketplace manifest -> depth 0-1 scan, marketplace: null', async () => {
  const { root } = await makeRepo('mkt-none', {
    'alpha2/worca-cc-plugin.json': MANIFEST('alpha2-plugin'),
    'alpha2/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.equal(r.marketplace, null);
  assert.deepEqual(r.discovered.map((d) => d.name), ['alpha2-plugin']);
});

test('addPluginRepo: invalid marketplace manifest -> warning + fallback to scan', async () => {
  const { root } = await makeRepo('mkt-bad', {
    'worca-cc-marketplace.json': '{nope',
    'gamma/worca-cc-plugin.json': MANIFEST('gamma-plugin'),
    'gamma/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.equal(r.marketplace, null);
  assert.deepEqual(r.discovered.map((d) => d.name), ['gamma-plugin']);
  assert.match(r.warnings.join('\n'), /worca-cc-marketplace\.json/);
});

test('addPluginRepo: bad manifest entries skipped with warnings; duplicates first-win', async () => {
  const { root } = await makeRepo('mkt-entries', {
    'worca-cc-marketplace.json': MP_MANIFEST([
      'plugins/ok', '../escape', '/abs', 'missing/dir', 'plugins/dup',
    ]),
    'plugins/ok/worca-cc-plugin.json': MANIFEST('same-name'),
    'plugins/ok/index.mjs': 'export default () => ({});\n',
    'plugins/dup/worca-cc-plugin.json': MANIFEST('same-name'), // duplicate NAME
    'plugins/dup/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.discovered.map(({ name, subdir }) => ({ name, subdir })),
    [{ name: 'same-name', subdir: 'plugins/ok' }]);
  const w = r.warnings.join('\n');
  assert.match(w, /\.\.\/escape/);
  assert.match(w, /\/abs/);
  assert.match(w, /missing\/dir/);
  assert.match(w, /same-name/); // duplicate warning
});

test('exportVersion: depth-2 subdir strips components correctly (regression lock)', async () => {
  const { root, sha } = await makeRepo('mkt-export', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/deep']),
    'plugins/deep/worca-cc-plugin.json': MANIFEST('deep-plugin'),
    'plugins/deep/index.mjs': 'export default () => ({});\n',
  });
  await addPluginRepo(root); // seed cache
  const { versionDir } = await exportVersion('deep-plugin', sha, { repoUrl: root, subdir: 'plugins/deep' });
  assert.ok(existsSync(join(versionDir, 'worca-cc-plugin.json')), 'manifest at export ROOT (strip-components = subdir depth)');
  assert.ok(existsSync(join(versionDir, 'index.mjs')));
});

test('fetchCandidate: depth-2 subdir scopes the diffstat to that plugin only', async () => {
  const { root, sha } = await makeRepo('mkt-cand', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/p1', 'plugins/p2']),
    'plugins/p1/worca-cc-plugin.json': MANIFEST('p1-plugin'),
    'plugins/p1/index.mjs': 'export default () => ({});\n',
    'plugins/p2/worca-cc-plugin.json': MANIFEST('p2-plugin'),
    'plugins/p2/index.mjs': 'export default () => ({});\n',
  });
  await addPluginRepo(root);
  writePluginsLock({ 'p1-plugin': {
    repo: root, subdir: 'plugins/p1', pinnedSha: sha, version: '0.1.0',
    enabled: true, installedAt: new Date().toISOString(),
  } });
  writeFileSync(join(root, 'plugins', 'p1', 'index.mjs'), 'export default () => ({ v: 2 });\n');
  writeFileSync(join(root, 'plugins', 'p2', 'index.mjs'), 'export default () => ({ v: 2 });\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'touch both');
  const fc = await fetchCandidate('p1-plugin');
  assert.match(fc.diffstat, /plugins\/p1\/index\.mjs/);
  assert.doesNotMatch(fc.diffstat, /plugins\/p2/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugin-repo.test.mjs`
Expected: the first four new tests FAIL (no `marketplace` key; stray/gamma discovery asserts differ). The two regression tests (exportVersion depth-2, fetchCandidate depth-2) should already PASS — they are characterization locks of existing-correct behavior; confirm they pass, don't "fix" them.

- [ ] **Step 3: Implement**

In `src/core/plugin-repo.mjs`:

(a) Extract the slug (replace the body of `repoCacheDir`):

```js
/** Filesystem slug for a repo URL — shared by the bare-cache dir and marketplace ids. */
export function repoSlug(repoUrl) {
  return String(repoUrl)
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'repo';
}

/** Bare-cache path for a repo URL: <pluginsRoot>/.cache/<slug>.git. */
export function repoCacheDir(repoUrl) {
  return join(pluginsRoot(), '.cache', `${repoSlug(repoUrl)}.git`);
}
```

(b) Add the marketplace-manifest parser (module scope, exported):

```js
/** Validate a raw worca-cc-marketplace.json (spec §4.1). Paths are repo-relative
 *  dirs, any depth: no absolute, no '..'/'.' segments, no backslashes, no empties. */
export function parseMarketplaceManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['not a JSON object'] };
  }
  const structural = []; // whole-file problems -> ok:false (caller falls back to the scan)
  if (typeof raw.name !== 'string' || !raw.name.trim()) structural.push('"name" is required');
  if (!Array.isArray(raw.plugins)) structural.push('"plugins" must be an array of repo-relative dirs');
  if (structural.length) return { ok: false, errors: structural };
  const warnings = []; // per-entry problems -> skipped entries, manifest still authoritative
  const plugins = [];
  for (const d of raw.plugins) {
    if (typeof d !== 'string' || !d.trim() || d.includes('\\') || d.startsWith('/')
        || d.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
      warnings.push(`invalid plugin path ${JSON.stringify(d)} — skipped`);
      continue;
    }
    plugins.push(d.replace(/\/+$/, ''));
  }
  return {
    ok: true,
    name: raw.name.trim(),
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    plugins,
    warnings,
  };
}
```

(c) Rework the discovery section of `addPluginRepo` (lines 62-82). Keep the shorthand expansion and `ensureCache` as-is; replace from the `paths` computation down:

```js
  const cache = await ensureCache(repoUrl, exec);
  const sha = (await gitDir(cache, ['rev-parse', 'HEAD'], exec)).trim();
  const allPaths = (await gitDir(cache, ['ls-tree', '-r', '--name-only', sha], exec))
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const warnings = [];
  let marketplace = null;
  let manifestPaths = null; // null -> fall back to the depth 0-1 scan
  if (allPaths.includes('worca-cc-marketplace.json')) {
    let mp = null;
    try {
      mp = parseMarketplaceManifest(JSON.parse(await gitDir(cache, ['show', `${sha}:worca-cc-marketplace.json`], exec)));
    } catch {
      mp = { ok: false, errors: ['invalid JSON'] };
    }
    if (mp.ok) {
      marketplace = { name: mp.name, description: mp.description };
      warnings.push(...(mp.warnings || []).map((w) => `worca-cc-marketplace.json: ${w}`));
      manifestPaths = [];
      for (const dir of mp.plugins) {
        const p = `${dir}/worca-cc-plugin.json`;
        if (!allPaths.includes(p)) {
          warnings.push(`worca-cc-marketplace.json: ${dir}/worca-cc-plugin.json not found in repo — skipped`);
          continue;
        }
        manifestPaths.push(p);
      }
    } else {
      warnings.push(`worca-cc-marketplace.json: ${mp.errors.join('; ')} — falling back to depth 0-1 scan`);
    }
  }
  if (manifestPaths === null) {
    manifestPaths = allPaths
      .filter((p) => p === 'worca-cc-plugin.json' || /^[^/]+\/worca-cc-plugin\.json$/.test(p));
  }
  const discovered = [];
  const seenNames = new Set();
  for (const p of manifestPaths) {
    const subdir = p === 'worca-cc-plugin.json' ? '' : p.slice(0, -'/worca-cc-plugin.json'.length);
    let raw;
    try {
      raw = JSON.parse(await gitDir(cache, ['show', `${sha}:${p}`], exec));
    } catch {
      warnings.push(`${p}: invalid JSON — skipped`);
      continue;
    }
    const res = normalizeManifest(raw, { dir: subdir || '.' });
    if (!res.ok) { warnings.push(...res.errors); continue; }
    if (seenNames.has(res.manifest.name)) {
      warnings.push(`${p}: duplicate plugin name "${res.manifest.name}" — first entry wins, skipped`);
      continue;
    }
    seenNames.add(res.manifest.name);
    discovered.push({ name: res.manifest.name, subdir, manifest: res.manifest });
  }
  return { repoUrl, sha, discovered, warnings, marketplace };
```

Also update the function's JSDoc `@returns` to include `marketplace`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugin-repo.test.mjs`
Expected: ALL PASS (including the pre-existing depth-1 tests — the fallback path must behave byte-identically to before).

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-repo.mjs test/plugin-repo.test.mjs
git commit -m "feat(plugin-repo): worca-cc-marketplace.json discovery + depth-2 regression locks

Manifest-listed plugin dirs (any depth) drive discovery when present; repos
without one keep the depth 0-1 scan. Adds repoSlug/parseMarketplaceManifest
exports and duplicate-name first-wins.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `plugin-inventory.mjs` (shared consent inventory)

**Files:**
- Create: `src/core/plugin-inventory.mjs`
- Modify: `ui/server.mjs:2785-2799` (delete the local `discoveryInventory`; import + use the new module in `POST /api/plugins/repo` — that route survives until Task 7)
- Test: `test/plugin-inventory.test.mjs`

**Interfaces:**
- Consumes: `repoCacheDir` (plugin-repo), `buildInstallInventory` (plugin-store), an existing bare cache seeded by `addPluginRepo`.
- Produces (used by Tasks 4, 7): `inventoryFromCache(repoUrl, sha, subdir, {exec}) → Promise<inventory>` where inventory is the exact `buildInstallInventory` shape (`{agents, taskSources, chatChannels, models, modelSecrets, skills, workflows, depCount, setupCommands}`).

- [ ] **Step 1: Write failing test**

```js
// test/plugin-inventory.test.mjs — inventoryFromCache exports a pinned SHA from
// the bare cache into a temp dir, inventories it, deletes it. Offline: local git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addPluginRepo } from '../src/core/plugin-repo.mjs';
import { inventoryFromCache } from '../src/core/plugin-inventory.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-inv-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}

test('inventoryFromCache: depth-2 subdir inventory matches the plugin manifest', async () => {
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'plugins', 'demo', 'connector'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'M', plugins: ['plugins/demo'] }));
  writeFileSync(join(root, 'plugins', 'demo', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'demo', version: '1.0.0',
    taskSources: [{ id: 'main', displayName: 'Demo', module: './connector/index.mjs',
      configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true }],
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'demo', 'connector', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const found = await addPluginRepo(root);
  const inv = await inventoryFromCache(found.repoUrl, found.sha, 'plugins/demo');
  assert.deepEqual(inv.taskSources, [{ id: 'main', displayName: 'Demo', secrets: ['token'] }]);
  assert.deepEqual(inv.setupCommands, []);
  assert.equal(inv.depCount, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugin-inventory.test.mjs`
Expected: FAIL — `Cannot find module '../src/core/plugin-inventory.mjs'`.

- [ ] **Step 3: Implement**

Create `src/core/plugin-inventory.mjs`:

```js
// src/core/plugin-inventory.mjs
// Consent inventory for a NOT-YET-INSTALLED plugin (spec §4.8): git-archive the
// pinned SHA from the bare cache into a throwaway temp dir, buildInstallInventory
// it, delete it. Nothing lands under ~/.worca-cc/plugins and no plugin code runs.
// Shared by the marketplace snapshot sync (marketplaces.mjs) and the web server.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoCacheDir } from './plugin-repo.mjs';
import { buildInstallInventory } from './plugin-store.mjs';

const execFileP = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) =>
  execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });

export async function inventoryFromCache(repoUrl, sha, subdir, { exec = defaultExec } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'worca-cc-consent-'));
  try {
    const tar = join(tmp, 'x.tar');
    await exec('git', ['--git-dir', repoCacheDir(repoUrl), 'archive', '--format=tar', '-o', tar,
      ...(subdir ? [sha, subdir] : [sha])]);
    await exec('tar', ['-xf', tar, '-C', tmp,
      ...(subdir ? ['--strip-components', String(subdir.split('/').length)] : [])]);
    await rm(tar, { force: true });
    return buildInstallInventory(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
```

In `ui/server.mjs`: delete the `discoveryInventory` function (lines 2786-2799) and the `const execFileP = promisify(execFile);` on 2785 **only if** `execFileP` has no other uses in the file (`grep -n execFileP ui/server.mjs` first — if used elsewhere, leave the const). Add `import { inventoryFromCache } from '../src/core/plugin-inventory.mjs';` next to the plugin-store import (line ~77), and in `POST /api/plugins/repo` replace `discoveryInventory(out.repoUrl, out.sha, d.subdir)` with `inventoryFromCache(out.repoUrl, out.sha, d.subdir)`.

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugin-inventory.test.mjs test/api-plugins.test.mjs`
Expected: PASS (api-plugins exercises the reworked `/api/plugins/repo`).

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-inventory.mjs ui/server.mjs test/plugin-inventory.test.mjs
git commit -m "refactor(core): extract shared plugin consent inventory from ui/server

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `marketplaces.mjs` — registry store (normalize, add, sync, refresh, remove, list, resolve)

**Files:**
- Create: `src/core/marketplaces.mjs`
- Test: `test/marketplaces.test.mjs`

**Interfaces:**
- Consumes: `addPluginRepo`, `repoCacheDir`, `repoSlug` (Task 2), `inventoryFromCache` (Task 3), `pluginsRoot`/`readPluginsLock` (plugins-lock).
- Produces (used by Tasks 5, 7, 10):
  - `marketplacesFile() → string`
  - `readMarketplaces() → { seededBuiltin: boolean, marketplaces: { [id]: Entry } }` (tolerant; missing/corrupt → `{seededBuiltin:false, marketplaces:{}}`)
  - `writeMarketplaces(state) → state` (atomic temp+rename)
  - `normalizeMarketplaceUrl(input) → string|null`
  - `marketplaceId(url) → string` (slug of the normalized url)
  - `addMarketplace(url, {exec}) → Promise<Entry>` — throws `{code:'EXISTS'}` on dup; **throws without recording** on sync failure
  - `syncMarketplace(id, {exec}) → Promise<Entry>` — failure keeps prior snapshot, sets `warnings: ['sync failed: …']`
  - `refreshAllMarketplaces({exec}) → Promise<Entry[]>` — sequential, per-entry tolerant
  - `removeMarketplace(id) → {ok:true, id}` — throws `{code:'NOT_FOUND'}` on unknown id; deletes the bare cache only when no lock entry shares the repo
  - `listMarketplaces() → Entry[]` (sorted by name)
  - `resolveInstallSource(name, {repo}) → {repoUrl, subdir, sha, marketplace} | {candidates: […]} | null`
  - `Entry = { id, url, name, description, builtin?: true, addedAt, lastSync: {sha, at}|null, plugins: [{name, subdir, description, version, inventory}], warnings: string[] }`

- [ ] **Step 1: Write failing tests**

```js
// test/marketplaces.test.mjs — persisted marketplace registry. Real local git
// fixture repos (offline); WORCA_HOME sandboxed via useTempHome.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  readMarketplaces, writeMarketplaces, normalizeMarketplaceUrl, marketplaceId,
  addMarketplace, syncMarketplace, refreshAllMarketplaces, removeMarketplace,
  listMarketplaces, resolveInstallSource, marketplacesFile,
} from '../src/core/marketplaces.mjs';
import { repoCacheDir } from '../src/core/plugin-repo.mjs';
import { writePluginsLock } from '../src/core/plugins-lock.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-mkt-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}
const PLUGIN = (name) => JSON.stringify({
  name, version: '0.1.0', description: `${name} fixture`,
  taskSources: [{ id: 'main', displayName: name, module: './index.mjs',
    inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
});
async function makeMarketRepo(dirName, pluginNames) {
  const root = join(scratch, dirName);
  const files = {
    'worca-cc-marketplace.json': JSON.stringify({
      name: `${dirName} market`, description: 'fixture', plugins: pluginNames.map((n) => `plugins/${n}`),
    }),
  };
  for (const n of pluginNames) {
    files[`plugins/${n}/worca-cc-plugin.json`] = PLUGIN(n);
    files[`plugins/${n}/index.mjs`] = 'export default () => ({});\n';
  }
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, files);
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  return { root, sha: await git(root, 'rev-parse', 'HEAD') };
}

test('normalizeMarketplaceUrl: shorthand, trailing junk, local paths', () => {
  assert.equal(normalizeMarketplaceUrl('owner/repo'), 'https://github.com/owner/repo');
  assert.equal(normalizeMarketplaceUrl('https://github.com/o/r.git'), 'https://github.com/o/r');
  assert.equal(normalizeMarketplaceUrl('https://github.com/o/r/'), 'https://github.com/o/r');
  assert.equal(normalizeMarketplaceUrl(''), null);
  assert.equal(normalizeMarketplaceUrl(scratch), scratch); // absolute local path stays
});

test('read tolerates a garbage file; write is atomic and round-trips', () => {
  writeFileSync(marketplacesFile(), '{broken', 'utf8');
  assert.deepEqual(readMarketplaces(), { seededBuiltin: false, marketplaces: {} });
  const state = { seededBuiltin: true, marketplaces: { x: { id: 'x', url: '/tmp/x', name: 'X', plugins: [], warnings: [], lastSync: null, addedAt: 'now' } } };
  writeMarketplaces(state);
  assert.deepEqual(readMarketplaces(), state);
});

test('addMarketplace: syncs the snapshot; duplicate add -> EXISTS; junk url not recorded', async () => {
  const { root, sha } = await makeMarketRepo('m1', ['aa', 'bb']);
  const entry = await addMarketplace(root);
  assert.equal(entry.name, 'm1 market');
  assert.equal(entry.id, marketplaceId(root));
  assert.equal(entry.lastSync.sha, sha);
  assert.deepEqual(entry.plugins.map((p) => ({ name: p.name, subdir: p.subdir })),
    [{ name: 'aa', subdir: 'plugins/aa' }, { name: 'bb', subdir: 'plugins/bb' }]);
  assert.equal(entry.plugins[0].inventory.taskSources[0].id, 'main');
  await assert.rejects(() => addMarketplace(root), (e) => e.code === 'EXISTS');
  await assert.rejects(() => addMarketplace(join(scratch, 'no-such-repo')));
  assert.equal(Object.keys(readMarketplaces().marketplaces).length, 1, 'failed add records nothing');
});

test('syncMarketplace: picks up new commits; failure keeps stale snapshot + warning', async () => {
  const { root } = await makeMarketRepo('m2', ['cc']);
  const entry = await addMarketplace(root);
  writeTree(root, {
    'worca-cc-marketplace.json': JSON.stringify({ name: 'm2 market', plugins: ['plugins/cc', 'plugins/dd'] }),
    'plugins/dd/worca-cc-plugin.json': PLUGIN('dd'),
    'plugins/dd/index.mjs': 'export default () => ({});\n',
  });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c2');
  const synced = await syncMarketplace(entry.id);
  assert.deepEqual(synced.plugins.map((p) => p.name), ['cc', 'dd']);
  rmSync(root, { recursive: true, force: true }); // repo vanishes
  rmSync(repoCacheDir(root), { recursive: true, force: true }); // and its cache
  const stale = await syncMarketplace(entry.id);
  assert.deepEqual(stale.plugins.map((p) => p.name), ['cc', 'dd'], 'stale snapshot kept');
  assert.match(stale.warnings.join('\n'), /sync failed/);
});

test('removeMarketplace: entry gone, installed plugins keep the cache; unknown -> NOT_FOUND', async () => {
  const { root } = await makeMarketRepo('m3', ['ee']);
  const entry = await addMarketplace(root);
  // simulate an installed plugin from this repo
  writePluginsLock({ ee: { repo: root, subdir: 'plugins/ee', pinnedSha: 'x'.repeat(40), version: '0.1.0', enabled: true, installedAt: 'now' } });
  removeMarketplace(entry.id);
  assert.ok(!readMarketplaces().marketplaces[entry.id]);
  assert.ok(existsSync(repoCacheDir(root)), 'cache kept while a lock entry references the repo');
  // no lock reference -> cache goes too
  writePluginsLock({});
  const entry2 = await addMarketplace(root);
  removeMarketplace(entry2.id);
  assert.ok(!existsSync(repoCacheDir(root)), 'cache removed with the last reference');
  assert.throws(() => removeMarketplace('nope'), (e) => e.code === 'NOT_FOUND');
});

test('resolveInstallSource: lock first, then unique marketplace hit, ambiguity -> candidates', async () => {
  const a = await makeMarketRepo('m4a', ['shared', 'only-a']);
  const b = await makeMarketRepo('m4b', ['shared']);
  await addMarketplace(a.root);
  await addMarketplace(b.root);
  const unique = resolveInstallSource('only-a', {});
  assert.equal(unique.repoUrl, a.root);
  assert.equal(unique.marketplace, marketplaceId(a.root));
  const ambiguous = resolveInstallSource('shared', {});
  assert.equal(ambiguous.candidates.length, 2);
  writePluginsLock({ shared: { repo: b.root, subdir: 'plugins/shared', pinnedSha: 'x'.repeat(40), version: '0.1.0', enabled: true, installedAt: 'now' } });
  assert.equal(resolveInstallSource('shared', {}).repoUrl, b.root, 'lock wins over marketplaces');
  assert.equal(resolveInstallSource('ghost', {}), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/marketplaces.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/marketplaces.mjs`**

```js
// src/core/marketplaces.mjs
// Persisted plugin-marketplace registry (marketplace spec §4.2): a git repo
// (URL, owner/repo, or local path) registered as a discovery source, with a
// cached discovery snapshot so the Plugins view renders with zero network.
// File conventions mirror plugins-lock.mjs: reads never throw, writes are
// temp+rename atomic, unknown keys survive read-modify-write.
// Installed plugins do NOT depend on this registry — the lock's own
// repo/subdir/pinnedSha provenance keeps update/uninstall working after a
// marketplace is removed (spec §4.5).

import {
  existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pluginsRoot, readPluginsLock } from './plugins-lock.mjs';
import { addPluginRepo, repoCacheDir, repoSlug } from './plugin-repo.mjs';
import { inventoryFromCache } from './plugin-inventory.mjs';

export function marketplacesFile() { return join(pluginsRoot(), 'marketplaces.json'); }

/** owner/repo -> GitHub URL (unless a real local path); URLs lose trailing /
 *  and .git; local paths resolve to absolute. null for empty input. */
export function normalizeMarketplaceUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !existsSync(s)) s = `https://github.com/${s}`;
  if (/^[a-z+]+:\/\//i.test(s)) return s.replace(/\/+$/, '').replace(/\.git$/i, '');
  return resolve(s);
}

export function marketplaceId(url) { return repoSlug(normalizeMarketplaceUrl(url) ?? url); }

/** Missing/corrupt/non-object -> empty state. Entries not normalized on read. */
export function readMarketplaces() {
  try {
    const v = JSON.parse(readFileSync(marketplacesFile(), 'utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return {
        ...v, // unknown keys survive read-modify-write; normalized fields below win
        seededBuiltin: v.seededBuiltin === true,
        marketplaces: v.marketplaces && typeof v.marketplaces === 'object' && !Array.isArray(v.marketplaces)
          ? v.marketplaces : {},
      };
    }
  } catch { /* fall through */ }
  return { seededBuiltin: false, marketplaces: {} };
}

export function writeMarketplaces(state) {
  const file = marketplacesFile();
  mkdirSync(pluginsRoot(), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(state ?? { seededBuiltin: false, marketplaces: {} }, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return state;
}

/** Discovery + per-plugin consent inventories -> fresh snapshot on the entry.
 *  Failure keeps the previous snapshot and records a warning (stale-but-usable). */
async function syncEntry(entry, { exec } = {}) {
  try {
    const found = await addPluginRepo(entry.url, ...(exec ? [{ exec }] : []));
    const plugins = [];
    for (const d of found.discovered) {
      plugins.push({
        name: d.name,
        subdir: d.subdir,
        description: d.manifest.description ?? '',
        version: d.manifest.version ?? null,
        inventory: await inventoryFromCache(found.repoUrl, found.sha, d.subdir, ...(exec ? [{ exec }] : [])),
      });
    }
    if (found.marketplace) {
      entry.name = found.marketplace.name;
      entry.description = found.marketplace.description;
    }
    entry.lastSync = { sha: found.sha, at: new Date().toISOString() };
    entry.plugins = plugins;
    entry.warnings = found.warnings;
  } catch (err) {
    entry.warnings = [`sync failed: ${err && err.message ? err.message : err}`];
  }
  return entry;
}

/** Register + immediately sync. Throws EXISTS on a duplicate (normalized) url.
 *  A first-sync failure throws WITHOUT recording — a typo'd url never leaves a
 *  junk entry (spec §4.2). */
export async function addMarketplace(url, { exec } = {}) {
  const norm = normalizeMarketplaceUrl(url);
  if (!norm) throw Object.assign(new Error('marketplace url is required'), { code: 'BAD_REQUEST' });
  const id = marketplaceId(norm);
  const state = readMarketplaces();
  if (state.marketplaces[id]) {
    throw Object.assign(new Error(`marketplace already added: ${norm}`), { code: 'EXISTS' });
  }
  const entry = {
    id, url: norm, name: id, description: '',
    addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [],
  };
  await syncEntry(entry, { exec });
  if (!entry.lastSync) {
    throw Object.assign(new Error(entry.warnings[0] || `could not read ${norm}`), { code: 'BAD_REQUEST' });
  }
  state.marketplaces[id] = entry;
  writeMarketplaces(state);
  return entry;
}

export async function syncMarketplace(id, { exec } = {}) {
  const state = readMarketplaces();
  const entry = state.marketplaces[id];
  if (!entry) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  await syncEntry(entry, { exec });
  writeMarketplaces(state);
  return entry;
}

/** Sequential, per-entry tolerant (a dead repo must not block the others). */
export async function refreshAllMarketplaces({ exec } = {}) {
  const out = [];
  for (const id of Object.keys(readMarketplaces().marketplaces).sort()) {
    out.push(await syncMarketplace(id, { exec }));
  }
  return out;
}

/** Remove the registry entry + snapshot. Installed plugins are untouched; the
 *  bare cache goes only when no plugins.lock.json entry shares the repo. */
export function removeMarketplace(id) {
  const state = readMarketplaces();
  const entry = state.marketplaces[id];
  if (!entry) throw Object.assign(new Error(`marketplace "${id}" not found`), { code: 'NOT_FOUND' });
  delete state.marketplaces[id];
  writeMarketplaces(state);
  const inUse = Object.values(readPluginsLock())
    .some((e) => e && e.repo && normalizeMarketplaceUrl(e.repo) === entry.url);
  if (!inUse) rmSync(repoCacheDir(entry.url), { recursive: true, force: true });
  return { ok: true, id };
}

export function listMarketplaces() {
  const state = readMarketplaces();
  return Object.values(state.marketplaces)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

/** Install-source resolution (spec §4.10): explicit --repo > lock provenance >
 *  unique snapshot match > {candidates} on ambiguity > null. */
export function resolveInstallSource(name, { repo } = {}) {
  if (repo) return { repoUrl: normalizeMarketplaceUrl(repo), subdir: null, sha: null, marketplace: null };
  const lockEntry = readPluginsLock()[name];
  if (lockEntry && lockEntry.repo) {
    return { repoUrl: lockEntry.repo, subdir: lockEntry.subdir ?? null, sha: null, marketplace: lockEntry.marketplace ?? null };
  }
  const hits = [];
  for (const m of listMarketplaces()) {
    for (const p of m.plugins || []) {
      if (p.name === name) {
        hits.push({ repoUrl: m.url, subdir: p.subdir, sha: m.lastSync ? m.lastSync.sha : null, marketplace: m.id });
      }
    }
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return { candidates: hits };
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/marketplaces.test.mjs`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/marketplaces.mjs test/marketplaces.test.mjs
git commit -m "feat(core): persisted marketplace registry with cached discovery snapshots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Builtin marketplace seeding (`hostRepoRoot` + `seedBuiltinMarketplace`)

**Files:**
- Modify: `src/core/marketplaces.mjs` (append two functions)
- Test: `test/marketplaces.test.mjs` (append)

**Interfaces:**
- Consumes: Task 4's store.
- Produces (used by Tasks 7, 10):
  - `hostRepoRoot() → string|null` — the repo root the host code runs from (two dirs up from `src/core/`), only when it contains `worca-cc-marketplace.json` AND `.git`; else null.
  - `seedBuiltinMarketplace({rootDir}) → {seeded: boolean, id?: string, reason?: string}` — **no git operations** (spec §4.2: registers `plugins: []`, `lastSync: null`; first sync happens via refresh). Sets `seededBuiltin: true` only on successful seed; once true, never seeds again (removal never resurrects).

- [ ] **Step 1: Write failing tests** (append to `test/marketplaces.test.mjs`; add `hostRepoRoot, seedBuiltinMarketplace` to the import list)

```js
test('seedBuiltinMarketplace: seeds once from an injected root, never resurrects after removal', () => {
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  const rootDir = join(scratch, 'host-root');
  mkdirSync(join(rootDir, '.git'), { recursive: true });
  writeFileSync(join(rootDir, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'Worca CC Official', description: 'bundled', plugins: [] }));
  const r1 = seedBuiltinMarketplace({ rootDir });
  assert.equal(r1.seeded, true);
  const entry = readMarketplaces().marketplaces[r1.id];
  assert.equal(entry.builtin, true);
  assert.equal(entry.name, 'Worca CC Official');
  assert.equal(entry.lastSync, null);
  assert.deepEqual(entry.plugins, []);
  assert.equal(seedBuiltinMarketplace({ rootDir }).seeded, false, 'idempotent');
  removeMarketplace(r1.id);
  assert.equal(seedBuiltinMarketplace({ rootDir }).seeded, false, 'removal never resurrects');
  assert.ok(!readMarketplaces().marketplaces[r1.id]);
});

test('seedBuiltinMarketplace: no host checkout -> not seeded, flag stays false', () => {
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  const r = seedBuiltinMarketplace({ rootDir: null });
  assert.equal(r.seeded, false);
  assert.equal(readMarketplaces().seededBuiltin, false, 'a later run from a real checkout can still seed');
});

test('hostRepoRoot: resolves to this repo (it has the marketplace manifest + .git)', () => {
  const root = hostRepoRoot();
  assert.ok(root, 'worca-cc checkout detected');
  assert.ok(existsSync(join(root, 'worca-cc-marketplace.json')));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/marketplaces.test.mjs`
Expected: new tests FAIL — functions not exported.

- [ ] **Step 3: Implement** (append to `src/core/marketplaces.mjs`)

```js
/** The checkout the host code runs from: two dirs above src/core/. Only a real
 *  marketplace checkout counts (must have worca-cc-marketplace.json + .git) —
 *  an npm-dist install without either returns null and seeding is skipped. */
export function hostRepoRoot() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return existsSync(join(root, 'worca-cc-marketplace.json')) && existsSync(join(root, '.git'))
    ? root : null;
}

/** First-run builtin seed (spec §4.2): register the host checkout as a
 *  local-path marketplace. NO git operations — plugins:[] / lastSync:null; the
 *  first sync happens via the Plugins view's background refresh or an explicit
 *  `worca marketplace refresh`. seededBuiltin is set only on success, so a
 *  removed builtin never auto-returns, while a non-checkout host stays eligible
 *  to seed on a later run from a real checkout. */
export function seedBuiltinMarketplace({ rootDir = hostRepoRoot() } = {}) {
  const state = readMarketplaces();
  if (state.seededBuiltin) return { seeded: false, reason: 'already-seeded' };
  if (!rootDir) return { seeded: false, reason: 'no-host-checkout' };
  const url = resolve(rootDir);
  const id = marketplaceId(url);
  let name = 'Worca CC Official';
  let description = '';
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, 'worca-cc-marketplace.json'), 'utf8'));
    if (typeof raw?.name === 'string' && raw.name.trim()) name = raw.name.trim();
    if (typeof raw?.description === 'string') description = raw.description.trim();
  } catch { /* keep defaults */ }
  if (!state.marketplaces[id]) {
    state.marketplaces[id] = {
      id, url, name, description, builtin: true,
      addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [],
    };
  }
  state.seededBuiltin = true;
  writeMarketplaces(state);
  return { seeded: true, id };
}
```

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/marketplaces.test.mjs`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/marketplaces.mjs test/marketplaces.test.mjs
git commit -m "feat(core): seed the host checkout as the builtin marketplace (seed-once, no git ops)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Lock provenance — `marketplace` field + richer `listInstalledPlugins`

**Files:**
- Modify: `src/core/plugin-store.mjs` (`installPlugin` signature at line 198 + lock write at 212-217; `listInstalledPlugins` at 388-407)
- Test: `test/marketplace-provenance.test.mjs`

**Interfaces:**
- Consumes: nothing new (Task 2's discovery already handles deep subdirs).
- Produces (used by Tasks 7, 8, 10):
  - `installPlugin({repoUrl, subdir, name, sha, marketplace}, {exec})` — `marketplace` optional string; when present, written to the lock entry verbatim.
  - `listInstalledPlugins()` rows gain `repo: string|null`, `subdir: string`, `marketplace: string|null` (the raw id; name resolution is the API layer's job).

- [ ] **Step 1: Write failing test**

```js
// test/marketplace-provenance.test.mjs — install stamps marketplace provenance
// into the lock; listInstalledPlugins surfaces repo/subdir/marketplace.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { installPlugin, listInstalledPlugins } from '../src/core/plugin-store.mjs';
import { readPluginsLock } from '../src/core/plugins-lock.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-prov-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}

test('installPlugin stamps marketplace id; listInstalledPlugins returns provenance', async () => {
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'plugins', 'prov', 'connector'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'), JSON.stringify({ name: 'M', plugins: ['plugins/prov'] }));
  writeFileSync(join(root, 'plugins', 'prov', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'prov-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'P', module: './connector/index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'prov', 'connector', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const sha = await git(root, 'rev-parse', 'HEAD');

  const res = await installPlugin({ repoUrl: root, subdir: 'plugins/prov', name: 'prov-plugin', sha, marketplace: 'm-id' });
  assert.equal(res.ok, true);
  assert.equal(readPluginsLock()['prov-plugin'].marketplace, 'm-id');

  const row = listInstalledPlugins().find((p) => p.name === 'prov-plugin');
  assert.equal(row.repo, root);
  assert.equal(row.subdir, 'plugins/prov');
  assert.equal(row.marketplace, 'm-id');
  assert.equal(row.broken, false, 'depth-2 install resolves through current/');
});

test('installPlugin without marketplace writes no marketplace key', async () => {
  // reuse the same repo; second plugin name via a fresh subdir is overkill —
  // uninstall is heavier than a second fixture, so make a tiny root-level repo.
  const root2 = join(scratch, 'repo2');
  mkdirSync(root2, { recursive: true });
  writeFileSync(join(root2, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'plain-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'P', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root2, 'index.mjs'), 'export default () => ({});\n');
  await git(root2, 'init', '-q', '-b', 'main');
  await git(root2, 'add', '-A');
  await git(root2, 'commit', '-qm', 'c1');
  const sha2 = await git(root2, 'rev-parse', 'HEAD');
  await installPlugin({ repoUrl: root2, subdir: '', name: 'plain-plugin', sha: sha2 });
  assert.ok(!('marketplace' in readPluginsLock()['plain-plugin']));
  assert.equal(listInstalledPlugins().find((p) => p.name === 'plain-plugin').marketplace, null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/marketplace-provenance.test.mjs`
Expected: FAIL on the `marketplace` / `repo` asserts.

- [ ] **Step 3: Implement**

In `src/core/plugin-store.mjs`:

Line 198 signature: `export async function installPlugin({ repoUrl, subdir = '', name, sha, marketplace } = {}, { exec = defaultExec } = {}) {`

Lock write (212-217) — add the conditional field:

```js
    lock[name] = {
      repo: repoUrl, subdir, pinnedSha: pin,
      version: manifest.version ?? pin.slice(0, 7), // no manifest version -> the SHA is the version (§4.1)
      enabled: true, installedAt: new Date().toISOString(),
      lockfileHash: sha256File(join(versionDir, 'package-lock.json')),
      ...(marketplace ? { marketplace } : {}),
    };
```

`listInstalledPlugins` return object — add three fields after `pinnedSha`:

```js
      pinnedSha: e.pinnedSha ?? null,
      repo: e.repo ?? null,
      subdir: e.subdir ?? '',
      marketplace: e.marketplace ?? null,
```

(`updatePlugin` spreads `...entry` at line 262, so the field survives updates with no change.)

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/marketplace-provenance.test.mjs test/api-plugins.test.mjs`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-store.mjs test/marketplace-provenance.test.mjs
git commit -m "feat(plugin-store): marketplace provenance in the lock + list output

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Server — marketplace endpoints, provenance merge, drop the transient scan, boot seed

**Files:**
- Modify: `ui/server.mjs` (imports ~77-86; routes in the `/api/plugins*` block 2730-3024; `isMain` boot block ~3330)
- Modify: `test/api-plugins.test.mjs` (its flow uses `POST /api/plugins/repo` — rewrite those calls)
- Test: `test/api-marketplaces.test.mjs`

**Interfaces:**
- Consumes: Tasks 4/5/6 exports.
- Produces (used by Tasks 8, 9):
  - `GET /api/marketplaces → {marketplaces: [Entry & {plugins: [{…, installed: boolean}]}]}`
  - `POST /api/marketplaces {url} → {ok:true, marketplace: Entry}`; 409 EXISTS, 400 bad/unreachable url
  - `POST /api/marketplaces/refresh → {ok:true, marketplaces: Entry[]}` (refresh-all; **registered BEFORE the `:id` route**)
  - `POST /api/marketplaces/:id/refresh → {ok:true, marketplace: Entry}` (sync failures are 200 + `warnings`)
  - `DELETE /api/marketplaces/:id → {ok:true}`; 404 unknown
  - `GET /api/plugins` rows gain `repo`, `subdir`, `marketplace`, `marketplaceName`
  - `POST /api/plugins/install` accepts optional `marketplace` (id string) in the body
  - `POST /api/plugins/repo` → **removed** (404)

- [ ] **Step 1: Write failing tests**

Create `test/api-marketplaces.test.mjs` (harness = `test/api-plugins.test.mjs`: import the app, ephemeral `http` server, `useTempHome`). Copy that file's lines 9-31 boilerplate (imports/fetch helpers) and its `before`/`after` app-boot pattern verbatim, then:

```js
// fixture: a marketplace repo with two depth-2 plugins
async function makeMarketRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-mktrepo-'));
  const plug = (name) => JSON.stringify({
    name, version: '0.1.0', description: `${name} fixture`,
    taskSources: [{ id: 'main', displayName: name, module: './index.mjs',
      configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true }],
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  });
  await mkdir(join(dir, 'plugins', 'aa'), { recursive: true });
  await mkdir(join(dir, 'plugins', 'bb'), { recursive: true });
  await writeFile(join(dir, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'API Fixture Market', description: 'x', plugins: ['plugins/aa', 'plugins/bb'] }));
  await writeFile(join(dir, 'plugins', 'aa', 'worca-cc-plugin.json'), plug('aa'));
  await writeFile(join(dir, 'plugins', 'aa', 'index.mjs'), 'export default () => ({ async validateConfig(){return {ok:true};} });\n');
  await writeFile(join(dir, 'plugins', 'bb', 'worca-cc-plugin.json'), plug('bb'));
  await writeFile(join(dir, 'plugins', 'bb', 'index.mjs'), 'export default () => ({ async validateConfig(){return {ok:true};} });\n');
  const git = (...args) => run('git', ['-C', dir, ...args]);
  await run('git', ['init', '-q', '-b', 'main', dir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture market');
  const { stdout } = await git('rev-parse', 'HEAD');
  return { dir, sha: stdout.trim() };
}

test('marketplace lifecycle: add -> list -> install (consent snapshot) -> remove keeps the install', async () => {
  const { dir, sha } = await makeMarketRepo();

  // add
  let r = await post('/api/marketplaces', { url: dir });
  assert.equal(r.status, 200, await r.text());
  const { marketplace } = await r.json();
  assert.equal(marketplace.name, 'API Fixture Market');
  assert.equal(marketplace.lastSync.sha, sha);
  assert.equal(marketplace.plugins.length, 2);
  assert.equal(marketplace.plugins[0].inventory.taskSources[0].secrets[0], 'token');

  // duplicate -> 409
  assert.equal((await post('/api/marketplaces', { url: dir })).status, 409);
  // junk -> 400
  assert.equal((await post('/api/marketplaces', { url: join(tmpdir(), 'nope-does-not-exist') })).status, 400);

  // list with installed flags (nothing installed yet)
  r = await get('/api/marketplaces');
  let list = (await r.json()).marketplaces;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].plugins.map((p) => p.installed), [false, false]);

  // install aa from the snapshot (depth-2 subdir!) with marketplace provenance
  r = await post('/api/plugins/install', {
    repoUrl: dir, subdir: 'plugins/aa', name: 'aa', sha, marketplace: marketplace.id,
  });
  assert.equal(r.status, 200, await r.text());

  // provenance in GET /api/plugins
  r = await get('/api/plugins');
  const row = (await r.json()).plugins.find((p) => p.name === 'aa');
  assert.equal(row.repo, dir);
  assert.equal(row.subdir, 'plugins/aa');
  assert.equal(row.marketplaceName, 'API Fixture Market');

  // installed flag in the marketplace listing
  list = (await (await get('/api/marketplaces')).json()).marketplaces;
  assert.deepEqual(list[0].plugins.map((p) => [p.name, p.installed]), [['aa', true], ['bb', false]]);

  // per-marketplace refresh works and is registered after the literal /refresh route
  assert.equal((await post(`/api/marketplaces/${marketplace.id}/refresh`, {})).status, 200);
  assert.equal((await post('/api/marketplaces/refresh', {})).status, 200);

  // remove marketplace -> discovery gone, installed plugin remains fully functional
  assert.equal((await del(`/api/marketplaces/${marketplace.id}`)).status, 200);
  assert.equal((await (await get('/api/marketplaces')).json()).marketplaces.length, 0);
  r = await get('/api/plugins');
  assert.ok((await r.json()).plugins.find((p) => p.name === 'aa'), 'installed plugin survives');
  const upd = await post('/api/plugins/aa/update', {});
  assert.equal(upd.status, 200, 'update preview still works from lock provenance');

  // unknown id -> 404
  assert.equal((await del('/api/marketplaces/ghost')).status, 404);
});

test('POST /api/plugins/repo is gone', async () => {
  const r = await post('/api/plugins/repo', { url: '/tmp/x' });
  assert.equal(r.status, 404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/api-marketplaces.test.mjs`
Expected: FAIL — 404s on `/api/marketplaces`.

- [ ] **Step 3: Implement in `ui/server.mjs`**

(a) Imports (next to the existing plugin imports at ~77-86):

```js
import {
  addMarketplace, listMarketplaces, syncMarketplace, refreshAllMarketplaces,
  removeMarketplace, readMarketplaces, seedBuiltinMarketplace,
} from '../src/core/marketplaces.mjs';
```

(b) In `pluginErrorStatus` (line 2754), add: `if (code === 'EXISTS') return 409;`

(c) After the `requirePlugin` helper, add:

```js
const MARKETPLACE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
function requireMarketplace(req, res) {
  const id = req.params.id;
  if (!MARKETPLACE_ID_RE.test(id) || !readMarketplaces().marketplaces[id]) {
    res.status(404).json({ error: 'marketplace not found' });
    return null;
  }
  return id;
}
```

(d) Replace the `POST /api/plugins/repo` route (2811-2827) with the marketplace block:

```js
// Marketplaces (spec §4.7): the persisted repo registry behind the Plugins
// view's Available/Marketplaces sections. Snapshots are cached in
// marketplaces.json, so GET is zero-network; refresh routes do the git work.
app.get('/api/marketplaces', (req, res) => {
  try {
    const lock = readPluginsLock();
    res.json({
      marketplaces: listMarketplaces().map((m) => ({
        ...m,
        plugins: (m.plugins || []).map((p) => ({ ...p, installed: !!lock[p.name] })),
      })),
    });
  } catch (err) { sendPluginError(res, err); }
});

app.post('/api/marketplaces', async (req, res) => {
  const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (!url) return badRequest(res, 'url is required');
  try {
    res.json({ ok: true, marketplace: await addMarketplace(url) });
  } catch (err) { sendPluginError(res, err); }
});

// Literal route FIRST — express matches in registration order, so declaring it
// after the :id route would swallow "refresh" as an id.
app.post('/api/marketplaces/refresh', async (req, res) => {
  try {
    res.json({ ok: true, marketplaces: await refreshAllMarketplaces() });
  } catch (err) { sendPluginError(res, err); }
});

app.post('/api/marketplaces/:id/refresh', async (req, res) => {
  const id = requireMarketplace(req, res);
  if (!id) return;
  try {
    res.json({ ok: true, marketplace: await syncMarketplace(id) });
  } catch (err) { sendPluginError(res, err); }
});

app.delete('/api/marketplaces/:id', (req, res) => {
  const id = requireMarketplace(req, res);
  if (!id) return;
  try {
    res.json(removeMarketplace(id));
  } catch (err) { sendPluginError(res, err); }
});
```

Then delete the now-unused `inventoryFromCache` import IF `POST /api/plugins/repo` was its last user (it was — Task 3 wired it there only; `marketplaces.mjs` imports it directly).

(e) `GET /api/plugins` (2801-2807) — merge marketplace names:

```js
app.get('/api/plugins', (req, res) => {
  try {
    const mkts = readMarketplaces().marketplaces;
    res.json({
      plugins: listInstalledPlugins().map((p) => ({
        ...p,
        marketplaceName: p.marketplace && mkts[p.marketplace] ? mkts[p.marketplace].name : null,
      })),
      orphans: listOrphanPluginData(),
    });
  } catch (err) {
    sendPluginError(res, err);
  }
});
```

(f) `POST /api/plugins/install` (2832-2847) — thread the optional marketplace id:

```js
  const subdir = typeof body.subdir === 'string' ? body.subdir : '';
  const marketplace = typeof body.marketplace === 'string' && MARKETPLACE_ID_RE.test(body.marketplace)
    ? body.marketplace : undefined;
  try {
    const out = await installPlugin({
      repoUrl: body.repoUrl.trim(), subdir, name: body.name.trim(), sha: body.sha.trim(), marketplace,
    });
```

(g) Boot seed — in the `isMain` block (~3330), immediately before `bootMaintenance().catch(...)`:

```js
  try {
    seedBuiltinMarketplace();
  } catch (err) {
    console.error(`[worca-ui] builtin marketplace seed skipped: ${err && err.message ? err.message : err}`);
  }
```

(h) Fix `test/api-plugins.test.mjs`: `grep -n "/api/plugins/repo" test/api-plugins.test.mjs`. Rewrite each hit: the discovery assertions move to `POST /api/marketplaces` + `GET /api/marketplaces` (the snapshot's `plugins[].inventory` replaces the scan's `discovered[].inventory`); install calls already POST `/api/plugins/install` directly with `{repoUrl, subdir, name, sha}` from the fixture, so they keep working — only scan-shaped assertions change. Preserve every behavioral assertion (inventory contents, consent fields), just re-route where the data comes from.

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/api-marketplaces.test.mjs test/api-plugins.test.mjs test/api-sources.test.mjs`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/api-marketplaces.test.mjs test/api-plugins.test.mjs
git commit -m "feat(api): marketplace endpoints; retire the transient repo scan

GET/POST/DELETE /api/marketplaces (+refresh, refresh-all), installed-flag and
provenance merges, optional marketplace id on install, builtin seed at boot.
POST /api/plugins/repo is superseded and removed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Renderers — Available cards, Marketplaces rows, installed provenance line

**Files:**
- Modify: `ui/public/plugins-view.mjs` (add `renderAvailableList`, `renderMarketplaceList`; extend `renderPluginList`)
- Test: `test/plugins-view.test.mjs` (append)

**Interfaces:**
- Consumes: `GET /api/marketplaces` Entry shape (Task 7) incl. `plugins[].installed`; `GET /api/plugins` rows incl. `repo`/`marketplaceName`/`pinnedSha`.
- Produces (used by Task 9):
  - `renderAvailableList(marketplaces, {doc}) → <div.pl-available>` — install buttons are `.pl-install-avail` with `data-name` + `data-marketplace`; installed plugins get a `.pl-installed` badge instead; a never-synced marketplace renders no install button.
  - `renderMarketplaceList(marketplaces, {doc}) → <div.pl-mkts>` — per-row buttons `.pl-mkt-refresh` / `.pl-mkt-remove` with `data-id`.
  - `renderPluginList` cards additionally render `<small.pl-provenance>` when `repo`/`marketplaceName` present.

- [ ] **Step 1: Write failing tests** (append to `test/plugins-view.test.mjs`; extend the import at lines 6-10 with `renderAvailableList, renderMarketplaceList`)

```js
const MKT = {
  id: 'm-1', url: '/tmp/m1', name: 'Fixture Market', description: 'x', builtin: true,
  addedAt: '2026-08-17T00:00:00Z',
  lastSync: { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', at: '2026-08-17T10:00:00Z' },
  warnings: ['worca-cc-marketplace.json: bad/entry — skipped'],
  plugins: [
    { name: 'aa', subdir: 'plugins/aa', description: 'first', version: '1.0.0', installed: false, inventory: {} },
    { name: 'bb', subdir: 'plugins/bb', description: 'second', version: null, installed: true, inventory: {} },
  ],
};

test('renderAvailableList: install button only for non-installed; marketplace badge; installed tag', () => {
  const el = renderAvailableList([MKT], { doc });
  const cards = el.querySelectorAll('.pl-avail-card');
  assert.equal(cards.length, 2);
  const btn = cards[0].querySelector('.pl-install-avail');
  assert.ok(btn);
  assert.equal(btn.dataset.name, 'aa');
  assert.equal(btn.dataset.marketplace, 'm-1');
  assert.match(cards[0].querySelector('.pl-mkt-badge').textContent, /Fixture Market/);
  assert.ok(!cards[1].querySelector('.pl-install-avail'), 'installed plugin has no install button');
  assert.match(cards[1].querySelector('.pl-installed').textContent, /Installed/);
});

test('renderAvailableList: never-synced marketplace disables install; empty states', () => {
  const unsynced = { ...MKT, id: 'm-2', lastSync: null, plugins: [{ name: 'cc', subdir: '', description: '', version: null, installed: false, inventory: {} }] };
  const el = renderAvailableList([unsynced], { doc });
  assert.ok(!el.querySelector('.pl-install-avail'), 'no install button before first sync');
  assert.match(renderAvailableList([], { doc }).textContent, /No marketplaces yet/);
  assert.match(renderAvailableList([{ ...MKT, plugins: [] }], { doc }).textContent, /No plugins discovered/);
});

test('renderMarketplaceList: builtin badge, sync line, warnings, action buttons', () => {
  const el = renderMarketplaceList([MKT], { doc });
  const row = el.querySelector('.pl-mkt-row');
  assert.equal(row.dataset.id, 'm-1');
  assert.match(row.querySelector('.pl-mkt-builtin').textContent, /built-in/);
  assert.match(row.querySelector('.pl-mkt-sync').textContent, /a1b2c3d.*2 plugins/);
  assert.match(row.querySelector('.pl-mkt-warning').textContent, /bad\/entry/);
  assert.equal(row.querySelector('.pl-mkt-refresh').dataset.id, 'm-1');
  assert.equal(row.querySelector('.pl-mkt-remove').dataset.id, 'm-1');
  const never = renderMarketplaceList([{ ...MKT, id: 'm-3', lastSync: null, warnings: [] }], { doc });
  assert.match(never.querySelector('.pl-mkt-sync').textContent, /never synced/);
});

test('renderPluginList: provenance line renders marketplace + repo @ sha7', () => {
  const el = renderPluginList([{
    name: 'aa', version: '1.0.0', pinnedSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    enabled: true, linked: false, broken: false,
    contributions: { agents: 0, taskSources: 1, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
    repo: '/tmp/m1', subdir: 'plugins/aa', marketplace: 'm-1', marketplaceName: 'Fixture Market',
  }], { doc });
  const prov = el.querySelector('.pl-provenance');
  assert.ok(prov);
  assert.match(prov.textContent, /Fixture Market · \/tmp\/m1 @ a1b2c3d/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugins-view.test.mjs`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement** (append to `ui/public/plugins-view.mjs`, plus one insertion in `renderPluginList`)

In `renderPluginList`, right after the `pl-contrib` line (line 54), insert:

```js
    if (p.repo || p.marketplaceName) {
      const prov = [p.marketplaceName, p.repo].filter(Boolean).join(' · ');
      card.appendChild(h(doc, 'small', 'pl-provenance hint mono',
        p.pinnedSha ? `${prov} @ ${sha7(p.pinnedSha)}` : prov));
    }
```

Append the two renderers:

```js
// renderAvailableList(marketplaces) -> <div.pl-available> of installable cards
// across every marketplace snapshot (GET /api/marketplaces). Install buttons
// carry data-name + data-marketplace for app.js's delegated listener; installed
// plugins render a badge instead; a never-synced marketplace renders no button
// (there is no sha to pin yet — Refresh first).
export function renderAvailableList(marketplaces, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-available');
  const mkts = marketplaces || [];
  let cards = 0;
  for (const m of mkts) {
    for (const p of m.plugins || []) {
      cards++;
      const card = h(doc, 'section', 'card pl-avail-card');
      card.dataset.name = p.name;
      card.dataset.marketplace = m.id;
      const head = h(doc, 'div', 'pl-head');
      head.appendChild(h(doc, 'b', 'pl-name', p.name));
      head.appendChild(h(doc, 'span', 'pl-version mono', p.version || sha7(m.lastSync && m.lastSync.sha)));
      head.appendChild(h(doc, 'span', 'badge waiting pl-mkt-badge', m.name || m.id));
      if (p.installed) {
        head.appendChild(h(doc, 'span', 'badge green pl-installed', 'Installed'));
      } else if (m.lastSync) {
        const b = h(doc, 'button', 'btn btn-primary btn-mini pl-install-avail', 'Install…');
        b.type = 'button';
        b.dataset.name = p.name;
        b.dataset.marketplace = m.id;
        head.appendChild(b);
      }
      card.appendChild(head);
      if (p.description) card.appendChild(h(doc, 'small', 'hint', p.description));
      root.appendChild(card);
    }
  }
  if (!mkts.length) root.appendChild(h(doc, 'div', 'hist-empty', 'No marketplaces yet — add one below.'));
  else if (!cards) root.appendChild(h(doc, 'div', 'hist-empty', 'No plugins discovered in your marketplaces.'));
  return root;
}

// renderMarketplaceList(marketplaces) -> <div.pl-mkts> of registry rows with
// Refresh/Remove buttons (data-id). Sync failures surface as .pl-mkt-warning
// lines; the snapshot stays usable (stale) per spec §4.6.
export function renderMarketplaceList(marketplaces, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'pl-mkts');
  for (const m of marketplaces || []) {
    const row = h(doc, 'div', 'card pl-mkt-row');
    row.dataset.id = m.id;
    const head = h(doc, 'div', 'pl-head');
    head.appendChild(h(doc, 'b', 'pl-name', m.name || m.id));
    if (m.builtin) head.appendChild(h(doc, 'span', 'badge waiting pl-mkt-builtin', 'built-in'));
    for (const [cls, label] of [['pl-mkt-refresh', 'Refresh'], ['pl-mkt-remove', 'Remove']]) {
      const b = h(doc, 'button', `btn-ghost ${cls}`, label);
      b.type = 'button';
      b.dataset.id = m.id;
      head.appendChild(b);
    }
    row.appendChild(head);
    row.appendChild(h(doc, 'small', 'pl-mkt-url hint mono', m.url));
    const n = (m.plugins || []).length;
    row.appendChild(h(doc, 'small', 'pl-mkt-sync hint', m.lastSync
      ? `${sha7(m.lastSync.sha)} · synced ${String(m.lastSync.at).slice(0, 16).replace('T', ' ')} · ${n} plugin${n === 1 ? '' : 's'}`
      : 'never synced — refresh to discover plugins'));
    for (const w of m.warnings || []) row.appendChild(h(doc, 'div', 'pl-mkt-warning hint err', w));
    root.appendChild(row);
  }
  if (!(marketplaces || []).length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'No marketplaces registered.'));
  }
  return root;
}
```

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugins-view.test.mjs test/plugin-provenance-ui.test.mjs`
Expected: ALL PASS (provenance-ui test exercises existing cards — the new `<small>` must not break it; if it asserts exact child counts, update it and say so in the commit).

- [ ] **Step 5: Commit**

```bash
git add ui/public/plugins-view.mjs test/plugins-view.test.mjs
git commit -m "feat(ui): available-plugins + marketplace renderers, installed provenance line

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Plugins view wiring — markup, loaders, listeners, styles

**Files:**
- Modify: `ui/public/index.html` (plugins section 730-750)
- Modify: `ui/public/app.js` (element cache ~243-249; plugins block 6342-6522)
- Modify: `ui/public/style.css` (append near the `.plugin-card` block ~1200)

**Interfaces:**
- Consumes: Task 7 endpoints, Task 8 renderers (import them in the existing `plugins-view.mjs` import at app.js:62-71).
- Produces: the user-facing feature. No exports.

- [ ] **Step 1: Replace the plugins section markup** (`index.html` 730-750)

```html
        <!-- ===== VIEW: PLUGINS ===== -->
        <section class="view hidden" data-view="plugins">
          <div class="topbar">
            <div>
              <h1>Plugins</h1>
              <div class="sub">Task sources, agents, skills and workflow packs from your plugin marketplaces</div>
            </div>
            <button type="button" id="plugin-add-btn" class="btn-go" style="padding:11px 20px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>
              Add marketplace
            </button>
          </div>
          <p id="plugins-msg" class="form-msg" aria-live="polite"></p>
          <div class="card hidden" id="marketplace-add-row" style="padding:16px 20px;margin-bottom:14px">
            <div class="path-row">
              <input id="marketplace-url" class="input" type="text" placeholder="https://github.com/owner/repo · owner/repo · /abs/path/to/repo" spellcheck="false" />
              <button type="button" id="marketplace-add" class="btn btn-primary btn-mini">Add</button>
            </div>
          </div>
          <h3 class="pl-sec-title">Installed</h3>
          <div class="run-list" id="plugins-list"></div>
          <h3 class="pl-sec-title">Available</h3>
          <div class="run-list" id="plugins-available"></div>
          <h3 class="pl-sec-title">Marketplaces</h3>
          <div class="run-list" id="marketplaces-list"></div>
        </section>
        <!-- /view plugins -->
```

- [ ] **Step 2: Element cache** (`app.js` ~243-249) — replace the four scan-era entries:

```js
  pluginsList: $('#plugins-list'),
  pluginsAvailable: $('#plugins-available'),
  marketplacesList: $('#marketplaces-list'),
  pluginAddBtn: $('#plugin-add-btn'),
  marketplaceAddRow: $('#marketplace-add-row'),
  marketplaceUrl: $('#marketplace-url'),
  marketplaceAdd: $('#marketplace-add'),
```

(delete `pluginAddRow`, `pluginRepoUrl`, `pluginRepoScan`, `pluginDiscovered`; keep the `pluginModal*` entries.)

- [ ] **Step 3: Rework the plugins block in app.js**

Extend the plugins-view import (app.js:62-71 region) with `renderAvailableList, renderMarketplaceList`.

Replace `loadPluginsView` (6342-6357) and `scanPluginRepo` (6359-6383) with:

```js
// Snapshot of the last GET /api/marketplaces payload — the delegated install
// listener resolves the consent inventory from here (no re-fetch, no network).
let pluginsViewMarketplaces = [];

function renderMarketplaceSections(list) {
  pluginsViewMarketplaces = list || [];
  el.pluginsAvailable.replaceChildren(renderAvailableList(pluginsViewMarketplaces));
  el.marketplacesList.replaceChildren(renderMarketplaceList(pluginsViewMarketplaces));
}

async function loadPluginsView() {
  setPluginsMsg('');
  try {
    const [pRes, mRes] = await Promise.all([fetch('/api/plugins'), fetch('/api/marketplaces')]);
    const data = await safeJson(pRes);
    if (!pRes.ok) return setPluginsMsg(data.error || `HTTP ${pRes.status}`, 'err');
    let channelStatus = [];
    try {
      const cs = await safeJson(await fetch('/api/chat/status'));
      channelStatus = cs.channels || [];
    } catch { /* chat host unavailable: cards render without badges */ }
    const parts = [renderPluginList(data.plugins || [], { channelStatus })];
    if (Array.isArray(data.orphans) && data.orphans.length) parts.push(renderOrphanList(data.orphans));
    el.pluginsList.replaceChildren(...parts);
    const mData = await safeJson(mRes);
    renderMarketplaceSections(mRes.ok ? mData.marketplaces || [] : []);
  } catch (e) { setPluginsMsg(e.message, 'err'); }
  refreshMarketplacesInBackground();
}

// Stale-while-revalidate (spec §4.6): render cached snapshots instantly, then
// one background refresh-all; re-render on completion. Failures keep the stale
// snapshot (per-marketplace warnings arrive in the payload).
let marketplaceRefreshInFlight = false;
async function refreshMarketplacesInBackground() {
  if (marketplaceRefreshInFlight) return;
  marketplaceRefreshInFlight = true;
  try {
    const { ok, data } = await pluginApi('POST', '/api/marketplaces/refresh');
    if (ok) renderMarketplaceSections(data.marketplaces || []);
  } catch { /* keep stale */ } finally {
    marketplaceRefreshInFlight = false;
  }
}

async function addMarketplaceFromInput() {
  const url = (el.marketplaceUrl.value || '').trim();
  if (!url) return setPluginsMsg('Enter a marketplace repo (https://github.com/owner/repo, owner/repo, or a local path).', 'err');
  el.marketplaceAdd.disabled = true;
  setPluginsMsg('Adding marketplace…');
  const { ok, data } = await pluginApi('POST', '/api/marketplaces', { url });
  el.marketplaceAdd.disabled = false;
  if (!ok) return setPluginsMsg(data.error || 'add failed', 'err');
  el.marketplaceUrl.value = '';
  el.marketplaceAddRow.classList.add('hidden');
  setPluginsMsg(`Added ${data.marketplace.name} (${data.marketplace.plugins.length} plugins).`, 'ok');
  loadPluginsView();
}
```

Update `openInstallConsent` (6385-6399): add the marketplace id to the POST body — change the payload line to:

```js
      const { ok, data } = await pluginApi('POST', '/api/plugins/install',
        { repoUrl: entry.repoUrl, subdir: entry.subdir, name: entry.name, sha: entry.sha,
          ...(entry.marketplace ? { marketplace: entry.marketplace } : {}) });
```

Add two delegated listeners after the existing `el.pluginsList` one (6442-6512):

```js
// Available section: Install… resolves the snapshot entry from the last
// /api/marketplaces payload and opens the same consent modal as before.
if (el.pluginsAvailable) el.pluginsAvailable.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.classList || !t.classList.contains('pl-install-avail')) return;
  const m = pluginsViewMarketplaces.find((x) => x.id === t.dataset.marketplace);
  const p = m && (m.plugins || []).find((x) => x.name === t.dataset.name);
  if (!m || !p || !m.lastSync) return;
  openInstallConsent({
    name: p.name, subdir: p.subdir, repoUrl: m.url, sha: m.lastSync.sha,
    inventory: p.inventory || {}, marketplace: m.id,
  });
});

// Marketplaces section: Refresh / Remove.
if (el.marketplacesList) el.marketplacesList.addEventListener('click', async (e) => {
  const t = e.target;
  const id = t && t.dataset ? t.dataset.id : '';
  if (!id) return;
  if (t.classList.contains('pl-mkt-refresh')) {
    setPluginsMsg('Refreshing marketplace…');
    const { ok, data } = await pluginApi('POST', `/api/marketplaces/${encodeURIComponent(id)}/refresh`, {});
    setPluginsMsg(ok ? '' : (data.error || 'refresh failed'), ok ? undefined : 'err');
    if (ok) loadPluginsView();
  } else if (t.classList.contains('pl-mkt-remove')) {
    const sure = await confirmModal({
      title: 'Remove marketplace',
      message: 'Removes plugin discovery from this marketplace. Installed plugins are not affected.',
      confirmLabel: 'Remove',
    });
    if (!sure || sure.ok === false) return;
    const { ok, data } = await pluginApi('DELETE', `/api/marketplaces/${encodeURIComponent(id)}`);
    if (!ok) return setPluginsMsg(data.error || 'remove failed', 'err');
    setPluginsMsg('Marketplace removed. Installed plugins remain.', 'ok');
    loadPluginsView();
  }
});
```

(Check `confirmModal`'s return convention against the existing purge-orphan usage at 6501-6506 — it is used both as `if (!sure)` and `if (!res.ok)`; mirror the purge-orphan pattern exactly.)

Replace the add-button wiring (6514-6518):

```js
if (el.pluginAddBtn) el.pluginAddBtn.addEventListener('click', () => {
  el.marketplaceAddRow.classList.toggle('hidden');
  if (!el.marketplaceAddRow.classList.contains('hidden')) el.marketplaceUrl.focus();
});
if (el.marketplaceAdd) el.marketplaceAdd.addEventListener('click', addMarketplaceFromInput);
```

- [ ] **Step 4: Styles** (append to `ui/public/style.css` near the `.plugin-card` rules ~1200):

```css
.pl-sec-title { margin: 22px 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; opacity: .65; }
.pl-provenance { display: block; margin-top: 4px; }
.pl-mkt-url { display: block; margin-top: 2px; }
.pl-mkt-sync { display: block; margin-top: 2px; }
.pl-mkt-warning { margin-top: 4px; }
.pl-avail-card .pl-mkt-badge { margin-left: 6px; }
```

- [ ] **Step 5: Verify**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/plugins-view.test.mjs test/api-marketplaces.test.mjs` — PASS.
Then manual smoke: `npm start`, open the Plugins view:
1. Builtin "Worca CC Official" row appears (seeded at boot), initially "never synced", then the background refresh populates 5 Available cards.
2. Install github-source from Available → consent modal shows the token secret → installs → card moves to Installed with a provenance line.
3. Remove the builtin marketplace → confirm-modal wording → Available empties, github-source stays installed and its Update button still previews.
4. Re-add by local path via Add marketplace.
Stop the server; if anything misbehaves, fix before committing.

- [ ] **Step 6: Commit**

```bash
git add ui/public/index.html ui/public/app.js ui/public/style.css
git commit -m "feat(ui): Plugins view marketplace sections (Installed / Available / Marketplaces)

Replaces the transient Add-repo scan with persisted marketplaces: add by URL or
path, background stale-while-revalidate refresh, install from cached snapshots,
remove with installed-plugins-remain messaging.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: CLI — `worca marketplace` namespace + `plugin install` resolution

**Files:**
- Modify: `src/cli/worca-cc.mjs` (help 798-818; `cmdPlugin` cases `add` 1070-1086 and `install` 1088-1123; `list` empty-message 1128; new `cmdMarketplace` + `MARKETPLACE_HELP`; dispatch at 1343)
- Test: `test/cli-marketplace.test.mjs`

**Interfaces:**
- Consumes: Task 4/5 exports (`addMarketplace`, `listMarketplaces`, `syncMarketplace`, `refreshAllMarketplaces`, `removeMarketplace`, `seedBuiltinMarketplace`, `resolveInstallSource`).
- Produces: `worca marketplace add|list|refresh|remove`, `worca plugin add` alias, `worca plugin install <name>` marketplace resolution with new `--marketplace <id>` flag.

- [ ] **Step 1: Write failing tests**

```js
// test/cli-marketplace.test.mjs — `worca marketplace <verb>` family + install
// resolution through marketplace snapshots. Harness mirrors test/cli-plugin.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const execFileP = promisify(execFile);

useTempHome(after);
const created = [];
const scratchCwd = mkdtempSync(join(tmpdir(), 'worca-cc-cli-mkt-cwd-'));
created.push(scratchCwd);
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

function run(args, { home } = {}) {
  return new Promise((res) => {
    const env = { ...process.env, WORCA_MOCK: '1' };
    if (home) env.WORCA_HOME = home;
    const child = spawn(process.execPath, [CLI, ...args], {
      env, cwd: scratchCwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

async function makeMarketRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mktrepo-'));
  created.push(dir);
  await mkdir(join(dir, 'plugins', 'cli-demo'), { recursive: true });
  await writeFile(join(dir, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'CLI Market', plugins: ['plugins/cli-demo'] }));
  await writeFile(join(dir, 'plugins', 'cli-demo', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'cli-demo', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'Demo', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  await writeFile(join(dir, 'plugins', 'cli-demo', 'index.mjs'), 'export default () => ({});\n');
  const git = (...args) => execFileP('git', ['-C', dir, ...args]);
  await execFileP('git', ['init', '-q', '-b', 'main', dir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture');
  return dir;
}

test('marketplace add/list/refresh/remove lifecycle; builtin seeded on first use', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt-'));
  created.push(home);
  const dir = await makeMarketRepo();

  const add = await run(['marketplace', 'add', dir], { home });
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /CLI Market/);
  assert.match(add.stdout, /cli-demo/);

  const list = await run(['marketplace', 'list'], { home });
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /CLI Market/);
  assert.match(list.stdout, /Worca CC Official/, 'builtin seeded from the host checkout');

  const dup = await run(['marketplace', 'add', dir], { home });
  assert.equal(dup.code, 1);
  assert.match(dup.stderr, /already added/);

  const refresh = await run(['marketplace', 'refresh'], { home });
  assert.equal(refresh.code, 0, refresh.stderr);

  // remove needs the id: parse it from list output (second column, tab-separated)
  const idLine = list.stdout.split('\n').find((l) => l.includes('CLI Market'));
  const id = idLine.split('\t')[1];
  const rm1 = await run(['marketplace', 'remove', id, '--yes'], { home });
  assert.equal(rm1.code, 0, rm1.stderr);
  assert.match(rm1.stdout, /installed plugins remain/i);
  assert.doesNotMatch((await run(['marketplace', 'list'], { home })).stdout, /CLI Market/);
});

test('plugin install resolves the repo through marketplace snapshots (no --repo)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt2-'));
  created.push(home);
  const dir = await makeMarketRepo();
  assert.equal((await run(['marketplace', 'add', dir], { home })).code, 0);
  const inst = await run(['plugin', 'install', 'cli-demo', '--yes'], { home });
  assert.equal(inst.code, 0, inst.stderr);
  assert.match(inst.stdout, /installed:/);
  const list = await run(['plugin', 'list'], { home });
  assert.match(list.stdout, /cli-demo/);
});

test('plugin add is a marketplace-add alias', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-cli-mkt3-'));
  created.push(home);
  const dir = await makeMarketRepo();
  const r = await run(['plugin', 'add', dir], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /marketplace/i);
  assert.match((await run(['marketplace', 'list'], { home })).stdout, /CLI Market/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/cli-marketplace.test.mjs`
Expected: FAIL — unknown `marketplace` subcommand.

- [ ] **Step 3: Implement in `src/cli/worca-cc.mjs`**

(a) `MARKETPLACE_HELP` next to `PLUGIN_HELP`:

```js
const MARKETPLACE_HELP = `worca marketplace — manage plugin marketplaces (repos whose plugins show up as installable)

Usage:
  worca marketplace add <repo-url|owner/repo|path>   Register + sync a marketplace
  worca marketplace list                             Registered marketplaces + their plugins
  worca marketplace refresh [id]                     Re-sync one marketplace (or all)
  worca marketplace remove <id> [--yes]              Unregister (installed plugins remain)

Removing a marketplace only removes discovery — already-installed plugins keep
working, including updates (install provenance lives in plugins.lock.json).
Exit codes: 0 ok, 1 failure, 2 usage/validation errors.
`;
```

(b) `cmdMarketplace` (below `cmdPlugin`):

```js
/** `worca marketplace <verb> …` — dispatch. Seeds the builtin marketplace
 *  lazily (a no-op file write after the first time; never any git work). */
async function cmdMarketplace(argv) {
  const verb = argv[0];
  const rest = argv.slice(1);
  if (!verb || verb === 'help') {
    process.stdout.write(MARKETPLACE_HELP);
    return 0;
  }
  const mkt = await import('../core/marketplaces.mjs');
  try { mkt.seedBuiltinMarketplace(); } catch { /* non-checkout install: skip */ }
  try {
    switch (verb) {
      case 'add': {
        const a = pluginArgs(rest);
        const url = a._[0];
        if (!url) fail('Usage: worca marketplace add <repo-url|owner/repo|path>');
        const entry = await mkt.addMarketplace(url);
        out(`added marketplace ${entry.name}\t${entry.id}\t@ ${entry.lastSync.sha.slice(0, 7)}`);
        for (const p of entry.plugins) out(`  ${p.name}\t${p.version || ''}\t${p.description || ''}`);
        for (const w of entry.warnings) out(c('yellow', `  warning: ${w}`));
        out(`install with: worca plugin install <name>`);
        return 0;
      }
      case 'list': {
        const entries = mkt.listMarketplaces();
        if (!entries.length) {
          out('No marketplaces registered. Add one with `worca marketplace add <repo-url>`.');
          return 0;
        }
        for (const m of entries) {
          const sync = m.lastSync ? `${m.lastSync.sha.slice(0, 7)} (${m.plugins.length} plugins)` : 'never synced';
          out(`${m.name}\t${m.id}\t${m.url}\t${sync}${m.builtin ? '\tbuilt-in' : ''}`);
          for (const w of m.warnings || []) out(c('yellow', `  warning: ${w}`));
        }
        return 0;
      }
      case 'refresh': {
        const a = pluginArgs(rest);
        const entries = a._[0] ? [await mkt.syncMarketplace(a._[0])] : await mkt.refreshAllMarketplaces();
        for (const m of entries) {
          const sync = m.lastSync ? `${m.lastSync.sha.slice(0, 7)} (${m.plugins.length} plugins)` : 'never synced';
          out(`${m.name}\t${sync}`);
          for (const w of m.warnings || []) out(c('yellow', `  warning: ${w}`));
        }
        return 0;
      }
      case 'remove': {
        const a = pluginArgs(rest, [], ['--yes']);
        const id = a._[0];
        if (!id) fail('Usage: worca marketplace remove <id> [--yes]');
        if (!(await confirmPlugin(`Remove marketplace "${id}"? Installed plugins remain.`, !!a.yes))) {
          out('aborted');
          return 1;
        }
        mkt.removeMarketplace(id);
        out(`removed marketplace ${id} — installed plugins remain (managed via worca plugin …)`);
        return 0;
      }
      default:
        fail(`unknown marketplace verb "${verb}" — see: worca marketplace help`);
    }
  } catch (err) {
    if (err && err.code === 'USAGE') throw err; // fail() escapes untouched
    process.stderr.write(`${err && err.message ? err.message : err}\n`);
    return 1;
  }
  return 1;
}
```

**Check how `fail()` signals usage errors** (`worca-cc.mjs:151`) — if it throws a tagged error or calls `process.exit(2)`, mirror `cmdPlugin`'s existing handling instead of the `err.code === 'USAGE'` guard above (read `cmdPlugin`'s catch block and copy its idiom exactly).

(c) Dispatch — next to line 1343 `if (sub === 'plugin') return cmdPlugin(rest);` add:

```js
    if (sub === 'marketplace') return cmdMarketplace(rest);
```

(d) `cmdPlugin` case `'add'` (1070-1086) becomes the alias:

```js
      case 'add': {
        const a = pluginArgs(rest);
        const url = a._[0];
        if (!url) fail('Usage: worca plugin add <repo-url>  (alias of: worca marketplace add)');
        out('note: `worca plugin add` now registers a marketplace (persisted) — same as `worca marketplace add`');
        return cmdMarketplace(['add', url]);
      }
```

(e) `cmdPlugin` case `'install'` — replace the resolution block (1089-1101) with:

```js
        const a = pluginArgs(rest, ['--repo', '--ref', '--marketplace'], ['--yes']);
        const name = a._[0];
        if (!name) fail('Usage: worca plugin install <name> [--repo <url>] [--marketplace <id>] [--ref <sha>] [--yes]');
        const mkt = await import('../core/marketplaces.mjs');
        try { mkt.seedBuiltinMarketplace(); } catch { /* non-checkout install */ }
        let repoUrl = a.repo;
        let marketplace = a.marketplace || null;
        if (!repoUrl && marketplace) {
          const m = mkt.listMarketplaces().find((x) => x.id === marketplace);
          if (!m) fail(`unknown marketplace "${marketplace}" — see: worca marketplace list`);
          repoUrl = m.url;
        }
        if (!repoUrl) {
          const hit = mkt.resolveInstallSource(name, {});
          if (hit && hit.candidates) {
            process.stderr.write(`plugin "${name}" exists in ${hit.candidates.length} marketplaces — pick one with --marketplace:\n`);
            for (const cnd of hit.candidates) process.stderr.write(`  --marketplace ${cnd.marketplace}\t${cnd.repoUrl}\n`);
            return 1;
          }
          if (hit) {
            repoUrl = hit.repoUrl;
            marketplace = marketplace ?? hit.marketplace;
          }
        }
        if (!repoUrl) fail(`plugin "${name}" not found in the lock or any marketplace — pass --repo <url> (or add a marketplace first)`);
        const found = await repoMod.addPluginRepo(repoUrl);
        const entry = found.discovered.find((d) => d.name === name);
        if (!entry) {
          process.stderr.write(`plugin "${name}" not found in ${repoUrl} (discovered: ${found.discovered.map((d) => d.name).join(', ') || 'none'})\n`);
          return 1;
        }
        const sha = a.ref || found.sha;
```

and change the install call (1119) to `store.installPlugin({ repoUrl, subdir: entry.subdir, name, sha, ...(marketplace ? { marketplace } : {}) });`
(The now-redundant `const { readPluginsLock } = await import('../core/plugins-lock.mjs');` line can go — `resolveInstallSource` reads the lock itself.)

(f) `cmdPlugin` case `'list'` empty message (1128): `` 'No plugins installed. Use `worca plugin add <repo-url>` to discover some.' `` → `` 'No plugins installed. Browse marketplaces with `worca marketplace list` or add one with `worca marketplace add <repo-url>`.' ``

(g) `PLUGIN_HELP` (798-818): change the `add` line to `worca plugin add <repo-url>                     Register a plugin marketplace (alias of: worca marketplace add)` and the `install` line to `worca plugin install <name> [--repo <url>] [--marketplace <id>] [--ref <sha>] [--yes]`. Also check the top-level `--help` output (grep for `worca plugin` in the main help string) and add a `worca marketplace …` line beside it.

- [ ] **Step 4: Run tests**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/cli-marketplace.test.mjs test/cli-plugin.test.mjs test/cli-subcommands.test.mjs`
Expected: ALL PASS (cli-plugin has an `add` test? grep it — if it asserts the old scan-only output, update it to the alias behavior in this task).

- [ ] **Step 5: Commit**

```bash
git add src/cli/worca-cc.mjs test/cli-marketplace.test.mjs test/cli-plugin.test.mjs
git commit -m "feat(cli): worca marketplace namespace + marketplace-aware plugin install

worca plugin add becomes a persisted marketplace-add alias; plugin install
resolves repos via --repo > lock > unique marketplace snapshot, with
--marketplace <id> to break ties.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Docs + skill content, final verification

**Files:**
- Modify: `.claude/skills/creating-worca-cc-plugins/SKILL.md` (content additions)
- Modify: `README.md` (plugins/marketplace mention — grep for the plugins section)
- Verify: full suite + smoke + manual checklist

**Interfaces:**
- Consumes: everything.
- Produces: shipped docs.

- [ ] **Step 1: SKILL.md additions**

In `.claude/skills/creating-worca-cc-plugins/SKILL.md`:

1. After the "## Manifest quick reference" section, add:

```markdown
## Marketplace manifest (repo-level, optional)

A repo can declare itself a **marketplace** with `worca-cc-marketplace.json` at its root:

```json
{ "name": "My Plugins", "description": "…", "plugins": ["plugins/one", "plugins/two"] }
```

Listed dirs (any depth, no `..`) each contain a `worca-cc-plugin.json`; when the file is
present it is the complete plugin list (the depth 0–1 auto-scan is skipped). Repos without
it still work as implicit marketplaces via the scan. The worca-cc repo itself is a
marketplace (its 5 bundled plugins live under `plugins/`), registered by default.
```

2. In "## Before you ship", replace the `worca plugin add <repo-url>` line with:

```markdown
Then push and let users register the repo as a marketplace:
`worca marketplace add <repo-url>` (or Plugins → Add marketplace in the UI) →
install from the Available list or `worca plugin install <name>`.
Removing a marketplace never removes installed plugins.
```

- [ ] **Step 2: README**

`grep -n "plugin" README.md | head -30` — find the plugins paragraph/section; update any `worca plugin add` mention to the marketplace flow and add two sentences: the repo doubles as the default "Worca CC Official" marketplace (root `worca-cc-marketplace.json`, plugins under `plugins/`); marketplaces are managed in the Plugins view or via `worca marketplace add|list|refresh|remove`, and removing one keeps installed plugins working.

- [ ] **Step 3: Full verification**

```bash
npm test 2>&1 | tail -25        # green modulo the 4 imagegen baseline failures
npm run smoke                    # completes; recreates sandbox/ at the new path
npm run smoke:plugin             # plugin link/exec path unaffected
```

Manual UI pass (npm start): the four checks from Task 9 Step 5 once more, plus `worca marketplace list` showing the builtin.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/creating-worca-cc-plugins/SKILL.md README.md
git commit -m "docs: marketplace publishing model in plugin skill + README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan notes for the executor

- **Deviation rule:** if reality contradicts a line number or snippet (files drift), adapt minimally and note it; if a whole assumption breaks (e.g. `confirmModal` return shape), stop and re-read the referenced code before improvising.
- **The 4 imagegen-skill test failures are pre-existing baseline** — never try to fix them in this branch.
- Never commit `docs/superpowers/**`, `sandbox/`, or `.worca-cc-*` dirs.
- After Task 11, the branch is ready for review; do NOT merge or open a PR without being asked.
