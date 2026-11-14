// test/design-build-sound.test.mjs — Design sound P2 Task B5: the round's sound stage (SPEC D8, D9, D16, D17), between
// the lead's plan and the builders, on the mock engine with P1's `speak` and `compose` stubbed (no network, no settings).
// It makes and books the voice and the music behind worca's spend limits, grows a scene its voice needs before any
// builder is told `S.dur`, rebuilds a built scene that grew, and tells each builder its words. A failure is a line,
// never a failed round, and a design without sound is unchanged.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { _testing as mockDesignTesting } from '../src/core/engines/mock-design.mjs';
import { estimateWords } from '../src/core/elevenlabs.mjs';
import { SoundError, silentWav } from '../src/core/sound.mjs';
import { musicUsd, voiceUsd } from '../src/shared/sound-services.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { designDir, designWorkDir, picturesDir } from '../src/core/design/paths.mjs';
import { continuePrompt, leadSystemPrompt } from '../src/core/design/prompts.mjs';
import { getBuild, getDesign, listAgents, updateAgent, updateDesign } from '../src/core/design/store.mjs';
import { restoreVersion, snapshotVersion } from '../src/core/design/versions.mjs';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';

useDesignEnv(after);

const ON_CALM = { on: true, voice: { id: 'mock-voice-1', name: 'Ana' }, music: { kind: 'calm' } };
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const abortError = () => new DOMException('This operation was aborted', 'AbortError');

