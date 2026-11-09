// test/public-assets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPartsManifest, isPublicPart, publicRelPath, assemble } from '../src/core/public-assets.mjs';
import { readStyleCss, readStyleCssEntry } from '../src/core/read-style-css.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { catchUpHint } from '../tools/split-by-feature.mjs';
import { keptMonolithProblems, catchUpCommand } from '../tools/split-by-feature/after-split.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../ui/public/', import.meta.url));

test('monolith tree: readStyleCss / readIndexHtml return the files byte for byte', () => {
  if (existsSync(join(PUBLIC_DIR, 'parts.json'))) return;              // a split tree has no monoliths to compare with
  assert.equal(readStyleCss(), readFileSync(join(PUBLIC_DIR, 'style.css'), 'utf8'));
  assert.equal(readIndexHtml(), readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8'));
});

function splitFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pa-'));
  mkdirSync(join(dir, 'chat')); mkdirSync(join(dir, 'shell'));
  writeFileSync(join(dir, 'chat/panel.mjs'), '');                       // chat/ existed before the split
  writeFileSync(join(dir, 'shell/shell.css'), ':root{}\n');
  writeFileSync(join(dir, 'chat/chat.css'), '.chat{}\n');
  writeFileSync(join(dir, 'shell/head.html'), '<html>\n');
  writeFileSync(join(dir, 'parts.json'), JSON.stringify({ version: 1, css: ['shell/shell.css', 'chat/chat.css'], html: ['shell/head.html'], dirs: ['shell'] }));
  return dir;
}

test('split tree: parts concatenate in manifest order, cached until a part changes', () => {
  const dir = splitFixture();
  assert.equal(readStyleCss(dir), ':root{}\n.chat{}\n');
  assert.equal(readIndexHtml(dir), '<html>\n');
  writeFileSync(join(dir, 'chat/chat.css'), '.chat{color:red}\n');
  assert.equal(readStyleCss(dir), ':root{}\n.chat{color:red}\n');
  assert.ok(readStyleCssEntry(dir).mtimeMs > 0);
});

test('isPublicPart: parts, extensionless HTML parts, new folders, variants', () => {
  const dir = splitFixture();
  const caseInsensitive = existsSync(join(dir, 'CHAT'));
  assert.equal(isPublicPart('/chat/chat.css', dir), true);
  assert.equal(isPublicPart('/chat//chat.css', dir), true);
  assert.equal(isPublicPart('/Chat/Chat.css', dir), caseInsensitive);
  assert.equal(isPublicPart('/shell/head', dir), true);                 // express.static would serve head.html
  assert.equal(isPublicPart('/parts.json', dir), true);
  assert.equal(isPublicPart('/shell', dir), true);                      // a folder the split created
  assert.equal(isPublicPart('/shell/', dir), true);
  assert.equal(isPublicPart('/chat', dir), false);                      // existed before: unchanged
  assert.equal(isPublicPart('/chat/panel.mjs', dir), false);
  assert.equal(isPublicPart('/%E0%A4%A', dir), false);                  // bad escape: static answers 400, as before
  assert.equal(isPublicPart('/x/../parts.json', dir), true);            // dot segments resolved like express.static
  assert.equal(isPublicPart('/../parts.json', dir), false);             // climbs above the root: static answers 403, as before
});

test('publicRelPath resolves a request path the way express.static does', () => {
  assert.equal(publicRelPath('/style.css'), 'style.css');
  assert.equal(publicRelPath('//style.css'), 'style.css');
  assert.equal(publicRelPath('/%73tyle.css'), 'style.css');
  assert.equal(publicRelPath('/a/../style.css'), 'style.css');
  assert.equal(publicRelPath('/style.css/'), 'style.css/');             // trailing slash kept: static misses it
  assert.equal(publicRelPath('/../style.css'), null);                   // static: 403
  assert.equal(publicRelPath('/%E0%A4%A'), null);                       // static: 400
  assert.equal(publicRelPath('/a%00.css'), null);
});

test('a bad manifest entry is refused, and a missing part is named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-'));
  for (const bad of ['../secret.css', '/abs.css', 'x/a.js', 'a\\..\\..\\b.css', 'C:/x.css', 'a\u0000.css', 'a//b.css', './a.css', '']) {
    writeFileSync(join(dir, 'parts.json'), JSON.stringify({ version: 1, css: [bad], html: [] }));
    assert.throws(() => readPartsManifest(dir), /parts\.json: bad css entry/, bad);
  }
  writeFileSync(join(dir, 'parts.json'), JSON.stringify({ version: 1, css: ['gone/gone.css'], html: [] }));
  assert.throws(() => readPartsManifest(dir), /missing part: ui\/public\/gone\/gone\.css/);
  writeFileSync(join(dir, 'parts.json'), JSON.stringify({ version: 1, css: [], html: [], dirs: 'shell' }));
  assert.throws(() => readPartsManifest(dir), /parts\.json: dirs must be a list/);   // a string would be walked letter by letter
});

