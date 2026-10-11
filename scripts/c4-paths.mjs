// scripts/c4-paths.mjs — where the Architecture (C4) cards look. Shared by c4Discover, c4Check and
// c4Render so the three agree on what "the project" is: the run's checkout on a single-project run,
// every member's checkout on a workspace run (ctx.repos on a detached run, ctx.workspace.members
// otherwise). Paths in the envelopes are member-relative with `/` separators, so a run on Windows
// and a run on macOS describe the same file the same way.
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** [{ key, name, dir }] — one entry per checkout the run spans. `key` identifies, `name` is for people. */
export function c4Roots(ctx = {}) {
  const members = ctx.workspace && Array.isArray(ctx.workspace.members) ? ctx.workspace.members.filter((m) => m && m.key) : [];
  const nameOf = (key) => (members.find((m) => m.key === key) || {}).name || key;
  if (Array.isArray(ctx.repos) && ctx.repos.length) return ctx.repos.filter((r) => r && r.dir).map((r) => ({ key: r.key, name: nameOf(r.key), dir: r.dir }));
  const withDir = members.filter((m) => m.dir);
  if (withDir.length) return withDir.map((m) => ({ key: m.key, name: m.name || m.key, dir: m.dir }));
  const dir = ctx.cwd || process.cwd();
  // a single-project run: the checkout is a worktree named after the run, the project folder is not
  const key = basename(ctx.projectDir || dir);
  return [{ key, name: key, dir }];
}

/** A path relative to its root, always with `/`. */
export function toPosixRel(root, file) {
  return relative(root, file).split(sep).join('/');
}

/** The absolute file an envelope ({ path, project? }) names, or null. */
export function resolveC4Path(env, ctx = {}) {
  const p = typeof env?.path === 'string' ? env.path.trim() : '';
  if (!p) return null;
  if (isAbsolute(p)) return p;
  const roots = c4Roots(ctx);
  const root = (env.project && roots.find((r) => r.key === env.project)) || roots[0];
  return join(root.dir, ...p.split('/'));
}

/** The command the architect runs to check a file: this Node, this checkout's CLI, quoted for any shell. */
export function c4CheckCommand() {
  const cli = fileURLToPath(new URL('./c4-check-cli.mjs', import.meta.url));
  return `"${process.execPath}" "${cli}" <FILE>`;
}
