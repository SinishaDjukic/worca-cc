import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/pkg-go.mjs';

const WEB_MOD = `module github.com/acme/web/v2

go 1.22

require github.com/acme/billing v1.4.0

require (
\tgithub.com/gin-gonic/gin v1.10.0
\tgithub.com/acme/shared v0.0.0-00010101000000-000000000000
\tgolang.org/x/net v0.25.0 // indirect
\t"github.com/acme/quoted" v1.0.0
)

replace github.com/acme/shared => ../shared

replace (
\tgithub.com/acme/tools v1.0.0 => ../tools
\tgithub.com/acme/remote => github.com/fork/remote v1.1.0
)
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    web: { 'go.mod': WEB_MOD, 'testdata/mod/go.mod': 'module example.com/fixture\n' },
    shared: { 'go.mod': '\uFEFFmodule github.com/acme/shared\r\n\r\ngo 1.22\r\n' },
    tools: { 'go.mod': 'module github.com/acme/tools\n' },
    broken: { 'go.mod': 'module\nrequire (\n\tnot a line\n' },
    fixtureonly: { 'testdata/mod/go.mod': 'module example.com/fixture-mod\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('pkg-go: provides the module path; alias drops the /vN suffix', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['go:example.com/fixture', 'go:github.com/acme/web/v2']);
  assert.deepEqual(r.aliases.map((a) => a.value).sort(), ['web'], 'a testdata module never aliases the member');
  assert.deepEqual(r.stack, ['go']);
  assertEvidence(member('web'), r);
});

test('pkg-go: consumes direct requires (single + block, quoted), skips // indirect', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), [
    'go:github.com/acme/billing', 'go:github.com/acme/quoted', 'go:github.com/acme/shared', 'go:github.com/acme/tools', 'go:github.com/gin-gonic/gin',
  ]);
});

test('pkg-go: replace => ../dir targets the member owning that dir (block and single form)', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const shared = r.facts.find((f) => f.key === 'go:github.com/acme/shared');
  assert.equal(shared.target, 'shared');
  assert.equal(shared.line, 9, 'the require line is the evidence');
  assert.equal(shared.detail, 'replace => ../shared');
  const tools = r.facts.find((f) => f.key === 'go:github.com/acme/tools');
  assert.deepEqual([tools.target, tools.line], ['tools', 17]);
  assert.equal(r.facts.find((f) => f.key === 'go:github.com/acme/billing').target, undefined);
  assert.ok(!r.facts.some((f) => f.key.includes('fork')));
});

test('pkg-go: testdata modules are facts marked test; a CRLF go.mod with a BOM parses', async () => {
  const web = await runDetector(detector, member('web'), ws.members);
  assert.equal(web.facts.find((f) => f.key === 'go:example.com/fixture').test, true);
  const shared = await runDetector(detector, member('shared'), ws.members);
  assert.deepEqual(keysOf(shared, 'pkg', 'provides'), ['go:github.com/acme/shared']);
  assertEvidence(member('shared'), shared);
  const only = await runDetector(detector, member('fixtureonly'), ws.members);
  assert.deepEqual([only.stack, only.aliases, keysOf(only, 'pkg', 'provides')], [[], [], ['go:example.com/fixture-mod']], 'a testdata module sets no stack and no alias');
});

test('pkg-go: a malformed go.mod never throws and yields no bogus facts', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.deepEqual(r.facts, []);
});
