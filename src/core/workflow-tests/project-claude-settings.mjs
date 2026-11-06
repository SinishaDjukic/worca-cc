// src/core/workflow-tests/project-claude-settings.mjs — workflow tests 3b (D72): in a Pretend project try's checkout, the
// project's own Claude Code settings lose their hooks and enabled plugins (they can send things); its instructions (CLAUDE.md,
// agents, skills, commands) and its other settings stay (Q7 a). Never follows a link: a settings file or a .claude folder that
// is one is removed (the link only), so nothing outside the checkout is read or written.
// Task 5 (security review I2, decision D72a): the hooks in the frontmatter of the project's skills, agents and commands go
// too. (M10): so do `extraKnownMarketplaces` and the settings `env` keys that would undo the try guard (Claude Code applies
// settings env to its tools: probe m10env). (M6): every file is replaced through a temp file and a rename, so a hardlink's
// other name (possibly outside the checkout) keeps its content.
import { randomBytes } from 'node:crypto';
import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { isTryStrippedKey } from './try-guard-env.mjs';

export const PROJECT_SETTINGS_FILES = Object.freeze(['.claude/settings.json', '.claude/settings.local.json']);
export const STRIPPED_SETTINGS_KEYS = Object.freeze(['hooks', 'enabledPlugins', 'extraKnownMarketplaces']);
/** The harness's setup stage while it switches them off: Worca's own setup (U-T2 reads a failure here as Worca's, 'copy'),
 *  never the person's setup command (TRY_SETUP_STAGE). */
export const PLUGINS_OFF_STAGE = 'Switching off the project\'s hooks and plugins';

// M10: the env layers of the try guard (try-guard-env.mjs withTryGuardEnv): its PATH stand-ins, git that cannot sign in, the
// forge CLIs' empty sign-in folders, WSL's view of them, its own WORCA_* keys, and the tokens it strips (isTryStrippedKey).
// Task 5 fix review (concern 3): NODE_OPTIONS and NODE_PATH, which the CLI also hands to Worca's own `node` hooks (the try
// guard) and could load the checkout's code into them (probe nodeopts-318: a project `--require` ran inside the hook).
// The dynamic loader's keys (LD_*, DYLD_*) do the same to any hook process, so they go too (controller decision, 2026-11-06).
const TRY_GUARD_ENV_KEYS = new Set(['PATH', 'GIT_SSH_COMMAND', 'GH_CONFIG_DIR', 'GLAB_CONFIG_DIR', 'AZURE_CONFIG_DIR', 'GIT_TERMINAL_PROMPT',
  'GCM_INTERACTIVE', 'WSLENV', 'NODE_OPTIONS', 'NODE_PATH']);
/** M10: a settings `env` key that would undo the try guard for the agent's tools (any spelling: Windows env names ignore case). */
export const isTryGuardEnvKey = (k) => {
  const u = String(k).toUpperCase();
  return TRY_GUARD_ENV_KEYS.has(u) || u.startsWith('LD_') || u.startsWith('DYLD_') || u.startsWith('GIT_CONFIG') || u.startsWith('WORCA_') || isTryStrippedKey(k);
};

/** The settings text without STRIPPED_SETTINGS_KEYS and the try guard's env keys (2-space JSON and a final newline), or null
 *  when nothing changes: no such key, or not a JSON object (the CLI ignores a file it cannot parse). A leading BOM is read. Pure. */
export function strippedSettingsText(text) {
  const r = settingsStrip(text);
  return r ? r.text : null;
}

