// test/ui-team-policy-skills.test.mjs — the skills parts of ui/public/team-policy-view.mjs (skills registry spec §6
// board 10, F8): the Required skills editor field, the setup checklist's skill rows, the Turn on consent dialog and
// its click flow. Pure renderers in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderPolicyEditor, docFromEditor, editorDirty } from '../ui/public/team-policy-view.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
const doc = dom.window.document;
globalThis.window = dom.window;

const REG = [
  { key: 'plugins.required', group: 'plugins', label: 'Required plugins', type: 'plugins', kinds: ['soft'] },
  { key: 'skills.required', group: 'plugins', label: 'Required skills', help: 'Each developer turns them on with consent; they join the Team set. Never automatic.', type: 'skills', kinds: ['soft'], workspaceRuns: false },
  { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'] },
];
const DEPLOY = { plugin: 'acme', skill: 'deploy-checklist' };
const QA = { plugin: 'acme-qa', skill: 'qa-runbook' };
const DOC = { schema: 1, title: '', notes: '', fields: {
  'plugins.required': { kind: 'soft', value: [{ name: 'acme' }] },
  'skills.required': { kind: 'soft', value: [DEPLOY, QA] },
}, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } };
const chips = (row) => [...row.querySelectorAll('.tp-chip')].map((c) => c.firstChild.textContent);
const click = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

test('editor: skills.required renders "skill · plugin" chips, round-trips unchanged, and has no Workspace-runs row', () => {
  const root = renderPolicyEditor(DOC, { registry: REG, doc });
  const row = root.querySelector('.tp-edit-row[data-key="skills.required"][data-scope="fields"]');
  assert.deepEqual(chips(row), ['deploy-checklist · acme', 'qa-runbook · acme-qa']);
  assert.equal(row.querySelector('.tp-skill-ref').placeholder, 'plugin/skill, e.g. acme/deploy-checklist');
  assert.match(row.querySelector('.tp-key small').textContent, /Each developer turns them on with consent/);
  assert.deepEqual(docFromEditor(root, { registry: REG }).fields['skills.required'], DOC.fields['skills.required']);
  assert.equal(editorDirty(root, DOC, { registry: REG }), false, 'a round trip never deletes or changes the field');
  assert.equal(root.querySelector('.tp-edit-row[data-key="skills.required"][data-scope="workspaceRuns"]'), null);
});

test('editor: + add takes "plugin/skill" (Enter too), picks the kind, refuses a bad or repeated one; ✕ and an emptied list', () => {
  const root = renderPolicyEditor({ ...DOC, fields: { 'plugins.required': DOC.fields['plugins.required'] } }, { registry: REG, doc });
  doc.body.append(root);
  const row = root.querySelector('.tp-edit-row[data-key="skills.required"][data-scope="fields"]');
  const inp = row.querySelector('.tp-skill-ref'); const err = row.querySelector('.tp-skill-err'); const add = row.querySelector('.tp-add-btn');
  assert.equal(err.hidden, true);
  click(add);
  assert.equal(err.hidden, true, 'an empty box adds nothing and says nothing');
  for (const bad of ['Acme', 'Acme/deploy', 'acme/Deploy', 'acme/deploy/x', '/x', 'acme--x/x', '1acme/x', 'a/b-', `a/${'b'.repeat(65)}`]) {
    inp.value = bad; click(add);
    assert.equal(err.hidden, false, bad);
    assert.equal(err.textContent, 'type plugin/skill, e.g. acme/deploy-checklist');
  }
  assert.deepEqual(chips(row), []);
  inp.value = '  '; click(add);
  assert.equal(err.hidden, true, 'an emptied box clears the error');
  inp.value = 'Acme/x'; click(add);
  click(row.querySelector('.tp-unset'));
  assert.deepEqual([err.hidden, inp.value], [true, ''], 'Unset clears the typed reference and its error');
  inp.value = ' acme/deploy-checklist '; click(add);
  assert.equal(err.hidden, true);
  assert.equal(inp.value, '');
  assert.deepEqual(chips(row), ['deploy-checklist · acme']);
  assert.equal(row.querySelector('.tp-kind-seg .on').dataset.kind, 'soft', 'the first value picks the only kind');
  inp.value = 'acme/deploy-checklist'; click(add);
  assert.deepEqual(chips(row), ['deploy-checklist · acme'], 'a repeat adds nothing');
  inp.value = 'acme-qa/qa-runbook';
  inp.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(docFromEditor(root, { registry: REG }).fields['skills.required'], { kind: 'soft', value: [DEPLOY, QA] });
  while (row.querySelector('.tp-chip-rm')) click(row.querySelector('.tp-chip-rm'));   // each ✕ repaints the list
  assert.equal(docFromEditor(root, { registry: REG }).fields['skills.required'], undefined, 'an emptied list is left out, like plugins');
  root.remove();
});

