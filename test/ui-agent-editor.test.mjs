// test/ui-agent-editor.test.mjs — jsdom tests for the in-card agent editor pane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet', runnerType: 'producer',
    metaVersion: 2, order: 1, origin: 'builtin', portSummary: 'Reads task; produces plan.',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md', store: 'project' }] },
  { key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs', color: 'green', runnerType: 'verifier',
    metaVersion: 2, order: 42, origin: 'user', portSummary: 'Reads plan; produces review.',
    verdict: { filename: 'docs-review.json' },
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'docs-review.md' },
              { id: 'pass', type: 'void', when: 'clean' }] },
  // Description resolved from the .md frontmatter, not authored in the sidecar.
  { key: 'derivedDesc', displayName: 'Derived Desc', description: 'Came from the .md frontmatter.',
    descriptionDerived: true, color: 'blue', runnerType: 'producer', metaVersion: 2, order: 43, origin: 'user',
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'review', type: 'md', filename: 'review.md' }] },
];
const MOCK_ROLES = ['clarify', 'planner-plan', 'generic-producer', 'generic-verifier'];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    // GET /api/agents/:key -> the full v2 pair the editor pane renders from.
    const detail = u.match(/\/api\/agents\/([^/?]+)$/);
    if (detail && (!opts || !opts.method || opts.method === 'GET')) {
      const meta = AGENTS.find((a) => a.key === detail[1]);
      if (meta) return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta, markdown: '# b\n' }) });
    }
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, mockWriterRoles: MOCK_ROLES }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window, ws: () => WSStub.last }; // ws accessor: Task 7's wizard tests destructure it
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const goAgents = async (window) => {
  window.location.hash = 'agents';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

test('Edit opens the pane, fills fields via .value (markup inert), and PUTs the edited agent', async () => {
  const puts = [];
  const MD_XSS = '# body\n<img src=x onerror="boom()">\n';
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/docsWriter') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: AGENTS[1], markdown: MD_XSS }) });
      }
      if (u.endsWith('/api/agents/docsWriter') && opts.method === 'PUT') {
        puts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: { ...AGENTS[1], displayName: 'Docs v2' }, markdown: MD_XSS }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const doc = window.document;
  const card = doc.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  const pane = card.querySelector('.agent-edit-pane');
  assert.equal(pane.hidden, false, 'edit pane visible');
  const ta = card.querySelector('.agent-f-md');
  assert.equal(ta.value, MD_XSS, 'markdown bound via .value');
  assert.equal(ta.querySelector && ta.querySelector('img'), null, 'no element parsed (never innerHTML)');
  assert.equal(card.querySelector('.agent-f-name').value, 'Docs Writer');
  // the typed INPUT ports render as editable rows, not channel chips
  assert.deepEqual([...card.querySelectorAll('.agent-ports-in .port-row .pf-id')].map((i) => i.value), ['plan']);

  card.querySelector('.agent-f-name').value = 'Docs v2';
  ta.value = MD_XSS + 'edited\n';
  click(window, card.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].meta.displayName, 'Docs v2');
  assert.deepEqual(puts[0].meta.inputs.map((p) => p.id), ['plan']);
  assert.equal(puts[0].meta.consumes, undefined, 'no channel fields are ever PUT');
  assert.equal(puts[0].markdown, MD_XSS + 'edited\n');
});

test('the pane renders typed ports and PUTs exactly what the form read back', async () => {
  const puts = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/agents/docsWriter') && opts && opts.method === 'PUT') {
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

test('a derived description is shown as a placeholder, never pre-filled, and never PUT back', async () => {
  const puts = [];
  const derived = AGENTS[2];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/derivedDesc') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: derived, markdown: '# b' }) });
      }
      if (u.endsWith('/api/agents/derivedDesc') && opts.method === 'PUT') {
        puts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: derived, markdown: '# b' }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const card = window.document.querySelector('.agent-card[data-agent-key="derivedDesc"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  const desc = card.querySelector('.agent-f-desc');
  assert.equal(desc.value, '', 'computed text must not masquerade as authored input');
  assert.equal(desc.placeholder, derived.description, 'but the user still sees where the blurb comes from');
  click(window, card.querySelector('.agent-edit-save')); // save WITHOUT touching the description
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].meta.description, '', 'a no-op save cannot freeze the fallback into the sidecar');
});

test('a 400 on save keeps the pane open and surfaces the store rule VERBATIM', async () => {
  const rule = 'outputs.review: md outputs require a filename template';
  const { window } = await boot({ fetchHandler: (u, opts) => (u.includes('/api/agents/docsWriter') && opts && opts.method === 'PUT'
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

// MAJ-15 (UI half): a port change that strands a saved wire is reported by
// PUT /api/agents/:key as `warnings: [...]`. The save SUCCEEDED, so the banner
// must not read as an error — it names the pipelines the run gate will now refuse.
test('a PUT that returns warnings surfaces them beside the save confirmation', async () => {
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/agents/docsWriter') && opts && opts.method === 'PUT') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        meta: { key: 'docsWriter' }, markdown: '# b\n',
        warnings: ['saved pipelines reference a removed port: Docs Flow (n_d.review)'],
      }) });
    }
    return null;
  } });
  await goAgents(window);
  const card = window.document.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  click(window, card.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  const msg = window.document.querySelector('#agents-msg');
  assert.equal(msg.textContent,
    'Agent saved. saved pipelines reference a removed port: Docs Flow (n_d.review)');
  assert.equal(msg.className, 'form-msg warn', 'a saved-with-caveats banner is not an error');
});

// MIN-19 (UI half): propagating a port change to a workspace variant is a SUCCESS,
// not a caveat — the banner names the variants and stays green.
test('a PUT that updated workspace variants names them and stays an ok banner', async () => {
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/agents/docsWriter') && opts && opts.method === 'PUT') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        meta: { key: 'docsWriter' }, markdown: '# b\n', warnings: [], updatedVariants: ['docsWriterWs'],
      }) });
    }
    return null;
  } });
  await goAgents(window);
  const card = window.document.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  click(window, card.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  const msg = window.document.querySelector('#agents-msg');
  assert.equal(msg.textContent, 'Agent saved. Workspace variants updated: docsWriterWs.');
  assert.equal(msg.className, 'form-msg ok');
});
