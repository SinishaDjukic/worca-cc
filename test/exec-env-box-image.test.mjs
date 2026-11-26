// test/exec-env-box-image.test.mjs — the box image's pure parts (src/core/exec-env/box-image.mjs): the base setting,
// the union of specs and its conflict refusal, the Dockerfile and tag, the check of a built image, current or stale,
// and the .env line. No Docker, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnvSpec } from '../src/core/exec-env/env-spec.mjs';
import {
  boxBaseImage, checkImageRef, unionSpecs, renderBoxDockerfile, boxImageTag, parseBoxProbe, parseLabels, checkBoxProbe,
  boxImageState, setDotenvLine, BoxImageError, PROBE_SCRIPT, CLAUDE_CODE_LABEL,
} from '../src/core/exec-env/box-image.mjs';

const spec = (tools = [], apt = []) => normalizeEnvSpec({ tools, apt });
const env = (vars) => (k) => vars[k] ?? '';

test('the base: WORCA_BASE_IMAGE, else the image of WORCA_TAG, else latest; never something a FROM line cannot hold', () => {
  assert.equal(boxBaseImage(env({})), 'ghcr.io/worca-org/worca:latest');
  assert.equal(boxBaseImage(env({ WORCA_TAG: '1.21.0-full' })), 'ghcr.io/worca-org/worca:1.21.0-full');
  assert.equal(boxBaseImage(env({ WORCA_TAG: 'rc', WORCA_BASE_IMAGE: 'registry.acme.example/platform/worca:1.21.0' })), 'registry.acme.example/platform/worca:1.21.0');
  assert.equal(checkImageRef('acme/worca@sha256:' + 'a'.repeat(64)), 'acme/worca@sha256:' + 'a'.repeat(64));
  for (const bad of ['acme/worca:1\nRUN id', 'acme worca', '--privileged', 'acme/$(id)', 'a/../b', "acme'"]) {
    assert.throws(() => boxBaseImage(env({ WORCA_BASE_IMAGE: bad })), BoxImageError, JSON.stringify(bad));
  }
  assert.throws(() => boxBaseImage(env({ WORCA_TAG: 'x y' })), /WORCA_TAG/);
});

test('union: every tool once, every apt package once, sorted, with one hash', () => {
  const u = unionSpecs([
    { key: 'acme-api-11111111', name: 'acme-api', spec: spec([{ name: 'node', version: '24.21.0' }, { name: 'python', version: '3.13.1' }], ['libpq-dev']) },
    { key: 'acme-web-22222222', name: 'acme-web', spec: spec([{ name: 'node', version: '24.21.0' }], ['libpq-dev', 'curl']) },
  ]);
  assert.deepEqual(u.tools, [{ name: 'node', version: '24.21.0' }, { name: 'python', version: '3.13.1' }]);
  assert.deepEqual(u.apt, ['curl', 'libpq-dev']);
  assert.match(u.hash, /^sha256:[0-9a-f]{64}$/);
  const again = unionSpecs([{ key: 'b-22222222', spec: spec([{ name: 'node', version: '24.21.0' }], ['curl', 'libpq-dev']) },
    { key: 'a-11111111', spec: spec([{ name: 'python', version: '3.13.1' }]) }]);
  assert.equal(again.hash, u.hash, 'the same tools give the same hash, whichever project brings them');
});

test('union: two pins of one tool are refused with both projects and the tool named', () => {
  assert.throws(() => unionSpecs([
    { key: 'acme-api-11111111', name: 'acme-api', spec: spec([{ name: 'node', version: '24.21.0' }]) },
    { key: 'acme-web-22222222', name: 'acme-web', spec: spec([{ name: 'node', version: '22.19.0' }]) },
  ]), (err) => err instanceof BoxImageError
    && /tool node: project acme-api \(acme-api-11111111\) pins 24\.21\.0, project acme-web \(acme-web-22222222\) pins 22\.19\.0/.test(err.message)
    && /--project/.test(err.message));
  assert.throws(() => unionSpecs([]), /no project/);
});

test('union: the limits hold for the sum', () => {
  const many = (prefix) => spec(Array.from({ length: 60 }, (_, i) => ({ name: `${prefix}${i}`, version: '1' })));
  assert.throws(() => unionSpecs([{ key: 'a-11111111', spec: many('a') }, { key: 'b-22222222', spec: many('b') }]), /together: at most 100 tools/);
});

