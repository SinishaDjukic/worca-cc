# Node-Graph v2 — P7: Agents view port editor + agent-gen v2 + plugin API 3 Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every *authoring* surface speak meta v2. The Agents view gets a real typed-port editor (`agentFormRender`/`agentFormRead`/`bindAgentForm`) that emits a v2 sidecar and renders the store's 400 verbatim; `agent-gen` teaches the LLM ports instead of channels; plugins move to **plugin API 3** (meta v2 sidecars + v2 graph templates) with content-gated validation, load-time skipping, a Plugins-view "needs update" note, a v2 `worca plugin init` scaffold and a converted test fixture.

**Architecture:** One validator, three consumers. `validateMetaV2` (P2, `src/shared/graph/agent-meta.mjs`) is the single gate: `agent-store` calls it before `normalizeMeta` and 400s with the rule text; `validatePluginDir` calls it per plugin sidecar and turns each failed rule into an `agents/<f>: <rule>` ERROR; `agent-gen` calls it on read-back. The browser never re-implements it — the port editor shows the same rule texts as **non-blocking hints** and always lets the PUT go to the server, which owns the verdict. Plugin *templates* go through the same `validateGraph` (P2) the composer and the save route use, with a `portsFn` built from the plugin's OWN sidecars, so a plugin template is a first-class graph, not a second dialect. `GET /api/agents` swaps `channels` for `mockWriterRoles`; the v1 sidecar fields on the 11 builtins stay untouched (they die in P8).

**Series position:** P7 of 8; requires P6 landed (sentinel: `decorFromState` in `ui/public/graph/run-decor.mjs` + `src/cli/render.mjs`); leaves dev green and shippable; the v1 engine stays live.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` §9 (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats every rule text, message string and schema block it needs).

## Global Constraints
- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in every user-facing string: **"worca"** (never "worca-cc"; the `worca-cc-plugin.json` filename, the `worca-cc-api` engines key and repo paths are identifiers, not prose, and stay as they are).
- Commits: `worca: Node-graph v2 P7 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file); baseline recorded in Task 0, final total in the last task.
- **Coexistence is mandatory.** The 11 builtin sidecars keep their v1 fields (`consumes`/`optionalConsumes`/`produces`/`connectsTo`/`loopSource`) until P8. Do NOT touch `DEFAULT_SPEC`, `channelList`, `LEGACY_LABELS`, `registryToSteps`, `src/core/channels.mjs`, or the `CHANNEL_IDS` import at `src/core/agent-registry.mjs:14` — they die in P8. The only channel code this plan deletes is `collectChannelIds` in `ui/server.mjs` and the channel chip-pickers in the Agents view / wizard form.
- **The client never pre-empts the store.** Every rule the port editor shows is a hint. Save always PUTs; a 400 renders `data.error` VERBATIM.
- Every rule/guard gets a test that FAILS when the rule is removed (mutation-proof).
- jsdom 29: `PointerEvent`/`WheelEvent` exist; `setPointerCapture`/`hasPointerCapture`/`ResizeObserver` do NOT; `getBoundingClientRect` returns zeros. Never wrap a jsdom `dispatchEvent` in `assert.doesNotThrow` (vacuous — listener errors surface as window `error` events).

---

### Task 0: Branch check, deps, predecessor sentinels, baseline
- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch (by hand: `git checkout -b worca-cc/node-graph-v2-p7` off dev). NEVER `git checkout dev`, never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: predecessor sentinels — if ANY is missing, STOP (P1–P6 have not landed):
  ```sh
  grep -q "export function decorFromState" ui/public/graph/run-decor.mjs && [ -f src/cli/render.mjs ] || echo MISSING-P6
  grep -q "export function validateMetaV2" src/shared/graph/agent-meta.mjs || echo MISSING-P2-agent-meta
  grep -q "export function normalizeAgentMeta" src/shared/graph/agent-meta.mjs || echo MISSING-P2-normalize
  grep -q "export function validateGraph" src/shared/graph/validate.mjs || echo MISSING-P2-validate
  grep -q "export function portsFnFor" src/shared/graph/ports.mjs || echo MISSING-P2-ports
  grep -q "export function registryPortsFn" src/core/graph/registry-ports.mjs || echo MISSING-P2-registry-ports
  grep -q "export const MOCK_WRITER_ROLES" src/core/claude-runner.mjs || echo MISSING-P2-mock-roles
  grep -q "export async function writeGraphWorkflow" src/core/workflows.mjs || echo MISSING-P2b-workflows
  ```
- [ ] Step 4: `npm test 2>&1 | tail -5` — record the printed pass count as **BASELINE**; it must be green before you change anything.

**Interfaces consumed from earlier plans (do not redefine):**
- `src/shared/graph/agent-meta.mjs`: `validateMetaV2(raw, { mockWriterRoles } = {}) → { errors: string[] }` (rule texts listed in Task 13), `normalizeAgentMeta(raw) → { meta, errors }`, `indexByKey(list) → Record<key, meta>`, `derivePortSummary(meta) → string`.
- `src/shared/graph/validate.mjs`: `validateGraph(tpl, portsFn, { limits } = {}) → { ok, errors, warnings }`, issues `{ code, message, nodeId?, wireId?, portId? }`.
- `src/shared/graph/ports.mjs`: `portsFnFor(agentsByKey) → (node) => { inputs, outputs, known, ported }` (flow kinds `task/end/and/or/combine` answered from `flowPorts`, agent kinds from the map).
- `src/core/graph/registry-ports.mjs`: `registryPortsFn(registry)`.
- `src/core/claude-runner.mjs`: `MOCK_WRITER_ROLES` (a `Set` of the 14 mock writer roles).
- `src/core/agent-registry.mjs`: `normalizeMeta(raw)` merges the v2 fields when `raw.metaVersion === 2` and returns `{…v1 keys, metaVersion, inputs, outputs, portSummary, verdict?, sideEffect?, mockRole?, wantsRequest?, workspaceFanOut?, workspaceStrategy?, workspaceVariantOf?, placeable?}`.

---

### Task 1: Plugin API 3 — constants + the three pure manifest helpers

**Files:** modify `src/core/plugin-api.mjs:10-13`; modify `src/core/plugin-manifest.mjs` (add helpers after `negotiatedApi`, `:50-69`); modify `test/plugin-manifest.test.mjs:31-33` and `:70-76`.
**Interfaces produced:** `WORCA_PLUGIN_API = 3`, `WORCA_PLUGIN_APIS = [1, 2, 3]`; `declaredApi(range) → number|null`; `dataContractIssues(absDir) → { agentsV1: string[], workflowsV1: string[] }`; `apiMismatchMessage(mismatch) → string` (the ONE user-facing sentence, spec §9 wording); `apiMismatch(range, issues) → null | { builtFor, host: 3, agents: number, workflows: number, message: string }` (`message = apiMismatchMessage(...)` — the browser, the doctor and the CLI all print this field; no other formatter exists).
**Consumes:** `apiSatisfies`/`negotiatedApi` (unchanged set semantics).

Set semantics MUST survive: `negotiatedApi('>=1 <2') === 1` and `negotiatedApi('>=2 <3') === 2` keep every bundled connector/channel plugin working (all 5 in-tree plugins ship only `connector/` or `channel/` — nothing to convert).

- [ ] Step 1: Write the failing test — replace `test/plugin-manifest.test.mjs:31-33` and add the new pins (put the new tests right after the API-constant test):

```js
// test/plugin-manifest.test.mjs (replace the WORCA_PLUGIN_API test at :31-33)
test('WORCA_PLUGIN_API is the integer 3; host still speaks APIs 1 and 2', () => {
  assert.equal(WORCA_PLUGIN_API, 3);
  assert.deepEqual(WORCA_PLUGIN_APIS, [1, 2, 3]);
  // Set semantics: a connector-only API-1 plugin must keep negotiating 1.
  assert.equal(negotiatedApi('>=1 <2'), 1);
  assert.equal(negotiatedApi('>=2 <3'), 2);
  assert.equal(negotiatedApi('>=3 <4'), 3);
});

test('declaredApi: the LOWEST integer a range accepts (null when unparseable)', () => {
  assert.equal(declaredApi('>=1 <2'), 1);
  assert.equal(declaredApi('1'), 1);
  assert.equal(declaredApi('>=2 <3'), 2);
  assert.equal(declaredApi('>=3 <4'), 3);
  assert.equal(declaredApi(''), 0, 'an unconstrained range accepts everything, starting at 0');
  assert.equal(declaredApi('not-a-range'), null);
});

test('dataContractIssues names the v1-shaped files, and apiMismatch counts them', () => {
  const dir = mkPluginDir({
    'agents/oldOne.meta.json': JSON.stringify({ key: 'oldOne', consumes: ['plan'], produces: ['review'] }),
    'agents/oldOne.md': '# oldOne\n',
    'agents/newOne.meta.json': JSON.stringify({ metaVersion: 2, key: 'newOne', inputs: [], outputs: [] }),
    'agents/newOne.md': '# newOne\n',
    'workflows/legacy.json': JSON.stringify({ version: 1, steps: [[{ id: 's0', key: 'oldOne' }]] }),
    'workflows/graph.json': JSON.stringify({ version: 2, nodes: [], wires: [] }),
  });
  const issues = dataContractIssues(dir);
  assert.deepEqual(issues.agentsV1, ['oldOne.meta.json']);
  assert.deepEqual(issues.workflowsV1, ['legacy.json']);
  const m = apiMismatch('>=1 <2', issues);
  assert.equal(m.message, 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)');
  assert.match(apiMismatch('', issues).message, /^built for plugin API an older version; /);
  assert.deepEqual(m, { builtFor: 1, host: 3, agents: 1, workflows: 1 });
  assert.equal(apiMismatch('>=3 <4', { agentsV1: [], workflowsV1: [] }), null,
    'an API-3 plugin with clean data has no mismatch');
  assert.equal(apiMismatch('>=1 <2', { agentsV1: [], workflowsV1: [] }), null,
    'a connector-only API-1 plugin is NOT a mismatch — the bump is data-gated, not range-gated');
});
```

Also fix the existing engines-range test (`test/plugin-manifest.test.mjs:70-76`): with host APIs `[1,2,3]` the range `>=3` is now SATISFIED, so the "bad" case must move up:
```js
  const bad = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=4' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not satisfied by host plugin APIs \[1, 2, 3\]/);
```
Add `declaredApi, dataContractIssues, apiMismatch` to the import list at `test/plugin-manifest.test.mjs:8-10`.

`Expected: FAIL — "SyntaxError: The requested module '../src/core/plugin-manifest.mjs' does not provide an export named 'declaredApi'"` (and, once that resolves, `AssertionError: 2 !== 3`).

- [ ] Step 2: Implement. `src/core/plugin-api.mjs` — replace the closing comment + both constants (`:10-13`):

```js
// API 2 adds the chatChannels contribution + persistent channel worker
// protocol; API 3 changes the DATA contract: agent sidecars are meta v2 (typed
// ports) and workflows/*.json are v2 graphs. The task-source connector and the
// channel-worker protocols are unchanged across 1 -> 2 -> 3, so a connector-only
// ">=1 <2" plugin and a chat plugin's ">=2 <3" keep negotiating 1 and 2 and keep
// working untouched. The set is what makes that possible: never collapse it to a
// single integer.
export const WORCA_PLUGIN_API = 3;
export const WORCA_PLUGIN_APIS = [1, 2, 3];
```

`src/core/plugin-manifest.mjs` — add after `negotiatedApi` (`:69`). `declaredApi` PROBES rather than parses so it can never disagree with `apiSatisfies`:

```js
/** The host API a range was BUILT FOR: the lowest integer it accepts. ">=1 <2"
 *  and "1" both answer 1; an unconstrained range answers 0; null when nothing
 *  satisfies it (an unparseable range fails closed in apiSatisfies too).
 *  @param {string} range  @returns {number|null} */
export function declaredApi(range) {
  for (let n = 0; n <= 99; n += 1) if (apiSatisfies(range, n)) return n;
  return null;
}

/** Which files in a plugin dir are still on the API-2 data contract: sidecars
 *  without metaVersion 2, templates without version 2. Pure fs read; an absent
 *  or unreadable dir/file contributes nothing (validatePluginDir reports those
 *  separately as parse errors). Basenames only — the caller prefixes them.
 *  @param {string} absDir
 *  @returns {{agentsV1: string[], workflowsV1: string[]}} */
export function dataContractIssues(absDir) {
  const agentsV1 = [];
  const workflowsV1 = [];
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const agentsDir = join(absDir, 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.meta.json')).sort()) {
      const raw = read(join(agentsDir, f));
      if (raw && Number(raw.metaVersion) !== 2) agentsV1.push(f);
    }
  }
  const wfDir = join(absDir, 'workflows');
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.json')).sort()) {
      const raw = read(join(wfDir, f));
      if (raw && Number(raw.version) !== 2) workflowsV1.push(f);
    }
  }
  return { agentsV1, workflowsV1 };
}

/**
 * The Plugins-view / doctor payload for a plugin whose DATA is still on the old
 * contract, or null when it has nothing the host would ignore. The bump is
 * gated by CONTENT, not by the range: a connector-only plugin declaring
 * ">=1 <2" ships no agents and no templates, so it is never "incompatible" —
 * it simply keeps negotiating API 1.
 * @param {string} range   engines['worca-cc-api']
 * @param {{agentsV1: string[], workflowsV1: string[]}} issues
 * @returns {{builtFor: number|null, host: number, agents: number, workflows: number}|null}
 */
export function apiMismatch(range, issues) {
  const agents = (issues && issues.agentsV1 ? issues.agentsV1 : []).length;
  const workflows = (issues && issues.workflowsV1 ? issues.workflowsV1 : []).length;
  if (!agents && !workflows) return null;
  // declaredApi('') is 0 (an unconstrained range accepts everything); report that
  // as null so the message reads "built for an older version", never "API 0".
  const mismatch = { builtFor: declaredApi(range) || null, host: WORCA_PLUGIN_API, agents, workflows };
  mismatch.message = apiMismatchMessage(mismatch);
  return mismatch;
}

/**
 * THE user-facing sentence (spec §9 wording, "worca" is the product name) —
 * rendered verbatim by the Plugins view (`p.apiMismatch.message`), the doctor's
 * `agents-api` check and `worca plugin list`. An API-outdated plugin is NOT
 * corrupt: it installed fine and its connector or chat channel still works —
 * worca simply ignores the agents and pipeline templates it ships.
 */
export function apiMismatchMessage(mismatch) {
  if (!mismatch) return '';
  const { builtFor, agents, workflows } = mismatch;
  return `built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires `
    + `plugin API ${WORCA_PLUGIN_API} for agents and pipeline templates — update or reinstall the plugin `
    + `(${agents} agent(s), ${workflows} template(s) ignored)`;
}
```

`plugin-manifest.mjs` already imports `readFileSync, readdirSync, existsSync` (`:6`) and `join` (`:7`); add `WORCA_PLUGIN_API` to the `plugin-api.mjs` import at `:8` (it currently imports only `WORCA_PLUGIN_APIS`).

`Expected: PASS — node --test test/plugin-manifest.test.mjs → all tests pass`
- [ ] Step 3: `node --test test/plugin-api*.test.mjs test/plugin-manifest.test.mjs test/plugin-shim.test.mjs test/plugin-repo.test.mjs 2>&1 | tail -5` — `plugin-shim.test.mjs:48` (an API-1 plugin negotiating 1 on a bumped host) and `plugin-repo.test.mjs:349` (`>=99` warns) must both still pass unchanged.
- [ ] Step 4: Commit — `worca: Node-graph v2 P7 — plugin API 3 constants and manifest helpers`

---

### Task 2: `validatePluginDir` gates the plugin DATA contract

**Files:** modify `src/core/plugin-manifest.mjs:402-447` (`validatePluginDir`, agents block `:402-424`, workflows block `:436-447`); modify `test/plugin-manifest.test.mjs`.
**Interfaces produced:** `validatePluginDir(absDir, {strict}) → {ok, manifest, problems}` — unchanged shape, new problems.
**Consumes:** `validateMetaV2`, `normalizeAgentMeta`, `indexByKey` (P2 `src/shared/graph/agent-meta.mjs`), `portsFnFor` (P2 `src/shared/graph/ports.mjs`), `validateGraph` (P2 `src/shared/graph/validate.mjs`), `declaredApi`.

Rules (spec §9 / adjudication):
1. A **v2 sidecar** goes through the SAME `validateMetaV2` the store's save path uses; every failed rule is an ERROR `agents/<f>: <rule text verbatim>`. The existing key/stem/sibling checks stay exactly as they are.
2. A **v1-shaped sidecar or template** is an ERROR when the range admits API 3 (`negotiatedApi(range) === 3`, which includes a manifest with no `engines`), else a WARN. The two message texts are fixed:
   - `agents/<f>: not a meta v2 sidecar (declare "metaVersion": 2 with typed inputs/outputs) — plugin API 3 no longer reads channel sidecars`
   - `workflows/<f>: not a version-2 graph template (nodes/wires) — port the "steps" pipeline`
   The plugin still INSTALLS on the warn path (a connector/channel plugin keeps working); its agents and templates are simply ignored at load.
3. A **v2 template** goes through the shared `validateGraph` with a `portsFn` built from THIS plugin's own v2 sidecars + the engine flow ports. Errors render `workflows/<f>: V<n>: <msg>`; warnings are pushed as `warn`. The own-keys isolation rule stays and keeps its exact text: `workflows/<f>: references agent key "<k>" which this plugin does not ship` (a template wiring in a builtin or a user agent would break the moment the host renamed one, and the plugin could not ship a fix).

- [ ] Step 1: Write the failing tests (append to `test/plugin-manifest.test.mjs`):

