// test/marketplace-publish.test.mjs
// Export → Worca plugin → Marketplace (#717): the PURE helpers of src/core/marketplace-publish.mjs —
// target classification, placement, index edit, PR text and the credential scan. No git, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  publishTargetOf, publishRefusal, listPublishTargets, derivePluginName, pluginBranchName, pluginSubdir,
  placePlugin, placementSubdir, parseLsTree, assertNoSymlinkOnPath, addToIndex, buildPrTitle, buildPrBody, describeVersion, findCredentialLeaks,
} from '../src/core/marketplace-publish.mjs';

useTempHome(after);

test('publishTargetOf: github.com and Azure DevOps only; clone URL rebuilt without userinfo', async () => {
  await checkRows([
    { name: 'https github', run: () => {
      const t = publishTargetOf({ id: 'm1', name: 'Acme', url: 'https://github.com/acme/market' });
      assert.equal(t.forge, 'github');
      assert.equal(t.slug, 'acme/market');
      assert.equal(t.cloneUrl, 'https://github.com/acme/market.git');
      assert.equal(t.ref, null);
    } },
    { name: 'scp-style + tracked ref', run: () => {
      const t = publishTargetOf({ id: 'm2', url: 'git@github.com:acme/market.git', ref: 'dev' });
      assert.equal(t.cloneUrl, 'https://github.com/acme/market.git');
      assert.equal(t.ref, 'dev');
      assert.equal(t.name, 'm2');
    } },
    { name: 'userinfo never survives', run: () => {
      const t = publishTargetOf({ id: 'm3', url: 'https://bot:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/market' });
      assert.equal(t.cloneUrl, 'https://github.com/acme/market.git');
      assert.doesNotMatch(JSON.stringify(t), /ghp_|bot:/);
    } },
    { name: 'azure', run: () => {
      const t = publishTargetOf({ id: 'm4', url: 'https://dev.azure.com/org/My%20Proj/_git/market' });
      assert.equal(t.forge, 'azure');
      // parseAzurePath percent-DECODES names (src/shared/azure-remote.mjs build) → re-encoded once here
      assert.equal(t.cloneUrl, 'https://dev.azure.com/org/My%20Proj/_git/market');
    } },
    { name: 'local path / file:// / GHE → null', run: () => {
      assert.equal(publishTargetOf({ id: 'a', url: '/srv/market' }), null);
      assert.equal(publishTargetOf({ id: 'b', url: 'file:///srv/market' }), null);
      assert.equal(publishTargetOf({ id: 'c', url: 'https://ghe.example.com/acme/market' }), null);
    } },
  ]);
});

test('listPublishTargets: splits targets from the rest, with a reason', () => {
  const r = listPublishTargets([
    { id: 'gh', name: 'Acme', url: 'https://github.com/acme/market', ref: 'dev' },
    { id: 'loc', name: 'Local', url: '/srv/market' },
  ], { env: {} });
  assert.deepEqual(r.targets, [{ id: 'gh', name: 'Acme', forge: 'github', label: 'GitHub', repo: 'acme/market', ref: 'dev', url: 'https://github.com/acme/market' }]);
  assert.deepEqual(r.skipped, [{ id: 'loc', name: 'Local', reason: 'not a GitHub or Azure DevOps repository' }]);
});

test('publishRefusal: WORCA_CLONE_ALLOW scopes the targets on a hosted Worca (D17)', async () => {
  const gh = { id: 'gh', url: 'https://github.com/acme/market' };
  const other = { id: 'o', url: 'https://github.com/someone/market' };
  const ado = { id: 'a', url: 'https://dev.azure.com/org/My%20Proj/_git/market' };
  await checkRows([
    { name: 'unset → any', run: () => assert.equal(publishRefusal(other, { env: {} }), null) },
    { name: 'inside the allowlist', run: () => assert.equal(publishRefusal(gh, { env: { WORCA_CLONE_ALLOW: 'github.com/acme/*' } }), null) },
    { name: 'outside → reason', run: () => assert.equal(publishRefusal(other, { env: { WORCA_CLONE_ALLOW: 'github.com/acme/*' } }), 'github.com/someone/market is not in WORCA_CLONE_ALLOW') },
    { name: 'azure: owner is org/project (decoded)', run: () => assert.equal(publishRefusal(ado, { env: { WORCA_CLONE_ALLOW: 'dev.azure.com/org/My%20Proj/*' } }), null) },
    { name: 'not a forge', run: () => assert.equal(publishRefusal({ id: 'l', url: '/srv/m' }, { env: {} }), 'not a GitHub or Azure DevOps repository') },
    { name: 'listPublishTargets skips it with the reason', run: () => {
      const r = listPublishTargets([gh, other], { env: { WORCA_CLONE_ALLOW: 'github.com/acme/*' } });
      assert.deepEqual(r.targets.map((t) => t.id), ['gh']);
      assert.deepEqual(r.skipped, [{ id: 'o', name: 'o', reason: 'github.com/someone/market is not in WORCA_CLONE_ALLOW' }]);
    } },
  ]);
});

