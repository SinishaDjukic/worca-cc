// plugins/ai-readiness/scripts/readiness-probe.mjs — measures what the rubric must not leave to a
// model: which instruction files exist and reach which tool, whether skill frontmatter parses,
// whether the confirmed commands exit 0, each engine's files against the chip's size limits, and what a probed command
// left behind in the checkout. Used by two cards (readinessProbe, readinessProbeFinal).
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

/** worca mounts these into the checkout for the run; they are never the repository's. The rubric lands
    where the run's engine reads skills: `.claude/skills` on Claude Code, `.agents/skills` on every other
    engine (run-context.mjs skillsRelFor), so both are listed. */
export const DEFAULT_EXCLUDED = Object.freeze(['.claude/rules/worca', '.claude/skills/readiness-rubric', '.agents/skills/readiness-rubric']);
const RUN_KINDS = new Set(['install', 'test', 'lint', 'typecheck']);
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md', '.cursorrules'];
// The file setup writes for each engine (Task 9's table); the keys are worca's run engines.
export const EXPECTED_FILE = Object.freeze({ claude: 'CLAUDE.md', gemini: 'GEMINI.md', codex: 'AGENTS.md', opencode: 'AGENTS.md', goose: 'AGENTS.md', qwen: 'AGENTS.md', cursor: 'AGENTS.md', copilot: 'AGENTS.md' });
// Engines that expand an `@AGENTS.md` import in their own file.
const IMPORTS_AGENTS = new Set(['claude', 'gemini']);
// The skills folder (a key of `skills`) that counts as the engine's own, for `skills-only`.
const SKILLS_OF = Object.freeze({ claude: 'claude', qwen: 'qwen', codex: 'agents', copilot: 'agents', cursor: 'agents', gemini: 'agents', opencode: 'agents', goose: 'agents' });
const BUDGET_MS = 1500000;
const SIDE_EFFECT_CAP = 50;
// A command Map took from worca memory carries an `origin`; it runs only when a person answered card A (the host's
// `api.readiness.cardA.by === 'user'`). Away mode, an unattended run and an older worca with no view all skip it.
export const MEMORY_SKIP_WHY = 'from worca memory; nobody confirmed it on card A';
const hasOrigin = (c) => typeof c?.origin === 'string' && c.origin.trim() !== '';
const POINTER_ONLY = /^\s*(see|read|refer to)\b[^\n]*\b(CLAUDE|AGENTS)\.md\b[^\n]*$/im;

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readBuf = (p) => { try { return readFileSync(p); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isExcluded = (rel, excluded) => excluded.some((e) => rel === e || rel.startsWith(`${e}/`));

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return 'no frontmatter block';
  if (!/^name:\s*\S/m.test(m[1])) return 'frontmatter has no name';
  if (!/^description:\s*\S/m.test(m[1])) return 'frontmatter has no description';
  return null;
}

/** `command` appears in `text` as a whole command: not inside a longer one (`npm test` is not in
    `npm test:fast` or `pnpm test`, `pytest` is not in `pytest-cov`). Ending a sentence is fine. */
export function mentionsCommand(text, command) {
  const cmd = String(command || '');
  if (!cmd || !text) return false;
  const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w./:@-])${esc}(?![\\w:/@-]|\\.\\w)`).test(text);
}

/** A tool file carries the core: every confirmed install/test command, or — with none confirmed —
 *  real substance and not just a sentence pointing at another file. */
export function selfSufficient(text, commands = []) {
  const t = String(text || '');
  const must = (Array.isArray(commands) ? commands : [])
    .filter((c) => c && (c.kind === 'install' || c.kind === 'test') && c.verdict !== 'wrong' && c.command);
  if (must.length) return must.every((c) => mentionsCommand(t, c.command));
  return t.trim().length >= 400 && !(POINTER_ONLY.test(t) && t.trim().length < 600);
}

function listSkills(dir, base, excluded) {
  const root = join(dir, base);
  if (!existsSync(root)) return { names: [], frontmatter: [] };
  const names = [];
  const frontmatter = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const rel = `${base}/${d.name}`;
    if (isExcluded(rel, excluded)) continue;
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const text = read(join(root, d.name, 'SKILL.md'));
    if (text === null) continue;
    names.push(d.name);
    const error = parseFrontmatter(text);
    if (error) frontmatter.push({ path: `${rel}/SKILL.md`, error });
  }
  return { names: names.sort(), frontmatter };
}

/** Claude Code expands an `@AGENTS.md` import anywhere in CLAUDE.md, except inside code. */
export function importsAgents(text) {
  const prose = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return /(^|\s)@(\.\/)?AGENTS\.md(?=$|[\s.,;:!?)\]])/m.test(prose);
}

/** Every file under .cursor/rules (Cursor reads nested folders too), relative to it. A broken
    symlink or an unreadable entry is skipped, never fatal. */
function listRuleFiles(root, rel = '', depth = 0) {
  const out = [];
  let entries;
  try { entries = readdirSync(rel ? join(root, rel) : root); } catch { return out; }
  for (const name of entries) {
    const r = rel ? `${rel}/${name}` : name;
    let st;
    try { st = statSync(join(root, r)); } catch { continue; }
    if (st.isFile()) out.push(r);
    else if (st.isDirectory() && depth < 8) out.push(...listRuleFiles(root, r, depth + 1));
  }
  return out.sort();
}

/** Mirrors `globRe` in src/core/repo-readiness/engines.mjs (the chip): `**\/` is any number of
    folders, `*` stays inside one. Kept as a copy because plugin scripts never import host code. */
function globRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${re}$`);
}

