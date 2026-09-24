// src/cli/models.mjs
// `worca models …` (model-bridge-design.md §6.5): the provider operations the
// Providers card offers, for a terminal — sign in to GitHub Copilot with the
// device flow, sign out, import Copilot models into the catalog, list the
// catalog with its bridge facts, and show provider state. Pure helpers are
// exported for tests; cmdModels takes its I/O injected (the schedule.mjs
// precedent) so nothing here touches process.stdout directly.

import { createInterface } from 'node:readline';
import {
  providersState, beginCopilotLogin, pollCopilotLogin, copilotLogout, acknowledgeTerms,
  copilotModelsForImport, importCopilotModels, testProviderConnection, patchProvider,
  endpointModelsForImport, importEndpointModels,
} from '../core/bridge/provider-ops.mjs';
import { listModels } from '../core/config.mjs';
import { isTranslatedApi } from '../core/model-env.mjs';

export const MODELS_HELP = `worca models — the model catalog and its providers

Usage:
  worca models list                       Catalog with provider / bridge facts
  worca models providers                  Provider state (never a token)
  worca models login copilot [--accept-terms]
                                          Sign in to GitHub Copilot (device flow)
  worca models logout copilot             Forget the Copilot sign-in
  worca models import copilot [--all | --pick <id,id,…>] [--yes]
                                          Add Copilot models to the catalog
  worca models import openai [--base-url <url>] [--all | --pick <id,id,…>] [--yes]
                                          Add what an OpenAI-compatible endpoint serves
                                          (llama.cpp, Ollama, LM Studio, vLLM, a gateway)
  worca models test <provider>            Reachability + auth check (copilot|openai|anthropic)
  worca models set <provider> <key>=<value> …
                                          Patch a provider: accountType, maxConcurrent, baseUrl, apiKey

Notes:
  Copilot: GitHub allows Copilot only through supported clients and has suspended
  access for automated use. \`login\` prints the notice; --accept-terms records the
  acknowledgement non-interactively. Pipelines are automated, high-volume use.
`;

/** The notice text, mirrored from ui/public/bridge-view.mjs COPILOT_TERMS (kept
 *  here too: the CLI must not import UI modules). */
export const COPILOT_TERMS_TEXT = [
  'Using GitHub Copilot from Worca',
  '',
  "Worca will talk to GitHub Copilot through the same API GitHub's editor extensions use, identifying itself as an editor client. GitHub's terms allow Copilot only through supported clients, and GitHub has suspended Copilot access for automated or unsupported use. Pipelines are automated, high-volume use.",
  '',
  '  • Your GitHub account, not Worca, carries this risk.',
  '  • Worca caps concurrent requests (configurable) and never signs in without you.',
  '  • Premium-request quotas apply per your plan; Worca shows usage but cannot enforce it.',
].join('\n');

