// test/ui-team-people.test.mjs — step 4: team metrics actors and the policy publisher may be full
// emails now (the person who started the run / published, on a shared deployment). They render as
// text, clipped by class, with the whole name in a tooltip. Team data shows teammates on every
// install, so these are NOT gated on the shared-sign-in display rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderBreakdownTable, renderRunsTable } from '../ui/public/team-metrics-view.mjs';
import { renderPolicyHeader } from '../ui/public/team-policy-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const EMAIL = 'ada.lovelace@example.com';

test('By actor: the label is a clipped person with the full name as its tooltip; other dims unchanged', () => {
  const rows = [{ key: EMAIL, label: EMAIL, runs: 3, usd: 1.5, perRunUsd: 0.5, successRate: 1, overrides: 0 }];
  const t = renderBreakdownTable('actor', rows, { doc });
  const lab = t.querySelector('tbody td span');
  assert.equal(lab.className, 'tm-person');
  assert.equal(lab.textContent, EMAIL);
  assert.equal(lab.title, EMAIL);
  const wf = renderBreakdownTable('workflow', [{ key: 'wf', label: 'Quick fix', runs: 1, usd: 1, perRunUsd: 1, successRate: 1, share: 1 }], { doc });
  assert.equal(wf.querySelector('tbody td span').className, '');
});

test('runs table: the actor cell is clipped with a tooltip; no actor shows a dash', () => {
  const base = { title: 't', result: 'done', usd: 1, wallMs: 1, reviewCycles: null, pr: null, startedAt: '2026-09-10T10:00:00Z' };
  const t = renderRunsTable([{ id: 'a', ...base, actor: '<b>x</b>' + EMAIL }, { id: 'b', ...base, actor: null }], { doc, total: 2 });
  const who = [...t.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('.tm-person') || null);
  assert.equal(who[0].textContent, '<b>x</b>' + EMAIL, 'text, never markup');
  assert.equal(who[0].title, '<b>x</b>' + EMAIL);
  assert.equal(who[1], null);
});

test('policy header: "updated … by <email>" with a Published by tooltip', () => {
  const card = renderPolicyHeader({
    scope: { kind: 'project', id: 'bl-00000001', name: 'billing-api' },
    policy: { home: 'gateway', sha: 'abc1234def', delegated: false, from: null, warnings: [], checkedAt: new Date().toISOString(), workspaceRun: false,
      doc: { title: 'T', notes: '', updatedAt: new Date().toISOString(), updatedBy: EMAIL, catalogs: {} } },
    effective: [], plugins: [], blockedPlugins: [], deviations: [], canPublish: false, worcaVersion: '1.4.0',
  }, { doc });
  const upd = [...card.querySelectorAll('span')].find((s) => /updated .* by /.test(s.textContent));
  assert.ok(upd, card.textContent);
  assert.match(upd.textContent, new RegExp(`by ${EMAIL.replace(/\./g, '\\.')}$`));
  assert.equal(upd.title, `Published by ${EMAIL}`);
});
