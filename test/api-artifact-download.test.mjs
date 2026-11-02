// test/api-artifact-download.test.mjs
// The artifact-raw routes' DOWNLOAD form (`?download=1`; run, history and workspace twins): always an attachment
// under a Windows-safe name (an ASCII `filename` plus the exact UTF-8 `filename*`), any extension, no 25 MB preview
// ceiling, streamed. The preview form keeps its 415/413. Media is served inline for the viewer's players and HTTP
// Range answers 206 (seeking). Plus the pure filename helpers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
import { downloadFilename, attachmentDisposition } from '../src/core/download-filename.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

const WS_KEY = 'wks-team-a-00000001';
// 64 bytes that open like an MP3 (an ID3 header) — the route never sniffs, the extension decides.
const MP3 = Buffer.from(`ID3\u0004${'\u0000'.repeat(6)}${'x'.repeat(54)}`, 'latin1');
const BIG = 26 * 1024 * 1024;

let homeDir, srv, base, prevHome, proj, key, id, dir, wsId;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-artdl-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-artdl-proj-'));
  ({ id, key, dir } = await seedPipeline(proj, { title: 'A', status: 'done' }));
  await mkdir(join(dir, 'deck'), { recursive: true });
  await mkdir(join(dir, 'media'), { recursive: true });
  await writeFile(join(dir, 'report.md'), '# report\n', 'utf8');
  await writeFile(join(dir, 'deck', 'deck.html'), '<!DOCTYPE html><p>deck</p>', 'utf8');
  await writeFile(join(dir, 'deck', 'thing.xyz'), 'unknown bytes', 'utf8');
  await writeFile(join(dir, 'media', 'narration.mp3'), MP3);
  await writeFile(join(dir, 'media', 'empty.mp3'), Buffer.alloc(0));
  await writeFile(join(dir, 'Résumé plan.md'), '# résumé\n', 'utf8');
  await mkdir(join(dir, 'notes'), { recursive: true });
  await writeFile(join(dir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
  await writeFile(join(dir, 'feed.xml'), '<html xmlns="http://www.w3.org/1999/xhtml"><script>1</script></html>', 'utf8');
  await writeFile(join(dir, '.env.example'), 'KEY=\n', 'utf8');
  await writeFile(join(dir, 'notes', '.hidden.md'), '# hidden\n', 'utf8');
  // Past the 25 MB preview ceiling without writing 26 MB: truncate() makes SPARSE files (as api-run-artifact-raw does).
  for (const big of ['big.pdf', join('media', 'long.mp4'), join('media', 'long.wav')]) {
    const fh = await open(join(dir, big), 'w');
    await fh.truncate(BIG);
    await fh.close();
  }
  recordArtifact(id, 'review', 'report.md');
  recordArtifact(id, 'deck', 'deck/deck.html');
  recordArtifact(id, 'deck', 'deck/thing.xyz');
  recordArtifact(id, 'deck-asset', 'media/narration.mp3');
  recordArtifact(id, 'plan', 'Résumé plan.md');
  recordArtifact(id, 'pdf', 'big.pdf');
  recordArtifact(id, 'deck-asset', 'media/long.mp4');
  recordArtifact(id, 'deck-asset', 'media/long.wav');
  recordArtifact(id, 'deck-asset', 'media/empty.mp3');
  recordArtifact(id, 'x', 'pic.svg');
  recordArtifact(id, 'x', 'feed.xml');
  recordArtifact(id, 'x', '.env.example');
  recordArtifact(id, 'x', 'notes/.hidden.md');
  const ws = await seedWorkspacePipeline(proj, WS_KEY, { title: 'ws run', status: 'done' },
    [{ projectKey: key, projectDir: proj, projectName: 'alpha' }]);
  wsId = ws.id;
  await writeFile(join(ws.dir, 'result.md'), '# ws\n', 'utf8');
  recordArtifact(wsId, 'result', 'result.md');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

async function hit(path, opts = {}) {
  const res = await fetch(`${base}${path}`, opts);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: buf, text: buf.toString('utf8') };
}
const raw = (rel, q = '') => `/api/runs/${id}/artifact-raw/${rel.split('/').map(encodeURIComponent).join('/')}${q}`;

test('downloadFilename keeps a name legal on Windows, macOS and Linux; attachmentDisposition carries it both ways', async () => {
  await checkRows([
    { name: 'the last segment of either separator, Windows-illegal characters made `_`', run: () => {
      assert.equal(downloadFilename('a/b/c<d>:e"f|g?h*i.md'), 'c_d__e_f_g_h_i.md');
      assert.equal(downloadFilename('C:\\runs\\x\\notes. '), 'notes', 'trailing dots and spaces go');
      assert.equal(downloadFilename('dir/a\u0007b.txt'), 'a_b.txt', 'control characters');
    } },
    { name: 'reserved device names get a prefix; nothing usable falls back to "artifact"', run: () => {
      assert.equal(downloadFilename('con.txt'), '_con.txt');
      assert.equal(downloadFilename('x/LPT1'), '_LPT1');
      assert.equal(downloadFilename('...'), 'artifact');
      assert.equal(downloadFilename(''), 'artifact');
    } },
    { name: 'an over-long name keeps its extension', run: () => {
      const name = downloadFilename(`${'a'.repeat(300)}.md`);
      assert.equal(name.length, 200);
      assert.ok(name.endsWith('.md'), name);
    } },
    { name: 'attachmentDisposition: an ASCII fallback plus the exact UTF-8 name (RFC 6266 / 5987)', run: () => {
      assert.equal(attachmentDisposition('deck/Résumé plan.md'),
        'attachment; filename="R_sum_ plan.md"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9%20plan.md');
      assert.equal(attachmentDisposition("notes/it's (v2).md"),
        'attachment; filename="it\'s (v2).md"; filename*=UTF-8\'\'it%27s%20%28v2%29.md');
      assert.equal(attachmentDisposition('x/100%.md'), 'attachment; filename="100_.md"; filename*=UTF-8\'\'100%25.md');
    } },
    { name: 'a cut never ends on a dot or a space; every reserved form; a broken surrogate never throws', run: () => {
      assert.equal(downloadFilename(`${'a'.repeat(199)} ${'b'.repeat(10)}`), 'a'.repeat(199));
      assert.equal(downloadFilename(`${'a'.repeat(199)}.${'b'.repeat(20)}`), 'a'.repeat(199));
      assert.equal(downloadFilename('COM0.log'), '_COM0.log');
      assert.equal(downloadFilename('lpt¹'), '_lpt¹');
      assert.equal(downloadFilename('conin$'), '_conin$');
      const lone = `a${String.fromCharCode(0xd800)}b.md`;
      assert.equal(downloadFilename(lone), `a${String.fromCharCode(0xfffd)}b.md`);
      assert.equal(attachmentDisposition(lone), 'attachment; filename="a_b.md"; filename*=UTF-8\'\'a%EF%BF%BDb.md');
    } },
  ]);
});

test('?download=1 is an attachment under its own name, same bytes and type, still nosniff and no-store', async () => {
  const r = await hit(raw('report.md', '?download=1'));
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-disposition'], 'attachment; filename="report.md"; filename*=UTF-8\'\'report.md');
  assert.equal(r.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.text, '# report\n');
  const preview = await hit(raw('report.md'));
  assert.equal(preview.headers['content-disposition'], 'inline; filename="report.md"', 'the preview form is unchanged');
  const zero = await hit(raw('report.md', '?download=0'));
  assert.equal(zero.headers['content-disposition'], 'inline; filename="report.md"', 'only download=1 downloads');
  assert.equal((await hit(raw('not/indexed.md', '?download=1'))).status, 404, '`rel` still only selects indexed rows');
});

