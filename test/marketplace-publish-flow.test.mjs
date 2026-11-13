// test/marketplace-publish-flow.test.mjs
// Export → Worca plugin → Marketplace (#717): the orchestrator against REAL git and local bare
// repositories (the hosted URLs are mapped to them through the `transport` dep). The forge — push
// access, fork, pull request — is scripted. A real git is needed because the subject is the commit,
// the push and the force-with-lease behaviour; an in-process stub of git would test nothing.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { useGitSandbox } from './helpers/metrics-git.mjs';
import { createV2Agent } from './helpers/export-fixtures.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { writeMarketplaces } from '../src/core/marketplaces.mjs';
import { stripHostCredentials } from '../src/core/host-credentials.mjs';
import { exportWorkflowToMarketplace, _testing } from '../src/core/marketplace-publish.mjs';

useTempHome(after);
useGitSandbox(before, after);                                // empty global git config → commits as Worca
const execFileP = promisify(execFile);
const dirs = [];
const tmp = async (p) => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
afterEach(() => _testing.reset());

const git = async (cwd, ...args) => (await execFileP('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd })).stdout.trim();
const HOSTED = 'https://github.com/acme/market.git';
const FORK = 'https://github.com/me/market.git';
const ADO = 'https://dev.azure.com/org/proj/_git/market';      // publishTargetOf's rebuilt Azure clone URL
const BRANCH = 'worca/plugin/shared-flow';
let workflowId, agentMd;

/** Write `files` ({relPath: text}); keys starting with `__` are fixture options, never files. */
async function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    if (rel.startsWith('__')) continue;
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), text);
  }
}
/** A bare "hosted" marketplace on `main` (+ a bare fork of it). `files.__plugins` = the index's list;
 *  `symlinks` = {relPath: absoluteTarget} committed as mode-120000 entries (a hostile marketplace). */
async function makeMarket({ index = true, files = {}, symlinks = {} } = {}) {
  const src = await tmp('mkt-src-');
  await git(src, 'init', '-q', '-b', 'main');
  await writeTree(src, { 'README.md': '# market\n', ...files,
    ...(index ? { 'worca-cc-marketplace.json': JSON.stringify({ name: 'Acme', plugins: files.__plugins || [] }, null, 2) + '\n' } : {}) });
  for (const [rel, target] of Object.entries(symlinks)) {
    await mkdir(dirname(join(src, rel)), { recursive: true });
    await symlink(target, join(src, rel));
  }
  await git(src, 'add', '-A'); await git(src, 'commit', '-qm', 'c1');
  const bare = join(await tmp('mkt-bare-'), 'market.git');
  await git(tmpdir(), 'clone', '-q', '--bare', src, bare);
  const fork = join(await tmp('mkt-fork-'), 'market.git');
  await git(tmpdir(), 'clone', '-q', '--bare', bare, fork);
  return { bare, fork };
}
const remoteTip = async (bare, ref = BRANCH) => (await git(bare, 'ls-remote', bare, `refs/heads/${ref}`)).split(/\s+/)[0] || '';
const showAt = (bare, ref, path) => git(bare, 'show', `${ref}:${path}`);

/** Scripted forge + transport to the local bares. `prs` simulates the open PRs by head. */
function stub({ bare, fork, canPush = true, prs = new Map(), over = {} }) {
  const calls = { createPr: [], editPrBody: [], fork: 0 };
  _testing.setDeps({
    transport: (url) => ({ [HOSTED]: bare, [FORK]: fork, [ADO]: bare })[url] || url,
    gitEnv: async () => ({ env: stripHostCredentials(process.env), error: null }),
    access: async () => ({ ok: true, canPush }),
    fork: async () => { calls.fork += 1; return { ok: true, owner: 'me', repo: 'market', slug: 'me/market' }; },
    providerAvailable: async () => ({ ok: true }),
    createPr: async (o) => {
      calls.createPr.push(o);
      if (prs.has(o.head)) return { ok: true, url: prs.get(o.head), existed: true };
      prs.set(o.head, 'https://github.com/acme/market/pull/1');
      return { ok: true, url: prs.get(o.head), existed: false };
    },
    editPrBody: async (o) => { calls.editPrBody.push(o); return { ok: true }; },
    runCases: async () => ({ scripts: [], passed: 0, failed: 0, unchecked: 0, stopped: false, problems: [] }),
    ...over,
  });
  return calls;
}

