#!/usr/bin/env node
// tools/classic-inventory.mjs — gate.coverage (docs/rail/gate.md): every control classic Worca offers, the API routes and
// Settings keys it uses, and where it stands in Stillhet (wired, planned, not offered by decision, or MISSING).
//
// Two sources, combined:
//   static  a scan of today's UI (ui/public/ but stillhet/, design-system/, vendor/, browser-extension/, assets/, fonts/):
//           every <button>, <input>, <select>, <textarea>, <dialog>, role=menuitem|switch|tab|dialog|checkbox|radio, every
//           createElement and h(…,'button') of a control, every btn()/button()/iconBtn() call and every menu item object
//           ({ label, onSelect|run|href… }). A control's routes are the /api/… literals of the function that draws it and of
//           the functions that handle it (found by its id, its data-* value or its class), three call levels deep.
//   walk    `--walk URL`: a real browser (Playwright) on a running classic instance, in the mode the server has (the tool
//           never changes it). It opens every page, records every visible control, opens each menu and dialog
//           (aria-haspopup) and presses Escape. Every request but GET is aborted, so it cannot write.
//           It writes plans/rail/coverage/classic-walk.json; the static run joins it by id and by label.
//
// Classification (classify): a route Stillhet's own code fetches from the control's own place is wired (the page's `places`:
// folders of ui/public/stillhet/, a live/ file by LIVE_PLACE; a call from another place clears nothing); else the status of a
// plans/rail/stillhet-wiring.md row that names it (a `wired` row only when it names a file of that place or sits in its
// section); else planned when plans/rail/test-results/PLAN.md, plans/rail/test-results/FINDINGS.md or an Open row of
// plans/rail/findings.md names it; else MISSING. A Settings key: wired when Stillhet's live code reads it, else the same
// order. A control with no route and no key is a view control: its page's place decides (PAGES). A control's status is its
// worst part (MISSING, planned, not offered, wired). A `## Classic controls` row in stillhet-wiring.md overrides one control.
//
//   node tools/classic-inventory.mjs                  static scan + the last walk → classic-controls.json and COVERAGE.md
//   node tools/classic-inventory.mjs --walk URL       walk URL first (read-only), then as above
//   node tools/classic-inventory.mjs --update         also writes the MISSING baseline (it refuses one that gains an id)
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { callPathsOf } from './stillhet-surfaces.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DIR = 'plans/rail/coverage';
export const CONTROLS = `${DIR}/classic-controls.json`;
export const WALK = `${DIR}/classic-walk.json`;
export const REPORT = `${DIR}/COVERAGE.md`;
export const BASELINE = 'test/fixtures/stillhet-coverage-baseline.json';
const SETTINGS_KEYS = 'test/fixtures/settings-api-keys.json';
export const STATUSES = ['wired', 'planned', 'not offered', 'MISSING'];
const ORDER = { MISSING: 3, planned: 2, 'not offered': 1, wired: 0 };

// ── Today's UI ────────────────────────────────────────────────────────────────────────────────────────────────────
const SKIP = /^ui\/public\/(stillhet|design-system|browser-extension|assets|fonts)\/|\/vendor\//;
const EXT = /\.(mjs|js|html)$/;

