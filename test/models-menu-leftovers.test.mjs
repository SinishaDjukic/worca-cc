// test/models-menu-leftovers.test.mjs — nothing of the old Models page cards and the old Providers page is left
// (models-menu P7). The scan reads every file of the stages in STAGES: no GONE word (an old function, id, class, card or
// page name) outside the tables that turn an old address into a new one; every class a Models stylesheet names is still
// emitted by some ui/public module; every link into docs/models.md lands on one of its headings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEngines } from '../src/core/engines/index.mjs';
import { ENGINE_SETUP } from '../src/shared/engine-setup.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const STAGES = ['code', 'docs', 'ask'];
const GONE = ['renderModelsList', 'renderProvidersCard', 'openImportDialog', 'model-import-modal', 'model-import-btn', 'model-share-btn', 'model-roles-card',
  'engine-settings-card', 'modelRolesSave', 'engineSettingsSave', 'mv-sec-toggle', 'mv-hide-builtin-row', 'mv-providers-hint', 'mv-pv-preset',
  'data-view="providers"', "showView('providers'", 'data-nav="providers"',
  'effortsSummary', 'envSummary', 'bridgedBadge', 'needsSignInPill', 'degradationLine', 'applyImportSelectAll',      // deleted here
  'Providers page', 'Providers card', 'Engines card', 'Roles card', 'Everyday coding', 'everyday coding',
  'Models › Engines', 'Models › Model roles', 'Models › Step models', 'Models › Helper jobs', 'Models › Roles', 'Models page › Engines',
  'Models page (Engines)', "Models page's Claude tab", 'on the Claude tab', 'See the Claude tab',
  'Import models…', 'Share as plugin…', 'Preset: OpenRouter'];

/** Every file under `dir` (repo-relative, '/'-separated) whose path matches `re`, walked as parity-crawl.test.mjs walks
 *  ui/public; skips ui/public/stillhet/ (untracked in the main checkout) and minified bundles. */
function files(dir, re) {
  return readdirSync(join(ROOT, dir), { recursive: true }).map((f) => `${dir}/${String(f).split(sep).join('/')}`)
    .filter((f) => re.test(f) && !f.includes('/stillhet/') && !f.endsWith('.min.js') && statSync(join(ROOT, f)).isFile());
}