before(async () => {
  delete process.env.WORCA_CLONE_ALLOW;                    // an operator's ambient allowlist must not steer the tests (D17)
  // createV2Agent returns only the key (test/helpers/export-fixtures.mjs:92); the .md path is the
  // registry's agentPath — the same file exportWorkflowPlugin copies (workflow-export.mjs:1140).
  const key = await createV2Agent({ key: 'sharedAgent', displayName: 'Shared Agent', description: 'a user agent to bundle',
    runnerType: 'producer', order: 50, markdown: '---\nname: sharedAgent\n---\n# Shared Agent\n' });
  agentMd = loadAgentRegistry()[key].agentPath;           // edited between exports below
  assert.ok(agentMd, 'the fixture agent has an agentPath');
  // Same hand-built graph as test/workflow-export-plugin.test.mjs:53-66 (V2 node ids /^n_[a-z0-9]+$/).
  const tpl = await writeGraphWorkflow({ name: 'Shared Flow', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 100, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 120, y: 100, config: {} },
      { id: 'n_shared', kind: 'agent', key: 'sharedAgent', x: 240, y: 100, config: {} },
      { id: 'n_end', kind: 'end', x: 360, y: 100, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_shared', port: 'task' } },
      { id: 'w3', from: { node: 'n_shared', port: 'out' }, to: { node: 'n_end', port: 'result' } }] });
  workflowId = tpl.id;
  writeMarketplaces({ seededBuiltin: true, marketplaces: {
    acme: { id: 'acme', url: 'https://github.com/acme/market', name: 'Acme', description: '', addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [] },
    loc: { id: 'loc', url: '/srv/market', name: 'Local', description: '', addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [] },
    ado: { id: 'ado', url: 'https://dev.azure.com/org/proj/_git/market', name: 'ADO', description: '', addedAt: new Date().toISOString(), lastSync: null, plugins: [], warnings: [] },
  } });
});

test('writable GitHub marketplace: one PR adding plugins/<name>/ + its index entry; one commit; nothing on main', async () => {
  const { bare, fork } = await makeMarket({ files: { __plugins: ['plugins/other'], 'plugins/other/worca-cc-plugin.json': '{"name":"other","version":"1.0.0"}\n' } });
  const calls = stub({ bare, fork });
  const mainBefore = await remoteTip(bare, 'main');
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme', draft: true, startedBy: 'alice' });
  assert.equal(r.status, 'opened');
  assert.equal(r.prUrl, 'https://github.com/acme/market/pull/1');
  assert.deepEqual([r.name, r.subdir, r.branch, r.base, r.oldVersion, r.newVersion], ['shared-flow', 'plugins/shared-flow', BRANCH, 'main', null, '0.1.0']);
  assert.equal(await remoteTip(bare, 'main'), mainBefore, 'the base branch is never pushed');
  assert.equal(await git(bare, 'rev-list', '--count', `main..${BRANCH}`), '1');
  assert.deepEqual(JSON.parse(await showAt(bare, BRANCH, 'worca-cc-marketplace.json')).plugins, ['plugins/other', 'plugins/shared-flow']);
  assert.equal(JSON.parse(await showAt(bare, BRANCH, 'plugins/shared-flow/worca-cc-plugin.json')).version, '0.1.0');
  assert.match(await showAt(bare, BRANCH, 'plugins/shared-flow/agents/sharedAgent.md'), /Shared Agent/);
  assert.equal(await git(bare, 'log', '-1', '--format=%an', BRANCH), 'Worca');
  const pr = calls.createPr[0];
  assert.deepEqual([pr.base, pr.head, pr.repo, pr.headOwner, pr.draft, pr.title], ['main', BRANCH, 'acme/market', null, true, 'Add plugin shared-flow v0.1.0']);
  assert.match(pr.body, /new, 0\.1\.0/);
  assert.match(pr.body, /\*\*Agents:\*\* `agents\/sharedAgent\.md`/);
  assert.match(pr.body, /Built-in agents\/scripts:\*\* planner/);
  assert.match(pr.body, /adds `plugins\/shared-flow` to `plugins`/);
  assert.match(pr.body, /Started by alice via worca/);
  assert.doesNotMatch(JSON.stringify(r), /worca-mkt-publish-|market\.git/, 'no scratch or local paths leak');
});

