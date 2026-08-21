// test/source-bindings.test.mjs — which profile of a plugin task source a
// project/workspace pulls from, and the fallbacks that keep the common case
// invisible (single profile, workspace inheriting from unanimous members).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  getBinding, setBinding, clearBinding, listBindingsForScope,
  clearBindingsForProfile, clearBindingsForPlugin, resolveProfile,
} from '../src/core/source-bindings.mjs';

useTempHome(after);

const SRC = { plugin: 'jira-source', sourceId: 'jira' };
const proj = (key) => ({ scopeType: 'project', scopeKey: key, ...SRC });

test('a binding is per (scope, plugin, source) and survives re-binding', () => {
  assert.equal(getBinding(proj('proj-a')), null, 'unbound reads as null');
  setBinding(proj('proj-a'), 'work');
  setBinding(proj('proj-b'), 'client');
  assert.equal(getBinding(proj('proj-a')), 'work');
  assert.equal(getBinding(proj('proj-b')), 'client');

  setBinding(proj('proj-a'), 'client'); // re-bind, not a second row
  assert.equal(getBinding(proj('proj-a')), 'client');
  assert.deepEqual(listBindingsForScope('project', 'proj-a'),
    [{ plugin: 'jira-source', sourceId: 'jira', profile: 'client' }]);

  // A second source on the same project binds independently.
  setBinding({ scopeType: 'project', scopeKey: 'proj-a', plugin: 'gh-source', sourceId: 'issues' }, 'oss');
  assert.equal(getBinding(proj('proj-a')), 'client', 'untouched by the other source');
  assert.equal(listBindingsForScope('project', 'proj-a').length, 2);

  clearBinding(proj('proj-a'));
  assert.equal(getBinding(proj('proj-a')), null);
  clearBinding(proj('proj-a')); // idempotent
});

test('resolveProfile prefers an explicit binding, then falls back to the only profile', () => {
  setBinding(proj('r-1'), 'work');
  assert.deepEqual(resolveProfile({ ...proj('r-1'), available: ['work', 'client'] }),
    { profile: 'work', via: 'binding' });

  // No binding, one profile -> no ceremony.
  assert.deepEqual(resolveProfile({ ...proj('r-2'), available: ['only-one'] }),
    { profile: 'only-one', via: 'only' });

  // No binding, several profiles -> the caller must ask.
  assert.deepEqual(resolveProfile({ ...proj('r-2'), available: ['a', 'b'] }),
    { profile: null, via: 'none' });
});

test('a binding naming a deleted profile degrades to "ask", never to a wrong run', () => {
  setBinding(proj('r-3'), 'retired');
  assert.deepEqual(resolveProfile({ ...proj('r-3'), available: ['work', 'client'] }),
    { profile: null, via: 'none' }, 'stale binding is ignored');
  // ...and with a single surviving profile it lands on that one instead.
  assert.deepEqual(resolveProfile({ ...proj('r-3'), available: ['work'] }),
    { profile: 'work', via: 'only' });
});

test('a workspace inherits from its members only when they agree', () => {
  const ws = { scopeType: 'workspace', scopeKey: 'wks-1', ...SRC };
  setBinding(proj('m-1'), 'work');
  setBinding(proj('m-2'), 'work');
  assert.deepEqual(
    resolveProfile({ ...ws, memberKeys: ['m-1', 'm-2'], available: ['work', 'client'] }),
    { profile: 'work', via: 'members' },
  );

  // Members split across two trackers is a real ambiguity — guessing one is the
  // silent-wrong-tracker bug this module exists to prevent.
  setBinding(proj('m-2'), 'client');
  assert.deepEqual(
    resolveProfile({ ...ws, memberKeys: ['m-1', 'm-2'], available: ['work', 'client'] }),
    { profile: null, via: 'conflict', candidates: ['work', 'client'] },
  );

  // The workspace's own binding overrides the members either way.
  setBinding(ws, 'client');
  assert.deepEqual(
    resolveProfile({ ...ws, memberKeys: ['m-1', 'm-2'], available: ['work', 'client'] }),
    { profile: 'client', via: 'binding' },
  );
});

test('deleting a profile or a plugin clears the bindings that named it', () => {
  setBinding(proj('d-1'), 'doomed');
  setBinding(proj('d-2'), 'survivor');
  // Every scope bound to the deleted profile is cleared, across all projects —
  // and across the plugin's sources: the profile's buckets are per-plugin, so a
  // sibling source's binding to it would dangle just the same.
  setBinding(proj('d-3'), 'doomed');
  setBinding({ scopeType: 'project', scopeKey: 'd-4', plugin: 'jira-source', sourceId: 'other' }, 'doomed');
  assert.equal(clearBindingsForProfile('jira-source', 'doomed'), 3);
  assert.equal(getBinding(proj('d-1')), null);
  assert.equal(getBinding(proj('d-3')), null);
  assert.equal(getBinding(proj('d-2')), 'survivor', 'other profiles untouched');

  clearBindingsForPlugin('jira-source');
  assert.equal(getBinding(proj('d-2')), null);
});

test('an invalid scope is a programming error, not a silent no-op', () => {
  assert.throws(() => getBinding({ scopeType: 'galaxy', scopeKey: 'x', ...SRC }), /invalid binding scope/);
});
