import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_VERSION, CHECKS } from '../src/core/repo-readiness/checks.mjs';

const byId = (id) => CHECKS.find((c) => c.id === id);
const pkg = (scripts) => JSON.stringify({ scripts });

describe('checks catalog', () => {
  it('exports CATALOG_VERSION = 1', () => {
    assert.strictEqual(CATALOG_VERSION, 1);
  });

  it('exports a frozen CHECKS array with 12 entries', () => {
    assert.ok(Array.isArray(CHECKS));
    assert.strictEqual(CHECKS.length, 12);
    assert.throws(() => {
      CHECKS.push({});
    }, TypeError);
  });

  it('each check has required fields: id, title, severity, engines, fix, run', () => {
    for (const c of CHECKS) {
      assert.ok(typeof c.id === 'string');
      assert.ok(typeof c.title === 'string');
      assert.ok(['blocker', 'warn', 'info'].includes(c.severity));
      assert.ok(
        c.engines === 'all' ||
          c.engines === 'perEngine' ||
          Array.isArray(c.engines),
      );
      assert.ok(typeof c.fix === 'string');
      assert.ok(typeof c.run === 'function');
    }
  });

  it('has the expected ids in order', () => {
    assert.deepStrictEqual(
      CHECKS.map((c) => c.id),
      [
        'git.repo',
        'instructions.present',
        'instructions.committed',
        'instructions.size',
        'instructions.single-source',
        'commands.test',
        'commands.build',
        'commands.lint',
        'deps.lockfile',
        'ignore.heavy-dirs',
        'secrets.tracked-names',
        'repo.map',
      ],
    );
  });

  it('blockers are: git.repo, instructions.present', () => {
    const blockers = CHECKS.filter((c) => c.severity === 'blocker').map(
      (c) => c.id,
    );
    assert.deepStrictEqual(
      blockers.sort(),
      ['git.repo', 'instructions.present'].sort(),
    );
  });

  it('info checks are single-source, build, lint, repo.map', () => {
    const info = CHECKS.filter((c) => c.severity === 'info').map((c) => c.id);
    assert.deepStrictEqual(
      info.sort(),
      [
        'commands.build',
        'commands.lint',
        'instructions.single-source',
        'repo.map',
      ].sort(),
    );
  });

  it('perEngine checks are: instructions.present, instructions.committed', () => {
    const perEngine = CHECKS.filter((c) => c.engines === 'perEngine').map(
      (c) => c.id,
    );
    assert.deepStrictEqual(
      perEngine.sort(),
      ['instructions.present', 'instructions.committed'].sort(),
    );
  });
});

