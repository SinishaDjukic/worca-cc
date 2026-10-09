// test/live/scenarios/30-ask.mjs
// Ask Worca (the in-app assistant) through the UI server's HTTP API.
import { checkWire } from '../lib/checks.mjs';
import { GPT_RE, askTurn, flagOf, isAskTurnTap, newThread, serverWithProject, waitSpawnsIdle, waitTitle } from '../lib/server-api.mjs';

/** Checks every settled assistant reply shares. */
function checkReply(t, label, { post, msg }) {
  t.check(`${label}: message accepted (202)`, post.status === 202, `${post.status} ${post.text.slice(0, 300)}`);
  t.check(`${label}: reply settled`, !!msg, 'no settled assistant message');
  if (!msg) return;
  t.check(`${label}: reply status done`, msg.status === 'done', `status=${msg.status} reason=${msg.reason}`);
  t.check(`${label}: reply has text`, typeof msg.text === 'string' && msg.text.trim().length > 0, JSON.stringify(msg.text).slice(0, 200));
  t.check(`${label}: reply cost booked (> 0)`, typeof msg.costUsd === 'number' && msg.costUsd > 0, `costUsd=${msg.costUsd}`);
  t.check(`${label}: reply usage recorded`, !!msg.usage && (msg.usage.output || 0) > 0, JSON.stringify(msg.usage));
}

/** The worca MCP server reported connected in the chat's own init frame. */
function checkMcpConnected(t, tp, label) {
  const servers = tp?.wire?.mainInit?.mcp || [];
  const worca = servers.find((s) => s.name === 'worca');
  t.check(`${label}: worca MCP server connected (init)`, worca && worca.status === 'connected', JSON.stringify(servers).slice(0, 300));
}

const LOCKDOWN = (tp) => {
  const tools = flagOf(tp, '--tools');
  return {
    'permission-mode dontAsk': flagOf(tp, '--permission-mode') === 'dontAsk',
    '--tools Task,Read,Grep,Glob': tools === 'Task,Read,Grep,Glob',
    '--strict-mcp-config': tp.args.includes('--strict-mcp-config'),
    '--disable-slash-commands': tp.args.includes('--disable-slash-commands'),
    '--max-turns N': /^\d+$/.test(flagOf(tp, '--max-turns') || ''),
    '--setting-sources project': flagOf(tp, '--setting-sources') === 'project',
  };
};

