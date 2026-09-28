import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const PINS = {
  yaml: ['2.9.1', 'sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw=='],
  'smol-toml': ['1.9.0', 'sha512-hpd+HLON7HdZXqYchMM/+LaTTbdK0AU3NngIJ4KVyWbY9bfQqdL9cD+4yf6dUoU2Ap4VsU0JkQi6FxAI1B2mXQ=='],
};

test('yaml and smol-toml are exact-pinned runtime dependencies, locked with integrity', () => {
  const pkg = read('../package.json');
  const lock = read('../package-lock.json');
  for (const [name, [version, integrity]] of Object.entries(PINS)) {
    assert.equal(pkg.dependencies[name], version, `${name} pinned exactly (no caret)`);
    assert.equal((pkg.devDependencies || {})[name], undefined);
    assert.equal(lock.packages[''].dependencies[name], version);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.version, version);
    assert.equal(entry.integrity, integrity);
    assert.notEqual(entry.dev, true);
  }
  if (pkg.name === '@worca/app') {
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@highlightjs/cdn-assets', 'dompurify', 'express', 'htmlparser2', 'marked', 'smol-toml', 'ws', 'yaml']);
  }
});

test('both are pure JS: no dependencies, no install scripts, no native build (macOS, Linux, Windows alike)', () => {
  for (const name of Object.keys(PINS)) {
    const p = read(`../node_modules/${name}/package.json`);
    assert.deepEqual(p.dependencies || {}, {}, name);
    for (const s of ['preinstall', 'install', 'postinstall']) assert.equal((p.scripts || {})[s], undefined, `${name} ${s}`);
    assert.equal(p.gypfile, undefined, name);
  }
});

test('both import as ESM under this Node (>= 22.13) and parse', async () => {
  const { parseAllDocuments, LineCounter } = await import('yaml');
  const { parse } = await import('smol-toml');
  const docs = parseAllDocuments('a: 1\n---\nb: [x]\n', { lineCounter: new LineCounter() });
  assert.deepEqual(docs.map((d) => d.toJS()), [{ a: 1 }, { b: ['x'] }]);
  assert.equal(parse('[package]\nname = "x"\n').package.name, 'x');
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 13), process.versions.node);
});
