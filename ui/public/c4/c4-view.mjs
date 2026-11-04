// ui/public/c4/c4-view.mjs — the Worca C4 viewer.
//
// One module, three layers, no framework:
//   parseC4(text)        a LikeC4 SUBSET parser (specification, model, deployment, views)
//   buildViews(model)    resolves every view into nodes + edges
//   <worca-c4>           a web component that draws a view as SVG, in Worca's own tokens,
//                        with pan, zoom, selection, an optional info rail and JPEG/PNG export
//
// Deployment views follow ONE convention, nothing else: every top-level deployment node is a
// horizontal BAND in declaration order; any node with children is a FRAME, recursively; leaves
// are TILES. A node's `metadata { order '…' }` picks how its children are placed: `declared`
// (default), `alphabetical`, or `dependencies` (a top-to-bottom dependency layout, wide ranks
// wrapped). `metadata { criteria '…' }` is prose for the agent that places elements; the viewer
// shows it in the info rail and never interprets it.
//
// Layout for element views needs dagre (window.dagre, or pass `dagre` to the component). Without
// it, element views fall back to rows. The deployment sheet needs dagre only for `dependencies`.
//
// Embedding:  <worca-c4 src="docs/architecture.c4" view="deployment" info toolbar></worca-c4>
//             el.load(text | json); el.view = 'id'; el.export({ format: 'jpeg', scale: 2 }) → Blob
// Events:     c4-ready (views), c4-select ({ id, node }), c4-error (message)

// ───────────────────────────────────────── tokenizer ─────────────────────────────────────────

function tokenize(src) {
  const toks = []; let i = 0; let line = 1;
  const n = src.length;
  const push = (t, v) => toks.push({ t, v, line });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const chunk = src.slice(i, e < 0 ? n : e + 2); line += (chunk.match(/\n/g) || []).length; i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      if (src.startsWith(c + c + c, i)) { const e = src.indexOf(c + c + c, i + 3); const s = src.slice(i + 3, e < 0 ? n : e); line += (s.match(/\n/g) || []).length; push('str', dedent(s)); i = e < 0 ? n : e + 3; continue; }
      let j = i + 1; let s = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\' && j + 1 < n) { s += src[j + 1]; j += 2; } else { if (src[j] === '\n') line += 1; s += src[j]; j += 1; } }
      push('str', s); i = j + 1; continue;
    }
    if (c === '{' || c === '}' || c === ',' || c === '=' || c === ';') { push(c, c); i += 1; continue; }
    if (c === '-' && src[i + 1] === '>') { push('->', '->'); i += 2; continue; }
    if (c === '-' && src[i + 1] === '[') { const e = src.indexOf(']->', i); push('-[', src.slice(i + 2, e).trim()); i = e + 3; continue; }
    if (c === '<' && src[i + 1] === '-' && src[i + 2] === '>') { push('<->', '<->'); i += 3; continue; }
    if (c === '#') { let j = i + 1; while (j < n && /[\w-]/.test(src[j])) j += 1; push('hash', src.slice(i + 1, j)); i = j; continue; }
    if (/[A-Za-z_*]/.test(c)) { let j = i; while (j < n && /[\w.*-]/.test(src[j])) j += 1; push('id', src.slice(i, j)); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.%]/.test(src[j])) j += 1; push('num', src.slice(i, j)); i = j; continue; }
    if (c === '(' || c === ')' || c === '[' || c === ']') { push(c, c); i += 1; continue; }
    i += 1; // anything else is ignored
  }
  push('eof', null);
  return toks;
}
function dedent(s) {
  const lines = s.replace(/^\n/, '').replace(/\n[ \t]*$/, '').split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n');
}

// ───────────────────────────────────────── parser ─────────────────────────────────────────

// split literal: test/shared-graph-purity scans ui/public for module specifiers, and a quoted
// keyword right after the word reads to it as one.
const KW_IMPORT = 'im' + 'port';

const LIKEC4_COLORS = { primary: 'blue', secondary: 'slate', muted: 'slate', sky: 'blue', gray: 'slate', grey: 'slate', blue: 'blue', indigo: 'indigo', red: 'red', green: 'green', amber: 'amber', slate: 'slate' };

