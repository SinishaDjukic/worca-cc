# Live harness suite

Real harness binaries, real subscriptions, real tokens. It answers one question:
**does worca still drive this harness correctly, end to end?** It is never part
of `npm test` or CI (`tools/test.mjs` only reads `test/*.mjs`), and it refuses
to start unless `WORCA_ALLOW_LIVE=1` is set.

```sh
WORCA_ALLOW_LIVE=1 npm run test:live -- --tier smoke                 # ~5 min, Haiku
WORCA_ALLOW_LIVE=1 npm run test:live -- --tier core --baseline ../worca-cc-baseline
WORCA_ALLOW_LIVE=1 npm run test:live -- --tier full --models matrix --repeat 2
WORCA_ALLOW_LIVE=1 npm run test:live -- --only 'ask.*,lifecycle.pause-resume'
npm run test:live -- --list                                          # no tokens
```

| option | meaning |
|---|---|
| `--engine claude\|codex\|copilot` | harness profile (`profiles/<engine>.mjs`) |
| `--tier smoke\|core\|full` | cumulative scenario tiers |
| `--only <id,glob*>` | pick scenarios |
| `--models cheap\|matrix\|<id,id>` | `cheap` runs matrix scenarios on the cheap model only |
| `--repeat N` | run each job N times (pass rate per model) |
| `--baseline <checkout>` | also run `diff: true` scenarios on another checkout and diff the wire |
| `--concurrency N` | parallel jobs (default 3) |
| `--out <dir>` | results dir (default `test/live/out/<timestamp>`, gitignored) |

Results: `report.md` (human), `report.json`, `junit.xml`, and one sandbox per
job under `sandboxes/` (its HOME, WORCA_HOME, fixture project and the wire tap)
kept for post-mortems.

## How it stays deterministic

The model's words are never asserted. Every scenario judges invariants:

- **state**: the run's recorded status, per-step cost and session ids,
  sub-agent rows closed (CLI `runs --json` and the store DB);
- **wire**: every harness spawn exited 0 and streamed a non-error result, the
  model that answered (`system/init`) is the model asked for, resume reused the
  stored session id;
- **oracle**: the work product executes. Coding scenarios run on the `calc`
  fixture (`fixtures/repos/calc`), whose feature branch is checked out and
  executed (`subtract()` works, the fixture's tests pass).

`--baseline` adds a build-vs-build check: the same scenario runs on both
checkouts and every harness spawn is grouped by call site (`# Task: <role>`,
helper system prompt) and compared argv / env / system prompt / staged files
after masking per-run values. Anything not `same` is either a regression or a
change someone must sign off.

## Layout

```
run.mjs                runner (gate, preflight, capability skips, matrix, pool, reports)
lib/tap.mjs            the wire tap: stands in for the harness binary, records, proxies
lib/sandbox.mjs        isolated HOME/WORCA_HOME/projects + tapped binary + CLI/server helpers
lib/checks.mjs         engine-neutral invariants + the calc oracle
lib/diff.mjs           build-vs-build wire diff
profiles/<engine>.mjs  per-harness knowledge: binary, sign-in check, model tiers, wire parser, call sites
scenarios/NN-*.mjs     scenarios: { id, title, tier, models, requires, diff, env, run(t) }
fixtures/              fixture repos and workflows
```

### Isolation and the subscription

worca runs under a throwaway `HOME` and `WORCA_HOME` (its `settings.json`
follows `$HOME`), so nothing touches your real worca state. The harness login
lives in the real home, so the tap starts the real binary with the real `HOME`
(`LIVE_REAL_HOME` overrides). The tap's config is baked into a per-sandbox
wrapper (`<sandbox>/bin/<engine>`), which is also first on `PATH`, so worca's
spawn-env scrub cannot strip it and a bare `claude` lookup is tapped too.

### Another harness

A profile is the only harness-specific piece: `binEnv` (the `WORCA_*_BIN` that
worca reads), `realBin`, `preflight` (installed + signed in), `models`
(`cheap`/`mid`/`top`/`matrix`), `expectInitModel`, `parseWire` (stream →
`{inits, sessionIds, results, tools, subagentSpawns, hookEvents}`), `isProbe`,
`callSite`, `argvShape`. Scenarios declare the engine capabilities they need
(`requires: ['resume']`, keys from `src/core/engines/capabilities.mjs`); the
runner reads the build's declared capabilities and skips what the engine lacks.
Engine-specific scenarios set `engines: ['claude']`. `profiles/codex.mjs` and
`profiles/copilot.mjs` are scaffolds that have not been validated live yet.

### Writing a scenario

```js
export default [{
  id: 'area.name', title: '…', tier: 'core', models: 'cheap' /* | 'matrix' | ['id'] */,
  requires: ['resume'], diff: true, env: { WORCA_SUBAGENT_HOOKS: '1' },
  async run(t) {                       // t: { sb, model, profile, check, note, skip }
    const proj = t.sb.addProject();
    const res = await t.sb.cli(['--project', proj, '--prompt', '…', '--yes', '--model', t.model]);
    t.check('cli: exit 0', res.code === 0, res.stderr);
    checkWire(t, t.sb.agentTaps(), { expectModel: true });
  },
}];
```

`t.check(name, cond, detail, { severity: 'warn' })` records a soft check that
is reported but does not fail the job.
