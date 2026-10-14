// test/demo-video-tooling.test.mjs — the demo-video tool's pure pieces: args, ports, ready line + sandbox env,
// ffconcat/ffmpeg args, key pacing, scenario coverage of the script's prompts, the sample app's self-containment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { parseArgs, outputName } from '../tools/demo/extension-video/lib/args.mjs';
import { freePort, portFree } from '../tools/demo/extension-video/lib/ports.mjs';
import { parseReadyLine, hostEnv, READY_PREFIX } from '../tools/demo/extension-video/lib/start-host.mjs';
import { concatList, encodeArgs } from '../tools/demo/extension-video/lib/capture.mjs';
import { keyDelays } from '../tools/demo/extension-video/lib/human.mjs';
import { PROMPTS } from '../tools/demo/extension-video/lib/script.mjs';
import { demoAskReply } from '../src/core/demo-scenario.mjs';

const DIR = new URL('../tools/demo/extension-video/', import.meta.url);

test('args: defaults to 1920x1080 MP4; --size parses; junk is refused', () => {
  assert.deepEqual(parseArgs([]).size, { width: 1920, height: 1080 });
  assert.deepEqual(parseArgs(['--size', '1600x900']).size, { width: 1600, height: 900 });
  assert.throws(() => parseArgs(['--size', 'big']), /WIDTHxHEIGHT/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.equal(outputName(new Date(2026, 9, 14, 9, 5), 'mp4'), 'worca-extension-demo-20261014-0905.mp4');
});

test('freePort gives a bindable port; portFree sees a taken one', async () => {
  const p = await freePort();
  assert.ok(p > 0 && p < 65536);
  const s = net.createServer(); await new Promise((r) => s.listen(p, '127.0.0.1', r));
  try { assert.equal(await portFree(p), false); } finally { await new Promise((r) => s.close(r)); }
  assert.equal(await portFree(p), true);
});

test('host env is sandboxed: one home, mock + scenario on, agent/remote vars gone', () => {
  const env = hostEnv({ HOME: '/real', WORCA_HOST_PID: '1', WORCA_ALLOWED_HOSTS: 'x', PATH: '/bin' }, { home: '/tmp/h', port: 5000, scenario: '/s.json' });
  assert.equal(env.HOME, '/tmp/h'); assert.equal(env.WORCA_HOME, '/tmp/h'); assert.equal(env.USERPROFILE, '/tmp/h');
  assert.equal(env.WORCA_MOCK, '1'); assert.equal(env.WORCA_DEMO_SCENARIO, '/s.json'); assert.equal(env.PORT, '5000');
  assert.equal(env.WORCA_HOST_PID, undefined); assert.equal(env.WORCA_ALLOWED_HOSTS, undefined); assert.equal(env.PATH, '/bin');
  assert.deepEqual(parseReadyLine(`${READY_PREFIX}{"port":1}`), { port: 1 });
  assert.equal(parseReadyLine('[worca-ui] listening'), null);
});

test('ffconcat keeps real frame timing; encoder args make an H.264 yuv420p MP4', () => {
  const list = concatList([{ file: '/a.jpg', t: 10 }, { file: '/b.jpg', t: 12.5 }], 0.5);
  assert.match(list, /file '\/a\.jpg'\nduration 2\.5000/);
  assert.match(list, /file '\/b\.jpg'\nduration 0\.5000\nfile '\/b\.jpg'\n$/);
  const args = encodeArgs({ list: 'l', out: 'o.mp4', width: 1920, height: 1080 });
  assert.ok(args.includes('libx264') && args.join(' ').includes('format=yuv420p') && args.at(-1) === 'o.mp4');
});

test('typing pace is human (50–70 ms/key + a beat after spaces) and deterministic', () => {
  const d = keyDelays('fix this');
  assert.deepEqual(d, keyDelays('fix this'));
  for (const [i, ms] of d.entries()) assert.ok(ms >= 50 && ms <= 110, `key ${i}: ${ms}`);
});

test('every typed prompt has a scripted answer and title (no "[mock]" on camera)', () => {
  const env = { WORCA_DEMO_SCENARIO: new URL('scenario.json', DIR).pathname };
  for (const p of Object.values(PROMPTS)) {
    assert.ok(demoAskReply(p, env)?.answer, `answer for "${p}"`);
    assert.ok(demoAskReply(`Write the title for this task:\n\n${p}`, env)?.title, `title for "${p}"`);
  }
  assert.match(demoAskReply('Fix the annual price', env).answer, /\$278/);    // the specific entry wins over "fix this"
});

test('the sample app is self-contained (no network URLs) and carries the planted issues', () => {
  const app = new URL('sample-app/', DIR);
  for (const f of readdirSync(app).filter((n) => /\.(html|css|js|mjs)$/.test(n))) {
    assert.doesNotMatch(readFileSync(new URL(f, app), 'utf8'), /https?:\/\/(?!localhost|127\.0\.0\.1|x\b)/, f);
  }
  const html = readFileSync(new URL('index.html', app), 'utf8');
  assert.match(html, /Billed annually at \$348 — save 20%/);
  assert.match(readFileSync(new URL('styles.css', app), 'utf8'), /\.plan--team \.plan-cta\s*\{[^}]*translateX/);
});
