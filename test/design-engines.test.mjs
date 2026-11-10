// test/design-engines.test.mjs
// Design P8 Task 2: the engine gate. One table row per engine, kept honest against what each adapter declares; open,
// consent and refused engines; consent never lifts the broker, a bridged model that is not ready or a missing
// OpenCode model; the copy each case shows, and the project note. `env: {}` keeps the OpenCode opt-in out of reach of
// the shell running the suite.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { getEngine } from '../src/core/engines/index.mjs';
import { ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { DESIGN_ENGINES, designEngineFor, designEngineGate, designEngineRow, resolveDesignEngine } from '../src/core/design/engines.mjs';

useTempHome(after);
const gate = (o) => designEngineGate({ broker: () => null, bridged: () => null, env: {}, ...o });
const verdict = (r) => [r.ok, r.overridable, r.code];

test('the table agrees with what the adapters declare', async () => {
  await checkRows([...ENGINE_NAMES, 'mock'].map((name) => ({
    name,
    run: () => {
      assert.ok(Object.hasOwn(DESIGN_ENGINES, name), 'a row exists');
      const row = DESIGN_ENGINES[name];
      const caps = getEngine(name).capabilities;
      if (caps.allowedTools === false) assert.notEqual(row.gate, 'open', 'no Bash cannot be enforced: gated');
      assert.equal(row.cost === 'unknown', caps.cost === false, 'cost unknown exactly where the adapter reports none');
      if (caps.permissionRules === false) assert.equal(row.gate, 'refused', 'no rules at all: refused');
      if (name !== 'claude' && name !== 'mock') assert.notEqual(row.live, 'toolInput', 'only Claude streams tool input');
      assert.deepEqual(designEngineRow(name), row);
    },
  })));
  assert.equal(designEngineRow('nextcli').gate, 'refused');
  assert.equal(designEngineRow('__proto__').gate, 'refused', 'a name is looked up as an own key only');
});

test('open, consent, refused', async () => {
  for (const engine of ['claude', 'mock']) assert.deepEqual(gate({ engine }).ok, true, engine);
  const codex = gate({ engine: 'codex' });
  assert.deepEqual(verdict(codex), [false, true, 'engine-gated']);
  assert.match(codex.reasons[0], /^OpenAI Codex cannot be kept from running shell commands\. Its sandbox holds writes/);
  assert.equal(codex.error, codex.reasons[0]);
  assert.equal(gate({ engine: 'codex', allowed: true }).ok, true);
  await checkRows(['gemini', 'qwen', 'cursor', 'opencode'].map((engine) => ({
    name: engine,
    run: () => {
      const r = gate({ engine, modelFor: () => 'm' });
      assert.deepEqual(verdict(r), [false, true, 'engine-gated']);
      assert.match(r.reasons[0], engine === 'cursor'
        ? /^Cursor cannot be kept from running shell commands, so its agents/
        : /runs with its shell and web tools off here/);
      assert.equal(gate({ engine, modelFor: () => 'm', allowed: true }).ok, true);
    },
  })));
  const goose = gate({ engine: 'goose', allowed: true });
  assert.deepEqual(verdict(goose), [false, false, 'engine-refused']);
  assert.match(goose.error, /^Goose cannot be held to one folder/);
  assert.deepEqual(goose.reasons, [goose.error]);
  const unknown = gate({ engine: 'nextcli', allowed: true, adapterOf: () => { throw new Error('unknown engine'); } });
  assert.deepEqual([unknown.ok, unknown.overridable, unknown.code], [false, false, 'engine-refused']);
  assert.equal(unknown.error, 'nextcli has not been checked for Design, so it does not run here.');
  assert.equal(gate({ engine: 'nextcli', allowed: true }).ok, false, 'the real adapter lookup refuses it too');
});

test('copilot: Bash can be denied, yet spend and rules still need consent', () => {
  const rules = { deny: ['Read(//**/.env*)', 'Bash(rm:*)'] };
  const r = gate({ engine: 'copilot', rules });
  assert.deepEqual(verdict(r), [false, true, 'engine-gated']);
  assert.deepEqual(r.reasons, [
    "GitHub Copilot reports no cost, so worca's spend limits cannot stop it.",
    'GitHub Copilot cannot fully hold these rules: Read(//**/.env*), Bash(rm:*).',
  ]);
  assert.equal(gate({ engine: 'copilot', rules, allowed: true }).ok, true);
  assert.deepEqual(gate({ engine: 'claude', rules }).ok, true, 'rules are skipped on Claude: its hook holds them');
});

test('consent never lifts the broker, a bridged model that is not ready, or a missing model', () => {
  const broker = gate({ engine: 'codex', allowed: true, broker: () => 'the credential broker is on' });
  assert.deepEqual([...verdict(broker), broker.error], [false, false, 'engine-refused', 'the credential broker is on']);
  const bridged = gate({ engine: 'claude', models: ['kimi'], allowed: true, bridged: () => ({ ready: false, message: 'no key' }) });
  assert.deepEqual([...verdict(bridged), bridged.error], [false, false, 'engine-refused', 'no key']);
  const lead = (r) => (r === 'lead' ? 'm' : null);
  const noModel = gate({ engine: 'opencode', allowed: true, modelFor: lead });
  assert.deepEqual([...verdict(noModel), noModel.error], [false, false, 'engine-refused', 'OpenCode needs a model set in Settings before Design can run on it.']);
  assert.equal(gate({ engine: 'opencode', allowed: true, modelFor: (r) => (r === 'builder' ? 'm' : null) }).ok, false, 'the lead needs one too');
  assert.equal(gate({ engine: 'opencode', allowed: true, modelFor: lead, env: { WORCA_OPENCODE_ALLOW_DEFAULT_MODEL: '1' } }).ok, true);
  for (const off of ['0', 'false', 'FALSE', '']) {
    assert.equal(gate({ engine: 'opencode', allowed: true, modelFor: lead, env: { WORCA_OPENCODE_ALLOW_DEFAULT_MODEL: off } }).ok, false, `opt-in ${JSON.stringify(off)} is off`);
  }
  let asked = null;
  gate({ engine: 'codex', broker: (e, env) => { asked = [e, env.MARK]; return null; }, env: { MARK: 'x' } });
  assert.deepEqual(asked, ['codex', 'x'], 'the broker is asked about this engine, with the gate\'s env');
});

test('a bridged Claude model', () => {
  const r = gate({ engine: 'claude', models: ['m'], bridged: () => ({ ready: true }) });
  assert.deepEqual([r.ok, r.row.live, r.row.cost, r.row.confine, r.row.bridged], [true, 'toolEnd', 'priced', 'hook', true]);
  assert.equal(gate({ engine: 'claude', models: ['m'] }).row.bridged, undefined, 'a model the bridge does not serve');
  assert.deepEqual(designEngineRow('claude', { models: ['m'], bridged: () => ({ ready: true }) }).live, 'toolEnd');
});

test('notes', () => {
  assert.deepEqual(gate({ engine: 'gemini', allowed: true, project: true }).notes, ['Gemini CLI cannot read the picked project.']);
  assert.deepEqual(gate({ engine: 'gemini', allowed: true }).notes, []);
  assert.deepEqual(gate({ engine: 'gemini', project: true }).notes, ['Gemini CLI cannot read the picked project.'], 'a refusal carries the note too');
  for (const engine of ['codex', 'cursor', 'claude']) assert.deepEqual(gate({ engine, allowed: true, project: true }).notes, [], engine);
});

test('a design\'s engine: a stored one as it is, else the resolved one, unstored', () => {
  assert.deepEqual(designEngineFor({ engine: 'mock' }), { engine: 'mock', stored: true }, 'a stored mock never meets selectRunEngine');
  assert.deepEqual(designEngineFor({ engine: 'codex' }), { engine: 'codex', stored: true });
  assert.deepEqual(designEngineFor({ engine: null }), { engine: 'claude', stored: false });
  assert.equal(resolveDesignEngine({ explicit: ' codex ' }), 'codex');
  assert.equal(resolveDesignEngine(), 'claude');
  for (const explicit of ['nope', 'mock']) assert.throws(() => resolveDesignEngine({ explicit }), (e) => e.status === 400, explicit);
});
