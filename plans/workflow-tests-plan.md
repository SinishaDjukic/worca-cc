# Workflow tests and version compare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People who build workflows (often domain experts, not developers) save named versions of a workflow, test a version on their own examples, and see what got better or worse before new runs use it.

**Architecture:** Five parts, each shippable on its own. Part 1 (this plan, in full) adds one append-only table `workflow_revisions`. It holds the automatic history of every save (issue #721, workflow part) and the named versions. `workflows.live_version_no` marks the version that new runs use. The canvas keeps editing the row, which becomes the draft. Runs resolve the live version through one function, `readRunnableWorkflow`, and record the version they used in the manifest. Parts 2–5 are outlined at the end. Each gets its own detailed tasks once the part before it is merged.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test` + jsdom, Express (`ui/server.mjs`), vanilla DOM modules (`ui/public/*.mjs`).

**Spec:**
- The approved design canvas (23 boards): https://claude.ai/artifact/7kDSH4sKKDz3gV4DnnTABJ
- The decisions D1–D14 below. Where the canvas and a decision disagree, the decision wins.

**Related upstream issues:**
- **#721** "History and restore for your own workflows, agents and scripts". Part 1 implements its workflow part with its design: snapshot before every write, a ring, restore through the validating save, and `GET/POST …/history` routes. Agent and script history stay with #721.
- **#681** "Benchmarks: release regression baseline". This is a developer benchmark on fixed repos. It is not this feature, but Part 2's runner could serve it later.
- **#20** "W-013: Run Comparison View". Part 2's compare covers version-vs-version, not run-vs-run.

## Decisions

| # | Decision |
|---|---|
| D1 | A **version** is made only with **Save version**. The canvas's **Save** writes the draft, the `workflows` row, exactly as today. |
| D2 | **Draft until Use.** Once a workflow has a version, new runs use its **live** version (`workflows.live_version_no`), not the draft. **Use vN for new runs** switches it. A workflow without versions runs its row, unchanged from today. The first saved version becomes live automatically: it is identical to the row, so nothing changes at that moment. |
| D3 | **Every save keeps the state it replaced** (#721): writes of the row via `writeGraphWorkflow`, `setWorkflowNodeDefaults` and `deleteWorkflow` snapshot the previous row first, in the same transaction. A save that changes nothing takes no snapshot. A failed snapshot fails the write. The last **50** automatic snapshots per workflow are kept. Named versions are never pruned. The table is FK-free, so history outlives a deleted row. |
| D4 | **Restore** puts a saved state back into the **draft** through `saveGraphWorkflow`, the validating save. A state that no longer fits today's agents is refused with the validator's reason (422). Restore never changes the live version. The restore itself is snapshotted, so it can be undone. |
| D5 | Plugin-owned rows (`origin = 'plugin:*'`) and built-ins (never rows) have no history and no versions. Rows with `origin = 'auto'` do. |
| D6 | **Version identity** = `workflowFingerprint(graph, parts)`. It covers the nodes (id, kind, key, config) and wires (id, ends, maxCycles), but not layout. `parts` hashes the content of every agent and script the graph uses, so an edit in the Library shows as "changed since vN". Part 1 records the hashes only: a live version runs today's agent text. Freezing agent text per version is out of scope. |
| D7 | The column `workflows.version` is the **format** version (1 or 2). The new identifiers are therefore `version_no`, `live_version_no` and `versionNo`, never `version`. |
| D8 | Runs record the version they used: `manifest.workflowVersion = { no }` (`pipelines.stepper` JSON), only when a named version ran. Statistics and team metrics are unchanged. |
| D9 | Everything visible and every new route is behind the experimental flag `workflowTests`. Snapshots (D3) are always taken; they are data only. While the flag is off, runs ignore `live_version_no` and use the row. |
| D10 | UI words, for domain experts: Versions, version, draft, "Save version", "Use v5 for new runs", "New runs use this", "Restore into draft". Never "revision", "rev", "fingerprint" or "live". |
| D11 | UI level: Simple, as #721 argues: the way back must be at every level that can edit. |
| D12 | Examples travel with an export (Part 4). Tests count in the normal spending limit, with an optional test share and their own Statistics tile (Part 5). Colleague reviews use a review file until Worca has login (Part 4). Real use is measured only where Worca sees the kept result, per version, team setting off by default (Part 5). The checking model is chosen per example (Part 3). There is no sharing gate (Part 2 shows the latest test; the person decides). |
| D13 | A workflow's **Tests** page (Part 2) runs versions with `workflowUse: 'draft' \| <versionNo>` through the same run path. Part 1 adds that option so Part 2 needs no engine change. |
| D14 | Unreliable criteria (Part 3) still run and show, but do not decide better or worse. A criterion becomes unreliable only after ≥ 10 answers. |

## Global Constraints

- **Worktree and branch:** worktree `C:\Users\BRT1BG\worca-cc\worca-cc-tests`, branch `feat/workflow-tests` from `origin/dev` @ `d3fec7530`.
- **Commits:** one commit per task. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Author email is `tomica.brkovic@yahoo.com`, set once per worktree (Task 0).
- **Upstream rules** (CONTRIBUTING.md:178-190):
  - Target `dev`.
  - Merge commits only. Merge `dev` in, never rebase or force-push.
  - `npm test` plus a smoke run, stated in the PR.
  - Name the UI level and update `docs/ui-levels.md`.
- **Push and PR:** never push or open a PR without the user's explicit go. Before the PR, post a comment on #721 saying that this PR covers its workflow part; the user approves its text first.
- **Schema:** `SCHEMA_VERSION` becomes **77**. If `dev` or the A8 lane takes 77 first, renumber on the merge: the DDL, the ladder line and the test file name.
- **Run one test file:** `node tools/test.mjs test/<file>.test.mjs`. It sets the hermetic home and the no-real-claude guard.
- **Full suite:** `npm test`. On this laptop about 170 failures already exist on clean `dev`, so compare against a `dev` baseline before blaming the branch.
- **Styles:** `style.css` uses tokens only, never a hex colour (`test/ui-theme-tokens.test.mjs`). Status colours: green = done, red = failed, blue = information. Amber means only "needs you".
- **New CSS placement:** put new CSS in the workflows section of `style.css`, never after a `/* ── marketplace … ── */` marker. Some tests slice the file by those markers. After every merge of `dev`, run the slicing tests (`grep -ln "indexOf('/\*" test/*.test.mjs`).
- **Route errors:** `{ error }` with 400 / 404 / 409 / 422 / 500.
- **No `version` identifiers:** no new identifier may be called `version` (D7).

## Review Focus

1. **Save after "Save version" must not change runs.**
   - Setup: flag on, save a workflow, save version 1, edit the canvas, save, start a run.
   - Expect: the run's manifest has `workflowVersion.no === 1` and v1's graph. The draft's new node is absent (Task 4 test).
2. **A save that changes nothing takes no snapshot.**
   - Expect: re-saving identical content leaves the revision count unchanged (Task 3).
3. **History survives delete.**
   - Expect: deleting the workflow keeps all its revisions plus one `delete` snapshot (Task 3).
4. **Restoring a state that no longer validates.**
   - Setup: an agent's port was renamed since.
   - Expect: 422 with the issues; the draft and the live version are unchanged (Task 5 and Task 6).
5. **Flag off.**
   - Expect: every new route answers 404. Runs use the row even when `live_version_no` is set. No new UI is visible (Task 4, Task 6 and Task 7).
6. **Plugin rows.**
   - Expect: no snapshot; Save version answers 400 (Task 3 and Task 5).

---

## Part 1 — Versions and history

### Task 0: Worktree setup (no commit)

- [ ] **Step 1: Share `node_modules` with the dev checkout (junction, as the other lanes do)**

Run (PowerShell):
```powershell
cmd /c mklink /J C:\Users\BRT1BG\worca-cc\worca-cc-tests\node_modules C:\Users\BRT1BG\worca-cc\worca-cc-dev\node_modules
```
Expected: `Junction created for …`. When the lane is finished, remove it with `cmd /c rmdir node_modules`, never `rm -rf`.

- [ ] **Step 2: Set the commit identity for this worktree only**

Run:
```powershell
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests config --worktree user.email tomica.brkovic@yahoo.com
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests config --worktree user.name "Tomica Brkovic"
```

- [ ] **Step 3: Record a baseline of the files this part touches**

Run:
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests; node tools/test.mjs test/workflows-db.test.mjs test/api-workflows.test.mjs test/workflow-share.test.mjs test/orchestrator-no-project.test.mjs test/db-migrate-v76.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs test/ui-levels.test.mjs test/ui-workflows-shell.test.mjs test/ui-workflows-library.test.mjs
```
Expected: all pass. Note any failure here: it is a baseline failure, not ours.

---

### Task 1: Schema v77 — `workflow_revisions` and `workflows.live_version_no`

**Files:**
- Modify: `src/core/db.mjs`:
  - `SCHEMA_VERSION` (:66)
  - `INCREMENTAL_COLUMNS.workflows` (:866)
  - the new DDL after `ASK_CHAT_GROUPS_DDL` (:1331–1339)
  - `INCREMENTAL_TABLES` (:1341–1387)
  - the ladder line after `if (current < 76)` (:2525)
- Create: `test/db-migrate-v77.test.mjs`

**Interfaces:**
- Produces:
  - table `workflow_revisions(id, workflow_id, version_no, note, name, domain, graph, fingerprint, parts, source, made_by, created_at)`
  - column `workflows.live_version_no INTEGER`
  - unique partial index on `(workflow_id, version_no)`

- [ ] **Step 1: Write the failing test** — `test/db-migrate-v77.test.mjs`

```js
// test/db-migrate-v77.test.mjs — workflow history + named versions (plans/workflow-tests-plan.md Task 1, #721).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const REV_COLS = ['id', 'workflow_id', 'version_no', 'note', 'name', 'domain', 'graph', 'fingerprint', 'parts', 'source', 'made_by', 'created_at'];

test('fresh DB: workflow_revisions exists and workflows has live_version_no', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 77);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(cols(db, 'workflows').includes('live_version_no'));
});

test('a DB stamped 76 without them gets both and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE workflows DROP COLUMN live_version_no; DROP TABLE workflow_revisions; PRAGMA user_version = 76');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(cols(db, 'workflows').includes('live_version_no'));
});

test('a named version number is unique per workflow; automatic snapshots (NULL) repeat freely', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES (?, ?, 'W', '{}', 'f', 'save', '2026-10-25T00:00:00Z')`);
  ins.run('wf_a', null); ins.run('wf_a', null); ins.run('wf_a', 1); ins.run('wf_b', 1);
  assert.throws(() => ins.run('wf_a', 1), /UNIQUE/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/db-migrate-v77.test.mjs`
Expected: FAIL. `SCHEMA_VERSION >= 77` is false, and `workflow_revisions` has no columns.

- [ ] **Step 3: Implement in `src/core/db.mjs`**

Change :66 to:
```js
export const SCHEMA_VERSION = 77;
```
In `INCREMENTAL_COLUMNS` (:866), replace the `workflows` line with:
```js
  workflows:              { domain: 'TEXT', origin: 'TEXT', graph: 'TEXT', archived_at: 'TEXT',
                            live_version_no: 'INTEGER' },   // v77: the named version new runs use (NULL = the row itself)
```
After the `ASK_CHAT_GROUPS_DDL` constant, add:
```js
// v77 (plans/workflow-tests-plan.md, #721 workflow part): every save keeps the state it replaced (version_no NULL,
// the last 50 per workflow) and Save version keeps a numbered state (never pruned). Append-only and FK-free like
// ask_cost_ledger, so history outlives a deleted workflows row. `graph` = {nodes, wires, canvas?, codeGraph?}.
const WORKFLOW_REVISIONS_DDL = `
CREATE TABLE IF NOT EXISTS workflow_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  version_no  INTEGER,
  note        TEXT,
  name        TEXT NOT NULL,
  domain      TEXT,
  graph       TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  parts       TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL,
  made_by     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_revisions_wf ON workflow_revisions (workflow_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_revisions_version ON workflow_revisions (workflow_id, version_no) WHERE version_no IS NOT NULL;`;
```
In `INCREMENTAL_TABLES`, after the `ask_chat_groups` line, add:
```js
  workflow_revisions: WORKFLOW_REVISIONS_DDL,  // v77 (workflow tests Part 1, #721)
```
In `migrate()`, after the `if (current < 76) …` line, add:
```js
    if (current < 77) db.exec(WORKFLOW_REVISIONS_DDL);   // v77 workflow history + versions; workflows.live_version_no comes from INCREMENTAL_COLUMNS
```

- [ ] **Step 4: Run the new and neighbouring migration tests**

Run: `node tools/test.mjs test/db-migrate-v77.test.mjs test/db-migrate-v76.test.mjs test/db.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/db.mjs test/db-migrate-v77.test.mjs
git commit -m "Workflow tests: schema v77, workflow_revisions + workflows.live_version_no (#721)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: What changed, and a version's identity (pure helpers)

**Files:**
- Create: `src/shared/graph/diff-graphs.mjs`, a pure and browser-safe plain-language diff, plus `canon`.
- Create: `src/core/workflow-fingerprint.mjs` with `graphShape` and `workflowFingerprint` (`node:crypto` only).
- Create: `src/core/workflow-parts.mjs` with `workflowParts`, which hashes the agents and scripts a graph uses.
- Test: `test/graph-diff.test.mjs`, `test/workflow-fingerprint.test.mjs`

**Interfaces:**
- Produces:
  - `canon(value) → string`: deterministic JSON, with object keys sorted at every depth.
  - `diffGraphs(before, after, { labelOf? }) → Array<{ kind: 'name'|'removed'|'added'|'replaced'|'model'|'effort'|'config'|'loop'|'wires', nodeId?: string, text: string }>`
    - `before` and `after` are `{ name?, nodes, wires }`.
    - `labelOf(node) → string` defaults to `node.key || node.kind`.
  - `graphShape(graph) → { nodes: Array<{id,kind,key,config}>, wires: Array<{id,from,to,maxCycles}> }`, sorted by id.
  - `workflowFingerprint(graph, parts = []) → string`: 16 hex characters.
  - `workflowParts(graph, { registry?, scripts?, readText?, scriptSource? }) → Promise<Array<{ kind: 'agent'|'script', key, origin, hash }>>`, sorted by `kind`, then `key`.

- [ ] **Step 1: Write the failing tests**

`test/graph-diff.test.mjs`:
```js
// test/graph-diff.test.mjs — diffGraphs: what changed between two workflow graphs, in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffGraphs, canon } from '../src/shared/graph/diff-graphs.mjs';

const g = (over = {}) => ({
  name: 'Brief writer',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_draft', kind: 'agent', key: 'drafter', x: 100, y: 0, config: { model: 'opus' } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 200, y: 0, config: {} },
  ],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_draft', port: 'task' } },
    { id: 'w_loop', from: { node: 'n_rev', port: 'issues' }, to: { node: 'n_draft', port: 'feedback' }, maxCycles: 3 }],
  ...over,
});
const labelOf = (n) => ({ drafter: 'Draft brief', reviewer: 'Review', checker: 'Fact check' }[n.key] || n.key || n.kind);