test('re-export while the PR is open: unchanged → up-to-date (no push); changed → force-with-lease onto the same branch, PR reused + body refreshed', async () => {
  const { bare, fork } = await makeMarket();
  const prs = new Map();
  stub({ bare, fork, prs });
  await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  const tip1 = await remoteTip(bare);
  let calls = stub({ bare, fork, prs });
  const same = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(same.status, 'up-to-date');
  assert.equal(await remoteTip(bare), tip1);
  assert.equal(calls.editPrBody.length, 0);
  await writeFile(agentMd, '---\nname: sharedAgent\n---\n# Shared Agent v2\n');
  calls = stub({ bare, fork, prs });
  const changed = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(changed.status, 'updated');
  assert.equal(changed.newVersion, '0.1.0', 'still a NEW plugin vs the base: no climb while the PR is open (D3)');
  assert.notEqual(await remoteTip(bare), tip1);
  assert.equal(await git(bare, 'rev-list', '--count', `main..${BRANCH}`), '1', 'still one commit');
  assert.equal(calls.editPrBody.length, 1);
  assert.match(calls.editPrBody[0].body, /Shared Agent|agents\/sharedAgent\.md/);
});

test('after merge: unchanged → "unchanged", no PR; changed → 0.1.0 → 0.1.1 and the stale branch is replaced', async () => {
  const { bare, fork } = await makeMarket();
  const prs = new Map();
  stub({ bare, fork, prs });
  await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  await git(bare, 'update-ref', 'refs/heads/main', await remoteTip(bare));     // "merge" (fast-forward)
  prs.clear();                                                                  // the PR is merged, not open
  let calls = stub({ bare, fork, prs });
  const none = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(none.status, 'unchanged');
  assert.equal(none.prUrl, null);
  assert.equal(calls.createPr.length, 0);
  await writeFile(agentMd, '---\nname: sharedAgent\n---\n# Shared Agent v3\n');
  calls = stub({ bare, fork, prs });
  const upd = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(upd.status, 'opened');
  assert.deepEqual([upd.oldVersion, upd.newVersion], ['0.1.0', '0.1.1']);
  assert.equal(calls.createPr[0].title, 'Update plugin shared-flow 0.1.0 → 0.1.1');
  assert.match(calls.createPr[0].body, /0\.1\.0 → 0\.1\.1/);
  assert.equal(await git(bare, 'rev-list', '--count', `main..${BRANCH}`), '1');
});

test('no push access → fork; the PR is cross-repo and NOTHING is pushed to the marketplace', async () => {
  const { bare, fork } = await makeMarket();
  const calls = stub({ bare, fork, canPush: false });
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(calls.fork, 1);
  assert.equal(r.pushTo, 'fork');
  assert.deepEqual(r.fork, { repo: 'me/market' });
  assert.equal(await remoteTip(bare), '', 'no branch on the marketplace');
  assert.notEqual(await remoteTip(fork), '');
  assert.equal(calls.createPr[0].headOwner, 'me');
  assert.equal(calls.createPr[0].repo, 'acme/market');
});

