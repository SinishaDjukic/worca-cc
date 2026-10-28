// test/plugin-update-consent.test.mjs — an update applies only the commit the user reviewed (S3 G26, CONTRACT §1.4).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { readPluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { installPlugin, updatePlugin } from '../src/core/plugin-store.mjs';
import { fetchCandidate } from '../src/core/plugin-repo.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-consent-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const git = async (cwd, ...args) => (await promisify(execFile)('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com',
  '-c', 'commit.gpgsign=false', ...args], { cwd })).stdout.trim();

test('updatePlugin with expectSha: a moved tip is STALE_PREVIEW and changes nothing; the reviewed tip applies', async () => {
  const root = join(scratch, 'repo');
  mkdirSync(root, { recursive: true });
  const commit = async (version) => {
    writeFileSync(join(root, 'worca-cc-plugin.json'), JSON.stringify({ name: 'consent-plugin', version }));
    await git(root, 'add', '-A');
    await git(root, 'commit', '-qm', version);
    return git(root, 'rev-parse', 'HEAD');
  };
  await git(root, 'init', '-q', '-b', 'main');
  const v1 = await commit('0.1.0');
  await installPlugin({ repoUrl: root, subdir: '', name: 'consent-plugin', sha: v1 });
  const v2 = await commit('0.2.0');
  assert.equal((await fetchCandidate('consent-plugin')).candidateSha, v2, 'the user reviews v2');
  const v3 = await commit('0.3.0');
  await assert.rejects(updatePlugin('consent-plugin', { expectSha: v2 }), {
    code: 'STALE_PREVIEW', candidateSha: v3,
    message: `plugin "consent-plugin" moved on since the preview (${v2.slice(0, 7)} → ${v3.slice(0, 7)}) — review the update again`,
  });
  assert.equal(readPluginsLock()['consent-plugin'].pinnedSha, v1, 'nothing applied');
  assert.equal(existsSync(join(pluginDir('consent-plugin'), 'versions', v3.slice(0, 7))), false, 'nothing exported');
  const ok = await updatePlugin('consent-plugin', { expectSha: v3 });
  assert.deepEqual([ok.updated, readPluginsLock()['consent-plugin'].pinnedSha, readPluginsLock()['consent-plugin'].version], [true, v3, '0.3.0']);
  await assert.rejects(updatePlugin('consent-plugin', { expectSha: v2 }), { code: 'STALE_PREVIEW', candidateSha: v3 },
    'checked before the up-to-date shortcut: consent on v2 never confirms v3');
});
