// test/cli-interactive.test.mjs
// The CLI's INTERACTIVE answer path, driven end to end over a real stdin pipe.
//
// Every other test/cli-*.test.mjs spawns the CLI with --yes/--non-interactive, so
// `orch.on('question')` returns at `if (flags.auto || !rl) return;` and askClarify /
// askGate / askRecovery / makeRl never execute — the gap that let a live
// ReferenceError ship through P6 (worca-cc.mjs's own comment records it) and that
// the only existing pins (source-text regexes in cli-exec-render.test.mjs and
// cli-resume.test.mjs) cannot close.
//
// Harness: spawn the CLI with stdin a PIPE and NO --yes, then write an answer when
// its rendered prompt appears on stdout. Assertions are on the rendered TEXT plus the
// BEHAVIOURAL consequence (the answer in step_questions, the extra loop cycle, the
// re-run node), never on an ask id — the ids are engine internals.
//
// Fixtures per arm:
//   clarify  — wf_default's n_clarify; the mock planner asks its two questions.
//   gate     — wf_default with w9 (review -> fix) budget forced to 1, so the mock
//              reviewer's cycle-1 major blocks the FIRST delivery and holds the gate.
//   recovery — no WORCA_MOCK; WORCA_CLAUDE_BIN points at a stub that exits 1 with a
//              401 on stderr, which classifyError() reads as the `auth` class.
//   questions— wf_default with n_impl.config.askQuestions, which makes phases.mjs emit
//              `MOCK_ASK: <questionsFile>` so the mock writes a step_questions round.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

// Sets process.env.WORCA_HOME for this file; the spawned CLI inherits it, so the
// workflows this file seeds and the step_questions rows the child writes are the
// same store.
const home = useTempHome(after, 'worca-cc-cliix-home-');

const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

