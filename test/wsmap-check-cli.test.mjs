// test/wsmap-check-cli.test.mjs — the agents' self-check CLI (wsmap P1, spec D19).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkerCommand, main } from '../src/core/workspace-map/check-cli.mjs';

const CLI = fileURLToPath(new URL('../src/core/workspace-map/check-cli.mjs', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-'));
after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
const put = async (name, doc) => { const p = join(dir, name); await writeFile(p, typeof doc === 'string' ? doc : JSON.stringify(doc)); return p; };
const extract = await put('extract.json', { version: 1, members: { web: {}, api: {} } });
const catalog = await put('catalog.json', { version: 1, members: { web: {}, api: {} }, entries: [{ id: 'e_0123456789' }] });
const map = await put('map.json', { version: 1, members: [{ key: 'web' }, { key: 'api' }] });
const run = async (argv) => { const out = []; const code = await main(argv, { print: (l) => out.push(l) }); return { code, out }; };

test('checkerCommand: quoted node + this file + kind + literal <OUT> + ref flag', () => {
  assert.equal(checkerCommand('survey', { ref: '/p/extract.json' }), `"${process.execPath}" "${CLI}" survey "<OUT>" --extract "/p/extract.json"`);
  assert.match(checkerCommand('usage', { ref: '/p/c.json' }), / usage "<OUT>" --catalog "\/p\/c\.json"$/);
  assert.match(checkerCommand('synthesis', { ref: '/p/m.json' }), / synthesis "<OUT>" --map "\/p\/m\.json"$/);
  assert.throws(() => checkerCommand('nope', { ref: 'x' }), TypeError);
  for (const kind of ['constructor', 'toString', '__proto__']) assert.throws(() => checkerCommand(kind, { ref: 'x' }), TypeError, kind);
});

test('valid documents → exit 0 and OK', async () => {
  const survey = await put('survey.json', { version: 1, members: { web: { status: 'skipped' }, api: { status: 'investigated', role: 'API' } } });
  assert.deepEqual(await run(['survey', survey, '--extract', extract]), { code: 0, out: ['OK'] });
  const usage = await put('usage.json', { version: 1, members: { web: { status: 'investigated', uses: [{ entry: 'e_0123456789', file: 'a.ts', line: 1, match: 'x' }] } } });
  assert.deepEqual(await run(['usage', usage, '--catalog', catalog]), { code: 0, out: ['OK'] });
  const synth = await put('synthesis.json', { version: 1, overview: 'Two.', roles: { api: 'API' } });
  assert.deepEqual(await run(['synthesis', synth, '--map', map]), { code: 0, out: ['OK'] });
});

test('invalid documents → exit 1 with one path-addressed line per error, at most 50', async () => {
  const usage = await put('bad-usage.json', { version: 1, members: { web: { status: 'investigated', uses: [{ entry: 'e_nope', file: '../x', line: 1, match: 'x' }] }, ghost: { status: 'failed' } } });
  const r = await run(['usage', usage, '--catalog', catalog]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.out, ['members.web.uses[0]: unknown entry e_nope', 'members.ghost: unknown member']);
  const many = await put('many.json', { version: 1, members: { web: { status: 'investigated', provides: Array.from({ length: 80 }, () => ({ kind: 'nope' })) } } });
  const m = await run(['survey', many, '--extract', extract]);
  assert.equal(m.code, 1);
  assert.equal(m.out.length, 50);
  assert.equal(m.out.at(-1), '… and 31 more errors');
});

test('missing or unparsable file → exit 1 "file: …"; bad invocation → exit 2', async () => {
  const gone = await run(['survey', join(dir, 'nope.json'), '--extract', extract]);
  assert.equal(gone.code, 1);
  assert.match(gone.out[0], /^file: .*nope\.json does not exist$/);
  const junk = await put('junk.json', '{ nope');
  assert.match((await run(['survey', junk, '--extract', extract])).out[0], /^file: .* is not valid JSON/);
  assert.equal((await run(['survey', junk])).code, 2);
  const multi = await put('multi.json', '[1,\n2,\nOK\n]');
  const m = await run(['survey', multi, '--extract', extract]);
  assert.equal(m.code, 1);
  assert.deepEqual([m.out.length, m.out[0].includes('\n')], [1, false], 'a parse error that quotes the source is one line');
  assert.ok(m.out[0].startsWith('file: ') && !m.out.includes('OK'));
  const r = await run(['survey', junk, '--extract', multi]);
  assert.deepEqual([r.code, r.out.length, r.out[0].includes('\n')], [2, 1, false], 'so is an unreadable reference');
  assert.equal((await run(['survey', junk, '--catalog', catalog])).code, 2, 'wrong ref flag for the kind');
  assert.equal((await run(['bogus', junk, '--extract', extract])).code, 2);
  assert.equal((await run(['constructor', junk, `--${String(Object)}`, extract])).code, 2, 'a prototype name is no kind');
  assert.equal((await run(['survey', junk, '--extract', join(dir, 'no-ref.json')])).code, 2);
});

test('runs as a process: the exact checkerCommand line an agent would execute', () => {
  const survey = join(dir, 'survey.json');
  const cmd = checkerCommand('survey', { ref: extract }).replace('<OUT>', survey);
  const argv = [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  const ok = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, 'OK\n');
  const bad = spawnSync(process.execPath, [CLI, 'survey', join(dir, 'bad-usage.json'), '--extract', extract], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /members\.ghost: unknown member/);
});

test('an error echoing a multi-line key prints as one line (v4)', async () => {
  const survey = await put('nl.json', { version: 1, members: { [`ghost\nOK\n${'x\n'.repeat(60)}`]: { status: 'skipped' } } });
  const r = await run(['survey', survey, '--extract', extract]);
  assert.equal(r.code, 1);
  assert.equal(r.out.length, 1);
  assert.ok(!r.out[0].includes('\n'), r.out[0]);
});
