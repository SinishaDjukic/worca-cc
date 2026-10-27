// test/install-skill.test.mjs
// tools/install.mjs rewrites the <WORCA_REPO> placeholder in the copied SKILL.md. The
// source once named the placeholder in its own prose, so the installed copy read
// "`/opt/.../@worca/app` below is the absolute path ... rewrites `/opt/.../@worca/app`".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

function installedSkill() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-skill-target-'));
  scratch.push(dir);
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'install.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return readFileSync(join(dir, '.claude', 'skills', 'worca', 'SKILL.md'), 'utf8');
}

test('installed SKILL.md has no leftover placeholder and never names the repo path twice in a line', () => {
  const md = installedSkill();
  assert.equal(md.includes('<WORCA_REPO>'), false, 'placeholder left in the installed copy');
  for (const line of md.split('\n')) {
    assert.ok(line.split(ROOT).length - 1 <= 1, `repo path appears twice in: ${line}`);
  }
  assert.ok(md.includes(`node ${ROOT}/src/cli/worca-cc.mjs`), 'the PATH fallback points at this install');
});

test('installed SKILL.md calls worca from PATH first', () => {
  const md = installedSkill();
  assert.match(md, /command -v worca/);
  assert.match(md, /^worca --project "\$PWD" --prompt "<args>"$/m);
  assert.match(md, /^worca --ui$/m);
  assert.match(md, /^worca --install "<targetDir>"$/m);
});
