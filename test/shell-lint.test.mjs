// test/shell-lint.test.mjs — the conservative POSIX-sh lint behind the Command field's
// warnings and validator rule V33. Pure: text in, [{line, code, message}] out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';
import { lintShell, MAX_SHELL_WARNINGS, SHELL_LINT_CODES } from '../src/shared/shell-lint.mjs';

const DEPLOY = [
  '#!/bin/sh',
  '# deploy — it\'s a comment with an apostrophe',
  'set -eu',
  'ENV="${1:-staging}"',
  'log() { echo "[deploy] $*"; }',
  'if [ "$ENV" = prod ]; then',
  '  log "going to production"',
  'elif [ "$ENV" = staging ]; then',
  '  log "staging"',
  'else',
  '  log "unknown $ENV"; exit 1',
  'fi',
  'for f in dist/*.js; do',
  '  [ -f "$f" ] || continue',
  '  log "uploading $f"',
  '  scp "$f" "host:/srv/$ENV/" || { log failed; exit 2; }',
  'done',
  'i=0',
  'while [ "$i" -lt 3 ]; do',
  '  i=$((i + 1))',
  '  sleep 1',
  'done',
  'case "$ENV" in',
  '  (prod) log "p" ;;',
  '  stage|staging) log "s" ;;',
  '  *) log "other" ;;',
  'esac',
  'out=$(git rev-parse --short HEAD)',
  'echo "released ${out} at `date`"',
  '(cd /tmp && ls)',
  'until false; do break; done',
  'if ! command -v curl >/dev/null; then log "no curl"; fi',
  'echo "done"',
].join('\n');

const big = Array.from({ length: 600 }, (_, i) => `echo "line ${i}" # c${i}\nif [ ${i} -gt 1 ]; then echo ok; fi`).join('\n');

const at = (text) => lintShell(text).map((w) => [w.line, w.code]);

const CLEAN = [
  ['a deploy script with if/elif/else, for, while, case, functions and groups', DEPLOY],
  ['<<\'EOF\' heredoc', "cat <<'EOF'\nit's \"raw\" $x `y`\nEOF\necho after"],
  ['<<-EOF heredoc with a tab-indented terminator', 'cat <<-EOF\n\tbody \'q\n\tEOF\necho after'],
  ['<<"EOF" heredoc', 'cat <<"EOF"\nbody "q\nEOF'],
  ['a heredoc inside $( )', 'x=$(cat <<EOF\nhi it\'s\nEOF\n)\necho "$x"'],
  ['two heredocs on one line', 'cat <<A <<B\none\nA\ntwo\nB\n'],
  ['a here-string', 'cat <<< "it\'s"'],
  ['arithmetic shifts and groups', 'echo $((1<<2)) $(( (1+2)*3 ))\n(( i++ ))'],
  ['a quoted close brace inside ${ }', 'echo ${x:-"}"} ${y:-\'a b\'}'],
  ['$# and ${#a}', 'echo $# ${#a}'],
  ['a comment with an apostrophe', "# it's a comment\necho hi"],
  ['quotes inside quotes', 'echo "it\'s"\necho \'say "hi"\''],
  ['an ANSI-C quote with an escaped apostrophe', "echo $'it\\'s'"],
  ['backticks', 'echo `date`'],
  ['a nested quote in a substitution', 'echo "$(echo ")")"'],
  ['backslash-continued lines', 'echo a \\\n  b \\\n  c'],
  ['CRLF text', 'if true; then\r\n  echo "x"\r\nfi\r\n'],
  ['placeholders only', 'echo $WORCA_PARAM_X ${WORCA_IN_PLAN} {{name}} {cycle}'],
  ['[[ ]] and arrays', '[[ $a == b ]] && a=(1 2)\ndiff <(ls a) <(ls b)'],
  ['a subshell holding an if', '( if a; then b; fi )'],
  ['cmd.exe if exist', 'if exist out (del out)'],
  ['cmd.exe for in do', 'for %%f in (*.txt) do type %%f'],
  ['keywords that are not at command position', 'echo if fi done esac then do case'],
  ['an escaped quote', 'echo \\" \\\' \\`'],
  ['a 600-line script', big],
  ['a one-line function body starting with if', 'main() { if [ -z "$1" ]; then echo x; fi; }'],
  ['a one-line function body starting with case', 'f() { case $1 in a) echo;; esac; }'],
  ['the function keyword with a one-line if body', 'function f { if x; then y; fi; }'],
  ['a C-style for header with a shift', 'for ((i=0;i<1<<3;i++)); do echo $i; done'],
  ['an apostrophe in a ${ } alternative inside double quotes', 'echo "${x:+it\'s}"'],
  ['an empty-ish text', '   \n\n'],
];

const DEFECTS = [
  ['quote-single', 'echo ok\necho \'hi', [[2, 'quote-single']]],
  ['quote-double', 'echo "x', [[1, 'quote-double']]],
  ['backtick', 'a\nb\necho `date', [[3, 'backtick']]],
  ['quote-ansi', "echo $'x", [[1, 'quote-ansi']]],
  ['subst', 'echo ok\nx=$(date\ny=1', [[2, 'subst']]],
  ['heredoc', 'echo ok\ncat <<END\nbody\nmore', [[2, 'heredoc']]],
  ['if-open', 'echo a\nif true; then\n  echo x', [[2, 'if-open']]],
  ['fi-stray', 'echo a\nfi', [[2, 'fi-stray']]],
  ['do-open', 'echo a\nfor x in 1 2; do\n echo $x', [[2, 'do-open']]],
  ['done-stray', 'echo a\n\ndone', [[3, 'done-stray']]],
  ['case-open', 'case $x in\n a) echo;;', [[1, 'case-open']]],
  ['esac-stray', 'echo a\nesac', [[2, 'esac-stray']]],
];