/** Rejects once `signal` aborts, checked before the listener is added (the mock engine's `untilAborted`). */
function untilAborted(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

/** P1's `speak`, stubbed: records the call, runs `speak.onCall`, honours the abort, hangs the `speak.gate`-th call until
 *  the abort, rejects `speak.fail`, else answers a silent clip of `speak.secondsFor(text)` (2 s) at `speak.costUsd`. */
async function speak({ text, voiceId, previousText, nextText, signal, mock }) {
  speak.calls.push({ text, voiceId, previousText, nextText, mock });
  speak.onCall?.();
  if (signal?.aborted) throw abortError();
  if (speak.gate && speak.calls.length === speak.gate) await untilAborted(signal);
  if (speak.fail) throw speak.fail;
  const s = speak.secondsFor?.(text) ?? 2;
  return {
    bytes: silentWav(s), ext: 'wav', seconds: s, words: estimateWords(text, 2.5).words.map(({ w, t0, t1 }) => ({ w, t0, t1 })),
    chars: text.length, costUsd: speak.costUsd ?? voiceUsd(text.length), model: 'elevenlabs/eleven_multilingual_v2',
  };
}
/** P1's `compose`, stubbed: rejects `compose.fail` when set, else a silent track of the asked length at `compose.costUsd`. */
async function compose({ prompt, seconds, signal, mock }) {
  compose.calls.push({ prompt, seconds, mock });
  if (signal?.aborted) throw abortError();
  if (compose.fail) throw compose.fail;
  return { bytes: silentWav(seconds), ext: 'wav', seconds, costUsd: compose.costUsd ?? musicUsd(seconds), model: 'elevenlabs/music_v2_5' };
}
/** Clears every record and every override. */
function reset() {
  speak.calls = [];
  compose.calls = [];
  for (const k of ['secondsFor', 'gate', 'costUsd', 'fail', 'onCall']) delete speak[k];
  delete compose.costUsd;
  delete compose.fail;
}
beforeEach(reset);

/** The stubs, ElevenLabs ready, and a test's own deps over them. */
const soundDeps = (deps = {}) => ({ speak, compose, soundReady: () => true, ...deps });

/** The prompts the fixture's `runClaude` was given: the lead's first process (its plan or change stage), and a builder's
 *  last, found by its folder (a builder's cwd is its section's). Read when asked, so a Continue's calls count. */
function promptsOf(calls) {
  const role = (c, r) => String(c.systemPrompt ?? '').startsWith(`MOCK_ROLE: design-${r}\n`);
  const lead = () => calls.find((c) => role(c, 'lead'));
  return {
    get leadSystem() { return lead()?.systemPrompt; },
    get lead() { return lead()?.prompt; },
    builder: (id) => calls.filter((c) => role(c, 'builder') && basename(c.cwd) === id).at(-1)?.prompt,
  };
}

/** A video round with `sound`, run to its end. `until` is asked at each `speak` call, as it is recorded, and `then`
 *  runs on the build when it holds; `onFrame(frame, build)` hears every frame as it is sent. */
async function round({ sound, brief, deps, until, then, onFrame } = {}) {
  const design = newDesign({ kind: 'video' });
  updateDesign(design.id, { sound });
  const { build, frames, calls } = newBuild(design, { brief, deps: soundDeps(deps) });
  if (onFrame) build.on('frame', (f) => onFrame(f, build));
  speak.onCall = () => { if (until?.()) then(build); };
  try {
    await build.run();
  } finally {
    delete speak.onCall;
  }
  return { build, frames, calls, prompts: promptsOf(calls), design };
}

/** A change round of `first`'s design, run to its end. */
async function change(first, { instruction, sections, needsLead, deps } = {}) {
  const design = getDesign(first.design.id);
  const { build, frames, calls } = newBuild(design, { kind: 'change', instruction, sections, needsLead, deps: soundDeps(deps) });
  await build.run();
  return { build, frames, calls, prompts: promptsOf(calls), design };
}

const ledger = (designId) => prepare('SELECT agent_id, amount_usd, model FROM design_cost_ledger WHERE design_id = ? ORDER BY id').all(designId);
const workDir = (design) => designWorkDir(design.id);

test('sound on: the stage runs between the plan and the builders, and the builders know the words', async () => {
  speak.secondsFor = (text) => (text.length > 100 ? 9 : 2);                              // MOCK_SAY_LONG's words need 9 s
  const { frames, prompts, design, build } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=3 MOCK_SAY MOCK_SAY_LONG=hero' });
  const order = frames.map((f) => f.type === 'design-sound' ? `sound:${f.state}` : f.type === 'design-agent' && f.role === 'builder' && f.status === 'starting' ? 'builder' : f.type === 'design-plan' ? 'plan' : null).filter(Boolean);
  const at = order.indexOf('sound:making');
  assert.ok(order.indexOf('plan') >= 0 && order.indexOf('plan') < at);                  // the lead's plan comes first
  assert.deepEqual(order.slice(at, at + 4), ['sound:making', 'plan', 'sound:made', 'builder']);   // this plan frame carries the grown scene
  const made = frames.find((f) => f.type === 'design-sound' && f.state === 'made');
  assert.deepEqual([made.voice, made.music, made.grown], [{ made: 3, reused: 0 }, true, 1]);
  const plan = JSON.parse(readFileSync(join(workDir(design), 'plan.json'), 'utf8'));
  assert.deepEqual(plan.sections.map((s) => s.duration), [9.8, 4, 4]);
  assert.match(prompts.builder('hero'), /S\.dur is 9\.8\.\nThe voice speaks in this scene from 0\.35s to 9\.35s\./);
  assert.match(prompts.leadSystem, /\nSound \(this video has a voice; worca makes it and plays it beside the scenes\):/);
  assert.match(prompts.lead, /^Sound: voice "Ana"; music: calm$/m);
  const rows = ledger(design.id).filter((r) => r.agent_id === null);
  assert.deepEqual(rows.map((r) => r.model), ['elevenlabs/eleven_multilingual_v2', 'elevenlabs/eleven_multilingual_v2', 'elevenlabs/eleven_multilingual_v2', 'elevenlabs/music_v2_5']);
  assert.equal(r6(getBuild(build.id).costUsd), r6(rows.reduce((t, r) => t + r.amount_usd, 0)));          // the mock agents book $0
  assert.equal(build.snapshot().sound.state, 'made');
});
test('sound off or never asked: no call, no folder, the prompts of today', async () => {
  for (const sound of [null, { on: false }]) {
    const { frames, prompts, design } = await round({ sound, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
    assert.equal(speak.calls.length + compose.calls.length, 0);
    assert.equal(frames.some((f) => f.type === 'design-sound'), false);
    assert.equal(existsSync(join(workDir(design), 'assets/sound')), false);
    assert.equal(prompts.leadSystem, `MOCK_ROLE: design-lead\n${leadSystemPrompt({ kind: 'video' })}`);   // spawn-options.mjs:72 under mock
    assert.doesNotMatch(prompts.builder('hero'), /The voice speaks/);
  }
});
test('Stop during the stage books nothing for the cut call', async () => {
  speak.gate = 2;                                                                        // the 2nd call hangs until aborted
  const { build } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=3 MOCK_SAY', until: () => speak.calls.length === 2, then: (b) => b.stop() });
  assert.equal(getBuild(build.id).status, 'stopped');
  assert.equal(ledger(build.designId).filter((r) => r.agent_id === null).length, 1);
});
test('a pause mid-stage, then Continue: one clip is reused, two are made, none paid twice', async () => {
  speak.gate = 2;
  const { build } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=3 MOCK_SAY', until: () => speak.calls.length === 2, then: (b) => b.pauseForDrain() });
  speak.gate = 0; reset();
  await build.continue();
  assert.equal(speak.calls.length, 2);
  assert.equal(ledger(build.designId).filter((r) => r.model === 'elevenlabs/eleven_multilingual_v2').length, 3);
});
test('the sound that reaches the cost limit pauses the round before any builder', async () => {   // the gate would also pause: not the mutation proof of _bookSound's pause
  const { build, frames } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY', deps: { readCaps: async () => ({ perRunCapUsd: 0.0001, totalCapUsd: null }) } });
  assert.deepEqual([getBuild(build.id).status, getBuild(build.id).reason], ['paused', 'total-limit']);
  assert.equal(frames.some((f) => f.type === 'design-agent' && f.role === 'builder'), false);
});
test('a spend limit closed before the stage: no call, the round pauses', async () => {
  let blocked = false;
  const { build, frames } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY', deps: { budgetStatus: () => ({ blocked }) },
    onFrame: (f) => { if (f.type === 'design-plan') blocked = true; } });                // open for the lead, closed once its plan is in
  assert.deepEqual([speak.calls.length, compose.calls.length], [0, 0]);
  assert.deepEqual([getBuild(build.id).status, getBuild(build.id).reason], ['paused', 'total-limit']);
  assert.equal(framesOf(frames, 'design-build').some((f) => f.status === 'building'), false);   // the stage paused it, not the builders' gate
  assert.deepEqual(framesOf(frames, 'design-sound').map((f) => f.state), ['making']);
  assert.deepEqual(listAgents(build.id).map((a) => a.role), ['lead']);
});
test('sound dollars add to the agents\' on the build and on the design', async () => {
  speak.costUsd = 0.05; compose.costUsd = 0.06;                                          // three clips and the music: $0.21
  const { build, design } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=3 MOCK_COST=0.2 MOCK_SAY' });   // agents: $1.00
  assert.deepEqual([r6(getBuild(build.id).costUsd), r6(getDesign(design.id).costUsd)], [1.21, 1.21]);
});
test('a failure is a line, never a failed round', async () => {
  speak.fail = new SoundError('the ElevenLabs account is out of credits', 402);
  const { build, frames } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
  assert.equal(getBuild(build.id).status, 'done');
  const f = frames.find((x) => x.type === 'design-sound' && x.state === 'failed');
  assert.deepEqual(f.reasons, ['the ElevenLabs account is out of credits']);
  assert.equal(f.music, true);                                                           // 402 on the voice does not stop the music
});
test('not set up: one reason, no call; a throw anywhere in the stage is a line too', async () => {
  const { frames } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY', deps: { soundReady: () => false } });
  assert.deepEqual(frames.filter((f) => f.type === 'design-sound').map((f) => [f.state, f.reasons]), [['failed', ['ElevenLabs is not set up']]]);
  assert.equal(speak.calls.length, 0);
  const t = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY', deps: { soundReady: () => { throw new Error('settings unreadable'); } } });
  assert.equal(getBuild(t.build.id).status, 'done');
  assert.deepEqual(t.frames.filter((f) => f.type === 'design-sound').map((f) => f.reasons), [['the sound could not be saved']]);
});
test('a grown scene whose builder already ran in this build is reworked on the Continue', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'failed']);   // hero done, its session held
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 12 : 2);
  await first.build.continue();                                                          // the selection is { features }
  assert.equal(speak.calls.length, 2);
  assert.match(first.prompts.builder('hero'), /^Rework: This scene is now 12\.8s long \(it was 4s\) so its voice fits\./);
  assert.equal(getBuild(first.build.id).sections.find((s) => s.id === 'hero').status, 'done');
});
test('a change round: only the touched words are spoken again; a built scene that grew is rebuilt', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=3 MOCK_SAY' });
  reset();
  speak.secondsFor = (text) => (text === 'new words for the second scene.' ? 9 : 2);     // the new words need a longer scene
  const second = await change(first, { instruction: 'Change features MOCK_ROUND_SAY=features:new-words-for-the-second-scene', sections: ['features'], needsLead: true });
  assert.deepEqual(speak.calls.map((c) => c.text), ['new words for the second scene.']);
  assert.match(second.prompts.builder('features'), /S\.dur is 9\.8\.\nThe voice speaks in this scene from 0\.35s to 9\.35s\./);
  assert.match(second.prompts.builder('features'), /^For this section: Mock new words\.$/m);   // the person's change, not the grown-scene brief
  assert.doesNotMatch(second.prompts.builder('features'), /This scene is now/);
  assert.deepEqual(getBuild(second.build.id).sections.find((x) => x.id === 'features').todo, { stage: 'change', brief: 'Mock new words.' });
});
test('a new voice between rounds: every clip again, and a built scene that grew is rebuilt though the round named another', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=3 MOCK_SAY' });
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 12 : 2);                 // hero's clip is now longer than hero
  const second = await change(first, { instruction: 'Tidy pricing', sections: ['pricing'], needsLead: false });
  assert.equal(speak.calls.length, 3);
  assert.match(second.prompts.builder('hero'), /For this section: This scene is now 12\.8s long \(it was 4s\) so its voice fits\. Stretch its timeline to the new length and change nothing else\./);
});
test('sound turned off after a round with sound: the next round removes the files', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
  updateDesign(first.design.id, { sound: { on: false } });
  await change(first, { instruction: 'Tidy hero', sections: ['hero'], needsLead: false });
  assert.equal(existsSync(join(workDir(first.design), 'assets/sound')), false);
});

