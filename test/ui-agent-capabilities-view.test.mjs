// test/ui-agent-capabilities-view.test.mjs — the agent capability picker (pickerModel + DOM) and the run-details card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { planAgentCapabilities } from '../src/core/agent-capabilities.mjs';
import { pickerModel, renderCapabilityPicker, renderRunAgentCapabilities } from '../ui/public/agent-capabilities-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const GH = 'plugin:gh', TEAM = 'manual:team-db', NAT = 'native:local';
const catalog = () => ({
  servers: [
    { id: GH, name: 'github', group: 'project', required: false, tools: [{ name: 'a', heldBack: null }, { name: 'b', heldBack: null }, { name: 'long', heldBack: 'name too long' }] },
    { id: TEAM, name: 'team-db', group: 'team', required: true, tools: [{ name: 'q', heldBack: null }] },
    { id: NAT, name: 'local', group: 'personal', required: false, native: true, tools: null },
  ],
  skills: [
    { id: 'skill:library:x', name: 'x', group: 'project', required: false },
    { id: 'skill:plugin:t', name: 't', group: 'team', required: true },
  ],
  unavailable: { servers: { 'plugin:old': 'no longer installed' }, skills: {} },
});
const row = (m, id) => m.servers.find((s) => s.id === id);

test('pickerModel: required server is locked, selected and "all" without being picked', () => {
  const r = row(pickerModel({ catalog: catalog(), access: {} }), TEAM);
  assert.deepEqual([r.selected, r.locked, r.mode], [true, true, 'all']);
  assert.ok(r.tools.every((t) => t.checked && t.disabled));
});

test('pickerModel: held-back tool is disabled; unreviewed tool is new; exclusions keep mode "all"', () => {
  const access = { mcpAccess: [{ server: GH, tools: 'all', reviewedTools: ['a'], excludedTools: ['b'] }] };
  const r = row(pickerModel({ catalog: catalog(), access }), GH);
  const t = Object.fromEntries(r.tools.map((x) => [x.name, x]));
  assert.equal(r.mode, 'all');
  assert.deepEqual([t.b.checked, t.a.checked], [false, true]);
  assert.deepEqual([t.long.disabled, t.long.checked, t.long.heldBack], [true, false, 'name too long']);
  assert.equal(t.long.isNew, true);
  assert.equal(t.a.isNew, false);
});

test('pickerModel: gone server, gone tool, native row', () => {
  const access = { mcpAccess: [{ server: 'plugin:old', tools: 'all' }, { server: GH, tools: ['a', 'zzz'] }] };
  const m = pickerModel({ catalog: catalog(), access });
  assert.deepEqual(m.goneServers, [{ id: 'plugin:old', name: 'plugin:old', reason: 'no longer installed' }]);
  assert.deepEqual(row(m, GH).goneTools, ['zzz']);
  assert.equal(row(m, GH).mode, 'some');
  const nat = row(m, NAT);
  assert.deepEqual([nat.native, nat.tools.length, nat.toolsKnown], [true, 0, false]);
});

const mount = (access, onChange = () => {}) => renderCapabilityPicker({ doc, catalog: catalog(), access, onChange });
const text = (el) => el.textContent.replace(/\s+/g, ' ');

test('picker: group headings in order Project, Team, Personal; team badge; locked checkbox', () => {
  const el = mount({});
  const heads = [...el.querySelectorAll('.cap-group-head')].map((h) => h.textContent);
  assert.deepEqual(heads.slice(0, 3), ['Project', 'Team', 'Personal']);
  assert.ok(text(el).includes('Required by team'));
  assert.ok(el.querySelector('.badge.slate'));
  const locked = [...el.querySelectorAll('input[type=checkbox]')].find((c) => c.dataset.id === TEAM);
  assert.deepEqual([locked.checked, locked.disabled], [true, true]);
  assert.ok(text(el).includes('Changes apply to every workflow that uses this agent, from its next run.'));
});

test('picker: ticking a server calls onChange with it added; Remove drops an unavailable one', () => {
  const calls = [];
  const el = mount({ mcpAccess: [{ server: 'plugin:old', tools: 'all' }] }, (a) => calls.push(a));
  assert.ok(el.querySelector('.badge.grey').textContent === 'Unavailable');
  el.querySelector('.cap-remove').click();
  assert.deepEqual(calls.at(-1), {});
  const gh = [...el.querySelectorAll('input[type=checkbox]')].find((c) => c.dataset.id === GH);
  gh.checked = true; gh.dispatchEvent(new doc.defaultView.Event('change'));
  assert.deepEqual(calls.at(-1).mcpAccess.map((e) => e.server), ['plugin:old', GH]);
});

