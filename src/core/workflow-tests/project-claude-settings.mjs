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
const TRY_GUARD_ENV_KEYS = new Set(['PATH', 'GIT_SSH_COMMAND', 'GH_CONFIG_DIR', 'GLAB_CONFIG_DIR', 'AZURE_CONFIG_DIR', 'GIT_TERMINAL_PROMPT',
  'GCM_INTERACTIVE', 'WSLENV', 'NODE_OPTIONS', 'NODE_PATH']);
/** M10: a settings `env` key that would undo the try guard for the agent's tools (any spelling: Windows env names ignore case). */
export const isTryGuardEnvKey = (k) => {
  const u = String(k).toUpperCase();
  return TRY_GUARD_ENV_KEYS.has(u) || u.startsWith('GIT_CONFIG') || u.startsWith('WORCA_') || isTryStrippedKey(k);
};

/** The settings text without STRIPPED_SETTINGS_KEYS and the try guard's env keys (2-space JSON and a final newline), or null
 *  when nothing changes: no such key, or not a JSON object (the CLI ignores a file it cannot parse). A leading BOM is read. Pure. */
export function strippedSettingsText(text) {
  const raw = String(text ?? '');
  const body = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  let s;
  try { s = JSON.parse(body); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = { ...s };
  let changed = false;
  for (const k of STRIPPED_SETTINGS_KEYS) if (Object.hasOwn(out, k)) { delete out[k]; changed = true; }
  if (out.env && typeof out.env === 'object' && !Array.isArray(out.env)) {
    const env = Object.fromEntries(Object.entries(out.env).filter(([k]) => !isTryGuardEnvKey(k)));
    if (Object.keys(env).length !== Object.keys(out.env).length) { out.env = env; changed = true; }
  }
  return changed ? `${JSON.stringify(out, null, 2)}\n` : null;
}

// ── D72a: the frontmatter's top-level `hooks` key ───────────────────────────────────────────────────────────────────────
const HOOKS_KEY_RE = /^(?:hooks|"hooks"|'hooks')[ \t]*:(?=\s|$)/;
const bare = (l) => l.replace(/\r?\n$/, '');
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

/**
 * D72a: a skill's, agent's or command's text without the top-level `hooks:` key of its YAML frontmatter and that key's
 * indented block; every other byte (the BOM, line endings, other keys, the body) stays. `{ text }` when it changed, null when
 * there is nothing to change (no frontmatter, no such key), `{ unsafe: true }` when Worca cannot change it safely (no closing
 * line, two such keys, a tab in the block, a flow or quoted value spread over lines, an anchor used outside the block). Pure.
 */
export function strippedFrontmatterText(text) {
  const raw = String(text ?? '');
  const bom = raw.charCodeAt(0) === 0xFEFF ? '﻿' : '';
  const lines = raw.slice(bom.length).match(/[^\n]*\n|[^\n]+$/g) || [];
  if (!lines.length || bare(lines[0]).trimEnd() !== '---') return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (/^(?:---|\.\.\.)\s*$/.test(bare(lines[i]))) { close = i; break; }
  if (close < 0) return lines.slice(1).some((l) => HOOKS_KEY_RE.test(bare(l))) ? { unsafe: true } : null;
  const fm = lines.slice(1, close);
  const at = fm.flatMap((l, i) => (HOOKS_KEY_RE.test(bare(l)) ? [i] : []));
  if (!at.length) return null;
  if (at.length > 1) return { unsafe: true };
  const i = at[0];
  let last = i;
  for (let j = i + 1; j < fm.length; j++) {
    const b = bare(fm[j]);
    if (!b.trim()) continue;
    if (!/^[ \t]/.test(b)) break;
    if (/^ *\t/.test(b)) return { unsafe: true };   // YAML has no tab indentation: the CLI's reading is unknown
    last = j;
  }
  const value = bare(fm[i]).replace(HOOKS_KEY_RE, '').trim().replace(/^&\S+\s*/, '');
  if (/^[{["']/.test(value) && (last > i || !closedOnItsLine(value))) return { unsafe: true };
  const block = fm.slice(i, last + 1).map(bare).join('\n');
  const rest = [...fm.slice(0, i), ...fm.slice(last + 1)].map(bare).join('\n');
  for (const m of block.matchAll(/(?:^|[\s[{,:])&([^\s,[\]{}]+)/g)) if (rest.includes(`*${m[1]}`)) return { unsafe: true };
  return { text: bom + lines[0] + fm.slice(0, i).join('') + fm.slice(last + 1).join('') + lines.slice(close).join('') };
}

/** D72a: the trees whose markdown files Claude Code reads frontmatter hooks from, and which files in them. */
const FRONTMATTER_TREES = Object.freeze([['.claude/skills', (n) => /^skill\.md$/i.test(n)], ['.claude/agents', (n) => /\.md$/i.test(n)],
  ['.claude/commands', (n) => /\.md$/i.test(n)]]);
const abs = (dir, rel) => join(dir, ...rel.split('/'));

/** M6: replace `file` with `text` through a new temp file and a rename: never written through a link or a hardlink. */
async function replaceFile(file, text) {
  const tmp = `${file}.worca-${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' });
  try { await rename(tmp, file); } catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw e; }
}

/** The files under `rel` that `match`, depth first in name order; a link is listed in `links` and not followed. */
async function walkTree(dir, rel, match, found, links, depth = 0) {
  if (depth > 32) return;
  let names;
  try { names = (await readdir(abs(dir, rel))).sort(); } catch { return; }
  for (const name of names) {
    const r = `${rel}/${name}`;
    let st;
    try { st = await lstat(abs(dir, r)); } catch { continue; }
    if (st.isSymbolicLink()) links.push(r);   // a symlink or, on Windows, a junction
    else if (st.isDirectory()) await walkTree(dir, r, match, found, links, depth + 1);
    else if (st.isFile() && match(name)) found.push(r);
  }
}

/**
 * D72: switch the project's hooks and plugins off in `checkoutDir`. `changed`: the files rewritten; `links`: the links
 * removed (`.claude` itself, a settings file, or a link inside the skills, agents or commands folders); `unparsed` (present
 * only when there is one): skill, agent or command files whose frontmatter Worca could not change safely (D72a), left as they
 * are. Throws only when a file cannot be read or written (the caller ends the try).
 * @returns {Promise<{changed: string[], links: string[], unparsed?: string[]}>}
 */
export async function stripProjectClaudeSettings(checkoutDir) {
  const changed = [];
  const links = [];
  const unparsed = [];
  const done = () => ({ changed, links, ...(unparsed.length ? { unparsed } : {}) });
  let st = null;
  try { st = await lstat(join(checkoutDir, '.claude')); } catch { return done(); }
  if (st.isSymbolicLink()) {   // a symlink or, on Windows, a junction: never read through it
    await rm(join(checkoutDir, '.claude'), { force: true });
    links.push('.claude');
    return done();
  }
  if (!st.isDirectory()) return done();
  for (const rel of PROJECT_SETTINGS_FILES) {
    const file = abs(checkoutDir, rel);
    let fst = null;
    try { fst = await lstat(file); } catch { continue; }
    if (fst.isSymbolicLink()) { await rm(file, { force: true }); links.push(rel); continue; }
    if (!fst.isFile()) continue;
    const next = strippedSettingsText(await readFile(file, 'utf8'));
    if (next === null) continue;
    await replaceFile(file, next);
    changed.push(rel);
  }
  for (const [tree, match] of FRONTMATTER_TREES) {
    let tst = null;
    try { tst = await lstat(abs(checkoutDir, tree)); } catch { continue; }
    if (tst.isSymbolicLink()) { await rm(abs(checkoutDir, tree), { force: true }); links.push(tree); continue; }
    if (!tst.isDirectory()) continue;
    const found = [];
    const treeLinks = [];
    await walkTree(checkoutDir, tree, match, found, treeLinks);
    for (const l of treeLinks) { await rm(abs(checkoutDir, l), { force: true }); links.push(l); }
    for (const rel of found) {
      const buf = await readFile(abs(checkoutDir, rel));
      const text = buf.toString('utf8');
      const r = strippedFrontmatterText(text);
      if (r === null) continue;
      if (r.unsafe || !Buffer.from(text, 'utf8').equals(buf)) { unparsed.push(rel); continue; }   // not UTF-8: not rewritten
      await replaceFile(abs(checkoutDir, rel), r.text);
      changed.push(rel);
    }
  }
  return done();
}