export default [
  {
    id: 'ask.turn-resume',
    title: 'Ask: two turns in one chat; the second resumes the first session',
    tier: 'smoke', models: 'cheap', diff: true,
    async run(t) {
      const { srv } = await serverWithProject(t);
      let settleOn = null;
      try {
        const tid = await newThread(srv); settleOn = tid;
        const a = await askTurn(srv, tid, 'Remember the code word LIMEADE. Reply with just: OK.', { model: t.model });
        checkReply(t, 'turn 1', a);
        const sess1 = a.thread?.thread?.sessionId;
        t.check('turn 1: session id stored on the thread', /^[0-9a-f-]{36}$/.test(sess1 || ''), String(sess1));
        const b = await askTurn(srv, tid, 'What was the code word? Reply with just the word.', { model: t.model });
        checkReply(t, 'turn 2', b);
        t.check('turn 2: the resumed session remembers', /LIMEADE/i.test(b.msg?.text || ''), b.msg?.text);
        const gptTry = await srv.api('POST', `/api/ask/threads/${tid}/messages`, { text: 'hi', model: 'gpt-5.5', effort: 'medium' });
        t.check('a Codex model (gpt-5.5) on this Claude chat is refused (400)', gptTry.status === 400, `${gptTry.status} ${gptTry.text.slice(0, 200)}`);
        const title = await waitTitle(srv, tid);
        t.check('chat title generated', !!title, String(title));
        const g = await srv.api('GET', `/api/ask/threads/${tid}`);
        const totals = g.json?.thread?.totals || {};
        t.check('thread totals: 2 turns, cost = sum of replies', totals.turns === 2 && Math.abs(totals.costUsd - ((a.msg?.costUsd || 0) + (b.msg?.costUsd || 0))) < 1e-6, JSON.stringify(totals));

        const turns = t.sb.agentTaps().filter(isAskTurnTap);
        t.check('two Ask turn spawns', turns.length === 2, turns.map((x) => x.site).join(' | '));
        if (turns.length === 2) {
          t.check('turn 1: no --resume', !turns[0].args.includes('--resume'), JSON.stringify(turns[0].args.slice(0, 12)));
          t.check('turn 2: --resume <turn 1 session>', flagOf(turns[1], '--resume') === sess1 && turns[0].wire.sessionIds.includes(sess1), `resume=${flagOf(turns[1], '--resume')} stored=${sess1} wire=${turns[0].wire.sessionIds}`);
          for (const [i, tp] of turns.entries()) {
            for (const [k, ok] of Object.entries(LOCKDOWN(tp))) t.check(`turn ${i + 1}: lockdown ${k}`, ok, JSON.stringify(tp.args.filter((x) => x.startsWith('--'))));
            checkMcpConnected(t, tp, `turn ${i + 1}`);
          }
        }
        await waitSpawnsIdle(t); checkWire(t, t.sb.agentTaps(), { expectModel: true });
      } finally { if (settleOn) { await waitTitle(srv, settleOn, 30000); await waitSpawnsIdle(t); } await srv.stop(); }
    },
  },
  {
    id: 'ask.subagent',
    title: 'Ask: the assistant delegates to a Task sub-agent; agent block + totals',
    tier: 'core', models: 'cheap',
    async run(t) {
      const { srv, key } = await serverWithProject(t);
      let settleOn = null;
      try {
        const tid = await newThread(srv); settleOn = tid;
        const r = await askTurn(srv, tid,
          'Use the Task tool exactly once: start one general-purpose sub-agent and ask it to call the worca list_projects tool and report the project names. Then tell me what it found in one sentence. You must use the Task tool for this.',
          { model: t.model, context: { projectKey: key, pinned: true } });
        checkReply(t, 'turn', r);
        const turn = t.sb.agentTaps().find(isAskTurnTap);
        const tasks = (turn?.wire?.tools || []).filter((x) => x.name === 'Task' || x.name === 'Agent');
        t.check('wire: the chat called the Task tool', tasks.length > 0, (turn?.wire?.tools || []).map((x) => x.name).join(','));
        const agentBlocks = (r.msg?.blocks || []).filter((b) => b.kind === 'agent');
        t.check('stored reply has an agent block', agentBlocks.length > 0, JSON.stringify((r.msg?.blocks || []).map((b) => b.kind)));
        t.check('agent block settled', agentBlocks.every((b) => b.status && b.status !== 'running'), JSON.stringify(agentBlocks.map((b) => b.status)));
        const totals = r.thread?.thread?.totals || {};
        t.check('thread totals count the agent', (totals.agents || 0) >= 1, JSON.stringify(totals));
        await waitSpawnsIdle(t); checkWire(t, t.sb.agentTaps(), { expectModel: true });
      } finally { if (settleOn) { await waitTitle(srv, settleOn, 30000); await waitSpawnsIdle(t); } await srv.stop(); }
    },
  },
  {
    id: 'ask.project-read',
    title: 'Ask pinned to a project: opens a worktree and reads the code',
    tier: 'core', models: 'cheap',
    async run(t) {
      const { srv, key } = await serverWithProject(t);
      let settleOn = null;
      try {
        const tid = await newThread(srv); settleOn = tid;
        const r = await askTurn(srv, tid,
          'Open a worktree of the pinned project and read src/calc.mjs. What exactly does the function add return? Quote the return expression.',
          { model: t.model, context: { projectKey: key, pinned: true } });
        checkReply(t, 'turn', r);
        t.check('answer quotes a + b', /a\s*\+\s*b/.test(r.msg?.text || ''), (r.msg?.text || '').slice(0, 300));
        const turn = t.sb.agentTaps().find(isAskTurnTap);
        const tools = turn?.wire?.tools || [];
        t.check('wire: worca open_worktree used', tools.some((x) => /open_worktree/.test(x.name)), tools.map((x) => x.name).join(','));
        const reads = tools.filter((x) => ['Read', 'Grep', 'Glob'].includes(x.name));
        t.check('wire: Read/Grep/Glob used', reads.length > 0, tools.map((x) => x.name).join(','));
        const outside = reads.filter((x) => { const p = x.input?.file_path || x.input?.path || ''; return p && !/\.worca-cc\/ask\//.test(p); });
        t.check('reads stay inside the chat worktree', outside.length === 0, JSON.stringify(outside.map((x) => x.input)).slice(0, 300), { severity: 'warn' });
        const denials = turn?.wire?.result?.denials || [];
        t.check('no permission denials', denials.length === 0, JSON.stringify(denials).slice(0, 300), { severity: 'warn' });
        await waitSpawnsIdle(t); checkWire(t, t.sb.agentTaps(), { expectModel: true });
      } finally { if (settleOn) { await waitTitle(srv, settleOn, 30000); await waitSpawnsIdle(t); } await srv.stop(); }
    },
  },
  {
    id: 'ask.propose-workflow',
    title: 'Ask: propose_workflow on a Claude chat offers no Codex (gpt-*) models (R1)',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const { srv, key } = await serverWithProject(t);
      let settleOn = null;
      try {
        const tid = await newThread(srv); settleOn = tid;
        const r = await askTurn(srv, tid,
          'Call propose_workflow once with task mode for this task: "Add a subtract(a, b) function to src/calc.mjs with a unit test." Use the pinned project. Then summarize the proposal in one sentence.',
          { model: t.model, context: { projectKey: key, pinned: true } });
        checkReply(t, 'turn', r);
        const turn = t.sb.agentTaps().find(isAskTurnTap);
        const called = (turn?.wire?.tools || []).some((x) => /propose_workflow/.test(x.name));
        t.check('wire: propose_workflow called', called, (turn?.wire?.tools || []).map((x) => x.name).join(','));
        // Every spawn that is neither the chat turn nor the chat-title helper: the nested classifier.
        const nested = t.sb.agentTaps().filter((tp) => !isAskTurnTap(tp) && !/title for this task/i.test(tp.site));
        t.note(`nested spawns: ${nested.map((x) => x.site).join(' | ')}`);
        t.check('nested classifier spawn recorded', nested.length > 0, t.sb.agentTaps().map((x) => x.site).join(' | '));
        for (const tp of nested) {
          const text = tp.args.join('\n') + (tp.stdin || '') + Object.values(tp.files || {}).join('\n');
          const gpt = [...new Set(text.match(GPT_RE) || [])];
          t.check(`classifier prompt offers no gpt-* model (${tp.site.slice(0, 40)})`, gpt.length === 0, gpt.join(','));
        }
        const blocks = JSON.stringify(r.msg?.blocks || []);
        const gptCard = [...new Set(blocks.match(GPT_RE) || [])];
        t.check('proposal card carries no gpt-* model', gptCard.length === 0, gptCard.join(','));
        await waitSpawnsIdle(t); checkWire(t, t.sb.agentTaps(), { expectModel: false });
      } finally { if (settleOn) { await waitTitle(srv, settleOn, 30000); await waitSpawnsIdle(t); } await srv.stop(); }
    },
  },
  {
    id: 'ask.model-matrix',
    title: 'Ask: one turn per model in the matrix',
    tier: 'core', models: 'matrix',
    async run(t) {
      const { srv } = await serverWithProject(t);
      let settleOn = null;
      try {
        const tid = await newThread(srv); settleOn = tid;
        const r = await askTurn(srv, tid, 'Reply with exactly the word PONG.', { model: t.model });
        if (/^(opus|sonnet|haiku)$/.test(t.model)) {
          // Ask validates against the catalog, which has no bare aliases (unchanged from the pre-multi-harness build).
          t.check(`Ask refuses the bare alias ${t.model} with 400 unknown model`, r.post.status === 400 && /unknown model/.test(r.post.text), `${r.post.status} ${r.post.text.slice(0, 200)}`);
          t.check('no harness spawn for a refused model', t.sb.agentTaps().length === 0, `${t.sb.agentTaps().length}`);
          settleOn = null;
          return;
        }
        checkReply(t, 'turn', r);
        t.check('reply is PONG', /PONG/.test(r.msg?.text || ''), r.msg?.text, { severity: 'warn' });
        t.check('stored message model is the one asked for', r.msg?.model === t.model, `model=${r.msg?.model}`);
        const turn = t.sb.agentTaps().find(isAskTurnTap);
        t.check('argv --model as asked', flagOf(turn || { args: [] }, '--model') === t.model, String(flagOf(turn || { args: [] }, '--model')));
        await waitSpawnsIdle(t); checkWire(t, t.sb.agentTaps(), { expectModel: true });
      } finally { if (settleOn) { await waitTitle(srv, settleOn, 30000); await waitSpawnsIdle(t); } await srv.stop(); }
    },
  },
];
