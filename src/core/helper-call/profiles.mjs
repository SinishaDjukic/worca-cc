// Per-harness profiles of the helper call: offered engines, capabilities, runner options, words
// (plans/requirements-9c-design.md D4, D6, D11, D12, D13, D15, D16, D18). Pure: no spawn, no fs.
import { ENGINES, engineLabel } from '../../shared/engine-switch.mjs';
import { ASK_ENGINES } from '../model-env.mjs';
import { chatDescriptor } from '../engines/chat.mjs';
import { REPO_LOOK_TOOLS } from '../auto/classify.mjs';
import { REQ_ATTACH_LIMITS } from '../requirements/attachments.mjs';

export const PROFILES = Object.freeze(['none', 'repo', 'file']);

/** Claude plus every chat engine with a lockdown, never Cursor (askCatalog's `available`). */
export function requirementsEngines(deps = { lockdown: (e) => !!chatDescriptor(e)?.lockdown() }) {
  return ['claude', ...ASK_ENGINES.filter((e) => e !== 'claude' && e !== 'cursor' && deps.lockdown(e))];
}

export function capabilities(engine) {
  const e = engine || 'claude';
  const known = Object.hasOwn(ENGINES, e);
  return {
    repo: known && ENGINES[e].helpers === true,
    files: e === 'claude',
    keepsCopy: ['copilot', 'gemini', 'goose', 'qwen'].includes(e),
    reportsCost: known && ENGINES[e].cost === true,
    deletesSession: e === 'codex',
  };
}

const BASE = (o) => ({ engine: o.engine, cwd: o.cwd, systemPrompt: o.systemPrompt, prompt: o.prompt, model: o.model,
  ...(o.effort ? { effort: o.effort } : {}), permissionMode: 'acceptEdits', spawnKind: 'aux', sandbox: 'read-only' });

/** Runner options for a non-Claude engine. Claude's come from interviewCallOptions. */
export function launchOptions(o) {
  if (!o.engine || o.engine === 'claude') throw new TypeError('launchOptions: Claude calls use interviewCallOptions');
  if (o.engine === 'cursor') throw new TypeError('launchOptions: Cursor is never offered');
  if (o.profile === 'none') return { ...BASE(o), askLockdown: true, envScrub: true, allowedTools: [] };
  if (o.profile === 'repo') {
    if (!capabilities(o.engine).repo) throw new TypeError(`launchOptions: ${o.engine} cannot read the repo`);
    if (!o.mcpConfigPath) throw new TypeError('launchOptions: a repo look needs the files server');
    return { ...BASE(o), mcpConfigPath: o.mcpConfigPath, allowedTools: [...REPO_LOOK_TOOLS], tools: [...REPO_LOOK_TOOLS],
      ...(o.maxTurns ? { maxTurns: o.maxTurns } : {}) };
  }
  throw new TypeError(`launchOptions: profile ${JSON.stringify(o.profile)} runs on Claude only`);
}

/** D12 notices, in order: repo, each file, keeps-copy, cost estimated. */
export function stepNotices({ engine, profile, files = [], estimated = false }) {
  const cap = capabilities(engine);
  const H = engineLabel(engine);
  const out = [];
  if (profile === 'repo' && !cap.repo) out.push(`Repo not read: ${H} can't read the repo.`);
  if (!cap.files) {
    for (const f of files) {
      if (f.kind !== 'text') out.push(`${f.name} skipped: ${H} gets files as text only.`);
      else if (f.bytes > REQ_ATTACH_LIMITS.inlineBytes) out.push(`${f.name} skipped: it is too large for ${H}.`);
    }
  }
  if (cap.keepsCopy) out.push(`${H} keeps its own copy of this step in its history on this computer.`);
  if (estimated) out.push(`Cost estimated: ${H} reports none.`);
  return out;
}

/** Words for a harness that is not ready: option text, D13 sentence, D4 line. */
export function notReadyWords(engine, reason, { broker = false } = {}) {
  const H = engineLabel(engine);
  const text = String(reason || '');
  if (engine === 'cursor') {
    return { short: 'Not available', sentence: `${H} can't run Requirements. Change the model.`,
      startsOn: `Your default engine is ${H}, which can't run Requirements, so this starts on Claude.` };
  }
  if (broker || /\bbroker\b/i.test(text)) {
    return { short: 'Off while the credential broker is on', sentence: `${H} is off while the credential broker is on. Change the model.`,
      startsOn: `${H} is off while the credential broker is on, so this starts on Claude.` };
  }
  if (/not signed in/i.test(text)) {
    return { short: 'Not signed in', sentence: `${H} isn't signed in. Sign in, or change the model.`, startsOn: `${H} isn't signed in, so this starts on Claude.` };
  }
  if (/cannot run|not installed|ENOENT/i.test(text)) {
    return { short: 'Not installed', sentence: `${H} isn't installed. Install it, or change the model.`, startsOn: `${H} isn't installed, so this starts on Claude.` };
  }
  return { short: 'Not ready', sentence: `${H} can't run this step: ${text}. Change the model, or try again.`,
    startsOn: `${H} can't run this step: ${text}, so this starts on Claude.` };
}

const COMPANIES = Object.freeze({ claude: 'Anthropic', codex: 'OpenAI', copilot: 'GitHub', gemini: 'Google', qwen: 'Alibaba Cloud' });
const NAMED = new Set(Object.values(COMPANIES));

/** "Sent to <company>" (D11): a named company, or "the provider of <model>" when the endpoint is the model's own. */
export function companyOf(engine, entry) {
  const e = engine || 'claude';
  const id = entry?.id ?? entry?.model ?? '';
  const own = !!entry && (((entry.custom === 'global' || entry.custom === 'plugin') && entry.hasEnv === true)
    || !!entry.bridged || !!entry.upstream || !!entry.upstreamApi);
  if (e === 'goose' || e === 'opencode' || own || !Object.hasOwn(COMPANIES, e)) return `the provider of ${id}`;
  return COMPANIES[e];
}

/** Same company only when both resolve to the same named company. */
export function sameCompany(a, b) {
  return typeof a === 'string' && a === b && NAMED.has(a);
}

/** Board 1/2 hint under the harness choice. */
export function harnessLine(engine) {
  if (!engine || engine === 'claude') return null;
  const H = engineLabel(engine);
  return capabilities(engine).repo ? `${H} reads the repo read-only. Files go to it as text.` : `${H} can't read the repo. Files go to it as text.`;
}

/** D18: the Product brief box when the default engine can't read the repo. */
export function noRepoStartsOn(engine) {
  return `Your default engine is ${engineLabel(engine)}, which can't read the repo, so this brief is made on Claude.`;
}
