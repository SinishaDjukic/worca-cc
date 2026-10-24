// test/cli-guardrails-flag.test.mjs — `worca --guardrails <id>` (G13 follow-up).
// A fresh install defaults to the Normal set, whose permission rules Codex and Cursor cannot hold,
// so the CLI needs a way to pick the set a run uses: --guardrails names it, an unknown id fails
// before any run starts, and the engine gate's refusal tells a CLI user which flag lifts it. A resume
// keeps the set its run pinned, so its refusal sends the person to a new run for Permissive.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { engineRefusalFor } from '../src/shared/engine-switch.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { getDb } from '../src/core/db.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function project() {
  const d = mkdtempSync(join(tmpdir(), 'worca-cli-guardrails-'));
  dirs.push(d);
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: d });
  return d;
}
// HOME too: settings.json resolves under HOME, not WORCA_HOME. No store_meta row: a fresh install (Normal).
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, WORCA_MOCK: '' },
});

test('--help lists --guardrails', () => {
  const r = cli(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--guardrails <id>/);
});

test('a fresh install refuses a Codex run on Normal and names the flag that picks Permissive', () => {
  const r = cli(['--project', project(), '--prompt', 'x', '--mock', '--yes', '--engine', 'codex']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /guardrail set "normal" has permission rules this engine cannot enforce .* — run it with --guardrails permissive, or pass --allow-unguarded-engine/);
});

test('--guardrails permissive runs a Codex project on a fresh install without --allow-unguarded-engine', () => {
  for (const flag of [['--guardrails', 'permissive'], ['--guardrails=permissive']]) {
    const r = cli(['--project', project(), '--prompt', 'x', '--mock', '--yes', '--engine', 'codex', ...flag]);
    assert.equal(r.status, 0, `${flag.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /cannot enforce/);
    const row = getDb().prepare('SELECT guardrails_id FROM pipelines ORDER BY rowid DESC LIMIT 1').get();
    assert.equal(row.guardrails_id, 'permissive', 'the run records the set it ran on');
  }
});

test('an unknown --guardrails id exits 2 before a run starts', () => {
  const r = cli(['--project', project(), '--prompt', 'x', '--mock', '--yes', '--guardrails', 'nope']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /worca: unknown guardrail set "nope"/);
  assert.doesNotMatch(r.stdout, /orchestrator — project/, 'no run was started');
  const bare = cli(['--prompt', 'x', '--guardrails']);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /Flag --guardrails requires a value/);
});

test('the refusal names only options that exist: a start picks the set, a resume keeps it and points at a new run', async () => {
  const codex = (extra) => createOrchestrator({ projectDir: project(), ...extra, claude: { mock: true, engine: 'codex' } });
  const start = (await codex({ guardrailsId: 'normal' }).engineStartRefusal()).error;
  const resume = (await codex({ resume: { row: {}, resumePoint: graphResumePoint({ guardrailsId: 'normal' }) } }).engineResumeRefusal()).error;
  assert.match(start, /^engine codex: guardrail set "normal" has permission rules this engine cannot enforce \(.*\) — run it with --guardrails permissive, or pass --allow-unguarded-engine to run it without them$/);
  assert.match(resume, /^engine codex: guardrail set "normal" has permission rules this engine cannot enforce \(.*\) — start a new run with --guardrails permissive, or pass --allow-unguarded-engine to run it without them$/);
  // Every flag the CLI wording names is a real `worca` option, and `worca resume` takes the consent.
  const help = cli(['--help']).stdout;
  for (const flag of `${start} ${resume}`.match(/--[a-z][a-z-]*/g)) assert.match(help, new RegExp(`^ +${flag} `, 'm'), `${flag} is a worca option`);
  assert.match(cli(['resume']).stderr, /usage: worca resume .*\[--allow-unguarded-engine\]/);
  // The UI and chat name the set and the consent where each one is, never a CLI flag.
  assert.match(engineRefusalFor(resume, 'ui'), / — start a new run with the Permissive set, or tick Allow unguarded to run it without them$/);
  assert.match(engineRefusalFor(resume, 'chat'), / — start a new run with the Permissive set, or resume it in the Worca UI with Allow unguarded to run it without them$/);
  for (const text of [start, resume]) for (const surface of ['ui', 'chat']) assert.doesNotMatch(engineRefusalFor(text, surface), /--/);
});

test('the UI and chat word the Permissive hint as the set, never the CLI flag', () => {
  const cliText = 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce — run it with --guardrails permissive, or pass --allow-unguarded-engine to run it without them';
  assert.equal(engineRefusalFor(cliText, 'ui'), 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce — run it with the Permissive set, or tick Allow unguarded to run it without them');
  assert.equal(engineRefusalFor(cliText, 'chat'), 'engine codex: guardrail set "normal" has permission rules this engine cannot enforce — run it with the Permissive set, or resume it in the Worca UI with Allow unguarded to run it without them');
  assert.equal(engineRefusalFor(cliText, 'cli'), cliText);
});
