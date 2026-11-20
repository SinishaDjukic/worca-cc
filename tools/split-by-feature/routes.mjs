// tools/split-by-feature/routes.mjs
// Moves app.<verb>(…) statements of ui/server.mjs verbatim into ui/routes/FEATURE/AREA.mjs files (#919).
import * as acorn from 'acorn';
import { analyze } from 'eslint-scope';
import path from 'node:path';
import { featureForRoute } from './plan.mjs';
import { canOverlap, describePath } from './overlap.mjs';

export const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
export const STATIC_ANCHOR = 'app.use(express.static(PUBLIC_DIR';
export const FALLBACK_ANCHOR = '// SPA fallback:';
export const CAP = 1000;

const parsed = new Map();                       // src → parse; order-pin rounds re-plan the same text (read-only use)
export function parseModule(src) {
  if (parsed.has(src)) return parsed.get(src);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', ranges: true, locations: true });
  const sm = analyze(ast, { ecmaVersion: 2022, sourceType: 'module', fallback: 'iteration' });
  const out = { ast, sm, moduleScope: sm.scopes.find((s) => s.type === 'module') };
  if (parsed.size > 4) parsed.clear();
  parsed.set(src, out);
  return out;
}

/** app.<method>(…) calls in `node`, not entering functions. method is null for a computed member. */
export function appCalls(node) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (/Function/.test(n.type)) return;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'app') {
      out.push({ method: n.callee.computed ? null : n.callee.property.name, pathNode: n.arguments[0], line: n.loc.start.line });
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
    }
  })(node);
  return out;
}
export const routeCalls = (node) => appCalls(node).filter((c) => c.method === null || VERBS.has(c.method));
/** A statement that registers anything other than a route (use, route, param, set…) is a segment barrier. */
const isBarrier = (node) => appCalls(node).some((c) => c.method !== null && !VERBS.has(c.method) && c.method !== 'listen');

/** The static path prefix of a route's first argument, or null (regex, computed, unknown identifier). */
export function staticPrefix(node, constStrings) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis[0].value.cooked;
  if (node.type === 'ArrayExpression') {
    const ps = node.elements.map((e) => staticPrefix(e, constStrings));
    return ps.every((p) => p !== null) ? ps : null;
  }
  if (node.type === 'Identifier' && constStrings.has(node.name)) return constStrings.get(node.name);
  return null;
}
/** The overlap description of a route call: an exact string, a template (prefix + '*'), an array, or unknown. */
function pathDesc(node, constStrings) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return describePath(node.value);
  if (node?.type === 'TemplateLiteral') return node.expressions.length ? describePath(node.quasis[0].value.cooked + '*') : describePath(node.quasis[0].value.cooked);
  if (node?.type === 'ArrayExpression') return { kind: 'array', value: node.elements.map((e) => pathDesc(e, constStrings)) };
  if (node?.type === 'Identifier' && constStrings.has(node.name)) {
    const v = constStrings.get(node.name);
    return Array.isArray(v) ? { kind: 'array', value: v.map(describePath) } : describePath(v);
  }
  return { kind: 'regexp', value: 'unknown' };
}

const INERT_INIT = (n) => !n || ['Literal', 'ArrowFunctionExpression', 'FunctionExpression', 'ClassExpression'].includes(n.type)
  || (n.type === 'TemplateLiteral' && n.expressions.length === 0)
  || (n.type === 'ArrayExpression' && n.elements.every(INERT_INIT))
  || (n.type === 'ObjectExpression' && n.properties.every((p) => p.type === 'Property' && !p.computed && INERT_INIT(p.value)))
  || (n.type === 'NewExpression' && ['Map', 'Set', 'WeakMap'].includes(n.callee.name) && n.arguments.length === 0)
  || (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'Object'
      && n.callee.property.name === 'freeze' && n.arguments.every(INERT_INIT));
