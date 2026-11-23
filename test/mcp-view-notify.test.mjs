// test/mcp-view-notify.test.mjs — #555 §7.1: the MCP view reports a write's result through an
// injected `notify` (a toast) and keeps every message load() emits on its inline .form-msg line.
// The no-`notify` inline fallback for a write failure is pinned in test/ui-mcp-view.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMcpView } from '../ui/public/mcp-view.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const click = (el) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
/** A row's ⋯ (Remove and Delete live there): open it, then pick the item by its label. */
const pickMore = (scope, label) => {
  click(scope.querySelector('.cx-more'));
  const item = [...doc.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === label);
  assert.ok(item, `the ⋯ menu offers ${label}`);
  click(item);
};
const change = (el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));

const SETS = [
  { id: 'general', name: 'General', group: 'general', greyed: false, home: null, serverCount: 0, problem: false, usedBy: [], members: [] },
  { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, serverCount: 1, problem: false, usedBy: [], members: [] },
];
const MEMBER = { serverId: 'manual:pg', base: 'pg', copy: 'pg_billing', provisional: false, source: 'manual', sourceLabel: 'Manual',
  type: 'stdio', description: 'Replica', enabled: true, fields: [], reason: null, problem: null, test: null, tooLong: null };
const VIEWS = {
  general: { set: { id: 'general', name: 'General', group: 'general', greyed: false, home: null, usedBy: [] }, members: [] },
  billing: { set: { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, usedBy: [] }, members: [MEMBER] },
};

function mount({ over = {}, newer = false } = {}) {
  const toasts = [];
  const modal = { opened: null, open(title, body, actions) { this.opened = { title, body, actions }; }, close() { this.opened = null; } };
  const api = async (method, path, body) => {
    const key = `${method} ${path}`;
    if (Object.hasOwn(over, key)) return over[key];
    if (key === 'GET /api/mcp/sets') return { ok: true, status: 200, data: { newer, sets: SETS } };
    if (method === 'GET' && path.startsWith('/api/mcp/sets/')) {
      const v = VIEWS[decodeURIComponent(path.slice(14))];
      return v ? { ok: true, status: 200, data: v } : { ok: false, status: 404, data: { error: 'set not found' } };
    }
    if (key === 'GET /api/mcp/servers') return { ok: true, status: 200, data: { newer, servers: [] } };
    return { ok: true, status: 200, data: { ok: true, id: 'new-set' } };
  };
  const host = doc.createElement('section');
  doc.body.replaceChildren(host);
  const ctl = createMcpView({ host, api, navigate: () => {}, confirm: async () => true, modal, doc, now: () => 0, notify: (o) => toasts.push(o) });
  return { host, ctl, toasts, modal };
}

test('MCP view feedback: write failures and successes toast (a field toggle says nothing), load() messages stay inline', async () => {
  // The two write-success rows share one mount: a toggle, a remove, then rename / duplicate /
  // delete, so the toasts list collects every write's result in that order.
  let shared;
  await checkRows([
    { name: 'a write failure is an err toast and leaves the inline line empty', run: async () => {
      const { host, ctl, toasts } = mount({ over: { 'PUT /api/mcp/sets/billing/members/manual%3Apg': { ok: false, status: 404, data: { error: 'server not found' } } } });
      await ctl.show('sets/billing');
      const sw = host.querySelector('[data-toggle="manual:pg"]');
      sw.checked = false;
      change(sw);
      await settle();
      assert.deepEqual(toasts, [{ tone: 'err', title: 'server not found', detail: '' }]);
      assert.equal(host.querySelector('.form-msg').textContent, '');
    } },
    { name: 'a load failure stays inline (err-inline), never a toast', run: async () => {
      const { host, ctl, toasts } = mount();
      await ctl.show('sets/nope');
      assert.deepEqual(toasts, []);
      assert.equal(host.querySelector('.form-msg.err').textContent, 'set not found');
    } },
    { name: '"need a newer Worca" from load() stays inline', run: async () => {
      const { host, ctl, toasts } = mount({ newer: true });
      await ctl.show('sets/billing');
      assert.deepEqual(toasts, []);
      assert.equal(host.querySelector('.form-msg.err').textContent, 'MCP registry files need a newer Worca');
      const servers = mount({ newer: true });
      await servers.ctl.show('servers');
      assert.deepEqual(servers.toasts, []);
      assert.equal(servers.host.querySelector('.form-msg.err').textContent, 'MCP registry files need a newer Worca');
    } },
    { name: 'removing a server from a set toasts "Server removed"; a field toggle stays state-only', run: async () => {
      shared = mount();
      const { host, ctl, toasts } = shared;
      await ctl.show('sets/billing');
      const sw = host.querySelector('[data-toggle="manual:pg"]');
      sw.checked = false;
      change(sw);
      await settle();
      assert.deepEqual(toasts, [], 'a toggle says nothing');
      pickMore(host.querySelector('.cx-row[data-server="manual:pg"]'), 'Remove from set');
      await settle();
      assert.deepEqual(toasts, [{ tone: 'ok', title: 'Server removed', detail: '' }]);
    } },
    { name: 'set actions toast their result: renamed, duplicated, deleted', run: async () => {
      const { host, ctl, toasts, modal } = shared;
      const named = async (act, name) => {
        click(host.querySelector(`[data-act="${act}"]`));
        await settle();
        modal.opened.body.querySelector('input').value = name;
        modal.opened.actions.find(([label]) => label === 'Save')[2]();
        await settle();
      };
      await named('rename', 'Billing 2');
      await named('duplicate', 'Billing copy');
      await ctl.show('sets/billing');
      pickMore(host.querySelector('.cx-set-head'), 'Delete set');
      await settle();
      assert.deepEqual(toasts.map((t) => t.title), ['Server removed', 'Set renamed', 'Set duplicated', 'Set deleted']);
      assert.ok(toasts.every((t) => t.tone === 'ok'));
    } },
  ]);
});