test('the Dockerfile: FROM the base, the layers as root, back to worca, the spec as a label', () => {
  const s = spec([{ name: 'node', version: '24.21.0' }], ['libpq-dev']);
  const d = renderBoxDockerfile({ base: 'ghcr.io/worca-org/worca:1.21.0', spec: s });
  const lines = d.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('FROM ')).length, 1);
  assert.equal(lines[1], 'FROM ghcr.io/worca-org/worca:1.21.0');
  assert.equal(lines[2], 'USER root');
  assert.ok(d.indexOf("'libpq-dev'") > d.indexOf('USER root') && d.indexOf("'node@24.21.0'") < d.indexOf('USER worca'));
  assert.match(d, new RegExp(`^LABEL dev\\.worca\\.box-image\\.spec="${s.hash}"$`, 'm'));
  assert.ok(d.endsWith('\n'));
  assert.throws(() => renderBoxDockerfile({ base: 'x\nRUN id', spec: s }), BoxImageError);
  assert.throws(() => renderBoxDockerfile({ base: 'acme/worca:1', spec: { ...s, hash: 'nope' } }), BoxImageError);
});

test('the tag: predictable from the Dockerfile and the base id; a newer base gives a new one', () => {
  const t = boxImageTag('FROM x\n', 'sha256:aaa');
  assert.match(t, /^worca-box:[0-9a-f]{12}$/);
  assert.equal(boxImageTag('FROM x\n', 'sha256:aaa'), t);
  assert.notEqual(boxImageTag('FROM x\n', 'sha256:bbb'), t);
  assert.notEqual(boxImageTag('FROM y\n', 'sha256:aaa'), t);
});

test('the probe: its output parses into versions; a missing tool is null', () => {
  assert.match(PROBE_SCRIPT, /for c in node git claude worca/);
  const p = parseBoxProbe('node=v24.11.1\ngit=git version 2.39.5\nclaude=2.1.278 (Claude Code)\nworca=worca 1.21.0-rc.1\n');
  assert.deepEqual(p, { node: '24.11.1', git: '2.39.5', claude: '2.1.278', worca: '1.21.0-rc.1' });
  assert.deepEqual(parseBoxProbe('node=\r\ngit=git version 2.39.5\r\nnoise\nclaude=\n'), { node: null, git: '2.39.5', claude: null, worca: null });
  assert.deepEqual(parseBoxProbe(''), { node: null, git: null, claude: null, worca: null });
  assert.deepEqual(parseLabels('{"dev.worca.claude-code.version":"2.1.278"}'), { [CLAUDE_CODE_LABEL]: '2.1.278' });
  assert.deepEqual(parseLabels('null'), {});
  assert.deepEqual(parseLabels('garbage'), {});
  assert.deepEqual(parseLabels('[1]'), {});
});

test('the check: a Worca-derived image with what Worca needs passes; each gap is one clear line', () => {
  const good = { node: '24.11.1', git: '2.39.5', claude: '2.1.278', worca: '1.21.0' };
  const labels = { [CLAUDE_CODE_LABEL]: '2.1.278' };
  const base = 'registry.acme.example/worca:1';
  assert.deepEqual(checkBoxProbe(good, { labels, base, minNode: '22.19.0' }), []);
  assert.deepEqual(checkBoxProbe(good, { labels: {}, base }), [`the base ${base} is not a Worca image or one built FROM it (it has no ${CLAUDE_CODE_LABEL} label)`]);
  assert.match(checkBoxProbe({ ...good, node: '20.18.0' }, { labels, base, minNode: '22.19.0' })[0], /node 20\.18\.0 runs in the image, but Worca needs 22\.19\.0 or newer/);
  assert.match(checkBoxProbe({ ...good, node: null }, { labels, base })[0], /node is missing/);
  assert.match(checkBoxProbe({ ...good, git: null }, { labels, base })[0], /git is missing/);
  assert.match(checkBoxProbe({ ...good, claude: '2.0.1' }, { labels, base })[0], /Claude Code 2\.0\.1 runs in the image, but the base pins 2\.1\.278/);
  assert.match(checkBoxProbe({ ...good, claude: null }, { labels, base })[0], /Claude Code \(claude\) is missing/);
  assert.match(checkBoxProbe({ ...good, worca: null }, { labels, base })[0], /worca is missing/);
  assert.equal(checkBoxProbe({ node: null, git: null, claude: null, worca: null }, { labels: {}, base }).length, 5);
});

