#!/usr/bin/env node
// tools/requirements-real-helper.mjs
// Real Ask Worca calls on a fixture feature (plans/requirements-a3-design.md §8 "Real calls"): five messages on a feature with a
// product brief, a file and a pending round, each one real helper call through sendMessage and the real runner. Per call: the cost,
// the cache reads and writes (D4: whether helper calls of one feature share a prefix), and whether the reply parsed. The figures
// go into the pull request. A sandbox WORCA_HOME (the store lands in <sandbox>/.worca-cc); the real HOME keeps Claude Code signed
// in and Worca's settings file (its model entries). Routing to another endpoint (a base URL, Vertex, Bedrock, an API key...) is
// refused before any call unless --allow-routed, with tools/requirements-real-read.mjs's own checks (imported from there): this
// shell's environment, Claude Code's user and managed settings, and Worca's model entry. Only key names are printed.
//
//   node tools/requirements-real-helper.mjs [--max-usd <n>] [--sandbox <dir>] [--out <file.json>] [--allow-routed] [--yes]
//
// Without --yes it is a dry run: it sends nothing and makes no folder. With --yes it calls the model and THIS COSTS MONEY.
// The cap (--max-usd, default 1.00) is hard: every call gets the budget left as --max-budget-usd, and no call starts once
// nothing is left. It refuses to run with WORCA_MOCK / ORCH_MOCK set. Exit: 0 every reply parsed; 1 a reply failed or the cap
// stopped it; 2 usage, mock mode or refused routing.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { routingKeys, userSettingsRoutingKeys, settingsFileRoutingKeys, managedSettingsPaths } from './requirements-real-read.mjs';

const cents = (n) => Math.round(n * 100) / 100;
const four = (n) => Math.round(n * 1e4) / 1e4;

/** The five messages (§8): three general questions, Help me answer on question 1 (`focus: 'q1'`), and a change request. */
export const MESSAGES = Object.freeze([
  { text: 'Is anything missing from this spec?' },
  { text: 'Until when can a customer cancel?', focus: 'q1' },
  { text: "Which criteria can't be tested?" },
  { text: 'What edge cases am I missing?' },
  { text: 'Should a partly shipped order be cancellable?' },
]);

/** A feature waiting for round 1's answers, with a made product brief for its scope and one read file (no call: rows only). */
export function makeFixture(store) {
  const f = store.createFeature({ scopeType: 'project', scopeKey: 'real-helper', title: 'Cancel an order before it ships',
    description: 'Customers cancel an order themselves before it ships, from their order history.' });
  const b = store.beginBrief('project', 'real-helper');
  store.saveBriefResult(b.id, { sections: { product: 'An online shoe shop: customers order, pay by card and get parcels at home.',
    users: [{ name: 'Customer', can: 'orders, pays and follows a parcel' }, { name: 'Support agent', can: 'answers tickets and refunds orders' }],
    terms: [{ term: 'Order', meaning: "a customer's purchase, with a status" }],
    areas: [{ name: 'Orders', belongsTo: null, text: 'Orders have a status: paid, packed, shipped, delivered.', status: 'exists', files: [], added: null }] },
  edited: {}, sources: [{ project: 'real-helper', branch: 'main', sha: '0123456789abcdef' }], files: [], seed: null, model: null });
  const att = store.insertAttachment({ id: store.mintAttachmentId(), ownerType: 'feature', ownerId: f.seq, name: 'support-tickets.pdf', kind: 'binary',
    mime: 'application/pdf', bytes: 2200000, sha256: 'a'.repeat(64), status: 'done' });
  store.updateAttachment(att.id, { summary: '52 support tickets from September asking to cancel an order: 38 came after the label was printed and before pick-up; 9 ask to cancel one item of several.',
    readAt: new Date().toISOString() });
  const questions = [
    { id: 'until', question: 'Until when can a customer cancel?', options: ['Until the label is printed', 'Until the parcel is picked up'], recommended: 'Until the label is printed', why: 'It sets the cut-off.' },
    { id: 'shipping', question: 'Who pays the return shipping?', options: ['The shop', 'The customer'], recommended: 'The shop', why: 'It decides the refund.' },
  ];
  const turnId = store.appendTurn(f.seq, { kind: 'round', payload: { questions, note: 'Two questions.', done: false } });
  store.updateFeature(f.seq, { status: 'your_turn', rounds: 1, criteriaSeq: 3, assumptionSeq: 2, spec: {
    goal: { text: 'Customers cancel an order themselves before it ships.', measure: 'fewer cancel tickets' }, actors: ['Customer'],
    flow: ['The customer opens the order', 'The customer presses Cancel', 'The refund goes back to the card'], edgeCases: [], rules: ['A refund goes back to the card.'],
    outOfScope: [], openQuestions: [], edited: {},
    criteria: [{ id: 'R-po-1', text: 'A customer can cancel a paid order before it ships.' }, { id: 'R-po-2', text: 'The refund reaches the card within 14 days.' },
      { id: 'R-po-3', text: 'The confirm dialog is clear.' }],
    assumptions: [{ id: 'A-1', text: 'Refunds are full.', status: 'open' }, { id: 'A-2', text: 'A cancelled order frees its stock at once.', status: 'open' }] } });
  return { seq: f.seq, turnId, questions };
}

