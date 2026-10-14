// Pure catalog of repository-readiness checks: facts in, {status, detail?} out.
// No I/O. `status` is 'pass' | 'fail' | 'skip' | 'error'; 'ignored' is applied later.
import {
  DEFAULT_CONTEXT_MAX_BYTES_PER_FILE,
  DEFAULT_CONTEXT_MAX_BYTES_TOTAL,
} from '../settings.mjs';

export const CATALOG_VERSION = 1;

const SECRET_RES = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$|sample$|template$)[^/]+$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /(^|\/)id_rsa($|[^/]*$)/,
  /(^|\/)id_ed25519($|[^/]*$)/,
  /\.keystore$/,
  /(^|\/)credentials\.json$/,
];

const DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';

// Dependency manifest → any one of these tracked lockfiles satisfies it.
const LOCKFILES = Object.freeze([
  [
    'package.json',
    ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'],
  ],
  ['pyproject.toml', ['poetry.lock', 'uv.lock', 'pdm.lock', 'requirements.txt']],
  ['Cargo.toml', ['Cargo.lock']],
  ['go.mod', ['go.sum']],
]);

const PACKAGE_MANIFEST_RE = /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/;
const MAKE_TARGETS = Object.freeze({
  test: ['test', 'check'],
  build: ['build', 'all'],
  lint: ['lint', 'fmt', 'format'],
});

const has = (obj, key) => obj != null && obj[key] !== undefined;

