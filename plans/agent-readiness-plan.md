# Agent Readiness v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the branch's first agent-readiness implementation into the approved design: only the tools a project uses are judged, repository checks show once, a per-tool Detect / Used / Not used setting, an open-problem count on the chip, and the new popover and settings card.

**Architecture:** Evaluation stays fact-based and cached by fingerprint (`facts.mjs` → `checks.mjs` → `engines.mjs`), but now produces a *base report* (check rows with a `scope`, a level per engine, a repository level). A new pure step (`report.mjs`) combines the base report with *usage* (`used.mjs`: settings, `run.engine`, run history, tool files) into the final report on every read, so a settings change or a new run never needs a re-evaluation. The UI (`readiness-chip.mjs`, the popover and the settings card in `app.js`) renders the final report.

**Tech Stack:** Node ≥ 22 ESM, `node:test`, `node:sqlite` via `src/core/db.mjs`, vanilla DOM in `ui/public`, JSDOM in tests.

**Spec:** `plans/agent-readiness-design.md`. Mockup: `https://claude.ai/artifact/BkK2wE7H9vrLBe5DVfL9MJ` (local copy: the session scratchpad's `agent-readiness-tools.html`).

## Global Constraints

- Engine display names come only from `engineLabel()` (`src/shared/engine-switch.mjs`): **Claude Code**, **OpenAI Codex**, **GitHub Copilot**, **Cursor**. No component has names of its own.
- UI copy uses no "·" separators and no "…" (write "..."). Labels are text on a tinted pill: **no leading dot, no border or outline ring, also on hover**.
- Label words: Ready (green), Partly ready (amber), Not ready (red), Not used (grey). Chip words: Agent-ready, Partly ready, Not agent-ready.
- The chip's number counts **open problems** = failing `blocker` + `warn` checks across judged tools and the repository; `info` never counts; a green chip has no number. The number is regular weight (500), on a solid disc whose text uses `--panel`.
- No numeric score or percentage anywhere. Passed/applicable appears only in the popover header and the chip tooltip.
- Readiness never blocks a project add or a run start.
- Every string from a report is server data: render with `textContent`, never `innerHTML`.
- `AGENTS.md` alone marks no engine as used. Signed-in engines are not a usage signal.
- The engine `run.engine` resolves to is always judged, even when set to `unused`.
- Kill switch `WORCA_READINESS=0` keeps working everywhere it works today.

## Sources

Which instruction files each tool reads (spec §4.4). Check these pages before changing an engine's
instruction list, and cite the page next to the export:

- Claude Code: https://code.claude.com/docs/en/memory#agents-md
- OpenAI Codex: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- GitHub Copilot CLI: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
- GitHub Copilot in IDEs (not used by runs): https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/configure-custom-instructions/add-repository-instructions-in-your-ide
- Cursor CLI: https://cursor.com/docs/cli/using#rules
- Cursor rules: https://cursor.com/docs/rules

## Out of scope (separate follow-up)

- The **team layer** of `readiness.tools` and its Team policy page rows (spec §4.7, §5). Team values go through the policy field schema (`src/core/policy/effective.mjs#FIELDS`) with its own validation and UI; that is its own plan. This plan implements the project layer and leaves `team: null` on the cascade entry.
- Phase 2 items in spec §10.

## Spec correction made by this plan

Spec D8 ("a new `pipelines.engine` column") is **wrong**: a run's engine is already queryable through `RUN_ENGINE_SQL` in `src/core/artifacts.mjs` (`outcome.runEngine`, else the resume point's `claude.engine`, NULL = `claude`). Task 11 rewrites §4.6/D8 to say so. No schema change.

## Review Focus

1. **A project with no runs and no settings** (freshly added): exactly one engine (the `run.engine` default, Claude Code) is judged; the chip is not red for Codex/Copilot. Pinned in Task 3 (`usedEngines` with empty history) and Task 5 (`buildReport` fixture "fresh project").
2. **Setting the run engine's tool to Not used** (via settings, not the popover): it stays judged, with reason "runs use it". Pinned in Task 3.
3. **A settings change while the popover is open**: the popover and chip repaint without Recheck. Pinned in Task 6 (PATCH emits `readiness-changed`) and Task 9 (frame repaints the open menu).
4. **A long check list on a short window**: the popover's footer (Settings, Recheck) stays reachable; only the body scrolls; the popover never covers its chip. Pinned in Task 7 (`placeFlyout` mode `below`) and Task 9 (CSS: body `overflow:auto`, popover `display:flex;flex-direction:column`).
5. **Undo right after "Not used here"**: restores the previous setting exactly (`used` stays `used`, Detect stays Detect). Pinned in Task 9 (`markToolUnused` returns the previous value; the toast's action writes it back).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/shared/engine-switch.mjs`, `src/shared/connections.mjs` | already changed (uncommitted) | Full engine names; `HARNESS_NAMES` removed |
| `src/core/repo-readiness/checks.mjs` | modify | Catalog: `scope` instead of `engines`, pass details, `CATALOG_VERSION = 2` |
| `src/core/repo-readiness/engines.mjs` | modify | Tool-scope checks per engine (present, committed, size), base levels |
| `src/core/repo-readiness/used.mjs` | create | Which engines are used and why (pure) + run-history read |
| `src/core/repo-readiness/report.mjs` | create | Base report + usage → final report (levels, counts) — pure |
| `src/core/repo-readiness/evaluate.mjs` | modify | Returns the base report |
| `src/core/repo-readiness/cache.mjs` | modify | Caches base reports, builds the final report on read, summary |
| `src/core/repo-readiness/snapshot.mjs` | modify | Run snapshot from the final report for the run's engine |
| `src/core/artifacts.mjs` | modify | `runEngineCounts(projectKey, sinceIso)` |
| `src/core/settings.mjs`, `src/core/settings-cascade.mjs` | modify | `readiness.tools` (project layer), `readinessTools()` |
| `ui/server.mjs` | modify | Usage wiring, summary, settings PATCH → `readiness-changed`, added-project toast |
| `src/cli/worca-cc.mjs` | modify | Used engines + repeatable `--engine` |
| `ui/public/side-flyout.mjs` | modify | `placeFlyout` mode `below` (left-aligned, height-limited) |
| `ui/public/readiness-chip.mjs` | modify | Chip without dot, count disc, tooltip; pure popover/settings model helpers |
| `ui/public/app.js` | modify | Popover, settings card, Not used here + Undo |
| `ui/public/style.css` | modify | Readiness styles per mockup |
| tests under `test/` | modify/create | One file per unit, listed per task |
| `plans/agent-readiness-design.md` | modify | D8 correction, team layer moved to follow-up |

---

### Task 1: Verify and commit the full engine names

The rename is already in the working tree (`engine-switch.mjs`, `connections.mjs`, 32 test files) but its test run was interrupted.

**Files:**
- Modify (already changed): `src/shared/engine-switch.mjs`, `src/shared/connections.mjs`, the 32 modified `test/*.test.mjs` files from `git status`

**Interfaces:**
- Produces: `engineLabel('claude') === 'Claude Code'`, `'codex' → 'OpenAI Codex'`, `'copilot' → 'GitHub Copilot'`, `'cursor' → 'Cursor'`. `HARNESS_NAMES` no longer exists.

- [ ] **Step 1: Confirm nothing still imports `HARNESS_NAMES`**

Run: `git grep -n HARNESS_NAMES`
Expected: no output.

- [ ] **Step 2: Run the fast tier**

Run: `npm run -s test:fast > /tmp/rd-fast.log 2>&1; grep -E "^ℹ (tests|pass|fail)" /tmp/rd-fast.log`
Expected: `fail 0`. If a test fails, open its block (`grep -n "test at " /tmp/rd-fast.log`), and if the diff is only the old short name in an expected string, update that expected string to the full name. Any other failure is a real regression: stop and report it.

- [ ] **Step 3: Run the slow tier**

Run: `npm run -s test:slow > /tmp/rd-slow.log 2>&1; grep -E "^ℹ (tests|pass|fail)" /tmp/rd-slow.log`
Expected: `fail 0` (same rule as Step 2).

- [ ] **Step 4: Commit**

```bash
git add src/shared/engine-switch.mjs src/shared/connections.mjs test/
git commit -m "Engines: full display names (Claude Code, OpenAI Codex, GitHub Copilot)"
```

---

### Task 2: Check catalog with scopes and pass details

**Files:**
- Modify: `src/core/repo-readiness/checks.mjs`
- Modify: `src/core/repo-readiness/engines.mjs`
- Test: `test/checks.test.mjs`, `test/engines.test.mjs`

**Interfaces:**
- Produces (`checks.mjs`): `CATALOG_VERSION = 2`; `CHECKS[i] = { id, title, scope: 'repository'|'tool', severity, fix, run }`. Repository checks' `run(facts)` returns `{status, detail?}` and **`detail` is set on `pass` too**. Tool checks have `run: null` (engines.mjs runs them).
- Produces (`engines.mjs`): `evaluateEngines(facts, { ignore = [], env })` →
  ```js
  {
    checks: Array<{ id, title, scope, severity, engine?: string, status, detail?: string, fix }>,
    repository: { level, failing: string[] },               // level: 'ready'|'partial'|'not-ready'|'unknown'
    engines: Record<name, { level, failing: string[], locked?: string }>,  // tool-scope only, every engine
  }
  ```
  `DECLARED_ENGINES` unchanged. Tool-scope ids: `instructions.present`, `instructions.committed`, `instructions.size`.

- [ ] **Step 1: Write the failing tests**

Add to `test/checks.test.mjs`:

```js
import { CHECKS, CATALOG_VERSION } from '../src/core/repo-readiness/checks.mjs';

describe('catalog v2: scopes and pass details', () => {
  it('is version 2 and every check has a scope', () => {
    assert.equal(CATALOG_VERSION, 2);
    for (const c of CHECKS) assert.ok(c.scope === 'repository' || c.scope === 'tool', `${c.id} scope`);
  });

  it('the three instruction checks are tool scope, the rest repository', () => {
    const tool = CHECKS.filter((c) => c.scope === 'tool').map((c) => c.id).sort();
    assert.deepEqual(tool, ['instructions.committed', 'instructions.present', 'instructions.size']);
  });

  it('a passing repository check says what it found', () => {
    const facts = {
      isRepo: true, trackedSet: new Set(['package.json', 'package-lock.json']), tracked: ['package.json', 'package-lock.json'],
      manifests: { 'package.json': JSON.stringify({ scripts: { test: 'node --test', build: 'tsc', lint: 'eslint .' } }) },
      texts: {}, sizes: {}, heavyPresent: ['node_modules'], heavyIgnored: { node_modules: true },
    };
    for (const c of CHECKS.filter((x) => x.scope === 'repository')) {
      const r = c.run(facts);
      if (r.status === 'pass') assert.ok(typeof r.detail === 'string' && r.detail.length > 0, `${c.id} pass detail`);
    }
  });

  it('commands.test names the script it found', () => {
    const c = CHECKS.find((x) => x.id === 'commands.test');
    const r = c.run({ manifests: { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) }, texts: {} });
    assert.deepEqual(r, { status: 'pass', detail: '`npm test` in package.json' });
  });
});
```

Add to `test/engines.test.mjs`:

```js
describe('evaluateEngines v2', () => {
  it('returns repository and per-engine tool levels separately', () => {
    withRepo((dir) => { writeFileSync(join(dir, 'CLAUDE.md'), '# x\n'); commitAll(dir); }, (dir) => {
      const r = evaluateEngines(collectFacts(dir), { env: {} });
      assert.equal(r.engines.claude.level, 'ready');
      assert.equal(r.engines.codex.level, 'not-ready');            // no AGENTS.md
      assert.deepEqual(r.engines.codex.failing, ['instructions.present']);
      assert.ok(['ready', 'partial'].includes(r.repository.level));
      assert.ok(r.checks.every((c) => c.scope === 'repository' ? c.engine === undefined : typeof c.engine === 'string'));
    });
  });

  it('instructions.size is judged per engine on that engine\'s own files', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, 'CLAUDE.md'), '# small\n');
      writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(60 * 1024));
      commitAll(dir);
    }, (dir) => {
      const r = evaluateEngines(collectFacts(dir), { env: {} });
      const size = (e) => r.checks.find((c) => c.id === 'instructions.size' && c.engine === e);
      assert.equal(size('claude').status, 'pass');
      assert.equal(size('codex').status, 'fail');
      assert.match(size('codex').detail, /AGENTS\.md/);
    });
  });

  it('a passing tool check carries a detail', () => {
    withRepo((dir) => { writeFileSync(join(dir, 'CLAUDE.md'), '# x\n'); commitAll(dir); }, (dir) => {
      const r = evaluateEngines(collectFacts(dir), { env: {} });
      const present = r.checks.find((c) => c.id === 'instructions.present' && c.engine === 'claude');
      assert.deepEqual([present.status, present.detail], ['pass', 'CLAUDE.md found']);
    });
  });

  it('git.repo failing makes every level unknown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'norepo-'));
    try {
      const r = evaluateEngines(collectFacts(dir), { env: {} });
      assert.equal(r.repository.level, 'unknown');
      for (const e of Object.values(r.engines)) assert.equal(e.level, 'unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/checks.test.mjs test/engines.test.mjs`
Expected: FAIL (`CATALOG_VERSION` is 1, no `scope`, no `repository`).

- [ ] **Step 3: Implement `checks.mjs`**

Change `CATALOG_VERSION` to `2`. Replace each check's `engines: 'all'` with `scope: 'repository'` and each `engines: 'perEngine'` with `scope: 'tool'`; move `instructions.size` to `scope: 'tool'` with `run: null`; set `run: null` on the other two tool checks. Return pass details:

```js
// commandCheck: return what was found, in the words the popover shows.
if (pkgTxt !== undefined) {
  const s = parsePkg(pkgTxt)?.scripts || {};
  if (kind === 'test' && s.test && s.test !== DEFAULT_TEST) return { status: 'pass', detail: '`npm test` in package.json' };
  if (kind === 'build' && s.build) return { status: 'pass', detail: '`npm run build` in package.json' };
  const lintScript = ['lint', 'format', 'check'].find((n) => s[n]);
  if (kind === 'lint' && lintScript) return { status: 'pass', detail: `\`npm run ${lintScript}\` in package.json` };
}
if (makeTxt !== undefined) {
  const t = makeTargets(makeTxt);
  const target = MAKE_TARGETS[kind].find((x) => t.has(x));
  if (target) return { status: 'pass', detail: `\`make ${target}\` in the Makefile` };
}
const eco = ecoPass(f, kind);
if (eco?.status === 'pass') return eco;
if (instructionMentions(f, kind)) return { status: 'pass', detail: `a ${kind} command is named in the instructions` };
```

In `ecoPass`, give each `pass` a detail: go → `'implied by go.mod'`, Cargo → `'implied by Cargo.toml'`, Maven/Gradle → `'implied by the build file'`, pyproject test → `'pytest/tox/nox configured in pyproject.toml'`, pyproject lint → `'a linter configured in pyproject.toml'`, `.golangci.yml` → `'.golangci.yml is tracked'`.

Other pass details:

```js
// git.repo
f.isRepo ? { status: 'pass', detail: 'Runs check out a worktree of this repository' } : { status: 'fail', detail: 'not a git work tree' }
// lockfileCheck: name the lockfiles found
if (!missing.length) {
  const found = present.map(([, locks]) => locks.find((l) => f.trackedSet.has(l)));
  return { status: 'pass', detail: `${found.join(', ')} committed` };
}
// ignore.heavy-dirs
leaked.length ? { status: 'fail', detail: `${leaked.join(', ')} not ignored` } : { status: 'pass', detail: `${f.heavyPresent.join(', ')} in .gitignore` }
// secrets.tracked-names
hit ? { status: 'fail', detail: `${hit} is tracked` } : { status: 'pass', detail: 'No .env, key or certificate files are tracked' }
// instructions.single-source pass
{ status: 'pass', detail: 'CLAUDE.md and AGENTS.md reference each other' }
// repoMapCheck pass
{ status: 'pass', detail: `the instructions name ${mentioned} of ${dirs.size} packages` }
```

- [ ] **Step 4: Implement `engines.mjs`**

Replace the per-engine part so all three tool checks run per engine, and return the new shape:

```js
import { DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, DEFAULT_CONTEXT_MAX_BYTES_TOTAL } from '../settings.mjs';

