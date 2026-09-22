// test/cli-forms.test.mjs
// The CLI's kind:'form' answer path, driven end to end over a real stdin pipe
// (spec §8). Harness is test/cli-interactive.test.mjs's driveCli, verbatim: spawn
// the CLI with stdin a PIPE and NO --yes, then write an answer when its rendered
// prompt appears on stdout. Auto mode is P2's and is never exercised here.
//
// The fixture (decision S11, verified on a real host): a USER agent — built-ins
// are immutable, so a form cannot be bolted onto worca-cc-implementer — carrying
// `asksQuestions: true` (without it src/core/workflows.mjs forces
// nc.askQuestions to false), an `ask` block, and the MOCK_ASK_FORM marker in its
// .md BODY (ruling X10: the test places the marker, never the prompt block; the
// body becomes the system prompt and parseMarkers scans both). The graph is
// hand-built because node ids must match /^n_[a-z0-9]{1,32}$/, which
// writeKeyGraph's `n0_<key>` ids are not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { createAgent } from '../src/core/agent-store.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

const home = useTempHome(after, 'worca-cc-cliform-home-');
const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-cliform-repo-'));
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

const DRIVE_TIMEOUT_MS = process.platform === 'win32' ? 120000 : 30000;
/** test/cli-interactive.test.mjs's driveCli. Cues are consumed IN ORDER: each is
 *  searched for starting AFTER the previous cue's match. */
function driveCli(args, { script = [], env = {}, stdin = 'pipe', timeoutMs = DRIVE_TIMEOUT_MS } = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', ...env },
      stdio: [stdin, 'pipe', 'pipe'],
    });
    child.stdin?.on('error', () => {});
    let stdout = ''; let stderr = ''; let pos = 0; let sent = 0; let timedOut = false;
    const pump = () => {
      while (sent < script.length && child.stdin) {
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
    child.on('exit', (code, signal) => { clearTimeout(timer); res({ code, signal, stdout, stderr, sent, timedOut }); });
  });
}

const pipelineIdFrom = (stdout) => (/Pipeline directory: .*-([0-9a-f]{8})\s*$/m.exec(stdout) || [])[1] || null;
const pipelineStatuses = () => getDb().prepare('SELECT id, status FROM pipelines').all();

/** The form the fixture agent declares. */
const REVIEW_FORM = {
  version: 1,
  title: 'Review mockups',
  data: { type: 'object', required: ['images'], properties: {
    summary: { type: 'string', maxLength: 8000 },
    images: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id'], properties: {
      id: { type: 'string' }, caption: { type: 'string' } } } } } },
  answer: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' },
    picked: { type: 'string', enumFrom: 'data.images[].id' },
    notes: { type: 'string', maxLength: 4000 } } },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'select', field: 'picked', label: 'Which one' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } },
  ],
  example: { summary: 'Two directions.', images: [{ id: 'a', caption: 'Option A' }, { id: 'b', caption: 'Option B' }] },
};

/** What the mock writes as the ask payload (X10: the TEST supplies it). */
const MOCK_PAYLOAD = { form: 'review-mockups', data: REVIEW_FORM.example };

