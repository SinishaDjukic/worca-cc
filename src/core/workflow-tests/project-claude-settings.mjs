// src/core/workflow-tests/project-claude-settings.mjs — workflow tests 3b (D72): in a Pretend project try's checkout, the
// project's own Claude Code settings lose their hooks and enabled plugins (they can send things); its instructions (CLAUDE.md,
// agents, skills, commands) and its other settings stay (Q7 a). Never follows a link: a settings file or a .claude folder that
// is one is removed (the link only), so nothing outside the checkout is read or written.
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PROJECT_SETTINGS_FILES = Object.freeze(['.claude/settings.json', '.claude/settings.local.json']);
export const STRIPPED_SETTINGS_KEYS = Object.freeze(['hooks', 'enabledPlugins']);
/** The harness's setup stage while it switches them off: Worca's own setup (U-T2 reads a failure here as Worca's, 'copy'),
 *  never the person's setup command (TRY_SETUP_STAGE). */
export const PLUGINS_OFF_STAGE = 'Switching off the project\'s hooks and plugins';

/** The settings text without STRIPPED_SETTINGS_KEYS (2-space JSON and a final newline), or null when nothing changes: no
 *  such key, or not a JSON object (the CLI ignores a file it cannot parse). A leading BOM is read. Pure. */
export function strippedSettingsText(text) {
  const raw = String(text ?? '');
  const body = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  let s;
  try { s = JSON.parse(body); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (!STRIPPED_SETTINGS_KEYS.some((k) => Object.hasOwn(s, k))) return null;
  const out = { ...s };
  for (const k of STRIPPED_SETTINGS_KEYS) delete out[k];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * D72: switch the project's hooks and plugins off in `checkoutDir`. `changed`: the files rewritten; `links`: the links
 * removed (`.claude` itself, or a settings file). Throws only when a file cannot be read or written (the caller ends the try).
 * @returns {Promise<{changed: string[], links: string[]}>}
 */
export async function stripProjectClaudeSettings(checkoutDir) {
  const changed = [];
  const links = [];
  let st = null;
  try { st = await lstat(join(checkoutDir, '.claude')); } catch { return { changed, links }; }
  if (st.isSymbolicLink()) {   // a symlink or, on Windows, a junction: never read through it
    await rm(join(checkoutDir, '.claude'), { force: true });
    links.push('.claude');
    return { changed, links };
  }
  if (!st.isDirectory()) return { changed, links };
  for (const rel of PROJECT_SETTINGS_FILES) {
    const file = join(checkoutDir, ...rel.split('/'));
    let fst = null;
    try { fst = await lstat(file); } catch { continue; }
    if (fst.isSymbolicLink()) { await rm(file, { force: true }); links.push(rel); continue; }
    if (!fst.isFile()) continue;
    const next = strippedSettingsText(await readFile(file, 'utf8'));
    if (next === null) continue;
    await writeFile(file, next, 'utf8');
    changed.push(rel);
  }
  return { changed, links };
}