```js
// test/plugin-manifest.test.mjs (append)
const V2_META = (key, over = {}) => JSON.stringify({
  metaVersion: 2, key, displayName: key, agentFile: `${key}.md`, runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
  order: 900, ...over,
});
const V2_GRAPH = (key) => JSON.stringify({
  name: 'Flow', version: 2, domain: 'general',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_a', kind: 'agent', key, x: 320, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
    { id: 'w2', from: { node: 'n_a', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
  ],
});
const errs = (v) => v.problems.filter((p) => p.level === 'error').map((p) => p.message);
const warns = (v) => v.problems.filter((p) => p.level === 'warn').map((p) => p.message);

test('a v2 sidecar + v2 template validate clean through the SHARED gates', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/flow.json': V2_GRAPH('helper'),
  });
  const v = validatePluginDir(dir);
  assert.deepEqual(errs(v), []);
  assert.equal(v.ok, true);
});

test('a broken v2 sidecar reports EVERY failed meta rule, verbatim, per file', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper', { runnerType: 'verifier', outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'r.md' }] }),
    'agents/helper.md': '# helper\n',
  });
  const v = validatePluginDir(dir);
  assert.ok(errs(v).includes('agents/helper.meta.json: runnerType "verifier" requires verdict: { filename }'));
  assert.equal(v.ok, false);
});

test('a v1 sidecar/template is an ERROR when the range admits API 3, a WARN when it does not', () => {
  const files = {
    'agents/old.meta.json': JSON.stringify({ key: 'old', agentFile: 'old.md', consumes: ['plan'], produces: ['review'], order: 900 }),
    'agents/old.md': '# old\n',
    'workflows/legacy.json': JSON.stringify({ version: 1, steps: [[{ id: 's0', key: 'old' }]], feedbacks: [] }),
  };
  const strictDir = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }) });
  const hard = validatePluginDir(strictDir);
  assert.ok(errs(hard).includes('agents/old.meta.json: not a meta v2 sidecar (declare "metaVersion": 2 with typed inputs/outputs) — plugin API 3 no longer reads channel sidecars'));
  assert.ok(errs(hard).includes('workflows/legacy.json: not a version-2 graph template (nodes/wires) — port the "steps" pipeline'));
  assert.equal(hard.ok, false);

  const legacyDir = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } }) });
  const soft = validatePluginDir(legacyDir);
  assert.deepEqual(errs(soft), [], 'an API-1 plugin still installs — its connector is unaffected');
  assert.ok(warns(soft).some((m) => m.startsWith('agents/old.meta.json: not a meta v2 sidecar')));
  assert.ok(warns(soft).some((m) => m.startsWith('workflows/legacy.json: not a version-2 graph template')));
  assert.equal(soft.ok, true);

  const noEngines = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p' }) });
  assert.equal(validatePluginDir(noEngines).ok, false, 'no engines constraint means "current API" -> hard error');
});

test('a v2 template is validated V1-V21 against the PLUGIN\'S OWN ports', () => {
  const noEnd = JSON.parse(V2_GRAPH('helper'));
  noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/no-end.json': JSON.stringify(noEnd),
  });
  const v = validatePluginDir(dir);
  assert.ok(errs(v).some((m) => /^workflows\/no-end\.json: V21: /.test(m)), 'the End rule fires with its code');
  assert.equal(v.ok, false);
});

test('a v2 template may reference ONLY the plugin\'s own agent keys', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/foreign.json': V2_GRAPH('planner'),
  });
  assert.ok(errs(validatePluginDir(dir)).includes(
    'workflows/foreign.json: references agent key "planner" which this plugin does not ship'));
});
```

`Expected: FAIL — "AssertionError: expected [] to include 'agents/helper.meta.json: runnerType \"verifier\" requires verdict: { filename }'" (today validatePluginDir never opens the sidecar body)`

- [ ] Step 2: Implement. Add to the imports at the top of `src/core/plugin-manifest.mjs` (after `:9`):

```js
import { validateMetaV2, normalizeAgentMeta, indexByKey } from '../shared/graph/agent-meta.mjs';
import { portsFnFor } from '../shared/graph/ports.mjs';
import { validateGraph } from '../shared/graph/validate.mjs';
```
(`src/shared/**` is pure — no `node:` builtins, no DOM — so `plugin-manifest.mjs` stays the fs-only pure module it advertises at `:1-4`.)

Replace the agents `for` loop body inside `validatePluginDir` (`:405-422`) — everything up to `agentKeys.add(key)` keeps its current checks; the new lines are the API gate and the shared meta gate. Track the normalized metas so the workflow block can build a ports function:

```js
  // agents/: <key>.md + <key>.meta.json pairs, existing dual-file format (§4.2).
  // API 3: the sidecar must pass the SAME meta v2 gate the agent-store save path
  // applies, every failed rule named. ALL capability fields are open to plugins
  // (verdict, sideEffect, mockRole, workspace*, placeable, …) — the gate is the
  // schema, not an allow-list.
  const agentKeys = new Set();
  const ownMetas = [];
  // A range that admits the CURRENT API (or no engines at all) claims to be an
  // API-3 plugin, so v1-shaped data is a hard error. An older range is honest
  // about what it is: warn, install, and ignore the data at load.
  const hardData = negotiatedApi(raw && raw.engines ? raw.engines['worca-cc-api'] : '') === WORCA_PLUGIN_API;
  const dataLevel = hardData ? 'error' : 'warn';
  const agentsDir = join(absDir, 'agents');
  if (existsSync(agentsDir)) {
    const files = readdirSync(agentsDir);
    for (const f of files.filter((x) => x.endsWith('.meta.json'))) {
      const stem = f.slice(0, -'.meta.json'.length);
      let meta = null;
      try { meta = JSON.parse(readFileSync(join(agentsDir, f), 'utf8')); }
      catch { push('error', `agents/${f}: invalid JSON`); continue; }
      const key = typeof meta?.key === 'string' ? meta.key : '';
      if (!KEY_RE.test(key)) { push('error', `agents/${f}: "${key}" must be a valid agent key (letters/digits/_-)`); continue; }
      if (key !== stem) push('error', `agents/${f}: key "${key}" must match the filename stem "${stem}"`);
      if (!files.includes(`${stem}.md`)) push('error', `agents/${f}: missing sibling ${stem}.md`);
      agentKeys.add(key);
      if (Number(meta.metaVersion) !== 2) {
        push(dataLevel, `agents/${f}: not a meta v2 sidecar (declare "metaVersion": 2 with typed inputs/outputs) — plugin API 3 no longer reads channel sidecars`);
        continue;
      }
      const { errors } = validateMetaV2(meta);
      for (const e of errors) push('error', `agents/${f}: ${e}`);
      if (!errors.length) ownMetas.push(normalizeAgentMeta(meta).meta);
    }
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const stem = f.slice(0, -3);
      if (!files.includes(`${stem}.meta.json`)) {
        push('warn', `agents/${f}: no ${stem}.meta.json sidecar — the registry will ignore it`);
      }
    }
  }
```

Note: `raw` is the parsed manifest json read at `:380`; it is in scope and is `null` on a parse failure, hence the guard. `negotiatedApi` and `WORCA_PLUGIN_API` are module-local (`WORCA_PLUGIN_API` added to the import in Task 1).

Replace the workflows block (`:436-447`) entirely:

```js
  // workflows/*.json are v2 GRAPHS (API 3), validated by the SAME shared
  // validator the composer and POST /api/workflows use, over a ports function
  // built from this plugin's OWN sidecars plus the engine's flow-card ports.
  // The isolation rule stays: a template may reference only keys this plugin
  // ships, so a host rename or a deleted user agent can never break it.
  const wfDir = join(absDir, 'workflows');
  if (existsSync(wfDir)) {
    const portsFn = portsFnFor(indexByKey(ownMetas));
    for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.json'))) {
      let tpl = null;
      try { tpl = JSON.parse(readFileSync(join(wfDir, f), 'utf8')); }
      catch { push('error', `workflows/${f}: invalid JSON`); continue; }
      if (Number(tpl?.version) !== 2) {
        push(dataLevel, `workflows/${f}: not a version-2 graph template (nodes/wires) — port the "steps" pipeline`);
        continue;
      }
      const nodes = Array.isArray(tpl.nodes) ? tpl.nodes : [];
      const keys = nodes.filter((n) => n && n.kind === 'agent').map((n) => n.key).filter(Boolean);
      let foreign = false;
      for (const k of new Set(keys)) {
        if (!agentKeys.has(k)) {
          push('error', `workflows/${f}: references agent key "${k}" which this plugin does not ship`);
          foreign = true;
        }
      }
      // A foreign key resolves to no ports, so every wire touching it would
      // also fire V4/V5 — one clear cause beats five derived ones.
      if (foreign) continue;
      const { errors, warnings } = validateGraph(
        { ...tpl, nodes, wires: Array.isArray(tpl.wires) ? tpl.wires : [] }, portsFn,
      );
      for (const e of errors) push('error', `workflows/${f}: ${e.code}: ${e.message}`);
      for (const w of warnings) push('warn', `workflows/${f}: ${w.code}: ${w.message}`);
    }
  }
```

`Expected: PASS — node --test test/plugin-manifest.test.mjs → all tests pass`
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — validatePluginDir gates the plugin data contract`

---

### Task 3: `worca plugin init` scaffolds API 3, and the plugin fixtures convert

**Files:** modify `src/cli/worca-cc.mjs:971` (manifest engines), `:1021-1032` (sidecar), `:1061-1067` (example flow); modify `test/fixtures/plugins/mock-source/worca-cc-plugin.json`, `.../agents/mockHelper.meta.json`, `.../workflows/mock-flow.json`; modify `test/api-plugins.test.mjs:64-68` (`AGENT_META`); modify `test/plugin-agent-registry.test.mjs:24-33` (`writeAgent`). `scripts/smoke-plugin.mjs` is UNCHANGED.
**Interfaces produced:** a scaffold that passes `validatePluginDir(dir, {strict:true})` by construction.

- [ ] Step 1: Write the failing test — extend `test/cli-plugin.test.mjs:52` ("plugin init scaffolds a plugin that validates cleanly (strict)") with the API-3 pins, and add one new test:

```js
// test/cli-plugin.test.mjs — inside 'plugin init scaffolds a plugin that validates cleanly (strict)',
// after the existing `assert.equal(manifest.taskSources[0].id, 'main');`
  assert.equal(manifest.engines['worca-cc-api'], '>=3 <4', 'scaffolds the current plugin API');
  const sidecar = JSON.parse(await readFile(join(dir, 'agents', 'demoPluginHelper.meta.json'), 'utf8'));
  assert.equal(sidecar.metaVersion, 2);
  assert.deepEqual(sidecar.inputs, [{ id: 'task', type: 'md', required: true }]);
  assert.deepEqual(sidecar.outputs, [{ id: 'notes', type: 'md', filename: 'notes.md', store: 'run' }]);
  assert.equal(sidecar.consumes, undefined, 'no channel vocabulary in an API-3 scaffold');
  const flow = JSON.parse(await readFile(join(dir, 'workflows', 'example-flow.json'), 'utf8'));
  assert.equal(flow.version, 2);
  assert.deepEqual(flow.nodes.map((n) => n.kind), ['task', 'agent', 'end']);
  assert.equal(flow.nodes[1].key, 'demoPluginHelper');
  assert.equal(flow.wires.length, 2);
```

`Expected: FAIL — "AssertionError: '>=1 <2' !== '>=3 <4'"`
- [ ] Step 2: Implement the scaffold. `src/cli/worca-cc.mjs:971` → `engines: { 'worca-cc-api': '>=3 <4' },`. Replace the sidecar object (`:1021-1032`):

```js
    files.set(`agents/${agentKey}.meta.json`, JSON.stringify({
      metaVersion: 2,
      key: agentKey,
      displayName: 'Example Helper',
      description: `Example agent installed by the ${name} plugin`,
      color: 'amber',
      agentFile: `${agentKey}.md`,
      runnerType: 'producer',
      inputs: [{ id: 'task', type: 'md', required: true }],
      outputs: [{ id: 'notes', type: 'md', filename: 'notes.md', store: 'run' }],
      ...(withParts.includes('skills') ? { requiresSkills: ['example-skill'] } : {}),
      order: 900,
    }, null, 2) + '\n');
```

Replace the example flow (`:1061-1067`):

```js
  if (withParts.includes('workflows')) {
    // A v2 graph: the Task and End cards are mandatory (V20/V21) and every input
    // takes exactly one wire (V7). Ports come from the sidecar above.
    files.set('workflows/example-flow.json', JSON.stringify({
      name: `${name} example flow`,
      version: 2,
      domain: 'general',
      nodes: [
        { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
        { id: 'n_helper', kind: 'agent', key: agentKey, x: 320, y: 200, config: {} },
        { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
      ],
      wires: [
        { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_helper', port: 'task' } },
        { id: 'w2', from: { node: 'n_helper', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
      ],
    }, null, 2) + '\n');
  }
```

Also update the agent body's frontmatter description line at `:1036` — it says "worca-cc plugin"; the prose in the body (`:1041`) must read `You are an example agent shipped by the "${name}" worca plugin.` (product name rule).

- [ ] Step 3: Convert `test/fixtures/plugins/mock-source/`. `worca-cc-plugin.json` → `"engines": { "worca-cc-api": ">=3 <4" }` (everything else byte-identical). `agents/mockHelper.meta.json` becomes exactly:

```json
{
  "metaVersion": 2,
  "key": "mockHelper",
  "displayName": "Mock Helper",
  "description": "Minimal plugin producer used by plugin tests",
  "color": "amber",
  "agentFile": "mockHelper.md",
  "runnerType": "producer",
  "inputs": [
    { "id": "task", "type": "md" }
  ],
  "outputs": [
    { "id": "notes", "type": "md", "filename": "notes.md" }
  ],
  "requiresSkills": ["mock-skill"],
  "order": 900
}
```

`workflows/mock-flow.json` becomes exactly:

```json
{
  "name": "Mock Flow",
  "version": 2,
  "domain": "general",
  "nodes": [
    { "id": "n_task", "kind": "task", "x": 40, "y": 200, "config": {} },
    { "id": "n_helper", "kind": "agent", "key": "mockHelper", "x": 320, "y": 200, "config": {} },
    { "id": "n_end", "kind": "end", "x": 600, "y": 200, "config": {} }
  ],
  "wires": [
    { "id": "w1", "from": { "node": "n_task", "port": "task" }, "to": { "node": "n_helper", "port": "task" } },
    { "id": "w2", "from": { "node": "n_helper", "port": "notes" }, "to": { "node": "n_end", "port": "result" } }
  ]
}
```

`agents/mockHelper.md` is unchanged (its `## Inputs`-style prose is free text, not a contract).
- [ ] Step 4: Convert the two inline test fixtures that a validate/registry gate now rejects.

`test/api-plugins.test.mjs:64-68` — `AGENT_META` (the manifest there declares NO `engines`, so its data is hard-gated):
```js
const AGENT_META = {
  metaVersion: 2, key: 'localHelper', agentFile: 'localHelper.md',
  displayName: 'Local Helper', description: 'fixture agent', color: 'blue',
  runnerType: 'producer', order: 90,
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
};
```

`test/plugin-agent-registry.test.mjs:24-33` — `writeAgent` writes the sidecar for every layer in that file, including the plugin layer that Task 4 gates:
```js
function writeAgent(dir, key, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.md`), `# ${key}\n\nYou are the ${key} agent.\n`);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    metaVersion: 2,
    key, displayName: key, description: 'd', color: 'amber', icon: '<path d="M0 0"/>',
    agentFile: `${key}.md`, runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
    order: 99, ...extra,
  }, null, 2));
}
```

`Expected: PASS — node --test test/cli-plugin.test.mjs test/api-plugins.test.mjs test/plugin-agent-registry.test.mjs test/plugin-store.test.mjs test/plugin-inventory.test.mjs test/plugin-skills.test.mjs → all pass`

`test/plugin-store.test.mjs:75` and `:402` declare `>=1 <2` and ship no agents/workflows, so they land on the warn path and stay green untouched — verify, do not "fix".
- [ ] Step 5: `node scripts/smoke-plugin.mjs` is part of `npm run smoke`, not `npm test`; run it if a git worktree + fake claude bin are available, otherwise note that `scripts/smoke-plugin.mjs` is unchanged by construction (it links the fixture and reads `origin`/task-source behavior only).
- [ ] Step 6: Commit — `worca: Node-graph v2 P7 — API 3 scaffold and plugin fixtures`

---

### Task 4: the registry ignores non-v2 sidecars in the PLUGIN layers

**Files:** modify `src/core/agent-registry.mjs:272-283` (`pluginAgentLayers`), `:314-346` (`scanLayer`), `:381-395` (the plugin merge loop); modify `test/plugin-agent-registry.test.mjs`.
**Interfaces produced:** `pluginAgentLayers() → Array<{plugin, dir, builtFor: number|null}>`; `scanLayer(dir, origin, { requireMetaV2 = false, builtFor = null } = {})`.

**Scope rule (important):** the v2 gate applies to the PLUGIN layers ONLY. Builtin and user sidecars without `metaVersion` keep loading through `normalizeMeta`'s v1 path until P8 — the v1 engine is still the live engine and a user's own v1 agent must keep running. Plugins are different: API 3 is a *contract they declare*, and a plugin agent with no ports can be neither placed on a v2 canvas nor resolved by the v2 engine, so it is ignored with a loud, actionable line.

The exact message (one template, `builtFor` pre-formatted so an unknown range still reads as English):

```js
const builtForText = builtFor == null ? 'an older plugin API' : `plugin API ${builtFor}`;
`[agent-registry] ${origin}/${file}: built for ${builtForText} — worca requires plugin API 3 (a metaVersion 2 sidecar with typed ports) — ignored`
```

- [ ] Step 1: Write the failing test (append to `test/plugin-agent-registry.test.mjs`):

```js
// test/plugin-agent-registry.test.mjs (append)
test('a plugin sidecar that is not meta v2 is ignored, with a line naming the API', () => {
  const versionDir = installFakePlugin('legacy-source', []);
  writeFileSync(join(versionDir, 'worca-cc-plugin.json'),
    JSON.stringify({ name: 'legacy-source', engines: { 'worca-cc-api': '>=2 <3' } }));
  const agentsDir = join(versionDir, 'agents');
  writeFileSync(join(agentsDir, 'oldHelper.md'), '# oldHelper\n');
  writeFileSync(join(agentsDir, 'oldHelper.meta.json'), JSON.stringify({
    key: 'oldHelper', displayName: 'Old Helper', agentFile: 'oldHelper.md',
    runnerType: 'producer', consumes: ['userPrompt'], produces: ['plan'], order: 900,
  }));
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
    assert.equal(reg.oldHelper, undefined, 'the v1 plugin sidecar never reaches the registry');
    assert.ok(reg.alpha, 'the builtin layer is unaffected');
  } finally { console.warn = realWarn; }
  assert.ok(warnings.some((m) => m.includes('plugin:legacy-source/oldHelper.meta.json')
    && m.includes('built for plugin API 2')
    && m.includes('metaVersion 2') && m.endsWith('ignored')), warnings.join('\n'));
});

