// test/workspace-scan-mock.test.mjs
// The offline writers of the Workspace scan's three agents (wsmap spec D20): each reads the reference
// file its brief names on the pinned first-lines marker and writes a VALID document — P1's checkers
// agree — so a mock run exercises every script and the finalize end to end. A missing brief, a
// missing reference or garbage JSON degrades to an empty valid document; nothing throws.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { briefMarker, writeMockSurvey, writeMockUsage, writeMockSynthesis } from '../src/core/workspace-scan-mock.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { checkSurvey, checkUsage, checkSynthesis } from '../src/shared/workspace-map/schema.mjs';

const scratch = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-wsmock-')); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
/** A brief with P1's exact first three lines. */
function brief(dir, title, marker, ref) {
  const p = join(dir, `${marker}-brief.md`);
  writeFileSync(p, `# ${title}\n<!-- worca:${marker}=${ref} -->\n<!-- worca:check="node" "check-cli.mjs" x "<OUT>" --r "${ref}" -->\n\n- body\n`);
  return p;
}
const ENTRY = 'e_0123456789';
function catalogFixture(dir) {
  const p = join(dir, 'catalog.json');
  writeFileSync(p, JSON.stringify({
    version: 1,
    members: { web: { key: 'web', name: 'Web' }, api: { key: 'api', name: 'API' } },
    entries: [{ id: ENTRY, member: 'api', kind: 'http', norm: 'http:GET /invoices/{}', display: 'GET /invoices/{id}', terms: ['/invoices'], evidence: [], sources: ['static'] }],
    candidates: { web: [{ entry: ENTRY, file: 'src/pay.js', line: 12, match: "fetch('/invoices/' + id)", via: 'path' }, { entry: ENTRY, file: 7 }] },
  }));
  return p;
}
function mapFixture(dir) {
  const p = join(dir, 'workspace-map.json');
  writeFileSync(p, JSON.stringify({ version: 1, members: [{ key: 'api', name: 'API', role: 'Invoices API' }, { key: 'web', name: 'Web', role: null }, { key: 'lib', name: 'Lib', role: '  ' }], edges: [] }));
  return p;
}

test('briefMarker reads a first-lines marker, LF or CRLF; null when absent', () => {
  assert.equal(briefMarker('# T\n<!-- worca:extract=/a/extract.json -->\n', 'extract'), '/a/extract.json');
  assert.equal(briefMarker('# T\r\n<!-- worca:map=C:\\r\\workspace-map.json -->\r\n', 'map'), 'C:\\r\\workspace-map.json');
  assert.equal(briefMarker('# T\n', 'catalog'), null);
  assert.equal(briefMarker(undefined, 'catalog'), null);
});

test('survey: members with needs are investigated with a mock role, the rest skipped — a valid survey.json', async () => {
  const dir = tmp();
  const extractPath = join(dir, 'extract.json');
  // BOM-prefixed on purpose: the writers' reader tolerates an editor's leading byte-order mark.
  writeFileSync(extractPath, String.fromCharCode(0xFEFF) + JSON.stringify({ version: 1, workspace: { name: 'Shop' }, createdAt: '2026-09-25T00:00:00.000Z', members: {
    web: { key: 'web', name: 'Web', needs: ['provides', 'consumes'] },
    api: { key: 'api', name: 'API', needs: [] },
  } }));
  const out = join(dir, 'survey.json');
  const r = await writeMockSurvey({ briefPath: brief(dir, 'Workspace survey brief', 'extract', extractPath), outPath: out });
  assert.deepEqual([r.investigated, r.skipped], [1, 1]);
  const doc = read(out);
  assert.deepEqual(doc, { version: 1, members: {
    api: { status: 'skipped', role: '', aliases: [], provides: [], consumes: [], notes: '' },
    web: { status: 'investigated', role: 'Mock role for web', aliases: [], provides: [], consumes: [], notes: '' },
  } });
  const checked = checkSurvey(doc, { memberKeys: ['api', 'web'] });
  assert.equal(checked.ok, true, checked.errors.join('\n'));
});

