// test/workspace-map-eval.test.mjs
// src/core/workspace-map/eval.mjs: precision / recall of a map against labels at pair+kind and
// key level, per kind and per confidence; missed / spurious lists; the --init template and the
// labels a workspace's overrides imply; label errors and warnings; a report that never prints a
// control character. Pure: no fs, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, labelsFromMap, labelsFromOverrides, checkLabels, formatReport } from '../src/core/workspace-map/eval.mjs';
import { edgeId } from '../src/shared/workspace-map/ids.mjs';

const edge = (from, to, kind, norm, confidence) => ({
  id: edgeId(from, to, kind, norm), from, to, kind, norm, display: norm.slice(norm.indexOf(':') + 1), label: null,
  detail: '', confidence, sources: ['static'], evidence: { from: [], to: [] },
});
const E = {
  getInvoice: edge('web', 'billing', 'http', 'http:GET /invoices/{}', 'exact'),
  postInvoice: edge('web', 'billing', 'http', 'http:POST /invoices', 'verified'),
  getUser: edge('web', 'users', 'http', 'http:GET /users/{}', 'heuristic'),
  sharedPkg: edge('billing', 'shared', 'pkg', 'pkg:npm:@acme/shared', 'exact'),
  orders: edge('web', 'billing', 'topic', 'topic:orders', 'inferred'),
};
const MAP = {
  version: 1, workspace: { name: 'Shop' }, scannedAt: '2026-09-25T00:00:00.000Z', runId: 'r1',
  members: ['billing', 'shared', 'users', 'web'].map((key) => ({ key, name: key, coverage: { level: 'rich' } })),
  edges: Object.values(E), order: [], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 },
  stats: {}, errors: [],
};
const LABELS = {
  version: 1, workspace: 'Shop',
  edges: [
    { from: 'web', to: 'billing', kind: 'http', key: 'GET /invoices/:id', truth: true },   // raw key -> normKey
    { from: 'web', to: 'billing', kind: 'http', key: 'http:POST /invoices', truth: true }, // a norm, literally
    { from: 'web', to: 'users', kind: 'http', key: 'http:GET /users/{}', truth: false },
    { from: 'billing', to: 'shared', kind: 'pkg', truth: true },                           // pair level
    { from: 'users', to: 'shared', kind: 'pkg', truth: true },                             // missed
    { from: 'web', to: 'billing', kind: 'grpc', key: 'grpc:acme.Billing', truth: true },   // missed, key + rolled-up pair
    { from: 'web', to: 'shared', kind: 'db', truth: null },                                // undecided: ignored
  ],
};
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('key level: raw and normalised keys both match; tp / fp / fn / unlabelled', () => {
  const r = evaluate(MAP, LABELS);
  assert.deepEqual({ tp: r.keys.tp, fp: r.keys.fp, fn: r.keys.fn, unlabelled: r.keys.unlabelled }, { tp: 2, fp: 1, fn: 1, unlabelled: 2 });
  approx(r.keys.precision, 2 / 3);
  approx(r.keys.recall, 2 / 3);
});

test('pair+kind level: explicit pair labels plus key labels rolled up to their pair', () => {
  const r = evaluate(MAP, LABELS);
  assert.deepEqual({ tp: r.pairs.tp, fp: r.pairs.fp, fn: r.pairs.fn, unlabelled: r.pairs.unlabelled }, { tp: 2, fp: 1, fn: 2, unlabelled: 1 });
  approx(r.pairs.precision, 2 / 3);
  approx(r.pairs.recall, 0.5);
  assert.deepEqual(r.counts, { edges: 5, pairs: 4, labels: 6 });
});

test('byKind and byConfidence (a pair counts at its strongest edge; recall = share of the truth)', () => {
  const r = evaluate(MAP, LABELS);
  assert.deepEqual(Object.keys(r.byKind), ['http', 'grpc', 'topic', 'pkg']);
  assert.equal(r.byKind.http.precision, 0.5);
  assert.equal(r.byKind.http.recall, 1);
  assert.equal(r.byKind.grpc.recall, 0);
  assert.equal(r.byKind.grpc.precision, null);
  assert.equal(r.byKind.topic.unlabelled, 1);
  assert.equal(r.byKind.pkg.recall, 0.5);
  assert.deepEqual(Object.keys(r.byConfidence), ['exact', 'heuristic', 'inferred']);
  assert.equal(r.byConfidence.exact.tp, 2);
  assert.equal(r.byConfidence.exact.precision, 1);
  assert.equal(r.byConfidence.exact.recall, 0.5);
  assert.equal(r.byConfidence.heuristic.precision, 0);
  assert.equal(r.byConfidence.inferred.unlabelled, 1);
  assert.equal(r.byConfidence.inferred.precision, null);
});

