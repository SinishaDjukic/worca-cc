// ui/public/nav/routes.mjs — the one route table (docs/design-system.md Navigation). Pure: no imports, no DOM, no app
// state. Every per-view fact is a ROUTES row; the functions below are generic over the rows and never branch on a
// view name. Old addresses are redirects declared in the rows (legacy segments, tab aliases). Adding a view is one
// row plus fixtures in test/nav-routes.test.mjs.

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const freeze = (o) => Object.freeze(o);

/** A path parameter: `segs` is [min, max] slash-separated segments; `encode` URI-encodes it. */
const param = (name, { segs = [1, 1], encode = false } = {}) => freeze({ name, segs: freeze(segs), encode });
/** A tab spec: address keys in strip order, the default (left out of the address), and old names. */
const tabs = (keys, def, aliases = {}) => freeze({ keys: freeze([...keys]), default: def, aliases: freeze({ ...aliases }) });
const row = ({ section = false, params = [], tabs: t = null, engine = {}, legacy = [], parent = () => null } = {}) =>
  freeze({ section, params: freeze(params), tabs: t, engine: freeze({ ...engine }), legacy: freeze([...legacy]), parent });

/** A dynamic parent the page reports (setNavParent): used when it names a titled route of a known view. */
const fromCtx = (fallback) => (route, ctx = {}) => {
  const p = ctx.parent;
  if (p && p.id && p.title && own(ROUTES, p.view) && !ROUTES[p.view].section) {
    const t = ROUTES[p.view].tabs;
    return { view: p.view, id: p.id, ...(t ? { tab: t.default } : {}), title: p.title };
  }
  return { view: fallback };
};
const to = (view) => () => ({ view });

const RUN_TABS = tabs(['summary', 'diff', 'changes', 'artifacts', 'actions', 'workflow', 'logs', 'agents', 'qa'], 'summary',
  { overview: 'summary', clarify: 'qa' });
const GROUP_TABS = tabs(['runs', 'overview', 'decisions', 'logs'], 'runs');   // group-page.mjs GROUP_TABS keys (pinned by test)

export const ROUTES = freeze({
  runs: row({ section: true }),
  running: row({ params: [param('id')], tabs: RUN_TABS, engine: { summary: 'overview' }, legacy: ['details'], parent: fromCtx('runs') }),
  // The project key may hold one slash ('workspaces/wk'); ids never do.
  history: row({ params: [param('projectKey', { segs: [1, 2] }), param('id')], tabs: RUN_TABS,
    engine: { summary: 'overview', qa: 'clarify' }, legacy: ['details'], parent: fromCtx('runs') }),
  feature: row({ params: [param('id', { encode: true })], tabs: GROUP_TABS, parent: to('runs') }),
  group: row({ params: [param('id', { encode: true })], tabs: GROUP_TABS, parent: to('runs') }),
});

const rowOf = (view) => (own(ROUTES, view) ? ROUTES[view] : null);
const arity = (spec) => spec.params.reduce((a, p) => [a[0] + p.segs[0], a[1] + p.segs[1]], [0, 0]);
const isTabWord = (spec, s) => !!spec.tabs && (spec.tabs.keys.includes(s) || own(spec.tabs.aliases, s));
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
// A row's address key for any tab word (alias, engine key, any case); unknown -> the row's default.
const tabKeyOf = (spec, key) => {
  const k = String(key || '').toLowerCase();
  const a = own(spec.tabs.aliases, k) ? spec.tabs.aliases[k] : k;
  return spec.tabs.keys.includes(a) ? a : spec.tabs.default;
};

/** Any tab key of `view` (address or engine, old or new) -> its address key; '' for a view without tabs. */
export function tabKey(view, key) {
  const spec = rowOf(view);
  return spec && spec.tabs ? tabKeyOf(spec, key) : '';
}

