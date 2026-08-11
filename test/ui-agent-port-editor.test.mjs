// test/ui-agent-port-editor.test.mjs
// The Agents-view PORT EDITOR — the v1 channel form's replacement.
//
// The v1 form spoke channels (consumes / optionalConsumes / produces /
// connectsTo). Meta v2 has no such fields, so that form could only ever PUT a
// body the store 400s; this suite pins the surface that replaces it. It is
// deliberately the FULL v2 sidecar surface — port rows with every flag, the
// per-port `as` renderer and `directive`, plus the agent-level capability
// panel — because anything less forces users into hand-editing sidecar JSON,
// which is exactly the pluggability the port schema exists to remove.
//
// The store is authoritative: save renders its 400 text VERBATIM rather than
// paraphrasing a rule the UI would then have to keep in sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const MOCK_ROLES = [...MOCK_WRITER_ROLES];

/** A user agent exercising every corner of the v2 surface. */
const DOCS_WRITER = {
  metaVersion: 2,
  key: 'docsWriter',
  displayName: 'Docs Writer',
  description: 'Writes the docs.',
  color: 'green',
  icon: '',
  agentFile: 'docsWriter.md',
  runnerType: 'verifier',
  scope: 'project',
  domain: 'coding',
  order: 8,
  fanOut: true,
  asksQuestions: true,
  questionsLocked: true,
  questionsDefault: true,
  promptHints: '',
  requiresSkills: [],
  verdict: { filename: 'docs-review-cycle{cycle}.json' },
  sideEffect: 'code',
  mockRole: 'generic-verifier',
  wantsRequest: true,
  workspaceFanOut: true,
  workspaceStrategy: 'review',
  workspaceVariantOf: 'reviewer',
  origin: 'user',
  inputs: [
    { id: 'plan', type: 'md', required: true, as: 'file' },
    { id: 'fix', type: 'md', required: false, loop: true, as: 'fix-review', directive: '## Fix it\n\n{path}' },
    { id: 'task', type: 'json', required: false, expands: true, as: 'file' },
  ],
  outputs: [
    { id: 'review', type: 'md', when: 'blocking', filename: '{base}-docs-review.md', store: 'project', artifactKind: 'review' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
};

const HIDDEN_AGENT = {
  metaVersion: 2, key: 'hiddenScan', displayName: 'Hidden Scan', description: 'Off-palette.',
  color: 'blue', icon: '', agentFile: 'hiddenScan.md', runnerType: 'producer', scope: 'project',
  domain: 'coding', order: 9, fanOut: false, asksQuestions: false, questionsLocked: false,
  questionsDefault: false, promptHints: '', requiresSkills: [], placeable: false, origin: 'user',
  inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'notes', type: 'md', when: 'always', filename: 'notes.md', store: 'run', artifactKind: 'notes' }],
};

const BUILTIN = {
  metaVersion: 2, key: 'reviewer', displayName: 'Review Implementation', description: 'Reviews.',
  color: 'blue', icon: '', agentFile: 'reviewer.md', runnerType: 'verifier', scope: 'project',
  domain: 'coding', order: 4, fanOut: true, asksQuestions: false, questionsLocked: false,
  questionsDefault: false, promptHints: '', requiresSkills: [],
  verdict: { filename: 'impl-review-cycle{cycle}.json' }, origin: 'builtin',
  inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'pass', type: 'void', when: 'clean' }],
};

const AGENTS = [BUILTIN, DOCS_WRITER, HIDDEN_AGENT];

async function boot({ put = null } = {}) {
  const calls = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    const json = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
    if (opts && opts.method === 'PUT' && u.includes('/api/agents/')) {
      const body = JSON.parse(opts.body);
      calls.push({ url: u, body });
      return put ? put(body) : json({ meta: { ...body.meta, origin: 'user' }, markdown: body.markdown });
    }
    if (u.includes('/api/agents/')) {
      const key = decodeURIComponent(u.split('/api/agents/')[1]);
      const meta = AGENTS.find((a) => a.key === key);
      return json({ meta, markdown: `# ${key}\n\nbody\n` });
    }
    if (u.includes('/api/agents')) return json({ agents: AGENTS, channels: [], mockWriterRoles: MOCK_ROLES });
    if (u.includes('/api/workflows')) return json({ workflows: [] });
    if (u.includes('/api/projects')) return json({ projects: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* jsdom-only key */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  window.location.hash = 'agents';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 20));
  return { window, doc: window.document, calls };
}

const cardOf = (doc, key) => [...doc.querySelectorAll('#agents-list .agent-card')]
  .find((c) => c.querySelector('.agent-name').textContent === (AGENTS.find((a) => a.key === key) || {}).displayName);

async function openEditor(ctx, key) {
  const card = cardOf(ctx.doc, key);
  assert.ok(card, `card for ${key}`);
  card.querySelector('.agent-edit').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const pane = card.querySelector('.agent-edit-pane');
  assert.equal(pane.hidden, false, 'the edit pane opens');
  return { card, pane };
}

async function save(ctx, pane) {
  pane.querySelector('.agent-edit-save').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
}