test('missed and spurious name every miss and every false edge, by level', () => {
  const r = evaluate(MAP, LABELS);
  assert.deepEqual(r.missed, [
    { level: 'key', from: 'web', to: 'billing', kind: 'grpc', key: 'grpc:acme.Billing' },
    { level: 'pair', from: 'users', to: 'shared', kind: 'pkg' },
    { level: 'pair', from: 'web', to: 'billing', kind: 'grpc' },
  ]);
  assert.deepEqual(r.spurious, [
    { level: 'key', from: 'web', to: 'users', kind: 'http', key: 'http:GET /users/{}', id: E.getUser.id, confidence: 'heuristic' },
    { level: 'pair', from: 'web', to: 'users', kind: 'http', confidence: 'heuristic' },
  ]);
});

test('with overrides the reviewed map is scored: rejected edges dropped, manual edges predicted', () => {
  const overrides = {
    version: 1,
    edges: { [E.getUser.id]: { state: 'rejected', from: 'web', to: 'users', kind: 'http', display: 'GET /users/{}', at: 't' } },
    manual: [{ id: 'm_0123456789ab', from: 'users', to: 'shared', kind: 'pkg', display: '@acme/shared', detail: '', createdAt: 't' }],
  };
  const r = evaluate(MAP, LABELS, { overrides });
  assert.deepEqual({ tp: r.pairs.tp, fp: r.pairs.fp, fn: r.pairs.fn }, { tp: 3, fp: 0, fn: 1 });
  assert.equal(r.pairs.precision, 1);
  approx(r.pairs.recall, 0.75);
  assert.deepEqual(Object.keys(r.byConfidence), ['exact', 'inferred', 'manual'], 'a manual edge is scored as manual, never as the scan\'s verified');
  assert.equal(r.byConfidence.manual.tp, 1);
});

test('never throws: null map, garbage labels, bad entries reported in labelErrors', () => {
  const empty = evaluate(null, null);
  assert.deepEqual(empty.pairs, { tp: 0, fp: 0, fn: 0, unlabelled: 0, precision: null, recall: null });
  assert.deepEqual(empty.labelErrors, ['edges: must be an array']);
  const { edges, errors } = checkLabels({ edges: [
    null, { from: 'a', to: 'b', kind: 'smoke', truth: true }, { from: 'a', kind: 'http', truth: true },
    { from: 'a', to: 'b', kind: 'http', truth: 'yes' }, { from: 'a', to: 'b', kind: 'http', key: '  ', truth: true },
    { from: 'a', to: 'b', kind: 'http', truth: false },
  ] });
  assert.deepEqual(edges, [{ from: 'a', to: 'b', kind: 'http', truth: false }]);
  assert.equal(errors.length, 5);
  assert.match(errors[1], /^edges\[1\]: kind must be one of/);
});

test('labelsFromMap: one undecided key-level entry per edge, sorted; scoring it untouched labels nothing', () => {
  const t = labelsFromMap(MAP);
  assert.equal(t.version, 1);
  assert.equal(t.workspace, 'Shop');
  assert.equal(t.edges.length, 5);
  assert.deepEqual(t.edges[0], { from: 'billing', to: 'shared', kind: 'pkg', key: 'pkg:npm:@acme/shared', truth: null, display: E.sharedPkg.display, confidence: 'exact', id: E.sharedPkg.id });
  assert.ok(t.edges.every((e) => e.truth === null));
  const r = evaluate(MAP, t);
  assert.deepEqual(r.labelErrors, [], 'undecided entries are ignored silently');
  assert.equal(r.counts.labels, 0);
  assert.equal(r.pairs.precision, null, 'an untouched template never reads as a perfect score');
  assert.deepEqual(labelsFromMap(null), { version: 1, workspace: null, edges: [] });
});