/** Every file under the folder a glob starts in (the part before its first wildcard), relative to
    `dir`, as `/`-joined paths; bounded in depth, broken symlinks skipped. */
function filesUnder(dir, rel, depth = 0) {
  const out = [];
  let entries;
  try { entries = readdirSync(rel ? join(dir, rel) : dir); } catch { return out; }
  for (const name of entries) {
    const r = rel ? `${rel}/${name}` : name;
    let st;
    try { st = statSync(join(dir, r)); } catch { continue; }
    if (st.isFile()) out.push(r);
    else if (st.isDirectory() && depth < 10 && name !== 'node_modules' && name !== '.git') out.push(...filesUnder(dir, r, depth + 1));
  }
  return out;
}

/** The files a source list reads that exist in the checkout: its literal files (`firstNonEmpty`
    takes only the first non-empty one) plus every glob match, never a worca mount. */
function presentSources(dir, src, excluded) {
  const files = Array.isArray(src?.files) ? src.files : [];
  const globs = Array.isArray(src?.globs) ? src.globs : [];
  let own = files.filter((f) => !isExcluded(f, excluded) && existsSync(join(dir, f)) && statSync(join(dir, f)).isFile());
  if (src?.firstNonEmpty) own = own.filter((f) => statSync(join(dir, f)).size > 0).slice(0, 1);
  const found = [];
  for (const g of globs) {
    const re = globRe(g);
    const base = g.split('/').slice(0, g.split('/').findIndex((seg) => seg.includes('*'))).join('/');
    for (const f of filesUnder(dir, base)) if (re.test(f) && !isExcluded(f, excluded)) found.push(f);
  }
  return [...own, ...found.sort().filter((f) => !own.includes(f))];
}

/** One engine's surface from the files the chip says it reads: together they carry the core
    (self-sufficient), some are there but do not (partial), none but skills (skills-only), or nothing
    (missing). A file over `limits.perFile` is not counted; the engine's files over `limits.total` are partial. */
