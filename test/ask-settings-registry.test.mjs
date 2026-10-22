// test/ask-settings-registry.test.mjs — worca Chat P2 Task 2: the settings the chat may read and change (U4), each
// change a receipt (R6). Pure: every reader and writer is a fake; the validators are the Settings page's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsRegistry, SETTING_EXCLUSIONS, sameValue } from '../src/core/ask/settings-registry.mjs';
import { receiptCard, chatActionSummary, askActorFor, prCardLinkRefusal, prCardResult } from '../src/core/ask/receipt.mjs';
import { SETTINGS_POST_KEYS, assertScheduleDefaultsInput, setScheduleDefaults } from '../src/core/settings.mjs';
import { checkRows } from './helpers/rows.mjs';

const PROJECT = { key: 'shop-1a2b3c4d', name: 'shop', path: '/p/shop' };
const MODELS = [
  { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', efforts: ['medium', 'high'] },
];
const SCHED = { graceMin: 'scheduleGraceMin', ifMissed: 'scheduleIfMissed', maxFailures: 'scheduleMaxFailures' };
/** Just enough of the real setters for these rows (one key per body, like applySettingsPatch is handed). */
function applyBody(s, body) {
  const [[key, v]] = Object.entries(body);
  if (key === 'schedule') { for (const [k, x] of Object.entries(v)) { if (x === null || x === '') delete s[SCHED[k]]; else s[SCHED[k]] = x; } return; }
  if (key === 'sync') { s.sync = { ...(s.sync || {}) }; for (const [k, x] of Object.entries(v)) { if (x === null) delete s.sync[k]; else s.sync[k] = x; } return; }
  if (key === 'chat') { s.chat = { ...(s.chat || {}), notify: { ...((s.chat || {}).notify || {}), ...v.notify } }; return; }
  if (key === 'workspaceScan') { if (v) s.workspaces = { scan: v }; else delete s.workspaces; return; }
  if (key === 'theme') { if (v === '' || v === 'system') delete s.theme; else s.theme = v; return; }
  if (v === '' || v === null) delete s[key]; else s[key] = v;
}
function setup({ settings = {}, own = {}, writable = true } = {}) {
  const s = { ...settings };
  const layer = { ...own };
  const bodies = []; const patches = []; const slots = [];
  const reg = createSettingsRegistry({
    readSettings: () => s,
    roles: () => [{ key: 'planner', label: 'Planner' }],
    listModels: async () => MODELS,
    assertSlotModels: async (items) => {
      slots.push(...items);
      for (const it of items) if (!MODELS.some((m) => m.id === it.value.model)) throw new Error(`${it.id}: unknown model "${it.value.model}" — add it to the catalog first`);
    },
    projectSettingIds: (roles) => ['run.engine', 'pipelineCostLimitUsd', 'askMaxTurns', 'askWeb', 'nightMode.enabled', 'skillMount', ...roles.map((r) => `models.claude.steps.${r}`)],
    resolveSetting: (id) => {
      const dflt = id === 'askMaxTurns' ? 400 : null;
      return { value: layer[id] ?? dflt, source: layer[id] !== undefined ? 'project' : 'default', layers: { project: layer[id], user: undefined, team: undefined, default: dflt } };
    },
    assertProjectSettingsPatch: (patch) => Object.entries(patch).map(([id, value]) => {
      if (id === 'askMaxTurns' && value !== null && !(Number.isSafeInteger(value) && value >= 1 && value <= 500)) throw Object.assign(new Error('askMaxTurns must be an integer between 1 and 500'), { status: 400 });
      return { entry: { id, ...(id.startsWith('models.') ? { family: 'steps', engine: 'claude' } : {}) }, value };
    }),
    projects: async () => [PROJECT],
    scanDefaults: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' },
    ...(writable ? {
      applyUser: async (body) => { bodies.push(body); applyBody(s, body); },
      applyProject: async (p, patch) => { patches.push([p.key, patch]); for (const [k, v] of Object.entries(patch)) { if (v === null) delete layer[k]; else layer[k] = v; } },
    } : {}),
  });
  return { reg, s, layer, bodies, patches, slots };
}

test('list_settings rows: user scope lists the Settings page, never a secret, a folder, a command or the chat\'s own powers', async () => {
  const { reg } = setup();
  const out = await reg.list({ scope: 'user' });
  const ids = out.settings.map((r) => r.id);
  for (const id of ['theme', 'uiLevel', 'pipelineCostLimitUsd', 'sync.beforeRun', 'schedule.graceMin', 'chat.notify.done', 'askMaxTurns', 'models.claude.ask', 'models.claude.memoryDefrag', 'run.engine', 'models.claude.steps.planner', 'workspaceScan.scanEffort']) assert.ok(ids.includes(id), id);
  for (const id of ids) assert.ok(!/^(root|projectsRoot|actions|askWeb|chat\.scriptTools|chat\.channels|nightMode|providers|speech)(\.|$)/.test(id), `never listed: ${id}`);
  const theme = out.settings.find((r) => r.id === 'theme');
  assert.deepEqual(theme, { id: 'theme', label: 'Theme', group: 'General', value: 'System (default)', stored: null, allowed: '"system" | "light" | "dark" | null (default)' });
  assert.equal(out.settings.find((r) => r.id === 'models.claude.steps.planner').label, 'Planner model (Claude)');   // engineLabel('claude')
  assert.deepEqual(out.excluded, SETTING_EXCLUSIONS.map((e) => e.what));
  assert.deepEqual((await reg.list({ scope: 'user', query: 'sync.' })).settings.map((r) => r.id), ['sync.beforeRun', 'sync.onDiverged', 'sync.remote', 'sync.refreshMinutes']);
});

test('list_settings rows: project scope lists the cascade ids minus web access and Away mode, with what they inherit', async () => {
  const { reg, layer } = setup();
  const out = await reg.list({ scope: 'project', projectKey: PROJECT.key });
  assert.equal(out.projectKey, PROJECT.key);
  assert.deepEqual(out.settings.map((r) => r.id), ['run.engine', 'pipelineCostLimitUsd', 'askMaxTurns', 'skillMount', 'models.claude.steps.planner']);
  assert.equal(out.settings.find((r) => r.id === 'askMaxTurns').value, '400 (inherited)');
  layer.askMaxTurns = 20;
  const again = (await reg.list({ scope: 'project', projectKey: PROJECT.key })).settings.find((r) => r.id === 'askMaxTurns');
  assert.equal(again.value, '20'); assert.equal(again.stored, 20); assert.equal(again.source, 'project');
  await assert.rejects(reg.list({ scope: 'project', projectKey: 'nope-00000000' }), /unknown project "nope-00000000"/);
});

test('check: every refusal is the Settings page\'s own words, or names why the chat may not touch it', async () => {
  const { reg } = setup();
  await checkRows([
    ['theme neon', { id: 'theme', value: 'neon' }, /theme must be system, light or dark/],
    ['root is excluded', { id: 'root', value: '/x' }, /root is not changed from the chat: folders widen what can be browsed/],
    ['askWeb is the chat\'s own power', { id: 'askWeb.enabled', value: true }, /not changed from the chat: the chat's own powers are only the user's to grant/],
    ['unknown id', { id: 'bogus', value: 1 }, /unknown setting "bogus"/],
    ['project scope needs a project', { id: 'askMaxTurns', scope: 'project', value: 5 }, /scope "project" needs projectKey/],
    ['unknown project', { id: 'askMaxTurns', scope: 'project', projectKey: 'nope-00000000', value: 5 }, /unknown project "nope-00000000"/],
    ['a sync remote is a name', { id: 'sync.remote', value: 'https://x' }, /sync.remote must be a remote NAME/],
    ['schedule grace range', { id: 'schedule.graceMin', value: 99999 }, /scheduleGraceMin must be a whole number of minutes from 0 to 10080/],
    ['an unknown chat model', { id: 'models.claude.ask', value: { model: 'gpt-x' } }, /unknown model "gpt-x"/],
    ['a Claude helper slot takes no effort', { id: 'models.claude.utility.title', value: { model: 'claude-sonnet-5', effort: 'high' } }, /takes no effort/],
    ['the per-turn cap range', { id: 'askMaxBudgetUsd', value: 500 }, /askMaxBudgetUsd must be null \(no cap\) or a number between 0.1 and 100/],
    ['the project cascade validator', { id: 'askMaxTurns', scope: 'project', projectKey: PROJECT.key, value: 9999 }, /askMaxTurns must be an integer between 1 and 500/],
  ].map(([name, req, re]) => ({ name, run: async () => {
    const r = await reg.check(req);
    assert.equal(r.ok, false, name);
    assert.match(r.error, re);
  } })));
});

test('apply: one POST key per change, a receipt with display before/after and the raw values a Revert writes back', async () => {
  await checkRows([
    { name: 'theme', run: async () => {
      const { reg, bodies } = setup();
      const r = await reg.apply({ id: 'theme', scope: 'user', value: 'dark' });
      assert.deepEqual(bodies, [{ theme: 'dark' }]);
      assert.deepEqual(r.card, { type: 'receipt', kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' }, revertible: true });
    } },
    { name: 'unchanged: no write, a notice', run: async () => {
      const { reg, bodies } = setup();
      assert.deepEqual(await reg.apply({ id: 'theme', scope: 'user', value: 'system' }), { ok: true, unchanged: true, notice: 'Theme is already System (default)' });
      assert.deepEqual(bodies, []);
    } },
    { name: 'a workspace scan field writes the whole pick (unit = the pick)', run: async () => {
      const { reg, bodies } = setup();
      const r = await reg.apply({ id: 'workspaceScan.scanEffort', scope: 'user', value: 'high' });
      assert.deepEqual(bodies, [{ workspaceScan: { scanModel: 'claude-sonnet-5', scanEffort: 'high', agentModel: 'sonnet', agentEffort: 'medium' } }]);
      assert.equal(r.card.before, 'medium (default)'); assert.equal(r.card.after, 'high'); assert.equal(r.card.raw.before, null);
    } },
    { name: 'a chat notification', run: async () => {
      const { reg, bodies } = setup();
      const r = await reg.apply({ id: 'chat.notify.done', scope: 'user', value: false });
      assert.deepEqual(bodies, [{ chat: { notify: { done: false } } }]);
      assert.equal(r.card.before, 'On'); assert.equal(r.card.after, 'Off'); assert.deepEqual(r.card.raw, { before: true, after: false });
    } },
    { name: 'a schedule default', run: async () => {
      const { reg, bodies } = setup();
      const r = await reg.apply({ id: 'schedule.graceMin', scope: 'user', value: 60 });
      assert.deepEqual(bodies, [{ schedule: { graceMin: 60 } }]);
      assert.equal(r.card.before, '6 h (default)'); assert.equal(r.card.after, '1 h');
    } },
    { name: 'a project override', run: async () => {
      const { reg, patches } = setup();
      const r = await reg.apply({ id: 'askMaxTurns', scope: 'project', projectKey: PROJECT.key, value: 20 });
      assert.deepEqual(patches, [[PROJECT.key, { askMaxTurns: 20 }]]);
      assert.deepEqual(r.card.target, { settingId: 'askMaxTurns', scope: 'project', projectKey: PROJECT.key, title: 'shop' });
      assert.equal(r.card.before, '400 (inherited)'); assert.equal(r.card.after, '20');
    } },
    { name: 'the MCP child\'s copy is read-only', run: async () => {
      const { reg } = setup({ writable: false });
      const r = await reg.apply({ id: 'theme', scope: 'user', value: 'dark' });
      assert.equal(r.ok, false); assert.match(r.error, /read-only/);
    } },
  ]);
});

test('revert: writes raw.before only while the value still equals raw.after (R6)', async () => {
  await checkRows([
    { name: 'user: back to unset', run: async () => {
      const { reg, s, bodies } = setup();
      const { card } = await reg.apply({ id: 'theme', scope: 'user', value: 'dark' });
      assert.deepEqual(await reg.revert(card), { ok: true, notice: 'Reverted: Theme back to System (default)' });
      assert.deepEqual(bodies.at(-1), { theme: '' });
      assert.equal(s.theme, undefined);
    } },
    { name: 'changed since: nothing written', run: async () => {
      const { reg, s, bodies } = setup();
      const { card } = await reg.apply({ id: 'theme', scope: 'user', value: 'dark' });
      s.theme = 'light';
      assert.deepEqual(await reg.revert(card), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.equal(bodies.length, 1);
    } },
    { name: 'project: back to inherited', run: async () => {
      const { reg, patches } = setup();
      const { card } = await reg.apply({ id: 'askMaxTurns', scope: 'project', projectKey: PROJECT.key, value: 20 });
      const r = await reg.revert(card);
      assert.equal(r.ok, true); assert.equal(r.notice, 'Reverted: Turn limit (shop) back to 400 (inherited)');
      assert.deepEqual(patches.at(-1), [PROJECT.key, { askMaxTurns: null }]);
    } },
  ]);
});

test('every user setting writes exactly one known POST key — never an empty body, never root, projectsRoot or actions', () => {
  const { reg } = setup();
  for (const def of reg.defsFor('user')) {
    for (const unit of [null, def.put(null, def.get(null))]) {
      const keys = Object.keys(def.body(unit));
      assert.equal(keys.length, 1, def.id);
      assert.ok(SETTINGS_POST_KEYS.includes(keys[0]) && !['root', 'projectsRoot', 'actions'].includes(keys[0]), `${def.id} → ${keys[0]}`);
    }
  }
});

test('assertScheduleDefaultsInput is the setter\'s own check (setScheduleDefaults still refuses before any write)', async () => {
  assert.throws(() => assertScheduleDefaultsInput({ graceMin: -1 }), /scheduleGraceMin must be a whole number of minutes from 0 to 10080/);
  assert.throws(() => assertScheduleDefaultsInput({ ifMissed: 'later' }), /scheduleIfMissed must be one of run \| skip/);
  assert.doesNotThrow(() => assertScheduleDefaultsInput({ graceMin: null, maxFailures: '' }));
  await assert.rejects(setScheduleDefaults({ maxFailures: 101 }), /scheduleMaxFailures must be a whole number from 0 to 100/);
});

test('receipt helpers: the card shape, its context line, the actor, the same-value rule', () => {
  const card = receiptCard({ kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0001', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' } });
  assert.equal(chatActionSummary(card), 'Run (Fix login): Running → Paused');
  assert.equal(chatActionSummary({ type: 'run-stop', title: 'Fix login' }), 'Stop Fix login');
  assert.equal(chatActionSummary({ type: 'pull-request', title: 'Fix login', result: { url: 'https://x/pull/1' } }), 'Pull request for Fix login: https://x/pull/1');
  assert.equal(chatActionSummary({ type: 'ship', title: 'Charts' }), 'Ship Charts');
  assert.equal(chatActionSummary({ type: 'ship', title: 'Charts', result: { mode: 'one' } }), 'Ship Charts: shipped as one PR');
  // Shaper s5: the round number is the one taken at Start (result.round), never landing.target.round
  const round = { type: 'changes', landing: { kind: 'round', title: 'Changes to Run 2 · same branch, same PR', target: { round: 2 } } };
  assert.equal(chatActionSummary(round), 'Changes to Run 2 · same branch, same PR');
  assert.equal(chatActionSummary({ ...round, result: { round: 3, pr: 41 } }), 'Changes to Run 2 · same branch, same PR: Round 3 started');
  assert.equal(chatActionSummary({ type: 'changes', landing: { kind: 'next-plan', title: "Changes to Charts · into Run 3's plan" }, result: { index: 3 } }),
    "Changes to Charts · into Run 3's plan: Added to Run 3's plan");
  assert.equal(chatActionSummary({ type: 'route', text: 'make the legend smaller' }), 'Where does this go: make the legend smaller');
  assert.equal(chatActionSummary({ type: 'route', text: 'x', result: { verb: 'save' } }), 'Where does this go: x: Saved for the next checkpoint');
  assert.throws(() => receiptCard({ kind: 'nope' }), /unknown receipt kind/);
  assert.equal(askActorFor('ada@example.com'), 'ada@example.com via worca chat');
  assert.equal(askActorFor('local'), 'worca chat');
  assert.equal(sameValue(null, undefined), true);
  assert.equal(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameValue({ model: 'x' }, { model: 'x', effort: 'high' }), false);
});

test('apply and revert run one at a time: two changes in flight at once both land (a turn\'s parallel change_setting calls)', async () => {
  let stored = {};
  const reg = createSettingsRegistry({
    readSettings: () => stored,
    applyUser: async (body) => {
      const next = { ...stored };                          // a setter reads settings.json …
      await new Promise((r) => setImmediate(r));           // … awaits its write …
      applyBody(next, body); stored = next;                // … and writes back what it read, plus its key
    },
  });
  const [a, b] = await Promise.all([reg.apply({ id: 'theme', value: 'dark' }), reg.apply({ id: 'uiLevel', value: 'expert' })]);
  assert.equal(a.card.after, 'Dark'); assert.equal(b.card.after, 'Expert');
  assert.deepEqual(stored, { theme: 'dark', uiLevel: 'expert' });
  const [ra, rb] = await Promise.all([reg.revert(a.card), reg.revert(b.card)]);
  assert.equal(ra.ok, true); assert.equal(rb.ok, true);
  assert.deepEqual(stored, {});
});

test('the link rules for a workspace: a later member PR finds the card applied and adds itself (Review Focus 3)', () => {
  const block = { state: 'proposed', card: { type: 'pull-request', pipelineId: 'aaaa0001' } };
  assert.equal(prCardLinkRefusal(block, { id: 'aaaa0001', memberKey: 'api-11111111' }), null);
  const first = prCardResult(block, { url: 'https://x/pull/1', draft: false, existed: false, memberKey: 'api-11111111' });
  assert.deepEqual(first, { url: 'https://x/pull/1', draft: false, existed: false, members: [{ url: 'https://x/pull/1', draft: false, existed: false, memberKey: 'api-11111111' }] });
  const applied = { state: 'applied', card: { type: 'pull-request', pipelineId: 'aaaa0001', result: first } };
  assert.equal(prCardLinkRefusal(applied, { id: 'aaaa0001', memberKey: 'web-22222222' }), null, 'the second member is allowed');
  assert.deepEqual(prCardLinkRefusal(applied, { id: 'aaaa0001' }), { status: 409, error: 'card is applied' }, 'a project run opens one PR');
  const second = prCardResult(applied, { url: 'https://x/pull/2', draft: true, existed: false, memberKey: 'web-22222222' });
  assert.equal(second.url, 'https://x/pull/1');
  assert.deepEqual(second.members.map((m) => m.memberKey), ['api-11111111', 'web-22222222']);
  assert.deepEqual(prCardLinkRefusal({ state: 'proposed', card: { type: 'run-stop' } }, { id: 'aaaa0001' }), { status: 400, error: 'unknown askCardId' });
});

test('revert: a project no longer registered is CHANGED_SINCE, nothing written (mutation killer)', async () => {
  const { reg, patches } = setup();
  const card = receiptCard({ kind: 'setting', label: 'Turn limit', target: { settingId: 'askMaxTurns', scope: 'project', projectKey: 'gone-00000000', title: 'gone' },
    before: '400 (inherited)', after: '20', raw: { before: null, after: 20 } });
  assert.deepEqual(await reg.revert(card), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — the project is no longer registered' });
  assert.deepEqual(patches, []);
});

test('refine cycle 2 mutation killers: a setting no longer offered, a project override back to inherited, an empty value', async () => {
  await checkRows([
    { name: 'revert of a setting the chat no longer offers (a removed role): NOT_REVERTIBLE, nothing written', run: async () => {
      const { reg, bodies } = setup();
      const card = receiptCard({ kind: 'setting', label: 'Retired model (Claude)', target: { settingId: 'models.claude.steps.retired', scope: 'user' }, before: 'Default (default)', after: 'claude-opus-5-5', raw: { before: null, after: { model: 'claude-opus-5-5' } } });
      assert.deepEqual(await reg.revert(card), { ok: false, code: 'NOT_REVERTIBLE', error: 'This setting can no longer be changed from the chat' });
      assert.deepEqual(bodies, []);
    } },
    { name: 'check: a project override set to null reads what it inherits now — the user\'s own value before the default', run: async () => {
      const layer = { askMaxTurns: 20 };
      const reg = createSettingsRegistry({
        projectSettingIds: () => ['askMaxTurns'],
        resolveSetting: (id) => ({ value: layer[id] ?? 100, source: layer[id] !== undefined ? 'project' : 'user', layers: { project: layer[id], user: 100, team: undefined, default: 400 } }),
        assertProjectSettingsPatch: (patch) => Object.entries(patch).map(([id, value]) => ({ entry: { id }, value })),
        projects: async () => [PROJECT],
      });
      const r = await reg.check({ id: 'askMaxTurns', scope: 'project', projectKey: PROJECT.key, value: null });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(r.before, { unit: 20, text: '20' });
      assert.deepEqual(r.after, { unit: null, text: '100 (inherited)' });
    } },
    { name: 'apply: an empty value is "back to the default" — already the default, so no write and no receipt', run: async () => {
      const { reg, bodies } = setup();
      assert.deepEqual(await reg.apply({ id: 'theme', scope: 'user', value: '' }), { ok: true, unchanged: true, notice: 'Theme is already System (default)' });
      assert.deepEqual(bodies, []);
    } },
  ]);
});

test('refine cycle 2: a model slot id is never "keys and tokens"; Hide built-in models stays on the Models page; an effort-only pair reads as one; null puts a workspace scan field back', async () => {
  await checkRows([
    { name: 'a model slot typo is an unknown setting, not an exclusion', run: async () => {
      const { reg } = setup();
      const r = await reg.check({ id: 'models.claude.steps.Planner', value: { model: 'claude-sonnet-5' } });
      assert.equal(r.ok, false);
      assert.match(r.error, /^unknown setting "models\.claude\.steps\.Planner"/);
    } },
    { name: 'hideBuiltinModels is excluded with its reason, and never listed', run: async () => {
      const { reg } = setup();
      const r = await reg.check({ id: 'hideBuiltinModels', value: true });
      assert.equal(r.ok, false);
      assert.match(r.error, /^hideBuiltinModels is not changed from the chat: once set it overrides the team default/);
      assert.ok(!(await reg.list({ scope: 'user' })).settings.some((x) => x.id === 'hideBuiltinModels'));
    } },
    { name: 'an effort-only pair reads as one', run: async () => {
      const { reg } = setup({ settings: { askModels: { claude: { effort: 'high' } } } });
      assert.equal((await reg.list({ scope: 'user', query: 'models.claude.ask' })).settings[0].value, 'Model default · high');
    } },
    { name: 'workspace scan: null puts the field back; all four at their defaults = unset', run: async () => {
      const { reg, bodies } = setup({ settings: { workspaces: { scan: { scanModel: 'claude-opus-5-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' } } } });
      const r = await reg.apply({ id: 'workspaceScan.scanModel', scope: 'user', value: null });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(bodies, [{ workspaceScan: null }]);
      assert.equal(r.card.before, 'claude-opus-5-5');
      assert.equal(r.card.after, 'claude-sonnet-5 (default)');
    } },
  ]);
});

test('refine cycle 3 mutation killers: a model alone reads as the model (no dangling " · "); a user-only chat model slot asked per project is unknown there, not "keys and tokens"', async () => {
  const { reg, bodies } = setup({ settings: { askModels: { claude: { model: 'claude-sonnet-5' } }, stepModels: { claude: { planner: { model: 'claude-opus-5-5', effort: 'high' } } } } });
  const rows = (await reg.list({ scope: 'user', query: 'models.claude.' })).settings;
  assert.equal(rows.find((r) => r.id === 'models.claude.ask').value, 'claude-sonnet-5');
  assert.equal(rows.find((r) => r.id === 'models.claude.steps.planner').value, 'claude-opus-5-5 · high');
  const r = await reg.apply({ id: 'models.claude.ask', scope: 'user', value: { model: 'claude-opus-5-5' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(bodies, [{ askModels: { claude: { model: 'claude-opus-5-5' } } }]);
  assert.equal(r.card.before, 'claude-sonnet-5'); assert.equal(r.card.after, 'claude-opus-5-5');
  const p = await reg.check({ id: 'models.claude.ask', scope: 'project', projectKey: PROJECT.key, value: { model: 'claude-sonnet-5' } });
  assert.equal(p.ok, false);
  assert.match(p.error, /^unknown setting "models\.claude\.ask"/);
});

test('a model slot reads only {model, effort}: a hand-edited extra field never reaches list_settings or a receipt (impl review m5)', async () => {
  const { reg } = setup({ settings: { stepModels: { claude: { planner: { model: 'claude-opus-5-5', effort: 'high', apiKey: 'sk-SECRET123' } } } } });
  const row = (await reg.list({ scope: 'user', query: 'models.claude.steps.' })).settings.find((r) => r.id === 'models.claude.steps.planner');
  assert.deepEqual(row.stored, { model: 'claude-opus-5-5', effort: 'high' });
  const r = await reg.apply({ id: 'models.claude.steps.planner', scope: 'user', value: { model: 'claude-sonnet-5', effort: 'medium' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.card.raw.before, { model: 'claude-opus-5-5', effort: 'high' }, 'a Revert writes back only the pair');
});

test('refine cycle 3: a project-only setting\'s refusal names what it takes, never "<id> undefined" (the cascade keeps no hint for it)', async () => {
  const { assertProjectSettingsPatch } = await import('../src/core/settings-cascade.mjs');
  const reg = createSettingsRegistry({
    projectSettingIds: () => ['contextMaxBytesPerFile', 'skillMount', 'memory.defrag.bytesPct'],
    resolveSetting: () => ({ value: null, source: 'default', layers: { project: undefined, user: undefined, team: undefined, default: null } }),
    assertProjectSettingsPatch: (patch, o) => assertProjectSettingsPatch(patch, o),
    projects: async () => [PROJECT],
  });
  for (const [id, value, words] of [['contextMaxBytesPerFile', -1, 'contextMaxBytesPerFile must be a whole number of bytes'],
    ['skillMount', 'hardlink', 'skillMount must be "copy" | "symlink"'], ['memory.defrag.bytesPct', 500, 'memory.defrag.bytesPct must be a whole number 1–100']]) {
    const r = await reg.check({ id, scope: 'project', projectKey: PROJECT.key, value });
    assert.equal(r.ok, false, id);
    assert.equal(r.error, words);
  }
  const ok = await reg.check({ id: 'skillMount', scope: 'project', projectKey: PROJECT.key, value: 'symlink' });
  assert.equal(ok.ok, true, 'a good value still passes');
});

test('refine cycle 3: one card applied twice (two tabs pressed Create at once) keeps one link per pull request', () => {
  const card = { type: 'pull-request', pipelineId: 'aaaa0001' };
  const first = prCardResult({ state: 'proposed', card }, { url: 'https://x/pull/7', draft: true, existed: false });
  assert.deepEqual(prCardResult({ state: 'applied', card: { ...card, result: first } }, { url: 'https://x/pull/7', draft: false, existed: true }), first,
    'a project run: the second submission only linked the same PR — no memberless "members" entry');
  const ws = prCardResult({ state: 'proposed', card }, { url: 'https://x/pull/8', draft: false, existed: false, memberKey: 'api-11111111' });
  const twice = prCardResult({ state: 'applied', card: { ...card, result: ws } }, { url: 'https://x/pull/8', draft: false, existed: true, memberKey: 'api-11111111' });
  assert.deepEqual(twice.members.map((m) => m.memberKey), ['api-11111111'], 'one link per member');
  const other = prCardResult({ state: 'applied', card: { ...card, result: ws } }, { url: 'https://x/pull/9', draft: false, existed: false, memberKey: 'web-22222222' });
  assert.deepEqual(other.members.map((m) => m.memberKey), ['api-11111111', 'web-22222222'], 'another member still adds itself (Review Focus 3)');
});

test('check: a project override set to null previews what the cascade resolves — a stored null (No cap) outranks a team default', async () => {
  const reg = createSettingsRegistry({
    projectSettingIds: () => ['askMaxBudgetUsd'], projects: async () => [PROJECT],
    resolveSetting: () => ({ value: 3, source: 'project', layers: { project: 3, user: null, team: 2, default: null } }),
    assertProjectSettingsPatch: (patch) => Object.entries(patch).map(([id, value]) => ({ entry: { id }, value })),
  });
  const r = await reg.check({ id: 'askMaxBudgetUsd', scope: 'project', projectKey: PROJECT.key, value: null });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.after, { unit: null, text: 'No cap (inherited)' });
});

test('models.claude.utility.agentGen: a user-scope Claude pair on agentGenModel, never a project setting', async () => {
  const { reg, s, bodies, slots } = setup();
  const row = (await reg.list({ scope: 'user', query: 'agentGen' })).settings;
  assert.deepEqual(row.map((r) => [r.id, r.label, r.group, r.value, r.stored]),
    [['models.claude.utility.agentGen', 'Agent generation model', 'Models', 'Default', null]]);
  assert.match(row[0].allowed, /a model from list_models that runs on Claude, "effort": "medium" \| "high" \| "xhigh" \| "max"/);
  let r = await reg.apply({ id: 'models.claude.utility.agentGen', scope: 'user', value: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(bodies.at(-1), { agentGenModel: { model: 'claude-opus-5-5', effort: 'high' } }, 'the catalog casing, on the Settings page\'s own key');
  assert.equal(r.card.after, 'claude-opus-5-5 · high');
  assert.deepEqual(slots.at(-1), { id: 'models.claude.utility.agentGen', engine: 'claude', value: { model: 'claude-opus-5-5', effort: 'high' } },
    'the catalog check runs on Claude: a Codex id is refused here, not "applied" and then refused by the server');
  r = await reg.check({ id: 'models.claude.utility.agentGen', value: { model: 'claude-sonnet-5', effort: 'max' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /claude-sonnet-5 does not offer effort "max"/);
  r = await reg.check({ id: 'models.claude.utility.agentGen', value: { model: 'gpt-x' } });
  assert.match(r.error, /unknown model "gpt-x"/);
  r = await reg.apply({ id: 'models.claude.utility.agentGen', scope: 'user', value: null });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(bodies.at(-1), { agentGenModel: null });
  assert.equal('agentGenModel' in s, false);
  const p = await reg.check({ id: 'models.claude.utility.agentGen', scope: 'project', projectKey: PROJECT.key, value: { model: 'claude-sonnet-5' } });
  assert.equal(p.ok, false);
  assert.match(p.error, /^unknown setting "models\.claude\.utility\.agentGen"/, 'user-only: unknown per project, not "keys and tokens"');
});

test('models.claude.utility.naming: a user-scope Claude pair on namingModel, never a project setting', async () => {
  const { reg, s, bodies, slots } = setup();
  const row = (await reg.list({ scope: 'user', query: 'naming' })).settings;
  assert.deepEqual(row.map((r) => [r.id, r.label, r.group, r.value, r.stored]),
    [['models.claude.utility.naming', 'Run naming model', 'Models', 'Default', null]]);
  assert.match(row[0].allowed, /a model from list_models that runs on Claude, "effort": "medium" \| "high" \| "xhigh" \| "max"/);
  let r = await reg.apply({ id: 'models.claude.utility.naming', scope: 'user', value: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(bodies.at(-1), { namingModel: { model: 'claude-opus-5-5', effort: 'high' } }, 'the catalog casing, on the Settings page\'s own key');
  assert.equal(r.card.after, 'claude-opus-5-5 · high');
  assert.deepEqual(slots.at(-1), { id: 'models.claude.utility.naming', engine: 'claude', value: { model: 'claude-opus-5-5', effort: 'high' } },
    'the catalog check runs on Claude: a Codex id is refused here, not "applied" and then refused by the server');
  r = await reg.check({ id: 'models.claude.utility.naming', value: { model: 'claude-sonnet-5', effort: 'max' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /claude-sonnet-5 does not offer effort "max"/);
  r = await reg.check({ id: 'models.claude.utility.naming', value: { model: 'gpt-x' } });
  assert.match(r.error, /unknown model "gpt-x"/);
  r = await reg.apply({ id: 'models.claude.utility.naming', scope: 'user', value: null });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(bodies.at(-1), { namingModel: null });
  assert.equal('namingModel' in s, false);
  const p = await reg.check({ id: 'models.claude.utility.naming', scope: 'project', projectKey: PROJECT.key, value: { model: 'claude-sonnet-5' } });
  assert.equal(p.ok, false);
  assert.match(p.error, /^unknown setting "models\.claude\.utility\.naming"/, 'user-only: unknown per project, not "keys and tokens"');
});
