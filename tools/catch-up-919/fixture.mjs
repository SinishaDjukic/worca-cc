// tools/catch-up-919/fixture.mjs — a fixture "old" PR for catch-up:919: a route, a CSS rule and a markup line, written
// at anchors inside mapped feature regions (so the coverage guard stays green), committed in a scratch clone.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_ROUTE = "app.get('/api/settings/catch-up-fixture', (req, res) => res.json({ fixture: true }));";
export const FIXTURE_CSS = '.catch-up-fixture { outline: 0; }';
export const FIXTURE_HTML = '<span class="catch-up-fixture" hidden></span>';
const ROUTE_ANCHOR = "app.get('/api/settings', ";        // ui/server.mjs:12600; '/api/settings' is the settings feature's route prefix
const CSS_ANCHOR = '/* ---------- Settings cards ---------- */';   // style.css:3577; feature-map css "^Settings cards"
// index.html:3395, in the shell feature's "<!-- Action results" region. Not the Main column marker (:209): a span there sits
// between aside.sidebar and .main-col, which test/ui-topnav-shell.test.mjs pins as adjacent siblings.
const HTML_ANCHOR = '<div id="toasts"';
const FILES = { server: 'ui/server.mjs', css: 'ui/public/style.css', html: 'ui/public/index.html' };
const IDENT = ['-c', 'user.name=worca catch-up', '-c', 'user.email=catch-up@worca.invalid'];

export function fixtureEdits({ server, css, html }) {
  const at = (text, needle, what) => { const i = text.indexOf(needle); if (i < 0) throw new Error(`fixture: no ${what} anchor (${needle})`); return i; };
  const r = server.lastIndexOf('\n', at(server, ROUTE_ANCHOR, 'route')) + 1;
  const c = css.indexOf('\n', at(css, CSS_ANCHOR, 'CSS')) + 1;
  const h = html.indexOf('\n', at(html, HTML_ANCHOR, 'markup')) + 1;
  return { server: `${server.slice(0, r)}${FIXTURE_ROUTE}\n${server.slice(r)}`,
    css: `${css.slice(0, c)}${FIXTURE_CSS}\n${css.slice(c)}`,
    html: `${html.slice(0, h)}${FIXTURE_HTML}\n${html.slice(h)}` };
}

/** A scratch clone of `base` with the fixture commit on top; returns { dir, head }. */
export function makeFixturePr({ run, cloneAt, root, base, dir }) {
  cloneAt(run, root, base, dir);
  const read = (k) => readFileSync(join(dir, FILES[k]), 'utf8');
  const e = fixtureEdits({ server: read('server'), css: read('css'), html: read('html') });
  for (const k of Object.keys(FILES)) writeFileSync(join(dir, FILES[k]), e[k]);
  for (const a of [['add', ...Object.values(FILES)], [...IDENT, 'commit', '--quiet', '-m', 'fixture: an old PR (a route, a CSS rule, a markup line)']]) {
    const r = run('git', ['-C', dir, ...a]); if (r.code !== 0) throw new Error(`fixture: git ${a.at(-1)}: ${r.stderr.trim()}`);
  }
  return { dir, head: run('git', ['-C', dir, 'rev-parse', 'HEAD']).stdout.trim() };
}

/** Where the three edits landed in a caught-up tree. */
export function checkFixture(dir) {
  const list = (d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d), { recursive: true }).map(String) : []);
  const has = (p) => readFileSync(join(dir, p), 'utf8').includes('catch-up-fixture');
  const where = (d, re) => list(d).filter((f) => re.test(f)).map((f) => `${d}/${f}`).filter(has);
  const routes = where('ui/routes', /\.mjs$/); const css = where('ui/public', /^[a-z0-9-]+\/[a-z0-9-]+\.css$/);
  const html = where('ui/public', /^[a-z0-9-]+\/[a-z0-9-]+\.html$/);
  const problems = [];
  for (const [what, got] of [['route', routes], ['CSS rule', css], ['markup line', html]]) if (got.length !== 1) problems.push(`the ${what} is in ${got.length} split files, expected 1`);
  if (existsSync(join(dir, FILES.server)) && has(FILES.server)) problems.push('the route stayed in ui/server.mjs');
  return { ok: !problems.length, problems, routes, css, html };
}