test('the v2 gate is PLUGIN-only: a v1 USER sidecar still loads (v1 engine is live)', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  const userDir = tmp('worca-cc-userlayer-');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, 'oldUser.md'), '# oldUser\n');
  writeFileSync(join(userDir, 'oldUser.meta.json'), JSON.stringify({
    key: 'oldUser', displayName: 'Old User', agentFile: 'oldUser.md',
    runnerType: 'producer', consumes: ['plan'], produces: ['review'], order: 98,
  }));
  const reg = loadAgentRegistry(builtin, { userAgentsDir: userDir, includePlugins: false });
  assert.ok(reg.oldUser, 'a v1 user sidecar is untouched by the plugin API gate');
  assert.equal(reg.oldUser.metaVersion, undefined);
});
```

(`tmp`, `writeAgent`, `mkdirSync`, `writeFileSync` and `installFakePlugin` all already exist in that file — `:20-21`, `:24`, `:9`, `:35`. `installFakePlugin(name, [])` still creates `agents/`, which is what `pluginAgentLayers` filters on.)

`Expected: FAIL — "AssertionError: the v1 plugin sidecar never reaches the registry" (reg.oldHelper is an object today)`

- [ ] Step 2: Implement. In `src/core/agent-registry.mjs`, add the import (next to `:16`):

```js
import { declaredApi } from './plugin-manifest.mjs'; // plugin API declared by a layer's manifest
```
This is acyclic: `plugin-manifest.mjs` imports `plugin-api.mjs`, `model-env.mjs` and the pure `src/shared/graph/*` — never `agent-registry.mjs`.

Extend `pluginAgentLayers` (`:272-283`) to carry the declared API (one extra read per installed plugin, inside the existing try/catch):

```js
export function pluginAgentLayers() {
  try {
    const lock = readPluginsLock();
    return Object.keys(lock)
      .sort()
      .filter((name) => lock[name] && lock[name].enabled !== false)
      .map((name) => {
        const dir = pluginCurrentDir(name);
        let builtFor = null;
        try {
          const raw = JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8'));
          builtFor = declaredApi(raw?.engines?.['worca-cc-api'] ?? '');
        } catch { builtFor = null; } // unreadable manifest: the message degrades, the skip does not
        return { plugin: name, dir: join(dir, 'agents'), builtFor };
      })
      .filter(({ dir }) => existsSync(dir));
  } catch {
    return []; // no home / unreadable lock => no plugin layer (fails safe)
  }
}
```

Extend `scanLayer` (`:314`) with the opt-in gate — the two new lines go immediately after the `JSON.parse` and before `normalizeMeta`:

```js
function scanLayer(dir, origin, { requireMetaV2 = false, builtFor = null } = {}) {
  …
    // API 3 (plugin layers only): a sidecar that is not meta v2 has no typed
    // ports, so it can be neither placed on a canvas nor resolved by the graph
    // engine. Ignore it with a line that names the fix. Builtin/user layers keep
    // the v1 path until the engine cut-over.
    if (requireMetaV2 && Number(parsed?.metaVersion) !== 2) {
      const builtForText = builtFor == null ? 'an older plugin API' : `plugin API ${builtFor}`;
      console.warn(`[agent-registry] ${origin}/${f}: built for ${builtForText} — worca requires plugin API 3 (a metaVersion 2 sidecar with typed ports) — ignored`);
      continue;
    }
    const meta = normalizeMeta(parsed);
```

`test/plugin-agent-registry.test.mjs:57` pins the layer shape with a `deepEqual`; extend it (the plugin there declares no manifest, so `builtFor` is `null`):
```js
  assert.deepEqual(layers, [{ plugin: 'demo-source', dir: join(pluginCurrentDir('demo-source'), 'agents'), builtFor: null }]);
```

And pass it from the plugin merge loop (`:384`):
```js
    for (const { plugin, dir, builtFor } of pluginAgentLayers()) {
      for (const m of scanLayer(dir, `plugin:${plugin}`, { requireMetaV2: true, builtFor })) {
```

`readFileSync` and `join` are already imported at `:11-12`.

`Expected: PASS — node --test test/plugin-agent-registry.test.mjs test/agent-registry.test.mjs test/agent-registry-layered.test.mjs test/plugin-skills.test.mjs → all pass`
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — registry ignores non-v2 plugin sidecars`

---

### Task 5: plugin templates import as v2 graphs

**Files:** modify `src/core/plugin-workflows.mjs:8-15` (imports), `:33-90` (`importPluginWorkflows`), `:142-179` (`referencedPluginAgents`); rewrite `test/plugin-workflows.test.mjs`.
**Interfaces produced:** `importPluginWorkflows(name, versionDir) → {imported, skipped}` (unchanged signature); rows written with `version = 2, graph = {nodes, wires, canvas?}, steps = '[]', feedbacks = '[]', archived_at = NULL`.
**Consumes:** `registryPortsFn` (`src/core/graph/registry-ports.mjs`), `validateGraph`, `loadAgentRegistry`.

Storage contract (spec §4, binding): **the `graph` column holds `{nodes, wires, canvas?}` ONLY.** `id`/`name`/`domain`/`origin` stay row columns so a rename can never drift. `workflow-validator.mjs` is no longer imported here (it dies in P8, and this module was its last non-v1 caller); `wfp_<plugin>_<slug>` minting, the `origin` stamp, `removePluginWorkflows` and its reference guard are UNCHANGED.

- [ ] Step 1: Write the failing tests. Rewrite `test/plugin-workflows.test.mjs` keeping the harness at `:23-62` (fresh `WORCA_HOME` per test, `installFakePlugin`, the lock write) and swapping the fixture agent + template for v2. Twelve tests (names carried over from the discarded branch, three of them new):

```js
// test/plugin-workflows.test.mjs — replace installFakePlugin's sidecar body and TPL
  writeFileSync(join(versionDir, 'agents', 'demoAgent.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'demoAgent', displayName: 'Demo Agent', agentFile: 'demoAgent.md',
    runnerType: 'producer', order: 50,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  }));

/** The smallest legal v2 plugin template: task -> demoAgent -> end. V20 and V21
 *  apply to plugin templates too, so both flow cards are mandatory. */
function graphTpl(name = 'Demo Flow', key = 'demoAgent') {
  return {
    name, version: 2, domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      { id: 'n_a', kind: 'agent', key, x: 320, y: 200, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}
const TPL = graphTpl();

test('importPluginWorkflows inserts v2 rows id wfp_<name>_<slug> with origin plugin:<name>', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, ['wfp_demo_simple']);
  const row = getDb().prepare(
    'SELECT name, version, origin, domain, graph, steps, feedbacks, archived_at FROM workflows WHERE id = ?',
  ).get('wfp_demo_simple');
  assert.equal(row.origin, 'plugin:demo');
  assert.equal(row.name, 'Demo Flow');
  assert.equal(row.version, 2);
  assert.equal(row.domain, 'general');
  assert.equal(row.steps, '[]', 'the v1 columns are blanked');
  assert.equal(row.feedbacks, '[]');
  assert.equal(row.archived_at, null);
  const graph = JSON.parse(row.graph);
  assert.deepEqual(Object.keys(graph).sort(), ['nodes', 'wires'], 'graph holds nodes/wires only');
  assert.deepEqual(graph.nodes, TPL.nodes);
  assert.deepEqual(graph.wires, TPL.wires);
});

test('an imported plugin template reads back through readWorkflow as a v2 graph', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const tpl = await readWorkflow('wfp_demo_simple');
  assert.ok(tpl, 'a v1 row would have been dropped by rowToTpl');
  assert.equal(tpl.version, 2);
  assert.equal(tpl.origin, 'plugin:demo');
  assert.equal(tpl.nodes.length, 3);
});

test('re-import upserts by id: name/graph update, created_at survives', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  const before = getDb().prepare('SELECT created_at FROM workflows WHERE id = ?').get('wfp_demo_simple');
  const renamed = { ...graphTpl('Demo Flow v2'), domain: 'coding' };
  await writeFile(join(versionDir, 'workflows', 'simple.json'), JSON.stringify(renamed));
  await importPluginWorkflows('demo', versionDir);
  const row = getDb().prepare('SELECT name, domain, created_at FROM workflows WHERE id = ?').get('wfp_demo_simple');
  assert.equal(row.name, 'Demo Flow v2');
  assert.equal(row.domain, 'coding');
  assert.equal(row.created_at, before.created_at);
});

test('re-import UN-ARCHIVES a row the v2 upgrade had archived', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  getDb().prepare("UPDATE workflows SET archived_at = '2026-08-26T00:00:00.000Z' WHERE id = ?").run('wfp_demo_simple');
  await importPluginWorkflows('demo', versionDir);
  assert.equal(getDb().prepare('SELECT archived_at FROM workflows WHERE id = ?').get('wfp_demo_simple').archived_at, null);
});
```

```js
test('a v1 "steps" template is rejected with a warning naming the port, never imported', async () => {
  const versionDir = installFakePlugin('demo', {
    'legacy.json': { name: 'Legacy', version: 1, steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] },
  });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, []);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].errors[0], /not a version-2 graph template/);
  assert.equal(getDb().prepare('SELECT id FROM workflows WHERE id = ?').get('wfp_demo_legacy'), undefined);
});

test('a graph without an end node fails V21 — V20/V21 apply to plugin templates too', async () => {
  const noEnd = graphTpl();
  noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  const versionDir = installFakePlugin('demo', { 'no-end.json': noEnd });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, []);
  assert.match(res.skipped[0].errors.join('; '), /^V21: /);
});

test('an invalid template (agent key the registry does not know) is skipped with a warning, not thrown', async () => {
  const versionDir = installFakePlugin('demo', { 'ghost.json': graphTpl('Ghost', 'noSuchAgent') });
  const res = await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(res.imported, []);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].errors.join('; '), /V4|noSuchAgent/);
});

test('a user-duplicated copy (origin NULL) is a separate row, untouched by re-import AND removal', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  await writeGraphWorkflow({ id: 'wf_my-copy', name: 'My Copy', domain: 'general', nodes: TPL.nodes, wires: TPL.wires });
  await importPluginWorkflows('demo', versionDir);
  await removePluginWorkflows('demo');
  const mine = getDb().prepare('SELECT origin FROM workflows WHERE id = ?').get('wf_my-copy');
  assert.ok(mine && mine.origin === null);
});

test('referencedPluginAgents walks graph.nodes of NON-plugin workflows', async () => {
  const versionDir = installFakePlugin('demo', {});
  await writeGraphWorkflow({ id: 'wf_mine', name: 'Mine', domain: 'general', nodes: TPL.nodes, wires: TPL.wires });
  const refs = referencedPluginAgents('demo');
  assert.deepEqual(refs, [{ workflowId: 'wf_mine', name: 'Mine', keys: ['demoAgent'] }]);
  void versionDir;
});

test('referencedPluginAgents ignores the plugin\'s OWN imported rows', async () => {
  const versionDir = installFakePlugin('demo', { 'simple.json': TPL });
  await importPluginWorkflows('demo', versionDir);
  assert.deepEqual(referencedPluginAgents('demo'), []);
});
```

Keep the three removal-guard tests as they are today (`:115-154`: `removePluginWorkflows throws ReferencedError when a project pins the workflow`, `the guard also catches a paused pipeline whose resume_point pins the workflow`, `but an ARCHIVED pipeline releases the pin — archive must not strand \`worca plugin remove\``) — swap only their template literal for `TPL`. Import `readWorkflow` and `writeGraphWorkflow` from `../src/core/workflows.mjs` at `:15`.

`Expected: FAIL — "AssertionError: 1 !== 2" (row.version is still 1)`
- [ ] Step 2: Implement. `src/core/plugin-workflows.mjs` — swap the imports (`:13-14`):

```js
import { loadAgentRegistry } from './agent-registry.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { validateGraph } from '../shared/graph/validate.mjs';
```

Replace the body of `importPluginWorkflows` from `:52` (`getDb();`) to `:88` (`imported.push(id);`):

