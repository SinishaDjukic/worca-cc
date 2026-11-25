// src/core/design/chat-actions.mjs
// The hand-off from a design chat to the engine (P5 Task 7). A start_design_build or change_design request becomes
// one `designBuilds.start` call, with no confirm card (L11): the kit and the thread's uploads are staged in the
// source folder first, and the upload names join the brief or instruction (L5.5). An accepted round answers a running
// `design-round` card; every refusal is a notice for the chat and no card.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentNote, designRoundSummary, validateDesignRequest } from '../ask/design-payload.mjs';
import { getThread } from '../ask/store.mjs';
import { copyThreadAttachments } from './attachments.mjs';
import { designBuildModels, designIdForThread } from './chat-thread.mjs';
import { designWorkDir, ensureDesignFolders } from './paths.mjs';
import { validatePlan } from './plan.mjs';
import { getDesign, updateDesign } from './store.mjs';

/** P2's refusal for this design's own open build (`registry.mjs` `start`), paused included. */
const OPEN_BUILD_PREFIX = 'This design already has a build open';

const notice = (text) => ({ ok: false, notice: text });
const messageOf = (err) => (err instanceof Error ? err.message : String(err));

/** The section ids of the design's plan.json, or null when it is missing or not valid (P2 then refuses with its 422). */
function planSectionIds(design, workDir) {
  let text;
  try { text = readFileSync(join(workDir, 'plan.json'), 'utf8'); } catch { return null; }
  const check = validatePlan(text, { kind: design.kind });
  return check.ok ? check.plan.sections.map((s) => s.id) : null;
}

/** What the chat says when `designBuilds.start` refuses (L5.20); `what` is 'build' or 'change'. Shaper's Prototype
 *  step (C1, D6) shows the same words. */
export function refusalNotice(err, what) {
  const status = err?.status;
  const message = messageOf(err);
  if (status === 409) {
    return message.startsWith(OPEN_BUILD_PREFIX) ? 'A build is already open: wait for it, or press Resume or Stop.' : message;
  }
  if (status === 403) return 'Total cost limit reached: no build started.';
  if (status === 503) return message;
  return `Could not start the ${what}: ${message}.`;
}

/**
 * The hand-off of one round (C1, D6, shared by the chat and Shaper's Prototype step): stages the kit, makes the design's
 * folders real, runs `beforeStart` (the chat copies its uploads), then starts the round, all while the design is held
 * against a restore (M3). A file system error names server paths: the log keeps it, the caller gets words. The folders
 * are made real first (`ensureDesignFolders`): a link or a file an agent planted at `assets` or `assets/att` would
 * otherwise refuse this and every later copy, and only a started round makes them again.
 * @param {{ designBuilds: object, stageKit: Function, design: {id: string, kind: string, version?: number}, what: string,
 *   opts: object | ((before: unknown) => object), beforeStart?: {run: Function, label: string, refused: string} | null }} a
 * @returns {Promise<{ok: true, started: {buildId: string, round: number, kind: string}, baseVersion: number}
 *   | {ok: false, notice: string, status?: number}>} `status` is the refusal's HTTP status, when it has one.
 */
export async function startHeldRound({ designBuilds, stageKit, design, what, opts, beforeStart = null }) {
  const workDir = designWorkDir(design.id);
  const handOff = async () => {
    try {
      await stageKit({ kind: design.kind, workDir });
    } catch (err) {
      console.error(`[worca-design] staging the kit of ${design.id} failed: ${messageOf(err)}`);
      return { refused: `Could not prepare the ${what}: try again.` };
    }
    let before;
    try {
      ensureDesignFolders(design.id);
      before = beforeStart ? await beforeStart.run({ workDir }) : undefined;
    } catch (err) {
      console.error(`[worca-design] ${beforeStart ? beforeStart.label : 'making the folders'} of ${design.id} failed: ${messageOf(err)}`);
      return { refused: beforeStart ? beforeStart.refused : `Could not prepare the ${what}: try again.` };
    }
    // Read now, not with the caller's row: a restore may have ended meanwhile, and none runs while held.
    const baseVersion = getDesign(design.id)?.version ?? design.version;
    return { started: await designBuilds.start(typeof opts === 'function' ? opts(before) : opts), baseVersion };
  };
  let held;
  try {
    held = await designBuilds.whileStarting(design.id, handOff);
  } catch (err) {
    return { ok: false, notice: refusalNotice(err, what), ...(Number.isInteger(err?.status) ? { status: err.status } : {}) };
  }
  if (held.refused) return { ok: false, notice: held.refused };
  return { ok: true, started: held.started, baseVersion: held.baseVersion };
}