const rows = (pane, side) => [...pane.querySelectorAll(`.agent-ports-${side} .port-row`)];

// ============================================================ port rows

test('port rows expose the full v2 input surface, in order', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  const ins = rows(pane, 'in');
  assert.equal(ins.length, 3);
  assert.deepEqual(ins.map((r) => r.querySelector('.pf-id').value), ['plan', 'fix', 'task']);

  const fix = ins[1];
  assert.equal(fix.querySelector('.pf-type').value, 'md');
  assert.equal(fix.querySelector('.pf-required').checked, false);
  assert.equal(fix.querySelector('.pf-loop').checked, true);
  assert.equal(fix.querySelector('.pf-expands').checked, false);
  assert.equal(fix.querySelector('.pf-as').value, 'fix-review');
  assert.equal(fix.querySelector('.pf-directive').value, '## Fix it\n\n{path}');
  // The directive is long-form and rare — collapsed until asked for.
  assert.equal(fix.querySelector('.pf-directive-wrap').hidden, true);

  const task = ins[2];
  assert.equal(task.querySelector('.pf-type').value, 'json');
  assert.equal(task.querySelector('.pf-expands').checked, true);
});

test('output rows carry when / filename / store', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  const outs = rows(pane, 'out');
  assert.deepEqual(outs.map((r) => r.querySelector('.pf-id').value), ['review', 'pass']);
  assert.equal(outs[0].querySelector('.pf-when').value, 'blocking');
  assert.equal(outs[0].querySelector('.pf-filename').value, '{base}-docs-review.md');
  assert.equal(outs[0].querySelector('.pf-store').value, 'project');
  assert.equal(outs[1].querySelector('.pf-type').value, 'void');
  assert.equal(outs[1].querySelector('.pf-when').value, 'clean');
});

test('the v1 channel vocabulary is gone from the form', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  for (const cls of ['.agent-f-consumes', '.agent-f-optional', '.agent-f-produces', '.agent-f-connects', '.agent-f-connect-any', '.agent-f-loopsource']) {
    assert.equal(pane.querySelector(cls), null, `${cls} died with the v1 form`);
  }
});

test('editing a port row round-trips through the PUT as v2 meta', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  const review = rows(pane, 'out')[0];
  review.querySelector('.pf-filename').value = '{base}-handbook.md';
  review.querySelector('.pf-store').value = 'run';
  rows(pane, 'in')[0].querySelector('.pf-id').value = 'blueprint';
  await save(ctx, pane);

  assert.equal(ctx.calls.length, 1);
  const { meta } = ctx.calls[0].body;
  assert.equal(meta.metaVersion, 2);
  assert.equal(meta.key, 'docsWriter');
  assert.deepEqual(meta.inputs.map((p) => p.id), ['blueprint', 'fix', 'task']);
  // artifactKind is not surfaced by the editor — and is carried through
  // untouched, so editing a filename cannot silently drop a sidecar key.
  assert.deepEqual(meta.outputs[0], {
    id: 'review', type: 'md', when: 'blocking', filename: '{base}-handbook.md', store: 'run',
    artifactKind: 'review',
  });
  // A void output carries neither filename nor store — the store 400s on either.
  assert.deepEqual(meta.outputs[1], { id: 'pass', type: 'void', when: 'clean' });
  assert.deepEqual(meta.inputs[1], {
    id: 'fix', type: 'md', required: false, loop: true, as: 'fix-review', directive: '## Fix it\n\n{path}',
  });
  assert.deepEqual(meta.inputs[2], { id: 'task', type: 'json', required: false, expands: true, as: 'file' });
  // ...and nothing from the dead vocabulary rides along.
  for (const dead of ['consumes', 'optionalConsumes', 'produces', 'connectsTo', 'loopSource', 'channelDefs', 'uiPhase']) {
    assert.equal(dead in meta, false, `${dead} must not be PUT`);
  }
});

test('rows can be added and removed', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  pane.querySelector('.pf-add-in').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  const added = rows(pane, 'in')[3];
  assert.ok(added, 'a blank input row appears');
  added.querySelector('.pf-id').value = 'notes';
  added.querySelector('.pf-type').value = 'md';
  rows(pane, 'in')[2].querySelector('.pf-remove').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await save(ctx, pane);
  assert.deepEqual(ctx.calls[0].body.meta.inputs.map((p) => p.id), ['plan', 'fix', 'notes']);
});

// ================================================== agent capability panel

