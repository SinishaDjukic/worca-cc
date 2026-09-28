// test/ask-web-access.test.mjs
// One Ask turn's web access (docs/guardrails.md "Web access"): local settings ⊕ the pinned project's team policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askWebAccess } from '../src/core/ask/web-access.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';

const local = (o) => () => ({ enabled: false, anyHost: false, allowedDomains: [], search: null, ...o });
const policy = (fields) => () => ({ doc: normalizePolicyDoc({ schema: 1, fields }).doc });

test('off by default', () => {
  assert.deepEqual(askWebAccess({ readLocal: local({}) }), { enabled: false, allowedDomains: [], search: null });
});

test('enabled with an empty list is on: every host goes through an approval card', () => {
  assert.deepEqual(askWebAccess({ readLocal: local({ enabled: true }) }), { enabled: true, allowedDomains: [], search: null, teamCap: null });
});

test('hosts the user allowed for this chat join the list; the team cap still binds them', () => {
  const on = local({ enabled: true, allowedDomains: ['a.com'] });
  assert.deepEqual(askWebAccess({ readLocal: on, chatHosts: ['docs.b.org'] }).allowedDomains, ['a.com', 'docs.b.org']);
  const capped = askWebAccess({ projectKey: 'p', readLocal: on, chatHosts: ['docs.b.org', 'x.team.com'],
    policyFor: policy({ 'ask.webAllowedDomains': { kind: 'soft', value: ['*.team.com', 'a.com'] } }) });
  assert.deepEqual(capped.allowedDomains, ['a.com', 'x.team.com']);
  assert.deepEqual(capped.teamCap, ['*.team.com', 'a.com']);
});

test('anyHost reads as ["*"], and a team cap narrows it to the team list', () => {
  const any = local({ enabled: true, anyHost: true, allowedDomains: ['a.com'] });
  assert.deepEqual(askWebAccess({ readLocal: any }).allowedDomains, ['*']);
  assert.deepEqual(askWebAccess({ projectKey: 'p', readLocal: any, policyFor: policy({ 'ask.webAllowedDomains': { kind: 'soft', value: ['*.team.com'] } }) }).allowedDomains, ['*.team.com']);
  assert.equal(askWebAccess({ projectKey: 'p', readLocal: any, policyFor: policy({ 'ask.webEnabled': { kind: 'soft', value: false } }) }).enabled, false);
});

test('team soft false disables for the pinned project; unpinned is untouched', () => {
  const on = local({ enabled: true, allowedDomains: ['a.com'] });
  const pol = policy({ 'ask.webEnabled': { kind: 'soft', value: false } });
  assert.equal(askWebAccess({ projectKey: 'p', readLocal: on, policyFor: pol }).enabled, false);
  assert.equal(askWebAccess({ projectKey: null, readLocal: on, policyFor: pol }).enabled, true);
});

test('a team policy can never switch web access on or add a host (opt-in stays the developer\'s)', () => {
  const r = askWebAccess({ projectKey: 'p', readLocal: local({}),
    policyFor: policy({ 'ask.webEnabled': { kind: 'default', value: true }, 'ask.webAllowedDomains': { kind: 'default', value: ['team.example.com'] } }) });
  assert.deepEqual(r, { enabled: false, allowedDomains: [], search: null });
});

test('the team allowlist caps the developer\'s list; nothing outside it survives', () => {
  const r = askWebAccess({ projectKey: 'p', readLocal: local({ enabled: true, allowedDomains: ['docs.team.com', 'me.com'] }),
    policyFor: policy({ 'ask.webAllowedDomains': { kind: 'soft', value: ['*.team.com'] } }) });
  assert.deepEqual(r.allowedDomains, ['docs.team.com']);
  const none = askWebAccess({ projectKey: 'p', readLocal: local({ enabled: true, allowedDomains: ['me.com'] }),
    policyFor: policy({ 'ask.webAllowedDomains': { kind: 'soft', value: ['*.team.com'] } }) });
  assert.deepEqual(none.allowedDomains, [], 'nothing of yours survives the cap: every host needs a card, and cards outside the cap are refused');
});
