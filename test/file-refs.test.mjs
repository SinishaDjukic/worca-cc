// test/file-refs.test.mjs — which words of a chat answer are file-path candidates (issue 1064 §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileRefsInText, fileRefFromCode, normalizeLinkPath, clampLines, FILE_PATH_MAX } from '../src/shared/file-refs.mjs';

const keys = (t) => fileRefsInText(t).map((h) => [h.ref.key, h.ref.line, h.ref.endLine]);

test('each form: a path, :line, :line-line, #Lline, #Lline-Lline, a bare name, a folder, backslashes, ./', () => {
  assert.deepEqual(keys('see ui/public/x.mjs:120 and src/a.js:3-9, lib/b.ts#L7 or lib/c.ts#L7-L12'),
    [['ui/public/x.mjs', 120, null], ['src/a.js', 3, 9], ['lib/b.ts', 7, null], ['lib/c.ts', 7, 12]]);
  assert.deepEqual(keys('open app.js now.'), [['app.js', null, null]]);
  assert.deepEqual(keys('the folder src/core/ holds it'), [['src/core/', null, null]]);
  assert.deepEqual(keys('on Windows src\\core\\x.mjs:4'), [['src/core/x.mjs', 4, null]]);
  assert.deepEqual(keys('run ./rel/x.md first'), [['rel/x.md', null, null]]);
  assert.deepEqual(keys('end of a sentence: ui/public/x.mjs.'), [['ui/public/x.mjs', null, null]]);
  assert.deepEqual(keys('lib/c.ts#L7-12'), [['lib/c.ts', 7, 12]]);
});

test('never a candidate: absolute, ~, .., a drive, a URL, an e-mail, a version, a reversed range, a bare word', () => {
  for (const t of ['/Users/me/x.js', '~/x.js', '../x.js', 'a/../b.js', 'C:\\x\\y.js', 'https://h.com/a/b.js',
    'user@host.com', 'v1.2.3', 'x.js:9-3', 'README', 'a/b.c.d/../e.js', '../x.js and ~/y.js']) {
    assert.deepEqual(keys(t), [], t);
  }
  assert.deepEqual(keys('@types/node/index.d.ts'), [['@types/node/index.d.ts', null, null]]);
});

test('a code span links only when its whole text is a path', () => {
  assert.deepEqual(fileRefFromCode(' src/a.js:12 '), { raw: 'src/a.js:12', path: 'src/a.js', dir: false, bare: false, key: 'src/a.js', line: 12, endLine: null });
  assert.equal(fileRefFromCode('npm test'), null);
  assert.equal(fileRefFromCode('/abs/x.js'), null);
  assert.equal(fileRefFromCode('see src/a.js'), null);
  assert.equal(fileRefFromCode('x'.repeat(FILE_PATH_MAX + 30)), null);
});

test('normalizeLinkPath refuses what leaves a root', () => {
  for (const p of ['', '/a', '~/a', 'C:/a', '\\\\srv\\share\\a', 'a/../b', '..', 'a/./b', `x${String.fromCharCode(0)}y`]) {
    assert.equal(normalizeLinkPath(p), null, JSON.stringify(p));
  }
  assert.deepEqual(normalizeLinkPath('./a\\b/'), { path: 'a/b', dir: true });
});

test('clampLines: past the end lands on the last line', () => {
  assert.deepEqual(clampLines({ line: 900, endLine: null }, 40), { line: 40, endLine: null });
  assert.deepEqual(clampLines({ line: 30, endLine: 90 }, 40), { line: 30, endLine: 40 });
  assert.deepEqual(clampLines({ line: 50, endLine: 90 }, 40), { line: 40, endLine: null });
  assert.deepEqual(clampLines({ line: 5, endLine: 9 }, null), { line: 5, endLine: 9 });
});

test('a path inside a URL query or a mailto body is not a candidate (v3)', () => {
  const hits = fileRefsInText('https://h.com/x?f=src/a.js and mailto:x@y.com?body=src/b.js&n=1, then src/c.js');
  assert.deepEqual(hits.map((h) => h.ref.key), ['src/c.js']);
});

test('linear on hostile text (150 000 chars of dotted and slashed runs)', () => {
  for (const s of ['a.'.repeat(75_000), 'a/'.repeat(75_000), '-a.b'.repeat(37_500), 'x.js:'.repeat(30_000)]) {
    const t0 = Date.now();
    fileRefsInText(s);
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  }
});
