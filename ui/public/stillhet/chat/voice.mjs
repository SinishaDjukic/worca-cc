// ui/public/stillhet/chat/voice.mjs — the prototype's mic over dev's own voice engine (D15): dev's VAD, browser and server
// speech and the hands-free loop (src/shared/ask-voice.mjs createVoiceController), never a second engine and never the
// Web Speech API (Chrome sends that audio to Google). conversation.js loads it with import() on the first mic press.
import { createVoiceController, voiceSupport } from '../../../../src/shared/ask-voice.mjs';

/** `onTranscript(text, {send})`: a dictated text fills the composer, a hands-free one is sent. `onState(state)` paints the
 *  mic, with dev's `{detail}` (why it stopped, on `error`). `create` is the controller factory (dev's by default; a test passes a fake). */
export function bindVoice({ win, doc, fetch, onTranscript, onState, onBargeIn = () => {}, onNotice = () => {}, create = createVoiceController }) {
  let ctl = null;
  const controller = () => ctl || (ctl = create({ win, doc, fetch, onState: (s, info) => onState(s, info || {}), onTranscript: (text, o = {}) => onTranscript(text, { send: !!o.autoSend }), onBargeIn, onNotice }));
  return {
    support: () => voiceSupport(win),
    dictate: () => controller().start('dictate'),
    handsFree: (on) => (on ? controller().start('handsfree') : controller().stop()),
    stop: () => (ctl ? ctl.stop() : Promise.resolve()),
    onFrame: (f, text) => ctl?.onFrame?.(f, text),
  };
}
