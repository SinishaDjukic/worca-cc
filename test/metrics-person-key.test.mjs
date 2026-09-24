// test/metrics-person-key.test.mjs
// Host-neutral identity for the Timeline's People grouping: personKey (a hash of the git email,
// the same formula the PR-events Action uses), the optional actorKey on a run record, and
// groupByPerson joining one person across runs and pull requests made outside Worca.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildRunRecord, personKey, RECORD_FIELDS } from '../src/core/metrics/record.mjs';
import { groupByPerson } from '../src/shared/team-metrics/timeline.mjs';
import { NOW, projectDone } from './fixtures/team-metrics/snapshots.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('personKey: sha256("worca:" + lower email), 16 hex; machines and junk get none', () => {
  const expect = createHash('sha256').update('worca:sini@example.com').digest('hex').slice(0, 16);
  assert.equal(personKey('Sini@Example.com '), expect);
  assert.match(personKey('a@b.c'), /^[0-9a-f]{16}$/);
  assert.equal(personKey('orchestrator@local'), null, "Worca's own run commits");
  assert.equal(personKey('worca@local'), null, 'the metrics fallback identity');
  assert.equal(personKey(''), null);
  assert.equal(personKey(null), null);
  assert.equal(personKey('not-an-email'), null);
});

test('a run record carries actorKey after actor, and never under attribution "none"', () => {
  const key = personKey('sini@example.com');
  const rec = buildRunRecord({ ...projectDone, actorKey: key }, { attribution: 'git-user', now: new Date(NOW) });
  assert.equal(rec.actorKey, key);
  const keys = Object.keys(rec);
  assert.equal(keys[keys.indexOf('actor') + 1], 'actorKey');
  assert.equal(buildRunRecord({ ...projectDone, actorKey: key }, { attribution: 'none', now: new Date(NOW) }).actorKey, undefined);
  assert.equal(buildRunRecord({ ...projectDone, actorKey: 'NOT-A-KEY' }, { now: new Date(NOW) }).actorKey, undefined);
  assert.deepEqual(Object.keys(buildRunRecord(projectDone, { now: new Date(NOW) })), RECORD_FIELDS, 'no key: the record is unchanged');
});

test('groupByPerson: one person across runs and PRs, by key, name or login; the git name wins', () => {
  const K = personKey('sini@example.com');
  const items = [
    { key: 'run-new', actor: 'Siniša Đukić', actorKey: K, login: null },         // a run with a key
    { key: 'run-old', actor: 'Siniša Đukić', actorKey: null, login: null },      // an old run: joins by name
    { key: 'pr-1', actor: 'Siniša Đukić', actorKey: K, login: 'SinishaDjukic' },  // PR: git author + login
    { key: 'pr-2', actor: 'SinishaDjukic', actorKey: null, login: 'SinishaDjukic' }, // PR without commit author: joins by login
    { key: 'pr-3', actor: 'Denislav Prinov', actorKey: personKey('d@example.com'), login: 'dprinov' },
    { key: 'pr-4', actor: null, actorKey: null, login: null },                   // attribution none
  ];
  const groups = groupByPerson(items);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.key)]), [
    ['Denislav Prinov', ['pr-3']],
    ['Siniša Đukić', ['run-new', 'run-old', 'pr-1', 'pr-2']],
    ['Unattributed', ['pr-4']],
  ]);
  // The key-carrying item may be off screen: `known` still resolves the alias.
  const shown = groupByPerson([items[1]], { known: items });
  assert.equal(shown[0].key, K);
});
