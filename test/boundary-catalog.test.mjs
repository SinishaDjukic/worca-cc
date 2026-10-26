// test/boundary-catalog.test.mjs
// The engine catalog is the one place an engine's facts live (src/shared/engine-switch.mjs ENGINES,
// plans/core-protection-layer-design.md §4.4): the adapter registry, REMOTE_ENGINES and the sandbox rules derive
// from it, its env names are exact, and each rule claim has its fixtures. The engine gate reads it and never names an
// engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, ENGINE_NAMES, RULE_KINDS, RULE_SUPPORT, ruleKind } from '../src/shared/engine-switch.mjs';
import { REMOTE_ENGINES } from '../src/shared/exec-env.mjs';
import { ENGINE_SANDBOX } from '../src/core/exec-env/policy.mjs';
import { listEngines, getEngine } from '../src/core/engines/index.mjs';
import { builtinSlots } from '../src/broker/slots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES_DIR = join(ROOT, 'test', 'fixtures', 'engine-rules');
const NAME = /^[A-Z][A-Za-z0-9_]*$/;
const SECRET = /_(TOKEN|SECRET|KEY)$/;
// The broker slots the catalog's key modes sit in (src/broker/slots.mjs builtinSlots).
const BROKER_SLOTS = ['anthropic', 'openai', 'copilot-pat', 'cursor'];

test('catalog keys equal the adapter registry minus mock', () => {
  assert.deepEqual([...ENGINE_NAMES], listEngines().map((e) => e.name).filter((n) => n !== 'mock'));
});

test('cost flag equals adapter capability', () => {
  for (const e of ENGINE_NAMES) assert.equal(ENGINES[e].cost, getEngine(e).capabilities.cost !== false, e);
});

test('REMOTE_ENGINES is the remote catalog entries, and each has its sandbox rules', () => {
  assert.deepEqual([...REMOTE_ENGINES], ENGINE_NAMES.filter((e) => ENGINES[e].remote));
  assert.deepEqual(Object.keys(ENGINE_SANDBOX), [...REMOTE_ENGINES]);
});

test('env names are exact', () => {
  for (const e of ENGINE_NAMES) {
    const { env, signIn } = ENGINES[e];
    const all = [...env.names, ...env.relayOwned, ...env.hostOnly, ...signIn.modes.flatMap((m) => m.env)];
    for (const n of all) assert.match(n, NAME, `${e}: ${n}`);
    for (const v of Object.values(env)) assert.ok(!(v instanceof RegExp), `${e}: no RegExp in env`);
    assert.ok(env.home === null || (NAME.test(env.home.env) && typeof env.home.dir === 'string'), `${e}: home`);
    for (const m of signIn.modes) {
      if (m.kind === 'own') continue;
      // A mode's credential is its one secret-named name (credentials.mjs modeCredential); its other names are config.
      assert.equal(m.env.filter((n) => SECRET.test(n)).length, 1, `${e}/${m.id}: exactly one secret-named name`);
      for (const r of m.requires || []) {
        assert.ok(!SECRET.test(r) && (env.relayOwned.includes(r) || m.env.includes(r)), `${e}/${m.id}: requires ${r} is config the entry lists`);
      }
      if (m.brokerSlot) {
        assert.ok(BROKER_SLOTS.includes(m.brokerSlot), `${e}/${m.id}: slot ${m.brokerSlot}`);
        assert.ok(builtinSlots().some((s) => s.id === m.brokerSlot), `${e}/${m.id}: the broker has a built-in ${m.brokerSlot} slot`);
      }
    }
  }
});

test('copilot does not list COPILOT_ALLOW_ALL or COPILOT_ASSISTED_APPROVAL', () => {
  const { env, signIn } = ENGINES.copilot;
  const all = [...env.names, ...env.relayOwned, ...env.hostOnly, ...signIn.modes.flatMap((m) => m.env)];
  assert.equal(all.includes('COPILOT_ALLOW_ALL'), false);
  assert.equal(all.includes('COPILOT_ASSISTED_APPROVAL'), false);
});

test('claude declares its subscription sign-in names', () => {
  const names = new Set(ENGINES.claude.signIn.modes.flatMap((m) => m.env));
  for (const n of ['HOME', 'USER', 'LOGNAME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) {
    assert.ok(names.has(n), n);
  }
});

test('sign-in modes are well formed', () => {
  for (const e of ENGINE_NAMES) {
    const ids = ENGINES[e].signIn.modes.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, `${e}: unique mode ids`);
    for (const m of ENGINES[e].signIn.modes) assert.ok(['own', 'key', 'oauth'].includes(m.kind), `${e}/${m.id}: kind`);
  }
});

test('rule values are known, and keyed by known kinds', () => {
  for (const e of ENGINE_NAMES) {
    for (const [kind, v] of Object.entries(ENGINES[e].rules)) {
      assert.ok(RULE_KINDS.includes(kind), `${e}: kind ${kind}`);
      assert.ok(RULE_SUPPORT.includes(v), `${e}.${kind}: ${v}`);
    }
  }
});

