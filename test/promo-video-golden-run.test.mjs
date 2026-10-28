// The shipped Promo video workflow (wf_promo_video) run offline in mock mode to its End card — the
// presentation-golden-run pattern. Two runs: an unattended `--yes` run (every gate auto-answers from the
// form defaults, the engine blocks producer asks) and an attended run in which the test answers every
// form it is shown with that form's AUTO answer, so the script-approval gate is raised and passes gate 3.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { autoAnswer } from '../src/shared/forms/answer.mjs';
import { PROMO_VIDEO_WORKFLOW_ID } from '../src/core/graph/promo-video-workflow.mjs';

useTempHome(after);

/** The defaults the setup form's auto answer must produce (spec "Unattended"). */
const SETUP_DEFAULTS = {
  tone: 'Playful', length: '60 s', pace: 'Lively', mascots: true, mascotSource: 'Design one for me',
  mascotAmount: 40, audio: 'Silent video',
};
/** The audio fields are hidden on a silent video, and the auto answer drops a hidden field (D10):
 *  absent, or their default — readSetup fills them in either way. */
const HIDDEN_WHEN_SILENT = { voiceGender: 'Either', music: true };

/** A mock run consults no lookup: every promo agent runs on the mock engine and every promo script
 *  declares a mock. A lookup reached here would mean the preflight misread the run as live. */
const NO_LOOKUPS = {
  findChrome: () => { throw new Error('the mock run consulted findChrome'); },
  findFfmpeg: () => { throw new Error('the mock run consulted findFfmpeg'); },
  toolHints: () => { throw new Error('the mock run consulted toolHints'); },
};

/** The run must stay FULLY mock: no Chrome and no ffmpeg is ever spawned (a headless Chrome under a
 *  temp HOME also pops a macOS keychain dialog). WORCA_CHROME / WORCA_FFMPEG win every kit lookup, so
 *  pointing both at a trap that only records it was executed catches any spawn the run would make. */
