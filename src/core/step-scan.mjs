// src/core/step-scan.mjs
// The post-execution scan of one step folder (run-folder-artifacts-design.md §6.1, D7).
// PURE fs, no DB: walks `<runDir>/steps/<node>-cN[-slice]/` and returns every regular
// file the agent left there — bounded (depth, count, size), dot-entries skipped,
// symlinks neither followed nor descended — with a FORMAT-only kind derived from
// the extension. The orchestrator indexes the result (kind-agnostic dedupe against
// rows already recorded) and turns the warnings into run-log lines. No `realpath`
// here: containment is enforced on READ (artifacts.mjs#resolveIndexedArtifactForRow).
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * `relative(base, p)` spelled with '/' on every OS — the store-layout key the
 * artifacts index, the pipeline_tasks file_rel_path column and the run log all
 * carry (a Windows-native 'steps\\x.md' would miss every '/'-keyed lookup). Lives
 * in this leaf module (node imports only) so the scanner that PRODUCES the skip
 * key and the harness/orchestrator/executor sites that write or delete rows all
 * spell it byte-for-byte the same.
 */
export function posixRel(base, p) {
  return relative(base, p).split(sep).join('/');
}

/** A rel path carrying a `..` segment (either separator) — never served, sized,
 *  or written. ONE spelling for the artifact index and the mock file writer. */
export const hasDotDot = (rel) => String(rel).split(/[\\/]/).includes('..');

export const SCAN_LIMITS = Object.freeze({ maxDepth: 8, maxFiles: 50, maxBytes: 5 * 1024 * 1024 });

// The extension -> kind table lives in src/shared (browser-importable) so the
// artifact viewer derives its binary set from the same table this scanner and the
// read route use.
export { KIND_BY_EXT, scanKindFor } from '../shared/artifact-kinds.mjs';
import { scanKindFor } from '../shared/artifact-kinds.mjs';

const mb = (n) => (n / (1024 * 1024)).toFixed(1);

/**
 * @param {string} stepDir  the absolute step folder (may not exist)
 * @param {{ pipelineDir: string, skip?: Set<string>, limits?: typeof SCAN_LIMITS }} o
 *   `pipelineDir` roots the rel paths (run-dir-relative, '/'-joined — the exact
 *   string recordArtifact stores); `skip` holds rel paths already indexed.
 * @returns {Promise<{ files: Array<{ path:string, relPath:string, kind:string, bytes:number }>, warnings: string[] }>}
 */
export async function scanStepFolder(stepDir, { pipelineDir, skip = new Set(), limits = SCAN_LIMITS } = {}) {
  const files = [];
  const warnings = [];
  const root = String(pipelineDir || stepDir);
  const toRel = (abs) => posixRel(root, abs);
  let full = false;

  async function walk(dir, depth) {
    if (full || depth > limits.maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }   // missing dir ⇒ nothing
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (full) return;
      if (ent.name.startsWith('.')) continue;                  // dot-files and dot-dirs
      const abs = join(dir, ent.name);
      // A symlinked directory reports isSymbolicLink(), not isDirectory(): never descended.
      if (ent.isDirectory()) { await walk(abs, depth + 1); continue; }
      if (!ent.isFile()) continue;                             // symlinks, sockets, fifos: never listed
      const rel = toRel(abs);
      if (skip.has(rel)) continue;
      let bytes;
      try { bytes = (await stat(abs)).size; } catch { continue; }
      if (bytes > limits.maxBytes) {
        warnings.push(`step folder: skipped ${rel} (${mb(bytes)} MB > ${Math.round(limits.maxBytes / (1024 * 1024))} MB)`);
        continue;
      }
      if (files.length >= limits.maxFiles) {
        warnings.push(`step folder: more than ${limits.maxFiles} files, the rest are not indexed`);
        full = true;
        return;
      }
      files.push({ path: abs, relPath: rel, kind: scanKindFor(ent.name), bytes });
    }
  }

  await walk(String(stepDir || ''), 0);
  return { files, warnings };
}