/** Minimal flag parser for the subcommand (mirrors worca-cc.mjs pluginArgs). */
export function modelsArgs(argv, valueFlags = [], boolFlags = [], fail = (m) => { throw new Error(m); }) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    if (valueFlags.includes(a)) {
      const v = inline !== undefined ? inline : argv[++i];
      if (v === undefined) fail(`Flag ${a} requires a value.`);
      out[a.slice(2)] = v;
    } else if (boolFlags.includes(a)) out[a.slice(2)] = true;
    else if (a.startsWith('-') && a !== '-') fail(`Unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

/** One catalog line: "id  label  [bridged: copilot → gpt-5]  [needs sign-in]". Pure. */
export function formatModelLine(m) {
  const bits = [m.id];
  if (m.label && m.label !== m.id) bits.push(`(${m.label})`);
  if (m.custom === 'plugin') bits.push(`plugin:${m.plugin}`);
  else if (m.custom === 'policy') bits.push('policy');
  else if (m.custom === 'global') bits.push('yours');
  else if (!m.custom) bits.push('built-in');
  if (m.bridged) bits.push(`bridged: ${m.bridged}${m.upstreamModel ? ` → ${m.upstreamModel}` : ''}${isTranslatedApi(m.upstreamApi) ? ' (translated)' : ''}`);
  else if (m.routed) bits.push('endpoint-routed');
  if (m.needsSignIn) bits.push(`NEEDS ${m.signInReason === 'no_key' ? 'API KEY' : m.signInReason === 'terms' ? 'ACKNOWLEDGEMENT' : 'SIGN-IN'}`);
  if (m.hidden) bits.push('hidden');
  return bits.join('  ');
}

/** Provider state lines. Pure. */
export function formatProviders(p) {
  const c = p.copilot || {};
  const lines = [
    `copilot     ${c.connected ? `connected${c.login ? ` as @${c.login}` : ''}` : 'not connected'}  account=${c.accountType || 'individual'}  maxConcurrent=${c.maxConcurrent}  terms=${c.termsCurrent ? `acknowledged ${String(c.acknowledgedTerms || '').slice(0, 10)}` : 'not acknowledged'}${c.tokenSource === 'env' ? `  token=${c.tokenRef}` : ''}`,
  ];
  if (c.quota) {
    lines.push(`            premium requests: ${c.quota.unlimited ? 'unlimited' : `${c.quota.used ?? '?'} / ${c.quota.entitlement ?? '?'}`}${c.quota.resetDate ? ` (resets ${c.quota.resetDate})` : ''}`);
  }
  for (const name of ['openai', 'anthropic']) {
    const k = p[name] || {};
    lines.push(`${name.padEnd(11)} ${k.configured ? 'key set' : k.keySet ? 'key ${VAR} NOT SET' : 'no key'}${k.keySource === 'env' ? ` (${k.keyRef})` : ''}  baseUrl=${k.baseUrl || '-'}  maxConcurrent=${k.maxConcurrent}`);
  }
  return lines;
}

async function confirm(msg, yes, { c }) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => { rl.close(); process.exit(130); });
  try {
    const a = await new Promise((r) => rl.question(c('cyan', `${msg} [y/N] `), r));
    return /^y(es)?$/i.test(String(a).trim());
  } finally {
    rl.close();
  }
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

/**
 * The `worca models` entry point.
 * @param {string[]} argv  tokens after `models`
 * @param {{out:(s:string)=>void, c:(name:string,s:string)=>string, fail:(m:string)=>never, sleep?:Function}} io
 * @returns {Promise<number>} exit code
 */
export async function cmdModels(argv, { out, c, fail, sleep: wait = sleep }) {
  const args = modelsArgs(argv, ['--pick', '--base-url'], ['--accept-terms', '--all', '--yes', '-h', '--help'], fail);
  const [verb, ...rest] = args._;
  if (!verb || args.help || args.h || verb === 'help') { out(MODELS_HELP); return 0; }

  if (verb === 'list') {
    const models = await listModels('');
    for (const m of models) out(formatModelLine(m));
    if (!models.length) out('(empty catalog)');
    return 0;
  }

  if (verb === 'providers') {
    for (const line of formatProviders(await providersState({ quota: true }))) out(line);
    return 0;
  }

  const provider = rest[0];
  if (verb === 'login') {
    if (provider !== 'copilot') return fail('only `worca models login copilot` is supported');
    const state = await providersState();
    if (!state.copilot.termsCurrent) {
      out(COPILOT_TERMS_TEXT);
      out('');
      const ok = args['accept-terms'] || await confirm('I understand and want to continue', false, { c });
      if (!ok) return fail('sign-in cancelled — pass --accept-terms to acknowledge non-interactively');
      await acknowledgeTerms();
    }
    const flow = await beginCopilotLogin();
    out(`Open ${c('bold', flow.verificationUri)} and enter the code ${c('bold', flow.userCode)}`);
    out(c('dim', `Waiting for approval (code valid ${Math.round(flow.expiresIn / 60)} min)…`));
    let interval = flow.interval;
    const deadline = Date.now() + flow.expiresIn * 1000;
    while (Date.now() < deadline) {
      await wait(interval * 1000);
      const r = await pollCopilotLogin(flow.deviceCode);
      if (r.ok) { out(c('green', `Connected to GitHub Copilot${r.login ? ` as @${r.login}` : ''}.`)); return 0; }
      if (r.error) return fail(r.error);
      if (r.interval) interval = r.interval;
    }
    return fail('the device code expired — run the command again');
  }

  if (verb === 'logout') {
    if (provider !== 'copilot') return fail('only `worca models logout copilot` is supported');
    await copilotLogout();
    out('Signed out of GitHub Copilot.');
    return 0;
  }

  if (verb === 'import' && provider === 'openai') {
    // §8.4 for a server you run: the endpoint is asked what it serves, and only a window it
    // really serves becomes a prompt limit — the rest is printed for the user to judge.
    let out0;
    try { out0 = await endpointModelsForImport({ baseUrl: args['base-url'] || '' }); } catch (err) { return fail(err.message || String(err)); }
    const fmtCtx = (m) => (m.servedContext ? `${Math.round(m.servedContext / 1000)}k` : m.trainedContext ? `?/${Math.round(m.trainedContext / 1000)}k` : '-');
    let ids;
    if (args.pick) ids = String(args.pick).split(',').map((x) => x.trim()).filter(Boolean);
    else if (args.all) ids = out0.models.filter((m) => m.importable).map((m) => m.id);
    else {
      out(`${out0.serverLabel} at ${out0.baseUrl} (pass --all, or --pick id,id,…):`);
      for (const m of out0.models) {
        out(`  ${m.id.padEnd(34)} ${fmtCtx(m).padStart(7)}  ${m.toolCalls ? 'tools' : m.toolCalls === null ? 'tools?' : '     '} ${m.vision ? 'vision' : '      '}${m.loaded === true ? ' loaded' : ''}${m.inCatalog ? '  (in catalog)' : ''}${m.importable ? '' : `  (${m.blocked})`}`);
      }
      for (const w of out0.warnings) out(c('yellow', `  ! ${w}`));
      return 0;
    }
    for (const w of out0.warnings) out(c('yellow', `! ${w}`));
    if (!(await confirm(`Import ${ids.length} model${ids.length === 1 ? '' : 's'} into the catalog?`, args.yes, { c }))) return fail('cancelled');
    const r = await importEndpointModels(ids, { baseUrl: args['base-url'] || '' });
    for (const id of r.created) out(`  + ${id}`);
    for (const id of r.updated) out(`  ~ ${id} (upstream refreshed)`);
    for (const sk of r.skipped) out(`  - ${sk.id} (skipped: ${sk.why})`);
    return 0;
  }

  if (verb === 'import') {
    if (provider !== 'copilot') return fail('only `worca models import copilot` and `worca models import openai` are supported');
    let list;
    try { list = await copilotModelsForImport(); } catch (err) {
      return fail(err && err.code === 'NOT_SIGNED_IN' ? 'not signed in — run `worca models login copilot` first' : (err.message || String(err)));
    }
    const importable = list.filter((m) => !m.policyState || m.policyState === 'enabled');
    let ids;
    if (args.pick) ids = String(args.pick).split(',').map((s) => s.trim()).filter(Boolean);
    else if (args.all) ids = importable.map((m) => m.id);
    else {
      out('Copilot models (pass --all, or --pick id,id,…):');
      for (const m of list) out(`  ${m.id.padEnd(28)} ${m.vendor.padEnd(10)} ${(m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : '-').padStart(5)}  ${m.toolCalls ? 'tools' : '     '} ${m.vision ? 'vision' : '      '} ${m.reasoning ? 'reasoning' : '         '}  ${String(m.api || '').padEnd(16)}${m.inCatalog ? '  (in catalog)' : ''}${m.policyState && m.policyState !== 'enabled' ? '  (disabled in Copilot settings)' : ''}`);
      return 0;
    }
    out('These run through your Copilot subscription. Claude models keep extended thinking; other vendors run through a translation layer (no web tools; reasoning arrives as summaries on the Responses API).');
    if (!(await confirm(`Import ${ids.length} model${ids.length === 1 ? '' : 's'} into the catalog?`, args.yes, { c }))) return fail('cancelled');
    const r = await importCopilotModels(ids);
    for (const id of r.created) out(`  + ${id}`);
    for (const id of r.updated) out(`  ~ ${id} (API and capabilities refreshed)`);
    for (const id of r.skipped) out(`  - ${id} (skipped: not offered, or not a copilot entry)`);
    return 0;
  }

  if (verb === 'test') {
    if (!provider) return fail('usage: worca models test <copilot|openai|anthropic>');
    const r = await testProviderConnection(provider);
    if (r.ok) { out(c('green', `✓ ${provider} reachable${r.models != null ? ` — ${r.models} models listed` : ''}`)); return 0; }
    out(c('red', `✗ ${provider}: ${r.message}`));
    return 1;
  }

  if (verb === 'set') {
    if (!provider) return fail('usage: worca models set <provider> key=value …');
    const patch = {};
    for (const kv of rest.slice(1)) {
      const i = kv.indexOf('=');
      if (i <= 0) return fail(`expected key=value, got ${JSON.stringify(kv)}`);
      const k = kv.slice(0, i); const v = kv.slice(i + 1);
      patch[k] = k === 'maxConcurrent' ? Number(v) : v;
    }
    if (!Object.keys(patch).length) return fail('nothing to set');
    try { await patchProvider(provider, patch); } catch (err) { return fail(err.message || String(err)); }
    for (const line of formatProviders(await providersState())) out(line);
    return 0;
  }

  return fail(`unknown models subcommand ${JSON.stringify(verb)} — see \`worca models help\``);
}
