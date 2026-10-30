import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite } from '../tools/split-by-feature/codemod-reads.mjs';

const IMP = (name, mod) => `import { ${name} } from '../src/core/${mod}.mjs';`;

test('inline URL form: rewritten, one import after the last import', () => {
  const src = "import { readFileSync } from 'node:fs';\nconst css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');\n";
  assert.equal(rewrite(src, 'test/x.test.mjs'), `import { readFileSync } from 'node:fs';\n${IMP('readStyleCss', 'read-style-css')}\nconst css = readStyleCss();\n`);
});
test('fileURLToPath form, index.html and server.mjs map to their helpers', () => {
  const src = "import a from 'a';\nx(readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8'));\ny(readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8'));\n";
  const out = rewrite(src, 'test/y.test.mjs');
  assert.ok(out.includes(`${IMP('readIndexHtml', 'read-index-html')}\n${IMP('readServerSource', 'read-server-source')}\n`));
  assert.match(out, /x\(readIndexHtml\(\)\)/);
  assert.match(out, /y\(readServerSource\(\)\)/);
});
test('path variable form: reads rewritten, the unused variable deleted', () => {
  const src = "import a from 'a';\nconst htmlPath = join(__dir, '..', 'ui', 'public', 'index.html');\nconst html = readFileSync(htmlPath, 'utf8');\n";
  assert.equal(rewrite(src, 'test/v.test.mjs'), `import a from 'a';\n${IMP('readIndexHtml', 'read-index-html')}\nconst html = readIndexHtml();\n`);
});
test('a path variable still used elsewhere is kept', () => {
  const src = "import a from 'a';\nconst htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));\nconst h = readFileSync(htmlPath, 'utf8');\nnew JSDOM(h, { url: htmlPath });\n";
  assert.match(rewrite(src, 'test/k.test.mjs'), /const htmlPath = /);
});
test('async readFile and a local read helper', () => {
  const src = "import a from 'a';\nconst read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');\nconst css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');\nconst doc = read('ui/public/index.html');\n";
  const out = rewrite(src, 'test/h.test.mjs');
  assert.match(out, /const css = await readStyleCss\(\);/);
  assert.match(out, /const doc = readIndexHtml\(\);/);
});
test('a file with no match is returned unchanged, and a second run changes nothing', () => {
  const once = rewrite("import a from 'a';\nreadFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');\n", 'test/z.test.mjs');
  assert.equal(rewrite(once, 'test/z.test.mjs'), once);
  assert.equal(rewrite("import a from 'a';\nreadFileSync(join(KIT, 'film', 'index.html'), 'utf8');\n", 'test/f.test.mjs'),
    "import a from 'a';\nreadFileSync(join(KIT, 'film', 'index.html'), 'utf8');\n");
});
test('a read called on another object is left alone (it would become a member call)', () => {
  const src = "import a from 'a';\nconst css = (await import('node:fs')).readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');\n";
  assert.equal(rewrite(src, 'test/m.test.mjs'), src);
});