/** Seed a user agent with `ask` + the mock marker, and a graph that runs it. */
async function seed(agentKey, workflowId, forms, payload = MOCK_PAYLOAD) {
  await createAgent({
    meta: {
      key: agentKey, displayName: 'Form Asker', metaVersion: 2, description: 'ask-forms fixture',
      uiPhase: 'implement', order: 50, runnerType: 'producer',
      asksQuestions: true, questionsDefault: true,
      inputs: [{ id: 'task', type: 'md', required: true }],
      outputs: [{ id: 'notes', type: 'md', filename: 'notes.md', store: 'run' }],
      tools: ['Read', 'Write'],
      ask: { forms },
    },
    markdown: `# Form Asker\n\nDo the thing.\n\nMOCK_ASK_FORM: ${JSON.stringify(payload)}\n`,
  });
  await writeGraphWorkflow({
    id: workflowId, name: 'Form arm', domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 100, config: {} },
      { id: 'n_asker', kind: 'agent', key: agentKey, x: 120, y: 100, config: { askQuestions: true } },
      { id: 'n_end', kind: 'end', x: 240, y: 100, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_asker', port: 'task' } },
      { id: 'w2', from: { node: 'n_asker', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
}

/** The single persisted form round for n_asker (P2 E13 / X3). */
function formRound(pipelineId) {
  return readStepQuestions(pipelineId).find((r) => r.nodeId === 'n_asker' && r.ask);
}

test('form arm: the projection renders, fields prompt in layout order, `when` gates the last', async () => {
  await seed('formAskerA', 'wf_cliform_a', { 'review-mockups': REVIEW_FORM });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form arm e2e', '--workflow', 'wf_cliform_a'], {
    script: [
      { cue: /Choose \[number or value, Enter = approve\]/, send: '2\n' },   // verdict -> changes
      { cue: /Choose \[number or value\]/, send: 'b\n' },                    // picked  -> by VALUE
      { cue: /Your answer/, send: 'tighten the spacing\n' },                 // notes, revealed by `when`
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 3, `only ${r.sent} prompt(s) rendered:\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);

  // P1's projectForm output: `<title> — <agent>`, the markdown display widget, then
  // one numbered two-line block per input field.
  assert.match(r.stdout, /\? Review mockups — /);
  assert.match(r.stdout, /Two directions\./);
  assert.match(r.stdout, /^1\. Verdict \{verdict\}$/m);
  assert.match(r.stdout, /one of: 1\) approve {2}2\) changes/);
  assert.match(r.stdout, /^3\. What should change\? \{notes\}$/m);
  assert.doesNotMatch(r.stdout, /Reply: \/answer/, 'no ref on the CLI, so no reply line');
  // formatFormField's own lines (Task 2): the required marker and the numbered options.
  assert.match(r.stdout, /^Verdict \*$/m);
  // `when: { verdict: 'changes' }` — the textarea PROMPT only opens after verdict.
  assert.ok(r.stdout.indexOf('Your answer') > r.stdout.indexOf('Choose [number or value, Enter = approve]'), r.stdout);

  // Behavioural consequence: { values } reached orch.answer and was persisted.
  const id = pipelineIdFrom(r.stdout);
  assert.ok(id, `no pipeline id in:\n${r.stdout}`);
  const round = formRound(id);
  assert.ok(round, `no persisted form round for ${id}`);
  assert.deepEqual(round.formAnswer.values, { verdict: 'changes', picked: 'b', notes: 'tighten the spacing' });
  assert.deepEqual(round.ask.values, round.formAnswer.values, 'X3: the snapshot carries the answer');
  assert.deepEqual(round.questions, [], 'X3: the legacy arrays stay empty');
  assert.deepEqual(round.answers, []);
});

test('form arm: Enter accepts the default and `when` DROPS the hidden field', async () => {
  await seed('formAskerB', 'wf_cliform_b', { 'review-mockups': REVIEW_FORM });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form default e2e', '--workflow', 'wf_cliform_b'], {
    script: [
      { cue: /Choose \[number or value, Enter = approve\]/, send: '\n' },   // Enter -> 'approve'
      { cue: /Choose \[number or value\]/, send: '1\n' },                   // picked by ORDINAL -> 'a'
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 2, `expected exactly 2 prompts (notes stays hidden):\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(/Your answer/.test(r.stdout), false, 'a `when`-hidden field is never prompted');
  assert.deepEqual(formRound(pipelineIdFrom(r.stdout)).formAnswer.values, { verdict: 'approve', picked: 'a' });
});

test('form arm: an invalid entry re-prompts the SAME field with P1\'s message', async () => {
  await seed('formAskerC', 'wf_cliform_c', { 'review-mockups': REVIEW_FORM });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form reprompt e2e', '--workflow', 'wf_cliform_c'], {
    script: [
      { cue: /Choose \[number or value, Enter = approve\]/, send: 'maybe\n' },  // not in the enum
      { cue: /Choose \[number or value, Enter = approve\]/, send: '1\n' },      // approve
      { cue: /Choose \[number or value\]/, send: '1\n' },
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 3, `only ${r.sent} prompt(s):\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Verdict: "maybe" is not one of: approve, changes/,
    'coerceInput\'s message with the label prefixed (formatCoerceError)');
  assert.deepEqual(formRound(pipelineIdFrom(r.stdout)).formAnswer.values, { verdict: 'approve', picked: 'a' });
});

test('form arm: CRLF-terminated input answers exactly like LF (Windows pipes)', async () => {
  await seed('formAskerD', 'wf_cliform_d', { 'review-mockups': REVIEW_FORM });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form crlf e2e', '--workflow', 'wf_cliform_d'], {
    script: [
      { cue: /Choose \[number or value, Enter = approve\]/, send: '2\r\n' },
      { cue: /Choose \[number or value\]/, send: 'a\r\n' },
      { cue: /Your answer/, send: 'more contrast\r\n' },
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 3, r.stdout);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(formRound(pipelineIdFrom(r.stdout)).formAnswer.values,
    { verdict: 'changes', picked: 'a', notes: 'more contrast' },
    'no stray \\r anywhere in the answer');
});

test('form arm: a review-list prompts per item and collects one row each', async () => {
  const STEPS_FORM = {
    version: 1, title: 'Review the plan',
    data: { type: 'object', required: ['steps'], properties: {
      steps: { type: 'array', items: { type: 'object', required: ['id'], properties: {
        id: { type: 'string' }, title: { type: 'string' } } } } } },
    answer: { type: 'object', required: ['steps'], properties: {
      steps: { type: 'array', items: { type: 'object', required: ['id', 'verdict'], properties: {
        id: { type: 'string' },
        verdict: { type: 'string', enum: ['keep', 'drop'], default: 'keep' },
        note: { type: 'string' } } } } } },
    layout: [{ widget: 'review-list', field: 'steps', bind: 'data.steps', label: 'Per-step verdict' }],
    example: { steps: [{ id: 's1', title: 'Core' }, { id: 's2', title: 'Engine' }] },
  };
  await seed('formAskerR', 'wf_cliform_r', { 'review-plan': STEPS_FORM },
    { form: 'review-plan', data: STEPS_FORM.example });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form review-list e2e', '--workflow', 'wf_cliform_r'], {
    script: [
      { cue: /Choose \[number or value, Enter = keep\]/, send: '1\n' },   // s1 verdict
      { cue: /Your answer/, send: '\n' },                                 // s1 note (optional)
      { cue: /Choose \[number or value, Enter = keep\]/, send: '2\n' },   // s2 verdict -> drop
      { cue: /Your answer/, send: 'too risky\n' },                        // s2 note
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 4, `only ${r.sent} prompt(s):\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Per-step verdict \*$/m);
  assert.deepEqual(formRound(pipelineIdFrom(r.stdout)).formAnswer.values, {
    steps: [{ id: 's1', verdict: 'keep' }, { id: 's2', verdict: 'drop', note: 'too risky' }],
  });
});

test('form arm: rank, multiselect, toggle, number and suggest; per-field re-prompts and the whole-form re-offer', async () => {
  // Every input class the review form above does not prompt, plus all four re-ask
  // paths: a validate() refusal (9 > maximum), a coerceInput refusal ("abc"), Enter on
  // a REQUIRED field with no default, and the whole-form re-offer collectAnswer forces
  // — a rank naming one item twice is admitted by coerceInput (unlisted items are
  // appended) and refused by collectAnswer with `unique`, so askForm re-asks from
  // the first offending field. Pass 2 also takes Enter on the optional multiselect
  // (dropped) and on the number (its default).
  const RICH_FORM = {
    version: 1, title: 'Rich widgets',
    data: { type: 'object', required: ['images'], properties: {
      summary: { type: 'string' },
      images: { type: 'array', items: { type: 'object', required: ['id'], properties: {
        id: { type: 'string' }, caption: { type: 'string' } } } } } },
    answer: { type: 'object', required: ['order', 'picked'], properties: {
      order: { type: 'array', items: { type: 'string', enumFrom: 'data.images[].id' } },
      tags: { type: 'array', items: { type: 'string', enum: ['spacing', 'colour', 'copy'] } },
      ship: { type: 'boolean', default: false },
      count: { type: 'integer', minimum: 1, maximum: 5, default: 2 },
      scope: { type: 'string' },
      picked: { type: 'string', enumFrom: 'data.images[].id' } } },
    layout: [
      { widget: 'markdown', bind: 'data.summary' },
      { widget: 'rank', field: 'order', bind: 'data.images', label: 'Order' },
      { widget: 'multiselect', field: 'tags', label: 'Tags' },
      { widget: 'toggle', field: 'ship', label: 'Ship it' },
      { widget: 'number', field: 'count', label: 'Count' },
      { widget: 'select', field: 'scope', label: 'Scope', suggest: ['Web only', 'Web and CLI'] },
      { widget: 'select', field: 'picked', label: 'Which one' },
    ],
    example: { summary: 'Two.', images: [{ id: 'a', caption: 'Option A' }, { id: 'b', caption: 'Option B' }] },
  };
  await seed('formAskerRich', 'wf_cliform_rich', { rich: RICH_FORM }, { form: 'rich', data: RICH_FORM.example });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form rich e2e', '--workflow', 'wf_cliform_rich'], {
    script: [
      { cue: /Order \[comma-separated numbers or ids\]/, send: 'a,a\n' },            // admitted here, refused by collectAnswer
      { cue: /Choose \[numbers or values, comma-separated\]/, send: '1,3\n' },
      { cue: /Choose \[y\/n, Enter = false\]/, send: '\n' },                          // Enter -> false
      { cue: /Enter a number \[Enter = 2\]/, send: '9\n' },                             // validate: Maximum is 5
      { cue: /Enter a number \[Enter = 2\]/, send: 'abc\n' },                           // coerce: not a number
      { cue: /Enter a number \[Enter = 2\]/, send: '4\n' },
      { cue: /Choose \[number, value or your own text\]/, send: 'Everything\n' },     // free text on a suggest select
      { cue: /Choose \[number or value\]/, send: '\n' },                               // required, no default
      { cue: /Choose \[number or value\]/, send: 'b\n' },
      // pass 2: collectAnswer refused the duplicate rank, so EVERY field is re-asked
      { cue: /Order \[comma-separated numbers or ids\]/, send: '2,1\n' },
      { cue: /Choose \[numbers or values, comma-separated\]/, send: '\n' },           // optional, dropped
      { cue: /Choose \[y\/n, Enter = false\]/, send: 'y\n' },
      { cue: /Enter a number \[Enter = 2\]/, send: '\n' },                              // Enter -> 2
      { cue: /Choose \[number, value or your own text\]/, send: '2\n' },              // ordinal -> 'Web and CLI'
      { cue: /Choose \[number or value\]/, send: '1\n' },                              // ordinal -> 'a'
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.sent, 15, `only ${r.sent} prompt(s):\n${r.stdout}`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /count: Maximum is 5\./, 'a validate() refusal names the field (formatFormErrors)');
  assert.match(r.stdout, /Count: "abc" is not a number/, 'a coerceInput refusal carries the label (formatCoerceError)');
  assert.match(r.stdout, /Which one is required/, 'Enter on a required field with no default re-prompts');
  assert.match(r.stdout, /order: Each item may appear only once\./, 'collectAnswer refused the duplicate rank');
  assert.equal((r.stdout.match(/Order \*\n {2}1\) Option A/g) || []).length, 2, 're-offered exactly once, from the rank');
  assert.deepEqual(formRound(pipelineIdFrom(r.stdout)).formAnswer.values,
    { order: ['b', 'a'], ship: true, count: 2, scope: 'Web and CLI', picked: 'a' });
});

test('MAJ-7 parity: /dev/null stdin without --yes still refuses before anything is created', async () => {
  await seed('formAskerE', 'wf_cliform_e', { 'review-mockups': REVIEW_FORM });
  const repo = freshRepo();
  const before = pipelineStatuses().length;
  const r = await driveCli(['--project', repo, '--prompt', 'form eof e2e', '--workflow', 'wf_cliform_e'], {
    stdin: 'ignore',
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.code, 2, `expected the fail() exit code\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /stdin cannot answer prompts/);
  assert.equal(pipelineStatuses().length, before, 'refused BEFORE start()');
});

// ── surface: 'web' (ruling X11) ────────────────────────────────────────────────
// A form that is meaningless as text. Chat prints it and keeps waiting — a chat run
// lives in the server and a browser can answer it. The CLI owns its orchestrator
// in-process and NOTHING can answer it there, so it declines: the projection
// prints, one line names the web UI, and the existing abandon ladder stops the run.

const WEB_ONLY_FORM = { ...REVIEW_FORM, surface: 'web', title: 'Pick a mockup' };

test('surface:"web": the CLI prints the projection, names the web UI, and stops the run', async () => {
  await seed('formAskerW', 'wf_cliform_w', { 'pick-mockup': WEB_ONLY_FORM },
    { form: 'pick-mockup', data: REVIEW_FORM.example });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form web-only e2e', '--workflow', 'wf_cliform_w'], {
    script: [],
  });
  assert.equal(r.timedOut, false, `the run HUNG instead of declining\n${r.stdout}`);
  assert.notEqual(r.code, 0, `a declined form is not a successful run\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

  // The projection still prints — the user sees what was asked.
  assert.match(r.stdout, /\? Pick a mockup — /);
  assert.match(r.stdout, /Two directions\./);
  // Exactly one line names the web UI, and NO prompt is ever opened.
  assert.match(r.stdout, /^This form is answered in the worca web UI\.$/m);
  assert.equal(/Choose \[/.test(r.stdout), false, 'no prompt is opened for a web-only form');

  // The existing abandon ladder owns the outcome: the row is never left running.
  assert.match(r.stderr, /worca: cannot continue without an answer — stopping the run\./);
  const rows = pipelineStatuses();
  assert.equal(rows.filter((p) => p.status === 'running').length, 0, JSON.stringify(rows));
});

test('surface:"any" (or absent) still prompts — the refusal is opt-in', async () => {
  await seed('formAskerX', 'wf_cliform_x', { 'review-mockups': { ...REVIEW_FORM, surface: 'any' } });
  const repo = freshRepo();
  const r = await driveCli(['--project', repo, '--prompt', 'form surface any e2e', '--workflow', 'wf_cliform_x'], {
    script: [
      { cue: /Choose \[number or value, Enter = approve\]/, send: '1\n' },
      { cue: /Choose \[number or value\]/, send: '1\n' },
    ],
  });
  assert.equal(r.timedOut, false, r.stdout);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(/answered in the worca web UI/.test(r.stdout), false, r.stdout);
});
