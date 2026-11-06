// src/core/workflow-tests/test-output.mjs — workflow tests 3b (D74): the test names in a command's output, for "The command
// passes" before and after the change. Pure and line by line: a command's output can be large, so only the names are kept.
// Reads TAP (node --test when piped on older Node, tape, mocha -R tap), node:test's spec reporter, pytest (-rA and -v name
// every test; the default names the failures), Jest (verbose names every test; the default the failures) and Vitest
// (likewise). Anything else: no format, and the command is compared by its exit code only. Best effort: no regex here can
// backtrack badly on a long line.

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
export const TEST_FORMATS = Object.freeze(['tap', 'node-spec', 'pytest', 'jest', 'vitest']);
export const MAX_TESTS = 20_000;
export const NAME_MAX = 300;
const PAREN_MS_RE = /\s+\(\d+(?:\.\d+)?\s?m?s\)\s*$/;   // " (1.2ms)", " (3 ms)"
const BARE_MS_RE = /\s+\d+(?:\.\d+)?m?s\s*$/;           // " 3ms" (Vitest)
const TEST_FILE_RE = /^\S+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const DETECT = [
  ['tap', (l) => /^\s*TAP version \d+/.test(l) || /^\s*(?:not ok|ok)\s+\d+\b/.test(l)],
  ['node-spec', (l) => /^\s*▶ \S/.test(l) || /^\s*[✔✖﹣] .*\(\d+(?:\.\d+)?m?s\)/.test(l)],
  ['pytest', (l) => /^=+ (?:test session starts|short test summary info) =+$/.test(l) || /::\S.*\s(?:PASSED|FAILED|ERROR)\b/.test(l)],
  ['jest', (l) => (/^\s*(?:PASS|FAIL)\s+\S+/.test(l) && !/ > /.test(l)) || /^Tests:\s+\d/.test(l)],
  ['vitest', (l) => /^\s*[✓❯×↓]\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?\b/.test(l) || /^\s*FAIL\s+\S+ > /.test(l) || /^\s*Test Files\s+\d/.test(l)],
];

/** "1 failed, 212 passed, 213 total" (Jest) or "1 failed | 4 passed (5)" (Vitest) or pytest's: the three counts. */
function countsOf(text) {
  const c = { passed: 0, failed: 0, skipped: 0 };
  for (const [, n, w] of String(text).matchAll(/(\d+) (passed|failed|skipped|todo|errors?|xfailed|xpassed)\b/g)) {
    const k = w === 'passed' || w === 'xpassed' ? 'passed' : w === 'failed' || w.startsWith('error') ? 'failed' : 'skipped';
    c[k] += Number(n);
  }
  return c;
}