// ---- the setup checklist's skill rows, the Sets-tab strip, the consent dialog, the click flow (Task 9) ----
import { renderSetupChecklist, renderMcpStrip, renderSkillConsent, handleTeamSkillClick } from '../ui/public/team-policy-view.mjs';
import { SKILL_HOOKS_TEXT } from '../src/core/skills-registry/texts.mjs';

const HOME = 'acme/platform';
const row = (name, state, over = {}) => ({ home: HOME, sha: '8c1d2e0', setId: 'team-acme-platform-9333', setName: 'Team · acme/platform',
  skillId: `skill:plugin:acme/${name}`, name, plugin: 'acme', state, working: state === 'ok', hash: name[0].repeat(64), problem: null,
  code: '3f9a1c2', files: 5, bytes: 6963, scripts: ['scripts/preflight.sh', 'scripts/rollback.py'], shellBlocks: 1, description: `${name} text`, ...over });
const SKILLS = [
  row('deploy-checklist', 'never-consented'),
  row('release-notes', 'ok', { files: 4, scripts: ['scripts/collect.sh'], shellBlocks: 0 }),
  row('qa-runbook', 'needs-plugin', { plugin: 'acme-qa', skillId: 'skill:plugin:acme-qa/qa-runbook', code: null, files: 0, scripts: [], shellBlocks: 0 }),
  row('incident-triage', 'off', { scripts: [], shellBlocks: 0, files: 1 }),
  row('bad-one', 'skipped', { problem: 'invalid' }),
];
const skillAct = (r) => { const b = r.querySelector('.tp-skill-act'); return b ? [b.textContent, b.dataset.consent || '', b.dataset.home, b.dataset.skill, b.dataset.state, b.classList.contains('btn-primary')] : null; };

test('setup checklist: one Skill row per required skill, the state badge, the facts, the action its state calls for', () => {
  const list = renderSetupChecklist({ home: HOME, skills: SKILLS }, { doc });
  const rows = [...list.querySelectorAll('.tp-setup-row.tp-skill-row')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.tp-skill-kind').textContent, r.querySelector('.tp-setup-text b').textContent, r.querySelector('.tp-skill-state').textContent]), [
    ['Skill ', 'deploy-checklist', 'Off · never turned on'], ['Skill ', 'release-notes', 'On'], ['Skill ', 'qa-runbook', 'Needs plugin acme-qa'],
    ['Skill ', 'incident-triage', 'Off'], ['Skill ', 'bad-one', 'invalid']]);
  assert.deepEqual(rows.map((r) => r.querySelector('.tp-setup-text small').textContent), [
    'acme @ 3f9a1c2 · 5 files · 2 scripts · 1 shell block', 'acme @ 3f9a1c2 · 4 files · 1 script', 'from acme-qa', 'acme @ 3f9a1c2 · 1 file', 'acme @ 3f9a1c2 · 5 files · 2 scripts · 1 shell block']);
  assert.deepEqual(rows.map(skillAct), [
    ['Turn on', '1', HOME, 'skill:plugin:acme/deploy-checklist', 'never-consented', true],
    null, null,
    ['Turn on', '', HOME, 'skill:plugin:acme/incident-triage', 'off', false],
    null]);
  assert.equal(list.querySelector('.hist-empty'), null, 'skills alone are something to set up');
  assert.ok(list.querySelector('.tp-trust-row').textContent.includes('MCP servers are never installed or turned on automatically, and required skills are never turned on automatically. However, updates to required skills apply without another review when you trust this home.'),
    'trusting a home is honest about required-skill updates');
  assert.ok(renderSetupChecklist({ home: HOME }, { doc }).querySelector('.hist-empty'), 'nothing at all: the empty line');
  const ghost = renderSetupChecklist({ home: HOME, skills: [row('ghost', 'skipped', { code: null, files: 0, scripts: [], shellBlocks: 0, problem: 'acme does not ship a skill named ghost' })] }, { doc })
    .querySelector('.tp-skill-row');
  assert.deepEqual([ghost.querySelector('.tp-skill-state').textContent, ghost.querySelector('.tp-setup-text small').textContent, ghost.querySelector('.tp-skill-act')],
    ['acme does not ship a skill named ghost', 'from acme', null], 'a skill its plugin does not ship: the reason, no action');
});