// Beyond the plan's thirteen: each pins a guard the thirteen leave open (the booking's own pause and the settle right
// after the stage, each arm a Continue meets, the clips a rehydrate and a stage that makes nothing still hand out).
test('a sound booking that reaches the per-run cap pauses the round itself, before the builders\' stage', async () => {
  speak.costUsd = 0.05;                                                                  // the gate is open at $0: only the booking reaches the cap
  const { build, frames, prompts } = await round({ sound: { ...ON_CALM, music: { kind: 'none' } }, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY', deps: { readCaps: async () => ({ perRunCapUsd: 0.01, totalCapUsd: null }) } });
  assert.deepEqual([getBuild(build.id).status, getBuild(build.id).reason], ['paused', 'total-limit']);
  assert.deepEqual(ledger(build.designId).filter((r) => r.agent_id === null).map((r) => r.amount_usd), [0.05]);
  assert.equal(framesOf(frames, 'design-build').some((f) => f.status === 'building'), false);   // settled right after the stage
  assert.deepEqual(framesOf(frames, 'design-sound').map((f) => [f.state, f.music]), [['making', false]]);   // the abort cut the stage: no line
  assert.match(prompts.lead, /^Sound: voice "Ana"; music: no music$/m);
  assert.match(prompts.lead, /^This design is a video made of HTML and JavaScript\. worca adds a voice\. Aim at the length the brief names\.$/m);
});
test('a builder cut off mid-build whose scene grew finishes its build at the new length', async () => {
  let cut = false;
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY MOCK_HANG_SECTION=hero',
    onFrame: (f, b) => { if (!cut && f.type === 'design-delta' && f.sectionId === 'hero') { cut = true; setImmediate(() => b.pauseForDrain()); } } });
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'drain']);
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 12 : 2);
  await first.build.continue();
  assert.equal(first.prompts.builder('hero'), `${continuePrompt({ role: 'builder' })}\nThis scene is now 12.8s long (it was 4s) so its voice fits. Stretch its timeline to the new length and change nothing else.`);
  assert.equal(getBuild(first.build.id).status, 'done');
});
/** A round paused the moment its first builder's row exists: that builder never starts a process, so it has no session. */
const pauseAtFirstBuilder = () => {
  let paused = false;
  return (f, b) => { if (!paused && f.type === 'design-agent' && f.role === 'builder') { paused = true; b.pauseForDrain(); } };
};
test('a builder that never started is told its scene\'s new length and its new words on the Continue', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY', onFrame: pauseAtFirstBuilder() });
  assert.deepEqual([getBuild(first.build.id).status, first.prompts.builder('hero')], ['paused', undefined]);
  assert.match(first.prompts.lead, /^This design is a video made of HTML and JavaScript\. worca adds a voice and music\. Aim at the length the brief names\.$/m);
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 12 : 2);
  const seen = [];
  first.build.on('frame', (f) => {
    if (f.type === 'design-sound') seen.push([f.state, f.music, ...(f.state === 'made' ? [getBuild(first.build.id).sections[0].duration] : [])]);
    if (f.type === 'design-section' && f.sectionId === 'hero' && seen.length === 1) seen.push(['section', f.status]);
  });
  await first.build.continue();
  assert.match(first.prompts.builder('hero'), /S\.dur is 12\.8\.\nThe voice speaks in this scene from 0\.35s to 12\.35s\./);
  assert.deepEqual(seen, [['making', true], ['section', 'planned'], ['made', true, 12.8]]);   // the row holds the new length before any builder
});
test('a rehydrated round tells a builder that never started its words, with ElevenLabs not set up', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY', onFrame: pauseAtFirstBuilder() });
  const calls = [];
  const inner = first.build._deps.runClaude;
  const again = DesignBuild.rehydrate({ buildId: first.build.id, deps: soundDeps({ staggerMs: 0, retryDelayMs: 0, soundReady: () => false, runClaude: (o) => { calls.push(o); return inner(o); } }) });
  const frames = [];
  again.on('frame', (f) => frames.push(f));
  await again.continue();
  assert.deepEqual(framesOf(frames, 'design-sound').map((f) => [f.state, f.reasons]), [['failed', ['ElevenLabs is not set up']]]);
  assert.match(promptsOf(calls).builder('hero'), /S\.dur is 4\.\nThe voice speaks in this scene from 0\.35s to 2\.35s\./);
  assert.equal(getBuild(first.build.id).status, 'done');
});
test('a built scene that grew is rebuilt from its first prompt when its builder holds no session', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
  const hero = first.build.snapshot().agents.find((a) => a.sectionId === 'hero');
  updateAgent(hero.agentId, { sessionId: null });                                        // as after a lost session
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 12 : 2);
  const calls = [];
  const inner = first.build._deps.runClaude;
  const again = DesignBuild.rehydrate({ buildId: first.build.id, deps: soundDeps({ staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return inner(o); } }) });
  await again.continue();                                                                // the selection is { features }
  assert.match(promptsOf(calls).builder('hero'), /^Section: hero\n[\s\S]*S\.dur is 12\.8\.\nThe voice speaks in this scene from 0\.35s to 12\.35s\./);
  assert.equal(getBuild(first.build.id).sections.find((s) => s.id === 'hero').status, 'done');
});
test('a builder is told only the words its scene still says, when ElevenLabs is not set up or the stage throws', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
  reset();
  const second = await change(first, { instruction: 'Change features MOCK_ROUND_SAY=features:new-words-for-the-second-scene', sections: ['features'], needsLead: true, deps: { soundReady: () => false } });
  assert.match(second.prompts.lead, /^Sound: voice "Ana"; music: calm$/m);                // the change round's lead knows the film has a voice
  assert.match(second.prompts.builder('hero'),/S\.dur is 4\.\nThe voice speaks in this scene from 0\.35s to 2\.35s\./);   // the same words: its clip stands
  assert.doesNotMatch(second.prompts.builder('features'), /The voice speaks/);           // its clip says the old words
  const third = await change(first, { instruction: 'Tidy hero', sections: ['hero'], needsLead: false, deps: { soundReady: () => { throw new Error('settings unreadable'); } } });
  assert.deepEqual(framesOf(third.frames, 'design-sound').map((f) => f.reasons), [['the sound could not be saved']]);
  assert.match(third.prompts.builder('hero'), /S\.dur is 4\.\nThe voice speaks in this scene from 0\.35s to 2\.35s\./);
  assert.equal(speak.calls.length + compose.calls.length, 0);
});
test('the failed line names each reason once, and the calls carry the round\'s mock mode', async () => {
  speak.fail = new SoundError('ElevenLabs is busy; try again', 503);
  compose.fail = new SoundError('ElevenLabs is busy; try again', 503);
  const { build, frames } = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY', deps: { mock: true } });
  assert.equal(getBuild(build.id).status, 'done');
  const f = framesOf(frames, 'design-sound').at(-1);
  assert.deepEqual([f.state, f.voice, f.music, f.grown, f.reasons], ['failed', { made: 0, reused: 0 }, false, 0, ['ElevenLabs is busy; try again']]);
  assert.deepEqual(build.snapshot().sound, { state: 'failed', voice: { made: 0, reused: 0 }, music: false, grown: 0, reasons: ['ElevenLabs is busy; try again'] });
  assert.deepEqual([...speak.calls, ...compose.calls].map((c) => c.mock), [true, true, true]);
});
test('a halt before the stage starts nothing of it', async () => {
  let stopAtCaps = null;
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features',
    deps: { readCaps: async () => { stopAtCaps?.stop(); return { perRunCapUsd: null, totalCapUsd: null }; } } });
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'failed']);
  reset(); stopAtCaps = first.build;
  await first.build.continue();
  assert.equal(getBuild(first.build.id).status, 'stopped');
  assert.deepEqual([framesOf(first.frames, 'design-sound').map((f) => f.state), speak.calls.length], [['making', 'made'], 0]);
});
test('sound on a design that is not a video changes nothing', async () => {
  const design = newDesign();
  updateDesign(design.id, { sound: ON_CALM });
  const planted = join(workDir(design), 'assets/sound/x.txt');                            // an agent's own folder of that name
  mkdirSync(dirname(planted), { recursive: true });
  writeFileSync(planted, 'x');
  const { build, frames, calls } = newBuild(design, { brief: 'MOCK_SECTIONS=1', deps: soundDeps() });
  assert.equal((await build.run()).status, 'done');
  const prompts = promptsOf(calls);
  assert.equal(prompts.leadSystem, `MOCK_ROLE: design-lead\n${leadSystemPrompt({ kind: 'web' })}`);
  assert.doesNotMatch(prompts.lead, /^Sound:/m);
  assert.deepEqual([speak.calls.length, frames.some((f) => f.type === 'design-sound'), build.snapshot().sound], [0, false, null]);
  assert.equal(readFileSync(planted, 'utf8'), 'x');                                      // never removed: only a video's round owns it
});

