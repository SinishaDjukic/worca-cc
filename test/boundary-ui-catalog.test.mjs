// test/boundary-ui-catalog.test.mjs
// The engine catalog (src/shared/engine-switch.mjs ENGINES) is where the UI learns every engine fact it shows
// (plans/core-protection-layer-design.md §4.4, core-4): the engine pickers, the effort lists, the sign-in text and the
// helper notes, and the CLI's and the chat's engine lists and sign-in text too. So an engine PR touches the catalog, its
// adapter and its fixtures, never a UI file. The scan below fails on an engine name or label written into ui/public,
// src/shared, src/cli or src/core/ask outside the catalog, apart from a frozen allow list of product behaviour that may
// only shrink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ENGINES, ENGINE_NAMES, MODEL_ENGINE_NAMES, DEFAULT_ENGINE, HELPER_ENGINE_NAMES, CHAT_ENGINE_NAMES, BETA_ENGINES, engineOptions, engineLabel, engineList, engineChoiceLabel, engineHelpList, isBetaEngine } from '../src/shared/engine-switch.mjs';
import { REMOTE_ENGINES } from '../src/shared/exec-env.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_SYSTEM_RULES } from '../src/core/ask/prompt.mjs';
import { HARNESS_EFFORTS, HARNESS_NAMES, SIGNIN_LABELS } from '../src/shared/connections.mjs';
import { EFFORTS, CODEX_EFFORTS, CURSOR_EFFORTS, COPILOT_EFFORTS, ALL_EFFORTS, HELPER_ENGINES, ASK_ENGINES, effortsForEngine, REASONING_EFFORT_LEVELS } from '../src/core/model-env.mjs';
import { ASK_CHAT_ENGINES } from '../ui/public/ask-engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = 'src/shared/engine-switch.mjs';

/** Every UI source the scan reads: ui/public's scripts and pages, src/shared (served to the browser as-is), the CLI
 *  (src/cli: its help names the engines) and the chat (src/core/ask: its tools and rules name them). */
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const d of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) { if (d.name !== 'vendor' && d.name !== 'node_modules') walk(rel); continue; }
      if (/\.(mjs|js|html)$/.test(d.name) && !/\.min\.js$/.test(d.name) && rel !== CATALOG) out.push(rel);
    }
  };
  walk('ui/public'); walk('src/shared'); walk('src/cli'); walk('src/core/ask');
  return out.sort();
}

/** A JS source split in two, both the source's length with its newlines kept: `code` (comments and literals blanked)
 *  and `text` (only string, template and regex literal contents). Prose in a comment never counts. */
function splitJs(src) {
  let code = ''; let text = ''; let i = 0; let last = '';
  const holes = [];   // a template's `${` depth, so its closing `}` resumes the template
  let depth = 0;
  const put = (s, kind) => {
    const blank = s.replace(/[^\n]/g, ' ');
    code += kind === 'code' ? s : blank; text += kind === 'text' ? s : blank;
  };
  const keyword = () => /(?:^|[^\w$.])(return|typeof|case|in|of|void|delete|throw|new|else|do|yield|await)\s*$/.test(code);
  while (i < src.length) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { const end = src.indexOf('\n', i); const j = end < 0 ? src.length : end; put(src.slice(i, j), 'comment'); i = j; continue; }
    if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2); const j = end < 0 ? src.length : end + 2; put(src.slice(i, j), 'comment'); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      put(src.slice(i, j + 1), 'text'); i = j + 1; last = c; continue;
    }
    if (c === '`' || (c === '}' && holes.length && holes.at(-1) === depth)) {
      if (c === '}') holes.pop();
      let j = i + 1; while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
      if (src[j] === '$') { put(src.slice(i, j + 2), 'text'); holes.push(depth); i = j + 2; last = '{'; continue; }
      put(src.slice(i, j + 1), 'text'); i = j + 1; last = '`'; continue;
    }
    if (c === '/' && (!last || '(,=:[!&|?{};+-*%<>~^'.includes(last) || keyword())) {
      let j = i + 1; let cls = false;
      while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      while (/[a-z]/.test(src[j + 1] || '')) j++;
      put(src.slice(i, j + 1), 'text'); i = j + 1; last = '/'; continue;
    }
    if (c === '{') depth++; else if (c === '}') depth--;
    put(c, 'code'); if (!/\s/.test(c)) last = c; i++;
  }
  return { code, text };
}
/** splitJs of one scanned file, read and split once for every scan below. */
const splitCache = new Map();
function splitFile(rel) {
  if (!splitCache.has(rel)) splitCache.set(rel, splitJs(readFileSync(join(ROOT, rel), 'utf8')));
  return splitCache.get(rel);
}

