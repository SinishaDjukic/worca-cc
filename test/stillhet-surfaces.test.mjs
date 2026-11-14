// test/stillhet-surfaces.test.mjs — every Settings key and every path today's UI fetches has a `## Dev surfaces` row in
// plans/rail/stillhet-wiring.md, or sits in the frozen baseline (test/fixtures/stillhet-surfaces-baseline.json), which only
// shrinks (tools/stillhet-surfaces.mjs, gate.prototype in docs/rail/gate.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../tools/stillhet-surfaces.mjs';

const head = '# w\n\n## Figure rows\n\n## Dev surfaces\n\n| Surface | Status | Where in Stillhet, or why not yet |\n|---|---|---|\n';
const doc = (...rows) => head + rows.join('\n') + '\n\n## Opt-in\n';

test('isTodaysUi: ui/public outside stillhet/ and design-system/', () => {
  for (const f of ['ui/public/app.js', 'ui/public/chat/x.mjs']) assert.equal(S.isTodaysUi(f), true, f);
  for (const f of ['ui/public/stillhet/shell/shell.js', 'ui/public/design-system/components/index.mjs', 'ui/routes/x.mjs', 'src/x.mjs']) assert.equal(S.isTodaysUi(f), false, f);
});

test('callPathsOf: templates, query strings, ${qs} suffixes, fragments and concatenations normalize to one call path', () => {
  const cases = [
    ['fetch(`/api/runs/${encodeURIComponent(id)}/artifacts?x=${y}`)', ['/api/runs/:param/artifacts']],
    ['get(`/api/config${qs}`)', ['/api/config']],
    ["fetch('/api/history/' + k)", ['/api/history']],
    ['fetch(`/api/list?${q ? `a=${b}&c=${`d${e}`}` : \'\'}`)', ['/api/list']],
    ['fetch(`/api/runs/${id}`)', ['/api/runs/:param']],
    ['fetch("/api/x/#frag")', ['/api/x']],
    ["fetch('/api/x/' + id + '/y')", ['/api/x']],
    ["fetch('/apix')", []],
    ["a('/api/a'); b(\"/api/b\"); c('/api/a')", ['/api/a', '/api/b', '/api/a']],
  ];
  for (const [src, want] of cases) assert.deepEqual(S.callPathsOf(src), want, src);
});

test('pathMatches: equal segment count, each segment equal or a :name on either side', () => {
  assert.equal(S.pathMatches('/api/runs/:param/pause', '/api/runs/:id/pause'), true);
  assert.equal(S.pathMatches('/api/foo', '/api/foo'), true);
  assert.equal(S.pathMatches('/api/runs/:param', '/api/runs/:id/pause'), false);
  assert.equal(S.pathMatches('/api/runs/:param/stop', '/api/runs/:id/pause'), false);
});

test('compare: grew, shrank and bad rows', () => {
  const ids = ['route › /api/a', 'route › /api/b', 'setting › keepAwake'];
  const base = ['route › /api/b', 'setting › keepAwake'];
  assert.deepEqual(S.compare(ids, doc(), base), { grew: ['route › /api/a'], shrank: [], badStatus: [] });
  assert.deepEqual(S.compare(ids, doc('| `route › /api/a` | wire to | not built yet |'), base), { grew: [], shrank: [], badStatus: [] });
  const bad = ['| `route › /api/a` | maybe | x |', '| `route › /api/b` | not offered live |  |', '| `route › /api/a` | wired | twice |'];
  assert.deepEqual(S.compare(ids, doc(...bad), base).badStatus, bad);
  assert.deepEqual(S.compare(ids, doc('| `route › /api/a` | wired | y |', '| `setting › keepAwake` | wired | the profile menu |'), base),
    { grew: [], shrank: ['setting › keepAwake'], badStatus: [] });
  assert.deepEqual(S.compare([...ids, 'setting › brandNew'], doc('| `route › /api/a` | wired | y |'), base).grew, ['setting › brandNew']);
});

test('nextBaseline refuses any added id, even one swapped for another at an equal count; it returns the lower set', () => {
  const base = ['route › /api/a', 'route › /api/b'];
  assert.deepEqual(S.nextBaseline(['route › /api/a', 'route › /api/c'], doc(), base), { ok: false, added: ['route › /api/c'] });
  assert.deepEqual(S.nextBaseline(['route › /api/a', 'route › /api/b'], doc('| `route › /api/a` | wire to | later |'), base), { ok: true, next: ['route › /api/b'] });
});