// Review cycle 1: a grown scene's brief is kept on its record until its builder received it, so no halt, restart or lost
// session loses it; a design without sound never shows a sound line; the settle after the stage waits for the desk.
/** A machine slot that runs `drainAt.pauseForDrain()` once while a builder waits in it, so no process starts. */
const drainInSlot = () => {
  const slot = { at: null };
  slot.acquireGlobal = async () => { const b = slot.at; slot.at = null; b?.pauseForDrain(); };
  return slot;
};
const NEW_VOICE = { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } };
const heroGrows = () => { reset(); speak.secondsFor = (text) => (text.includes('one') ? 12 : 2); };   // hero's new clip needs 12.8 s
const heroOf = (build) => getBuild(build.id).sections.find((s) => s.id === 'hero');
const GROWN = 'This scene is now 12.8s long (it was 4s) so its voice fits. Stretch its timeline to the new length and change nothing else.';

test('a grown scene whose rework the halt cut while it waited for the machine slot is reworked on the next Continue', async () => {
  const slot = drainInSlot();
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features', deps: { acquireGlobal: slot.acquireGlobal } });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const n = first.calls.length;
  slot.at = first.build;
  assert.deepEqual(await first.build.continue(), { status: 'paused', reason: 'drain' });
  assert.deepEqual([first.calls.length, speak.calls.length, heroOf(first.build).duration], [n, 2, 12.8]);   // grown, no process started
  assert.equal(Object.hasOwn(heroOf(first.build), 'regrow'), true);                      // the build row keeps what hero is owed
  assert.equal(first.build.snapshot().sections.some((x) => Object.hasOwn(x, 'regrow')), false);
  reset();
  // The row marks the stretch received as hero's process receives it, before the section is judged: a crash then sends
  // it no more, yet the scene still owes it until it is built.
  const inner = first.build._deps.runClaude;
  let kept = null;
  first.build._deps.runClaude = async (o) => {
    const out = await inner(o);
    if (basename(o.cwd) === 'hero' && o.prompt.includes(GROWN)) kept ??= heroOf(first.build).regrow;
    return out;
  };
  assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  assert.deepEqual(kept, { from: 4, to: 12.8, rework: true, received: true });
  assert.equal(speak.calls.length, 0);                                                   // plan.json is grown: nothing grows again
  assert.match(first.prompts.builder('hero'), /^Rework: This scene is now 12\.8s long \(it was 4s\) so its voice fits\./);
  assert.equal(Object.hasOwn(heroOf(first.build), 'regrow'), false);                     // gone once hero was built at its length
  assert.equal(first.frames.some((f) => JSON.stringify(f).includes('"regrow"')), false);   // and it never left the engine
});
test('a scene that grows again before its builder heard of it is still reworked, from the length it was built for', async () => {
  const slot = drainInSlot();
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features', deps: { acquireGlobal: slot.acquireGlobal } });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  slot.at = first.build;
  assert.deepEqual(await first.build.continue(), { status: 'paused', reason: 'drain' });   // hero: 4 s -> 12.8 s, not yet told
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-3', name: 'Cy' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 15 : 2);                 // and now 15.8 s
  assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  assert.match(first.prompts.builder('hero'), /^Rework: This scene is now 15\.8s long \(it was 4s\) so its voice fits\./);
});
test('a restart after the stage keeps a cut-off scene\'s brief: the rehydrated round sends it', async () => {
  const slot = drainInSlot();
  let cut = false;
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY MOCK_HANG_SECTION=hero', deps: { acquireGlobal: slot.acquireGlobal },
    onFrame: (f, b) => { if (!cut && f.type === 'design-delta' && f.sectionId === 'hero') { cut = true; setImmediate(() => b.pauseForDrain()); } } });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  slot.at = first.build;
  assert.deepEqual(await first.build.continue(), { status: 'paused', reason: 'drain' });
  reset();
  const calls = [];
  const inner = first.build._deps.runClaude;
  const again = DesignBuild.rehydrate({ buildId: first.build.id, deps: soundDeps({ staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return inner(o); } }) });
  assert.deepEqual(await again.continue(), { status: 'done', reason: null });
  assert.equal(promptsOf(calls).builder('hero'), `${continuePrompt({ role: 'builder' })}\n${GROWN}`);
});
test('a reworked builder whose session is lost starts again at the scene\'s new length', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const n = first.calls.length;
  mockDesignTesting.lost.add(hero.sessionId);
  try {
    assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  } finally {
    mockDesignTesting.lost.delete(hero.sessionId);
  }
  const heroCalls = first.calls.slice(n).filter((c) => basename(c.cwd) === 'hero');
  assert.deepEqual(heroCalls.map((c) => Boolean(c.resumeSessionId)), [true, false]);
  assert.match(heroCalls[0].prompt, /^Rework: This scene is now 12\.8s long/);
  assert.match(heroCalls[1].prompt, /^Section: hero\n[\s\S]*S\.dur is 12\.8\.\nThe voice speaks in this scene from 0\.35s to 12\.35s\./);
  assert.equal(Object.hasOwn(heroOf(first.build), 'regrow'), false);
});
test('a grown scene whose builder still waits on its question is told the new length with the answers', async () => {
  let asked = false; let failed = false; let paused = false;
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_ASK_SECTION=hero MOCK_FAIL_SECTION=features',
    onFrame: (f, b) => {
      if (f.type === 'design-question') asked = true;
      if (f.type === 'design-section' && f.sectionId === 'features' && f.status === 'failed') failed = true;
      if (asked && failed && !paused) { paused = true; setImmediate(() => b.pauseForDrain()); }
    } });
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'drain']);
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const k = first.frames.length;
  const c = first.build.continue();
  const q = await waitForFrame(first.frames, (f, i) => i >= k && f.type === 'design-question');
  first.build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await c, { status: 'done', reason: null });
  assert.match(first.prompts.builder('hero'), new RegExp(`^Answers to your questions:\\n[\\s\\S]*Go on with your task, using these answers\\.\\n${GROWN.replace(/[.()]/g, '\\$&')}$`));
  assert.equal(Object.hasOwn(heroOf(first.build), 'regrow'), false);
});