/** The engine's key for any tab key of `view` (the run pages call Summary 'overview', the saved Q&A 'clarify'). */
export function engineTab(view, key) {
  const k = tabKey(view, key);
  const e = rowOf(view)?.engine;
  return own(e, k) ? e[k] : k;
}

// Strip the tail: '…/legacy/tab', '…/legacy' or '…/tab', but only while enough segments stay for the params,
// so '#history/proj/diff' keeps run 'diff' of 'proj'.
function splitTail(spec, segs) {
  const [min] = arity(spec);
  const s = [...segs];
  let tab = '';
  const n = s.length;
  if (n >= min + 2 && spec.legacy.includes(s[n - 2])) { tab = s.pop(); s.pop(); }
  else if (n > min && spec.legacy.includes(s[n - 1])) s.pop();
  else if (n > min && isTabWord(spec, s[n - 1])) tab = s.pop();
  return { s, tab };
}

function matchParams(spec, segs) {
  const [min, max] = arity(spec);
  let { s, tab } = splitTail(spec, segs);
  if (s.length > max) s = s.slice(0, max);              // an unknown trailing word is dropped (non-canonical)
  if (s.length < min || s.some((x) => !x)) return null;
  let spare = s.length - min;                           // segments the wider params take beyond their minimum
  const out = {};
  for (const p of spec.params) {
    const take = p.segs[0] + Math.min(spare, p.segs[1] - p.segs[0]);
    spare -= take - p.segs[0];
    const v = s.splice(0, take).join('/');
    out[p.name] = p.encode ? safeDecode(v) : v;
  }
  return spec.tabs ? { ...out, tab: tabKeyOf(spec, tab) } : out;
}

/** The section root a view lives under (its parent chain with no page context). */
export function sectionOf(view) {
  let r = { view };
  for (let i = 0; i < 8 && rowOf(r.view) && !rowOf(r.view).section; i++) r = rowOf(r.view).parent(r, {}) || { view: '' };
  return rowOf(r.view) && rowOf(r.view).section ? r.view : '';
}

/** '#view/param' -> a route. `known`: the table owns the view. `canonical`: formatRoute writes it the same way. */
export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const i = raw.indexOf('/');
  const view = i === -1 ? raw : raw.slice(0, i);
  const rest = i === -1 ? '' : raw.slice(i + 1);
  const spec = rowOf(view);
  if (!spec) return { view, param: rest, known: false, canonical: true };
  if (spec.section) return { view, param: rest, known: true, canonical: true };
  const fields = matchParams(spec, rest ? rest.split('/') : []);
  if (!fields) return { view: sectionOf(view), param: '', known: true, canonical: false };
  const route = { view, ...fields };
  return { ...route, known: true, canonical: formatRoute(route) === `#${raw}` };
}

/** A route -> its canonical '#…' address: params in order, then the tab unless it is the default. */
export function formatRoute(r) {
  const spec = rowOf(r.view);
  if (!spec || spec.section) return `#${r.view}${r.param ? `/${r.param}` : ''}`;
  const parts = spec.params.map((p) => (p.encode ? encodeURIComponent(r[p.name]) : r[p.name]));
  const t = spec.tabs ? tabKeyOf(spec, r.tab) : '';
  return `#${[r.view, ...parts, ...(t && t !== spec.tabs.default ? [t] : [])].join('/')}`;
}

/** The page's address without its tab: the same page across tab changes (keeps the parent context). */
export const pageKey = (r) => formatRoute({ ...r, tab: '' });

/** The page one level up, or null for a section root or an unknown view. `ctx.parent` is the page's own report. */
export function parentOf(route, ctx = {}) {
  const spec = rowOf(route.view);
  return spec && !spec.section ? spec.parent(route, ctx) : null;
}

/** A Runs row's group as a parent route (the rule groupHrefOf in run-page-head.mjs uses; pinned by test). */
export const groupRoute = (row) => ({ view: row.groupKind === 'feature' ? 'feature' : 'group', id: row.groupId, title: row.title });