// A temp root with one Settings key, one today's-UI fetch, one Stillhet fetch (not gated) and a wiring file.
function tempRoot(wiring) {
  const root = mkdtempSync(join(tmpdir(), 'stillhet-surfaces-'));
  for (const d of ['test/fixtures', 'plans/rail', 'ui/public/chat', 'ui/public/stillhet']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'test/fixtures/settings-api-keys.json'), JSON.stringify(['brandNew', 'keepAwake']));
  writeFileSync(join(root, 'ui/public/chat/a.mjs'), "fetch('/api/chat/' + id)");
  writeFileSync(join(root, 'ui/public/stillhet/s.js'), "fetch('/api/stillhet-only')");
  writeFileSync(join(root, 'plans/rail/stillhet-wiring.md'), wiring);
  return root;
}
const capture = () => { const lines = []; return { lines, out: { log: (s) => lines.push(String(s)) } }; };

test('surfaceIds: the fixture keys and today\'s UI fetches, not Stillhet\'s', () => {
  const root = tempRoot(doc());
  try {
    assert.deepEqual(S.surfaceIds(root), ['route › /api/chat', 'setting › brandNew', 'setting › keepAwake']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('main: a new id prints GREW and how to fix it (exit 1); a covered baseline id prints shrank (exit 0)', () => {
  const root = tempRoot(doc('| `setting › keepAwake` | wired | the profile menu |'));
  const baseline = join(root, 'baseline.json');
  try {
    writeFileSync(baseline, JSON.stringify(['route › /api/chat', 'setting › keepAwake']));
    let c = capture();
    assert.equal(S.main([], { root, baseline, out: c.out }), 1);
    assert.ok(c.lines.includes('GREW setting › brandNew'), c.lines.join('\n'));
    assert.match(c.lines.join('\n'), /add a row under ## Dev surfaces/);
    writeFileSync(baseline, JSON.stringify(['route › /api/chat', 'setting › brandNew', 'setting › keepAwake']));
    c = capture();
    assert.equal(S.main([], { root, baseline, out: c.out }), 0);
    assert.ok(c.lines.includes('shrank setting › keepAwake'), c.lines.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('main --update: refuses a grown set and writes nothing; seeds an absent file; lowers a shrunk one', () => {
  const root = tempRoot(doc('| `setting › keepAwake` | wired | the profile menu |'));
  const baseline = join(root, 'baseline.json');
  try {
    const before = '["route › /api/chat"]\n';
    writeFileSync(baseline, before);
    let c = capture();
    assert.equal(S.main(['--update'], { root, baseline, out: c.out }), 1);
    assert.match(c.lines.join('\n'), /^Refused: the baseline only shrinks/m);
    assert.ok(c.lines.some((l) => l.includes('setting › brandNew')));
    assert.equal(readFileSync(baseline, 'utf8'), before, 'byte-identical');
    rmSync(baseline);
    assert.equal(S.main(['--update'], { root, baseline, out: capture().out }), 0);
    assert.equal(readFileSync(baseline, 'utf8'), JSON.stringify(['route › /api/chat', 'setting › brandNew'], null, 2) + '\n');
    writeFileSync(join(root, 'plans/rail/stillhet-wiring.md'), doc('| `setting › keepAwake` | wired | x |', '| `setting › brandNew` | wire to | later |'));
    assert.equal(S.main(['--update'], { root, baseline, out: capture().out }), 0);
    assert.deepEqual(JSON.parse(readFileSync(baseline, 'utf8')), ['route › /api/chat']);
    c = capture();
    assert.equal(S.main(['--list'], { root, baseline, out: c.out }), 0);
    assert.deepEqual(c.lines, ['route › /api/chat', 'setting › brandNew', 'setting › keepAwake']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the baseline is a sorted, duplicate-free array of setting and route ids', () => {
  assert.ok(existsSync(S.BASELINE), 'seed it with node tools/stillhet-surfaces.mjs --update');
  const b = JSON.parse(readFileSync(S.BASELINE, 'utf8'));
  assert.ok(Array.isArray(b) && b.length > 0);
  assert.deepEqual(b, [...new Set(b)].sort());
  for (const id of b) assert.match(id, /^(setting|route) › /);
});

test('the real tree: every Settings key and today\'s-UI fetch has a row or is in the baseline, and the baseline is current', () => {
  const wiring = readFileSync(join(S.ROOT, 'plans/rail/stillhet-wiring.md'), 'utf8');
  assert.ok(wiring.includes('\n## Dev surfaces\n'));
  assert.deepEqual(S.compare(S.surfaceIds(), wiring, JSON.parse(readFileSync(S.BASELINE, 'utf8'))), { grew: [], shrank: [], badStatus: [] });
});