test('the capability panel exposes the whole v2 agent surface and round-trips it', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  assert.equal(pane.querySelector('.agent-f-runner').value, 'verifier');
  assert.deepEqual([...pane.querySelectorAll('.agent-f-runner option')].map((o) => o.value),
    ['producer', 'verifier', 'clarifier']);
  assert.equal(pane.querySelector('.agent-f-verdict').value, 'docs-review-cycle{cycle}.json');
  assert.equal(pane.querySelector('.agent-f-sideeffect').checked, true);
  assert.equal(pane.querySelector('.agent-f-mockrole').value, 'generic-verifier');
  assert.equal(pane.querySelector('.agent-f-wantsrequest').checked, true);
  assert.equal(pane.querySelector('.agent-f-ws-fanout').checked, true);
  assert.equal(pane.querySelector('.agent-f-ws-strategy').value, 'review');
  assert.equal(pane.querySelector('.agent-f-ws-variantof').value, 'reviewer');
  assert.equal(pane.querySelector('.agent-f-placeable').checked, true);

  await save(ctx, pane);
  const { meta } = ctx.calls[0].body;
  assert.equal(meta.runnerType, 'verifier');
  assert.deepEqual(meta.verdict, { filename: 'docs-review-cycle{cycle}.json' });
  assert.equal(meta.sideEffect, 'code');
  assert.equal(meta.mockRole, 'generic-verifier');
  assert.equal(meta.wantsRequest, true);
  assert.equal(meta.workspaceFanOut, true);
  assert.equal(meta.workspaceStrategy, 'review');
  assert.equal(meta.workspaceVariantOf, 'reviewer');
  assert.equal('placeable' in meta, false, 'placeable is only written when FALSE — the default rides implicit');
});

test('the mockRole select is the server vocabulary plus a blank auto option', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  const values = [...pane.querySelectorAll('.agent-f-mockrole option')].map((o) => o.value);
  assert.equal(values[0], '', 'blank = auto');
  assert.deepEqual(values.slice(1), MOCK_ROLES);
  assert.equal(pane.querySelector('.agent-f-mockrole option').textContent, 'auto');
});

test('workspaceVariantOf offers the registry keys as a datalist', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  const input = pane.querySelector('.agent-f-ws-variantof');
  const list = pane.querySelector(`#${input.getAttribute('list')}`);
  assert.ok(list, 'the datalist is wired to the input');
  assert.deepEqual([...list.querySelectorAll('option')].map((o) => o.value).sort(),
    ['docsWriter', 'hiddenScan', 'reviewer']);
});

test('clearing an optional capability drops the key entirely', async () => {
  const ctx = await boot();
  const { pane } = await openEditor(ctx, 'docsWriter');
  pane.querySelector('.agent-f-sideeffect').checked = false;
  pane.querySelector('.agent-f-wantsrequest').checked = false;
  pane.querySelector('.agent-f-ws-strategy').value = '';
  pane.querySelector('.agent-f-ws-variantof').value = '';
  pane.querySelector('.agent-f-mockrole').value = '';
  await save(ctx, pane);
  const { meta } = ctx.calls[0].body;
  for (const k of ['sideEffect', 'wantsRequest', 'workspaceStrategy', 'workspaceVariantOf', 'mockRole']) {
    assert.equal(k in meta, false, `${k} is absent, not falsy`);
  }
});

test('placeable:false is written back and badges the card', async () => {
  const ctx = await boot();
  const card = cardOf(ctx.doc, 'hiddenScan');
  const badge = card.querySelector('.agent-not-placeable');
  assert.equal(badge.hidden, false, 'a not-placeable agent says so on its card');
  assert.equal(badge.textContent, 'not placeable');
  assert.equal(cardOf(ctx.doc, 'docsWriter').querySelector('.agent-not-placeable').hidden, true);

  const { pane } = await openEditor(ctx, 'hiddenScan');
  assert.equal(pane.querySelector('.agent-f-placeable').checked, false);
  await save(ctx, pane);
  assert.equal(ctx.calls[0].body.meta.placeable, false);
});

// ==================================================== the store's 400 text

test('a 400 renders the store rule text VERBATIM and keeps the pane open', async () => {
  const RULE = 'outputs.review: filename "a/b.md" must be a plain basename';
  const ctx = await boot({
    put: () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: RULE }) }),
  });
  const { pane } = await openEditor(ctx, 'docsWriter');
  rows(pane, 'out')[0].querySelector('.pf-filename').value = 'a/b.md';
  await save(ctx, pane);
  const msg = pane.querySelector('.agent-edit-msg');
  assert.equal(msg.textContent, RULE);
  assert.match(msg.className, /err/);
  assert.equal(pane.hidden, false, 'the user keeps their edits');
});

test('the reserved `await` port id surfaces the store rule on the id field', async () => {
  const RULE = 'inputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node';
  const ctx = await boot({
    put: () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: RULE }) }),
  });
  const { pane } = await openEditor(ctx, 'docsWriter');
  const idField = rows(pane, 'in')[0].querySelector('.pf-id');
  idField.value = 'await';
  await save(ctx, pane);
  assert.equal(ctx.calls[0].body.meta.inputs[0].id, 'await', 'the client does not pre-empt the store');
  assert.equal(pane.querySelector('.agent-edit-msg').textContent, RULE);
});

test('several broken rules arrive joined, exactly as the store sends them', async () => {
  const RULE = 'inputs: bad port id "" ; outputs.pass: type must be one of md, json, void';
  const ctx = await boot({
    put: () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: RULE }) }),
  });
  const { pane } = await openEditor(ctx, 'docsWriter');
  await save(ctx, pane);
  assert.equal(pane.querySelector('.agent-edit-msg').textContent, RULE);
});