export function parseC4(text) {
  const toks = tokenize(text); let p = 0;
  const peek = (k = 0) => toks[p + k]; const next = () => toks[p++];
  const is = (t, v) => peek().t === t && (v === undefined || peek().v === v);
  const accept = (t, v) => (is(t, v) ? next() : null);
  const expect = (t, v) => { if (!is(t, v)) throw new SyntaxError(`line ${peek().line}: expected ${v || t}, got ${JSON.stringify(peek().v)}`); return next(); };
  const skipBlock = () => { expect('{'); let d = 1; while (d && !is('eof')) { const t = next(); if (t.t === '{') d += 1; else if (t.t === '}') d -= 1; } };

  const m = { spec: { elements: {}, nodes: {}, relationships: {}, tags: [], colors: {} }, elements: {}, relations: [], deployment: {}, deploymentOrder: [], deploymentRelations: [], views: [], viewOrder: [] };

  const readProps = (into, allowNested) => {
    // Reads a `{ … }` body: properties, metadata, style, tags, nested elements, relations.
    expect('{');
    while (!is('}') && !is('eof')) {
      if (is('hash')) { into.tags.push(next().v); continue; }
      if (is('id', 'title')) { next(); into.title = expect('str').v; continue; }
      if (is('id', 'description')) { next(); into.description = expect('str').v; continue; }
      if (is('id', 'technology')) { next(); into.technology = expect('str').v; continue; }
      if (is('id', 'summary')) { next(); into.summary = expect('str').v; continue; }
      if (is('id', 'link')) { next(); const url = next().v; const label = accept('str'); into.links.push({ url, label: label ? label.v : url }); continue; }
      if (is('id', 'icon')) { next(); into.icon = next().v; continue; }
      if (is('id', 'metadata')) { next(); expect('{'); while (!is('}') && !is('eof')) { const k = next().v; const v = accept('str'); into.metadata[k] = v ? v.v : ''; } expect('}'); continue; }
      if (is('id', 'style')) { next(); expect('{'); while (!is('}') && !is('eof')) { const k = next().v; const v = next(); into.style[k] = v.v; } expect('}'); continue; }
      if (allowNested && allowNested(into)) continue;
      // unknown keyword: swallow a value or a block
      const t = next();
      if (is('{')) skipBlock(); else if (is('str') || is('num') || is('id')) { if (t.t === 'id' && !['this', 'it'].includes(t.v)) next(); }
    }
    expect('}');
  };
  const blank = (extra) => ({ title: '', description: '', technology: '', tags: [], links: [], metadata: {}, style: {}, ...extra });

  const parseRelationTail = (from, scope, list, implicitSource) => {
    // after `from` has been read: `->` or `-[kind]->`, then target, optional label and body
    let kind = null;
    if (is('-[')) kind = next().v; else expect('->');
    const to = expect('id').v;
    const r = { from, to, kind, title: '', description: '', technology: '', tags: [], links: [], metadata: {}, style: {}, scope, implicitSource };
    const label = accept('str'); if (label) r.title = label.v;
    if (is('{')) readProps(r, null);
    list.push(r);
  };

  const parseElementBody = (el, fqn, list) => readProps(el, (into) => {
    // nested element: `id = kind 'title' {…}` | `kind id 'title'` | relation `-> x` / `a -> b`
    if (is('->') || is('-[')) { parseRelationTail(fqn, fqn, list, true); return true; }
    if (is('id') && peek(1).t === '=') { parseElementDecl(fqn, list); return true; }
    if (is('id') && (peek(1).t === '->' || peek(1).t === '-[')) { const from = next().v; parseRelationTail(from, fqn, list, false); return true; }
    if (is('id') && m.spec.elements[peek().v] && peek(1).t === 'id') { parseElementDecl(fqn, list, true); return true; }
    return false;
  });
  function parseElementDecl(parentFqn, list, kindFirst = false) {
    let name; let kind;
    if (kindFirst) { kind = next().v; name = next().v; } else { name = next().v; expect('='); kind = next().v; }
    const fqn = parentFqn ? `${parentFqn}.${name}` : name;
    const el = blank({ id: fqn, name, kind, parent: parentFqn || null, children: [] });
    const t1 = accept('str'); if (t1) el.title = t1.v;
    const t2 = accept('str'); if (t2) el.description = t2.v;
    const t3 = accept('str'); if (t3) el.technology = t3.v;
    if (!el.title) el.title = name;
    m.elements[fqn] = el;
    if (parentFqn && m.elements[parentFqn]) m.elements[parentFqn].children.push(fqn);
    if (is('{')) parseElementBody(el, fqn, list);
  }

  function parseDeploymentDecl(parentFqn) {
    // `id = kind 'title' {…}` | `id = instanceOf ref {…}` | `instanceOf ref`
    let name = null;
    if (is('id', 'instanceOf')) { next(); const ref = expect('id').v; name = ref.split('.').pop(); return finishInstance(name, ref, parentFqn); }
    name = next().v; expect('=');
    if (is('id', 'instanceOf')) { next(); const ref = expect('id').v; return finishInstance(name, ref, parentFqn); }
    const kind = next().v;
    const fqn = parentFqn ? `${parentFqn}.${name}` : name;
    const node = blank({ id: fqn, name, kind, parent: parentFqn || null, children: [], instance: false, modelRef: null });
    const t1 = accept('str'); if (t1) node.title = t1.v;
    if (!node.title) node.title = name;
    m.deployment[fqn] = node; m.deploymentOrder.push(fqn);
    if (parentFqn && m.deployment[parentFqn]) m.deployment[parentFqn].children.push(fqn);
    if (is('{')) readProps(node, () => {
      if (is('id') && (peek(1).t === '=' || peek().v === 'instanceOf')) { parseDeploymentDecl(fqn); return true; }
      if (is('->') || is('-[')) { parseRelationTail(fqn, fqn, m.deploymentRelations, true); return true; }
      if (is('id') && (peek(1).t === '->' || peek(1).t === '-[')) { const from = next().v; parseRelationTail(from, fqn, m.deploymentRelations, false); return true; }
      return false;
    });
  }
  function finishInstance(name, ref, parentFqn) {
    const fqn = parentFqn ? `${parentFqn}.${name}` : name;
    const node = blank({ id: fqn, name, kind: 'instance', parent: parentFqn || null, children: [], instance: true, modelRef: ref });
    m.deployment[fqn] = node; m.deploymentOrder.push(fqn);
    if (parentFqn && m.deployment[parentFqn]) m.deployment[parentFqn].children.push(fqn);
    if (is('{')) readProps(node, null);
  }

  const parsePredicates = () => {
    // comma separated: ref | ref.* | ref.** | * | ref -> ref | * -> * | ref ->  …  (relation predicates kept as {rel:true})
    const out = [];
    const one = () => {
      const a = next().v;
      if (is('->')) { next(); const b = next().v; out.push({ rel: true, from: a, to: b }); }
      else if (is('<->')) { next(); const b = next().v; out.push({ rel: true, from: a, to: b, both: true }); }
      else out.push({ ref: a });
      if (is('{')) skipBlock(); // `include x { style … }` and `where` blocks are ignored
    };
    one(); while (accept(',')) one();
    return out;
  };
  function parseView(type) {
    const id = expect('id').v;
    let of = null; if (accept('id', 'of')) of = expect('id').v;
    const v = { id, type, of, title: '', description: '', rules: [], autoLayout: type === 'dynamic' ? 'LeftRight' : 'TopBottom', steps: [], tags: [] };
    expect('{');
    while (!is('}') && !is('eof')) {
      if (is('hash')) { v.tags.push(next().v); continue; }
      if (accept('id', 'title')) { v.title = expect('str').v; continue; }
      if (accept('id', 'description')) { v.description = expect('str').v; continue; }
      if (accept('id', 'include')) { v.rules.push({ include: true, preds: parsePredicates() }); continue; }
      if (accept('id', 'exclude')) { v.rules.push({ include: false, preds: parsePredicates() }); continue; }
      if (accept('id', 'autoLayout')) { v.autoLayout = next().v; while (is('num')) next(); continue; }
      if (type === 'dynamic' && is('id') && (peek(1).t === '->' || peek(1).t === '-[')) {
        const from = next().v; if (is('-[')) next(); else next(); const to = next().v; const lbl = accept('str');
        const step = { from, to, title: lbl ? lbl.v : '' }; if (is('{')) readProps(Object.assign(step, { tags: [], links: [], metadata: {}, style: {} }), null); v.steps.push(step); continue;
      }
      const t = next(); if (is('{')) skipBlock(); else if (t.t === 'id' && (is('str') || is('id') || is('num'))) next();
    }
    expect('}');
    if (!v.title) v.title = id;
    m.views.push(v); m.viewOrder.push(id);
  }

  while (!is('eof')) {
    if (accept('id', 'specification')) {
      expect('{');
      while (!is('}') && !is('eof')) {
        if (accept('id', 'element')) { const k = next().v; const s = { kind: k, style: {}, technology: '', notation: '' }; if (is('{')) readProps(Object.assign(s, { tags: [], links: [], metadata: {} }), null); m.spec.elements[k] = s; continue; }
        if (accept('id', 'deploymentNode')) { const k = next().v; const s = { kind: k, style: {} }; if (is('{')) readProps(Object.assign(s, { tags: [], links: [], metadata: {}, technology: '' }), null); m.spec.nodes[k] = s; continue; }
        if (accept('id', 'relationship')) { const k = next().v; const s = { kind: k, style: {} }; if (is('{')) { expect('{'); while (!is('}') && !is('eof')) { const key = next().v; const val = next(); s.style[key] = val.v; } expect('}'); } m.spec.relationships[k] = s; continue; }
        if (accept('id', 'tag')) { m.spec.tags.push(next().v); if (is('{')) skipBlock(); continue; }
        if (accept('id', 'color')) { const name = next().v; const val = next(); m.spec.colors[name] = `#${val.v}`; continue; }
        const t = next(); if (is('{')) skipBlock();
      }
      expect('}'); continue;
    }
    if (accept('id', 'model')) {
      expect('{');
      while (!is('}') && !is('eof')) {
        if (is('id') && peek(1).t === '=') { parseElementDecl(null, m.relations); continue; }
        if (is('id') && m.spec.elements[peek().v] && peek(1).t === 'id') { parseElementDecl(null, m.relations, true); continue; }
        if (is('id') && (peek(1).t === '->' || peek(1).t === '-[')) { const from = next().v; parseRelationTail(from, null, m.relations, false); continue; }
        if (accept('id', 'extend')) { const fqn = next().v; const el = m.elements[fqn] || (m.elements[fqn] = blank({ id: fqn, name: fqn.split('.').pop(), kind: 'unknown', parent: null, children: [] })); parseElementBody(el, fqn, m.relations); continue; }
        next();
      }
      expect('}'); continue;
    }
    if (accept('id', 'deployment')) {
      expect('{');
      while (!is('}') && !is('eof')) {
        if (is('id') && (peek(1).t === '=' || peek().v === 'instanceOf')) { parseDeploymentDecl(null); continue; }
        if (is('id') && (peek(1).t === '->' || peek(1).t === '-[')) { const from = next().v; parseRelationTail(from, null, m.deploymentRelations, false); continue; }
        next();
      }
      expect('}'); continue;
    }
    if (accept('id', 'views')) {
      expect('{');
      while (!is('}') && !is('eof')) {
        if (accept('id', 'view')) { parseView('element'); continue; }
        if (is('id', 'deployment') && peek(1).v === 'view') { next(); next(); parseView('deployment'); continue; }
        if (is('id', 'dynamic') && peek(1).v === 'view') { next(); next(); parseView('dynamic'); continue; }
        if (accept('id', 'global')) { skipBlock(); continue; }
        next();
      }
      expect('}'); continue;
    }
    if (accept('id', KW_IMPORT) || accept('id', `${KW_IMPORT}s`)) { while (!is('}') && !is('eof') && !is('id', 'specification') && !is('id', 'model')) next(); continue; }
    next();
  }

  // resolve relation refs (innermost scope outwards), drop the unresolvable with a note
  const resolveIn = (table, ref, scope) => {
    if (table[ref]) return ref;
    let s = scope;
    while (s) { const c = `${s}.${ref}`; if (table[c]) return c; s = table[s] ? table[s].parent : null; }
    const parts = ref.split('.'); const head = parts[0];
    for (const k of Object.keys(table)) if (k.endsWith(`.${head}`) || k === head) { const c = k.slice(0, k.length - head.length) + ref; if (table[c]) return c; }
    return null;
  };
  m.problems = [];
  for (const r of m.relations) {
    r.source = r.implicitSource ? r.from : resolveIn(m.elements, r.from, r.scope);
    r.target = resolveIn(m.elements, r.to, r.scope);
    if (!r.source || !r.target) m.problems.push(`relation ${r.from} -> ${r.to} could not be resolved`);
  }
  m.relations = m.relations.filter((r) => r.source && r.target);
  for (const r of m.deploymentRelations) { r.source = r.implicitSource ? r.from : resolveIn(m.deployment, r.from, r.scope); r.target = resolveIn(m.deployment, r.to, r.scope); }
  m.deploymentRelations = m.deploymentRelations.filter((r) => r.source && r.target);
  for (const d of Object.values(m.deployment)) if (d.instance) {
    const ref = resolveIn(m.elements, d.modelRef, null);
    if (!ref) { m.problems.push(`instance ${d.id} references unknown element ${d.modelRef}`); continue; }
    d.modelRef = ref; const el = m.elements[ref];
    // an instance inherits what it does not restate; its own technology is read as badges
    if (!d.title) d.title = el.title; if (!d.description) d.description = el.description; d.ownTechnology = d.technology; if (!d.technology) d.technology = el.technology;
    d.tags = [...new Set([...(el.tags || []), ...(d.tags || [])])]; d.kind = el.kind; d.style = { ...el.style, ...d.style };
  }
  for (const v of m.views) if (v.of) v.of = resolveIn(m.elements, v.of, null) || v.of;
  return m;
}

// ──────────────────────────────────── view resolution ────────────────────────────────────

const isAncestor = (a, b) => b.startsWith(`${a}.`);
const txt = (v) => (v && typeof v === 'object' ? (v.txt ?? v.md ?? '') : (v || ''));

function expandPred(table, pred, scopeOf) {
  const r = pred.ref;
  if (r === '*') return scopeOf ? Object.keys(table).filter((k) => k === scopeOf || table[k].parent === scopeOf) : Object.keys(table).filter((k) => !table[k].parent);
  if (r.endsWith('.**')) { const b = r.slice(0, -3); return Object.keys(table).filter((k) => isAncestor(b, k)); }
  if (r.endsWith('.*')) { const b = r.slice(0, -2); return Object.keys(table).filter((k) => table[k].parent === b); }
  return table[r] ? [r] : [];
}


// LikeC4: `include *` in a scoped view also brings in the outside neighbours of the scope's
// children, collapsed to the level of the scope's siblings (or to the top level).
function neighbours(m, table, scope) {
  const scopeParent = table[scope] ? table[scope].parent : null; const out = new Set();
  const collapse = (id) => { if (scopeParent && isAncestor(scopeParent, id)) return `${scopeParent}.${id.slice(scopeParent.length + 1).split('.')[0]}`; return id.split('.')[0]; };
  const inside = (id) => id === scope || isAncestor(scope, id);
  for (const r of m.relations) { const a = inside(r.source); const b = inside(r.target); if (a === b) continue; const o = a ? r.target : r.source; if (!isAncestor(scope, o)) out.add(collapse(o)); }
  return out;
}

