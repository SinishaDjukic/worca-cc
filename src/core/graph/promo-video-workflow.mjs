// src/core/graph/promo-video-workflow.mjs
// The shipped Promo video workflow. Seeded by schema V60 as a v2 row (INSERT OR IGNORE), so a user
// who edits or deletes it keeps their choice; refreshed on later bumps only while the stored shape is
// one worca shipped (PROMO_VIDEO_SHIPPED_FINGERPRINTS), exactly like the Presentation seed.
//
//   Task ─▶ setup (form) ─▶ explore ─▶ write (approval form) ─▶ narrate ─▶ scenes ─▶ review ─pass─▶ render ─▶ End
//   setup ─▶ voices ─▶ voice (form) ─▶ narrate          explore + write ─▶ capture ─▶ scenes
//   setup + explore + write + narrate ─▶ mascot ─▶ scenes
//   review.findings (≤2 cycles) / render.findings (≤1) ─▶ or ─▶ scenes.fixes
//
// The optional steps (voices, voice, mascot) skip themselves with a clean report when the setup
// answers turn them off (a silent video, mascots off), so the graph never branches. The awaitAll
// barriers make every multi-input step wait for all of its inputs on its first run, which is also
// what makes the gates hold: nothing past the setup form starts until it is answered.
import { deepFreeze } from './builtin-workflows.mjs';
import { presentationGraphFingerprint } from './presentation-workflow.mjs';

export const PROMO_VIDEO_WORKFLOW_ID = 'wf_promo_video';