test('identical graphs and layout-only moves: nothing changed', () => {
  assert.deepEqual(diffGraphs(g(), g(), { labelOf }), []);
  const moved = g(); moved.nodes[1] = { ...moved.nodes[1], x: 999, y: 42 };
  assert.deepEqual(diffGraphs(g(), moved, { labelOf }), []);
});

test('model, a new step, a loop budget and a rename read as plain sentences', () => {
  const after = g({ name: 'Product brief writer' });
  after.nodes[1] = { ...after.nodes[1], config: { model: 'sonnet' } };
  after.nodes.push({ id: 'n_fact', kind: 'agent', key: 'checker', x: 300, y: 0, config: {} });
  after.wires[1] = { ...after.wires[1], maxCycles: 2 };
  assert.deepEqual(diffGraphs(g(), after, { labelOf }).map((c) => c.text), [
    'Renamed from "Brief writer" to "Product brief writer"',
    'New step Fact check',
    'Draft brief: AI model opus → sonnet',
    'Draft brief loop: at most 3 rounds → 2',
  ]);
});

test('a removed step, a replaced agent and other settings', () => {
  const after = g();
  after.nodes = after.nodes.filter((n) => n.id !== 'n_rev');
  after.nodes[1] = { ...after.nodes[1], key: 'checker', config: { model: 'opus', fanOut: true } };
  after.wires = after.wires.slice(0, 1);
  assert.deepEqual(diffGraphs(g(), after, { labelOf }).map((c) => c.kind), ['removed', 'replaced', 'config', 'wires']);
});

test('canon sorts keys at every depth', () => {
  assert.equal(canon({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
});
```

`test/workflow-fingerprint.test.mjs`:
```js
// test/workflow-fingerprint.test.mjs — a version's identity: graph shape + the content of the agents/scripts it uses.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphShape, workflowFingerprint } from '../src/core/workflow-fingerprint.mjs';
import { workflowParts } from '../src/core/workflow-parts.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const graph = () => ({
  nodes: [{ id: 'b', kind: 'agent', key: 'drafter', x: 5, y: 5, config: { model: 'opus' } },
    { id: 'a', kind: 'script', key: 'word-count', x: 0, y: 0, config: {} }],
  wires: [{ id: 'w', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' }, maxCycles: 2 }],
  canvas: { zoom: 1 },
});

test('graphShape ignores layout and canvas and sorts by id', () => {
  const s = graphShape(graph());
  assert.deepEqual(s.nodes.map((n) => n.id), ['a', 'b']);
  assert.equal('x' in s.nodes[0] || 'canvas' in s, false);
});

test('the fingerprint changes with config and parts, not with layout', () => {
  const base = workflowFingerprint(graph(), []);
  assert.match(base, /^[0-9a-f]{16}$/);
  const moved = graph(); moved.nodes[0].x = 400; moved.canvas = { zoom: 2 };
  assert.equal(workflowFingerprint(moved, []), base);
  const tuned = graph(); tuned.nodes[0].config.model = 'sonnet';
  assert.notEqual(workflowFingerprint(tuned, []), base);
  assert.notEqual(workflowFingerprint(graph(), [{ kind: 'agent', key: 'drafter', origin: 'user', hash: '1' }]), base);
});

test('workflowParts hashes each agent file and script source once; an edit changes the hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-parts-')); dirs.push(dir);
  const md = join(dir, 'drafter.md');
  await writeFile(md, 'Write the brief.');
  const registry = { drafter: { key: 'drafter', origin: 'user', agentPath: md } };
  const scripts = { 'word-count': { key: 'word-count', origin: 'builtin' } };
  const g2 = graph(); g2.nodes.push({ id: 'c', kind: 'agent', key: 'drafter', config: {} });
  const one = await workflowParts(g2, { registry, scripts, scriptSource: async () => 'echo 1' });
  assert.deepEqual(one.map((p) => `${p.kind}:${p.key}:${p.origin}`), ['agent:drafter:user', 'script:word-count:builtin']);
  await writeFile(md, 'Write the brief. Name a measurable goal.');
  const two = await workflowParts(g2, { registry, scripts, scriptSource: async () => 'echo 1' });
  assert.notEqual(two[0].hash, one[0].hash);
  assert.equal(two[1].hash, one[1].hash);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node tools/test.mjs test/graph-diff.test.mjs test/workflow-fingerprint.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/shared/graph/diff-graphs.mjs`**

```js
// src/shared/graph/diff-graphs.mjs
// What changed between two workflow graphs, in plain words for the Versions page, the Save version dialog and the
// version comparison (plans/workflow-tests-plan.md D10). Pure and browser-safe: no node: imports (shared-graph-purity).
// Layout (x, y, canvas) never counts as a change.

/** Deterministic JSON: object keys sorted at every depth; undefined → null. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);
const byId = (a) => new Map(list(a).map((x) => [x.id, x]));
const plainLabel = (n) => (n && (n.key || n.kind)) || 'step';
const ends = (w) => canon({ from: w.from ?? null, to: w.to ?? null });
const shown = (v) => (v === undefined || v === null || v === '' ? 'default' : String(v));

/**
 * @param {{name?: string, nodes?: Array, wires?: Array}} before
 * @param {{name?: string, nodes?: Array, wires?: Array}} after
 * @param {{labelOf?: (node: object) => string}} [opts]
 * @returns {Array<{kind: string, nodeId?: string, text: string}>}
 */
export function diffGraphs(before, after, { labelOf = plainLabel } = {}) {
  const out = [];
  const label = (n) => labelOf(n) || plainLabel(n);
  if ((before?.name ?? '') !== (after?.name ?? '') && before?.name && after?.name) {
    out.push({ kind: 'name', text: `Renamed from "${before.name}" to "${after.name}"` });
  }
  const a = byId(before?.nodes);
  const b = byId(after?.nodes);
  for (const [id, n] of a) if (!b.has(id)) out.push({ kind: 'removed', nodeId: id, text: `Removed step ${label(n)}` });
  for (const [id, n] of b) if (!a.has(id)) out.push({ kind: 'added', nodeId: id, text: `New step ${label(n)}` });
  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na) continue;
    if ((na.key ?? null) !== (nb.key ?? null) || na.kind !== nb.kind) {
      out.push({ kind: 'replaced', nodeId: id, text: `${label(nb)} replaces ${label(na)}` });
      continue;
    }
    const ca = na.config && typeof na.config === 'object' ? na.config : {};
    const cb = nb.config && typeof nb.config === 'object' ? nb.config : {};
    if ((ca.model ?? null) !== (cb.model ?? null)) out.push({ kind: 'model', nodeId: id, text: `${label(nb)}: AI model ${shown(ca.model)} → ${shown(cb.model)}` });
    if ((ca.effort ?? null) !== (cb.effort ?? null)) out.push({ kind: 'effort', nodeId: id, text: `${label(nb)}: effort ${shown(ca.effort)} → ${shown(cb.effort)}` });
    const rest = (c) => canon(Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'model' && k !== 'effort')));
    if (rest(ca) !== rest(cb)) out.push({ kind: 'config', nodeId: id, text: `${label(nb)}: settings changed` });
  }
  const wa = byId(before?.wires);
  const wb = byId(after?.wires);
  let rewired = wa.size !== wb.size;
  for (const [id, w] of wb) {
    const prev = wa.get(id);
    if (!prev || ends(prev) !== ends(w)) { rewired = true; continue; }
    if ((prev.maxCycles ?? null) !== (w.maxCycles ?? null)) {
      const target = b.get(w.to?.node) || { key: w.to?.node };
      out.push({ kind: 'loop', text: `${label(target)} loop: at most ${shown(prev.maxCycles)} rounds → ${shown(w.maxCycles)}` });
    }
  }
  for (const id of wa.keys()) if (!wb.has(id)) rewired = true;
  if (rewired) out.push({ kind: 'wires', text: 'Connections between steps changed' });
  return out;
}
```

- [ ] **Step 4: Implement `src/core/workflow-fingerprint.mjs`**

```js
// src/core/workflow-fingerprint.mjs
// A workflow version's identity (plans/workflow-tests-plan.md D6): the graph's shape — nodes {id, kind, key, config}
// and wires {id, from, to, maxCycles}, layout excluded — plus the hash of every agent/script it uses
// (workflow-parts.mjs). Leaf module: node:crypto + the shared canon only.
import { createHash } from 'node:crypto';
import { canon } from '../shared/graph/diff-graphs.mjs';

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const items = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);

/** @param {{nodes?: Array, wires?: Array}} graph */
export function graphShape(graph) {
  return {
    nodes: items(graph?.nodes).map((n) => ({ id: n.id, kind: n.kind ?? null, key: n.key ?? null, config: n.config ?? null })).sort(byId),
    wires: items(graph?.wires).map((w) => ({ id: w.id, from: w.from ?? null, to: w.to ?? null, maxCycles: w.maxCycles ?? null })).sort(byId),
  };
}

/** @param {object} graph @param {Array<{kind:string,key:string,hash:string}>} [parts] @returns {string} 16 hex chars */
export function workflowFingerprint(graph, parts = []) {
  const p = (Array.isArray(parts) ? parts : []).map((x) => [x.kind, x.key, x.hash]);
  return createHash('sha256').update(canon({ g: graphShape(graph), p })).digest('hex').slice(0, 16);
}
```

- [ ] **Step 5: Implement `src/core/workflow-parts.mjs`**

```js
// src/core/workflow-parts.mjs
// The agents and scripts a graph uses, each with a content hash (plans/workflow-tests-plan.md D6): an edit in the
// Library changes the hash, so the Versions page can say "changed since v4". Reads only; never throws (a missing
// file hashes as empty).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canon } from '../shared/graph/diff-graphs.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { loadScriptRegistry } from './script-registry.mjs';
import { readScript } from './script-store.mjs';

const defaultScriptSource = async (key) => {
  const s = await readScript(key);
  return s ? `${s.source ?? ''}\u0000${s.sourceWin32 ?? ''}` : '';
};

/**
 * @param {{nodes?: Array}} graph
 * @param {{registry?: object, scripts?: object, readText?: (path: string) => Promise<string>, scriptSource?: (key: string) => Promise<string>}} [deps]
 * @returns {Promise<Array<{kind: 'agent'|'script', key: string, origin: string|null, hash: string}>>}
 */
export async function workflowParts(graph, { registry, scripts, readText = (p) => readFile(p, 'utf8'), scriptSource = defaultScriptSource } = {}) {
  const reg = registry && typeof registry === 'object' ? registry : loadAgentRegistry();
  const scr = scripts && typeof scripts === 'object' ? scripts : loadScriptRegistry({ agentKeys: Object.keys(reg) });
  const seen = new Map();
  for (const n of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    if (!n || (n.kind !== 'agent' && n.kind !== 'script') || typeof n.key !== 'string' || !n.key) continue;
    const id = `${n.kind}:${n.key}`;
    if (seen.has(id)) continue;
    const meta = n.kind === 'agent' ? reg[n.key] : scr[n.key];
    let body = '';
    try {
      body = n.kind === 'agent' ? (meta && meta.agentPath ? await readText(meta.agentPath) : '') : await scriptSource(n.key);
    } catch { body = ''; }
    const hash = createHash('sha256').update(canon(meta ?? null)).update('\u0000').update(String(body ?? '')).digest('hex').slice(0, 16);
    seen.set(id, { kind: n.kind, key: n.key, origin: (meta && meta.origin) || null, hash });
  }
  return [...seen.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : a.kind + a.key > b.kind + b.key ? 1 : 0));
}
```

- [ ] **Step 6: Run the tests, plus the shared-module purity guard**

Run: `node tools/test.mjs test/graph-diff.test.mjs test/workflow-fingerprint.test.mjs test/shared-graph-purity.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/graph/diff-graphs.mjs src/core/workflow-fingerprint.mjs src/core/workflow-parts.mjs test/graph-diff.test.mjs test/workflow-fingerprint.test.mjs
git commit -m "Workflow tests: plain-language graph diff and a version's fingerprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: History — every save keeps the state it replaced (#721)

**Files:**
- Create: `src/core/workflow-revisions.mjs`. A leaf module: it imports only `db.mjs` and `workflow-fingerprint.mjs`.
- Modify: `src/core/workflows.mjs`:
  - `writeGraphWorkflow` (:305; the `tx` at :347)
  - `setWorkflowNodeDefaults` (:495; the `tx` at :516)
  - `deleteWorkflow` (:544)
- Test: `test/workflow-revisions.test.mjs`

**Interfaces:**
- Consumes: `workflowFingerprint` (Task 2).
- Produces, from `workflow-revisions.mjs`:
  - `AUTO_KEEP = 50`
  - `isVersionableRow(row) → boolean`
  - `snapshotRowTx(prevRow, { source, by?, now? }) → number | null`: the new revision id. It must be called inside a `tx()`.
  - `insertVersionTx(row, { note, by, parts, fingerprint, now }) → number`: the new version number.
  - `setLiveVersionTx(workflowId, versionNo)`
  - `liveVersionNo(workflowId) → number | null`
  - `listRevisions(workflowId) → Array<{ id, versionNo, note, name, source, by, createdAt, fingerprint }>`, newest first.
  - `readRevision(workflowId, id)` and `readVersion(workflowId, versionNo) → { id, versionNo, note, name, domain, source, by, createdAt, fingerprint, graph, parts } | null`
  - `latestVersion(workflowId) → that same shape | null`
