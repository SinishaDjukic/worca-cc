// Every registry entry carries the agent .md's frontmatter (name/description/tools/model)
// read from the file HEAD — the body never reaches the registry (auto-workflow P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadAgentFile } from '../src/core/workflows.mjs';

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });

test('all 11 builtins carry frontmatter: name = worca-cc-<role>, tools list, model inherit', () => {
  for (const m of Object.values(REG)) {
    assert.ok(m.frontmatter, `${m.key} has frontmatter`);
    assert.match(m.frontmatter.name, /^worca-cc-[a-z-]+$/);
    assert.ok(m.frontmatter.description.length > 100, `${m.key}: the .md description is the long role statement`);
    assert.ok(m.frontmatter.tools.includes('Read'), `${m.key} declares Read`);
    assert.equal(m.frontmatter.model, 'inherit');
  }
  assert.ok(REG.manualWebUiTesting.frontmatter.tools.includes('mcp__plugin_playwright_playwright__browser_navigate'));
  assert.equal(REG.manualWebUiTesting.frontmatter.tools.filter((t) => t.startsWith('mcp__plugin_playwright_playwright__')).length, 14);
  assert.match(REG.manualWebUiTesting.frontmatter.description, /RUNNING web UI/);
  assert.notEqual(REG.planner.frontmatter.description, REG.planner.description, 'sidecar blurb and .md role differ — both are kept');
  assert.equal(REG.planner.descriptionDerived, undefined, 'a sidecar blurb is never marked derived');
});

test('a temp layer: CRLF + BOM parse, no-frontmatter and missing .md give null, the body never leaks, derived blurb still flagged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-reg-fm-'));
  const sidecar = (key, extra = {}) => JSON.stringify({ key, displayName: key, color: 'blue', runnerType: 'producer', order: 1, agentFile: `${key}.md`, ...extra });
  writeFileSync(join(dir, 'crlf.meta.json'), sidecar('crlf'));
  writeFileSync(join(dir, 'crlf.md'), '---\r\nname: crlf\r\ndescription: CRLF role\r\ntools: Read, Bash\r\nmodel: inherit\r\n---\r\nBODY-MUST-NOT-LEAK\r\n');
  writeFileSync(join(dir, 'bom.meta.json'), sidecar('bom', { description: 'sidecar blurb' }));
  writeFileSync(join(dir, 'bom.md'), '\uFEFF---\nname: bom\ndescription: BOM role\ntools: Read\n---\nBODY-MUST-NOT-LEAK\n');
  writeFileSync(join(dir, 'nofm.meta.json'), sidecar('nofm'));
  writeFileSync(join(dir, 'nofm.md'), '# heading only\nBODY-MUST-NOT-LEAK\n');
  writeFileSync(join(dir, 'nomd.meta.json'), sidecar('nomd'));
  const reg = loadAgentRegistry(dir, { userAgentsDir: null, includePlugins: false });
  assert.deepEqual(reg.crlf.frontmatter.tools, ['Read', 'Bash']);
  assert.equal(reg.crlf.description, 'CRLF role', 'empty sidecar blurb falls back to the .md description');
  assert.equal(reg.crlf.descriptionDerived, true);
  assert.equal(reg.bom.frontmatter.description, 'BOM role', 'a BOM-prefixed .md now parses');
  assert.equal(reg.bom.description, 'sidecar blurb', 'the sidecar blurb still wins');
  assert.equal(reg.nofm.frontmatter, null);
  assert.equal(reg.nofm.description, '');
  assert.equal(reg.nomd.frontmatter, null);
  assert.ok(!JSON.stringify(reg).includes('BODY-MUST-NOT-LEAK'), 'the registry never carries a body');
  // loadAgentFile keeps returning the same tools through the shared parser (and the whole prompt, as before).
  const loaded = await loadAgentFile(dir, 'crlf.md');
  assert.deepEqual(loaded.tools, ['Read', 'Bash']);
  assert.match(loaded.prompt, /BODY-MUST-NOT-LEAK/, 'the executor still gets the full prompt');
});
