// src/core/engines/sessions.mjs
// Removing a run's engine sessions when it is archived (plans/core-protection-layer-design.md §4.4 `sessions`): each
// adapter names where its CLI keeps a session; this walks that store and removes only the entries named by the run's
// own session ids. It never follows a link out of the store, and never touches a sign-in file (auth.json, the
// keychain, .credentials.json): those are never named by a session id.
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isWithin } from '../fs-scope.mjs';

/**
 * Remove every entry under `root` (down to `depth` directory levels, links never followed) whose name `match`es.
 * @param {string} root  the session store
 * @param {(name: string) => boolean} match
 * @returns {Promise<{removed: string[], failed: {path: string, error: string}[]}>}
 */
export async function removeSessionEntries(root, match, { depth = 0 } = {}) {
  const out = { removed: [], failed: [] };
  let real;
  try { real = realpathSync(root); } catch { return out; }   // no store: nothing to remove
  const hits = [];
  const walk = (dir, level) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (match(e.name)) { hits.push(p); continue; }
      if (level < depth && e.isDirectory() && !e.isSymbolicLink()) walk(p, level + 1);
    }
  };
  walk(real, 0);
  for (const p of hits) {
    try {
      // The entry itself may be a link: rm removes the link, never its target, and a directory's walk below never
      // follows the links inside it. Its parent must still be inside the store.
      lstatSync(p);
      if (!isWithin(realpathSync(dirname(p)), real)) throw new Error('outside the session store');
      await rm(p, { recursive: true, force: false });
      out.removed.push(p);
    } catch (err) { out.failed.push({ path: p, error: err?.code || err?.message || String(err) }); }
  }
  return out;
}
