// test/ask-command-secret-paths.test.mjs
// The chat command check's path matcher (src/core/ask/command-policy.mjs namesSystemSecretPath), one row per bypass
// class: variable and command substitution, globs on any protected segment and name, cd / pushd chains, symlink-style
// aliases, env-var indirection, redirections and here-strings, and recursive readers naming a parent of a protected
// folder. It is a guard on the chat's own commands, not the security boundary: the boundary is file permissions,
// agent users and the egress sidecar. Ordinary commands keep working, and the work stays bounded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { checkAskCommand, namesSystemSecretPath } from '../src/core/ask/command-policy.mjs';

const HOME = '/Users/zed';
const CTX = { cwd: '/repo', home: `${HOME}/.worca-cc`, userHome: HOME, egressDataDir: null };
const refused = (c, o = {}) => /protected path/.test(checkAskCommand(c, { ...CTX, ...o }) || '');

const CLASSES = {
  'variable substitution: known variables are substituted, unknown ones never skip the check': [
    'cat $X/run/secrets/a', 'cat $PWD/../run/secrets/a', 'cat ${PWD}/../../run/secrets/a', 'cat ${HOME}/../../run/secrets/a',
    'cat $HOME/../../worca/egress/x', 'cat $OLDPWD/../run/secrets/a', 'cat $X/secrets/a', 'cat ${X}/egress/login', 'cat $HOME/.worca-cc/proxy-login.json',
    'cat ~/../../run/secrets/a', 'cat $DIR/proxy-login.json',
  ],
  'command substitution: $( ) and backticks stand for any path': [
    'cat $(echo /run)/secrets/a', 'cat `echo /run`/secrets/a', 'cat "$(printf /run)/secrets/a"', 'cat $(pwd)/../run/secrets/a',
  ],
  'globs on any protected segment and on the protected names': [
    'cat /r?n/secrets/a', 'cat /run/[s]ecrets/a', 'cat /*/egress/x', 'cat /wor*/egr*/x', 'cat ~/.worca-cc/*login.json', 'cat ~/.worca-cc/p*.json',
    'cat ~/.worca-cc/?roxy-login.json', 'cat ~/.worca-cc/[p]roxy-login.json', 'cat ~/.worca-cc/*-login.j*', 'cat ~/.worca-c*/x', 'cat ~/.w*/proxy-login.json',
    'cat /srv/data/p*.json',
  ],
  'cd and pushd chains: a relative name is read from every folder the command reaches': [
    'cd /run && cat secrets/a', 'pushd /var/run; cat secrets/a', 'cd / && cd run && cat ./secrets/a', 'cd /worca; cd egress; cat x',
    'cd /tmp && cd ../run && cat secrets/a', 'cd ~/.worca-cc && cat proxy*.json',
  ],
  'symlink-style aliases': ['cat /var/run/secrets/a', 'cat /private/var/run/secrets/a', 'cat /var//run/./secrets/a'],
  'env-var indirection': ['X=/run; cat $X/secrets/a', 'export X=/run && cat ${X}/secrets/a', 'X=/run Y=secrets; cat $X/$Y/a', 'D=/worca cat $D/egress/x'],
  'redirections and here-strings': ['cat < /run/secrets/a', 'cat</run/secrets/a', 'wc -l <<< "$(cat /run/secrets/a)"', 'cat 0</var/run/secrets/a'],
  'recursive readers naming a parent of a protected folder': [
    "find /run -name '*'", 'tar c /run', 'cp -r /worca /tmp/x', 'rsync -a /var/run/ /tmp/x', 'grep -r token /run', 'find / -name x', 'tar czf a.tgz ~',
    'cd / && tar c run', 'echo /run | xargs ls -R', 'zip -r a.zip /worca', 'rg password /var/run', 'cp -r ~/.worca-cc /tmp/x',
  ],
};

test('every bypass class is refused', async () => {
  const rows = [];
  for (const [cls, cmds] of Object.entries(CLASSES)) for (const c of cmds) rows.push({ name: `${cls}: ${c}`, run: () => assert.ok(refused(c), c) });
  await checkRows(rows);
});

test('a custom egress data folder is refused in every class', async () => {
  const o = { egressDataDir: '/data/egress-login' };
  await checkRows(['cat /data//egress-login/./x', 'cd /data && cat egress-login/x', 'cat /data/egress-l*/x', 'X=/data; cat $X/egress-login/x', 'tar c /data']
    .map((c) => ({ name: c, run: () => assert.ok(refused(c, o), c) })));
  assert.equal(refused('cat /data/other/x', o), false);
});

