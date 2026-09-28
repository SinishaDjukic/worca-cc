// test/wsmap-schema.test.mjs — vocabularies and the drop-invalid-keep-valid checkers (wsmap P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KINDS, KIND_LABELS, DIRS, CONFIDENCE, COVERAGE_LEVELS, NEEDS, EDGE_STATES,
  confidenceRank, checkLlmFact, checkSurvey, checkUsage, checkSynthesis, checkOverrides, storedCheckError,
} from '../src/shared/workspace-map/schema.mjs';

const fact = (over = {}) => ({ kind: 'http', key: 'GET /invoices/:id', file: 'src/api.ts', line: 3, match: "get('/invoices/:id'", ...over });

test('vocabularies are frozen and complete', () => {
  for (const t of [KINDS, KIND_LABELS, DIRS, CONFIDENCE, COVERAGE_LEVELS, NEEDS, EDGE_STATES]) assert.ok(Object.isFrozen(t));
  assert.deepEqual([...KINDS], ['http', 'grpc', 'graphql', 'topic', 'pkg', 'db', 'service', 'other']);
  assert.deepEqual(Object.keys(KIND_LABELS), [...KINDS]);
  assert.deepEqual([...CONFIDENCE], ['exact', 'verified', 'heuristic', 'inferred']);
  assert.deepEqual([...EDGE_STATES], ['auto', 'confirmed', 'rejected', 'manual', 'missing', 'stale']);
  assert.deepEqual(CONFIDENCE.map(confidenceRank), [0, 1, 2, 3]);
  assert.equal(confidenceRank('bogus'), 99);
});

test('checkLlmFact: member-root escape is refused in every spelling (killer: member-root escape)', () => {
  assert.equal(checkLlmFact(fact()), null);
  for (const file of ['../billing/src/a.ts', 'src/../../etc/passwd', '/etc/passwd', 'C:/Windows/x.ts', 'c:\\x.ts', 'src\\a.ts', '']) {
    assert.ok(checkLlmFact(fact({ file })), `must refuse ${JSON.stringify(file)}`);
  }
  assert.match(checkLlmFact(fact({ kind: 'rest' })), /kind must be one of/);
  assert.match(checkLlmFact(fact({ line: 0 })), /line/);
  assert.match(checkLlmFact(fact({ line: 2.5 })), /line/);
  assert.match(checkLlmFact(fact({ match: 'x'.repeat(201) })), /at most 200/);
  assert.match(checkLlmFact(fact({ match: 'a\nb' })), /single line/);
  assert.match(checkLlmFact(fact({ label: 'x'.repeat(61) })), /label/);
  assert.match(checkLlmFact(null), /object/);
});