const isInertDecl = (s) => s.type === 'FunctionDeclaration'
  || (s.type === 'ClassDeclaration' && !s.body.body.some((m) => m.type === 'StaticBlock' || (m.static && m.value && !INERT_INIT(m.value))))
  || (s.type === 'VariableDeclaration' && s.declarations.every((d) => d.id.type === 'Identifier' && INERT_INIT(d.init)));
const isDecl = (s) => ['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration'].includes(s.type);

/** True when `test` matches a node in `node` that no `shields` node encloses (a shield stops the walk below it). */
function findOutside(node, test, shields) {
  let hit = false;
  (function walk(n) {
    if (hit || !n || typeof n.type !== 'string') return;
    if (test(n)) { hit = true; return; }
    if (shields(n)) return;
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
    }
  })(node);
  return hit;
}
const anyFn = (n) => /Function/.test(n.type);                                  // await is local to every function
const ownThisFn = (n) => n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
  || n.type === 'ClassBody';                                                 // arrows inherit `this`

/** Why a statement cannot move into register(), or null. */
export function hasForbidden(node) {
  if (findOutside(node, (n) => n.type === 'MetaProperty', () => false)) return 'uses import.meta';
  if (findOutside(node, (n) => n.type === 'AwaitExpression' || (n.type === 'ForOfStatement' && n.await), anyFn)) return 'top-level await';
  if (findOutside(node, (n) => n.type === 'ThisExpression', ownThisFn)) return 'top-level this';
  return null;
}