/** A real repo with one commit on `main` — the shape every run flow needs. */
function freshRepo(prefix = 'worca-cc-cliix-repo-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

/**
 * Spawn the CLI with stdin a PIPE and answer its prompts as they render.
 *
 * `script` cues are consumed IN ORDER: each is searched for in stdout starting
 * AFTER the previous cue's match, so two identical prompts (e.g. a second
 * `Choose [1-2]:` from a second recovery round) are answered in sequence rather
 * than both firing off the first render.
 *
 * @param {string[]} args                 argv after the CLI path (never pass --yes)
 * @param {object}   [opts]
 * @param {Array<{cue: RegExp|string, send: string}>} [opts.script]
 * @param {Record<string,string>} [opts.env] extra env for the child
 * @param {boolean}  [opts.mock=true]      true -> WORCA_MOCK=1; false -> DELETE it
 *                                         (real runner; pair with WORCA_CLAUDE_BIN)
 * @param {number}   [opts.timeoutMs=30000]
 * @returns {Promise<{code:number|null, signal:string|null, stdout:string,
 *                    stderr:string, sent:number, timedOut:boolean, ms:number}>}
 */
function driveCli(args, { script = [], env = {}, mock = true, timeoutMs = 30000 } = {}) {
  return new Promise((res) => {
    const childEnv = { ...process.env, WORCA_HOME: home, ...env };
    if (mock) childEnv.WORCA_MOCK = '1';
    else delete childEnv.WORCA_MOCK;
    const child = spawn(process.execPath, [CLI, ...args], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const t0 = Date.now();
    let stdout = '';
    let stderr = '';
    let pos = 0;   // stdout index just past the last consumed cue
    let sent = 0;
    let timedOut = false;
    const pump = () => {
      while (sent < script.length) {
        const { cue, send } = script[sent];
        const re = cue instanceof RegExp ? new RegExp(cue.source, cue.flags.replace(/[gy]/g, '')) : new RegExp(cue);
        const m = re.exec(stdout.slice(pos));
        if (!m) break;
        pos += m.index + m[0].length;
        sent += 1;
        child.stdin.write(send);
      }
    };
    child.stdout.on('data', (b) => { stdout += b.toString(); pump(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      res({ code, signal, stdout, stderr, sent, timedOut, ms: Date.now() - t0 });
    });
  });
}

/** The 8-hex pipeline id off the CLI's closing `Pipeline directory: …-<id>` line. */
function pipelineIdFrom(stdout) {
  const m = /Pipeline directory: .*-([0-9a-f]{8})\s*$/m.exec(stdout);
  return m ? m[1] : null;
}

/**
 * A stub `claude` that always exits 1 with `message` on stderr, and records one
 * file per invocation (its whole argv) under <dir>/calls so a test can count how
 * many times a given agent was spawned.
 * @returns {{bin:string, calls:string, spawnsMatching:(needle:string)=>number}}
 */
function failingClaudeBin(message) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-cliix-bin-'));
  scratch.push(dir);
  const calls = join(dir, 'calls');
  mkdirSync(calls);
  const bin = join(dir, 'claude');
  // mktemp, not a counter: the title-generation spawn and the first node's spawn
  // overlap, and two shells that both read the same directory count would write
  // (and lose) the same file name.
  writeFileSync(bin, `#!/bin/sh\nf=$(mktemp "${calls}/callXXXXXXXX")\nprintf '%s' "$*" > "$f"\necho "${message}" >&2\nexit 1\n`);
  chmodSync(bin, 0o755);
  return {
    bin,
    calls,
    spawnsMatching: (needle) =>
      readdirSync(calls).filter((f) => readFileSync(join(calls, f), 'utf8').includes(needle)).length,
  };
}

/** Clone wf_default, applying `mut` to nodes/wires, and store it under `id`. */
async function seedWorkflow(id, name, mut) {
  const d = GRAPH_DEFAULT_WORKFLOW;
  const { nodes = d.nodes, wires = d.wires } = mut({ nodes: d.nodes, wires: d.wires });
  return writeGraphWorkflow({ id, name, domain: d.domain, nodes, wires });
}

// ── clarify arm ────────────────────────────────────────────────────────────────
// Drives BOTH input shapes askClarify supports: a 1-based option number and free
// text typed instead of a number.

test('clarify arm: the numbered options render and both answers reach clarify.json', async () => {
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'clarify arm e2e'], {
    script: [
      { cue: /Choose \[number or text\]/, send: '2\n' },          // option 2 by number
      { cue: /Choose \[number or text\]/, send: 'Soft delete\n' }, // free text
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 2, `only ${r.sent} prompt(s) rendered:\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);

  // Rendered by askClarify (worca-cc.mjs) — the question, its options, and the
  // synthesized "type your own" choice numbered after the real options.
  assert.match(r.stdout, /Q: How should the feature handle invalid input/);
  assert.match(r.stdout, /^ {2}1\) Fail fast with a clear error$/m);
  assert.match(r.stdout, /^ {2}5\) type your own$/m);

  // Behavioural consequence: the parsed choices were handed to orch.answer() and
  // persisted on the clarify node's round.
  const id = pipelineIdFrom(r.stdout);
  assert.ok(id, `no pipeline id in:\n${r.stdout}`);
  const round = readStepQuestions(id).find((q) => q.nodeId === 'n_clarify');
  assert.ok(round, `no n_clarify round for ${id}`);
  assert.deepEqual(round.answers.map((a) => [a.id, a.choice]), [
    ['invalid-input', 'Coerce to a safe default'],   // "2" resolved to the 2nd option
    ['delete-behavior', 'Soft delete'],              // free text taken verbatim
  ]);
});

// ── gate arm ───────────────────────────────────────────────────────────────────
// w9 (n_review.review -> n_impl.fix) budget forced to 1, so the mock reviewer's
// cycle-1 major exhausts the wire on its first delivery and holds the gate.

test('gate arm: the header names the wire and its budget, and "another cycle" spends one', async () => {
  await seedWorkflow('wf_cliix_gate', 'Gate arm', ({ nodes, wires }) => ({
    nodes,
    wires: wires.map((w) => (w.id === 'w9' ? { ...w, config: { ...w.config, maxCycles: 1 } } : w)),
  }));
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'gate arm e2e', '--workflow', 'wf_cliix_gate'], {
    script: [
      { cue: /Choose \[number or text\]/, send: '1\n' },
      { cue: /Choose \[number or text\]/, send: '1\n' },
      { cue: /Choose \[1-2\]/, send: '2\n' },   // "I approve another cycle"
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 3, `only ${r.sent} prompt(s) rendered:\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);

  // formatGateHeader's rendered text (never the ask id): wire label + budget.
  assert.match(r.stdout, /\? Loop gate · Review Implementation → Implementation {2}1\/1 cycles used/);
  assert.match(r.stdout, /Open critical\/major issues:/);
  assert.match(r.stdout, /- \[major\] Unhandled empty-string input/);
  assert.match(r.stdout, /^ {2}1\) Don't have another cycle and continue$/m);
  assert.match(r.stdout, /^ {2}2\) I approve another cycle$/m);

  // Behavioural consequence: the approved cycle was actually taken.
  assert.match(r.stdout, /▶ Implementation #2 · fix ← Review Implementation/);
  assert.match(r.stdout, /^10 executions · /m);
});

test('gate arm: "continue" spends no cycle — the loop body never re-runs', async () => {
  await seedWorkflow('wf_cliix_gate', 'Gate arm', ({ nodes, wires }) => ({
    nodes,
    wires: wires.map((w) => (w.id === 'w9' ? { ...w, config: { ...w.config, maxCycles: 1 } } : w)),
  }));
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'gate continue e2e', '--workflow', 'wf_cliix_gate'], {
    script: [
      { cue: /Choose \[number or text\]/, send: '1\n' },
      { cue: /Choose \[number or text\]/, send: '1\n' },
      { cue: /Choose \[1-2\]/, send: '1\n' },   // "Don't have another cycle and continue"
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 3, `only ${r.sent} prompt(s) rendered:\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\? Loop gate · Review Implementation → Implementation {2}1\/1 cycles used/);
  // The decisive contrast with the test above: no second Implementation, two
  // fewer executions.
  assert.equal(/▶ Implementation #2/.test(r.stdout), false, r.stdout);
  assert.match(r.stdout, /^8 executions · /m);
});

// ── recovery arm ───────────────────────────────────────────────────────────────
// Real runner + a stub bin that always fails with a 401, so every attempt is a
// recoverable `auth` error and the interactive gate re-opens after each Retry.

test('recovery arm: Abort ends the run with a non-zero exit', async () => {
  const stub = failingClaudeBin('API Error: 401 Invalid authentication credentials');
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'recovery abort e2e'], {
    mock: false,
    env: { WORCA_CLAUDE_BIN: stub.bin, WORCA_RECOVERY_BACKOFF_MS: '0' },
    script: [{ cue: /Choose \[1-2\]/, send: '2\n' }],   // "Abort the run"
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 1, `no recovery prompt rendered:\n${r.stdout}`);
  assert.equal(r.code, 1, `expected a non-zero exit\n${r.stdout}`);

  // Rendered by askRecovery.
  assert.match(r.stdout, /Recoverable auth error — the pipeline could not reach the model\./);
  assert.match(r.stdout, /Fix: re-authenticate \(claude setup-token or \/login\) in another terminal, then retry\./);
  assert.match(r.stdout, /^ {2}1\) Retry$/m);
  assert.match(r.stdout, /^ {2}2\) Abort the run$/m);
  assert.match(r.stdout, /Pipeline ended with status: error/);

  // Behavioural consequence: aborting spawned the failing node exactly once.
  assert.equal(stub.spawnsMatching('# Task: Clarify'), 1);
});

test('recovery arm: Retry re-runs the failing node before the next prompt', async () => {
  const stub = failingClaudeBin('API Error: 401 Invalid authentication credentials');
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'recovery retry e2e'], {
    mock: false,
    env: { WORCA_CLAUDE_BIN: stub.bin, WORCA_RECOVERY_BACKOFF_MS: '0' },
    script: [
      { cue: /Choose \[1-2\]/, send: '1\n' },   // Retry -> the node runs again
      { cue: /Choose \[1-2\]/, send: '2\n' },   // ...fails again; Abort out
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 2, `only ${r.sent} recovery prompt(s) rendered:\n${r.stdout}`);
  assert.equal(r.code, 1, `expected a non-zero exit\n${r.stdout}`);
  // The decisive contrast with the Abort-first test: two spawns, not one.
  assert.equal(stub.spawnsMatching('# Task: Clarify'), 2);
});

// ── questions arm ──────────────────────────────────────────────────────────────
// kind === 'questions' — the mid-run ask-then-resume round, which renders its own
// "<Agent> has questions:" banner and then reuses askClarify.

test('questions arm: the agent banner renders and the answer resumes the same session', async () => {
  await seedWorkflow('wf_cliix_ask', 'Questions arm', ({ nodes, wires }) => ({
    nodes: nodes.map((n) => (n.id === 'n_impl' ? { ...n, config: { ...n.config, askQuestions: true } } : n)),
    wires,
  }));
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'questions arm e2e', '--workflow', 'wf_cliix_ask'], {
    script: [
      { cue: /Choose \[number or text\]/, send: '1\n' },   // clarify q1
      { cue: /Choose \[number or text\]/, send: '1\n' },   // clarify q2
      { cue: /Choose \[number or text\]/, send: '2\n' },   // the implementer's question
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 3, `only ${r.sent} prompt(s) rendered:\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);

  // The banner is the only thing the 'questions' arm renders itself; the body is
  // askClarify's.
  assert.match(r.stdout, /^Implementation has questions:$/m);
  assert.match(r.stdout, /Q: Mock question from implementer\?/);
  // Behavioural consequence: the answer was persisted and the SAME claude session
  // resumed with it (the mock echoes the resumed session id).
  assert.match(r.stdout, /resuming with 1 answer\(s\) \(round 1\)/);
  assert.match(r.stdout, /\[mock\] resumed session mock-session-implementer-c1/);

  const id = pipelineIdFrom(r.stdout);
  assert.ok(id, `no pipeline id in:\n${r.stdout}`);
  const round = readStepQuestions(id).find((q) => q.nodeId === 'n_impl');
  assert.ok(round, `no n_impl round for ${id}`);
  assert.deepEqual(round.answers.map((a) => [a.id, a.choice]), [['q1', 'Option B']]);
});