test('picker: unticking a tool of an "All tools" server keeps the mode at "All tools"', () => {
  let access = { mcpAccess: [{ server: GH, tools: 'all', reviewedTools: ['a', 'b', 'long'] }] };
  const calls = [];
  const el = mount(access, (a) => calls.push(a));
  const a = [...el.querySelectorAll('input[type=checkbox]')].find((c) => c.dataset.tool === 'a');
  a.checked = false; a.dispatchEvent(new doc.defaultView.Event('change'));
  assert.deepEqual(calls.at(-1).mcpAccess[0].excludedTools, ['a']);
  assert.equal(calls.at(-1).mcpAccess[0].tools, 'all');
  assert.equal(el.querySelector('.seg [aria-pressed=true]').textContent, 'All tools');
});

test('picker: new tools offer Keep; untested server explains itself', () => {
  const calls = [];
  const el = mount({ mcpAccess: [{ server: GH, tools: 'all', reviewedTools: [] }, { server: NAT, tools: 'all' }] }, (a) => calls.push(a));
  assert.ok(text(el).includes('New — needs review'));
  assert.ok(text(el).includes("Tools of this server can't be listed here"));
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Keep all new').click();
  assert.deepEqual(calls.at(-1).mcpAccess[0].reviewedTools.sort(), ['a', 'b', 'long']);
});

const rec = (o = {}) => ({ agent: 'impl', servers: [], skills: [], requiredServers: [], requiredSkills: [], emptyServers: true, emptySkills: true, missing: [], enforced: true, ...o });

test('run card: lists, required badge, except-list, empty category + required, missing, note', () => {
  const card = renderRunAgentCapabilities({
    n1: rec({
      servers: [
        { server: GH, name: 'github', tools: 'all', excluded: ['merge'], toolNames: ['a', 'merge'], required: false },
        { server: TEAM, name: 'team-db', tools: 'all', toolNames: ['q', 'fresh'], required: true },
      ],
      emptyServers: false, requiredSkills: [{ skill: 'skill:plugin:t', name: 't' }],
      missing: [{ kind: 'server', id: 'manual:gone', label: 'gone', reason: 'no longer installed' }], note: 'bypass permissions: not enforced',
    }),
  }, { doc });
  const t = text(card);
  assert.ok(t.includes('All tools except merge'));
  assert.ok(t.includes('Required by team'));
  assert.ok(t.includes('fresh'));
  assert.ok(t.includes('Everything the run provides'));
  assert.ok(t.includes('Not available'));
  assert.ok(t.includes('no longer installed'));
  assert.ok(t.includes('bypass permissions: not enforced'));
  assert.ok(!t.includes('Enforced via Claude permissions'));
  assert.ok(!t.includes('New — needs review'));
});

test('run card: null when nothing is selected or required; "applied run-wide" when not enforced', () => {
  assert.equal(renderRunAgentCapabilities({ n1: rec() }, { doc }), null);
  assert.equal(renderRunAgentCapabilities(null, { doc }), null);
  const c = renderRunAgentCapabilities({ n1: rec({ skills: [{ skill: 's', name: 's' }], emptySkills: false, enforced: false }) }, { doc });
  assert.ok(text(c).includes('applied run-wide'));
});

// Built from the producer: the planner's record, nested the way run-harness writes it to run.json.
test('run card: the run.json shape, an All-tools server lists its tools (new one included), missing shows label + reason', () => {
  const mcp = { sets: [{ id: 's', group: 'set' }, { id: 'tm', group: 'team' }], skipped: [], skippedTools: [],
    copies: [
      { name: 'github', copy: 'github', setId: 's', serverId: GH, tools: ['search', 'create_pr', 'brand_new'] },
      { name: 'team-db', copy: 'team-db', setId: 'tm', serverId: TEAM, tools: ['q'] },
    ] };
  const access = { mcpAccess: [{ server: GH, tools: 'all', reviewedTools: ['search', 'create_pr'] }, { server: 'manual:gone', tools: 'all' }] };
  const plan = planAgentCapabilities({ access, mcp, skills: { sets: [], mounted: [] } });
  const runJson = { n1: { agent: 'impl', selection: access, record: plan.record, missing: plan.missing, enforced: plan.enforced } };
  const t = text(renderRunAgentCapabilities(runJson, { doc }));
  assert.ok(t.includes('github: All tools: search, create_pr, brand_new'));
  assert.ok(t.includes('team-db: q'));
  assert.ok(/manual:gone|gone/.test(t) && t.includes('('), 'missing item carries its reason');
  assert.ok(!t.includes('undefined'));
});

test('run card: a team-required server with no selection lists its tools', () => {
  const c = renderRunAgentCapabilities({ n1: rec({ requiredServers: [{ server: TEAM, name: 'team-db', toolNames: ['q', 'r'] }] }) }, { doc });
  assert.ok(text(c).includes('team-db: q, r'));
});