test('unknown access (App token) + a refused push → falls back to the fork once', async () => {
  const { bare, fork } = await makeMarket();
  const realGit = _testing.defaultGit;
  const calls = stub({ bare, fork, canPush: null, over: {
    git: (cwd, args, o) => (args.includes('push') && args.includes(bare)
      ? Promise.resolve({ ok: false, code: 128, stdout: '', stderr: 'remote: Permission to acme/market.git denied to bot.\nfatal: unable to access \'https://github.com/acme/market.git/\': The requested URL returned error: 403' })
      : realGit(cwd, args, o)),
  } });
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(r.pushTo, 'fork');
  assert.equal(calls.fork, 1);
  assert.equal(await remoteTip(bare), '');
});

test('no index → placed at <name>/ in the root, no index file created', async () => {
  const { bare, fork } = await makeMarket({ index: false });
  stub({ bare, fork });
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(r.subdir, 'shared-flow');
  assert.deepEqual(r.index, { present: false, added: false });
  await assert.rejects(showAt(bare, BRANCH, 'worca-cc-marketplace.json'));
  assert.equal(JSON.parse(await showAt(bare, BRANCH, 'shared-flow/worca-cc-plugin.json')).name, 'shared-flow');
});

test('a plugin the marketplace lists in another folder is updated there in place: the index is untouched and the PR is an update', async () => {
  const { bare, fork } = await makeMarket({ files: { __plugins: ['tools/shared-flow'], 'tools/shared-flow/worca-cc-plugin.json': '{"name":"shared-flow","version":"1.0.0"}\n' } });
  const calls = stub({ bare, fork });
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(r.status, 'opened');
  assert.deepEqual([r.subdir, r.update, r.oldVersion, r.newVersion], ['tools/shared-flow', true, '1.0.0', '1.0.1']);
  assert.deepEqual(r.index, { present: true, added: false }, 'the existing index entry is kept, never duplicated');
  assert.deepEqual(JSON.parse(await showAt(bare, BRANCH, 'worca-cc-marketplace.json')).plugins, ['tools/shared-flow']);
  assert.equal(JSON.parse(await showAt(bare, BRANCH, 'tools/shared-flow/worca-cc-plugin.json')).version, '1.0.1');
  assert.match(await showAt(bare, BRANCH, 'tools/shared-flow/agents/sharedAgent.md'), /Shared Agent/);
  await assert.rejects(showAt(bare, BRANCH, 'plugins/shared-flow/worca-cc-plugin.json'), 'nothing lands at the default folder');
  const changed = (await git(bare, 'diff', '--name-only', `main..${BRANCH}`)).split('\n').filter(Boolean);
  assert.ok(changed.length > 0 && changed.every((p) => p.startsWith('tools/shared-flow/')), changed.join(', '));
  assert.equal(r.validation.discovery, 'finds shared-flow v1.0.1 at tools/shared-flow/');
  const pr = calls.createPr[0];
  assert.equal(pr.title, 'Update plugin shared-flow 1.0.0 → 1.0.1');
  assert.match(pr.body, /\*\*Folder:\*\* `tools\/shared-flow\/`/);
  assert.match(pr.body, /1\.0\.0 → 1\.0\.1/);
  assert.doesNotMatch(pr.body, /## Marketplace index/);
});

test('name clash / failed validation / discovery missing / ignored files → nothing is pushed, the error says why', async () => {
  const cases = [
    // a marketplace that IS one plugin (no index, the manifest at its root): exporting into the root would rewrite the repository
    { name: 'same name at the repository root', index: false, files: { 'worca-cc-plugin.json': '{"name":"shared-flow","version":"1.0.0"}\n' }, code: 'CONFLICT', re: /already lives at the repository root/ },
    { name: 'folder holds another plugin', files: { __plugins: [], 'plugins/shared-flow/worca-cc-plugin.json': '{"name":"other","version":"1.0.0"}\n' }, code: 'CONFLICT', re: /holds plugin "other"/ },
    { name: 'shipped script case fails', files: {}, over: { runCases: async () => ({ scripts: [{ key: 's', cases: [{ caseId: 'c1', name: 'c1', pass: false, diffs: ['exit 1 ≠ 0'] }] }], passed: 0, failed: 1, unchecked: 0, stopped: false, problems: [] }) }, code: 'VALIDATION_FAILED', re: /script cases failed/ },
    { name: 'existing plugin manifest does not validate', files: { __plugins: ['plugins/shared-flow'], 'plugins/shared-flow/worca-cc-plugin.json': '{"name":"shared-flow","version":"1.0.0","taskSources":"nope"}\n' }, code: 'VALIDATION_FAILED', re: /does not validate/ },
    { name: 'version not plain x.y.z', files: { __plugins: ['plugins/shared-flow'], 'plugins/shared-flow/worca-cc-plugin.json': '{"name":"shared-flow","version":"1.0.0-beta"}\n' }, code: 'VALIDATION_FAILED', re: /was not bumped/ },
    { name: '.gitignore drops plugin files', files: { '.gitignore': 'plugins/shared-flow/agents/\n' }, code: 'VALIDATION_FAILED', re: /\.gitignore drops/ },
    { name: 'discovery does not find it', files: {}, over: { discover: (() => { let n = 0; return async () => (++n === 1 ? { sha: 'x', discovered: [], warnings: [], marketplace: { name: 'Acme', description: '' } } : { sha: 'y', discovered: [], warnings: ['plugins/shared-flow/worca-cc-plugin.json: engines mismatch'], marketplace: null }); })() }, code: 'DISCOVERY_FAILED', re: /discovery does not find plugin "shared-flow".*engines mismatch/ },
  ];
  for (const c of cases) {
    const { bare, fork } = await makeMarket({ files: c.files, index: c.index !== false });
    const calls = stub({ bare, fork, over: c.over || {} });
    await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' }), (e) => e.code === c.code && c.re.test(e.message), c.name);
    assert.equal(await remoteTip(bare), '', `${c.name}: nothing pushed`);
    assert.equal(calls.createPr.length, 0, `${c.name}: no PR`);
  }
});

test('a committed symlink on the write path → MARKETPLACE_INVALID before any write; nothing lands outside the clone, nothing is pushed', async () => {
  const idxJson = JSON.stringify({ name: 'Elsewhere', plugins: [] }) + '\n';
  const mkOutside = async (files = {}) => {
    const out = await tmp('mkt-outside-');
    for (const [rel, text] of Object.entries(files)) await writeFile(join(out, rel), text);
    return out;
  };
  const cases = [
    { name: 'plugins -> outside (an ancestor of the plugin folder)', re: /plugins is a symbolic link/,
      market: async (out) => ({ symlinks: { plugins: out } }) },
    { name: 'no index: <name> -> outside (the plugin folder itself)', re: /shared-flow is a symbolic link/,
      market: async (out) => ({ index: false, symlinks: { 'shared-flow': out } }) },
    { name: 'worca-cc-marketplace.json -> outside (the index is read and rewritten through it)', re: /worca-cc-marketplace\.json is a symbolic link/, outsideFiles: { 'index.json': idxJson },
      market: async (out) => ({ index: false, symlinks: { 'worca-cc-marketplace.json': join(out, 'index.json') } }) },
    { name: 'update: plugins/shared-flow/agents -> outside (inside an existing plugin folder)', re: /plugins\/shared-flow\/agents is a symbolic link/,
      market: async (out) => ({ files: { __plugins: ['plugins/shared-flow'], 'plugins/shared-flow/worca-cc-plugin.json': '{"name":"shared-flow","version":"1.0.0"}\n' }, symlinks: { 'plugins/shared-flow/agents': out } }) },
  ];
  for (const c of cases) {
    const out = await mkOutside(c.outsideFiles);
    const { bare, fork } = await makeMarket(await c.market(out));
    const calls = stub({ bare, fork });
    await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' }),
      (e) => e.code === 'MARKETPLACE_INVALID' && c.re.test(e.message) && !/worca-mkt-publish-/.test(e.message), c.name);
    assert.deepEqual((await readdir(out)).sort(), Object.keys(c.outsideFiles || {}), `${c.name}: nothing written outside the clone`);
    if (c.outsideFiles) assert.equal(await readFile(join(out, 'index.json'), 'utf8'), idxJson, `${c.name}: the target file is untouched`);
    assert.equal(await remoteTip(bare), '', `${c.name}: nothing pushed`);
    assert.equal(calls.createPr.length, 0, `${c.name}: no PR`);
  }
});

