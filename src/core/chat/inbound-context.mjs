// src/core/chat/inbound-context.mjs — the chat context around a freeform chat message (discord-chat 0.4.0): the files
// on it, on the message it replies to and on recent channel history; which of them the host downloads, from where and
// under which caps; and the chat-context block the Ask user row and the turn prompt carry. Platform-neutral: every chat
// plugin sends the same validated fields (channel-protocol.mjs INBOUND_LIMITS). All content is untrusted DATA.
import { classifyExtension } from '../ask/attachment-kind.mjs';
import { ASK_LIMITS } from '../ask/limits.mjs';
import { validateAttachmentBuffer } from '../attachment-upload.mjs';

const MB = 1024 * 1024;
/** Chat downloads (clarify answer 3), each also bounded by Ask's own upload limits. */
export const CHAT_FILE_LIMITS = Object.freeze({
  perFileBytes: Math.min(25 * MB, ASK_LIMITS.attachment.maxBytesPerFile, ASK_LIMITS.attachment.maxBytesPerBinaryFile),
  perMessage: 4,                                             // per platform message (the person's, the reply, each history row)
  perTurn: Math.min(8, ASK_LIMITS.attachment.maxFiles),      // the whole turn: the message and its quoted context
  turnBytes: Math.min(50 * MB, ASK_LIMITS.attachment.maxBytesPerMessage),
  fileTimeoutMs: 20_000,
  turnTimeoutMs: 60_000,
});
/** Characters of quoted text one turn carries: the reply first, then history from the newest. */
export const CHAT_CONTEXT_TEXT_BUDGET = 20_000;

const size = (n) => (n >= MB ? `${Math.round(n / MB)} MB` : `${n} B`);
const extOf = (name) => { const dot = name.lastIndexOf('.'); return dot === -1 ? '' : name.slice(dot).toLowerCase(); };

/** A file URL the host may fetch: https, no credentials, no port, the host name exactly one the plugin declared. */
export function isAllowedFileUrl(raw, hosts) {
  if (typeof raw !== 'string' || !Array.isArray(hosts) || !hosts.length) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && u.port === '' && hosts.includes(u.hostname.toLowerCase());
}

/** The replied-to message is quoted once (a history row with its link is dropped); history keeps its NEWEST rows inside
 *  the text budget (the reply's text counts first) and says how many older ones were left out. */
export function fitChatContext(inbound) {
  const replyTo = inbound.replyTo || null;
  const notes = Array.isArray(inbound.notes) ? [...inbound.notes] : [];
  let history = (Array.isArray(inbound.history) ? inbound.history : []).filter((q) => !(replyTo && replyTo.link && q.link === replyTo.link));
  let used = replyTo ? replyTo.text.length : 0;
  let cut = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    used += history[i].text.length;
    if (used > CHAT_CONTEXT_TEXT_BUDGET) { cut = i + 1; break; }
  }
  if (cut) {
    history = history.slice(cut);
    notes.push(`${cut} older message${cut === 1 ? '' : 's'} left out (over the ${CHAT_CONTEXT_TEXT_BUDGET}-character budget).`);
  }
  return { ...inbound, replyTo, history, notes };
}

/** Which files to download, in priority order (the message's own, the replied-to message's, then history newest first),
 *  and which are refused before any download: an unsupported type, what the chat's engine cannot view (`refuse`, the
 *  upload route's chatAttachRefusal), a declared size over the cap, past 4 per message or 8 per turn. */
export function planChatFiles({ link = null, attachments = [], replyTo = null, history = [] }, limits = CHAT_FILE_LIMITS, { refuse = () => null } = {}) {
  const groups = [
    { from: 'message', link, list: attachments || [] },
    ...(replyTo ? [{ from: 'reply', link: replyTo.link ?? null, list: replyTo.attachments || [] }] : []),
    ...(history || []).map((q, index) => ({ from: 'history', index, link: q.link ?? null, list: q.attachments || [] })).reverse(),
  ];
  const take = [];
  const skipped = [];
  for (const g of groups) {
    let onMessage = 0;
    for (const ref of g.list) {
      const source = { from: g.from, ...(g.index !== undefined ? { index: g.index } : {}), link: g.link };
      const cls = classifyExtension(extOf(ref.name));
      let why = null;
      if (!cls) why = 'not saved: this file type cannot be attached';
      else if (refuse(cls, ref.name)) why = `not saved: ${refuse(cls, ref.name)}`;
      else if (ref.size > limits.perFileBytes) why = `not saved: over the ${size(limits.perFileBytes)} limit per file`;
      else if (onMessage >= limits.perMessage) why = `not saved: only ${limits.perMessage} files per message are saved`;
      else if (take.length >= limits.perTurn) why = `not saved: only ${limits.perTurn} files are saved with one message and its context`;
      if (why) { skipped.push({ name: ref.name, why, source }); continue; }
      onMessage += 1;
      take.push({ ref, source });
    }
  }
  return { take, skipped };
}