const TOOL = Object.freeze({
  'instructions.present': (src, facts) => {
    if (!hasSources(src)) return { status: 'skip' };
    const found = [...presentFiles(src, facts), ...globMatches(src, facts)];
    if (found.length) return { status: 'pass', detail: `${found.slice(0, 2).join(', ')} found` };
    return { status: 'fail', detail: `none of ${[...src.files, ...src.globs].join(', ')} found` };
  },
  'instructions.committed': (src, facts) => {
    if (!hasSources(src) || src.committedExempt || !facts.trackedSet) return { status: 'skip' };
    const files = presentFiles(src, facts).filter((p) => !LOCAL_ONLY_FILES.includes(p));
    if (!files.length) return { status: 'skip' };
    const notCommitted = files.filter((p) => !facts.trackedSet.has(p) || facts.instructionStatus?.[p]);
    return notCommitted.length
      ? { status: 'fail', detail: `${notCommitted.join(', ')} not committed` }
      : { status: 'pass', detail: `${files.join(', ')} committed` };
  },
  'instructions.size': (src, facts) => {
    if (!hasSources(src) || facts.truncated) return { status: 'skip' };
    const sizes = presentFiles(src, facts).map((p) => [p, facts.sizes?.[p]]).filter(([, n]) => typeof n === 'number');
    if (!sizes.length) return { status: 'skip' };
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    const over = sizes.find(([, n]) => n > DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
    if (over) return { status: 'fail', detail: `${over[0]} is ${kb(over[1])}, over the ${kb(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE)} limit` };
    const total = sizes.reduce((a, [, n]) => a + n, 0);
    if (total > DEFAULT_CONTEXT_MAX_BYTES_TOTAL) return { status: 'fail', detail: `instruction files total ${kb(total)}` };
    return { status: 'pass', detail: `under the ${kb(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE)} limit` };
  },
});

function levelOf(rows, ignoreSet) {
  const failing = rows.filter((r) => r.status === 'fail' && !ignoreSet.has(r.id));
  const level = failing.some((r) => r.severity === 'blocker') ? 'not-ready'
    : failing.some((r) => r.severity === 'warn') ? 'partial' : 'ready';
  return { level, failing: failing.map((r) => r.id) };
}

export function evaluateEngines(facts, { ignore = [], env = process.env } = {}) {
  const ignoreSet = new Set(ignore);
  const engines = listEngines().map((e) => e.name).filter((n) => n !== 'mock');
  const lockedBy = new Map(engineLocks(env).map((l) => [l.name, l.reason]));
  const row = (check, result, engine) => ({
    id: check.id, title: check.title, scope: check.scope, severity: check.severity,
    ...(engine ? { engine } : {}),
    status: ignoreSet.has(check.id) ? 'ignored' : result.status,
    ...(result.detail === undefined ? {} : { detail: result.detail }),
    fix: check.fix,
  });

  const repoRows = CHECKS.filter((c) => c.scope === 'repository').map((c) => row(c, safeRun(c, facts)));
  const toolRows = {};
  for (const name of engines) {
    toolRows[name] = CHECKS.filter((c) => c.scope === 'tool').map((c) => {
      const impl = TOOL[c.id];
      return row(c, impl ? safeRun({ run: (f) => impl(sourcesOf(name), f) }, facts) : { status: 'skip' }, name);
    });
  }

  const broken = !!facts.error || repoRows.find((r) => r.id === 'git.repo')?.status === 'fail';
  const unknown = { level: 'unknown', failing: [] };
  const out = {};
  for (const name of engines) {
    out[name] = lockedBy.has(name) ? { ...unknown, locked: lockedBy.get(name) } : broken ? unknown : levelOf(toolRows[name], ignoreSet);
  }
  return {
    checks: [...repoRows, ...engines.flatMap((n) => toolRows[n])],
    repository: broken ? unknown : levelOf(repoRows, ignoreSet),
    engines: out,
  };
}
```

Delete the now-unused `PER_ENGINE`, `runPerEngine`, `levelFor`, `appliesList`, `rowApplies`, `makeRow`. Remove the old `instructions.size` implementation from `checks.mjs`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/checks.test.mjs test/engines.test.mjs`
Expected: PASS. Existing assertions on the old shape (`engines: 'all'`, `row.engines`) are updated to `scope` / `engine` in the same files.

- [ ] **Step 6: Commit**

```bash
git add src/core/repo-readiness/checks.mjs src/core/repo-readiness/engines.mjs test/checks.test.mjs test/engines.test.mjs
git commit -m "Readiness: repository vs tool checks, pass details, catalog v2"
```

---

### Task 3: Which engines a project uses

**Files:**
- Create: `src/core/repo-readiness/used.mjs`
- Modify: `src/core/artifacts.mjs` (add `runEngineCounts`)
- Test: `test/readiness-used.test.mjs`, `test/artifacts-run-engine-counts.test.mjs`

**Interfaces:**
- Consumes: `facts.trackedSet` (Task 2's facts, unchanged).
- Produces:
  ```js
  // artifacts.mjs
  export function runEngineCounts(projectKey, sinceIso) // → Record<engine, number>; NULL engine counts as 'claude'
  // used.mjs
  export const HISTORY_DAYS = 90;
  export function toolFiles(facts)                       // → Record<engine, string>  e.g. { claude: 'CLAUDE.md', copilot: 'copilot-instructions.md' }
  export function usedEngines({ engines, runEngine, history = {}, files = {}, settings = {} })
  // → Record<engine, { used: boolean, setting: 'detect'|'used'|'unused', detected: boolean,
  //                    reasons: Array<{ kind: 'run-engine'|'history'|'file'|'setting', text: string }>,   // why it is judged (shown in the popover)
  //                    signals: Array<{ kind: 'run-engine'|'history'|'file', text: string }> }>          // what Detect finds, whatever the setting
  ```

- [ ] **Step 1: Write the failing tests**

`test/readiness-used.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { usedEngines, toolFiles } from '../src/core/repo-readiness/used.mjs';

const ENGINES = ['claude', 'codex', 'copilot', 'cursor'];
const used = (o) => usedEngines({ engines: ENGINES, runEngine: 'claude', ...o });
const usedNames = (r) => Object.entries(r).filter(([, v]) => v.used).map(([k]) => k);

describe('usedEngines', () => {
  it('a fresh project judges only the run engine', () => {
    const r = used({});
    assert.deepEqual(usedNames(r), ['claude']);
    assert.deepEqual(r.claude.reasons, [{ kind: 'run-engine', text: 'runs use it' }]);
    assert.equal(r.codex.detected, false);
  });

  it('run history inside the window counts', () => {
    const r = used({ history: { codex: 3 } });
    assert.deepEqual(usedNames(r), ['claude', 'codex']);
    assert.deepEqual(r.codex.reasons, [{ kind: 'history', text: 'used in 3 runs' }]);
  });

  it('one run reads "used in 1 run"', () => {
    assert.equal(used({ history: { codex: 1 } }).codex.reasons[0].text, 'used in 1 run');
  });

  it('a tool file counts', () => {
    const r = used({ files: { copilot: 'copilot-instructions.md' } });
    assert.deepEqual(r.copilot.reasons, [{ kind: 'file', text: 'copilot-instructions.md in repo' }]);
    assert.equal(r.copilot.used, true);
  });

  it('unused wins over every signal for that tool only', () => {
    const r = used({ files: { copilot: 'copilot-instructions.md' }, history: { codex: 2 }, settings: { copilot: 'unused' } });
    assert.equal(r.copilot.used, false);
    assert.equal(r.copilot.detected, true);
    assert.equal(r.copilot.setting, 'unused');
    assert.equal(r.codex.used, true, 'other tools keep detecting');
  });

  it('used wins over no signal', () => {
    const r = used({ settings: { cursor: 'used' } });
    assert.equal(r.cursor.used, true);
    assert.deepEqual(r.cursor.reasons, [{ kind: 'setting', text: 'set by you' }]);
  });

  it('the run engine is judged even when set to unused', () => {
    const r = used({ settings: { claude: 'unused' } });
    assert.equal(r.claude.used, true);
    assert.equal(r.claude.setting, 'unused');
    assert.deepEqual(r.claude.reasons, [{ kind: 'run-engine', text: 'runs use it' }]);
  });

  it('signals say what Detect finds even when the setting overrides it', () => {
    const r = used({ files: { copilot: 'copilot-instructions.md' }, settings: { copilot: 'used' } });
    assert.deepEqual(r.copilot.reasons, [{ kind: 'setting', text: 'set by you' }]);
    assert.deepEqual(r.copilot.signals, [{ kind: 'file', text: 'copilot-instructions.md in repo' }]);
  });

  it('an unknown setting value reads as detect', () => {
    assert.equal(used({ settings: { codex: 'maybe' } }).codex.setting, 'detect');
  });
});

describe('toolFiles', () => {
  const facts = (paths) => ({ trackedSet: new Set(paths) });
  it('maps each tool-specific file to its engine', () => {
    assert.deepEqual(toolFiles(facts(['CLAUDE.md', '.github/copilot-instructions.md', '.cursor/rules/a.mdc'])),
      { claude: 'CLAUDE.md', copilot: 'copilot-instructions.md', cursor: '.cursor/rules' });
  });
  it('AGENTS.md alone marks nothing', () => {
    assert.deepEqual(toolFiles(facts(['AGENTS.md', 'AGENTS.override.md'])), {});
  });
  it('.github/instructions counts for copilot', () => {
    assert.deepEqual(toolFiles(facts(['.github/instructions/api.instructions.md'])), { copilot: '.github/instructions' });
  });
  it('no tracked set: nothing', () => assert.deepEqual(toolFiles({}), {}));
});
```

`test/artifacts-run-engine-counts.test.mjs` (use the repo's temp home helper so the DB is isolated):

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { runEngineCounts } from '../src/core/artifacts.mjs';

describe('runEngineCounts', () => {
  const home = useTempHome({ before, after });
  it('counts runs per engine since a date; NULL engine is claude', () => {
    void home;
    const db = getDb();
    const ins = db.prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, started_at, outcome, resume_point)
      VALUES (?, 'pk', 'project', 'done', 'done', ?, ?, NULL)`);
    ins.run('a1', '2026-10-01T00:00:00Z', JSON.stringify({ runEngine: 'codex' }));
    ins.run('a2', '2026-10-02T00:00:00Z', JSON.stringify({ runEngine: 'codex' }));
    ins.run('a3', '2026-10-03T00:00:00Z', null);
    ins.run('a4', '2026-01-01T00:00:00Z', JSON.stringify({ runEngine: 'copilot' }));   // outside the window
    assert.deepEqual(runEngineCounts('pk', '2026-07-01T00:00:00Z'), { codex: 2, claude: 1 });
    assert.deepEqual(runEngineCounts('other', '2026-07-01T00:00:00Z'), {});
  });
});
```

Check `test/helpers/temp-home.mjs` for its real export signature before writing this file and adapt the two `useTempHome` lines to it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/readiness-used.test.mjs test/artifacts-run-engine-counts.test.mjs`
Expected: FAIL (modules/functions missing).

- [ ] **Step 3: Implement `runEngineCounts` in `artifacts.mjs`**

Right after `runEngineOfRow`:

```js
/** How many runs of `projectKey` started on or after `sinceIso` ran on each engine (NULL engine = 'claude').
 *  Indexed by idx_pipelines_project_started. Never throws: a DB problem answers {}. */
export function runEngineCounts(projectKey, sinceIso) {
  try {
    const rows = getDb().prepare(`SELECT COALESCE(${RUN_ENGINE_SQL}, 'claude') AS engine, COUNT(*) AS n
      FROM pipelines WHERE project_key = ? AND started_at >= ? GROUP BY 1`).all(projectKey, sinceIso);
    return Object.fromEntries(rows.map((r) => [r.engine, Number(r.n)]));
  } catch {
    return {};
  }
}
```

(`getDb` is already imported in `artifacts.mjs`; confirm with `grep -n "getDb" src/core/artifacts.mjs | head -2`.)

- [ ] **Step 4: Implement `used.mjs`**

```js
// src/core/repo-readiness/used.mjs
// Which engines a project uses, and why (spec 4.6). Pure: the caller passes settings, the run
// engine, run-history counts and the facts' tool files. AGENTS.md alone marks no engine.
export const HISTORY_DAYS = 90;
const SETTINGS = new Set(['used', 'unused']);

/** Tool-specific instruction files in the tracked set → { engine: text shown after "in repo" }. */
export function toolFiles(facts) {
  const t = facts?.trackedSet;
  if (!t) return {};
  const any = (prefix) => [...t].some((p) => p.startsWith(prefix));
  const out = {};
  if (t.has('CLAUDE.md')) out.claude = 'CLAUDE.md';
  else if (t.has('.claude/CLAUDE.md')) out.claude = '.claude/CLAUDE.md';
  if (t.has('.github/copilot-instructions.md')) out.copilot = 'copilot-instructions.md';
  else if (any('.github/instructions/')) out.copilot = '.github/instructions';
  if (any('.cursor/rules/')) out.cursor = '.cursor/rules';
  return out;
}

export function usedEngines({ engines, runEngine, history = {}, files = {}, settings = {} }) {
  const out = {};
  for (const name of engines) {
    const setting = SETTINGS.has(settings[name]) ? settings[name] : 'detect';
    const signals = [];
    if (name === runEngine) signals.push({ kind: 'run-engine', text: 'runs use it' });
    const n = Number(history[name]) || 0;
    if (n > 0) signals.push({ kind: 'history', text: `used in ${n} run${n === 1 ? '' : 's'}` });
    if (files[name]) signals.push({ kind: 'file', text: `${files[name]} in repo` });
    const detected = signals.length > 0;
    const isRun = name === runEngine;
    const used = isRun || setting === 'used' || (setting === 'detect' && detected);
    const reasons = isRun ? signals.slice(0, 1)
      : setting === 'used' ? [{ kind: 'setting', text: 'set by you' }]
      : setting === 'detect' ? signals.slice(0, 1) : [];
    out[name] = { used, setting, detected, reasons, signals };
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/readiness-used.test.mjs test/artifacts-run-engine-counts.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/repo-readiness/used.mjs src/core/artifacts.mjs test/readiness-used.test.mjs test/artifacts-run-engine-counts.test.mjs
git commit -m "Readiness: decide which engines a project uses"
```

---

### Task 4: The `readiness.tools` setting (project layer)

**Files:**
- Modify: `src/core/settings.mjs`, `src/core/settings-cascade.mjs`
- Test: `test/readiness-settings.test.mjs`

**Interfaces:**
- Produces: setting id `readiness.tools`, value `{ [engine]: 'used' | 'unused' }` (a missing key = Detect), project layer only, `team: null`. `SETTING_CHECKS.toolMap(value)`. `readinessTools(scope) → object` (never throws; `{}` when unset or invalid).

- [ ] **Step 1: Write the failing tests**

Append to `test/readiness-settings.test.mjs` (reuse the file's existing project setup helpers; the existing `readiness.ignore` tests show how to create a project and write project settings):

```js
import { readinessTools, SETTING_CHECKS } from '../src/core/settings.mjs';

describe('readiness.tools', () => {
  it('validates a map of engine to used|unused', () => {
    assert.equal(SETTING_CHECKS.toolMap({ codex: 'used', copilot: 'unused' }), true);
    assert.equal(SETTING_CHECKS.toolMap({}), true);
    assert.equal(SETTING_CHECKS.toolMap({ codex: 'detect' }), false, 'detect is written as a missing key');
    assert.equal(SETTING_CHECKS.toolMap(['codex']), false);
    assert.equal(SETTING_CHECKS.toolMap(null), false);
  });

  it('round-trips through project settings and is not inherited from the user layer', () => {
    // Use the same project fixture as the readiness.ignore tests above in this file.
    const scope = makeProjectScope();
    writeProjectSettings(scope, { 'readiness.tools': { copilot: 'unused' } });
    assert.deepEqual(readinessTools(scope), { copilot: 'unused' });
    writeProjectSettings(scope, { 'readiness.tools': null });
    assert.deepEqual(readinessTools(scope), {});
  });

  it('rejects an invalid value with a 400', () => {
    const scope = makeProjectScope();
    assert.throws(() => writeProjectSettings(scope, { 'readiness.tools': { codex: 'yes' } }), (e) => e.status === 400);
  });
});
```

`makeProjectScope` is whatever the existing `readiness.ignore` tests in this file use to get `{ projectDir, projectKey }`; if they inline it, extract it into a local helper in the same edit.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/readiness-settings.test.mjs`
Expected: FAIL (`readinessTools` / `toolMap` missing).

- [ ] **Step 3: Implement**

`settings.mjs`, inside `SETTING_CHECKS`:

```js
toolMap: (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every((v) => v === 'used' || v === 'unused'),
```

and next to `readinessIgnore`:

```js
/** The project's per-tool readiness choice: { engine: 'used'|'unused' }; a missing engine is Detect (project layer only). */
export function readinessTools(scope) {
  const value = projectOverride('readiness.tools', scope);
  return SETTING_CHECKS.toolMap(value) ? value : {};
}
```

`settings-cascade.mjs`, after the `readiness.ignore` entry:

```js
// Project layer now; the team layer is a follow-up (policy FIELDS + Team policy page).
{ id: 'readiness.tools', path: ['readiness', 'tools'], store: 'settings', default: {},
  readUser: () => undefined, readProject: (ctx) => dig(ctx.projectSettings(), ['readiness', 'tools']), team: null,
  validate: (value) => SETTING_CHECKS.toolMap(value), hint: 'must map engine names to "used" or "unused"' },
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/readiness-settings.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.mjs src/core/settings-cascade.mjs test/readiness-settings.test.mjs
git commit -m "Readiness: per-tool Detect / Used / Not used setting"
```

---

### Task 5: Final report from base report + usage

**Files:**
- Create: `src/core/repo-readiness/report.mjs`
- Modify: `src/core/repo-readiness/evaluate.mjs`
- Test: `test/readiness-report.test.mjs`, update `test/evaluate.test.mjs`

**Interfaces:**
- Consumes: `evaluateEngines` result (Task 2), `usedEngines` result (Task 3).
- Produces:
  ```js
  // evaluate.mjs
  evaluateReadiness({ dir, projectKey, ignore, timeoutMs }) // → base: { catalogVersion, checks, repository, engines }
  // report.mjs
  export function buildReport(base, usage) // → ReadinessReport:
  // { catalogVersion, level, repository, checks,
  //   engines: Record<name, { used, setting, detected, detectedReason: string|null, reasons, signals,
  //                           level /* tool level, 'unused' or 'locked' */, failing, locked? }>,
  //   checkedAt: string /* ISO, set by cache.mjs */,
  //   counts: { mustFix, shouldFix, passed, applicable } }
  export function summaryOf(report) // → { level, failingCount, mustFix, shouldFix, passed, applicable }
  ```
  `level` = worst of used engines' levels and `repository.level` (`unknown` if any is unknown; `not-ready` > `partial` > `ready`). `counts` cover repository checks + tool checks of **used** engines; `applicable` excludes `skip`, `error` and `ignored`; `mustFix`/`shouldFix` count failing `blocker`/`warn` rows; `failingCount = mustFix + shouldFix`.

- [ ] **Step 1: Write the failing test**

`test/readiness-report.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, summaryOf } from '../src/core/repo-readiness/report.mjs';

const row = (id, scope, severity, status, engine) => ({ id, title: id, scope, severity, status, fix: 'f', ...(engine ? { engine } : {}) });
const base = {
  catalogVersion: 2,
  checks: [
    row('git.repo', 'repository', 'blocker', 'pass'),
    row('commands.test', 'repository', 'warn', 'pass'),
    row('commands.build', 'repository', 'info', 'fail'),
    row('deps.lockfile', 'repository', 'warn', 'skip'),
    row('instructions.present', 'tool', 'blocker', 'pass', 'claude'),
    row('instructions.size', 'tool', 'warn', 'pass', 'claude'),
    row('instructions.present', 'tool', 'blocker', 'fail', 'codex'),
    row('instructions.committed', 'tool', 'warn', 'skip', 'codex'),
  ],
  repository: { level: 'ready', failing: ['commands.build'] },
  engines: { claude: { level: 'ready', failing: [] }, codex: { level: 'not-ready', failing: ['instructions.present'] } },
};
const usage = (codexUsed) => ({
  claude: { used: true, setting: 'detect', detected: true, reasons: [{ kind: 'run-engine', text: 'runs use it' }] },
  codex: { used: codexUsed, setting: codexUsed ? 'used' : 'detect', detected: false, reasons: codexUsed ? [{ kind: 'setting', text: 'set by you' }] : [] },
});

describe('buildReport', () => {
  it('fresh project: an unused tool never turns the chip red', () => {
    const r = buildReport(base, usage(false));
    assert.equal(r.level, 'ready');
    assert.equal(r.engines.codex.level, 'unused');
    assert.deepEqual(r.counts, { mustFix: 0, shouldFix: 0, passed: 4, applicable: 5 });   // info failing counts as applicable, not as a problem
    assert.deepEqual(summaryOf(r), { level: 'ready', failingCount: 0, mustFix: 0, shouldFix: 0, passed: 4, applicable: 5 });
  });

  it('a used tool with a blocker makes the project not-ready and counts once', () => {
    const r = buildReport(base, usage(true));
    assert.equal(r.level, 'not-ready');
    assert.equal(r.engines.codex.level, 'not-ready');
    assert.deepEqual(r.counts, { mustFix: 1, shouldFix: 0, passed: 4, applicable: 6 });
  });

  it('unknown anywhere among the judged makes the project unknown', () => {
    const r = buildReport({ ...base, repository: { level: 'unknown', failing: [] } }, usage(false));
    assert.equal(r.level, 'unknown');
  });

  it('passes the first detection signal through as detectedReason', () => {
    const u = usage(false);
    u.codex.signals = [{ kind: 'history', text: 'used in 2 runs' }];
    assert.equal(buildReport(base, u).engines.codex.detectedReason, 'used in 2 runs');
  });

  it('a locked engine is never used', () => {
    const locked = { ...base, engines: { ...base.engines, codex: { level: 'unknown', failing: [], locked: 'broker on' } } };
    const r = buildReport(locked, usage(true));
    assert.equal(r.engines.codex.used, false);
    assert.equal(r.engines.codex.level, 'locked');
    assert.equal(r.level, 'ready');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/readiness-report.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `report.mjs`**

```js
// src/core/repo-readiness/report.mjs
// The final readiness report (spec 4.7, 4.9): a cached base report plus usage, combined on every
// read so a settings change or a new run needs no re-evaluation. Pure.
const RANK = { ready: 0, partial: 1, 'not-ready': 2 };

function worst(levels) {
  if (levels.includes('unknown')) return 'unknown';
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ready');
}

export function buildReport(base, usage) {
  const engines = {};
  for (const [name, e] of Object.entries(base.engines || {})) {
    const u = usage[name] || { used: false, setting: 'detect', detected: false, reasons: [] };
    const used = u.used && !e.locked;
    engines[name] = {
      ...u, used,
      detectedReason: u.signals?.[0]?.text ?? null,
      level: e.locked ? 'locked' : used ? e.level : 'unused',
      failing: used ? e.failing : [],
      ...(e.locked ? { locked: e.locked } : {}),
    };
  }
  const usedNames = Object.keys(engines).filter((n) => engines[n].used);
  const judged = (c) => c.scope === 'repository' || usedNames.includes(c.engine);
  const rows = (base.checks || []).filter(judged);
  const applicable = rows.filter((c) => c.status === 'pass' || c.status === 'fail');
  const failing = applicable.filter((c) => c.status === 'fail');
  return {
    catalogVersion: base.catalogVersion,
    level: worst([base.repository?.level ?? 'unknown', ...usedNames.map((n) => engines[n].level)]),
    repository: base.repository,
    engines,
    checks: base.checks || [],
    counts: {
      mustFix: failing.filter((c) => c.severity === 'blocker').length,
      shouldFix: failing.filter((c) => c.severity === 'warn').length,
      passed: applicable.length - failing.length,
      applicable: applicable.length,
    },
  };
}

export function summaryOf(report) {
  const { mustFix, shouldFix, passed, applicable } = report.counts;
  return { level: report.level, failingCount: mustFix + shouldFix, mustFix, shouldFix, passed, applicable };
}
```

- [ ] **Step 4: Update `evaluate.mjs`**

Drop `primaryEngine`; return the base report:

```js
export async function evaluateReadiness({ dir, projectKey, ignore = [], timeoutMs = INTERACTIVE_TIMEOUT_MS } = {}) {
  try {
    const facts = collectFacts(dir, { timeoutMs });
    if (facts.error) logError(projectKey, 'facts', facts.error);
    const { checks, repository, engines } = evaluateEngines(facts, { ignore });
    return { catalogVersion: CATALOG_VERSION, checks, repository, engines, files: toolFiles(facts) };
  } catch (e) {
    logError(projectKey, 'evaluate', e);
    return unknownReport();
  }
}
```

with `import { toolFiles } from './used.mjs';` and `unknownReport()` returning `{ catalogVersion, checks: [], repository: { level: 'unknown', failing: [] }, engines /* every DECLARED engine unknown */, files: {} }`. Update `test/evaluate.test.mjs` assertions to the base shape (`repository`, `files`, rows with `scope`).

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/readiness-report.test.mjs test/evaluate.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/repo-readiness/report.mjs src/core/repo-readiness/evaluate.mjs test/readiness-report.test.mjs test/evaluate.test.mjs
git commit -m "Readiness: final report from base report and tool usage"
```

---

### Task 6: Cache, server, snapshot and CLI use the final report

**Files:**
- Modify: `src/core/repo-readiness/cache.mjs`, `src/core/repo-readiness/snapshot.mjs`, `ui/server.mjs`, `src/cli/worca-cc.mjs`
- Test: `test/cache.test.mjs`, `test/readiness-routes.test.mjs`, `test/run-readiness-snapshot.test.mjs`, `test/readiness-cli.test.mjs`

**Interfaces:**
- Consumes: `evaluateReadiness` (base), `buildReport`, `summaryOf`, `usedEngines`, `HISTORY_DAYS`, `runEngineCounts`, `readinessTools`, `readinessIgnore`, `resolveRunEngine`.
- Produces:
  ```js
  // cache.mjs
  export function getCachedOrEvaluate({ dir, projectKey, ignore, usage /* () => usageInputs */, timeoutMs, force }) // → Promise<ReadinessReport>
  export function readinessSummary(projectKey) // → summaryOf(last built report) | null
  export function usageInputs({ projectKey, projectDir, runEngine, now }) // → { runEngine, history, settings }
  // server: GET /api/projects rows: readiness = summaryOf | null
  // server: GET /api/projects/:key/readiness → { readiness: ReadinessReport | null }
  // ws: { type: 'readiness-changed', action: projectKey } after a readiness.* settings PATCH
  // snapshot run.json: { catalogVersion, engine, level, failing } where level = worst(tool level of the run engine, repository)
  // CLI: worca readiness [--project p] [--engine e]... [--json] [--force]
  ```

- [ ] **Step 1: Write the failing tests**

`test/cache.test.mjs` — add:

```js
it('builds the final report on every read: a usage change needs no re-evaluation', async () => {
  // reuse this file's repo helper; CLAUDE.md committed, no AGENTS.md
  await withRepo(async (dir) => {
    let calls = 0;
    const evaluate = async (o) => { calls++; return realEvaluate(o); };
    _setEvaluateForTest(evaluate);
    try {
      const usageA = () => ({ runEngine: 'claude', history: {}, settings: {} });
      const usageB = () => ({ runEngine: 'claude', history: {}, settings: { codex: 'used' } });
      const a = await getCachedOrEvaluate({ dir, projectKey: 'k', usage: usageA });
      const b = await getCachedOrEvaluate({ dir, projectKey: 'k', usage: usageB });
      assert.equal(calls, 1);
      assert.equal(a.engines.codex.level, 'unused');
      assert.equal(b.engines.codex.level, 'not-ready');
      assert.equal(readinessSummary('k').level, 'not-ready');
      assert.ok(a.checkedAt && a.checkedAt === b.checkedAt, 'checkedAt is the evaluation time, not the read time');
    } finally { _setEvaluateForTest(null); }
  });
});
```

`test/readiness-routes.test.mjs` — add, using the file's existing server harness:

```js
it('PATCH readiness.tools emits readiness-changed and the summary follows', async () => {
  const key = await addFixtureProject({ claudeMd: true });           // this file's existing helper
  await get(`/api/projects/${key}/readiness`);                        // warm the cache
  const frame = waitForFrame('readiness-changed');
  await patch(`/api/projects/${key}/settings`, { 'readiness.tools': { codex: 'used' } });
  assert.equal((await frame).action, key);
  const { projects } = await get('/api/projects');
  const s = projects.find((p) => p.key === key).readiness;
  assert.equal(s.level, 'not-ready');
  assert.equal(s.failingCount, 1);
});

it('GET /api/projects summary has counts and no primaryEngine', async () => {
  const key = await addFixtureProject({ claudeMd: true });
  await get(`/api/projects/${key}/readiness`);
  const s = (await get('/api/projects')).projects.find((p) => p.key === key).readiness;
  assert.deepEqual(Object.keys(s).sort(), ['applicable', 'failingCount', 'level', 'mustFix', 'passed', 'shouldFix']);
});
```

If the harness has no `waitForFrame`, read how the existing `readiness-changed` test in this file observes frames and use that.

`test/run-readiness-snapshot.test.mjs` — add: a run on `codex` in a repo with `CLAUDE.md` only and `readiness.tools = { codex: 'unused' }` writes `level: 'not-ready'`, `engine: 'codex'`, `failing` containing `instructions.present` (the run's engine is judged regardless of the setting).

`test/readiness-cli.test.mjs` — add: `--engine codex --engine copilot` prints `Judged: OpenAI Codex, GitHub Copilot` and exits 2 when either is not ready; without `--engine` the output starts with `Judged: Claude Code (runs use it)` for a fresh repo and exits 0 when Claude is ready.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/cache.test.mjs test/readiness-routes.test.mjs test/run-readiness-snapshot.test.mjs test/readiness-cli.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `cache.mjs`**

```js
import { evaluateReadiness as realEvaluate } from './evaluate.mjs';
import { buildReport, summaryOf } from './report.mjs';
import { usedEngines, HISTORY_DAYS } from './used.mjs';
import { runEngineCounts } from '../artifacts.mjs';
import { readinessTools } from '../settings.mjs';

let evaluate = realEvaluate;
/** Test seam: count or replace evaluations. null restores the real one. */
export function _setEvaluateForTest(fn) { evaluate = fn || realEvaluate; }

const entries = new Map();   // projectKey → { fingerprint, base, report }

/** Inputs usedEngines needs that are not in the base report. Never throws. */
export function usageInputs({ projectKey, projectDir, runEngine, now = Date.now() }) {
  const since = new Date(now - HISTORY_DAYS * 86_400_000).toISOString();
  let settings = {};
  try { settings = readinessTools({ projectDir, projectKey }); } catch { settings = {}; }
  return { runEngine, history: runEngineCounts(projectKey, since), settings };
}

function finish(projectKey, base, usage) {
  const u = usage();
  const report = buildReport(base, usedEngines({ engines: Object.keys(base.engines), files: base.files, ...u }));
  const entry = entries.get(projectKey);
  const before = entry?.report ? JSON.stringify(summaryOf(entry.report)) + JSON.stringify(levels(entry.report)) : null;
  if (entry) entry.report = report;
  const after = JSON.stringify(summaryOf(report)) + JSON.stringify(levels(report));
  if (before !== null && before !== after) cache.emit('changed', { projectKey });
  return report;
}
const levels = (r) => Object.entries(r.engines).map(([n, e]) => [n, e.level, e.failing]).sort();
```

`getCachedOrEvaluate` keeps its fingerprint and in-flight logic, stores `{ fingerprint, base, evaluatedAt: Date.now(), report: null }`, and resolves with `finish(projectKey, base, usage)` on both the hit and the miss path. `finish` adds `checkedAt: new Date(entry.evaluatedAt).toISOString()` to the report it builds (the popover's "Checked 8 min ago"). `readinessSummary(projectKey)` returns `entries.get(projectKey)?.report ? summaryOf(that report) : null`. Delete `enginesSignature` and `primaryEngine`.

- [ ] **Step 4: Implement the server changes in `ui/server.mjs`**

Replace `readinessEngine`/`getReadiness`:

```js
const readinessRunEngine = (p) => resolveRunEngine({ projectDir: p.path, projectKey: p.key }).engine || 'claude';
async function getReadiness(p, { refresh = false } = {}) {
  try {
    return await getCachedOrEvaluate({
      dir: p.path, projectKey: p.key, timeoutMs: INTERACTIVE_TIMEOUT_MS, force: refresh,
      ignore: readinessIgnore({ projectDir: p.path, projectKey: p.key }),
      usage: () => usageInputs({ projectKey: p.key, projectDir: p.path, runEngine: readinessRunEngine(p) }),
    });
  } catch (err) {
    console.error(`[worca-ui] readiness ${p.key}: ${err && err.message ? err.message : err}`);
    return null;
  }
}
```

In `evaluateAddedProject`, replace the primary-engine test with "any used engine not-ready":

```js
const notReady = Object.entries(report.engines || {}).find(([, e]) => e.used && e.level === 'not-ready');
if (notReady) broadcast({ type: 'readiness-added', projectKey: p.key, name: p.name, engine: engineLabel(notReady[0]) });
```

(import `engineLabel` from `../src/shared/engine-switch.mjs` if `server.mjs` does not already.)

In `PATCH /api/projects/:key/settings`, after a successful write, when the patch has a key starting with `readiness.`:

```js
if (Object.keys(req.body || {}).some((id) => id.startsWith('readiness.'))) {
  void getReadiness(p, { refresh: Object.hasOwn(req.body, 'readiness.ignore') }).then(() => emitChanged('readiness-changed', p.key));
}
```

(`readiness.ignore` changes the base report, so it refreshes; `readiness.tools` only changes usage.)

- [ ] **Step 5: Implement `snapshot.mjs`**

```js
const base = await evaluateReadiness({ dir, projectKey, ignore: skip, timeoutMs: INTERACTIVE_TIMEOUT_MS });
const tool = base?.engines?.[engine];
if (!tool) return null;
const RANK = { ready: 0, partial: 1, 'not-ready': 2, unknown: 3 };
const level = [tool.level, base.repository.level].reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
const readiness = { catalogVersion: base.catalogVersion, engine, level, failing: [...base.repository.failing, ...tool.failing] };
```

- [ ] **Step 6: Implement the CLI changes in `cmdReadiness`**

- `--engine` becomes repeatable: `opts.engines = []`, push each value.
- Build the final report: `const report = buildReport(base, opts.engines.length ? Object.fromEntries(Object.keys(base.engines).map((n) => [n, { used: opts.engines.includes(n), setting: 'used', detected: false, reasons: [{ kind: 'setting', text: '--engine' }] }])) : usedEngines({ engines: Object.keys(base.engines), files: base.files, ...usageInputs({ projectKey: key, projectDir: dir, runEngine }) }))`.
- Unknown `--engine` names still fail with the existing message.
- Output, first lines:
  ```
  Project: <name> (<dir>)
  Judged: Claude Code (runs use it), OpenAI Codex (used in 3 runs)
  Result: Not ready. 1 must fix, 1 should fix. 5 of 9 checks pass.
  ```
  then the existing Blocker failures / Warnings blocks restricted to repository rows and tool rows of judged engines, each tool row suffixed with ` (<engineLabel>)`.
- Exit: `2` when `report.level === 'not-ready'`, `1` when `unknown`, else `0`. `--json` prints the final report.
- Usage strings: `worca readiness [--project <key|path>] [--engine <name>]... [--json] [--force]` in both places.

- [ ] **Step 7: Run to verify pass**

Run: `node --test test/cache.test.mjs test/readiness-routes.test.mjs test/run-readiness-snapshot.test.mjs test/readiness-cli.test.mjs test/readiness-integration.test.mjs`
Expected: PASS (update old `primaryEngine` assertions in these files to the new shape).

- [ ] **Step 8: Commit**

```bash
git add src/core/repo-readiness/cache.mjs src/core/repo-readiness/snapshot.mjs ui/server.mjs src/cli/worca-cc.mjs test/
git commit -m "Readiness: judge used tools only in cache, routes, run snapshot and CLI"
```

---

### Task 7: Flyout mode `below`

**Files:**
- Modify: `ui/public/side-flyout.mjs`
- Test: `test/side-flyout.test.mjs` (create if absent; else add to the existing file — check with `ls test | grep -i flyout`)

**Interfaces:**
- Produces: `placeFlyout(menu, trigger, { mode: 'below' })`: `left = trigger.left` (clamped to the viewport), `top = trigger.bottom + gap`, and `menu.style.maxHeight = (vh - top - margin) + 'px'`. It never moves the menu above the trigger. `createFlyout({ mode: 'below' })` passes it through.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { placeFlyout } from '../ui/public/side-flyout.mjs';

describe('placeFlyout below', () => {
  it('opens under the trigger, left-aligned, and limits its height instead of covering the trigger', () => {
    const { window } = new JSDOM('<button id="t"></button><div id="m"></div>');
    const doc = window.document;
    const trigger = doc.getElementById('t');
    const menu = doc.getElementById('m');
    trigger.getBoundingClientRect = () => ({ left: 300, right: 420, top: 600, bottom: 622, width: 120, height: 22 });
    Object.defineProperty(menu, 'offsetWidth', { value: 460 });
    Object.defineProperty(menu, 'offsetHeight', { value: 560 });
    const win = { innerWidth: 1200, innerHeight: 900 };
    placeFlyout(menu, trigger, { mode: 'below', win });
    assert.equal(menu.style.left, '300px');
    assert.equal(menu.style.top, '628px');
    assert.equal(menu.style.maxHeight, '264px');   // 900 - 628 - 8
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/side-flyout.test.mjs`
Expected: FAIL (`top` clamped to 332px, no maxHeight).

- [ ] **Step 3: Implement**

In `placeFlyout`, before the final clamps:

```js
if (mode === 'below') {
  const top = t.bottom + gap;
  const left = Math.max(margin, Math.min(t.left, vw - w - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${Math.max(120, vh - top - margin)}px`;
  return;
}
```

Add `below` to the mode list in the doc comment: `mode 'below' : left = trigger.left; top = trigger.bottom + gap; height limited to the room below (never covers the trigger)`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/side-flyout.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/side-flyout.mjs test/side-flyout.test.mjs
git commit -m "Flyout: a below mode that never covers its trigger"
```

---

### Task 8: The chip and the pure view model

**Files:**
- Modify: `ui/public/readiness-chip.mjs`, `ui/public/style.css`
- Test: `test/readiness-chip.test.mjs`, `test/readiness-styles.test.mjs`

**Interfaces:**
- Consumes: the summary from `GET /api/projects` (Task 6) and the final report (Task 5).
- Produces (`readiness-chip.mjs`):
  ```js
  export const CHIP_WORDS   // { ready: 'Agent-ready', partial: 'Partly ready', 'not-ready': 'Not agent-ready' }
  export const LEVEL_WORDS  // { ready: 'Ready', partial: 'Partly ready', 'not-ready': 'Not ready', unused: 'Not used' }
  export function chipTooltip(summary)            // "1 must fix, 1 should fix. 5 of 9 checks pass."
  export function renderReadinessChip(summary, { doc })   // <span class="pl-rd rd-<level>">word<span class="rd-n">N</span></span> | null
  export function renderLevelLabel(level, { doc })        // <span class="rd-lbl rd-<level>">word</span>
  export function readinessMenuModel(report, { engineLabel }) // pure: everything the popover paints (below)
  export function readinessAddedToast(msg, opts)  // unchanged signature
  ```
  `readinessMenuModel` returns:
  ```js
  { level, countLine: '5 of 9 checks pass',
    tools: [{ name, label, reason, level, detail, fix, runs: boolean }],       // used engines, run engine first
    notJudged: ['OpenAI Codex', 'GitHub Copilot'],                            // labels, in listEngines order
    failing: { blocker: [row], warn: [row], info: [row] },                    // repository rows only
    passed: [{ title, detail }],                                              // repository + used tools' tool rows
    ignored: [{ id, title }] }
  ```
  A tool row's `detail`/`fix` come from that engine's first failing tool check (`null` when ready). `runs` is true for the engine whose reasons include `kind: 'run-engine'`. Tool-row titles in `passed` read `"<title> (<label>)"`.

- [ ] **Step 1: Write the failing tests**

Replace the chip tests in `test/readiness-chip.test.mjs` with:

```js
import { renderReadinessChip, chipTooltip, readinessMenuModel } from '../ui/public/readiness-chip.mjs';

const doc = () => new JSDOM().window.document;
const summary = (o) => ({ level: 'not-ready', failingCount: 2, mustFix: 1, shouldFix: 1, passed: 5, applicable: 9, ...o });

describe('renderReadinessChip v2', () => {
  it('not-ready: words, a count disc, no dot', () => {
    const chip = renderReadinessChip(summary(), { doc: doc() });
    assert.equal(chip.className, 'pl-rd rd-not-ready');
    assert.equal(chip.firstChild.textContent, 'Not agent-ready');
    assert.equal(chip.querySelector('.rd-n').textContent, '2');
    assert.equal(chip.querySelector('.rd-dot'), null);
  });
  it('ready has no number even with advice failing', () => {
    const chip = renderReadinessChip(summary({ level: 'ready', failingCount: 0, mustFix: 0, shouldFix: 0, passed: 7 }), { doc: doc() });
    assert.equal(chip.textContent, 'Agent-ready');
    assert.equal(chip.querySelector('.rd-n'), null);
  });
  it('tooltip and accessible name spell out the count', () => {
    assert.equal(chipTooltip(summary()), '1 must fix, 1 should fix. 5 of 9 checks pass.');
    assert.equal(chipTooltip(summary({ mustFix: 0, shouldFix: 0, failingCount: 0 })), '5 of 9 checks pass.');
    const chip = renderReadinessChip(summary(), { doc: doc() });
    assert.equal(chip.title, '1 must fix, 1 should fix. 5 of 9 checks pass.');
    assert.equal(chip.getAttribute('aria-label'), 'Not agent-ready, 2 open problems. 1 must fix, 1 should fix. 5 of 9 checks pass.');
  });
  it('no copy uses a middle dot', () => {
    assert.doesNotMatch(chipTooltip(summary()), /·/);
  });
});

describe('readinessMenuModel', () => {
  const label = (n) => ({ claude: 'Claude Code', codex: 'OpenAI Codex', copilot: 'GitHub Copilot', cursor: 'Cursor' })[n];
  const report = {
    level: 'partial',
    counts: { mustFix: 0, shouldFix: 1, passed: 9, applicable: 12 },
    engines: {
      claude: { used: true, level: 'ready', reasons: [{ kind: 'run-engine', text: 'runs use it' }], failing: [] },
      codex: { used: false, level: 'unused', reasons: [], failing: [] },
      copilot: { used: true, level: 'partial', reasons: [{ kind: 'file', text: 'copilot-instructions.md in repo' }], failing: ['instructions.size'] },
    },
    checks: [
      { id: 'commands.build', title: 'Build command', scope: 'repository', severity: 'info', status: 'fail', detail: 'no build command discoverable', fix: 'Add a build script.' },
      { id: 'commands.test', title: 'Test command', scope: 'repository', severity: 'warn', status: 'pass', detail: '`npm test` in package.json', fix: 'x' },
      { id: 'deps.lockfile', title: 'Lockfile', scope: 'repository', severity: 'warn', status: 'ignored', fix: 'x' },
      { id: 'instructions.present', title: 'Agent instructions', scope: 'tool', engine: 'claude', severity: 'blocker', status: 'pass', detail: 'CLAUDE.md found', fix: 'x' },
      { id: 'instructions.size', title: 'Instruction size', scope: 'tool', engine: 'copilot', severity: 'warn', status: 'fail', detail: 'copilot-instructions.md is 52 KB, over the 40 KB limit', fix: 'Trim it.' },
      { id: 'instructions.present', title: 'Agent instructions', scope: 'tool', engine: 'codex', severity: 'blocker', status: 'fail', detail: 'none', fix: 'x' },
    ],
  };
  const m = readinessMenuModel(report, { engineLabel: label });

  it('lists used tools, run engine first, with reason, level and the failing detail', () => {
    assert.deepEqual(m.tools.map((t) => [t.label, t.reason, t.level, t.runs]),
      [['Claude Code', 'runs use it', 'ready', true], ['GitHub Copilot', 'copilot-instructions.md in repo', 'partial', false]]);
    assert.equal(m.tools[1].detail, 'copilot-instructions.md is 52 KB, over the 40 KB limit');
    assert.equal(m.tools[1].fix, 'Trim it.');
    assert.equal(m.tools[0].detail, null);
  });
  it('names the tools that are not judged', () => assert.deepEqual(m.notJudged, ['OpenAI Codex']));
  it('repository failures are grouped by severity; unused tools never appear', () => {
    assert.deepEqual(m.failing.info.map((r) => r.id), ['commands.build']);
    assert.equal(m.failing.blocker.length, 0);
  });
  it('passed covers repository and used tools only', () => {
    assert.deepEqual(m.passed.map((p) => p.title), ['Test command', 'Agent instructions (Claude Code)']);
  });
  it('ignored and the count line', () => {
    assert.deepEqual(m.ignored, [{ id: 'deps.lockfile', title: 'Lockfile' }]);
    assert.equal(m.countLine, '9 of 12 checks pass');
  });
});
```

Update `test/readiness-styles.test.mjs`: drop the dot assertions; add

```js
it('labels have no border, ring or dot', () => {
  for (const sel of ['.pl-rd', '.pl-rd:hover', '.rd-lbl']) {
    const body = ruleBody(sel) || '';
    assert.doesNotMatch(body, /box-shadow|border:/, `${sel} has no ring or border`);
  }
  assert.ok(!bare.includes('.rd-dot'), 'no dot rule');
});
it('the count disc is regular weight and uses --panel', () => {
  const body = ruleBody('.pl-rd .rd-n');
  assert.match(body, /font-weight:500/);
  assert.match(body, /color:var\(--panel\)/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/readiness-chip.test.mjs test/readiness-styles.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `readiness-chip.mjs`**

```js
export const CHIP_WORDS = Object.freeze({ ready: 'Agent-ready', partial: 'Partly ready', 'not-ready': 'Not agent-ready' });
export const LEVEL_WORDS = Object.freeze({ ready: 'Ready', partial: 'Partly ready', 'not-ready': 'Not ready', unused: 'Not used' });

export function chipTooltip(s) {
  const parts = [s.mustFix && `${s.mustFix} must fix`, s.shouldFix && `${s.shouldFix} should fix`].filter(Boolean);
  return `${parts.length ? `${parts.join(', ')}. ` : ''}${s.passed} of ${s.applicable} checks pass.`;
}

export function renderReadinessChip(summary, { doc = globalThis.document } = {}) {
  if (!summary || !CHIP_WORDS[summary.level]) return null;
  const span = doc.createElement('span');
  span.className = `pl-rd rd-${summary.level}`;
  span.append(doc.createTextNode(CHIP_WORDS[summary.level]));
  const n = summary.level === 'ready' ? 0 : summary.failingCount;
  if (n > 0) span.append(Object.assign(doc.createElement('span'), { className: 'rd-n', textContent: String(n) }));
  const tip = chipTooltip(summary);
  span.title = tip;
  span.setAttribute('aria-label', `${CHIP_WORDS[summary.level]}${n ? `, ${n} open problem${n > 1 ? 's' : ''}` : ''}. ${tip}`);
  return span;
}

export function renderLevelLabel(level, { doc = globalThis.document } = {}) {
  return Object.assign(doc.createElement('span'), { className: `rd-lbl rd-${level}`, textContent: LEVEL_WORDS[level] || '' });
}

export function readinessMenuModel(report, { engineLabel }) {
  const engines = Object.entries(report.engines || {});
  const usedNames = engines.filter(([, e]) => e.used).map(([n]) => n);
  const runs = (e) => (e.reasons || []).some((r) => r.kind === 'run-engine');
  const ordered = [...usedNames].sort((a, b) => Number(runs(report.engines[b])) - Number(runs(report.engines[a])));
  const checks = report.checks || [];
  const tools = ordered.map((n) => {
    const e = report.engines[n];
    const fail = checks.find((c) => c.scope === 'tool' && c.engine === n && c.status === 'fail');
    return { name: n, label: engineLabel(n), reason: e.reasons?.[0]?.text || '', level: e.level,
      detail: fail ? fail.detail || null : null, fix: fail ? fail.fix : null, runs: runs(e) };
  });
  const repo = checks.filter((c) => c.scope === 'repository');
  const failing = { blocker: [], warn: [], info: [] };
  for (const c of repo) if (c.status === 'fail') failing[c.severity].push(c);
  const passed = [
    ...repo.filter((c) => c.status === 'pass').map((c) => ({ title: c.title, detail: c.detail || '' })),
    ...checks.filter((c) => c.scope === 'tool' && usedNames.includes(c.engine) && c.status === 'pass')
      .map((c) => ({ title: `${c.title} (${engineLabel(c.engine)})`, detail: c.detail || '' })),
  ];
  const seen = new Set();
  const ignored = checks.filter((c) => c.status === 'ignored' && !seen.has(c.id) && seen.add(c.id)).map((c) => ({ id: c.id, title: c.title }));
  return {
    level: report.level,
    countLine: `${report.counts.passed} of ${report.counts.applicable} checks pass`,
    tools,
    notJudged: engines.filter(([, e]) => !e.used && e.level !== 'locked').map(([n]) => engineLabel(n)),
    failing, passed, ignored,
  };
}
```

Keep `readinessAddedToast` as it is.

- [ ] **Step 4: Implement the CSS**

In `ui/public/style.css`, replace the branch's readiness block (from `/* Repo-readiness chip` to the end of the file) with:

```css
/* Agent readiness: the row chip, its popover and the settings card. Labels are text on a tinted pill: no dot,
   no border, no ring (also on hover). The count disc is the app's number disc, solid, regular weight. */
.pl-rd{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;
  line-height:1;cursor:pointer;user-select:none;}
.pl-rd:focus-visible{outline:2px solid var(--blue);outline-offset:2px;}
.rd-ready{background:var(--green-bg);color:var(--green-ink);}
.rd-partial{background:var(--amber-bg);color:var(--amber-ink-strong);}
.rd-not-ready{background:var(--red-bg);color:var(--red-ink);}
.rd-unused{background:var(--field);color:var(--ink-2);}
.pl-rd .rd-n{display:inline-grid;place-items:center;min-width:18px;height:18px;margin-right:-5px;padding:0 5px;border-radius:999px;
  font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--panel);}
.rd-partial .rd-n{background:var(--amber-ink-strong);}
.rd-not-ready .rd-n{background:var(--red-ink);}
.rd-lbl{display:inline-flex;align-items:center;flex:none;height:22px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;}

.readiness-pop{width:460px;display:flex;flex-direction:column;}
.rp-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 12px;border-bottom:1px solid var(--line);}
.rp-title{font-weight:600;font-size:14px;}
.rp-sub{display:block;font-weight:400;font-size:12px;color:var(--ink-3);}
.rp-count{display:block;margin-top:2px;border:0;background:none;padding:0;font:inherit;font-size:12px;font-weight:500;color:var(--blue-ink-strong);cursor:pointer;text-align:left;}
.rp-count:hover{text-decoration:underline;}
.rp-body{flex:1 1 auto;min-height:0;overflow:auto;padding-bottom:8px;}
.rp-sec{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:14px 16px 4px;}
.rp-sec h3{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);}
.rp-sec span{font-size:11.5px;color:var(--ink-3);}
.rp-tool{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:8px 16px;}
.rp-tool-n{font-weight:600;font-size:13px;}
.rp-tool-n small{font-weight:500;font-size:12px;color:var(--ink-3);}
.rp-tool-d,.rp-tool-f,.rp-hint{grid-column:1 / -1;font-size:12.5px;}
.rp-tool-d{color:var(--ink-2);}
.rp-hint{font-size:12px;color:var(--ink-3);}
.rp-act{grid-column:1 / -1;justify-self:start;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--blue-ink-strong);cursor:pointer;}
.rp-act:hover{text-decoration:underline;}
.rp-notjudged{padding:4px 16px 2px;font-size:12px;color:var(--ink-3);}
.rp-notjudged a{color:var(--blue-ink-strong);text-decoration:none;font-weight:500;}
.rp-notjudged a:hover{text-decoration:underline;}
.rp-chk{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:2px 10px;padding:8px 16px;}
.rp-chk:hover{background:var(--field);}
.rp-sev{margin-top:5px;width:10px;height:10px;border-radius:50%;border:2px solid currentColor;}
.rp-sev.blocker{color:var(--red);background:var(--red);}
.rp-sev.warn{color:var(--amber);}
.rp-sev.info{color:var(--ink-3);}
.rp-chk-t{font-weight:600;font-size:13px;}
.rp-chk-d{grid-column:2;font-size:12.5px;color:var(--ink-2);}
.rp-chk-f{grid-column:2;font-size:12.5px;}
.rp-ign{grid-row:1;grid-column:3;align-self:start;border:0;background:none;font:inherit;font-size:12px;color:var(--ink-3);cursor:pointer;padding:2px 4px;border-radius:6px;}
.rp-ign:hover{color:var(--ink);background:var(--hover);}
.rp-more{margin:8px 16px 0;border-radius:10px;background:var(--field);}
.rp-more + .rp-more{margin-top:6px;}
.rp-more summary{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:12.5px;font-weight:500;color:var(--ink-2);cursor:pointer;list-style:none;border-radius:10px;}
.rp-more summary::-webkit-details-marker{display:none;}
.rp-more summary:hover{color:var(--ink);}
.rp-more summary .rp-chev{margin-left:auto;flex:none;width:8px;height:8px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px);}
.rp-more[open] summary .rp-chev{transform:rotate(225deg) translateY(-1px);}
.rp-tick{flex:none;position:relative;width:7px;height:12px;}
.rp-tick::before{content:"";position:absolute;left:0;top:2px;width:9px;height:5px;border-left:1.6px solid var(--green);border-bottom:1.6px solid var(--green);transform:rotate(-45deg);}
.rp-gdot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--ink-3);}
.rp-more ul{list-style:none;margin:0 10px;padding:0 0 8px;}
.rp-more li{margin-left:15px;padding:6px 0;border-top:1px solid var(--line-2);}
.rp-more li b{display:block;font-weight:600;font-size:12.5px;}
.rp-more li span{display:block;font-size:12px;color:var(--ink-2);}
.rp-more li .rp-ign{display:inline;padding:0;margin-top:2px;}
.rp-foot{flex:none;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-3);}
.rp-foot .rp-sp{flex:1;}
.rp-foot a{color:var(--blue-ink-strong);text-decoration:none;font-weight:500;}

.readiness-settings-card{padding:16px;border:1px solid var(--line);border-radius:var(--r-card);margin-bottom:16px;}
.readiness-settings-card h3{margin:0 0 4px;font-size:13px;font-weight:600;}
.rs-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;align-items:center;padding:12px 0;border-top:1px solid var(--line);}
.rs-row:first-of-type{border-top:0;}
.rs-name{font-weight:600;font-size:13px;}
.rs-find{grid-column:1;font-size:12px;color:var(--ink-2);}
.rs-row .seg{grid-row:1 / span 2;grid-column:2;}
.rs-row .seg button:disabled{color:var(--ink-3);cursor:not-allowed;opacity:.6;}
.rs-note{grid-column:1 / -1;font-size:12px;color:var(--ink-3);}
@media (max-width:560px){.rs-row{grid-template-columns:minmax(0,1fr);}.rs-row .seg{grid-row:auto;grid-column:1;justify-self:start;}}
```

Check `--blue`, `--hover`, `--field` and `.seg.seg-sm` exist in `style.css` (`grep -n "^\.seg\b\|--hover:" ui/public/style.css`); they do on `dev` today.

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/readiness-chip.test.mjs test/readiness-styles.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/public/readiness-chip.mjs ui/public/style.css test/readiness-chip.test.mjs test/readiness-styles.test.mjs
git commit -m "Readiness chip: open-problem count, no dot or ring; popover view model"
```

---

### Task 9: The popover

**Files:**
- Modify: `ui/public/app.js` (the `// ---- Agent readiness` block: `newReadinessChip`, `openReadinessMenu`, `paintReadinessMenu`, `buildReadinessMenu`, `setReadinessIgnore`; the `readiness-changed` handler)
- Test: `test/readiness-ui.test.mjs`

**Interfaces:**
- Consumes: `readinessMenuModel`, `renderLevelLabel`, `LEVEL_WORDS` (Task 8), `engineLabel` (already imported in app.js — check with `grep -n "engineLabel" ui/public/app.js | head -2`), `createFlyout` with `mode: 'below'` (Task 7), `notify` (feedback.mjs), the final report from `GET /api/projects/:key/readiness`.
- Produces:
  ```js
  async function setReadinessTool(key, engine, value)   // value 'used'|'unused'|'detect'; resolves to the previous value, or null on failure
  function openReadinessSettings(key)                    // location.hash = `projects/${key}/settings`, then scroll the card into view
  ```

- [ ] **Step 1: Write the failing tests**

In `test/readiness-ui.test.mjs`, replace the `breakdown flyout` describe with:

```js
describe('readiness UI: popover v2', () => {
  it('opens below the chip', () => {
    assert.match(fnSource('newReadinessChip'), /mode: 'below'/);
  });
  it('builds from the pure model and never from innerHTML', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /readinessMenuModel\(/);
    assert.doesNotMatch(src, /innerHTML/);
  });
  it('has a fixed head, a scrolling body and a fixed foot', () => {
    const src = fnSource('buildReadinessMenu');
    for (const cls of ['rp-head', 'rp-body', 'rp-foot']) assert.match(src, new RegExp(cls));
  });
  it('offers "Not used here" with an Undo toast that restores the previous value', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Not used here/);
    assert.match(src, /setReadinessTool\(key, t\.name, 'unused'\)/);
    assert.match(src, /label: 'Undo'/);
    assert.match(src, /setReadinessTool\(key, t\.name, prev\)/);
  });
  it('the run engine gets the hint instead of the button', () => {
    assert.match(fnSource('buildReadinessMenu'), /Runs use this tool\. To stop judging it, change the engine in Settings\./);
  });
  it('the not-judged line links to project settings', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Not judged: /);
    assert.match(src, /Change in Settings/);
    assert.match(src, /openReadinessSettings\(key\)/);
  });
  it('the header count opens the passed box', () => {
    assert.match(fnSource('buildReadinessMenu'), /rp-count[\s\S]{0,400}passedBox\.open = true/);
  });
  it('ignored checks can be restored from the popover', () => {
    assert.match(fnSource('buildReadinessMenu'), /Stop ignoring/);
  });
  it('no middle dot in any readiness copy', () => {
    for (const name of ['buildReadinessMenu', 'fillReadinessCard']) assert.doesNotMatch(fnSource(name), /·/);
  });
  it('setReadinessTool writes the whole map and returns the previous value', () => {
    const src = fnSource('setReadinessTool');
    assert.match(src, /'readiness\.tools'/);
    assert.match(src, /return prev/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/readiness-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `newReadinessChip`, change `mode: 'down'` to `mode: 'below'`. Change the menu's class to `activity-pop readiness-pop` (keep) — the `.readiness-pop` rule from Task 8 sets the column layout; `.activity-pop` already sets `position:fixed`, border, radius, shadow and `overflow:hidden`, which is now correct because only `.rp-body` scrolls.

Add the helpers next to `setReadinessIgnore`:

```js
// Set one tool's readiness choice ('used' | 'unused' | 'detect') on the project's own readiness.tools map.
// Resolves to the previous choice (for Undo), or null when the PATCH failed.
async function setReadinessTool(key, engine, value) {
  const url = `/api/projects/${encodeURIComponent(key)}/settings`;
  try {
    const data = await safeJson(await fetch(url));
    const own = data && data.own && data.own['readiness.tools'];
    const cur = own && typeof own === 'object' && !Array.isArray(own) ? { ...own } : {};
    const prev = cur[engine] || 'detect';
    if (value === 'detect') delete cur[engine]; else cur[engine] = value;
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'readiness.tools': Object.keys(cur).length ? cur : null }) });
    if (!res.ok) return null;
    return prev;
  } catch {
    return null;
  }
}

// The project's Settings tab, scrolled to the Agent readiness card.
function openReadinessSettings(key) {
  for (const rec of readinessChips.values()) if (rec.fly.isOpen()) rec.fly.close();
  location.hash = `projects/${key}/settings`;
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll('.readiness-settings-card')].find((c) => c.dataset.key === key);
    if (card) { card.scrollIntoView({ block: 'center' }); card.focus({ preventScroll: true }); }
  });
}
```

(If `createFlyout`'s returned object has no `close()`, use `rec.chip.click()` when open; check `side-flyout.mjs`'s return value first.)

Replace `buildReadinessMenu(key, report, engine, onEngine)` with `buildReadinessMenu(key, report)` and update its one caller in `paintReadinessMenu` (drop `rec.engine`):

```js
// The popover (spec 5): head with the level and "N of M checks pass"; the tools this project uses; one line naming
// the tools that are not judged; failing repository checks; the passed and ignored boxes; a fixed foot.
// Every string from the report is server data: textContent only.
function buildReadinessMenu(key, report) {
  const m = readinessMenuModel(report, { engineLabel });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const frag = document.createDocumentFragment();

  const head = el('div', 'rp-head');
  const title = el('div', 'rp-title', 'Agent readiness');
  const p = projectByKey(key);
  title.append(el('span', 'rp-sub', p ? p.name : key));
  const count = el('button', 'rp-count', m.countLine);
  count.type = 'button';
  title.append(count);
  head.append(title);
  if (LEVEL_WORDS[m.level]) head.append(renderLevelLabel(m.level, { doc: document }));
  frag.append(head);

  const body = el('div', 'rp-body');
  const sec = (h, note) => { const s = el('div', 'rp-sec'); s.append(el('h3', '', h)); if (note) s.append(el('span', '', note)); return s; };

  body.append(sec('Tools this project uses'));
  for (const t of m.tools) {
    const row = el('div', 'rp-tool');
    const name = el('span', 'rp-tool-n', t.label);
    if (t.reason) name.append(' ', el('small', '', `(${t.reason})`));
    row.append(name, renderLevelLabel(t.level, { doc: document }));
    if (t.detail) row.append(el('span', 'rp-tool-d', t.detail));
    if (t.fix) row.append(el('span', 'rp-tool-f', t.fix));
    if (t.runs) {
      row.append(el('span', 'rp-hint', 'Runs use this tool. To stop judging it, change the engine in Settings.'));
    } else {
      const btn = el('button', 'rp-act', 'Not used here');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const prev = await setReadinessTool(key, t.name, 'unused');
        if (prev === null) { btn.disabled = false; notify({ tone: 'error', title: `Could not save. ${t.label} is still judged.` }); return; }
        await refreshReadiness(key);
        notify({ tone: 'info', title: `${t.label} marked as not used`, key: `readiness-unused-${key}-${t.name}`,
          action: { label: 'Undo', run: async () => { if ((await setReadinessTool(key, t.name, prev)) !== null) await refreshReadiness(key); } } });
      });
      row.append(btn);
    }
    body.append(row);
  }
  if (m.notJudged.length) {
    const line = el('div', 'rp-notjudged', `Not judged: ${m.notJudged.join(', ')}. `);
    const link = el('a', '', 'Change in Settings');
    link.href = `#projects/${key}/settings`;
    link.addEventListener('click', (e) => { e.preventDefault(); openReadinessSettings(key); });
    line.append(link);
    body.append(line);
  }

  body.append(sec('Repository', 'Applies to every tool'));
  const GROUP = { blocker: 'Must fix', warn: 'Should fix', info: 'Advice' };
  for (const sev of ['blocker', 'warn', 'info']) {
    for (const c of m.failing[sev]) {
      const row = el('div', 'rp-chk');
      const dot = el('span', `rp-sev ${sev}`);
      dot.setAttribute('aria-label', GROUP[sev]);
      const ign = el('button', 'rp-ign', 'Ignore');
      ign.type = 'button';
      ign.addEventListener('click', async () => { if (await setReadinessIgnore(key, c.id, true)) await refreshReadiness(key, { refresh: true }); });
      row.append(dot, el('span', 'rp-chk-t', c.title), ign);
      if (c.detail) row.append(el('span', 'rp-chk-d', c.detail));
      row.append(el('span', 'rp-chk-f', c.fix));
      body.append(row);
    }
  }

  const box = (lead, text) => {
    const d = el('details', 'rp-more');
    const s = el('summary');
    s.append(el('span', lead), el('span', '', text), el('span', 'rp-chev'));
    d.append(s);
    return d;
  };
  const passedBox = box('rp-tick', `${m.passed.length} checks pass`);
  const list = el('ul');
  for (const it of m.passed) { const li = el('li'); li.append(el('b', '', it.title), el('span', '', it.detail)); list.append(li); }
  passedBox.append(list);
  body.append(passedBox);
  count.addEventListener('click', () => { passedBox.open = true; passedBox.scrollIntoView({ block: 'nearest' }); passedBox.querySelector('summary').focus(); });

  if (m.ignored.length) {
    const ignBox = box('rp-gdot', `${m.ignored.length} ignored for this project`);
    const ul = el('ul');
    for (const it of m.ignored) {
      const li = el('li');
      const back = el('button', 'rp-ign', 'Stop ignoring');
      back.type = 'button';
      back.addEventListener('click', async () => { if (await setReadinessIgnore(key, it.id, false)) await refreshReadiness(key, { refresh: true }); });
      li.append(el('b', '', it.title), back);
      ul.append(li);
    }
    ignBox.append(ul);
    body.append(ignBox);
  }
  frag.append(body);

  const foot = el('div', 'rp-foot');
  const when = el('span', '', report.checkedAt ? `Checked ${timeAgo(report.checkedAt)}` : '');
  const settings = el('a', '', 'Settings');
  settings.href = `#projects/${key}/settings`;
  settings.addEventListener('click', (e) => { e.preventDefault(); openReadinessSettings(key); });
  const recheck = el('button', 'btn btn-ghost btn-mini', 'Recheck');
  recheck.type = 'button';
  recheck.addEventListener('click', async () => { recheck.disabled = true; await refreshReadiness(key, { refresh: true }); recheck.disabled = false; });
  foot.append(when, el('span', 'rp-sp'), settings, recheck);
  frag.append(foot);
  return frag;
}
```

`timeAgo`: use the helper app.js already uses for "Checked 8 min ago" on the Projects page (`grep -n "Checked \${" ui/public/app.js | head -3` to find it). `report.checkedAt` comes from Task 6.

Update imports: `import { renderReadinessChip, readinessAddedToast, readinessMenuModel, renderLevelLabel, LEVEL_WORDS } from './readiness-chip.mjs';` and fix the existing import assertion in `readiness-ui.test.mjs` accordingly.

`applyReadinessReport(key, report)` now sets `p.readiness = summaryOfClient(report)` where `summaryOfClient` is:

```js
const summaryOfClient = (r) => ({ level: r.level, failingCount: r.counts.mustFix + r.counts.shouldFix, ...r.counts });
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/readiness-ui.test.mjs test/readiness-chip.test.mjs`
Expected: PASS.

- [ ] **Step 5: Check it in the running app**

Start the UI the way the repo documents (`npm run ui` or the command in `package.json` scripts; check with `grep -n "\"ui\|\"start" package.json`), open `#projects`, click a project's chip, and confirm against the mockup: popover under the chip, head count, tools, the "Not judged" line, repository checks, "N checks pass" box with one tick, footer visible; click "Not used here" on a non-run tool and use Undo. Take a screenshot.

- [ ] **Step 6: Commit**

```bash
git add ui/public/app.js test/readiness-ui.test.mjs
git commit -m "Readiness popover: used tools, not-judged line, passed box, Not used here with Undo"
```

---

### Task 10: The settings card

**Files:**
- Modify: `ui/public/app.js` (`buildReadinessSettingsCard`, `fillReadinessCard`)
- Test: `test/readiness-ui.test.mjs`

**Interfaces:**
- Consumes: `setReadinessTool` (Task 9), `setReadinessIgnore`, the final report (`engines[*].setting/detected/reasons/used/level`), `engineLabel`.
- Produces: the card with one `.rs-row` per engine (except locked ones) holding a `.seg.seg-sm` of three buttons (`data-v="detect"|"used"|"unused"`, `aria-pressed`), then the ignore switches as today.

- [ ] **Step 1: Write the failing test**

```js
describe('readiness UI: settings card v2', () => {
  it('one three-way control per tool', () => {
    const src = fnSource('fillReadinessCard');
    assert.match(src, /seg seg-sm/);
    for (const w of ["'Detect'", "'Used'", "'Not used'"]) assert.ok(src.includes(w), w);
    assert.match(src, /aria-pressed/);
  });
  it('says what Detect finds and whether the tool is judged', () => {
    const src = fnSource('fillReadinessCard');
    assert.match(src, /Detect finds: /);
    assert.match(src, /Detect finds nothing/);
    assert.match(src, /Not judged\./);
  });
  it('the run engine cannot be set to Not used', () => {
    const src = fnSource('fillReadinessCard');
    assert.match(src, /Runs use this tool, so it is always judged\. To stop, change the Run engine setting\./);
    assert.match(src, /disabled = true/);
  });
  it('a choice writes through setReadinessTool', () => {
    assert.match(fnSource('fillReadinessCard'), /setReadinessTool\(key, name, v\)/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/readiness-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `fillReadinessCard(card, key)`, after loading `settings` and `report`, before the ignore switches:

```js
const head = Object.assign(document.createElement('h3'), { textContent: 'Agent readiness' });
const hint = Object.assign(document.createElement('small'), { className: 'hint', textContent: 'Which tools this project uses. Detect lets Worca decide from runs and files.' });
card.replaceChildren(head, hint);
const CHOICES = [['detect', 'Detect'], ['used', 'Used'], ['unused', 'Not used']];
for (const [name, e] of Object.entries((report && report.engines) || {})) {
  if (e.level === 'locked') continue;
  const runs = (e.reasons || []).some((r) => r.kind === 'run-engine');
  const row = document.createElement('div');
  row.className = 'rs-row';
  row.append(Object.assign(document.createElement('span'), { className: 'rs-name', textContent: engineLabel(name) }));
  const seg = document.createElement('div');
  seg.className = 'seg seg-sm';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', engineLabel(name));
  for (const [v, label] of CHOICES) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.setAttribute('aria-pressed', String(e.setting === v));
    if (runs && v === 'unused') { b.disabled = true; b.title = 'Runs use this tool'; }
    b.addEventListener('click', async () => {
      if (b.disabled || e.setting === v) return;
      for (const x of seg.children) x.disabled = true;
      const prev = await setReadinessTool(key, name, v);
      if (prev === null) msg.textContent = 'Could not save.';
      void refreshReadiness(key, { cards: true });
    });
    seg.append(b);
  }
  row.append(seg);
  const finds = e.detectedReason ? `Detect finds: ${e.detectedReason}` : 'Detect finds nothing';
  const judged = e.used ? `Judged: ${LEVEL_WORDS[e.level] || e.level}.` : 'Not judged.';
  row.append(Object.assign(document.createElement('span'), { className: 'rs-find', textContent: `${finds}. ${judged}` }));
  if (runs) row.append(Object.assign(document.createElement('span'), { className: 'rs-note', textContent: 'Runs use this tool, so it is always judged. To stop, change the Run engine setting.' }));
  card.append(row);
}
```

`e.detectedReason` (Task 5) is what Detect finds whatever the setting, so a tool set to Used still says what was detected.

Keep the card's `tabindex="-1"` (`card.tabIndex = -1` in `buildReadinessSettingsCard`) so `openReadinessSettings` can focus it.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/readiness-ui.test.mjs`
Expected: PASS.

- [ ] **Step 5: Check it in the running app**

Open a project's Settings tab: the card shows one row per tool with Detect / Used / Not used; Claude Code's Not used is disabled with the note; choosing Not used for a detected tool turns the chip on the Projects page green without Recheck. Take a screenshot.

- [ ] **Step 6: Commit**

```bash
git add ui/public/app.js test/readiness-ui.test.mjs
git commit -m "Readiness settings: Detect / Used / Not used per tool"
```

---

### Task 11: Spec correction and full verification

**Files:**
- Modify: `plans/agent-readiness-design.md`

- [ ] **Step 1: Correct the spec**

In §4.6 replace the "Run history column" paragraph with:

> **Run history.** A run's engine is already queryable: `RUN_ENGINE_SQL` in `src/core/artifacts.mjs` reads `outcome.runEngine`, else the resume point's `claude.engine`, and NULL means `claude`. `runEngineCounts(projectKey, sinceIso)` groups the project's runs of the last `HISTORY_DAYS` (90) by that expression, using `idx_pipelines_project_started`. No schema change. Ask Worca chats are not a signal: `ask_threads` has no project link.

Replace D8 with: "**D8 — Run history needs no new column.** `RUN_ENGINE_SQL` already exposes each run's engine."
In §4.7 and §5 mark the team layer of `readiness.tools` and the Team policy rows as a follow-up (policy `FIELDS` + Team policy page), not part of this implementation.

- [ ] **Step 2: Run the whole suite**

Run: `npm test > /tmp/rd-all.log 2>&1; grep -E "^ℹ (tests|pass|fail)" /tmp/rd-all.log`
Expected: `fail 0`. Fix any readiness-related failure in the task that owns the code; report anything unrelated.

- [ ] **Step 3: Commit**

```bash
git add plans/agent-readiness-design.md plans/agent-readiness-plan.md
git commit -m "Agent readiness spec: run history needs no new column; team layer is a follow-up"
```