export function buildViews(m) {
  const out = [];
  for (const v of m.views) {
    if (v.type === 'dynamic') { out.push(buildDynamic(m, v)); continue; }
    const table = v.type === 'deployment' ? m.deployment : m.elements;
    const inc = new Set(); const nb = new Set(); let dropEdges = false; const edgeFilters = [];
    for (const rule of v.rules) for (const pred of rule.preds) {
      if (pred.rel) { if (!rule.include && pred.from === '*' && pred.to === '*') dropEdges = true; else edgeFilters.push({ include: rule.include, pred }); continue; }
      for (const id of expandPred(table, pred, v.of)) { if (rule.include) { inc.add(id); nb.delete(id); } else { inc.delete(id); nb.delete(id); } }
      if (rule.include && pred.ref === '*' && v.type === 'element' && v.of) for (const id of neighbours(m, table, v.of)) if (!inc.has(id)) { inc.add(id); nb.add(id); }
    }
    if (v.type === 'element' && !v.rules.length && v.of) for (const id of expandPred(table, { ref: '*' }, v.of)) inc.add(id);
    // deployment views draw every ancestor of an included node as a group (LikeC4 does the same)
    if (v.type === 'deployment') for (const id of [...inc]) { let pth = table[id] ? table[id].parent : null; while (pth) { inc.add(pth); pth = table[pth].parent; } }
    const nearest = (id) => { let s = id; while (s) { if (inc.has(s)) return s; s = table[s] ? table[s].parent : null; } return null; };
    const nodes = [...inc].map((id) => { const e = table[id]; return { id, parent: nearest(e.parent), title: e.title, description: e.description, technology: e.technology, ownTechnology: e.ownTechnology, tags: e.tags, kind: e.kind, metadata: e.metadata, links: e.links, instance: !!e.instance, modelRef: e.modelRef || null, style: e.style, children: [] }; });
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (const n of nodes) if (n.parent && byId[n.parent]) byId[n.parent].children.push(n.id);
    // declaration order for deployment, model order otherwise
    const order = v.type === 'deployment' ? m.deploymentOrder : Object.keys(m.elements);
    nodes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const edges = new Map();
    const addEdge = (s, t, rel) => {
      if (!s || !t || s === t || isAncestor(s, t) || isAncestor(t, s)) return;
      const k = `${s}\u0000${t}`; if (!edges.has(k)) edges.set(k, { id: `e${edges.size + 1}`, source: s, target: t, labels: [], kinds: new Set(), relations: [] });
      const e = edges.get(k); if (rel.title && !e.labels.includes(rel.title)) e.labels.push(rel.title); if (rel.kind) e.kinds.add(rel.kind); e.relations.push(rel);
    };
    if (!dropEdges) {
      if (v.type === 'deployment') {
        // an instance stands for its model element and that element's descendants
        const instOf = (elId) => { let s = elId; while (s) { const hit = nodes.filter((n) => n.instance && n.modelRef === s); if (hit.length) return hit; s = m.elements[s] ? m.elements[s].parent : null; } return []; };
        for (const r of m.relations) for (const a of instOf(r.source)) for (const b of instOf(r.target)) addEdge(a.id, b.id, r);
        for (const r of m.deploymentRelations) addEdge(nearest(r.source), nearest(r.target), r);
      } else {
        // a scoped `include *` draws no relation between two outside neighbours
        // a neighbour brought in by `include *` only keeps the relations that brought it in
        const inScope = (id) => v.of && (id === v.of || isAncestor(v.of, id));
        for (const r of m.relations) { const a = nearest(r.source); const b = nearest(r.target); if ((nb.has(a) && !inScope(r.target)) || (nb.has(b) && !inScope(r.source))) continue; addEdge(a, b, r); }
      }
    }
    let edgeList = [...edges.values()].map((e) => ({ ...e, kinds: [...e.kinds] }));
    for (const f of edgeFilters) { const hit = (e) => (f.pred.from === '*' || e.source === f.pred.from || isAncestor(f.pred.from, e.source)) && (f.pred.to === '*' || e.target === f.pred.to || isAncestor(f.pred.to, e.target)); if (!f.include) edgeList = edgeList.filter((e) => !hit(e)); }
    out.push({ id: v.id, type: v.type, title: v.title, description: v.description, of: v.of, autoLayout: v.autoLayout, nodes, edges: edgeList });
  }
  return out;
}
function buildDynamic(m, v) {
  const ids = new Set(); const steps = [];
  const res = (ref) => (m.elements[ref] ? ref : Object.keys(m.elements).find((k) => k.endsWith(`.${ref}`)) || ref);
  for (const s of v.steps) { const a = res(s.from); const b = res(s.to); ids.add(a); ids.add(b); steps.push({ from: a, to: b, title: s.title }); }
  const nodes = [...ids].map((id) => { const e = m.elements[id] || { title: id, kind: 'unknown', tags: [], metadata: {}, links: [], style: {} }; return { id, parent: null, title: e.title, description: e.description || '', technology: e.technology || '', tags: e.tags, kind: e.kind, metadata: e.metadata, links: e.links, children: [], style: e.style }; });
  return { id: v.id, type: 'dynamic', title: v.title, description: v.description, nodes, edges: steps.map((s, i) => ({ id: `s${i + 1}`, source: s.from, target: s.to, labels: [s.title], kinds: [], step: i + 1 })), steps };
}

// Accepts LikeC4's own JSON export too (likec4 export json), so a CLI-produced file works as-is.
export function fromExport(json) {
  const m = { spec: { elements: {}, nodes: {}, relationships: {}, tags: [], colors: {} }, elements: {}, relations: [], deployment: {}, deploymentOrder: [], deploymentRelations: [], views: [], viewOrder: [], problems: [], prebuilt: [] };
  for (const [k, s] of Object.entries(json.specification?.elements || {})) m.spec.elements[k] = { kind: k, style: s.style || {}, technology: s.technology || '' };
  for (const [k, s] of Object.entries(json.specification?.deployments || {})) m.spec.nodes[k] = { kind: k, style: s.style || {} };
  for (const [k, s] of Object.entries(json.specification?.relationships || {})) m.spec.relationships[k] = { kind: k, style: s || {} };
  for (const [k, c] of Object.entries(json.specification?.customColors || {})) m.spec.colors[k] = typeof c === 'string' ? c : (c.elements?.fill || '#888');
  for (const [id, e] of Object.entries(json.elements || {})) m.elements[id] = { id, name: id.split('.').pop(), kind: e.kind, parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null, children: [], title: e.title || id, description: txt(e.description), technology: e.technology || '', tags: e.tags || [], links: e.links || [], metadata: e.metadata || {}, style: e.style || {} };
  for (const e of Object.values(m.elements)) if (e.parent && m.elements[e.parent]) m.elements[e.parent].children.push(e.id);
  for (const r of Object.values(json.relations || {})) m.relations.push({ source: r.source?.model || r.source, target: r.target?.model || r.target, title: txt(r.title), kind: r.kind || null, technology: r.technology || '', description: txt(r.description), tags: r.tags || [], metadata: r.metadata || {} });
  for (const [id, d] of Object.entries(json.deployments?.elements || {})) { const inst = !!d.element; m.deployment[id] = { id, name: id.split('.').pop(), kind: inst ? 'instance' : d.kind, parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null, children: [], instance: inst, modelRef: inst ? d.element : null, title: d.title || (inst && m.elements[d.element] ? m.elements[d.element].title : id), description: txt(d.description) || (inst && m.elements[d.element] ? m.elements[d.element].description : ''), technology: d.technology || (inst && m.elements[d.element] ? m.elements[d.element].technology : ''), tags: d.tags || (inst && m.elements[d.element] ? m.elements[d.element].tags : []), links: d.links || [], metadata: d.metadata || {}, style: d.style || {} }; m.deploymentOrder.push(id); }
  for (const d of Object.values(m.deployment)) if (d.parent && m.deployment[d.parent]) m.deployment[d.parent].children.push(d.id);
  for (const r of Object.values(json.deployments?.relations || {})) m.deploymentRelations.push({ source: r.source?.id || r.source, target: r.target?.id || r.target, title: txt(r.title), kind: r.kind || null });
  for (const [id, v] of Object.entries(json.views || {})) {
    const type = v._type === 'deployment' ? 'deployment' : v._type === 'dynamic' ? 'dynamic' : 'element';
    const view = { id, type, title: v.title || id, description: txt(v.description), of: v.viewOf || null, autoLayout: v.autoLayout?.direction || 'TopBottom', rules: [], steps: [], tags: v.tags || [] };
    // keep the export's own node/edge set: rebuild from its nodes and edges
    const ids = new Set(v.nodes.map((n) => n.id));
    view.rules.push({ include: true, preds: [...ids].map((r) => ({ ref: r })) });
    if (type === 'dynamic') view.steps = v.edges.map((e) => ({ from: e.source, to: e.target, title: txt(e.label) }));
    m.views.push(view); m.viewOrder.push(id);
  }
  return m;
}

// ───────────────────────────────────────── palette ─────────────────────────────────────────