const trapDir = mkdtempSync(join(tmpdir(), 'promo-golden-trap-'));
const trapHit = join(trapDir, 'spawned');
const trap = join(trapDir, 'trap.sh');
writeFileSync(trap, `#!/bin/sh\necho "$0 $*" >> '${trapHit}'\nexit 1\n`);
chmodSync(trap, 0o755);
const prevTools = { WORCA_CHROME: process.env.WORCA_CHROME, WORCA_FFMPEG: process.env.WORCA_FFMPEG };
process.env.WORCA_CHROME = trap;
process.env.WORCA_FFMPEG = trap;
after(() => {
  for (const [k, v] of Object.entries(prevTools)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(trapDir, { recursive: true, force: true });
});
const assertNothingSpawned = () => assert.equal(existsSync(trapHit), false,
  `the mock run spawned a media tool: ${existsSync(trapHit) ? readFileSync(trapHit, 'utf8') : ''}`);

const formDefs = {};
for (const key of ['promoSetup', 'promoVoice', 'promoWriter']) {
  const meta = JSON.parse(readFileSync(new URL(`../agents/${key}.meta.json`, import.meta.url), 'utf8'));
  Object.assign(formDefs, meta.ask?.forms || {});
}

function promoRun(tag, { auto }) {
  const orch = createOrchestrator({
    projectDir: gitDir(tag), workflowId: PROMO_VIDEO_WORKFLOW_ID, prompt: 'a 60 second promo video for this app',
    claude: { mock: true }, auto, mediaTools: NO_LOOKUPS,
  });
  const frames = [];
  orch.on('question', (q) => {
    frames.push(q);
    if (auto) return;                       // --yes: the engine answers
    setImmediate(() => {
      if (q.kind === 'form') {
        const def = formDefs[q.form];
        assert.ok(def, `a form the promo agents do not declare: ${q.form}`);
        orch.answer(q.id, { form: q.form, version: q.version, values: autoAnswer(def, q.data) });
      } else if (Array.isArray(q.questions) && q.questions.length) {
        orch.answer(q.id, { answers: q.questions.map((x) => ({ id: x.id, choice: (x.options || [])[0] || 'ok' })) });
      } else {
        orch.answer(q.id, { decision: 'continue' });
      }
    });
  });
  return { orch, frames };
}

const ordinalsOf = (st) => {
  const out = {};
  for (const s of st.steps.filter((x) => x.nodeId)) out[s.nodeId] = Math.max(out[s.nodeId] || 0, s.ordinal || 0);
  return out;
};

async function assertGoldenShape(orch, frames) {
  const st = orch.getState();
  assert.equal(st.endReached, true);
  const dir = orch.pipeline.dir;
  const ordinals = ordinalsOf(st);
  // Every card ran; the gates and the steps before the fix loop ran exactly once.
  for (const id of ['n_setup', 'n_voices', 'n_voice', 'n_explore', 'n_write', 'n_narrate', 'n_capture', 'n_mascot']) {
    assert.equal(ordinals[id], 1, `${id} runs once (${JSON.stringify(ordinals)})`);
  }
  // The fix loop: the mock verifier blocks once (cycle 1), the or card routes its findings into
  // n_scenes.fixes, the scenes are rebuilt and re-reviewed clean (cycle 2) — and only then does the
  // render run, ONCE, gated on the clean review.
  assert.equal(ordinals.n_review, 2, JSON.stringify(ordinals));
  assert.equal(ordinals.n_scenes, 2, 'the blocking review re-ran the scenes through n_or');
  assert.equal(ordinals.n_or, 1);
  assert.equal(ordinals.n_render, 1, 'the render runs once, after a clean review');
  assert.equal(ordinals.n_end, 1);

  // The setup form was raised and answered with the unattended defaults; the answers port file
  // is the wrapper the self-skipping steps read.
  const setup = frames.filter((q) => q.kind === 'form' && q.form === 'promo-setup');
  assert.equal(setup.length, 1, frames.map((q) => q.form || q.kind).join(', '));
  const answers = JSON.parse(await readFile(join(dir, 'promo-setup.json'), 'utf8'));
  assert.equal(answers.form, 'promo-setup');
  for (const [k, v] of Object.entries(SETUP_DEFAULTS)) assert.deepEqual(answers.values[k], v, `setup.${k}`);
  for (const [k, v] of Object.entries(HIDDEN_WHEN_SILENT)) {
    assert.ok(answers.values[k] === undefined || answers.values[k] === v, `setup.${k}: ${JSON.stringify(answers.values[k])}`);
  }
  assert.ok(!answers.values.apiKey || /^\[env:/.test(answers.values.apiKey), 'no typed key ever reaches the port file');
  // The voice picker (the mock raises it with sample voices; a real silent run writes no question):
  // when it is shown, its answer is the first voice, which is what --yes picks.
  const voice = frames.filter((q) => q.kind === 'form' && q.form === 'promo-voice');
  assert.ok(voice.length <= 1);
  if (voice.length) {
    const picked = JSON.parse(await readFile(join(dir, 'promo-voice.json'), 'utf8'));
    assert.equal(picked.form, 'promo-voice');
    assert.equal(picked.values.voiceId, voice[0].data.voices[0].id);
  }
  // No form outside the three the workflow declares.
  for (const q of frames.filter((x) => x.kind === 'form')) {
    assert.ok(['promo-setup', 'promo-voice', 'approve-script'].includes(q.form), q.form);
  }
  // The kit is STAGED for the cards that need it.
  await access(join(dir, 'promo-kit', 'CONTRACT.md'));
  assertNothingSpawned();
  return { st, dir, ordinals };
}

test('wf_promo_video runs offline end to end under --yes: the setup form auto-answers from its defaults', { timeout: 180000 }, async () => {
  const { orch, frames } = promoRun('promo-golden-yes', { auto: true });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const { st } = await assertGoldenShape(orch, frames);
  assert.deepEqual(st.warnings, []);
  // --yes blocks a PRODUCER's questions (the engine's rule for every agent), so the script is
  // approved as written: the approval form is never shown on an unattended run.
  assert.equal(frames.some((q) => q.form === 'approve-script'), false);
});

test('wf_promo_video attended: the setup, voice and script-approval forms are raised and their auto answers pass', { timeout: 180000 }, async () => {
  const { orch, frames } = promoRun('promo-golden-attended', { auto: false });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const { st } = await assertGoldenShape(orch, frames);
  assert.deepEqual(st.warnings, []);
  const approve = frames.filter((q) => q.kind === 'form' && q.form === 'approve-script');
  assert.equal(approve.length, 1, frames.map((q) => q.form || q.kind).join(', '));
  assert.equal(approve[0].nodeId, 'n_write');
});
