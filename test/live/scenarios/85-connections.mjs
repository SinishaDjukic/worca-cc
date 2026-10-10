// test/live/scenarios/85-connections.mjs — harness ⟂ provider ⟂ model (src/shared/connections.mjs), on the real CLI.
// A model's harnesses follow from its connection; a usage limit is whoever's allowance ran out (the harness's own
// sign-in, or a provider's); a resume can pick another model, and every remaining step runs on it.
import { SUBTRACT_TASK, checkRunDone, checkRunBookkeeping, checkCalcRun } from '../lib/checks.mjs';
import { implementOnly, nodeTaps, flagOf, fakeGateway } from '../lib/scenario-kit.mjs';

/** A provider model on a local OpenAI-compatible endpoint (keyless: a local base URL), added through the API. */
async function addEndpointModel(t, entry) {
  const srv = await t.sb.server();
  try {
    const r = await srv.api('POST', '/api/models', entry);
    t.check(`POST /api/models ${entry.id}: 200`, r.status === 200, r.text.slice(0, 300));
    return r;
  } finally { await srv.stop(); }
}

export default [
  {
    id: 'connections.catalog',
    title: 'the catalog derives each model\'s harnesses from its connection; a gateway twin of gpt-5.5 gets its own id (R6)',
    tier: 'smoke', models: 'cheap',
    async run(t) {
      const srv = await t.sb.server();
      try {
        const responses = { provider: 'openai', api: 'openai-responses', model: 'gpt-5.5', baseUrl: 'http://127.0.0.1:9/v1' };
        const both = await srv.api('POST', '/api/models', { id: 'openai-gpt-5.5', label: 'GPT-5.5 (API)', upstream: responses });
        t.check('an OpenAI Responses provider model is added once', both.status === 200, both.text.slice(0, 300));
        const chat = await srv.api('POST', '/api/models', { id: 'openai-chat-m', upstream: { ...responses, api: 'openai-chat', model: 'm' } });
        t.check('a chat-completions provider model is added', chat.status === 200, chat.text.slice(0, 300));
        const cfg = await srv.api('GET', '/api/config');
        const rows = (cfg.json?.models || []);
        const row = (id) => rows.find((m) => m.id === id) || {};
        t.check('Responses endpoint: runs on Claude Code and Codex', JSON.stringify(row('openai-gpt-5.5').harnesses) === '["claude","codex"]', JSON.stringify(row('openai-gpt-5.5')));
        t.check('chat completions: Claude Code only (Codex refuses chat)', JSON.stringify(row('openai-chat-m').harnesses) === '["claude"]', JSON.stringify(row('openai-chat-m').harnesses));
        t.check('the ChatGPT built-in stays Codex\'s', JSON.stringify(row('gpt-5.5').harnesses) === '["codex"]', JSON.stringify(row('gpt-5.5').harnesses));
        t.check('a Claude built-in stays Claude Code\'s', JSON.stringify(row('claude-haiku-4-5').harnesses) === '["claude"]', JSON.stringify(row('claude-haiku-4-5').harnesses));

        // R6: the Codex built-in's id is its sign-in's; a gateway serving the same model takes an id of its own.
        const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_AUTH_TOKEN: 'live-dummy' };
        const twin = await srv.api('POST', '/api/models', { id: 'gpt-5.5', label: 'GPT via my gateway', env });
        t.note(`POST gpt-5.5 via env → ${twin.status} ${twin.text.slice(0, 220)}`);
        t.check('R6: a gateway twin of gpt-5.5 is refused with an id to use instead', twin.status === 400 && /such as "gw-gpt-5\.5"/.test(twin.json?.error || '') && /ANTHROPIC_MODEL=gpt-5\.5/.test(twin.json?.error || ''), twin.text.slice(0, 300));
        const named = await srv.api('POST', '/api/models', { id: 'gw-gpt-5.5', label: 'GPT via my gateway', env: { ...env, ANTHROPIC_MODEL: 'gpt-5.5' } });
        t.check('R6: the suggested id is accepted, sending gpt-5.5 on the wire', named.status === 200, named.text.slice(0, 300));

        // A resume's model must be one the run's harness can run.
        const bad = await srv.api('POST', '/api/resume', { pipelineId: 'nope0000', model: 'gpt-5.6-sol' });
        t.note(`POST /api/resume unknown run + model → ${bad.status} ${bad.text.slice(0, 160)}`);
        t.check('resume API: a bad model or run is a 4xx, never a 500', bad.status >= 400 && bad.status < 500, bad.text.slice(0, 200));
      } finally { await srv.stop(); }
    },
  },

  {
    id: 'connections.provider-limit-resume-model',
    title: 'a provider\'s usage limit pauses naming the provider, offers no harness switch; resume --model finishes on another model',
    tier: 'core', models: 'cheap',
    async run(t) {
      // An OpenAI-compatible endpoint whose allowance is spent: every request is a 429 that says so.
      const gw = await fakeGateway({ status: 429, body: { error: { type: 'rate_limit_exceeded', code: 'rate_limit_exceeded', message: "You've hit your usage limit for this period, it resets 6pm" } } });
      try {
        await addEndpointModel(t, { id: 'live-gw', label: 'Live gateway', upstream: { provider: 'openai', api: 'openai-chat', model: 'gw-model', baseUrl: `${gw.url}/v1` } });
        const r = await implementOnly(t, SUBTRACT_TASK, { model: 'live-gw', timeoutMs: 25 * 60 * 1000 });
        t.note(`run ${r.id}: exit=${r.res.code} status=${r.run?.status} reason=${r.run?.pauseReason} limitEngine=${r.run?.limitEngine} detail=${String(r.run?.pauseDetail || '').slice(0, 200)}; gateway hits=${gw.hits.length}`);
        t.check('the endpoint was reached through the bridge', gw.hits.length >= 1, `hits=${gw.hits.length}`);
        t.check('paused on a usage limit', r.run?.status === 'paused' && r.run?.pauseReason === 'usage_limit', `${r.run?.status}/${r.run?.pauseReason} ${String(r.run?.pauseDetail || '').slice(0, 300)}`);
        t.check('the limit is the provider\'s: no engine recorded', r.run?.limitEngine == null, String(r.run?.limitEngine));
        t.check('the pause names the provider', /^OpenAI-compatible limit — /.test(r.run?.pauseDetail || ''), String(r.run?.pauseDetail || '').slice(0, 200));
        const out = `${r.res.stdout}\n${r.res.stderr}`;
        t.check('CLI: offers another model', /Or continue now with another model: worca resume \S+ --model <id>/.test(out), out.slice(-600));
        t.check('CLI: offers no other harness for a provider limit', !/Or continue now on (Codex|Cursor|Claude)/.test(out), out.slice(-600));
        if (!r.id || r.run?.status !== 'paused') return;

        const before = new Set(nodeTaps(t.sb).map((tp) => tp.seq));
        const res = await t.sb.cli(['resume', r.id, '--yes', '--model', t.model], { cwd: r.proj, timeoutMs: 20 * 60 * 1000 });
        t.check('resume --model: exit 0', res.code === 0, `${res.stderr.slice(-500)} ${res.stdout.slice(-500)}`);
        const run = checkRunDone(t, t.sb, r.id);
        checkRunBookkeeping(t, t.sb, r.id);
        checkCalcRun(t, t.sb, r.proj, run);
        const after = nodeTaps(t.sb).filter((tp) => !before.has(tp.seq));
        const models = after.map((tp) => flagOf(tp, '--model'));
        t.note(`resumed node spawns --model: ${models.join(',')}`);
        t.check('every resumed step ran on the picked model', after.length >= 1 && models.every((m) => m === t.model), models.join(','));
        t.check('…not through the spent gateway', after.every((tp) => !String(tp.env?.ANTHROPIC_BASE_URL || '').includes('/m/live-gw')), after.map((tp) => tp.env?.ANTHROPIC_BASE_URL || '-').join(','));
        const shown = t.sb.runShow(r.id);
        t.check('resume clears the limit', shown?.pauseReason == null && shown?.limitEngine == null, JSON.stringify({ p: shown?.pauseReason, l: shown?.limitEngine }));
      } finally { await gw.close(); }
    },
  },
];