test('a symlink elsewhere in the marketplace is carried over untouched: the commit adds only the plugin and its index entry', async () => {
  const out = await tmp('mkt-outside-');
  const { bare, fork } = await makeMarket({ symlinks: { 'docs/link': out } });
  stub({ bare, fork });
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' });
  assert.equal(r.status, 'opened');
  assert.deepEqual(await readdir(out), []);
  assert.match(await git(bare, 'ls-tree', BRANCH, 'docs/link'), /^120000 blob /, 'still a symlink on the PR branch');
  const changed = (await git(bare, 'diff', '--name-only', `main..${BRANCH}`)).split('\n');
  assert.ok(changed.every((p) => p === 'worca-cc-marketplace.json' || p.startsWith('plugins/shared-flow/')), changed.join(', '));
});

test('a credential in a plugin file → VALIDATION_FAILED naming the file, never the value; nothing pushed (D15)', async () => {
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(agentMd, 'utf8');
  const live = 'live-push-credential-0123456789abcdef';
  try {
    // 1. a token shape
    await writeFile(agentMd, `${original}\nexport GH_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345\n`);
    let { bare, fork } = await makeMarket();
    let calls = stub({ bare, fork });
    await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' }),
      (e) => e.code === 'VALIDATION_FAILED' && /plugins\/shared-flow\/agents\/sharedAgent\.md/.test(e.message)
        && /token-shaped/.test(e.message) && !/ghp_/.test(e.message));
    assert.equal(await remoteTip(bare), '');
    assert.equal(calls.createPr.length, 0);
    // 2. the exact value of the credential this export uses (no known shape)
    await writeFile(agentMd, `${original}\nsecret: ${live}\n`);
    ({ bare, fork } = await makeMarket());
    calls = stub({ bare, fork, over: { gitEnv: async () => ({ env: { ...stripHostCredentials(process.env), WORCA_GIT_TOKEN: live }, error: null }) } });
    await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' }),
      (e) => e.code === 'VALIDATION_FAILED' && /a credential this Worca uses/.test(e.message) && !e.message.includes(live));
    assert.equal(await remoteTip(bare), '');
  } finally {
    await writeFile(agentMd, original);
  }
});

