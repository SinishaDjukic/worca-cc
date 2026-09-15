import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintProject, FINGERPRINT_LIMITS } from '../src/core/auto/fingerprint.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), 'worca-fp-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(dir, ...rel.split('/')), body, 'utf8');
  }
  return dir;
}

test('a node web app: manifests, deps, lockfile, test config, languages and the web hint', async () => {
  const dir = await fixture({
    'package.json': JSON.stringify({ name: 'x', dependencies: { react: '1', express: '4' }, devDependencies: { vitest: '2', '@playwright/test': '1' } }),
    'package-lock.json': '{}', 'vitest.config.ts': '', 'README.md': '#',
    'src/app.tsx': '', 'src/server.ts': '', 'src/lib/util.ts': '', 'src/styles/main.css': '',
    'node_modules/react/index.js': 'never counted', '.github/workflows/ci.yml': '',
  });
  const fp = await fingerprintProject(dir);
  assert.match(fp, /^top-level: \.github\/ README\.md package-lock\.json package\.json src\/ vitest\.config\.ts$/m);
  assert.match(fp, /^package\.json \(node\): @playwright\/test, express, react, vitest$/m);
  assert.match(fp, /^lockfiles: package-lock\.json$/m);
  assert.match(fp, /^tests\/ci: vitest\.config\.ts, \.github\/workflows$/m);
  assert.match(fp, /^languages: TypeScript \(4\), CSS \(1\)$/m, 'src/*.ts(x) + the top-level vitest.config.ts');
  assert.match(fp, /^hints: web-ui likely \(react, express\); tests: vitest$/m);
  assert.ok(!fp.includes('never counted') && !/JavaScript/.test(fp), 'node_modules is skipped');
});

test('a python library and an empty dir', async () => {
  const py = await fixture({ 'pyproject.toml': '[project]\nname = "x"\ndependencies = ["fastapi>=0.1", "pydantic"]\n', 'pkg/__init__.py': '', 'pkg/core.py': '', 'tests/test_core.py': '', 'pytest.ini': '' });
  const fp = await fingerprintProject(py);
  assert.match(fp, /^pyproject\.toml \(python\): fastapi, pydantic$/m);
  assert.match(fp, /^languages: Python \(3\)$/m);
  assert.match(fp, /^hints: web-ui likely \(fastapi\); tests: pytest$/m);
  const empty = await fixture({});
  assert.equal(await fingerprintProject(empty), 'top-level: ');
});

test('requirements*.txt globs and .csproj manifests are recognised', async () => {
  const dir = await fixture({
    'requirements-dev.txt': 'pytest>=8\nruff\n# a comment\n-r requirements.txt\n',
    'App.csproj': '<Project><ItemGroup><PackageReference Include="Serilog" Version="3" /><PackageReference Include="xunit" Version="2" /></ItemGroup></Project>',
  });
  const fp = await fingerprintProject(dir);
  assert.match(fp, /^requirements-dev\.txt \(python\): pytest, ruff$/m);
  assert.match(fp, /^App\.csproj \(dotnet\): Serilog, xunit$/m);
});

test('the output is capped and an unreadable dir degrades, never throws', async () => {
  const deps = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`some-really-long-dependency-name-number-${i}`, '1']));
  const big = await fixture({ 'package.json': JSON.stringify({ dependencies: deps }) });
  const fp = await fingerprintProject(big);
  assert.ok(Buffer.byteLength(fp, 'utf8') <= FINGERPRINT_LIMITS.maxBytes, `${Buffer.byteLength(fp)} bytes`);
  assert.ok(fp.endsWith('…'), 'a clipped fingerprint ends with an ellipsis');
  assert.match(await fingerprintProject(join(tmpdir(), 'worca-fp-does-not-exist')), /^fingerprint: unavailable \(ENOENT\)$/);
});

test('the bounds hold: dotfiles are hidden (except .github), the walk is depth-capped, the top-level list is capped', async () => {
  const files = { '.env': 'SECRET=1', '.gitignore': 'x', 'a.ts': '' };
  for (let i = 0; i < 70; i += 1) files[`f${String(i).padStart(3, '0')}.md`] = '';
  files['a/b/c/deep.py'] = '';                                    // depth 3 > FINGERPRINT_LIMITS.depth
  const dir = await fixture(files);
  const fp = await fingerprintProject(dir);
  assert.ok(!fp.includes('.env') && !fp.includes('.gitignore'), 'dotfiles never reach the prompt');
  assert.match(fp, /… \(\+12\)/, 'the top-level list is capped at maxTopEntries with a remainder');
  assert.equal(fp.split('\n')[0].slice('top-level: '.length).split(' … ')[0].split(' ').length, FINGERPRINT_LIMITS.maxTopEntries, 'exactly maxTopEntries names are listed');
  assert.ok(!/Python/.test(fp), 'the language walk stops at FINGERPRINT_LIMITS.depth');
  assert.match(fp, /TypeScript \(1\)/);
});
