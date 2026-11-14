// ui/public/chat/prompt-check.mjs — the prompt check chip in the Chat composer and the Shaper task (docs/prompt-check.md,
// "The chip"). A composer add-on (CONTRACT §2, { id: 'prompt-check' }) that mounts the chip through the chip host in
// the lead row, after the intent chip. Its surface is `shaper` while the intent is Shaper (always a task) and `chat`
// otherwise; its id is the thread id, or `new` before the first send. The mount is re-keyed (disposed and mounted
// again) only when that kind or id changes, never on a re-check. A correction made before the chat has an id is held
// and recorded with the thread id its first send creates, once that message is accepted; opening another chat drops it.
import { registerComposerAddon } from './extensions.mjs';
import { mountPromptCheckChip } from '../prompt-check/chip-host.mjs';

export const PROMPT_CHECK_ADDON_ID = 'prompt-check';

/** @param {{intent?:{current:()=>string|null}, timers?:object}} [o] */
export function createPromptCheckAddon({ intent = null, timers } = {}) {
  return {
    id: PROMPT_CHECK_ADDON_ID,
    mount(leadEl, ctx) {
      let chip = null;
      let key = null;
      let threadId = null;
      let text = '';
      let holding = false;   // this chip holds a correction for a send not yet taken (a new chat, or one carried onto it)

      const surfaceKind = () => (intent && typeof intent.current === 'function' && intent.current() === 'shape' ? 'shaper' : 'chat');
      const currentThread = () => {
        const id = typeof ctx.threadId === 'function' ? ctx.threadId() : null;
        return typeof id === 'string' && id ? id : null;
      };

      function rekey() {
        const tid = currentThread();
        const kind = surfaceKind();
        const next = `${kind}|${tid || 'new'}`;
        if (next === key) return;
        // A new chat's first send made its thread: the correction held for it moves onto that thread's chip, still held,
        // and is recorded only when the message is accepted (sent). Any other move (another chat opened, even after a
        // refused first message) drops it with the chip.
        const made = !!(chip && !threadId && tid && typeof ctx.madeThread === 'function' && ctx.madeThread() === tid);
        const held = made ? chip.pendingCorrection() : null;
        if (chip) chip.dispose();
        key = next;
        threadId = tid;
        holding = !tid || !!held;
        chip = mountPromptCheckChip({
          doc: leadEl.ownerDocument, host: leadEl,
          surface: { kind, id: tid || 'new' },
          ids: tid ? { threadId: tid } : {},
          forceTask: kind === 'shaper',
          deferCorrection: () => holding,
          held,
          announce: typeof ctx.announce === 'function' ? ctx.announce : undefined,
          fetchImpl: typeof ctx.fetch === 'function' ? ctx.fetch : undefined,
          timers,
          // Improve: the composer's text, written back through its input path (ask-panel addonCtx).
          field: typeof ctx.text === 'function' && typeof ctx.setText === 'function'
            ? { read: () => ctx.text(), write: (t2) => ctx.setText(t2), focus: () => ctx.focus?.() } : null,
          project: typeof ctx.projectKey === 'function' ? () => ctx.projectKey() : null,
        });
        if (text.trim()) chip.input(text, { silent: true });
      }
      rekey();

      return {
        update() { rekey(); },
        input(t, { answering = false } = {}) {
          text = String(t ?? '');
          rekey();
          chip.input(text, { answering });
        },
        sent(t) {
          text = '';
          // The message is taken: a correction held for it (on a new chat's chip not re-keyed yet, or carried onto the
          // thread made for it) is recorded with that thread's id.
          const tid = threadId || currentThread();
          if (tid) {
            chip.flushCorrection({ threadId: tid });
            holding = false;   // recorded: later picks in this chat are recorded at once
          }
          chip.sent(t);
        },
        destroy() {
          if (chip) chip.dispose();
          chip = null;
        },
      };
    },
  };
}

/** Register the add-on (CONTRACT §2). app.js calls this right after installIntentAddon, BEFORE createAskPanel. */
export function installPromptCheckAddon(opts = {}) {
  const addon = createPromptCheckAddon(opts);
  registerComposerAddon(addon);
  return addon;
}