const FIXED = [
  'echo ok\necho \'hi\'', 'echo "x"', 'a\nb\necho `date`', "echo $'x'", 'echo ok\nx=$(date)\ny=1',
  'echo ok\ncat <<END\nbody\nmore\nEND', 'echo a\nif true; then\n  echo x\nfi', 'echo a',
  'echo a\nfor x in 1 2; do\n echo $x\ndone', 'echo a\n', 'case $x in\n a) echo;;\nesac',
];

test('lintShell: clean scripts give no warnings', async () => {
  await checkRows(CLEAN.map(([name, text]) => ({ name, run: () => assert.deepEqual(lintShell(text), []) })));
});

test('lintShell: each of the twelve codes lands on its line, and the defects are sorted and capped', async () => {
  await checkRows([
    ...DEFECTS.map(([code, text, want]) => ({ name: code, run: () => assert.deepEqual(at(text), want) })),
    { name: 'the table covers every code', run: () => assert.deepEqual(DEFECTS.map((d) => d[0]).sort(), [...SHELL_LINT_CODES].sort()) },
    { name: 'two defects are sorted by line', run: () => assert.deepEqual(at('fi\necho a\nesac'), [[1, 'fi-stray'], [3, 'esac-stray']]) },
    { name: 'an unclosed quote hides the block checks (no cascade)', run: () => assert.deepEqual(at("if a; then\necho 'x"), [[2, 'quote-single']]) },
    { name: 'a nested do is reported when its fi closes the if', run: () => assert.deepEqual(at('if a; then\nwhile b; do\nfi'), [[2, 'do-open']]) },
    { name: 'an if without then is not reported', run: () => assert.deepEqual(at('if exist x'), []) },
    { name: 'only the outermost open quote is reported', run: () => assert.deepEqual(at('echo "a $(echo \'b'), [[1, 'quote-double']]) },
    { name: 'a heredoc names its real delimiter', run: () => assert.equal(lintShell('cat <<-"STOP"\nx')[0].message, 'Heredoc <<STOP has no closing STOP line.') },
    { name: 'an unclosed quote in a heredoc delimiter is a quote warning, not a heredoc dump', run: () => {
      assert.deepEqual(at("cat <<'EOF\nbody\nmore"), [[1, 'quote-single']]);
    } },
    { name: 'more than the cap are cut', run: () => {
      const w = lintShell(Array.from({ length: MAX_SHELL_WARNINGS + 10 }, () => 'fi').join('\n'));
      assert.equal(w.length, MAX_SHELL_WARNINGS);
      assert.equal(w[0].line, 1);
    } },
    { name: 'a warning carries a 1-based line, a code and a one-sentence message', run: () => {
      const [w] = lintShell('echo "x');
      assert.deepEqual(Object.keys(w).sort(), ['code', 'line', 'message']);
      assert.equal(w.message, 'This double quote (") is never closed.');
    } },
  ]);
});

test('lintShell: fixing a defect clears its warning', async () => {
  await checkRows(FIXED.map((text, i) => ({ name: `fixed text ${i + 1}`, run: () => assert.deepEqual(lintShell(text), []) })));
});

test('lintShell: total, pure, and free of DOM wording', async () => {
  await checkRows([
    { name: 'non-string input and the empty string give []', run: () => {
      for (const v of [undefined, null, 5, {}, [], '']) assert.deepEqual(lintShell(v), []);
    } },
    { name: 'a few hundred slices of real scripts never throw', run: () => {
      const files = ['docker/entrypoint.sh', 'tools/docker-linux-pass.sh', 'tools/railway/in-container-probe.sh'];
      const texts = [DEPLOY, ...files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))];
      let n = 0;
      for (const t of texts) {
        for (let a = 0; a < t.length; a += Math.max(1, Math.floor(t.length / 90))) {
          for (const len of [7, 40, 400]) { assert.ok(Array.isArray(lintShell(t.slice(a, a + len)))); n += 1; }
        }
      }
      assert.ok(n >= 300, `swept ${n} slices`);
    } },
    { name: 'no message names a browser or process global', run: () => {
      const all = DEFECTS.flatMap(([, text]) => lintShell(text)).map((w) => w.message).join('\n');
      assert.doesNotMatch(all, /\b(document|window|navigator|localStorage)\b|process\./);
    } },
    { name: 'a long text lints in linear time', run: () => {
      const t0 = Date.now();
      lintShell('"'.repeat(1) + 'x'.repeat(400000));
      lintShell('$('.repeat(20000));
      lintShell('do;'.repeat(50000) + 'fi;'.repeat(50000));
      lintShell('if;'.repeat(50000) + 'done;'.repeat(50000));
      lintShell('if;do;'.repeat(30000) + 'then;'.repeat(60000));
      assert.ok(Date.now() - t0 < 2000);
    } },
  ]);
});