export function planRoutes(src, map, { forced = new Map(), keepCentral = new Set(), startAnchor = STATIC_ANCHOR } = {}) {
  const { ast, sm, moduleScope } = parseModule(src);
  const body = ast.body;
  const startIdx = body.findIndex((s) => src.startsWith(startAnchor, s.start)) + 1;
  const fallbackAt = src.indexOf(FALLBACK_ANCHOR);
  const callIdx = body.findIndex((s) => s.start > fallbackAt);
  if (startIdx === 0 || fallbackAt < 0 || callIdx < 0) throw new Error('split: ui/server.mjs anchors not found (static mount / SPA fallback)');

  // Segments (D4): barrier k closes segment k; the last segment closes at the SPA fallback.
  const barriers = [];
  for (let i = startIdx; i < callIdx; i++) if (isBarrier(body[i])) barriers.push(i);
  const ends = [...barriers, callIdx];                                  // registration point of segment k = ends[k]
  const segmentOf = (i) => ends.findIndex((e) => i < e);

  const starts = body.map((s) => s.start);
  const stmtOf = (pos) => { let lo = 0, hi = body.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const declStmt = new Map(moduleScope.variables.map((v) => [v, stmtOf(v.defs[0].name.start)]));
  const isImport = (v) => v.defs[0].type === 'ImportBinding';
  const isFn = (v) => v.defs[0].type === 'FunctionName';
  const uses = body.map(() => new Set()); const writes = body.map(() => new Set()); const evalUses = body.map(() => new Set());
  for (const scope of sm.scopes) for (const ref of scope.references) {
    const v = ref.resolved;
    if (!v || v.scope !== moduleScope) continue;
    const i = stmtOf(ref.identifier.start);
    if (i === declStmt.get(v)) continue;
    uses[i].add(v);
    if (ref.isWrite()) writes[i].add(v);
    if (ref.from.variableScope === moduleScope) evalUses[i].add(v);
  }
  const usersOf = new Map();             // decl stmt index → stmt indices that reference one of its bindings
  body.forEach((_, i) => { for (const v of uses[i]) { const d = declStmt.get(v); if (!usersOf.has(d)) usersOf.set(d, new Set()); usersOf.get(d).add(i); } });

  const constStrings = new Map();        // NAME = 'literal' | ['a', 'b'] (for app.get(SET_SKILL_PATHS, …))
  for (const s of body) if (s.type === 'VariableDeclaration' && s.kind === 'const') for (const d of s.declarations) {
    const p = d.id.type === 'Identifier' ? staticPrefix(d.init, new Map()) : null;
    if (p !== null) constStrings.set(d.id.name, p);
  }

  // group = `${feature}#${segment}`: one file set per feature and segment.
  const group = new Map(); const pins = []; const problems = []; const routeInfo = new Map();
  for (let i = startIdx; i < callIdx; i++) {
    const calls = routeCalls(body[i]);
    if (!calls.length) continue;
    const key = calls.map((c) => `${(c.method || '?').toUpperCase()} ${JSON.stringify(staticPrefix(c.pathNode, constStrings))}`).join(' + ');
    routeInfo.set(i, { key, layers: calls.map((c) => ({ kind: 'route', methods: [c.method || 'all'], path: pathDesc(c.pathNode, constStrings) })) });
    const fs = new Set(); let unresolved = false;
    for (const c of calls) {
      const p = c.method === null ? null : staticPrefix(c.pathNode, constStrings);
      if (p === null) { unresolved = true; continue; }
      for (const one of [p].flat()) {
        const f = featureForRoute(map, one);
        if (!f) problems.push(`unmapped route: ${c.method.toUpperCase()} ${one} (ui/server.mjs:${c.line})`);
        else fs.add(f);
      }
    }
    const why = isBarrier(body[i]) ? 'registers middleware' : unresolved ? 'path has no static prefix'
      : fs.size > 1 ? `spans features ${[...fs].join(',')}` : forced.get(i) ?? hasForbidden(body[i]);
    if (why) pins.push({ key, line: body[i].loc.start.line, reason: why });
    else if (fs.size === 1) group.set(i, `${[...fs][0]}#${segmentOf(i)}`);
  }

  // A statement unmoved for what it writes or reads stays central for good; otherwise the declaration pass would move
  // it back (its users still agree) and the two passes would take turns forever.
  const stuck = new Set();
  const unmove = (i, reason) => {
    if (routeInfo.has(i)) pins.push({ key: routeInfo.get(i).key, line: body[i].loc.start.line, reason });
    group.delete(i); stuck.add(i);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let i = startIdx; i < callIdx; i++) {                         // declarations follow their users
      const s = body[i];
      if (!isDecl(s) || routeCalls(s).length || isBarrier(s)) continue;
      const users = [...(usersOf.get(i) || [])];
      const gs = new Set(users.map((u) => group.get(u) ?? 'central'));
      const g = !keepCentral.has(i) && !stuck.has(i) && isInertDecl(s) && gs.size === 1 && !gs.has('central') ? [...gs][0] : null;
      if (g && group.get(i) !== g) { group.set(i, g); changed = true; }
      if (!g && group.has(i)) { group.delete(i); changed = true; }
    }
    for (const [i, g] of [...group]) {                                  // moved code must still link and run
      for (const v of writes[i]) if (group.get(declStmt.get(v)) !== g) { unmove(i, `writes ${v.name}`); changed = true; break; }
      if (!group.has(i)) continue;
      const regAt = ends[Number(g.split('#')[1])];                     // where this statement now runs
      for (const v of evalUses[i]) {
        const d = declStmt.get(v);
        if (group.get(d) === g || isImport(v) || isFn(v) || d < regAt || v.name === 'app') continue;
        unmove(i, `reads ${v.name} before it is declared`); changed = true; break;
      }
    }
  }
  return { body, group, pins, problems, declStmt, uses, usersOf, isImport, callIdx, startIdx, barriers, ends, routeInfo, src };
}