test('checkSurvey: drops the invalid item, keeps its valid siblings (killer: checkers keep siblings)', () => {
  const doc = { version: 1, members: {
    web: { status: 'investigated', role: 'Storefront', aliases: ['web', 'two words'],
      provides: [fact(), fact({ file: '../x.ts' }), fact({ key: 'POST /cart', match: 'post(' })], consumes: [] },
    ghost: { status: 'investigated', provides: [], consumes: [] },
    api: { status: 'done' },
  } };
  const r = checkSurvey(doc, { memberKeys: ['web', 'api'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.value.members.web.provides.map((f) => f.key), ['GET /invoices/:id', 'POST /cart']);
  assert.deepEqual(r.value.members.web.aliases, ['web']);
  assert.equal(r.value.members.web.role, 'Storefront');
  assert.equal(r.value.members.ghost, undefined);
  assert.equal(r.value.members.api, undefined);
  assert.ok(r.errors.includes('members.web.provides[1]: file must be member-relative'), r.errors.join('\n'));
  assert.ok(r.errors.includes('members.ghost: unknown member'));
  assert.ok(r.errors.some((e) => e.startsWith('members.api.status:')));
  assert.ok(r.errors.some((e) => e.startsWith('members.web.aliases[1]:')));
});

test('checkSurvey: garbage in → valid empty skeleton out, never a throw', () => {
  for (const bad of [null, 42, 'x', [], { version: 2 }, { version: 1, members: [] }]) {
    const r = checkSurvey(bad, { memberKeys: ['a'] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.value, { version: 1, members: {} });
  }
  assert.equal(checkSurvey({ version: 1, members: {} }, { memberKeys: [] }).ok, true);
});

test('checkUsage: unknown entries, self relations and bad evidence are dropped one by one', () => {
  const doc = { version: 1, members: { web: { status: 'investigated',
    uses: [{ entry: 'e_1111111111', file: 'a.ts', line: 1, match: 'x' }, { entry: 'e_9999999999', file: 'a.ts', line: 1, match: 'x' }],
    rejected: [{ entry: 'e_1111111111', file: 'b.ts', line: 2, reason: 'comment only' }, { entry: 'e_1111111111', file: 'b.ts', line: 2 }],
    other: [{ to: 'api', kind: 'other', key: 'shared bucket', label: 'S3', file: 'c.ts', line: 3, match: 'bucket' },
      { to: 'web', kind: 'other', key: 'self', file: 'c.ts', line: 3, match: 'x' }] } } };
  const r = checkUsage(doc, { memberKeys: ['web', 'api'], entryIds: ['e_1111111111'] });
  const w = r.value.members.web;
  assert.deepEqual(w.uses.map((u) => u.entry), ['e_1111111111']);
  assert.equal(w.rejected.length, 1);
  assert.deepEqual(w.other.map((o) => o.to), ['api']);
  assert.ok(r.errors.includes('members.web.uses[1]: unknown entry e_9999999999'));
  assert.ok(r.errors.some((e) => e.startsWith('members.web.rejected[1]: reason')));
  assert.ok(r.errors.includes('members.web.other[1]: to must be another member'));
  assert.equal(checkUsage({ version: 1, members: { web: { status: 'skipped' } } }, { memberKeys: ['web'] }).value.members.web, undefined);
  // Persisted, a message keeps its path but never the agent-written value it echoes; the path is redacted.
  assert.equal(storedCheckError('members.web.uses[1]: unknown entry ghp_A1b2C3d4E5f6G7h8I9j0K1l2'), 'members.web.uses[1]: unknown entry');
  assert.equal(storedCheckError('members.web.other[0]: unknown member password=hunter2'), 'members.web.other[0]: unknown member');
  assert.equal(storedCheckError('members.ghost: unknown member'), 'members.ghost: unknown member');
  assert.doesNotMatch(storedCheckError('members.API_TOKEN=abc123: unknown member'), /abc123/);
  assert.equal(storedCheckError('x'.repeat(500)).length, 300);
});

test('checkSynthesis: overview required, roles only for known members, notes capped', () => {
  const r = checkSynthesis({ version: 1, overview: 'Two services.', roles: { web: 'Storefront', nope: 'x' },
    coordination: ['Ship billing first.', '', ...Array.from({ length: 25 }, (_, i) => `n${i}`)], orderNotes: 'Billing first.' }, { memberKeys: ['web'] });
  assert.equal(r.value.overview, 'Two services.');
  assert.deepEqual(r.value.roles, { web: 'Storefront' });
  assert.equal(r.value.coordination.length, 20);
  assert.equal(r.value.coordination[0], 'Ship billing first.');
  assert.ok(r.errors.includes('roles.nope: unknown member'));
  assert.ok(r.errors.some((e) => e.startsWith('coordination[1]:')));
  const empty = checkSynthesis({ version: 1 }, { memberKeys: [] });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.value, { version: 1, overview: '', roles: {}, coordination: [], orderNotes: '' });
});

test('checkOverrides: edge ids, states, snapshots and manual edges', () => {
  const good = { state: 'confirmed', from: 'web', to: 'api', kind: 'http', display: 'GET /x', at: '2026-09-25T00:00:00.000Z' };
  const r = checkOverrides({ version: 1,
    edges: { x_0123456789ab: good, m_0123456789ab: good, x_bad: good, x_aaaaaaaaaaaa: { ...good, state: 'maybe' } },
    manual: [{ id: 'm_0123456789ab', from: 'web', to: 'api', kind: 'topic', display: 'orders', detail: '', createdAt: 't' },
      { id: 'm_0123456789ab', from: 'web', to: 'api', kind: 'topic', display: 'orders', createdAt: 't' },
      { id: 'm_ffffffffffff', from: 'web', to: 'web', kind: 'topic', display: 'x', createdAt: 't' }] });
  assert.deepEqual(Object.keys(r.value.edges), ['x_0123456789ab'], 'only scanned-edge ids (x_) carry a state');
  assert.ok(r.errors.includes('edges.m_0123456789ab: edge id must be x_ + 12 hex'), r.errors.join('\n'));
  assert.deepEqual(r.value.manual.map((m) => m.id), ['m_0123456789ab']);
  assert.equal(r.errors.length, 5, r.errors.join('\n'));
});

test('checkSynthesis redacts what it keeps (the synthesis is stored in map_json and shown in the UI)', () => {
  const r = checkSynthesis({ version: 1, overview: 'Reads postgres://app:s3cr3t@db/x.', roles: { web: 'API_TOKEN=abc123' },
    coordination: ['password: hunter2'], orderNotes: 'token=zzz' }, { memberKeys: ['web'] });
  assert.equal(r.ok, true);
  assert.doesNotMatch(JSON.stringify(r.value), /s3cr3t|abc123|hunter2|zzz/);
  assert.equal(r.value.overview, 'Reads postgres://***@db/x.');
});

test('a "__proto__" member key is refused and never re-parents the kept members (v4)', () => {
  const doc = JSON.parse('{"version":1,"members":{"__proto__":{"status":"failed","role":"x"},"web":{"status":"failed"}}}');
  for (const check of [checkSurvey, checkUsage]) {
    const r = check(doc);
    assert.equal(Object.getPrototypeOf(r.value.members), Object.prototype);
    assert.deepEqual(Object.keys(r.value.members), ['web']);
    assert.ok(r.errors.includes('members.__proto__: unknown member'), r.errors.join('\n'));
  }
});

test('checkSynthesis clips after redacting: what it keeps passes its own re-check (render re-checks the stored synthesis)', () => {
  const doc = { version: 1, overview: 'a'.repeat(1493) + ' pwd=1', roles: { web: 'r'.repeat(154) + ' pwd=1' },
    coordination: ['n'.repeat(394) + ' pwd=1'], orderNotes: 'o'.repeat(1994) + ' pwd=1' };
  const first = checkSynthesis(doc, { memberKeys: ['web'] });
  assert.equal(first.ok, true, first.errors.join('; '));
  const again = checkSynthesis(first.value, { memberKeys: ['web'] });
  assert.equal(again.ok, true, again.errors.join('; '));
  assert.deepEqual(again.value, first.value);
  assert.deepEqual([first.value.overview.length, first.value.roles.web.length, first.value.coordination[0].length, first.value.orderNotes.length], [1500, 160, 400, 2000]);
  // v6: the clip never splits a surrogate pair nor leaves a trailing space, so the stored value is a fixpoint.
  for (const tail of [' pwd: ab ' + String.fromCharCode(0xd83d, 0xde42), ' pwd: ab y']) {
    const kept = checkSynthesis({ version: 1, overview: 'a'.repeat(1500 - tail.length) + tail }).value.overview;
    assert.equal(checkSynthesis({ version: 1, overview: kept }).value.overview, kept, JSON.stringify(tail));
    const last = kept.charCodeAt(kept.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff) && kept === kept.trimEnd(), JSON.stringify(tail));
  }
  // v7: the cut can leave text the redactor reads anew (`token=https://` cut to `token=https:/`): re-redacted until stable.
  const hs = String.fromCharCode(0xd83d);
  for (const tail of [' token=https://', ' AUTH_HOST=auth-svc.x', ' authorization: token x', ` y ${hs} ${hs}`]) {
    const kept = checkSynthesis({ version: 1, overview: 'secret: ab ' + 'z'.repeat(1489 - tail.length) + tail }).value.overview;
    assert.equal(checkSynthesis({ version: 1, overview: kept }).value.overview, kept, JSON.stringify(tail));
  }
  // A glued token chain (`npm_…npm_…`) loses one token per redaction pass: the clip runs until its cut is stable.
  const chain = Array.from({ length: 37 }, (_, i) => `npm_Zq9${String(i).padStart(3, '0')}${'a'.repeat(30)}`).join('');
  const clean = checkSynthesis({ version: 1, overview: chain }).value.overview;
  assert.equal(clean.includes('Zq9'), false, clean);
  assert.equal(checkSynthesis({ version: 1, overview: clean }).value.overview, clean);
  // Nothing left once the lone surrogates go: rejected as empty, never stored as '' (the re-check would reject it).
  const lone = checkSynthesis({ version: 1, overview: `${hs} ${hs}`, roles: { web: hs }, coordination: [hs, 'b'] }, { memberKeys: ['web'] });
  assert.deepEqual([lone.value.overview, lone.value.roles, lone.value.coordination], ['', {}, ['b']]);
  const relone = checkSynthesis(lone.value, { memberKeys: ['web'] });
  assert.deepEqual(relone.value, lone.value);
  assert.deepEqual(relone.errors.filter((e) => !lone.errors.includes(e)), []);
});
