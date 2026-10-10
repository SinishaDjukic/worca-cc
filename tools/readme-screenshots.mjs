#!/usr/bin/env node
// tools/readme-screenshots.mjs — re-shoots the README screenshots in docs/screenshots/ from a
// sandboxed Worca with believable demo data (docs/screenshots.md has the recipe and the set).
// NOT part of `npm test`: it needs Chrome and boots a real server in-process.
//
//   node tools/readme-screenshots.mjs                shoot every screenshot into docs/screenshots
//   … --only running,stats   shoot only these (names without .png)
//   … --out DIR              write the PNGs to DIR instead
//   … --port N               the sandbox server's port (default 4399; must be free)
//   … --keep                 keep the sandbox home and print its path (debugging)
//
// Viewport: a 16-inch MacBook Pro at its default "looks like" resolution, 1728×1117 CSS px at
// device scale 2, so every PNG is 3456×2234. Light theme, the whole viewport, sidebar included.
//
// Sandbox: HOME, USERPROFILE and WORCA_HOME all point at one mkdtemp dir. WORCA_HOME alone is not
// enough: settings.json (theme, interface mode, model catalog, budgets, provider tokens) lives
// under HOME/USERPROFILE (src/core/settings.mjs#settingsFile), and so do ~/.claude.json and
// ~/.claude/skills. Every demo repo carries a LOCAL demo git identity. Server-wide mock mode
// (WORCA_MOCK) stays off — it paints a MOCK pill next to the logo — so runs use the per-run
// `mock: true` body flag. Chrome gets the real HOME back (a Chrome with a fresh HOME never
// answers Page.navigate on macOS), its own mkdtemp profile and --use-mock-keychain.
//
// Leak guard: before anything is sandboxed the tool reads a denylist from the REAL environment
// (user name, home path, global git identity, the custom model ids and labels of the real
// settings.json catalog and their endpoint hosts). Every shot fails when the page text holds an
// entry; only the entry's number is printed, and the list is never written anywhere.
//
// Chrome comes from CHROME_BIN or the standard macOS/Linux locations; CDP_PORT picks its
// debugging port (default 9350). The tool stops only the processes it spawned and removes only
// the mkdtemp dirs it created, on success, failure and SIGINT/SIGTERM alike.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; return v && !v.startsWith('--') ? v : ''; };
const REPO = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.resolve(flag('--out') || path.join(REPO, 'docs', 'screenshots'));
const ONLY = (flag('--only') || '').split(',').map((s) => s.trim().replace(/\.png$/, '')).filter(Boolean);
const KEEP = args.includes('--keep');
const SERVER_PORT = Number(flag('--port') || 4399);
const CDP_PORT = Number(process.env.CDP_PORT || 9350);
const VIEWPORT = { width: 1728, height: 1117, deviceScaleFactor: 2, mobile: false };

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the leak denylist, read from the REAL environment before anything is sandboxed ---------
// Held in memory only: a hit prints the entry's number, never its value.
const DENY = (() => {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim().length >= 4) out.add(v.trim()); };
  try { add(os.userInfo().username); } catch {}
  add(os.homedir()); add(process.env.HOME); add(process.env.USERPROFILE);
  for (const key of ['user.email', 'user.name']) {
    try { add(execFileSync('git', ['config', '--global', key], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch {}
  }
  try {
    const s = JSON.parse(readFileSync(path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.worca-cc', 'settings.json'), 'utf8'));
    for (const m of Array.isArray(s.models) ? s.models : []) {
      add(m?.id); add(m?.label); add(m?.env?.ANTHROPIC_MODEL);
      for (const v of Object.values(m?.env || {})) {
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) { try { add(new URL(v).hostname); } catch {} }
      }
    }
  } catch {}
  return [...out];
})();

let chrome = null; let srv = null; let sandbox = null; let profile = null;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); } } catch {}
  try { if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  if (sandbox && KEEP) log(`sandbox kept: ${sandbox}`);
  else { try { if (sandbox) await rm(sandbox, { recursive: true, force: true, maxRetries: 10 }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}

// ---- the sandbox (env BEFORE the server import) --------------------------------------------
async function portFree(port) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });
}
if (!(await portFree(SERVER_PORT))) { console.error(`port ${SERVER_PORT} is in use - pick another with --port`); process.exit(1); }
if (!(await portFree(CDP_PORT))) { console.error(`CDP port ${CDP_PORT} is in use - set CDP_PORT`); process.exit(1); }