function parsePkg(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function makeTargets(txt) {
  const t = new Set();
  for (const line of txt.split('\n')) {
    const m = /^([A-Za-z0-9_.-]+):/.exec(line);
    if (m) t.add(m[1]);
  }
  return t;
}

function instructionText(f, name) {
  return f.texts?.[name] ?? null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fenced blocks and inline `code` spans of a markdown text. */
function codeSpans(txt) {
  const spans = [];
  const rest = txt.replace(/```[\s\S]*?```/g, (m) => {
    spans.push(m);
    return ' ';
  });
  for (const m of rest.matchAll(/`([^`\n]+)`/g)) spans.push(m[1]);
  return spans;
}

/** Does any instruction text carry a code span containing `word` as a whole word? */
function instructionMentions(f, word) {
  const re = new RegExp(`\\b${escapeRe(word)}\\b`, 'i');
  return Object.values(f.texts ?? {}).some(
    (txt) => typeof txt === 'string' && codeSpans(txt).some((s) => re.test(s)),
  );
}

/** Is there any non-JS build manifest whose ecosystem implies commands? */
function hasEcoManifest(f) {
  const m = f.manifests;
  return (
    has(m, 'pyproject.toml') ||
    has(m, 'go.mod') ||
    has(m, 'Cargo.toml') ||
    has(m, 'pom.xml') ||
    has(m, 'build.gradle') ||
    has(m, 'build.gradle.kts')
  );
}

/**
 * Ecosystem-implied command: {status:'pass'}, {status:'skip'} when the kind is
 * not applicable to the ecosystem (pyproject build), or null when nothing is implied.
 */
function ecoPass(f, kind) {
  const m = f.manifests;
  const tracked = (p) => !!f.trackedSet?.has(p);
  const pass = { status: 'pass' };

  if (has(m, 'go.mod')) {
    if (kind !== 'lint') return pass;
    if (tracked('.golangci.yml') || tracked('.golangci.yaml')) return pass;
  }
  if (has(m, 'Cargo.toml')) return pass;
  if (
    (has(m, 'pom.xml') || has(m, 'build.gradle') || has(m, 'build.gradle.kts')) &&
    kind !== 'lint'
  ) {
    return pass;
  }
  if (has(m, 'pyproject.toml')) {
    const py = m['pyproject.toml'];
    if (kind === 'test') {
      if (
        /\[tool\.pytest\.ini_options\]/.test(py) ||
        /\b(pytest|tox|nox)\b/.test(py) ||
        tracked('tox.ini') ||
        tracked('noxfile.py')
      ) {
        return pass;
      }
    } else if (kind === 'lint') {
      if (
        /\[tool\.(ruff|black|flake8)\b/.test(py) ||
        tracked('.flake8') ||
        tracked('ruff.toml')
      ) {
        return pass;
      }
    } else {
      return { status: 'skip' };
    }
  }
  return null;
}

function commandCheck(f, kind) {
  const pkgTxt = f.manifests?.['package.json'];
  const makeTxt = f.manifests?.Makefile ?? f.manifests?.makefile;
  if (pkgTxt === undefined && makeTxt === undefined && !hasEcoManifest(f)) {
    return { status: 'skip' };
  }

  if (pkgTxt !== undefined) {
    const s = parsePkg(pkgTxt)?.scripts || {};
    if (kind === 'test' && s.test && s.test !== DEFAULT_TEST) {
      return { status: 'pass' };
    }
    if (kind === 'build' && s.build) return { status: 'pass' };
    if (kind === 'lint' && (s.lint || s.format || s.check)) {
      return { status: 'pass' };
    }
  }
  if (makeTxt !== undefined) {
    const t = makeTargets(makeTxt);
    if (MAKE_TARGETS[kind].some((x) => t.has(x))) return { status: 'pass' };
  }
  const eco = ecoPass(f, kind);
  if (eco?.status === 'pass') return eco;
  if (instructionMentions(f, kind)) return { status: 'pass' };
  // 'not applicable' only holds when nothing else could have supplied the command
  if (eco && pkgTxt === undefined && makeTxt === undefined) return eco;
  return { status: 'fail', detail: `no ${kind} command discoverable` };
}

function lockfileCheck(f) {
  if (!f.trackedSet) return { status: 'skip' };
  const present = LOCKFILES.filter(([manifest]) => has(f.manifests, manifest));
  if (!present.length) return { status: 'skip' };
  const missing = present.filter(
    ([, locks]) => !locks.some((l) => f.trackedSet.has(l)),
  );
  if (!missing.length) return { status: 'pass' };
  return {
    status: 'fail',
    detail: missing
      .map(([manifest, locks]) => `${manifest} has no lockfile (${locks[0]})`)
      .join('; '),
  };
}

function repoMapCheck(f) {
  const files = f.tracked ?? (f.trackedSet ? [...f.trackedSet] : null);
  if (!files) return { status: 'skip' };

  const dirs = new Set();
  for (const p of files) {
    const i = p.lastIndexOf('/');
    if (i > 0 && PACKAGE_MANIFEST_RE.test(p)) dirs.add(p.slice(0, i));
  }
  const workspace =
    has(f.manifests, 'pnpm-workspace.yaml') ||
    !!parsePkg(f.manifests?.['package.json'] ?? '')?.workspaces;
  if (!(workspace || dirs.size >= 3) || !dirs.size) return { status: 'skip' };

  const text = Object.values(f.texts ?? {})
    .filter((t) => typeof t === 'string')
    .join('\n');
  const mentioned = [...dirs].filter((d) => {
    if (text.includes(d)) return true;
    const base = d.slice(d.lastIndexOf('/') + 1);
    return new RegExp(`(?<![\\w.-])${escapeRe(base)}(?![\\w-])`).test(text);
  }).length;
  if (mentioned * 2 >= dirs.size) return { status: 'pass' };
  return {
    status: 'fail',
    detail: `instructions mention ${mentioned} of ${dirs.size} packages`,
  };
}

// `run` is pure: facts in, {status, detail} out. `ignored` is never produced here.
export const CHECKS = Object.freeze([
  {
    id: 'git.repo',
    title: 'Git repository',
    severity: 'blocker',
    engines: 'all',
    fix: 'Runs check out a git worktree. Run `git init` and commit.',
    run: (f) =>
      f.isRepo
        ? { status: 'pass' }
        : { status: 'fail', detail: 'not a git work tree' },
  },
  {
    id: 'instructions.present',
    title: 'Agent instructions present',
    severity: 'blocker',
    engines: 'perEngine',
    fix: 'Add AGENTS.md (read by Codex, Copilot, Cursor) and import it from CLAUDE.md.',
    // perEngine checks are evaluated by engines.mjs, not by this `run`.
    run: () => ({ status: 'skip' }),
  },
  {
    id: 'instructions.committed',
    title: 'Instructions committed',
    severity: 'warn',
    engines: 'perEngine',
    fix: 'Commit it: runs on this engine see only committed files.',
    run: () => ({ status: 'skip' }),
  },
  {
    id: 'instructions.size',
    title: 'Instructions within size budget',
    severity: 'warn',
    engines: 'all',
    fix: 'Trim it or split into .claude/rules/*.md; it is truncated and costs tokens every turn.',
    run: (f) => {
      if (f.truncated) return { status: 'skip' };
      const sizes = Object.entries(f.sizes ?? {});
      if (!sizes.length) return { status: 'skip' };
      const over = sizes.filter(
        ([, n]) => n > DEFAULT_CONTEXT_MAX_BYTES_PER_FILE,
      );
      if (over.length) {
        return {
          status: 'fail',
          detail: `${over[0][0]} exceeds ${DEFAULT_CONTEXT_MAX_BYTES_PER_FILE} bytes`,
        };
      }
      const total = sizes.reduce((a, [, n]) => a + n, 0);
      if (total > DEFAULT_CONTEXT_MAX_BYTES_TOTAL) {
        return {
          status: 'fail',
          detail: `instruction files total ${total} bytes`,
        };
      }
      return { status: 'pass' };
    },
  },
  {
    id: 'instructions.single-source',
    title: 'Single source of truth',
    severity: 'info',
    engines: 'all',
    fix: 'Keep one source: put content in AGENTS.md and @AGENTS.md from CLAUDE.md.',
    run: (f) => {
      const tracked = (p) => f.trackedSet?.has(p);
      if (!(tracked('CLAUDE.md') && tracked('AGENTS.md'))) {
        return { status: 'skip' };
      }
      const mentions = (txt, other) => !!txt && txt.includes(other);
      if (
        mentions(instructionText(f, 'CLAUDE.md'), 'AGENTS.md') ||
        mentions(instructionText(f, 'AGENTS.md'), 'CLAUDE.md')
      ) {
        return { status: 'pass' };
      }
      return {
        status: 'fail',
        detail: 'CLAUDE.md and AGENTS.md do not reference each other',
      };
    },
  },
  {
    id: 'commands.test',
    title: 'Test command discoverable',
    severity: 'warn',
    engines: 'all',
    fix: 'Add a test script/target, or name the command in the instruction file.',
    run: (f) => commandCheck(f, 'test'),
  },
  {
    id: 'commands.build',
    title: 'Build command discoverable',
    severity: 'info',
    engines: 'all',
    fix: 'Add a build script/target, or name it in the instruction file.',
    run: (f) => commandCheck(f, 'build'),
  },
  {
    id: 'commands.lint',
    title: 'Lint command discoverable',
    severity: 'info',
    engines: 'all',
    fix: 'Add a lint/format script/target, or name it in the instruction file.',
    run: (f) => commandCheck(f, 'lint'),
  },
  {
    id: 'deps.lockfile',
    title: 'Lockfile committed',
    severity: 'warn',
    engines: 'all',
    fix: "Commit the lockfile so an agent's install matches CI.",
    run: (f) => lockfileCheck(f),
  },
  {
    id: 'ignore.heavy-dirs',
    title: 'Heavy dirs ignored',
    severity: 'warn',
    engines: 'all',
    fix: '.gitignore it; agents read and grep it otherwise.',
    run: (f) => {
      if (!f.heavyPresent?.length) return { status: 'skip' };
      const leaked = f.heavyPresent.filter((d) => !f.heavyIgnored?.[d]);
      return leaked.length
        ? { status: 'fail', detail: `${leaked.join(', ')} not ignored` }
        : { status: 'pass' };
    },
  },
  {
    id: 'secrets.tracked-names',
    title: 'No secret-looking tracked files',
    severity: 'warn',
    engines: 'all',
    fix: 'Remove it and rotate it: agents read the file and send it to the model provider.',
    run: (f) => {
      if (!f.tracked) return { status: 'skip' };
      const hit = f.tracked.find((p) => SECRET_RES.some((re) => re.test(p)));
      return hit
        ? { status: 'fail', detail: `${hit} is tracked` }
        : { status: 'pass' };
    },
  },
  {
    id: 'repo.map',
    title: 'Monorepo map present',
    severity: 'info',
    engines: 'all',
    fix: 'Add a short map of the packages to the instruction file.',
    run: (f) => repoMapCheck(f),
  },
]);
