// tools/split-by-feature/after-split.mjs — guards for a tree that is already split (#919). A PR that started before the
// split must not slip the old layout in quietly: a movable route left in the residual ui/server.mjs, a route above its
// static mount that is not central, or a monolith kept next to ui/public/parts.json, is a problem that names the
// catch-up command.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planRoutes, parseModule, routeCalls, VERBS } from './routes.mjs';
import { featureForRoute } from './plan.mjs';

/** The first statement of the old move region on a split tree: patchServer's parts-aware static mount (ASSET_BLOCK). */
export const SPLIT_START_ANCHOR = 'app.use(function servePublic(';
const MONOLITHS = Object.freeze({ 'style.css': '/style.css', 'index.html': 'the page' });

/** `npm run split:catch-up -- BRANCH` for the branch checked out at `root`, or the placeholder outside a branch. */
export function catchUpCommand(root) {
  let b = '';
  try { b = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return `npm run split:catch-up -- ${b && b !== 'HEAD' ? b : '<branch>'}`;
}

/**
 * Route statements in the old move region (servePublic … SPA fallback) that the split's own rules would move, and whose
 * key is not a baseline pin. Unmapped routes keep the coverage message. Routes above the static mount are not checked here (see topZoneRouteProblems).
 */
export function residualRouteProblems(serverSrc, map, pinnedKeys, cmd) {
  let plan;
  try { plan = planRoutes(serverSrc, map, { startAnchor: SPLIT_START_ANCHOR }); }
  catch (err) { return [`${err.message} (ui/server.mjs:1)`]; }
  const out = [...plan.problems];
  for (const [i, { key }] of plan.routeInfo) {
    const g = plan.group.get(i);
    if (g === undefined || pinnedKeys.has(key)) continue;
    out.push(`route ${key.replaceAll('"', '')} (ui/server.mjs:${plan.body[i].loc.start.line}) belongs in ui/routes/${g.slice(0, g.lastIndexOf('#'))}/ — run ${cmd}`);
  }
  return out;
}

/**
 * Route statements above the static mount (the top of ui/server.mjs: sign-in, guards, body limits) whose `METHOD path`
 * is not in central-routes.json. The path is the string itself, or the argument's source text when it is not a string.
 */
export function topZoneRouteProblems(serverSrc, map, centralKeys, cmd) {
  let ast;
  try { ({ ast } = parseModule(serverSrc)); } catch { return []; }   // residualRouteProblems reports the same source
  const end = ast.body.findIndex((s) => serverSrc.startsWith(SPLIT_START_ANCHOR, s.start));
  const out = [];
  for (const s of ast.body.slice(0, Math.max(end, 0))) {
    for (const c of routeCalls(s)) {
      const p = c.pathNode;
      const path = p?.type === 'Literal' && typeof p.value === 'string' ? p.value : p ? serverSrc.slice(p.start, p.end) : '';
      const key = `${(c.method || '?').toUpperCase()} ${path}`;
      if (centralKeys.has(key)) continue;
      const f = typeof p?.value === 'string' ? featureForRoute(map, p.value) : null;
      out.push(`route ${key} (ui/server.mjs:${c.line}) belongs in ui/routes/${f ?? '<feature>'}/ — run ${cmd} (top of ui/server.mjs is for central sign-in and guards only)`);
    }
  }
  return out;
}

/** style.css or index.html kept next to parts.json: the app builds both from the parts, so the kept file is never served. */
export function keptMonolithProblems(publicDir, cmd) {
  if (!existsSync(join(publicDir, 'parts.json'))) return [];
  return Object.entries(MONOLITHS).filter(([f]) => existsSync(join(publicDir, f))).map(([f, what]) =>
    `ui/public/${f} next to ui/public/parts.json is not served: the app builds ${what} from the parts listed in parts.json, so this file's changes are lost — run ${cmd}`);
}

// Express 4 path syntax that Express 5 (path-to-regexp 8) refuses at registration, each with its Express 5 spelling.
const EXPRESS4_SYNTAX = [
  [/:(\w+)\(/, (m) => `:${m[1]}(…) has an inline regex, which Express 5 dropped: register :${m[1]} and check it in the handler (next() when it does not match)`],
  [/\/?:(\w+)\?/, (m) => `the optional :${m[1]}? is {/:${m[1]}} in Express 5`],
  [/\*(?![A-Za-z_$])/, () => 'a bare * is a named wildcard in Express 5: *splat (the handler reads req.params.splat, an array of segments, not req.params[0])'],
  [/[()[\]?+!]/, (m) => `"${m[0]}" is reserved in Express 5 paths: escape it (\\${m[0]}) or use a RegExp route`],
];
const ROUTE_METHODS = new Set([...VERBS, 'use', 'route']);

/**
 * Route paths in ui/server.mjs and ui/routes/** written in Express 4 syntax (a bare `*`, `:p?`, `:p(re)`, reserved
 * characters). dev is on Express 5, which throws on them when the server starts, so a caught-up Express 4 branch fails
 * here with the fix instead of at runtime. String and template paths starting with / of any x.METHOD(…) call; RegExp paths pass.
 */
export function express4SyntaxProblems(root) {
  const files = ['ui/server.mjs', ...(existsSync(join(root, 'ui/routes')) ? readdirSync(join(root, 'ui/routes'), { recursive: true })
    .map((f) => `ui/routes/${String(f).split('\\').join('/')}`).filter((f) => f.endsWith('.mjs')).sort() : [])];
  const out = [];
  for (const rel of files) {
    let ast;
    try { ({ ast } = parseModule(readFileSync(join(root, rel), 'utf8'))); } catch { continue; }   // a parse error fails the suite on its own
    (function walk(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && ROUTE_METHODS.has(n.callee.property.name)) {
        const arg = n.arguments[0];
        for (const a of arg?.type === 'ArrayExpression' ? arg.elements : [arg]) {
          const texts = a?.type === 'Literal' && typeof a.value === 'string' ? [a.value] : a?.type === 'TemplateLiteral' ? a.quasis.map((q) => q.value.cooked) : [];
          const path = a?.type === 'Literal' ? a.value : texts.join('${…}');
          if (texts[0] !== '' && !String(texts[0]).startsWith('/')) continue;   // a route path; not headers.get('x-…'), map.get(k)
          for (const t of texts) {
            const hit = EXPRESS4_SYNTAX.map(([re, fix]) => [re.exec(t), fix]).find(([m]) => m);
            if (hit) { out.push(`route ${n.callee.property.name.toUpperCase()} ${path} (${rel}:${a.loc.start.line}) uses Express 4 path syntax: ${hit[1](hit[0])} — dev is on Express 5`); break; }
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'range') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
      }
    })(ast);
  }
  return out;
}
