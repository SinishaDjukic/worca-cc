// diff-view.mjs — pure unified-diff parsing for the History Diff tab.
// DOM-free on purpose (pattern: log-line.mjs / log-filter.mjs) so node:test can
// exercise it without jsdom. Input is the persisted diff-patch.patch artifact;
// workspace runs concatenate per-member patches, each prefixed with a
// "# <projectKey>" comment line (orchestrator.mjs:3443).

export const MAX_FILE_SECTION_BYTES = 500_000;

// One cheap pass: split the patch into per-file sections. Lines outside any
// "diff --git" section are ignored, EXCEPT "# <key>" markers, which set the
// project context for the sections that follow (workspace patches).
export function splitPatchSections(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let project = null;
  let cur = null;
  const flush = () => {
    if (!cur) return;
    cur.raw = cur.rawLines.join('\n');
    delete cur.rawLines;
    out.push(cur);
    cur = null;
  };
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      cur = { project, path: null, oldPath: null, header: line, rawLines: [line] };
      continue;
    }
    // A marker either introduces the first section or terminates the current one.
    // It can never collide with hunk content: adds start '+', deletes '-',
    // context ' ', and "\ No newline" starts '\'.
    if (/^# \S/.test(line)) {
      flush();
      project = line.slice(2).trim();
      continue;
    }
    if (!cur) continue;

    cur.rawLines.push(line);
    if (cur.oldPath == null && line.startsWith('--- ')) {
      const p = stripSide(line.slice(4));
      if (p) cur.oldPath = p;
    } else if (cur.path == null && line.startsWith('+++ ')) {
      const p = stripSide(line.slice(4));
      if (p) cur.path = p;
    } else if (line.startsWith('rename from ')) {
      cur.oldPath = line.slice('rename from '.length).trim();
    } else if (line.startsWith('rename to ')) {
      cur.path = line.slice('rename to '.length).trim();
    }
  }
  flush();
  for (const s of out) {
    // Deleted files carry "+++ /dev/null" and new files "--- /dev/null"; mirror
    // the surviving side. Binary and mode-only sections have NEITHER header, so
    // fall back to the "diff --git a/X b/X" line — without this they keep
    // path === null, drop out of patchIndex, and always render "(no textual
    // diff for this file)" even when results lists them.
    if (!s.path) s.path = s.oldPath || pathFromHeader(s.header);
    if (!s.oldPath) s.oldPath = s.path;
    delete s.header;
  }
  return out;
}

// "diff --git a/src/x.js b/src/x.js" -> "src/x.js". Split at the LAST " b/" so a
// path that itself contains " b/" still resolves. null when the shape is unusual
// (e.g. a C-quoted path — see the DESCOPED note on sectionKey).
function pathFromHeader(header) {
  const rest = String(header || '').slice('diff --git '.length);
  const i = rest.lastIndexOf(' b/');
  if (i <= 0) return null;
  const newSide = rest.slice(i + 3).trim();
  return newSide || null;
}

// "a/src/x.js" -> "src/x.js"; "/dev/null" and "" -> null. Git terminates names
// with a tab when they need it, so cut at the first tab.
function stripSide(s) {
  const t = String(s || '').split('\t')[0].trim();
  if (!t || t === '/dev/null') return null;
  return t.replace(/^[ab]\//, '');
}

// Parse ONE section's hunks. Lazy per selected file — never called for the whole
// patch up front.
export function parseFileSection(raw) {
  let text = String(raw || '');
  let truncated = false;
  if (text.length > MAX_FILE_SECTION_BYTES) {
    const cut = text.lastIndexOf('\n', MAX_FILE_SECTION_BYTES);
    if (cut > 0) {
      text = text.slice(0, cut);                    // snapped to a line boundary
    } else {
      // One line longer than the whole cap: there is no newline to snap to, so
      // cut mid-line and drop a trailing LONE HIGH SURROGATE (a '\n' can never
      // sit inside a pair, which is why the snapped path needs no such guard).
      text = text.slice(0, MAX_FILE_SECTION_BYTES);
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
    }
    truncated = true;
  }
  const res = { binary: false, truncated, hunks: [] };
  let hunk = null;
  const rows = text.split('\n');
  // A \n-terminated section yields a trailing '' from split (and the workspace
  // '\n\n' member join leaves extras at each seam); without the pop each becomes
  // a phantom empty context line. A GENUINE empty context line is the row ' '
  // (one space), never '', so popping every trailing '' is safe.
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  for (const line of rows) {
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      res.binary = true;
      continue;
    }
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] };
      res.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue; // still in the header block
    if (line.startsWith('+')) hunk.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    else hunk.lines.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return res;
}

// DESCOPED, by design: git C-quotes unusual paths (non-ASCII / control chars /
// '"' / '\') as `--- "a/caf\303\251.md"`; those sections keep the quoted string
// as their path and won't match results paths, so the pane shows "(no textual
// diff for this file)" — graceful. A future unquoteGitPath() can lift this.
// The separator is NUL, not a space: a space would make
// sectionKey('a-11111111', 'x y.js') collide with sectionKey(null, 'a-11111111 x y.js').
// Unreachable in practice (a workspace patch always emits its marker before the
// first section, so no section in one has project === null) — but free to fix,
// and no test asserts the key's literal text.
export function sectionKey(project, path) {
  return project ? `${project}\u0000${path}` : String(path || '');
}

export function patchIndex(sections) {
  const m = new Map();
  for (const s of Array.isArray(sections) ? sections : []) {
    if (s && s.path) m.set(sectionKey(s.project, s.path), s);
  }
  return m;
}