export const GRAPH_PROMO_VIDEO_WORKFLOW = deepFreeze({
  id: PROMO_VIDEO_WORKFLOW_ID,
  name: 'Promo video',
  version: 2,
  domain: 'video',
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    // Gate 1: tone, length, pace, mascots, audio (+ the ElevenLabs key, held as a secret env).
    { id: 'n_setup', kind: 'agent', key: 'promoSetup', x: 320, y: 200, config: { askQuestions: true } },
    { id: 'n_explore', kind: 'agent', key: 'promoExplorer', x: 600, y: 200, config: {} },
    // Gate 3: the narration script + storyboard (approve, or apply my changes).
    { id: 'n_write', kind: 'agent', key: 'promoWriter', x: 880, y: 200, config: { askQuestions: true, awaitAll: true } },
    // awaitAll: the script AND the voice pick (an empty pick on a silent run).
    { id: 'n_narrate', kind: 'script', key: 'promoNarrate', x: 1160, y: 200, config: { awaitAll: true } },
    { id: 'n_capture', kind: 'agent', key: 'promoCapture', x: 1440, y: 200, config: { awaitAll: true } },
    // awaitAll: the first run waits for the timeline, the plates, the mascot and the storyboard; a fix
    // cycle re-fires on the `fixes` loop token alone.
    { id: 'n_scenes', kind: 'agent', key: 'promoScenes', x: 1720, y: 200, config: { awaitAll: true, fanOut: true } },
    { id: 'n_review', kind: 'agent', key: 'promoReview', x: 2000, y: 200, config: {} },
    { id: 'n_render', kind: 'script', key: 'promoRender', x: 2280, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 2560, y: 200, config: {} },
    // The OPTIONAL cards, on a second row like Presentation's n_outputs: each skips itself (a clean
    // "skipped" report) when its setup answer turns it off.
    { id: 'n_voices', kind: 'script', key: 'promoVoices', x: 600, y: 430, config: {} },
    // Gate 2: listen to the matching voices and pick one (no question on a silent run).
    { id: 'n_voice', kind: 'agent', key: 'promoVoice', x: 880, y: 430, config: { askQuestions: true } },
    // awaitAll: also waits for the timeline — the film dir is initialised by the narrate step.
    { id: 'n_mascot', kind: 'agent', key: 'promoMascot', x: 1440, y: 430, config: { awaitAll: true } },
    { id: 'n_or', kind: 'or', x: 2140, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_setup', port: 'task' } },
    { id: 'w2', from: { node: 'n_setup', port: 'answers' }, to: { node: 'n_voices', port: 'answers' } },
    { id: 'w3', from: { node: 'n_voices', port: 'voices' }, to: { node: 'n_voice', port: 'voices' } },
    { id: 'w4', from: { node: 'n_task', port: 'task' }, to: { node: 'n_explore', port: 'task' } },
    { id: 'w5', from: { node: 'n_setup', port: 'answers' }, to: { node: 'n_explore', port: 'answers' } },
    { id: 'w6', from: { node: 'n_task', port: 'task' }, to: { node: 'n_write', port: 'task' } },
    { id: 'w7', from: { node: 'n_explore', port: 'product' }, to: { node: 'n_write', port: 'product' } },
    { id: 'w8', from: { node: 'n_setup', port: 'answers' }, to: { node: 'n_write', port: 'answers' } },
    { id: 'w9', from: { node: 'n_write', port: 'script' }, to: { node: 'n_narrate', port: 'script' } },
    { id: 'w10', from: { node: 'n_voice', port: 'answers' }, to: { node: 'n_narrate', port: 'answers' } },
    { id: 'w11', from: { node: 'n_explore', port: 'runbook' }, to: { node: 'n_capture', port: 'runbook' } },
    { id: 'w12', from: { node: 'n_write', port: 'storyboard' }, to: { node: 'n_capture', port: 'storyboard' } },
    { id: 'w13', from: { node: 'n_explore', port: 'product' }, to: { node: 'n_capture', port: 'product' } },
    { id: 'w14', from: { node: 'n_setup', port: 'answers' }, to: { node: 'n_mascot', port: 'answers' } },
    { id: 'w15', from: { node: 'n_write', port: 'storyboard' }, to: { node: 'n_mascot', port: 'storyboard' } },
    { id: 'w16', from: { node: 'n_explore', port: 'product' }, to: { node: 'n_mascot', port: 'product' } },
    { id: 'w17', from: { node: 'n_narrate', port: 'timeline' }, to: { node: 'n_mascot', port: 'timeline' } },
    { id: 'w18', from: { node: 'n_narrate', port: 'timeline' }, to: { node: 'n_scenes', port: 'timeline' } },
    { id: 'w19', from: { node: 'n_capture', port: 'plates' }, to: { node: 'n_scenes', port: 'plates' } },
    { id: 'w20', from: { node: 'n_mascot', port: 'mascot' }, to: { node: 'n_scenes', port: 'mascot' } },
    { id: 'w21', from: { node: 'n_write', port: 'storyboard' }, to: { node: 'n_scenes', port: 'storyboard' } },
    { id: 'w22', from: { node: 'n_scenes', port: 'film' }, to: { node: 'n_review', port: 'film' } },
    { id: 'w25', from: { node: 'n_review', port: 'findings' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 2 } },
    { id: 'w26', from: { node: 'n_or', port: 'out' }, to: { node: 'n_scenes', port: 'fixes' } },
    // The render runs ONCE per clean review: gated on `await`, it also takes `film` straight from the
    // scenes step inside the fix loop — the Presentation bundle's shape, which cannot re-fire on a fresh
    // payload alone (test/graph-scheduler.test.mjs pins it).
    { id: 'w27', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_render', port: 'await' } },
    { id: 'w28', from: { node: 'n_scenes', port: 'film' }, to: { node: 'n_render', port: 'film' } },
    { id: 'w30', from: { node: 'n_render', port: 'findings' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 1 } },
    { id: 'w31', from: { node: 'n_render', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** Same structural fingerprint as the Presentation seed: sorted node ids + sorted wire ids. */
export const promoVideoGraphFingerprint = presentationGraphFingerprint;

/** Every shape this workflow has been SHIPPED as before the current one, newest last. Empty: the
 *  first shape is the constant above. When the shape changes, append the OUTGOING fingerprint here
 *  and bump SCHEMA_VERSION (the procedure is the one presentation-workflow.mjs documents). */
export const PROMO_VIDEO_SHIPPED_FINGERPRINTS = Object.freeze([]);