export async function main(argv = process.argv.slice(2), { log = console.log, env = process.env, home = homedir(), managedPaths = managedSettingsPaths(), runner = null, modelEnvOf = null } = {}) {
  if (env.WORCA_MOCK || env.ORCH_MOCK) { log('the real-helper check measures the real model; unset WORCA_MOCK'); return 2; }
  let o;
  try {
    o = parseArgs({ args: argv, options: { 'max-usd': { type: 'string', default: '1.00' }, sandbox: { type: 'string' }, out: { type: 'string' },
      'allow-routed': { type: 'boolean', default: false }, yes: { type: 'boolean', default: false } } }).values;
  } catch (err) { log(err.message); return 2; }
  const maxUsd = Number(o['max-usd']);
  if (!(maxUsd > 0)) { log('--max-usd must be a positive number'); return 2; }
  for (const m of MESSAGES) log(`message: ${m.text}${m.focus ? ' (Help me answer · question 1)' : ''}`);
  if (!o.yes) { log(`Dry run: nothing was sent. Add --yes to send ${MESSAGES.length} real messages (this costs money; hard cap $${maxUsd.toFixed(2)}).`); return 0; }
  const outside = [["this shell's environment", routingKeys(env)], ["Claude Code's user settings", userSettingsRoutingKeys({ env, home })],
    ...managedPaths.map((p) => [`Claude Code's managed settings (${p})`, settingsFileRoutingKeys(p)])].filter(([, keys]) => keys.length);
  for (const [where, keys] of outside) log(`Claude Code is routed by ${where} (${keys.join(', ')}): its calls are billed to that endpoint, not to this sign-in`);
  if (outside.length && !o['allow-routed']) { log('Nothing was sent. Add --allow-routed to send through that endpoint anyway.'); return 2; }

  const parent = o.sandbox ? resolve(o.sandbox) : tmpdir();
  mkdirSync(parent, { recursive: true });
  const sandbox = mkdtempSync(join(parent, 'worca-a3-real-'));   // only now: a dry run leaves nothing behind
  process.env.WORCA_HOME = sandbox;   // a sandbox store; HOME stays the user's, so Claude Code is signed in
  log(`sandbox: ${sandbox}`);
  const store = await import('../src/core/requirements/store.mjs');
  const { sendMessage } = await import('../src/core/requirements/helper.mjs');
  const { interviewModel } = await import('../src/core/requirements/interview.mjs');
  const { runClaude } = await import('../src/core/claude-runner.mjs');
  const { normalizingOnEvent } = await import('../src/core/engines/claude-events.mjs');
  const base = runner || runClaude;
  const im = await interviewModel({});
  const model = im.model || undefined;
  log(`model: ${model || '(the CLI default)'}${im.effort ? `, effort ${im.effort}` : ''}`);
  const routed = routingKeys((modelEnvOf || (await import('../src/core/config.mjs')).resolveModelEnv)(model));
  if (routed.length) {
    log(`the model ${model} is routed by Worca's model settings (${routed.join(', ')}): its calls are billed to that endpoint, not to this sign-in`);
    if (!o['allow-routed']) { log('Nothing was sent. Add --allow-routed to send through that endpoint anyway.'); return 2; }
  }
  const fx = makeFixture(store);
  let cliSpent = 0;
  const left = () => cents(maxUsd - cliSpent);
  const report = { calls: [] };
  let bad = false;
  for (const msg of MESSAGES) {
    if (left() <= 0) { report.calls.push({ text: msg.text, skipped: 'max-usd' }); log(JSON.stringify(report.calls.at(-1))); bad = true; continue; }
    const rec = { costUsd: 0, usage: null, budgets: [] };
    /** Every attempt of the call: the budget left as --max-budget-usd; the CLI's own cost and usage recorded. */
    const wrap = async (opts) => {
      const budget = left();
      rec.budgets.push(budget);
      if (budget <= 0) throw new Error('the --max-usd cap is reached');
      const tee = normalizingOnEvent((n) => {
        if (n.type !== 'result') return;
        if (Number.isFinite(Number(n.costUsd))) { rec.costUsd += Number(n.costUsd); cliSpent += Number(n.costUsd); }
        if (n.usage) rec.usage = n.usage;
      });
      return base({ ...opts, maxBudgetUsd: budget, onEvent: (e) => { tee(e); opts.onEvent?.(e); } });
    };
    const t0 = Date.now();
    const focus = msg.focus ? { roundTurnId: fx.turnId, questionId: fx.questions[0].id } : undefined;
    await sendMessage(fx.seq, { text: msg.text, focus }, { by: 'real-helper' }, { runClaudeImpl: wrap });
    const w = store.listHelperMessages(fx.seq).at(-1);
    const u = rec.usage || {};
    const row = { text: msg.text, seconds: Math.round((Date.now() - t0) / 1000), costUsd: w.costUsd, cliCostUsd: four(rec.costUsd), maxBudgetUsd: rec.budgets,
      parsed: !w.error, error: w.error ? w.error.code : null, inputTokens: Number(u.input_tokens) || 0, cacheReadTokens: Number(u.cache_read_input_tokens) || 0,
      cacheWriteTokens: Number(u.cache_creation_input_tokens) || 0, replyChars: w.text.length, drafts: w.drafts.length, proposals: w.proposals.length };
    if (w.error) bad = true;
    report.calls.push(row);
    log(JSON.stringify({ ...row, maxBudgetUsd: row.maxBudgetUsd[0] }));
  }
  const booked = store.listHelperMessages(fx.seq).reduce((n, m) => n + (m.costUsd || 0), 0);
  if (o.out) writeFileSync(o.out, `${JSON.stringify({ version: 1, at: new Date().toISOString(), model: model || null, effort: im.effort || null, maxUsd,
    booked: four(booked), cliSpent: four(cliSpent), ...report }, null, 2)}\n`);
  log(`spent $${Math.max(booked, cliSpent).toFixed(4)} of $${maxUsd.toFixed(2)} (booked $${booked.toFixed(4)}, CLI $${cliSpent.toFixed(4)})`);
  return bad ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(2); });