test('labelsFromOverrides: confirmed true, rejected false (key level on the map); lost confirmed and manual -> pair true', () => {
  const overrides = {
    version: 1,
    edges: {
      [E.getInvoice.id]: { state: 'confirmed', from: 'web', to: 'billing', kind: 'http', display: 'x', at: 't' },
      [E.getUser.id]: { state: 'rejected', from: 'web', to: 'users', kind: 'http', display: 'x', at: 't' },
      x_0000000000aa: { state: 'confirmed', from: 'web', to: 'users', kind: 'graphql', display: 'Query.me', at: 't' },
      x_0000000000bb: { state: 'rejected', from: 'web', to: 'users', kind: 'db', display: 'users', at: 't' },
      m_00000000abcd: { state: 'confirmed', from: 'web', to: 'users', kind: 'grpc', display: 'x', at: 't' }, // not a scanned-edge id: never read
    },
    manual: [{ id: 'm_0123456789ab', from: 'users', to: 'shared', kind: 'pkg', display: '@acme/shared', detail: '', createdAt: 't' }],
  };
  assert.deepEqual(labelsFromOverrides(MAP, overrides).edges, [
    { from: 'users', to: 'shared', kind: 'pkg', truth: true },
    { from: 'web', to: 'billing', kind: 'http', key: 'http:GET /invoices/{}', truth: true },
    { from: 'web', to: 'users', kind: 'graphql', truth: true },
    { from: 'web', to: 'users', kind: 'http', key: 'http:GET /users/{}', truth: false },
  ]);
  const r = evaluate(MAP, labelsFromOverrides(MAP, overrides));
  assert.deepEqual({ tp: r.pairs.tp, fp: r.pairs.fp, fn: r.pairs.fn }, { tp: 1, fp: 1, fn: 2 });
  assert.deepEqual(labelsFromOverrides(MAP, null).edges, []);
});

test('formatReport prints both levels, both breakdowns and the lists; n/a for an undefined ratio', () => {
  const text = formatReport(evaluate(MAP, LABELS), { workspace: 'Shop' });
  assert.match(text, /^worca workspace map eval — Shop: 5 edges, 4 pairs, 6 labels$/m);
  assert.match(text, /^pair\+kind\s+2\s+1\s+2\s+1\s+0\.667\s+0\.500$/m);
  assert.match(text, /^key\s+2\s+1\s+1\s+2\s+0\.667\s+0\.667$/m);
  assert.match(text, /^grpc\s+0\s+0\s+1\s+0\s+n\/a\s+0\.000$/m);
  assert.match(text, /^missed \(3\)$/m);
  assert.match(text, /^ {2}\[pair\] users -> shared {2}pkg$/m);
  assert.match(text, /^spurious \(2\)$/m);
});

const pick = (m) => ({ tp: m.tp, fp: m.fp, fn: m.fn, unlabelled: m.unlabelled });
const USERS_GET = edge('web', 'users', 'http', 'http:GET /users/{}', 'heuristic');
const USERS_POST = edge('web', 'users', 'http', 'http:POST /users', 'exact');
const TWO = { ...MAP, edges: [USERS_GET, USERS_POST] };

test('a pair known only through false key labels stays unlabelled while a predicted edge of it is unlabelled', () => {
  const one = [{ from: 'web', to: 'users', kind: 'http', key: 'http:GET /users/{}', truth: false }];
  const r = evaluate(TWO, { version: 1, edges: one });
  assert.deepEqual(pick(r.keys), { tp: 0, fp: 1, fn: 0, unlabelled: 1 });
  assert.deepEqual(pick(r.pairs), { tp: 0, fp: 0, fn: 0, unlabelled: 1 });
  const reviewed = { version: 1, manual: [], edges: { [USERS_GET.id]: { state: 'rejected', from: 'web', to: 'users', kind: 'http', display: 'x', at: 't' } } };
  assert.equal(evaluate(TWO, labelsFromOverrides(TWO, reviewed)).pairs.fp, 0, 'an un-reviewed POST keeps the pair unlabelled');
  const both = evaluate(TWO, { version: 1, edges: [...one, { from: 'web', to: 'users', kind: 'http', key: 'POST /users', truth: false }] });
  assert.deepEqual(pick(both.pairs), { tp: 0, fp: 1, fn: 0, unlabelled: 0 });
});