// Review cycle 2: a stretch a scene is owed outlives the build that grew it. A build that closes before the scene's
// builder heard of it hands it to the next round as the scene's change todo (`grown`), beside the round's own brief.
const GROWN_RE = GROWN.replace(/[.()]/g, '\\$&');
/** A first build whose hero grew from 4 s to 12.8 s on a Continue the drain cut before hero's builder heard of it,
 *  then stopped: the stretch is owed on a closed build. */
async function grownThenStopped() {
  const slot = drainInSlot();
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features', deps: { acquireGlobal: slot.acquireGlobal } });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  slot.at = first.build;
  assert.deepEqual(await first.build.continue(), { status: 'paused', reason: 'drain' });
  assert.equal(Object.hasOwn(heroOf(first.build), 'regrow'), true);
  assert.deepEqual(await first.build.stop(), { status: 'stopped', reason: 'user' });
  reset();
  return first;
}
test('a stretch owed on a closed build is sent in the next lead-less round, whether it names that scene or another', async () => {
  for (const [sections, change1] of [[['features'], 'Tidy features'], [['hero'], 'Tidy hero']]) {
    const first = await grownThenStopped();
    const second = await change(first, { instruction: change1, sections, needsLead: false });
    assert.deepEqual([speak.calls.length, framesOf(second.frames, 'design-sound').at(-1).grown], [0, 0], change1);   // plan.json is grown: nothing grows again
    const hero = second.prompts.builder('hero');
    assert.match(hero, new RegExp(`^Change: ${change1}\\n`), change1);
    assert.match(hero, /S\.dur is 12\.8\.\nThe voice speaks in this scene from 0\.35s to 12\.35s\./, change1);
    assert.match(hero, new RegExp(`^For this section: ${GROWN_RE}$`, 'm'), change1);
    assert.deepEqual(heroOf(second.build).todo, { stage: 'change' }, change1);           // built at its length: the stretch is paid
    assert.equal(heroOf(second.build).status, 'done', change1);
    assert.equal(second.frames.some((f) => JSON.stringify(f).includes('"grown":{')), false, change1);   // the todo never leaves the engine
  }
});
test('a lead that touches a scene owed a stretch: its builder gets the touch and the stretch, and a re-applied round keeps one of each', async () => {
  const first = await grownThenStopped();
  const second = await change(first, { instruction: 'Warmer', needsLead: true });       // the mock lead touches hero: 'Mock touch'
  assert.match(second.prompts.builder('hero'), new RegExp(`^For this section: Mock touch\\n${GROWN_RE}$`, 'm'));
  assert.deepEqual(heroOf(second.build).todo, { stage: 'change', brief: 'Mock touch' });  // built at its length: the stretch is paid
  // As after a crash before the lead row went done: the round applied again over the records it was applied to once.
  const round2 = { touch: [{ id: 'hero', brief: 'Mock touch' }], add: [], remove: [] };
  Object.assign(second.build._sections.find((s) => s.id === 'hero'), { status: 'planned', todo: { stage: 'change', grown: { from: 4, to: 12.8 } } });
  second.build._applyRound(round2);
  second.build._applyRound(round2);
  assert.deepEqual(heroOf(second.build).todo, { stage: 'change', brief: 'Mock touch', grown: { from: 4, to: 12.8 } });
});
test('a change round that grew a scene it never built, stopped before that builder started: the next round builds it', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const slot = drainInSlot();
  const second = newBuild(getDesign(first.design.id), { kind: 'change', instruction: 'Tidy features', sections: ['features'], needsLead: false, deps: soundDeps({ acquireGlobal: slot.acquireGlobal }) });
  slot.at = second.build;
  assert.deepEqual(await second.build.run(), { status: 'paused', reason: 'drain' });
  assert.deepEqual([speak.calls.length, heroOf(second.build).status, heroOf(second.build).todo], [2, 'planned', { stage: 'change', grown: { from: 4, to: 12.8 } }]);
  assert.deepEqual(await second.build.stop(), { status: 'stopped', reason: 'user' });
  reset();
  const third = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.deepEqual([speak.calls.length, framesOf(third.frames, 'design-sound').at(-1).grown], [0, 0]);
  assert.match(third.prompts.builder('hero'), new RegExp(`^For this section: ${GROWN_RE}$`, 'm'));
  assert.equal(heroOf(third.build).status, 'done');
});
test('a stretch owed on a closed build that grows again in the next round is told from the length it was built for', async () => {
  const first = await grownThenStopped();
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-3', name: 'Cy' } } });
  speak.secondsFor = (text) => (text.includes('one') ? 15 : 2);                          // and now 15.8 s
  const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(framesOf(second.frames, 'design-sound').at(-1).grown, 1);
  assert.match(second.prompts.builder('hero'), /^For this section: This scene is now 15\.8s long \(it was 4s\) so its voice fits\./m);
});
test('a stretch that reached its builder is not sent again in the next round', async () => {
  const first = await grownThenStopped();
  const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(heroOf(second.build).status, 'done');
  // Features was never built (its first build failed, then the drain cut it), so its change fails: the round pauses.
  assert.deepEqual([getBuild(second.build.id).status, getBuild(second.build.id).reason], ['paused', 'failed']);
  assert.deepEqual(await second.build.stop(), { status: 'stopped', reason: 'user' });
  const third = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(third.prompts.builder('hero'), undefined);
  assert.equal(Object.hasOwn(heroOf(third.build), 'todo'), false);
});
test('the grown records are written before plan.json: a row write that fails leaves a plan the next round grows again', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const error = console.error;
  console.error = () => {};
  prepare("CREATE TEMP TRIGGER design_sound_no_regrow BEFORE UPDATE OF sections_json ON design_builds WHEN NEW.sections_json LIKE '%regrow%' BEGIN SELECT RAISE(ABORT, 'regrow refused'); END").run();
  try {
    assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  } finally {
    prepare('DROP TRIGGER IF EXISTS design_sound_no_regrow').run();
    console.error = error;
  }
  assert.deepEqual(framesOf(first.frames, 'design-sound').at(-1).reasons, ['the sound could not be saved']);
  assert.equal(JSON.parse(readFileSync(join(workDir(first.design), 'plan.json'), 'utf8')).sections[0].duration, 4);
  reset();
  const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(framesOf(second.frames, 'design-sound').at(-1).grown, 1);
  assert.match(second.prompts.builder('hero'), new RegExp(`^For this section: ${GROWN_RE}$`, 'm'));
});
test('a builder in a session whose clip was made again is restarted, should its session be lost, at the new cue times', async () => {
  let cut = false;
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY MOCK_HANG_SECTION=hero',
    onFrame: (f, b) => { if (!cut && f.type === 'design-delta' && f.sectionId === 'hero') { cut = true; setImmediate(() => b.pauseForDrain()); } } });
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'drain']);
  const hero = listAgents(first.build.id).find((a) => a.sectionId === 'hero');
  updateDesign(first.design.id, { sound: NEW_VOICE });
  reset(); speak.secondsFor = () => 3;                                                   // a new clip that still fits hero's 4 s
  const n = first.calls.length;
  mockDesignTesting.lost.add(hero.sessionId);
  try {
    assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  } finally {
    mockDesignTesting.lost.delete(hero.sessionId);
  }
  assert.equal(framesOf(first.frames, 'design-sound').at(-1).grown, 0);
  const heroCalls = first.calls.slice(n).filter((c) => basename(c.cwd) === 'hero');
  assert.deepEqual(heroCalls.map((c) => Boolean(c.resumeSessionId)), [true, false]);
  assert.match(heroCalls[1].prompt, /S\.dur is 4\.\nThe voice speaks in this scene from 0\.35s to 3\.35s\./);
});