/** The body, or {tooBig} as soon as it passes `cap` bytes (a declared size is not trusted). */
async function readCapped(res, cap) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > cap) return { tooBig: true };
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > cap ? { tooBig: true } : { buf };
  }
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { await reader.cancel().catch(() => {}); return { tooBig: true }; }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return { buf: Buffer.concat(chunks, n) };
}

/** Download the planned files one at a time from the plugin's declared hosts (`redirect: 'error'`: a redirect can never
 *  leave them), each validated like an upload. Never throws: every file that is not stored is listed with its reason.
 *  @returns {Promise<{files: Array<{name, kind, mime, text?, data, bytes, source, quoted}>, skipped: Array<{name, why, source}>}>} */
export async function fetchChatFiles(inbound, { fetchFn = globalThis.fetch, allowedHosts = [], refuse = () => null, limits = CHAT_FILE_LIMITS, log = () => {} } = {}) {
  const { take, skipped } = planChatFiles(inbound, limits, { refuse });
  const files = [];
  let total = 0;
  const deadline = AbortSignal.timeout(limits.turnTimeoutMs);
  for (const { ref, source } of take) {
    const skip = (why) => { skipped.push({ name: ref.name, why, source }); };
    if (!isAllowedFileUrl(ref.url, allowedHosts)) { skip('not saved: not from the chat platform\'s file host'); continue; }
    if (total + ref.size > limits.turnBytes) { skip(`not saved: over the ${size(limits.turnBytes)} limit per message`); continue; }
    if (deadline.aborted) { skip('not saved: the downloads took too long'); continue; }
    const cap = Math.min(limits.perFileBytes, limits.turnBytes - total);
    let got;
    try {
      const res = await fetchFn(ref.url, { redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(limits.fileTimeoutMs)]) });
      if (!res.ok) {
        res.body?.cancel().catch(() => {});   // release the connection now, not at GC
        skip(`not saved: download failed (HTTP ${res.status})`);
        continue;
      }
      got = await readCapped(res, cap);
    } catch (err) {
      log('warn', `chat file ${ref.name} not downloaded: ${err?.message || err}`);
      skip('not saved: download failed');
      continue;
    }
    if (got.tooBig) {
      skip(cap < limits.perFileBytes ? `not saved: over the ${size(limits.turnBytes)} limit per message` : `not saved: over the ${size(limits.perFileBytes)} limit per file`);
      continue;
    }
    const v = validateAttachmentBuffer(ref.name, got.buf, { maxBytesPerFile: limits.perFileBytes, maxBytesPerBinaryFile: limits.perFileBytes, refuse });
    if (!v.ok) { skip(`not saved: ${v.error}`); continue; }
    total += v.file.bytes;
    const f = v.file;
    const quoted = source.from !== 'message';   // a quoted message's file: listed for read_attachment, never inlined
    files.push(f.kind === 'text'
      ? { name: f.name, kind: 'text', mime: f.mime, text: f.text, bytes: f.bytes, source, quoted }
      : { name: f.name, kind: f.kind, mime: f.mime, data: f.data, bytes: f.bytes, source, quoted });
  }
  return { files, skipped };
}

/** The user row's ONE chat-context block (shown collapsed in worca, quoted to the model as untrusted data), or null when
 *  the message brought nothing to quote. `inbound` has gone through fitChatContext; `saved` = the stored files with
 *  their attachment ids and sources, `skipped` = fetchChatFiles' list. The message's own SAVED files are its ordinary
 *  attachments; only its skipped ones are listed here. */
export function chatContextBlock(inbound, { saved = [], skipped = [] } = {}) {
  const filesOf = (pick) => [
    ...saved.filter((f) => f.source && pick(f.source)).map((f) => ({ id: f.id, name: f.name })),
    ...skipped.filter((s) => s.source && pick(s.source)).map((s) => ({ name: s.name, note: s.why })),
  ];
  const quote = (q, pick) => {
    const files = filesOf(pick);
    return { author: q.author, at: q.at, link: q.link ?? null, text: q.text, ...(files.length ? { files } : {}) };
  };
  const replyTo = inbound.replyTo ? quote(inbound.replyTo, (s) => s.from === 'reply') : null;
  const history = (inbound.history || []).map((q, index) => quote(q, (s) => s.from === 'history' && s.index === index));
  const own = skipped.filter((s) => s.source && s.source.from === 'message').map((s) => ({ name: s.name, note: s.why }));
  const notes = (inbound.notes || []).filter((n) => typeof n === 'string' && n);
  if (!replyTo && !history.length && !own.length && !notes.length) return null;
  return { kind: 'chat-context', platform: String(inbound.platform || 'chat'),
    ...(replyTo ? { replyTo } : {}), ...(history.length ? { history } : {}), ...(own.length ? { files: own } : {}), ...(notes.length ? { notes } : {}) };
}