describe('check results', () => {
  it('git.repo check: pass for a repo, fail otherwise', () => {
    const repoCheck = byId('git.repo');
    assert.deepStrictEqual(repoCheck.run({ isRepo: true }), { status: 'pass' });
    const res = repoCheck.run({ isRepo: false });
    assert.strictEqual(res.status, 'fail');
    assert.strictEqual(typeof res.detail, 'string');
  });

  it('perEngine checks have a skip run (engines.mjs evaluates them)', () => {
    for (const id of ['instructions.present', 'instructions.committed']) {
      const check = byId(id);
      assert.strictEqual(check.engines, 'perEngine');
      assert.deepStrictEqual(check.run({}), { status: 'skip' });
    }
  });

  it('instructions.size check: skip if no files, pass if OK, fail if over limit', () => {
    const check = byId('instructions.size');

    assert.deepStrictEqual(check.run({ sizes: {}, truncated: false }), {
      status: 'skip',
    });
    assert.deepStrictEqual(
      check.run({ sizes: { 'CLAUDE.md': 100 }, truncated: true }),
      { status: 'skip' },
    );
    assert.deepStrictEqual(
      check.run({ sizes: { 'CLAUDE.md': 10000 }, truncated: false }),
      { status: 'pass' },
    );

    const result1 = check.run({
      sizes: { 'CLAUDE.md': 30000 },
      truncated: false,
    });
    assert.strictEqual(result1.status, 'fail');
    assert.ok(result1.detail.includes('CLAUDE.md'));

    const result2 = check.run({
      sizes: {
        'CLAUDE.md': 20000,
        'AGENTS.md': 20000,
        'a.md': 20000,
        'b.md': 20000,
      },
      truncated: false,
    });
    assert.strictEqual(result2.status, 'fail');
    assert.ok(result2.detail.includes('80000'));
  });

  it('instructions.single-source: pass if CLAUDE.md and AGENTS.md reference each other', () => {
    const check = byId('instructions.single-source');

    assert.deepStrictEqual(
      check.run({ trackedSet: new Set(['CLAUDE.md']) }),
      { status: 'skip' },
    );
    assert.deepStrictEqual(check.run({}), { status: 'skip' });

    const both = new Set(['CLAUDE.md', 'AGENTS.md']);
    assert.strictEqual(
      check.run({
        trackedSet: both,
        texts: { 'CLAUDE.md': 'See @AGENTS.md', 'AGENTS.md': '' },
      }).status,
      'pass',
    );
    assert.strictEqual(
      check.run({
        trackedSet: both,
        texts: { 'CLAUDE.md': '', 'AGENTS.md': 'mirrors CLAUDE.md' },
      }).status,
      'pass',
    );
    assert.strictEqual(
      check.run({
        trackedSet: both,
        texts: { 'CLAUDE.md': 'Claude stuff', 'AGENTS.md': 'Agent stuff' },
      }).status,
      'fail',
    );
    // text missing entirely → no reference found
    assert.strictEqual(check.run({ trackedSet: both, texts: {} }).status, 'fail');
  });
});