test('the download form serves what the preview refuses: an unknown type (415) and a file past the 25 MB ceiling (413)', async () => {
  assert.equal((await hit(raw('deck/thing.xyz'))).status, 415);
  const any = await hit(raw('deck/thing.xyz', '?download=1'));
  assert.equal(any.status, 200);
  assert.equal(any.headers['content-type'], 'application/octet-stream');
  assert.equal(any.headers['content-disposition'], 'attachment; filename="thing.xyz"; filename*=UTF-8\'\'thing.xyz');
  assert.equal(any.text, 'unknown bytes');
  assert.equal((await hit(raw('big.pdf'))).status, 413);
  const big = await hit(raw('big.pdf', '?download=1'), { method: 'HEAD' });       // HEAD: no 26 MB body in the test
  assert.equal(big.status, 200);
  assert.equal(big.headers['content-length'], String(BIG), 'streamed whole, no ceiling');
  assert.match(big.headers['content-disposition'], /^attachment; /);
});

test('a non-ASCII name downloads under its exact UTF-8 name; html keeps its sandbox CSP as a download', async () => {
  const u = await hit(raw('Résumé plan.md', '?download=1'));
  assert.equal(u.status, 200);
  assert.equal(u.headers['content-disposition'],
    'attachment; filename="R_sum_ plan.md"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9%20plan.md');
  const h = await hit(raw('deck/deck.html', '?download=1'));
  assert.equal(h.status, 200);
  assert.match(h.headers['content-disposition'], /^attachment; filename="deck\.html"/);
  assert.equal(h.headers['content-security-policy'], 'sandbox allow-scripts');
  assert.equal(h.headers['content-type'], 'text/html; charset=utf-8');
});