// Review cycle 3: a stretch lasts until its scene is built at the new length. A builder that received it and was cut
// (a Stop, its agent stopped, a drain) still owes it, and the next round tells it again; once the scene is built the
// stretch is gone, so neither a later round nor a fresh restart of a later rework is told it again.
/** Wraps `build`'s runClaude (read at every spawn) so the first hero process whose prompt starts with `start` runs
 *  `act(build)` right after its session event reached the build: the receipt (`_spawnOnce`'s `onReceive`) has run. The
 *  mock checks its abort after every frame, so a halt there ends the process before its next. A listener's throw is
 *  swallowed, so `at.regrow` keeps the row's mark at that moment for the test to assert afterwards. */
const atHeroReceipt = (build, start, act) => {
  const inner = build._deps.runClaude;
  const at = { done: false, regrow: undefined };
  build._deps.runClaude = (o) => {
    if (at.done || basename(o.cwd) !== 'hero' || !o.prompt.startsWith(start)) return inner(o);
    return inner({ ...o, onEvent: (evt) => {
      o.onEvent(evt);
      if (at.done || evt?.type !== 'session' || evt.parentId != null) return;
      at.done = true;
      at.regrow = heroOf(build).regrow;
      act(build);
    } });
  };
  return at;
};
/** A change round with a lead ('Warmer': the mock lead touches hero) whose integrate pass sends hero back ('Rework: Mock
 *  rework'). The integrate prompt carries no brief, so the token the mock reads there first is added to it. */