const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
// /tmp on macOS and Linux: run checkouts show their folder, and /tmp/… reads cleaner than /var/folders/….
const SANDBOX_PARENT = process.platform !== 'win32' && existsSync('/tmp') ? '/tmp' : os.tmpdir();
sandbox = await mkdtemp(path.join(SANDBOX_PARENT, 'worca-shots-'));
const CODE = path.join(sandbox, 'code');
await mkdir(CODE, { recursive: true });
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.WORCA_HOME = sandbox;
process.env.WORCA_PROJECTS_ROOT = CODE;
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of ['WORCA_HOST_PID', 'CLAUDE_CONFIG_DIR', 'WORCA_IDENTITY_HEADER', 'WORCA_IDENTITY_NAME', 'WORCA_MOCK', 'ORCH_MOCK',
  'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete process.env[k];
// The fallback identity for any commit the app makes itself (run branches, checkpoints).
await writeFile(path.join(sandbox, '.gitconfig'), '[user]\n\tname = Maya Chen\n\temail = maya@nimbus.dev\n[init]\n\tdefaultBranch = main\n');

// ---- demo repos: small, believable, a few commits each --------------------------------------
const PEOPLE = {
  maya: ['Maya Chen', 'maya@nimbus.dev'],
  diego: ['Diego Alvarez', 'diego@nimbus.dev'],
  priya: ['Priya Nair', 'priya@nimbus.dev'],
  sam: ['Sam Okafor', 'sam@nimbus.dev'],
};
const DAY = 86_400_000;
function git(cwd, argv, env = {}) {
  return execFileSync('git', argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}
async function writeFiles(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }
}
// commits: [{ who, daysAgo, msg, files }] — authored and committed by `who`, back-dated.
async function makeRepo(name, commits) {
  const dir = path.join(CODE, name);
  await mkdir(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', PEOPLE.maya[0]]);
  git(dir, ['config', 'user.email', PEOPLE.maya[1]]);
  for (const c of commits) {
    await writeFiles(dir, c.files);
    git(dir, ['add', '-A']);
    const [n, e] = PEOPLE[c.who];
    const when = new Date(Date.now() - c.daysAgo * DAY).toISOString();
    git(dir, ['commit', '-qm', c.msg], { GIT_AUTHOR_NAME: n, GIT_AUTHOR_EMAIL: e, GIT_COMMITTER_NAME: n, GIT_COMMITTER_EMAIL: e, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  }
  return dir;
}

const CRM_FILES = {
  'package.json': `${JSON.stringify({ name: 'nimbus-crm', version: '0.9.2', private: true, type: 'module',
    scripts: { start: 'node src/server.js', test: 'node --test' }, dependencies: { express: '^4.21.0' } }, null, 2)}\n`,
  'README.md': '# nimbus-crm\n\nA small contacts and deals API for the Nimbus sales team.\n\n```bash\nnpm install\nnpm start   # http://localhost:3000\n```\n',
  'src/server.js': `import express from 'express';
import { contacts } from './routes/contacts.js';
import { deals } from './routes/deals.js';

const app = express();
app.use(express.json());
app.use('/contacts', contacts);
app.use('/deals', deals);
app.get('/health', (req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(\`nimbus-crm on :\${port}\`));
`,
  'src/db.js': `// In-memory store; swapped for Postgres in production.
const rows = new Map();
let nextId = 1;

export function insert(contact) {
  const row = { id: nextId++, createdAt: new Date().toISOString(), ...contact };
  rows.set(row.id, row);
  return row;
}

export function list({ q = '', owner } = {}) {
  const needle = q.toLowerCase();
  return [...rows.values()].filter((c) =>
    (!owner || c.owner === owner) &&
    (!needle || c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle)));
}

export function get(id) { return rows.get(Number(id)) || null; }
`,
  'src/routes/contacts.js': `import { Router } from 'express';
import { insert, list, get } from '../db.js';

export const contacts = Router();

contacts.get('/', (req, res) => {
  res.json(list({ q: req.query.q, owner: req.query.owner }));
});

contacts.get('/:id', (req, res) => {
  const row = get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

contacts.post('/', (req, res) => {
  const { name, email, company, owner } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  res.status(201).json(insert({ name, email, company, owner }));
});
`,
  'src/routes/deals.js': `import { Router } from 'express';

export const deals = Router();
const stages = ['lead', 'qualified', 'proposal', 'won', 'lost'];

deals.get('/stages', (req, res) => res.json(stages));
`,
  'test/contacts.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insert, list } from '../src/db.js';

test('list filters by name or email', () => {
  insert({ name: 'Ada Park', email: 'ada@acme.io', owner: 'maya' });
  insert({ name: 'Ben Ito', email: 'ben@globex.com', owner: 'diego' });
  assert.equal(list({ q: 'acme' }).length, 1);
  assert.equal(list({ owner: 'diego' })[0].name, 'Ben Ito');
});
`,
};
const LUMEN_FILES = {
  'package.json': `${JSON.stringify({ name: 'lumen-docs', version: '1.4.0', private: true, type: 'module',
    scripts: { build: 'node src/build.js', test: 'node --test' }, dependencies: { marked: '^14.1.0' } }, null, 2)}\n`,
  'README.md': '# lumen-docs\n\nTurns a folder of Markdown into a static docs site.\n\n```bash\nnpm run build   # docs/ -> dist/\n```\n',
  'src/build.js': `import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { render } from './render.js';

const SRC = 'docs';
const OUT = 'dist';

const pages = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
await mkdir(OUT, { recursive: true });
for (const file of pages) {
  const md = await readFile(path.join(SRC, file), 'utf8');
  await writeFile(path.join(OUT, file.replace(/\\.md$/, '.html')), render(md, { pages }));
}
console.log(\`built \${pages.length} pages\`);
`,
  'src/render.js': `import { marked } from 'marked';
import { readFileSync } from 'node:fs';

const layout = readFileSync(new URL('../templates/page.html', import.meta.url), 'utf8');

export function render(md, { pages }) {
  const title = (md.match(/^# (.+)$/m) || [, 'Lumen'])[1];
  const nav = pages.map((p) => \`<a href="\${p.replace(/\\.md$/, '.html')}">\${p.replace(/\\.md$/, '')}</a>\`).join('');
  return layout.replace('{{title}}', title).replace('{{nav}}', nav).replace('{{body}}', marked.parse(md));
}
`,
  'templates/page.html': '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>{{title}}</title><link rel="stylesheet" href="theme.css"></head>\n<body><nav>{{nav}}</nav><main>{{body}}</main></body>\n</html>\n',
  'docs/index.md': '# Lumen\n\nWelcome to the Nimbus developer docs.\n',
  'docs/api.md': '# API\n\nEvery endpoint answers JSON.\n',
};
const WEB_FILES = {
  'package.json': `${JSON.stringify({ name: 'nimbus-web', version: '0.6.0', private: true, type: 'module',
    scripts: { dev: 'vite', build: 'vite build' }, dependencies: { vue: '^3.5.0' }, devDependencies: { vite: '^5.4.0' } }, null, 2)}\n`,
  'README.md': '# nimbus-web\n\nThe Nimbus CRM web app (Vue 3 + Vite). Talks to nimbus-crm over REST.\n',
  'src/api.js': `const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function listContacts(q = '') {
  const res = await fetch(\`\${BASE}/contacts?q=\${encodeURIComponent(q)}\`);
  if (!res.ok) throw new Error(\`contacts: HTTP \${res.status}\`);
  return res.json();
}

export async function createContact(contact) {
  const res = await fetch(\`\${BASE}/contacts\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(contact) });
  return res.json();
}
`,
  'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\n\ncreateApp(App).mount('#app');\n",
  'src/App.vue': '<template>\n  <main><h1>Contacts</h1><ContactList /></main>\n</template>\n\n<script setup>\nimport ContactList from \'./ContactList.vue\';\n</script>\n',
  'src/ContactList.vue': '<template>\n  <input v-model="q" placeholder="Search contacts" />\n  <ul><li v-for="c in rows" :key="c.id">{{ c.name }} — {{ c.company }}</li></ul>\n</template>\n\n<script setup>\nimport { ref, watchEffect } from \'vue\';\nimport { listContacts } from \'./api.js\';\n\nconst q = ref(\'\');\nconst rows = ref([]);\nwatchEffect(async () => { rows.value = await listContacts(q.value); });\n</script>\n',
};
const JOBS_FILES = {
  'package.json': `${JSON.stringify({ name: 'nimbus-jobs', version: '0.3.1', private: true, type: 'module',
    scripts: { start: 'node src/worker.js' }, dependencies: { bullmq: '^5.12.0', pg: '^8.12.0' } }, null, 2)}\n`,
  'README.md': '# nimbus-jobs\n\nBackground jobs for Nimbus: nightly lead scoring and export e-mails.\n',
  'src/worker.js': `import { Worker } from 'bullmq';
import { scoreLeads } from './score.js';

new Worker('crm-events', async (job) => {
  if (job.name === 'contact.created') await scoreLeads([job.data.id]);
}, { connection: { host: process.env.REDIS_HOST || 'localhost' } });
`,
  'src/score.js': `import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.CRM_DATABASE_URL });

export async function scoreLeads(ids) {
  await pool.query('UPDATE contacts SET score = score + 10 WHERE id = ANY($1)', [ids]);
}
`,
};

// Each repo gets a bare `origin` under the sandbox (Team metrics reads its worca-metrics branch).
async function withOrigin(dir) {
  const bare = path.join(sandbox, 'remotes', `${path.basename(dir)}.git`);
  await mkdir(bare, { recursive: true });
  git(bare, ['init', '--bare', '-q', '-b', 'main']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', 'origin', 'main']);
  git(dir, ['branch', '-q', '--set-upstream-to=origin/main', 'main']);
  return dir;
}
const REPOS = {
  'nimbus-crm': await withOrigin(await makeRepo('nimbus-crm', [
    { who: 'maya', daysAgo: 58, msg: 'Contacts API with an in-memory store', files: CRM_FILES },
    { who: 'diego', daysAgo: 31, msg: 'Pipeline value per deal stage', files: { 'src/routes/deals.js': `${CRM_FILES['src/routes/deals.js']}\ndeals.get('/pipeline', (req, res) => {\n  res.json(stages.map((stage) => ({ stage, deals: 0, valueCents: 0 })));\n});\n` } },
  ])),
  'lumen-docs': await withOrigin(await makeRepo('lumen-docs', [{ who: 'priya', daysAgo: 44, msg: 'Markdown to HTML build with a page template', files: LUMEN_FILES }])),
  'nimbus-web': await withOrigin(await makeRepo('nimbus-web', [{ who: 'sam', daysAgo: 40, msg: 'Contacts list against the CRM API', files: WEB_FILES }])),
  'nimbus-jobs': await withOrigin(await makeRepo('nimbus-jobs', [{ who: 'diego', daysAgo: 36, msg: 'Lead scoring worker on the crm-events queue', files: JOBS_FILES }])),
};

// ---- the server, in-process on SERVER_PORT (the exported `server`: the UI's WebSocket rides it) ----
const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = server;
await new Promise((r, j) => { srv.once('error', j); srv.listen(SERVER_PORT, '127.0.0.1', r); });
const base = `http://127.0.0.1:${SERVER_PORT}`;
const api = async (p, body, method = body === undefined ? 'GET' : 'POST') => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let json; try { json = JSON.parse(t); } catch { json = t; }
  if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
};
log(`sandbox server ${base}`);
const { getDb } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
const db = getDb();
{ // Built-in model ids and labels are public: a custom catalog entry reusing one is not a leak.
  const { PREDEFINED_MODELS } = await import(new URL('../src/core/config.mjs', import.meta.url).href);
  const pub = new Set(PREDEFINED_MODELS.flatMap((m) => [m.id, m.label].map((s) => s.toLowerCase())));
  for (let i = DENY.length - 1; i >= 0; i -= 1) if (pub.has(DENY[i].toLowerCase())) DENY.splice(i, 1);
}

await api('/api/settings', { theme: 'light', uiLevel: 'expert' });
await api('/api/onboarding', { welcomeSeen: true, hidden: true });
for (const [name, dir] of Object.entries(REPOS)) await api('/api/projects', { name, path: dir });
const PROJECTS = Object.fromEntries((await api('/api/projects')).projects.map((p) => [p.name, p]));

// ---- workspace + a stored interconnection map (the P5 store, like verify-workspace-map-cdp) ----
const { createWorkspace, saveWorkspaceScanResult } = await import(new URL('../src/core/workspaces.mjs', import.meta.url).href);
const { edgeId } = await import(new URL('../src/shared/workspace-map/ids.mjs', import.meta.url).href);
const { changeOrder } = await import(new URL('../src/shared/workspace-map/order.mjs', import.meta.url).href);
const WS_MEMBERS = ['nimbus-crm', 'nimbus-web', 'nimbus-jobs'];
const ws = await createWorkspace({ name: 'Nimbus', projectPaths: WS_MEMBERS.map((n) => REPOS[n]) });
{
  const K = Object.fromEntries(ws.projectPaths.map((p, i) => [path.basename(p), ws.projectKeys[i]]));
  const cov = (level, files) => ({ level, files, scannedFiles: files, truncated: false, factsStatic: files, factsLlm: 2, unresolved: 0, rejected: 0, surveyed: 'investigated', usageStatus: 'investigated', graph: null });
  const edge = (from, to, kind, norm, display, confidence, evFrom, evTo) => ({
    id: edgeId(K[from], K[to], kind, norm), from: K[from], to: K[to], kind, norm, display, label: null, detail: '',
    confidence, sources: confidence === 'inferred' ? ['llm'] : ['static'], evidence: { from: evFrom, to: evTo },
  });
  const EDGES = [
    edge('nimbus-web', 'nimbus-crm', 'http', 'http:GET /contacts', 'GET /contacts', 'exact',
      [{ file: 'src/api.js', line: 4, match: 'fetch(`${BASE}/contacts?q=' }], [{ file: 'src/routes/contacts.js', line: 6, match: "contacts.get('/'" }]),
    edge('nimbus-web', 'nimbus-crm', 'http', 'http:POST /contacts', 'POST /contacts', 'exact',
      [{ file: 'src/api.js', line: 10, match: 'fetch(`${BASE}/contacts`' }], [{ file: 'src/routes/contacts.js', line: 16, match: "contacts.post('/'" }]),
    edge('nimbus-crm', 'nimbus-jobs', 'topic', 'topic:crm-events', 'crm-events', 'verified',
      [{ file: 'src/db.js', line: 5, match: 'export function insert(contact)' }], [{ file: 'src/worker.js', line: 4, match: "new Worker('crm-events'" }]),
    edge('nimbus-jobs', 'nimbus-crm', 'db', 'db:contacts', 'contacts table', 'inferred',
      [{ file: 'src/score.js', line: 6, match: 'UPDATE contacts SET score' }], []),
  ];
  const keys = Object.values(K).sort();
  const { order, cycles } = changeOrder(keys, EDGES);
  const byKind = {}; const byConfidence = {};
  for (const e of EDGES) { byKind[e.kind] = (byKind[e.kind] || 0) + 1; byConfidence[e.confidence] = (byConfidence[e.confidence] || 0) + 1; }
  const ROLES = { 'nimbus-crm': 'Contacts and deals REST API', 'nimbus-web': 'Vue web app for the sales team', 'nimbus-jobs': 'Background workers: lead scoring' };
  const STACK = { 'nimbus-crm': ['node', 'express'], 'nimbus-web': ['vue', 'vite'], 'nimbus-jobs': ['node', 'bullmq', 'postgres'] };
  const MAP = {
    version: 1, workspace: { name: 'Nimbus' }, scannedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), runId: 'demo',
    members: WS_MEMBERS.map((n) => ({ key: K[n], name: n, role: ROLES[n], roleSource: 'survey', aliases: [], stack: STACK[n], coverage: cov('rich', n === 'nimbus-web' ? 5 : 6) })),
    edges: EDGES, order, cycles, graph: { mode: 'none', file: null, nodes: 0, bridges: 0 },
    stats: { edges: EDGES.length, byKind, byConfidence, candidates: 1, candidatesConfirmed: 1, factsRejected: 0 }, errors: [],
  };
  const SYNTH = {
    version: 1,
    overview: 'nimbus-web calls the nimbus-crm REST API; nimbus-crm publishes contact events that nimbus-jobs consumes, and nimbus-jobs writes lead scores straight into the CRM database.',
    roles: {}, coordination: [], orderNotes: 'Ship API changes in nimbus-crm before the web app that calls them.',
  };
  await saveWorkspaceScanResult(ws.id, { map: MAP, synthesis: SYNTH });
}

// ---- runs: per-run `mock: true` (offline, free), then the mock blemishes fixed --------------
const until = async (fn, tag, ms = 120_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${tag}`);
    await sleep(100);
  }
};
const startRun = async (proj, title, prompt) => (await api('/api/run', { projectDir: REPOS[proj], prompt, title, workflowId: 'wf_default', mock: true })).runId;
// Mock wf_default parks at its clarify question until it is answered (or stopped).
const heldQuestion = (runId) => until(() => runs.get(runId)?.pendingQuestion, `clarify question of ${runId}`);
async function finishRun(runId, { stop = false } = {}) {
  const q = await heldQuestion(runId);
  if (stop) await api('/api/stop', { runId });
  else await api('/api/answer', { runId, id: q.id, payload: { answers: q.questions.map((x) => ({ id: x.id, choice: x.recommended || x.options[0] })) } });
  await until(() => runs.get(runId)?.settled, `run ${runId} settled`);
  return runs.get(runId);
}
async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

// [project, title, prompt, days ago, USD, active minutes, human hours, stopped?]
const FINISHED = [
  ['nimbus-crm', 'CSV export for contacts', 'Add a CSV export for the filtered contact list: GET /contacts/export.csv streams name, email, company, owner and created date, honouring the same q and owner filters as GET /contacts.', 0.12, 4.82, 21, 5],
  ['nimbus-crm', 'Paginate the search endpoint', 'GET /contacts returns every row. Add cursor pagination (limit + cursor), keep the old response behind ?all=1 and document both in the README.', 0.9, 3.65, 17, 4],
  ['lumen-docs', 'Dark-mode docs theme', 'Give the generated docs a dark theme that follows prefers-color-scheme, with a toggle in the nav that remembers the choice.', 1.3, 2.91, 14, 3.5],
  ['nimbus-web', 'Empty state for the contact list', 'When a search matches nothing, show a friendly empty state with a button that clears the search box.', 1.8, 1.42, 7, 1.5],
  ['nimbus-jobs', 'Retry failed scoring jobs with backoff', 'Scoring jobs that throw are lost. Retry them three times with exponential backoff, then move them to a dead-letter queue.', 2.2, 3.18, 16, 4],
  ['nimbus-crm', 'Validate e-mail addresses on create', 'POST /contacts accepts any string as an e-mail. Reject malformed addresses with a 400 that names the field, and cover it with tests.', 2.7, 2.06, 11, 2],
  ['lumen-docs', 'Broken-link check in the build', 'Fail the build when a page links to another page that does not exist, and print every broken link with its source file.', 3.1, 2.47, 13, 3],
  ['nimbus-web', 'Debounce the contact search box', 'Every keystroke in the search box fires a request. Debounce it by 250 ms and cancel the request that is still in flight.', 3.6, 1.15, 6, 1],
  ['nimbus-crm', 'Deal stage history', 'Record every stage change of a deal with who changed it and when, and expose it at GET /deals/:id/history.', 4.2, 5.94, 29, 7],
  ['nimbus-jobs', 'Nightly lead-score recalculation', 'Add a nightly job that recomputes every lead score from the last 90 days of activity, in batches of 500.', 5.4, 3.77, 19, 4.5],
  ['lumen-docs', 'Sidebar table of contents', 'Generate a table of contents from the h2 and h3 headings of each page and show it in a sticky right-hand sidebar.', 6.1, 2.33, 12, 2.5],
  ['nimbus-crm', 'Soft-delete contacts', 'DELETE /contacts/:id removes the row for good. Make it a soft delete with a deletedAt column and hide deleted rows from every list.', 6.8, 3.02, 15, 3.5],
  ['nimbus-web', 'Owner filter chips', 'Add filter chips above the contact list for each owner, combinable with the search box, and keep them in the URL.', 7.5, 2.64, 13, 3],
  ['nimbus-crm', 'Health check reports store size', 'Make GET /health also report the number of contacts and deals, and answer 503 while the store is still loading.', 8.2, 0.96, 5, 1],
  ['lumen-docs', 'Copy button on code blocks', 'Add a copy-to-clipboard button to every fenced code block, with a short "Copied" confirmation.', 9.0, 1.38, 7, 1.5],
  ['nimbus-jobs', 'Structured JSON logs', 'Replace the console.log calls with structured JSON logs carrying job id, queue and duration.', 9.7, 1.84, 9, 2],
  ['nimbus-crm', 'Rate-limit contact creation', 'Limit POST /contacts to 60 requests per minute per API key and answer 429 with a Retry-After header.', 10.4, 2.95, 15, 3],
  ['nimbus-web', 'Keyboard shortcuts for the list', 'Add j/k to move through the contact list, Enter to open a contact and / to focus the search box.', 11.1, 1.71, 9, 2],
  ['lumen-docs', 'Versioned docs folders', 'Build docs/v1 and docs/v2 into separate trees with a version switcher in the header.', 13.6, 4.41, 22, 5],
  ['nimbus-crm', 'OpenAPI spec for the contacts API', 'Write an OpenAPI 3.1 document for every contacts and deals route and serve it at GET /openapi.json.', 16.2, 3.36, 17, 4],
  ['nimbus-jobs', 'Graceful shutdown on SIGTERM', 'On SIGTERM, stop taking new jobs, let running jobs finish for up to 30 s, then close the database pool.', 19.5, 1.27, 6, 1.5],
  ['nimbus-web', 'Contact detail drawer', 'Open a side drawer with the full contact and its deals when a row is clicked, without leaving the list.', 23.3, 4.08, 20, 5],
  ['nimbus-crm', 'Switch the store to Postgres', 'Replace the in-memory store with Postgres behind the same functions, with a migration for the contacts table.', 2.4, 0.88, 4, 0, true],
  ['nimbus-web', 'Move the build to Vite 6', 'Upgrade the build from Vite 5 to Vite 6 and fix whatever breaks.', 12.3, 0.41, 2, 0, true],
];

const { tx } = await import(new URL('../src/core/db.mjs', import.meta.url).href);
const { updatePipelineTitle } = await import(new URL('../src/core/artifacts.mjs', import.meta.url).href);
const { diffNameStatus, diffNumstat, diffPatch } = await import(new URL('../src/core/git-info.mjs', import.meta.url).href);
const { assembleResults, persistResults, persistDiffPatch } = await import(new URL('../src/core/results.mjs', import.meta.url).href);

// Mock runs record $0.00, a second of work and a "[mock] …" title. Spread them over the past
// weeks with plausible cost, time and human-hours credit, per step and in the cost ledger.
const stepWeight = (node) => (/impl/.test(node) ? 5 : /plan/.test(node) ? 3 : /review|test/.test(node) ? 2 : 1);
function restage(pipelineId, { title, startedMs, usd, activeMin, humanHours }) {
  const activeMs = Math.round(activeMin * 60_000) + (Math.round(usd * 1000) % 57) * 1000;   // not a round minute
  const endMs = startedMs + activeMs + 4 * 60_000;
  const steps = db.prepare('SELECT key, node_id FROM pipeline_steps WHERE pipeline_id = ? ORDER BY step_index, cycle, key').all(pipelineId);
  const w = steps.map((s) => stepWeight(s.node_id || s.key));
  const W = w.reduce((a, b) => a + b, 0) || 1;
  tx(() => {
    let t = startedMs; let spent = 0;
    steps.forEach((s, i) => {
      const ms = Math.round((activeMs * w[i]) / W);
      const cost = i === steps.length - 1 ? Math.round((usd - spent) * 1e4) / 1e4 : Math.round(((usd * w[i]) / W) * 1e4) / 1e4;
      spent += cost;
      const st = new Date(t).toISOString(); t += ms; const en = new Date(t).toISOString();
      db.prepare('UPDATE pipeline_steps SET cost_usd = ?, active_ms = ?, started_at = ?, updated_at = ?, ended_at = ?, human_hours = ? WHERE pipeline_id = ? AND key = ?')
        .run(cost, ms, st, en, en, Math.round(((humanHours * w[i]) / W) * 100) / 100, pipelineId, s.key);
      if (cost > 0) db.prepare('INSERT INTO cost_ledger (pipeline_id, step_key, amount_usd, ts) VALUES (?, ?, ?, ?)').run(pipelineId, s.key, cost, t);
    });
    db.prepare('UPDATE pipelines SET title = ?, started_at = ?, updated_at = ?, total_cost_usd = ?, total_active_ms = ?, human_hours = ? WHERE id = ?')
      .run(title, new Date(startedMs).toISOString(), new Date(endMs).toISOString(), usd, activeMs, humanHours, pipelineId);
  });
}

// A mock implementer writes a generic src/feature.mjs. For the run whose Diff tab is shot, the
// run branch gets a real, believable change instead, and results.json + the patch follow it.
const CSV_CHANGE = {
  'src/csv.js': `// RFC 4180 CSV for contact rows.
const COLUMNS = ['name', 'email', 'company', 'owner', 'createdAt'];

function cell(value) {
  const s = value == null ? '' : String(value);
  return /[",\\r\\n]/.test(s) ? \`"\${s.replace(/"/g, '""')}"\` : s;
}

export function toCsv(rows, columns = COLUMNS) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return lines.join('\\r\\n') + '\\r\\n';
}
`,
  'src/routes/contacts.js': CRM_FILES['src/routes/contacts.js']
    .replace("import { insert, list, get } from '../db.js';", "import { insert, list, get } from '../db.js';\nimport { toCsv } from '../csv.js';")
    .replace("contacts.get('/:id'", `// Same filters as GET /contacts; the browser saves it as contacts.csv.
contacts.get('/export.csv', (req, res) => {
  const rows = list({ q: req.query.q, owner: req.query.owner });
  res.type('text/csv').attachment('contacts.csv').send(toCsv(rows));
});

contacts.get('/:id'`),
  'test/csv.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/csv.js';

test('quotes cells holding commas or quotes', () => {
  const csv = toCsv([{ name: 'Park, Ada', email: 'ada@acme.io', company: 'Acme "West"', owner: 'maya', createdAt: '2026-09-30' }]);
  assert.equal(csv, 'name,email,company,owner,createdAt\\r\\n"Park, Ada",ada@acme.io,"Acme ""West""",maya,2026-09-30\\r\\n');
});

test('an empty list still has the header row', () => {
  assert.equal(toCsv([]), 'name,email,company,owner,createdAt\\r\\n');
});
`,
  'README.md': `${CRM_FILES['README.md']}\n## Export\n\n\`GET /contacts/export.csv\` downloads the contacts as CSV. It takes the same \`q\` and \`owner\` filters as \`GET /contacts\`.\n`,
};
async function replaceRunChange(entry, title, files) {
  const repo = entry.projectDir;
  const row = db.prepare('SELECT branch FROM pipelines WHERE id = ?').get(entry.pipelineId);
  const feature = JSON.parse(row.branch).feature;
  const base = git(repo, ['rev-parse', 'main']);
  const wt = path.join(sandbox, `wt-${entry.pipelineId}`);
  git(repo, ['worktree', 'add', '-q', '--detach', wt, base]);
  await writeFiles(wt, files);
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-qm', `worca: ${title}\n\nPipeline ${entry.pipelineId}`]);
  const head = git(wt, ['rev-parse', 'HEAD']);
  git(repo, ['worktree', 'remove', '--force', wt]);
  git(repo, ['branch', '-f', feature, head]);
  const [ns, num, patch] = await Promise.all([diffNameStatus(repo, base, head), diffNumstat(repo, base, head), diffPatch(repo, base, head)]);
  await persistResults(entry.orch.pipeline.dir, assembleResults({ nameStatus: ns, numstat: num, reviews: [] }));
  await persistDiffPatch(entry.orch.pipeline.dir, patch);
}

log(`seeding ${FINISHED.length} finished mock runs`);
const DONE = {};   // title -> { runId, pipelineId, projectKey, projectDir }
await inBatches(FINISHED, 4, async ([proj, title, prompt, daysAgo, usd, activeMin, humanHours, stopped]) => {
  const runId = await startRun(proj, title, prompt);
  const entry = await finishRun(runId, { stop: !!stopped });
  await entry.orch._titlePromise;
  if (title === 'CSV export for contacts') await replaceRunChange(entry, title, CSV_CHANGE);
  restage(entry.pipelineId, { title, startedMs: Date.now() - daysAgo * DAY, usd, activeMin, humanHours });
  DONE[title] = { runId, pipelineId: entry.pipelineId, projectKey: PROJECTS[proj].key, projectDir: REPOS[proj] };
  // History reads the DB; a finished entry left in the live map would keep its mock title there.
  runs.delete(runId);
});

// ---- Actions: the CRM's Run/Test actions, the CSV run checked out and its Test run once -----
const csvRun = DONE['CSV export for contacts'];
await api(`/api/projects/${PROJECTS['nimbus-crm'].key}/actions`, {
  actions: [
    { id: 'run', label: 'Run', kind: 'service', cmd: 'npm start', cwd: '.', env: [{ name: 'PORT', type: 'port', value: 'auto' }],
      openUrl: 'http://localhost:{PORT}', ready: { kind: 'port', port: 'PORT', timeoutMs: 60000 } },
    { id: 'test', label: 'Test', kind: 'task', cmd: 'npm test' },
  ],
}, 'PUT');
const runQ = `?projectKey=${encodeURIComponent(csvRun.projectKey)}`;
await api(`/api/runs/${csvRun.pipelineId}/checkout${runQ}`, {});
await api(`/api/runs/${csvRun.pipelineId}/actions/test/start${runQ}`, {});
await until(async () => {
  const a = await api(`/api/runs/${csvRun.pipelineId}/actions${runQ}`);
  return JSON.stringify(a).includes('"exitCode":0');
}, 'the Test action to finish', 60_000);

// ---- Ask Worca: a stored conversation built with the real proposal validator ---------------
const askStore = await import(new URL('../src/core/ask/store.mjs', import.meta.url).href);
const { validateProposal } = await import(new URL('../src/core/ask/proposal.mjs', import.meta.url).href);
const askThread = askStore.createThread({ title: 'Contacts search is slow' });
{
  const pageRun = DONE['Paginate the search endpoint'];
  askStore.appendMessage(askThread.id, { role: 'user', text: 'The contacts search in nimbus-crm gets slow once we pass 10k rows. Can you page it?' });
  const cardId = askStore.newAskId('card');
  const started = await validateProposal({ projectKey: pageRun.projectKey, workflowId: 'wf_default', guardrailsId: 'normal', title: 'Paginate the search endpoint',
    brief: FINISHED.find((f) => f[1] === 'Paginate the search endpoint')[2],
    note: 'GET /contacts reads every row on each call; a cursor keeps the first page fast.' }, { cardId });
  if (!started.ok) throw new Error(`ask proposal: ${started.errors.join('; ')}`);
  askStore.appendMessage(askThread.id, { role: 'assistant', status: 'done',
    text: '`GET /contacts` filters the whole table in memory on every request, so the time grows with the table. A cursor (`limit` + `cursor`) keeps each page cheap; the old shape can stay behind `?all=1` for scripts that rely on it.\n\nHere is a run for it:',
    blocks: [{ kind: 'card', id: cardId, state: 'started', runId: pageRun.pipelineId, card: started.card }] });
  askStore.linkRun(askThread.id, { runId: pageRun.pipelineId, cardId, pipelineId: pageRun.pipelineId, status: 'done' });
  askStore.appendMessage(askThread.id, { role: 'system', text: 'Run started — "Paginate the search endpoint"',
    blocks: [{ kind: 'notice', text: 'Run started — "Paginate the search endpoint"', href: `#history/${pageRun.projectKey}/${pageRun.pipelineId}` }] });
  askStore.appendMessage(askThread.id, { role: 'user', text: 'Does the docs site need a change too?' });
  askStore.appendMessage(askThread.id, { role: 'assistant', status: 'done',
    text: 'Yes. `docs/api.md` in lumen-docs still documents `GET /contacts` as returning every row. It needs the `limit` and `cursor` parameters, the `nextCursor` field and `?all=1`. Want me to propose a docs run for it?' });
  // Ask spend this week (Statistics' Ask Worca tile): this chat and three shorter ones.
  const turn = (threadId, usd, hoursAgo) => db.prepare('INSERT INTO ask_cost_ledger (thread_id, message_id, amount_usd, tokens, model, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(threadId, null, usd, Math.round(usd * 210_000), 'claude-sonnet-5-5', Date.now() - hoursAgo * 3_600_000);
  turn(askThread.id, 0.18, 0.5); turn(askThread.id, 0.07, 0.4);
  askStore.addThreadTotals(askThread.id, { costUsd: 0.25, usage: { input: 41_200, output: 2_900 } });
  for (const [title, q, a, usd, hoursAgo] of [
    ['Why did the docs build fail?', 'Why did the last lumen-docs build fail?', 'The broken-link check found `api.md` linking to `auth.md`, which does not exist yet. Either add the page or drop the link.', 0.12, 20],
    ['Which runs touched deals.js?', 'Which runs changed src/routes/deals.js this month?', 'Two: **Deal stage history** (Monday) and **Pipeline value per deal stage** from before Worca. Both are merged into main.', 0.09, 46],
    ['Plan for the Postgres move', 'What would moving nimbus-crm to Postgres involve?', 'Three steps: a `contacts` table migration, swapping `src/db.js` for a pg pool behind the same functions, and a seed script for local runs.', 0.21, 70],
  ]) {
    const t = askStore.createThread({ title });
    askStore.appendMessage(t.id, { role: 'user', text: q });
    askStore.appendMessage(t.id, { role: 'assistant', status: 'done', text: a });
    turn(t.id, usd, hoursAgo);
    askStore.addThreadTotals(t.id, { costUsd: usd, usage: { input: Math.round(usd * 190_000), output: Math.round(usd * 12_000) } });
  }
}

// ---- Schedules: repeating series and a one-off ticket (the scheduler never ticks in-process) ----
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const schedule = (proj, title, prompt, extra) => api('/api/run', { projectDir: REPOS[proj], prompt, title, workflowId: 'wf_default', ...extra });
await schedule('nimbus-crm', 'Nightly dependency audit', 'Run npm audit, upgrade every dependency with a fix that stays inside its semver range, and keep the tests green.',
  { repeat: { rule: { freq: 'weekly', weekdays: ['mo', 'tu', 'we', 'th', 'fr'], time: '02:00', tz: TZ } } });
await schedule('lumen-docs', 'Weekly broken-link sweep', 'Build the docs, list every broken internal or external link, and fix the internal ones.',
  { repeat: { rule: { freq: 'weekly', weekdays: ['mo'], time: '07:30', tz: TZ } } });
await schedule('nimbus-web', 'Monthly flaky-test sweep', 'Run the test suite ten times, find tests that fail only sometimes, and make them deterministic.',
  { repeat: { rule: { freq: 'monthly', monthDay: 1, time: '06:00', tz: TZ } } });
{
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(9, 0, 0, 0);
  await schedule('nimbus-jobs', 'Upgrade BullMQ to v6', 'Upgrade bullmq to v6, follow its migration guide for workers and queues, and keep the job names unchanged.', { scheduledFor: sat.toISOString() });
}

// ---- Team metrics: the CRM's worca-metrics branch on its origin, written through the real sync ----
const { buildRunRecord, personKey } = await import(new URL('../src/core/metrics/record.mjs', import.meta.url).href);
const metricsSync = await import(new URL('../src/core/metrics/sync.mjs', import.meta.url).href);
await api(`/api/projects/${PROJECTS['nimbus-crm'].key}/team-metrics/enable`, { mode: 'here', attribution: 'git-user' });
{
  const slug = 'nimbus-crm';
  const WF = { wf_default: 'Default', 'wf_quick-fix': 'Quick Fix', wf_full: 'Full' };
  const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];
  const TM_TITLES = ['CSV export for contacts', 'Paginate the search endpoint', 'Validate e-mail addresses on create', 'Deal stage history',
    'Soft-delete contacts', 'Health check reports store size', 'Rate-limit contact creation', 'OpenAPI spec for the contacts API',
    'Owner field on deals', 'Search by company name', 'Bulk import from CSV', 'Merge duplicate contacts', 'Fix timezone in createdAt',
    'Deal value in cents', 'Archive lost deals after 90 days', 'Contact tags', 'Webhook on stage change', 'Audit log for deletes',
    'Sort contacts by last activity', 'Idempotency keys on POST', 'Phone number normalisation', 'Owner reassignment endpoint',
    'Fix 500 on empty search', 'Request id in every log line', 'ETag on GET /contacts/:id', 'Faster startup with lazy routes'];
  const who = ['maya', 'diego', 'priya', 'sam', 'maya', 'diego', 'maya', 'priya'];
  let n = 0;
  for (const [i, title] of TM_TITLES.entries()) {
    const person = PEOPLE[who[i % who.length]];
    const startMs = Date.now() - (2 + i * 2.3) * DAY - (i % 5) * 3_600_000;
    const activeMs = (8 + ((i * 7) % 26)) * 60_000 + ((i * 23) % 60) * 1000;
    const status = i === 6 ? 'error' : i === 13 ? 'stopped' : 'done';
    const wfId = i % 4 === 3 ? 'wf_quick-fix' : i % 7 === 5 ? 'wf_full' : 'wf_default';
    const usd = Math.round((1.1 + ((i * 37) % 70) / 10) * 100) / 100;
    const steps = [
      { agentKey: 'planner', phase: 'plan', cycle: 1, costUsd: usd * 0.25, modelUsed: MODELS[0], humanHours: 1 + (i % 3) * 0.5 },
      { agentKey: 'implementer', phase: 'implement', cycle: 1, costUsd: usd * 0.55, modelUsed: i % 2 ? MODELS[1] : MODELS[0], humanHours: 2 + (i % 4) },
      { agentKey: 'code-reviewer', phase: 'review', cycle: 1 + (i % 3 === 0 ? 1 : 0), costUsd: usd * 0.2, modelUsed: MODELS[i % 5 === 0 ? 2 : 1], humanHours: 0.5 },
    ];
    const rec = buildRunRecord({
      status, runId: `demo${String(i).padStart(4, '0')}`, startedAt: new Date(startMs).toISOString(), endedAt: new Date(startMs + activeMs + 6 * 60_000).toISOString(),
      totalActiveMs: activeMs, totalCostUsd: usd, pausedMs: 0, steps, agentKeys: ['planner', 'implementer', 'code-reviewer'],
      workflow: { id: wfId, name: WF[wfId], version: 2 }, target: { kind: 'project', project: slug }, title,
      ...(i % 2 === 0 ? { source: { type: 'github-issues', ref: `#${212 - i * 3}`, title } } : {}),
      ...(status === 'error' ? { error: 'npm test failed after two fix cycles' } : {}),
      git: { branch: `worca-cc/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, head: null, base: 'main', filesChanged: 2 + (i % 6), insertions: 30 + ((i * 53) % 260), deletions: (i * 17) % 60 },
      interventions: { questions: i % 3 ? 1 : 2, pauses: i % 9 === 0 ? 1 : 0, resumes: i % 9 === 0 ? 1 : 0 },
      actor: person[0], actorKey: personKey(person[1]),
    }, { attribution: 'git-user', now: new Date(startMs + activeMs + 7 * 60_000) });
    await metricsSync.writeOutbox(slug, rec);
    n += 1;
  }
  await metricsSync.flushSlug(slug);
  await api(`/api/team-metrics?scope=${encodeURIComponent(`project:${PROJECTS['nimbus-crm'].key}`)}&range=all`);
  log(`team metrics: ${n} records on ${slug}'s worca-metrics branch`);
}

// ---- live runs: held at clarify; their questions rewritten in place to read as real decisions ----
// [project, title, prompt, [{ question, options, confidence }]] — the question ids stay the mock's,
// and the objects are edited IN PLACE: the run's buffered question event shares them, so the
// replay a subscribing tab gets carries the new text too.
const LIVE = [
  ['nimbus-crm', 'Webhooks for deal stage changes', 'Let integrators register webhook URLs and send each of them a signed JSON payload whenever a deal changes stage.', [
    { question: 'How should webhook payloads be signed?', options: ['HMAC-SHA256 header with a per-endpoint secret', 'Ed25519 signature with a published public key', 'No signature, HTTPS only'], confidence: [72, 22, 6] },
    { question: 'What should happen when an endpoint keeps failing?', options: ['Retry with backoff for 24 h, then disable the endpoint', 'Retry three times, then drop the event'], confidence: [65, 35] },
  ]],
  ['lumen-docs', 'Full-text search for the docs', 'Add client-side full-text search across every page, with results that highlight the matching words.', [
    { question: 'Where should the search index be built?', options: ['At build time, shipped as one JSON file', 'In the browser on the first search', 'On a hosted search service'], confidence: [78, 17, 5] },
    { question: 'Should results point to page sections or whole pages?', options: ['Sections, linking to the heading', 'Whole pages'], confidence: [60, 40] },
  ]],
  ['nimbus-web', 'Bulk-edit contact owners', 'Let a manager select many contacts in the list and hand them to another owner in one action.', [
    { question: 'How should the reassignment reach the API?', options: ['One PATCH /contacts/owner call with all ids', 'One PATCH per contact, in parallel', 'A background job with a progress toast'], confidence: [58, 12, 30] },
    { question: 'Who may reassign contacts?', options: ['Managers only', 'Any user, for the contacts they own'], confidence: [70, 30] },
  ]],
];
async function startLiveRuns() {
  const ids = [];
  for (const [proj, title, prompt, qs] of LIVE) {
    const runId = await startRun(proj, title, prompt);
    const q = await heldQuestion(runId);
    const e = runs.get(runId);
    await e.orch._titlePromise;
    e.orch.state.title = title; e.title = title;
    updatePipelineTitle(e.pipelineId, title);
    e.orch.emit('title', { title, provisional: false, pipelineId: e.pipelineId });
    qs.forEach((s, i) => {
      const x = q.questions[i];
      x.question = s.question;
      x.options.splice(0, x.options.length, ...s.options);
      x.confidence = s.confidence;
      x.recommended = s.options[0];
    });
    // Mock steps take milliseconds and cost nothing: give Task and Clarify plausible figures,
    // then emit a fresh state frame (the last one is what a subscribing tab replays).
    const clarifyMs = 38_000 + ids.length * 9_000;
    const clarifyUsd = 0.12 + ids.length * 0.03;
    for (const st of e.orch.state.steps) {
      if (st.nodeId === 'n_task') { st.activeMs = 1_800; st.costUsd = 0; }
      if (st.nodeId === 'n_clarify') { st.activeMs = clarifyMs; st.costUsd = clarifyUsd; }
    }
    e.orch.state.totalCostUsd = clarifyUsd;
    e.orch.state.totalActiveMs = clarifyMs + 1_800;
    e.orch._emit('state', e.orch.getState());
    ids.push(runId);
  }
  return ids;
}

// ---- chrome + cdp ---------------------------------------------------------------------------
profile = await mkdtemp(path.join(os.tmpdir(), 'worca-shots-profile-'));
chrome = spawn(CHROME, ['--headless=new', ...SANDBOX, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--force-color-profile=srgb',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...REAL_ENV } });
const chromeErr = [];
chrome.stderr.on('data', (d) => { chromeErr.push(String(d)); if (chromeErr.length > 40) chromeErr.shift(); });
let chromeExit = null;
chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
let wsUrl = null;
const targetDeadline = Date.now() + 60_000;
while (!wsUrl && Date.now() < targetDeadline && !chromeExit) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) {
  console.error(chromeExit ? `no devtools target: chrome exited (code ${chromeExit.code}, signal ${chromeExit.signal})` : 'no devtools target after 60s');
  if (chromeErr.length) console.error(chromeErr.join('').trim().split('\n').slice(-15).join('\n'));
  await shutdown(1);
}
const sock = new WebSocket(wsUrl);
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
let msgId = 0; const pending = new Map(); const listeners = [];
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  for (const l of [...listeners]) l(m);
};
function cdp(method, params = {}, ms = 30000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    sock.send(JSON.stringify({ id, method, params }));
  });
}
const waitEvent = (name, ms = 30000) => new Promise((res, rej) => {
  const to = setTimeout(() => { off(); rej(new Error(`timeout ${name}`)); }, ms);
  const l = (m) => { if (m.method === name) { clearTimeout(to); off(); res(m.params); } };
  const off = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(l);
});
const pageErrors = [];
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', VIEWPORT);
// This Mac's headless Chrome defaults to dark; the stored theme is light, and so is the emulation.
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
async function ev(expr, ms = 30000) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr.slice(0, 300)}`);
  return r.result.value;
}
// Headless paints only on demand: a 16×16 capture forces a frame.
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }).catch(() => null);
async function settle(tag) {
  await ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
  for (let i = 0; i < 10; i += 1) { if (await ev('window.__rafHit')) return; await kick(); }
  throw new Error(`no animation frame after 10 forced frames (${tag})`);
}
async function until2(expr, tag, tries = 150) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(`(()=>{try{return !!(${expr});}catch(e){return false;}})()`)) return true;
    await kick(); await sleep(120);
  }
  throw new Error(`timeout waiting for ${tag}`);
}
const READY = `(async()=>{await document.fonts.ready;
  await Promise.all(['/assets/worca-logo-mask.png','/assets/worca-mark-mask.png','/assets/worca-favicon.png'].map((src)=>new Promise((r)=>{const i=new Image();i.onload=i.onerror=r;i.src=src;})));return 1;})()`;
const FREEZE_CSS = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
async function freeze(tag) {
  await ev(`(()=>{let s=document.getElementById('shot-freeze');if(!s){s=document.createElement('style');s.id='shot-freeze';s.textContent=${JSON.stringify(FREEZE_CSS)};document.head.appendChild(s);}
    (document.getAnimations?.()||[]).forEach((a)=>{try{a.finish();}catch{}});return 1;})()`);
  await settle(`${tag} freeze-1`); await settle(`${tag} freeze-2`);
}
const click = async (sel) => { const ok = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;e.click();return 1;})()`); if (!ok) throw new Error(`no element for ${sel}`); };
let navigated = false;
async function go(hash, { level, before = '' }) {
  await api('/api/settings', { uiLevel: level });
  if (!navigated) {
    const loaded = waitEvent('Page.loadEventFired');
    await cdp('Page.navigate', { url: `${base}/#${hash}` }); await loaded; navigated = true;
  }
  if (before) await ev(`(()=>{${before};return 1;})()`);
  await ev(`location.hash=${JSON.stringify(hash)};0`);
  const loaded = waitEvent('Page.loadEventFired');
  await cdp('Page.reload', {}); await loaded;
  await until2('window.__np && window.__np.getRun', 'app boot');
  const route = hash.split('/')[0];
  const view = ['running', 'history'].includes(route) ? 'runs' : route;
  await until2(`document.querySelector('[data-view=${JSON.stringify(view)}]:not(.hidden)')`, `view ${view}`);
  await until2(`document.documentElement.dataset.level === ${JSON.stringify(level)}`, `level ${level}`);
  await sleep(600);
  await ev(READY);
}

// The page text must hold no denylist entry; only the entry's number is ever printed.
async function leakCheck(name) {
  const text = String(await ev(`[document.title, document.body.innerText,
    ...[...document.querySelectorAll('input,textarea')].map((e)=>e.value),
    ...[...document.querySelectorAll('select')].map((s)=>s.selectedOptions[0]?.text||'')].join('\\n')`)).toLowerCase();
  const hits = DENY.map((d, i) => (text.includes(d.toLowerCase()) ? i + 1 : 0)).filter(Boolean);
  if (hits.length) throw new Error(`leak in ${name}: denylist entry #${hits.join(', #')}`);
  if (/\[mock\]/i.test(text)) throw new Error(`mock blemish in ${name}: "[mock]" on the page`);
}
async function capture(name) {
  await freeze(name);
  await leakCheck(name);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 60000);
  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  const b = Buffer.from(data, 'base64');
  log(`${name}.png ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`);
}

// ---- the shot list (the lowest interface mode that shows each view; docs/ui-levels.md) -------
const statsRange = () => { const d = new Date(); const wd = (d.getDay() + 6) % 7; return wd >= 2 ? 'week' : d.getDate() >= 8 ? 'month' : 'all'; };
const SHOTS = [
  { name: 'history', level: 'simple', hash: () => `history/${DONE['Paginate the search endpoint'].projectKey}/${DONE['Paginate the search endpoint'].pipelineId}`,
    before: "localStorage.removeItem('worca-cc.lingerRuns')",
    prep: async () => { await until2("document.querySelectorAll('.runs-row-body').length >= 10", 'history rows'); await sleep(800); } },
  { name: 'run-detail', level: 'advanced', hash: () => `history/${csvRun.projectKey}/${csvRun.pipelineId}/details/diff`,
    prep: async () => {
      await until2("document.querySelector('.hd-diff-pane .hd-diff-body:not(.hint)')", 'diff body');
      // The modified route reads better than a new file: context lines around the change.
      await ev("(()=>{const r=[...document.querySelectorAll('.hd-diff-rows *')].filter((e)=>/contacts\\.js$/.test(e.textContent.trim())&&!e.querySelector('*'));const t=r[0]&&(r[0].closest('[role=button],button,[tabindex]')||r[0]);if(t)t.click();return 1;})()");
      await until2("(document.querySelector('.hd-diff-pane .hd-diff-path')||{}).textContent?.endsWith('contacts.js') && document.querySelector('.hd-diff-pane .hd-diff-body:not(.hint)')", 'contacts.js diff');
    } },
  { name: 'actions', level: 'advanced', hash: () => `history/${csvRun.projectKey}/${csvRun.pipelineId}/details/actions`,
    prep: () => until2("document.querySelector('.act-card .act-log, .act-card pre')", 'action log') },
  { name: 'composer', level: 'advanced', hash: () => 'workflows',
    prep: async () => { await until2('document.querySelector(\'#wfv-library [data-tab="workflows"]\')', 'library tabs'); await click('#wfv-library [data-tab="workflows"]');
      await until2('document.querySelector(\'#wfv-library .wfl-wf[data-id="wf_default"] .wfl-main\')', 'workflow list'); await click('#wfv-library .wfl-wf[data-id="wf_default"] .wfl-main');
      await until2("document.querySelectorAll('#wfv-canvas .gv-world .node').length >= 4", 'agent nodes'); } },
  { name: 'stats', level: 'advanced', hash: () => 'stats',
    prep: async () => { await click(`#stats-range button[data-range="${statsRange()}"]`); await sleep(800); await until2("document.querySelectorAll('[data-view=\"stats\"] svg').length >= 2", 'stats charts'); } },
  { name: 'schedules', level: 'advanced', hash: () => 'schedules/repeating',
    prep: () => until2("document.querySelector('[data-view=\"schedules\"]').innerText.includes('Nightly dependency audit')", 'schedules list') },
  { name: 'team-metrics', level: 'expert', hash: () => 'team-metrics', before: `localStorage.setItem('worca.teamMetrics.scope', ${JSON.stringify(`project:${PROJECTS['nimbus-crm'].key}`)})`,
    prep: async () => { await until2("document.querySelector('#tm-body .tm-kpis')", 'team metrics'); await click('#tm-range button[data-range="last-month"]'); await sleep(800);
      await until2("document.querySelector('#tm-body .tm-kpis') && !document.querySelector('#tm-sync .is-busy')", 'team metrics range'); } },
  { name: 'workspace-map', level: 'advanced', hash: () => `workspaces/${ws.id}/map`,
    prep: () => until2("document.querySelector('#ws-detail .pd-sec[data-sec=\"map\"] svg.wm-graph')", 'map graph') },
  { name: 'scripts', level: 'expert', hash: () => 'workflows/scripts', prep: () => until2("document.querySelectorAll('#wfv-library .wfl-item[data-item^=\"script:\"]').length >= 5", 'script rows') },
  // The sheet is drag-resizable and remembers its size; a tall one shows the whole chat.
  { name: 'ask-worca', level: 'simple', hash: () => 'new',
    before: `localStorage.setItem('worca-cc.ask.thread', ${JSON.stringify(askThread.id)});localStorage.setItem('worca-cc.ask.size', '{"w":960,"h":1090}')`,
    prep: async () => { await click('.ask-pill'); await until2('document.querySelector(\'.ask-sheet:not([hidden]) .ask-card.ask-rc\')', 'ask run card'); await sleep(800); } },
  // The Runs page reopens the last run it showed; name it, so the shot never depends on the order.
  { name: 'running', level: 'simple', live: true, hash: () => `history/${csvRun.projectKey}/${csvRun.pipelineId}`, before: "localStorage.removeItem('worca-cc.lingerRuns')",
    prep: () => until2("document.querySelectorAll('.runs-row-body').length >= 10", 'runs rows') },
  { name: 'clarify', level: 'simple', live: true, hash: () => `running/${liveIds[0]}`,
    prep: () => until2("document.querySelector('.qpanel-head')", 'clarify panel') },
];
const wanted = SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.name));
const unknown = ONLY.filter((n) => !SHOTS.some((s) => s.name === n));
if (unknown.length) { console.error(`unknown shot(s): ${unknown.join(', ')} — known: ${SHOTS.map((s) => s.name).join(', ')}`); await shutdown(2); }

let liveIds = [];
for (const s of wanted) {
  if (s.live && !liveIds.length) { liveIds = await startLiveRuns(); log(`live runs held at clarify: ${liveIds.length}`); }
  await go(s.hash(), { level: s.level, before: s.before });
  await s.prep();
  await capture(s.name);
}
if (pageErrors.length) { console.error(`page errors:\n${pageErrors.slice(0, 10).join('\n')}`); await shutdown(1); }
log(`done: ${wanted.length} screenshot(s) in ${OUT}`);
await shutdown(0);
