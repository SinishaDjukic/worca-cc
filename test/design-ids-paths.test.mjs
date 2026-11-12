// test/design-ids-paths.test.mjs — Design ids, section-id rules and the C-1 library layout (P1 Task 2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import {
  DesignError, DESIGN_KINDS, DESIGN_ID_RE, BUILD_ID_RE, AGENT_ID_RE, MAX_SECTIONS,
  newDesignId, newBuildId, newAgentId, sectionIdProblem, isSectionId,
} from '../src/core/design/ids.mjs';
import {
  designDir, designWorkDir, distDir, versionsDir, versionDir, sectionDir, asksDir, kitDir, attDir, crewFile,
  ensureDesignFolders, leadWriteDirs, builderWriteDirs,
} from '../src/core/design/paths.mjs';

useTempHome(after, 'worca-design-ids-paths-');
const ID = 'd_0123456789ab';

test('ids: shapes and the Windows reserved names', () => {
  assert.match(newDesignId(), DESIGN_ID_RE); assert.match(newBuildId(), BUILD_ID_RE); assert.match(newAgentId(), AGENT_ID_RE);
  assert.notEqual(newDesignId(), newDesignId());
  assert.deepEqual([...DESIGN_KINDS], ['web', 'presentation', 'pitch', 'video', 'document']);
  assert.equal(MAX_SECTIONS, 40);
  for (const ok of ['hero', 'a', 'pricing-2', 'con-tact', 'console', 'com10', 'lpt10', 'null', 'a'.repeat(32)]) assert.equal(sectionIdProblem(ok), null, ok);
  const reserved = ['con', 'prn', 'aux', 'nul', ...[...Array(10).keys()].flatMap((n) => [`com${n}`, `lpt${n}`]), 'tokens', 'global'];
  for (const bad of ['', 'Hero', '1hero', '-hero', 'he_ro', 'he ro', 'hero.', '../x', '__proto__', 'a'.repeat(33), null, 7, ...reserved]) {
    assert.equal(typeof sectionIdProblem(bad), 'string', String(bad)); assert.equal(isSectionId(bad), false);
  }
});

test('paths: C-1 layout under <home>/design, and a bad id never reaches the disk', () => {
  assert.equal(designDir(ID), join(worcaHome(), 'design', ID));
  assert.equal(designWorkDir(ID), join(designDir(ID), 'work'));
  assert.equal(sectionDir(ID, 'hero'), join(designWorkDir(ID), 'sections', 'hero'));
  assert.equal(asksDir(ID), join(designWorkDir(ID), '.asks'));
  assert.equal(kitDir(ID), join(designWorkDir(ID), '.kit'));
  assert.equal(attDir(ID), join(designWorkDir(ID), 'assets', 'att'));
  assert.equal(crewFile(ID), join(designWorkDir(ID), '.crew.json'));
  assert.equal(versionDir(ID, 3), join(designDir(ID), 'versions', '3'));
  assert.deepEqual([distDir(ID), versionsDir(ID)], [join(designDir(ID), 'dist'), join(designDir(ID), 'versions')]);
  // Both anchors: a URL id reaches deleteDesign's rmSync(recursive) only through designDir.
  for (const bad of ['../x', 'd_0123', 'D_0123456789AB', '', null, `../${ID}`, `${ID}/../../x`, `${ID}c`, `x${ID}`, `${ID}\n`]) {
    assert.throws(() => designDir(bad), (e) => e instanceof DesignError && e.code === 'BAD_REQUEST', String(bad));
  }
  assert.throws(() => sectionDir(ID, 'con'), (e) => e.code === 'BAD_REQUEST');
  for (const [id, n] of [[ID, 0], [ID, '1'], [ID, 1.5], [ID, '../x'], ['../x', 1], [`${ID}/../..`, 1]]) {
    assert.throws(() => versionDir(id, n), (e) => e instanceof DesignError && e.code === 'BAD_REQUEST', `${id} ${String(n)}`);
  }
  for (const [re, good] of [[BUILD_ID_RE, 'b_0123456789ab'], [AGENT_ID_RE, 'a_01234567']]) {
    assert.match(good, re);
    for (const bad of [`${good}/../x`, `${good}0`, `x${good}`, `../${good}`]) assert.doesNotMatch(bad, re, bad);
  }
  assert.deepEqual(leadWriteDirs(ID), [designWorkDir(ID)]);
  assert.deepEqual(builderWriteDirs(ID, 'hero'), [sectionDir(ID, 'hero'), asksDir(ID)]);
});

test('ensureDesignFolders: makes the folders, is idempotent, makes no builds folder (M1)', () => {
  assert.equal(ensureDesignFolders(ID), designDir(ID));
  for (const p of [join(designWorkDir(ID), 'sections'), attDir(ID), asksDir(ID), distDir(ID), versionsDir(ID)]) assert.ok(statSync(p).isDirectory(), p);
  writeFileSync(join(designWorkDir(ID), 'plan.json'), '{}');
  ensureDesignFolders(ID);
  assert.ok(existsSync(join(designWorkDir(ID), 'plan.json')));
  assert.equal(existsSync(join(designDir(ID), 'builds')), false);
});
