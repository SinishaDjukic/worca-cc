# PR #361 merge-conflict resolution plan — v2

**PR:** #361 `feat/chat-connectivity` → `dev` (NOT master) — https://github.com/SinishaDjukic/worca-cc/pull/361
**Status:** `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`
**Date:** 2026-08-16 (v2; supersedes `2026-08-16-pr361-merge-conflict-resolution.md`)

**Provenance:** v1 reviewed by four independent max-effort agents (anchor fact-check · executed dry-run + 18-mutation audit · adversarial design critique · coverage audit). The dry-run agent ran the real merge in a throwaway worktree, applied v1's resolutions, and got a green tree — **every per-file resolution in v1 is semantically correct**. What v1 got wrong is *executability* (4 hunks need a brace v1 never mentions), one CSS instruction, one fabricated fact, and a verification section blind to 4 real regressions. All fixed below. This v2 was then itself validated twice: a cold fresh-eyes doc review, and a **blind zero-context execution following only this document** — green end to end (fast loop 55/55, risky set 116/116, full suite 2364/2360/4 known, merge commit parents `10d67ba7` + `527d29da` verified), with its findings folded back in. Refs valid as of `HEAD = 10d67ba7`, `origin/dev = 527d29da`, merge base `3587cd6e`.

## Situation

Conflict cause: `dev` merged #360 "configurable models" (16 commits, merge commit `527d29da`) after this branch's merge base (`3587cd6e`). Both features extended the same plugin surfaces: manifest contributions, plugin-store inventory/consent, config API, Plugins view, CSS.

**9 files, 18 hunks** (counts independently reproduced twice via `git merge-tree --write-tree HEAD origin/dev`, tree `5cd22140`):

```
src/core/plugin-manifest.mjs   4      ui/public/app.js           2
src/core/plugin-store.mjs      3      ui/public/plugins-view.mjs 2
test/plugin-manifest.test.mjs  2      ui/public/style.css        1
test/plugin-store.test.mjs     1      ui/server.mjs              2
test/plugins-view.test.mjs     1                     total      18
```

