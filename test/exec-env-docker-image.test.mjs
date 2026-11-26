// test/exec-env-docker-image.test.mjs — the Local sandbox (Docker) image (docker/local-sandbox/sandbox.Dockerfile and
// backends/docker-image.mjs): pinned, single stage, the sandbox user made here, no sudo at all, and shipped in the package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSandboxDockerfile, renderSandboxProjectDockerfile, dockerBaseVersion, defaultImageName, projectImageName, isImageRef,
  SANDBOX_DOCKERFILE } from '../src/core/exec-env/backends/docker-image.mjs';
import { pinnedClaudeCodeVersion, pinnedEngineClis, MISE_VERSION } from '../src/core/exec-env/backends/e2b-template.mjs';
import { normalizeEnvSpec } from '../src/core/exec-env/env-spec.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the default image pins Claude Code and the engine CLIs, by digest, in one stage with no build context', () => {
  const df = renderSandboxDockerfile();
  const v = pinnedClaudeCodeVersion(); const clis = pinnedEngineClis();
  assert.ok(df.includes(`@anthropic-ai/claude-code@${v}`));
  assert.ok(df.includes(`@openai/codex@${clis.codex}`) && df.includes(`@github/copilot@${clis.copilot}`) && df.includes(`/lab/${clis.cursor}/linux/`));
  assert.doesNotMatch(df, /__[A-Z_]+_VERSION__/);
  assert.equal(df.match(/^FROM /gm).length, 1);
  assert.match(df, /^FROM node:22-bookworm@sha256:[0-9a-f]{64}$/m);
  assert.doesNotMatch(df, /^\s*(COPY|ADD)\b/m, 'built from stdin: nothing to copy');
});

test('no sudo: not installed, no sudoers file, no passwordless rule; the image makes `user` (1000) and `worca` (990)', () => {
  const df = renderSandboxDockerfile();
  const instructions = df.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(instructions, /sudoers|NOPASSWD/);
  assert.doesNotMatch(instructions, /install[^\n]*\bsudo\b/, 'sudo is not in the apt list');
  assert.match(instructions, /! command -v sudo/, 'the build fails if sudo is present');
  assert.match(instructions, /usermod -l user -d \/home\/user -m node/);
  assert.match(instructions, /useradd --system --uid 990 --gid 990 [^\n]*--shell \/usr\/sbin\/nologin worca/);
  assert.match(instructions, /install -d -o worca -g worca -m 0755 \/run\/worca/);
  assert.match(instructions, /^USER user$/m);
});

test('a project image is the default plus apt and pinned mise tools, still one stage', () => {
  const spec = normalizeEnvSpec({ tools: [{ name: 'node', version: '24.21.0' }], apt: ['libpq-dev'] });
  const df = renderSandboxProjectDockerfile(spec);
  assert.equal(df.match(/^FROM /gm).length, 1);
  assert.match(df, /apt-get install -y --no-install-recommends 'libpq-dev'/);
  assert.match(df, /mise use --global 'node@24\.21\.0'/);
  assert.match(df, new RegExp(`# worca: project environment ${spec.hash}`));
  assert.match(df, /USER user\nWORKDIR \/home\/user\n$/);
});

test('names and the base version: a moved pin or base instruction names a new default image; comments do not', () => {
  const base = dockerBaseVersion();
  assert.match(base, new RegExp(`^claude-code@${pinnedClaudeCodeVersion().replaceAll('.', '\\.')}\\+codex@.*\\+local-sandbox@[0-9a-f]{12}\\+mise@${MISE_VERSION.replaceAll('.', '\\.')}$`));
  assert.match(defaultImageName(), /^worca-local-sandbox:[0-9a-f]{12}$/);
  assert.notEqual(defaultImageName(dockerBaseVersion({ text: 'FROM x\n' })), defaultImageName());
  assert.equal(dockerBaseVersion({ text: '# a\nFROM x\n\nRUN y\n' }), dockerBaseVersion({ text: 'FROM x\nRUN y\n' }));
  assert.equal(projectImageName('acme-12345678'), 'worca-local-sandbox-acme-12345678');
  assert.ok(isImageRef(defaultImageName()) && isImageRef(projectImageName('acme-12345678')));
});

test('the files a first-use build needs ship in the package', () => {
  for (const f of ['docker/local-sandbox/sandbox.Dockerfile', 'docker/e2b/engine-clis.json', 'docker/CLAUDE_CODE_VERSION']) assert.ok(pkg.files.includes(f), f);
  assert.ok(SANDBOX_DOCKERFILE.endsWith('docker/local-sandbox/sandbox.Dockerfile'));
  assert.ok(pkg.files.includes('src/'), 'the relay scripts ship under src/');
});