function warmerWithRework(first) {
  const second = newBuild(getDesign(first.design.id), { kind: 'change', instruction: 'Warmer', needsLead: true, deps: soundDeps() });
  const inner = second.build._deps.runClaude;
  second.build._deps.runClaude = (o) => inner(o.prompt.startsWith('The builders are done') ? { ...o, prompt: `${o.prompt}\nMOCK_REWORK=hero` } : o);
  return second;
}
test('a grown scene whose builder received its stretch, then was stopped (the round, or its agent), is told it again in the next round', async () => {
  for (const [how, end] of [['round', { status: 'stopped', reason: 'user' }], ['agent', { status: 'done', reason: 'partial' }]]) {
    const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
    updateDesign(first.design.id, { sound: NEW_VOICE });
    heroGrows();
    const heroId = first.build.snapshot().agents.find((a) => a.sectionId === 'hero').agentId;
    const at = atHeroReceipt(first.build, 'Rework: This scene is now', (b) => { if (how === 'round') void b.stop(); else b.stopAgent(heroId); });
    assert.deepEqual(await first.build.continue(), end, how);                              // L2.22: a stopped agent holds no round up
    assert.deepEqual(at.regrow, { from: 4, to: 12.8, rework: true, received: true }, how);   // received, written at once, kept
    assert.equal(heroOf(first.build).status, 'stopped', how);
    reset();
    const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
    assert.match(second.prompts.builder('hero'), new RegExp(`^For this section: ${GROWN_RE}$`, 'm'), how);
    assert.deepEqual([heroOf(second.build).status, heroOf(second.build).todo], ['done', { stage: 'change' }], how);
  }
});
test('a grown scene\'s builder cut just after it received its stretch resumes on the continue prompt, and the built scene owes nothing', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  atHeroReceipt(first.build, 'Rework: This scene is now', (b) => b.pauseForDrain());
  assert.deepEqual(await first.build.continue(), { status: 'paused', reason: 'drain' });
  reset();
  const n = first.calls.length;
  assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  assert.deepEqual(first.calls.slice(n).filter((c) => basename(c.cwd) === 'hero').map((c) => c.prompt), [continuePrompt({ role: 'builder' })]);   // its session holds the stretch
  assert.equal(Object.hasOwn(heroOf(first.build), 'regrow'), false);
});
test('a scene built at its new length owes nothing: a Stop in its later rework sends no stretch in the next round', async () => {
  const first = await grownThenStopped();
  const second = warmerWithRework(first);
  const at = atHeroReceipt(second.build, 'Rework: Mock rework', (b) => { void b.stop(); });
  assert.deepEqual(await second.build.run(), { status: 'stopped', reason: 'user' });
  const heroCalls = second.calls.filter((c) => basename(c.cwd) === 'hero');
  assert.deepEqual([at.done, heroCalls.map((c) => c.prompt.split('\n')[0])], [true, ['Change: Warmer', 'Rework: Mock rework']]);
  assert.match(heroCalls[0].prompt, new RegExp(`^For this section: Mock touch\\n${GROWN_RE}$`, 'm'));
  assert.deepEqual([heroOf(second.build).status, heroOf(second.build).todo], ['stopped', { stage: 'change', brief: 'Mock touch' }]);
  const third = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(third.prompts.builder('hero'), undefined);
});
test('a scene built at its new length whose later rework loses its session starts again without the stretch', async () => {
  const first = await grownThenStopped();
  const second = warmerWithRework(first);
  const inner = second.build._deps.runClaude;
  let lost = null;
  second.build._deps.runClaude = (o) => {
    if (!lost && o.prompt.startsWith('The builders are done')) {
      lost = listAgents(second.build.id).find((a) => a.sectionId === 'hero').sessionId;
      mockDesignTesting.lost.add(lost);
    }
    return inner(o);
  };
  try {
    assert.deepEqual(await second.build.run(), { status: 'done', reason: 'partial' });  // features stays stopped
  } finally {
    mockDesignTesting.lost.delete(lost);
  }
  const heroCalls = second.calls.filter((c) => basename(c.cwd) === 'hero');
  assert.deepEqual(heroCalls.map((c) => [c.prompt.split('\n')[0], Boolean(c.resumeSessionId)]), [['Change: Warmer', false], ['Rework: Mock rework', true], ['Change: Warmer', false]]);
  assert.match(heroCalls[2].prompt, /^For this section: Mock touch$/m);
  assert.doesNotMatch(heroCalls[2].prompt, /This scene is now/);
});
test('a change round\'s builder whose scene grew while it held a session restarts, should that session be lost, told the stretch', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
  const second = newBuild(getDesign(first.design.id), { kind: 'change', instruction: 'Tidy hero', sections: ['hero'], needsLead: false, deps: soundDeps() });
  atHeroReceipt(second.build, 'Change: Tidy hero', (b) => b.pauseForDrain());
  assert.deepEqual(await second.build.run(), { status: 'paused', reason: 'drain' });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const hero = listAgents(second.build.id).find((a) => a.sectionId === 'hero');
  const n = second.calls.length;
  mockDesignTesting.lost.add(hero.sessionId);
  try {
    assert.deepEqual(await second.build.continue(), { status: 'done', reason: null });
  } finally {
    mockDesignTesting.lost.delete(hero.sessionId);
  }
  const heroCalls = second.calls.slice(n).filter((c) => basename(c.cwd) === 'hero');
  assert.deepEqual(heroCalls.map((c) => Boolean(c.resumeSessionId)), [true, false]);
  assert.equal(heroCalls[0].prompt, `${continuePrompt({ role: 'builder' })}\n${GROWN}`);
  assert.match(heroCalls[1].prompt, /^Change: Tidy hero\n/);
  assert.match(heroCalls[1].prompt, new RegExp(`^For this section: ${GROWN_RE}$`, 'm'));
  assert.deepEqual([heroOf(second.build).todo, Object.hasOwn(heroOf(second.build), 'regrow')], [{ stage: 'change' }, false]);
});
test('a scene that owes a carried stretch and grows again while its builder holds a session is told from the length its files were built for', async () => {
  const first = await grownThenStopped();
  const second = newBuild(getDesign(first.design.id), { kind: 'change', instruction: 'Tidy features', sections: ['features'], needsLead: false, deps: soundDeps() });
  atHeroReceipt(second.build, 'Change: Tidy features', (b) => b.pauseForDrain());
  assert.equal((await second.build.run()).status, 'paused');
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-3', name: 'Cy' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 15 : 2);                 // and now 15.8 s
  await second.build.continue();
  const told = 'This scene is now 15.8s long (it was 4s) so its voice fits. Stretch its timeline to the new length and change nothing else.';
  assert.equal(promptsOf(second.calls).builder('hero'), `${continuePrompt({ role: 'builder' })}\n${told}`);
});
test('a scene whose builder received its stretch, then lost its session, grown again: still owed at the new length', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY MOCK_FAIL_SECTION=features' });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  atHeroReceipt(first.build, 'Rework: This scene is now', (b) => b.pauseForDrain());
  assert.deepEqual(await first.build.continue(), { status: 'paused', reason: 'drain' });
  updateAgent(first.build.snapshot().agents.find((a) => a.sectionId === 'hero').agentId, { sessionId: null });   // as after a lost session
  updateDesign(first.design.id, { sound: { ...ON_CALM, voice: { id: 'mock-voice-3', name: 'Cy' } } });
  reset(); speak.secondsFor = (text) => (text.includes('one') ? 15 : 2);                 // and now 15.8 s
  const again = DesignBuild.rehydrate({ buildId: first.build.id, deps: soundDeps({ staggerMs: 0, retryDelayMs: 0, runClaude: first.build._deps.runClaude }) });
  const at = atHeroReceipt(again, 'Section: hero', (b) => { void b.stop(); });          // its fresh first build, at 15.8 s
  assert.deepEqual(await again.continue(), { status: 'stopped', reason: 'user' });
  assert.deepEqual(at.regrow, { from: 4, to: 15.8, rework: true, received: true });
  reset();
  const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.match(second.prompts.builder('hero'), /^For this section: This scene is now 15\.8s long \(it was 4s\) so its voice fits\./m);
});
test('a stretch owed on a closed build is not sent once plan.json no longer holds its length (an earlier version restored)', async () => {
  const first = await grownThenStopped();
  const file = join(workDir(first.design), 'plan.json');
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  plan.sections.find((s) => s.id === 'hero').duration = 4;                              // as restoreVersion puts back an earlier work/
  writeFileSync(file, JSON.stringify(plan));
  updateDesign(first.design.id, { sound: { on: false } });
  const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(second.prompts.builder('hero'), undefined);
  assert.equal(Object.hasOwn(heroOf(second.build), 'todo'), false);
});

