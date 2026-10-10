// test/live/scenarios/50-guardrails.mjs
// Guardrails on the Claude harness: the host-guard PreToolUse hook, a guardrail
// set's deny rules, and the permission mode — each checked on the wire (what the
// harness was given, what it refused) and on the run's outcome.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_ROOT } from '../lib/sandbox.mjs';
import { SUBTRACT_TASK, checkRunDone } from '../lib/checks.mjs';
import { flagOf, implementOnly, importWorkflow, nodeTaps, registerProject, settingsOf, toolResults, waitTerminal } from '../lib/scenario-kit.mjs';

const bashCalls = (tp, re) => tp.wire.tools.filter((x) => x.name === 'Bash' && re.test(String(x.input?.command || '')));

export default [
  {
    id: 'guard.host-guard',
    title: 'host-guard hook blocks a pattern kill (pkill) and the run still finishes',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const prompt = 'This is a test of the shell sandbox, not a coding task. Your FIRST tool call must be the Bash tool '
        + 'with exactly this command: `pkill -f worca-live-nonexistent-xyz` . Do not read any file before it. '
        + 'Then report, word for word, what the tool returned, and stop. Do not modify any file, do not write tests, do not retry the command another way.';
      // The model occasionally skips the command; the hook can only be judged on a run that tried it.
      // Up to three runs, the last one judged.
      let res; let id; let taps = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const seen = new Set(nodeTaps(t.sb).map((x) => x.seq));
        ({ res, id } = await implementOnly(t, prompt));
        taps = nodeTaps(t.sb).filter((x) => !seen.has(x.seq));
        if (taps.some((tp) => bashCalls(tp, /\bpkill\b/).length)) { if (attempt > 1) t.note(`the agent tried pkill on attempt ${attempt}`); break; }
      }
      t.check('cli: exit 0', res.code === 0, `${res.stderr.slice(-400)} ${res.stdout.slice(-400)}`);
      if (id) checkRunDone(t, t.sb, id);
      t.check('one implementer spawn', taps.length >= 1, `${taps.length}`);
      const hook = taps.map(settingsOf).find(Boolean)?.hooks?.PreToolUse || [];
      t.check('--settings carries the host-guard PreToolUse hook on Bash',
        hook.some((h) => h.matcher === 'Bash' && JSON.stringify(h.hooks).includes('host-guard.mjs')), JSON.stringify(hook).slice(0, 300));
      const tries = taps.flatMap((tp) => bashCalls(tp, /\bpkill\b/).map((c) => ({ tp, c })));
      t.check('the agent attempted the pkill (precondition)', tries.length > 0, taps.map((tp) => tp.wire.tools.map((x) => x.name).join(',')).join(' | '));
      const blocked = taps.flatMap(toolResults).filter((r) => /host guard: blocked `pkill`/.test(r.text));
      t.check('the hook blocked it (tool_result says "host guard: blocked `pkill`")', blocked.length > 0,
        taps.flatMap(toolResults).map((r) => r.text.slice(0, 160)).join(' | ').slice(0, 600));
      t.check('the blocked result is an error result', blocked.every((r) => r.isError), JSON.stringify(blocked.map((r) => r.isError)));
    },
  },

  {
    id: 'guard.deny-rules',
    title: "a guardrail set's deny rule (Bash(curl:*)) reaches --settings and the harness refuses the command",
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const srv = await t.sb.server();
      try {
        const proj = t.sb.addProject();
        const reg = await registerProject(srv, proj);
        t.check('project registered', reg.status === 200, reg.text.slice(0, 300));
        const gr = await srv.api('POST', '/api/guardrails', { name: 'Live no curl', settings: { deny: ['Bash(curl)', 'Bash(curl:*)'] } });
        t.check('guardrail set created', gr.status === 201, gr.text.slice(0, 300));
        const grId = gr.json?.guardrails?.id;
        const wf = importWorkflow(t, 'implement-only', { nodeConfig: { model: t.model }, as: 'Live implement only (pinned)' });
        const prompt = 'This is a test of the shell sandbox, not a coding task. Your FIRST tool call must be the Bash tool with exactly this command, verbatim: '
          + '`curl -s -m 5 http://127.0.0.1:9/` . Do not read any file before it. Then report, word for word, what the tool returned, and stop. '
          + 'Do not modify any file and do not try any other command or tool to reach the network.';
        const start = await srv.api('POST', '/api/run', { projectDir: proj, prompt, workflowId: wf, guardrailsId: grId, title: 'live deny rules' });
        t.check('run accepted', start.status >= 200 && start.status < 300, start.text.slice(0, 400));
        const row = await waitTerminal(t.sb, null, { timeoutMs: 20 * 60 * 1000 });
        t.check('run reached a terminal state', !!row, 'timeout');
        if (row) t.check('run: status done', row.status === 'done', `${row.status} ${row.pauseReason || ''}`);
        const taps = nodeTaps(t.sb);
        const deny = taps.map(settingsOf).find(Boolean)?.permissions?.deny || [];
        t.check('--settings permissions.deny carries Bash(curl:*)', deny.includes('Bash(curl:*)') && deny.includes('Bash(curl)'), JSON.stringify(deny));
        t.check('the agent attempted curl (precondition)', taps.some((tp) => bashCalls(tp, /\bcurl\b/).length), taps.map((tp) => tp.wire.tools.map((x) => `${x.name}:${String(x.input?.command || '').slice(0, 40)}`).join(',')).join(' | '));
        const denials = taps.flatMap((tp) => tp.wire.results.flatMap((r) => r.denials || []));
        const refused = taps.flatMap(toolResults).filter((r) => r.isError && /denied|not allowed|permission/i.test(r.text));
        t.check('the harness refused the curl (permission denial on the wire)',
          denials.some((d) => /curl/.test(JSON.stringify(d))) || refused.length > 0,
          `denials=${JSON.stringify(denials).slice(0, 300)} results=${taps.flatMap(toolResults).map((r) => r.text.slice(0, 120)).join(' | ').slice(0, 400)}`);
        t.check('no curl ran successfully', !taps.flatMap(toolResults).some((r) => !r.isError && /curl/.test(r.text) && /Connection refused|Failed to connect|couldn't connect/i.test(r.text)), '');
      } finally {
        await srv.stop();
      }
    },
  },

  {
    id: 'guard.permission-mode',
    title: '--permission-mode plan reaches every agent spawn and the run edits nothing',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const { res, id, run, proj } = await implementOnly(t, SUBTRACT_TASK, { extra: ['--permission-mode', 'plan'] });
      t.note(`cli exit=${res.code}; run status=${run?.status} pause=${run?.pauseReason || ''}`);
      t.check('cli finished (no hang)', !res.timedOut, `${res.ms}ms`);
      const taps = nodeTaps(t.sb);
      t.check('implementer spawned', taps.length >= 1, `${taps.length}`);
      t.check('every agent spawn got --permission-mode plan', taps.length > 0 && taps.every((tp) => flagOf(tp, '--permission-mode') === 'plan'),
        taps.map((tp) => flagOf(tp, '--permission-mode')).join(','));
      const orig = readFileSync(join(LIVE_ROOT, 'fixtures', 'repos', 'calc', 'src', 'calc.mjs'), 'utf8');
      const branch = run?.featureBranch;
      let after = orig;
      if (branch) { try { after = t.sb.git(proj, ['show', `${branch}:src/calc.mjs`]); } catch { /* no branch left: nothing committed */ } }
      t.check('src/calc.mjs unchanged (plan mode edits nothing)', after === orig, after.slice(0, 300));
      // Plan mode itself writes the plan to <HOME>/.claude/plans/ (Claude Code behaviour, outside the
      // project): not an edit. Those files land in the real HOME (the tap restores it), so the ones
      // this run created are removed again.
      const plansDir = join(t.profile.realHome(), '.claude', 'plans') + '/';
      const writes = taps.flatMap((tp) => toolResults(tp).filter((r) => !r.isError && /has been (updated|created)|File created successfully|updated successfully/i.test(r.text)));
      const planFiles = writes.map((w) => /(\/\S+?\.md)\b/.exec(w.text)?.[1]).filter((p) => p && p.startsWith(plansDir));
      for (const p of planFiles) { try { rmSync(p, { force: true }); } catch { /* best effort */ } }
      const edits = writes.filter((w) => !planFiles.some((p) => w.text.includes(p)));
      t.check('no successful Edit/Write outside the plan-mode plan file', edits.length === 0, edits.map((e) => e.text.slice(0, 160)).join(' | '));
      t.check('run reached a terminal state', !!run && ['done', 'error', 'paused', 'stopped'].includes(run.status), `${run?.status}`);
      if (id) t.note(`status ${t.sb.runShow(id)?.status}`);
    },
  },
];