function surfaceOf(engine, present, { text, bytes, skills, commands, limits, agentsText }) {
  const expected = EXPECTED_FILE[engine] || '';
  const perFile = Number(limits?.perFile) > 0 ? Number(limits.perFile) : Infinity;
  const total = Number(limits?.total) > 0 ? Number(limits.total) : Infinity;
  const skillSet = skills[SKILLS_OF[engine]] || [];
  if (!present.length) {
    return { surface: skillSet.length ? 'skills-only' : 'missing', files: [], expected, overCap: false, why: `no ${expected} (nor any other file ${engine} reads)` };
  }
  const over = present.filter((f) => bytes[f] > perFile);
  const counted = present.filter((f) => !over.includes(f));
  const sum = present.reduce((n, f) => n + bytes[f], 0);
  const overTotal = sum > total;
  let body = counted.map((f) => text[f]).join('\n');
  const imports = IMPORTS_AGENTS.has(engine) && counted.some((f) => importsAgents(text[f]));
  if (imports) body += `\n${agentsText ?? ''}`;
  const carries = !over.length && !overTotal && selfSufficient(body, commands);
  let why = '';
  if (!carries) {
    if (over.length) why = `${over.join(', ')} ${over.length > 1 ? 'are' : 'is'} over the ${Math.round(perFile / 1024)} KiB per-file limit`;
    else if (overTotal) why = `${engine}'s files are over the ${Math.round(total / 1024)} KiB total limit`;
    else if (imports) why = 'the instructions do not carry the confirmed commands';
    else if (IMPORTS_AGENTS.has(engine) && agentsText != null && present.includes(expected)) why = `${expected} does not import @AGENTS.md`;
    else if (IMPORTS_AGENTS.has(engine) && agentsText != null) why = `${expected} is missing, so ${engine} does not read AGENTS.md (${present.join(', ')} do not carry the confirmed commands)`;
    else why = `${present.join(', ')} ${present.length > 1 ? 'do' : 'does'} not carry the confirmed commands`;
  }
  return { surface: carries ? 'self-sufficient' : 'partial', files: present, expected, overCap: over.length > 0 || overTotal, why };
}

function porcelain(dir) {
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) return [];
  const recs = r.stdout.split('\0');
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec) continue;
    out.push(rec.slice(3));
    if (rec[0] === 'R' || rec[0] === 'C' || rec[1] === 'R' || rec[1] === 'C') i++; // the next record is the old path
  }
  return out;
}

/** Put back what the probed commands wrote: a path the index knows is checked out again, any other
    is deleted with its now-empty parent directories. Paths are the ones `git status` prints, which
    are relative to the repo TOPLEVEL (not to `dir`); only paths inside `dir` are ever touched, git
    sees every path literally (never as a glob), and nothing is deleted when git could not answer.
    A pre-existing EMPTY directory a command wrote into is pruned with the new file (git cannot see
    empty directories) — accepted by ruling. */
const CHUNK = 200;

/** Where `abs`'s parent really is: `inside` realTop (with its real path), `outside` it (a symlinked
    directory leading out of the repository), or `gone` (the directory no longer exists). */
export function realParentInside(abs, realTop) {
  let parent;
  try { parent = realpathSync(dirname(abs)); } catch (err) {
    return err && err.code === 'ENOENT' ? { state: 'gone' } : { state: 'outside' };
  }
  return (parent + sep).startsWith(realTop + sep) ? { state: 'inside', parent } : { state: 'outside' };
}

/** The real paths of the repo toplevel (what `git status` paths are relative to) and of `dir`. */
function realRoots(dir) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
  if (top.status !== 0 || !top.stdout.trim()) return null;
  try { return { realTop: realpathSync(top.stdout.trim()), realDir: realpathSync(dir) }; } catch { return null; }
}

const SNAP_FILE_CAP = 8 * 1024 * 1024;
const SNAP_TOTAL_CAP = 64 * 1024 * 1024;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Paths that were already dirty before the commands ran (the files Generate and Seed tests just
    wrote, on the final probe) are invisible to `git status`, so their content is kept here: a hash
    always, the bytes while under the caps so a command's edit can be put back. */