/**
 * @param {{
 *   designBuilds: { start: (opts: object) => Promise<{ buildId: string, round: number, kind: string }>,
 *     whileStarting: <T>(designId: string, fn: () => Promise<T>) => Promise<T> },
 *   receipts: { posted: (buildId: string) => void },
 *   flagOn: () => boolean,
 *   brokerRefusal: (thread: object, modelIds: string[]) => Promise<string|null>,
 *   appendCardRow: (threadId: string, block: object) => void,
 *   newCardId: () => string,
 *   stageKit: (opts: { kind: string, workDir: string }) => Promise<unknown>,
 *   soundCards?: object|null,
 * }} deps  `soundCards` (Design sound): a video's first start asks about sound first; absent, every start runs as it is.
 * @returns {{ apply: (req: object, ctx: { threadId: string, by?: string|null, soundDecided?: boolean }) => Promise<
 *   { ok: false, notice: string } | { ok: true, block: object, posted: (added: boolean) => void }> }}
 *   `soundDecided`: the sound card's own start (`cardStart`), which never meets the card again.
 */
export function createDesignChatActions({ designBuilds, receipts, flagOn, brokerRefusal, appendCardRow, newCardId, stageKit, soundCards = null }) {
  async function apply(req, { threadId, by, soundDecided = false } = {}) {
    if (!flagOn()) return notice('Design is switched off.');
    const designId = designIdForThread(threadId);
    const design = designId ? getDesign(designId) : null;
    const thread = design ? getThread(threadId) : null;
    if (!design || !thread) return notice('This chat has no design.');
    const checked = validateDesignRequest(req);
    // Before anything is staged: a brief or instruction past its limit would only meet P1's BRIEF_MAX at the start.
    if (!checked.ok) return notice(`Could not start the ${req?.kind === 'design-change' ? 'change' : 'build'}: ${checked.error}.`);
    const ask = checked.value;
    const change = ask.kind === 'design-change';
    const workDir = designWorkDir(design.id);
    if (change) {
      const ids = planSectionIds(design, workDir);
      const unknown = ids ? ask.sections.find((id) => !ids.includes(id)) : undefined;
      if (unknown !== undefined) return notice(`Could not start the change: unknown section "${unknown}".`);
    }
    const refusal = await brokerRefusal(thread, designBuildModels(design));
    if (refusal) return notice(refusal);
    if (!change && !soundDecided && soundCards) {
      if (soundCards.holding(threadId)) return notice('The sound card above starts the build when it is answered.');
      // Read again after the broker check's await. Asked once per design (D2): showing card 1 writes `{ on: false }`.
      // No await from here to the return: a second start in the same reply meets the hold, never a second card.
      const fresh = getDesign(design.id);
      if (soundCards.available(fresh) && fresh.sound == null) {
        soundCards.closeGearCards(threadId);
        const block = soundCards.askBlock({ design: fresh, pending: ask });
        updateDesign(design.id, { sound: { on: false } });
        soundCards.hold(threadId);   // last: a throw above leaves no hold
        return {
          ok: true,
          block,
          /** The card is the reply's, or a row of its own; either way the thread holds it now. No kit is staged, no round
           *  starts and no receipt follows: answering the card starts the round with the brief it keeps. */
          posted(added) {
            try {
              if (!added) appendCardRow(threadId, block);
            } finally {
              soundCards.release(threadId);
            }
          },
        };
      }
    }
    const rawText = change ? ask.instruction : ask.brief;
    const pins = Array.isArray(thread.composer?.pins) ? thread.composer.pins : [];
    const what = change ? 'change' : 'build';
    const held = await startHeldRound({
      designBuilds, stageKit, design, what,
      beforeStart: { label: 'copying the uploads', refused: 'Could not copy the attachments: try again.',
        run: ({ workDir: dir }) => copyThreadAttachments({ threadId, workDir: dir }) },
      opts: (names) => {
        const text = rawText + attachmentNote(names);   // within BRIEF_MAX: DESIGN_LIMITS leaves the line its room
        return change
          ? { designId: design.id, instruction: text, sections: ask.sections, needsLead: ask.needsLead, ...(pins.length ? { pins } : {}), by }
          : { designId: design.id, brief: text, by };
      },
    });
    if (!held.ok) return notice(held.notice);
    const { started: { buildId, round, kind }, baseVersion } = held;
    const block = {
      id: newCardId(),
      state: 'running',
      card: { type: 'design-round', designId: design.id, buildId, round, kind, summary: designRoundSummary({ round, kind, text: rawText }), baseVersion },
    };
    return {
      ok: true,
      block,
      /** The finished reply took the card (`added`), or the card goes in as a row of its own; either way the receipt
       *  now follows the build. */
      posted(added) {
        if (!added) appendCardRow(threadId, block);
        receipts.posted(buildId);
      },
    };
  }
  return { apply };
}