// Review cycle 4: a grown scene is never left to no round. A restored version puts back a length its owed stretch no
// longer matches, so the next round carries no stretch; should the scene grow again there, that round rebuilds it. A
// scene no builder ever worked on has no files to change, so a change round never takes it for growing.
test('a scene whose owed stretch a restored version dropped, grown again by the same voice, is rebuilt with the stretch', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY' });
  const v1 = await snapshotVersion({ designId: first.design.id });
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const slot = drainInSlot();
  const second = newBuild(getDesign(first.design.id), { kind: 'change', instruction: 'Tidy features', sections: ['features'], needsLead: false, deps: soundDeps({ acquireGlobal: slot.acquireGlobal }) });
  slot.at = second.build;
  assert.deepEqual(await second.build.run(), { status: 'paused', reason: 'drain' });
  assert.deepEqual(await second.build.stop(), { status: 'stopped', reason: 'user' });
  assert.deepEqual(heroOf(second.build).todo, { stage: 'change', grown: { from: 4, to: 12.8 } });
  await restoreVersion({ designId: first.design.id, n: v1 });                             // plan.json and hero's files at 4 s again
  heroGrows();
  const third = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(framesOf(third.frames, 'design-sound').at(-1).grown, 1);
  const hero = third.prompts.builder('hero') ?? '';
  assert.match(hero, /^Change: Tidy features\n/);
  assert.match(hero, /S\.dur is 12\.8\.\nThe voice speaks in this scene from 0\.35s to 12\.35s\./);
  assert.match(hero, new RegExp(`^For this section: ${GROWN_RE}$`, 'm'));
  assert.deepEqual([heroOf(third.build).status, heroOf(third.build).todo], ['done', { stage: 'change' }]);
});
test('a scene no builder ever worked on that grows in a change round naming another is not sent a change', async () => {
  const slot = drainInSlot();
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=2 MOCK_SAY', deps: { acquireGlobal: slot.acquireGlobal },
    until: () => !slot.at, then: (b) => { slot.at = b; } });                              // the drain lands in the first builder's slot wait
  assert.deepEqual([getBuild(first.build.id).status, getBuild(first.build.id).reason], ['paused', 'drain']);
  assert.deepEqual(await first.build.stop(), { status: 'stopped', reason: 'user' });
  assert.deepEqual([heroOf(first.build).status, heroOf(first.build).agentId], ['planned', null]);
  updateDesign(first.design.id, { sound: NEW_VOICE });
  heroGrows();
  const second = await change(first, { instruction: 'Tidy features', sections: ['features'], needsLead: false });
  assert.equal(framesOf(second.frames, 'design-sound').at(-1).grown, 1);
  assert.equal(second.prompts.builder('hero'), undefined);
  assert.equal(Object.hasOwn(heroOf(second.build), 'todo'), false);
});

/** POSIX and not root: a folder worca itself cannot empty. */
const LOCKED = { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a locked folder' : false };
/** Every folder below `dir` made writable again, so the design's temp home can be removed. */
function unlockAll(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    chmodSync(join(dir, e.name), 0o755);
    unlockAll(join(dir, e.name));
  }
}
test('a video without sound sends no sound line, even when worca cannot empty or move assets/sound', LOCKED, async () => {
  // An agent's folder inside it (set aside), then a read-only assets/ (removeSound throws: the stage only logs it).
  for (const locked of ['assets/sound/locked', 'assets']) {
    const design = newDesign({ kind: 'video' });
    mkdirSync(join(workDir(design), 'assets/sound/locked'), { recursive: true });
    writeFileSync(join(workDir(design), 'assets/sound/locked/f'), 'x');
    chmodSync(join(workDir(design), locked), 0o555);
    const [warn, error] = [console.warn, console.error];
    console.warn = () => {};
    console.error = () => {};
    try {
      const { build, frames } = newBuild(design, { brief: 'A film MOCK_SECTIONS=1 MOCK_SAY', deps: soundDeps() });
      assert.deepEqual(await build.run(), { status: 'done', reason: null }, locked);
      assert.equal(frames.some((f) => f.type === 'design-sound'), false, locked);
      assert.equal(build.snapshot().sound, null, locked);
    } finally {
      [console.warn, console.error] = [warn, error];
      unlockAll(designDir(design.id));
    }
  }
});
test('sound turned off between a pause and a Continue: a builder that never started is told no clip, and no old line stays', async () => {
  const first = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY', onFrame: pauseAtFirstBuilder() });
  assert.equal(first.build.snapshot().sound.state, 'made');
  updateDesign(first.design.id, { sound: { on: false } });
  assert.deepEqual(await first.build.continue(), { status: 'done', reason: null });
  assert.doesNotMatch(first.prompts.builder('hero'), /The voice speaks/);
  assert.equal(first.build.snapshot().sound, null);
  assert.equal(existsSync(join(workDir(first.design), 'assets/sound')), false);
});

// A halt inside the stage with the picture desk open (design-build-pictures 7, 7c, 8): the settle waits for the desk.
const kit = (cwd, args) => new Promise((res) => execFile(process.execPath, [join(cwd, '.kit/picture.mjs'), ...args], { cwd }, (err, out) => res({ code: err ? err.code : 0, out })));
const planning = (o) => o.prompt.startsWith('Plan a new design') && /^Picture kit: \.kit\/picture\.mjs$/m.test(o.prompt);
/** A `generatePicture` that hangs until its call is aborted, then rejects as an abort `lag` ms later. */
const hanging = (lag) => {
  const h = { signal: null };
  h.deps = {
    imagesReady: () => true,
    generatePicture: ({ signal }) => new Promise((_, rej) => {
      h.signal = signal;
      signal.addEventListener('abort', () => setTimeout(() => rej(abortError()), lag));
    }),
  };
  return h;
};
/** The lead's plan stage asks for a picture and waits 200 ms only (exit 3: still in the making), once the call started. */
const askingLong = (h, seen) => async (o) => {
  if (planning(o)) {
    seen.push(await kit(o.cwd, ['--wait-ms', '200', 'a', 'wide', 'A test picture of a, no text']));
    await waitUntil(() => h.signal !== null);
  }
  return runClaude({ ...o, mock: true });
};
test('a halt inside the stage settles only once the picture desk closed', async () => {
  for (const [halt, end] of [[(b) => b.stop(), ['stopped', 'user']], [(b) => b.pauseForDrain(), ['paused', 'drain']]]) {
    const h = hanging(300);
    const seen = [];
    const t = await round({ sound: ON_CALM, brief: 'A film MOCK_SECTIONS=1 MOCK_SAY', deps: { ...h.deps, runClaude: askingLong(h, seen) }, until: () => true, then: halt });
    assert.equal(seen[0].code, 3);                                                       // the picture was still in the making
    assert.deepEqual(framesOf(t.frames, 'design-sound').map((f) => f.state), ['making']);   // the halt landed in the stage
    assert.ok(existsSync(join(picturesDir(t.design.id), 'a.done.json')));
    const last = (type) => t.frames.findLastIndex((f) => f.type === type);
    assert.ok(last('design-picture') < last('design-build'), 'no picture frame after the terminal one');
    assert.deepEqual([t.frames.at(-1).type, t.frames.at(-1).status, t.frames.at(-1).reason], ['design-build', ...end]);
    reset();
  }
});
