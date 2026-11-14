// experiments/messaging-bus/lib/task-files.mjs — the per-task file list (plan §3.3 file-list rule, §4.1).
// A Decompose task file lists the files it may touch under `## Files you may touch` as
// `- Create: \`p\`` / `- Modify: \`p\`` / `- Delete: \`p\`` / `- \`p\`` bullets. Nothing machine-readable
// exists in the product yet, so the hook reads the list from the markdown.

const SECTION_RE = /^##\s+Files you may touch\s*$/i;
const BULLET_RE = /^\s*[-*]\s+(?:(?:Create|Modify|Delete):\s*)?`([^`]+)`/;

/** POSIX, repo-relative, no `./`, `..` resolved, duplicate `/` removed; null when absolute, empty or escaping the root. */
export function normPath(p) {
  if (typeof p !== 'string') return null;
  const s = p.replace(/\\/g, '/').trim();
  if (!s || s.startsWith('/')) return null;
  const out = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/** The `## Files you may touch` section, up to the next `## ` heading. A section without path bullets is not a list. */
export function parseTaskFiles(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const start = lines.findIndex((l) => SECTION_RE.test(l));
  if (start < 0) return { parsed: false, files: [] };
  const files = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    const m = BULLET_RE.exec(lines[i]);
    if (!m) continue;
    const p = normPath(m[1]);
    if (p && !files.includes(p)) files.push(p);
  }
  return files.length ? { parsed: true, files } : { parsed: false, files: [] };
}

/** `decomposition.json` + a task-file reader → `{ v:1, tasks: { <id>: { title, file, files, parsed } } }`. */
export function buildTaskMap(decomposition, readTask) {
  const tasks = {};
  for (const phase of decomposition?.phases ?? []) {
    for (const t of phase.tasks ?? []) {
      let text = '';
      try { text = readTask(t.file) ?? ''; } catch { text = ''; }
      const { parsed, files } = parseTaskFiles(text);
      tasks[t.id] = { title: t.title, file: t.file, files, parsed };
    }
  }
  return { v: 1, tasks };
}