```js
  getDb(); // open + migrate: workflows.origin/graph/archived_at exist (V13/V23)
  const now = new Date().toISOString();
  // ONE registry load for the whole import, and the SHARED port synthesis over
  // it: agent meta ports plus the universal `await` gate and the flow-card
  // table. The templates are not in the DB yet, so resolveGraph is unavailable —
  // registryPortsFn exists for exactly this caller and the server's save route.
  const portsFn = registryPortsFn(loadAgentRegistry());
  const skip = (f, errors) => {
    skipped.push({ file: f, errors });
    console.warn(`[plugin-workflows] ${name}/${f}: invalid template — skipped (${errors.join('; ')})`);
  };
  for (const f of files) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      skipped.push({ file: f, errors: [`unreadable JSON: ${err.message}`] });
      console.warn(`[plugin-workflows] ${name}/${f}: unreadable JSON — skipped`);
      continue;
    }
    // A v1 `steps` template is called out by name rather than left to V1's
    // generic "version must be 2": the plugin author needs to know their
    // template needs porting, not that a field is off by one.
    if (Number(raw?.version) !== 2) {
      skip(f, ['not a version-2 graph template (nodes/wires) — port the "steps" pipeline']);
      continue;
    }
    const id = `wfp_${name}_${slugify(basename(f, '.json'))}`;
    const rowName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : basename(f, '.json');
    const domain = normDomain(raw.domain);
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const wires = Array.isArray(raw.wires) ? raw.wires : [];
    // The FULL kind set {agent, task, and, or, combine, end} and every rule
    // V1-V21 — including V20/V21's mandatory Task + End cards and V7's
    // one-wire-per-input — apply to a plugin template exactly as they do to a
    // hand-composed one. Warnings never block an import (they do not block a
    // save either); they are logged so a template that will misbehave at run
    // time says so at install.
    const { errors, warnings } = validateGraph({ id, name: rowName, version: 2, domain, nodes, wires }, portsFn);
    if (errors.length) { skip(f, errors.map((e) => `${e.code}: ${e.message}`)); continue; }
    for (const w of warnings) console.warn(`[plugin-workflows] ${name}/${f}: ${w.code}: ${w.message}`);
    // graph holds {nodes, wires, canvas?} ONLY — id/name/domain/origin are row
    // columns, so a rename can never drift between the two.
    const graph = { nodes, wires };
    if (raw.canvas && typeof raw.canvas === 'object') graph.canvas = raw.canvas; // accepted, engine-ignored
    tx(() => {
      prepare(`
        INSERT INTO workflows (id, name, version, domain, graph, steps, feedbacks, origin, created_at, updated_at, archived_at)
        VALUES (?, ?, 2, ?, ?, '[]', '[]', ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, version = 2, domain = excluded.domain,
          graph = excluded.graph, steps = '[]', feedbacks = '[]',
          origin = excluded.origin, updated_at = excluded.updated_at,
          archived_at = NULL
      `).run(id, rowName, domain, JSON.stringify(graph), origin, now, now);
    });
    imported.push(id);
  }
```

(`created_at` keeps today's semantics: `INSERT` stamps `now`, `ON CONFLICT` never touches it — that is what "created_at survives" pins. A successful re-import un-archives, which is the documented escape hatch after the P8 upgrade archives every v1 row.)

Replace the `referencedPluginAgents` row scan (`:165-177`):

```js
  for (const row of prepare(
    'SELECT id, name, graph FROM workflows WHERE origin IS NULL OR origin != ?',
  ).all(`plugin:${name}`)) {
    let graph;
    try { graph = JSON.parse(row.graph); } catch { continue; } // v1 rows have graph NULL: nothing to guard
    const found = new Set();
    for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
      if (node && node.kind === 'agent' && keys.has(node.key)) found.add(node.key);
    }
    if (found.size) out.push({ workflowId: row.id, name: row.name, keys: [...found].sort() });
  }
```
Update its doc comment (`:142-149`) to say the walk is over `graph.nodes[]` because every v2 writer blanks `steps` to `'[]'` — a `steps` scan would silently match nothing and let `worca plugin remove` rip an agent out from under a saved template.

`Expected: PASS — node --test test/plugin-workflows.test.mjs test/plugin-store.test.mjs test/api-plugins.test.mjs → all pass`
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — plugin templates import as v2 graphs`

---

### Task 6: `apiMismatch` reaches the Plugins view, the doctor and the CLI

**Files:** modify `src/core/plugin-store.mjs:18` (import), `:143-158` (`dirChecks`), `:427-450` (`listInstalledPlugins`); modify `src/cli/worca-cc.mjs:1184-1188` (`plugin list`); modify `ui/public/plugins-view.mjs:1-20` (new export) `:59` (badge) `:75` (note); modify `test/plugins-view.test.mjs:157`, `test/plugin-store.test.mjs`.
**Interfaces produced:** `listInstalledPlugins()[i].apiMismatch: null | {builtFor, host, agents, workflows, message}`; `dirChecks` gains an `agents-api` check whose `detail` is `apiMismatch.message` (or the healthy line). The browser has NO formatter: `plugins-view.mjs` renders `p.apiMismatch.message` verbatim (one text, one owner — Task 1's `apiMismatchMessage`).

The Plugins-view sentence is FIXED (adjudication §1.7), and "worca" is the product name in it:
```
built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (${n} agent(s), ${m} template(s) ignored)
```

- [ ] Step 1: Write the failing tests.

```js
// test/plugins-view.test.mjs (append) — the fixture carries the server-built `message`
test('an API-mismatched plugin gets an amber "needs update" badge and the note', () => {
  const el = renderPluginList([
    { name: 'old-plugin', version: '0.2.0', enabled: true, contributions: { agents: 1, workflows: 1 },
      apiMismatch: { builtFor: 2, host: 3, agents: 1, workflows: 1,
        message: 'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)' } },
    { name: 'fine-plugin', version: '1.0.0', enabled: true, contributions: {} },
  ], { doc });
  const cards = el.querySelectorAll('.plugin-card');
  const badge = cards[0].querySelector('.pl-api-mismatch');
  assert.ok(badge, 'needs-update badge renders');
  assert.equal(badge.textContent, 'needs update');
  assert.ok(badge.classList.contains('amber'));
  assert.equal(cards[0].querySelector('.pl-broken'), null, 'an outdated plugin is not "broken"');
  const note = cards[0].querySelector('.pl-api-note');
  assert.equal(note.textContent,
    'built for plugin API 2; this version of worca requires plugin API 3 for agents and pipeline '
    + 'templates — update or reinstall the plugin (1 agent(s), 1 template(s) ignored)');
  assert.equal(note.previousElementSibling.className, 'pl-contrib hint', 'the note follows the contributions line');
  assert.equal(cards[1].querySelector('.pl-api-mismatch'), null);
  assert.equal(cards[1].querySelector('.pl-api-note'), null);
});

test('a card without apiMismatch renders no note (the browser has no formatter of its own)', () => {
  const el = renderPluginList([{ name: 'fine', version: '1.0.0', enabled: true, contributions: {} }], { doc });
  assert.equal(el.querySelector('.pl-api-note'), null);
});
```

```js
// test/plugin-store.test.mjs (append — the file's local helper writes a plugin dir + lock entry)
test('listInstalledPlugins reports apiMismatch for v1-shaped data, and null when clean', async () => {
  const dir = installLocal('legacy-data', { engines: { 'worca-cc-api': '>=1 <2' } });
  writeFileSync(join(dir, 'agents', 'oldOne.meta.json'), JSON.stringify({ key: 'oldOne', agentFile: 'oldOne.md' }));
  writeFileSync(join(dir, 'agents', 'oldOne.md'), '# oldOne\n');
  const p = listInstalledPlugins().find((x) => x.name === 'legacy-data');
  assert.deepEqual(p.apiMismatch, { builtFor: 1, host: 3, agents: 1, workflows: 0,
    message: 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (1 agent(s), 0 template(s) ignored)' });
  assert.equal(p.broken, false, 'an outdated data contract is not a broken install');
  const clean = listInstalledPlugins().find((x) => x.name !== 'legacy-data');
  if (clean) assert.equal(clean.apiMismatch, null);
});

test('doctor reports an agents-api check', async () => {
  const dir = installLocal('legacy-doctor', { engines: { 'worca-cc-api': '>=1 <2' } });
  writeFileSync(join(dir, 'agents', 'oldTwo.meta.json'), JSON.stringify({ key: 'oldTwo', agentFile: 'oldTwo.md' }));
  writeFileSync(join(dir, 'agents', 'oldTwo.md'), '# oldTwo\n');
  const report = await doctorPlugin('legacy-doctor');
  const check = report.checks.find((c) => c.id === 'agents-api');
  assert.ok(check, 'the doctor names the data contract');
  assert.equal(check.ok, false);
  assert.match(check.detail, /update or reinstall the plugin/);
});
```
(Use the file's existing install helper — whatever `test/plugin-store.test.mjs` already calls to lay down `versions/<sha>/` + `current` + a lock entry — instead of inventing `installLocal`; the assertions are what matter.)

`Expected: FAIL — "AssertionError: needs-update badge renders" / "AssertionError: expected undefined to deeply equal { builtFor: 1, … }"`
- [ ] Step 2: Implement.

`ui/public/plugins-view.mjs` — NO formatter here: the sentence arrives on `p.apiMismatch.message` (Task 1's `apiMismatchMessage`, server-side). `broken` alone would read as "reinstall me" and say nothing about why, hence the separate badge + note:
Insert the badge after the `linked` badge (`:59`) and BEFORE the `broken` badge, and make `broken` an `else if` so a card never carries both:
```js
    if (p.apiMismatch) head.appendChild(h(doc, 'span', 'badge amber pl-api-mismatch', 'needs update'));
    else if (p.broken) head.appendChild(h(doc, 'span', 'badge red pl-broken', 'broken'));
```
Insert the note immediately after the `.pl-contrib` line (`:75`):
```js
    if (p.apiMismatch) card.appendChild(h(doc, 'small', 'pl-api-note hint err', p.apiMismatch.message || ''));
```

`src/core/plugin-store.mjs` — extend the import (`:18`):
```js
import { normalizeManifest, validatePluginDir, apiSatisfies, dataContractIssues, apiMismatch } from './plugin-manifest.mjs';
```
In `dirChecks` (`:143-158`), inside the `if (manifest)` block after the `api` check:
```js
    const mismatch = apiMismatch(range, dataContractIssues(dir));
    c('agents-api', !mismatch, mismatch ? mismatch.message : 'agents and pipeline templates are plugin API 3 (meta v2 + graph templates)');
```
In `listInstalledPlugins` (`:427-450`), after `const inv = …`, and add the field to the returned object:
```js
    // Read from the raw dir, not the manifest: the mismatch is about the DATA
    // the plugin ships, not about whether its manifest normalized.
    const mismatch = manifest
      ? apiMismatch(manifest.engines?.worcaApi ?? '', dataContractIssues(cur))
      : null;
    …
      broken: !manifest,
      apiMismatch: mismatch,
```

`src/cli/worca-cc.mjs` `plugin list` (`:1184-1188`) — one extra line under a flagged row:
```js
        for (const p of plugins) {
          const version = p.linked ? 'linked' : p.version || (p.pinnedSha || '').slice(0, 7);
          const flags = [p.enabled ? 'enabled' : 'disabled', ...(p.linked ? ['linked'] : [])].join(', ');
          out(`${p.name}\t${version}\t${flags}\t${contribSummary(p.contributions)}`);
          if (p.apiMismatch) out(c('yellow', `  ${p.apiMismatch.message}`));
        }
```

`Expected: PASS — node --test test/plugins-view.test.mjs test/plugin-store.test.mjs test/api-plugins.test.mjs test/cli-plugin.test.mjs test/plugin-provenance-ui.test.mjs → all pass`
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — needs-update badge, doctor check and CLI note`

---

### Task 7: agent-gen v2 — the LLM drafts typed ports

**Files:** modify `src/core/agent-gen.mjs:23-26` (SYSTEM_PROMPT), `:39` (`this.channels` dies), `:88-92` (read-back), `:113-125` (`_neighborBlock`), `:127-144` (`_metaSchemaBlock`), `:146-157` (`_fullPrompt`), `:159-169` (`_metaPrompt`); modify `src/core/claude-runner.mjs:1551-1576` (`mockAgentGen`); modify `ui/server.mjs:3935-3945` (`startAgentGen`), `:3986-3994` (`/api/agents/generate`); modify `test/agent-gen.test.mjs`, `test/agents-questions-form.test.mjs:33-38`.
**Interfaces produced:** `createAgentGen({name, purpose, details, expectedBefore, expectedAfter, userMarkdown, claude})` — the `channels` option is GONE; the draft's meta is a normalized v2 meta.
**Consumes:** `validateMetaV2` (P2), `normalizeMeta`.

- [ ] Step 1: Write the failing tests. Keep `test/agent-gen.test.mjs:61-66` (the palette-blurb pins) EXACTLY as they are — they must still pass against the new block — and drop the now-meaningless `channels:` option from the three `createAgentGen` calls at `:22`, `:42`. Append:

```js
// test/agent-gen.test.mjs (append)
test('the meta schema block teaches meta v2 ports, not channels', () => {
  const gen = createAgentGen({ name: 'X', purpose: 'p', claude: { mock: true } });
  const block = gen._metaSchemaBlock();
  assert.match(block, /"metaVersion": 2/);
  assert.match(block, /at most 8 ports per side/);
  assert.match(block, /The id "await" is RESERVED/);
  assert.match(block, /"verifier" MUST declare "verdict"/);
  assert.match(block, /"clarifier" MUST declare/);
  assert.doesNotMatch(block, /consumes|optionalConsumes|connectsTo|loopSource/,
    'the channel vocabulary is gone from the generator prompt');
});

test('neighbors are rendered as typed ports, and the body is told to document them', () => {
  const gen = createAgentGen({
    name: 'X', purpose: 'p', claude: { mock: true },
    expectedBefore: [{ key: 'planner', displayName: 'Plan', inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md' }] }],
    expectedAfter: [],
  });
  const block = gen._neighborBlock();
  assert.match(block, /"outputs": \[\s*\{\s*"id": "plan",\s*"type": "md",\s*"when": "always"/);
  assert.doesNotMatch(block, /Channel vocabulary/);
  assert.match(block, /port ids are yours to choose/i);
  assert.match(gen._fullPrompt(), /## Ports/);
  assert.match(gen._fullPrompt(), /never hardcode filenames/);
});

test('a generated meta that breaks a v2 rule fails with the rules named', async () => {
  const gen = createAgentGen({ name: 'Bad Agent', purpose: 'p', claude: { mock: true } });
  const events = collect(gen);
  const { mkdir, writeFile } = await import('node:fs/promises');
  // Replace the ONE seam that talks to claude, so the read-back sees exactly
  // this meta: the gate is the subject, not the LLM.
  gen._runClaude = async () => {
    await mkdir(gen.scratchDir, { recursive: true });
    await writeFile(gen.mdPath, '# Bad Agent\n\nbody\n', 'utf8');
    await writeFile(gen.metaPath, JSON.stringify({
      metaVersion: 2, key: 'badAgent', displayName: 'Bad', runnerType: 'verifier',
      inputs: [], outputs: [],
    }), 'utf8');
  };
  const out = await gen.run();
  assert.equal(out.status, 'error');
  assert.match(out.message, /^the generator produced invalid metadata: /);
  assert.match(out.message, /at least one output port is required/);
  assert.match(out.message, /runnerType "verifier" requires verdict: \{ filename \}/);
  assert.equal(events.filter((e) => e.type === 'agentgen-error').length, 1, 'exactly one terminal event');
  assert.equal(events.filter((e) => e.type === 'agentgen-done').length, 0);
});

test('the mock generator writes a v2 sidecar with a ## Ports body', async () => {
  const gen = createAgentGen({ name: 'Docs Writer', purpose: 'write docs', claude: { mock: true } });
  const out = await gen.run();
  assert.equal(out.status, 'done');
  assert.equal(out.draft.meta.metaVersion, 2);
  assert.deepEqual(out.draft.meta.inputs.map((p) => p.id), ['plan']);
  assert.deepEqual(out.draft.meta.outputs.map((p) => p.id), ['review']);
  assert.equal(out.draft.meta.outputs[0].filename, 'review-{cycle}.md');
  assert.equal(out.draft.meta.consumes, undefined);
  assert.match(out.draft.markdown, /## Ports/);
});
```

The invalid-metadata test needs ONE seam in the engine: the inline `await runClaude({…})` inside `run()` moves into a private `async _runClaude()` method that `run()` awaits (identical behavior, one indirection). That is the only production change this test forces.

`Expected: FAIL — "AssertionError: The input did not match the regular expression /\"metaVersion\": 2/"`

- [ ] Step 2: Implement `src/core/agent-gen.mjs`. Import the gate (after `:21`): `import { validateMetaV2 } from '../shared/graph/agent-meta.mjs';`. Delete `this.channels = …` (`:39`). Product name in the three prompt headers (`:25`, `:148`, `:161`): `worca`, never `worca-cc`. Replace `_neighborBlock` (`:113-125`) and `_metaSchemaBlock` (`:127-144`) with:

```js
  _neighborBlock() {
    const j = (list) => JSON.stringify(list.map((m) => ({
      key: m.key,
      displayName: m.displayName,
      inputs: (m.inputs || []).map((p) => ({ id: p.id, type: p.type })),
      outputs: (m.outputs || []).map((p) => ({ id: p.id, type: p.type, when: p.when || 'always' })),
    })), null, 2);
    return (
      `## Pipeline neighbors\n\n` +
      `Agents expected to run BEFORE this one (their OUTPUT ports are what this agent's inputs get wired to):\n${j(this.expectedBefore)}\n\n` +
      `Agents expected to run AFTER this one (their INPUT ports are what this agent's outputs feed):\n${j(this.expectedAfter)}\n\n` +
      'Wires are drawn in the composer and only require matching port TYPES, so port ids are yours ' +
      'to choose: declare the ports this agent actually needs, and reuse a neighbor\'s id only when ' +
      'it genuinely names the same payload.\n\n'
    );
  }

  _metaSchemaBlock() {
    return (
      `Write the metadata JSON to: ${this.metaPath}\n` +
      'One JSON object, sidecar meta v2 — typed PORTS, no channel vocabulary. ' +
      'REQUIRED: { "metaVersion": 2, "key": "<lowerCamel>", "displayName", "description", ' +
      '"runnerType": "producer"|"verifier"|"clarifier", "inputs": [..], "outputs": [..] } — ' +
      'at least one output port, at most 8 ports per side.\n' +
      'An INPUT port: { "id", "type": "md"|"json"|"void", "label", "required" (default true — a ' +
      'required input is a barrier the agent waits on), "loop" (true = loop receiver; forces ' +
      'required:false; a fresh token re-fires the agent), "expands" (json only — run once per ' +
      'element of the array it carries), "as": "file"|"answers"|"fix-review"|"worktree" (how the ' +
      'payload renders into the prompt; default "file"; "worktree" is the only renderer a void ' +
      'input takes), "directive" (markdown appended to the task prompt only when this port fires; ' +
      '{path} is substituted) }.\n' +
      'An OUTPUT port: { "id", "type", "when": "always"|"blocking"|"clean" (default always; ' +
      'anything else requires "verdict"), "filename" (plain basename, required on md/json, may use ' +
      '{cycle} {vsuffix} {base}), "store": "run"|"project" (default run), "artifactKind" (defaults ' +
      'to the id) }. A void port carries no payload — no filename, no store.\n' +
      'Port ids are lowerCamel, <=32 chars, unique per side. The id "await" is RESERVED — the ' +
      'engine synthesizes an await gate on every agent node; never declare it.\n' +
      'Runner obligations: "verifier" MUST declare "verdict": { "filename": "<basename>" }; ' +
      '"clarifier" MUST declare at least one json output; "producer" just writes its outputs.\n' +
      'Optional agent fields: "color" (green|peach|red|blue|violet|amber), "icon" (inline SVG ' +
      'path), "sideEffect": "code", "scope": "project"|"workspace-only", "domain", "order", ' +
      '"fanOut", "asksQuestions"/"questionsLocked"/"questionsDefault", "requiresSkills": [..], ' +
      '"promptHints", "wantsRequest", "workspaceFanOut", "workspaceStrategy": ' +
      '"explore"|"task"|"review", "workspaceVariantOf": "<agentKey>" (requires scope ' +
      '"workspace-only"), "placeable": false, "mockRole" (omit unless mimicking a built-in ' +
      'writer; unknown values dropped).\n' +
      '"description" is the palette blurb: 1-2 plain sentences, max 160 chars total and the ' +
      'FIRST sentence max 75 chars (the palette card clamps at 1-2 short lines). It is shown under ' +
      'the agent name in the composer palette — say what the agent does and what it reads/writes.\n' +
      'Questions flags: asksQuestions=true if the agent may need a user decision mid-task ' +
      '(the orchestrator pauses it and resumes it with the answers). questionsLocked=true ONLY if ' +
      "asking the user is the agent's whole purpose (the user then cannot toggle it in the " +
      'pipeline menu). questionsDefault=true only for locked-on agents; every other agent ' +
      'starts OFF and the user opts in per pipeline.\n\n'
    );
  }
```

`_fullPrompt` item 1 (`:152`) gains the ports sentence:
```js
      `1. The agent's system-prompt markdown (role, inputs, outputs, method, output contract) to: ${this.mdPath}\n` +
      '   Document every port under a `## Ports` heading (one bullet per port id, what it carries); ' +
      'never hardcode filenames — the engine binds every port to an absolute path in the task prompt.\n' +
```

Extract the claude call into the seam and add the read-back gate. Replace `:72-92`:
```js
      if (metaOnly) await writeFile(this.mdPath, this.userMarkdown, 'utf8'); // the LLM reads it
      await this._runClaude(metaOnly);
      this._checkAbort();
      this._setPhase('finalize', 'validating the draft…');
      // Authoritative read-back (runWorkspaceScan pattern, phases.mjs:803-809).
      const markdown = metaOnly ? this.userMarkdown : await readFile(this.mdPath, 'utf8');
      const rawMeta = JSON.parse(await readFile(this.metaPath, 'utf8'));
      if (!Number.isFinite(Number(rawMeta?.order))) rawMeta.order = 99;
      // The SAME gate the store applies on save: a draft that breaks a port rule
      // must fail here, naming every rule, instead of 400-ing after the user has
      // reviewed it on Step 3.
      const { errors } = validateMetaV2(rawMeta);
      if (errors.length) throw new Error(`the generator produced invalid metadata: ${errors.join('; ')}`);
      const meta = normalizeMeta(rawMeta);
      if (!meta) throw new Error('the generator produced unusable metadata');
```
and add the method next to `_neighborBlock`:
```js
  /** The single claude call (seam: tests replace it to pin the read-back gate). */
  async _runClaude(metaOnly) {
    await runClaude({
      cwd: this.scratchDir,
      systemPrompt: SYSTEM_PROMPT,
      prompt: metaOnly ? this._metaPrompt() : this._fullPrompt(),
      allowedTools: ['Read', 'Write'],
      permissionMode: this.claude.permissionMode || 'acceptEdits',
      model: this.claude.model,
      modelEnv: resolveModelEnv(this.claude.model), // catalog routing env (design §4.8)
      bin: this.claude.bin,
      mock: this.claude.mock,
      signal: this.abort.signal,
      onEvent: (e) => this._onAgentEvent(e),
    });
  }
```
- [ ] Step 3: `src/core/claude-runner.mjs` `mockAgentGen` (`:1558-1565`) — v2 meta + a `## Ports` body:
```js
  const meta = {
    metaVersion: 2, key, displayName: name, description: `mock-generated agent for ${name}`,
    color: 'amber', runnerType: 'producer', domain: 'general', fanOut: false,
    asksQuestions: true, questionsLocked: false, questionsDefault: false, order: 99,
    inputs: [{ id: 'plan', type: 'md', label: 'Plan' }],
    outputs: [{ id: 'review', type: 'md', filename: 'review-{cycle}.md' }],
  };
  if (m.MOCK_OUT) {
    const md = `# Agent: ${name}\n\nYou are ${name} (deterministic mock body).\n\n`
      + '## Ports\n\n- `plan` (in, md) — the plan to review.\n- `review` (out, md) — the review this agent writes.\n';
```
- [ ] Step 4: `ui/server.mjs` — drop the channel plumbing from the generator. In `startAgentGen` (`:3935-3945`) delete the `channels:` line and its two comment lines (`:3938-3941`); in `POST /api/agents/generate` (`:3992`) delete `channels: collectChannelIds(allAgents),` from the `startAgentGen({…})` call. `collectChannelIds` itself dies in Task 8.
- [ ] Step 5: `test/agents-questions-form.test.mjs:33-38` pins the OLD schema strings (`"asksQuestions": bool`). Repoint them at the new block:
```js
test('builder prompt schema names the questions fields with guidance', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/core/agent-gen.mjs', import.meta.url)), 'utf8');
  assert.match(src, /"asksQuestions"\/"questionsLocked"\/"questionsDefault"/);
  assert.match(src, /questionsLocked=true ONLY if/);
  assert.match(src, /questionsDefault=true only for locked-on agents/);
});
```
Its first test (`:12-22`) creates a user agent through `createAgent` with a v1 meta — Task 13 adds the store gate, so convert that meta now:
```js
    meta: { key: 'qDemo', displayName: 'Q Demo', order: 99, metaVersion: 2, runnerType: 'producer',
      inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
      asksQuestions: true, questionsLocked: false, questionsDefault: true },
```

`Expected: PASS — node --test test/agent-gen.test.mjs test/agents-questions-form.test.mjs test/agentgen-api.test.mjs test/ui-agent-wizard.test.mjs → all pass`
- [ ] Step 6: Commit — `worca: Node-graph v2 P7 — agent-gen drafts meta v2 ports`

---

### Task 8: `GET /api/agents` returns `{ agents, mockWriterRoles }`

**Files:** modify `ui/server.mjs:115` (import), `:3886-3905` (`collectChannelIds` — DELETE), `:3907-3916` (the route); modify `ui/public/app.js:26` (state), `:6600`; modify `test/agents-api.test.mjs:37-47`, `:91-104`.
**Interfaces produced:** `GET /api/agents[?all=1] → { agents, mockWriterRoles: string[] }`.
**Consumes:** `MOCK_WRITER_ROLES` (P2, `src/core/claude-runner.mjs`).

- [ ] Step 1: Write the failing tests — rewrite `test/agents-api.test.mjs:37` and REPLACE the channels-union test at `:91-104` (it has no successor: channels are gone from this payload):

```js
test('GET /api/agents carries origin + mockWriterRoles and EXCLUDES markdown', async () => {
  const r = await get('/api/agents');
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data.agents) && data.agents.length >= 9);
  assert.ok(data.agents.every((a) => a.origin === 'builtin' || a.origin === 'user'));
  assert.ok(data.agents.every((a) => !('markdown' in a)));
  assert.equal(data.channels, undefined, 'the channel vocabulary is gone from this payload');
  assert.ok(Array.isArray(data.mockWriterRoles));
  assert.ok(data.mockWriterRoles.includes('generic-verifier') && data.mockWriterRoles.includes('clarify'));
  assert.ok(!data.agents.some((a) => a.key === 'workspaceScanner'), 'workspace-only excluded by default');
  const all = await (await get('/api/agents?all=1')).json();
  assert.ok(all.agents.some((a) => a.key === 'workspaceScanner'), '?all=1 includes workspace-only');
});

