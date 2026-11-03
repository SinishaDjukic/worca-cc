// tools/split-by-feature/after-split.mjs — guards for a tree that is already split (#919). A PR that started before the
// split must not slip the old layout in quietly: a movable route left in the residual ui/server.mjs, a route above its
// static mount that is not central, or a monolith kept next to ui/public/parts.json, is a problem that names the
// catch-up command.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planRoutes, parseModule, routeCalls } from './routes.mjs';
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
