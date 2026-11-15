// test/stillhet-workflows-copy-draft.test.mjs — Stillhet's Workflows: "Edit a copy by hand" opens a never-saved draft
// (F-5-08). Opening and Discard send nothing; Save creates the copy once under a free name ("X copy", "X copy 2"); Use as a
// template takes the next free name too; the demo opens the same draft. Live hosts over a fake API that mints wf_<slug>
// and answers 409 for a slug it already has, as dev's create with no id does; two demo hosts.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { workflowsHost, WF_LISTS, settle, go, clone, saidText, closeHosts } from './helpers/stillhet-workflows-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const sent = (calls) => calls.filter((c) => c.method !== 'GET');
const pick = async (d, menu, value) => { d.querySelector(`[data-menu="${menu}"]`).click(); await settle(20); d.querySelector(`[data-menu-pick="${menu}|${value}"]`).click(); await settle(40); };

// a server that keeps what it creates: the list read after a Save holds the copy
function server() {
  const list = clone(WF_LISTS['/api/workflows'].workflows), answers = [];
  const slug = (n) => `wf_${n.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    answers,
    read: (u) => (u === '/api/workflows' ? [200, { workflows: clone(list) }] : null),
    write: (u, b, m) => {
      if (m !== 'POST' || u !== '/api/workflows' || b.id) return [200, { ok: true }];
      const id = slug(b.name);
      if (list.some((t) => t.id === id)) { answers.push(409); return [409, { error: `a pipeline with the id "${id}" already exists — choose another name`, id }]; }
      list.push({ ...clone(b), id, origin: null }); answers.push(201);
      return [201, { workflow: { id, name: b.name } }];
    },
  };
}
const copyEdit = async (d) => { d.querySelector('[data-wf-copy-edit]').click(); await settle(80); };

test('F-5-08 live: Edit a copy by hand on wf_default opens #workflows/edit:copy-1 as a never-saved draft and sends no request', async () => {
  const { w, d, calls } = await workflowsHost({ hash: '#workflows/workflow:wf_default' });
  await copyEdit(d);
  assert.equal(w.location.hash, '#workflows/edit:copy-1');
  assert.deepEqual(sent(calls), [], 'opening the copy sends nothing');
  assert.match(d.querySelector('.wf-ed-top').textContent, /never saved/);
  assert.equal(d.querySelector('[data-ed-name]').value, 'Default copy');
  assert.match(saidText(d), /^Default copy: a draft until you save it/);
  const x = w.RailWorkflowLive.data().workflow.find((y) => y.id === 'copy-1');
  assert.ok(x.fresh && x.draft, 'a fresh record with its draft');
});

test('F-5-08 live: Save of the copy sends one POST /api/workflows with no id or origin, named Default copy, and opens the saved workflow', async () => {
  const s = server();
  const { w, d, calls } = await workflowsHost({ hash: '#workflows/workflow:wf_default', read: s.read, write: s.write });
  await copyEdit(d);
  d.querySelector('[data-draft-save]').click(); await settle(150);
  const p = sent(calls);
  assert.equal(p.length, 1); assert.equal(p[0].method, 'POST'); assert.equal(p[0].url, '/api/workflows');
  assert.equal(p[0].body.name, 'Default copy');
  assert.ok(!('id' in p[0].body) && !('origin' in p[0].body), 'no id, no origin');
  assert.ok(p[0].body.nodes.length > 2, 'the source graph, not the task→end stub');
  assert.equal(w.location.hash, '#workflows/workflow:wf_default-copy');
  assert.match(saidText(d), /^Saved Default copy: tasks run it from now/);
  assert.ok(!w.RailWorkflowLive.data().workflow.some((y) => y.id === 'copy-1'), 'the draft left');
});

test('F-5-08 live: Discard of the copy sends nothing and it is gone; Back instead keeps it as a Draft · never saved card on ~drafts', async () => {
  const a = await workflowsHost({ hash: '#workflows/workflow:wf_default' });
  const before = a.w.RailWorkflowLive.data().workflow.filter((y) => !y.fresh).map((y) => y.id);
  await copyEdit(a.d);
  a.d.querySelector('[data-draft-discard]').click(); await settle(80);
  assert.deepEqual(sent(a.calls), [], 'discard sends nothing');
  assert.equal(a.w.location.hash, '#workflows');
  assert.match(saidText(a.d), /Discarded Default copy/);
  assert.deepEqual(a.w.RailWorkflowLive.data().workflow.map((y) => y.id), before, 'the saved list unchanged, the copy gone');

  const b = await workflowsHost({ hash: '#workflows/workflow:wf_default' });
  await copyEdit(b.d);
  b.d.querySelector('[data-ed-back]').click(); await settle(80);
  await go(b.w, '#workflows/~drafts', 80);
  const card = [...b.d.querySelectorAll('.pg-grid > *')].find((c) => /Default copy/.test(c.textContent));
  assert.ok(card, 'the copy is on Drafts');
  assert.match(card.textContent, /Draft · never saved/);
  assert.ok(card.querySelector('[data-wf-edit="copy-1"]'), 'Go on editing');
  await go(b.w, '#workflows', 80);
  assert.ok(![...b.d.querySelectorAll('.pg-grid > *')].some((c) => /Default copy/.test(c.textContent)), 'not in All workflows');
  assert.deepEqual(sent(b.calls), []);
});

test('F-5-08 live: a second copy while the first is saved is named Default copy 2 and its Save answers 201, no 409', async () => {
  const s = server();
  const { w, d, calls } = await workflowsHost({ hash: '#workflows/workflow:wf_default', read: s.read, write: s.write });
  await copyEdit(d);
  d.querySelector('[data-draft-save]').click(); await settle(150);
  await go(w, '#workflows/workflow:wf_default', 80);
  await copyEdit(d);
  assert.equal(d.querySelector('[data-ed-name]').value, 'Default copy 2');
  d.querySelector('[data-draft-save]').click(); await settle(150);
  assert.deepEqual(sent(calls).map((c) => c.body.name), ['Default copy', 'Default copy 2']);
  assert.deepEqual(s.answers, [201, 201], 'no 409');
  assert.equal(w.location.hash, '#workflows/workflow:wf_default-copy-2');
});

test('F-5-08 live: Use as a template on a built-in twice: the second POST is named Default copy 2, no "Could not copy" toast', async () => {
  const s = server();
  const { w, d, calls } = await workflowsHost({ hash: '#workflows/workflow:wf_default', read: s.read, write: s.write });
  await pick(d, 'wf-more', 'copy'); await settle(120);
  assert.equal(w.location.hash, '#workflows/workflow:wf_default-copy');
  await go(w, '#workflows/workflow:wf_default', 80);
  await pick(d, 'wf-more', 'copy'); await settle(120);
  assert.deepEqual(sent(calls).map((c) => c.body.name), ['Default copy', 'Default copy 2']);
  assert.deepEqual(s.answers, [201, 201]);
  assert.doesNotMatch(saidText(d), /Could not copy/);
  assert.equal(w.location.hash, '#workflows/workflow:wf_default-copy-2');
});

test('F-5-08 demo: Edit a copy by hand makes a fresh draft (not in All workflows\' count), and Save makes it a saved workflow', async (t) => {
  // the demo kind's mode is Expert's (Edit a copy by hand); graph.js is not among the host's scripts, so the canvas draws on a stub
  const w = stillhetHost({ hash: '#workflows/workflow:default', after: (fn) => t.after(fn), beforeScripts: (win) => { win.structuredClone ||= structuredClone; win.localStorage.setItem('worca-rail.mode', 'expert'); win.RailGraph = { mount: () => ({ g: null, view: null, fit: 1 }), align: (g) => g, build: () => ({}) }; } });
  await go(w, '#workflows/workflow:default', 120);
  const d = w.document, recs = () => w.RailPlaces.workflows.records().workflow;
  const saved = recs().filter((x) => !x.fresh).length;
  await copyEdit(d);
  const x = recs().find((y) => y.copyOf === 'default');
  assert.ok(x?.fresh && x.draft, 'a fresh draft, not a saved copy');
  assert.equal(w.location.hash, `#workflows/edit:${x.id}`);
  assert.equal(x.title, 'Default copy');
  assert.equal(recs().filter((y) => !y.fresh).length, saved, 'All workflows keeps its count');
  d.querySelector('[data-draft-save]').click(); await settle(80);
  assert.ok(!x.fresh && !x.draft, 'saved');
  assert.equal(recs().filter((y) => !y.fresh).length, saved + 1);
  await go(w, '#workflows/workflow:default', 80);
  await copyEdit(d);
  assert.equal(recs().find((y) => y.fresh && y.copyOf === 'default')?.title, 'Default copy 2', 'the second copy takes the next free name');
});