test('GET /api/agents carries the v2 port fields the composer and the editor need', async () => {
  const { agents } = await (await get('/api/agents')).json();
  const planner = agents.find((a) => a.key === 'planner');
  assert.equal(planner.metaVersion, 2);
  assert.ok(Array.isArray(planner.inputs) && planner.inputs.some((p) => p.id === 'task'));
  assert.ok(Array.isArray(planner.outputs) && planner.outputs.some((p) => p.id === 'plan'));
  assert.equal(typeof planner.portSummary, 'string');
  assert.ok(planner.portSummary.length > 0);
});
```
The `META`/`MD` constants in that file are v1 and every POST through them will 400 after Task 13 — convert `META` now:
```js
const META = {
  metaVersion: 2, displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'docs-review.md' }],
};
```
The workflow-reference test at `:80-89` builds a v1 workflow that names `docsWriter`; leave it alone (Task 13 keeps a v1 `steps` arm in the delete scan) — verify it stays green.

`Expected: FAIL — "AssertionError: the channel vocabulary is gone from this payload"`
- [ ] Step 2: Implement. `ui/server.mjs`: delete `collectChannelIds` and its comment block (`:3886-3905`) and drop `CHANNEL_IDS` from the import at `:115` (`import { CHANNEL_IDS } from '../src/core/channels.mjs';` — the whole line goes; `channels.mjs` itself stays until P8). Extend the existing claude-runner import at `ui/server.mjs:74` to `import { mockEnabled, MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';`. The route becomes:

```js
app.get('/api/agents', async (req, res) => {
  try {
    const all = await listAgents(); // merged builtin+user+plugin, origin stamped, .order ascending
    // §6.6: workspace-only agents stay out of the Composer palette by default;
    // the Agents management view passes ?all=1 to see them too.
    const agents = isTruthy(req.query.all) ? all : all.filter((m) => m.scope !== 'workspace-only');
    // mockWriterRoles drives ONE select in the agent form. It is a CLOSED list
    // (the mock switch in claude-runner.mjs), unlike the open channel vocabulary
    // it replaces: an unknown mockRole is dropped by the registry with a warning.
    res.json({ agents, mockWriterRoles: [...MOCK_WRITER_ROLES] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

`ui/public/app.js:26` — `channelIds: [],` becomes `mockWriterRoles: [], // closed mock-role list from /api/agents (drives the agent form)`; `:6600` becomes:
```js
    if (res.ok && Array.isArray(data.mockWriterRoles)) state.mockWriterRoles = data.mockWriterRoles;
```

`Expected: PASS — node --test test/agents-api.test.mjs → all pass` (the UI tests still fail here: they are Tasks 9–12.)
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — /api/agents serves mockWriterRoles, channels retired`

---

### Task 9: Agents-view CARD — port pills, `not placeable`, port summary

**Files:** modify `ui/public/index.html:817-821` (card template head); modify `ui/public/app.js:6623-6653` (`fillChannelRow` → `fillPortRow`, `buildAgentCard`); modify `ui/public/style.css:1382-1394` (Agents-view block); modify `test/ui-agents-view.test.mjs:13-17` (`AGENTS` fixture), `:59-78`, `:161-205`.
**Interfaces produced:** `buildAgentCard(a)` renders v2 ports; `window.__agents` keeps exporting it.

Card contract (spec §9): `.agent-origin` badge, then an amber `not placeable` badge shown only when `placeable === false`; `.agent-sub` = `` `${key} · ${runnerType} — ${description || portSummary}` ``; the Input/Output chip rows show one pill per port reading `id · type`, void pills dashed (`.void`), loop inputs prefixed `↺`. A side with no ports keeps today's `—` placeholder.

- [ ] Step 1: Write the failing tests. Replace the `AGENTS` fixture (`:13-17`) and the three channel-pill tests:

```js
// test/ui-agents-view.test.mjs
const AGENTS = [
  { key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet', runnerType: 'producer',
    metaVersion: 2, order: 1, origin: 'builtin', portSummary: 'Reads task; produces plan.',
    inputs: [{ id: 'task', type: 'md' }, { id: 'revise', type: 'md', loop: true, required: false }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md', store: 'project' }] },
  { key: 'docsWriter', displayName: 'Docs Writer', description: '', color: 'green', runnerType: 'verifier',
    metaVersion: 2, order: 42, origin: 'user', placeable: false, portSummary: 'Reads plan; produces review.',
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'docs-review.md' },
              { id: 'pass', type: 'void', when: 'clean' }] },
];
const MOCK_ROLES = ['clarify', 'planner-plan', 'generic-producer', 'generic-verifier'];
// …and every fetch stub in this file returns { agents: AGENTS, mockWriterRoles: MOCK_ROLES }.
```

```js
test('agents view renders grouped cards with origin badges + typed port pills', async () => {
  const { window } = await boot();
  await goAgents(window);
  const cards = window.document.querySelectorAll('.agent-card');
  assert.equal(cards.length, 2);
  const planner = cards[0];
  assert.equal(planner.querySelector('.agent-origin').textContent, 'builtin');
  assert.equal(planner.querySelector('.agent-sub').textContent, 'planner · producer — architecture');
  const inPills = [...planner.querySelectorAll('.agent-chips-in .agent-chip')].map((p) => p.textContent);
  assert.deepEqual(inPills, ['task · md', '↺ revise · md']);
  assert.deepEqual([...planner.querySelectorAll('.agent-chips-out .agent-chip')].map((p) => p.textContent), ['plan · md']);
});

test('a description-less agent falls back to its port summary, and void pills are marked', async () => {
  const { window } = await boot();
  await goAgents(window);
  const docs = window.document.querySelectorAll('.agent-card')[1];
  assert.equal(docs.querySelector('.agent-sub').textContent, 'docsWriter · verifier — Reads plan; produces review.');
  const out = docs.querySelectorAll('.agent-chips-out .agent-chip');
  assert.equal(out[1].textContent, 'pass · void');
  assert.ok(out[1].classList.contains('void'), 'a void port pill is visually distinct');
  assert.ok(!out[0].classList.contains('void'));
});

test('placeable:false raises the amber "not placeable" badge, and only there', async () => {
  const { window } = await boot();
  await goAgents(window);
  const [planner, docs] = window.document.querySelectorAll('.agent-card');
  assert.equal(planner.querySelector('.agent-not-placeable').hidden, true);
  const badge = docs.querySelector('.agent-not-placeable');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'not placeable');
});

test('an agent with no ports on a side keeps the — placeholder', async () => {
  const { window } = await boot({ fetchHandler: (u) => (u.includes('/api/agents')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({
      agents: [{ key: 'lonely', displayName: 'Lonely', runnerType: 'producer', metaVersion: 2, order: 5,
        origin: 'user', inputs: [], outputs: [], portSummary: '' }], mockWriterRoles: MOCK_ROLES }) })
    : null) });
  await goAgents(window);
  assert.equal(window.document.querySelector('.agent-chips-in .agent-io-none').textContent, '—');
});
```

`Expected: FAIL — "AssertionError: Expected values to be strictly deep-equal: ['task · md', '↺ revise · md'] !== []"`
- [ ] Step 2: Implement. `ui/public/index.html:819-820` — add the badge between `.agent-origin` and `.agent-sub`:
```html
                  <span class="agent-origin badge"></span>
                  <span class="agent-not-placeable badge" hidden>not placeable</span>
                  <small class="agent-sub"></small>
```

`ui/public/app.js` — replace `fillChannelRow` (`:6623-6633`) with `fillPortRow`, and update `buildAgentCard` (`:6635-6653`):
```js
// One pill per typed port: `id · type`, void ports dashed, loop inputs marked
// with ↺ (a loop input is optional and re-fires the agent on a fresh token).
function fillPortRow(container, ports, cls) {
  const list = Array.isArray(ports) ? ports : [];
  if (list.length === 0) {
    const none = document.createElement('span');
    none.className = 'agent-io-none';
    none.textContent = '—';
    container.appendChild(none);
    return;
  }
  for (const p of list) {
    if (!p || p.synthetic || p.id === 'await') continue; // the await gate is engine surface
    const text = `${p.loop ? '↺ ' : ''}${p.id} · ${p.type}`;
    container.appendChild(agentChip(text, `${cls}${p.type === 'void' ? ' void' : ''}`));
  }
}

