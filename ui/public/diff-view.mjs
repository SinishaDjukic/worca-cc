// diff-view.mjs — pure unified-diff parsing for the History Diff tab.
// DOM-free on purpose (pattern: log-line.mjs / log-filter.mjs) so node:test can
// exercise it without jsdom. Input is the persisted diff-patch.patch artifact;
// workspace runs concatenate per-member patches, each prefixed with a
// "# <projectKey>" comment line (orchestrator.mjs:3443).

export const MAX_FILE_SECTION_CODE_UNITS = 500_000;
export const MAX_FILE_SECTION_RENDER_ITEMS = 5_000;

const HUNK_RANGE_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

export function hunkRange(header) {
  const raw = String(header || '');
  const m = HUNK_RANGE_RE.exec(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
  if (!m) return null;
  const values = [m[1], m[2] ?? '1', m[3], m[4] ?? '1'].map(Number);
  if (!values.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const [oldStart, oldCount, newStart, newCount] = values;
  const safeRange = (start, count) => {
    if (count === 0) return start >= 0;
    return start >= 1 && start <= Number.MAX_SAFE_INTEGER - (count - 1);
  };
  if (!safeRange(oldStart, oldCount) || !safeRange(newStart, newCount)) return null;
  return { oldStart, oldCount, newStart, newCount };
}

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
  if (text.length > MAX_FILE_SECTION_CODE_UNITS) {
    const cut = text.lastIndexOf('\n', MAX_FILE_SECTION_CODE_UNITS);
    if (cut > 0) {
      text = text.slice(0, cut);                    // snapped to a line boundary
    } else {
      // One line longer than the whole cap: there is no newline to snap to, so
      // cut mid-line and drop a trailing LONE HIGH SURROGATE (a '\n' can never
      // sit inside a pair, which is why the snapped path needs no such guard).
      text = text.slice(0, MAX_FILE_SECTION_CODE_UNITS);
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
    }
    truncated = true;
  }
  const res = { binary: false, truncated, hunks: [] };
  let hunk = null;
  let retainedItems = 0;
  let oldNo = null;
  let newNo = null;
  let oldRemaining = 0;
  let newRemaining = 0;
  const rows = text.split('\n');
  // A \n-terminated section yields a trailing '' from split (and the workspace
  // '\n\n' member join leaves extras at each seam); without the pop each becomes
  // a phantom empty context line. A GENUINE empty context line is the row ' '
  // (one space), never '', so popping every trailing '' is safe.
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  for (const line of rows) {
    const structuralLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (structuralLine.startsWith('Binary files ')
      || structuralLine === 'GIT binary patch') {
      res.binary = true;
      continue;
    }
    if (structuralLine.startsWith('@@')) {
      if (retainedItems >= MAX_FILE_SECTION_RENDER_ITEMS) {
        res.truncated = true;
        break;
      }
      retainedItems += 1;
      const range = hunkRange(structuralLine);
      hunk = {
        header: structuralLine,
        oldStart: range?.oldStart ?? null,
        oldCount: range?.oldCount ?? null,
        newStart: range?.newStart ?? null,
        newCount: range?.newCount ?? null,
        lines: [],
      };
      oldNo = range?.oldStart ?? null;
      newNo = range?.newStart ?? null;
      oldRemaining = range?.oldCount ?? 0;
      newRemaining = range?.newCount ?? 0;
      res.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue; // still in the header block
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (retainedItems >= MAX_FILE_SECTION_RENDER_ITEMS) {
      res.truncated = true;
      break;
    }
    retainedItems += 1;

    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
    const source = kind === 'ctx'
      ? (line.startsWith(' ') ? line.slice(1) : line)
      : line.slice(1);
    const numbered = { kind, text: source, oldNo: null, newNo: null };
    if (kind !== 'add' && oldNo != null && oldRemaining > 0) {
      numbered.oldNo = oldNo++;
      oldRemaining -= 1;
    }
    if (kind !== 'del' && newNo != null && newRemaining > 0) {
      numbered.newNo = newNo++;
      newRemaining -= 1;
    }
    hunk.lines.push(numbered);
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