test('F-5-08 live: the copy draft and its edits survive a workflows-changed refresh and a redraw', async () => {
  const { w, d, calls } = await workflowsHost({ hash: '#workflows/workflow:wf_default' });
  await copyEdit(d);
  const at = d.querySelector('[data-menu^="ed-m-"]').dataset.menu;
  await pick(d, at, 'Haiku 5.5');
  const i = +at.slice(5);
  await w.RailWorkflowLive.refresh('workflows'); await settle(60);
  w.RailPlaces.workflows.changed(); await settle(40);
  const x = w.RailWorkflowLive.data().workflow.find((y) => y.id === 'copy-1');
  assert.ok(x?.fresh, 'the same id, still fresh');
  assert.equal(x.draft.steps[i][2], 'Haiku 5.5', 'the edit kept');
  assert.equal(w.location.hash, '#workflows/edit:copy-1');
  assert.equal(d.querySelector('[data-ed-name]').value, 'Default copy');
  assert.deepEqual(sent(calls), []);
});

test('F-5-08 live: Discard while the copy\'s Save is in flight: the copy it made is deleted again and the page says so', async () => {
  const s = server();
  let release; const held = new Promise((y) => { release = y; });
  const { w, d, calls } = await workflowsHost({ hash: '#workflows/workflow:wf_default', read: s.read,
    write: async (u, b, m) => { if (m === 'POST') await held; return m === 'DELETE' ? [200, { ok: true }] : s.write(u, b, m); } });
  await copyEdit(d);
  d.querySelector('[data-draft-save]').click(); await settle(40);
  d.querySelector('[data-draft-discard]').click(); await settle(40);
  assert.equal(w.location.hash, '#workflows');
  release(); await settle(150);
  assert.deepEqual(sent(calls).map((c) => `${c.method} ${c.url}`), ['POST /api/workflows', 'DELETE /api/workflows/wf_default-copy']);
  assert.equal(w.location.hash, '#workflows', 'not sent to the copy\'s page');
  assert.match(saidText(d), /^Discarded Default copy: its Save had already reached Worca, so it was deleted again/);
});
