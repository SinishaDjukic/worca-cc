// test/agent-registry-desc-fallback.test.mjs — empty sidecar description falls
// back to the agent .md's frontmatter description (spec 2026-08-09). Sidecar
// wins when present; unreadable/absent md, missing frontmatter, missing
// description line, or a block-scalar value degrades to ''.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

function layer(files) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-desc-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
const sidecar = (key, extra = {}) => JSON.stringify({
  key, displayName: key, color: 'blue', runnerType: 'producer', order: 1,
  agentFile: `${key}.md`, ...extra,
});
const load = (dir) => loadAgentRegistry(dir, { userAgentsDir: null, includePlugins: false });

test('empty sidecar description falls back to the .md frontmatter description', () => {
  const dir = layer({
    'alpha.meta.json': sidecar('alpha'),
    'alpha.md': '---\nname: alpha\ndescription: Audits dependencies for CVEs before release.\ntools: Read\n---\n\n# Alpha\n',
  });
  assert.equal(load(dir).alpha.description, 'Audits dependencies for CVEs before release.');
});

test('sidecar description wins over frontmatter when both exist', () => {
  const dir = layer({
    'beta.meta.json': sidecar('beta', { description: 'sidecar blurb' }),
    'beta.md': '---\ndescription: frontmatter blurb\n---\nbody\n',
  });
  assert.equal(load(dir).beta.description, 'sidecar blurb');
});

test('quoted frontmatter values are unquoted', () => {
  const dir = layer({
    'gamma.meta.json': sidecar('gamma'),
    'gamma.md': '---\ndescription: "Quoted: colons, commas, fine."\n---\n',
  });
  assert.equal(load(dir).gamma.description, 'Quoted: colons, commas, fine.');
});

test('missing .md, no frontmatter, no description line, or a block scalar → empty string', () => {
  const dir = layer({
    'noMd.meta.json': sidecar('noMd'),
    'noFm.meta.json': sidecar('noFm'), 'noFm.md': '# no frontmatter\n',
    'noLine.meta.json': sidecar('noLine'), 'noLine.md': '---\nname: noLine\n---\n',
    'folded.meta.json': sidecar('folded'),
    'folded.md': '---\nname: folded\ndescription: >-\n  Folded scalar body\n  continues here.\n---\n',
  });
  const reg = load(dir);
  assert.equal(reg.noMd.description, '');
  assert.equal(reg.noFm.description, '');
  assert.equal(reg.noLine.description, '');
  assert.equal(reg.folded.description, '', 'block-scalar indicator must degrade to empty, never ">-"');
});