const STAGE_FILES = Object.freeze({
  // the product: browser modules, routes, server, tools and core, Ask worca's own folder aside (the slash keeps
  // src/core/ask-files.mjs here)
  code: () => [...files('ui/public', /\.(mjs|js|html|css)$/), ...files('ui/routes', /\.mjs$/), 'ui/server.mjs', ...files('tools', /\.mjs$/),
    ...files('src', /\.mjs$/).filter((f) => !f.startsWith('src/core/ask/'))],
  // the docs a user reads today; released changelogs and docs/plans/ are history
  docs: () => [...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`), 'docs/changelog/unreleased.md'],
  ask: () => files('src/core/ask', /\.(mjs|js|md)$/),
});

/** The files of the stages in STAGES, each once. */
function SCOPE() {
  return [...new Set(STAGES.flatMap((s) => STAGE_FILES[s]()))];
}

/** The parts that turn an old address into a new one, so must keep naming it: app.js's MOVED_ROUTES and JOBS_PART_OF,
 *  each from `const NAME = Object.freeze({` to its `});` (as ui-addons-pages.test.mjs cuts MOVED_ROUTES), and
 *  page-tabs.mjs's JOBS_CARDS to the end of parseModelsParam's JSDoc. Nothing else is exempt. */
const OLD_ADDRESSES = Object.freeze({
  'ui/public/app.js': [['const MOVED_ROUTES = Object.freeze({', '});'], ['const JOBS_PART_OF = Object.freeze({', '});']],
  'ui/public/models/page-tabs.mjs': [['const JOBS_CARDS', '*/']],
});
const MAX_EXEMPT_LINES = 20;

/** `text` with `file`'s old-address parts blanked (their newlines kept, so file:line stays true). A missing anchor, or
 *  a part longer than MAX_EXEMPT_LINES (its end marker gone), throws: the exemption must not outlive what it exempts. */
function stripOldAddresses(file, text) {
  for (const [from, to] of OLD_ADDRESSES[file] || []) {
    const start = text.indexOf(from);
    if (start === -1) throw new Error(`${file}: "${from}" is gone; update OLD_ADDRESSES`);
    const end = text.indexOf(to, start);
    if (end === -1) throw new Error(`${file}: no "${to}" after "${from}"`);
    const part = text.slice(start, end);
    const lines = part.split('\n').length;
    if (lines > MAX_EXEMPT_LINES) throw new Error(`${file}: "${from}" … "${to}" spans ${lines} lines; is its end marker gone?`);
    text = text.slice(0, start) + part.replace(/[^\n]/g, '') + text.slice(end);
  }
  return text;
}

test('nothing of the old pages is left', () => {
  const scope = SCOPE();
  for (const f of ['ui/public/app.js', 'ui/public/models/page-tabs.mjs', 'ui/public/settings/settings.html', 'ui/public/models/model-bridge.css',
    'ui/routes/settings/settings.mjs', 'ui/server.mjs', 'tools/parity/crawl-routes.mjs', 'src/core/settings.mjs', 'src/core/ask-files.mjs',
    'docs/models.md', 'docs/changelog/unreleased.md', 'src/core/ask/prompt.mjs', 'src/core/ask/model-proposal.mjs']) {
    assert.ok(scope.includes(f), `${f} is scanned`);
  }
  assert.deepEqual(scope.filter((f) => f.startsWith('docs/plans/') || /^docs\/changelog\/(?!unreleased\.md$)/.test(f)), [], 'history is not scanned');
  const hits = [];
  for (const f of scope) {
    stripOldAddresses(f, read(f)).split('\n').forEach((line, i) => {
      for (const w of GONE) if (line.includes(w)) hits.push(`${f}:${i + 1}: ${w}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('stripOldAddresses blanks only the old-address tables, keeping the line numbers', () => {
  const app = read('ui/public/app.js');
  const stripped = stripOldAddresses('ui/public/app.js', app);
  assert.equal(stripped.split('\n').length, app.split('\n').length);
  assert.ok(app.includes("providers: 'models/providers'") && !stripped.includes("providers: 'models/providers'"));
  assert.ok(!stripped.includes("'model-roles-card': 'roles'"));
  assert.ok(stripped.includes('});') && stripped.includes('function '));
  assert.equal(stripOldAddresses('docs/models.md', 'Providers page'), 'Providers page', 'no other file is exempt');
  assert.throws(() => stripOldAddresses('ui/public/app.js', 'const MOVED_ROUTES = Object.freeze({\n});'), /JOBS_PART_OF/);
  assert.throws(() => stripOldAddresses('ui/public/models/page-tabs.mjs', `const JOBS_CARDS = 1;\n${'x\n'.repeat(30)}*/`), /spans/);
});

test('every class a Models stylesheet names is still emitted', () => {
  const sheets = [...readdirSync(join(ROOT, 'ui/public/models')).filter((f) => f.endsWith('.css')).map((f) => `ui/public/models/${f}`),
    'ui/public/settings/settings-cards.css'];
  assert.ok(sheets.includes('ui/public/models/model-bridge.css') && sheets.includes('ui/public/models/models-view.css'));
  // a whole token: mv-section-head does not keep mv-section alive
  const tokens = new Set(files('ui/public', /\.(mjs|js|html)$/).flatMap((f) => read(f).match(/[A-Za-z0-9_-]+/g) || []));
  assert.ok(tokens.has('mdl-toolbar') && tokens.has('mv-filters'), 'the emitted tokens are whole class names');
  const orphans = [];
  for (const css of sheets) {
    const names = new Set(read(css).replace(/\/\*[\s\S]*?\*\//g, '').match(/\.(?:mv|mvi|mvx|mimp|mdl)-[a-z0-9-]+/g) || []);
    for (const name of names) if (!tokens.has(name.slice(1))) orphans.push(`${css}: ${name}`);
  }
  assert.deepEqual(orphans, []);
});

/** docs/models.md's headings as GitHub slugs, in document order: inline markup unwrapped, lowercased, every character
 *  but letters, digits, `_`, `-` and space dropped, a space becomes `-`, a repeat gets `-1`, `-2`, …; fenced code is no
 *  heading. */
function modelsHeadingSlugs() {
  const slugs = [];
  const counts = new Map();
  let fence = null;
  for (const line of read('docs/models.md').split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    const text = h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1$2');
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    slugs.push(n ? `${base}-${n}` : base);
  }
  return slugs;
}

test('every link into docs/models.md lands on its heading', () => {
  const slugs = modelsHeadingSlugs();
  assert.equal(slugs[slugs.indexOf('the-models-page')], 'the-models-page', 'the slug rule reads the headings');
  const have = new Set(slugs);
  const text = /^(?!.*\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp3|mp4|wav|ogg|webm|pdf|zip)$)/i;
  const sources = [...STAGE_FILES.docs(), ...files('src', text), ...files('ui/public', text), ...files('docs-site/src', text)];
  const links = [];
  for (const f of sources) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/models\.md#([A-Za-z0-9_-]+)/g)) links.push([`${f}:${i + 1}`, m[1]]);
      if (f === 'docs/models.md') for (const m of line.matchAll(/\]\(#([^)\s]*)\)/g)) links.push([`${f}:${i + 1}`, m[1]]);
    });
  }
  // shared/engine-setup.mjs names each engine's setup section as a bare `docsAnchor` (the setup dialog's link and the
  // chat descriptors' notReady.docsUrl): no literal to grep
  for (const [e, { docsAnchor }] of Object.entries(ENGINE_SETUP)) links.push([`engine-setup.mjs ${e}`, docsAnchor]);
  const engines = listEngines().filter((a) => a.chat);
  assert.ok(engines.length >= 6, 'the engines with a chat descriptor');
  for (const a of engines) {
    const [page, anchor] = a.chat.notReady.docsUrl.split('#');
    assert.ok(page.endsWith('/docs/models.md'), `${a.name}: ${a.chat.notReady.docsUrl}`);
    links.push([`${a.name}'s chat descriptor (notReady.docsUrl)`, anchor]);
  }
  assert.ok(links.length > 40, `${links.length} links found`);
  assert.deepEqual(links.filter(([, slug]) => !have.has(slug)).map(([src, slug]) => `#${slug} <- ${src}`), []);
  // the sections other pages name by their bare slug keep it
  for (const t of ['providers', 'openrouter', 'chat', 'engines']) assert.ok(have.has(t), `a heading owns #${t}`);
});