test('names, branch and folder', () => {
  assert.equal(derivePluginName('Shared Flow!'), 'shared-flow');
  assert.equal(derivePluginName('2fa'), '');            // must start with a letter (PLUGIN_NAME_RE)
  assert.equal(derivePluginName(''), '');
  assert.equal(pluginBranchName('shared-flow'), 'worca/plugin/shared-flow');
  assert.equal(pluginSubdir('x', true), 'plugins/x');
  assert.equal(pluginSubdir('x', false), 'x');
});

test('placePlugin: new, update, and every conflict', async () => {
  const idx = { present: true, ok: true };
  await checkRows([
    { name: 'new plugin', run: () => {
      assert.deepEqual(placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['README.md'], index: idx, discovered: [], folderManifestName: null }),
        { subdir: 'plugins/x', update: false });
    } },
    { name: 'same name, same folder → update', run: () => {
      assert.deepEqual(placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['plugins/x/worca-cc-plugin.json'], index: idx,
        discovered: [{ name: 'x', subdir: 'plugins/x' }], folderManifestName: 'x' }), { subdir: 'plugins/x', update: true });
    } },
    { name: 'same name in another folder → that folder, update in place', run: () => {
      assert.equal(placementSubdir({ name: 'x', subdir: 'plugins/x', discovered: [{ name: 'x', subdir: 'extras/x' }] }), 'extras/x');
      assert.equal(placementSubdir({ name: 'x', subdir: 'plugins/x', discovered: [{ name: 'y', subdir: 'extras/y' }] }), 'plugins/x');
      assert.deepEqual(placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['extras/x/worca-cc-plugin.json'], index: idx,
        discovered: [{ name: 'x', subdir: 'extras/x' }], folderManifestName: 'x' }), { subdir: 'extras/x', update: true });
      // idempotent: the caller resolves the folder first, then re-reads the placement against it
      assert.deepEqual(placePlugin({ name: 'x', subdir: 'extras/x', paths: ['extras/x/worca-cc-plugin.json'], index: idx,
        discovered: [{ name: 'x', subdir: 'extras/x' }], folderManifestName: 'x' }), { subdir: 'extras/x', update: true });
    } },
    { name: 'same name in another folder whose manifest reads another name, or none → CONFLICT (never a write there)', run: () => {
      assert.throws(() => placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['extras/x/worca-cc-plugin.json'], index: idx, discovered: [{ name: 'x', subdir: 'extras/x' }], folderManifestName: 'other' }),
        (e) => e.code === 'CONFLICT' && /extras\/x\/ holds plugin "other"/.test(e.message));
      assert.throws(() => placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['extras/x/worca-cc-plugin.json'], index: idx, discovered: [{ name: 'x', subdir: 'extras/x' }], folderManifestName: null }),
        (e) => e.code === 'CONFLICT' && /extras\/x\/ holds plugin "\(unreadable manifest\)"/.test(e.message));
    } },
    { name: 'same name at the root → CONFLICT', run: () => {
      assert.throws(() => placementSubdir({ name: 'x', subdir: 'x', discovered: [{ name: 'x', subdir: '' }] }), (e) => e.code === 'CONFLICT' && /repository root/.test(e.message));
      assert.throws(() => placePlugin({ name: 'x', subdir: 'x', paths: ['worca-cc-plugin.json'], index: { present: false, ok: true }, discovered: [{ name: 'x', subdir: '' }], folderManifestName: null }),
        (e) => e.code === 'CONFLICT' && /repository root/.test(e.message));
    } },
    { name: 'folder holds another plugin → CONFLICT', run: () => {
      assert.throws(() => placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['plugins/x/worca-cc-plugin.json'], index: idx, discovered: [], folderManifestName: 'other' }),
        (e) => e.code === 'CONFLICT' && /holds plugin "other"/.test(e.message));
    } },
    { name: 'folder is not a plugin → CONFLICT', run: () => {
      assert.throws(() => placePlugin({ name: 'x', subdir: 'plugins/x', paths: ['plugins/x/notes.md'], index: idx, discovered: [], folderManifestName: null }),
        (e) => e.code === 'CONFLICT' && /not a Worca plugin/.test(e.message));
    } },
    { name: 'invalid index → MARKETPLACE_INVALID', run: () => {
      assert.throws(() => placePlugin({ name: 'x', subdir: 'plugins/x', paths: [], index: { present: true, ok: false, errors: ['"name" is required'] }, discovered: [], folderManifestName: null }),
        (e) => e.code === 'MARKETPLACE_INVALID');
    } },
  ]);
});

