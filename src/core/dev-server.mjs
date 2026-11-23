// src/core/dev-server.mjs — the Browser tab's dev server offer (issue 1064): "Dev server: `npm run dev`, on a free Actions
// port — Use this", read from the project's package.json scripts (dev, then start). "Use this" saves it as a project Action
// (ui/server.mjs POST /api/projects/:key/dev-server) through the one Actions config, never a separate launch file.
// Reads only package.json and the lock file names; never runs anything.
import { open, access } from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import { join } from 'node:path';

const MAX_PACKAGE_BYTES = 1024 * 1024;
const SCRIPTS = Object.freeze(['dev', 'start']);
const LOCKS = Object.freeze([['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']]);
/** Tools that ignore PORT get their port flag; `port` is what they use when given none (held as a fixed port when
 *  no flag can reach them). */
const TOOLS = Object.freeze([
  { re: /\bvite(?![\w-])/, tool: 'vite', flag: '--port', port: 5173 },   // not vite-node
  { re: /\bastro\b/, tool: 'astro', flag: '--port', port: 4321 },
  { re: /\bng\s+(?:serve|s)\b/, tool: 'angular', flag: '--port', port: 4200 },
  { re: /\bwebpack(?:-dev-server|\s+serve)\b/, tool: 'webpack', flag: '--port', port: 8080 },
  { re: /\bparcel\b/, tool: 'parcel', flag: '--port', port: 1234 },
  { re: /\bgatsby\s+develop\b/, tool: 'gatsby', flag: '--port', port: 8000 },
  { re: /\bstorybook\b|\bstart-storybook\b/, tool: 'storybook', flag: '--port', port: 6006 },
  { re: /\bvue-cli-service\s+serve\b/, tool: 'vue-cli', flag: '--port', port: 8080 },
  { re: /\bwrangler\s+(?:pages\s+)?dev\b/, tool: 'wrangler', flag: '--port', port: 8787 },
  { re: /\beleventy\b|@11ty\/eleventy\b/, tool: 'eleventy', flag: '--port', port: 8080 },
  { re: /\breact-router\s+dev\b/, tool: 'react-router', flag: '--port', port: 5173 },   // Vite underneath
  { re: /\bvitepress\s+dev\b/, tool: 'vitepress', flag: '--port', port: 5173 },
  { re: /\bnext\b/, tool: 'next', flag: null, port: 3000 },
  { re: /\breact-scripts\s+start\b/, tool: 'react-scripts', flag: null, port: 3000 },
  { re: /\bnux[ti]\b/, tool: 'nuxt', flag: null, port: 3000 },
]);
// Several commands at once: an appended flag would land on the runner, not the server.
// A whole word only: not `next dev --turbo` (Next's bundler flag) or a `vite.nx.config.ts`.
const MULTI_RE = /(?<![\w.-])(?:concurrently|npm-run-all|run-p|run-s|turbo|nx|lerna)(?![\w.-])/;
const PINNED_RE = /(?:--port[=\s]+|(?:^|\s)-p\s*|(?:^|\s)PORT=)(\d{2,5})\b/;
// The last command of a chain: `a && b`, `a || b`, `a; b`, `a & b` (a background job), `a | b` (a pipe).
const CHAIN_RE = /&&|\|\||[;&|]/;
// Non-blocking: a FIFO named package.json would otherwise hold a libuv thread for good (isFile() refuses it after).
const READ_FLAGS = fsc.O_RDONLY | (fsc.O_NONBLOCK ?? 0);

async function readPackage(dir) {
  let fh;
  try {
    fh = await open(join(dir, 'package.json'), READ_FLAGS);
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_PACKAGE_BYTES) return null;
    const text = String(await fh.readFile('utf8'));
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);   // a BOM some editors write
  } catch { return null; } finally { await fh?.close(); }
}
const exists = (p) => access(p).then(() => true, () => false);

