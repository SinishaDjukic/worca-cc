// test/e2b-template.test.mjs
// docker/e2b/: the E2B sandbox template (pinned Claude Code, single stage) and its API build — no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplateDockerfile, parseArgs, buildTemplate } from '../docker/e2b/build.mjs';
import { pinnedClaudeCodeVersion } from '../tools/docker-build.mjs';
import { renderProjectDockerfile, e2bBaseVersion, MISE_VERSION, MISE_SHA256 } from '../src/core/exec-env/backends/e2b-template.mjs';
import { e2bClient } from '../src/core/exec-env/backends/e2b.mjs';
import { normalizeEnvSpec } from '../src/core/exec-env/env-spec.mjs';
import { e2bEnvironmentName, TEMPLATE_RE } from '../src/core/exec-env/backends/e2b.mjs';
test('the template pins docker/CLAUDE_CODE_VERSION and stays single-stage', () => {
  const v = pinnedClaudeCodeVersion();
  const df = renderTemplateDockerfile(v);
  assert.match(df, new RegExp(`@anthropic-ai/claude-code@${v.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(df, /__CLAUDE_CODE_VERSION__/);
  assert.equal(df.match(/^FROM /gm).length, 1);
  assert.throws(() => renderTemplateDockerfile('latest'), /not a pinned version/);
});
test('parseArgs defaults to 2 vCPU / 4096 MB / worca-agent', () => {
  assert.deepEqual(parseArgs([]), { name: 'worca-agent', cpuCount: 2, memoryMB: 4096, skipCache: false });
  assert.throws(() => parseArgs(['--memory-mb', '4095']), /even/);
});
test('buildTemplate calls Template.build through the SDK (no network)', async () => {
  const calls = [];
  const Template = Object.assign(() => ({ fromDockerfile: (c) => ({ dockerfile: c }) }), { build: async (t, name, o) => { calls.push({ t, name, o }); return { templateId: 't1', buildId: 'b1', name }; } });
  const r = await buildTemplate({ sdk: { Template }, name: 'worca-agent', cpuCount: 2, memoryMB: 4096, conn: { apiKey: 'k', apiUrl: 'http://h:3000' }, log: () => {} });
  assert.equal(r.templateId, 't1');
  assert.equal(calls[0].o.apiUrl, 'http://h:3000'); assert.equal(calls[0].o.cpuCount, 2);
});
test('the rendered Dockerfile has nothing the E2B converter ignores or refuses', () => {
  const df = renderTemplateDockerfile(pinnedClaudeCodeVersion());
  assert.doesNotMatch(df, /^SHELL /m);
  assert.doesNotMatch(df, /^\s*COPY\s+--from/m);
});
test('the template keeps the user E2B builds and only adds sudo and git config', () => {
  const df = renderTemplateDockerfile(pinnedClaudeCodeVersion());
  assert.doesNotMatch(df, /\busermod\b|\bgroupmod\b/);
  assert.match(df, /NOPASSWD: ALL\\n' > \/etc\/sudoers\.d\/user/);
  assert.match(df, /git config --system --add safe\.directory '\*'/);
  assert.match(df, /^USER user$/m);
});

const SPEC = normalizeEnvSpec({ tools: [{ name: 'npm:prettier', version: '3.9.10' }, { name: 'node', version: '24.21.0' }], apt: ['libpq-dev'] });

test('a project template is worca-agent + apt + mise tools, still single-stage and converter-safe', () => {
  const df = renderProjectDockerfile(SPEC, { version: pinnedClaudeCodeVersion() });
  assert.equal(df.match(/^FROM /gm).length, 1);
  assert.doesNotMatch(df, /^SHELL /m); assert.doesNotMatch(df, /^\s*COPY\s+--from/m);
  assert.match(df, /apt-get install -y --no-install-recommends 'libpq-dev'/);
  assert.match(df, new RegExp(`mise-v${MISE_VERSION.replaceAll('.', '\\.')}-linux-`), 'mise at the pinned version');
  assert.match(df, /mise use --global 'node@24\.21\.0' 'npm:prettier@3\.9\.10'/);
  assert.match(df, /export MISE_DATA_DIR=\/opt\/mise MISE_CONFIG_DIR=\/opt\/mise\/config PATH="\/opt\/mise\/shims:\$PATH"\\n' > \/etc\/profile\.d\/mise\.sh/);
  assert.match(df, /USER user\nWORKDIR \/home\/user\n$/);
  assert.match(df, new RegExp(`# worca: project environment ${SPEC.hash}`));
});
test('supply chain: the base image is pinned by digest, and mise is a release binary checked against its SHA-256', () => {
  const df = renderProjectDockerfile(normalizeEnvSpec({ tools: [{ name: 'node', version: '24.21.0' }] }), { version: pinnedClaudeCodeVersion() });
  assert.match(df, /^FROM node:22-bookworm@sha256:[0-9a-f]{64}$/m);
  assert.doesNotMatch(df, /mise\.run|\| *sh\b|\| *bash\b/, 'no install script piped into a shell');
  for (const sum of Object.values(MISE_SHA256)) assert.match(sum, /^[0-9a-f]{64}$/);
  assert.match(df, new RegExp(`releases/download/v${MISE_VERSION.replaceAll('.', '\\.')}/mise-v${MISE_VERSION.replaceAll('.', '\\.')}-linux-\\$a`));
  assert.match(df, /sha256sum -c -/);
  assert.ok(df.includes(MISE_SHA256.x64) && df.includes(MISE_SHA256.arm64));
});
test('an empty spec adds no tool layer', () => {
  const df = renderProjectDockerfile(normalizeEnvSpec({}), { version: pinnedClaudeCodeVersion() });
  assert.doesNotMatch(df, /mise/); assert.doesNotMatch(df, /apt-get install -y --no-install-recommends '/);
});
test('the base version names the pinned Claude Code, the base Dockerfile and mise', () => {
  assert.match(e2bBaseVersion(), new RegExp(`^claude-code@${pinnedClaudeCodeVersion().replaceAll('.', '\\.')}\\+worca-agent@[0-9a-f]{12}\\+mise@`));
  assert.notEqual(e2bBaseVersion({ text: 'FROM x\n' }), e2bBaseVersion());
  assert.equal(e2bBaseVersion({ text: '# a\nFROM x\n\n# b\nRUN y\n' }), e2bBaseVersion({ text: 'FROM x\nRUN y\n' }), 'comments do not count');
});
test('buildEnvironment builds the rendered Dockerfile under the given name and reports the record (no network)', async () => {
  const calls = [];
  const Template = Object.assign(() => ({ fromDockerfile: (c) => ({ dockerfile: c }) }),
    { build: async (t, name, o) => { calls.push({ t, name, o }); o.onBuildLogs({ message: 'step 1' }); return { templateId: 't9', buildId: 'b9', name }; } });
  const lines = [];
  const r = await e2bClient({ Template }, { opts: { apiKey: 'k' }, keyHint: '…' }).buildEnvironment(SPEC, { name: 'worca-agent-p-12345678', onLog: (l) => lines.push(l) });
  assert.deepEqual(r, { name: 'worca-agent-p-12345678', id: 't9', buildId: 'b9', specHash: SPEC.hash, baseVersion: e2bBaseVersion() });
  assert.match(calls[0].t.dockerfile, /mise use --global/);
  assert.equal(calls[0].o.apiKey, 'k'); assert.equal(lines.at(-1), 'step 1');
  assert.deepEqual([calls[0].o.cpuCount, calls[0].o.memoryMB], [2, 4096], 'no template API to read the base size: the defaults');
});
test('buildEnvironment sizes the project template like the base template on this server (GET /templates)', async () => {
  const calls = []; const gets = [];
  const Template = Object.assign(() => ({ fromDockerfile: (c) => ({ dockerfile: c }) }),
    { build: async (t, name, o) => { calls.push(o); return { templateId: 't9', buildId: 'b9', name }; } });
  const sdkWith = (templates) => ({ Template,
    ConnectionConfig: class { constructor(o) { this.o = o; } },
    ApiClient: class { constructor(config) { this.api = { GET: async (path) => { gets.push({ path, config: config.o });
      if (templates instanceof Error) throw templates;
      return { data: templates, response: { status: 200 } }; } }; } } });
  const conn = { opts: { apiKey: 'k', apiUrl: 'http://h:3000' }, template: 'worca-agent', keyHint: '…' };
  const lines = [];
  const build = (sdk, c = conn) => e2bClient(sdk, c).buildEnvironment(SPEC, { name: 'worca-agent-p-12345678', onLog: (l) => lines.push(l) });
  await build(sdkWith([{ aliases: ['other'], names: ['other'], cpuCount: 8, memoryMB: 16384 },
    { aliases: ['worca-agent'], names: ['team/worca-agent'], cpuCount: 4, memoryMB: 4096 }]));
  assert.equal(gets[0].path, '/templates'); assert.equal(gets[0].config.apiUrl, 'http://h:3000'); assert.equal(gets[0].config.apiKey, 'k');
  assert.deepEqual([calls[0].cpuCount, calls[0].memoryMB], [4, 4096]);
  assert.ok(lines.includes('sized like worca-agent on this server: 4 vCPU, 4096 MB'), lines.join('\n'));
  // WORCA_E2B_TEMPLATE names the base (conn.template, as docker/e2b/build.mjs --name), matched by its namespaced name too.
  await build(sdkWith([{ aliases: [], names: ['team/big-agent'], cpuCount: 8, memoryMB: 8192 }]), { ...conn, template: 'big-agent:v2' });
  assert.deepEqual([calls[1].cpuCount, calls[1].memoryMB], [8, 8192]);
  lines.length = 0;
  await build(sdkWith([]));
  assert.deepEqual([calls[2].cpuCount, calls[2].memoryMB], [2, 4096]);
  assert.match(lines[0], /^worca-agent is not on this server; using 2 vCPU, 4096 MB$/);
  lines.length = 0;
  await build(sdkWith(new Error('listing refused')));
  assert.deepEqual([calls[3].cpuCount, calls[3].memoryMB], [2, 4096]);
  assert.match(lines[0], /^could not read worca-agent's size \(listing refused\); using 2 vCPU, 4096 MB$/);
});
test('a project template name is worca-agent-<key>, cut to 63 chars keeping the key hash', () => {
  assert.equal(e2bEnvironmentName('worca-cc-ace1a602'), 'worca-agent-worca-cc-ace1a602');
  const long = `${'a'.repeat(80)}-1234abcd`;
  const name = e2bEnvironmentName(long);
  assert.equal(name.length, 63); assert.ok(name.endsWith('-1234abcd')); assert.match(name, TEMPLATE_RE);
});
