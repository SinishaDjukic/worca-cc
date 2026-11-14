// src/core/repo-readiness/has-code.mjs
// Does a project directory hold code worth judging? A project manifest at the root, or a source file within a few
// levels (a known manifest from facts.mjs, or a source file outside dot-folders and HEAVY_DIRS). A README-only (or docs-only) folder has none. Sync, bounded, never throws.
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { HEAVY_DIRS, MANIFESTS } from './facts.mjs';

const SOURCE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.cs',
  '.php', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.mm', '.lua', '.ex', '.exs', '.dart', '.vue', '.svelte',
  '.sh', '.sql', '.r', '.hs', '.clj', '.ml', '.zig', '.csproj', '.sln',
  '.html', '.css', '.scss', '.tf', '.ipynb', '.ps1', '.pl', '.jl', '.groovy', '.fs',
]);
const MAX_ENTRIES = 2000;   // one bounded walk: never an unbounded read of a huge tree

export function projectHasCode(dir, { folderDepth = 2 } = {}) {
  try {
    let seen = 0;
    const walk = (d, depth) => {
      const entries = readdirSync(d, { withFileTypes: true });
      if (depth === 0 && entries.some((e) => e.isFile() && MANIFESTS.includes(e.name))) return true;   // before the entry cap
      for (const e of entries) {
        if (++seen > MAX_ENTRIES) return false;
        if (e.isFile()) {
          if (SOURCE_EXT.has(extname(e.name).toLowerCase())) return true;
        }
      }
      if (depth >= folderDepth) return false;
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && !HEAVY_DIRS.includes(e.name) && walk(join(d, e.name), depth + 1)) return true;
      }
      return false;
    };
    return walk(dir, 0);
  } catch { return false; }
}