- Produces: `writeGraphWorkflow(tpl, { rejectCollision?, revisionSource?, by? })`, which snapshots with `revisionSource || 'save'`.

- [ ] **Step 1: Write the failing test** — `test/workflow-revisions.test.mjs`

```js
// test/workflow-revisions.test.mjs — every write of a workflow row keeps the state it replaced (#721, workflow part).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGraphWorkflow, setWorkflowNodeDefaults, deleteWorkflow } from '../src/core/workflows.mjs';
import { listRevisions, readRevision, AUTO_KEEP, snapshotRowTx, insertVersionTx } from '../src/core/workflow-revisions.mjs';
import { getDb, tx, _resetForTests } from '../src/core/db.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfrev-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const tpl = (over = {}) => ({
  id: 'wf_brief', name: 'Brief writer', domain: 'general',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }],
  ...over,
});

test('the first save takes no snapshot; a changing save snapshots the previous state', async () => {
  await writeGraphWorkflow(tpl());
  assert.equal(listRevisions('wf_brief').length, 0);
  await writeGraphWorkflow(tpl({ name: 'Product brief writer' }));
  const revs = listRevisions('wf_brief');
  assert.equal(revs.length, 1);
  assert.deepEqual([revs[0].name, revs[0].source, revs[0].versionNo], ['Brief writer', 'save', null]);
  assert.equal(readRevision('wf_brief', revs[0].id).graph.nodes.length, 2);
});

test('a save that changes nothing takes no snapshot', async () => {
  await writeGraphWorkflow(tpl());
  await writeGraphWorkflow(tpl());
  await writeGraphWorkflow(tpl());
  assert.equal(listRevisions('wf_brief').length, 0);
});

test('revisionSource and by are recorded', async () => {
  await writeGraphWorkflow(tpl());
  await writeGraphWorkflow(tpl({ name: 'X' }), { revisionSource: 'restore', by: 'Tomica' });
  const [r] = listRevisions('wf_brief');
  assert.deepEqual([r.source, r.by], ['restore', 'Tomica']);
});

test('defaults and delete snapshot too; history outlives the deleted row', async () => {
  await writeGraphWorkflow(tpl());
  await setWorkflowNodeDefaults('wf_brief', { n_plan: { model: 'sonnet' } });
  assert.deepEqual(listRevisions('wf_brief').map((r) => r.source), ['defaults']);
  assert.equal(await deleteWorkflow('wf_brief'), true);
  assert.deepEqual(listRevisions('wf_brief').map((r) => r.source), ['delete', 'defaults']);
  assert.equal(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_brief'), undefined);
});

test('plugin-owned rows take no snapshots', async () => {
  await writeGraphWorkflow(tpl({ id: 'wfp_x_brief', origin: 'plugin:x' }));
  await writeGraphWorkflow(tpl({ id: 'wfp_x_brief', name: 'changed' }));
  assert.equal(listRevisions('wfp_x_brief').length, 0);
});

test(`only the last ${AUTO_KEEP} automatic snapshots are kept; named versions are never pruned`, async () => {
  await writeGraphWorkflow(tpl());
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_brief');
  tx(() => { insertVersionTx(row, { note: 'v1', by: null, parts: [], fingerprint: 'f', now: '2026-10-25T00:00:00Z' }); });
  tx(() => { for (let i = 0; i < AUTO_KEEP + 5; i += 1) snapshotRowTx(row, { source: 'save' }); });
  const revs = listRevisions('wf_brief');
  assert.equal(revs.filter((r) => r.versionNo === null).length, AUTO_KEEP);
  assert.equal(revs.filter((r) => r.versionNo === 1).length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-revisions.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-revisions.mjs'`.

- [ ] **Step 3: Implement `src/core/workflow-revisions.mjs`**

