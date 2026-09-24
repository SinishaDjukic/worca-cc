// test/identity.test.mjs
// src/core/identity.mjs: who started this. The verified token, then a NAMED trusted
// header, then the operator's name, then 'local'. Nothing is ever guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, startedByOf, prAttributionFooter } from '../src/core/identity.mjs';

const req = ({ user, headers = {} } = {}) => ({ worcaUser: user, headers });

test('a verified Access identity wins over everything', () => {
  const r = req({ user: { email: 'ada@example.com', sub: 'u1' }, headers: { 'x-forwarded-email': 'mallory@example.com' } });
  assert.deepEqual(resolveIdentity(r, { WORCA_IDENTITY_HEADER: 'X-Forwarded-Email', WORCA_IDENTITY_NAME: 'Op' }), { name: 'ada@example.com', source: 'access' });
});

test('a header is read only when named; unset = ignored even if sent', () => {
  const r = req({ headers: { 'x-forwarded-email': 'grace@example.com' } });
  assert.deepEqual(resolveIdentity(r, {}), { name: 'local', source: 'local' });
  assert.deepEqual(resolveIdentity(r, { WORCA_IDENTITY_HEADER: 'X-Forwarded-Email' }), { name: 'grace@example.com', source: 'header' });
  assert.deepEqual(resolveIdentity(r, { WORCA_IDENTITY_HEADER: 'bad header!' }), { name: 'local', source: 'local' }, 'an invalid header name is not a header');
});

test('the operator name when nothing verified applies; in-container callers too', () => {
  assert.deepEqual(resolveIdentity(req(), { WORCA_IDENTITY_NAME: ' Ada Lovelace ' }), { name: 'Ada Lovelace', source: 'operator' });
  assert.deepEqual(resolveIdentity(req({ user: { local: true } }), { WORCA_IDENTITY_NAME: 'Ada' }), { name: 'Ada', source: 'operator' });
  assert.equal(startedByOf(req(), {}), 'local');
});

test('values that could break a line or markup are refused, not cleaned up', () => {
  for (const bad of ['a\nb', 'x<script>', '', ' ', 'a\u2028b', 'x'.repeat(201)]) {
    assert.deepEqual(resolveIdentity(req({ headers: { 'x-user': bad } }), { WORCA_IDENTITY_HEADER: 'X-User' }).source, 'local', JSON.stringify(bad));
  }
  assert.equal(resolveIdentity(req({ headers: { 'x-user': ['one@example.com', 'two@example.com'] } }), { WORCA_IDENTITY_HEADER: 'X-User' }).name, 'one@example.com');
});

test('the PR footer names the person, and nobody for local or unknown', () => {
  assert.equal(prAttributionFooter('ada@example.com'), '\n\n---\nStarted by ada@example.com via worca');
  for (const none of ['local', null, undefined, '', 'a\nb']) assert.equal(prAttributionFooter(none), '');
});

test('actorOf, isSharedIdentity and chatActor', async () => {
  const { actorOf, isSharedIdentity, chatActor } = await import('../src/core/identity.mjs');
  assert.equal(actorOf(req({ user: { email: 'ada@example.com' } }), {}), 'ada@example.com');
  assert.equal(actorOf(req(), {}), 'local');
  assert.equal(isSharedIdentity('access'), true);
  assert.equal(isSharedIdentity('header'), true);
  assert.equal(isSharedIdentity('operator'), false);
  assert.equal(isSharedIdentity('local'), false);
  assert.equal(chatActor({ platform: 'slack', userName: 'ada' }), 'ada via Slack');
  assert.equal(chatActor({ platform: 'telegram', userId: 12345 }), '12345 via Telegram');
  assert.equal(chatActor({ platform: 'discord', userName: 'x\ny' }), 'someone via Discord');
  assert.equal(chatActor({}), 'someone via chat');
});

test('actorLabel / byActor: the name an audit line shows, nothing for local or junk', async () => {
  const { actorLabel, byActor } = await import('../src/core/identity.mjs');
  assert.equal(actorLabel('ada@example.com'), 'ada@example.com');
  assert.equal(byActor('ada via Slack'), ' by ada via Slack');
  for (const none of ['local', null, undefined, '', 'a\nb', 42]) {
    assert.equal(actorLabel(none), '');
    assert.equal(byActor(none), '');
  }
});