test('parseLsTree + assertNoSymlinkOnPath: a committed symlink the export would write through → MARKETPLACE_INVALID', async () => {
  const tree = ['100644 blob aaa\tREADME.md', '120000 blob bbb\tplugins', '120000 blob ccc\tdocs/link', '100644 blob ddd\tnaïve file.md'].join('\0') + '\0';
  assert.deepEqual(parseLsTree(tree), {
    paths: ['README.md', 'plugins', 'docs/link', 'naïve file.md'],      // -z: unquoted
    symlinks: ['plugins', 'docs/link'],
  });
  assert.deepEqual(parseLsTree(''), { paths: [], symlinks: [] });
  const refused = (symlinks, subdir, re) => assert.throws(() => assertNoSymlinkOnPath(symlinks, subdir),
    (e) => e.code === 'MARKETPLACE_INVALID' && re.test(e.message));
  await checkRows([
    { name: 'an ancestor of the plugin folder', run: () => refused(['plugins'], 'plugins/x', /plugins is a symbolic link/) },
    { name: 'the plugin folder itself', run: () => refused(['plugins/x'], 'plugins/x', /plugins\/x is a symbolic link/) },
    { name: 'the plugin folder itself, no index (root)', run: () => refused(['x'], 'x', /x is a symbolic link/) },
    { name: 'a path inside the plugin folder (update)', run: () => refused(['plugins/x/agents'], 'plugins/x', /plugins\/x\/agents is a symbolic link/) },
    { name: 'the index file', run: () => refused(['worca-cc-marketplace.json'], 'plugins/x', /worca-cc-marketplace\.json is a symbolic link/) },
    { name: 'a symlink elsewhere is harmless', run: () => assert.doesNotThrow(() => assertNoSymlinkOnPath(['docs/link', 'plugins/other', 'plugins/xy'], 'plugins/x')) },
    { name: 'no symlinks', run: () => assert.doesNotThrow(() => assertNoSymlinkOnPath([], 'plugins/x')) },
  ]);
});