export function createTestOutputParser() {
  const tests = new Map();   // name → 'pass' | 'fail' | 'skip'
  let format = null;
  let truncated = false;
  let counts = null;
  let everyTest = false;     // the output names passing tests too (passListed)
  const st = { stack: [], yaml: false, done: false, file: null, tree: false, verbose: false };
  const put = (name, state) => {
    const n = String(name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!n) return;
    if (tests.has(n)) { if (state === 'fail') tests.set(n, 'fail'); return; }   // a failure listed twice stays one failure
    if (tests.size >= MAX_TESTS) { truncated = true; return; }
    tests.set(n, state);
  };
  const H = {
    tap(l) {
      const t = l.trim();
      if (st.yaml) { if (t === '...') st.yaml = false; return; }
      if (t === '---') { st.yaml = true; return; }
      let m = /^(\s*)# Subtest: (.*)$/.exec(l);
      if (m) {
        const indent = m[1].length;
        while (st.stack.length && st.stack.at(-1).indent >= indent && st.stack.at(-1).open) st.stack.pop();
        const top = st.stack.at(-1);
        if (top && top.indent < indent) top.kids = true;
        st.stack.push({ indent, name: m[2].trim(), kids: false, open: true });
        return;
      }
      m = /^(\s*)(not ok|ok)(?=\s|$)(?:\s+\d+)?(?:\s+-)?\s*(.*)$/.exec(l);
      if (m) {
        const indent = m[1].length;
        let rest = m[3];
        let state = m[2] === 'ok' ? 'pass' : 'fail';
        const d = /\s*#\s*(?:SKIP|TODO)\b.*$/i.exec(rest);
        if (d) { rest = rest.slice(0, d.index); state = 'skip'; }
        const name = rest.trim();
        while (st.stack.length && st.stack.at(-1).indent > indent) st.stack.pop();
        const top = st.stack.at(-1);
        if (top && top.indent === indent && top.name === name) {
          st.stack.pop();
          if (top.kids) return;   // a suite's own line, not a test
        }
        const parent = st.stack.at(-1);
        if (parent && parent.indent < indent) parent.kids = true;
        everyTest = true;
        put([...st.stack.map((f) => f.name), name].join(' > '), state);
        return;
      }
      m = /^# (pass|fail|skipped|skip)\s+(\d+)\s*$/.exec(l);
      if (m) {
        counts = counts || { passed: 0, failed: 0, skipped: 0 };
        counts[m[1] === 'pass' ? 'passed' : m[1] === 'fail' ? 'failed' : 'skipped'] = Number(m[2]);
      }
    },
    'node-spec'(l) {
      if (st.done) return;
      if (/^\s*✖ failing tests:\s*$/.test(l)) { st.done = true; return; }
      const c = /^ℹ (pass|fail|skipped)\s+(\d+)\s*$/.exec(l);
      if (c) {
        counts = counts || { passed: 0, failed: 0, skipped: 0 };
        counts[c[1] === 'pass' ? 'passed' : c[1] === 'fail' ? 'failed' : 'skipped'] = Number(c[2]);
        return;
      }
      const m = /^(\s*)([▶✔✖﹣])\s+(.*)$/.exec(l);
      if (!m) return;
      const indent = m[1].length;
      let rest = m[3];
      let state = m[2] === '✔' ? 'pass' : m[2] === '✖' ? 'fail' : 'skip';
      const d = /\s*#\s*(?:SKIP|TODO)\b.*$/i.exec(rest);
      if (d) { rest = rest.slice(0, d.index); state = 'skip'; }
      else if (m[2] === '﹣') rest = rest.replace(/\s+#\s.*$/, '');   // the real reporter writes "﹣ name (0.1ms) # <skip reason>"
      const name = rest.replace(PAREN_MS_RE, '').trim();
      while (st.stack.length && st.stack.at(-1).indent > indent) st.stack.pop();
      const top = st.stack.at(-1);
      if (top && top.indent === indent && top.name === name) { st.stack.pop(); return; }   // a suite's closing line
      if (m[2] === '▶') { st.stack.push({ indent, name }); return; }
      everyTest = true;
      put([...st.stack.map((f) => f.name), name].join(' > '), state);
    },
    pytest(l) {
      let m = /^(PASSED|FAILED|ERROR|XPASS|XFAIL|SKIPPED) (.+?::.+?)(?: - .*)?$/.exec(l);
      if (!m) {
        const v = /^(\S.*?::\S.*?) (PASSED|FAILED|ERROR|XPASS|XFAIL|SKIPPED)(?:\s+\[\s*\d+%\])?\s*$/.exec(l);
        if (v) m = [v[0], v[2], v[1]];
      }
      if (m) {
        const state = m[1] === 'PASSED' || m[1] === 'XPASS' ? 'pass' : m[1] === 'FAILED' || m[1] === 'ERROR' ? 'fail' : 'skip';
        if (state === 'pass') everyTest = true;
        put(m[2].trim(), state);
        return;
      }
      const s = /^=+ (.+?) in [\d.]+s(?: \(.*\))? =+$/.exec(l);
      if (s && /\d+ (?:passed|failed|errors?|skipped)/.test(s[1])) counts = countsOf(s[1]);
    },
    jest(l) {
      let m = /^\s*(?:PASS|FAIL)\s+(\S.*?)(?:\s+\(\d+(?:\.\d+)?\s?m?s\))?\s*$/.exec(l);
      if (m && !/ > /.test(l) && !/^\s*(?:PASS|FAIL)\s+\d/.test(l)) { st.file = m[1]; st.stack = []; st.tree = true; return; }
      if (!l.trim()) { st.tree = false; return; }
      const c = /^Tests:\s+(.*)$/.exec(l);
      if (c) { counts = countsOf(c[1]); return; }
      m = /^\s*● (.+)$/.exec(l);
      if (m) {
        const name = m[1].trim();
        if (!st.verbose && !/^(?:Test suite failed to run|Console)\b/.test(name)) put(st.file ? `${st.file} › ${name}` : name, 'fail');
        return;
      }
      if (!st.tree || !st.file) return;
      m = /^(\s+)([✓✕○√×])\s+(.*)$/.exec(l);
      if (m) {
        st.verbose = true;
        const indent = m[1].length;
        while (st.stack.length && st.stack.at(-1).indent >= indent) st.stack.pop();
        const name = m[3].replace(PAREN_MS_RE, '').replace(/^(?:skipped|todo)\s+/, '').trim();
        const state = m[2] === '✓' || m[2] === '√' ? 'pass' : m[2] === '○' ? 'skip' : 'fail';
        if (state === 'pass') everyTest = true;
        put([st.file, ...st.stack.map((f) => f.name), name].join(' › '), state);
        return;
      }
      m = /^(\s+)(\S.*)$/.exec(l);
      if (m) {   // a describe block's title, in the verbose tree
        const indent = m[1].length;
        while (st.stack.length && st.stack.at(-1).indent >= indent) st.stack.pop();
        st.stack.push({ indent, name: m[2].trim() });
      }
    },
    vitest(l) {
      const t = l.replace(/\s+$/, '');
      const c = /^\s*Tests\s+(.*)$/.exec(t);
      if (c && /\d+ (?:passed|failed)/.test(c[1])) { counts = countsOf(c[1]); return; }
      let m = /^\s*FAIL\s+(\S+) > (.+)$/.exec(t);
      if (m) { put(`${m[1]} > ${m[2].trim()}`, 'fail'); return; }
      m = /^\s*[✓❯×↓]\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\(\d+ tests?/.exec(t);
      if (m) { st.file = m[1]; return; }
      m = /^\s*([✓×↓✗])\s+(.+)$/.exec(t);
      if (!m) return;
      const name = m[2].replace(BARE_MS_RE, '').trim();
      const head = name.split(' > ')[0];
      const key = TEST_FILE_RE.test(head) && name.includes(' > ') ? name : st.file ? `${st.file} > ${name}` : null;
      if (!key) return;
      const state = m[1] === '✓' ? 'pass' : m[1] === '↓' ? 'skip' : 'fail';
      if (state === 'pass') everyTest = true;
      put(key, state);
    },
  };
  function line(raw) {
    const l = String(raw ?? '').replace(ANSI_RE, '').replace(/\r$/, '');
    if (!format) {
      for (const [f, ok] of DETECT) if (ok(l)) { format = f; break; }
      if (!format) return;
    }
    H[format](l);
  }
  function result() {
    const pass = [];
    const fail = [];
    const skip = [];
    for (const [n, s] of tests) (s === 'pass' ? pass : s === 'fail' ? fail : skip).push(n);
    const by = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    const any = tests.size > 0 || counts !== null;
    const listsAll = format === 'tap' || format === 'node-spec' ? any : everyTest;
    return { format: any ? format : null, pass: pass.sort(by), fail: fail.sort(by), skip: skip.sort(by), passListed: !!listsAll, counts, truncated };
  }
  return { line, result };
}

/** All of a command's output at once (tests and fixtures). */
export function parseTestOutput(text) {
  const p = createTestOutputParser();
  for (const l of String(text ?? '').split('\n')) p.line(l);
  return p.result();
}