describe('commands.* discovery', () => {
  const test = byId('commands.test');
  const build = byId('commands.build');
  const lint = byId('commands.lint');

  it('skips when there is no manifest and no Makefile', () => {
    for (const c of [test, build, lint]) {
      assert.deepStrictEqual(c.run({ manifests: {} }), { status: 'skip' });
    }
  });

  it('package.json: test script present passes; npm default does not', () => {
    assert.strictEqual(
      test.run({ manifests: { 'package.json': pkg({ test: 'jest' }) } }).status,
      'pass',
    );
    const def = 'echo "Error: no test specified" && exit 1';
    assert.strictEqual(
      test.run({
        manifests: { 'package.json': pkg({ test: def }) },
        texts: {},
      }).status,
      'fail',
    );
  });

  it('package.json: fails when no script and no mention', () => {
    const res = test.run({
      manifests: { 'package.json': pkg({}) },
      texts: { 'CLAUDE.md': 'no mention of test' },
      trackedSet: new Set(),
    });
    assert.strictEqual(res.status, 'fail');
    assert.ok(res.detail.includes('test'));
  });

  it('package.json: unparsable json is treated as no scripts', () => {
    assert.strictEqual(
      test.run({ manifests: { 'package.json': '{nope' }, texts: {} }).status,
      'fail',
    );
  });

  it('package.json: build and lint (lint|format|check)', () => {
    const m = (s) => ({ manifests: { 'package.json': pkg(s) }, texts: {} });
    assert.strictEqual(build.run(m({ build: 'tsc' })).status, 'pass');
    assert.strictEqual(build.run(m({})).status, 'fail');
    assert.strictEqual(lint.run(m({ lint: 'eslint' })).status, 'pass');
    assert.strictEqual(lint.run(m({ format: 'prettier' })).status, 'pass');
    assert.strictEqual(lint.run(m({ check: 'biome check' })).status, 'pass');
    assert.strictEqual(lint.run(m({ test: 'x' })).status, 'fail');
  });

  it('Makefile targets (Makefile and makefile)', () => {
    const mk = 'all: x\n\ttrue\ntest:\n\ttrue\nfmt:\n\ttrue\n';
    assert.strictEqual(test.run({ manifests: { Makefile: mk } }).status, 'pass');
    assert.strictEqual(build.run({ manifests: { makefile: mk } }).status, 'pass');
    assert.strictEqual(lint.run({ manifests: { Makefile: mk } }).status, 'pass');
    assert.strictEqual(
      test.run({ manifests: { Makefile: 'clean:\n\ttrue\n' }, texts: {} }).status,
      'fail',
    );
    assert.strictEqual(
      test.run({ manifests: { Makefile: 'check:\n\ttrue\n' } }).status,
      'pass',
    );
  });

  it('instruction code span mention is a fallback pass', () => {
    const base = { manifests: { 'package.json': pkg({}) } };
    assert.strictEqual(
      test.run({ ...base, texts: { 'AGENTS.md': 'Run `npm test` first' } })
        .status,
      'pass',
    );
    assert.strictEqual(
      test.run({
        ...base,
        texts: { 'AGENTS.md': '```sh\nmake test\n```' },
      }).status,
      'pass',
    );
    // word outside a code span does not count
    assert.strictEqual(
      test.run({ ...base, texts: { 'AGENTS.md': 'please test it' } }).status,
      'fail',
    );
    // substring of another word inside a span does not count
    assert.strictEqual(
      test.run({ ...base, texts: { 'AGENTS.md': 'use `latest`' } }).status,
      'fail',
    );
  });

  it('go.mod: test/build pass implicitly, lint needs golangci config', () => {
    const f = { manifests: { 'go.mod': 'module x' }, texts: {} };
    assert.strictEqual(test.run(f).status, 'pass');
    assert.strictEqual(build.run(f).status, 'pass');
    assert.strictEqual(lint.run(f).status, 'fail');
    assert.strictEqual(
      lint.run({ ...f, trackedSet: new Set(['.golangci.yml']) }).status,
      'pass',
    );
    assert.strictEqual(
      lint.run({ ...f, trackedSet: new Set(['.golangci.yaml']) }).status,
      'pass',
    );
  });

  it('Cargo.toml / pom.xml / build.gradle(.kts): test and build pass implicitly', () => {
    for (const m of ['Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts']) {
      const f = { manifests: { [m]: '' }, texts: {} };
      assert.strictEqual(test.run(f).status, 'pass', m);
      assert.strictEqual(build.run(f).status, 'pass', m);
    }
    assert.strictEqual(
      lint.run({ manifests: { 'Cargo.toml': '' } }).status,
      'pass',
    );
    // maven/gradle: no implicit lint pass
    assert.strictEqual(
      lint.run({ manifests: { 'pom.xml': '' }, texts: {} }).status,
      'fail',
    );
  });

  it('pyproject.toml: test, build n/a (skip), lint', () => {
    const py = (txt, tracked = []) => ({
      manifests: { 'pyproject.toml': txt },
      trackedSet: new Set(tracked),
      texts: {},
    });
    assert.strictEqual(
      test.run(py('[tool.pytest.ini_options]\n')).status,
      'pass',
    );
    assert.strictEqual(
      test.run(py('[project]\ndependencies=["pytest"]')).status,
      'pass',
    );
    assert.strictEqual(test.run(py('', ['tox.ini'])).status, 'pass');
    assert.strictEqual(test.run(py('', ['noxfile.py'])).status, 'pass');
    assert.strictEqual(test.run(py('[project]\nname="x"')).status, 'fail');

    assert.deepStrictEqual(build.run(py('[project]\nname="x"')), {
      status: 'skip',
    });
    // an instruction mention still wins over n/a
    assert.strictEqual(
      build.run({
        ...py('[project]'),
        texts: { 'AGENTS.md': 'run `make build`' },
      }).status,
      'pass',
    );
    // package.json without a build script is not excused by pyproject
    assert.strictEqual(
      build.run({
        manifests: { 'package.json': pkg({}), 'pyproject.toml': '' },
        texts: {},
      }).status,
      'fail',
    );

    assert.strictEqual(lint.run(py('[tool.ruff]\nline-length=88')).status, 'pass');
    assert.strictEqual(lint.run(py('[tool.black]\n')).status, 'pass');
    assert.strictEqual(lint.run(py('[tool.flake8]\n')).status, 'pass');
    assert.strictEqual(lint.run(py('', ['.flake8'])).status, 'pass');
    assert.strictEqual(lint.run(py('', ['ruff.toml'])).status, 'pass');
    assert.strictEqual(lint.run(py('[project]')).status, 'fail');
  });
});