function buildAgentCard(a) {
  const tpl = $('#agent-card-tpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.agentKey = a.key || '';
  node.querySelector('.agent-name').textContent = a.displayName || a.key;
  node.querySelector('.agent-origin').textContent = a.origin || 'builtin';
  node.querySelector('.agent-origin').classList.add(a.origin === 'user' ? 'origin-user' : 'origin-builtin');
  // placeable defaults TRUE; the badge says the agent runs off-pipeline (the
  // workspace scanner) and can never be dropped on a canvas.
  node.querySelector('.agent-not-placeable').hidden = a.placeable !== false;
  // The blurb the user authored wins; a port summary stands in when it is empty.
  node.querySelector('.agent-sub').textContent =
    `${a.key} · ${a.runnerType || 'producer'} — ${a.description || a.portSummary || ''}`;
  fillPortRow(node.querySelector('.agent-chips-in'), a.inputs, 'cons');   // INPUT row
  fillPortRow(node.querySelector('.agent-chips-out'), a.outputs, 'prod'); // OUTPUT row
  const isUser = a.origin === 'user';
  node.querySelector('.agent-edit').hidden = !isUser;
  node.querySelector('.agent-delete').hidden = !isUser;
  node.querySelector('.agent-duplicate').hidden = isUser;
  return node;
}
```
(Builtin and plugin agents keep today's affordance: Edit/Delete hidden, Duplicate shown — read-only, editable-as-copy. Their header pills show their ports all the same.)

`ui/public/style.css` — after `.agent-chip.cons` (`:1393`):
```css
.agent-chip.void { border-style:dashed; background:transparent; opacity:.75; }
.agent-not-placeable { background:var(--amber-bg); color:var(--amber-ink); }
.agent-not-placeable[hidden] { display:none; }
```
(`--amber-bg` and `--amber-ink` are declared at `style.css:25`; the badge reuses the same pair as `.btn-pause` at `:265-266`.)

`Expected: PASS — node --test test/ui-agents-view.test.mjs → all pass`
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — agent cards show typed ports`

---

### Task 10: `agentFormRender` / `agentFormRead` / `bindAgentForm` — the port editor

**Files:** modify `ui/public/index.html:842-876` (editor pane body → one `<div class="agent-form">`), `:1025-1047` (wizard Step 3 → the same); replace `ui/public/app.js:6757-6833` (`syncQuestionFlags` + `agentFormFill` + `agentFormRead`; `buildChipChecks` `:6740-6753` and `chipValues` `:6755` STAY — the wizard's Step-1 neighbor pickers use them); add CSS to `ui/public/style.css`; new `test/ui-agent-port-editor.test.mjs`.
**Interfaces produced:**
- `agentFormRender(host, meta, { markdown = '', mockWriterRoles = [], registryKeys = [] } = {}) → void` — builds the whole form under `host` (a `.agent-form` element or a container holding one) and binds it.
- `agentFormRead(host) → { meta, markdown }` — `meta` is a raw **v2 sidecar** and nothing else.
- `bindAgentForm(host) → void` — ONE delegated `click` + one `change` listener per host, idempotent (`host.dataset.bound`).
All three are exported on `window.__agents` for the jsdom tests.

The rendered form (adjudication §3 mockup — build exactly this shape):
```
Display name [Docs Writer        ]   Description [Writes the docs…              ]
Color [green ▾]  Runner type [verifier ▾]   Order [8]   Verdict filename [docs-review-cycle{cycle}.json]
Domain [coding]  Scope [project ▾]         Icon (SVG path) [<path …>]
INPUTS                                                        [+ input]  (3/8)
┌ id [plan   ] type [md ▾] as [file ▾]             [▲][▼][×] ┐
│ ☑ required ☐ loop ☐ expands        [directive]              │
├ id [fix    ] type [md ▾] as [fix-review ▾]       [▲][▼][×] ┤
│ ☐ required(disabled) ☑ loop ☐ expands  [directive ✓]        │
│  ▸ textarea: "## Fix it\n\n{path}"                           │
│  hint: loop inputs are optional; a fresh token re-fires…    │
└─────────────────────────────────────────────────────────────┘
OUTPUTS                                                       [+ output] (2/8)
┌ id [review ] type [md ▾] when [blocking ▾] filename [{base}-docs-review.md] store [project ▾] [▲][▼][×]
│  hint: "blocking"/"clean" branch on the verdict file above
├ id [pass   ] type [void ▾] when [clean ▾]  (filename/store hidden)  [▲][▼][×]
Capabilities   ☑ Research fan-out  ☑ Asks questions  ☑ Questions locked  ☑ Questions on by default
               ☑ Writes code (sideEffect)  ☑ Carries the original request  ☑ Placeable on a canvas
Mock role [generic-verifier ▾ (auto|14 roles)]   Requires skills [mock-skill, …]   Prompt hints [textarea]
Workspace runs ☑ Force fan-out   Strategy [review ▾ (—|explore|task|review)]  Variant of [reviewer] (datalist = registry keys)
System prompt (markdown) [textarea rows=16]
<p class="agent-edit-msg form-msg">                      [Cancel] [Save]
```
Classes: existing `.field > label + .input/.select/.textarea`, `.row-2`, `.fanout-toggle`, `.badge`, `.btn-ghost.btn-mini` (`style.css:1170`, `:1383-1401`, `:3307-3311`); new `.agent-form`, `.agent-ports(-in/-out)`, `.agent-ports-head`, `.agent-ports-list`, `.port-row`, `.port-row-top`, `.port-row-flags`, `.pf-id/.pf-type/.pf-as/.pf-when/.pf-filename/.pf-store/.pf-required/.pf-loop/.pf-expands/.pf-directive(-wrap/-toggle)/.pf-remove/.pf-up/.pf-down/.pf-add-in/.pf-add-out/.pf-hint`, `.agent-caps`, `.agent-workspace`, `.agent-not-placeable`. Each control sits in a `.field.pf-f-<name>` wrapper so the CSS can size the narrow columns.

`agentFormRead` rules that are NOT negotiable:
- emits a v2 sidecar ONLY — no `consumes`/`produces`/`connectsTo`/`loopSource`;
- optional capabilities are ABSENT when off, never `false`/`''` (the schema reads presence);
- `placeable` is written only to say `false`;
- unsurfaced keys ride through `dataset.extra` (host level for agent keys, row level for port keys) so a save can never silently drop `artifactKind`, per-port `label`/`description`, or a field a newer worca ships.

- [ ] Step 1: Write the failing test — `test/ui-agent-port-editor.test.mjs` (new file):

```js
// test/ui-agent-port-editor.test.mjs — the v2 port editor: render, read-back,
// add/remove/reorder, hints, and the store's 400 rendered verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const MOCK_ROLES = ['clarify', 'planner-plan', 'reviewer', 'generic-producer', 'generic-verifier'];
const META = {
  metaVersion: 2, key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs',
  color: 'green', runnerType: 'verifier', order: 8, domain: 'coding', scope: 'workspace-only',
  icon: '<path d="M0 0"/>', verdict: { filename: 'docs-review-cycle{cycle}.json' },
  fanOut: true, asksQuestions: false, questionsLocked: false, questionsDefault: false,
  wantsRequest: true, workspaceFanOut: true, workspaceStrategy: 'review',
  workspaceVariantOf: 'reviewer', requiresSkills: ['mock-skill'], promptHints: 'be terse',
  mockRole: 'generic-verifier', sideEffect: 'code', placeable: false,
  inputs: [
    { id: 'plan', type: 'md', required: true, as: 'file', label: 'The plan' },
    { id: 'fix', type: 'md', loop: true, required: false, as: 'fix-review', directive: '## Fix it\n\n{path}' },
  ],
  outputs: [
    { id: 'review', type: 'md', when: 'blocking', filename: '{base}-docs-review.md', store: 'project', artifactKind: 'docs' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
};

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [], mockWriterRoles: MOCK_ROLES }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const host = window.document.createElement('div');
  host.className = 'agent-form';
  window.document.body.appendChild(host);
  return { window, host, api: window.__agents };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const change = (window, node) => node.dispatchEvent(new window.Event('change', { bubbles: true }));

test('render → read round-trips a v2 sidecar byte-for-byte (extras included)', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { markdown: '# body\n', mockWriterRoles: MOCK_ROLES, registryKeys: ['reviewer', 'planner'] });
  const { meta, markdown } = api.agentFormRead(host);
  assert.equal(markdown, '# body\n');
  assert.deepEqual(meta, META, 'every surfaced field AND every unsurfaced key survives the round trip');
  void window;
});

test('optional capabilities are ABSENT when off, never false', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, { metaVersion: 2, key: 'plain', displayName: 'Plain', runnerType: 'producer', order: 99,
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'notes', type: 'md', when: 'always', filename: 'notes.md', store: 'run' }] },
  { mockWriterRoles: MOCK_ROLES });
  const { meta } = api.agentFormRead(host);
  for (const k of ['verdict', 'sideEffect', 'mockRole', 'wantsRequest', 'workspaceFanOut',
    'workspaceStrategy', 'workspaceVariantOf', 'placeable', 'scope', 'domain', 'icon',
    'promptHints', 'requiresSkills']) {
    assert.equal(k in meta, false, `${k} must be absent, not falsy`);
  }
  assert.equal(meta.metaVersion, 2);
  assert.equal(meta.consumes, undefined, 'no v1 channel fields are ever emitted');
  void window;
});
```

```js
test('add / remove / reorder ports, and the add button dies at 8 per side', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const rows = () => [...host.querySelectorAll('.agent-ports-in .port-row .pf-id')].map((i) => i.value);
  assert.deepEqual(rows(), ['plan', 'fix']);
  click(window, host.querySelector('.agent-ports-in .pf-add-in'));
  assert.equal(rows().length, 3, 'a blank row is appended');
  assert.equal(host.querySelector('.agent-ports-in .pf-count').textContent, '(3/8)');
  // Move the second row up, then remove the (now second) one.
  click(window, host.querySelectorAll('.agent-ports-in .port-row')[1].querySelector('.pf-up'));
  assert.deepEqual(rows(), ['fix', 'plan', '']);
  click(window, host.querySelectorAll('.agent-ports-in .port-row')[1].querySelector('.pf-remove'));
  assert.deepEqual(rows(), ['fix', '']);
  assert.deepEqual(api.agentFormRead(host).meta.inputs.map((p) => p.id), ['fix', ''],
    'read-back follows the DOM order');
  // ▲ on the first row and ▼ on the last are no-ops, not crashes.
  click(window, host.querySelector('.agent-ports-in .port-row .pf-up'));
  assert.deepEqual(rows(), ['fix', '']);
  for (let i = rows().length; i < 8; i += 1) click(window, host.querySelector('.pf-add-in'));
  assert.equal(rows().length, 8);
  assert.equal(host.querySelector('.pf-add-in').disabled, true, 'MAX_PORTS_PER_SIDE is 8');
  click(window, host.querySelector('.pf-add-in'));
  assert.equal(rows().length, 8, 'a disabled add button adds nothing');
});

test('loop forces required off, expands is json-only, and void hides filename/store', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const plan = host.querySelectorAll('.agent-ports-in .port-row')[0];
  assert.equal(plan.querySelector('.pf-required').disabled, false);
  plan.querySelector('.pf-loop').checked = true;
  change(window, plan.querySelector('.pf-loop'));
  assert.equal(plan.querySelector('.pf-required').checked, false);
  assert.equal(plan.querySelector('.pf-required').disabled, true);
  assert.equal(api.agentFormRead(host).meta.inputs[0].required, false);

  const review = host.querySelectorAll('.agent-ports-out .port-row')[0];
  assert.equal(review.querySelector('.pf-f-filename').hidden, false);
  review.querySelector('.pf-type').value = 'void';
  change(window, review.querySelector('.pf-type'));
  assert.equal(review.querySelector('.pf-f-filename').hidden, true, 'a void port carries no filename');
  assert.equal(review.querySelector('.pf-f-store').hidden, true);
  const out0 = api.agentFormRead(host).meta.outputs[0];
  assert.equal(out0.filename, undefined, 'and never emits one');
  assert.equal(out0.store, undefined);
});

test('hints mirror the store rules and appear/disappear live, without blocking', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const hints = () => [...host.querySelectorAll('.pf-hint')].map((h) => h.textContent).join('\n');
  // A reserved id, live.
  const plan = host.querySelectorAll('.agent-ports-in .port-row')[0];
  plan.querySelector('.pf-id').value = 'await';
  change(window, plan.querySelector('.pf-id'));
  assert.match(hints(), /port id "await" is reserved/);
  plan.querySelector('.pf-id').value = 'Plan Two';
  change(window, plan.querySelector('.pf-id'));
  assert.match(hints(), /bad port id "Plan Two"/);
  plan.querySelector('.pf-id').value = 'plan';
  change(window, plan.querySelector('.pf-id'));
  assert.doesNotMatch(hints(), /await|bad port id/);
  // expands on a non-json input.
  plan.querySelector('.pf-expands').checked = true;
  change(window, plan.querySelector('.pf-expands'));
  assert.match(hints(), /expands is only legal on json inputs/);
  // Verifier without a verdict filename.
  host.querySelector('.agent-f-verdict').value = '';
  change(window, host.querySelector('.agent-f-verdict'));
  assert.match(hints(), /runnerType "verifier" requires verdict/);
  assert.match(hints(), /when "blocking" requires the agent to declare verdict/);
  // Clarifier obligation.
  host.querySelector('.agent-f-runner').value = 'clarifier';
  change(window, host.querySelector('.agent-f-runner'));
  assert.match(hints(), /runnerType "clarifier" requires at least one json output port/);
  // Hints NEVER block: no control is disabled by one, and read-back still works.
  assert.equal(host.querySelector('.pf-add-in').disabled, false);
  assert.equal(host.querySelector('.pf-add-out').disabled, false);
  assert.equal(api.agentFormRead(host).meta.runnerType, 'clarifier');
});

test('a duplicate id and an over-long id are hinted per side', async () => {
  const { window, host, api } = await boot();
  api.agentFormRender(host, META, { mockWriterRoles: MOCK_ROLES });
  const [plan, fix] = host.querySelectorAll('.agent-ports-in .port-row');
  fix.querySelector('.pf-id').value = 'plan';
  change(window, fix.querySelector('.pf-id'));
  const hints = [...host.querySelectorAll('.pf-hint')].map((h) => h.textContent).join('\n');
  assert.match(hints, /duplicate port id "plan"/);
  void plan; void api;
});
```

`Expected: FAIL — "TypeError: api.agentFormRender is not a function"`

- [ ] Step 2: Implement the markup. `ui/public/index.html` — replace lines 842-876 (everything between `<div class="agent-edit-pane" hidden>` and the `<p class="agent-edit-msg">` at `:877`) with exactly:
```html
                  <div class="agent-form"></div>
```
and replace lines 1025-1047 in `#agw-step-3` (everything between the opening `<div class="wiz-step hidden" id="agw-step-3">` and `<p id="agw-msg" …>` at `:1048`) with exactly:
```html
              <div class="agent-form"></div>
```
Nothing else in either block moves: the Cancel/Save actions, `#agw-msg`, `#agw-regen` and `#agw-save` stay put.
- [ ] Step 3: Implement the form. In `ui/public/app.js`, replace `syncQuestionFlags` (`:6759-6768`), `agentFormFill` (`:6770-6810`) and `agentFormRead` (`:6812-6833`) with the block below (`refreshAgentForm` absorbs the questions-flag mirroring); keep `buildChipChecks` (`:6740-6753`) and `chipValues` (`:6755`). Everything here is DOM-built (`.value`/`textContent` only, never `innerHTML`).

```js
// ---- Shared agent metadata form (card editor AND wizard Step 3) --------------
// The form emits a meta v2 SIDECAR and nothing else. It never blocks a save:
// every rule below is a live .pf-hint mirroring the store's 400 text, and the
// PUT/POST always goes out — the server owns the verdict (spec §9).
const PORT_TYPES = ['md', 'json', 'void'];
const PORT_AS = ['file', 'answers', 'fix-review', 'worktree'];
const OUTPUT_WHENS = ['always', 'blocking', 'clean'];
const PORT_STORES = ['run', 'project'];
const RUNNER_TYPES = ['producer', 'verifier', 'clarifier'];
const AGENT_COLORS = ['green', 'peach', 'red', 'blue', 'violet', 'amber'];
const AGENT_SCOPES = ['project', 'workspace-only'];
const WORKSPACE_STRATEGIES = ['explore', 'task', 'review'];
const MAX_PORTS_PER_SIDE = 8;
const PORT_ID_RE = /^[a-z][A-Za-z0-9]{0,31}$/;
const PORT_OWN_KEYS = ['id', 'type', 'required', 'loop', 'expands', 'as', 'directive', 'when', 'filename', 'store'];
const AGENT_OWN_KEYS = [
  'key', 'displayName', 'description', 'color', 'runnerType', 'order', 'domain', 'scope', 'icon',
  'fanOut', 'asksQuestions', 'questionsLocked', 'questionsDefault', 'inputs', 'outputs', 'verdict',
  'sideEffect', 'mockRole', 'wantsRequest', 'workspaceFanOut', 'workspaceStrategy',
  'workspaceVariantOf', 'placeable', 'requiresSkills', 'promptHints', 'metaVersion',
  // computed by the registry, never authored back into a sidecar
  'origin', 'agentPath', 'agentFile', 'descriptionDerived', 'portSummary',
];
/** The port type each `as` renderer demands ("file" takes md or json — a void
 *  payload has nothing to render, so it names md in the hint). */
const AS_TYPE = { file: 'md', answers: 'json', 'fix-review': 'md', worktree: 'void' };

/** The `.agent-form` host inside a pane (or the pane itself when it IS one). */
const formHost = (root) => root.querySelector('.agent-form') || root;

function fmField(labelText, control, cls) {
  const wrap = document.createElement('div');
  wrap.className = `field${cls ? ` ${cls}` : ''}`;
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.append(label, control);
  return wrap;
}
function fmInput(cls, value, { type = 'text', placeholder = '' } = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.className = `${cls} input`;
  input.spellcheck = false;
  input.value = value == null ? '' : String(value);
  if (placeholder) input.placeholder = placeholder;
  return input;
}
function fmSelect(cls, options, value) {
  const sel = document.createElement('select');
  sel.className = `${cls} select`;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = typeof opt === 'string' ? opt : opt.value;
    o.textContent = typeof opt === 'string' ? opt : opt.text;
    sel.appendChild(o);
  }
  sel.value = value == null ? '' : String(value);
  return sel;
}
function fmCheck(cls, labelText, checked) {
  const label = document.createElement('label');
  label.className = 'fanout-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = cls;
  cb.checked = Boolean(checked);
  const txt = document.createElement('span');
  txt.textContent = labelText;
  label.append(cb, txt);
  return label;
}
function fmHint(cls) {
  const el = document.createElement('small');
  el.className = `pf-hint hint err ${cls}`.trim();
  el.hidden = true;
  return el;
}
function fmMini(cls, text, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${cls} btn-ghost btn-mini`;
  b.textContent = text;
  if (title) b.title = title;
  return b;
}

/** One port row. `side` is 'in' | 'out'; the two sides carry different fields. */
function buildPortRow(side, port) {
  const p = port || {};
  const row = document.createElement('div');
  row.className = `port-row port-row-${side}`;
  // Unsurfaced sidecar keys (label, description, artifactKind, anything a newer
  // worca ships) ride ALONG so a save can never silently drop them.
  const extra = {};
  for (const [k, v] of Object.entries(p)) if (!PORT_OWN_KEYS.includes(k)) extra[k] = v;
  if (Object.keys(extra).length) row.dataset.extra = JSON.stringify(extra);

  const top = document.createElement('div');
  top.className = 'port-row-top';
  top.append(
    fmField('id', fmInput('pf-id', p.id, { placeholder: 'portId' }), 'pf-f-id'),
    fmField('type', fmSelect('pf-type', PORT_TYPES, p.type || 'md'), 'pf-f-type'),
  );
  if (side === 'in') {
    top.append(fmField('as', fmSelect('pf-as', PORT_AS, p.as || 'file'), 'pf-f-as'));
  } else {
    top.append(
      fmField('when', fmSelect('pf-when', OUTPUT_WHENS, p.when || 'always'), 'pf-f-when'),
      fmField('filename', fmInput('pf-filename', p.filename, { placeholder: '{base}.md' }), 'pf-f-filename'),
      fmField('store', fmSelect('pf-store', PORT_STORES, p.store || 'run'), 'pf-f-store'),
    );
  }
  top.append(
    fmMini('pf-up', '▲', 'Move this port up'),
    fmMini('pf-down', '▼', 'Move this port down'),
    fmMini('pf-remove', '×', 'Remove this port'),
  );
  row.appendChild(top);

  if (side === 'in') {
    const flags = document.createElement('div');
    flags.className = 'port-row-flags';
    // loop coerces required:false in the registry — mirror it so the form never
    // shows a state the store would rewrite under the user.
    flags.append(
      fmCheck('pf-required', 'required', p.required !== false && !p.loop),
      fmCheck('pf-loop', 'loop', p.loop === true),
      fmCheck('pf-expands', 'expands', p.expands === true),
      fmMini('pf-directive-toggle', p.directive ? 'directive ✓' : 'directive', 'Prompt text injected when this port fires'),
    );
    row.appendChild(flags);
    const dirWrap = document.createElement('div');
    dirWrap.className = 'pf-directive-wrap';
    dirWrap.hidden = true;
    const dir = document.createElement('textarea');
    dir.className = 'pf-directive textarea';
    dir.rows = 4;
    dir.spellcheck = false;
    dir.placeholder = 'Markdown appended to the task prompt when this port fires ({path} substituted)';
    dir.value = p.directive || '';
    dirWrap.appendChild(dir);
    row.appendChild(dirWrap);
  }
  row.appendChild(fmHint('pf-hint-row'));
  syncPortRow(row);
  return row;
}

/** Per-row mirroring of the coercions the registry applies anyway. */
function syncPortRow(row) {
  const loop = row.querySelector('.pf-loop');
  const required = row.querySelector('.pf-required');
  if (loop && required) {
    required.disabled = loop.checked;
    if (loop.checked) required.checked = false;
  }
  const type = row.querySelector('.pf-type').value;
  // A void port carries no payload: hide the two fields the store would 400 on.
  for (const cls of ['.pf-f-filename', '.pf-f-store']) {
    const f = row.querySelector(cls);
    if (f) f.hidden = type === 'void';
  }
}
```

```js
/** One ports section (head + list + the section-level hint). */
function buildPortsSection(side, ports) {
  const sec = document.createElement('div');
  sec.className = `agent-ports agent-ports-${side}`;
  const head = document.createElement('div');
  head.className = 'agent-ports-head';
  const title = document.createElement('b');
  title.textContent = side === 'in' ? 'INPUTS' : 'OUTPUTS';
  const count = document.createElement('span');
  count.className = 'pf-count hint';
  const add = fmMini(`pf-add-${side}`, side === 'in' ? '+ input' : '+ output');
  head.append(title, add, count);
  sec.appendChild(head);
  const list = document.createElement('div');
  list.className = 'agent-ports-list';
  for (const p of Array.isArray(ports) ? ports : []) {
    // The synthesized `await` gate is engine surface, never editable — and the
    // registry never ships it on a sidecar, so this filter is belt-and-braces.
    if (p && (p.synthetic || p.id === 'await')) continue;
    list.appendChild(buildPortRow(side, p));
  }
  sec.append(list, fmHint('pf-hint-side'));
  return sec;
}

/** Rebuild every hint + the two counters from the form's CURRENT state. */
function refreshAgentForm(host) {
  const setHint = (el, text) => { el.textContent = text; el.hidden = !text; };
  const runner = host.querySelector('.agent-f-runner').value;
  const verdict = host.querySelector('.agent-f-verdict').value.trim();
  const agentMsgs = [];
  if (runner === 'verifier' && !verdict) agentMsgs.push('runnerType "verifier" requires verdict: { filename }');
  for (const side of ['in', 'out']) {
    const sec = host.querySelector(`.agent-ports-${side}`);
    const rows = [...sec.querySelectorAll('.port-row')];
    const label = side === 'in' ? 'inputs' : 'outputs';
    sec.querySelector('.pf-count').textContent = `(${rows.length}/${MAX_PORTS_PER_SIDE})`;
    sec.querySelector(`.pf-add-${side}`).disabled = rows.length >= MAX_PORTS_PER_SIDE;
    const seen = new Map();
    const sideMsgs = [];
    for (const row of rows) {
      syncPortRow(row);
      const id = row.querySelector('.pf-id').value.trim();
      const type = row.querySelector('.pf-type').value;
      const msgs = [];
      if (id === 'await') {
        msgs.push(`${label}: port id "await" is reserved — the engine synthesizes the await gate port on every agent node`);
      } else if (id && !PORT_ID_RE.test(id)) {
        msgs.push(`${label}: bad port id "${id}"`);
      }
      if (id) {
        if (seen.has(id)) sideMsgs.push(`${label}: duplicate port id "${id}"`);
        seen.set(id, true);
      }
      if (side === 'in') {
        if (row.querySelector('.pf-expands').checked && type !== 'json') {
          msgs.push(`${label}.${id}: expands is only legal on json inputs`);
        }
        const as = row.querySelector('.pf-as').value;
        if (as && AS_TYPE[as] && AS_TYPE[as] !== type && !(as === 'file' && type === 'json')) {
          msgs.push(`${label}.${id}: as "${as}" requires a ${AS_TYPE[as]} port (got ${type})`);
        }
        if (row.querySelector('.pf-loop').checked) {
          msgs.push('loop inputs are optional; a fresh token on this port re-fires the agent');
        }
      } else {
        const when = row.querySelector('.pf-when').value;
        if (when !== 'always' && !verdict) {
          msgs.push(`${label}.${id}: when "${when}" requires the agent to declare verdict: { filename }`);
        } else if (when !== 'always') {
          msgs.push('"blocking"/"clean" branch on the verdict file above');
        }
        if (type !== 'void' && !row.querySelector('.pf-filename').value.trim()) {
          msgs.push(`${label}.${id}: ${type} outputs require a filename template`);
        }
      }
      setHint(row.querySelector('.pf-hint-row'), msgs.join(' · '));
    }
    if (side === 'out') {
      if (!rows.length) sideMsgs.push('at least one output port is required');
      if (runner === 'clarifier' && !rows.some((r) => r.querySelector('.pf-type').value === 'json')) {
        agentMsgs.push('runnerType "clarifier" requires at least one json output port');
      }
    }
    setHint(sec.querySelector('.pf-hint-side'), sideMsgs.join(' · '));
  }
  setHint(host.querySelector('.pf-hint-agent'), agentMsgs.join(' · '));
  // The two questions sub-flags are meaningless (and normalizeMeta force-clears
  // them) when the agent cannot ask; mirror that.
  const asks = host.querySelector('.agent-f-questions');
  for (const cls of ['.agent-f-questions-locked', '.agent-f-questions-default']) {
    const cb = host.querySelector(cls);
    cb.disabled = !asks.checked;
    if (!asks.checked) cb.checked = false;
  }
}

/**
 * Build the whole v2 form under `host` from `meta`.
 * @param {HTMLElement} host  a .agent-form element (or a container holding one)
 * @param {object} meta       a v2 sidecar (registry-normalized or a gen draft)
 * @param {{markdown?: string, mockWriterRoles?: string[], registryKeys?: string[]}} [opts]
 */
function agentFormRender(host, meta, opts = {}) {
  const root = formHost(host);
  const m = meta || {};
  const roles = Array.isArray(opts.mockWriterRoles) ? opts.mockWriterRoles : state.mockWriterRoles;
  const keys = Array.isArray(opts.registryKeys) ? opts.registryKeys : state.agentsList.map((a) => a.key);
  root.dataset.agentKey = m.key || '';
  const extra = {};
  for (const [k, v] of Object.entries(m)) if (!AGENT_OWN_KEYS.includes(k)) extra[k] = v;
  root.dataset.extra = JSON.stringify(extra);

  const frag = document.createDocumentFragment();
  frag.appendChild(fmField('Display name', fmInput('agent-f-name', m.displayName)));
  // A description resolved from the .md frontmatter is computed, not authored:
  // show it as a placeholder, never as a value — pre-filling it would PUT it
  // straight back and freeze the fallback into the sidecar.
  const desc = fmInput('agent-f-desc', m.descriptionDerived ? '' : (m.description || ''));
  if (m.descriptionDerived) desc.placeholder = m.description || '';
  frag.appendChild(fmField('Description', desc));

  const row1 = document.createElement('div');
  row1.className = 'row-2';
  row1.append(
    fmField('Color', fmSelect('agent-f-color', AGENT_COLORS, m.color || 'amber')),
    fmField('Runner type', fmSelect('agent-f-runner', RUNNER_TYPES, m.runnerType || 'producer')),
  );
  const row2 = document.createElement('div');
  row2.className = 'row-2';
  row2.append(
    fmField('Order', fmInput('agent-f-order', m.order != null ? m.order : 99, { type: 'number' })),
    fmField('Verdict filename', fmInput('agent-f-verdict', (m.verdict && m.verdict.filename) || '', {
      placeholder: 'required for verifiers, e.g. review-cycle{cycle}.json',
    })),
  );
  const row3 = document.createElement('div');
  row3.className = 'row-3';
  row3.append(
    fmField('Domain', fmInput('agent-f-domain', m.domain || '', { placeholder: 'general' })),
    fmField('Scope', fmSelect('agent-f-scope', AGENT_SCOPES, m.scope || 'project')),
    fmField('Icon (SVG path)', fmInput('agent-f-icon', m.icon || '', { placeholder: '<path d="…"/>' })),
  );
  frag.append(row1, row2, row3, fmHint('pf-hint-agent'));
  frag.append(buildPortsSection('in', m.inputs), buildPortsSection('out', m.outputs));

  const caps = document.createElement('div');
  caps.className = 'field agent-caps';
  const capsLabel = document.createElement('label');
  capsLabel.textContent = 'Capabilities';
  caps.append(
    capsLabel,
    fmCheck('agent-f-fanout', 'Research fan-out', m.fanOut),
    fmCheck('agent-f-questions', 'Asks questions', m.asksQuestions),
    fmCheck('agent-f-questions-locked', 'Questions locked', m.questionsLocked),
    fmCheck('agent-f-questions-default', 'Questions on by default', m.questionsDefault),
    fmCheck('agent-f-sideeffect', 'Writes code (sideEffect)', m.sideEffect === 'code'),
    fmCheck('agent-f-wantsrequest', 'Carries the original request', m.wantsRequest === true),
    fmCheck('agent-f-placeable', 'Placeable on a canvas', m.placeable !== false),
  );
  frag.appendChild(caps);

  const row4 = document.createElement('div');
  row4.className = 'row-2';
  row4.append(
    fmField('Mock role', fmSelect('agent-f-mockrole', [{ value: '', text: 'auto' }, ...roles.map((r) => ({ value: r, text: r }))], m.mockRole || '')),
    fmField('Requires skills', fmInput('agent-f-skills', (m.requiresSkills || []).join(', '), { placeholder: 'skill-one, skill-two' })),
  );
  const hints = document.createElement('textarea');
  hints.className = 'agent-f-hints textarea';
  hints.rows = 3;
  hints.spellcheck = false;
  hints.value = m.promptHints || '';
  frag.append(row4, fmField('Prompt hints', hints));

  const ws = document.createElement('div');
  ws.className = 'field agent-workspace';
  const wsLabel = document.createElement('label');
  wsLabel.textContent = 'Workspace runs';
  const variant = fmInput('agent-f-ws-variantof', m.workspaceVariantOf || '', { placeholder: 'agent key' });
  variant.setAttribute('list', 'agent-f-ws-keys');
  const datalist = document.createElement('datalist');
  datalist.id = 'agent-f-ws-keys';
  for (const k of keys) {
    const o = document.createElement('option');
    o.value = k;
    datalist.appendChild(o);
  }
  const wsRow = document.createElement('div');
  wsRow.className = 'row-2';
  wsRow.append(
    fmField('Strategy', fmSelect('agent-f-ws-strategy', ['', ...WORKSPACE_STRATEGIES], m.workspaceStrategy || '')),
    fmField('Variant of', variant),
  );
  ws.append(wsLabel, fmCheck('agent-f-ws-fanout', 'Force fan-out on workspace runs', m.workspaceFanOut === true), wsRow, datalist);
  frag.appendChild(ws);

  const md = document.createElement('textarea');
  md.className = 'agent-f-md textarea';
  md.rows = 16;
  md.spellcheck = false;
  md.value = typeof opts.markdown === 'string' ? opts.markdown : '';
  frag.appendChild(fmField('System prompt (markdown)', md));

  root.replaceChildren(frag);
  refreshAgentForm(root);
  bindAgentForm(root);
}
```

```js
/** ONE delegated click + one change listener per host — rows come and go. */
function bindAgentForm(host) {
  if (host.dataset.bound === '1') return;
  host.dataset.bound = '1';
  host.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const add = t.closest('.pf-add-in, .pf-add-out');
    if (add) {
      if (add.disabled) return;
      const side = add.classList.contains('pf-add-in') ? 'in' : 'out';
      host.querySelector(`.agent-ports-${side} .agent-ports-list`).appendChild(buildPortRow(side, null));
      refreshAgentForm(host);
      return;
    }
    const row = t.closest('.port-row');
    if (!row) return;
    if (t.closest('.pf-remove')) { row.remove(); refreshAgentForm(host); return; }
    if (t.closest('.pf-up')) {
      if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      refreshAgentForm(host);
      return;
    }
    if (t.closest('.pf-down')) {
      if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      refreshAgentForm(host);
      return;
    }
    if (t.closest('.pf-directive-toggle')) {
      const wrap = row.querySelector('.pf-directive-wrap');
      wrap.hidden = !wrap.hidden;
    }
  });
  // One handler for every field: the hint set is a pure function of the form.
  host.addEventListener('change', () => refreshAgentForm(host));
  // `change` on a text input only fires on blur; the id/filename/verdict hints
  // must track typing, so mirror it on input.
  host.addEventListener('input', (ev) => {
    if (ev.target && ev.target.matches && ev.target.matches('.pf-id, .pf-filename, .agent-f-verdict')) {
      refreshAgentForm(host);
    }
  });
}

