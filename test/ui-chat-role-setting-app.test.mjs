// test/ui-chat-role-setting-app.test.mjs — Shaper ask screens, slice 2 in the booted app (flag shaperSmallRuns):
// Settings › Chat "Your role" against the composer and an earlier Shaper card. One app for the file
// (test/helpers/shared-app-boot.mjs), loaded on a deep link to Settings › Chat with the flag on; the row's own
// renderer is in test/chat-settings-view.test.mjs and the flag-off page in
// test/ui-chat-role-setting-app-flag-off.test.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { _resetAnswerer, saveAnswerer } from '../ui/public/answerer.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
/** What a person reads in `node`: its text without the closed info tips. */
const shownText = (node) => { const c = node.cloneNode(true); c.querySelectorAll('.tip-content').forEach((n) => n.remove()); return c.textContent; };
const timesSaid = (node, words) => shownText(node).split(words).length - 1;
const menuRows = (d) => [...d.querySelectorAll('.wfv-menu [role^="menuitem"]')];
const menuRow = (d, label) => menuRows(d).find((r) => r.querySelector('.wfv-menu-l').textContent === label);

// R-arch-5's example runs on a stored thread: a Compliance message, then a proposed Shaper card.
const ROLE_TID = 'ask_0000a5ed';
const ROLE_CARD = {
  target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/tmp/p', workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', brief: 'Add export', title: 'Add export', sourceBranch: '',
  featureBranch: 'worca/add-export', sourceBranchByKey: null, note: '', attachments: [],
  nudge: { reason: 'decisions', size: 'large', openDecisions: ['Storage engine'], perspectives: ['qa'], estimates: { asIs: null, shaped: null }, asIsAuto: false },
};
const MESSAGES = [
  { id: 'askm_u0000001', threadId: ROLE_TID, seq: 1, role: 'user', blocks: [], status: null, createdAt: 't',
    text: 'Shape this task first: propose a run with `shape`.\n\nAsking as: compliance.\n\nAdd export' },
  { id: 'askm_00000001', threadId: ROLE_TID, seq: 2, role: 'assistant', text: 'ok', status: 'done', createdAt: 't',
    blocks: [{ kind: 'card', id: 'card_00000001', state: 'proposed', card: ROLE_CARD }] },
];

// The saved profile and what the app asked of it; start() gives each test its own.
const rec = { lead: 'compliance', answerer: [], runs: [] };
function arms(u, opts) {
  const path = u.split('?')[0];
  const method = (opts.method || 'GET').toUpperCase();
  if (path === '/api/answerer') {
    rec.answerer.push(method === 'PUT' ? `PUT ${opts.body}` : method);
    if (method === 'PUT') rec.lead = JSON.parse(opts.body).lead;
    return ok({ lead: rec.lead });
  }
  if (path === `/api/ask/threads/${ROLE_TID}` && method === 'GET') {
    return ok({ thread: { id: ROLE_TID, title: 'Export', createdAt: 't', updatedAt: 't', context: { pinned: true, projectKey: 'proj-00000001' } },
      messages: MESSAGES, attachments: [], runLinks: [], inFlight: null });
  }
  if (path === '/api/run' && method === 'POST') { rec.runs.push(JSON.parse(opts.body)); return ok({ runId: 'run-uuid-1' }); }
  if (path === '/api/projects') return ok({ projects: [{ key: 'proj-00000001', name: 'proj', path: '/tmp/p', exists: true }] });
  if (path === '/api/workflows') return ok({ workflows: [{ id: 'wf_default', name: 'Default' }] });
  if (path === '/api/guardrails') return ok({ guardrails: [{ id: 'normal', name: 'Normal' }] });
  if (path === '/api/run-defaults') return ok({ engine: { value: 'claude', source: 'default' }, chatSourceBranch: { mode: 'current', source: 'user', needs: [] } });
  if (path === '/api/branches') return ok({ branches: ['main'], current: 'main' });
  if (path.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
  if (path.includes('/api/ask/')) return ok({ threads: [] });
  return null;
}

const app = useSharedApp({ before, beforeEach, after }, {
  url: 'http://localhost:4317/#settings/ask', flags: { shaperSmallRuns: true }, fetchHandler: arms,
});

/** The app with `lead` as the saved role and a clean record, on `hash`. */
async function start({ lead, hash }) {
  Object.assign(rec, { lead, answerer: [], runs: [] });
  _resetAnswerer();
  app.go(hash);
  await app.settle(12);
  const doc = app.document;
  const until = async (find) => { for (let i = 0; i < 40; i++) { const hit = find(); if (hit) return hit; await app.settle(2); } return find(); };
  return Object.assign(app, { doc, rec, until });
}

test('R-arch-5 example in the app: clearing the role in Settings › Chat makes the composer read "Your role"; the earlier card still reads Compliance and starts a Compliance-led run', async () => {
  const a = await start({ lead: 'compliance', hash: `chat/${ROLE_TID}` });
  const cardRole = () => a.doc.querySelector('.ask-card .shape-card .rd-kv-row .rd-kv-v')?.textContent;
  assert.ok(await a.until(() => a.doc.querySelector('.ask-card [data-ask-card-shape]')), 'the card is up');
  assert.equal(cardRole(), 'Compliance');

  a.go('settings/ask'); await a.settle(12);
  const setting = () => a.doc.querySelector('#chat-role-card #chatRoleHost button');
  assert.ok(await a.until(() => setting()?.textContent === 'Compliance'), 'Settings › Chat shows the role button');
  setting().click();
  menuRow(a.doc, 'No role').click();
  await a.settle(12);
  assert.equal(a.rec.answerer.at(-1), 'PUT {"lead":null}');

  a.go('chat/new'); await a.settle(12);
  const tile = await a.until(() => a.doc.querySelector('[data-chat-home] [data-intent="shape"]'));
  tile.click();
  await a.settle(12);
  assert.equal(a.doc.querySelector('.chat-composer-lead .ask-asker-pick .ask-asker-l')?.textContent, 'Your role', 'the composer');

  a.go(`chat/${ROLE_TID}`); await a.settle(12);
  const shapeBtn = await a.until(() => a.doc.querySelector('.ask-card [data-ask-card-shape]'));
  assert.equal(cardRole(), 'Compliance', 'the earlier card');
  assert.equal(shapeBtn.hasAttribute('aria-disabled'), false);
  const before = a.rec.answerer.length;
  shapeBtn.click();
  assert.ok(await a.until(() => a.rec.runs.length), 'POST /api/run');
  assert.equal(a.rec.runs[0].shape.lead, 'compliance');
  assert.deepEqual(a.rec.answerer.slice(before), [], 'no profile read or write at start');
  assert.equal(a.rec.lead, null, 'the role stays cleared');
});

test('the app, loaded on a deep link to Settings › Chat, shows one "Your role", and the row re-reads the profile each time the tab opens', async () => {
  const a = await start({ lead: 'compliance', hash: 'settings/ask' });
  const card = a.doc.getElementById('chat-role-card');
  assert.ok(card, '#chat-role-card');
  const setting = () => card.querySelector('#chatRoleHost button');
  assert.ok(await a.until(() => setting()?.textContent === 'Compliance'), 'the saved role');
  assert.equal(timesSaid(card, 'Your role'), 1);
  assert.equal(card.querySelectorAll('#chatRoleHost button').length, 1);
  await saveAnswerer('qa', a.window.fetch);     // a Shaper card saves a role elsewhere
  a.go('settings/general'); await a.settle(8);
  a.go('settings/ask'); await a.settle(12);
  assert.equal(setting().textContent, 'QA');
});