describe('deps.lockfile', () => {
  const check = byId('deps.lockfile');

  it('skips without a tracked set or without a dependency manifest', () => {
    assert.deepStrictEqual(check.run({ manifests: {}, trackedSet: new Set() }), {
      status: 'skip',
    });
    assert.deepStrictEqual(
      check.run({ manifests: { 'package.json': '{}' }, trackedSet: null }),
      { status: 'skip' },
    );
    assert.deepStrictEqual(check.run({}), { status: 'skip' });
    // a Makefile alone has no lockfile concept
    assert.deepStrictEqual(
      check.run({ manifests: { Makefile: '' }, trackedSet: new Set() }),
      { status: 'skip' },
    );
  });

  it('passes when each manifest has a tracked lockfile', () => {
    const run = (m, lock) =>
      check.run({ manifests: { [m]: '' }, trackedSet: new Set([lock]) }).status;
    assert.strictEqual(run('package.json', 'package-lock.json'), 'pass');
    assert.strictEqual(run('package.json', 'pnpm-lock.yaml'), 'pass');
    assert.strictEqual(run('package.json', 'yarn.lock'), 'pass');
    assert.strictEqual(run('pyproject.toml', 'poetry.lock'), 'pass');
    assert.strictEqual(run('pyproject.toml', 'uv.lock'), 'pass');
    assert.strictEqual(run('pyproject.toml', 'requirements.txt'), 'pass');
    assert.strictEqual(run('Cargo.toml', 'Cargo.lock'), 'pass');
    assert.strictEqual(run('go.mod', 'go.sum'), 'pass');
  });

  it('fails naming every manifest missing its lockfile', () => {
    const res = check.run({
      manifests: { 'package.json': '{}', 'Cargo.toml': '', 'go.mod': '' },
      trackedSet: new Set(['go.sum']),
    });
    assert.strictEqual(res.status, 'fail');
    assert.ok(res.detail.includes('package.json'));
    assert.ok(res.detail.includes('Cargo.toml'));
    assert.ok(!res.detail.includes('go.mod'));
  });
});

describe('ignore.heavy-dirs', () => {
  it('pass if heavy dirs are ignored, fail otherwise', () => {
    const check = byId('ignore.heavy-dirs');

    assert.deepStrictEqual(check.run({ heavyPresent: [] }), { status: 'skip' });
    assert.deepStrictEqual(check.run({}), { status: 'skip' });

    assert.strictEqual(
      check.run({
        heavyPresent: ['node_modules'],
        heavyIgnored: { node_modules: true },
      }).status,
      'pass',
    );

    const result = check.run({
      heavyPresent: ['node_modules', 'dist'],
      heavyIgnored: { node_modules: true, dist: false },
    });
    assert.strictEqual(result.status, 'fail');
    assert.ok(result.detail.includes('dist'));
    assert.ok(!result.detail.includes('node_modules'));
  });
});