test('Azure DevOps marketplace without push access → FORK_FAILED, nothing pushed', async () => {
  // Production's path: Azure access is always unknown (DEFAULT_DEPS.access → canPush:null), the push
  // is refused with a 403 (TF401027), and the fork fallback refuses for Azure (D5).
  const { bare, fork } = await makeMarket();
  const realGit = _testing.defaultGit;
  const calls = stub({ bare, fork, canPush: null, over: {
    git: (cwd, args, o) => (args.includes('push') && args.includes(bare)
      ? Promise.resolve({ ok: false, code: 128, stdout: '', stderr: "remote: TF401027: You need the Git 'GenericContribute' permission to perform this action.\nfatal: unable to access 'https://dev.azure.com/org/proj/_git/market/': The requested URL returned error: 403" })
      : realGit(cwd, args, o)),
  } });
  await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'ado' }),
    (e) => e.code === 'FORK_FAILED' && /Azure DevOps pull requests cannot come from a fork/.test(e.message));
  assert.equal(calls.fork, 0, 'Azure never forks');
  assert.equal(await remoteTip(bare), '');
  assert.equal(calls.createPr.length, 0);
});

test('dry run: files, index change and PR body — no fork, no push, no PR', async () => {
  const { bare, fork } = await makeMarket();
  const calls = stub({ bare, fork, canPush: false });
  const r = await exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme', dryRun: true });
  assert.equal(r.status, 'dry-run');
  assert.equal(r.pushTo, 'fork');
  assert.ok(r.files.created.includes('plugins/shared-flow/worca-cc-plugin.json'));
  assert.deepEqual(r.index, { present: true, added: true });
  assert.match(r.body, /## Validation/);
  assert.equal(calls.fork, 0);
  assert.equal(calls.createPr.length, 0);
  assert.equal(await remoteTip(bare), '');
  assert.equal(await remoteTip(fork), '');
});

test('target errors: unknown marketplace NOT_FOUND; local marketplace UNSUPPORTED; outside WORCA_CLONE_ALLOW UNSUPPORTED', async () => {
  await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'nope' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'loc' }), (e) => e.code === 'UNSUPPORTED' && /not a GitHub or Azure DevOps/.test(e.message));
  process.env.WORCA_CLONE_ALLOW = 'github.com/someone-else/*';
  try {
    const calls = stub({ bare: '/nonexistent', fork: '/nonexistent' });
    await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' }),
      (e) => e.code === 'UNSUPPORTED' && /github\.com\/acme\/market is not in WORCA_CLONE_ALLOW/.test(e.message));
    assert.equal(calls.createPr.length, 0);
  } finally { delete process.env.WORCA_CLONE_ALLOW; }
});