function walkDir(root, dir, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walkDir(root, p, out); else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Today's UI files, relative to root, sorted. */
export function classicFiles(root = ROOT) {
  return walkDir(root, 'ui/public').filter((f) => !SKIP.test(f + '/') && !SKIP.test(f)).sort();
}

// ── Pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// [test over "file area function", page]. The first that matches names the page; app.js is read by its section heads.
const PAGE_RULES = [
  [/setup-assistant|smart-naming|update-view|credentials-view|sound-settings/, 'Settings'],
  [/pinpoint-surfaces/, 'Tasks'],   // Pinpoint on a run's artifact viewer and Diff tab: the run's page (COV-3)
  [/pinpoint/, 'Chat'],
  [/skill-/, 'Marketplace'],
  [/team-policy|teamPolicy|\btp[A-Z_]/, 'Team policy'],
  [/team-metrics|teamMetrics|\btm[A-Z_]|timeline/i, 'Team metrics'],
  [/statistics|stats|cost-(report|breakdown|area|dimension)/i, 'Statistics'],
  [/requirements/i, 'Requirements'],
  [/\/design\/|design-|designView|\bdsc?[A-Z]/, 'Design'],
  [/profile|worca-level/i, 'Profile'],
  [/getting-started|guide-spot|welcome|onboard/i, 'Getting started'],
  [/scheduled-runs|schedules|schedule/i, 'Schedules'],
  [/marketplace|plugin|export-marketplace|skills/i, 'Marketplace'],
  [/mcp|connectors/i, 'Connectors'],
  [/providers|openrouter|bridge-view|proxy/i, 'Providers'],
  [/models|model-editor|engine-settings|import models/i, 'Models'],
  [/workspace/i, 'Workspaces'],
  [/workflows|workflow|composer|agent-|agents|script|wizard/i, 'Workflows'],
  [/shape\/|feature\.html|feature page|shipit|ship-/i, 'Feature (Shaper)'],
  [/new-run|newRun|new pipeline|night-mode-form/i, 'New run'],
  [/runs\/|runs-|history|run-|diff|log |live log|q&a|sessions tab|agents tab|overview tab|terminal|actions|artifact|folder runs|workspace prs|group-|pipeline/i, 'Tasks'],
  [/projects|project-|memory|house-brief|git-automations|labels-settings|automations/i, 'Projects'],
  [/chat|ask-|ask\/|answerer|chats-/i, 'Chat'],
  [/settings|guardrails|credentials|flags|presets|appearance|labels|tags|alerts|sound|keys-sheet/i, 'Settings'],
  [/account|topnav|search|activity|shell|phone drawer|band|away|connection|limit-notice|feedback/i, 'Shell'],
];

// Each page's Stillhet place: what a view control (no route, no key) there counts as; and the Stillhet places (folders of
// ui/public/stillhet/, LIVE_PLACE for live/) whose calls cover its routes; '*' is every place.
export const PAGES = {
  Chat: { status: 'wired', where: 'Chat', places: ['chat'] },
  Tasks: { status: 'wired', where: 'Tasks and the task page', places: ['runs', 'chat'] },
  'New run': { status: 'wired', where: 'Chat and + › New task…', places: ['centers', 'chat'] },
  Schedules: { status: 'wired', where: 'Schedules', places: ['schedules'] },
  Projects: { status: 'wired', where: 'Projects', places: ['projects'] },
  Workspaces: { status: 'wired', where: 'Projects (workspaces)', places: ['workspaces', 'projects'] },
  Workflows: { status: 'wired', where: 'Workflows', places: ['workflows'] },
  Marketplace: { status: 'wired', where: 'Marketplace', places: ['marketplace'] },
  Statistics: { status: 'wired', where: 'Insights', places: ['insights'] },
  'Team metrics': { status: 'wired', where: 'Insights', places: ['insights'] },
  Shell: { status: 'wired', where: 'the shell (top bar, Pulse, profile)', places: ['*'] },   // the page of code no rule places
  'Feature (Shaper)': { status: 'wired', where: 'the group page and Chat\'s PlanCard', places: ['chat'] },
  Settings: { status: 'planned', where: 'Settings, wave 3 slice 12 (PLAN.md 4b, D22/D24)', places: ['settings'] },
  Connectors: { status: 'planned', where: 'Settings › Connectors, wave 3 slice 12 (PLAN.md 4b)', places: ['settings'] },
  Models: { status: 'planned', where: 'Settings › Models, wave 3 slice 12 (PLAN.md 4b, F-7b-08)', places: ['settings'] },
  Providers: { status: 'planned', where: 'Settings › Models, wave 3 slice 12 (PLAN.md 4b)', places: ['settings'] },
  'Team policy': { status: 'planned', where: 'Settings › Team, wave 3 slice 12 (PLAN.md 4b, F-7b-05)', places: ['settings'] },
  Requirements: { status: 'planned', where: 'Requirements, wave 3 slice 11 (PLAN.md 4b, D2, B8.7)', places: ['requirements'] },
  'Getting started': { status: 'planned', where: 'Onboarding, wave 3 slice 13 (PLAN.md 4b, D13, B8.6)', places: [] },
  Design: { status: 'planned', where: 'D1 (B8.2): a home or retire, owner decision', places: [] },
  Profile: { status: 'planned', where: 'D1 (B8.2): a home or retire, owner decision', places: ['shell'] },
};

// The walk's hash → page.
const VIEW_PAGE = {
  chat: 'Chat', runs: 'Tasks', running: 'Tasks', history: 'Tasks', pipelines: 'Tasks', new: 'New run', schedules: 'Schedules',
  projects: 'Projects', workspaces: 'Workspaces', 'workspace-create': 'Workspaces', workflows: 'Workflows', marketplace: 'Marketplace',
  connectors: 'Connectors', models: 'Models', providers: 'Providers', settings: 'Settings', 'team-policy': 'Team policy',
  stats: 'Statistics', 'team-metrics': 'Team metrics', requirements: 'Requirements', design: 'Design', profile: 'Profile',
  'getting-started': 'Getting started', feature: 'Feature (Shaper)', group: 'Tasks',
};

export function pageOf(file, area = '', fn = '') {
  const s = `${file} ${area} ${fn}`;
  for (const [re, page] of PAGE_RULES) if (re.test(s)) return page;
  return 'Shell';
}

// ── Static scan ───────────────────────────────────────────────────────────────────────────────────────────────────
const lineAt = (text) => { const nl = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') nl.push(i + 1); return (o) => { let lo = 0, hi = nl.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (nl[m] <= o) lo = m; else hi = m - 1; } return lo + 1; }; };
const clean = (s) => String(s || '').replace(/\$\{[^}]*\}/g, '…').replace(/<[^>]*>/g, ' ').replace(/&hellip;/g, '…').replace(/&amp;/g, '&')
  .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
const attr = (attrs, name) => { const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs); return m ? (m[2] ?? m[3]) : null; };
/** A string that reads as a label, not a class list or an id. */
export const looksLabel = (s) => { const t = String(s || '').trim(); return t.length > 0 && t.length <= 60 && !/^(btn|is-|has-)/.test(t) && !/\bbtn(-[a-z]+)?\b/.test(t)
  && (/^[A-Z0-9…⋯+×✕↻‹›←→]/.test(t) || /^[a-z]+( [a-z']+)+[.…]?$/.test(t)) && !/^[A-Z_]+$/.test(t) && !/[{}<>;=]/.test(t); };

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Every function of a source, with its name, span and lines; [] when it does not parse. */
function functionsOf(text) {
  let ast = null;
  for (const sourceType of ['module', 'script']) {
    try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); break; } catch { /* next */ }
  }
  if (!ast) return [];
  const out = [];
  const visit = (node, name) => {
    if (!node || typeof node.type !== 'string') return;
    if (FN_TYPES.has(node.type)) out.push({ start: node.start, end: node.end, name: (node.id && node.id.name) || name || '' });
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      let childName = '';
      if (node.type === 'VariableDeclarator' && k === 'init' && node.id.type === 'Identifier') childName = node.id.name;
      if ((node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && k === 'value' && node.key) childName = node.key.name || node.key.value || '';
      if (node.type === 'AssignmentExpression' && k === 'right' && node.left.type === 'MemberExpression' && node.left.property) childName = node.left.property.name || '';
      if (Array.isArray(v)) for (const c of v) visit(c, ''); else if (v && typeof v.type === 'string') visit(v, childName);
    }
  };
  visit(ast, '');
  return out.sort((a, b) => a.start - b.start);
}

const MAX_BLOCK = 12;
const GENERIC_KEYS = new Set(['app', 'default', 'root', 'chat', 'git', 'sync', 'flags', 'theme', 'schedule', 'actions']);

/** The indexed sources: per file its text, functions, line lookup and section heads; a name → functions map. */
export function indexSources(root = ROOT, files = classicFiles(root)) {
  const src = {}, byName = new Map();
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    const fns = f.endsWith('.html') ? [] : functionsOf(text);
    const heads = [];
    for (const m of text.matchAll(/^\/\/ ── ([^─\n]+)/gm)) heads.push([m.index, m[1].trim()]);
    const s = { file: f, text, fns, line: lineAt(text), heads, lines: text.split('\n').length };
    for (const fn of fns) {
      fn.file = f; fn.span = s.line(fn.end) - s.line(fn.start) + 1;
      if (fn.name) { if (!byName.has(fn.name)) byName.set(fn.name, []); byName.get(fn.name).push(fn); }
    }
    src[f] = s;
  }
  return { src, byName, keys: JSON.parse(readFileSync(join(root, SETTINGS_KEYS), 'utf8')), memo: new Map() };
}

const areaAt = (s, o) => { let a = ''; for (const [i, h] of s.heads) { if (i > o) break; a = h; } return a; };
const innermost = (s, o) => { let best = null; for (const fn of s.fns) { if (fn.start > o) break; if (fn.end >= o && (!best || fn.start >= best.start)) best = fn; } return best; };
const parentOf = (s, fn) => { let best = null; for (const g of s.fns) { if (g.start > fn.start) break; if (g !== fn && g.end >= fn.end && (!best || g.start >= best.start)) best = g; } return best; };

// The routes and settings keys of a function: its own /api literals, and those of the named functions it calls (one level,
// the same file first, else a unique name elsewhere; never a callee longer than 300 lines).
function partsOfFn(idx, fn) {
  const key = `${fn.file}:${fn.start}`;
  if (idx.memo.has(key)) return idx.memo.get(key);
  const text = idx.src[fn.file].text.slice(fn.start, fn.end);
  const routes = new Set(callPathsOf(text));
  // Three call levels: a click handler often calls a named helper that opens a dialog whose loader fetches.
  const seen = new Set([fn]);
  let level = [[fn, text]];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const [f, body] of level) {
      for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        const cands = (idx.byName.get(m[1]) || []).filter((g) => !seen.has(g) && g.span <= 300);
        const same = cands.filter((g) => g.file === f.file);
        // Only a name that is unique in its file (or, when the file has none, in all of today's UI): a common name
        // (`render`, `load`) would pull in another page's routes.
        const use = same.length === 1 ? same : !same.length && cands.length === 1 ? cands : [];
        for (const g of use) {
          seen.add(g);
          const gt = idx.src[g.file].text.slice(g.start, g.end);
          for (const r of callPathsOf(gt)) routes.add(r);
          next.push([g, gt]);
        }
      }
    }
    level = next;
  }
  const keys = new Set();
  if ([...routes].some((r) => r === '/api/settings')) {
    for (const k of idx.keys) if (!GENERIC_KEYS.has(k) && new RegExp(`(^|[^\\w$])${k}\\s*:|\\.${k}\\b|['"\`]${k}['"\`]`).test(text)) keys.add(k);
  }
  const out = { routes, keys };
  idx.memo.set(key, out);
  return out;
}