test('media is served inline for the players, and Range answers 206 so they can seek', async () => {
  const m = await hit(raw('media/narration.mp3'));
  assert.equal(m.status, 200);
  assert.equal(m.headers['content-type'], 'audio/mpeg');
  assert.equal(m.headers['content-disposition'], 'inline; filename="narration.mp3"');
  assert.equal(m.headers['accept-ranges'], 'bytes');
  const part = await hit(raw('media/narration.mp3'), { headers: { Range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], `bytes 0-3/${MP3.length}`);
  assert.deepEqual([...part.body], [0x49, 0x44, 0x33, 0x04]);
});

test('a Range the file cannot satisfy is a 416 with send\'s Content-Range, never a 500 under the artifact\'s type', async () => {
  const empty = await hit(raw('media/empty.mp3'), { headers: { Range: 'bytes=0-' } });
  assert.equal(empty.status, 416, 'any Range on an empty file');
  assert.equal(empty.headers['content-range'], 'bytes */0');
  const past = await hit(raw('media/narration.mp3'), { headers: { Range: `bytes=${MP3.length + 10}-` } });
  assert.equal(past.status, 416, 'a seek past the end');
  assert.equal(past.headers['content-range'], `bytes */${MP3.length}`);
});

test('audio and video stream inline at ANY size, with Range; every other kind keeps the 25 MB preview ceiling', async () => {
  const head = await hit(raw('media/long.mp4'), { method: 'HEAD' });      // HEAD: no 26 MB body in the test
  assert.equal(head.status, 200, 'a video past 25 MB is not refused');
  assert.equal(head.headers['content-type'], 'video/mp4');
  assert.equal(head.headers['content-disposition'], 'inline; filename="long.mp4"');
  assert.equal(head.headers['content-length'], String(BIG));
  assert.equal(head.headers['accept-ranges'], 'bytes');
  const tail = await hit(raw('media/long.mp4'), { headers: { Range: `bytes=${BIG - 4}-${BIG - 1}` } });
  assert.equal(tail.status, 206, 'the player seeks to the end without pulling the file');
  assert.equal(tail.headers['content-range'], `bytes ${BIG - 4}-${BIG - 1}/${BIG}`);
  assert.equal(tail.body.length, 4);
  const wav = await hit(raw('media/long.wav'), { method: 'HEAD' });
  assert.equal(wav.status, 200, 'audio past 25 MB is not refused either');
  assert.equal(wav.headers['content-type'], 'audio/wav');
  assert.equal(wav.headers['content-disposition'], 'inline; filename="long.wav"');
  const pdf = await hit(raw('big.pdf'));
  assert.equal(pdf.status, 413, 'a pdf past the ceiling is still refused inline');
  assert.equal(JSON.parse(pdf.text).error, 'artifact too large to preview');
  const dl = await hit(raw('big.pdf', '?download=1'), { method: 'HEAD' });
  assert.equal(dl.status, 200, 'and still downloads');
  assert.match(dl.headers['content-disposition'], /^attachment; /);
});

test('the history and workspace twins take ?download=1 too', async () => {
  const hist = await hit(`/api/history/${key}/${id}/artifact-raw/report.md?download=1`);
  assert.equal(hist.status, 200);
  assert.match(hist.headers['content-disposition'], /^attachment; filename="report\.md"/);
  const ws = await hit(`/api/workspaces/${WS_KEY}/runs/${wsId}/artifact-raw/result.md?download=1`);
  assert.equal(ws.status, 200);
  assert.match(ws.headers['content-disposition'], /^attachment; filename="result\.md"/);
  assert.equal(ws.text, '# ws\n');
});

test('the history and workspace twins keep ?download=0 a preview too', async () => {
  const hist = await hit(`/api/history/${key}/${id}/artifact-raw/report.md?download=0`);
  assert.equal(hist.headers['content-disposition'], 'inline; filename="report.md"');
  const ws = await hit(`/api/workspaces/${WS_KEY}/runs/${wsId}/artifact-raw/result.md?download=0`);
  assert.equal(ws.headers['content-disposition'], 'inline; filename="result.md"');
});

test('DEL is a control character too', () => {
  assert.equal(downloadFilename(`a${String.fromCharCode(0x7f)}b.txt`), 'a_b.txt');
});

// ── refine cycle 3: what the rows above left unpinned ──
test('a conditional request send refuses is a 412 without the artifact\'s type or name, never a 500', async () => {
  for (const h of [{ 'If-Match': '"nope"' }, { 'If-Unmodified-Since': 'Mon, 01 Jan 2001 00:00:00 GMT' }]) {
    const r = await hit(raw('deck/deck.html', '?download=1'), { headers: h });
    assert.equal(r.status, 412, JSON.stringify(h));
    assert.equal(r.headers['content-disposition'], undefined, 'no attachment name on a refusal');
    assert.doesNotMatch(r.headers['content-type'] || '', /text\/html/, 'never the artifact\'s own type');
  }
});

test('the download form keeps an svg\'s sandbox CSP, an XML file is sandboxed too, and serves dot-named files', async () => {
  const svg = await hit(raw('pic.svg', '?download=1'));
  assert.equal(svg.status, 200);
  assert.equal(svg.headers['content-security-policy'], 'sandbox');
  for (const q of ['', '?download=1']) {   // XML can carry XHTML <script>: an XML mime is sandboxed like SVG
    const xml = await hit(raw('feed.xml', q));
    assert.equal(xml.status, 200, q);
    assert.equal(xml.headers['content-type'], 'application/xml', q);
    assert.equal(xml.headers['content-security-policy'], 'sandbox', q);
  }
  for (const [rel, body] of [['.env.example', 'KEY=\n'], ['notes/.hidden.md', '# hidden\n']]) {
    const r = await hit(raw(rel, '?download=1'));
    assert.equal(r.status, 200, rel);
    assert.equal(r.text, body, rel);
  }
});

test('downloadFilename: every reserved name, spaces before the extension, bidi controls, the LAST dot, 255 UTF-8 bytes', () => {
  assert.equal(downloadFilename('x/aux.log'), '_aux.log');
  assert.equal(downloadFilename('x/CON .txt'), '_CON .txt', 'Win32 drops the spaces: still the console');
  assert.equal(downloadFilename('nul  .tar.gz'), '_nul  .tar.gz');
  const rlo = String.fromCharCode(0x202e);
  assert.equal(downloadFilename(`invoice${rlo}txt.exe`), 'invoice_txt.exe', 'a right-to-left override cannot disguise .exe');
  assert.equal(downloadFilename(`a${String.fromCharCode(0x2066)}b${String.fromCharCode(0x2069)}.md`), 'a_b_.md');
  const zwj = String.fromCharCode(0x200d);
  assert.equal(downloadFilename(`family 👨${zwj}👩.png`), `family 👨${zwj}👩.png`, 'a joiner is no bidi control');
  const early = downloadFilename(`v1.2 ${'a'.repeat(250)}.md`);
  assert.ok(early.endsWith('.md') && Array.from(early).length === 200, 'the extension is the LAST dot');
  const ext16 = `.${'e'.repeat(15)}`;
  assert.ok(downloadFilename(`${'a'.repeat(250)}${ext16}`).endsWith(ext16), '16 characters with the dot: an extension');
  assert.equal(downloadFilename(`${'a'.repeat(250)}.${'e'.repeat(16)}`), 'a'.repeat(200), '17: no extension, cut as a stem');
  const wide = downloadFilename(`${'日'.repeat(250)}.md`);
  assert.ok(Buffer.byteLength(wide) <= 255, `${Buffer.byteLength(wide)} bytes`);
  assert.ok(wide.endsWith('.md'));
  assert.equal(downloadFilename(`${'a'.repeat(300)}.md`).length, 200, 'ASCII keeps the 200 cap');
});

test('downloadFilename: every bidi control becomes _, and a name past 255 UTF-8 bytes is cut even under 200 characters', () => {
  for (const cp of [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
    assert.equal(downloadFilename(`a${String.fromCharCode(cp)}b.txt`), 'a_b.txt', cp.toString(16));
  }
  const short = downloadFilename(`${'日'.repeat(100)}.md`);            // 103 characters, 303 bytes
  assert.ok(Buffer.byteLength(short) <= 255 && short.endsWith('.md'), `${Buffer.byteLength(short)} bytes`);
  assert.equal(Buffer.byteLength(downloadFilename(`a${'日'.repeat(84)}.md`)), 253, '256 bytes: one character goes');
});
