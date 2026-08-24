// src/core/ask/git-allowlist.mjs
// The single gate between the Ask Worca `git` tool and a spawned git argv
// (ask-worca-worktrees-design.md §8). Pure, no imports: worktree-deps.mjs
// spawns ONLY what this returns. Allowlist-shaped throughout — unknown
// subcommands, creation/mutation forms and the known exec/config/write/
// transport vectors are rejected with a hint the model can act on.

// `cat-file` is DELIBERATELY absent: it is a pure raw-content read (`cat-file -p
// HEAD:.env` / `cat-file -p <blob-sha>`) with no diff structure for the §8
// protected-path filter to act on, and it completes the `ls-tree -> blob-sha ->
// cat-file -p <sha>` leak that no path inspection can catch (a sha carries no
// path). Files are read by checking out the ref and inspecting them with the
// other read subcommands — the git tool serves diffs/logs/history, not raw dumps.
const READ_SUBCOMMANDS = new Set([
  'diff', 'log', 'show', 'status', 'blame', 'rev-parse', 'merge-base',
  'grep', 'shortlog', 'describe', 'ls-files', 'ls-tree',
]);
const LIST_ONLY = new Set(['branch', 'tag']);
const NAV = new Set(['checkout', 'switch']);

// ANY position, exact token or `=`-form prefix. Closes config injection
// (`-c`/`--config-env` → hooks/pager/textconv = arbitrary exec), repo
// redirection (`--git-dir`/`--work-tree`/`-C`), exec paths (`--exec-path`/
// `--ext-diff`/`--textconv`), file writes (`--output`/`-o`) and transport
// command overrides (`--upload-pack`/`--receive-pack`).
//
// The second row are worktree-scope ESCAPES demonstrated during planning (spec
// D3 — the model reads ONLY inside its checkout): `diff --no-index <a> <b>` and
// `blame --contents <file>` read ARBITRARY filesystem paths and print them,
// bypassing every §7 deny; `grep -f/--file <path>` reads a pattern file from
// anywhere; `--filters` runs a repo-configured smudge filter (arbitrary exec —
// cat-file is already removed from the read tier, but blocking the flag is
// defence-in-depth); `--color`/`--color=*` injects SGR escapes that make the
// `diff --git ` header undetectable, defeating the protected-path section filter
// (verified: `git diff --color=always` leaked a whole `.env`). `-f`/`--file` are
// already in BRANCH_TAG_MUTATING/NAV_BLOCKED, so promoting them here changes no
// existing behaviour. The short `-O` form of `--open-files-in-pager` (arbitrary
// exec) needs a PREFIX guard, not a Set entry — `key('-Ocurl…')` returns the
// whole token, so no exact match can catch it (handled in validateGitArgs below).
const BLOCKED_ANYWHERE = new Set([
  '-c', '--config-env', '--exec-path', '--git-dir', '--work-tree', '-C',
  '--ext-diff', '--textconv', '--output', '-o', '--upload-pack', '--receive-pack',
  '--open-files-in-pager',
  '--no-index', '--contents', '-f', '--file', '--filters', '--color',
]);

