// src/core/c4-mock.mjs — the offline stand-in for the Architecture (C4) architect (mockRole
// `c4-architect`). It honours the person's setup answers exactly as the real agent must: a new
// file at `newPath` with the chosen bands (a preset, or "My own" lines with their criteria), or an
// in-place edit of the chosen file. The file it writes is a small but real LikeC4 model, so the
// deterministic cards after it (c4Check, c4Render) run for real on a mock run and the Artifacts
// tab has a genuine .c4 to open.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export const C4_SETUP_FILE = 'c4-setup.json';
export const C4_FOUND_FILE = 'c4-found.json';

const PRESETS = {
  'Standard: People · Clients · Host · External': [
    ['people', 'People', 'The actors: people who use or operate the system.'],
    ['clients', 'Clients', 'What a person operates directly: browser UIs, CLIs, chat clients.'],
    ['host', 'Host', 'Every process on the machine the system runs on.'],
    ['external', 'External', 'Systems outside the host: APIs, git hosts, model endpoints.'],
  ],
  'Deployment: You · Host · Services · Data · Models': [
    ['you', 'You', 'Clients and actors.'],
    ['host', 'Host', 'The main process and its modules.'],
    ['services', 'Services', 'Other processes and sidecars.'],
    ['data', 'Data', 'Stores.'],
    ['models', 'Models', 'Model endpoints.'],
  ],
};

const slug = (s, i) => (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'b$1') || `band${i + 1}`);
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** "Name — criteria" lines (two-space indent = a frame in the band above) → bands. Exported for tests. */
export function parseBandLines(text) {
  const bands = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const nested = /^\s{2,}/.test(raw);
    const [name, ...rest] = raw.trim().split(/\s+[—–-]\s+/);
    const entry = { title: name.trim(), criteria: rest.join(' — ').trim(), frames: [] };
    if (nested && bands.length) bands[bands.length - 1].frames.push(entry);
    else bands.push(entry);
  }
  return bands.map((b, i) => ({ ...b, id: slug(b.title, i), frames: b.frames.map((f, j) => ({ ...f, id: slug(f.title, j) })) }));
}

export function bandsFor(values = {}) {
  if (values.bandsPreset === 'No bands (element views only)') return [];
  if (values.bandsPreset === 'My own (below)') return parseBandLines(values.bands);
  const preset = PRESETS[values.bandsPreset] || PRESETS['Standard: People · Clients · Host · External'];
  return preset.map(([id, title, criteria]) => ({ id, title, criteria, frames: [] }));
}

/** The mock model: one system with an app and a store, every band holding one tile. */
export function mockC4Source(bands, { title = 'Mock system' } = {}) {
  const leaves = ['user', 'app', 'store', 'api'];
  const lines = [
    '// Written by worca\'s offline mock architect. A real run reads the code.',
    'specification {', '  element person { style { shape person color slate } }', '  element system', '  element container',
    '  element database { style { shape cylinder color teal } }', '  deploymentNode zone', '}', '',
    'model {', `  user = person 'User' { description 'Someone who uses ${q(title)}.' }`,
    `  sys = system '${q(title)}' {`,
    "    app = container 'App' { description 'The main process.' technology 'src/' }",
    "    store = database 'Store' { description 'Where state lives.' technology 'data/' }", '  }',
    "  api = system 'External API' { description 'A service outside the host.' }",
    "  user -> sys.app 'uses'", "  sys.app -> sys.store 'reads and writes'", "  sys.app -> api 'calls'", '}', '',
  ];
  if (bands.length) {
    lines.push('deployment {');
    bands.forEach((b, i) => {
      const ref = ['user', 'sys.app', 'sys.store', 'api'][i % leaves.length];
      lines.push(`  ${b.id} = zone '${q(b.title)}' {`, `    metadata { criteria '${q(b.criteria || b.title)}' order 'declared' }`);
      for (const f of b.frames) lines.push(`    ${f.id} = zone '${q(f.title)}' {`, `      metadata { criteria '${q(f.criteria || f.title)}' }`, `      t_${f.id} = instanceOf ${ref}`, '    }');
      if (!b.frames.length) lines.push(`    t_${b.id} = instanceOf ${ref}`);
      lines.push('  }');
    });
    lines.push('}', '');
  }
  lines.push('views {', "  view index { title 'Context' description 'Everything at the top level.' include * }",
    "  view app of sys { title 'The system' description 'Inside the system.' include * }");
  if (bands.length) lines.push(`  deployment view deployment { title 'Deployment' description 'The bands.' include ${bands.flatMap((b) => [`${b.id}.*`, ...b.frames.map((f) => `${b.id}.${f.id}.*`)]).join(', ')} }`);
  lines.push('}', '');
  return lines.join('\n');
}

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

/**
 * Write the mock model and the envelope. `modelPath` is the architect's `model` port path (in the
 * pipeline dir, where the setup answers and discovery result also live); `cwd` the run's checkout;
 * `members` the workspace members' checkouts ({ key, dir }) when the run spans several.
 */
export function writeMockC4({ modelPath, cwd, members = [] }) {
  const pdir = dirname(modelPath);
  const values = (readJson(join(pdir, C4_SETUP_FILE)) || {}).values || {};
  const found = readJson(join(pdir, C4_FOUND_FILE)) || { files: [] };
  const listed = Array.isArray(found.rootDirs) ? found.rootDirs.filter((r) => r && r.dir) : [];
  const roots = listed.length > 1 ? listed : members.length ? members : [{ key: listed[0]?.key ?? null, dir: cwd }];
  const workspace = roots.length > 1;
  const picked = values.target === 'Update a found file' && values.file
    ? (found.files || []).find((f) => f.id === values.file || f.path === values.file) : null;
  let rel; let project = null; let created;
  if (picked) {
    const root = roots.find((r) => r.key === picked.project) || roots[0];
    rel = picked.path; project = root.key; created = false;
    appendFileSync(join(root.dir, ...rel.split('/')), `\n// mock architect pass @ ${new Date().toISOString()}\n`, 'utf8');
  } else {
    rel = String(values.newPath || 'docs/architecture/architecture.c4').replace(/\\/g, '/').replace(/^\/+/, '');
    if (isAbsolute(rel) || rel.split('/').includes('..')) rel = 'docs/architecture/architecture.c4';
    const root = roots.find((r) => r.key === values.newProject) || roots[0];
    project = root.key; created = !existsSync(join(root.dir, ...rel.split('/')));
    const abs = join(root.dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, mockC4Source(bandsFor(values)), 'utf8');
  }
  const bands = picked ? (picked.bands || []).map((b) => ({ id: b.id, title: b.title, criteria: b.criteria }))
    : bandsFor(values).map((b) => ({ id: b.id, title: b.title, criteria: b.criteria }));
  const envelope = { path: rel, ...(project && workspace ? { project } : {}), created, bands, views: [] };
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  return envelope;
}