test('credentials never surface: a token in git/gh stderr is scrubbed from the error', async () => {
  const { bare, fork } = await makeMarket();
  stub({ bare, fork, over: { createPr: async () => ({ ok: false, error: 'HTTP 401 for https://x-access-token:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345@github.com/acme/market' }) } });
  await assert.rejects(exportWorkflowToMarketplace({ workflowId, marketplaceId: 'acme' }), (e) => e.code === 'PR_FAILED' && !/ghp_|x-access-token:/.test(e.message));
});

test('D17: use reaches the plugin build — version 1 bundles the agent the draft dropped; the draft (default) does not', async () => {
  const { createVersion } = await import('../src/core/workflow-versions.mjs');
  const node = (id, kind, key, x) => ({ id, kind, ...(key ? { key } : {}), x, y: 100, config: {} });
  const w = (id, a, ap, b, bp) => ({ id, from: { node: a, port: ap }, to: { node: b, port: bp } });
  const v1 = await writeGraphWorkflow({ name: 'Versioned Flow', domain: 'coding',
    nodes: [node('n_task', 'task', null, 0), node('n_plan', 'agent', 'planner', 120), node('n_shared', 'agent', 'sharedAgent', 240), node('n_end', 'end', null, 360)],
    wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_shared', 'task'), w('w3', 'n_shared', 'out', 'n_end', 'result')] });
  await createVersion(v1.id);
  // The draft drops the user agent and is renamed: the plugin (its name, its PR branch) stays the workflow's.
  await writeGraphWorkflow({ id: v1.id, name: 'Renamed Flow', domain: 'coding',
    nodes: [node('n_task', 'task', null, 0), node('n_plan', 'agent', 'planner', 120), node('n_end', 'end', null, 360)],
    wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_end', 'result')] });
  const AGENT = 'plugins/versioned-flow/agents/sharedAgent.md';
  const dry = async (extra) => {
    const { bare, fork } = await makeMarket();
    stub({ bare, fork });
    return exportWorkflowToMarketplace({ workflowId: v1.id, marketplaceId: 'acme', pluginName: 'versioned-flow', dryRun: true, ...extra });
  };
  assert.ok((await dry({ use: 1 })).files.created.includes(AGENT), 'version 1 has the user agent');
  assert.equal((await dry({})).files.created.includes(AGENT), false, 'the draft no longer has it');
  for (const use of ['abc', 'live']) await assert.rejects(dry({ use }), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(dry({ use: 7 }), (e) => e.code === 'NOT_FOUND');
  for (const use of [1, 'draft']) {
    const r = await dry({ use, pluginName: undefined });
    assert.deepEqual([r.name, r.branch], ['renamed-flow', 'worca/plugin/renamed-flow'], `use ${use}: named after the workflow, never the version`);
  }
});