const BRANCH_TAG_MUTATING = new Set([
  '-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force',
  '--edit-description', '--set-upstream-to', '-u', '--unset-upstream', '--create-reflog',
  '-s', '--sign', '-F', '--file', '-e', '--edit', '-a', // tag -a creates; branch -a lists — resolved below
]);
const LISTY_FLAGS = new Set(['--list', '-l', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at']);
// `-c`/`-C`/`--guess` create a branch on `switch`; without them a `git switch -c
// evil` is blocked only by git's own `--detach`+`-c` mutual-exclusion error — a
// version-dependent accident, not the validator. Blocking them keeps D4 ("no
// branch ever created") enforced by us, not by git's argument parser.
const NAV_BLOCKED = new Set(['-b', '-B', '-c', '-C', '--guess', '--orphan', '--track', '-t', '-f', '--force',
  '--ours', '--theirs', '-p', '--patch', '--pathspec-from-file', '--merge', '-m']);
const FETCH_FLAGS = new Set(['--all', '--prune', '-p']);

// `grep` is the one read subcommand whose output the §8 protected-path filter reads
// LINE by LINE (a path list, not a patch), and it drops a line only when a delimited
// token on that line is a protected basename. These forms take the path OFF the
// line — `-h`/`--no-filename` and `--heading` print bare match lines, `-z`/`--null`
// glues the path to the content with a NUL — so a protected file's CONTENTS come
// back verbatim (verified against real git: `git grep -h <pat>` dumped a whole
// .env). Forcing `-H` downstream is not enough: the last flag wins, and `--heading`
// overrides `-H` outright, so they are refused here.
const GREP_PATH_SUPPRESSING = new Set(['-h', '--no-filename', '--heading', '-z', '--null']);
// Short options whose value may be ATTACHED (`-ehunter`, `-C3`, `-m5`): everything
// after them inside a cluster is data, so the cluster scan stops there.
const GREP_VALUE_SHORTS = new Set(['e', 'f', 'm', 'A', 'B', 'C', 'O']);

const key = (a) => (a.includes('=') ? a.slice(0, a.indexOf('=')) : a);

const pathSuppressingError = (tok, flag) =>
  `git grep ${flag} (in ${JSON.stringify(tok)}) hides the filename from the output and is not allowed — the protected-path filter needs the path on every line`;

function validateGrep(args) {
  for (const a of args.slice(1)) {
    if (GREP_PATH_SUPPRESSING.has(key(a))) return { ok: false, error: pathSuppressingError(a, key(a)) };
    if (a.startsWith('--') || !a.startsWith('-')) continue;
    for (const ch of a.slice(1)) {                       // bundles: `git grep -nh` == `-n -h`
      if (GREP_VALUE_SHORTS.has(ch)) break;              // the rest of the token is this option's value
      if (ch === 'h' || ch === 'z') return { ok: false, error: pathSuppressingError(a, `-${ch}`) };
    }
  }
  return { ok: true, args, nav: false, fetch: false };
}

function validateListOnly(sub, args) {
  const rest = args.slice(1);
  for (const a of rest) {
    const k = key(a);
    if (k === '-a' && sub === 'branch') continue;              // branch -a = list all; tag -a = create
    if (BRANCH_TAG_MUTATING.has(k)) return { ok: false, error: `git ${sub} ${a} mutates branches/tags and is not allowed` };
  }
  const positionals = rest.filter((a) => !a.startsWith('-'));
  const listy = rest.some((a) => LISTY_FLAGS.has(key(a)));
  if (positionals.length && !listy) {
    return { ok: false, error: `git ${sub} with a positional name creates a ${sub}; use --list <pattern> to filter` };
  }
  return { ok: true, args, nav: false, fetch: false };
}

function validateNav(sub, args) {
  const rest = args.slice(1);
  if (rest.includes('--')) return { ok: false, error: `git ${sub} -- <paths> (file restore) is not allowed` };
  for (const a of rest) {
    if (NAV_BLOCKED.has(key(a))) return { ok: false, error: `git ${sub} ${a} is not allowed (worktrees stay detached, files stay pristine)` };
  }
  const positionals = rest.filter((a) => !a.startsWith('-'));
  if (positionals.length !== 1) return { ok: false, error: `git ${sub} needs exactly one ref` };
  const out = rest.includes('--detach') ? args : [sub, '--detach', ...rest];
  return { ok: true, args: out, nav: true, fetch: false };
}

function validateFetch(args) {
  const rest = args.slice(1);
  for (const a of rest.filter((x) => x.startsWith('-'))) {
    if (!FETCH_FLAGS.has(a)) return { ok: false, error: `git fetch ${a} is not allowed` };
  }
  const positionals = rest.filter((a) => !a.startsWith('-'));
  if (positionals.length > 1) return { ok: false, error: 'git fetch takes at most a remote name — refspecs are not allowed (they can rewrite local branches)' };
  if (positionals.length === 1) {
    const p = positionals[0];
    // Remote NAME only. Reject URLs/refspecs (`:`), path traversal (`.`/`..` or a
    // leading `.`), and a leading `-` (option-shaped). The runtime `git remote`
    // membership check in the tool handler is the second gate, but shape-reject here.
    if (!/^[A-Za-z0-9._-]+$/.test(p) || p.includes(':') || p === '.' || p === '..' || /^[.-]/.test(p)) {
      return { ok: false, error: 'git fetch accepts a configured remote NAME only, never a URL, refspec or path' };
    }
  }
  return { ok: true, args, nav: false, fetch: true };
}

/**
 * @param {unknown} rawArgs  the model-supplied argv (without the leading "git")
 * @returns {{ok:true, args:string[], nav:boolean, fetch:boolean} | {ok:false, error:string}}
 */
export function validateGitArgs(rawArgs) {
  if (!Array.isArray(rawArgs) || !rawArgs.length || !rawArgs.every((a) => typeof a === 'string')) {
    return { ok: false, error: 'args must be a non-empty array of strings' };
  }
  const args = rawArgs.map((a) => a.trim()).filter((a) => a.length);
  if (!args.length) return { ok: false, error: 'args must be a non-empty array of strings' };
  for (const a of args) {
    // Prefix guard for ATTACHED short-option values, which key() cannot normalise
    // (it strips `=value`, never `-f<value>` — git's standard attached short form):
    // `-O<cmd>` (open-files-in-pager = arbitrary exec, `diff -O<orderfile>` = read),
    // `-f<path>` (grep's pattern FILE = arbitrary absolute-path read OUTSIDE the
    // worktree, breaking the D3 confinement invariant) and `-o<path>` (--output =
    // file write). All three also hide inside a bundle — `git grep -nf/etc/passwd`
    // is `-n -f /etc/passwd`, verified against real git — so the scan accepts any
    // run of short flags before the offending letter. The bare `-f`/`-o`/`-O` tokens
    // were already refused by BLOCKED_ANYWHERE, so this only widens to the forms
    // that carry a value.
    if (/^-[A-Za-z]*[Ofo]/.test(a)) return { ok: false, error: `argument ${JSON.stringify(a)} is not allowed` };
    if (BLOCKED_ANYWHERE.has(key(a))) return { ok: false, error: `argument ${JSON.stringify(a)} is not allowed` };
  }
  const sub = args[0];
  if (sub === 'pull') return { ok: false, error: 'pull is not available (detached worktrees have nothing to merge into) — fetch, then diff/checkout origin/<branch>' };
  if (sub === 'push' || sub === 'remote') return { ok: false, error: `${sub} is not available: the chat cannot publish anything — propose a pipeline instead` };
  if (sub === 'grep') return validateGrep(args);   // read tier, but the path must stay on every line
  if (READ_SUBCOMMANDS.has(sub)) return { ok: true, args, nav: false, fetch: false };
  if (LIST_ONLY.has(sub)) return validateListOnly(sub, args);
  if (NAV.has(sub)) return validateNav(sub, args);
  if (sub === 'fetch') return validateFetch(args);
  return { ok: false, error: `git ${sub} is not in the allowlist` };
}