const FALLBACK = {
  light: { bg: '#F1F1EF', canvas: '#FBFBF9', panel: '#FFFFFF', field: '#F6F6F4', ink: '#19191B', ink2: '#5C5C63', ink3: '#9A9AA1', onInk: '#FFFFFF', line: '#ECECEA', line2: '#E3E3E0', seq: '#B7B7BC', amber: '#E6962A', amberBg: '#FCE8C8', amberInk: '#A66510', amberWash: '#FEF7EC', amberLine: '#F5D9A8', peachBg: '#FCEEDA', peachInk: '#B5751A', peachLine: '#F1DCBD', indigo: '#6A7FD8', indigoBg: '#E3E7F9', indigoInk: '#4457B5', greenBg: '#E2F3DF', greenInk: '#2F7A38', blueBg: '#DEEFF7', blueInk: '#2E6E8E', redBg: '#FBE3E0', redInk: '#C5483A', violetBg: '#EAE6F8', violetInk: '#6353B8', tealBg: '#DDF2EF', tealInk: '#2A8A80', pinkBg: '#FBE4EE', pinkInk: '#B84A7C', limeBg: '#EEF4D5', limeInk: '#6E8A14', cocoaBg: '#F1E7DB', cocoaInk: '#7E5D33', slateBg: '#E8ECF0', slateInk: '#58646F' },
  dark: { bg: '#161614', canvas: '#1B1B19', panel: '#222220', field: '#2C2C29', ink: '#ECECE8', ink2: '#B4B4AE', ink3: '#9E9E98', onInk: '#161614', line: '#30302D', line2: '#494944', seq: '#8E8E92', amber: '#E6962A', amberBg: '#332715', amberInk: '#F0B45A', amberWash: '#322816', amberLine: '#6A5228', peachBg: '#33261A', peachInk: '#F2B96A', peachLine: '#504029', indigo: '#6A7FD8', indigoBg: '#232739', indigoInk: '#A3B0EE', greenBg: '#1C2F1D', greenInk: '#8FD48F', blueBg: '#1A2A33', blueInk: '#9FD3EE', redBg: '#34201D', redInk: '#F08C7E', violetBg: '#262336', violetInk: '#B3A8EE', tealBg: '#1A2E2B', tealInk: '#86D3CA', pinkBg: '#33202A', pinkInk: '#F0A2C3', limeBg: '#262E15', limeInk: '#C7DB6E', cocoaBg: '#2F2620', cocoaInk: '#D2B08A', slateBg: '#262A2E', slateInk: '#B3BEC8' },
};
const TOKEN_VARS = { bg: '--bg', canvas: '--canvas-2', panel: '--panel', field: '--field', ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', onInk: '--on-ink', line: '--line', line2: '--line-2', seq: '--seq', amber: '--amber', amberBg: '--amber-bg', amberInk: '--amber-ink', amberWash: '--amber-wash', amberLine: '--amber-line', peachBg: '--peach-bg', peachInk: '--peach-ink', peachLine: '--peach-line', indigo: '--indigo', indigoBg: '--indigo-bg', indigoInk: '--indigo-ink', greenBg: '--green-bg', greenInk: '--green-ink', blueBg: '--blue-bg', blueInk: '--h-blue-ink', redBg: '--red-bg', redInk: '--red-ink', violetBg: '--violet-bg', violetInk: '--violet-ink', tealBg: '--teal-bg', tealInk: '--teal-ink', pinkBg: '--pink-bg', pinkInk: '--pink-ink', limeBg: '--lime-bg', limeInk: '--lime-ink', cocoaBg: '--cocoa-bg', cocoaInk: '--cocoa-ink', slateBg: '--slate-bg', slateInk: '--slate-ink' };

/** Resolve Worca's tokens off the host element; light-dark() values are resolved by a probe. */
function readPalette(host) {
  const dark = (() => { const t = host.ownerDocument.documentElement.getAttribute('data-theme'); if (t === 'dark') return true; if (t === 'light') return false; return host.ownerDocument.defaultView.matchMedia('(prefers-color-scheme: dark)').matches; })();
  const base = { ...(dark ? FALLBACK.dark : FALLBACK.light) };
  const doc = host.ownerDocument; const probe = doc.createElement('i'); probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; host.appendChild(probe);
  const cs = doc.defaultView.getComputedStyle(host);
  for (const [k, v] of Object.entries(TOKEN_VARS)) {
    const raw = cs.getPropertyValue(v).trim(); if (!raw) continue;
    probe.style.color = raw; const c = doc.defaultView.getComputedStyle(probe).color; if (c && c !== 'rgba(0, 0, 0, 0)') base[k] = c;
  }
  probe.remove();
  return { ...base, dark };
}
const hexToRgb = (h) => { const s = h.replace('#', ''); const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toRgb = (c) => { if (c.startsWith('#')) return hexToRgb(c); const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128]; };
const mix = (a, b, t) => { const A = toRgb(a); const B = toRgb(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; };

/** A LikeC4 colour name or hex → { bg (head tint), ink (head text), line (border) } in Worca's families. */
function family(pal, spec, color) {
  const name = LIKEC4_COLORS[color] || color || 'slate';
  const fam = { blue: ['blueBg', 'blueInk'], indigo: ['indigoBg', 'indigoInk'], red: ['redBg', 'redInk'], green: ['greenBg', 'greenInk'], amber: ['amberBg', 'amberInk'], slate: ['slateBg', 'slateInk'], violet: ['violetBg', 'violetInk'], peach: ['peachBg', 'peachInk'], teal: ['tealBg', 'tealInk'], pink: ['pinkBg', 'pinkInk'], lime: ['limeBg', 'limeInk'], cocoa: ['cocoaBg', 'cocoaInk'] }[name];
  if (fam) return { bg: pal[fam[0]], ink: pal[fam[1]] };
  const hex = spec.colors[name] || (name.startsWith('#') ? name : null);
  if (hex) return { bg: mix(pal.panel, hex, pal.dark ? 0.28 : 0.16), ink: mix(hex, pal.ink, pal.dark ? 0.45 : 0.25) };
  return { bg: pal.slateBg, ink: pal.slateInk };
}

// ───────────────────────────────────────── layout ─────────────────────────────────────────

const FONT = "'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const charW = (size) => size * 0.56;
function wrap(text, size, maxW, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  const w = (s) => s.length * charW(size);
  for (const word of words) { const t = cur ? `${cur} ${word}` : word; if (w(t) <= maxW || !cur) cur = t; else { lines.push(cur); cur = word; } }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}
const ell = (s, size, maxW) => { const n = Math.floor(maxW / charW(size)); return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s; };

const SHEET = { W: 1120, TILE_W: 176, TILE_H: 44, CARD_H: 86, CARD_MAX: 300, GAP: 10, BAND_GAP: 44, LABEL: 28, PAD: 18, FRAME_HEAD: 60, MAXCOL: 6, RGAP: 14 };

/** The deployment sheet: bands → frames → tiles by the convention in the file header. */
function layoutSheet(view, dagre) {
  const byId = Object.fromEntries(view.nodes.map((n) => [n.id, n]));
  const kids = (n) => n.children.map((id) => byId[id]);
  const roots = view.nodes.filter((n) => !n.parent);
  const edgesAmong = (ids) => view.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const boxes = {}; const frames = []; const tiles = []; const bands = [];

  // size pass: a leaf is a tile (or a card at band level); a container is as big as its children's layout
  function measure(n, depth) {
    const ch = kids(n);
    if (!ch.length) return { w: SHEET.TILE_W, h: depth === 1 ? SHEET.CARD_H : SHEET.TILE_H };
    const lay = arrange(n, ch, depth);
    return { w: lay.w + 2 * SHEET.PAD, h: lay.h + SHEET.FRAME_HEAD + SHEET.PAD, lay };
  }
  function arrange(n, ch, depth) {
    // a band (depth 0) keeps one row unless told otherwise; a frame whose children call each other lays them out by dependency
    const order = (n.metadata && n.metadata.order) || (depth > 0 && edgesAmong(new Set(ch.map((c) => c.id))).length && dagre ? 'dependencies' : 'declared');
    const sized = ch.map((c) => ({ c, s: measure(c, depth + 1) }));
    if (order === 'alphabetical') sized.sort((a, b) => a.c.title.localeCompare(b.c.title));
    const innerW = depth === 0 ? SHEET.W : Math.max(SHEET.TILE_W, SHEET.W - depth * 2 * SHEET.PAD - 2 * SHEET.PAD);
    const pos = {}; let w = 0; let h = 0;
    if (order === 'dependencies' && dagre) {
      const g = new dagre.graphlib.Graph(); g.setGraph({ rankdir: 'TB', nodesep: SHEET.RGAP, ranksep: 46 }); g.setDefaultEdgeLabel(() => ({}));
      for (const { c, s } of sized) g.setNode(c.id, { width: s.w, height: s.h });
      for (const e of edgesAmong(new Set(ch.map((c) => c.id)))) if (e.source !== e.target) g.setEdge(e.source, e.target);
      dagre.layout(g);
      // wrap wide ranks, then centre each rank
      const ranks = new Map(); for (const { c } of sized) { const d = g.node(c.id); if (!ranks.has(d.y)) ranks.set(d.y, []); ranks.get(d.y).push(c.id); }
      let y = 0;
      for (const ry of [...ranks.keys()].sort((a, b) => a - b)) {
        const ids = ranks.get(ry).sort((a, b) => g.node(a).x - g.node(b).x);
        const rows = ids.length > SHEET.MAXCOL ? Math.ceil(ids.length / SHEET.MAXCOL) : 1; const cols = Math.ceil(ids.length / rows);
        let rowH = 0; const rowsOut = [];
        for (let r = 0; r < rows; r += 1) { const slice = ids.slice(r * cols, (r + 1) * cols); let x = 0; const hh = Math.max(...slice.map((id) => g.node(id).height)); for (const id of slice) { pos[id] = { x, y: y + rowsOut.reduce((s, rr) => s + rr, 0) + r * SHEET.GAP }; x += g.node(id).width + SHEET.RGAP; } rowsOut.push(hh); w = Math.max(w, x - SHEET.RGAP); rowH += hh + (r ? SHEET.GAP : 0); }
        // centre this rank's rows
        for (let r = 0; r < rows; r += 1) { const slice = ids.slice(r * cols, (r + 1) * cols); const rw = slice.reduce((s, id) => s + g.node(id).width, 0) + (slice.length - 1) * SHEET.RGAP; for (const id of slice) pos[id].x += (Math.max(w, rw) - rw) / 2; }
        y += rowH + 46;
      }
      h = y - 46;
      // re-centre every row against the final width
      for (const id of Object.keys(pos)) { /* widths already centred per rank against w; nothing to do */ }
    } else {
      // rows: at band level equal-width cards fill the row; nested leaves keep the tile size
      const leafOnly = sized.every(({ c }) => !c.children.length);
      if (depth === 0 && leafOnly) {
        // equal widths, capped so a band of one or two cards does not stretch them across the sheet
        const cw = Math.min(SHEET.CARD_MAX, (innerW - SHEET.GAP * (sized.length - 1)) / sized.length);
        const off = (innerW - (cw * sized.length + SHEET.GAP * (sized.length - 1))) / 2;
        sized.forEach(({ c, s }, i) => { pos[c.id] = { x: off + i * (cw + SHEET.GAP), y: 0 }; s.w = cw; });
        w = innerW; h = SHEET.CARD_H;
      } else {
        let x = 0; let y = 0; let rowH = 0; const rows = [[]];
        for (const { c, s } of sized) { if (x && x + s.w > innerW) { x = 0; y += rowH + SHEET.GAP; rowH = 0; rows.push([]); } pos[c.id] = { x, y }; rows[rows.length - 1].push({ id: c.id, w: s.w }); x += s.w + SHEET.RGAP; rowH = Math.max(rowH, s.h); w = Math.max(w, x - SHEET.RGAP); }
        h = y + rowH;
        if (depth === 0) {
          w = Math.max(w, innerW);
          // a band's rows are centred on the sheet, like its cards
          for (const row of rows) { const rw = row.reduce((t, r) => t + r.w, 0) + SHEET.RGAP * (row.length - 1); for (const r of row) pos[r.id].x += (innerW - rw) / 2; }
        }
      }
    }
    return { w, h, pos, sized };
  }
  function place(n, x, y, depth, size) {
    const ch = kids(n);
    if (!ch.length) { boxes[n.id] = { x, y, w: size.w, h: size.h }; tiles.push({ node: n, depth, ...boxes[n.id] }); return; }
    boxes[n.id] = { x, y, w: size.w, h: size.h };
    if (depth > 0) frames.push({ node: n, depth, ...boxes[n.id] });
    const ox = x + (depth === 0 ? 0 : SHEET.PAD); const oy = y + (depth === 0 ? 0 : SHEET.FRAME_HEAD);
    for (const { c, s } of size.lay.sized) { const p = size.lay.pos[c.id]; place(c, ox + p.x, oy + p.y, depth + 1, s); }
  }
  let y = 0;
  for (const band of roots) {
    const ch = kids(band);
    bands.push({ node: band, y, labelH: SHEET.LABEL });
    if (!ch.length) { y += SHEET.LABEL + SHEET.BAND_GAP; continue; }
    const lay = arrange(band, ch, 0);
    const size = { w: lay.w, h: lay.h, lay };
    const isFrameBand = band.kind !== 'zone' && (band.technology || band.description) && ch.some((c) => c.children.length);
    if (isFrameBand) {
      // a host-like band draws as a dashed boundary with its own tag row
      const bx = 0; const by = y + 22; const bh = lay.h + 2 * SHEET.PAD + 14;
      boxes[band.id] = { x: bx, y: by, w: SHEET.W, h: bh };
      frames.push({ node: band, depth: 0, boundary: true, x: bx, y: by, w: SHEET.W, h: bh });
      for (const { c, s } of lay.sized) { const p = lay.pos[c.id]; place(c, bx + Math.max(SHEET.PAD, p.x), by + SHEET.PAD + 14 + p.y, 1, s); }   // rows are centred on the sheet already
      bands[bands.length - 1].boundary = true; y = by + bh + SHEET.BAND_GAP;
    } else {
      for (const { c, s } of lay.sized) { const p = lay.pos[c.id]; place(c, p.x, y + SHEET.LABEL + p.y, 1, s); }
      y += SHEET.LABEL + lay.h + SHEET.BAND_GAP;
    }
  }
  const H = Math.max(y - SHEET.BAND_GAP, 10);
  // edges from boxes: down from the bottom edge, up from the top edge, sideways when level
  const cx = (b) => b.x + b.w / 2; const r1 = (v) => Math.round(v * 10) / 10;
  const spread = (b, list, id) => (list.length > 1 ? b.x + b.w * (list.indexOf(id) + 1) / (list.length + 1) : cx(b));
  const vert = (sx, sy, tx, ty) => { const k = (ty - sy) / 2; return `M${r1(sx)} ${r1(sy)} C${r1(sx)} ${r1(sy + k)} ${r1(tx)} ${r1(ty - k)} ${r1(tx)} ${r1(ty)}`; };
  const edges = view.edges.map((e) => {
    const s = boxes[e.source]; const t = boxes[e.target]; if (!s || !t) return null;
    const outs = view.edges.filter((x) => x.source === e.source && boxes[x.target]).map((x) => x.target).sort((a, b) => cx(boxes[a]) - cx(boxes[b]));
    const ins = view.edges.filter((x) => x.target === e.target && boxes[x.source]).map((x) => x.source).sort((a, b) => cx(boxes[a]) - cx(boxes[b]));
    let d;
    if (s.y + s.h <= t.y) d = vert(spread(s, outs, e.target), s.y + s.h, spread(t, ins, e.source), t.y);
    else if (t.y + t.h <= s.y) d = vert(spread(s, outs, e.target), s.y, spread(t, ins, e.source), t.y + t.h);
    else { const sx = cx(s); const tx = cx(t); const adjacent = Math.abs(tx - sx) < s.w + t.w; if (adjacent) { const left = tx < sx; const a = left ? s.x : s.x + s.w; const b = left ? t.x + t.w : t.x; d = `M${r1(a)} ${r1(s.y + s.h / 2)} L${r1(b)} ${r1(t.y + t.h / 2)}`; } else { const lift = Math.min(60, 18 + Math.abs(tx - sx) / 12); d = `M${r1(sx)} ${r1(s.y)} C${r1(sx)} ${r1(s.y - lift)} ${r1(tx)} ${r1(t.y - lift)} ${r1(tx)} ${r1(t.y)}`; } }
    return { ...e, d };
  }).filter(Boolean);
  return { kind: 'sheet', w: SHEET.W, h: H, bands, frames, tiles, edges, boxes };
}

/** Element and dynamic views: dagre with compound frames; rows without dagre. */
function layoutGraph(view, dagre) {
  const byId = Object.fromEntries(view.nodes.map((n) => [n.id, n]));
  const leaves = view.nodes.filter((n) => !n.children.length);
  const size = (n) => { const lines = wrap(n.description, 11, 196, 3).length; return { w: 220, h: 40 + (n.technology ? 16 : 0) + (lines ? lines * 15 + 10 : 0) + 8 }; };
  const boxes = {}; const frames = []; let W = 0; let H = 0; let edges = [];
  const dir = view.type === 'dynamic' ? 'LR' : (view.autoLayout || 'TopBottom').replace('TopBottom', 'TB').replace('LeftRight', 'LR').replace('BottomTop', 'BT').replace('RightLeft', 'RL');
  // dagre cannot lay out an edge whose end is a compound node (a frame): it throws mid-rank. Those
  // edges are left out of the layout and routed between the boxes afterwards.
  const isLeaf = (id) => byId[id] && !byId[id].children.length;
  let g = null;
  if (dagre) {
    try {
      g = new dagre.graphlib.Graph({ compound: true, multigraph: true }); g.setGraph({ rankdir: dir, nodesep: 28, ranksep: 70, marginx: 10, marginy: 10 }); g.setDefaultEdgeLabel(() => ({}));
      for (const n of leaves) { const sz = size(n); g.setNode(n.id, { width: sz.w, height: sz.h }); }
      for (const n of view.nodes) if (n.children.length) g.setNode(n.id, { label: n.title, clusterLabelPos: 'top' });
      for (const n of view.nodes) if (n.parent && byId[n.parent]) g.setParent(n.id, n.parent);
      for (const e of view.edges) if (e.source !== e.target && isLeaf(e.source) && isLeaf(e.target)) g.setEdge(e.source, e.target, { width: Math.min(160, (e.labels[0] || '').length * 6.2), height: e.labels.length ? 16 : 0, labelpos: 'c' }, e.id);
      dagre.layout(g);
    } catch { g = null; }   // a layout dagre cannot do falls back to rows rather than failing the view
  }
  if (g) {
    for (const n of leaves) { const d = g.node(n.id); boxes[n.id] = { x: d.x - d.width / 2, y: d.y - d.height / 2, w: d.width, h: d.height }; }
    for (const n of view.nodes) if (n.children.length) { const d = g.node(n.id); if (!d || !d.width) continue; const b = { x: d.x - d.width / 2 - 12, y: d.y - d.height / 2 - 30, w: d.width + 24, h: d.height + 42 }; boxes[n.id] = b; frames.push({ node: n, ...b }); }
    W = g.graph().width + 20; H = g.graph().height + 20;
    edges = view.edges.map((e) => { const ge = g.edge(e.source, e.target, e.id); if (!ge) return frameEdge(e); const pts = ge.points; let d = `M${pts[0].x} ${pts[0].y}`; for (let i = 1; i < pts.length - 1; i += 1) { const a = pts[i]; const b = pts[i + 1]; const last = i === pts.length - 2; d += ` Q${a.x} ${a.y} ${last ? b.x : (a.x + b.x) / 2} ${last ? b.y : (a.y + b.y) / 2}`; } if (pts.length === 2) d += ` L${pts[1].x} ${pts[1].y}`; return { ...e, d, lx: ge.x, ly: ge.y }; }).filter(Boolean);
    // frames: grow to contain children (dagre's cluster box can be tight)
    for (const f of frames) { for (const id of byId[f.node.id].children) { const b = boxes[id]; if (!b) continue; f.x = Math.min(f.x, b.x - 12); f.y = Math.min(f.y, b.y - 30); f.w = Math.max(f.w, b.x + b.w + 12 - f.x); f.h = Math.max(f.h, b.y + b.h + 12 - f.y); } boxes[f.node.id] = { x: f.x, y: f.y, w: f.w, h: f.h }; }
    // edges at a frame were deferred until the frames had their final boxes
    edges = edges.map((e) => (e.deferred ? routeBetween(e, boxes) : e)).filter(Boolean);
    // deepest frames drawn last so they sit on top of their parents
    frames.sort((a, b) => depthOf(byId, a.node) - depthOf(byId, b.node));
  } else {
    let x = 0; let y = 0; let rowH = 0;
    for (const n of leaves) { const s = size(n); if (x && x + s.w > 1100) { x = 0; y += rowH + 24; rowH = 0; } boxes[n.id] = { x, y, ...s }; x += s.w + 24; rowH = Math.max(rowH, s.h); W = Math.max(W, x); }
    H = y + rowH;
    const cx = (b) => b.x + b.w / 2;
    edges = view.edges.map((e) => { const s = boxes[e.source]; const t = boxes[e.target]; if (!s || !t) return null; return { ...e, d: `M${cx(s)} ${s.y + s.h} L${cx(t)} ${t.y}`, lx: (cx(s) + cx(t)) / 2, ly: (s.y + s.h + t.y) / 2 }; }).filter(Boolean);
  }
  return { kind: 'graph', w: W, h: H, boxes, frames, tiles: leaves.map((n) => ({ node: n, ...boxes[n.id] })), edges };
}
/** An edge dagre did not lay out (one end is a frame): marked, routed once the boxes are final. */
const frameEdge = (e) => ({ ...e, deferred: true });
/** A curve from the side of one box that faces the other to the facing side of the other. */
function routeBetween(e, boxes) {
  const s = boxes[e.source]; const t = boxes[e.target]; if (!s || !t) return null;
  const sc = { x: s.x + s.w / 2, y: s.y + s.h / 2 }; const tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  const vertical = Math.abs(tc.y - sc.y) * (s.w + t.w) >= Math.abs(tc.x - sc.x) * (s.h + t.h);
  let a; let b;
  if (vertical) { a = { x: sc.x, y: tc.y > sc.y ? s.y + s.h : s.y }; b = { x: tc.x, y: tc.y > sc.y ? t.y : t.y + t.h }; }
  else { a = { x: tc.x > sc.x ? s.x + s.w : s.x, y: sc.y }; b = { x: tc.x > sc.x ? t.x : t.x + t.w, y: tc.y }; }
  const r = (v) => Math.round(v * 10) / 10;
  const d = vertical
    ? `M${r(a.x)} ${r(a.y)} C${r(a.x)} ${r((a.y + b.y) / 2)} ${r(b.x)} ${r((a.y + b.y) / 2)} ${r(b.x)} ${r(b.y)}`
    : `M${r(a.x)} ${r(a.y)} C${r((a.x + b.x) / 2)} ${r(a.y)} ${r((a.x + b.x) / 2)} ${r(b.y)} ${r(b.x)} ${r(b.y)}`;
  const { deferred, ...rest } = e; void deferred;
  return { ...rest, d, lx: (a.x + b.x) / 2, ly: (a.y + b.y) / 2 };
}
const depthOf = (byId, n) => (n.parent && byId[n.parent] ? 1 + depthOf(byId, byId[n.parent]) : 0);

// ───────────────────────────────────────── SVG ─────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const badgesOf = (n, m) => { const t = n.instance ? (n.ownTechnology || '') : (m.deployment[n.id] ? n.technology : ''); return t ? t.split(' · ').map((s) => s.trim()).filter(Boolean) : []; };

function renderSVG(view, lay, m, pal, opts = {}) {
  const sel = opts.selected || null;
  const related = new Set(); if (sel) for (const e of lay.edges) { if (e.source === sel) related.add(e.target); if (e.target === sel) related.add(e.source); }
  const dim = (id) => (sel && id !== sel && !related.has(id) ? 0.38 : 1);
  const parts = [];
  const famOf = (n) => { const spec = m.spec.elements[n.kind] || m.spec.nodes[n.kind] || (n.instance && n.modelRef && m.elements[n.modelRef] ? m.spec.elements[m.elements[n.modelRef].kind] : null); const color = (n.style && n.style.color) || (spec && spec.style && spec.style.color) || 'slate'; return family(pal, m.spec, color); };
  const text = (x, y, s, size, fill, extra = '') => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;
  const tones = (tone) => (tone === 'amber' ? [pal.peachBg, pal.peachInk] : tone === 'green' ? [pal.greenBg, pal.greenInk] : tone === 'grey' ? [pal.field, pal.ink3] : [pal.indigoBg, pal.indigoInk]);
  const badgeW = (label) => label.length * 6.6 + 14;
  const badgeAt = (x, y, label, tone) => { const w = badgeW(label); const t = tones(tone); return `<rect x="${x}" y="${y}" width="${w}" height="16" rx="5" fill="${t[0]}"/>${text(x + w / 2, y + 11.5, label.toUpperCase(), 9.5, t[1], 'text-anchor="middle" font-weight="700" letter-spacing=".06em"')}`; };
  const badgeRow = (cx, y, labels, tone) => { const total = labels.reduce((s, l) => s + badgeW(l), 0) + (labels.length - 1) * 5; let x = cx - total / 2; return labels.map((l) => { const svg = badgeAt(x, y, l, /^default$/i.test(l) ? 'grey' : tone); x += badgeW(l) + 5; return svg; }).join(''); };

  if (lay.kind === 'sheet') {
    parts.push(`<rect x="-40" y="-30" width="${lay.w + 80}" height="${lay.h + 60}" fill="${pal.canvas}"/>`);
    for (const b of lay.bands) if (!b.boundary) { parts.push(text(0, b.y + 12, b.node.title.toUpperCase(), 11, pal.ink3, 'font-weight="700" letter-spacing=".18em"')); const lw = b.node.title.length * 8.2 + 14; parts.push(`<line x1="${lw}" y1="${b.y + 8}" x2="${lay.w}" y2="${b.y + 8}" stroke="${pal.line2}"/>`); }
    for (const f of lay.frames) {
      if (f.boundary) {
        parts.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="18" fill="${pal.field}" stroke="${pal.seq}" stroke-width="2" stroke-dasharray="6 5"/>`);
        let x = f.x + 22; const tw = f.node.title.length * 7.4 + 30;
        parts.push(`<rect x="${x}" y="${f.y - 14}" width="${tw}" height="26" rx="13" fill="${pal.ink}"/>${text(x + tw / 2, f.y + 3.5, f.node.title.toUpperCase(), 11, pal.onInk, 'text-anchor="middle" font-weight="700" letter-spacing=".12em"')}`); x += tw + 8;
        for (const b of badgesOf(f.node, m)) { const w = b.length * 7.2 + 30; parts.push(`<rect x="${x}" y="${f.y - 14}" width="${w}" height="26" rx="13" fill="${pal.peachBg}" stroke="${pal.peachLine}"/>${text(x + w / 2, f.y + 3.5, b.toUpperCase(), 11, pal.peachInk, 'text-anchor="middle" font-weight="700" letter-spacing=".08em"')}`); x += w + 8; }
      } else {
        parts.push(`<g opacity="${dim(f.node.id)}"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="12" fill="${pal.panel}" stroke="${pal.line2}"/>${text(f.x + f.w / 2, f.y + 23, f.node.title, 15, pal.ink, 'text-anchor="middle" font-weight="700"')}${badgeRow(f.x + f.w / 2, f.y + 31, badgesOf(f.node, m), 'blue')}</g>`);
      }
    }
    // edges under tiles
    // a dense sheet draws its edges quieter at rest; hovering or selecting a tile lights its own up
    const rest = lay.edges.length > 40 ? 0.32 : lay.edges.length > 20 ? 0.5 : 0.8;
    parts.push(`<g fill="none" stroke-linecap="round">${lay.edges.map((e) => { const on = sel && (e.source === sel || e.target === sel); const out = sel && e.source === sel; const col = !sel ? pal.indigo : on ? (out ? pal.indigoInk : pal.amber) : pal.indigo; const op = !sel ? rest : on ? 1 : 0.08; const w = on ? 2.4 : 1.6; return `<path d="${e.d}" stroke="${col}" stroke-width="${w}" opacity="${op}" marker-end="url(#${out ? 'c4-ao' : on ? 'c4-ai' : 'c4-a'})"><title>${esc(e.labels.join('; '))}</title></path>`; }).join('')}</g>`);
    for (const t of lay.tiles) {
      const n = t.node; const fam = famOf(n); const card = t.depth === 1 && !lay.frames.some((f) => f.node.id === n.parent && !f.boundary);
      const gate = (n.tags || []).includes('gate'); const o = dim(n.id); const isSel = n.id === sel;
      const fill = card || t.depth === 1 ? pal.panel : (gate ? pal.amberWash : pal.field); const stroke = isSel ? pal.ink : gate ? pal.amberLine : pal.line2;
      parts.push(`<g class="c4-node" data-id="${esc(n.id)}" opacity="${o}" style="cursor:pointer"><rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="${card ? 12 : 9}" fill="${fill}" stroke="${stroke}" stroke-width="${isSel ? 2 : 1}"/>`);
      if (card || t.h >= SHEET.CARD_H) {
        const bl = badgesOf(n, m); const lines = wrap(n.title, 14.5, t.w - 20, 2);
        const block = lines.length * 17 + (bl.length ? 22 : 0); let ty = t.y + (t.h - block) / 2 + 13;
        lines.forEach((l) => { parts.push(text(t.x + t.w / 2, ty, l, 14.5, pal.ink, 'text-anchor="middle" font-weight="700"')); ty += 17; });
        if (bl.length) parts.push(badgeRow(t.x + t.w / 2, ty - 10, bl, lay.bands.find((b) => b.node.id === n.parent) ? (lay.bands.findIndex((b) => b.node.id === n.parent) === 0 ? 'amber' : 'green') : 'blue'));
      } else {
        const bl = badgesOf(n, m);
        parts.push(`<rect x="${t.x + 1}" y="${t.y + 1}" width="5" height="${t.h - 2}" rx="2" fill="${fam.bg}"/>`);
        // a long title wraps onto a second line when the tile has no badge row to make room for
        const tl = bl.length ? [ell(n.title, 12.5, t.w - 22)] : wrap(n.title, 12, t.w - 22, 2);
        if (tl.length === 2) tl.forEach((l, i) => parts.push(text(t.x + 14, t.y + 18 + i * 14.5, l, 12, pal.ink, 'font-weight="600"')));
        else parts.push(text(t.x + 14, t.y + (bl.length ? 18 : t.h / 2 + 4.5), tl[0], 12.5, pal.ink, 'font-weight="600"'));
        if (bl.length) parts.push(badgeRow(t.x + t.w / 2, t.y + 24, bl, 'grey'));
      }
      parts.push('</g>');
    }
  } else {
    parts.push(`<rect x="-40" y="-30" width="${lay.w + 80}" height="${lay.h + 60}" fill="${pal.canvas}"/>`);
    for (const f of lay.frames) parts.push(`<g opacity="${dim(f.node.id)}"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="14" fill="${pal.panel}" fill-opacity=".55" stroke="${pal.line2}" stroke-dasharray="5 4"/>${text(f.x + 14, f.y + 19, f.node.title, 11, pal.ink3, 'font-family="' + MONO + '" font-weight="500" letter-spacing=".02em"')}</g>`);
    parts.push(`<g fill="none" stroke-linecap="round">${lay.edges.map((e) => { const on = sel && (e.source === sel || e.target === sel); const out = sel && e.source === sel; const loop = e.kinds.includes('loop') || (m.spec.relationships[e.kinds[0]] && m.spec.relationships[e.kinds[0]].style.color === 'amber'); const col = loop ? pal.amber : !sel ? pal.seq : on ? (out ? pal.indigoInk : pal.amber) : pal.seq; const op = !sel ? 1 : on ? 1 : 0.15; const dash = loop ? ' stroke-dasharray="6 5"' : (m.spec.relationships[e.kinds[0]] && m.spec.relationships[e.kinds[0]].style.line === 'dotted') ? ' stroke-dasharray="2 4"' : ''; const label = e.step ? `${e.step}. ${e.labels[0] || ''}` : (e.labels[0] || ''); return `<path d="${e.d}" stroke="${col}" stroke-width="${on ? 2.4 : 1.8}" opacity="${op}"${dash} marker-end="url(#${loop ? 'c4-am' : out ? 'c4-ao' : on ? 'c4-ai' : 'c4-ag'})"><title>${esc(e.labels.join('; '))}</title></path>${label && e.lx != null ? `<g opacity="${op}"><rect x="${e.lx - Math.min(160, label.length * 6.2) / 2 - 5}" y="${e.ly - 9}" width="${Math.min(160, label.length * 6.2) + 10}" height="17" rx="4" fill="${pal.panel}" stroke="${pal.line}"/>${text(e.lx, e.ly + 3.5, ell(label, 10.5, 160), 10.5, pal.ink2, 'text-anchor="middle" font-family="' + MONO + '"')}</g>` : ''}`; }).join('')}</g>`);
    for (const t of lay.tiles) {
      const n = t.node; const fam = famOf(n); const isSel = n.id === sel; const o = dim(n.id);
      parts.push(`<g class="c4-node" data-id="${esc(n.id)}" opacity="${o}" style="cursor:pointer"><rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="12" fill="${pal.panel}" stroke="${isSel ? pal.ink : pal.line2}" stroke-width="${isSel ? 2 : 1.5}"/>`);
      parts.push(`<path d="M${t.x + 1} ${t.y + 12} q0 -11 11 -11 h${t.w - 24} q11 0 11 11 v22 h-${t.w - 2} z" fill="${fam.bg}"/>`);
      parts.push(text(t.x + 12, t.y + 22, ell(n.title, 13, t.w - 24), 13, fam.ink, 'font-weight="600"'));
      let y = t.y + 34 + 14;
      if (n.technology) { parts.push(text(t.x + 12, y, ell(n.technology, 10, t.w - 24), 10, pal.ink3, 'font-family="' + MONO + '"')); y += 16; }
      for (const l of wrap(n.description, 11, t.w - 24, 3)) { parts.push(text(t.x + 12, y + 2, l, 11, pal.ink2)); y += 15; }
      parts.push('</g>');
    }
  }
  const mk = (id, col) => `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0.8L9 5L0 9.2z" fill="${col}"/></marker>`;
  const defs = `<defs>${mk('c4-a', pal.indigo)}${mk('c4-ao', pal.indigoInk)}${mk('c4-ai', pal.amber)}${mk('c4-am', pal.amber)}${mk('c4-ag', pal.seq)}</defs>`;
  return { inner: defs + parts.join(''), w: lay.w, h: lay.h };
}

// ───────────────────────────────────── web component ─────────────────────────────────────

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', fit: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><circle cx="12" cy="12" r="2.2"/>', dl: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>', chev: '<path d="M9 6l6 6-6 6"/>', full: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>',
};
const CSS = `
:host{display:block;position:relative;min-height:240px;font-family:${FONT};color:var(--ink,#19191B);--c4-panel:var(--panel,#fff);--c4-line:var(--line-2,#E3E3E0);--c4-field:var(--field,#F6F6F4)}
:host([hidden]){display:none}
:host(:fullscreen){background:var(--bg,#F1F1EF)}
:host(:fullscreen) .wrap{border-radius:0;border:0}
.wrap{position:absolute;inset:0;display:flex;overflow:hidden;border:1px solid var(--c4-line);border-radius:var(--r-sm);background:var(--canvas-2,#FBFBF9)}
.stage{position:relative;flex:1 1 auto;min-width:0;overflow:hidden;touch-action:none;cursor:grab;outline:none;background:var(--canvas-2,#FBFBF9) radial-gradient(circle,var(--line-2,#E3E3E0) 1.1px,transparent 1.1px);background-size:22px 22px}
.stage.panning{cursor:grabbing}
svg.sheet{position:absolute;left:0;top:0;transform-origin:0 0;overflow:visible}
.nav{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;z-index:3}
.nav button,.bar button{width:30px;height:30px;padding:0;display:grid;place-items:center;border:1px solid var(--c4-line);border-radius:var(--r-sm);background:var(--c4-panel);color:var(--ink-2,#5C5C63);box-shadow:0 2px 12px rgba(25,25,27,.04);cursor:pointer;font-family:inherit}
.nav button:hover,.bar button:hover{background:var(--hover,#EBEBE8);color:var(--ink,#19191B)}
.nav svg,.bar svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.bar{position:absolute;left:12px;top:12px;display:flex;gap:6px;z-index:3;align-items:center}
.bar select{height:30px;border:1px solid var(--c4-line);border-radius:var(--r-sm);background:var(--c4-panel);color:var(--ink,#19191B);font:500 12.5px ${FONT};padding:0 28px 0 10px;appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 15px) 12px,calc(100% - 10px) 12px;background-size:5px 5px;background-repeat:no-repeat;max-width:260px}
.bar .cnt{font:11px ${MONO};color:var(--ink-3,#9A9AA1);white-space:nowrap}
.rail{flex:0 0 300px;border-left:1px solid var(--c4-line);background:var(--c4-panel);overflow:auto;padding:13px 15px 20px;display:none}
:host([info]) .rail{display:block}
@media (max-width:760px){:host([info]) .rail{display:none}}
.rail h3{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em}
.rail .sub{margin-top:4px;font:10.5px/1.4 ${MONO};color:var(--ink-3,#9A9AA1);overflow-wrap:anywhere}
.rail .head{padding-bottom:11px;margin-bottom:13px;border-bottom:1px solid var(--line,#ECECEA)}
.rail p{margin:0 0 12px;font-size:12px;line-height:1.55;color:var(--ink-2,#5C5C63)}
.rail .z{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3,#9A9AA1);margin:12px 0 7px}
.rail .it{display:flex;align-items:flex-start;gap:8px;padding:6px 9px;border-radius:var(--r-sm);background:var(--c4-field);margin-bottom:4px;font-size:12px}
.rail .it i{flex:none;width:9px;height:9px;border-radius:50%;background:var(--ink,#19191B);margin-top:4px}
.rail .it .n{flex:1 1 auto;min-width:0;color:var(--ink,#19191B);font-weight:500}
.rail .it .t{flex:0 0 auto;max-width:45%;text-align:right;font:10px/1.4 ${MONO};color:var(--ink-3,#9A9AA1)}
.rail .crit{font-size:12px;line-height:1.5;color:var(--ink-2,#5C5C63);background:var(--amber-wash,#FEF7EC);border:1px solid var(--amber-line,#F5D9A8);border-radius:var(--r-sm);padding:8px 10px;white-space:pre-wrap}
.rail code{font:11px ${MONO};color:var(--ink-2,#5C5C63);background:var(--c4-field);border-radius:var(--r-xs);padding:1px 5px}
.msg{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:var(--ink-2,#5C5C63);font-size:13px}
.msg.err{color:var(--red-ink,#C5483A)}
`;

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;
export class WorcaC4 extends Base {
  static get observedAttributes() { return ['src', 'view', 'info', 'toolbar']; }
  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="stage" tabindex="0" aria-label="C4 diagram"><div class="msg">Load a .c4 file.</div></div><div class="rail"></div></div>`;
    this._stage = this._root.querySelector('.stage'); this._rail = this._root.querySelector('.rail');
    this._T = { x: 0, y: 0, z: 1 }; this._sel = null; this._views = []; this._viewId = null; this._model = null; this._lay = null;
    this.dagre = null;
  }
  connectedCallback() { if (!this._bound) { this._bind(); this._bound = true; } this._attach(); if (this.getAttribute('src') && !this._model) this._fetch(this.getAttribute('src')); }
  attributeChangedCallback(name, _o, v) { if (name === 'src' && v && this._bound) this._fetch(v); if (name === 'view' && this._model) this.view = v; }

  get views() { return this._views.map((v) => ({ id: v.id, type: v.type, title: v.title, description: v.description })); }
  get view() { return this._viewId; }
  set view(id) { if (!this._views.length) { this._pendingView = id; return; } const v = this._views.find((x) => x.id === id) || this._views[0]; this._viewId = v.id; this._sel = null; this._render(true); }
  get selected() { return this._sel; }
  set selected(id) { this._sel = id || null; this._render(false); this._info(); }

  async _fetch(url) { try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); const t = await r.text(); this.load(t); } catch (e) { this._error(`Could not load ${url}: ${e.message}`); } }
  /** Load LikeC4 source text, a LikeC4 JSON export (object or string), or an already parsed model. */
  load(input) {
    try {
      let m;
      if (typeof input === 'string') { const s = input.trim(); m = s.startsWith('{') ? fromExport(JSON.parse(s)) : parseC4(s); }
      else if (input && input.elements && input.spec) m = input;
      else m = fromExport(input);
      this._model = m; this._views = buildViews(m);
      if (!this._views.length) { this._error('The file declares no views.'); return; }
      const want = this._pendingView || this.getAttribute('view'); this._pendingView = null;
      const v = this._views.find((x) => x.id === want) || this._views.find((x) => x.type === 'deployment') || this._views[0];
      this._viewId = v.id; this._sel = null;
      this._mountChrome(); this._render(true);
      this.dispatchEvent(new CustomEvent('c4-ready', { detail: { views: this.views, problems: m.problems || [] } }));
    } catch (e) { this._error(e.message); this.dispatchEvent(new CustomEvent('c4-error', { detail: { message: e.message } })); }
  }
  _error(msg) { this._stage.innerHTML = `<div class="msg err">${esc(msg)}</div>`; }

  _mountChrome() {
    this._stage.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'sheet'); this._svg = svg; this._stage.appendChild(svg);
    if (this.hasAttribute('toolbar')) {
      const bar = document.createElement('div'); bar.className = 'bar';
      const sel = document.createElement('select'); sel.setAttribute('aria-label', 'View');
      for (const v of this._views) { const o = document.createElement('option'); o.value = v.id; o.textContent = v.title; sel.appendChild(o); }
      sel.addEventListener('change', () => { this.view = sel.value; });
      this._select = sel; bar.appendChild(sel);
      const cnt = document.createElement('span'); cnt.className = 'cnt'; this._cnt = cnt; bar.appendChild(cnt);
      const dl = document.createElement('button'); dl.type = 'button'; dl.title = 'Download JPEG'; dl.setAttribute('aria-label', 'Download as JPEG'); dl.innerHTML = `<svg viewBox="0 0 24 24">${ICON.dl}</svg>`;
      dl.addEventListener('click', async () => { const blob = await this.export({ format: 'jpeg', scale: 2 }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${this._viewId}.jpg`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
      bar.appendChild(dl); this._stage.appendChild(bar);
    }
    const nav = document.createElement('div'); nav.className = 'nav';
    const navItems = [['plus', () => this.zoom(1.2), 'Zoom in'], ['minus', () => this.zoom(1 / 1.2), 'Zoom out'], ['fit', () => this.fit(), 'Fit']];
    if (this.hasAttribute('fullscreen') && typeof this.requestFullscreen === 'function') navItems.push(['full', () => this.toggleFullscreen(), 'Full screen']);
    for (const [k, fn, label] of navItems) { const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`; b.addEventListener('click', fn); nav.appendChild(b); }
    this._stage.appendChild(nav);
  }

  _layout() {
    const v = this._views.find((x) => x.id === this._viewId); const dagre = this.dagre || (typeof window !== 'undefined' ? window.dagre : null);
    this._lay = v.type === 'deployment' ? layoutSheet(v, dagre) : layoutGraph(v, dagre);
    this._pal = readPalette(this);
    this._cur = v;
  }
  _render(relayout) {
    if (!this._model) return;
    if (relayout || !this._lay) this._layout();
    const { inner, w, h } = renderSVG(this._cur, this._lay, this._model, this._pal, { selected: this._sel || this._hover || null });
    this._svg.setAttribute('width', w); this._svg.setAttribute('height', h); this._svg.innerHTML = inner;
    if (this._select) this._select.value = this._viewId;
    if (this._cnt) this._cnt.textContent = `${this._lay.tiles.length} elements · ${this._lay.edges.length} ${this._cur.type === 'dynamic' ? 'steps' : 'relationships'}`;
    if (relayout) { this.fit(); this._info(); }
  }
  _apply() { this._svg.style.transform = `translate(${this._T.x}px,${this._T.y}px) scale(${this._T.z})`; }
  fit() { if (!this._lay) return; const r = this._stage.getBoundingClientRect(); const pad = 28; const top = this.hasAttribute('toolbar') ? 52 : pad; const z = Math.min((r.width - 2 * pad) / this._lay.w, (r.height - top - pad) / this._lay.h, 1.25); this._T = { x: (r.width - this._lay.w * z) / 2, y: top + (r.height - top - pad - this._lay.h * z) / 2, z: Math.max(0.1, z) }; this._apply(); }
  zoom(f, sx, sy) { const r = this._stage.getBoundingClientRect(); const px = sx ?? r.width / 2; const py = sy ?? r.height / 2; const z = Math.max(0.1, Math.min(2.5, this._T.z * f)); const wx = (px - this._T.x) / this._T.z; const wy = (py - this._T.y) / this._T.z; this._T = { x: px - wx * z, y: py - wy * z, z }; this._apply(); }

  _bind() {
    const st = this._stage; let drag = null; let moved = false; const pts = new Map();
    const span = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    st.addEventListener('pointerdown', (e) => { if (e.button !== 0 && e.pointerType === 'mouse') return; if (e.pointerType === 'mouse') { drag = { x: e.clientX, y: e.clientY }; moved = false; } else { if (!pts.size) moved = false; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); } });
    const move = (e) => {
      if (e.pointerType === 'mouse') { if (!drag) return; if (!e.buttons) { drag = null; st.classList.remove('panning'); return; } const dx = e.clientX - drag.x; const dy = e.clientY - drag.y; if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return; moved = true; st.classList.add('panning'); drag = { x: e.clientX, y: e.clientY }; this._T.x += dx; this._T.y += dy; this._apply(); return; }
      const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x; const dy = e.clientY - p.y;
      if (pts.size === 1) { if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return; moved = true; p.x = e.clientX; p.y = e.clientY; this._T.x += dx; this._T.y += dy; this._apply(); }
      else if (pts.size === 2) { const before = span(); p.x = e.clientX; p.y = e.clientY; const after = span(); const a = [...pts.values()]; const r = st.getBoundingClientRect(); moved = true; if (before > 0) this.zoom(after / before, (a[0].x + a[1].x) / 2 - r.left, (a[0].y + a[1].y) / 2 - r.top); }
    };
    const up = (e) => { if (e.pointerType === 'mouse') { drag = null; st.classList.remove('panning'); } else pts.delete(e.pointerId); };
    // Window- and document-level listeners live only while the element is connected (_attach /
    // _detach): a viewer opened and closed in a dialog a hundred times must not leave a hundred.
    this._globals = [[window, 'pointermove', move], [window, 'pointerup', up], [window, 'pointercancel', up]];
    st.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = st.getBoundingClientRect(); this.zoom(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    st.addEventListener('click', (e) => { if (moved) { moved = false; return; } if (e.target.closest('button,select')) return; const g = e.target.closest('.c4-node'); const id = g ? g.dataset.id : null; this._sel = id; this._render(false); this._info(); this.dispatchEvent(new CustomEvent('c4-select', { detail: { id, node: id ? this._cur.nodes.find((n) => n.id === id) : null } })); });
    st.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this._sel = null; this._render(false); this._info(); } });
    // hover previews a tile's relationships; a click pins them (selection wins over hover)
    st.addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse' || drag) return; const g = e.target.closest && e.target.closest('.c4-node'); const id = g ? g.dataset.id : null; if (id === this._hover) return; this._hover = id; if (!this._sel) this._render(false); });
    st.addEventListener('pointerleave', () => { if (this._hover) { this._hover = null; if (!this._sel) this._render(false); } });
    if (typeof ResizeObserver === 'function') { let lastW = 0; let lastH = 0; this._ro = new ResizeObserver(() => { const w = st.clientWidth; const h = st.clientHeight; if (w && (w !== lastW || h !== lastH)) { lastW = w; lastH = h; if (this._lay) this.fit(); } }); }
    this._mq = window.matchMedia('(prefers-color-scheme: dark)'); this._onScheme = () => this._render(true);
    this._mo = new MutationObserver(() => this._render(true));
  }
  _attach() {
    for (const [t, ev, fn] of this._globals) t.addEventListener(ev, fn);
    if (this._ro) this._ro.observe(this._stage);
    this._mq.addEventListener('change', this._onScheme);
    this._mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  _detach() {
    for (const [t, ev, fn] of this._globals) t.removeEventListener(ev, fn);
    if (this._ro) this._ro.disconnect();
    this._mq.removeEventListener('change', this._onScheme);
    this._mo.disconnect();
  }
  disconnectedCallback() { if (this._bound) this._detach(); }
  /** The browser's full screen for this element; a second call leaves it. */
  toggleFullscreen() {
    if (document.fullscreenElement === this) { document.exitFullscreen().catch(() => {}); return; }
    if (typeof this.requestFullscreen === 'function') this.requestFullscreen().catch(() => {});
  }

  _info() {
    if (!this.hasAttribute('info') || !this._cur) return;
    const v = this._cur; const m = this._model; const el = (t, c, s) => { const n = document.createElement(t); if (c) n.className = c; if (s != null) n.textContent = s; return n; };
    const rail = this._rail; rail.replaceChildren();
    const head = el('div', 'head');
    if (!this._sel) {
      head.append(el('h3', '', v.title), el('div', 'sub', `${v.type} view${v.of ? ` of ${v.of}` : ''}`)); rail.appendChild(head);
      if (v.description) rail.appendChild(el('p', '', v.description));
      rail.appendChild(el('p', '', v.type === 'deployment' ? 'Select a box to light up its dependencies: blue for what it calls, amber for what calls it.' : 'Select a card to see what it is and what it connects to.'));
      if (v.type === 'deployment') { const crit = v.nodes.filter((n) => n.metadata && n.metadata.criteria); if (crit.length) { rail.appendChild(el('div', 'z', 'Placement criteria')); for (const n of crit) { rail.appendChild(el('div', 'z', n.title)); rail.appendChild(el('div', 'crit', n.metadata.criteria)); } } }
      return;
    }
    const n = v.nodes.find((x) => x.id === this._sel); if (!n) return;
    const parent = n.parent ? v.nodes.find((x) => x.id === n.parent) : null;
    head.append(el('h3', '', n.title), el('div', 'sub', [parent ? parent.title : null, n.technology].filter(Boolean).join(' · '))); rail.appendChild(head);
    if (n.description) rail.appendChild(el('p', '', n.description));
    const code = el('p'); code.appendChild(el('code', '', n.modelRef || n.id)); rail.appendChild(code);
    if (n.metadata && n.metadata.criteria) { rail.appendChild(el('div', 'z', 'Criteria')); rail.appendChild(el('div', 'crit', n.metadata.criteria)); }
    const list = (zone, items) => { if (!items.length) return; rail.appendChild(el('div', 'z', zone)); for (const it of items) { const row = el('div', 'it'); row.append(el('i'), el('span', 'n', it.label || '(unlabelled)'), el('span', 't', it.other)); rail.appendChild(row); } };
    const title = (id) => (v.nodes.find((x) => x.id === id) || {}).title || id;
    list('Incoming', this._lay.edges.filter((e) => e.target === n.id).map((e) => ({ label: e.labels.join('; '), other: title(e.source) })));
    list('Outgoing', this._lay.edges.filter((e) => e.source === n.id).map((e) => ({ label: e.labels.join('; '), other: title(e.target) })));
    void m;
  }

  /** Rasterise the current view. { format: 'jpeg'|'png', scale, background, font: { family, dataUrl } } → Blob */
  async export({ format = 'jpeg', scale = 2, background = null, font = null, view = null } = {}) {
    const v = view ? this._views.find((x) => x.id === view) : this._cur; if (!v) throw new Error('no view');
    const dagre = this.dagre || window.dagre; const lay = v === this._cur ? this._lay : (v.type === 'deployment' ? layoutSheet(v, dagre) : layoutGraph(v, dagre));
    const pal = this._pal || readPalette(this);
    const { inner, w, h } = renderSVG(v, lay, this._model, pal, { selected: null });
    const pad = 40; const W = Math.ceil(w + 2 * pad); const H = Math.ceil(h + 2 * pad);
    const fontCss = font && font.dataUrl ? `<style>@font-face{font-family:'${font.family || 'Poppins'}';src:url(${font.dataUrl}) format('woff2')}</style>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${-pad} ${-pad} ${W} ${H}">${fontCss}<rect x="${-pad}" y="${-pad}" width="${W}" height="${H}" fill="${background || pal.canvas}"/>${inner}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('SVG rasterisation failed')); i.src = url; });
      const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale; const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
      return await new Promise((res) => c.toBlob(res, format === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    } finally { URL.revokeObjectURL(url); }
  }
  /** The SVG markup of the current view, standalone. */
  toSVG() { const { inner, w, h } = renderSVG(this._cur, this._lay, this._model, this._pal, { selected: null }); return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 80}" height="${h + 60}" viewBox="-40 -30 ${w + 80} ${h + 60}">${inner}</svg>`; }
}

if (typeof customElements !== 'undefined' && !customElements.get('worca-c4')) customElements.define('worca-c4', WorcaC4);

/** Headless use (node, tests, the render script): the SVG string for a view, with a fixed palette. */
export function renderToSVG(model, viewId, { dagre = null, dark = false } = {}) {
  const views = buildViews(model); const v = views.find((x) => x.id === viewId) || views[0]; if (!v) throw new Error('no such view');
  const lay = v.type === 'deployment' ? layoutSheet(v, dagre) : layoutGraph(v, dagre);
  const pal = { ...(dark ? FALLBACK.dark : FALLBACK.light), dark };
  const { inner, w, h } = renderSVG(v, lay, model, pal, {});
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 80}" height="${h + 60}" viewBox="-40 -30 ${w + 80} ${h + 60}">${inner}</svg>`, view: v, width: w + 80, height: h + 60 };
}