test('usage: every member investigated, every well-formed candidate confirmed — a valid usage.json', async () => {
  const dir = tmp();
  const out = join(dir, 'usage.json');
  const r = await writeMockUsage({ briefPath: brief(dir, 'Workspace usage brief', 'catalog', catalogFixture(dir)), outPath: out });
  assert.equal(r.uses, 1, 'a malformed candidate is never echoed');
  const doc = read(out);
  assert.deepEqual(doc, { version: 1, members: {
    api: { status: 'investigated', uses: [], rejected: [], other: [] },
    web: { status: 'investigated', uses: [{ entry: ENTRY, file: 'src/pay.js', line: 12, match: "fetch('/invoices/' + id)" }], rejected: [], other: [] },
  } });
  const checked = checkUsage(doc, { memberKeys: ['api', 'web'], entryIds: [ENTRY] });
  assert.equal(checked.ok, true, checked.errors.join('\n'));
});

test('synthesis: the mock overview and roles only for members without one — a valid synthesis.json', async () => {
  const dir = tmp();
  const out = join(dir, 'synthesis.json');
  await writeMockSynthesis({ briefPath: brief(dir, 'Workspace synthesis brief', 'map', mapFixture(dir)), outPath: out });
  const doc = read(out);
  assert.deepEqual(doc, { version: 1, overview: 'Mock overview of 3 projects.', roles: { web: 'Mock role for web', lib: 'Mock role for lib' }, coordination: [], orderNotes: '' });
  const checked = checkSynthesis(doc, { memberKeys: ['api', 'lib', 'web'] });
  assert.equal(checked.ok, true, checked.errors.join('\n'));
});

test('no brief, a garbage reference, no brief path at all: each writer still writes an empty valid document', async () => {
  const dir = tmp();
  const garbage = join(dir, 'garbage.json');
  writeFileSync(garbage, '{ nope');
  await writeMockSurvey({ briefPath: join(dir, 'missing.md'), outPath: join(dir, 's.json') });
  assert.deepEqual(read(join(dir, 's.json')), { version: 1, members: {} });
  await writeMockUsage({ briefPath: brief(dir, 'Workspace usage brief', 'catalog', garbage), outPath: join(dir, 'u.json') });
  assert.deepEqual(read(join(dir, 'u.json')), { version: 1, members: {} });
  await writeMockSynthesis({ briefPath: undefined, outPath: join(dir, 'y.json') });
  assert.deepEqual(read(join(dir, 'y.json')), { version: 1, overview: 'Mock overview of 0 projects.', roles: {}, coordination: [], orderNotes: '' });
});

// runClaude emits the normalized vocabulary: an Agent tool_use arrives as a sub-agent spawn.
const spawnedAgent = (events) => events.some((e) => e.type === 'subagent' && e.event === 'spawn' && e.name === 'Agent');

test('runMock serves workspace-usage (a fan-out role) and workspace-synth (not one) off MOCK_IN / MOCK_OUT', async () => {
  const dir = tmp();
  const usageOut = join(dir, 'usage.json');
  const ev1 = [];
  const r1 = await runClaude({ cwd: dir, mock: true, onEvent: (e) => ev1.push(e),
    prompt: `MOCK_ROLE: workspace-usage\nMOCK_OUT: ${usageOut}\nMOCK_IN: ${brief(dir, 'Workspace usage brief', 'catalog', catalogFixture(dir))}` });
  assert.equal(r1.exitCode, 0);
  assert.match(r1.text, /workspace usage written/);
  assert.equal(read(usageOut).members.web.uses.length, 1);
  assert.ok(spawnedAgent(ev1), 'the usage stage fans out, so its mock emits sub-agent events');
  const synthOut = join(dir, 'synthesis.json');
  const ev2 = [];
  const r2 = await runClaude({ cwd: dir, mock: true, onEvent: (e) => ev2.push(e),
    prompt: `MOCK_ROLE: workspace-synth\nMOCK_OUT: ${synthOut}\nMOCK_IN: ${brief(dir, 'Workspace synthesis brief', 'map', mapFixture(dir))}` });
  assert.equal(r2.exitCode, 0);
  assert.equal(read(synthOut).overview, 'Mock overview of 3 projects.');
  assert.equal(spawnedAgent(ev2), false, 'the synthesizer never fans out');
});