function readPortRow(row, side) {
  const extra = row.dataset.extra ? JSON.parse(row.dataset.extra) : {};
  const type = row.querySelector('.pf-type').value;
  const port = { ...extra, id: row.querySelector('.pf-id').value.trim(), type };
  if (side === 'in') {
    const loop = row.querySelector('.pf-loop').checked;
    port.required = loop ? false : row.querySelector('.pf-required').checked; // loop implies optional
    if (loop) port.loop = true;
    if (row.querySelector('.pf-expands').checked) port.expands = true;
    const as = row.querySelector('.pf-as').value;
    if (as) port.as = as;
    const directive = row.querySelector('.pf-directive').value;
    if (directive.trim()) port.directive = directive;
  } else {
    port.when = row.querySelector('.pf-when').value;
    // A void port carries no payload — the store 400s on either field.
    if (type !== 'void') {
      const filename = row.querySelector('.pf-filename').value.trim();
      if (filename) port.filename = filename;
      port.store = row.querySelector('.pf-store').value;
    }
  }
  return port;
}

/** Read the form back into { meta, markdown } — a v2 sidecar, nothing else. */
function agentFormRead(host) {
  const root = formHost(host);
  const extra = root.dataset.extra ? JSON.parse(root.dataset.extra) : {};
  const val = (cls) => root.querySelector(`.${cls}`).value;
  const on = (cls) => root.querySelector(`.${cls}`).checked;
  const meta = {
    ...extra,
    metaVersion: 2,
    displayName: val('agent-f-name').trim(),
    description: val('agent-f-desc').trim(),
    color: val('agent-f-color'),
    runnerType: val('agent-f-runner'),
    order: Number(val('agent-f-order')),
    fanOut: on('agent-f-fanout'),
    asksQuestions: on('agent-f-questions'),
    questionsLocked: on('agent-f-questions-locked'),
    questionsDefault: on('agent-f-questions-default'),
    inputs: [...root.querySelectorAll('.agent-ports-in .port-row')].map((r) => readPortRow(r, 'in')),
    outputs: [...root.querySelectorAll('.agent-ports-out .port-row')].map((r) => readPortRow(r, 'out')),
  };
  if (root.dataset.agentKey) meta.key = root.dataset.agentKey;
  // Everything below is OPTIONAL: absent when off, never `false`/`''`. The
  // schema reads presence, and an explicit falsy value is a different (invalid)
  // thing — `placeable: false` is the one value worth writing.
  const verdict = val('agent-f-verdict').trim();
  if (verdict) meta.verdict = { filename: verdict };
  const domain = val('agent-f-domain').trim();
  if (domain) meta.domain = domain;
  if (val('agent-f-scope') === 'workspace-only') meta.scope = 'workspace-only';
  const icon = val('agent-f-icon').trim();
  if (icon) meta.icon = icon;
  if (on('agent-f-sideeffect')) meta.sideEffect = 'code';
  const mockRole = val('agent-f-mockrole');
  if (mockRole) meta.mockRole = mockRole;
  if (on('agent-f-wantsrequest')) meta.wantsRequest = true;
  if (on('agent-f-ws-fanout')) meta.workspaceFanOut = true;
  const strategy = val('agent-f-ws-strategy');
  if (strategy) meta.workspaceStrategy = strategy;
  const variantOf = val('agent-f-ws-variantof').trim();
  if (variantOf) meta.workspaceVariantOf = variantOf;
  const skills = val('agent-f-skills').split(',').map((s) => s.trim()).filter(Boolean);
  if (skills.length) meta.requiresSkills = skills;
  const promptHints = val('agent-f-hints');
  if (promptHints.trim()) meta.promptHints = promptHints;
  if (!on('agent-f-placeable')) meta.placeable = false;
  return { meta, markdown: root.querySelector('.agent-f-md').value };
}
```
Export the three on the test hook (`app.js:6893`):
```js
  window.__agents = { loadAgentsList, loadAgentsView, renderAgentsList, buildAgentCard, deleteAgentCard,
    duplicateAgentCard, agentFormRender, agentFormRead, bindAgentForm, openAgentEdit };
```
- [ ] Step 4: CSS — append to the Agents-view block in `ui/public/style.css` (after `:1394`), adapted from the discarded branch's `style.css:1057-1071` (its `.pf-f-*` field-wrapper selectors are kept; `.row-3` is new here because dev has no three-column row):
```css
/* ---------- Agents-view port editor ---------- */
.row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.agent-ports{margin-bottom:16px;}
.agent-ports-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.agent-ports-head b{font-size:12.5px;font-weight:600;letter-spacing:.06em;}
.agent-ports-head .pf-count{margin-left:auto;font-size:11px;}
.agent-ports-list{display:flex;flex-direction:column;gap:9px;}
.port-row{border:1px solid var(--line-2);border-radius:12px;padding:10px 12px;background:var(--panel);}
.port-row-top{display:flex;align-items:flex-end;gap:9px;}
.port-row-top .field{margin:0;flex:1 1 0;min-width:0;}
.port-row-top .pf-f-type,.port-row-top .pf-f-as,.port-row-top .pf-f-when,.port-row-top .pf-f-store{flex:0 0 104px;}
.port-row-top .field label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px;}
.port-row-top .field[hidden]{display:none;}
.port-row-flags{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:9px;}
.pf-up,.pf-down,.pf-remove{flex:0 0 auto;font-size:13px;line-height:1;padding:8px 10px;}
.pf-directive-wrap{margin-top:9px;}
.pf-directive-wrap[hidden]{display:none;}
.pf-hint{display:block;margin-top:6px;font-size:11px;}
.pf-hint[hidden]{display:none;}
.agent-caps,.agent-workspace{display:flex;flex-direction:column;gap:2px;}
```

`Expected: PASS — node --test test/ui-agent-port-editor.test.mjs → 6 tests pass`
- [ ] Step 5: Commit — `worca: Node-graph v2 P7 — agent port editor form`

---

### Task 11: wire the form into the card editor and the wizard

**Files:** modify `ui/public/app.js:6835-6849` (`openAgentEdit`), `:6850-6869` (`saveAgentEdit`), `:7318-7325` (`onAgentGenEvent`'s `agentgen-done` arm), `:7336-7337` (`saveGeneratedAgent`); modify `test/ui-agent-editor.test.mjs`, `test/ui-agent-wizard.test.mjs:75-117`.
**Interfaces produced:** none new — the two call sites now speak `agentFormRender`/`agentFormRead`.

- [ ] Step 1: Write the failing tests. In `test/ui-agent-editor.test.mjs`, swap `AGENTS`/`CHANNELS` for the v2 fixture + `mockWriterRoles` (same shape as Task 9), make the `/api/agents/:key` stub return a v2 `meta`, keep tests 1, 3 and 4, and REPLACE the custom-channel test at `:99-126` with:

```js
test('the pane renders typed ports and PUTs exactly what the form read back', async () => {
  const puts = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/agents/docsWriter') && opts.method === 'PUT') {
      puts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: { key: 'docsWriter' } }) });
    }
    return null;
  } });
  await goAgents(window);
  const card = window.document.querySelectorAll('.agent-card')[1];
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  const pane = card.querySelector('.agent-edit-pane');
  assert.equal(pane.hidden, false);
  const form = pane.querySelector('.agent-form');
  assert.ok(form, 'the pane hosts the shared form');
  assert.deepEqual([...form.querySelectorAll('.agent-ports-out .port-row .pf-id')].map((i) => i.value), ['review', 'pass']);
  // Add an input, then save.
  click(window, form.querySelector('.pf-add-in'));
  form.querySelector('.agent-ports-in .port-row:last-child .pf-id').value = 'extra';
  click(window, pane.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].meta.metaVersion, 2);
  assert.deepEqual(puts[0].meta.inputs.map((p) => p.id), ['plan', 'extra']);
  assert.equal(puts[0].meta.consumes, undefined, 'no channel fields are ever PUT');
  assert.equal('markdown' in puts[0], true);
});
```
and rewrite test 4 so the 400 body is a real store rule text:
```js
test('a 400 on save keeps the pane open and surfaces the store rule VERBATIM', async () => {
  const rule = 'outputs.review: md outputs require a filename template';
  const { window } = await boot({ fetchHandler: (u, opts) => (u.includes('/api/agents/docsWriter') && opts.method === 'PUT'
    ? Promise.resolve({ ok: false, status: 400, json: async () => ({ error: rule }) })
    : null) });
  await goAgents(window);
  const card = window.document.querySelectorAll('.agent-card')[1];
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  const pane = card.querySelector('.agent-edit-pane');
  click(window, pane.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pane.hidden, false, 'the pane stays open on a rejection');
  assert.equal(pane.querySelector('.agent-edit-msg').textContent, rule, 'verbatim — never re-worded');
  assert.ok(pane.querySelector('.agent-edit-msg').className.includes('err'));
});
```

In `test/ui-agent-wizard.test.mjs`, the Step-3 draft in the `agentgen-done` payload (`:75-117`) becomes a v2 meta, and the Step-3 assertions read ports:
```js
  ws().deliver({ type: 'agentgen-done', genId: 'agen_1', draft: {
    meta: { metaVersion: 2, key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs',
      runnerType: 'producer', order: 99, inputs: [{ id: 'plan', type: 'md' }],
      outputs: [{ id: 'review', type: 'md', filename: 'review-{cycle}.md' }] },
    markdown: '# Docs Writer\n\nbody\n',
  } });
  …
  const step3 = window.document.getElementById('agw-step-3');
  assert.equal(step3.querySelector('.agent-f-name').value, 'Docs Writer');
  assert.deepEqual([...step3.querySelectorAll('.agent-ports-in .pf-id')].map((i) => i.value), ['plan']);
  assert.equal(step3.querySelector('.agent-f-md').value, '# Docs Writer\n\nbody\n');
```
and the Step-3 Save test (`:118-156`) asserts the POSTed meta is v2 (`metaVersion === 2`, `outputs[0].filename === 'review-{cycle}.md'`).

`Expected: FAIL — "AssertionError: the pane hosts the shared form" (agentFormFill no longer exists / the pane is empty)`
- [ ] Step 2: Implement. `openAgentEdit` (`:6835-6849`) — the `.agent-f-connect-any` wiring goes with the chip pickers:
```js
async function openAgentEdit(card, a) {
  const detail = card.querySelector('.agent-detail');
  const head = card.querySelector('.agent-head');
  if (detail.hidden) { detail.hidden = false; head.setAttribute('aria-expanded', 'true'); }
  const full = await fetchAgentFull(a.key);
  if (!full) { setAgentsMsg('Could not load the agent.', 'err'); return; }
  const pane = card.querySelector('.agent-edit-pane');
  agentFormRender(pane, full.meta, {
    markdown: full.markdown,
    mockWriterRoles: state.mockWriterRoles,
    registryKeys: state.agentsList.map((x) => x.key).filter((k) => k !== a.key),
  });
  pane.hidden = false;
  pane.querySelector('.agent-edit-cancel').onclick = () => { pane.hidden = true; };
  pane.querySelector('.agent-edit-save').onclick = () => saveAgentEdit(card, a, pane);
}
```
`saveAgentEdit` (`:6853`) changes one line: `const body = agentFormRead(pane);`. The 400 arm at `:6862` is UNCHANGED — it already renders `data.error` verbatim, which is exactly the contract.

`onAgentGenEvent`'s done arm (`:7318-7323`):
```js
    const root = document.getElementById('agw-step-3');
    if (root && msg.draft) {
      agentFormRender(root, msg.draft.meta || {}, {
        markdown: msg.draft.markdown || '',
        mockWriterRoles: state.mockWriterRoles,
        registryKeys: state.agentsList.map((a) => a.key),
      });
    }
    showAgentWizardStep(3);
