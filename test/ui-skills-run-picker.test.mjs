// test/ui-skills-run-picker.test.mjs — New Pipeline › Advanced › Sets through the REAL index.html +
// app.js in jsdom (skills registry design §6 board 7, §4.5): the field is titled Sets, shows for a
// target whose sets hold only skills, counts skills in its label, prunes stale skill keys, and an
// unticked skill reaches the run body's mcpOptOut. Harness: test/helpers/run-page-boot.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn } from './helpers/run-page-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const PROJECT = '/Users/me/dev/billing';
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const skill = (name, setId = 'billing') => ({ id: `skill:library:${name}`, name, qualifiedName: `${setId}:${name}`, pluginName: setId, setId, projects: ['billing-00000001'] });
const PREVIEW = {
  sets: [{ id: 'billing', name: 'Billing', group: 'set', routes: [], skills: 2, startedSkills: 2 }],
  copies: [{ name: 'pg_billing', copy: 'pg_billing', setId: 'billing', serverId: 'manual:pg' }],
  skipped: [], started: 1, deviations: [], newer: false,
  skills: { mounted: [skill('deploy-checklist'), skill('release-notes')], plugins: [], skipped: [], started: 2, layer: { blocked: null, text: null }, newer: false },
};
const SKILLS_ONLY = { ...PREVIEW, copies: [], started: 0, skills: { ...PREVIEW.skills, mounted: [skill('deploy-checklist')] } };

// The project list is fetched when app.js loads, so its answer is the file's.
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: (u) => (u.includes('/api/projects') ? json({ projects: [{ name: 'billing', path: PROJECT, exists: true, key: 'billing-00000001' }] }) : null),
});
const bootApp = runPageOn(app);

async function openNew(first) {
  let current = first;
  const ctx = await bootApp({
    fetchHandler: (u) => {
      if (u === '/api/mcp/preview') return json(current);
      if (u === '/api/run') return json({ runId: 'r1' });
      return null;
    },
  });
  ctx.go('new');
  await ctx.settle(6);
  const doc = ctx.window.document;
  const previews = () => ctx.calls.filter((c) => c.url === '/api/mcp/preview').length;
  /** Pick the project and wait for the debounced preview fetch (not a fixed delay: a loaded machine is slower). */
  const pick = async () => {
    const before = previews();
    const sel = doc.getElementById('projectSelect');
    sel.value = PROJECT;
    sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    for (const t0 = Date.now(); previews() === before;) {
      assert.ok(Date.now() - t0 < 5000, 'the preview was fetched');
      await new Promise((r) => setTimeout(r, 20));
    }
    await ctx.settle(8);
  };
  return { ...ctx, doc, pick, setPreview: (p) => { current = p; } };
}

test('New pipeline › Sets: servers and skills in one control; an unticked skill reaches the run body; a stale skill key is pruned', async () => {
  const { doc, pick, window, calls, settle, setPreview, go } = await openNew(PREVIEW);
  await pick();
  assert.equal(doc.getElementById('mcpRunsHead').textContent, 'Sets');
  assert.equal(doc.getElementById('mcpRunsField').hidden, false);
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 1 server · 2 of 2 skills');
  const box = [...doc.querySelectorAll('#mcpRunsPop .mcp-runs-row input')].find((i) => i.dataset.keys === 'billing|skill:library:release-notes');
  box.click();
  await settle();
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 1 server · 1 of 2 skills');
  await pick();                                   // a refetch prunes to the target's memberships: the skill key is one
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 1 server · 1 of 2 skills');
  // Switched off in the set meanwhile: a skipped membership keeps its key too (the server's knownMcpOptOut does).
  const OFF = { setId: 'billing', setName: 'Billing', pluginName: 'billing', qualifiedName: 'billing:release-notes', skillId: 'skill:library:release-notes', name: 'release-notes', reason: 'off', why: 'off' };
  setPreview({ ...PREVIEW, skills: { ...PREVIEW.skills, mounted: [skill('deploy-checklist')], skipped: [OFF] } });
  await pick();
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 1 server · 1 of 1 skill');
  doc.getElementById('prompt').value = 'demo task';
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle(6);
  assert.deepEqual(JSON.parse(calls.findLast((c) => c.url === '/api/run').opts.body).mcpOptOut, ['billing|skill:library:release-notes']);
  go('new');                                      // the start opened the run; back to the form
  await settle(6);
  setPreview({ ...PREVIEW, skills: { ...PREVIEW.skills, mounted: [skill('deploy-checklist')] } });   // release-notes left the set
  await pick();
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '1 of 1 server · 1 of 1 skill');
  doc.getElementById('prompt').value = 'demo task';
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle(6);
  assert.equal(JSON.parse(calls.findLast((c) => c.url === '/api/run').opts.body).mcpOptOut, undefined, 'the stale skill key was pruned');
});

test('New pipeline › Sets: a target whose sets hold only skills still shows the control', async () => {
  const { doc, pick } = await openNew(SKILLS_ONLY);
  await pick();
  assert.equal(doc.getElementById('mcpRunsField').hidden, false);
  assert.equal(doc.getElementById('mcpRunsLabel').textContent, '0 of 0 servers · 1 of 1 skill');
  assert.deepEqual([...doc.querySelectorAll('#mcpRunsPop .mcp-runs-row .mono')].map((n) => n.textContent), ['billing:deploy-checklist']);
});

test('New pipeline › Sets: a target whose only memberships are skipped skills still shows the control', async () => {
  const OFF = { setId: 'billing', setName: 'Billing', pluginName: 'billing', qualifiedName: 'billing:quiet', skillId: 'skill:library:quiet', name: 'quiet', reason: 'off', why: 'off' };
  const { doc, pick } = await openNew({ ...PREVIEW, copies: [], started: 0, skills: { ...PREVIEW.skills, mounted: [], skipped: [OFF] } });
  await pick();
  assert.equal(doc.getElementById('mcpRunsField').hidden, false);
  assert.deepEqual([...doc.querySelectorAll('#mcpRunsPop .mcp-runs-row.is-skipped .mono')].map((n) => n.textContent), ['billing:quiet']);
});
