// test/helpers/import-closure.mjs — the static import closure of a module: every repo module it
// reaches through `import … from`, `export … from` and `import '…'`, and the bare specifiers
// (node builtins, packages) on the way. import() and require() are not followed.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const STATIC_IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

/** @returns {{modules: string[], bare: string[]}} repo-relative module paths and bare specifiers, sorted */
export function importClosure(entry) {
  const modules = new Set();
  const bare = new Set();
  const walk = (file) => {
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith('.')) { bare.add(spec); continue; }
      const dep = resolve(dirname(file), spec);
      const rel = relative(REPO, dep).split('\\').join('/');
      if (!modules.has(rel)) { modules.add(rel); walk(dep); }
    }
  };
  walk(resolve(REPO, entry));
  return { modules: [...modules].sort(), bare: [...bare].sort() };
}
