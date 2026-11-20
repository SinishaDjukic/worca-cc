// test/ui-agent-forms.test.mjs — the Agents view's Forms section (spec §11).
// jsdom, booting the real app.js the way test/ui-agent-editor.test.mjs does.
// The section is a list of {form id, JSON def}; gate 1 runs live and marks the
// row BY PATH; a complete PUT carries `ask`, and an emptied list omits it.
// House rule: the section carries NO explanatory prose.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const FORM = {
  version: 1, title: 'Pick one',
  data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } } },
  answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] } } },
  layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }],
  example: { summary: 'Something happened.' },
};

const AGENTS = [
  { key: 'asker', displayName: 'Asker', description: 'asks', color: 'green', runnerType: 'producer',
    metaVersion: 2, order: 42, origin: 'user',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
    ask: { forms: { 'pick-one': FORM } } },
  { key: 'plain', displayName: 'Plain', description: 'no forms', color: 'blue', runnerType: 'producer',
    metaVersion: 2, order: 43, origin: 'user',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] },
];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send() {}
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
}

async function boot({ fetchHandler, hooks } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  if (hooks) window.__worcaTestHooks = hooks;   // e.g. the real marked + DOMPurify for the markdown pins
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    const detail = u.match(/\/api\/agents\/([^/?]+)$/);
    if (detail && (!opts || !opts.method || opts.method === 'GET')) {
      const meta = AGENTS.find((a) => a.key === detail[1]);
      if (meta) return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta, markdown: '# b\n' }) });
    }
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, mockWriterRoles: [] }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return window;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const typeInto = (window, node, value) => {
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
};
/** Build a detached form host the way the card editor does. */
function host(window, meta) {
  const div = window.document.createElement('div');
  div.className = 'agent-form';
  window.document.body.appendChild(div);
  window.__agents.agentFormRender(div, meta, { markdown: '# b\n', mockWriterRoles: [], registryKeys: [] });
  return div;
}

test('forms render one row per form and agentFormRead round-trips ask.forms, omitting ask when the last row is removed', async () => {
  const window = await boot();
  const root = host(window, AGENTS[0]);
  await checkRows([
    { name: 'an agent with forms renders one row per form, id + JSON def', run: async () => {
      const rows = [...root.querySelectorAll('.agent-form-row')];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].querySelector('.afm-id').value, 'pick-one');
      const ta = rows[0].querySelector('.afm-editor .code-editor-ta');
      assert.ok(ta, 'the shared code editor is what edits the def');
      assert.equal(JSON.parse(ta.value).title, 'Pick one');
      assert.equal(rows[0].querySelector('.afm-id').value.includes('{'), false, 'the id is NOT inside the JSON');
    } },
    { name: 'agentFormRead emits ask.forms, and OMITS ask when the last row is removed', run: async () => {
      const read = window.__agents.agentFormRead(root);
      assert.deepEqual(Object.keys(read.meta.ask.forms), ['pick-one']);
      assert.deepEqual(read.meta.ask.forms['pick-one'], FORM, 'the def round-trips byte-for-byte');

      click(window, root.querySelector('.afm-remove'));
      await tick();
      assert.equal(root.querySelectorAll('.agent-form-row').length, 0);
      assert.equal(window.__agents.agentFormRead(root).meta.ask, undefined,
        'omitting ask on a metaVersion-2 PUT is what CLEARS the forms');
    } },
  ]);
});