/** strippedSettingsText, and the names of the env keys it left out (re-review 2 n5: the run log names them, never values). */
function settingsStrip(text) {
  const raw = String(text ?? '');
  const body = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  let s;
  try { s = JSON.parse(body); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = { ...s };
  let changed = false;
  let envKeys = [];
  for (const k of STRIPPED_SETTINGS_KEYS) if (Object.hasOwn(out, k)) { delete out[k]; changed = true; }
  if (out.env && typeof out.env === 'object' && !Array.isArray(out.env)) {
    envKeys = Object.keys(out.env).filter((k) => isTryGuardEnvKey(k));
    if (envKeys.length) { out.env = Object.fromEntries(Object.entries(out.env).filter(([k]) => !isTryGuardEnvKey(k))); changed = true; }
  }
  return changed ? { text: `${JSON.stringify(out, null, 2)}\n`, envKeys } : null;
}

// ── D72a: the frontmatter's top-level `hooks` key ───────────────────────────────────────────────────────────────────────
// Task 5 re-review 2 (N-I1): Worca reads a frontmatter the way Claude Code 2.1.318 does (its `xd` and `pMn`), then errs toward
// removing. The CLI: a leading BOM is dropped; no frontmatter unless a second `---` follows; the frontmatter is everything
// up to the first `---` after the opening line (even mid-line); Bun.YAML.parse reads it, and when that fails, every
// `key: value` line whose value has `: ` or one of {}[]*&#!|>%@` is quoted (`Bm`), leading tabs become two spaces each, and it
// is parsed again; a value that is not a mapping counts as none. Re-check on a CLI update (real-call-proof-3b.md).
const CLI_FRONTMATTER_RE = /^---\s*\n([\s\S]*?)---\s*\n?/d;
const CLI_QUOTE_RE = /[{}[\]*&#!|>%@`]|: /;
const HOOKS_KEY_RE = /^(?:hooks|"hooks"|'hooks')[ \t]*:(?=\s|$)/;
const bare = (l) => l.replace(/\r?\n$/, '');

/** The CLI's frontmatter in `text`: `{ bom, head, fm, tail }` (bom + head + fm + tail === text; `fm` is what the CLI parses), or
 *  null when the CLI reads none. */
function cliFrontmatter(text) {
  const raw = String(text ?? '');
  const bom = raw.charCodeAt(0) === 0xFEFF ? raw[0] : '';
  const e = raw.slice(bom.length);
  if (e.indexOf('---', 3) < 0) return null;
  const m = CLI_FRONTMATTER_RE.exec(e);
  if (!m) return null;
  const [start, end] = m.indices[1];
  return { bom, head: e.slice(0, start), fm: e.slice(start, end), tail: e.slice(end) };
}

/** One YAML reading of `src` (merge keys on unless `merge` is false, a repeated key allowed): `{ ok: true, value }` or
 *  `{ ok: false }`. */
function yamlReading(src, { merge = true } = {}) {
  try {
    const doc = parseDocument(src.replace(/\r(?!\n)/g, '\n'), { merge, uniqueKeys: false });
    if (doc.errors.length) return { ok: false };
    return { ok: true, value: doc.toJS({ maxAliasCount: 1000 }) };
  } catch { return { ok: false }; }
}

/** The CLI's fallback text (`Bm`, then its leading-tab change), line for line. */
function cliQuotedText(fm) {
  return fm.split('\n').map((s) => {
    const h = s.match(/^([a-zA-Z_-]+):\s+(\S.*)$/);
    if (!h) return s;
    const [, k, w] = h;
    if ((w.startsWith('"') && w.endsWith('"')) || (w.startsWith('\'') && w.endsWith('\''))) return s;
    if (w.startsWith('[') && w.endsWith(']')) { const r = yamlReading(w); if (r.ok && Array.isArray(r.value)) return s; }
    return CLI_QUOTE_RE.test(w) ? `${k}: "${w.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : s;
  }).join('\n').replace(/^\t+/gm, (t) => '  '.repeat(t.length));
}

const isMapping = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Both readings (the strict one and the CLI's fallback; both, because Worca's YAML parser is not Bun's): whether either
 *  parses, whether either has a top-level `hooks` key (merge keys applied: erring toward removing), and the mapping to rewrite
 *  from (the strict one first). Re-review 3 (m2): that mapping is read with merge keys off and without its `<<` entry, as the
 *  CLI applies no merge (probe merge-nostrip-318): the rewrite never brings a merge's keys to the top level. */
function readings(fm) {
  const all = [fm, cliQuotedText(fm)].map((src) => ({ src, r: yamlReading(src) })).filter((x) => x.r.ok);
  const maps = all.filter((x) => isMapping(x.r.value));
  let mapping = null;
  if (maps.length) {
    const plain = yamlReading(maps[0].src, { merge: false });
    if (plain.ok && isMapping(plain.value)) { const { '<<': _merge, ...rest } = plain.value; mapping = rest; }
  }
  return { parses: all.length > 0, hooks: maps.some((x) => Object.hasOwn(x.r.value, 'hooks')), mapping };
}

/** Whether a one-line YAML value closes every quote and bracket it opens (a `#` comment after whitespace ends it). */
function closedOnItsLine(v) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) { if (quote === '\'' && v[i + 1] === '\'') { i++; continue; } quote = null; }
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) break;
    if (c === '"' || c === '\'') quote = c;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return !quote && depth === 0;
}

/** D72a's line strip of a frontmatter `fm`: every top-level `hooks:` line and its indented block (spaces or tabs: the CLI turns
 *  leading tabs into spaces) removed, every other byte kept. null when there is no such line or the lines alone cannot say
 *  where its value ends (a flow or quoted value spread over lines) or the block holds an anchor used outside it. */
function lineStripped(fm) {
  const lines = fm.match(/[^\n]*\n|[^\n]+$/g) || [];
  const drop = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!HOOKS_KEY_RE.test(bare(lines[i]))) continue;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const b = bare(lines[j]);
      if (!b.trim()) continue;
      if (!/^[ \t]/.test(b)) break;
      last = j;
    }
    const value = bare(lines[i]).replace(HOOKS_KEY_RE, '').trim().replace(/^&\S+\s*/, '');
    if (/^[{["']/.test(value) && (last > i || !closedOnItsLine(value))) return null;
    for (let j = i; j <= last; j++) drop.add(j);
    i = last;
  }
  if (!drop.size) return null;
  const block = lines.filter((_, j) => drop.has(j)).map(bare).join('\n');
  const rest = lines.filter((_, j) => !drop.has(j)).map(bare).join('\n');
  for (const m of block.matchAll(/(?:^|[\s[{,:])&([^\s,[\]{}]+)/g)) if (rest.includes(`*${m[1]}`)) return null;
  return lines.filter((_, j) => !drop.has(j)).join('');
}

/** A frontmatter rewritten from a YAML reading without its `hooks` key (the line ending kept). */
function rewrittenFrontmatter(mapping, fm) {
  const { hooks: _hooks, ...rest } = mapping;
  const y = Object.keys(rest).length ? stringify(rest, { lineWidth: 0 }) : '';
  return fm.includes('\r\n') ? y.replace(/\n/g, '\r\n') : y;
}

/**
 * D72a: a skill's, agent's or command's text without the top-level `hooks` key of its YAML frontmatter, read the way Claude
 * Code reads it (see above). Returns null when there is nothing to change (the CLI reads no frontmatter, or no `hooks` in
 * it), `{ text }` when Worca removed it, and `{ text, unsafe: true }` when it wrote what it could but cannot be sure (named in
 * a run warning). Pure. In order:
 *  1. Neither reading has `hooks` and one parses: null (a `hooks:` line inside a string or a nested key is not one).
 *  2. Nothing parses (re-review 2, N-I1: when in doubt, remove; re-review 3, m1: the CLI reads no field of it in a normal run,
 *     2.1.318 `xd` keeps `{}` when `pMn` fails, so the try must not read any either): the line-stripped text while it still
 *     does not parse, else, when it mentions `hooks`, an empty frontmatter (read as empty too); `unsafe` either way.
 *  3. The line strip: the `hooks:` lines and their blocks go, every other byte stays. When a reading of the result parses and
 *     has no `hooks`: `{ text }`.
 *  4. A reading has `hooks` that the line strip cannot remove (review m4: an indented root mapping, a `? hooks` key, a `<<:`
 *     merge, a flow-style `{…}` frontmatter, an escaped key, a quoted or flow value over lines, an anchor used elsewhere): the
 *     frontmatter is rewritten from that reading without `hooks` (the same values; its comments and layout go), checked again.
 *  5. Else: the line-stripped text when there is one, else an empty frontmatter; `unsafe` either way.
 * `rewrite: false` (re-review 3, I1: a file that is not UTF-8) skips step 4, which would rewrite non-ASCII values too.
 */
export function strippedFrontmatterText(text, { rewrite = true } = {}) {
  const f = cliFrontmatter(text);
  if (!f) return null;
  const at = (fm) => f.bom + f.head + fm + f.tail;
  const before = readings(f.fm);
  if (before.parses && !before.hooks) return null;
  const ls = lineStripped(f.fm);
  if (!before.parses) {
    if (ls !== null && !readings(ls).parses) return { text: at(ls), unsafe: true };
    return ls !== null || /hooks/i.test(f.fm) ? { text: at(''), unsafe: true } : null;
  }
  if (ls !== null) {
    const after = readings(ls);
    if (after.parses && !after.hooks) return { text: at(ls) };
  }
  if (rewrite && before.mapping) {
    const fm = rewrittenFrontmatter(before.mapping, f.fm);
    const check = readings(fm);
    if (check.parses && !check.hooks) return { text: at(fm) };
  }
  return { text: at(ls ?? ''), unsafe: true };
}

/** Whether the CLI's reading of `text` keeps a top-level `hooks` key: a reading has one, or none parses and a top-level
 *  `hooks:` line is left (re-review 2, N-I1: when in doubt, it may). */
function cliKeepsHooks(text) {
  const f = cliFrontmatter(text);
  if (!f) return false;
  const r = readings(f.fm);
  return r.hooks || (!r.parses && f.fm.split('\n').some((l) => HOOKS_KEY_RE.test(bare(l))));
}

/**
 * D72a on a file's bytes: null when there is nothing to change, else `{ bytes, unsafe }`. Claude Code reads these files as
 * UTF-8 (2.1.318 `tT`: `{ encoding: "utf8" }`, a bad byte read as U+FFFD), so a file that is not UTF-8 still loads its
 * frontmatter hooks. Re-review 3 (I1): such a file is stripped on its latin1 reading (one character per byte; everything the
 * strip reads or cuts, `---`, `hooks`, `:`, indentation and line ends, is ASCII) and written back as latin1, so every byte the
 * strip does not cut stays; never rewritten from a YAML reading (`rewrite: false`: that would rewrite non-ASCII values too).
 * Checked on the CLI's own (UTF-8) reading of the result: where the two readings disagree (a non-ASCII space after the
 * opening `---`, say), the CLI's reading is stripped and written as UTF-8 (its bad bytes become U+FFFD, as the CLI reads
 * them). Always `unsafe` (named): the CLI's lossy decoding is not one Worca can mirror byte for byte.
 */
function strippedFrontmatterBytes(buf) {
  const view = buf.toString('utf8');
  if (Buffer.from(view, 'utf8').equals(buf)) {
    const r = strippedFrontmatterText(view);
    return r && { bytes: Buffer.from(r.text, 'utf8'), unsafe: !!r.unsafe };
  }
  const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF ? 3 : 0;   // the CLI drops a UTF-8 BOM
  const r = strippedFrontmatterText(buf.subarray(bom).toString('latin1'), { rewrite: false });
  const out = r ? Buffer.concat([buf.subarray(0, bom), Buffer.from(r.text, 'latin1')]) : buf;
  if (!cliKeepsHooks(out.toString('utf8'))) return r && { bytes: out, unsafe: true };
  const lossy = strippedFrontmatterText(view);
  return lossy && { bytes: Buffer.from(lossy.text, 'utf8'), unsafe: true };
}

/** D72a: the trees (in a `.claude` folder) whose markdown files Claude Code reads frontmatter hooks from, and which files. */
const FRONTMATTER_TREES = Object.freeze([['skills', (n) => /^skill\.md$/i.test(n)], ['agents', (n) => /\.md$/i.test(n)],
  ['commands', (n) => /\.md$/i.test(n)]]);
const abs = (dir, rel) => join(dir, ...rel.split('/'));
/** How deep a walk goes; a folder below it is named in `unparsed` (not checked), never passed over silently (review m13). */
const WALK_DEPTH_MAX = 32;
/** I-2: folders the nested `.claude` search never enters (gitignored ones are skipped too, re-review 2 n4). */
const NESTED_SKIP = new Set(['node_modules', '.git']);
/** Re-review 2 (n4): how many folders the nested `.claude` search reads at most; past it the harness logs a line. */
export const WALK_DIRS_MAX = 20000;
let walkDirsMaxDefault = WALK_DIRS_MAX;
/** Test seam: a smaller default cap for the harness's call. */
export const _testing = { walkDirsMax(n) { walkDirsMaxDefault = n; }, reset() { walkDirsMaxDefault = WALK_DIRS_MAX; } };

/** M6: replace `file` with `data` (a string, written as UTF-8, or a Buffer) through a new temp file and a rename: never written
 *  through a link or a hardlink. */
async function replaceFile(file, data) {
  const tmp = `${file}.worca-${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data, { encoding: 'utf8', flag: 'wx' });
  try { await rename(tmp, file); } catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw e; }
}

/** The files under `rel` that `match`, depth first in name order; a link is listed in `links` and not followed; a folder too
 *  deep to walk is listed in `deep`. */
async function walkTree(dir, rel, match, found, links, deep, depth = 0) {
  if (depth > WALK_DEPTH_MAX) { deep.push(rel); return; }
  let names;
  try { names = (await readdir(abs(dir, rel))).sort(); } catch { return; }
  for (const name of names) {
    const r = `${rel}/${name}`;
    let st;
    try { st = await lstat(abs(dir, r)); } catch { continue; }
    if (st.isSymbolicLink()) links.push(r);   // a symlink or, on Windows, a junction
    else if (st.isDirectory()) await walkTree(dir, r, match, found, links, deep, depth + 1);
    else if (st.isFile() && match(name)) found.push(r);
  }
}

/**
 * Task 5 fix review I-2: the `.claude` folders below the checkout root, as paths relative to it (`packages/web/.claude`).
 * Claude Code 2.1.318 loads a nested `.claude/skills` once the agent works with files in that folder and runs its skills'
 * frontmatter hooks (probe nested-read-318). Never enters node_modules, .git or a link; a `.claude` that is a link goes to
 * `links`; a folder too deep to walk goes to `deep`. Depth first, in name order. Re-review 2 (n4): a gitignored folder
 * (`out.ignored`) is not entered, as the CLI skips a gitignored skills dir ("[skills] Skipped gitignored skills dir"), and
 * at most `out.max` folders are read (`out.capped` then).
 */
async function nestedClaudeDirs(dir, rel, out, depth = 0) {
  if (depth > WALK_DEPTH_MAX) { out.deep.push(rel); return; }
  if (out.visited >= out.max) { out.capped = true; return; }
  out.visited++;
  let entries;
  try { entries = (await readdir(rel ? abs(dir, rel) : dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { return; }
  for (const e of entries) {
    if (out.capped) return;
    if (NESTED_SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (out.ignored.has(r)) continue;
    if (e.name === '.claude') {
      if (!rel) continue;                                       // the root's own: done by the caller
      if (e.isSymbolicLink()) out.links.push(r);                // a symlink or, on Windows, a junction: never followed
      else if (e.isDirectory()) out.dirs.push(r);
      continue;
    }
    if (e.isDirectory() && !e.isSymbolicLink()) await nestedClaudeDirs(dir, r, out, depth + 1);
  }
}

/** D72a in one `.claude` folder (`claudeRel`): its skills, agents and commands lose their frontmatter hooks; links in those
 *  trees are removed; files Worca is not sure it fully stripped (written anyway), files not in UTF-8 (stripped too, re-review
 *  3 I1) and folders too deep to walk are named. */
async function stripFrontmatterTrees(checkoutDir, claudeRel, { changed, links, unparsed }) {
  for (const [name, match] of FRONTMATTER_TREES) {
    const tree = `${claudeRel}/${name}`;
    let tst = null;
    try { tst = await lstat(abs(checkoutDir, tree)); } catch { continue; }
    if (tst.isSymbolicLink()) { await rm(abs(checkoutDir, tree), { force: true }); links.push(tree); continue; }
    if (!tst.isDirectory()) continue;
    const found = [];
    const treeLinks = [];
    const deep = [];
    await walkTree(checkoutDir, tree, match, found, treeLinks, deep);
    for (const l of treeLinks) { await rm(abs(checkoutDir, l), { force: true }); links.push(l); }
    for (const rel of found) {
      const r = strippedFrontmatterBytes(await readFile(abs(checkoutDir, rel)));
      if (r === null) continue;
      await replaceFile(abs(checkoutDir, rel), r.bytes);   // N-I1: written even when unsure (as far as Worca could strip it)
      changed.push(rel);
      if (r.unsafe) unparsed.push(rel);
    }
    unparsed.push(...deep);
  }
}

/**
 * D72: switch the project's hooks and plugins off in `checkoutDir`. `changed`: the files rewritten; `links`: the links
 * removed (`.claude` itself, a settings file, or a link inside the skills, agents or commands folders); `unparsed` (present
 * only when there is one): skill, agent or command files Worca is not sure it removed every hook from (D72a; re-review 2 N-I1:
 * written as far as Worca could strip them, and also in `changed`; re-review 3 I1: every file that is not UTF-8, stripped too),
 * and folders too deep to walk. I-2 (Task 5 fix review): the skills, agents and commands of every `.claude` folder below
 * the root (not in node_modules or .git) are treated the same way, and a nested `.claude` that is a link is removed; only the
 * root's settings files are ones the CLI loads. Throws only when a file cannot be read or written (the caller ends the try).
 * Re-review 2: `envKeys` (only when there is one): per settings file, the names of the env keys left out (n5; never values).
 * `git(args)` (the harness's, run in the checkout: `{ ok, stdout }`) lists the gitignored folders the nested search skips
 * (n4); without it, or when it fails (a Folder try), only node_modules and .git are skipped. `walkCapped` (only when it
 * happened): the nested search stopped after that many folders.
 * @returns {Promise<{changed: string[], links: string[], unparsed?: string[], envKeys?: {file: string, keys: string[]}[],
 *   walkCapped?: number}>}
 */
export async function stripProjectClaudeSettings(checkoutDir, { git = null, walkDirsMax = walkDirsMaxDefault } = {}) {
  const out = { changed: [], links: [], unparsed: [] };
  const { changed, links, unparsed } = out;
  const envKeys = [];
  let st = null;
  try { st = await lstat(join(checkoutDir, '.claude')); } catch { /* no root .claude: the nested ones are still looked for */ }
  if (st && st.isSymbolicLink()) {   // a symlink or, on Windows, a junction: never read through it
    await rm(join(checkoutDir, '.claude'), { force: true });
    links.push('.claude');
  } else if (st && st.isDirectory()) {
    for (const rel of PROJECT_SETTINGS_FILES) {
      const file = abs(checkoutDir, rel);
      let fst = null;
      try { fst = await lstat(file); } catch { continue; }
      if (fst.isSymbolicLink()) { await rm(file, { force: true }); links.push(rel); continue; }
      if (!fst.isFile()) continue;
      const next = settingsStrip(await readFile(file, 'utf8'));
      if (next === null) continue;
      await replaceFile(file, next.text);
      changed.push(rel);
      if (next.envKeys.length) envKeys.push({ file: rel, keys: next.envKeys });
    }
    await stripFrontmatterTrees(checkoutDir, '.claude', out);
  }
  const nested = { dirs: [], links: [], deep: [], ignored: await ignoredFolders(git), visited: 0, max: walkDirsMax, capped: false };
  await nestedClaudeDirs(checkoutDir, '', nested);
  for (const l of nested.links) { await rm(abs(checkoutDir, l), { force: true }); links.push(l); }
  for (const d of nested.dirs) await stripFrontmatterTrees(checkoutDir, d, out);
  unparsed.push(...nested.deep);
  return { changed, links, ...(unparsed.length ? { unparsed } : {}), ...(envKeys.length ? { envKeys } : {}),
    ...(nested.capped ? { walkCapped: nested.visited } : {}) };
}

/** n4: the checkout's gitignored folders (untracked, collapsed: `target`, `packages/new/target`), as paths relative to it;
 *  empty when there is no `git` or it fails. */
async function ignoredFolders(git) {
  if (typeof git !== 'function') return new Set();
  let r;
  try { r = await git(['-c', 'core.quotePath=false', 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']); } catch { return new Set(); }
  if (!r || !r.ok || typeof r.stdout !== 'string') return new Set();
  return new Set(r.stdout.split('\0').filter((p) => p.endsWith('/')).map((p) => p.slice(0, -1)));
}