// The block that handles an offset: the innermost function, widened to its parent while it has no route and the parent is
// at most 200 lines. A file with no function: the 30 lines around.
function blockParts(idx, file, o) {
  const s = idx.src[file];
  // A handler that starts right after the reference (`x.addEventListener('click', () => …)`, `x.onclick = …`) is the block.
  const eol = s.text.indexOf('\n', o);
  const after = s.fns.filter((f) => f.start > o && f.start <= (eol < 0 ? o + 200 : Math.min(eol, o + 200)));
  if (after.length) {
    const routes = new Set(), keys = new Set();
    for (const f of after) { const p = partsOfFn(idx, f); for (const r of p.routes) routes.add(r); for (const k of p.keys) keys.add(k); }
    if (routes.size) return { routes, keys, fn: after[0].name };
  }
  let fn = innermost(s, o);
  while (fn) {
    const p = partsOfFn(idx, fn);
    if (p.routes.size) return { ...p, fn: fn.name };
    const up = parentOf(s, fn);
    if (!up || up.span > 200) return { ...p, fn: fn.name };
    fn = up;
  }
  const a = s.text.lastIndexOf('\n', Math.max(0, o - 1500)), b = s.text.indexOf('\n', o + 1500);
  return { routes: new Set(callPathsOf(s.text.slice(Math.max(0, a), b < 0 ? undefined : b))), keys: new Set(), fn: '' };
}

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The offsets that refer to a handle of a control: its id ('#id', getElementById, an alias `x: $('#id')` and `.x`), its
// data-* value inside a function that reads that data name, or its first distinctive class ('.cls').
function handleRefs(idx, file, handles) {
  const out = [];
  const files = Object.keys(idx.src).filter((f) => !f.endsWith('.html'));
  for (const h of handles) {
    if (h.kind === 'id') {
      const re = new RegExp(`['"\`]#${esc(h.v)}\\b|getElementById\\(\\s*['"\`]${esc(h.v)}['"\`]`, 'g');
      for (const f of files) {
        const t = idx.src[f].text;
        for (const m of t.matchAll(re)) {
          out.push([f, m.index]);
          const al = /([A-Za-z_$][\w$]*)\s*[:=]\s*[\w$.]*\(\s*$/.exec(t.slice(Math.max(0, m.index - 80), m.index));
          if (al && al[1].length > 3) {
            let n = 0;
            for (const r of t.matchAll(new RegExp(`\\.${esc(al[1])}\\b`, 'g'))) { out.push([f, r.index]); if (++n >= 8) break; }
          }
        }
      }
    } else if (h.kind === 'data') {
      const camel = h.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const lit = new RegExp(`['"\`]${esc(h.v)}['"\`]`, 'g');
      for (const f of [file, ...files.filter((x) => x !== file)]) {
        const s = idx.src[f];
        if (!s.text.includes(`data-${h.name}`) && !s.text.includes(`dataset.${camel}`)) continue;
        for (const m of s.text.matchAll(lit)) {
          const fn = innermost(s, m.index);
          const body = fn ? s.text.slice(fn.start, fn.end) : '';
          if (body.includes(`dataset.${camel}`) || body.includes(`data-${h.name}`)) out.push([f, m.index]);
        }
      }
    } else if (h.kind === 'class') {
      const re = new RegExp(`['"\`][^'"\`]*\\.${esc(h.v)}\\b`, 'g');
      for (const f of [file]) for (const m of idx.src[f].text.matchAll(re)) out.push([f, m.index]);
    }
  }
  return out.slice(0, 24);
}

const KIND_OF_ROLE = { menuitem: 'menu item', menuitemradio: 'menu item', menuitemcheckbox: 'menu item', switch: 'toggle', checkbox: 'toggle',
  radio: 'toggle', tab: 'tab', dialog: 'dialog', alertdialog: 'dialog', button: 'button' };
const GENERIC_CLASS = /^(btn|btn-[a-z]+|tab|md-tab|link-btn|input|mono|switch|sw-input|row-btn|chip|is-[a-z]+|hidden|sr-only|icon|seg|pill)$/;

// The controls in markup (HTML files and markup strings in JS).
function markupControls(s) {
  const out = [];
  const forLabel = (id) => { if (!id) return ''; const m = new RegExp(`<label[^>]*\\bfor="${esc(id)}"[^>]*>([\\s\\S]{0,200}?)</label>`).exec(s.text); return m ? clean(m[1]) : ''; };
  const textById = (id) => { if (!id) return ''; const m = new RegExp(`\\bid="${esc(id)}"[^>]*>([\\s\\S]{0,200}?)</`).exec(s.text); return m ? clean(m[1]) : ''; };
  const re = /<([a-z][a-z0-9-]*)\b((?:[^>"'`]|"[^"]*"|'[^']*'|\$\{[^}]*\})*)>/g;
  for (const m of s.text.matchAll(re)) {
    const tag = m[1], attrs = m[2];
    const role = attr(attrs, 'role');
    let kind = null;
    if (role && KIND_OF_ROLE[role]) kind = KIND_OF_ROLE[role];
    else if (tag === 'button' || tag === 'summary') kind = 'button';
    else if (tag === 'select' || tag === 'textarea') kind = 'field';
    else if (tag === 'dialog') kind = 'dialog';
    else if (tag === 'input') {
      const type = attr(attrs, 'type') || 'text';
      if (type === 'hidden') continue;
      kind = /checkbox|radio/.test(type) ? 'toggle' : 'field';
    } else if (tag === 'a' && (/\bbtn\b/.test(attr(attrs, 'class') || '') || /data-(act|action)=/.test(attrs))) kind = 'button';
    if (!kind) continue;
    const id = attr(attrs, 'id');
    let label = attr(attrs, 'aria-label') || '';
    if (!label && (kind === 'button' || kind === 'menu item' || kind === 'tab' || tag === 'button' || tag === 'a')) {
      const close = s.text.indexOf(`</${tag}>`, m.index + m[0].length);
      if (close > 0 && close - m.index < 600) label = clean(s.text.slice(m.index + m[0].length, close));
    }
    if (!label && kind === 'dialog') label = textById(attr(attrs, 'aria-labelledby')) || '';
    if (!label) label = forLabel(id) || attr(attrs, 'title') || attr(attrs, 'placeholder') || attr(attrs, 'name') || id || '';
    if (!label && tag === 'input' && kind === 'toggle') {
      const after = s.text.slice(m.index + m[0].length, m.index + m[0].length + 300);
      label = clean((/<span[^>]*>([^<]{2,60})<\/span>/.exec(after) || [])[1] || '');
    }
    label = clean(label);
    if (!label) label = `(${clean(attr(attrs, 'class') || tag)})`;
    const handles = [];
    if (id && !id.includes('${')) handles.push({ kind: 'id', v: id });
    for (const d of attrs.matchAll(/\bdata-([a-z][a-z-]*)="([^"$]{1,40})"/g)) if (!/^(flag|min-level|tip|i18n)$/.test(d[1])) handles.push({ kind: 'data', name: d[1], v: d[2] });
    const cls = (attr(attrs, 'class') || '').split(/\s+/).find((c) => c && !c.includes('$') && !GENERIC_CLASS.test(c));
    if (cls) handles.push({ kind: 'class', v: cls });
    out.push({ o: m.index, kind, label, handles, ...(attr(attrs, 'data-flag') ? { flag: attr(attrs, 'data-flag') } : {}), ...(attr(attrs, 'data-min-level') ? { level: attr(attrs, 'data-min-level') } : {}) });
  }
  return out;
}

// A label from the variable a control is assigned to (`const archiveBtn = …` → "(archive)"), or from its first distinctive class.
const varLabel = (t, o) => {
  const m = /(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*$/.exec(t.slice(Math.max(0, o - 60), o));
  if (!m || /^(b|el|e|x|btn|button|input|sel|select|node|n|ta|i|d|it|item|row|opt|c)$/.test(m[1])) return '';
  return `(${m[1].replace(/(Btn|Button|El|Input|Sel|Select|Field|Box|Toggle|Check)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()})`;
};
const classLabel = (cls) => { const c = String(cls || '').split(/\s+/).find((x) => x && !x.includes('$') && !GENERIC_CLASS.test(x)); return c ? `(${c})` : ''; };

// The controls JS builds: createElement, a tag-named builder call, a btn()-like call, a menu item object.
function scriptControls(s) {
  const out = [];
  const t = s.text;
  for (const m of t.matchAll(/createElement\(\s*['"](button|input|select|textarea|dialog)['"]\s*\)/g)) {
    const win = t.slice(m.index, m.index + 700);
    const lab = /(?:textContent|innerText|ariaLabel|title|placeholder)\s*=\s*(['"`])([^'"`\n]{1,60})\1|setAttribute\(\s*['"](?:aria-label|title)['"]\s*,\s*(['"`])([^'"`\n]{1,60})\3/.exec(win);
    const type = /\.type\s*=\s*['"](checkbox|radio)['"]|role['"]?\s*,\s*['"]switch['"]/.exec(win);
    const tag = m[1];
    const kind = tag === 'button' ? 'button' : tag === 'dialog' ? 'dialog' : type ? 'toggle' : 'field';
    const cls = /className\s*=\s*['"`]([^'"`\n]+)['"`]/.exec(win.slice(0, 300));
    out.push({ o: m.index, kind, label: clean(lab ? (lab[2] || lab[4]) : varLabel(t, m.index) || classLabel(cls && cls[1]) || `(${tag})`), handles: [] });
  }
  for (const m of t.matchAll(/\b[\w$]+\(\s*(?:doc\s*,\s*)?['"](button|input|select|textarea)['"]\s*,([^\n]{0,240})/g)) {
    const lit = [...m[2].matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){1,60})\1/g)].map((x) => x[2]).find(looksLabel);
    const kind = m[1] === 'button' ? 'button' : 'field';
    const cls = /^\s*(['"`])([^'"`\n]+)\1/.exec(m[2]);
    out.push({ o: m.index, kind, label: clean(lit || varLabel(t, m.index) || classLabel(cls && cls[2]) || `(${m[1]})`), handles: [] });
  }
  for (const m of t.matchAll(/\b(btn|button|iconBtn|mkBtn|makeBtn|actionBtn|linkBtn|smallBtn|quietBtn)\(([^\n]{0,240})/g)) {
    if (/function\s*$|const\s*$/.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;
    if (/^\s*(doc\s*,\s*)?['"](button|input|select|textarea)['"]/.test(m[2])) continue;
    const lit = [...m[2].matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){1,60})\1/g)].map((x) => x[2]).find(looksLabel);
    if (!lit) continue;
    out.push({ o: m.index, kind: 'button', label: clean(lit), handles: [] });
  }
  for (const m of t.matchAll(/\{\s*(?:id\s*:\s*['"][\w-]+['"]\s*,\s*)?(?:label|text|title)\s*:\s*(['"`])((?:(?!\1)[^\\\n]|\\.){1,60})\1\s*,[^{}\n]*?\b(onSelect|run|onClick|onPick|action|act|href|danger|keys)\s*:/g)) {
    if (!looksLabel(m[2])) continue;
    out.push({ o: m.index, kind: 'menu item', label: clean(m[2]), handles: [] });
  }
  return out;
}

/** Every classic control the source draws, merged per (file, kind, label); with its routes, keys, page and lines. */
export function scanStatic(root = ROOT, idx = indexSources(root)) {
  const byId = new Map();
  for (const [file, s] of Object.entries(idx.src)) {
    const found = [...markupControls(s), ...(file.endsWith('.html') ? [] : scriptControls(s))];
    for (const c of found) {
      const parts = [];
      if (!file.endsWith('.html')) parts.push(blockParts(idx, file, c.o));
      for (const [f, o] of handleRefs(idx, file, c.handles)) parts.push(blockParts(idx, f, o));
      // A block with more than MAX_BLOCK routes is a page's loader or wiring, not this control's handler: it is left out.
      const routes = new Set(), keys = new Set();
      for (const p of parts) { if (p.routes.size > MAX_BLOCK) continue; for (const r of p.routes) routes.add(r); for (const k of p.keys) keys.add(k); }
      const fn = parts[0]?.fn || '';
      const page = pageOf(file, areaAt(s, c.o), fn);
      const id = `${file} › ${c.kind} › ${c.label}`;
      const prev = byId.get(id);
      if (prev) {
        for (const r of routes) if (!prev.routes.includes(r)) prev.routes.push(r);
        for (const k of keys) if (!prev.keys.includes(k)) prev.keys.push(k);
        if (prev.lines.length < 6) prev.lines.push(s.line(c.o));
        continue;
      }
      byId.set(id, { id, page, label: c.label, kind: c.kind, file, lines: [s.line(c.o)], routes: [...routes], keys: [...keys],
        handles: c.handles.filter((h) => h.kind === 'id').map((h) => h.v), ...(c.flag ? { flag: c.flag } : {}), ...(c.level ? { level: c.level } : {}) });
    }
  }
  const out = [...byId.values()];
  // A Settings field named after its key (`id="set-keep-awake"`, `name="keepAwake"`) carries that key.
  const flat = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const c of out) for (const k of idx.keys) if (k.length >= 6 && c.handles.some((h) => flat(h).includes(flat(k))) && !c.keys.includes(k)) c.keys.push(k);
  // Every Settings key no control was found for is a control of its own: the setting itself.
  const held = new Set(out.flatMap((c) => c.keys));
  for (const k of idx.keys) if (!held.has(k)) out.push({ id: `setting › ${k}`, page: 'Settings', label: k, kind: 'setting', file: SETTINGS_KEYS, lines: [], routes: ['/api/settings'], keys: [k], handles: [] });
  for (const c of out) { c.routes = [...new Set(c.routes.filter((r) => /^\/api\/[\w-]/.test(r)))].sort(); c.keys.sort(); }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ── Browser walk (read-only) ──────────────────────────────────────────────────────────────────────────────────────
/** The hash routes the walk opens: every view, every Settings tab, the deep pages a real store names. */
export async function walkRoutes(base) {
  const get = async (p) => { try { const r = await fetch(new URL(p, base)); return r.ok ? r.json() : {}; } catch { return {}; } };
  const views = ['chat', 'runs', 'new', 'schedules', 'schedules/once', 'schedules/repeating', 'schedules/activity', 'projects', 'workspaces',
    'workspace-create', 'workflows', 'workflows/agents', 'workflows/scripts', 'marketplace', 'marketplace/installed', 'marketplace/browse',
    'connectors', 'models', 'providers', 'team-policy', 'stats', 'team-metrics', 'team-metrics/timeline', 'requirements', 'design', 'profile',
    'getting-started', 'activity'];
  for (const t of ['general', 'tags', 'presets', 'runs', 'automations', 'experimental', 'ask', 'guardrails', 'memory']) views.push(`settings/${t}`);
  const proj = ((await get('/api/projects')).projects || []).find((p) => p.exists);
  if (proj) { views.push(`projects/${proj.key}`); for (const t of ['team', 'settings', 'mcp', 'actions', 'automations', 'away', 'memory']) views.push(`projects/${proj.key}/${t}`); }
  const runs = (await get('/api/history')).pipelines || [];
  for (const st of ['completed', 'failed', 'stopped', 'paused']) {
    const r = runs.find((x) => x.status === st && x.projectKey);
    if (r) views.push(`history/${r.projectKey}/${r.id}`);
  }
  const ws = ((await get('/api/workspaces')).workspaces || [])[0];
  if (ws) views.push(`workspaces/${ws.id}`);
  const th = ((await get('/api/ask/threads')).threads || [])[0];
  if (th) views.push(`chat/${th.id}`);
  return views;
}

// Runs in the page: every visible control under the open view (or an open dialog/menu), as plain records.
function collectInPage(scopeSel) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const roots = scopeSel ? [...document.querySelectorAll(scopeSel)].filter(vis) : [document.body];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=switch], [role=tab], [role=checkbox], [role=radio], [role=option], [role=dialog], dialog[open]';
  const out = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      if (el.closest('#stillhet-root, [data-stillhet]')) continue;
      const role = el.getAttribute('role') || '';
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const kind = /^menuitem/.test(role) ? 'menu item' : role === 'option' ? 'option' : role === 'tab' ? 'tab' : (role === 'dialog' || tag === 'dialog') ? 'dialog'
        : (role === 'switch' || role === 'checkbox' || role === 'radio' || type === 'checkbox' || type === 'radio') ? 'toggle'
          : (tag === 'input' || tag === 'select' || tag === 'textarea') ? 'field' : tag === 'a' && !el.classList.contains('btn') ? 'link' : 'button';
      let label = el.getAttribute('aria-label') || '';
      if (!label && el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) label = l.textContent; }
      if (!label && el.getAttribute('aria-labelledby')) { const l = document.getElementById(el.getAttribute('aria-labelledby').split(' ')[0]); if (l) label = l.textContent; }
      if (!label && kind !== 'field' && kind !== 'dialog') label = el.textContent;
      if (!label) label = el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '';
      label = String(label).replace(/\s+/g, ' ').trim().slice(0, 70);
      const data = {};
      for (const a of el.attributes) if (a.name.startsWith('data-') && a.value.length < 40) data[a.name.slice(5)] = a.value;
      out.push({ kind, label, id: el.id || '', data, href: tag === 'a' ? el.getAttribute('href') : undefined, popup: el.getAttribute('aria-haspopup') || '' });
    }
  }
  return out;
}

/** Walks a classic instance read-only and returns { base, mode, at, pages: [{ route, page, controls, menus }] }. */
export async function walk(base, { log = console.log } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome' });   // the installed Chrome, as the gates do
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let aborted = 0;
  await ctx.route('**/*', (route) => { if (route.request().method() !== 'GET') { aborted++; return route.abort(); } return route.continue(); });
  const page = await ctx.newPage();
  const settings = await (await fetch(new URL('/api/settings', base))).json().catch(() => ({}));
  const out = { base, mode: settings.uiLevel || '', at: new Date().toISOString().slice(0, 10), pages: [] };
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  for (const route of await walkRoutes(base)) {
    try {
      await page.evaluate((h) => { location.hash = h; }, route);
      await page.waitForTimeout(1600);
      const head = route.split('/')[0];
      const viewSel = `section.view[data-view="${head === 'history' || head === 'running' ? 'runs' : head}"]:not(.hidden)`;
      const hasView = await page.$(viewSel);
      const controls = await page.evaluate(collectInPage, hasView ? `${viewSel}, header, nav, .topnav, .sidebar` : null);
      const menus = [];
      const pops = await page.$$(`${hasView ? viewSel : 'body'} [aria-haspopup]:not([aria-haspopup="false"])`);
      for (const el of pops.slice(0, 40)) {
        try {
          if (!(await el.isVisible())) continue;
          const trigger = ((await el.getAttribute('aria-label')) || (await el.textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          await el.click({ timeout: 1500 });
          await page.waitForTimeout(350);
          const items = await page.evaluate(collectInPage, '[role=menu], [role=listbox], [role=dialog]:not(.hidden), dialog[open], .viewer-modal:not(.hidden), .menu:not(.hidden), .popover:not(.hidden)');
          menus.push({ trigger, items });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          const cancel = await page.$('.viewer-modal:not(.hidden) button:text-matches("^(Cancel|Close)$")');
          if (cancel) { await cancel.click({ timeout: 1000 }).catch(() => {}); await page.waitForTimeout(150); }
        } catch { await page.keyboard.press('Escape').catch(() => {}); }
      }
      const slim = (xs) => [...new Map(xs.filter((x) => x.kind !== 'option' && x.kind !== 'link').map((x) => [`${x.kind}|${x.label}|${x.id}`, { kind: x.kind, label: x.label, ...(x.id ? { id: x.id } : {}) }])).values()];
      out.pages.push({ route, page: VIEW_PAGE[head] || 'Shell', controls: slim(controls), menus: menus.map((m) => ({ trigger: m.trigger, items: slim(m.items) })).filter((m) => m.items.length) });
      log(`walk: #${route} ${controls.length} controls, ${menus.length} menus`);
    } catch (e) { log(`walk: #${route} failed: ${e.message}`); }
  }
  out.aborted = aborted;
  await browser.close();
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[…⋯.:]+$/g, '').replace(/\s+/g, ' ').replace(/\s*\d+$/, '').trim();
// Data the walk sees, not a control: a run, chat or project row, a count, a date.
const DATA_LABEL = (l) => !l || l.length > 48 || /\d{2}[:/-]\d{2}|\$\d|\b\d{3,}\b|^[\d\s.,%$·-]+$/.test(l) || /^(ask_|feat\/|fix\/)/.test(l);

/** Joins the walk to the static controls: by id, then by page and label. A walk control with no static twin is kept only
 *  when its label is a literal in today's UI (then its routes come from the code there, `src`); the rest is data (a run's
 *  title, a person, a count) and is only counted (`walkOnlyDropped`). */
export function merge(staticControls, walkData, idx = null) {
  const out = staticControls.map((c) => ({ ...c, seen: [] }));
  if (!walkData) return out;
  const byHandle = new Map(), byLabel = new Map();
  for (const c of out) {
    for (const h of c.handles || []) byHandle.set(h, c);
    const k = norm(c.label); if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k).push(c);
  }
  const extra = new Map(), dropped = new Set();
  const find = (label) => {
    if (!idx) return null;
    for (const [f, s] of Object.entries(idx.src)) {
      for (const pat of [`'${label}'`, `"${label}"`, `\`${label}\``, `>${label}<`]) {
        const o = s.text.indexOf(pat);
        if (o < 0) continue;
        const p = f.endsWith('.html') ? { routes: new Set(), keys: new Set() } : blockParts(idx, f, o);
        const ok = p.routes.size <= MAX_BLOCK;
        return { src: `${f}:${s.line(o)}`, routes: ok ? [...p.routes].filter((r) => /^\/api\/[\w-]/.test(r)).sort() : [], keys: ok ? [...p.keys].sort() : [] };
      }
    }
    return null;
  };
  const take = (pg, ctl, via) => {
    if (ctl.kind === 'option' || ctl.kind === 'link') return;
    let hit = ctl.id && byHandle.get(ctl.id);
    if (!hit) { const l = byLabel.get(norm(ctl.label)) || []; hit = l.find((c) => c.page === pg.page) || l[0]; }
    if (hit) { if (!hit.seen.includes(pg.route)) hit.seen.push(pg.route); return; }
    const id = `walk › ${pg.page} › ${ctl.kind} › ${ctl.label}`;
    if (DATA_LABEL(ctl.label) || dropped.has(id)) { dropped.add(id); return; }
    if (!extra.has(id)) {
      const f = find(ctl.label);
      if (!f) { dropped.add(id); return; }
      extra.set(id, { id, page: pg.page, label: ctl.label, kind: ctl.kind, file: '', src: f.src, lines: [], routes: f.routes, keys: f.keys, handles: ctl.id ? [ctl.id] : [], seen: [], ...(via && !DATA_LABEL(via) ? { in: via } : {}) });
    }
    const e = extra.get(id); if (!e.seen.includes(pg.route)) e.seen.push(pg.route);
  };
  for (const pg of walkData.pages) {
    for (const c of pg.controls) take(pg, c);
    for (const m of pg.menus) for (const c of m.items) take(pg, c, m.trigger);
  }
  const all = [...out, ...[...extra.values()].sort((a, b) => a.id.localeCompare(b.id))];
  all.walkOnlyDropped = dropped.size;
  return all;
}

// The walk as committed: no real data. Only the controls the merge kept (a label the code has), no row's title as a menu's
// trigger, and every address with its project key, task id or chat id replaced by KEY / ID.
const PLACEHOLDER = (r) => r.replace(/^(projects|workspaces)\/[^/]+/, '$1/KEY').replace(/^history\/[^/]+\/[^/]+/, 'history/KEY/ID').replace(/^(chat|running)\/[^/]+/, '$1/ID');
export function sanitizeWalk(w, controls) {
  const labels = new Set(controls.map((c) => norm(c.label))), handles = new Set(controls.flatMap((c) => c.handles || []));
  const keep = (x) => labels.has(norm(x.label)) || (x.id && handles.has(x.id));
  for (const c of controls) c.seen = [...new Set(c.seen.map(PLACEHOLDER))];
  return { ...w, pages: w.pages.map((pg) => ({ ...pg, route: PLACEHOLDER(pg.route), controls: pg.controls.filter(keep),
    menus: pg.menus.map((m) => ({ trigger: labels.has(norm(m.trigger)) ? m.trigger : '(a row\'s menu)', items: m.items.filter(keep) })).filter((m) => m.items.length) })) };
}

// ── Classification ────────────────────────────────────────────────────────────────────────────────────────────────
const WIRING = 'plans/rail/stillhet-wiring.md';
const PLAN = 'plans/rail/test-results/PLAN.md';
const FINDINGS_RESULTS = 'plans/rail/test-results/FINDINGS.md';
const LEDGER = 'plans/rail/findings.md';
const ROW_STATUS = /^\**(wired \(partial\)|wired|new: built|wire to|new: build it|add to the design first|not offered live|not a dev capability)\b/;
const STATUS_OF = { wired: 'wired', 'wired (partial)': 'wired', 'new: built': 'wired', 'wire to': 'planned', 'new: build it': 'planned',
  'add to the design first': 'planned', 'not offered live': 'not offered', 'not a dev capability': 'not offered' };

/** Route mentions in a text (`/api/a/:id/b`, `/api/x/*`), normalized: a trailing `*` is kept as a prefix mark. The short forms
 *  the wiring map writes count too: `…/start|stop` (each), "`/api/x/:id/pause` / `resume`" (a sibling), "`…/plan/save`"
 *  (under the route named before it). */
export function docRoutes(text) {
  const out = [];
  const t = String(text);
  let prev = '';
  for (const m of t.matchAll(/(?:\/api|…|\.\.\.)\/[\w\-/:.*…{}|]+/g)) {
    let raw = m[0];
    if (!raw.startsWith('/api')) {
      if (!prev) continue;
      const rel = raw.replace(/^(…|\.\.\.)/, '');
      const first = rel.split('/')[1];
      const at = prev.lastIndexOf('/' + first);
      raw = (at > 0 ? prev.slice(0, at) : prev.slice(0, prev.lastIndexOf('/'))) + rel;
    }
    const p0 = raw.replace(/[.,:;)]+$/, '').replace(/\/(…|\.\.\.)$/, '/*').replace(/\{[^}]*\}/g, ':x').replace(/\/+$/, '');
    if (!/^\/api\/[\w-]/.test(p0)) continue;
    const segs = p0.split('/');
    const last = segs.pop();
    const forms = last.split('|').map((x) => [...segs, x].join('/'));
    // "`/api/x/:id/pause` / `resume`", "… `/start` and `/stop`": bare sibling words right after the mention
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const sib = /^`?\s*(?:\/|,|or|and)\s*`\/?([a-z][\w-]*)`/.exec(tail);
    if (sib && !/^api$/.test(sib[1])) forms.push([...segs, sib[1]].join('/'));
    for (const f of forms) out.push(f);
    prev = forms[0];
  }
  return out;
}
/** Does classic's call path hit a Stillhet path or a mentioned route? Same segment count; each segment equal, or classic's is
 *  a :param, or the other's is a :name and classic's is not a plain word (`/api/projects/bulk` is not `/api/projects/:key`). */
export function sameRoute(call, other) {
  const a = call.split('/'), b = other.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || s.startsWith(':') || (b[i].startsWith(':') && !/^[a-z][a-z-]*$/.test(s)));
}
const routeHits = (call, mention) => mention.endsWith('/*') ? (call + '/').startsWith(mention.slice(0, -1)) : sameRoute(call, mention);

// A live/ file's place by its name; the rest of live/ and the files at the root (the shared loader, the host) serve every place.
const LIVE_PLACE = [[/^(chat-live|chat-turns)\./, 'chat'], [/^(task-live|task-page|terminal-live)\./, 'runs'], [/^projects-/, 'projects'],
  [/^market-/, 'marketplace'], [/^schedule-/, 'schedules'], [/^workflow-/, 'workflows'], [/^insights-/, 'insights'], [/^run-options-/, 'centers']];
/** A Stillhet file's place (`stillhet/projects/x.js` → projects, `stillhet/live/task-live.mjs` → runs), or '*' for shared code. */
export function placeOf(file) {
  const m = /stillhet\/(?:([\w-]+)\/)?([\w.-]+)$/.exec(file);
  if (!m || !m[1]) return '*';
  if (m[1] !== 'live') return m[1];
  const hit = LIVE_PLACE.find(([re]) => re.test(m[2]));
  return hit ? hit[1] : '*';
}

// A wiring section's place: its rows are that place's capabilities.
const SECTION_PLACE = [[/^Chat capabilities/, 'chat'], [/^Schedules capabilities/, 'schedules'], [/^Tasks capabilities/, 'runs']];

/** Stillhet's files as [file, place]; a module of today's UI it imports takes its importer's place. */
function stillhetFiles(root) {
  const files = walkDir(root, 'ui/public/stillhet').filter((f) => !/\/(components|graph)\.js$/.test(f));
  const deps = new Map();
  for (const f of files) {
    for (const m of readFileSync(join(root, f), 'utf8').matchAll(/(?:from|import\()\s*['"]((?:\.\.\/)+[\w\-/]+\.mjs)['"]/g)) {
      const abs = join(root, f, '..', m[1]); const rel = relative(root, abs).split('\\').join('/');
      if (rel.startsWith('ui/public/') && !rel.startsWith('ui/public/stillhet/') && existsSync(abs) && !deps.has(rel)) deps.set(rel, placeOf(f));
    }
  }
  return [...files.map((f) => [f, placeOf(f)]), ...deps];
}

/** Everything classify reads: Stillhet's fetches and live keys, the wiring rows, the plan texts. */
export function classifyIndex(root = ROOT) {
  const stillhetRoutes = new Map(), liveText = [], fileNames = new Map();
  for (const [f, place] of stillhetFiles(root)) {
    const t = readFileSync(join(root, f), 'utf8');
    if (f.startsWith('ui/public/stillhet/')) fileNames.set(f.split('/').pop(), place);
    for (const p of callPathsOf(t)) { if (!stillhetRoutes.has(p)) stillhetRoutes.set(p, []); stillhetRoutes.get(p).push([f.replace('ui/public/', ''), place]); }
    if (/stillhet\/(live|pulse|chat)\//.test(f)) liveText.push(t);
  }
  const wiring = readFileSync(join(root, WIRING), 'utf8');
  const rows = [];
  let section = '', top = '';
  for (const line of wiring.split('\n')) {
    if (line.startsWith('#')) section = line.replace(/^#+\s*/, '');
    if (line.startsWith('## ')) top = section;
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    let st = null;
    for (const c of [...cells].reverse()) { const m = ROW_STATUS.exec(c.replace(/`/g, '')); if (m) { st = STATUS_OF[m[1]]; break; } }
    if (!st) continue;
    // The places of the Stillhet files a row names (`live/task-live.mjs`, `projects/project-add.js › …`), and its section's.
    const places = [...new Set([...line.matchAll(/([\w-]+\.m?js)\b/g)].map((x) => fileNames.get(x[1])).filter(Boolean))];
    const sp = SECTION_PLACE.find(([re]) => re.test(top));
    if (sp && !places.includes(sp[1])) places.push(sp[1]);
    rows.push({ section, id: cells[0].replace(/`/g, ''), status: st, routes: docRoutes(line), places, line });
  }
  const plans = [];
  const ledger = readFileSync(join(root, LEDGER), 'utf8');
  const open = ledger.slice(ledger.indexOf('## Open'), ledger.indexOf('## Closed') > 0 ? ledger.indexOf('## Closed') : undefined);
  for (const line of open.split('\n')) if (line.startsWith('|')) {
    const cells = line.split('|').map((c) => c.trim());
    const cov = /\b(COV-\d+)\b/.exec(line);
    plans.push({ cite: cov ? `findings.md ${cov[1]}` : `findings.md: ${cells[2]}, ${(cells[3] || '').slice(0, 50)}`, text: line, own: !!cov });
  }
  for (const f of [PLAN, FINDINGS_RESULTS]) {
    let head = '';
    for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
      if (line.startsWith('#')) { head = line.replace(/^#+\s*/, ''); continue; }
      const fid = /\b(F-[\w-]+?\d+|[A-Z]{2}-\d+)\b/.exec(line);
      if (line.trim()) plans.push({ cite: `${f.split('/').pop()} ${fid ? fid[1] : head.slice(0, 40)}`, text: line, own: /\bCOV-\d+\b/.test(line) });
    }
  }
  for (const p of plans) p.routes = docRoutes(p.text);
  const overrides = new Map(rows.filter((r) => r.section === 'Classic controls').map((r) => [r.id, r]));
  return { stillhetRoutes, live: liveText.join('\n'), rows: rows.filter((r) => r.section !== 'Classic controls'), plans, overrides, keyMemo: new Map(), routeMemo: new Map() };
}

/** One route's status for a classic page: { status, where }. `/api/settings` itself is carried by its keys. Wired only when
 *  Stillhet calls it, or a `wired` row names it, from one of the page's places: a call from another place clears nothing. */
export function routeStatus(cx, r, page) {
  const memo = `${page}|${r}`;
  if (cx.routeMemo.has(memo)) return cx.routeMemo.get(memo);
  const places = PAGES[page]?.places || [];
  const ours = (place) => place === '*' || places.includes('*') || places.includes(place);
  let out = null;
  for (const [p, fs] of cx.stillhetRoutes) {
    const f = fs.find(([, place]) => ours(place));
    if (f && sameRoute(r, p)) { out = { status: 'wired', where: `stillhet/${f[0].replace(/^stillhet\//, '')}` }; break; }
  }
  if (!out) {
    const hit = cx.rows.filter((row) => row.routes.some((m) => routeHits(r, m)) && (row.status !== 'wired' || row.places.some(ours)));
    const best = hit.sort((a, b) => ORDER[a.status] - ORDER[b.status])[0];
    if (best) out = { status: best.status, where: `stillhet-wiring.md ${best.section}: ${best.id.slice(0, 70)}` };
  }
  if (!out) { const p = cx.plans.find((x) => !x.own && x.routes.some((m) => routeHits(r, m))); if (p) out = { status: 'planned', where: p.cite }; }
  out = out || { status: 'MISSING', where: '' };
  cx.routeMemo.set(memo, out);
  return out;
}

/** One Settings key's status: { status, where }. */
export function keyStatus(cx, k) {
  if (cx.keyMemo.has(k)) return cx.keyMemo.get(k);
  const re = new RegExp(`(^|[^\\w$])${k}([^\\w$]|$)`);
  let out = null;
  const row = cx.rows.find((r) => r.id === `setting › ${k}`);
  if (row) out = { status: row.status, where: `stillhet-wiring.md Dev surfaces: setting › ${k}` };
  else if (re.test(cx.live)) out = { status: 'wired', where: 'Stillhet live code reads it' };
  else { const p = cx.plans.find((x) => !x.own && new RegExp('`' + k + '`|\\b' + k + '\\b').test(x.text)); if (p) out = { status: 'planned', where: p.cite }; }
  out = out || { status: 'MISSING', where: '' };
  cx.keyMemo.set(k, out);
  return out;
}

/** A control's classification: { status, where, missing: [the routes and keys that are MISSING] }. */
export function classify(cx, c) {
  const ov = cx.overrides.get(c.id);
  if (ov) return { status: ov.status, where: `stillhet-wiring.md Classic controls: ${ov.line.split('|')[3]?.trim().slice(0, 90) || ''}`, missing: [] };
  const parts = [];
  for (const r of c.routes) if (r !== '/api/settings') parts.push([`route ${r}`, routeStatus(cx, r, c.page)]);
  for (const k of c.keys) parts.push([`setting ${k}`, keyStatus(cx, k)]);
  if (!parts.length) {
    const p = PAGES[c.page];
    return p ? { status: p.status, where: `view control: ${p.where}`, missing: [] } : { status: null, where: `no place for page ${c.page}`, missing: [] };
  }
  const worst = parts.reduce((a, b) => (ORDER[b[1].status] > ORDER[a[1].status] ? b : a));
  const missing = parts.filter((p) => p[1].status === 'MISSING').map((p) => p[0]);
  return { status: worst[1].status, where: worst[1].status === 'MISSING' ? missing.join(', ') : worst[1].where, missing };
}

// ── Output ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The MISSING ids of a classified list, sorted. */
export const missingIds = (classified) => classified.filter((c) => c.status === 'MISSING').map((c) => c.id).sort();

export function report(controls, classified, baseline, walkData, titles = {}) {
  const n = (s) => classified.filter((c) => c.status === s).length;
  const view = classified.filter((c) => c.status === 'wired' && /^view control/.test(c.where)).length;
  const L = [];
  L.push('# Classic coverage: every classic control and where it stands in Stillhet', '');
  L.push('Generated by `node tools/classic-inventory.mjs` (gate.coverage, `docs/rail/gate.md`); never edited by hand. The data is `classic-controls.json`; '
    + 'the MISSING ids and their finding ids are `test/fixtures/stillhet-coverage-baseline.json`, which only shrinks (`test/stillhet-coverage.test.mjs`).', '');
  L.push(`Sources: a static scan of today's UI (${new Set(controls.filter((c) => c.file).map((c) => c.file)).size} files)`
    + (walkData ? ` and a read-only browser walk of ${walkData.base} in ${walkData.mode || 'its'} mode on ${walkData.at} (${walkData.pages.length} pages, ${walkData.aborted || 0} writes aborted)` : '') + '.', '');
  L.push('| Status | Controls |', '|---|---|');
  L.push(`| wired | ${n('wired')} (of them ${view} view controls with no route or key, carried by their place) |`);
  const pview = classified.filter((c) => c.status === 'planned' && /^view control/.test(c.where)).length;
  L.push(`| planned | ${n('planned')} (of them ${pview} view controls of a place still to be built) |`, `| not offered (decision) | ${n('not offered')} |`, `| MISSING | ${n('MISSING')} |`, `| total | ${classified.length} |`, '');
  const pages = [...new Set(classified.map((c) => c.page))].sort();
  L.push('## By page', '', '| Page | Stillhet place | Controls | wired | planned | not offered | MISSING |', '|---|---|---|---|---|---|---|');
  for (const p of pages) {
    const cs = classified.filter((c) => c.page === p);
    const k = (s) => cs.filter((c) => c.status === s).length;
    L.push(`| ${p} | ${PAGES[p]?.where || ''} | ${cs.length} | ${k('wired')} | ${k('planned')} | ${k('not offered')} | ${k('MISSING')} |`);
  }
  L.push('', '## MISSING', '', 'Each MISSING control, grouped by its finding (`plans/rail/findings.md`, PLAN.md B9). A finding closes when its controls are wired or decided.', '');
  const groups = new Map();
  for (const c of classified.filter((x) => x.status === 'MISSING')) {
    const g = baseline[c.id] || '(no finding yet)';
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c);
  }
  for (const [g, cs] of [...groups].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    L.push(`### ${g}${titles[g] ? `: ${titles[g]}` : ''}`, '', '| Page | Control | Kind | Missing | Source |', '|---|---|---|---|---|');
    for (const c of cs) L.push(`| ${c.page} | ${c.label.replace(/\|/g, '\\|')} | ${c.kind} | ${c.missing.map((m) => '`' + m + '`').join(', ')} | ${c.file ? `${c.file}:${c.lines[0]}` : `walk ${c.seen[0] ? '#' + c.seen[0] : ''}`} |`);
    L.push('');
  }
  const planned = new Map();
  for (const c of classified.filter((x) => x.status === 'planned')) { const k = c.where.replace(/^view control: /, ''); if (!planned.has(k)) planned.set(k, []); planned.get(k).push(c); }
  L.push('## Planned', '', 'Each plan or row that carries planned controls, with how many and a few of them.', '', '| Plan, finding or row | Controls | For example |', '|---|---|---|');
  for (const [k, cs] of [...planned].sort((a, b) => b[1].length - a[1].length)) L.push(`| ${k.replace(/\|/g, '\\|').slice(0, 120)} | ${cs.length} | ${[...new Set(cs.map((c) => `${c.page} › ${c.label}`))].slice(0, 4).join('; ').replace(/\|/g, '\\|')} |`);
  const off = classified.filter((c) => c.status === 'not offered');
  L.push('', '## Not offered (decision)', '');
  if (!off.length) L.push('None: no classic control reaches a `not offered live` or `not a dev capability` row yet.');
  for (const c of off) L.push(`- ${c.page} › ${c.label} (${c.kind}): ${c.where}`);
  const wired = new Map();
  for (const c of classified.filter((x) => x.status === 'wired' && !/^view control/.test(x.where))) { const k = c.where; wired.set(k, (wired.get(k) || 0) + 1); }
  L.push('', '## Wired', '', `${n('wired') - view} controls reach a route or key Stillhet carries; ${view} are view controls (no route, no key) of a page whose place Stillhet has. Where they land:`, '', '| Stillhet code or row | Controls |', '|---|---|');
  for (const [k, v] of [...wired].sort((a, b) => b[1] - a[1])) L.push(`| ${k.replace(/\|/g, '\\|').slice(0, 120)} | ${v} |`);
  L.push('', 'Every control, with its routes, keys, source line and the walk pages it was seen on: `classic-controls.json`. One control: `node tools/classic-inventory.mjs --show TEXT`.');
  return L.join('\n') + '\n';
}

export function readJson(root, rel, dflt) { return existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), 'utf8')) : dflt; }

export async function main(argv = process.argv.slice(2), { root = ROOT, out = console } = {}) {
  const wi = argv.indexOf('--walk');
  let fresh = null;
  mkdirSync(join(root, DIR), { recursive: true });
  if (wi >= 0) {
    const base = argv[wi + 1];
    if (!base || /:4317\b/.test(base)) { out.log('--walk needs a classic instance URL (never 4317).'); return 1; }
    fresh = await walk(base, { log: (s) => out.log(s) });   // written below, only once sanitized
  }
  let walkData = fresh || readJson(root, WALK, null);
  const idx = indexSources(root);
  const controls = merge(scanStatic(root, idx), walkData, idx);
  if (walkData) { walkData = sanitizeWalk(walkData, controls); writeFileSync(join(root, WALK), JSON.stringify(walkData, null, 1) + '\n'); }
  const cx = classifyIndex(root);
  const classified = controls.map((c) => ({ ...c, ...classify(cx, c) }));
  const baseline = readJson(root, BASELINE, {});
  writeFileSync(join(root, CONTROLS), '[\n' + controls.map(({ handles, ...c }) => JSON.stringify(c)).join(',\n') + '\n]\n');
  const titles = {};
  for (const m of readFileSync(join(root, LEDGER), 'utf8').matchAll(/\b(COV-\d+): (.+?): classic offers it/g)) titles[m[1]] = m[2];
  writeFileSync(join(root, REPORT), report(controls, classified, baseline, walkData, titles));
  const miss = missingIds(classified);
  const grew = miss.filter((id) => !(id in baseline));
  if (argv.includes('--update')) {
    if (grew.length && Object.keys(baseline).length) { out.log(`Refused: ${grew.length} MISSING controls are not in the baseline (add a finding first):`); for (const id of grew.slice(0, 40)) out.log('  ' + id); return 1; }
    const next = {}; for (const id of miss) next[id] = baseline[id] || '';
    writeFileSync(join(root, BASELINE), JSON.stringify(next, null, 1) + '\n');
  }
  const si = argv.indexOf('--show');
  if (si >= 0) for (const c of classified.filter((x) => x.label.toLowerCase().includes(String(argv[si + 1]).toLowerCase()))) out.log(`${c.status}\t${c.id}\t${c.where}\t${c.routes.join(' ')} ${c.keys.join(' ')}`);
  const n = (s) => classified.filter((c) => c.status === s).length;
  out.log(`classic controls: ${classified.length}; wired ${n('wired')}, planned ${n('planned')}, not offered ${n('not offered')}, MISSING ${n('MISSING')}, unclassified ${classified.filter((c) => !c.status).length}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