/** The install command a run's fresh checkout needs before the script finds its tools (node_modules is not in git),
 *  or null when package.json declares no dependencies. */
async function installOf(dir, pkg, manager) {
  const deps = ['dependencies', 'devDependencies'].some((k) => pkg[k] && typeof pkg[k] === 'object' && Object.keys(pkg[k]).length);
  if (!deps) return null;
  if (manager !== 'npm') return `${manager} install`;
  return (await exists(join(dir, 'package-lock.json')) || await exists(join(dir, 'npm-shrinkwrap.json'))) ? 'npm ci' : 'npm install';
}

async function managerOf(dir, pkg) {
  const field = typeof pkg.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager) : null;
  if (field) return field[1];
  for (const [file, pm] of LOCKS) if (await exists(join(dir, file))) return pm;
  return 'npm';
}

/**
 * The project's dev server, or null (no package.json, no dev or start script, or a script pinned below port 1024,
 * which an Action cannot hold). `cmd` is what the Action runs: the script, plus the tool's port flag when the tool
 * ignores PORT (`npm run dev -- --port {PORT}`). `pinned`: the Action's PORT row holds `port` instead of auto, when
 * the script names its own port, or when a tool that ignores PORT runs where no flag can reach it (behind a runner
 * such as concurrently, a pipe or a background `&`): it then listens on its default port. A script with no known
 * tool keeps auto (it most likely reads PORT); `port` is then only the guess the offer does not show. `setup`: the
 * install command a run's checkout needs first (it has no node_modules), or null when nothing is declared.
 */
export async function detectDevServer(dir) {
  const pkg = await readPackage(dir);
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : null;
  const script = scripts ? SCRIPTS.find((s) => typeof scripts[s] === 'string' && scripts[s].trim()) : null;
  if (!script) return null;
  const text = scripts[script].trim();
  const manager = await managerOf(dir, pkg);
  const command = `${manager} run ${script}`;
  const last = text.split(CHAIN_RE).pop();
  const hit = MULTI_RE.test(text) ? null : TOOLS.find((t) => t.re.test(last)) || null;
  // `PORT=<n>` pins only a script that reads PORT: Vite and the other flag tools ignore it and listen on their default.
  const found = PINNED_RE.exec(text);
  const pin = found && /PORT=$/.test(found[0].slice(0, -found[1].length)) && (hit?.flag || (!hit && TOOLS.some((t) => t.flag && t.re.test(text))))
    ? null : found;
  const pinnedPort = pin ? Number(pin[1]) : null;
  if (pinnedPort != null && (pinnedPort < 1024 || pinnedPort > 65535)) return null;
  const flag = !pin && hit?.flag ? `${manager === 'npm' ? ' --' : ''} ${hit.flag} {PORT}` : '';
  const inner = hit ? null : TOOLS.find((t) => t.flag && t.re.test(text)) || null;   // out of a flag's reach
  const port = pinnedPort ?? hit?.port ?? inner?.port ?? 3000;
  return { script, scriptText: text.slice(0, 200), manager, tool: hit?.tool || null, command, cmd: `${command}${flag}`,
    port, pinned: pinnedPort != null || !!inner, setup: await installOf(dir, pkg, manager) };
}

/** The project Action "Use this" saves: a service on PORT (auto unless `found.pinned`), opened at localhost. */
export function devServerAction(found, takenIds = []) {
  const taken = new Set(takenIds);
  let id = 'dev';
  for (let n = 2; taken.has(id); n += 1) id = `dev-${n}`;
  return { id, label: 'Dev server', kind: 'service', cmd: found.cmd, cmdWin32: null, cwd: '.',
    env: [{ name: 'PORT', type: 'port', value: found.pinned ? found.port : 'auto' }],
    openUrl: 'http://localhost:{PORT}', ready: { kind: 'port', port: 'PORT', timeoutMs: 120_000 } };
}