/** The non-default engines' names as they can appear in UI code: the id and every display name. The default engine
 *  (what a run gets when it names none) stays nameable everywhere. */
function engineWords() {
  const words = new Set();
  for (const e of ENGINE_NAMES.filter((x) => x !== DEFAULT_ENGINE)) for (const w of [e, ENGINES[e].label, ENGINES[e].harness]) if (w) words.add(w);
  return [...words];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each engine word's hits in one file, as `line: text`: in a string, template or regex literal, as an object key,
 *  and anywhere in a page outside its comments. An identifier (`let cursor`) or a property read (`style.cursor`) is
 *  not one. */
function hitsIn(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const html = rel.endsWith('.html');
  const { code, text } = html ? { code: '', text: src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')) } : splitFile(rel);
  const lines = src.split('\n');
  const lineOf = (s, at) => s.slice(0, at).split('\n').length;
  const out = {};
  for (const w of engineWords()) {
    const found = [];
    for (const m of text.matchAll(new RegExp(`(?<![\\w$-])${esc(w)}(?![\\w$])`, 'g'))) found.push(lineOf(text, m.index));
    for (const m of code.matchAll(new RegExp(`(?<=[{,]\\s*)${esc(w)}(?=\\s*:)`, 'g'))) found.push(lineOf(code, m.index));
    if (found.length) out[w] = found.map((n) => `${n}: ${lines[n - 1].trim().slice(0, 160)}`);
  }
  return out;
}

/** The engine words still allowed per file, as counts. Each is product behaviour of one engine, not a fact an engine
 *  picker, effort list, sign-in text or helper note shows. It only shrinks: a count that drops fails until it is lowered
 *  here, and a new hit fails until its fact moves into the catalog. */
const ALLOWED = Object.freeze({
  // `worca models`: the GitHub Copilot bridge provider (login, logout, import, its notice); a Codex model's own endpoint;
  // the Gemini and Qwen hosted-API import presets (bridge providers named after Google's and Alibaba's APIs, not the engines).
  'src/cli/models.mjs': { codex: 1, copilot: 14, Copilot: 13, gemini: 3, qwen: 2 },
  // The tmp folders Requirements reads deny: each engine's own scratch folder, named on disk after it.
  'src/core/ask/deny-rules.mjs': { codex: 1, copilot: 1, cursor: 1, gemini: 1, goose: 1, opencode: 1, qwen: 1 },
  // The list_copilot_models status line (the bridge provider).
  'src/core/ask/events.mjs': { Copilot: 1 },
  // A Codex model's own endpoint; the GitHub Copilot bridge provider (its sign-in, import_copilot).
  'src/core/ask/model-proposal.mjs': { codex: 3, copilot: 5, Copilot: 6 },
  // The Copilot bridge provider's notice.
  'src/core/ask/models.mjs': { Copilot: 1 },
  // The Codex chat's own rules; rule 18's GitHub Copilot bridge provider.
  'src/core/ask/prompt.mjs': { codex: 2, Codex: 4, copilot: 1, Copilot: 4 },
  // Codex's helper-job slots in the chat's settings registry.
  'src/core/ask/settings-registry.mjs': { codex: 5 },
  // A chat list's page cursor (the list's own field, not the engine).
  'src/core/ask/store.mjs': { cursor: 2 },
  // The suggestion model of a Codex chat.
  'src/core/ask/suggest.mjs': { codex: 1 },
  // A Copilot built-in's id; the bridge provider; a cursor or codex model entry's fields (settings.mjs
  // assertCursorFields, assertCodexFields); the Gemini and Qwen hosted APIs list_endpoint_models reads.
  'src/core/ask/tools.mjs': { codex: 4, copilot: 12, Copilot: 8, gemini: 1, qwen: 1 },
  // The Codex and Copilot chat turns (gates, lockdown, resume).
  'src/core/ask/turn.mjs': { codex: 5, copilot: 3 },
  // Codex reaches an OpenAI-compatible endpoint itself (codexReaches, runsOnText); GitHub Copilot as a bridge provider.
  'src/shared/connections.mjs': { codex: 5, Codex: 2, copilot: 1, Copilot: 1 },
  // The Codex built-ins list (/api/models `codex`); the GitHub Copilot bridge provider (sign-in, import, usage).
  'ui/public/app.js': { codex: 1, copilot: 27, Copilot: 8 },
  // Copilot built-in ids (copilot/<id>) grouped by family; Import from Copilot (the bridge provider).
  'ui/public/ask-panel.mjs': { copilot: 4, Copilot: 1 },
  // The Codex endpoint connection; the GitHub Copilot bridge provider; the Gemini and Qwen hosted-API import presets.
  'ui/public/bridge-view.mjs': { codex: 9, Codex: 5, copilot: 17, Copilot: 22, gemini: 2, qwen: 2 },
  // CSS: cursor:pointer, cursor:grab.
  'ui/public/c4/c4-view.mjs': { cursor: 5 },
  // A chat list's page cursor (the Chats column's own field, not the engine).
  'ui/public/chats-column.mjs': { cursor: 3 },
  // The model import dialog's Gemini and Qwen hosted-API presets (bridge providers, not the engines).
  'ui/public/index.html': { gemini: 1, qwen: 1 },
  // The Codex filter chip and the Codex and Copilot built-ins groups.
  'ui/public/models-view.mjs': { codex: 5, Codex: 4, copilot: 1, Copilot: 4 },
  // The setup assistant's GitHub Copilot source: the bridge provider (its notice, sign-in, sign-out and model import).
  'ui/public/setup-assistant.mjs': { copilot: 12, Copilot: 10 },
  // The credential broker's Copilot slot.
  'ui/public/stats-view.mjs': { copilot: 1, Copilot: 1 },
  // xterm's theme key `cursor`.
  'ui/public/terminal-pane.mjs': { cursor: 1 },
});

test('no engine name or engine text in UI code outside the catalog', () => {
  const problems = [];
  const seen = new Set();
  for (const rel of sources()) {
    const hits = hitsIn(rel);
    const allowed = ALLOWED[rel] || {};
    for (const w of new Set([...Object.keys(hits), ...Object.keys(allowed)])) {
      const n = hits[w]?.length || 0; const max = allowed[w] || 0;
      if (allowed[w] !== undefined) seen.add(`${rel} ${w}`);
      if (n > max) problems.push(`${rel}: ${n - max} new "${w}" (take it from ENGINES in ${CATALOG}):\n    ${hits[w].join('\n    ')}`);
      else if (n < max) problems.push(`${rel}: "${w}" is down to ${n}; lower its ALLOWED count from ${max}`);
    }
  }
  for (const [rel, words] of Object.entries(ALLOWED)) for (const w of Object.keys(words)) if (!seen.has(`${rel} ${w}`)) problems.push(`${rel}: ALLOWED names "${w}" but the file is gone; drop the entry`);
  assert.deepEqual(problems, []);
});

test("no copy of an engine's effort list outside the catalog", () => {
  // labels.mjs has zero imports by design (the Away mode wording); test/night-decider-model.test.mjs pins its list.
  // team-policy-view.mjs: the policy's own effort vocabulary (src/core/policy/registry.mjs EFFORTS), not an engine's; it
  // equals Qwen Code's list by chance.
  const allowed = { 'src/shared/away-mode/labels.mjs': 1, 'ui/public/team-policy-view.mjs': 1 };
  // An array literal of exactly one engine's list: its strings in `text` (the commas are blanked there), `[` and `]` in `code`.
  const lists = [...new Set(ENGINE_NAMES.map((e) => ENGINES[e].efforts).filter((l) => l.length > 1))]
    .map((l) => new RegExp(l.map((x) => `(['"\`])${esc(x)}\\1`).join('\\s*'), 'g'));
  const found = {};
  for (const rel of sources().filter((f) => !f.endsWith('.html'))) {
    const { code, text } = splitFile(rel);
    let n = 0;
    for (const re of lists) for (const m of text.matchAll(re)) {
      if (code.slice(0, m.index).trimEnd().endsWith('[') && code.slice(m.index + m[0].length).trimStart().startsWith(']')) n++;
    }
    if (n) found[rel] = n;
  }
  assert.deepEqual(found, allowed);
});

test('no page hard-codes an engine <option>', () => {
  const ids = ENGINE_NAMES.map(esc).join('|');
  for (const rel of sources().filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(join(ROOT, rel), 'utf8'), new RegExp(`<option[^>]*value=["'](${ids})["']`), rel);
  }
});

test('the scan sees an engine name in a literal, a key and a regex, not in a comment or an identifier', () => {
  const { code, text } = splitJs("// codex here\nconst cursor = 1; const m = { codex: 1 }; f('codex', `x ${a ? 'y' : '}'} codex`, /^(claude|codex)$/); /* Codex */ a / b / c;");
  assert.doesNotMatch(code + text, /codex here|Codex/);
  assert.equal(text.match(/\bcodex\b/g).length, 3);
  assert.match(code, /\{ codex: 1 \}/);
  assert.match(code, /const cursor = 1/);
});

test('engineOptions: the one list every picker renders, per surface, in catalog order', () => {
  const run = engineOptions({ surface: 'run' });
  assert.deepEqual(run.map((o) => o.value), [...ENGINE_NAMES]);
  for (const o of run) assert.deepEqual(o, { value: o.value, label: engineLabel(o.value), beta: isBetaEngine(o.value) });
  assert.deepEqual(engineOptions().map((o) => o.value), [...ENGINE_NAMES]);
  assert.deepEqual(engineOptions({ surface: 'models' }).map((o) => o.value), [...MODEL_ENGINE_NAMES]);
  assert.deepEqual(engineOptions({ surface: 'ask' }).map((o) => o.value), [...CHAT_ENGINE_NAMES]);
  assert.throws(() => engineOptions({ surface: 'nope' }), /unknown surface "nope"/);
});

test('every catalog entry carries the UI fields', () => {
  for (const e of ENGINE_NAMES) {
    const x = ENGINES[e];
    assert.equal(typeof x.harness, 'string', `${e}.harness`);
    assert.ok(x.harness.length > 0, `${e}.harness`);
    assert.ok(Array.isArray(x.efforts), `${e}.efforts`);
    // Its own order, from the shared vocabulary.
    assert.deepEqual(x.efforts, REASONING_EFFORT_LEVELS.filter((l) => x.efforts.includes(l)), `${e}.efforts`);
    // Chat on it: what a chat takes, or `verified: false` while worca has no verified lockdown (engines/chat.mjs).
    assert.ok(x.chat && typeof x.chat.images === 'boolean' && typeof x.chat.pdfs === 'boolean', `${e}.chat`);
    // Its own sign-in as a connection group names it: 'ChatGPT sign-in', or the providers it signs in through ('Goose providers').
    assert.match(x.signInLabel, /(sign-in|providers)$/, `${e}.signInLabel`);
    assert.ok(x.signInHint === null || (typeof x.signInHint === 'string' && x.signInHint.length > 0), `${e}.signInHint`);
    assert.ok(x.helpersNote === null || (typeof x.helpersNote === 'string' && x.helpersNote.length > 0), `${e}.helpersNote`);
    assert.equal(typeof x.helperSlots, 'boolean', `${e}.helperSlots`);
    if (x.helperSlots) assert.equal(x.helpers, true, `${e}: helper slots need helpers on`);
    // An engine with no helper slots says what runs its helper jobs instead: it has no helper rows to show.
    if (!x.helperSlots) assert.equal(typeof x.helpersNote, 'string', `${e}: no helper slots needs a helpersNote`);
    assert.ok(x.modelConnection === null || (typeof x.modelConnection === 'string' && x.modelConnection.length > 0), `${e}.modelConnection`);
    if (e !== DEFAULT_ENGINE) assert.equal(typeof x.signInHint, 'string', `${e}.signInHint`);
    for (const k of ['modelRule', 'modelIdHint', 'signInTitle']) assert.ok(x[k] === null || (typeof x[k] === 'string' && x[k].length > 0), `${e}.${k}`);
    // A model rule is for an engine whose models connect one fixed way.
    if (x.modelRule) assert.equal(typeof x.modelConnection, 'string', `${e}: a modelRule needs a modelConnection`);
  }
  assert.ok(ENGINES[DEFAULT_ENGINE].chat && ENGINES[DEFAULT_ENGINE].chat.verified !== false, 'the default engine runs chats');
});

test('the shared and core engine lists derive from the catalog', () => {
  for (const e of ENGINE_NAMES) {
    assert.equal(HARNESS_EFFORTS[e], ENGINES[e].efforts, e);
    assert.equal(effortsForEngine(e), ENGINES[e].efforts, e);
    assert.equal(HARNESS_NAMES[e], ENGINES[e].harness, e);
    assert.equal(SIGNIN_LABELS[e], ENGINES[e].signInLabel, e);
  }
  assert.equal(effortsForEngine(undefined), EFFORTS);
  assert.equal(effortsForEngine('no-such-engine'), EFFORTS);
  assert.deepEqual([EFFORTS, CODEX_EFFORTS, CURSOR_EFFORTS, COPILOT_EFFORTS], ['claude', 'codex', 'cursor', 'copilot'].map((e) => ENGINES[e].efforts));
  assert.deepEqual(ALL_EFFORTS, [...new Set(ENGINE_NAMES.flatMap((e) => ENGINES[e].efforts))]);
  assert.deepEqual(HELPER_ENGINES, [...HELPER_ENGINE_NAMES]);
  // The setting keys (settings-cascade.mjs UTIL_RE) follow helperSlots alone, never the note's text.
  assert.deepEqual(HELPER_ENGINE_NAMES, ENGINE_NAMES.filter((e) => ENGINES[e].helperSlots));
  assert.deepEqual(ASK_ENGINES, [...CHAT_ENGINE_NAMES]);
  assert.deepEqual(ASK_CHAT_ENGINES, [...CHAT_ENGINE_NAMES]);
  assert.deepEqual(CHAT_ENGINE_NAMES, ENGINE_NAMES.filter((e) => ENGINES[e].chat && ENGINES[e].chat.verified !== false));
});

test('helper slots follow helperSlots alone: an engine with a helpers note keeps its slots', async () => {
  // A copy of the catalog module (it is import-free) where Copilot, which has a helpers note, gets helper slots.
  const src = readFileSync(join(ROOT, CATALOG), 'utf8');
  const changed = src.replace(/(\n  copilot: \{[\s\S]*?)helperSlots: false/, '$1helperSlots: true');
  assert.notEqual(changed, src);
  const copy = await import(`data:text/javascript,${encodeURIComponent(changed)}`);
  assert.equal(typeof copy.ENGINES.copilot.helpersNote, 'string');
  assert.ok(copy.HELPER_ENGINE_NAMES.includes('copilot'), copy.HELPER_ENGINE_NAMES.join());
});

test('engineHelpList: the CLI help lists every engine, the default and the beta ones marked; worca --help prints it', () => {
  assert.equal(engineHelpList(), ENGINE_NAMES.map((e) => (e === DEFAULT_ENGINE ? `${e} (default)` : isBetaEngine(e) ? `${e} (beta)` : e)).join(' | '));
  assert.match(engineHelpList(), new RegExp(`^${esc(DEFAULT_ENGINE)} \\(default\\)( \\| |$)`));
  // A child process: the help is the CLI's own output (HELP in src/cli/worca-cc.mjs is not exported). --help starts no run.
  const r = spawnSync(process.execPath, [join(ROOT, 'src/cli/worca-cc.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`--engine <name>          Agent harness for the pipeline's agent nodes: ${engineHelpList()}\n`), r.stdout);
});

test("the chat tools name the engines from the catalog the bundle passes, a new engine with no tools edit", () => {
  const engines = { ...ENGINES, zed: { ...ENGINES.cursor, label: 'Zed', beta: true, remote: false, models: true } };
  const models = { list: async () => ({}), providers: async () => ({}), test: async () => ({}), copilotModels: async () => [], validateChange: async () => ({}) };
  const desc = (catalog) => {
    const tools = createAskTools({ limits: {}, redact: (s) => s, models, ...(catalog ? { engineCatalog: catalog } : {}) }).list();
    const run = tools.find((t) => t.name === 'propose_run');
    return { run: run.description, engine: run.inputSchema.properties.engine.description, execEnv: run.inputSchema.properties.execEnv.description,
      list: tools.find((t) => t.name === 'list_models').description, change: tools.find((t) => t.name === 'propose_model_change').description };
  };
  const d = desc({ engines, defaultEngine: DEFAULT_ENGINE });
  const names = Object.keys(engines); const others = names.filter((e) => e !== DEFAULT_ENGINE);
  const list = (l, conj) => `${l.slice(0, -1).join(', ')} ${conj} ${l.at(-1)}`;
  assert.equal(d.engine, `${names.join(' | ')} — only when the user asked for that engine; omit for the default. ${list(names.filter((e) => engines[e].beta), 'and')} are beta: never pick one on your own`);
  assert.ok(d.engine.endsWith('qwen and zed are beta: never pick one on your own'), d.engine);
  assert.ok(d.run.includes(`engine: who runs the agents — claude (Claude Code), or ${list(others.map((e) => `${e} (beta)`), 'or')}; omit it`), d.run);
  assert.ok(d.execEnv.includes('needs a project target (one git project) on the claude, codex, copilot, cursor, gemini, goose, opencode or qwen engine.'), d.execEnv);
  assert.ok(d.list.includes(`engine (${names.join(' | ')}: the engine it belongs to;`), d.list);
  assert.ok(d.change.includes(`engine?: ${names.join(' | ')} (fixed once added)`), d.change);
  // Each engine whose models connect one fixed way writes its own add_model rule (catalog modelRule): zed copies Cursor's.
  assert.equal(d.change.split("a cursor model takes no env, no upstream and no efforts (cursor-agent's own sign-in); ").length, 3, d.change);
  assert.ok(d.change.includes("a goose model's id is provider/model, it takes no env and no upstream (Goose's own providers)"), d.change);
  // The real catalog, as tool-deps.mjs passes it.
  const real = desc({ engines: ENGINES, defaultEngine: DEFAULT_ENGINE });
  assert.ok(real.engine.startsWith(`${ENGINE_NAMES.join(' | ')} — `), real.engine);
  assert.ok(real.execEnv.includes(` on the ${REMOTE_ENGINES.slice(0, -1).join(', ')} or ${REMOTE_ENGINES.at(-1)} engine.`), real.execEnv);
  assert.ok(real.engine.includes(`${BETA_ENGINES.slice(0, -1).join(', ')} and ${BETA_ENGINES.at(-1)} are beta`), real.engine);
  // A bundle with no catalog (a unit fake) names no engine, and still lists the tools.
  const none = desc(null);
  assert.match(none.engine, /^only when the user asked for that engine; omit for the default\.$/);
  assert.ok(none.run.includes('engine: who runs the agents; omit it'), none.run);
  assert.ok(none.execEnv.includes('needs a project target (one git project).'), none.execEnv);
});

test("the chat rules name the run engines and E2B's engines from the catalog", () => {
  const others = ENGINE_NAMES.filter((e) => e !== DEFAULT_ENGINE);
  assert.ok(ASK_SYSTEM_RULES.includes(`Engines: a run's agents run on one engine — ${ENGINES[DEFAULT_ENGINE].harness} (${DEFAULT_ENGINE}), or ${engineList(others, engineChoiceLabel)}. Leave engine out`));
  assert.ok(ASK_SYSTEM_RULES.includes(`E2B takes runs of one git project only, on ${engineList(REMOTE_ENGINES)}: no workspace`));
});