test('a part swapped for a symlink out of the public dir after the manifest was read is not served', () => {
  const dir = splitFixture(); const outside = mkdtempSync(join(tmpdir(), 'pa-out-'));
  assert.equal(readStyleCss(dir), ':root{}\n.chat{}\n');                // the manifest is now cached
  writeFileSync(join(outside, 'secret.css'), 'secret');
  rmSync(join(dir, 'chat/chat.css')); symlinkSync(join(outside, 'secret.css'), join(dir, 'chat/chat.css'));
  assert.throws(() => readStyleCss(dir), /parts\.json: part "chat\/chat\.css" resolves outside its manifest/);
});

test('a part that is a symlink out of the public dir is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-')); const outside = mkdtempSync(join(tmpdir(), 'pa-out-'));
  writeFileSync(join(outside, 'secret.css'), 'x');
  mkdirSync(join(dir, 'shell')); symlinkSync(join(outside, 'secret.css'), join(dir, 'shell/shell.css'));
  writeFileSync(join(dir, 'parts.json'), JSON.stringify({ version: 1, css: ['shell/shell.css'], html: [] }));
  assert.throws(() => readPartsManifest(dir), /parts\.json: css entry "shell\/shell\.css" resolves outside ui\/public/);
});

// Guard: tests and tools reach the three monoliths only through their readers in src/core, so the freeze-day commit
// (which deletes style.css and index.html) touches no test. style.css / index.html: any path mention counts (exists,
// stat and spawn calls break too). ui/server.mjs stays a file, so only disk reads of it count.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const MONO = /(['"`])(?:\.{1,2}\/)*ui\/public\/(?:style\.css|index\.html)\1|(['"])public\2\s*,\s*(['"])(?:style\.css|index\.html)\3|\/ui\/public\/(?:style\.css|index\.html)['"`]/;
const BARE = /(['"])(?:style\.css|index\.html)\1/;
const PUBLIC_DIR_MENTION = /ui\/public\/?(?:['"`]|\$\{)|(['"])ui\1\s*,\s*(['"])public\2/;
const SERVER = /(['"`])(?:\.{1,2}\/)*ui\/server\.mjs\1|(['"])ui\2\s*,\s*(['"])server\.mjs\3/;
const READ = /\b(?:readFileSync|readFile|createReadStream|openSync)\s*\(/;
const IMPORT = /^\s*import\s[^;]*;?|\bimport\s*\([^)]*\)/g;
export function directReads(src) {
  const code = strip(src); const hits = [];
  const publicDirFile = PUBLIC_DIR_MENTION.test(code);
  const serverVars = [...code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=[^;\n]*(?:ui\/server\.mjs|['"]server\.mjs['"])/g)].map((m) => m[1]);
  // The variable may come after the read on the line, or before it (`files.filter((f) => … readFileSync(f, 'utf8'))`).
  const serverVarRead = serverVars.length
    ? new RegExp(`${READ.source}[^\\n]*\\b(?:${serverVars.join('|')})\\b|\\b(?:${serverVars.join('|')})\\b[^\\n]*${READ.source}`) : null;
  // Imports are not reads: drop the import itself and scan what else the line holds.
  const lines = code.split('\n').map((l) => l.replace(IMPORT, ''));
  lines.forEach((line, i) => {
    // A call wrapped over lines (`readFileSync(\n  join(ROOT, 'ui/server.mjs'),\n  'utf8')`): scan the line joined
    // with the next two, and report it on the line where the read starts.
    const win = READ.test(line) ? lines.slice(i, i + 3).join(' ') : line;
    if (MONO.test(line) || (publicDirFile && BARE.test(line)) || (READ.test(line) && SERVER.test(win))
      || (serverVarRead && serverVarRead.test(win))) hits.push(i + 1);
  });
  return hits;
}

test('guard: every read form is caught, imports and spawns are not', () => {
  const caught = [
    "readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8')",
    "import { readFileSync } from 'node:fs'; readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');",
    "const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));",
    "const p = join(__dir, '..', 'ui', 'public', 'index.html');",
    "const CSS = read('ui/public/style.css');",
    "const css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');",
    "const root = join(__dir, '..', 'ui', 'public');\nconst h = read('index.html');",
    "const S = join(ROOT, 'ui/server.mjs');\nconst src = readFileSync(S, 'utf8');",
    "const src = readFileSync(\n  join(ROOT, 'ui/server.mjs'),\n  'utf8');",
    "const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');\nconst html = read('index.html');",
    "const html = readFileSync(root + '/ui/public/index.html', 'utf8');",
    "const index = readFileSync(`${root}/ui/public/index.html`, 'utf8');",
    "const UI = join(ROOT, 'ui/public');\nconst html = readFileSync(join(UI, 'index.html'), 'utf8');",
    "const files = [...dirs, join(REPO, 'ui', 'server.mjs')];\nconst bad = files.filter((f) => /x/.test(readFileSync(f, 'utf8')));",
  ];
  for (const src of caught) assert.notDeepEqual(directReads(src), [], src);
  const fine = [
    "const { app } = await import('../ui/server.mjs');",
    "const SERVER = join(ROOT, 'ui/server.mjs');\nspawn(process.execPath, [SERVER]);",
    "// reads ui/public/style.css in a comment",
    "readFileSync(join(KIT, 'film', 'index.html'), 'utf8')",
    // a test title naming the path is not a read
    "test('a change to ui/public/style.css does not select the readers of index.html', () => {});",
  ];
  for (const src of fine) assert.deepEqual(directReads(src), [], src);
});

// Each entry: why the file may name the monoliths.
const ALLOW = new Map([
  ['test/public-assets.test.mjs', 'reads the monoliths on purpose and holds the guard fixtures'],
  ['tools/split-by-feature.mjs', 'the migration tool itself'],
  ['test/house-brief.test.mjs', "writes a fixture project's own ui/public/style.css and ui/server.mjs"],
  ['test/parity.test.mjs', "edits a copied tree's ui/server.mjs and style.css to prove the parity gates catch a change"],
  ['test/parity-reuse.test.mjs', "writes fixture trees' own ui/public/style.css and index.html to fingerprint them"],
  ['test/desktop-build.test.mjs', "reads the ui/server.mjs a fixture tarball extracted into a scratch staging dir"],
  ['e2e/extension/fixtures.mjs', "spawns ui/server.mjs; its only reads (openSync, readFileSync) are of the server's own log file"],
]);
const ALLOW_PREFIX = ['tools/split-by-feature/', 'test/split-by-feature',   // the tool and its fixture strings
  'tools/readiness/', 'test/readiness',   // the readiness dry run compares a scratch tree's monoliths with its split
  'tools/split-catch-up', 'test/split-catch-up'];   // the catch-up fixture edits a scratch clone's monoliths
test('no test or tool reaches style.css, index.html or ui/server.mjs on disk directly', () => {
  const root = new URL('../', import.meta.url);
  const offenders = [];
  for (const d of ['test', 'tools', 'e2e']) {   // e2e: the Playwright specs run on the split tree too (split:verify row h)
    for (const f of readdirSync(new URL(d + '/', root), { recursive: true })) {
      const rel = `${d}/${String(f).split('\\').join('/')}`;
      if (!/\.(mjs|js|cjs)$/.test(rel) || ALLOW.has(rel) || ALLOW_PREFIX.some((p) => rel.startsWith(p))) continue;
      if (/\/(node_modules|fixtures)\//.test(rel)) continue;
      for (const n of directReads(readFileSync(new URL(rel, root), 'utf8'))) offenders.push(`${rel}:${n}`);
    }
  }
  const msg = `use readStyleCss / readIndexHtml / readServerSource from src/core/read-style-css.mjs, read-index-html.mjs, read-server-source.mjs; ${catchUpHint(fileURLToPath(root))}`;
  assert.match(msg, /; if this branch started before the #919 split: run npm run split:catch-up -- \S+$/);
  assert.deepEqual(offenders, [], msg);
});

test('no monolith is kept next to ui/public/parts.json: the app builds /style.css and the page from the parts', () => {
  assert.deepEqual(keptMonolithProblems(PUBLIC_DIR, catchUpCommand(fileURLToPath(new URL('..', import.meta.url)))), []);
});

test('rollback B step 2: assemble is exported and gives the served bytes on both layouts', () => {
  const dir = splitFixture();
  assert.equal(assemble('css', 'style.css', dir).text, ':root{}\n.chat{}\n');
  assert.equal(assemble('html', 'index.html', dir).text, '<html>\n');
  if (existsSync(join(PUBLIC_DIR, 'parts.json'))) return;
  assert.equal(assemble('css', 'style.css', PUBLIC_DIR).text, readFileSync(join(PUBLIC_DIR, 'style.css'), 'utf8'));
  assert.equal(assemble('html', 'index.html', PUBLIC_DIR).text, readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8'));
});

test('readServerSource on a split tree: the server, then every area file in index order, feature indexes followed', () => {
  const ui = mkdtempSync(join(tmpdir(), 'pa-src-'));
  mkdirSync(join(ui, 'routes/chat'), { recursive: true });
  writeFileSync(join(ui, 'server.mjs'), '// server\n');
  writeFileSync(join(ui, 'routes/index.mjs'), "import * as m_chat from './chat/index.mjs';\nexport const ROUTE_SEGMENTS = [m_chat.SEGMENTS[0]];\n");
  writeFileSync(join(ui, 'routes/chat/index.mjs'), "import * as m_chat_ask from './ask.mjs';\nimport * as m_chat_search_index from './search-index.mjs';\n");
  writeFileSync(join(ui, 'routes/chat/ask.mjs'), '// ask\n');
  writeFileSync(join(ui, 'routes/chat/search-index.mjs'), '// search-index: an area, not an index\n');
  assert.equal(readServerSource(ui), '// server\n\n// ask\n\n// search-index: an area, not an index\n');
  rmSync(ui, { recursive: true, force: true });
});