function snapshotDirty(dir, paths, excluded) {
  const roots = realRoots(dir);
  if (!roots) return null;
  const snap = new Map();
  let total = 0;
  for (const p of paths) {
    if (isExcluded(p, excluded)) continue;
    const abs = resolve(roots.realTop, p);
    if (!abs.startsWith(roots.realDir + sep)) continue;
    let st;
    try { st = statSync(abs); } catch { snap.set(p, { abs, missing: true }); continue; }
    if (!st.isFile()) continue;
    const buf = readBuf(abs);
    if (buf === null) continue;
    const keep = buf.length <= SNAP_FILE_CAP && total + buf.length <= SNAP_TOTAL_CAP;
    if (keep) total += buf.length;
    snap.set(p, { abs, hash: sha(buf), buf: keep ? buf : null });
  }
  return snap;
}

/** Puts back every snapshotted path a command changed; one too large to have been kept is reported. */
function restoreDirty(snap) {
  const changed = [];
  const failed = [];
  for (const [p, s] of snap) {
    const now = readBuf(s.abs);
    if (s.missing ? now === null : now !== null && sha(now) === s.hash) continue;
    changed.push(p);
    try {
      if (s.missing) rmSync(s.abs, { force: true });
      else if (!s.buf) failed.push(p);
      else { mkdirSync(dirname(s.abs), { recursive: true }); writeFileSync(s.abs, s.buf); }
    } catch { failed.push(p); }
  }
  return { changed, failed };
}