test('current or stale: spec changes, a cleared spec, a new base and a newer pull of it; nothing rebuilds', () => {
  const record = { image: 'worca-box:abc', base: 'ghcr.io/worca-org/worca:latest', baseId: 'sha256:1',
    projects: [{ key: 'acme-api-11111111', name: 'acme-api', specHash: 'sha256:a' }, { key: 'acme-web-22222222', name: '', specHash: 'sha256:b' }] };
  const hashes = { 'acme-api-11111111': 'sha256:a', 'acme-web-22222222': 'sha256:b' };
  const at = (over = {}) => boxImageState({ record, envImage: 'worca-box:abc', base: record.base, specHashOf: (k) => hashes[k] ?? null, ...over });
  assert.deepEqual(at(), { state: 'current', image: 'worca-box:abc', reasons: [], notes: [] });
  assert.equal(at({ baseId: 'sha256:1' }).state, 'current');
  let s = at({ specHashOf: (k) => (k === 'acme-api-11111111' ? 'sha256:new' : hashes[k]) });
  assert.equal(s.state, 'stale'); assert.deepEqual(s.reasons, ['project acme-api (acme-api-11111111) changed its environment spec']);
  s = at({ specHashOf: (k) => (k === 'acme-web-22222222' ? null : hashes[k]) });
  assert.deepEqual(s.reasons, ['project acme-web-22222222 no longer has an environment spec']);
  s = at({ specHashOf: () => { throw new Error('db gone'); } });
  assert.equal(s.state, 'stale', 'an unreadable spec counts as gone, never as current');
  s = at({ base: 'ghcr.io/worca-org/worca:rc' });
  assert.deepEqual(s.reasons, ['the base is now ghcr.io/worca-org/worca:rc (built from ghcr.io/worca-org/worca:latest)']);
  s = at({ baseId: 'sha256:2' });
  assert.deepEqual(s.reasons, ['a newer ghcr.io/worca-org/worca:latest is here (pulled since the build)']);
  s = at({ withSpec: [{ key: 'acme-api-11111111', name: 'acme-api' }, { key: 'acme-ops-33333333', name: 'acme-ops' }] });
  assert.equal(s.state, 'current'); assert.deepEqual(s.notes, ['project acme-ops (acme-ops-33333333) has a spec that is not in the image']);
  assert.equal(boxImageState({ record, envImage: '', base: record.base, specHashOf: () => null }).state, 'none');
  assert.equal(boxImageState({ record: null, envImage: '', base: record.base, specHashOf: () => null }).notes.length, 0);
  assert.equal(boxImageState({ record, envImage: 'acme/own:1', base: record.base, specHashOf: () => null }).state, 'detached');
  assert.equal(boxImageState({ record: null, envImage: 'worca-box:abc', base: record.base, specHashOf: () => null }).state, 'detached');
});

test('the .env line: replaced in place, put under its example, appended, or removed; other lines untouched', () => {
  const body = '# a comment\nWORCA_TAG=latest\n#WORCA_IMAGE=worca-box:...\nTZ=UTC\n';
  const set = setDotenvLine(body, 'WORCA_IMAGE', 'worca-box:abc');
  assert.equal(set, '# a comment\nWORCA_TAG=latest\n#WORCA_IMAGE=worca-box:...\nWORCA_IMAGE=worca-box:abc\nTZ=UTC\n');
  assert.equal(setDotenvLine(set, 'WORCA_IMAGE', 'worca-box:def'), set.replace('worca-box:abc', 'worca-box:def'));
  assert.equal(setDotenvLine('A=1\nWORCA_IMAGE=x\nexport WORCA_IMAGE=y\n', 'WORCA_IMAGE', 'z'), 'A=1\nWORCA_IMAGE=z\n', 'duplicates dropped');
  assert.equal(setDotenvLine('A=1\n', 'WORCA_IMAGE', 'z'), 'A=1\nWORCA_IMAGE=z\n');
  assert.equal(setDotenvLine('A=1', 'WORCA_IMAGE', 'z'), 'A=1\nWORCA_IMAGE=z\n');
  assert.equal(setDotenvLine('', 'WORCA_IMAGE', 'z'), 'WORCA_IMAGE=z\n');
  assert.equal(setDotenvLine(set, 'WORCA_IMAGE', null), body, 'removal keeps the commented example');
  assert.equal(setDotenvLine('WORCA_IMAGE_X=1\n', 'WORCA_IMAGE', null), 'WORCA_IMAGE_X=1\n', 'a longer key is another key');
});