test('gate 1 runs live and names the failing PATH; a good form shows nothing', async () => {
  const window = await boot();
  const root = host(window, AGENTS[0]);
  const row = root.querySelector('.agent-form-row');
  const errors = row.querySelector('.afm-errors');
  assert.equal(errors.hidden, true, 'a valid form shows no error line');

  const broken = { ...FORM, layout: [{ widget: 'grid', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }] };
  typeInto(window, row.querySelector('.afm-editor .code-editor-ta'), JSON.stringify(broken, null, 2));
  await tick();
  assert.equal(errors.hidden, false);
  assert.match(errors.textContent, /layout#1/, 'errors are marked BY PATH, as P1 emits them (1-based ordinal)');
  assert.match(errors.textContent, /"grid" is not in the catalog/);
});

test('unparseable JSON shows one invalid-JSON line and keeps the last good def', async () => {
  const window = await boot();
  const root = host(window, AGENTS[0]);
  const row = root.querySelector('.agent-form-row');
  typeInto(window, row.querySelector('.afm-editor .code-editor-ta'), '{ "version": ');
  await tick();
  assert.match(row.querySelector('.afm-errors').textContent, /invalid JSON/);
  assert.equal(JSON.parse(row.dataset.def).title, 'Pick one', 'the last good parse is what a save would carry');
  const read = window.__agents.agentFormRead(root);
  assert.equal(read.meta.ask.forms['pick-one'].title, 'Pick one');
});

/** The REAL card editor: Edit -> the pane, with the store stubbed per test. */
async function openEditor(window, meta) {
  const card = window.__agents.buildAgentCard(meta);
  window.document.body.appendChild(card);
  await window.__agents.openAgentEdit(card, meta);
  await tick(); await tick();
  return { card, pane: card.querySelector('.agent-edit-pane') };
}
/** A fetchHandler that records every PUT body and answers it with `answer`; GETs fall through. */
const withPut = (puts, answer) => (u, opts) => {
  if (/\/api\/agents\/[^/?]+$/.test(u) && opts.method === 'PUT') {
    puts.push(JSON.parse(opts.body));
    return Promise.resolve(answer);
  }
  return null;
};
const SAVED = { ok: true, status: 200, json: async () => ({ meta: AGENTS[0], markdown: '# b', warnings: [], updatedVariants: [] }) };

test('two rows with one form id: Save refuses, names the id, and sends nothing (P20)', async () => {
  const puts = [];
  const window = await boot({ fetchHandler: withPut(puts, SAVED) });
  const { pane } = await openEditor(window, AGENTS[0]);
  click(window, pane.querySelector('.afm-add'));
  await tick();
  const rows = [...pane.querySelectorAll('.agent-form-row')];
  assert.equal(rows.length, 2);
  typeInto(window, rows[1].querySelector('.afm-id'), 'pick-one');
  await tick();
  assert.match(pane.querySelector('.afm-hint-section').textContent, /duplicate form id "pick-one"/);
  const read = window.__agents.agentFormRead(pane);
  assert.deepEqual(read.problems, ['duplicate form id "pick-one"']);
  assert.equal(read.meta.ask.forms['pick-one'].title, 'Pick one', 'the FIRST row is the one kept in the payload');
  click(window, pane.querySelector('.agent-edit-save'));
  await tick(); await tick(); await tick();
  assert.deepEqual(puts, [], 'a JSON object cannot carry two rows with one key, so nothing is sent');
  // #555: the refusal is a field error on the clashing id, not a line under the editor.
  assert.match(fieldErrorText(rows[1].querySelector('.afm-id')), /duplicate form id "pick-one"/);
  assert.equal(rows[1].querySelector('.afm-id').getAttribute('aria-invalid'), 'true');
  assert.equal(pane.hidden, false, 'the editor stays open');
});

test('a successful Save PUTs the forms and disposes the editors before the pane closes', async () => {
  const puts = [];
  const window = await boot({ fetchHandler: withPut(puts, SAVED) });
  const { pane } = await openEditor(window, AGENTS[0]);
  const ed = pane.querySelector('.agent-form-row').__editor;
  let destroyed = false;
  const real = ed.destroy;
  ed.destroy = () => { destroyed = true; real.call(ed); };
  click(window, pane.querySelector('.agent-edit-save'));
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(puts.length, 1, 'the PUT went out');
  assert.equal(puts[0].meta.metaVersion, 2);
  assert.deepEqual(puts[0].meta.ask.forms['pick-one'], FORM, 'the real editor path carries the def byte-for-byte');
  assert.equal(destroyed, true, 'no highlight debounce survives on a pane loadAgentsView() is about to replace');
  assert.equal(pane.hidden, true);
});

test('a row with a def but NO id: Save refuses, names the rule, and sends nothing (P21)', async () => {
  const puts = [];
  const window = await boot({ fetchHandler: withPut(puts, SAVED) });
  const { pane } = await openEditor(window, AGENTS[0]);
  click(window, pane.querySelector('.afm-add'));
  await tick();
  const rows = [...pane.querySelectorAll('.agent-form-row')];
  typeInto(window, rows[1].querySelector('.afm-editor .code-editor-ta'), JSON.stringify({ ...FORM, title: 'Unnamed' }, null, 2));
  await tick();
  assert.equal(rows[1].querySelector('.afm-errors').textContent, 'a form id is required');
  assert.deepEqual(window.__agents.agentFormRead(pane).problems, ['a form id is required']);
  click(window, pane.querySelector('.agent-edit-save'));
  await tick(); await tick(); await tick();
  assert.deepEqual(puts, [], 'a row with no id is not in the payload at all, so Save would silently drop it \u2014 refuse instead');
  assert.match(fieldErrorText(rows[1].querySelector('.afm-id')), /a form id is required/);
  assert.equal(pane.hidden, false, 'the editor stays open with the typed def still in it');
  assert.match(rows[1].querySelector('.afm-editor .code-editor-ta').value, /Unnamed/);
});

test('each row previews its example + projection; only a changed def rebuilds the preview', async () => {
  const window = await boot();
  const root = host(window, AGENTS[0]);
  await checkRows([
    { name: 'each row previews the form from its example and prints the projection beside it', run: async () => {
      const row = root.querySelector('.agent-form-row');
      const preview = row.querySelector('.afm-preview');
      const projection = row.querySelector('.afm-projection');
      assert.ok(preview.firstElementChild, 'the real renderAskForm drew the declaration');
      assert.match(projection.textContent, /Pick one/, 'the text projection is what CLI, chat and History show');
      assert.match(projection.textContent, /verdict/);
    } },
    { name: 'editing the def rebuilds the preview; an unchanged keystroke does not', run: async () => {
      const row = root.querySelector('.agent-form-row');
      const before = row.querySelector('.afm-preview').firstElementChild;
      typeInto(window, row.querySelector('.afm-editor .code-editor-ta'), JSON.stringify(FORM, null, 2) + '\n');
      await tick();
      assert.equal(row.querySelector('.afm-preview').firstElementChild, before,
        'the same def must not wipe a half-scrolled preview');

      typeInto(window, row.querySelector('.afm-editor .code-editor-ta'),
        JSON.stringify({ ...FORM, title: 'Pick another' }, null, 2));
      await tick();
      assert.notEqual(row.querySelector('.afm-preview').firstElementChild, before);
      assert.match(row.querySelector('.afm-projection').textContent, /Pick another/);
    } },
  ]);
});

test('a built-in or plugin agent is read-only: no Edit button, a read-only forms list', async () => {
  const window = await boot({ fetchHandler: (u, opts) => {
    if (/\/api\/agents\/pluginAsker$/.test(u) && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        meta: { key: 'pluginAsker', displayName: 'Plugin Asker', metaVersion: 2, runnerType: 'producer',
          origin: 'plugin:demo', order: 44,
          inputs: [{ id: 'task', type: 'md' }],
          outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
          ask: { forms: { 'pick-one': FORM } } },
        markdown: '# plugin asker\n',
      }) });
    }
    return null;
  } });
  const card = window.__agents.buildAgentCard({
    key: 'pluginAsker', displayName: 'Plugin Asker', origin: 'plugin:demo', metaVersion: 2,
    runnerType: 'producer', inputs: [], outputs: [],
  });
  window.document.body.appendChild(card);
  assert.equal(card.querySelector('.agent-edit').hidden, true, 'a plugin agent is never editable here');
  window.__agents.toggleAgentDetail(card);
  await tick(); await tick();
  const rows = [...card.querySelectorAll('.agent-forms-view .afv-row')];
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /pick-one/);
  assert.ok(rows[0].querySelector('.ask-form, .afv-preview > *'), 'the form is still inspectable, read-only');
  assert.equal(card.querySelector('.agent-forms-view .code-editor-ta'), null, 'no editor for a non-user agent');
});

/** The real bundle, exactly as test/ui-workspaces.test.mjs injects it. */
const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
const MD_FORM = { ...FORM, example: { summary: 'Something **bold** happened.' } };
const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 5)); } return false; };

test('the editor preview draws markdown through the page pipeline, as a run does', async () => {
  const window = await boot({ hooks: { askMarkdown: realMarkdown } });
  const root = host(window, { ...AGENTS[1], key: 'mdAsker', ask: { forms: { 'pick-one': MD_FORM } } });
  const md = root.querySelector('.afm-preview .af-md');
  assert.ok(md, 'the markdown widget is in the preview');
  assert.ok(await until(() => md.querySelector('strong')),
    'the ask panel and History pass the page markdown seam; the preview must show the same picture, not the source text');
  assert.ok(md.classList.contains('artifact-markdown'));
  assert.doesNotMatch(md.textContent, /\*\*/);
});
