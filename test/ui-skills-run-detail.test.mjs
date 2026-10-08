// test/ui-skills-run-detail.test.mjs — skills registry design §6 board 9: a run's Overview shows the set
// skills it got (the names agents call), the skipped ones with their reasons and a blocked layer's line,
// live from state frames (the run page) and from the saved record (History). Pure renderer + the REAL
// index.html/app.js in jsdom (test/helpers/run-page-boot.mjs, test/helpers/history-detail-boot.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderRunSkills } from '../ui/public/mcp-run-picker.mjs';
import { skillLayerText } from '../src/core/skills-registry/texts.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, secOf, DETAIL } from './helpers/history-detail-boot.mjs';

const MOUNT = {
  base: '/w/pipelines/p1/skills',
  plugins: [
    { setId: 'billing', setName: 'Billing', pluginName: 'billing', renamedPlugin: false, skills: ['deploy-checklist', 'release-notes'] },
    { setId: 'general', setName: 'General', pluginName: 'general', renamedPlugin: false, skills: ['graphify'] },
  ],
  skipped: [{ setId: 'billing', setName: 'Billing', skillId: 'skill:library:quiet', name: 'quiet', qualifiedName: 'billing:quiet', reason: 'off', why: 'switched off in the set' }],
  layer: { blocked: null, text: null },
};
// The record carries P1's reason part as `layer.text`; the card writes the prefix once.
const BLOCKED = { ...MOUNT, base: null, layer: { blocked: 'sideload-disabled', text: skillLayerText('sideload-disabled') } };
const texts = (el) => [...el.children].map((c) => c.textContent);

test('renderRunSkills: names as agents call them, skips with reasons, the personal-skills note; a blocked layer says why; no record, no card', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  assert.equal(renderRunSkills(null, { doc }), null);
  assert.equal(renderRunSkills(undefined, { doc }), null);
  const card = renderRunSkills(MOUNT, { doc });
  assert.equal(card.className, 'hd-ov-mem hd-ov-skills', 'the Overview card look, no new styles');
  assert.deepEqual(texts(card), [
    'SKILLS FROM SETS',
    'billing:deploy-checklist, billing:release-notes, general:graphify',
    'skipped: billing:quiet (Billing — switched off in the set)',
    '3 set skills in 2 plugins · plus your personal Claude Code skills',
  ]);
  assert.deepEqual(texts(renderRunSkills(BLOCKED, { doc })), [
    'SKILLS FROM SETS',
    `skills from sets not loaded: ${skillLayerText('sideload-disabled')}`,
    'skipped: billing:quiet (Billing — switched off in the set)',
    'Your personal Claude Code skills still load.',
  ]);
  // Another engine: the names its .agents/skills mount gave them, and no Claude Code note.
  const engine = { ...MOUNT, rel: '.agents/skills', names: ['deploy-checklist', 'billing-release-notes', 'graphify'] };
  assert.deepEqual(texts(renderRunSkills(engine, { doc })).slice(1), [
    'deploy-checklist, billing-release-notes, graphify',
    'skipped: billing:quiet (Billing — switched off in the set)',
    '3 set skills in .agents/skills · plus your project and personal skills',
  ]);
  const none = { ...MOUNT, base: null, layer: { blocked: 'engine-no-skill-mount', text: skillLayerText('engine-no-skill-mount', 'codex') } };
  assert.deepEqual(texts(renderRunSkills(none, { doc })).slice(1), [
    "skills from sets not loaded: Codex reads skills from the run's .agents/skills mount, and this run has none",
    'skipped: billing:quiet (Billing — switched off in the set)',
  ]);
});

test('run page › Overview: the card follows the run\'s state frames', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1' });
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', skillMount: MOUNT });
  ctx.go('running/r1/details/overview');
  await ctx.settle(6);
  const ov = () => ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="overview"]');
  const host = ov().querySelector('.hd-ov-skills-host');
  assert.equal(host.hidden, false);
  assert.match(host.textContent, /billing:deploy-checklist, billing:release-notes, general:graphify/);
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', skillMount: BLOCKED });   // the safety net fired
  await ctx.settle(4);
  assert.match(ov().querySelector('.hd-ov-skills-host').textContent, /skills from sets not loaded: /);
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', skillMount: null });
  await ctx.settle(4);
  assert.equal(ov().querySelector('.hd-ov-skills-host').hidden, true, 'a run without set skills shows no card');
});

test('History › Overview: the saved record\'s card', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, skillMount: MOUNT } });
  await openDetail(ctx, 'details/overview');
  const card = secOf(ctx.window.document, 'overview').querySelector('.hd-ov-skills');
  assert.ok(card, 'the card is on the saved run\'s Overview');
  assert.match(card.textContent, /general:graphify/);
  const none = await bootDetail();
  await openDetail(none, 'details/overview');
  assert.equal(secOf(none.window.document, 'overview').querySelector('.hd-ov-skills'), null);
});