```
`saveGeneratedAgent` (`:7337`) changes one line: `const { meta, markdown } = agentFormRead(root);`.

`Expected: PASS — node --test test/ui-agent-editor.test.mjs test/ui-agent-wizard.test.mjs test/ui-agents-view.test.mjs test/ui-agent-xss.test.mjs test/ui-nav-sections.test.mjs → all pass`
- [ ] Step 3: Grep for stragglers — `grep -n "agentFormFill\|state.channelIds\|agent-f-consumes\|agent-f-produces\|agent-f-optional\|agent-f-connect\|agent-f-loopsource" ui/public/app.js ui/public/index.html test/*.mjs` must return NOTHING outside the composer's own code. Fix whatever it finds.
- [ ] Step 4: Commit — `worca: Node-graph v2 P7 — port editor drives the card pane and the wizard`

---

### Task 12: the store validates meta v2, and the delete guard walks graphs

**Files:** modify `src/core/agent-store.mjs:9` (import), `:54-74` (`createAgent`), `:77-115` (`updateAgent`), `:118-143` (`deleteAgent`); modify `test/agent-store.test.mjs`.
**Interfaces produced:** `createAgent`/`updateAgent` throw `BAD_REQUEST` with the rule text before anything is written; `deleteAgent` also refuses while a v2 graph or a `workspaceVariantOf` points at the key.

**The rule texts** (verbatim from `validateMetaV2`; they ARE the store's 400 bodies and the editor's hints — do not re-word):
```
sidecar requires metaVersion 2
key "<k>" is not a valid agent key
runnerType must be one of producer, verifier, clarifier
at least one output port is required
inputs: at most 8 ports per side (got N)
inputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node
inputs: bad port id "<id>"
inputs: duplicate port id "<id>"
outputs.<id>: type must be one of md, json, void
outputs.<id>: void ports carry no filename or store
outputs.<id>: md outputs require a filename template
outputs.<id>: filename "<f>" must be a plain basename
outputs.<id>: filename "<f>" uses unknown token(s) {x}
outputs.<id>: when "blocking" requires the agent to declare verdict: { filename }
outputs: filename template "<f>" is shared by ports of different types
inputs.<id>: expands is only legal on json inputs
inputs.<id>: as "<as>" requires a <type> port (got <t>)
runnerType "verifier" requires verdict: { filename }
runnerType "clarifier" requires at least one json output port
sideEffect must be "code" when present
workspaceStrategy must be one of explore, task, review
workspaceVariantOf must be an agent key
workspaceVariantOf must not reference the agent itself
workspaceVariantOf requires scope "workspace-only"
```
An unknown `mockRole` is a WARNING (dropped by the registry), never a 400.

- [ ] Step 1: Write the failing tests. In `test/agent-store.test.mjs`, convert `META` (`:16-19`) to v2 and append the gate tests:

```js
const META = {
  metaVersion: 2, displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'docs-review.md' }],
};

test('createAgent 400s with the meta v2 rule text, one rule per broken field', async () => {
  const cases = [
    [{ ...META, metaVersion: undefined, displayName: 'No Version' }, /sidecar requires metaVersion 2/],
    [{ ...META, displayName: 'No Out', outputs: [] }, /at least one output port is required/],
    [{ ...META, displayName: 'Await In', inputs: [{ id: 'await', type: 'md' }] },
      /port id "await" is reserved — the engine synthesizes the await gate port on every agent node/],
    [{ ...META, displayName: 'Bad Id', inputs: [{ id: 'Plan Two', type: 'md' }] }, /bad port id "Plan Two"/],
    [{ ...META, displayName: 'Dup Id', inputs: [{ id: 'plan', type: 'md' }, { id: 'plan', type: 'json' }] },
      /duplicate port id "plan"/],
    [{ ...META, displayName: 'Too Many', inputs: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, type: 'md' })) },
      /at most 8 ports per side \(got 9\)/],
    [{ ...META, displayName: 'No Name', outputs: [{ id: 'review', type: 'md' }] },
      /md outputs require a filename template/],
    [{ ...META, displayName: 'Pathy', outputs: [{ id: 'review', type: 'md', filename: 'sub/review.md' }] },
      /must be a plain basename/],
    [{ ...META, displayName: 'Void Store', outputs: [{ id: 'pass', type: 'void', store: 'run' }] },
      /void ports carry no filename or store/],
    [{ ...META, displayName: 'Verifier', runnerType: 'verifier' }, /runnerType "verifier" requires verdict: \{ filename \}/],
    [{ ...META, displayName: 'Clarifier', runnerType: 'clarifier' }, /runnerType "clarifier" requires at least one json output port/],
    [{ ...META, displayName: 'Blocking', outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'r.md' }] },
      /when "blocking" requires the agent to declare verdict: \{ filename \}/],
    [{ ...META, displayName: 'Expands', inputs: [{ id: 'plan', type: 'md', expands: true }] },
      /expands is only legal on json inputs/],
    [{ ...META, displayName: 'Side', sideEffect: 'yes' }, /sideEffect must be "code" when present/],
    [{ ...META, displayName: 'Strategy', workspaceStrategy: 'wander' }, /workspaceStrategy must be one of explore, task, review/],
    [{ ...META, displayName: 'Variant', workspaceVariantOf: 'reviewer' }, /workspaceVariantOf requires scope "workspace-only"/],
  ];
  for (const [meta, re] of cases) {
    await assert.rejects(() => createAgent({ meta, markdown: MD }), (e) => {
      assert.equal(e.code, 'BAD_REQUEST', `${meta.displayName}: wrong code ${e.code}`);
      assert.match(e.message, re);
      return true;
    }, `${meta.displayName} must be rejected`);
    assert.equal(await readAgent(keyFromName(meta.displayName)), null, 'nothing is written on a rejection');
  }
});

test('updateAgent applies the same gate, and a clean v2 meta still round-trips', async () => {
  await assert.rejects(
    () => updateAgent('docsWriter', { meta: { ...META, outputs: [] } }),
    (e) => e.code === 'BAD_REQUEST' && /at least one output port is required/.test(e.message));
  const kept = await readAgent('docsWriter');
  assert.deepEqual(kept.meta.outputs.map((p) => p.id), ['review'], 'the rejected save changed nothing');
  const upd = await updateAgent('docsWriter', {
    meta: { ...META, outputs: [{ id: 'review', type: 'md', filename: 'docs-review-v2.md' }] },
  });
  assert.equal(upd.meta.outputs[0].filename, 'docs-review-v2.md');
  assert.equal(upd.meta.metaVersion, 2);
});

test('an unknown mockRole is a warning, not a 400', async () => {
  const { meta } = await createAgent({
    meta: { ...META, displayName: 'Mocky', mockRole: 'no-such-role' }, markdown: MD,
  });
  assert.equal(meta.mockRole, undefined, 'dropped by the registry');
  await deleteAgent('mocky');
});

test('deleteAgent refuses while a v2 GRAPH or a workspace variant points at the key', async () => {
  await createAgent({ meta: { ...META, displayName: 'Used Agent' }, markdown: MD });
  await writeGraphWorkflow({
    id: 'wf_uses', name: 'Uses It', domain: 'general',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_a', kind: 'agent', key: 'usedAgent', x: 200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
      { id: 'w2', from: { node: 'n_a', port: 'review' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  await assert.rejects(() => deleteAgent('usedAgent'), (e) => e.code === 'REFERENCED' && /Uses It/.test(e.message));

  await createAgent({
    meta: { ...META, displayName: 'Variant Agent', scope: 'workspace-only', workspaceVariantOf: 'docsWriter' },
    markdown: MD,
  });
  await assert.rejects(() => deleteAgent('docsWriter'),
    (e) => e.code === 'REFERENCED' && /variantAgent/.test(e.message));
});
```
Import `writeGraphWorkflow` next to `writeWorkflow` (`:11`).

`Expected: FAIL — "AssertionError: No Version must be rejected" (createAgent accepts a v1 meta today)`
- [ ] Step 2: Implement. `src/core/agent-store.mjs:9` — add the gate import:
```js
import { validateMetaV2 } from '../shared/graph/agent-meta.mjs';
```
In `createAgent`, between the `agentFile`/`order` defaults and `normalizeMeta` (`:61-62`):
```js
  // The v2 gate runs BEFORE normalizeMeta: normalizeMeta is lossy by design
  // (fixed key set, silent coercions), so a broken sidecar would otherwise be
  // "fixed" into something the user never wrote. Every failed rule is named.
  const issues = validateMetaV2(raw).errors;
  if (issues.length) throw err(issues.join('; '), 'BAD_REQUEST');
  const meta = normalizeMeta(raw);
```
In `updateAgent`, the same two lines immediately before `const meta = normalizeMeta(raw);` (`:103`). (`raw` there is `{...existing, ...rawMeta}`, so a PUT that touches only `markdown` still validates the stored sidecar — that is intended: an agent that cannot pass the gate must not be silently re-saved.)

Extend `deleteAgent`'s reference scan (`:133-138`):
```js
  const wfs = await listWorkflows();
  const refs = wfs
    .filter((wf) => (wf.version === 2
      // v2 rows: only kind:'agent' nodes carry a key.
      ? (wf.nodes || []).some((n) => n && n.kind === 'agent' && n.key === key)
      // v1 rows are still live until the engine cut-over.
      : (wf.steps || []).some((col) => (col || []).some((n) => n && n.key === key))))
    .map((wf) => wf.name || wf.id);
  if (refs.length) {
    throw err(`agent "${key}" is used by saved workflow(s): ${refs.join(', ')} — delete or edit those first`, 'REFERENCED');
  }
  // A workspace variant substitutes for its target agent by KEY: deleting the
  // target would leave the variant pointing at nothing, and the substitution
  // would silently stop happening on workspace runs.
  const variants = Object.values(loadAgentRegistry())
    .filter((m) => m && m.workspaceVariantOf === key)
    .map((m) => m.key);
  if (variants.length) {
    throw err(`agent "${key}" is the workspace variant target of: ${variants.join(', ')} — delete or re-point those first`, 'REFERENCED');
  }
```

`Expected: PASS — node --test test/agent-store.test.mjs test/agents-api.test.mjs test/agents-questions-form.test.mjs test/agent-derived-description.test.mjs test/agent-registry-schema-v2.test.mjs → all pass`
- [ ] Step 3: Commit — `worca: Node-graph v2 P7 — agent-store gates meta v2 and guards graph references`

---

### Task 13: full suite, manual verification, handoff

- [ ] Step 1: `npm test 2>&1 | tail -8`. Expected total: **BASELINE + 33** new tests, zero failures. The 33 break down as: `plugin-manifest` +7 (2 helpers, 5 validate-dir), `plugin-agent-registry` +2, `plugin-workflows` +5 net (8 → 13), `plugins-view` +2, `plugin-store` +2, `agent-gen` +4, `agents-api` +0 (the "channels is the open-vocabulary union" test is DELETED and replaced 1:1 by the port-fields test), `ui-agents-view` +1, `ui-agent-port-editor` +6 (new file), `agent-store` +4. Recount as you go and reconcile before claiming green.
- [ ] Step 2: If a test outside this plan's blast radius fails, check it against the two known coexistence rules before touching it: (a) builtin/user v1 sidecars still load — only PLUGIN layers are gated; (b) v1 `steps` workflows are still listed and runnable — only the `deleteAgent` scan and `referencedPluginAgents` learned about graphs. `test/api-sources.test.mjs` has a known intermittent ENOTEMPTY teardown flake that fails the whole file — re-run it alone before blaming the diff.
- [ ] Step 3: Manual verification (server + browser; no CDP script is required by this plan):
  1. `npm start`, open the Agents view. Every card shows `key · runnerType — description` and typed port pills; `workspaceScanner` carries the amber `not placeable` badge; void pills are dashed; `planner`'s `revise` input shows `↺`.
  2. Duplicate a builtin → the copy appears under "Your agents" with Edit/Delete; Edit opens the port editor with its ports pre-filled.
  3. In the editor: add an input, reorder it with ▲/▼, tick `loop` (required greys out), switch an output to `void` (filename/store vanish), clear the verdict filename on a verifier — the hints appear live and Save is never disabled.
  4. Save with a deliberately broken port (id `await`) → the pane stays open and the message is the store's rule text, word for word.
  5. Create agent → wizard → Step 3 shows the same form over the generated draft; Save lands the agent.
  6. `worca plugin init demo-plugin --dir /tmp/demo-plugin && worca plugin validate /tmp/demo-plugin --strict` → `OK: demo-plugin`; `worca plugin link /tmp/demo-plugin` → its agent appears in the registry and its example flow in the pipeline list.
  7. Downgrade `/tmp/demo-plugin/agents/*.meta.json` to a v1 shape, `worca plugin list` → the yellow data-contract line; the Plugins view shows the amber `needs update` badge and the note; the connector still works.
- [ ] Step 4: Commit — `worca: Node-graph v2 P7 — full suite green`
- [ ] Step 5: Handoff. This plan is `docs/superpowers/plans/2026-08-26-node-graph-v2-P7-agents-view-agent-gen-plugin-api-3.md`. P8 (the break + kill list) consumes these sentinels: `WORCA_PLUGIN_API === 3` in `src/core/plugin-api.mjs` and `function agentFormRender` in `ui/public/app.js`. P8 additionally inherits: the 11 builtin sidecars STILL carry their v1 fields; `src/core/channels.mjs`, `DEFAULT_SPEC`, `LEGACY_LABELS`, `registryToSteps` and the `CHANNEL_IDS` import at `agent-registry.mjs:14` are untouched and are P8's to delete; `deleteAgent`'s v1 `steps` arm and `agent-store`'s tolerance of v1 rows in `listWorkflows` go with the v1 engine.

## Clarifications (Q&A)

- **D1** — How does this land? → **A self-contained plan in an 8-plan series, each leaving `npm test` green and dev shippable; v1 stays the live engine until P8 (user decision 2026-08-26).**
- **D6** — Is the Agents view / agent-gen / plugin work in scope for v2 completeness? → **Yes: engine + composer + run monitor + migration + Agents view port editor + agent-gen v2 + plugin templates as v2 graphs + CLI parity (user decision 2026-08-26).**
- **D8** — Plugin API: bump or reinterpret? → **Bump to 3 with SET semantics `[1, 2, 3]`; connector (API 1) and channel-worker (API 2) protocols unchanged, so `>=1 <2` and `>=2 <3` keep negotiating 1 and 2 (user decision 2026-08-26, adjudication adj-f2 §1).**
- **P7.1** — What gates a plugin's data contract: the declared range or the shipped files? → **The FILES. `apiMismatch(range, issues)` returns null when a plugin ships no v1-shaped agents/templates, so all five bundled connector/chat plugins are unaffected (adjudication adj-f2 §1.1).**
- **P7.2** — v1-shaped plugin data at install: error or warning? → **ERROR when the range admits API 3 (or declares no `engines`), WARN otherwise; the plugin still installs and its connector still works (adjudication adj-f2 §1.2).**
- **P7.3** — Does the load-time v2 gate apply to every registry layer? → **PLUGIN layers only. The rebuild spec §6 keeps the v1 path for builtin/user sidecars during coexistence, and gating them would break the live v1 engine for every existing custom agent (planner default; adj-f2 §1.3 says "all layers", the spec §6 coexistence rule wins).**
- **P7.4** — Where does the plugin-template `portsFn` come from? → **The plugin's OWN sidecars (`portsFnFor(indexByKey(ownMetas))`) plus the engine flow ports, never the live registry — a plugin template may reference only keys it ships (adjudication adj-f2 §1.2).**
- **P7.5** — Does `importPluginWorkflows` write the whole document into `graph`? → **No: `graph` holds `{nodes, wires, canvas?}` only; `id`/`name`/`domain`/`origin` stay row columns (rebuild spec §4, overriding the discarded branch's shape).**
- **P7.6** — What does the Plugins view say? → **`built for plugin API ${builtFor ?? 'an older version'}; this version of worca requires plugin API 3 for agents and pipeline templates — update or reinstall the plugin (${n} agent(s), ${m} template(s) ignored)`, verbatim (adjudication adj-f2 §1.7).**
- **P7.7** — Does the doctor/CLI repeat that sentence? → **Yes — it is the ONLY sentence: `apiMismatchMessage(mismatch)` lives in `plugin-manifest.mjs`, `apiMismatch()` stamps it as `message`, and the Plugins view, the doctor's `agents-api` detail and `worca plugin list` all print that field verbatim; there is no second formatter and no browser copy (agent adjudication, cross-plan pass 2026-08-27 — one canonical text per message; supersedes the answer below).** Original answer, superseded: → **No: `apiMismatchDetail` (server, `plugin-manifest.mjs`) is a shorter sibling; `apiMismatchMessage` (browser, `plugins-view.mjs`) owns the long form. Two named strings beat one duplicated across layers (planner default).**
- **P7.8** — What replaces `channels` in `GET /api/agents`? → **`mockWriterRoles: [...MOCK_WRITER_ROLES]` — a CLOSED list, unlike the open channel vocabulary; `collectChannelIds` dies (spec §9, adj-f2 §3).**
- **P7.9** — `agentFormRender`'s signature? → **`agentFormRender(host, meta, { markdown, mockWriterRoles, registryKeys })`; `markdown` rides in the options bag because the form owns the system-prompt textarea (planner default — the spec names the function, not its options).**
- **P7.10** — May the client block a save it believes is invalid? → **Never. Hints are non-blocking; the PUT always goes out and a 400 renders `data.error` verbatim in `.agent-edit-msg` (spec §9).**
- **P7.11** — What happens to sidecar keys the form does not surface? → **They ride through `dataset.extra` (host-level for agent keys, row-level for port keys) and are re-emitted unchanged, so `artifactKind`, per-port `label`, and anything a newer worca ships survive an edit (adjudication adj-f2 §3).**
- **P7.12** — Which optional fields does `agentFormRead` omit when off? → **`verdict`, `sideEffect`, `mockRole`, `wantsRequest`, `workspaceFanOut`, `workspaceStrategy`, `workspaceVariantOf`, `domain`, `icon`, `promptHints`, `requiresSkills`, and `scope` (written only for `workspace-only`); `placeable` is written only as `false` (planner default extending adj-f2 §3's "ABSENT when off").**
- **P7.13** — Does the store validate before or after `normalizeMeta`? → **BEFORE, in create AND update: `normalizeMeta` is lossy by design, so a broken sidecar would otherwise be silently coerced (spec §9, `agent-store.mjs:62/:103`).**
- **P7.14** — What does `deleteAgent` scan? → **v2 `wf.nodes` (`kind === 'agent'`) AND the surviving v1 `wf.steps` arm, plus every registry agent whose `workspaceVariantOf` names the key (spec §9; the v1 arm dies with the engine in P8).**
- **P7.15** — Does agent-gen still teach channels? → **No: the new `_metaSchemaBlock` describes meta v2 ports verbatim, neighbors render as `{key, displayName, inputs:[{id,type}], outputs:[{id,type,when}]}`, the body gets a `## Ports` heading, and the read-back runs `validateMetaV2` → `agentgen-error` "the generator produced invalid metadata: <rules joined '; '>" (adjudication adj-f2 §2).**
- **P7.16** — `mockAgentGen`'s draft? → **A v2 meta (`metaVersion: 2`, `inputs: [{id:'plan',type:'md'}]`, `outputs: [{id:'review',type:'md',filename:'review-{cycle}.md'}]`) plus a body carrying `## Ports` (adjudication adj-f2 §2).**
- **P7.17** — Does `scripts/smoke-plugin.mjs` change? → **No. Only the fixture it links changes (manifest `>=3 <4`, v2 sidecar, v2 `mock-flow.json`) (adjudication adj-f2 §1.9).**
- **P7.18** — What stays behind for P8? → **The 11 builtins' v1 sidecar fields, `channels.mjs`, `DEFAULT_SPEC`, `LEGACY_LABELS`, `registryToSteps`, `agent-registry.mjs:14`'s `CHANNEL_IDS` import, and `deleteAgent`'s v1 `steps` arm (spec §2 plan table, §11 kill list).**

## Known issues (Session A, 2026-08-27 — resolve during this plan's refinement, before execution)

Findings recorded while refining P1/P2 and adjudicating the cross-plan contracts. The refinement reports live (untracked) in `docs/superpowers/plans/2026-08-26-node-graph-v2-reports/`; `xplan-manifest.md` §A is the canonical contract sheet, §D the residual list.

- xplan §D6: `test/plugin-manifest.test.mjs` deepEqual on `apiMismatch()` must tolerate the new `message` field.