test('the Sets-tab strip lists open skill items next to MCP ones; all done (or none): no strip', () => {
  const strip = renderMcpStrip([], { doc, skills: SKILLS });
  assert.equal(strip.querySelector('.card-head b').textContent, 'acme/platform requires 5 skills in its Team set (4 to set up)');
  assert.deepEqual([strip.querySelector('.card-head .badge').className, strip.querySelector('.card-head .badge').textContent], ['badge slate', 'Team policy']);
  assert.equal(renderMcpStrip([], { doc, skills: [SKILLS[0]] }).querySelector('.card-head b').textContent, 'acme/platform requires the skill deploy-checklist · acme in its Team set');
  assert.equal(renderMcpStrip([], { doc, skills: [SKILLS[0], { ...SKILLS[3], home: 'acme/other' }] }).querySelector('.card-head b').textContent, 'acme/platform, acme/other require 2 skills in their Team sets');
  assert.deepEqual([...strip.querySelectorAll('.pl-required[data-skill]')].map((r) => r.querySelector('b').textContent), ['deploy-checklist', 'qa-runbook', 'incident-triage', 'bad-one']);
  assert.ok(strip.querySelector('.tp-skill-act[data-skill="skill:plugin:acme/deploy-checklist"][data-consent="1"]'));
  assert.ok(strip.querySelector('.pl-policy-setup'));
  const mcpRow = { home: HOME, serverId: 'policy:acme/platform/pg', name: 'pg', plugin: null, type: 'stdio', state: 'off', setName: 'Team · acme/platform', field: null, problem: null };
  const mixed = renderMcpStrip([mcpRow], { doc, skills: SKILLS });
  assert.equal(mixed.querySelector('.card-head b').textContent, 'acme/platform: 1 MCP item and 4 skills to set up');
  assert.equal(mixed.querySelector('.card-head .badge').className, 'badge slate', 'with MCP items open the strip keeps the MCP register');
  assert.equal(renderMcpStrip([mcpRow], { doc }).querySelector('.card-head b').textContent, 'acme/platform: 1 MCP item to set up', 'MCP only: as before');
  assert.equal(renderMcpStrip([], { doc, skills: [SKILLS[1]] }), null);
});

const CONSENT = { ...SKILLS[0], allowedTools: 'Bash(kubectl get:*) Read', skillMd: '---\nname: deploy-checklist\n---\n# Deploy checklist\nCurrent tag: !`git describe --tags`\n' };

