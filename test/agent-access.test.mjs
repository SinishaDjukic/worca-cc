import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readMcpAccess, readSkillAccess, toggleServer, setAllTools, selectTools, toggleTool, keepTools,
  toggleSkill, removeServer, unreviewedTools, stampBaseline, accessSummary, pickAccess,
} from '../src/shared/agent-access.mjs';

const GH = 'plugin:gh/github';

test('readMcpAccess keeps valid entries (registry + native), drops bad ones with a warning', () => {
  const warns = [];
  const out = readMcpAccess([
    { server: GH, tools: 'all', reviewedTools: ['a'], excludedTools: ['b', 'b'], name: 'github' },
    { server: GH, tools: ['x'] },                 // duplicate server
    { server: 'nope', tools: 'all' },             // bad id
    { server: 'native:linear', tools: 'all' },
    { server: 'manual:m', tools: ['t', 7, 't'], excludedTools: ['z'] }, // non-string + repeat dropped; excluded ignored on explicit
  ], (m) => warns.push(m));
  assert.deepEqual(out.map((e) => e.server), [GH, 'native:linear', 'manual:m']);
  assert.deepEqual(out[0].excludedTools, ['b']);
  assert.deepEqual(out[2], { server: 'manual:m', tools: ['t'] });
  assert.equal(warns.length, 2);
});

test('toggleServer adds as All tools with the known tools reviewed, and removes again', () => {
  let a = toggleServer({}, GH, { name: 'github', known: ['a', 'b'] });
  assert.deepEqual(a.mcpAccess, [{ server: GH, name: 'github', tools: 'all', reviewedTools: ['a', 'b'] }]);
  a = toggleServer(a, GH, {});
  assert.equal(a.mcpAccess, undefined);            // empty category is absent, not []
});

test('unticking a tool of an All-tools server keeps All tools and records the exclusion (A-1, A-7)', () => {
  let a = toggleServer({}, GH, { name: 'github', known: ['a', 'b', 'c'] });
  a = toggleTool(a, GH, 'b');
  assert.deepEqual(a.mcpAccess[0], { server: GH, name: 'github', tools: 'all', reviewedTools: ['a', 'b', 'c'], excludedTools: ['b'] });
  a = toggleTool(a, GH, 'b');                      // re-tick
  assert.equal(a.mcpAccess[0].excludedTools, undefined);
  a = toggleTool(a, GH, 'c');
  a = selectTools(a, GH, ['a', 'b', 'c']);         // "Selected tools": now an explicit list
  assert.deepEqual(a.mcpAccess[0], { server: GH, name: 'github', tools: ['a', 'b'] });
  a = setAllTools(a, GH, ['a', 'b', 'c']);
  assert.deepEqual(a.mcpAccess[0], { server: GH, name: 'github', tools: 'all', reviewedTools: ['a', 'b', 'c'] });
});

test('toggleTool on an explicit list adds/removes the tool', () => {
  const a = { mcpAccess: [{ server: GH, tools: ['a'] }] };
  assert.deepEqual(toggleTool(a, GH, 'b').mcpAccess[0].tools, ['a', 'b']);
  assert.deepEqual(toggleTool(a, GH, 'a').mcpAccess[0].tools, []);
});

test('a tool added later is flagged until kept or unticked; no baseline = never flagged', () => {
  const entry = { server: GH, tools: 'all', reviewedTools: ['a'] };
  assert.deepEqual(unreviewedTools(entry, ['a', 'n']), ['n']);
  const kept = keepTools({ mcpAccess: [entry] }, GH, ['n']);
  assert.deepEqual(unreviewedTools(kept.mcpAccess[0], ['a', 'n']), []);
  const unticked = toggleTool({ mcpAccess: [entry] }, GH, 'n');
  assert.deepEqual(unreviewedTools(unticked.mcpAccess[0], ['a', 'n']), []);        // excluded counts as reviewed
  assert.deepEqual(unreviewedTools({ server: GH, tools: ['a'] }, ['a', 'n']), []); // explicit never flags
  assert.deepEqual(unreviewedTools({ server: GH, tools: 'all' }, ['a', 'n']), []); // no baseline yet (m3)
  const stamped = stampBaseline({ mcpAccess: [{ server: GH, tools: 'all' }] }, new Map([[GH, ['a', 'n']]]));
  assert.deepEqual(stamped.mcpAccess[0].reviewedTools, ['a', 'n']);
});

test('skills toggle and summary, incl. mixed modes (m10)', () => {
  let a = toggleSkill({}, 'skill:library:lint', 'lint');
  a = toggleServer(a, GH, { name: 'github', known: ['a'] });
  assert.equal(accessSummary(a), '1 server · all tools · 1 skill');
  a = toggleServer(a, 'manual:docs', { name: 'docs' });
  a = selectTools(a, 'manual:docs', ['x', 'y', 'z']);
  assert.equal(accessSummary(a), '2 servers · all tools + 3 tools · 1 skill');
  a = removeServer(removeServer(a, GH), 'manual:docs');
  assert.equal(accessSummary(a), '1 skill');
  assert.equal(accessSummary({}), '');
  assert.deepEqual(pickAccess({ mcpAccess: [], skillAccess: undefined, x: 1 }), {});
});
