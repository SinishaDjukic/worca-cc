// src/core/design/sound-cards.mjs
// The two sound cards of a Design video (SPEC D1–D4, §5 "Chat cards"). They are worca's cards, not the chat model's:
// `apply` (chat-actions.mjs) puts card 1 in the reply when a video's first build is handed over, and the gear opens it
// again. Answering one goes through the chat's card route and starts no chat model turn: card 1 checks the key by
// listing voices, saves it and appends card 2; card 2 stores the voice and the music on the design and starts the
// round with the brief kept on the card. The key never enters a block or an answer: `answers` holds checked fields only.

import { MUSIC_KINDS } from '../../shared/sound-services.mjs';
import { modelEnvRef } from '../model-env.mjs';
import { SoundError } from '../sound.mjs';

const CARD_TYPE = 'design-sound';
const KEY_MAX = 512;   // settings' SOUND_KEY_MAX, which it does not export
const MUSIC_TEXT_MAX = 300;
const VOICE_NAME_MAX = 80;
const MASKED = '••';

// SPEC §7's words.
const ASK_HEADING = 'Sound for this video';
const PICK_HEADING = 'Voice and music';
const ENTER_KEY = 'Enter your ElevenLabs API key';
const BAD_KEY = 'ElevenLabs rejected this key';
const BAD_SAVED_KEY = 'ElevenLabs rejected the saved key. Enter a new one.';
const UNREACHABLE = 'ElevenLabs could not be reached';
const NO_VOICES = 'This ElevenLabs account has no voice with a sample';
const PICK_VOICE = 'Pick a voice';
const SAY_MUSIC = 'Say what the music should sound like';
const MUSIC_TOO_LONG = 'Keep the music description under 300 characters';
// Not a §7 string: only a hand-made request reaches it (the card's Continue stays disabled until a tile is picked).
const PICK_YES_NO = 'Pick Yes or No';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isSoundCard = (b) => !!(b && b.kind === 'card' && b.card && b.card.type === CARD_TYPE);
const refused = (status, error, path) => ({ status, error, ...(path ? { path } : {}) });
/** A card no longer `asking` (answered, or closed by a typed message meanwhile), or gone with its thread. */
const stale = (block) => refused(409, block ? `card is ${block.state}` : 'card vanished');

/** A voice's name as the design stores it: one line, at most 80 characters, never blank (the store rejects, never folds). */
function voiceNameOf(voice) {
  const name = String(voice.name ?? '').replace(/\s+/g, ' ').trim().slice(0, VOICE_NAME_MAX).trim();
  return name || voice.id;
}

/**
 * @param {{
 *   getDesign: (id: string) => object|null,
 *   updateDesign: (id: string, patch: object) => object,
 *   soundState: () => { configured: boolean, available: boolean },
 *   listVoices: (opts: { key?: string }) => Promise<Array<{ id: string, name: string, about: string }>>,
 *   saveKey: (key: string) => Promise<void>,
 *   appendCardRow: (threadId: string, block: object) => void,
 *   flipCard: (threadId: string, cardId: string, patch: object) => object|null,
 *   findCard: (threadId: string, cardId: string) => object|null,
 *   listCards: (threadId: string) => object[],
 *   newCardId: () => string,
 *   start: (pending: { kind: 'design-start', brief: string }, ctx: { threadId: string, by: string }) => Promise<void>,
 *   log: (name: string) => void,
 * }} deps
 */