test('ordinary commands keep working', async () => {
  await checkRows(['npm run build', 'ls run', 'rm -rf *', 'git log -- secrets.md', 'npm test', 'cat ./src/run.mjs', 'cat /repo/docs/secrets-guide.md',
    'cd /repo && npm run build', 'echo run secrets', 'ls *', 'cat *.json', 'cat p*.json', 'find . -name "*.mjs"', 'tar czf out.tgz src', 'cp -r src /tmp/x',
    'grep -r TODO src', 'echo $PATH', 'X=1 npm test', 'cat $PWD/package.json', 'ls ~/projects', 'cat "$(git rev-parse --show-toplevel)/README.md"',
    'cd .. && ls', 'rsync -a dist/ /tmp/dist']
    .map((c) => ({ name: c, run: () => assert.equal(checkAskCommand(c, CTX), null, c) })));
});

test('the work stays bounded: long globs, many braces, many substitutions', () => {
  const t0 = Date.now();
  assert.equal(namesSystemSecretPath(`cat /srv/${'*a'.repeat(400)}/${'*a'.repeat(400)}b`, { cwd: '/repo' }), false);
  assert.equal(namesSystemSecretPath(`cat /${'*'.repeat(5000)}/secrets`, { cwd: '/repo' }), true);
  assert.equal(namesSystemSecretPath(`cat /srv/${'{a,b,c,d}'.repeat(30)}`, { cwd: '/repo' }), true, 'past the brace cap: refused');
  assert.equal(namesSystemSecretPath(`cat ${'$(x)'.repeat(200)}`, { cwd: '/repo' }), true, 'past the substitution cap: refused');
  assert.equal(namesSystemSecretPath(Array.from({ length: 300 }, (_, i) => `cd d${i}`).join(' && '), { cwd: '/repo' }), false);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

// Round 3 (fail closed): only what is resolved with certainty is tracked; everything else is ANY, and with an unknown
// prefix a word that could complete a protected path is refused.
const FAIL_CLOSED = {
  'a cd anywhere in a command is a folder change': ['{ cd /run; cat secrets/a; }', 'if true; then cd /run; fi; cat secrets/a', '! cd /run; cat secrets/a',
    "eval 'cd /run'; cat secrets/a", "sh -c 'cd /run && cat secrets/a'", "bash -lc 'cd /var/run; cat secrets/a'", 'true && cd /worca || cd /x; cat egress/y'],
  'cd options are skipped; an unknown one makes the folder unknown': ['cd -P /run && cat secrets/a', 'cd -- /run && cat secrets/a', 'cd -L -P /run; cat secrets/a',
    'cd -x /tmp && cat secrets/a'],
  'an unresolvable cd target, cd - and popd make the folder unknown': ['cd $(mktemp -d) && cat secrets/a', 'cd $D && cat secrets/a', 'cd /r* && cat secrets/a',
    'cd - && cat secrets/a', 'popd; cat egress/x', 'pushd $X; cat proxy-login.json'],
  'a variable holds every value it is given; X=v cmd does not persist': ['X=/tmp; X=/run; cat $X/secrets/a', 'X=/tmp ls; cat $X/secrets/a',
    'X=/run; Y=/tmp; X=$Y; cat $X/secrets/a'],
  'nested shells, eval, env, xargs, find -exec and here-strings': ["env -i sh -c 'cat /run/secrets/a'", "bash <<< 'cd /run; cat secrets/a'",
    'find / -exec cat {} +', "echo /run/secrets/a | xargs cat", "zsh -c 'cat ~/.worca-cc/proxy*.json'"],
  'an unknown prefix with a word that could complete a protected path': ['cat $X/secrets/a', 'cat ${A}${B}/egress/x', 'cat $X/proxy-login.j*',
    'cd $(pwd)/.. && cat run/secrets/a'],
};
test('fail closed: every case of the third review is refused', async () => {
  const rows = [];
  for (const [cls, cmds] of Object.entries(FAIL_CLOSED)) for (const c of cmds) rows.push({ name: `${cls}: ${c}`, run: () => assert.ok(refused(c), c) });
  await checkRows(rows);
});
test('fail closed still lets ordinary commands through, an unknown folder included', async () => {
  await checkRows(['npm run build', 'ls run', 'cd src && ls', 'git log -- secrets.md', 'rm -rf *', 'X=1 npm test', 'cd "$(git rev-parse --show-toplevel)" && npm test',
    'cd $(mktemp -d) && ls', 'cd - && npm test', 'X=/tmp; cat $X/notes.txt', 'cd -P src && npm test', 'pushd src; npm test; popd',
    'cd "$(git rev-parse --show-toplevel)" && grep -r TODO src', 'echo $HOME', 'bash -c "npm test"']
    .map((c) => ({ name: c, run: () => assert.equal(checkAskCommand(c, CTX), null, c) })));
});