function restorePaths(dir, paths, excluded, before) {
  const env = { ...process.env, GIT_LITERAL_PATHSPECS: '1' };
  const roots = realRoots(dir);
  if (!roots) return [...paths];
  const { realTop, realDir } = roots;
  const failed = new Set();
  const inside = [];
  for (const p of paths) {
    const abs = resolve(realTop, p);
    if (abs.startsWith(realDir + sep)) inside.push(p); else failed.add(p);
  }
  // One membership answer per chunk: the paths ls-files echoes back are the index's; a chunk git
  // could not answer is left untouched and reported.
  const known = new Set();
  const unknown = [];
  for (let i = 0; i < inside.length; i += CHUNK) {
    const chunk = inside.slice(i, i + CHUNK);
    const r = spawnSync('git', ['ls-files', '-z', '--', ...chunk], { cwd: realTop, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) { for (const p of chunk) failed.add(p); continue; }
    const echoed = new Set(r.stdout.split('\0').filter(Boolean));
    for (const p of chunk) { if (echoed.has(p)) known.add(p); else unknown.push(p); }
  }
  if (known.size) {
    const r = spawnSync('git', ['checkout', '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: realTop, env, input: [...known].join('\0') + '\0', stdio: ['pipe', 'ignore', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) for (const p of known) failed.add(p);
  }
  for (const p of unknown) {
    const abs = resolve(realTop, p);
    const where = realParentInside(abs, realTop);
    if (where.state === 'gone') continue; // the file is already gone with its directory
    if (where.state === 'outside') { failed.add(p); continue; }
    const { parent } = where;
    try {
      rmSync(abs, { force: true });
      for (let d = parent; d.startsWith(realDir + sep); d = dirname(d)) {
        try { rmdirSync(d); } catch { break; } // not empty (or gone): stop
      }
    } catch { failed.add(p); }
  }
  const still = new Set(porcelain(dir).filter((q) => !before.has(q) && !isExcluded(q, excluded)));
  for (const p of paths) if (still.has(p)) failed.add(p);
  return paths.filter((p) => failed.has(p));
}

const TAIL_LINES = 40;
const TAIL_CHARS = 4096;
const TAIL_READ_BYTES = 64 * 1024;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/** The end of a command's output: the last 40 lines, capped to the last 4096 characters. Only the
    last 64 KiB of the file is read, so a huge output is never loaded whole. */
function tailOf(fd) {
  const size = fstatSync(fd).size;
  const start = Math.max(0, size - TAIL_READ_BYTES);
  const buf = Buffer.alloc(size - start);
  let got = 0;
  while (got < buf.length) {
    const n = readSync(fd, buf, got, buf.length - got, start + got);
    if (n <= 0) break;
    got += n;
  }
  const text = buf.subarray(0, got).toString('utf8').replace(ANSI, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const last = lines.slice(-TAIL_LINES).join('\n');
  return last.length > TAIL_CHARS ? last.slice(-TAIL_CHARS) : last;
}

/** Runs the command in its own process group and, on timeout, kills the whole group: killing only
    the shell would leave the test runner it started writing to the checkout after the restore.
    spawnSync cannot detach, so a small node supervisor does it; it drops a marker file on timeout. */
const SUPERVISOR = `
const { spawn, spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const [command, ms, marker] = process.argv.slice(1);
const win = process.platform === 'win32';
const child = spawn(command, { shell: true, stdio: 'inherit', detached: !win });
const killGroup = () => {
  if (win) { try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} return; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
};
const timer = setTimeout(() => { writeFileSync(marker, ''); killGroup(); }, Number(ms));
child.on('error', () => { clearTimeout(timer); process.exit(127); });
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  killGroup(); // anything the command left running in the background goes with it
  process.exit(code ?? 128 + (require('node:os').constants.signals[signal] || 9));
});
`;

function runOne(dir, c, timeoutMs) {
  // stdout and stderr share one temp file, never a pipe: spawnSync's maxBuffer would kill a chatty suite.
  const tmp = mkdtempSync(join(tmpdir(), 'air-out-'));
  const marker = join(tmp, 'timed-out');
  let fd = null;
  try {
    fd = openSync(join(tmp, 'out.log'), 'w+');
    const t0 = Date.now();
    // The outer timeout only guards against a stuck supervisor; the supervisor times the command.
    const r = spawnSync(process.execPath, ['-e', SUPERVISOR, c.command, String(timeoutMs), marker],
      { cwd: dir, stdio: ['ignore', fd, fd], timeout: timeoutMs + 30000, killSignal: 'SIGKILL' });
    const ms = Date.now() - t0;
    if (existsSync(marker) || (r.error && r.error.code === 'ETIMEDOUT')) return { status: 'timeout', exitCode: null, ms, outputTail: tailOf(fd) };
    if (r.status === 0) return { status: 'pass', exitCode: 0, ms };
    return { status: 'fail', exitCode: r.status, ms, outputTail: tailOf(fd) };
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function probeRepo(dir, { map = {}, excluded = DEFAULT_EXCLUDED, runCommands = true, timeoutMs = 300000, budgetMs = 1500000, deadline = Date.now() + budgetMs, view = null, cardA = null } = {}) {
  const commandsIn = Array.isArray(map.commands) ? map.commands : [];
  const memoryConfirmed = cardA?.by === 'user';
  // The commands the instruction files must carry: a memory command nobody confirmed is not one, like a wrong one.
  const confirmedIn = memoryConfirmed ? commandsIn : commandsIn.filter((c) => !hasOrigin(c));
  const text = {};
  const files = {};
  for (const f of INSTRUCTION_FILES) {
    const body = read(join(dir, f));
    text[f] = body;
    files[f] = body === null ? { exists: false } : { exists: true, bytes: Buffer.byteLength(body) };
  }
  if (files['CLAUDE.md'].exists) files['CLAUDE.md'].importsAgents = importsAgents(text['CLAUDE.md']);
  const ruleFiles = listRuleFiles(join(dir, '.cursor/rules'));
  files.cursorMdc = ruleFiles.filter((f) => f.endsWith('.mdc')).map((f) => `.cursor/rules/${f}`);
  const claudeSkills = listSkills(dir, '.claude/skills', excluded);
  const agentSkills = listSkills(dir, '.agents/skills', excluded);
  const qwenSkills = listSkills(dir, '.qwen/skills', excluded);
  const skills = { claude: claudeSkills.names, agents: agentSkills.names, qwen: qwenSkills.names };

  const documentedIn = (cmd) => INSTRUCTION_FILES.find((f) => mentionsCommand(text[f], cmd)) || '';
  const before = runCommands ? new Set(porcelain(dir)) : new Set();
  const dirtySnap = runCommands ? snapshotDirty(dir, before, excluded) : null;
  const entries = commandsIn.filter((c) => c && c.command);
  const results = new Array(entries.length);
  const baseOf = (c) => ({ id: String(c.id || c.kind), kind: c.kind, command: c.command, documented: !!documentedIn(c.command), documentedIn: documentedIn(c.command), ...(c.seeded ? { seeded: true } : {}), ...(hasOrigin(c) ? { origin: c.origin } : {}) });
  const runnable = [];
  entries.forEach((c, i) => {
    const base = baseOf(c);
    if (hasOrigin(c) && !memoryConfirmed) results[i] = { ...base, status: 'skipped-memory', why: MEMORY_SKIP_WHY, exitCode: null, ms: 0 };
    else if (c.verdict === 'wrong') results[i] = { ...base, status: 'skipped-wrong', exitCode: null, ms: 0 };
    else if (c.verdict === 'slow') results[i] = { ...base, status: 'skipped-slow', exitCode: null, ms: 0 };
    else if (!RUN_KINDS.has(c.kind)) results[i] = { ...base, status: 'skipped-kind', exitCode: null, ms: 0 };
    else if (!runCommands) results[i] = { ...base, status: 'skipped-mock', exitCode: null, ms: 0 };
    else runnable.push(i);
  });
  // Installs first, then the rest in map order; the output keeps map order.
  const order = [...runnable.filter((i) => entries[i].kind === 'install'), ...runnable.filter((i) => entries[i].kind !== 'install')];
  for (const i of order) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { results[i] = { ...baseOf(entries[i]), status: 'skipped-budget', exitCode: null, ms: 0 }; continue; }
    const r = runOne(dir, entries[i], Math.min(timeoutMs, remaining));
    // Killed because the card's budget ran out, not at its own timeout: not the command's fault, so
    // it is never a timeout (a hard failure after setup) but skipped-budget, cut short.
    results[i] = r.status === 'timeout' && remaining < timeoutMs
      ? { ...baseOf(entries[i]), ...r, status: 'skipped-budget', exitCode: null, cutByBudget: true }
      : { ...baseOf(entries[i]), ...r };
  }
  const commands = results;
  const dirty = dirtySnap ? restoreDirty(dirtySnap) : { changed: [], failed: [] };
  const written = runCommands ? porcelain(dir).filter((p) => !before.has(p) && !isExcluded(p, excluded)) : [];
  const restoreFailed = [...(written.length ? restorePaths(dir, written, excluded, before) : []), ...dirty.failed];
  let sideEffects = [...written, ...dirty.changed];
  if (sideEffects.length > SIDE_EFFECT_CAP) sideEffects = [...sideEffects.slice(0, SIDE_EFFECT_CAP), `+${sideEffects.length - SIDE_EFFECT_CAP} more`];

  // The view's engines are worca's run engines and `sources` is what the chip reads for each; without
  // a view (an older worca, or a unit test) nothing can be measured per tool, and the why says so.
  const engines = Array.isArray(view?.engines) ? view.engines : Object.keys(EXPECTED_FILE);
  const surfaces = {};
  const sizes = {};
  const overCap = { files: [], engines: [] };
  const perFile = Number(view?.limits?.perFile) > 0 ? Number(view.limits.perFile) : Infinity;
  const ctx = { text: {}, bytes: {}, skills, commands: confirmedIn, limits: view?.limits, agentsText: text['AGENTS.md'] };
  for (const e of engines) {
    const src = view?.sources?.[e];
    if (!src) {
      surfaces[e] = { surface: 'missing', files: [], expected: EXPECTED_FILE[e] || '', why: "no view of the chip's sources: nothing was measured for this tool" };
      continue;
    }
    const present = presentSources(dir, src, excluded);
    for (const f of present) {
      if (ctx.text[f] === undefined) {
        const body = read(join(dir, f)) ?? '';
        ctx.text[f] = body;
        ctx.bytes[f] = Buffer.byteLength(body);
        sizes[f] = ctx.bytes[f];
        if (ctx.bytes[f] > perFile && !overCap.files.includes(f)) overCap.files.push(f);
      }
    }
    const { overCap: engineOver, ...rest } = surfaceOf(e, present, ctx);
    surfaces[e] = rest;
    if (engineOver && !present.some((f) => ctx.bytes[f] > perFile)) overCap.engines.push(e);
  }
  const limits = view?.limits && typeof view.limits === 'object' ? { perFile: view.limits.perFile ?? null, total: view.limits.total ?? null } : null;
  return {
    version: 1,
    ...(Array.isArray(view?.engines) ? { engines: view.engines, labels: view.labels && typeof view.labels === 'object' ? view.labels : {} } : {}),
    selectedTools: (Array.isArray(map.tools) ? map.tools : []).filter((t) => engines.includes(t)),
    files: Object.fromEntries(INSTRUCTION_FILES.map((f) => [f, files[f]])),
    cursorRules: { mdc: files.cursorMdc, ignoredMd: ruleFiles.filter((f) => f.endsWith('.md')).map((f) => `.cursor/rules/${f}`) },
    skills,
    frontmatter: [...claudeSkills.frontmatter, ...agentSkills.frontmatter, ...qwenSkills.frontmatter],
    sizes,
    overCap,
    limits,
    agentsMd: { bytes: files['AGENTS.md'].bytes || 0, overCap: (files['AGENTS.md'].bytes || 0) > perFile },
    tools: surfaces,
    commands,
    excluded: [...excluded],
    sideEffects,
    restored: restoreFailed.length === 0,
    restoreFailed,
  };
}

/** worca's own mounts, read from run.json when the run has one (detached run roots), plus the defaults. */
export function injectedExclusions({ runRoot, pipelineDir }) {
  const manifest = (runRoot && readJson(join(runRoot, 'run.json'))) || (pipelineDir && readJson(join(pipelineDir, 'run.json'))) || {};
  const out = new Set(DEFAULT_EXCLUDED);
  for (const entries of Object.values(manifest.injectedPaths || {})) {
    for (const e of Array.isArray(entries) ? entries : []) if (e && typeof e.path === 'string') out.add(e.path.replace(/\/+$/, ''));
  }
  return [...out];
}

/** A member's checkout: ctx.repos (detached runs), then ctx.workspace.members (every workspace run), then repos/<key>. */
export function memberDir(ctx, key) {
  const find = (list) => (Array.isArray(list) ? list.find((r) => r && r.key === key)?.dir : null);
  return find(ctx.repos) || find(ctx.workspace?.members) || join(ctx.cwd, 'repos', key);
}

/** The final probe only: each command gets the status the same command text had in the baseline
    probe (`'none'` when the baseline did not run it), so a suite that was red before setup is never
    blamed on setup (see hardFailuresOf). */
export function annotateBaseline(result, baseline) {
  const statusesOf = (p) => new Map((Array.isArray(p?.commands) ? p.commands : []).filter((c) => c && typeof c.command === 'string').map((c) => [c.command, String(c.status || 'none')]));
  const annotate = (probe, base) => {
    const known = statusesOf(base);
    for (const c of probe.commands || []) c.baselineStatus = known.get(c.command) ?? 'none';
  };
  if (result.members) for (const key of Object.keys(result.members)) annotate(result.members[key], baseline?.members?.[key]);
  else annotate(result, baseline);
  return result;
}

/** The map's commands plus the seeded test commands it does not already have (tagged seeded). */
function withSeeded(m, seededCommands) {
  if (!Array.isArray(seededCommands)) return m;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return m;
  const known = new Set((Array.isArray(m.commands) ? m.commands : []).map((c) => c && c.command));
  const extra = [];
  for (const e of seededCommands) {
    const command = typeof e === 'string' ? e : e && e.command;
    if (typeof command !== 'string' || !command.trim() || known.has(command)) continue;
    known.add(command);
    extra.push({ id: `seeded-${extra.length + 1}`, kind: 'test', command, verdict: 'correct', seeded: true });
  }
  return { ...m, commands: [...(Array.isArray(m.commands) ? m.commands : []), ...extra] };
}

export default async function ({ inputs, outputs, ctx, log, readiness }) {
  const map = readJson(inputs.map?.path) || {};
  // Setup scores only the tools whose file the user approved on the plan card (plan.tools).
  const plan = readJson(inputs.plan?.path);
  if (plan && Array.isArray(plan.tools)) map.tools = plan.tools.filter((t) => typeof t === 'string');
  // The final probe also runs the commands the test seeder wrote, unless the map already has them.
  const seeded = readJson(inputs.tests?.path);
  if (seeded && !map.members) Object.assign(map, withSeeded(map, seeded.commands));
  if (seeded && map.members && seeded.members && typeof seeded.members === 'object') {
    for (const key of Object.keys(map.members)) map.members[key] = withSeeded(map.members[key], seeded.members[key]?.commands);
  }
  const view = readJson(inputs.view?.path);
  const excluded = injectedExclusions(ctx);
  const runCommands = !ctx.mock;
  // Who answered card A: the host's fresh view (never the chip snapshot in `view`, taken before Map ran). Card A is one
  // card on a workspace run too, so the field sits at the top of the view. No view (an older worca): nobody did.
  const cardA = readiness && typeof readiness === 'object' && readiness.cardA && typeof readiness.cardA === 'object' ? readiness.cardA : null;
  // One budget per card: every member shares the deadline so the card never outlives its timeout.
  const deadline = Date.now() + BUDGET_MS;
  let result;
  if (map.members && typeof map.members === 'object') {
    const members = {};
    for (const key of Object.keys(map.members).sort()) {
      const dir = memberDir(ctx, key);
      members[key] = probeRepo(dir, { map: { ...map.members[key], tools: map.tools || map.members[key].tools }, excluded, runCommands, deadline, view: view?.members?.[key] ?? view, cardA });
    }
    result = { version: 1, members };
  } else {
    result = probeRepo(ctx.cwd, { map, excluded, runCommands, deadline, view, cardA });
  }
  // The final probe (any card but the baseline's own output) compares with the baseline probe.
  const baselinePath = join(ctx.pipelineDir || dirname(outputs.probe.path), 'readiness-probe.json');
  if (resolve(outputs.probe.path) !== resolve(baselinePath) && existsSync(baselinePath)) annotateBaseline(result, readJson(baselinePath) || {});
  writeFileSync(outputs.probe.path, JSON.stringify(result, null, 2));
  const n = result.members ? Object.keys(result.members).length : 1;
  log('info', `probed ${n} project(s)${runCommands ? '' : ' (mock: no commands run)'}`);
  const all = result.members ? Object.values(result.members).flatMap((m) => m.commands || []) : (result.commands || []);
  const memSkipped = all.filter((c) => c.status === 'skipped-memory').length;
  if (memSkipped) log('info', `skipped ${memSkipped} command(s) from worca memory: nobody confirmed card A`);
  return { summary: `Probed ${n} project(s).` };
}