test('addToIndex: appends once, other keys/entries/indent untouched', () => {
  const text = '{\n    "name": "Acme",\n    "description": "d",\n    "plugins": [\n        "plugins/a"\n    ],\n    "extra": 1\n}\n';
  const r = addToIndex(text, 'plugins/x');
  assert.equal(r.changed, true);
  assert.deepEqual(JSON.parse(r.text), { name: 'Acme', description: 'd', plugins: ['plugins/a', 'plugins/x'], extra: 1 });
  assert.match(r.text, /^\{\n {4}"name"/);           // 4-space indent kept
  assert.ok(r.text.endsWith('}\n'));
  assert.deepEqual(addToIndex(r.text, 'plugins/x'), { text: r.text, changed: false });
  assert.equal(addToIndex('{"name":"A","plugins":["plugins/x/"]}', 'plugins/x').changed, false);
});

test('findCredentialLeaks: token shapes, URL userinfo and live credential values — reports kind, never the value', () => {
  const live = 'S3cr3t-live-value-0123456789';
  const hits = findCredentialLeaks([
    { rel: 'plugins/x/agents/a.md', text: '# Agent\nuse GH ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 here\n' },
    { rel: 'plugins/x/scripts/s.sh', text: 'git clone https://bot:pw@github.com/a/b\n' },
    { rel: 'plugins/x/skills/k/notes.txt', text: `token=${live}\n` },
    { rel: 'plugins/x/workflows/w.json', text: '{"see":"https://github.com/acme/market"}\n' },   // a plain URL is fine
    { rel: 'plugins/x/skills/k/key.pem', text: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==\n-----END OPENSSH PRIVATE KEY-----\n' },
  ], [live, 'short']);                                                                    // < 8 chars is ignored
  assert.deepEqual(hits, [
    { rel: 'plugins/x/agents/a.md', kind: 'a token-shaped string' },
    { rel: 'plugins/x/scripts/s.sh', kind: 'a URL with a user name and password' },
    { rel: 'plugins/x/skills/k/notes.txt', kind: 'a credential this Worca uses' },
    { rel: 'plugins/x/skills/k/key.pem', kind: 'a private key' },
  ]);
  assert.doesNotMatch(JSON.stringify(hits), /ghp_|S3cr3t|bot:pw|b3Blbn/);
  assert.deepEqual(findCredentialLeaks([{ rel: 'a', text: 'nothing here' }], []), []);
});

test('buildPrTitle / buildPrBody: version, grouped files, left-out built-ins, validation; repo-relative only', () => {
  assert.equal(buildPrTitle({ name: 'x', update: false, oldVersion: null, newVersion: '0.1.0' }), 'Add plugin x v0.1.0');
  assert.equal(buildPrTitle({ name: 'x', update: true, oldVersion: '0.1.0', newVersion: '0.1.1' }), 'Update plugin x 0.1.0 → 0.1.1');
  // a hand-authored plugin without a version (the pinned SHA is its version) is still an UPDATE
  assert.equal(buildPrTitle({ name: 'x', update: true, oldVersion: null, newVersion: null }), 'Update plugin x');
  assert.equal(buildPrTitle({ name: 'x', update: true, oldVersion: '0.2.0', newVersion: '0.2.0' }), 'Update plugin x (list it in the marketplace index)');
  // D18: one wording for body, CLI and done screen — never "null"
  assert.equal(describeVersion({ update: false, oldVersion: null, newVersion: '0.1.0' }), 'new, 0.1.0');
  assert.equal(describeVersion({ update: false, oldVersion: null, newVersion: null }), 'new, unversioned');
  assert.equal(describeVersion({ update: true, oldVersion: '0.1.0', newVersion: '0.1.1' }), '0.1.0 → 0.1.1');
  assert.equal(describeVersion({ update: true, oldVersion: '0.2.0', newVersion: '0.2.0' }), '0.2.0 (unchanged)');
  assert.equal(describeVersion({ update: true, oldVersion: null, newVersion: null }), 'unversioned (unchanged)');
  assert.match(buildPrBody({ name: 'x', subdir: 'plugins/x', update: true, oldVersion: null, newVersion: null, created: [], updated: ['plugins/x/agents/a.md'],
    indexAdded: false, validation: { lint: 'passed', cases: 'no cases shipped', discovery: 'finds x at plugins/x/' } }), /\*\*Version:\*\* unversioned \(unchanged\)/);
  const body = buildPrBody({
    name: 'x', subdir: 'plugins/x', update: true, oldVersion: '0.1.0', newVersion: '0.1.1', workflow: 'Shared Flow',
    created: ['plugins/x/agents/a.md', 'plugins/x/agents/a.meta.json'],
    updated: ['plugins/x/workflows/shared-flow.json', 'plugins/x/worca-cc-plugin.json'],
    builtins: ['planner'], skippedSkills: ['bundled-skill'], indexAdded: false,
    validation: { lint: 'passed', cases: 'no cases shipped', discovery: 'finds x v0.1.1 at plugins/x/' },
    startedBy: 'alice',
  });
  assert.match(body, /\*\*Version:\*\* 0\.1\.0 → 0\.1\.1/);
  assert.match(body, /## Created\n\n- \*\*Agents:\*\* `agents\/a\.md`, `agents\/a\.meta\.json`/);
  assert.match(body, /## Updated\n\n- \*\*Workflows:\*\* `workflows\/shared-flow\.json`\n- \*\*Manifest:\*\* `worca-cc-plugin\.json`/);
  assert.match(body, /Built-in agents\/scripts:\*\* planner/);
  assert.match(body, /Built-in skills:\*\* bundled-skill/);
  assert.match(body, /Marketplace discovery: finds x v0\.1\.1/);
  assert.match(body, /Started by alice via worca$/);
  assert.doesNotMatch(body, /\/tmp|\/var\/|[A-Z]:\\/);
});