/** Route statements whose move would swap order with an overlapping route in their segment (D6). */
export function orderFlips(plan, files) {
  const { body, group, routeInfo, ends, startIdx } = plan;
  const flips = new Map();
  ends.forEach((end, k) => {
    const from = k ? ends[k - 1] + 1 : startIdx;
    const central = []; for (let i = from; i < end; i++) if (routeInfo.has(i) && !group.has(i)) central.push(i);
    // central routes stay in place; moved files register at the segment end in ROUTE_SEGMENTS[k] order
    const moved = files.filter((f) => f.segment === k).flatMap((f) => f.stmtIdx.filter((i) => routeInfo.has(i)));
    const pos = new Map([...central, ...moved].map((i, n) => [i, n]));
    const src = [...pos.keys()].sort((a, b) => a - b);
    for (let x = 0; x < src.length; x++) for (let y = x + 1; y < src.length; y++) {
      const [a, b] = [src[x], src[y]];
      if (pos.get(a) < pos.get(b) || flips.has(a)) continue;
      const hit = routeInfo.get(a).layers.some((la) => routeInfo.get(b).layers.some((lb) => canOverlap(la, lb)));
      if (hit) flips.set(a, `would run after ${routeInfo.get(b).key} (ui/server.mjs:${body[b].loc.start.line})`);
    }
  });
  return flips;
}

const leadStart = (src, body, i) => {           // a statement owns the comment lines right above it
  const prevEnd = i ? body[i - 1].end : 0;
  const nl = src.indexOf('\n', prevEnd);
  return nl >= 0 && nl < body[i].start ? nl + 1 : body[i].start;
};
export const stmtText = (src, body, i) => {
  const end = src[body[i].end] === '\n' ? body[i].end + 1 : body[i].end;
  return src.slice(leadStart(src, body, i), end);
};
export { leadStart };

/** An import specifier of ui/server.mjs, as the file in `base` (ui/routes/FEATURE) must write it. */
export function relSpecifier(spec, base) {
  if (!spec.startsWith('.')) return spec;
  const r = path.posix.relative(base, path.posix.join('ui', spec));
  return r.startsWith('.') ? r : './' + r;
}

export function importLines(vars, base) {
  const bySpec = new Map();
  for (const v of vars) {
    const def = v.defs[0]; const spec = relSpecifier(def.parent.source.value, base);
    if (!bySpec.has(spec)) bySpec.set(spec, { def: null, ns: null, named: [] });
    const e = bySpec.get(spec); const n = def.node;
    if (n.type === 'ImportDefaultSpecifier') e.def = v.name;
    else if (n.type === 'ImportNamespaceSpecifier') e.ns = v.name;
    else { const imp = n.imported.type === 'Literal' ? n.imported.value : n.imported.name; e.named.push(imp === v.name ? v.name : `${imp} as ${v.name}`); }
  }
  const lines = [];
  for (const spec of [...bySpec.keys()].sort()) {
    const e = bySpec.get(spec);
    if (e.ns) lines.push(`import * as ${e.ns} from '${spec}';`);
    const parts = [e.def, e.named.length ? `{ ${e.named.sort().join(', ')} }` : null].filter(Boolean);
    if (parts.length) lines.push(`import ${parts.join(', ')} from '${spec}';`);
  }
  return lines;
}

export function emitRouteFile({ name, feature, doc, version, stmtIdx, plan }) {
  const { body, uses, declStmt, isImport, src } = plan;
  const local = new Set(stmtIdx);
  const imported = new Set(); const fromServer = new Set();
  for (const i of stmtIdx) for (const v of uses[i]) {
    if (v.name === 'app' || local.has(declStmt.get(v))) continue;
    if (isImport(v)) imported.add(v); else fromServer.add(v.name);
  }
  const head = [
    `// ui/routes/${name}.mjs — feature "${feature}"${doc ? ` (${doc})` : ''}. Generated by tools/split-by-feature.mjs v${version};`,
    '// the body of register() was moved verbatim from ui/server.mjs. Edit it here from now on.',
    ...importLines(imported, `ui/routes/${feature}`),
    ...(fromServer.size ? [`import { ${[...fromServer].sort().join(', ')} } from '../../server.mjs';`] : []),
    '',
    'export function register(app) {',
  ];
  const text = stmtIdx.map((i) => stmtText(src, body, i)).join('');
  return { file: `ui/routes/${name}.mjs`, text: head.join('\n') + '\n' + text + '}\n', fromServer, firstLine: body[stmtIdx[0]].loc.start.line };
}
