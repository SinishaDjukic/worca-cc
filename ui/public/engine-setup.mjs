// ui/public/engine-setup.mjs — the setup dialog of a chat engine (Connect <engine>, #engine-setup-modal in
// runs/welcome.html): how to install it, where worca looks for it, how to sign it in, its docs, and what Check again
// found. One dialog for every engine, filled from src/shared/engine-setup.mjs; app.js opens it (openEngineSetup) and
// asks the server. Claude's status is the Getting started step's (GET /api/onboarding), painted in app.js; every
// other engine's is GET /api/engines/<engine>/setup, which setupStatusLine words.
import { engineSetup, engineSetupDocs } from '../../src/shared/engine-setup.mjs';
import { pickerEngineLabel } from './ask-engine.mjs';

/** The dialog's title for `engine`: "Connect Claude Code", "Connect OpenAI Codex", … (the picker's engine names). */
export const setupTitle = (engine) => `Connect ${pickerEngineLabel(engine)}`;

const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
/** A setup text as parts: {text}, {code} for a `backticked` span, {link, href} for [words](https://…). */
export function inlineParts(text) {
  const out = [];
  const s = String(text || '');
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push(m[1] !== undefined ? { code: m[1] } : { link: m[2], href: m[3] });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function link(doc, href, text) {
  const a = el(doc, 'a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
/** Append `text`'s parts to `parent` (text nodes, <code>, links): never HTML. */
function appendInline(doc, parent, text) {
  for (const p of inlineParts(text)) {
    if (p.code !== undefined) parent.appendChild(el(doc, 'code', null, p.code));
    else if (p.link !== undefined) parent.appendChild(link(doc, p.href, p.link));
    else parent.appendChild(doc.createTextNode(p.text));
  }
  return parent;
}
const para = (doc, cls, text) => appendInline(doc, el(doc, 'p', cls), text);
const commands = (doc, list) => { const pre = el(doc, 'pre', 'ob-setup-cmd'); pre.appendChild(el(doc, 'code', null, list.join('\n'))); return pre; };

/**
 * Fill `host` (#engine-setup-guide) with `engine`'s setup: the install command(s) and what else installs it, the
 * WORCA_<ENGINE>_BIN override and the sign-in step. The status box below it is the dialog's own markup (a live region,
 * so it is there before its words change), and so is the foot's Docs ↗ link (paintSetupDocsLink).
 * @returns {boolean} false for an engine with no setup (host left as it was)
 */
export function renderEngineSetup(doc, host, engine) {
  const s = engineSetup(engine);
  if (!s || !host) return false;
  const label = pickerEngineLabel(engine);
  const lead = el(doc, 'p', 'ob-setup-lead');
  lead.append('Worca drives ', el(doc, 'strong', null, label), '. ');
  appendInline(doc, lead, 'Real runs and chats need its CLI on your `PATH`; mock runs need nothing.');
  const parts = [lead, commands(doc, s.install),
    para(doc, 'ob-setup-note', `${s.installNote} A binary elsewhere: set \`${s.binVar}\` to its full path and restart the UI.`)];
  const step = el(doc, 'p', 'ob-setup-lead ob-setup-step');
  step.append(el(doc, 'strong', null, 'Then sign it in.'), ' ');
  parts.push(appendInline(doc, step, s.signIn.lead), commands(doc, s.signIn.commands));
  for (const note of s.signIn.notes) parts.push(para(doc, 'ob-setup-note', note));
  host.replaceChildren(...parts);
  return true;
}

/** Point the foot's Docs ↗ link (#engine-setup-docs) at `engine`'s setup section, named for it ("OpenAI Codex setup in
 *  the docs"), since its own words say only "Docs". @returns {boolean} false for an engine with no setup */
export function paintSetupDocsLink(a, engine) {
  if (!a || !engineSetup(engine)) return false;
  const name = `${pickerEngineLabel(engine)} setup in the docs`;
  a.href = engineSetupDocs(engine);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = name;
  a.setAttribute('aria-label', name);
  return true;
}

const clause = (s) => String(s || '').trim().replace(/[.\s]+$/, '');
/**
 * The status line for a non-Claude engine from GET /api/engines/<engine>/setup (`status`; null: not answered yet).
 * `ok`: true ready (green), false not (red), null still asking (neither).
 * @returns {{ok:boolean|null, text:string}}
 */
export function setupStatusLine(engine, status) {
  if (!status) return { ok: null, text: 'Checking…' };
  const bin = status.bin || engine;
  // The reason already says what to install (cli-resolve.mjs cliNotInstalled): only what to do after.
  if (!status.installed) return { ok: false, text: `${clause(status.missing) || `${bin} was not found. Install it`}. Then check again (restart the UI if PATH changed).` };
  if (status.broker) return { ok: false, text: `${clause(status.reason)}.` };
  if (status.ready === false) return { ok: false, text: `Found ${bin}, but it is not ready yet: ${clause(status.reason) || 'no reason given'}. Sign it in, then check again.` };
  return { ok: true, text: `Found ${bin}. You're set.${status.reason ? ` ${clause(status.reason)}.` : ''}` };
}

/** The line Check again leaves under the status, so an unchanged answer still shows it was asked. */
export function setupCheckedLine(status) {
  if (!status || !status.installed) return 'Checked just now: still not found.';
  return status.ready === false || status.broker ? 'Checked just now: still not ready.' : 'Checked just now: ready.';
}