**Corrected taxonomy** (v1's "all both-added, zero logic contention, union nearly everywhere" was wrong): there is no *logic* contention — no hunk changes the meaning of the other side's code — but almost none can be resolved by keeping both sides verbatim. Exactly **one** hunk is a clean disjoint union (plugin-store inventory). **Nine** are same-statement rewrites (both sides edited the same line; the resolution is a single merged line, given below). **Four** are block additions sharing a trailing brace — the traps in the next section. **One** (server.mjs PUT) has real control-flow stitching with a mandatory ordering. The rest are the CSS duplicate selector and reordered rows.

Additionally, **12 files were touched by both sides**, not 9 — `src/core/orchestrator.mjs`, `src/core/settings.mjs`, and `ui/public/index.html` auto-merge with no markers. They are verified clean (see "Auto-merged" section) but must be sanity-checked, not ignored.

## Strategy

`git merge origin/dev` into the branch (merge commit, **not** rebase). Confirmed twice over: (a) 13 branch commits would replay the same 18 hunks 3–4 times with divergent intermediate states (conflicts concentrate in 3 of the 13 commits); (b) the PR is open against `dev`, so a rebase force-push detaches review threads; merging is exactly what GitHub's "Update branch" would do. Resolve per file below, verify, commit, push.

The merge commit stays **resolution-only** plus one one-token symmetry fix (§2 bullet 4). Everything else discovered during review goes to "Follow-ups" at the end — do not fix pre-existing gaps in this commit.

## ⚠ The four brace traps — read before resolving anything

In 4 of the 18 hunks, **both sides' blocks end mid-construct and the single `}` / `});` on the line after `>>>>>>> origin/dev` is shared context that closes only ONE side's construct.** Concatenating both sides verbatim leaves the first block unclosed. Proven empirically: v1's literal "keep both" fails `node --check` on all four files, with reported error lines 100+ lines away from the defect (e.g. `SyntaxError: Unexpected token 'export'` at `findEscapingSymlinks`, 120 lines below the real gap).

| file | hunk | branch side ends inside… | the shared trailing line closes… | insert at the seam |
|---|---|---|---|---|
| `src/core/plugin-manifest.mjs` | #3 (validation blocks) | the duplicate-channel-id `for` loop | dev's `else {` | `  }` |
| `ui/public/plugins-view.mjs` | #2 (install consent) | `if ((inv.chatChannels \|\| []).length) {` | dev's `if ((inv.models \|\| []).length) {` | `  }` |
| `test/plugin-manifest.test.mjs` | #2 (appended suites) | branch's last `test(` callback | dev's last `test(` callback | `});` |
| `test/plugins-view.test.mjs` | #1 (appended suites) | branch's last `test(` callback | dev's last `test(` callback | `});` |

Rule: **keep branch's block, close it yourself with the token above, then keep dev's block, then leave the pre-existing shared closer in place.** Exact seams are inlined in the per-file sections. The `// <-- ADD THIS BRACE` style annotations inside seam snippets are plan annotations — do not paste them into the code. Run `node --check` on these four files before running any test.

## Per-file resolutions

### 1. `src/core/plugin-manifest.mjs` (4 hunks)

- **Hunk 1 — imports:** keep branch's `import { WORCA_PLUGIN_APIS } from './plugin-api.mjs';` (branch rewrote `apiSatisfies`/`negotiatedApi` to the plural API set `[1, 2]`; dev never touched `plugin-api.mjs`), **add** dev's `import { EFFORTS, isReservedModelEnvKey } from './model-env.mjs';` (dev's models block uses both). Drop dev's `import { WORCA_PLUGIN_API } from './plugin-api.mjs';` — **scoped to this file only**: nothing in the merged `plugin-manifest.mjs` references the singular (dev's two uses, `apiSatisfies` default and the engines error message, are both in regions branch rewrote to plural, which auto-merge). The export itself **must stay** in `src/core/plugin-api.mjs` — `src/core/plugin-shim.mjs:19` and `src/core/chat/channel-host.mjs:19` import it. A repo-wide grep for `WORCA_PLUGIN_API\b` post-merge is *expected* to hit exactly: `plugin-api.mjs`, `plugin-shim.mjs`, `chat/channel-host.mjs`, `test/plugin-manifest.test.mjs`. Do not "fix" those hits.
- **Hunk 2 — `KNOWN_TOP`** (single-line rewrite; both sides already contain `'setup'`):
  ```js
  const KNOWN_TOP = new Set(['name', 'version', 'description', 'author', 'homepage', 'license', 'engines', 'taskSources', 'chatChannels', 'setup', 'models', 'modelSecrets']);
  ```
  The neighboring consts need no stitching: branch's `KNOWN_CHANNEL`/`CHANNEL_INGRESS` and dev's `KNOWN_MODEL`/`KNOWN_MODEL_SECRET`/`isSecretRef` all sit outside the conflict and auto-merge (verified in the merge-tree blob).
- **Hunk 3 — validation blocks ⚠ brace trap:** branch's chatChannels block, **then an inserted `  }`**, then dev's modelSecrets+models block verbatim, then the pre-existing shared `  }` (it closes dev's `else`). The seam:
  ```js
  const chIds = chatChannels.map((c) => c.id);
  for (const dup of new Set(chIds.filter((v, i) => v && chIds.indexOf(v) !== i))) {
    errors.push(`${where}: duplicate chatChannels id "${dup}"`);
  }                       // <-- ADD THIS BRACE — it is on neither conflict side
  // models + modelSecrets (design §9.1). Manifest-only contribution: no files
  // to check, so ALL validation lives here. Write-time env rules mirror the
  // global-catalog setters (settings.mjs assertEnvPairs): reserved keys are a
  // hard error — the spawn-time prepareModelEnv drop stays as the second gate.
  const secretsRaw = raw.modelSecrets ?? [];   // …dev's block continues verbatim
  ```
  (Dev's block starts at its design-§9.1 comment — include it; "verbatim" means from that comment on.)
  Keep dev's side byte-for-byte and in order — its internal ordering is load-bearing (`const secretKeys = new Set(modelSecrets.map((f) => f.key))` must stay between the modelSecrets and models sub-blocks). Both blocks stay above `if (errors.length) return …`. Block order (chatChannels first, then models) is otherwise free: no test asserts cross-block `errors[0]`.
- **Hunk 4 — return object:** `engines: { worcaApi }, setup, taskSources, chatChannels, models, modelSecrets,` — the exact union of the two sides.

### 2. `src/core/plugin-store.mjs` (3 hunks + 1 symmetry fix)

- **Inventory (the one true clean union):** keep both mapping blocks — branch's `const chatChannels = (manifest.chatChannels || []).map(…)` and dev's `const models = …` / `const modelSecrets = (manifest.modelSecrets || []).map((f) => ({ key: f.key, label: f.label }));`. Genuinely disjoint.
- **Return:** `{ agents, taskSources, chatChannels, models, modelSecrets, skills: skills.sort(), workflows, depCount, setupCommands }`.
- **Contributions counts** — both ternary arms get `chatChannels` **and** `models` (`modelSecrets` is deliberately absent from counts on both sides — do not add it):
  ```js
        ? { agents: inv.agents.length, taskSources: inv.taskSources.length, chatChannels: inv.chatChannels.length, models: inv.models.length, skills: inv.skills.length, workflows: inv.workflows.length }
        : { agents: 0, taskSources: 0, chatChannels: 0, models: 0, skills: 0, workflows: 0 },
  ```
- **Symmetry fix (the only edit outside a conflict hunk in this merge):** dev changed the unreadable-manifest fallback near the top of `buildInstallInventory` to `?? { taskSources: [], models: [], modelSecrets: [], setup: { node: false, python: null } }` in a region branch didn't touch, so it auto-merges **without** `chatChannels: []`. Add it: `?? { taskSources: [], chatChannels: [], models: [], modelSecrets: [], setup: { node: false, python: null } }`. Harmless today (every read site guards with `|| []`) but keeps the shape consistent with everything above.

### 3. `ui/server.mjs` (2 hunks) ⚠ real stitching

- **GET `/api/plugins/:name/config`** — branch's `channels` mapping **and** dev's `msSchema`, comments kept:
  ```js
    const channels = (manifest.chatChannels || []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      platform: c.platform,
      schema: c.configSchema,
      values: redactedConfig(name, c.configSchema),
    }));
    // Model secrets (design §9.7): same redaction contract — { set: true|false }
    // markers only, never values.
    const msSchema = modelSecretsSchema(name);
    res.json({
      sources,
      channels,
      ...(msSchema.length ? { models: { schema: msSchema, values: redactedConfig(name, msSchema) } } : {}),
    });
  ```
  Shape adjudicated: `channels` unconditional (branch's shipped contract; its UI renders from `data.channels`), `models` conditional (dev's wire contract; dev's frontend guards for absence, branch's ignores extras). `modelSecretsSchema` is already imported outside the conflict.
- **PUT `/api/plugins/:name/config`** — order is **load-bearing, not style**:
  1. Dev's `if (body.target === 'modelSecrets') { … }` early-return block **first** (verbatim, incl. its comment), directly after the manifest read.
  2. Then branch's `let schema;` + channelId/sourceId routing verbatim.
  3. The shared tail (`try { writePluginConfig(name, schema, body.values); reloadChatWorkers(name); res.json({ ok: true }); }`) auto-merges to branch's version — leave it.
  4. **Delete dev's trailing four lines only** (`const sources = manifest.taskSources || [];` / `const sourceId = …` / `const source = sources.find(…)` / `if (!source) return badRequest(…)`) — branch's `else` arm replaces them. **Keep dev's `try { writePluginConfig(name, schema, body.values); return res.json({ ok: true }); } catch …` inside the modelSecrets block** from step 1: it performs the write and returns *before* the shared tail's `reloadChatWorkers(name)`; it is the only `try` on dev's side of the hunk (dev's endpoint-tail try sits outside the conflict and resolves to branch's shared tail). Keeping dev's trailing four lines instead compiles but puts the sourceId guard ahead of the channel routing, so **every `channelId` save 400s** — and no test catches that (see "Verify by eye"). Deleting the modelSecrets try by mistake IS caught, by `test/api-models.test.mjs` in the risky set.

  Why dev-first is mandatory: for a plugin with **one taskSource + modelSecrets**, a `{ target: 'modelSecrets', values }` body reaching branch's routing first falls into the `sources.length === 1` inference, and `writePluginConfig` (schema-agnostic `Object.entries(values)` loop) writes the secret into `config.json` (**0644**) instead of `secrets.json` (0600) while `redactedConfig` still reports `{ set: false }` — a silent plaintext-secret leak. The suite catches an ordering flip only via the zero-taskSource fixture in `test/api-models.test.mjs` (400 path); the dangerous single-source variant has **no coverage** (regression test → Follow-ups).

  The early return **before** `reloadChatWorkers(name)` is also load-bearing and correct: channel workers spawn with `scrubbedEnv()` (PATH+HOME only, `channel-host.mjs:224-226`) and receive only their channel's own `configSchema` values via the hello frame (`channel-host.mjs:294`) — no model secret can be live inside a worker, so a model-secrets write must **not** restart them. Do not add a reload there.

### 4. `ui/public/app.js` (2 hunks) ⚠ real stitching

- **Config body:** branch's call, then dev's model-secrets block **minus its first line** — dev's side begins with `const body = renderConfigForm(sources);`, which branch's call replaces; keeping both is a duplicate `const body` declaration (SyntaxError). Full merged text (nothing elided — v1's `// ... dev block unchanged` pasted literally is an empty `if`):
  ```js
    const body = renderConfigForm({ sources, channels: data.channels || [] });
    // Model secrets (design §9.7): one extra form, marked with data-target so the
    // save loop routes it through the { target: 'modelSecrets' } write.
    if (data.models && Array.isArray(data.models.schema) && data.models.schema.length) {
      const head = document.createElement('h4');
      head.className = 'pl-config-h';
      head.textContent = 'Model secrets';
      body.appendChild(head);
      const msForm = renderConfigForm([{ id: '', schema: data.models.schema, values: data.models.values }])
        .querySelector('.pl-config-form');
      msForm.dataset.target = 'modelSecrets';
      body.appendChild(msForm);
    }
  ```
  This works because branch's `renderConfigForm` kept array back-compat — it accepts the legacy array of sources OR the full `{ sources, channels }` payload (`plugins-view.mjs:201-204` as of `10d67ba7`; cite the function if lines drift). Dev's array-built form carries `dataset.sourceId = ''`, which the save-loop routing below overrides before it matters.
- **Save loop:**
  ```js
        for (const f of body.querySelectorAll('.pl-config-form')) {
          const collected = collectConfigForm(f); // { sourceId | channelId, values }
          const payload = f.dataset.target === 'modelSecrets'
            ? { target: 'modelSecrets', values: collected.values }
            : collected;
          const r = await pluginApi('PUT', `/api/plugins/${encodeURIComponent(name)}/config`, payload);
          if (!r.ok) { failed = r.data.error || 'save failed'; break; }
        }
  ```
  **Do not** use dev's `const { sourceId, values } = collectConfigForm(f)` destructuring — it drops `channelId` and every channel save 400s with "sourceId does not match". Single `collected` binding, passed through whole on the non-modelSecrets arm.

### 5. `ui/public/plugins-view.mjs` (2 hunks)

- **`contribSummary`:** both rows before skills/workflows — `[n(c && c.chatChannels), 'chat channel'], [n(c && c.models), 'model'],`. Zero/absent counts are dropped by the existing `.filter(([k]) => k > 0)` (plugins-view.mjs:24; `n()` only coerces), so each side's tests still pass with the other feature's key absent from their fixtures.
- **Install consent ⚠ brace trap:** keep both sections — branch's chat-channels section (security warning: inbound chat can pause/stop/approve runs) then dev's models section (base URLs rendered verbatim) — **and insert `  }` between them**: after branch's `channels.appendChild(h(doc, 'div', 'pl-consent-row pl-channel-warn', …))` line and before dev's `// Models (design §9.4)` comment. The shared `  }` after the hunk closes dev's `if ((inv.models || []).length) {`, not branch's `if ((inv.chatChannels || []).length) {`.

### 6. `ui/public/style.css` (1 hunk)

Keep both blocks: branch's chat-connectivity block (`.pl-channels`, `.pl-channel-warn`, `.pl-config-h`, `.chat-events`, `.chat-channels`, `.chat-event-row` incl. its `.hint`, `.chat-channel-row`, `.chat-channel-toggle`, `.chat-state`) + dev's Models-view block (`.mv-*`, `.mvx-*`, `.pl-baseurl`, `.pl-config-h`).

**`.pl-config-h` — both sides define it, and they are NOT interchangeable** (v1's "either is fine, pick dev's" was wrong): branch styles a **`<div>`** heading inside each channel form (`plugins-view.mjs:213`) and its `font-weight: 600` is the only thing making it read as a heading (no UA bold on div, no heading reset in style.css); dev styles an **`<h4>`** ("Model secrets", app.js) and supplies `font-size: 13px`/margins, relying on UA bold. Replace the two lines with ONE merged rule:

```css
.pl-config-h { font-weight: 600; margin: 14px 0 6px; font-size: 13px; }
```

Put the merged rule at **branch's position** (replacing branch's `.pl-config-h { font-weight: 600; margin: 10px 0 4px; }` line in the chat block) and delete dev's minified `.pl-config-h{margin:14px 0 6px;font-size:13px;}` line — post-resolve check 3 assumes one surviving spaced rule. CSS is untested — a lossy single-rule pick ships silently (see "Verify by eye"). (If you accidentally keep *both* lines, rendering is still correct by cascade — branch's `font-weight` survives, dev's later margin/size win — the defect is a duplicate selector, which check 3 flags.)

### 7. Tests (4 hunks)

- **`test/plugin-manifest.test.mjs`** (2 hunks):
  - Empty-fixture union — the `engines`/`setup` prefix is on *both conflict sides* (inside the hunk, not shared context), so write the whole thing; layout:
    ```js
        engines: { worcaApi: null }, setup: { node: false, python: null }, taskSources: [], chatChannels: [],
        models: [], modelSecrets: [],
    ```
    This is a `deepEqual` against the merged `normalizeManifest` return — the key set must match §1 hunk 4 exactly, and it does.
  - Appended suites **⚠ brace trap**: keep branch's 8 chatChannels tests in this hunk (branch adds 9 to the file — one sits outside the conflict and auto-merges), **insert `});`** after branch's last line (`assert.equal(ok.ok, true, JSON.stringify(ok.problems));`), then dev's 4 models/modelSecrets tests; the shared trailing `});` closes dev's last `test(`.
  - Looks-alarming-but-fine: dev's side of this file is append-only (+65/−0), so the base API-1 assertions (`WORCA_PLUGIN_API === 1`, `apiSatisfies('>=2') === false`) auto-merge to branch's API-2 rewrites (`apiSatisfies('>=2') === true`, `negotiatedApi('>=1 <2') === 1`, `/host plugin APIs \[1, 2\]/`). No manual fixup.
- **`test/plugin-store.test.mjs`** (1 hunk): assertion union `{ agents: 1, taskSources: 1, chatChannels: 0, models: 0, skills: 1, workflows: 1 }` — a `deepEqual` on `row.contributions`, must match §2's ternary key set exactly.
- **`test/plugins-view.test.mjs`** (1 hunk) **⚠ brace trap**: keep both suites (channel badges/config forms + model consent/delta/counts), **insert `});`** after branch's last line (`assert.deepEqual(collectConfigForm(forms[0]).sourceId, 'gh', …);`) before dev's suite. The auto-merged import block already pulls every symbol both suites need — no import stitching.

## Auto-merged, both-sides-touched — verified clean, sanity-check only

These three files merge with no markers; each side's diff carries over byte-for-byte (verified in the dry-run). Confirm with `git diff --stat` after merging — expected deltas:

| file | dev's Δ vs base (must survive) | branch's Δ vs base (must survive) | merged intent |
|---|---|---|---|
| `src/core/orchestrator.mjs` | +29 −2 | +10 −3 | dev: model dispatch + `observeModelCost` + `modelUsed` stamping; branch: `_reportToSource()` on stopped/error terminal paths. Disjoint lines, disjoint concerns. |
| `src/core/settings.mjs` | +231 −2 | +48 | dev: global `models` catalog key + CRUD at EOF; branch: `chat` key (`chatPrefs`/`setChatPrefs`). No key or symbol collision. |
| `ui/public/index.html` | +25 | +14 | dev: `models` nav buttons + `data-view="models"` section; branch: `#chat-settings-card` inside the existing settings view (no nav button, no data-view). |

Two landmines checked and safe: (a) dev retargeted the UI count invariants (`ui-shell` 13→14 views, `ui-nav-buttons`/`ui-nav-sections` 11→12) — branch adds no `data-view` and no nav button, so they hold on the merged HTML; (b) branch's strict `Object.keys(j).sort()` assertion on `GET /api/settings` (`settings-projects-root.test.mjs`) — dev adds no settings-state key (its catalog rides `/api/models`), so it holds.

Also confirmed, no action: `package.json`/`package-lock.json` untouched by both sides (no dependency merge; `npm test` is a `test/*.mjs` glob, so both sides' new test files run automatically). `src/core/plugin-api.mjs` is branch-only (exports both `WORCA_PLUGIN_API = 2` and `WORCA_PLUGIN_APIS = [1, 2]`). `src/cli/worca-cc.mjs` is branch-only and auto-merges (see Follow-ups). `src/core/plugin-repo.mjs` is dev-only (see Follow-ups). The three files above are the **complete** both-touched auto-merged set.

## Not covered by any test — verify by eye

The 18-mutation audit ran each plausible wrong-resolution against the full 2364-test suite. These stayed **green while broken** — the test suite cannot protect these spots, so check them visually before committing:

| spot | wrong-resolution that passes every test | real-world damage |
|---|---|---|
| §1 `KNOWN_TOP` | dropping `'models', 'modelSecrets'` | every model plugin warns `unknown field "models" ignored`; `worca plugin validate --strict` fails all model plugins |
| §3 GET | omitting `channels` from `res.json` | chat-plugin Settings modal renders no channel forms — the branch's headline feature dead (zero tests hit GET config for `channels`) |
| §3 PUT | keeping dev's trailing source-lookup lines | every `channelId` save 400s |
| §4 both blocks | dropping the model-secrets form append and/or the `dataset.target` payload routing | model-secrets save broken in the browser (`app.js` has zero test coverage) |
| §6 CSS | dropping either block, or a lossy `.pl-config-h` pick | Models view unstyled / channel headings un-bolded (CSS untested by design) |

(For contrast: every other mutation — KNOWN_TOP `chatChannels`, validation blocks, return objects, inventory, ternary keys, consent sections, PUT ordering-flip via the 400 path — is caught, most by the 3 conflicted test files, the PUT ones only by `test/api-models.test.mjs` in the full suite.)

## Post-resolve checks

```bash
# 0. No conflict residue anywhere (git grep: every tracked file under these dirs, untracked skipped).
git grep -n '^<<<<<<<\|^=======$\|^>>>>>>>' -- src ui test       # expect: no output

# 1. Syntax FIRST — catches all four brace traps (error lines are misleading; the greps
#    in this file's brace-trap table say where the real seams are).
node --check src/core/plugin-manifest.mjs
node --check src/core/plugin-store.mjs
node --check ui/server.mjs
node --check ui/public/plugins-view.mjs
node --check ui/public/app.js
node --check test/plugin-manifest.test.mjs
node --check test/plugin-store.test.mjs
node --check test/plugins-view.test.mjs

# 2. The unions actually landed (each grep must show ALL listed keys on one line).
grep -n "const KNOWN_TOP" src/core/plugin-manifest.mjs            # chatChannels AND models AND modelSecrets
grep -n "engines: { worcaApi }" src/core/plugin-manifest.mjs      # taskSources, chatChannels, models, modelSecrets
grep -n "return { agents, taskSources" src/core/plugin-store.mjs  # chatChannels, models, modelSecrets
grep -n "chatChannels: inv.chatChannels.length" src/core/plugin-store.mjs   # models too, same line
grep -n "'chat channel'\]\|'model'\]" ui/public/plugins-view.mjs  # both contribSummary rows

# 3. Exactly one .pl-config-h rule survives, and it carries the weight AND the size.
grep -c "pl-config-h" ui/public/style.css    # expect 1 — count WITHOUT a brace: dev's original is
                                             # minified (.pl-config-h{…}), so "pl-config-h {" would
                                             # miss a surviving duplicate
grep    "pl-config-h" ui/public/style.css    # the one line must carry font-weight: 600 AND font-size: 13px

# 4. Singular-API scoping: expected hits ONLY in these four files.
grep -rln "WORCA_PLUGIN_API\b" src/ test/ ui/ | sort
# expect exactly these four, any order: src/core/chat/channel-host.mjs  src/core/plugin-api.mjs
#                                       src/core/plugin-shim.mjs  test/plugin-manifest.test.mjs

# 5. The merged validator accepts every shipped manifest — 0 errors, 0 warnings
#    (an unknown-field warning here means the KNOWN_TOP union is wrong).
node --input-type=module -e "
const {normalizeManifest}=await import('./src/core/plugin-manifest.mjs');
const fs=await import('node:fs');
for (const p of ['examples/plugins/github-source','examples/plugins/telegram-chat',
 'examples/plugins/slack-chat','examples/plugins/discord-chat','examples/plugins/teams-chat',
 'test/fixtures/plugins/mock-source']) {
 const r=normalizeManifest(JSON.parse(fs.readFileSync(p+'/worca-cc-plugin.json','utf8')));
 console.log(p, r.ok?'OK':'FAIL', JSON.stringify(r.ok?r.warnings:r.errors)); }"
# expect: 6 lines ending in: OK []
# (Four chat plugins declare ">=2 <3" → negotiated API 2; github-source and the mock
#  fixture declare ">=1 <2" → negotiated API 1 via the any-member rule. Dev ships NO
#  plugin manifests of its own — v1's "dev's model plugins declare >=1" referred to
#  files that don't exist.)

# 6. modelEnv seam × chat workers: no wiring needed and none must be added.
#    Chat workers spawn process.execPath with scrubbedEnv() (PATH+HOME) at
#    channel-host.mjs:224/:480 and never invoke claude; the only run-creating chat verb
#    (/resume) re-enters the orchestrator via POST /api/resume → phases.mjs runOpts,
#    where dev already resolves modelEnv. Do NOT thread modelEnv into createChannelHost.

# 7. Auto-merged trio sanity — run BEFORE committing. HEAD is still the branch tip at
#    this point, so OMIT it: a bare revision diffs the merged working tree. (With HEAD
#    the first command prints a scary bogus "280 deletions" and the second prints nothing.)
git diff --numstat origin/dev -- src/core/orchestrator.mjs src/core/settings.mjs ui/public/index.html
# expect (added/deleted — branch's Δ survived): 10 3 orchestrator · 48 0 settings · 14 0 index.html
git diff --numstat 10d67ba7 -- src/core/orchestrator.mjs src/core/settings.mjs ui/public/index.html
# expect (dev's Δ survived): 29 2 orchestrator · 231 2 settings · 25 0 index.html
```

## Verification

```bash
# Fast loop — the three conflicted test files.
node --test test/plugin-manifest.test.mjs test/plugin-store.test.mjs test/plugins-view.test.mjs
# expect: 55 tests, 55 pass (pre-merge baseline was 46; union arithmetic: 16+9+4 / 11+0+2 / 7+3+3)

# Targeted risky set — suites that straddle the merge but never conflicted. NOT optional:
# test/api-models.test.mjs is the ONLY automated guard on the PUT modelSecrets path,
# and ui-boot JSDOM-boots the merged app.js against the merged index.html.
node --test test/api-models.test.mjs test/api-plugins.test.mjs test/api-ingress.test.mjs \
            test/plugin-models.test.mjs test/plugin-repo.test.mjs \
            test/models-view.test.mjs test/chat-settings-view.test.mjs \
            test/ui-boot.test.mjs test/ui-shell.test.mjs test/ui-nav-buttons.test.mjs \
            test/ui-nav-sections.test.mjs test/ui-workspace-selectors.test.mjs \
            test/settings-projects-root.test.mjs
# expect: 116 tests, 116 pass

# Full suite.
npm test
# expect: 2364 tests, 2360 pass, 4 fail — exactly the four known pre-existing
# imagegen-skill failures (bundled SKILL.md/script, python3, detached+declared skills,
# legacy pinned skills). Any OTHER failure is a resolution error.

# Then walk the "Verify by eye" table.
```

Counts measured on the dry-run merge at `10d67ba7` × `527d29da`; if they drift, judge by "same failures as a pre-merge baseline run", per the project's test-baseline convention. (Fresh-worktree note: `npm ci` is required; `examples/sandbox` is NOT needed for `npm test` — only the `smoke` script touches it.)

## Mechanics

```bash
git fetch origin dev
git merge origin/dev     # 9 files conflict (list above); 47 more auto-merge, already staged
                         # (3 of the 47 are both-sides-touched — see the trio table)
# resolve per plan above; run post-resolve checks + verification
git add -u               # stages the 9 resolved files; NEVER `git add -A` here —
                         # docs/ is untracked in the main tree and must stay untracked
git commit --no-edit     # default merge message is fine (bare `git commit` opens $EDITOR)
git push
```

`docs/` stays untracked (never commit plans/specs). Effort: **45–60 min** including verification for a zero-context implementer following this plan (v1 said 30–45, but its missing seams cost the dry-run agent a brace-hunting detour; with the seams spelled out, ~25 min hands-on + test time is realistic).

## Follow-ups — known gaps the merge inherits (do NOT fix in the merge commit)

None of these is introduced by the merge; each is pre-existing on one side. Recorded so the resolver neither panics nor makes unrequested fixes. File as issues / a follow-up commit on this branch after the merge lands:

1. **PUT single-source leak regression test** (the one follow-up worth doing on this branch immediately after the merge): `test/api-models.test.mjs` fixture with ONE taskSource AND modelSecrets; `PUT { target: 'modelSecrets', values }`; assert `GET …/config` shows `models.values.<key> = { set: true }` and the source's values do NOT contain the key. Guards §3's mandatory ordering against future refactors — the current suite only covers the zero-source 400 path.
2. **`src/core/plugin-repo.mjs:86-89` `manifestSecretKeys`** reads `taskSources[].configSchema` only — a plugin update adding a chat channel with a new `secret:true` bot token raises no `NEW SECRET requested:` flag in the update-consent delta dev just built for exactly this risk class (and `renderUpdatePreview` has no `newChatChannels` row). Branch-side gap, security-consent surface.
3. **`src/cli/worca-cc.mjs`** (branch-only file, auto-merges): `contribSummary` (:862) missing `models`; `printInventory` (:876) missing `models`/`modelSecrets` incl. the verbatim base-URL disclosure the web consent treats as critical; `worca plugin install` pre-consent summary (:1105) missing `chatChannels` AND `models`; update-delta printer (:1152) missing dev's four model-delta fields. Dev-side gaps (dev never taught its features to the CLI) + one branch-side (install consent).
4. **Flat per-plugin config namespace**: a `modelSecrets` key equal to a `taskSources`/`chatChannels` configSchema key would migrate values between `config.json`/`secrets.json` on save (`plugin-config.mjs` `delete other[k]`); `normalizeManifest` should reject the collision.
5. **`.claude/skills/creating-worca-cc-plugins/SKILL.md`** documents `taskSources` only — teaches neither `chatChannels` nor `models`/`modelSecrets`.
6. **Export-plugin scaffold** (`POST /api/models/export-plugin`) emits no `engines` key — accepted today, but `"worca-cc-api": ">=1"` would be strictly better.
7. **`resolveModelEnv` per-spawn cost**: it synchronously re-parses every enabled plugin's manifest per claude spawn; post-merge that set includes the four chat plugins. Correctness fine (chat manifests yield `models: []`), just a growing sync-IO cost.

## Changes from v1 (summary)

1. Brace-trap section + explicit seam tokens in §1/§5/§7 — v1's "keep both" was a SyntaxError in 4 files.
2. §3 PUT: ordering promoted from unstated to load-bearing (0644 plaintext-leak rationale), dev's trailing-lines deletion made explicit, early-return-before-reload justified.
3. §4: dev's app.js block inlined in full, minus its duplicate `const body` first line; save-loop do-not added.
4. §6: `.pl-config-h` "either is fine" replaced with the merged single rule (branch's div needs the bold, dev's h4 needs the size).
5. §1: singular-`WORCA_PLUGIN_API` drop scoped to plugin-manifest.mjs only; export stays (channel-host/shim import it); expected grep hits listed.
6. §2: `chatChannels: []` added to dev's inventory fallback (only non-conflict edit).
7. New sections: auto-merged trio with expected diffstats, mutation-derived "verify by eye" list, concrete post-resolve command checklist with expected outputs, follow-ups.
8. Verification: exact expected counts (55/55; 2364/2360/4), risky-set test list added (the 3-file loop alone misses the PUT path entirely).
9. Fabrications/errors fixed: "dev's model plugins declare >=1" (no such plugins exist; the two real manifests pin `>=1 <2`, satisfied via member 1), "zero logic contention / union nearly everywhere", "4 ⚠ spots" arithmetic, `n()` filtering mechanism, style.css block inventory, `git add <9 files>` → `git add -u`, effort estimate.