export function createSoundCards({ getDesign, updateDesign, soundState, listVoices, saveKey, appendCardRow, flipCard, findCard, listCards, newCardId, start, log }) {
  /** Threads whose card with a brief `apply` made and the thread has not stored yet (in memory: a restart reads the stored card). */
  const held = new Set();

  /** Sound can be asked about here: a video, and a service this worca may hold a key for (D19). */
  const available = (design) => design?.kind === 'video' && soundState().available === true;

  /** The thread's last sound card still `asking`, or null. */
  function openCard(threadId) {
    const cards = listCards(threadId);
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      if (isSoundCard(cards[i]) && cards[i].state === 'asking') return cards[i];
    }
    return null;
  }

  /** One sound card at a time: a start closes the gear's open cards (those with no brief to start). */
  function closeGearCards(threadId) {
    for (const b of listCards(threadId)) {
      if (isSoundCard(b) && b.state === 'asking' && b.card.pending == null) flipCard(threadId, b.id, { state: 'closed' });
    }
  }

  function askBlock({ design, pending }) {
    return {
      id: newCardId(),
      state: 'asking',
      card: { type: CARD_TYPE, step: 'ask', designId: design.id, heading: ASK_HEADING, summary: ASK_HEADING, keyNeeded: !soundState().configured, pending },
    };
  }

  const hold = (threadId) => { held.add(threadId); };
  const release = (threadId) => { held.delete(threadId); };
  const holding = (threadId) => held.has(threadId) || openCard(threadId)?.card.pending != null;

  /** The gear's Change: card 1 with no brief, as a row of its own; null while a sound card is open or being made. */
  async function openFromGear({ design, threadId }) {
    if (held.has(threadId) || openCard(threadId)) return null;
    const block = askBlock({ design, pending: null });
    appendCardRow(threadId, block);
    return { cardId: block.id };
  }

  /** Starts the kept brief; the card is answered already, so a failure here is logged, never answered. */
  async function startPending(pending, threadId, by) {
    if (!pending) return;
    try {
      await start(pending, { threadId, by });
    } catch (err) {
      log(err?.name || 'Error');
    }
  }

  /** The key failures' words (§7): a key refusal names the key it was, anything else is the reach failure or its reason. */
  function voicesRefusal(err, typed, threadId, cardId) {
    if (err instanceof SoundError && (err.status === 401 || err.status === 403)) {
      if (typed) return refused(422, BAD_KEY, 'apiKey');
      flipCard(threadId, cardId, { card: { keyNeeded: true } });
      return refused(422, BAD_SAVED_KEY, 'apiKey');
    }
    if (err instanceof SoundError && err.status !== 504) return refused(502, err.message);
    if (!(err instanceof SoundError)) log(err?.name || 'Error');
    return refused(502, UNREACHABLE);
  }

  async function answerAsk({ threadId, block, answers, by }) {
    const { designId, pending = null } = block.card;
    if (answers.sound === 'no') {
      updateDesign(designId, { sound: { on: false } });
      const flipped = flipCard(threadId, block.id, { state: 'answered', card: { answers: { sound: 'no' }, pending: null } });
      if (!flipped) return stale(null);
      await startPending(pending, threadId, by);
      return { status: 200, block: flipped };
    }
    const raw = typeof answers.apiKey === 'string' ? answers.apiKey.trim() : '';
    const typed = raw && !raw.startsWith(MASKED) ? raw : '';
    if (!typed && !soundState().configured) return refused(422, ENTER_KEY, 'apiKey');
    // The card takes a key, never a variable's name, and no more than settings keep.
    if (typed && (typed.length > KEY_MAX || modelEnvRef(typed))) return refused(422, BAD_KEY, 'apiKey');
    let voices;
    try {
      voices = await listVoices({ key: typed || undefined });
    } catch (err) {
      return voicesRefusal(err, typed, threadId, block.id);
    }
    if (!Array.isArray(voices) || !voices.length) return refused(422, NO_VOICES);
    const checked = findCard(threadId, block.id);
    if (!checked || checked.state !== 'asking') return stale(checked);
    if (typed) {
      try {
        await saveKey(typed);
      } catch (err) {
        if (err?.code === 'BROKER') return refused(422, err.message, 'apiKey');
        throw err;
      }
    }
    // No await from this read to the flips: a card closed during the save gets no card 2 (the checked key stays saved).
    const now = findCard(threadId, block.id);
    if (!now || now.state !== 'asking') return stale(now);
    const kept = now.card.pending ?? null;
    const flipped = flipCard(threadId, block.id, { state: 'answered', card: { answers: { sound: 'yes' }, pending: null } });
    if (!flipped) return stale(null);
    appendCardRow(threadId, {
      id: newCardId(),
      state: 'asking',
      card: { type: CARD_TYPE, step: 'pick', designId, heading: PICK_HEADING, summary: PICK_HEADING, voices: voices.map((v) => ({ id: v.id, name: v.name, about: v.about })), pending: kept },
    });
    return { status: 200, block: flipped };
  }

  async function answerPick({ threadId, block, answers, by }) {
    const { designId, pending = null } = block.card;
    const voice = (Array.isArray(block.card.voices) ? block.card.voices : []).find((v) => v.id === answers.voiceId);
    if (!voice) return refused(422, PICK_VOICE, 'voiceId');
    const m = answers.music;
    if (!isObj(m) || !MUSIC_KINDS.includes(m.kind)) return refused(422, SAY_MUSIC, 'music');
    let music = { kind: m.kind };
    if (m.kind === 'custom') {
      const text = typeof m.text === 'string' ? m.text.trim() : '';
      if (!text) return refused(422, SAY_MUSIC, 'music');
      if (text.length > MUSIC_TEXT_MAX) return refused(422, MUSIC_TOO_LONG, 'music');
      music = { kind: 'custom', text };
    }
    const voiceName = voiceNameOf(voice);
    updateDesign(designId, { sound: { on: true, voice: { id: voice.id, name: voiceName }, music } });
    const flipped = flipCard(threadId, block.id, { state: 'answered', card: { answers: { voiceId: voice.id, voiceName, music }, pending: null } });
    if (!flipped) return stale(null);
    await startPending(pending, threadId, by);
    return { status: 200, block: flipped };
  }

  /**
   * Answers a stored sound card. Never throws: a bad body is a 4xx; an unexpected failure is a 502 with §7's reach
   * words, logged by its name only (its message can name a path or hold the key).
   * @returns {Promise<{ status: number, block?: object, error?: string, path?: string }>}
   */
  async function answer({ threadId, block, body, by }) {
    try {
      if (block.state !== 'asking') return stale(block);
      const answers = isObj(body) && isObj(body.answers) ? body.answers : null;
      if (block.card.step === 'pick') return await answerPick({ threadId, block, answers: answers || {}, by });
      if (!answers || (answers.sound !== 'yes' && answers.sound !== 'no')) return refused(422, PICK_YES_NO);
      return await answerAsk({ threadId, block, answers, by });
    } catch (err) {
      log(err?.name || 'Error');
      return refused(502, UNREACHABLE);
    }
  }

  return { available, askBlock, hold, release, holding, openCard, closeGearCards, openFromGear, answer };
}

/**
 * The cards' `start`: the kept brief goes through the chat's own hand-off, marked decided so it meets no card again.
 * An accepted start posts the round row and its receipt; a refusal is a notice row; a throw is logged and swallowed
 * (the card is answered already).
 * @param {{ getActions: () => { apply: Function }, postNotice: (threadId: string, text: string) => void, log: (name: string) => void }} deps
 */
export function cardStart({ getActions, postNotice, log }) {
  return async (pending, { threadId, by }) => {
    try {
      const r = await getActions().apply(pending, { threadId, by, soundDecided: true });
      if (r && r.ok) r.posted(false);
      else postNotice(threadId, r?.notice || 'Could not start the build.');
    } catch (err) {
      log(err?.name || 'Error');
    }
  };
}
