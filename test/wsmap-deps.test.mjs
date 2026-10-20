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
    // @ricky0123/vad-web + onnxruntime-web: Ask Worca voice mode's in-page Silero VAD (docs/speech.md).
    // undici: fetch() through HTTP(S)_PROXY on Nodes without http.setGlobalProxyFromEnv (src/core/env-proxy.mjs).
    // @xterm/*: the terminal pane, served from node_modules (docs/terminal.md).
    // gsap + playwright-core: the promo video kit (assets/promo-kit: the film runtime, real-UI plate capture on a system Chrome).
    // diff: Folder runs' changes.patch (src/core/folder-copy.mjs, jsdiff createTwoFilesPatch).
    // tar: GitHub's .tar.gz archives read without git (src/core/git-free/archive.mjs).
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@highlightjs/cdn-assets', '@modelcontextprotocol/sdk', '@ricky0123/vad-web', '@xterm/addon-fit', '@xterm/xterm', 'diff', 'dompurify', 'express', 'gsap', 'htmlparser2', 'marked', 'onnxruntime-web', 'playwright-core', 'smol-toml', 'tar', 'undici', 'ws', 'yaml']);
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