describe('secrets.tracked-names', () => {
  const check = byId('secrets.tracked-names');
  const run = (...tracked) => check.run({ tracked });

  it('skips when tracked files are unknown', () => {
    assert.deepStrictEqual(check.run({ tracked: null }), { status: 'skip' });
    assert.deepStrictEqual(check.run({}), { status: 'skip' });
  });

  it('passes with no secret-looking names, including .env templates', () => {
    assert.strictEqual(run('src/main.js', 'package.json').status, 'pass');
    assert.strictEqual(
      run('.env.example', 'a/.env.sample', '.env.template', 'environment.ts')
        .status,
      'pass',
    );
  });

  it('fails on secret-looking names', () => {
    for (const p of [
      '.env',
      'src/.env',
      'src/.env.local',
      'certs/server.pem',
      'a.p12',
      'a.pfx',
      'id_rsa',
      '.ssh/id_rsa.pub',
      'id_ed25519',
      'keys/id_ed25519_work',
      'release.keystore',
      'config/credentials.json',
    ]) {
      const res = run('README.md', p);
      assert.strictEqual(res.status, 'fail', p);
      assert.ok(res.detail.includes(p), p);
    }
  });
});

describe('repo.map', () => {
  const check = byId('repo.map');
  const files = (...p) => ({ tracked: p, trackedSet: new Set(p) });

  it('skips for a single-package repo', () => {
    assert.deepStrictEqual(
      check.run({
        manifests: { 'package.json': '{}' },
        ...files('package.json', 'src/a.js', 'packages/a/package.json'),
        texts: {},
      }),
      { status: 'skip' },
    );
    assert.deepStrictEqual(check.run({}), { status: 'skip' });
  });

  const mono = files(
    'package.json',
    'packages/a/package.json',
    'packages/b/package.json',
    'packages/c/package.json',
  );

  it('≥3 nested manifests with no mention fails', () => {
    const res = check.run({ manifests: {}, ...mono, texts: {} });
    assert.strictEqual(res.status, 'fail');
    assert.ok(res.detail);
  });

  it('passes when at least half of the package dirs are mentioned', () => {
    const res = check.run({
      manifests: {},
      ...mono,
      texts: { 'AGENTS.md': 'packages/a and packages/b are libs' },
    });
    assert.strictEqual(res.status, 'pass');
  });

  it('fails when fewer than half are mentioned', () => {
    const res = check.run({
      manifests: {},
      ...mono,
      texts: { 'AGENTS.md': 'only packages/a here' },
    });
    assert.strictEqual(res.status, 'fail');
  });

  it('a basename mention counts', () => {
    const res = check.run({
      manifests: {},
      ...mono,
      texts: { 'CLAUDE.md': 'The a, b and c packages' },
    });
    // single-letter basenames are matched as whole words
    assert.strictEqual(res.status, 'pass');
  });

  it('pnpm-workspace.yaml or package.json workspaces marks a monorepo', () => {
    const two = files('packages/a/package.json', 'packages/b/package.json');
    assert.strictEqual(
      check.run({
        manifests: { 'pnpm-workspace.yaml': 'packages: [packages/*]' },
        ...two,
        texts: {},
      }).status,
      'fail',
    );
    assert.strictEqual(
      check.run({
        manifests: {
          'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
        },
        ...two,
        texts: { 'AGENTS.md': 'packages/a, packages/b' },
      }).status,
      'pass',
    );
  });

  it('workspace manifest with no enumerable package dirs skips', () => {
    assert.deepStrictEqual(
      check.run({
        manifests: { 'pnpm-workspace.yaml': '' },
        ...files('package.json'),
        texts: {},
      }),
      { status: 'skip' },
    );
  });

  it('other manifest kinds count toward the threshold', () => {
    const res = check.run({
      manifests: {},
      ...files('svc/a/go.mod', 'svc/b/pyproject.toml', 'svc/c/Cargo.toml'),
      texts: {},
    });
    assert.strictEqual(res.status, 'fail');
  });

  it('falls back to trackedSet when tracked list is absent', () => {
    const res = check.run({
      manifests: {},
      trackedSet: new Set(mono.tracked),
      texts: {},
    });
    assert.strictEqual(res.status, 'fail');
  });
});

describe('purity', () => {
  it('every check returns a known status for an empty facts object', () => {
    for (const c of CHECKS) {
      const res = c.run({});
      assert.ok(['pass', 'fail', 'skip', 'error'].includes(res.status), c.id);
    }
  });
});