test('consent dialog: plugin @ sha7, the home, files, scripts, shell blocks, allowed tools, the set it joins, the SKILL.md text', () => {
  const el = renderSkillConsent(CONSENT, { doc });
  assert.equal(el.querySelector('.tp-skill-from').textContent, 'from plugin acme @ 3f9a1c2 · required by acme/platform');
  const facts = Object.fromEntries([...el.querySelectorAll('dl.tp-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.deepEqual(facts, {
    Name: 'deploy-checklist', From: 'acme/platform · worca-policy @ 8c1d2e0', Files: '5 · 6.8 kB',
    Scripts: 'scripts/preflight.sh · scripts/rollback.py', 'Shell blocks': '1 in SKILL.md (they run in pipeline runs without guardrail checks; Chat never runs them)',
    'Allowed tools': 'Bash(kubectl get:*) Read',
    Consent: 'this plugin skill; later content changes come through the plugin\'s update review',
    Updates: 'updates to required skills apply without another review when you trust this home', Joins: 'Team · acme/platform set',
  });
  assert.equal(el.querySelector('pre.tp-skill-md').textContent, CONSENT.skillMd, 'the text, never rendered as markup');
  const bare = Object.fromEntries([...renderSkillConsent({ ...CONSENT, scripts: [], shellBlocks: 0, allowedTools: null, bytes: 300, code: 'linked' }, { doc })
    .querySelectorAll('dl.tp-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.deepEqual([bare.Scripts, bare['Shell blocks'], bare['Allowed tools'], bare.Files, bare.Hooks, bare['Plugin files']], ['none', 'none', undefined, '5 · 300 B', undefined, undefined]);
  const hooked = [...renderSkillConsent({ ...CONSENT, hooks: true }, { doc }).querySelectorAll('dl.tp-facts dt')].find((dt) => dt.textContent === 'Hooks');
  assert.equal(hooked?.nextElementSibling.textContent, SKILL_HOOKS_TEXT, 'U1: the words every other surface shows for skill hooks');
  const rooted = [...renderSkillConsent({ ...CONSENT, pluginRootRefs: true }, { doc }).querySelectorAll('dl.tp-facts dt')].find((dt) => dt.textContent === 'Plugin files');
  assert.equal(rooted?.nextElementSibling.textContent, "references its plugin's other files, so it may not work from a set", '§4.1: the badge text');
  assert.match(el.querySelector('.confirm-message').textContent, /inline shell blocks and declared hooks are not checked by them\.$/, 'U1/U2: no guardrail claim for them');
});

/** The app's side of the click flow, recorded. `scopes` = what each fresh /api/policy/scopes read returns. */
function fakeDeps({ rows = SKILLS, consent = { ok: true, data: CONSENT }, turnOn = { ok: true, data: { ok: true } } } = {}) {
  const calls = [];
  let open = null;
  const deps = {
    doc,
    scopes: async () => { calls.push(['scopes']); return { skillRequirements: typeof rows === 'function' ? rows() : rows }; },
    api: async (method, path, body) => { calls.push([method, path, body]); return method === 'GET' ? consent : turnOn; },
    dialog: (title, body, actions = []) => { calls.push(['dialog', title, actions.map((a) => a[0])]); open = { body, actions }; },
    close: () => { calls.push(['close']); open = null; },
    owner: () => null,
    isOpen: (node) => !!open && open.body === node,
    repaint: async (o) => { calls.push(['repaint', o]); },
  };
  return { deps, calls, dialog: () => open };
}
const clickOn = async (r, deps) => {
  const list = renderSetupChecklist({ home: HOME, skills: SKILLS }, { doc });
  const b = list.querySelector(`.tp-skill-act[data-skill="${r.skillId}"]`);
  await handleTeamSkillClick({ target: b, stopPropagation() {} }, deps);
  return b;
};

test('click flow: never consented → the consent dialog first; Turn on posts only { expectHash } and closes it', async () => {
  const { deps, calls, dialog } = fakeDeps();
  await clickOn(SKILLS[0], deps);
  const base = '/api/sets/teams/acme%2Fplatform/skills/skill%3Aplugin%3Aacme%2Fdeploy-checklist';
  assert.deepEqual(calls, [['scopes'], ['GET', `${base}/consent`, undefined], ['dialog', 'Turn on skill: deploy-checklist', ['Cancel', 'Turn on']]]);
  assert.equal(dialog().body.querySelector('pre.tp-skill-md').textContent, CONSENT.skillMd);
  const turnOn = dialog().actions.find((a) => a[0] === 'Turn on')[2];
  turnOn(); turnOn();   // a double click posts once
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.slice(3), [['POST', `${base}/turn-on`, { expectHash: CONSENT.hash }], ['close'], ['repaint', { checklist: false }]]);
});

test('click flow: an off skill turns on at once; a row that moved on repaints and never posts; a refusal shows its error', async () => {
  const off = fakeDeps();
  await clickOn(SKILLS[3], off.deps);
  assert.deepEqual(off.calls, [['scopes'], ['POST', '/api/sets/teams/acme%2Fplatform/skills/skill%3Aplugin%3Aacme%2Fincident-triage/turn-on', { expectHash: SKILLS[3].hash }], ['repaint', { checklist: false }]]);
  const moved = fakeDeps({ rows: [{ ...SKILLS[0], state: 'ok' }] });
  await clickOn(SKILLS[0], moved.deps);
  assert.deepEqual(moved.calls, [['scopes'], ['repaint', { checklist: false }]], 'painted as never-consented, now on: no dialog, no POST');
  const twoHomes = fakeDeps({ rows: [{ ...SKILLS[3], home: 'acme/other', state: 'ok' }, SKILLS[3]] });
  await clickOn(SKILLS[3], twoHomes.deps);
  assert.equal(twoHomes.calls[1][0], 'POST', 'the row of the button\'s own home');
  const gone = fakeDeps({ rows: [] });
  await clickOn(SKILLS[3], gone.deps);
  assert.deepEqual(gone.calls, [['scopes'], ['repaint', { checklist: false }]]);
  const refused = fakeDeps({ turnOn: { ok: false, data: { error: 'the team definition changed, review it again' } } });
  await clickOn(SKILLS[3], refused.deps);
  assert.deepEqual(refused.calls.slice(2).map((c) => c[0]), ['dialog', 'repaint']);
  assert.equal(refused.dialog().body.textContent, 'the team definition changed, review it again');
  const noConsent = fakeDeps({ consent: { ok: false, data: { error: 'skill:plugin:acme/deploy-checklist is not installed' } } });
  await clickOn(SKILLS[0], noConsent.deps);
  assert.deepEqual(noConsent.calls.map((c) => c[0]), ['scopes', 'GET', 'dialog', 'repaint']);
  assert.equal(noConsent.dialog().body.textContent, 'skill:plugin:acme/deploy-checklist is not installed');
});

test('click flow: a Turn on that lands after the user opened another dialog never closes that one', { timeout: 5000 }, async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { deps, calls, dialog } = fakeDeps();
  const api = deps.api;
  deps.api = async (method, path, body) => { if (method === 'POST') { calls.push([method, path, body]); await held; return { ok: true, data: {} }; } return api(method, path, body); };
  try {
    await clickOn(SKILLS[0], deps);
    dialog().actions.find((a) => a[0] === 'Turn on')[2]();
    deps.dialog('Set up for acme/platform', doc.createElement('div'));   // the user opens the checklist meanwhile
  } finally { release(); }
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.some((c) => c[0] === 'close'), false);
  assert.deepEqual(calls.at(-1), ['repaint', { checklist: false }]);
});

test('click flow: a click while one is in flight acts once; the checklist the click came from repaints when the row moved on', { timeout: 5000 }, async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { deps, calls } = fakeDeps();
  deps.scopes = async () => { calls.push(['scopes']); await held; return { skillRequirements: SKILLS }; };
  const list = renderSetupChecklist({ home: HOME, skills: SKILLS }, { doc });
  const b = list.querySelector('.tp-skill-act[data-state="off"]');
  const first = handleTeamSkillClick({ target: b, stopPropagation() {} }, deps);
  const second = handleTeamSkillClick({ target: b, stopPropagation() {} }, deps);   // a double click
  release();
  await Promise.all([first, second]);
  assert.equal(calls.filter((c) => c[0] === 'POST').length, 1);
  assert.equal(b.dataset.busy, undefined, 'released for the next click');
  const moved = fakeDeps({ rows: [] });
  doc.body.append(list);
  moved.deps.owner = (t) => (list.contains(t) ? list : null);
  // The repaint empties the checklist while the scopes read is in flight: `owner` must be read before the await.
  moved.deps.scopes = async () => { moved.calls.push(['scopes']); list.replaceChildren(); return { skillRequirements: [] }; };
  await handleTeamSkillClick({ target: list.querySelector('.tp-skill-act[data-state="off"]'), stopPropagation() {} }, moved.deps);
  assert.deepEqual(moved.calls.at(-1), ['repaint', { checklist: true }]);
  list.remove();
});
