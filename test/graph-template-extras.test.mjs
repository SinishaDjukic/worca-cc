// test/graph-template-extras.test.mjs — the session schema: constants, the sparse settings map, the one extras picker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplate, normalizeSessions, pickTemplateExtras, mintId, TEMPLATE_EXTRAS } from '../src/shared/graph/template.mjs';
import { SESSION_ID_RE, MAX_SESSION_MEMBERS, SESSION_MIN_MEMBERS, SESSION_MODES, SESSION_LABEL_MAX, SESSION_SETTING_KEYS } from '../src/shared/graph/constants.mjs';

const A = (id, session) => ({ id, kind: 'agent', key: 'planner', x: 0, y: 0, config: session === undefined ? {} : { session } });

test('session constants and minted ids', () => {
  assert.equal(MAX_SESSION_MEMBERS, 4);
  assert.equal(SESSION_MIN_MEMBERS, 2);
  assert.equal(SESSION_LABEL_MAX, 60);
  assert.deepEqual([...SESSION_MODES], ['subagents', 'shared']);
  assert.deepEqual([...SESSION_SETTING_KEYS], ['label', 'mode', 'hostModel', 'hostEffort']);
  for (let i = 0; i < 200; i += 1) assert.match(mintId('s_', new Set()), SESSION_ID_RE);
  for (const bad of ['s_ABCDEFGH', 's_1234567', 's_123456789', 'n_abcdefgh', 's-abcdefgh', ' s_abcdefgh']) assert.doesNotMatch(bad, SESSION_ID_RE);
});

test('normalizeSessions: only sessions with an agent member, unknown keys kept, keys sorted, junk dropped', () => {
  const nodes = [A('n_a', 's_aaaaaaaa'), A('n_b', 's_aaaaaaaa'), A('n_c'),
    { id: 'n_s', kind: 'script', key: 'k', x: 0, y: 0, config: { session: 's_cccccccc' } }];
  const out = normalizeSessions({ s_zzzzzzzz: { label: 'gone' }, s_aaaaaaaa: { mode: 'shared', color: 'red' }, s_bbbbbbbb: 7, s_cccccccc: { label: 'x' } }, nodes);
  assert.deepEqual(out, { s_aaaaaaaa: { mode: 'shared', color: 'red' } });
  assert.deepEqual(Object.keys(normalizeSessions({ s_bbbbbbbb: { label: 'B' }, s_aaaaaaaa: { label: 'A' } }, [A('n_1', 's_bbbbbbbb'), A('n_2', 's_aaaaaaaa')])), ['s_aaaaaaaa', 's_bbbbbbbb']);
  assert.equal(normalizeSessions({}, nodes), null);
  assert.equal(normalizeSessions(null, nodes), null);
  assert.equal(normalizeSessions({ s_aaaaaaaa: {} }, nodes), null, 'an empty entry is the default: dropped');
  assert.equal(normalizeSessions({ S_BAD: { label: 'x' } }, [A('n_a', 'S_BAD'), A('n_b', 'S_BAD')]), null, 'a malformed sid keeps no settings (V25 judges the members)');
  const raw = { s_aaaaaaaa: { label: 'L' } };
  assert.notEqual(normalizeSessions(raw, nodes).s_aaaaaaaa, raw.s_aaaaaaaa, 'entries are copies');
});

test('pickTemplateExtras: canvas all-or-nothing, codeGraph only false, sessions per normalizeSessions', () => {
  assert.deepEqual([...TEMPLATE_EXTRAS], ['canvas', 'codeGraph', 'sessions']);
  const nodes = [A('n_a', 's_aaaaaaaa'), A('n_b', 's_aaaaaaaa')];
  assert.deepEqual(pickTemplateExtras({ nodes, canvas: { x: 1, y: 2, zoom: 1 }, codeGraph: false, sessions: { s_aaaaaaaa: { label: 'L' } } }),
    { canvas: { x: 1, y: 2, zoom: 1 }, codeGraph: false, sessions: { s_aaaaaaaa: { label: 'L' } } });
  assert.deepEqual(Object.keys(pickTemplateExtras({ nodes, sessions: { s_aaaaaaaa: { label: 'L' } }, codeGraph: false, canvas: { zoom: 1, y: 2, x: 1 } })), ['canvas', 'codeGraph', 'sessions']);
  assert.deepEqual(pickTemplateExtras({ nodes, canvas: { x: 1 }, codeGraph: true, sessions: {} }), {});
  assert.deepEqual(pickTemplateExtras({ sessions: { s_aaaaaaaa: { label: 'L' } } }, nodes), { sessions: { s_aaaaaaaa: { label: 'L' } } }, 'nodes may come from elsewhere');
  assert.deepEqual(pickTemplateExtras(null), {});
});

test('normalizeTemplate round-trips sessions and never rewrites config.session', () => {
  const t = normalizeTemplate({ id: 'wf', version: 2, nodes: [A('n_a', 's_aaaaaaaa'), A('n_b', 7)], wires: [], sessions: { s_aaaaaaaa: { hostEffort: 'low' } } });
  assert.deepEqual(t.sessions, { s_aaaaaaaa: { hostEffort: 'low' } });
  assert.equal(t.nodes[1].config.session, 7, 'the validator judges a bad value; normalize keeps it');
  assert.equal('sessions' in normalizeTemplate({ id: 'wf', nodes: [A('n_a')], wires: [] }), false, 'absent stays absent');
  assert.deepEqual(Object.keys(normalizeTemplate({ id: 'wf', nodes: [A('n_a', 's_aaaaaaaa'), A('n_b', 's_aaaaaaaa')], wires: [], canvas: { x: 0, y: 0, zoom: 1 }, codeGraph: false, sessions: { s_aaaaaaaa: { label: 'L' } } })),
    ['id', 'name', 'version', 'domain', 'nodes', 'wires', 'canvas', 'codeGraph', 'sessions']);
});
