// git-submodules: .gitmodules → consumes pkg 'git:<slug>' per submodule, target = '<slug>'
// ('github.com/acme/billing'), which resolves through the alias index to the member whose origin
// has that slug: P1's extract aliases every member's origin as `remoteSlug(origin)` (source
// 'git-remote'), and this detector normalises with the SAME P1 `remoteSlug`, so both sides agree.
// Relative submodule URLs ('../billing.git') resolve against this member's origin — git runs only
// then; without an origin they are unresolved.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { splitLines, fact, onePerKey, cleanUnresolved } from './lib/text.mjs';
import { resolveRelativeRemote } from './lib/git-remote.mjs';
import { remoteSlug } from '../../../shared/workspace-map/keys.mjs';

/** This checkout's origin URL, or null. git never looks above the member (GIT_CEILING_DIRECTORIES:
 *  a non-repo member inside another repo must not borrow that repo's origin), and an inherited
 *  GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_COMMON_DIR never points it at another repo. */
function originOf(dir) {
  try {
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
    const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, env, encoding: 'utf8', timeout: 10000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  ctx.state.subs ??= [];
  let cur = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/[#;][^]*$/, '');
    const head = /^\s*\[\s*submodule\s+"([^"]*)"\s*\]/.exec(line);
    if (head) { cur = { name: head[1], rel, lines }; ctx.state.subs.push(cur); return; }
    const kv = /^\s*(path|url)\s*=(.*)$/.exec(line);
    const val = kv ? kv[2].trim() : '';
    if (kv && cur && val) { cur[kv[1]] = val.replace(/^"(.*)"$/, '$1'); cur[`${kv[1]}Line`] = i + 1; }
  });
}

function finish(ctx) {
  // P1's extract already aliases every member's origin slug (source 'git-remote'); git runs here
  // only when a relative submodule URL needs this member's own origin.
  const needsOrigin = (ctx.state.subs || []).some((s) => s.url && /^\.\.?\//.test(s.url));
  const origin = needsOrigin ? originOf(ctx.member.dir) : null;
  const originNorm = origin ? remoteSlug(origin) : null;
  const aliases = [];
  const facts = [];
  const unresolved = [];
  for (const s of ctx.state.subs || []) {
    if (!s.url) continue;
    const relative = /^\.\.?\//.test(s.url);
    const norm = relative ? (originNorm ? resolveRelativeRemote(originNorm, s.url) : null) : remoteSlug(s.url);
    if (!norm) {
      unresolved.push({ kind: 'pkg', raw: s.url, file: s.rel, line: s.urlLine, reason: relative ? 'relative submodule url without origin' : 'not a network git remote' });
      continue;
    }
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `git:${norm}`, rel: s.rel, lines: s.lines, line: s.urlLine, needle: s.url, detail: `git submodule ${s.path || s.name}`, target: norm, confidence: 'exact' }));
  }
  return { facts: onePerKey(facts), aliases, unresolved: cleanUnresolved(ctx.state, null, unresolved) };
}

export default Object.freeze({
  id: 'git-submodules',
  claims: (rel) => rel === '.gitmodules',
  detect,
  finish,
});