test('one truth written as a norm and as a raw key counts once; a key worca cannot read is a label error', () => {
  const r = evaluate(MAP, { version: 1, edges: [
    { from: 'web', to: 'users', kind: 'topic', key: 'topic:user.created', truth: true },
    { from: 'web', to: 'users', kind: 'topic', key: 'user.created', truth: true },
  ] });
  assert.equal(r.keys.fn, 1);
  assert.deepEqual(r.missed.filter((m) => m.level === 'key'), [{ level: 'key', from: 'web', to: 'users', kind: 'topic', key: 'topic:user.created' }]);
  const { edges, errors } = checkLabels({ edges: [{ from: 'billing', to: 'shared', kind: 'pkg', key: '@acme/shared', truth: true }] });
  assert.deepEqual(edges, []);
  assert.deepEqual(errors, ['edges[0]: key is not a pkg key: @acme/shared']);
});

test('explicit pair labels win over rolled-up key labels; a lost confirmed edge is never a prediction', () => {
  const r = evaluate(MAP, { version: 1, edges: [
    { from: 'web', to: 'billing', kind: 'http', truth: false },
    { from: 'web', to: 'billing', kind: 'http', key: 'GET /invoices/:id', truth: true },
  ] });
  assert.deepEqual({ tp: r.pairs.tp, fp: r.pairs.fp, keysTp: r.keys.tp }, { tp: 0, fp: 1, keysTp: 1 });
  const lost = { version: 1, manual: [], edges: { x_00000000abcd: { state: 'confirmed', from: 'users', to: 'web', kind: 'grpc', display: 'x', at: 't' } } };
  const m = evaluate(MAP, { version: 1, edges: [{ from: 'users', to: 'web', kind: 'grpc', truth: true }] }, { overrides: lost });
  assert.deepEqual({ tp: m.pairs.tp, fn: m.pairs.fn }, { tp: 0, fn: 1 });
});

test('label warnings: another workspace, contradicting truths, a non-member, a self edge — reported, never dropped', () => {
  const r = evaluate(MAP, { version: 1, workspace: 'Other', edges: [
    { from: 'web', to: 'billing', kind: 'http', key: 'GET /invoices/:id', truth: true },
    { from: 'web', to: 'billing', kind: 'http', key: 'http:GET /invoices/{}', truth: false },
    { from: 'web', to: 'ghost-00000000', kind: 'db', truth: true },
    { from: 'web', to: 'web', kind: 'other', key: 'self', truth: true },
  ] });
  assert.deepEqual(r.labelErrors, [
    'workspace: the labels are for "Other", the map is "Shop"',
    'edges[1]: contradicts edges[0] (same key, other truth)',
    'edges[2]: to is not a member of this map: ghost-00000000',
    'edges[3]: from and to are the same member',
  ]);
  assert.equal(r.counts.labels, 4, 'a warning never drops a label');
  assert.equal(r.keys.tp, 1, 'contradicting truths: true wins, as before');
  const bare = evaluate({ ...MAP, members: [] }, { version: 1, workspace: 'Other', edges: [{ from: 'a', to: 'a', kind: 'db', truth: true }] });
  assert.deepEqual(bare.labelErrors, [], 'a map without members warns about nothing');
});

test('formatReport prints no control character from the map, the labels or the workspace name', () => {
  const odd = edge('web', 'users', 'other', 'other:x\u001b[2jy', 'inferred');
  const r = evaluate({ ...MAP, edges: [odd] }, { version: 1, edges: [{ from: 'web', to: 'users', kind: 'other', key: 'other:x\u001b[2jy', truth: false }] });
  const text = formatReport(r, { workspace: 'Sh\u0007op' });
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text), false, 'only the line breaks are control characters');
  assert.match(text, /^ {2}\[key\] web -> users {2}other {2}other:x\?\[2jy {2}\(inferred\)$/m);
  assert.match(text, /^worca workspace map eval — Sh\?op: 1 edges, 1 pairs, 1 labels$/m);
});