```js
// src/core/workflow-revisions.mjs
// Workflow history (#721, workflow part) and named versions (plans/workflow-tests-plan.md Part 1) in ONE append-only
// table. Leaf module: it imports only db.mjs and the fingerprint, so workflows.mjs can call the *Tx helpers inside
// its own transactions (db.tx() is not re-entrant). Rows: version_no NULL = an automatic snapshot (the last
// AUTO_KEEP per workflow), 1,2,… = a named version (never pruned).
import { getDb, prepare } from './db.mjs';
import { workflowFingerprint } from './workflow-fingerprint.mjs';

export const AUTO_KEEP = 50;

const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
const graphOf = (row) => { const g = parse(row && row.graph ? row.graph : '{}', {}); return g && typeof g === 'object' ? g : {}; };

/** D5: a format-2 row that no plugin owns (built-ins are never rows). */
export function isVersionableRow(row) {
  return !!row && row.version === 2 && !(typeof row.origin === 'string' && row.origin.startsWith('plugin:'));
}

const INSERT = `INSERT INTO workflow_revisions
  (workflow_id, version_no, note, name, domain, graph, fingerprint, parts, source, made_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Snapshot the row a write is about to replace. Call INSIDE tx(). @returns {number|null} the revision id */
export function snapshotRowTx(prev, { source = 'save', by = null, now = new Date().toISOString() } = {}) {
  if (!isVersionableRow(prev)) return null;
  const graph = graphOf(prev);
  const info = prepare(INSERT).run(prev.id, null, null, prev.name, prev.domain || null, JSON.stringify(graph),
    workflowFingerprint(graph, []), '[]', source, by, now);
  prepare(`DELETE FROM workflow_revisions WHERE workflow_id = ? AND version_no IS NULL AND id NOT IN (
    SELECT id FROM workflow_revisions WHERE workflow_id = ? AND version_no IS NULL ORDER BY id DESC LIMIT ?)`)
    .run(prev.id, prev.id, AUTO_KEEP);
  return Number(info.lastInsertRowid);
}

/** Keep the row as the next numbered version. Call INSIDE tx(). @returns {number} the new version number */
export function insertVersionTx(row, { note = null, by = null, parts = [], fingerprint, now = new Date().toISOString() }) {
  const last = prepare('SELECT MAX(version_no) AS m FROM workflow_revisions WHERE workflow_id = ?').get(row.id);
  const next = (last && last.m ? Number(last.m) : 0) + 1;
  prepare(INSERT).run(row.id, next, note, row.name, row.domain || null, JSON.stringify(graphOf(row)),
    fingerprint, JSON.stringify(parts), 'version', by, now);
  return next;
}

/** Call INSIDE tx(). */
export function setLiveVersionTx(workflowId, versionNo) {
  prepare('UPDATE workflows SET live_version_no = ? WHERE id = ?').run(versionNo, workflowId);
}

/** @returns {number|null} */
export function liveVersionNo(workflowId) {
  getDb();
  const r = prepare('SELECT live_version_no AS n FROM workflows WHERE id = ?').get(workflowId);
  return r && Number.isInteger(r.n) ? r.n : null;
}

const COLS = 'id, version_no, note, name, domain, source, made_by, created_at, fingerprint';
const entry = (r) => ({ id: Number(r.id), versionNo: r.version_no ?? null, note: r.note ?? null, name: r.name,
  domain: r.domain ?? null, source: r.source, by: r.made_by ?? null, createdAt: r.created_at, fingerprint: r.fingerprint });
const full = (r) => (r ? { ...entry(r), graph: parse(r.graph, {}), parts: parse(r.parts, []) } : null);

/** Newest first. */
export function listRevisions(workflowId) {
  getDb();
  return prepare(`SELECT ${COLS} FROM workflow_revisions WHERE workflow_id = ? ORDER BY id DESC`).all(workflowId).map(entry);
}

export function readRevision(workflowId, id) {
  getDb();
  return full(prepare(`SELECT ${COLS}, graph, parts FROM workflow_revisions WHERE workflow_id = ? AND id = ?`).get(workflowId, Number(id)));
}

export function readVersion(workflowId, versionNo) {
  getDb();
  return full(prepare(`SELECT ${COLS}, graph, parts FROM workflow_revisions WHERE workflow_id = ? AND version_no = ?`).get(workflowId, Number(versionNo)));
}

export function latestVersion(workflowId) {
  getDb();
  return full(prepare(`SELECT ${COLS}, graph, parts FROM workflow_revisions WHERE workflow_id = ? AND version_no IS NOT NULL
    ORDER BY version_no DESC LIMIT 1`).get(workflowId));
}
```

- [ ] **Step 4: Hook the three writes in `src/core/workflows.mjs`**

Add to the imports:
```js
import { snapshotRowTx } from './workflow-revisions.mjs';
```
Add next to `ROW_COLS`:
```js
/** D3: does this write change what the row holds? (name, domain, graph, or un-archiving it). */
function rowChanges(prev, { name, domain, graph }) {
  return prev.version !== 2 || prev.name !== name || (prev.domain || 'general') !== domain
    || prev.graph !== JSON.stringify(graph) || !!prev.archived_at;
}
```
In `writeGraphWorkflow`, replace the `tx(() => { prepare(\`INSERT INTO workflows …\`).run(…); });` block (:347–363) with the same statement preceded by the snapshot:
```js
  tx(() => {
    const prev = prepare(`SELECT ${ROW_COLS} FROM workflows WHERE id = ?`).get(id);
    if (prev && rowChanges(prev, { name, domain, graph })) {
      snapshotRowTx(prev, { source: opts?.revisionSource || 'save', by: opts?.by ?? null, now });
    }
    prepare(`
      INSERT INTO workflows (id, name, version, domain, steps, feedbacks, graph, archived_at, created_at, updated_at, origin)
      VALUES (?, ?, 2, ?, '[]', '[]', ?, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, version = 2, domain = excluded.domain,
        steps = '[]', feedbacks = '[]', graph = excluded.graph, archived_at = NULL,
        updated_at = excluded.updated_at,
        -- COALESCE, never a plain overwrite: the composer's Save on a loaded row
        -- sends {id, name, nodes, wires} and NO origin, so a plain
        -- "origin = excluded.origin" would silently detach a plugin-owned wfp_* row
        -- from removePluginWorkflows' guard. v1's writeWorkflow never touches origin
        -- on conflict either. (SQL comments only: a backtick here would END the JS literal.)
        origin = COALESCE(excluded.origin, workflows.origin)
    `).run(id, name, domain, JSON.stringify(graph), createdAt, now, origin);
  });
```
Also update the JSDoc `@param` of `opts` to `{{rejectCollision?:boolean, revisionSource?:string, by?:string|null}}`.

In `setWorkflowNodeDefaults`, replace the v2 `tx(() => { prepare('UPDATE workflows SET graph = ? …').run(…); });` with:
```js
    const nextGraph = JSON.stringify({ nodes, wires: tpl.wires, ...(tpl.canvas ? { canvas: tpl.canvas } : {}) });
    tx(() => {
      const prev = prepare(`SELECT ${ROW_COLS} FROM workflows WHERE id = ?`).get(id);
      if (prev && prev.graph !== nextGraph) snapshotRowTx(prev, { source: 'defaults', now });
      prepare('UPDATE workflows SET graph = ?, updated_at = ? WHERE id = ?').run(nextGraph, now, id);
    });
```
In `deleteWorkflow`, replace the `tx(() => { changed = prepare('DELETE …').run(id).changes; });` with:
```js
  tx(() => {
    const prev = prepare(`SELECT ${ROW_COLS} FROM workflows WHERE id = ?`).get(id);
    if (prev) snapshotRowTx(prev, { source: 'delete' });
    changed = prepare('DELETE FROM workflows WHERE id = ?').run(id).changes;
  });
```

- [ ] **Step 5: Run the new test and every workflow-store test**

Run: `node tools/test.mjs test/workflow-revisions.test.mjs test/workflows-db.test.mjs test/workflows-graph-rows.test.mjs test/workflow-share.test.mjs test/api-workflows.test.mjs test/api-workflow-defaults.test.mjs test/plugin-workflows.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow-revisions.mjs src/core/workflows.mjs test/workflow-revisions.test.mjs
git commit -m "Workflow tests: every save keeps the state it replaced (#721 workflow history)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: New runs use the version marked in use

**Files:**
- Modify: `src/core/workflows.mjs`:
  - a new `readRunnableWorkflow`
  - `assertRunnableWorkflow` (:453)
  - `resolveGraph` (:641; the `readWorkflow` line and the return at :805)
- Modify: `src/core/orchestrator.mjs`, `_resolveTopology` (:163–227), to pass `use` and record `manifest.workflowVersion`.
- Modify: `src/core/workflow-export.mjs:400`, which exports the draft.
- Modify: `src/shared/flags/registry.mjs`, adding the `workflowTests` entry after `requirements` (:133). This task needs the flag first.
- Modify: `docs/feature-flags.md`, adding the flag's row (the flags tests require it).
- Test: `test/workflow-live-version.test.mjs`

**Interfaces:**
- Consumes:
  - `readVersion` and `liveVersionNo` (Task 3)
  - `flagEnabled` from `src/core/flags.mjs`
- Produces:
  - `readRunnableWorkflow(id, { use = 'live' }) → template | null`
    - `use`: `'live'` (the live version if the flag is on and one is set, else the row), `'draft'` (always the row), or a positive integer (that version; no flag needed, for Part 2).
    - The returned template has `versionNo: number | null`.
  - `assertRunnableWorkflow(id, { …, use = 'live' })`. With `checkGraph: false` it reads the draft, which is what the Composer opens.
  - `resolveGraph(…, { …, use = 'live' })`, whose result gains `versionNo`.
  - Run option `workflowUse` (`'live' | 'draft' | number`). `manifest.workflowVersion = { no }` when a named version ran.
  - Flag key `workflowTests`.

- [ ] **Step 1: Add the flag entry** to `src/shared/flags/registry.mjs` after the `requirements` entry:

```js
  entry({
    key: 'workflowTests',
    title: 'Workflow versions and tests',
    description: 'Save named versions of a workflow, choose which version new runs use, and restore any earlier save. Later: test a version on your own examples and compare it with another before runs use it.',
    stage: 'experimental',
    default: false,
    owner: 'TomicaB',
    since: '1.14.0',
    added: '2026-10-25',
    reviewBy: '2027-01-22',
    docs: 'docs/feature-flags.md',
  }),
```
In `docs/feature-flags.md`, add a row for `workflowTests` in the same format as the `requirements` row (title, stage experimental, owner TomicaB, what it turns on: the Versions page of a workflow, Save version, Use for new runs, history and restore). Run `node tools/test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`. If `flags-usage` requires a code use of the key, that use arrives in Step 4 below; run it again then.

- [ ] **Step 2: Write the failing test** — `test/workflow-live-version.test.mjs`

```js
// test/workflow-live-version.test.mjs — D2: once a workflow has versions, new runs use the version in use.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORCA_FLAGS = 'workflowTests';          // before the flag module is first read
const { writeGraphWorkflow, readRunnableWorkflow, assertRunnableWorkflow, resolveGraph } = await import('../src/core/workflows.mjs');
const { insertVersionTx, setLiveVersionTx } = await import('../src/core/workflow-revisions.mjs');
const { getDb, tx, _resetForTests } = await import('../src/core/db.mjs');
const { loadAgentRegistry } = await import('../src/core/agent-registry.mjs');

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wflive-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const v1 = () => ({
  id: 'wf_live', name: 'Live test', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
async function withVersion1ThenDraftEdit() {
  await writeGraphWorkflow(v1());
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_live');
  tx(() => { const no = insertVersionTx(row, { note: null, by: null, parts: [], fingerprint: 'f1' }); setLiveVersionTx('wf_live', no); });
  const draft = v1(); draft.name = 'Live test (draft)'; draft.nodes[1] = { ...draft.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(draft);
}

test('use: live → version 1; draft → the row; an explicit number → that version', async () => {
  await withVersion1ThenDraftEdit();
  const live = await readRunnableWorkflow('wf_live');
  assert.deepEqual([live.versionNo, live.name, live.nodes[1].config.model], [1, 'Live test', undefined]);
  const draft = await readRunnableWorkflow('wf_live', { use: 'draft' });
  assert.deepEqual([draft.versionNo ?? null, draft.nodes[1].config.model], [null, 'sonnet']);
  assert.equal((await readRunnableWorkflow('wf_live', { use: 1 })).versionNo, 1);
  await assert.rejects(readRunnableWorkflow('wf_live', { use: 7 }), { code: 'NOT_FOUND' });
});

test('a workflow without versions runs its row, exactly as before', async () => {
  await writeGraphWorkflow(v1());
  const t = await readRunnableWorkflow('wf_live');
  assert.equal(t.versionNo ?? null, null);
  assert.equal(t.name, 'Live test');
});

test('assertRunnableWorkflow checks what will run; checkGraph:false (the Composer) reads the draft', async () => {
  await withVersion1ThenDraftEdit();
  assert.equal((await assertRunnableWorkflow('wf_live')).versionNo, 1);
  assert.equal((await assertRunnableWorkflow('wf_live', { checkGraph: false })).name, 'Live test (draft)');
});

test('resolveGraph resolves the version in use and reports its number', async () => {
  await withVersion1ThenDraftEdit();
  const registry = loadAgentRegistry();
  const live = await resolveGraph(null, 'wf_live', registry);
  assert.equal(live.versionNo, 1);
  assert.equal(live.template.name, 'Live test');
  const draft = await resolveGraph(null, 'wf_live', registry, undefined, { use: 'draft' });
  assert.equal(draft.versionNo, null);
});
```
Then add one test of the flag-off case in a separate file, `test/workflow-live-version-flag-off.test.mjs`, because the flag is read per process:
```js
// test/workflow-live-version-flag-off.test.mjs — D9: with workflowTests off, runs ignore live_version_no.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGraphWorkflow, readRunnableWorkflow } from '../src/core/workflows.mjs';
import { insertVersionTx, setLiveVersionTx } from '../src/core/workflow-revisions.mjs';
import { getDb, tx, _resetForTests } from '../src/core/db.mjs';

const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfoff-'));
_resetForTests(); process.env.WORCA_HOME = dir; delete process.env.WORCA_FLAGS;
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await rm(dir, { recursive: true, force: true }); });

test('flag off: the row runs even with a version in use', async () => {
  await writeGraphWorkflow({ id: 'wf_off', name: 'Off', nodes: [{ id: 'n_task', kind: 'task', config: {} }], wires: [] });
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get('wf_off');
  tx(() => { setLiveVersionTx('wf_off', insertVersionTx(row, { parts: [], fingerprint: 'f' })); });
  await writeGraphWorkflow({ id: 'wf_off', name: 'Off draft', nodes: [{ id: 'n_task', kind: 'task', config: {} }], wires: [] });
  assert.equal((await readRunnableWorkflow('wf_off')).name, 'Off draft');
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node tools/test.mjs test/workflow-live-version.test.mjs test/workflow-live-version-flag-off.test.mjs`
Expected: FAIL. `readRunnableWorkflow` is not exported.

- [ ] **Step 4: Implement in `src/core/workflows.mjs`**

Add to the imports:
```js
import { readVersion, liveVersionNo } from './workflow-revisions.mjs';
import { flagEnabled } from './flags.mjs';
```
Add after `readWorkflow`:
```js
/**
 * What a RUN of this workflow uses (plans/workflow-tests-plan.md D2, D9, D13). `use`:
 *   'live'  (default) — the version marked in use when the workflowTests flag is on and one is set; else the row
 *   'draft' — always the row (the canvas's draft)
 *   n > 0   — that named version (the Tests page; no flag needed: its routes are flag-gated)
 * Built-ins and plugin rows are never versioned: they come back as readWorkflow returns them. The result carries
 * `versionNo` (null = the row).
 * @param {string} id
 * @param {{use?: 'live'|'draft'|number}} [opts]
 */
export async function readRunnableWorkflow(id, { use = 'live' } = {}) {
  const row = await readWorkflow(id);
  if (!row || row.version !== 2 || isReservedWorkflowId(row.id)
    || (typeof row.origin === 'string' && row.origin.startsWith('plugin:'))) return row;
  let no = null;
  if (Number.isInteger(use) && use > 0) no = use;
  else if (use === 'live' && flagEnabled('workflowTests')) no = liveVersionNo(row.id);
  if (!no) return { ...row, versionNo: null };
  const v = readVersion(row.id, no);
  if (!v) throw Object.assign(new Error(`workflow "${id}" has no version ${no}`), { code: 'NOT_FOUND' });
  const g = v.graph && typeof v.graph === 'object' ? v.graph : {};
  const { canvas: _c, codeGraph: _g, nodes: _n, wires: _w, ...rest } = row;
  return {
    ...rest, name: v.name, domain: v.domain || row.domain,
    nodes: Array.isArray(g.nodes) ? g.nodes : [], wires: Array.isArray(g.wires) ? g.wires : [],
    ...(g.canvas && typeof g.canvas === 'object' ? { canvas: g.canvas } : {}),
    ...(g.codeGraph === false ? { codeGraph: false } : {}),
    versionNo: no,
  };
}
```
In `assertRunnableWorkflow`, change the signature and the first read:
```js
export async function assertRunnableWorkflow(id, { registry, scripts, checkGraph = true, use = 'live' } = {}) {
  const wanted = typeof id === 'string' && id.trim() ? id.trim() : GRAPH_DEFAULT_WORKFLOW.id;
  if (wanted === AUTO_WORKFLOW_ID) return AUTO_WORKFLOW_STUB;
  // D2: a run is checked against what it will run; the Composer's read (checkGraph:false) opens the draft.
  const live = await readRunnableWorkflow(wanted, { use: checkGraph ? use : 'draft' });
```
The rest of the function is unchanged. In `resolveGraph`, replace `const stored = await readWorkflow(workflowId);` with:
```js
  const stored = await readRunnableWorkflow(workflowId, { use: opts.use ?? 'live' });
```
and change the return (:805) to:
```js
  return { template: tpl, ports: portsFn, loops, nodes, wires, agentsByKey, agentKeys, scriptsByKey, scriptKeys, versionNo: stored.versionNo ?? null };
```

- [ ] **Step 5: Thread `use` through the run and record it, in `src/core/orchestrator.mjs` `_resolveTopology`**

In the `resolveGraph(this.projectDir, this.workflowId, …, {` call (:191), add as the first option:
```js
      use: this.opts && this.opts.workflowUse !== undefined ? this.opts.workflowUse : 'live',
```
After `if (overlay) manifest.runOverlay = structuredClone(overlay);` add:
```js
    // D8: the named version this run used (plans/workflow-tests-plan.md); absent = the workflow's row.
    if (Number.isInteger(resolved.versionNo)) manifest.workflowVersion = { no: resolved.versionNo };
```
In `src/core/workflow-export.mjs:400`, export the draft:
```js
  const graph = await resolveGraph(destination === 'project' ? projectDir : null, workflowId, registry, undefined, { use: 'draft' });
```
Add to `test/workflow-live-version.test.mjs` a run-level test that uses the offline harness from `test/orchestrator-no-project.test.mjs`:
```js
test('a run records the version it used in its manifest', async () => {
  await withVersion1ThenDraftEdit();
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const { newPipelineId, findPipelineRowById } = await import('../src/core/artifacts.mjs');
  const { NO_PROJECT_KEY, noProjectWorkDir } = await import('../src/core/store.mjs');
  const pipelineId = newPipelineId();
  const orch = createOrchestrator({ workMode: 'none', pipelineId, projectKey: NO_PROJECT_KEY, projectDir: noProjectWorkDir(pipelineId),
    workflowId: 'wf_live', prompt: 'x', claude: { mock: true }, auto: true });
  await orch.run();
  const stepper = JSON.parse(findPipelineRowById(pipelineId).stepper);
  assert.deepEqual(stepper.workflowVersion, { no: 1 });
  assert.equal(stepper.template.name, 'Live test');
});
```
This uses the same mock no-project run as `test/orchestrator-no-project.test.mjs:52` (`workMode: 'none'`, `claude: { mock: true }`, `auto: true`). That file puts `WORCA_HOME` inside a git repository only to watch for git calls, which this test does not do.

- [ ] **Step 6: Run the tests and the run-path suites**

Run: `node tools/test.mjs test/workflow-live-version.test.mjs test/workflow-live-version-flag-off.test.mjs test/workflows-resolve-graph.test.mjs test/run-workflow-gate.test.mjs test/orchestrator-graph.test.mjs test/orchestrator-graph-resume.test.mjs test/orchestrator-no-project.test.mjs test/api-workflows.test.mjs test/workflow-export-plugin.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/workflows.mjs src/core/orchestrator.mjs src/core/workflow-export.mjs src/shared/flags/registry.mjs docs/feature-flags.md test/workflow-live-version.test.mjs test/workflow-live-version-flag-off.test.mjs
git commit -m "Workflow tests: new runs use the version in use; runs record it (flag workflowTests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Versions service — Save version, Use, status, restore, overview

**Files:**
- Create: `src/core/workflow-versions.mjs`
- Modify: `src/core/workflow-share.mjs`, `saveGraphWorkflow` (:219), to pass a `revision` option through to `writeGraphWorkflow`.
- Test: `test/workflow-versions.test.mjs`

**Interfaces:**
- Consumes: Tasks 2, 3 and 4.
- Produces:
  - `createVersion(workflowId, { note?, by?, deps? }) → Promise<{ versionNo, liveVersionNo }>`
    - Throws `NOT_FOUND`, `NOT_VERSIONABLE`, or `UNCHANGED` (with `.versionNo`).
    - The first version becomes live.
  - `useVersion(workflowId, versionNo) → { liveVersionNo }`. Throws `NOT_FOUND`.
  - `versionStatus(workflowId, { deps? }) → Promise<{ liveVersionNo, latestVersionNo, draft: null | { changed: boolean, changes: string[], partsChanged: Array<{kind,key}> } }>`
  - `restoreRevision(workflowId, revisionId, { by?, agentsDir? }) → Promise<{ workflow, warnings }>`. Throws `NOT_FOUND` or `INVALID_GRAPH`.
  - `versionsOverview(workflowId, { deps? }) → Promise<{ workflowId, name, liveVersionNo, draft, versions: Array<{ id, versionNo, note, by, createdAt, inUse, runs, changes: string[] }>, history: Array<{ id, source, by, createdAt, name }> }>`
  - `saveGraphWorkflow(body, { …, revision?: { source, by } })`
  - `deps = { registry?, scripts?, readText?, scriptSource? }`, passed to `workflowParts` and used for labels.

- [ ] **Step 1: Write the failing test** — `test/workflow-versions.test.mjs`

```js
// test/workflow-versions.test.mjs — Save version, Use for new runs, what changed, restore into draft.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORCA_FLAGS = 'workflowTests';
const { writeGraphWorkflow, readWorkflow } = await import('../src/core/workflows.mjs');
const { createVersion, useVersion, versionStatus, restoreRevision, versionsOverview } = await import('../src/core/workflow-versions.mjs');
const { listRevisions, liveVersionNo } = await import('../src/core/workflow-revisions.mjs');
const { _resetForTests, getDb } = await import('../src/core/db.mjs');

const homes = [];
let deps;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfver-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  const md = join(dir, 'planner.md');
  await writeFile(md, 'Plan it.');
  deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {}, mdPath: md };
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const tpl = (over = {}) => ({
  id: 'wf_v', name: 'Versioned', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
  ...over,
});

test('the first version becomes the one in use; saving again without changes is refused', async () => {
  await writeGraphWorkflow(tpl());
  const v = await createVersion('wf_v', { note: 'First', by: 'Tomica', deps });
  assert.deepEqual(v, { versionNo: 1, liveVersionNo: 1 });
  await assert.rejects(createVersion('wf_v', { deps }), { code: 'UNCHANGED', versionNo: 1 });
});

test('a later version does not change what runs until Use', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  await writeGraphWorkflow(tpl({ name: 'Versioned 2' }));
  assert.deepEqual(await createVersion('wf_v', { deps }), { versionNo: 2, liveVersionNo: 1 });
  assert.deepEqual(useVersion('wf_v', 2), { liveVersionNo: 2 });
  assert.equal(liveVersionNo('wf_v'), 2);
  assert.throws(() => useVersion('wf_v', 9), { code: 'NOT_FOUND' });
});

test('status: the draft differs from the version in use, in plain words, including a Library edit', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  const t = tpl(); t.nodes[1] = { ...t.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(t);
  await writeFile(deps.mdPath, 'Plan it carefully.');
  const s = await versionStatus('wf_v', { deps });
  assert.equal(s.liveVersionNo, 1);
  assert.equal(s.draft.changed, true);
  assert.deepEqual(s.draft.changes, ['Planner: AI model default → sonnet', 'Planner: changed in the Library']);
  assert.deepEqual(s.draft.partsChanged, [{ kind: 'agent', key: 'planner' }]);
});

test('status without versions: draft is null', async () => {
  await writeGraphWorkflow(tpl());
  assert.deepEqual(await versionStatus('wf_v', { deps }), { liveVersionNo: null, latestVersionNo: null, draft: null });
});

test('restore puts a saved state into the draft, keeps the version in use, and can itself be undone', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { deps });
  await writeGraphWorkflow(tpl({ name: 'Edited' }));
  const auto = listRevisions('wf_v').find((r) => r.versionNo === null);
  await restoreRevision('wf_v', auto.id, { by: 'Tomica' });
  assert.equal((await readWorkflow('wf_v')).name, 'Versioned');
  assert.equal(liveVersionNo('wf_v'), 1);
  assert.equal(listRevisions('wf_v')[0].source, 'restore');
  await assert.rejects(restoreRevision('wf_v', 99999), { code: 'NOT_FOUND' });
});

test('plugin rows cannot be versioned; unknown ids are NOT_FOUND', async () => {
  await writeGraphWorkflow(tpl({ id: 'wfp_p_x', origin: 'plugin:p' }));
  await assert.rejects(createVersion('wfp_p_x', { deps }), { code: 'NOT_VERSIONABLE' });
  await assert.rejects(createVersion('wf_nope', { deps }), { code: 'NOT_FOUND' });
});

test('overview: versions newest first with what changed, in use, runs; history of automatic saves', async () => {
  await writeGraphWorkflow(tpl());
  await createVersion('wf_v', { note: 'First', deps });
  await writeGraphWorkflow(tpl({ name: 'Versioned 2' }));
  await createVersion('wf_v', { note: 'Renamed', deps });
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, stepper) VALUES ('p1', 'k', 'done', ?)`)
    .run(JSON.stringify({ template: { id: 'wf_v', name: 'Versioned' }, workflowVersion: { no: 1 } }));
  const o = await versionsOverview('wf_v', { deps });
  assert.deepEqual(o.versions.map((v) => [v.versionNo, v.inUse, v.runs]), [[2, false, 0], [1, true, 1]]);
  assert.deepEqual(o.versions[0].changes, ['Renamed from "Versioned" to "Versioned 2"']);
  assert.deepEqual(o.versions[1].changes, ['First version']);
  assert.deepEqual(o.history.map((h) => h.source), ['save']);
});
```
`pipelines` (`src/core/db.mjs:255`) needs only `id` and `project_key`: every other column has a default.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-versions.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-versions.mjs'`.

- [ ] **Step 3: Pass the revision option through `saveGraphWorkflow`** (`src/core/workflow-share.mjs:219`)

```js
export async function saveGraphWorkflow(body, { registry, agentsDir, origin = null, confirmScripts = false, acceptScripts = null, revision = null } = {}) {
```
and change its write to:
```js
  const workflow = await writeGraphWorkflow(typeof origin === 'string' && origin ? { ...graph, origin } : graph, {
    rejectCollision: true,
    ...(revision && typeof revision === 'object' ? { revisionSource: revision.source, by: revision.by ?? null } : {}),
  });
```

- [ ] **Step 4: Implement `src/core/workflow-versions.mjs`**

```js
// src/core/workflow-versions.mjs
// Named workflow versions (plans/workflow-tests-plan.md Part 1): Save version, Use for new runs, what changed since
// the version in use, restore into the draft, and the Versions page's overview. Storage: workflow-revisions.mjs.
import { getDb, prepare, tx } from './db.mjs';
import { isSafeWorkflowId } from './workflows.mjs';
import { saveGraphWorkflow } from './workflow-share.mjs';
import {
  isVersionableRow, insertVersionTx, setLiveVersionTx, listRevisions, readRevision, readVersion, latestVersion,
} from './workflow-revisions.mjs';
import { workflowFingerprint } from './workflow-fingerprint.mjs';
import { workflowParts } from './workflow-parts.mjs';
import { diffGraphs } from '../shared/graph/diff-graphs.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { loadScriptRegistry } from './script-registry.mjs';

const NOTE_MAX = 200;
const coded = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };

function versionableRow(workflowId) {
  if (!isSafeWorkflowId(workflowId)) throw coded(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  getDb();
  const row = prepare('SELECT id, name, version, domain, graph, origin, archived_at, live_version_no FROM workflows WHERE id = ?').get(workflowId);
  if (!row || row.archived_at) throw coded(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  if (!isVersionableRow(row)) throw coded(`"${row.name}" cannot have versions: it comes from a plugin or is not a graph`, 'NOT_VERSIONABLE');
  return row;
}

function registries(deps = {}) {
  const registry = deps.registry && typeof deps.registry === 'object' ? deps.registry : loadAgentRegistry();
  const scripts = deps.scripts && typeof deps.scripts === 'object' ? deps.scripts : loadScriptRegistry({ agentKeys: Object.keys(registry) });
  return { registry, scripts };
}
const labeler = ({ registry, scripts }) => (n) => {
  const meta = n && n.kind === 'agent' ? registry[n.key] : n && n.kind === 'script' ? scripts[n.key] : null;
  return (meta && meta.displayName) || (n && (n.key || n.kind)) || 'step';
};

/** Save version: keep the row as the next numbered version. The first version is also put in use (D2). */
export async function createVersion(workflowId, { note = null, by = null, deps = {} } = {}) {
  const row = versionableRow(workflowId);
  const graph = parse(row.graph, {});
  const regs = registries(deps);
  const parts = await workflowParts(graph, { ...deps, ...regs });
  const fingerprint = workflowFingerprint(graph, parts);
  const last = latestVersion(workflowId);
  if (last && last.fingerprint === fingerprint && last.name === row.name) {
    throw coded(`nothing changed since version ${last.versionNo}`, 'UNCHANGED', { versionNo: last.versionNo });
  }
  const clean = typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_MAX) : null;
  let versionNo = 0;
  let live = row.live_version_no ?? null;
  tx(() => {
    versionNo = insertVersionTx(row, { note: clean, by, parts, fingerprint });
    if (!live) { setLiveVersionTx(workflowId, versionNo); live = versionNo; }
  });
  return { versionNo, liveVersionNo: live };
}

/** Use for new runs. */
export function useVersion(workflowId, versionNo) {
  versionableRow(workflowId);
  const n = Number(versionNo);
  if (!Number.isInteger(n) || n < 1 || !readVersion(workflowId, n)) throw coded(`no version ${versionNo}`, 'NOT_FOUND');
  tx(() => { setLiveVersionTx(workflowId, n); });
  return { liveVersionNo: n };
}

/** The draft compared with the version in use (null when the workflow has no version in use). */
export async function versionStatus(workflowId, { deps = {} } = {}) {
  const row = versionableRow(workflowId);
  const latest = latestVersion(workflowId);
  const live = row.live_version_no ? readVersion(workflowId, row.live_version_no) : null;
  if (!live) return { liveVersionNo: null, latestVersionNo: latest ? latest.versionNo : null, draft: null };
  const regs = registries(deps);
  const labelOf = labeler(regs);
  const graph = parse(row.graph, {});
  const parts = await workflowParts(graph, { ...deps, ...regs });
  const changes = diffGraphs({ name: live.name, ...live.graph }, { name: row.name, ...graph }, { labelOf }).map((c) => c.text);
  const before = new Map((live.parts || []).map((p) => [`${p.kind}:${p.key}`, p.hash]));
  const partsChanged = parts.filter((p) => before.has(`${p.kind}:${p.key}`) && before.get(`${p.kind}:${p.key}`) !== p.hash)
    .map((p) => ({ kind: p.kind, key: p.key }));
  for (const p of partsChanged) changes.push(`${labelOf(p)}: changed in the Library`);
  const changed = workflowFingerprint(graph, parts) !== live.fingerprint || row.name !== live.name;
  return { liveVersionNo: live.versionNo, latestVersionNo: latest ? latest.versionNo : null, draft: { changed, changes, partsChanged } };
}

/** Restore into draft (D4): through the validating save; a state that no longer fits is refused (INVALID_GRAPH). */
export async function restoreRevision(workflowId, revisionId, { by = null, agentsDir } = {}) {
  const row = versionableRow(workflowId);
  const rev = readRevision(workflowId, Number(revisionId));
  if (!rev) throw coded(`no saved state ${revisionId} for "${row.name}"`, 'NOT_FOUND');
  const g = rev.graph || {};
  const body = {
    id: workflowId, version: 2, name: rev.name, ...(rev.domain ? { domain: rev.domain } : {}),
    nodes: Array.isArray(g.nodes) ? g.nodes : [], wires: Array.isArray(g.wires) ? g.wires : [],
    ...(g.canvas ? { canvas: g.canvas } : {}), ...(g.codeGraph === false ? { codeGraph: false } : {}),
  };
  return saveGraphWorkflow(body, { agentsDir, revision: { source: 'restore', by } });
}

function runCounts(workflowId) {
  getDb();
  const rows = prepare(`SELECT json_extract(stepper, '$.workflowVersion.no') AS no, COUNT(*) AS n FROM pipelines
    WHERE json_extract(stepper, '$.template.id') = ? GROUP BY no`).all(workflowId);
  return new Map(rows.filter((r) => r.no !== null).map((r) => [Number(r.no), Number(r.n)]));
}

/** Everything the Versions page shows, in one read. */
export async function versionsOverview(workflowId, { deps = {} } = {}) {
  const row = versionableRow(workflowId);
  const status = await versionStatus(workflowId, { deps });
  const labelOf = labeler(registries(deps));
  const all = listRevisions(workflowId);
  const named = all.filter((r) => r.versionNo !== null).sort((a, b) => b.versionNo - a.versionNo);
  const counts = runCounts(workflowId);
  const versions = named.map((v, i) => {
    const prev = named[i + 1] ? readVersion(workflowId, named[i + 1].versionNo) : null;
    const cur = readVersion(workflowId, v.versionNo);
    const changes = prev
      ? diffGraphs({ name: prev.name, ...prev.graph }, { name: cur.name, ...cur.graph }, { labelOf }).map((c) => c.text)
      : ['First version'];
    return { id: v.id, versionNo: v.versionNo, note: v.note, by: v.by, createdAt: v.createdAt,
      inUse: v.versionNo === status.liveVersionNo, runs: counts.get(v.versionNo) || 0, changes };
  });
  const history = all.filter((r) => r.versionNo === null).map((r) => ({ id: r.id, source: r.source, by: r.by, createdAt: r.createdAt, name: r.name }));
  return { workflowId, name: row.name, liveVersionNo: status.liveVersionNo, draft: status.draft, versions, history };
}
```
`versions[].changes` lists what changed in that version compared with the one before it. For v1 it is `['First version']`.

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-versions.test.mjs test/workflow-revisions.test.mjs test/workflow-share.test.mjs test/workflow-share-api.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow-versions.mjs src/core/workflow-share.mjs test/workflow-versions.test.mjs
git commit -m "Workflow tests: Save version, Use for new runs, what changed, restore into draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Routes

**Files:**
- Create: `src/core/workflow-versions-routes.mjs`. Registered from one call, like `src/core/requirements/routes.mjs`.
- Modify: `ui/server.mjs`:
  - the import near :327
  - the registration right after `app.post('/api/workflows', …)` (:13032–13044)
- Test: `test/api-workflow-versions.test.mjs`

**Interfaces:**
- Consumes: Task 5. `requireFlag` from `src/core/flags.mjs`.
- Produces (all behind `requireFlag('workflowTests')`):
  - `GET /api/workflows/:id/versions` → `versionsOverview`
  - `POST /api/workflows/:id/versions` with `{ note?, use? }` → `201` with the overview
  - `POST /api/workflows/:id/versions/:no/use` → the overview
  - `GET /api/workflows/:id/history` → `{ revisions }`, the `listRevisions` result
  - `GET /api/workflows/:id/history/:rev` → `{ revision }`, the `readRevision` result
  - `POST /api/workflows/:id/history/:rev/restore` → `{ workflow, warnings, overview }`
  - Error mapping: `NOT_FOUND` 404, `NOT_VERSIONABLE` 400, `UNCHANGED` 409 (`{ error, versionNo }`), `INVALID_GRAPH` 422 (`{ error, errors, warnings }`), anything else 500.

- [ ] **Step 1: Write the failing test** — `test/api-workflow-versions.test.mjs`

```js
// test/api-workflow-versions.test.mjs — the Versions routes (flag workflowTests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, srv, base, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const graphBody = (name) => ({
  version: 2, id: 'wf_api_v', name, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body || {}) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfvapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('save version, edit, save again, use, restore — over HTTP', async () => {
  assert.equal((await post('/api/workflows', graphBody('API versions'))).status, 201);
  let r = await post('/api/workflows/wf_api_v/versions', { note: 'First' });
  assert.equal(r.status, 201);
  let o = await r.json();
  assert.deepEqual([o.liveVersionNo, o.versions.length, o.versions[0].note], [1, 1, 'First']);
  assert.equal((await post('/api/workflows/wf_api_v/versions', {})).status, 409);

  assert.equal((await post('/api/workflows', graphBody('API versions 2'))).status, 201);
  o = await (await fetch(`${base}/api/workflows/wf_api_v/versions`)).json();
  assert.equal(o.draft.changed, true);
  r = await post('/api/workflows/wf_api_v/versions', { note: 'Renamed', use: true });
  o = await r.json();
  assert.deepEqual([o.liveVersionNo, o.versions.map((v) => v.versionNo)], [2, [2, 1]]);
  o = await (await post('/api/workflows/wf_api_v/versions/1/use')).json();
  assert.equal(o.liveVersionNo, 1);
  assert.equal((await post('/api/workflows/wf_api_v/versions/9/use')).status, 404);

  const h = await (await fetch(`${base}/api/workflows/wf_api_v/history`)).json();
  const auto = h.revisions.find((x) => x.versionNo === null);
  const one = await (await fetch(`${base}/api/workflows/wf_api_v/history/${auto.id}`)).json();
  assert.equal(one.revision.graph.nodes.length, 3);
  r = await post(`/api/workflows/wf_api_v/history/${auto.id}/restore`);
  assert.equal(r.status, 200);
  const back = await r.json();
  assert.equal(back.workflow.name, 'API versions');
  assert.equal(back.overview.liveVersionNo, 1);
});

test('unknown workflow → 404', async () => {
  assert.equal((await fetch(`${base}/api/workflows/wf_none/versions`)).status, 404);
});
```
Add `test/api-workflow-versions-flag-off.test.mjs` with the same `before`, but without `WORCA_FLAGS`. Its one test asserts that `GET /api/workflows/wf_x/versions` and `POST /api/workflows/wf_x/versions` both answer 404.

- [ ] **Step 2: Run them to verify they fail**

Run: `node tools/test.mjs test/api-workflow-versions.test.mjs`
Expected: FAIL. The version routes are missing: the POST falls to Express's 404, so the first `201` assertion fails.

- [ ] **Step 3: Implement `src/core/workflow-versions-routes.mjs`**

```js
// src/core/workflow-versions-routes.mjs — HTTP for workflow versions and history (plans/workflow-tests-plan.md
// Task 6; #721's routes for workflows). Every route is behind the workflowTests flag.
import { requireFlag } from './flags.mjs';
import { actorOf as identityActorOf } from './identity.mjs';
import { createVersion, useVersion, restoreRevision, versionsOverview } from './workflow-versions.mjs';
import { listRevisions, readRevision } from './workflow-revisions.mjs';

function send(res, err) {
  const code = err && err.code;
  const message = err && err.message ? err.message : String(err);
  if (code === 'NOT_FOUND') return res.status(404).json({ error: message });
  if (code === 'NOT_VERSIONABLE' || code === 'BAD_REQUEST') return res.status(400).json({ error: message });
  if (code === 'UNCHANGED') return res.status(409).json({ error: message, versionNo: err.versionNo });
  if (code === 'INVALID_GRAPH') return res.status(422).json({ error: message, errors: err.errors || [], warnings: err.warnings || [] });
  return res.status(500).json({ error: message });
}

/** @param {import('express').Express} app @param {{agentsDir?: string, actorOf?: (req) => string|null}} [opts] */
export function registerWorkflowVersionRoutes(app, { agentsDir, actorOf = (req) => identityActorOf(req) || null } = {}) {
  const gate = requireFlag('workflowTests');
  const base = '/api/workflows/:id';
  app.get(`${base}/versions`, gate, async (req, res) => {
    try { res.json(await versionsOverview(req.params.id)); } catch (err) { send(res, err); }
  });
  app.post(`${base}/versions`, gate, async (req, res) => {
    try {
      const body = req.body || {};
      const v = await createVersion(req.params.id, { note: typeof body.note === 'string' ? body.note : null, by: actorOf(req) });
      if (body.use === true) useVersion(req.params.id, v.versionNo);
      res.status(201).json(await versionsOverview(req.params.id));
    } catch (err) { send(res, err); }
  });
  app.post(`${base}/versions/:no/use`, gate, async (req, res) => {
    try { useVersion(req.params.id, Number(req.params.no)); res.json(await versionsOverview(req.params.id)); } catch (err) { send(res, err); }
  });
  app.get(`${base}/history`, gate, (req, res) => {
    try { res.json({ revisions: listRevisions(req.params.id) }); } catch (err) { send(res, err); }
  });
  app.get(`${base}/history/:rev`, gate, (req, res) => {
    try {
      const revision = readRevision(req.params.id, Number(req.params.rev));
      if (!revision) return res.status(404).json({ error: `no saved state ${req.params.rev}` });
      res.json({ revision });
    } catch (err) { send(res, err); }
  });
  app.post(`${base}/history/:rev/restore`, gate, async (req, res) => {
    try {
      const { workflow, warnings } = await restoreRevision(req.params.id, Number(req.params.rev), { by: actorOf(req), agentsDir });
      res.json({ workflow, warnings, overview: await versionsOverview(req.params.id) });
    } catch (err) { send(res, err); }
  });
}
```
In `ui/server.mjs`, import it next to the requirements import (:327):
```js
import { registerWorkflowVersionRoutes } from '../src/core/workflow-versions-routes.mjs';
```
and register it right after the `app.post('/api/workflows', …)` handler:
```js
// Workflow versions + history (plans/workflow-tests-plan.md Part 1; #721 workflow part). Flag workflowTests.
registerWorkflowVersionRoutes(app, { agentsDir: AGENTS_DIR });
```
"Who" is recorded with `actorOf(req)` from `src/core/identity.mjs:50`, the same identity `ui/server.mjs:222` imports for run attribution.

- [ ] **Step 4: Run the tests**

Run: `node tools/test.mjs test/api-workflow-versions.test.mjs test/api-workflow-versions-flag-off.test.mjs test/api-workflows.test.mjs test/api-workflows-graph.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow-versions-routes.mjs ui/server.mjs test/api-workflow-versions.test.mjs test/api-workflow-versions-flag-off.test.mjs
git commit -m "Workflow tests: versions and history routes (flag workflowTests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Workflow top bar — Canvas · Versions, the status line, Save version

This matches boards 1 and 7 (top bar) of the canvas. The **Tests** tab arrives in Part 2.

**Files:**
- Modify: `ui/public/index.html` (the workflow top bar :1484–1508)
- Create: `ui/public/workflows/version-dialogs.mjs`, with the Save version and Use dialogs
- Modify: `ui/public/app.js`:
  - `wfvEls` (:3247)
  - `gvApi` (~:3208)
  - `wfvShellActions` (:3385)
- Modify: `ui/public/style.css`, the `.wfv-pages` and `.wfv-vstatus` rules, tokens only
- Test: `test/ui-workflow-version-dialogs.test.mjs`, `test/ui-workflows-markup.test.mjs` (extend)

**Interfaces:**
- Consumes: the Task 6 routes.
- Produces:
  - `openSaveVersionDialog({ doc, win, nextNo, changes, onSubmit })`, where `onSubmit({ note, use }) → Promise<{ ok, error? }>`
  - `openUseVersionDialog({ doc, win, versionNo, changes, onConfirm })`, where `onConfirm() → Promise<{ ok, error? }>`
  - `statusText(overview) → string`:
    - `''` when there is no version
    - `'v4 in use'` when the draft equals the version in use
    - `'Draft · new runs use v4'` when it differs
  - DOM ids: `#wfv-pages` (a `.seg` with `Canvas` and `Versions` buttons), `#wfv-vstatus`, `#wfv-saveversion`, `#wfv-versions` (the page container)

- [ ] **Step 1: Write the failing dialog test** — `test/ui-workflow-version-dialogs.test.mjs`

```js
// test/ui-workflow-version-dialogs.test.mjs — Save version / Use dialogs and the top-bar status line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openSaveVersionDialog, openUseVersionDialog, statusText } from '../ui/public/workflows/version-dialogs.mjs';

const dom = () => { const d = new JSDOM('<!doctype html><body></body>'); return { doc: d.window.document, win: d.window }; };
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

test('statusText: nothing, in use, or draft', () => {
  assert.equal(statusText({ liveVersionNo: null, draft: null }), '');
  assert.equal(statusText({ liveVersionNo: 4, draft: { changed: false, changes: [] } }), 'v4 in use');
  assert.equal(statusText({ liveVersionNo: 4, draft: { changed: true, changes: ['x'] } }), 'Draft · new runs use v4');
});

test('Save version: title, the changes, a note, and "Also use v5 for new runs"', async () => {
  const { doc, win } = dom();
  let sent = null;
  openSaveVersionDialog({ doc, win, nextNo: 5, changes: ['New step Fact check'], onSubmit: async (b) => { sent = b; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Save version 5');
  assert.deepEqual([...doc.querySelectorAll('.wfv-changes li')].map((li) => li.textContent), ['New step Fact check']);
  doc.querySelector('#wfv-sv-note').value = 'Cheaper drafting';
  doc.querySelector('#wfv-sv-use').checked = true;
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Save version 5'));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, { note: 'Cheaper drafting', use: true });
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes on success');
});

test('Save version shows the error and stays open on failure', async () => {
  const { doc, win } = dom();
  openSaveVersionDialog({ doc, win, nextNo: 2, changes: [], onSubmit: async () => ({ ok: false, error: 'nothing changed since version 1' }) });
  assert.equal(doc.querySelector('.wfv-changes-none').textContent, 'No changes since the last version.');
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Save version 2'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('.wfv-dlg-error').textContent, 'nothing changed since version 1');
  assert.ok(doc.querySelector('#mk-dialog'));
});

test('Use dialog: plain words and one confirming button', async () => {
  const { doc, win } = dom();
  let used = 0;
  openUseVersionDialog({ doc, win, versionNo: 5, changes: ['Draft brief: AI model opus → sonnet'], onConfirm: async () => { used += 1; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Use v5 for new runs?');
  assert.match(doc.querySelector('.mk-dialog-body').textContent, /Runs already going keep their version\. You can switch back at any time\./);
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Use v5'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(used, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-version-dialogs.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `ui/public/workflows/version-dialogs.mjs`**

```js
// ui/public/workflows/version-dialogs.mjs — Save version and Use dialogs + the top-bar status line
// (plans/workflow-tests-plan.md Task 7; canvas boards 7 and 8). Pure DOM on the shared dialog layout.
import { createDialog } from '../marketplace/layers.mjs';

/** The top-bar line next to the name (D10 words). */
export function statusText(o) {
  if (!o || !Number.isInteger(o.liveVersionNo)) return '';
  return o.draft && o.draft.changed ? `Draft · new runs use v${o.liveVersionNo}` : `v${o.liveVersionNo} in use`;
}

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function changesList(doc, changes, none) {
  if (!Array.isArray(changes) || !changes.length) return el(doc, 'p', 'hint wfv-changes-none', none);
  const ul = el(doc, 'ul', 'wfv-changes');
  for (const c of changes) ul.append(el(doc, 'li', '', c));
  return ul;
}

function frame({ doc, win, title, body, confirmLabel, onConfirm }) {
  const dlg = createDialog({ doc, win, width: 'md' });
  const h = el(doc, 'h2', 'mk-dialog-title', title); h.id = 'mk-dialog-title';
  const error = el(doc, 'p', 'hint err wfv-dlg-error'); error.setAttribute('aria-live', 'polite');
  const cancel = el(doc, 'button', 'btn', 'Cancel'); cancel.type = 'button';
  const ok = el(doc, 'button', 'btn btn-primary', confirmLabel); ok.type = 'button';
  cancel.addEventListener('click', () => dlg.close());
  ok.addEventListener('click', async () => {
    dlg.setBusy(true); ok.disabled = true; error.textContent = '';
    let res;
    try { res = await onConfirm(); } catch (e) { res = { ok: false, error: e && e.message ? e.message : String(e) }; }
    dlg.setBusy(false); ok.disabled = false;
    if (res && res.ok) dlg.close(); else error.textContent = (res && res.error) || 'That did not work. Try again.';
  });
  dlg.replace({ head: [h], body: [...body, error], foot: [cancel, ok] });
  dlg.open();
  return dlg;
}

/** Save version N: what changed since the last version, a short note, and "Also use vN for new runs". */
export function openSaveVersionDialog({ doc, win, nextNo, changes, onSubmit }) {
  const label = el(doc, 'label', 'label', 'What changed, in a few words '); label.htmlFor = 'wfv-sv-note';
  label.append(el(doc, 'span', 'opt', 'optional'));
  const note = el(doc, 'input'); note.type = 'text'; note.id = 'wfv-sv-note'; note.maxLength = 200;
  const useWrap = el(doc, 'label', 'wfv-check');
  const use = el(doc, 'input'); use.type = 'checkbox'; use.id = 'wfv-sv-use';
  useWrap.append(use, el(doc, 'span', '', ` Also use v${nextNo} for new runs`));
  const field = el(doc, 'div', 'field'); field.append(label, note);
  return frame({
    doc, win, title: `Save version ${nextNo}`, confirmLabel: `Save version ${nextNo}`,
    body: [el(doc, 'p', 'hint', 'What changed since the last version:'), changesList(doc, changes, 'No changes since the last version.'), field, useWrap],
    onConfirm: () => onSubmit({ note: note.value.trim(), use: use.checked }),
  });
}

/** Use vN for new runs? (board 8, D2/D12: no gate — the person decides). */
export function openUseVersionDialog({ doc, win, versionNo, changes, onConfirm }) {
  return frame({
    doc, win, title: `Use v${versionNo} for new runs?`, confirmLabel: `Use v${versionNo}`,
    body: [
      el(doc, 'p', '', `Runs you start from now on use v${versionNo}: from the Runs page, schedules and chats. Runs already going keep their version. You can switch back at any time.`),
      el(doc, 'p', 'hint', `Compared with the version in use now:`),
      changesList(doc, changes, 'Nothing differs from the version in use.'),
    ],
    onConfirm,
  });
}
```

- [ ] **Step 4: Markup in `ui/public/index.html`**

In `.wfv-tl .wfv-bar`, right after the `#wfv-name` input, add:
```html
                  <span class="wfv-vstatus hint" id="wfv-vstatus" data-flag="workflowTests" aria-live="polite" hidden></span>
                  <span class="wfv-sep" aria-hidden="true" data-flag="workflowTests"></span>
                  <div class="seg wfv-pages" id="wfv-pages" role="tablist" aria-label="Workflow views" data-flag="workflowTests" data-flag-chip>
                    <button type="button" role="tab" aria-selected="true" class="on" data-page="canvas">Canvas</button>
                    <button type="button" role="tab" aria-selected="false" data-page="versions">Versions</button>
                  </div>
```
In `.wfv-tr .wfv-bar`, right before `#wfv-savewrap`, add:
```html
                  <button type="button" class="btn btn-quiet" id="wfv-saveversion" data-flag="workflowTests">Save version</button>
```
After the closing tag of `.wfv-stage` (#wfv-stage), add the page container:
```html
            <section class="wfv-versions" id="wfv-versions" data-flag="workflowTests" aria-label="Versions" hidden></section>
```
Extend `test/ui-workflows-markup.test.mjs` with a test that parses `ui/public/index.html` and asserts:
- `#wfv-pages` exists with `data-flag="workflowTests"`, holding the buttons `Canvas` and `Versions`
- `#wfv-saveversion` exists with text `Save version` and `data-flag="workflowTests"`
- `#wfv-versions` exists and is `hidden`

- [ ] **Step 5: Styles in `ui/public/style.css`** (append in the workflows section; tokens only)

```css
/* Workflow versions (plans/workflow-tests-plan.md Part 1) */
.wfv-pages button{height:26px;}
.wfv-vstatus{margin:0 4px;white-space:nowrap;color:var(--ink-2);}
.wfv-versions{position:absolute;inset:0;overflow:auto;background:var(--bg);padding:72px 32px 48px;}
.wfv-changes{margin:4px 0 12px;padding-left:18px;}
.wfv-changes li{margin:2px 0;}
.wfv-check{display:flex;align-items:center;gap:8px;font-size:13px;}
```

- [ ] **Step 6: Wire it in `ui/public/app.js`**

Add the dialogs import beside the other `./workflows/*.mjs` imports:
```js
import { openSaveVersionDialog, openUseVersionDialog, statusText } from './workflows/version-dialogs.mjs';
```
In `wfvEls()` add `pages: g('wfv-pages'), vstatus: g('wfv-vstatus'), saveVersion: g('wfv-saveversion'), versions: g('wfv-versions'),` to the returned object.
In `gvApi`, add:
```js
  versions: async (id) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/versions`);
    if (!res.ok) return null;
    return safeJson(res);
  },
  saveVersion: async (id, body) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await safeJson(res);
    return res.ok ? { ok: true, overview: d } : { ok: false, error: d && d.error };
  },
  useVersion: async (id, no) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/versions/${no}/use`, { method: 'POST' });
    const d = await safeJson(res);
    return res.ok ? { ok: true, overview: d } : { ok: false, error: d && d.error };
  },
  restoreRevision: async (id, rev) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/history/${rev}/restore`, { method: 'POST' });
    const d = await safeJson(res);
    return res.ok ? { ok: true, ...d } : { ok: false, error: d && d.error, errors: d && d.errors };
  },
```
Add the page-and-status controller next to `wfvShellActions()`:
```js
// Workflow versions (plans/workflow-tests-plan.md Part 1): the Canvas · Versions switch, the status line and Save version.
let wfvVersionsOverview = null;
async function wfvRefreshVersions() {
  const els = wfvEls();
  const t = gvComposer && gvComposer.template();
  if (!flagOn('workflowTests') || !t || !t.id) { wfvVersionsOverview = null; if (els.vstatus) els.vstatus.hidden = true; return null; }
  wfvVersionsOverview = await gvApi.versions(t.id);
  const text = statusText(wfvVersionsOverview);
  if (els.vstatus) { els.vstatus.textContent = text; els.vstatus.hidden = !text; }
  if (els.versions && !els.versions.hidden) wfvRenderVersionsPage();
  return wfvVersionsOverview;
}
function wfvShowPage(page) {
  const els = wfvEls();
  for (const b of els.pages ? els.pages.querySelectorAll('button[data-page]') : []) {
    const on = b.dataset.page === page;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  if (els.versions) els.versions.hidden = page !== 'versions';
  if (page === 'versions') void wfvRefreshVersions().then(() => wfvRenderVersionsPage());
}
async function wfvSaveVersion() {
  // Save the draft first when the canvas has unsaved changes: the same path Export… takes (wfvShellActions
  // exportCurrent → gvComposer.openSaveDialog({ then })), so an unsaved canvas is never versioned by surprise.
  if (gvComposer.isDirty() || !gvComposer.template().id) { gvComposer.openSaveDialog({ then: () => void wfvSaveVersion() }); return; }
  const t = gvComposer.template();
  if (!t || !t.id) return;
  const o = (await wfvRefreshVersions()) || { versions: [], draft: null };
  const nextNo = (o.versions[0] ? o.versions[0].versionNo : 0) + 1;
  openSaveVersionDialog({ doc: document, win: window, nextNo, changes: o.draft ? o.draft.changes : [],
    onSubmit: async (body) => { const r = await gvApi.saveVersion(t.id, body); if (r.ok) await wfvRefreshVersions(); return r; } });
}
```
Until Task 8 adds the page itself, the Versions page shows the status line's text, so the switch works and nothing is undefined:
```js
function wfvRenderVersionsPage() {             // Task 8 replaces this body with renderVersionsPage(…)
  const els = wfvEls();
  if (els.versions) els.versions.textContent = statusText(wfvVersionsOverview) || 'No versions yet.';
}
```
Bind the controls once where the shell is created (after `createWorkflowsShell(…)`, app.js ~:3325):
```js
{
  const e = wfvEls();
  e.pages?.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-page]'); if (b) wfvShowPage(b.dataset.page); });
  e.saveVersion?.addEventListener('click', () => void wfvSaveVersion());
}
```
Keep the status line current in two places:
- **After a workflow opens:** in `wfvLibraryActions().openWorkflow` (:3706), change the body to
  `const full = await gvApi.readWorkflow(id); if (full && await gvComposer.openTemplate(full)) { gvComposer.fit(); void wfvRefreshVersions(); }`
- **After every successful Save:** in `gvApi.saveWorkflow`, before `return { ok: true, … }`, add `setTimeout(() => void wfvRefreshVersions(), 0);`. The timeout lets the composer's `markSaved` give the template its id first.

- [ ] **Step 7: Run the tests**

Run: `node tools/test.mjs test/ui-workflow-version-dialogs.test.mjs test/ui-workflows-markup.test.mjs test/ui-workflows-shell.test.mjs test/ui-workflows-app.test.mjs test/ui-flags.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/public/index.html ui/public/style.css ui/public/app.js ui/public/workflows/version-dialogs.mjs test/ui-workflow-version-dialogs.test.mjs test/ui-workflows-markup.test.mjs
git commit -m "Workflow tests: Canvas · Versions switch, status line and Save version (flag workflowTests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Versions page, history and restore, and "Versions…" in the Library

This matches canvas board 7 without the Tests and Real use columns, which arrive in Parts 2 and 5.

**Files:**
- Create: `ui/public/workflows/versions-view.mjs`
- Modify: `ui/public/app.js` (`wfvRenderVersionsPage`, plus the library `openVersions` action)
- Modify: `ui/public/workflows/library.mjs` (the row's ⋯ menu, :553–568)
- Modify: `ui/public/style.css` (the `.wfv-vt*` table rules)
- Test: `test/ui-workflow-versions-view.test.mjs`, `test/ui-workflows-library.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 5 overview shape; Task 7 dialogs and `gvApi`.
- Produces: `renderVersionsPage(root, overview, actions, { doc })`
  - `actions = { saveVersion(), useVersion(versionNo), restore(revisionId, label), openCanvas() }`
  - library action `openVersions(workflowId)`

- [ ] **Step 1: Write the failing test** — `test/ui-workflow-versions-view.test.mjs`

```js
// test/ui-workflow-versions-view.test.mjs — the Versions page (canvas board 7, Part 1 columns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderVersionsPage } from '../ui/public/workflows/versions-view.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const overview = () => ({
  workflowId: 'wf_b', name: 'Product brief writer', liveVersionNo: 4,
  draft: { changed: true, changes: ['New step Fact check', 'Draft brief: AI model opus → sonnet'], partsChanged: [] },
  versions: [
    { id: 30, versionNo: 4, note: 'Shorter briefs', by: 'Tomica Brkovic', createdAt: '2026-10-12T09:00:00Z', inUse: true, runs: 41, changes: ['Removed step Summary'] },
    { id: 20, versionNo: 3, note: null, by: null, createdAt: '2026-10-08T09:00:00Z', inUse: false, runs: 28, changes: ['Review loop: at most 2 rounds → 3'] },
  ],
  history: [{ id: 41, source: 'save', by: null, createdAt: '2026-10-25T10:00:00Z', name: 'Product brief writer' },
    { id: 40, source: 'restore', by: 'Tomica Brkovic', createdAt: '2026-10-24T10:00:00Z', name: 'Product brief writer' }],
});

function boot(o = overview()) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = { saveVersion: () => calls.push(['save']), useVersion: (n) => calls.push(['use', n]),
    restore: (id, label) => calls.push(['restore', id, label]), openCanvas: () => calls.push(['canvas']) };
  const root = window.document.getElementById('root');
  renderVersionsPage(root, o, actions, { doc: window.document });
  return { doc: window.document, root, calls };
}

test('the draft row says what changed and offers Save version', () => {
  const { root, calls } = boot();
  const draft = root.querySelector('.wfv-vt-draft');
  assert.match(draft.textContent, /Your draft/);
  assert.match(draft.textContent, /New step Fact check · Draft brief: AI model opus → sonnet/);
  click([...draft.querySelectorAll('button')].find((b) => b.textContent === 'Save version'));
  assert.deepEqual(calls.at(-1), ['save']);
});

test('version rows: number, note, who and when, in use, runs, and Use for new runs on the others', () => {
  const { root, calls } = boot();
  const rows = [...root.querySelectorAll('.wfv-vt-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.wfv-vt-no').textContent), ['v4', 'v3']);
  assert.match(rows[0].textContent, /Shorter briefs/);
  assert.match(rows[0].textContent, /New runs use this/);
  assert.match(rows[0].textContent, /Used 41 times/);
  assert.equal([...rows[0].querySelectorAll('button')].some((b) => b.textContent === 'Use for new runs'), false);
  click([...rows[1].querySelectorAll('button')].find((b) => b.textContent === 'Use for new runs'));
  assert.deepEqual(calls.at(-1), ['use', 3]);
  click([...rows[1].querySelectorAll('button')].find((b) => b.textContent === 'Restore into draft'));
  assert.deepEqual(calls.at(-1), ['restore', 20, 'v3']);
});

test('history lists every save in plain words with Restore', () => {
  const { root, calls } = boot();
  const items = [...root.querySelectorAll('.wfv-vh-row')];
  assert.match(items[0].textContent, /Saved/);
  assert.match(items[1].textContent, /Restored by Tomica Brkovic/);
  click(items[0].querySelector('button'));
  assert.equal(calls.at(-1)[0], 'restore');
});

test('no versions yet: an explanation and Save version, no table', () => {
  const { root } = boot({ ...overview(), liveVersionNo: null, draft: null, versions: [] });
  assert.match(root.textContent, /No versions yet/);
  assert.equal(root.querySelectorAll('.wfv-vt-row').length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-versions-view.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `ui/public/workflows/versions-view.mjs`**

```js
// ui/public/workflows/versions-view.mjs — the Versions page of a workflow (plans/workflow-tests-plan.md Task 8;
// canvas board 7). Pure DOM: app.js owns data and actions. Words per D10.
const SOURCE_TEXT = { save: 'Saved', defaults: 'Step defaults changed', restore: 'Restored', delete: 'Deleted', version: 'Version saved' };

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (doc, label, onClick, cls = 'btn btn-sm') => { const b = el(doc, 'button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

/**
 * @param {HTMLElement} root
 * @param {{name:string, liveVersionNo:number|null, draft:null|{changed:boolean, changes:string[]}, versions:Array, history:Array}} o
 * @param {{saveVersion:Function, useVersion:Function, restore:Function, openCanvas:Function}} actions
 * @param {{doc: Document}} ctx
 */
export function renderVersionsPage(root, o, actions, { doc }) {
  root.replaceChildren();
  const wrap = el(doc, 'div', 'wfv-vpage');
  wrap.append(el(doc, 'p', 'subtitle', 'Your changes stay in a draft until you choose Save version. Every run remembers which version it used, so you can always go back.'));

  if (!o || !Array.isArray(o.versions) || !o.versions.length) {
    const empty = el(doc, 'div', 'card wfv-vempty');
    empty.append(el(doc, 'h2', '', 'No versions yet'),
      el(doc, 'p', 'hint', 'New runs use what you last saved. Save a version to keep this state; after that, you choose when new runs get your changes.'),
      btn(doc, 'Save version', () => actions.saveVersion(), 'btn btn-primary'));
    wrap.append(empty);
  } else {
    const table = el(doc, 'div', 'card wfv-vt');
    const draft = el(doc, 'div', 'wfv-vt-draft');
    const d = o.draft;
    const what = d && d.changed ? d.changes.join(' · ') : `Same as v${o.liveVersionNo}`;
    draft.append(el(doc, 'span', 'wfv-vt-no', 'Draft'),
      (() => { const c = el(doc, 'span', 'wfv-vt-main'); c.append(el(doc, 'b', '', 'Your draft'), el(doc, 'span', 'hint', what)); return c; })(),
      btn(doc, 'Save version', () => actions.saveVersion(), 'btn btn-sm btn-primary'));
    table.append(draft);
    for (const v of o.versions) {
      const row = el(doc, 'div', 'wfv-vt-row');
      const main = el(doc, 'span', 'wfv-vt-main');
      const head = el(doc, 'span', 'wfv-vt-head');
      head.append(el(doc, 'b', '', v.note || v.changes[0] || `Version ${v.versionNo}`));
      if (v.inUse) head.append(el(doc, 'span', 'badge wfv-inuse', 'New runs use this'));
      main.append(head, el(doc, 'span', 'hint', [when(v.createdAt), v.by].filter(Boolean).join(' · ')),
        el(doc, 'span', 'hint', v.changes.join(' · ')));
      const used = el(doc, 'span', 'wfv-vt-used', v.runs === 1 ? 'Used once' : `Used ${v.runs} times`);
      const acts = el(doc, 'span', 'wfv-vt-acts');
      if (!v.inUse) acts.append(btn(doc, 'Use for new runs', () => actions.useVersion(v.versionNo)));
      acts.append(btn(doc, 'Restore into draft', () => actions.restore(v.id, `v${v.versionNo}`), 'btn btn-sm btn-quiet'));
      row.append(el(doc, 'span', 'wfv-vt-no', `v${v.versionNo}`), main, used, acts);
      table.append(row);
    }
    wrap.append(table);
  }

  if (o && Array.isArray(o.history) && o.history.length) {
    const hist = el(doc, 'section', 'wfv-vh');
    hist.setAttribute('aria-label', 'Every save');
    hist.append(el(doc, 'h2', '', 'Every save'), el(doc, 'p', 'hint', 'Worca keeps the last 50 saves of this workflow, so any change can be undone.'));
    for (const h of o.history) {
      const row = el(doc, 'div', 'wfv-vh-row');
      const text = `${SOURCE_TEXT[h.source] || 'Saved'}${h.by ? ` by ${h.by}` : ''}`;
      row.append(el(doc, 'span', 'wfv-vh-when', when(h.createdAt)), el(doc, 'span', 'wfv-vh-what', text),
        btn(doc, 'Restore', () => actions.restore(h.id, `${text} ${when(h.createdAt)}`), 'btn btn-sm btn-quiet'));
      hist.append(row);
    }
    wrap.append(hist);
  }
  root.append(wrap);
}
```
Add styles to `ui/public/style.css` (tokens only):
```css
.wfv-vpage{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}
.wfv-vt{padding:0;overflow-x:auto;}
.wfv-vt-draft,.wfv-vt-row{display:grid;grid-template-columns:64px minmax(0,1fr) 120px auto;gap:16px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);}
.wfv-vt-draft{background:var(--canvas-2);}
.wfv-vt-row:last-child{border-bottom:0;}
.wfv-vt-no{font-family:var(--font-mono);font-weight:600;}
.wfv-vt-main{display:flex;flex-direction:column;gap:2px;min-width:0;}
.wfv-vt-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.wfv-vt-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;}
.badge.wfv-inuse{background:var(--blue-bg);color:var(--blue-ink-strong);}
.wfv-vh{display:flex;flex-direction:column;gap:6px;}
.wfv-vh-row{display:grid;grid-template-columns:160px minmax(0,1fr) auto;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);}
@media (max-width:700px){.wfv-vt-draft,.wfv-vt-row{grid-template-columns:48px minmax(0,1fr);}.wfv-vt-used,.wfv-vt-acts{grid-column:2;justify-content:flex-start;}}
```

- [ ] **Step 4: Wire it in `ui/public/app.js`**

```js
import { renderVersionsPage } from './workflows/versions-view.mjs';
```
Replace Task 7's `wfvRenderVersionsPage` with:
```js
function wfvRenderVersionsPage() {
  const els = wfvEls();
  const t = gvComposer && gvComposer.template();
  if (!els.versions || !t || !t.id || !wfvVersionsOverview) return;
  renderVersionsPage(els.versions, wfvVersionsOverview, {
    saveVersion: () => void wfvSaveVersion(),
    useVersion: (no) => {
      const live = wfvVersionsOverview.versions.find((v) => v.inUse);
      const target = wfvVersionsOverview.versions.find((v) => v.versionNo === no);
      openUseVersionDialog({ doc: document, win: window, versionNo: no, changes: target && live ? [`From v${live.versionNo} to v${no}`, ...target.changes] : (target ? target.changes : []),
        onConfirm: async () => { const r = await gvApi.useVersion(t.id, no); if (r.ok) { wfvVersionsOverview = r.overview; await wfvRefreshVersions(); } return r; } });
    },
    restore: async (rev, label) => {
      // #721: restoring the workflow open on the canvas while it has unsaved changes asks first.
      if (gvComposer.isDirty()) {
        const ok = await confirmModal({ title: 'Restore into your draft?', confirmLabel: 'Restore',
          message: 'Your canvas has unsaved changes. Restoring replaces them with the saved state.' });
        if (!ok) return;
      }
      const r = await gvApi.restoreRevision(t.id, rev);
      if (!r.ok) { notify({ tone: 'err', title: 'Not restored', detail: r.error || 'The saved state no longer fits the agents it uses.' }); return; }
      await gvComposer.openTemplate(r.workflow);
      wfvVersionsOverview = r.overview;
      wfvRenderVersionsPage();
      notify({ tone: 'ok', title: `Restored ${label} into your draft` });
    },
    openCanvas: () => wfvShowPage('canvas'),
  }, { doc: document });
}
```
`notify({ tone, title, detail })` and `confirmModal({ title, message, confirmLabel, danger })` are the helpers app.js already uses for workflow deletes (:3711–3717).

In the object returned by `wfvLibraryActions()` (app.js :3693), add:
```js
    openVersions: async (id) => {
      const full = await gvApi.readWorkflow(id);
      if (full && await gvComposer.openTemplate(full)) { gvComposer.fit(); wfvShowPage('versions'); }
    },
    versionsEnabled: (w) => flagOn('workflowTests') && !String(w.origin || '').startsWith('plugin:'),
```

In `ui/public/workflows/library.mjs`, extend the row's ⋯ menu items (:563):
```js
        toggleMenu({ doc, anchor: more, align: 'end', label: `More for ${w.name || w.id}`, items: [
          { label: pinned ? 'Unpin from Chat home' : 'Pin to Chat home', onSelect: () => act('togglePin', w) },
          ...(act('versionsEnabled', w) === true ? [{ label: 'Versions…', onSelect: () => act('openVersions', w.id) }] : []),
        ] });
```
`versionsEnabled` is the app.js action added above.
Extend `test/ui-workflows-library.test.mjs`: when `versionsEnabled` returns `true`, the ⋯ menu lists `Versions…` and calls `openVersions` with the id; when it returns `false`, it does not.

- [ ] **Step 5: Run the tests and rebuild nothing (no bundler)**

Run: `node tools/test.mjs test/ui-workflow-versions-view.test.mjs test/ui-workflows-library.test.mjs test/ui-workflows-app.test.mjs test/ui-workflow-version-dialogs.test.mjs test/ui-theme-tokens.test.mjs`
Then run every test that slices `style.css` by marker comments, listed by `grep -ln "indexOf('/\*" test/*.test.mjs`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/public/workflows/versions-view.mjs ui/public/workflows/library.mjs ui/public/app.js ui/public/style.css test/ui-workflow-versions-view.test.mjs test/ui-workflows-library.test.mjs
git commit -m "Workflow tests: the Versions page, every save with Restore, Versions… in the Library

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, UI levels, verification

**Files:**
- Modify: `docs/storage.md`. Add `workflow_revisions` and `workflows.live_version_no`: what they hold, the 50-save ring, never pruned versions, FK-free.
- Modify: `docs/ui-levels.md`. In the catalogue, add rows for the Canvas · Versions switch, Save version, the Versions page and the Library's Versions… item, all at **Simple** (D11), with the reason from #721.
- Modify: `docs/changelog/unreleased.md`. Add a "Workflow versions (Labs)" line.
- Modify: `test/ui-levels.test.mjs`, if its catalogue check needs the new rows listed there too.

- [ ] **Step 1: Write the docs**
  - **`docs/storage.md`:** add after the `workflows` table entry: "`workflow_revisions` (v77): every save of a user workflow keeps the state it replaced (`version_no` NULL; the last 50 per workflow) and Save version keeps a numbered state (`version_no` 1, 2, …; never pruned). Append-only and without foreign keys, so a deleted workflow's history stays. `workflows.live_version_no` is the version new runs use; NULL = the row itself. Plugin workflows have neither."
  - **`docs/ui-levels.md`:** add the catalogue rows in the existing table format.
  - **Changelog:** "Workflow versions (Labs, flag `workflowTests`): Save version on a workflow, choose which version new runs use, see what changed, and restore any of the last 50 saves."

- [ ] **Step 2: Run the guards**

Run: `node tools/test.mjs test/ui-levels.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`
Expected: PASS.

- [ ] **Step 3: Full verification**
  1. **Run every test file touched in this part.** Build the list with `git diff --name-only origin/dev -- test` and run `node tools/test.mjs <those files>`. All of them must pass.
  2. **Run the full suite on the branch and on a `dev` baseline worktree.**
     - Use the per-file runner `node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs <repo> <outDir>`.
     - Compare the failing files. Only a file that fails on the branch and passes on `dev` is ours.
  3. **Smoke run:** `npm run smoke`. Under WSL with portable Node 22 if the engine path needs POSIX.
  4. **Manual check in the browser** with `WORCA_FLAGS=workflowTests`:
     - Save a workflow and Save version 1. The status line says "v1 in use".
     - Edit and Save. The line says "Draft · new runs use v1".
     - Start a run. The run page shows v1's graph.
     - Save version 2, then Use v2.
     - Restore a history entry.
     - Light and dark themes, at 1440 px and 390 px. Compare with boards 7 and 8 of the canvas.

- [ ] **Step 4: Commit**

```bash
git add docs/storage.md docs/ui-levels.md docs/changelog/unreleased.md test/ui-levels.test.mjs
git commit -m "Workflow tests: docs (storage, UI levels, changelog) for versions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Before the PR (needs the user's go)**
  1. **Draft the upstream issue** "Workflow versions and tests". Its Problem section says that domain experts cannot test a change before runs use it. It links #721, #681 and #20 and the canvas, and lists Parts 1–5. The user reviews the text; then it is opened as TomicaB.
  2. **Draft the #721 comment:** "The workflow part of this (history on every save, restore through the validating save, the `…/history` routes, the 50-save ring) is implemented in #<PR> together with named versions; agent and script history remain open here." The user approves it before it is posted.
  3. **PR body:**
     - `npm test` comparison numbers and the smoke result
     - UI level Simple, flag `workflowTests`
     - screenshots: light, dark and 390 px
     - `Closes #<new issue>`, partially, Part 1

---

## Parts 2–5 (outline; detailed tasks are written when the part before is merged)

### Part 2 — Examples and testing a version (canvas boards 1–6, 19, 20)

- **Store:** new tables (one migration):
  - `wf_test_examples(workflow_id, id, name, request, files JSON, answers JSON, basics JSON, auto_checks JSON, tries, created_from_run)`
  - `wf_test_runs(id, workflow_id, a_use, b_use, status, cost_usd, created_at)`
  - `wf_test_tries(run_id, example_id, use, try_no, pipeline_id, verdict JSON, cost_usd)`
- **Runner (`src/core/workflow-tests/runner.mjs`):** for each example × try × version it starts a run through the same path as `invokeStartRun` (ui/server.mjs:3693):
  - `noProject: true`, so nothing is written outside `<home>/runs/<id>/work`
  - `workflowUse: 'draft' | n` (D13)
  - `extras` for the files
  - `mock` for the free quick check
  - its own small queue, at most 2 at a time
- **Canned answers:** an `orch.on('question')` listener matches the question text, falls back to `autoAnswerPayload` (ui/server.mjs:711-732) or fails the try, and answers through `orch.answer` (run-harness.mjs:1168). Precedent: `test/orchestrator-questions.test.mjs:173`.
- **Isolation:**
  - Prompt-only runs never write back (`sources.mjs:212`).
  - No PR is ever automatic.
  - Exclude test runs from team metrics and History by a `run_labels` label `worca:test`.
  - Memory mount is read-only for test runs (`_mountMemory` run-harness.mjs:4119 needs a per-run opt-out).
- **Basics:** read from `pipelines` (status, cost, cycle), `step_questions` and `_metricsIv`.
- **Automatic checks:** Library scripts via `runBenchOnce` (script-bench.mjs:621) on the run's `work/` folder (`cwd: {kind:'dir'}` with `allowDirCwd`).
- **Results:**
  - Re-use the old version's results when the fingerprint and the examples are unchanged.
  - "Might be luck" when the difference is ≤ 1 try of 3.
  - "Steady results".
- **UI:**
  - the Tests tab in the Canvas · Tests · Versions switch
  - first use from past runs
  - the example editor without "Your criteria"
  - Add from a past run, without AI-suggested criteria
  - Test a version, while it runs, Compare (by example), and one example side by side

### Part 3 — Your criteria, checked by Worca (boards 2, 10–13)

- **Judge:** a helper call shaped like `callModel` (src/core/requirements/interview.mjs:227): no tools, a replaced system prompt, the model chosen per example (D12). It returns yes/no + reason + proof quote; the proof is checked by text search.
- **Spend:** recorded in a new `test_cost_ledger`, counted in `totalWindowSpendUsd` (cost-budget.mjs:114).
- **Exact checks:** quotes found in the files, numbers from the files, must or must not mention, no personal data, links. Pure functions, no AI.
- **Check the checker:**
  - planted broken results: Worca edits a good result with a model call or a deterministic edit (number removed, quote invented)
  - asked again 3×, order swapped, padding
  - agreement from Agree/Disagree answers
- **Trust marks:** D14 (≥ 10 answers).
- **UI:** Add a check, Check the checker, Compare by criterion, the trust report, AI-suggested criteria in "Add from a past run".

### Part 4 — Colleagues, harder examples, export (boards 14–18, 21)

- **Review file:** a self-contained HTML (inline CSS/JS, no network) with pairs labelled A/B. The version key is kept on the author's machine in `wf_test_reviews`. The answers file is JSON with a review id and a checksum; Add answers validates both.
- **Harder examples:** generated by a model call from existing examples (conflict, gap, hidden instruction, rewording, size). The person picks which to keep.
- **Export:** "Include the test examples" in `exportWorkflowPlugin` (workflow-export.mjs:1048) and the JSON export (workflow-share.mjs:118). Files and liked results are a second box. For a marketplace plugin, examples are off by default.

### Part 5 — Real use and the test share (boards 7, 22, 23)

- **Test share:** an optional setting (percent of the spending limit) enforced at a test run's start and between tries, plus the Statistics Tests tile (stats.mjs:484, stats-view.mjs:164 `renderKpiRow`).
- **Real use:** a team setting, off by default.
  - **Requirements:** compare Worca's result with the kept spec, using the Requirements spec versions.
  - **Repo files:** git diff of the result files after the run.
  - **Elsewhere:** counted as unknown.
  - Counted per version (`manifest.workflowVersion`), never per person.
  - The optional "Why did you change it?" prompt in Requirements.
  - Shown on the Versions page.
