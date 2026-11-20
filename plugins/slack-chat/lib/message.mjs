/**
 * NormalizedMessage / IncomingMessage contracts + validators — the plugin-side
 * copy of the channel protocol's message shapes (ported from the pre-1.0
 * integrations adapter.js, ChatAdapter interface dropped). Vendored
 * byte-identically into every chat plugin; test/chat-lib-drift.test.mjs
 * enforces the copies never diverge.
 * @module lib/message
 */

export const MESSAGE_SEGMENT_KINDS = ['text', 'bold', 'code', 'code_block', 'link', 'markdown'];

export const SEVERITY_LEVELS = ['info', 'success', 'warning', 'error'];

/** Native controls (interactive channels only). Executable controls carry a host-issued opaque `ref`; the platform
 *  echoes it back in an `interaction` frame. Links carry no ref and execute nothing. */
export const CONTROL_KINDS = ['button', 'link', 'select'];
export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'];
export const INTERACTION_KINDS = ['button', 'select', 'modal'];
export const CONTROL_REF_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MODAL_FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const CONTROL_LIMITS = Object.freeze({
  controls: 10, selects: 1, selectOptions: 25, label: 80, optionValue: 100, optionLabel: 100, description: 100,
  placeholder: 100, url: 512, modalTitle: 45, modalFields: 5, modalFieldLabel: 45, modalFieldMax: 4000,
  interactionValues: 25, fieldValue: 4000, replyText: 2000,
});
const L = CONTROL_LIMITS;
const str = (v, max, min = 1) => typeof v === 'string' && v.length >= min && v.length <= max;

function isValidModal(m) {
  if (!m || typeof m !== 'object' || !str(m.title, L.modalTitle)) return false;
  if (!Array.isArray(m.fields) || m.fields.length < 1 || m.fields.length > L.modalFields) return false;
  return m.fields.every((f) => f && typeof f === 'object' && typeof f.id === 'string' && MODAL_FIELD_ID_RE.test(f.id)
    && str(f.label, L.modalFieldLabel) && (f.style === 'short' || f.style === 'paragraph')
    && typeof f.required === 'boolean' && Number.isInteger(f.maxLength) && f.maxLength >= 1 && f.maxLength <= L.modalFieldMax);
}

export function isValidControl(c) {
  if (!c || typeof c !== 'object' || !CONTROL_KINDS.includes(c.kind)) return false;
  if (c.kind === 'link') {
    if (!str(c.label, L.label) || !str(c.url, L.url)) return false;
    try { const u = new URL(c.url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
  }
  if (typeof c.ref !== 'string' || !CONTROL_REF_RE.test(c.ref)) return false;
  if (c.kind === 'button') {
    return str(c.label, L.label) && BUTTON_STYLES.includes(c.style) && (c.modal === undefined || isValidModal(c.modal));
  }
  if (c.placeholder !== undefined && !str(c.placeholder, L.placeholder)) return false;
  if (!Array.isArray(c.options) || c.options.length < 1 || c.options.length > L.selectOptions) return false;
  const seen = new Set();
  for (const o of c.options) {
    if (!o || typeof o !== 'object' || !str(o.value, L.optionValue) || !str(o.label, L.optionLabel)) return false;
    if (o.description !== undefined && !str(o.description, L.description)) return false;
    if (seen.has(o.value)) return false;
    seen.add(o.value);
  }
  return true;
}

export function isValidControls(list) {
  if (!Array.isArray(list) || list.length > L.controls) return false;
  if (list.filter((c) => c && c.kind === 'select').length > L.selects) return false;
  return list.every(isValidControl);
}

/** @param {unknown} seg */
export function isValidSegment(seg) {
  if (!seg || typeof seg !== 'object') return false;
  return MESSAGE_SEGMENT_KINDS.includes(seg.kind) && typeof seg.value === 'string';
}

/** @param {unknown} msg */
export function isValidMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.title !== null && typeof msg.title !== 'string') return false;
  if (!Array.isArray(msg.body) || !msg.body.every(isValidSegment)) return false;
  return SEVERITY_LEVELS.includes(msg.severity) && (msg.controls === undefined || isValidControls(msg.controls));
}

/** @param {unknown} inc */
export function isValidIncoming(inc) {
  if (!inc || typeof inc !== 'object') return false;
  return typeof inc.chatId === 'string' && inc.chatId !== ''
    && typeof inc.userId === 'string'
    && typeof inc.text === 'string';
}