test('every held or partial rule kind has a translation fixture equal to the adapter rule plan', () => {
  for (const e of ENGINE_NAMES) {
    for (const [kind, v] of Object.entries(ENGINES[e].rules)) {
      if (v !== 'held' && v !== 'partial') continue;
      const file = join(RULES_DIR, e, `${kind}.json`);
      assert.ok(existsSync(file), `${e}/${kind}.json`);
      const { rules, expected } = JSON.parse(readFileSync(file, 'utf8'));
      assert.ok(rules.deny.every((r) => ruleKind(r) === kind), `${e}/${kind}.json names ${kind} rules only`);
      assert.ok(expected && typeof expected === 'object', `${e}/${kind}: a translation, not nothing`);
      assert.deepEqual(getEngine(e).rulePlan(rules), expected, `${e}/${kind}: the adapter's translation`);
    }
  }
});

test('every held kind has a recorded denial', () => {
  for (const e of ENGINE_NAMES) {
    for (const [kind, v] of Object.entries(ENGINES[e].rules)) {
      if (v !== 'held') continue;
      const file = join(RULES_DIR, e, `${kind}.denial.jsonl`);
      assert.ok(existsSync(file), `${e}/${kind}.denial.jsonl`);
      const found = getEngine(e).denials(readFileSync(file, 'utf8').split('\n'));
      assert.ok(found.length > 0, `${e}/${kind}: the adapter finds the refusal`);
    }
  }
});

test('inheritance needs proof', () => {
  for (const e of ENGINE_NAMES) {
    const s = ENGINES[e].subagents;
    assert.ok(['yes', 'no', 'unverified'].includes(s.inheritsRules), e);
    if (s.inheritsRules !== 'yes') continue;
    assert.ok(s.proof && existsSync(join(RULES_DIR, s.proof)), `${e}: ${s.proof}`);
    const found = getEngine(e).denials(readFileSync(join(RULES_DIR, s.proof), 'utf8').split('\n'));
    assert.ok(found.some((d) => d.subagent), `${e}: the refusal happened inside a sub-agent`);
  }
});

test('shell engines are declared', () => {
  assert.equal(ENGINES.claude.shell, true);
  // Every adapter whose capabilities do not withhold the shell hands its agent one.
  for (const e of ENGINE_NAMES) if (getEngine(e).capabilities.shell !== false) assert.equal(ENGINES[e].shell, true, e);
});

test('the catalog holds data only', () => {
  for (const e of ENGINE_NAMES) {
    for (const k of ['requiresExplicitModel', 'remote', 'shell']) assert.equal(typeof ENGINES[e][k], 'boolean', `${e}.${k}`);
    assert.ok(['managed-home', 'user-store', 'none'].includes(ENGINES[e].sessions), `${e}.sessions`);
    assert.ok(Object.isFrozen(ENGINES[e].env.names), `${e}: frozen`);
  }
});

test('the release note of decision 3 agrees with the catalog: what needs --allow-unguarded-engine, per engine', () => {
  const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const at = log.indexOf('### Security: one owner per engine boundary');
  assert.ok(at >= 0, 'the section is there');
  const section = log.slice(at, log.indexOf('\n### ', at + 10));
  // A kind the catalog holds on Claude is never named as needing the flag there.
  const held = Object.entries(ENGINES.claude.rules).filter(([, v]) => v === 'held').map(([k]) => k);
  assert.ok(held.includes('mcp'));
  assert.match(section, /Its `Read`, `Edit`, `Bash`, `WebFetch`, `WebSearch` and MCP rules are held/);
  // Every engine with no held kind is named in the bare-rule note.
  const unheld = ['codex', 'copilot', 'cursor'].filter((e) => !Object.values(ENGINES[e].rules).includes('held'));
  const note = section.split('\n').find((l) => /a bare `Bash`, `WebSearch`, `WebFetch` or MCP rule needs the flag/.test(l)) || '';
  for (const e of unheld) assert.ok(note.includes(ENGINES[e].label), `${e} is named`);
  assert.match(section, /`\.claude\/settings\.json` deny rules on Claude/);
  assert.match(section, /Chat spawns go through the same allowlist/);
});


test('rule kinds parse from rule text', () => {
  assert.equal(ruleKind('Read(./x)'), 'Read');
  assert.equal(ruleKind('Bash'), 'Bash');
  assert.equal(ruleKind('Bash(git push:*)'), 'Bash');
  assert.equal(ruleKind('mcp__pg__drop'), 'mcp');
  assert.equal(ruleKind('MultiEdit(./x)'), 'Edit');
  assert.equal(ruleKind('Foo(x)'), 'Foo');
});

/** The body of method `name` in `src` (its first `name(` definition at class-member indent), brace-matched. */
function methodBody(src, name) {
  const at = src.search(new RegExp(`\\n  (async )?${name}\\(`));
  assert.ok(at >= 0, `${name} not found`);
  let i = src.indexOf('{', src.indexOf(')', at)); let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`${name}: unbalanced`);
}

test('no security gate names an engine', () => {
  const src = readFileSync(join(ROOT, 'src', 'core', 'run-harness.mjs'), 'utf8');
  for (const m of ['_engineRefusal', '_engineUnenforced', '_enginePartial', '_engineChecks', '_engineResumeGate', '_engineEarlyRefusal', '_engineMcpRefusal', '_engineMcpWarnings']) {
    const body = methodBody(src, m);
    for (const e of ENGINE_NAMES) assert.equal(body.includes(`'${e}'`), false, `${m} names '${e}'`);
  }
  for (const f of ['src/core/exec-env/policy.mjs', 'src/core/engines/index.mjs']) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    for (const e of ENGINE_NAMES) assert.equal(new RegExp(`[!=]==\\s*'${e}'`).test(s), false, `${f} tests the engine name '${e}'`);
  }
});
