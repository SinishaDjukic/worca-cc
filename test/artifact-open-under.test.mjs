// test/artifact-open-under.test.mjs — V9 (G11): an artifact is read from the file the link check passed, never
// reopened by path. openArtifactUnder opens first (O_NOFOLLOW, O_NONBLOCK), then checks that `<base>/<rel>` has no
// link anywhere below the base AND that the open file is that same file (dev/ino), so a swap in either order fails.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openArtifactUnder } from '../src/core/artifacts.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlinks and FIFOs' : false };
const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-open-under-')));
after(() => rmSync(root, { recursive: true, force: true }));
const base = join(root, 'run'); mkdirSync(join(base, 'work'), { recursive: true });
const secret = join(root, 'ui.json'); writeFileSync(secret, '{"token":"secret"}');
const read = async (rel) => { const fh = await openArtifactUnder(base, rel); if (!fh) return null; try { return await fh.readFile('utf8'); } finally { await fh.close(); } };

test('a regular file below the base opens', async () => {
  writeFileSync(join(base, 'work', 'report.md'), '# ok\n');
  assert.equal(await read('work/report.md'), '# ok\n');
});

test('a link as the file, or as a folder on the way, never opens', POSIX, async () => {
  symlinkSync(secret, join(base, 'work', 'leak.md'));
  assert.equal(await read('work/leak.md'), null);
  mkdirSync(join(root, 'elsewhere')); writeFileSync(join(root, 'elsewhere', 'plan.md'), 'outside');
  symlinkSync(join(root, 'elsewhere'), join(base, 'plans'));
  assert.equal(await read('plans/plan.md'), null);
});

test('a FIFO is refused at once, never a request held open', POSIX, async () => {
  execFileSync('mkfifo', [join(base, 'work', 'pipe.md')]);
  assert.equal(await read('work/pipe.md'), null);
});
