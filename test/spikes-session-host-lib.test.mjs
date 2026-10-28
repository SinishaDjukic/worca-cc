// test/spikes-session-host-lib.test.mjs — the spike library's pure half, and every spike's --dry path. No real
// harness is spawned: child_process is mocked to throw inside dryRun, and the only real spawns are `node` itself.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarize, strip, runTurn, requestFacts, bigPrompt, toolResult, hostAgentCalls, assistantMessages, sumUsage,
  dryLine, runJsonl, recordingProxy, defaultUpstream, spikeContext, verdict } from '../tools/spikes/session-host/lib.mjs';
import { main as s1 } from '../tools/spikes/session-host/s1-agents-per-resume.mjs';
import { main as s2, definitionFacts as s2Facts } from '../tools/spikes/session-host/s2-definition-fields.mjs';
import { main as s3 } from '../tools/spikes/session-host/s3-child-permissions.mjs';
import { main as s4 } from '../tools/spikes/session-host/s4-cost.mjs';
import { main as s6, scanCli } from '../tools/spikes/session-host/s6-depth-and-cap.mjs';
import { main as s7, BRIEF_DIVIDER, replacesDefaultFrom } from '../tools/spikes/session-host/s7-prompt-and-quality.mjs';
import { sum } from '../tools/spikes/session-host/fixtures/s7-repo/src/sum.mjs';
import { slug } from '../tools/spikes/session-host/fixtures/s7-repo/src/slug.mjs';

const F = [
  { type: 'system', subtype: 'init', session_id: 'S', model: 'claude-haiku-4-5', tools: ['Agent', 'Bash'] },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'T1', name: 'Agent', input: { subagent_type: 'spike-a', prompt: 'go', model: 'opus' } }] } },
  { type: 'system', subtype: 'init', parent_tool_use_id: 'T1', model: 'claude-haiku-4-5', tools: ['Read'] },
  { type: 'assistant', parent_tool_use_id: 'T1', message: { content: [{ type: 'tool_use', id: 'I1', name: 'Agent', input: { subagent_type: 'worca-investigator' } }] } },
  { type: 'assistant', parent_tool_use_id: 'I1', message: { content: [{ type: 'text', text: 'secret' }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'T1', content: 'ALPHA' }] }, tool_use_result: { resolvedModel: 'claude-haiku-4-5', usage: { input_tokens: 5 }, agentId: 'ag1' } },
  { type: 'result', session_id: 'S', total_cost_usd: 0.0123, usage: { input_tokens: 9 } },
];

test('summarize: agent calls with their parent and input keys, child inits, results, cumulative cost', () => {
  const s = summarize(F);
  assert.deepEqual(s.agentCalls, [{ id: 'T1', type: 'spike-a', parent: null, inputKeys: ['model', 'prompt', 'subagent_type'] },
    { id: 'I1', type: 'worca-investigator', parent: 'T1', inputKeys: ['subagent_type'] }]);
  assert.equal(s.childFrames, 3);
  assert.deepEqual(s.parentIds, ['I1', 'T1']);
  assert.deepEqual(s.inits, [{ parent: null, model: 'claude-haiku-4-5', tools: ['Agent', 'Bash'] }, { parent: 'T1', model: 'claude-haiku-4-5', tools: ['Read'] }]);
  assert.equal(s.toolResults[0].meta.resolvedModel, 'claude-haiku-4-5');
  assert.equal(s.toolResults[0].meta.agentId, 'ag1');
  assert.equal(s.cumulativeUsd, 0.0123);
});

test('strip: no text, input or content survives', () => {
  const out = JSON.stringify(F.map(strip));
  assert.ok(!out.includes('secret') && !out.includes('ALPHA') && !out.includes('"go"'), out);
  assert.ok(out.includes('"T1"') && out.includes('"I1"'), 'ids survive');
});

test('requestFacts: sizes and marker hits only, never the text', () => {
  const body = { model: 'claude-haiku-4-5', system: [{ type: 'text', text: 'You are Claude Code. Use TodoWrite. MARK-CLAUDEMD' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'gitStatus: clean' }] }] };
  const f = requestFacts(body, ['TodoWrite', 'MARK-CLAUDEMD', 'gitStatus', 'absent']);
  assert.deepEqual(f, { model: 'claude-haiku-4-5', systemBytes: 49, markersInSystem: ['TodoWrite', 'MARK-CLAUDEMD'], markersInMessages: ['gitStatus'] });
  assert.ok(!JSON.stringify(f).includes('You are'));
});

test('bigPrompt and runTurn dry: the argv the spike would spawn', async () => {
  const p = bigPrompt(65536, 'END-MARK');
  assert.ok(Buffer.byteLength(p) >= 65536 && p.endsWith('END-MARK'));
  const r = await runTurn({ bin: 'claude', cwd: '/tmp', prompt: 'p', resume: 'S', agentsFile: '/tmp/a.json', extraArgs: ['--max-turns', '4'], dry: true });
  assert.deepEqual(r.argv, ['-p', 'p', '--output-format', 'stream-json', '--verbose', '--resume', 'S', '--agents', '/tmp/a.json', '--max-turns', '4']);
});

// ---- beyond revision 3 (D1–D5) --------------------------------------------------------------------------------

test('toolResult, hostAgentCalls, assistantMessages, sumUsage: the per-call views the spikes read', () => {
  assert.deepEqual(toolResult(F, 'T1'), { isError: false, text: 'ALPHA', meta: F[5].tool_use_result });
  assert.equal(toolResult(F, 'nope'), null);
  assert.deepEqual(hostAgentCalls(F).map((c) => c.id), ['T1']);
  assert.equal(assistantMessages(F, 'T1').length, 1);
  assert.deepEqual(sumUsage([{ input_tokens: 5 }, { input_tokens: 4, output_tokens: 1 }]),
    { input_tokens: 9, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test('strip: absolute paths and stderr do not survive either (the S9 fixture is committed)', () => {
  const out = JSON.stringify(strip({ type: 'system', subtype: 'init', cwd: '/Users/someone/repo', tools: ['Read'],
    message: { content: [{ type: 'tool_use', id: 'R1', name: 'Read', input: { file_path: '/Users/someone/repo/a.txt' } }] },
    tool_use_result: { stderr: 'boom', filePath: '/Users/someone/repo/a.txt' } }));
  assert.ok(!out.includes('/Users/someone') && !out.includes('boom'), out);
  assert.ok(out.includes('"R1"') && out.includes('"Read"'));
});

test('dryLine: one line; long or multi-line args become a byte count; env and placeholders print bare', () => {
  const l = dryLine('turn 1', { bin: 'claude', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:<port>' },
    argv: ['-p', 'a b', '--append-system-prompt', 'x\ny', '--settings', '{"deny":["Bash(x*)"]}', '--resume', '<session-1>'] });
  assert.equal(l, `dry turn 1: ANTHROPIC_BASE_URL=http://127.0.0.1:<port> claude -p 'a b' --append-system-prompt <3 bytes> --settings '{"deny":["Bash(x*)"]}' --resume <session-1>`);
});

test('runJsonl: JSONL frames, non-JSON lines kept in stderr, stdin closed, a bad exit or a missing binary never throws', async () => {
  const code = "process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'system',subtype:'init',session_id:'S',ctx:process.env.NODE_TEST_CONTEXT??null}));"
    + "console.log('not json');console.log(JSON.stringify({type:'result',total_cost_usd:0.5}));process.exit(4)})";
  const r = await runJsonl({ bin: [process.execPath], argv: ['-e', code], cwd: process.cwd() });
  assert.deepEqual(r.frames.map((f) => f.type), ['system', 'result']);
  assert.equal(r.frames[0].ctx, null, 'a spike child never inherits NODE_TEST_CONTEXT');
  assert.match(r.stderr, /not json/);
  assert.equal(r.exitCode, 4);
  const missing = await runJsonl({ bin: ['/nonexistent/worca-spike-bin'], argv: [], cwd: process.cwd() });
  assert.equal(missing.exitCode, -1);
  assert.match(missing.stderr, /ENOENT/);
});

test('recordingProxy: drops the client Host, forwards body and auth, streams the reply, records facts only', async () => {
  let seen = null;
  const up = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; }).on('end', () => {
      seen = { host: req.headers.host, key: req.headers['x-api-key'], body: b };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('event: done\ndata: {}\n\n');
    });
  });
  await new Promise((ok) => up.listen(0, '127.0.0.1', ok));
  const upstream = `http://127.0.0.1:${up.address().port}`;
  const proxy = await recordingProxy({ upstream, markers: ['MARK'] });
  try {
    const body = JSON.stringify({ model: 'claude-haiku-4-5', system: 'sys MARK', messages: [{ role: 'user', content: 'hi' }] });
    const r = await fetch(`${proxy.url}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'k' }, body });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'event: done\ndata: {}\n\n');
    assert.deepEqual(seen, { host: upstream.slice('http://'.length), key: 'k', body });
    assert.deepEqual(proxy.requests().map((q) => [q.path, q.model, q.systemBytes, q.markersInSystem, q.thinking]),
      [['/v1/messages', 'claude-haiku-4-5', 8, ['MARK'], null]]);
    assert.ok(!JSON.stringify(proxy.requests()).includes('sys MARK'));
    assert.equal(defaultUpstream({}), 'https://api.anthropic.com');
    assert.equal(defaultUpstream({ ANTHROPIC_BASE_URL: 'https://gw.example/anthropic/' }), 'https://gw.example/anthropic');
  } finally {
    await proxy.close();
    up.closeAllConnections();
    await new Promise((ok) => up.close(ok));
  }
});

test('spikeContext: a live run is refused without WORCA_ALLOW_LIVE_CLAUDE=1; --dry writes nothing', () => {
  const saved = process.env.WORCA_ALLOW_LIVE_CLAUDE;
  delete process.env.WORCA_ALLOW_LIVE_CLAUDE;
  try {
    assert.throws(() => spikeContext('SX', []), /WORCA_ALLOW_LIVE_CLAUDE=1/);
    const ctx = spikeContext('SX', ['--dry'], { log: () => {} });
    assert.equal(ctx.dry, true);
    assert.match(ctx.agents({ a: {} }), /agents-1\.json$/);
    assert.match(ctx.agents({ b: {} }), /agents-2\.json$/);
    assert.equal(existsSync(ctx.out), false, '--dry writes nothing');
  } finally { if (saved !== undefined) process.env.WORCA_ALLOW_LIVE_CLAUDE = saved; }
});

test('verdict: one JSON line; pass:null leaves the exit code alone', () => {
  const saved = process.exitCode;
  const lines = [];
  try {
    verdict('S10-codex', null, { skipped: 'not installed' }, { log: (l) => lines.push(l) });
    assert.equal(process.exitCode, saved);
  } finally { process.exitCode = saved; }
  assert.deepEqual(JSON.parse(lines[0]), { spike: 'S10-codex', pass: null, facts: { skipped: 'not installed' } });
});

// ---- the --dry harness used by Tasks 2–10 -------------------------------------------------------------------------

const SPAWNERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];

/** Run a spike's main(['--dry']) in-process with every child_process entry point mocked to throw. */
async function dryRun(main, env = {}) {
  const lines = [];
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const mocks = SPAWNERS.map((m) => mock.method(cp, m, () => { throw new Error(`--dry must not call child_process.${m}`); }));
  try {
    await main(['--dry'], { log: (l) => lines.push(String(l)) });
    for (const m of mocks) assert.equal(m.mock.callCount(), 0, 'a --dry run spawned a process');
  } finally {
    for (const m of mocks) m.mock.restore();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return {
    argv: lines.filter((l) => l.startsWith('dry ')),
    notes: lines.filter((l) => l.startsWith('# ')),
    verdicts: lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)),
  };
}

test('S1 --dry: five turns; turns 2–5 resume; turns 2, 3 and 5 carry agents-2.json; turn 4 a never-existing id', async () => {
  const { argv } = await dryRun(s1);
  assert.equal(argv.length, 5, argv.join('\n'));
  for (const l of argv) assert.match(l, /claude -p .* --output-format stream-json --verbose /);
  assert.match(argv[0], /--agents \S*agents-1\.json/);
  assert.doesNotMatch(argv[0], /--resume/);
  for (const i of [1, 2, 4]) assert.match(argv[i], /--resume <session-1> --agents \S*agents-2\.json/);
  assert.match(argv[3], /--resume 00000000-0000-4000-8000-000000000000/);
  assert.doesNotMatch(argv[3], /--agents/);
});

test('S2 --dry: per CLI one control and four definition turns (10 lines), each definition with --agents', async () => {
  const { argv } = await dryRun(s2, { WORCA_EFFORT_FLAG: '' });
  assert.equal(argv.length, 10, argv.join('\n'));
  assert.equal(argv.filter((l) => / --agents /.test(l)).length, 8);
  assert.equal(argv.filter((l) => l.includes(' npx -y @anthropic-ai/claude-code@2.1.294 ')).length, 5);
  const control = argv.filter((l) => / control: /.test(l));
  assert.equal(control.length, 2);
  for (const l of control) { assert.doesNotMatch(l, /--agents|--model/); assert.match(l, /--allowedTools Read /); }
  for (const l of argv.filter((x) => / s2bare: /.test(x))) assert.match(l, /ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:<port> .*--model claude-haiku-4-5 --effort low/);
  for (const l of argv.filter((x) => / s2: /.test(x))) assert.match(l, /--model claude-sonnet-4-5 --allowedTools Agent,Read,Bash/);
  for (const l of argv.filter((x) => / s2m: /.test(x))) assert.match(l, /--mcp-config \S*mcp\.json/);
});

test('S2 definitionFacts: null without child evidence; a child holding Bash or running past maxTurns reads false', () => {
  const host = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'A1', name: 'Agent', input: { subagent_type: 's2' } }] } };
  const msg = (id, block) => ({ type: 'assistant', parent_tool_use_id: 'A1', message: { id, content: [block] } });
  const read = (id) => ({ type: 'tool_use', id, name: 'Read', input: {} });
  const none = { toolsRestrict: null, maxTurnsHonoured: null, childToolsWithList: null };
  assert.deepEqual(s2Facts([]), none, 'no Agent call');
  assert.deepEqual(s2Facts([host]), none, 'the child left no frame');
  assert.deepEqual(s2Facts([host, msg('m1', read('R1')), msg('m2', read('R2'))]),
    { toolsRestrict: true, maxTurnsHonoured: true, childToolsWithList: null }, 'cut after 2 messages with work left');
  assert.equal(s2Facts([host, msg('m1', read('R1')), msg('m2', { type: 'text', text: 'x' })]).maxTurnsHonoured, null,
    'a child that stopped by itself after 2 messages tested nothing');
  assert.equal(s2Facts([host, msg('m1', read('R1'))]).maxTurnsHonoured, null, 'one message tested nothing');
  assert.deepEqual(s2Facts([host, { type: 'system', subtype: 'init', parent_tool_use_id: 'A1', tools: ['Read', 'Bash'] },
    ...['m1', 'm2', 'm3', 'm4'].map((id, i) => msg(id, read(`R${i}`)))]),
  { toolsRestrict: false, maxTurnsHonoured: false, childToolsWithList: ['Read', 'Bash'] });
  const bash = [host, msg('m1', { type: 'tool_use', id: 'B1', name: 'Bash', input: {} }),
    { type: 'user', parent_tool_use_id: 'A1', message: { content: [{ type: 'tool_result', tool_use_id: 'B1', content: 's2' }] } }];
  assert.equal(s2Facts(bash).toolsRestrict, false, 'a Bash call that ran');
});

test('S3 --dry: five turns per CLI; c carries worca\'s deny settings, d the guard env, e the key-logging hook', async () => {
  const { argv } = await dryRun(s3, { WORCA_HOST_GUARD: '1' });
  assert.equal(argv.length, 10, argv.join('\n'));
  const turn = (t) => argv.filter((l) => new RegExp(`^dry \\S+ ${t}: `).test(l));
  for (const t of ['a', 'b', 'c', 'd', 'e']) assert.equal(turn(t).length, 2, t);
  for (const l of turn('a')) assert.match(l, /--allowedTools Agent --max-turns/);
  for (const l of turn('b')) assert.match(l, /--tools Agent --allowedTools Agent,Bash,Write /);
  for (const l of turn('c')) { assert.ok(l.includes('"deny":["Bash(echo s3-denied*)"]'), l); assert.match(l, /host-guard\.mjs/); }
  for (const l of turn('d')) { assert.match(l, /WORCA_HOST_GUARD=1 WORCA_HOST_PID=\d+ /); assert.ok(l.includes('"deny":["Bash(echo s3-denied*)"]')); }
  for (const l of turn('e')) assert.match(l, /S3E_KEYS=\S+s3e\.keys .*--settings .*"matcher":"\*"/);
});

test('S4 --dry: six turns; the third and fourth carry --max-budget-usd', async () => {
  const { argv } = await dryRun(s4);
  assert.equal(argv.length, 6, argv.join('\n'));
  assert.deepEqual(argv.map((l) => l.includes('--max-budget-usd')), [false, false, true, true, false, false]);
  assert.match(argv[1], /--resume <session-1> /);
  assert.match(argv[2], /--resume <session-1> .*--max-budget-usd <C2\/2>/);
  assert.match(argv[3], /--max-budget-usd 0\.02/);
  assert.doesNotMatch(argv[3], /--resume/);
  assert.match(argv[5], /--resume <session-5> /);
});

test('S6 --dry: five turns; (b0) and the three (b) turns carry the per-session cap env; (c) is a note', async () => {
  const { argv, notes } = await dryRun(s6);
  assert.equal(argv.length, 5, argv.join('\n'));
  assert.deepEqual(argv.map((l) => l.includes('CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION=2 ')), [false, true, true, true, true]);
  assert.doesNotMatch(argv[2], /--resume/);
  for (const i of [3, 4]) assert.match(argv[i], /--resume <session-b1> /);
  assert.ok(notes.some((n) => n.includes('(c)')));
});

test('S6 scanCli: the cap default and the concurrent-cap literal from a CLI file, no spawn', () => {
  const dir = mkdtempSync(join(tmpdir(), 's6-scan-'));
  try {
    const f = join(dir, 'cli.js');
    writeFileSync(f, 'x=a.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION ?? 200;y="Concurrent subagent limit reached. You can run "+n+" subagents at once."');
    assert.deepEqual(scanCli(f), { capDefault: 200, concurrentCapText: 'Concurrent subagent limit reached. You can run ' });
    assert.deepEqual(scanCli(null), { capDefault: null, concurrentCapText: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('S7a --dry: two probe turns through the proxy, then three process and three sub-agent trials', async () => {
  const { argv } = await dryRun(s7);
  assert.equal(argv.length, 8, argv.join('\n'));
  for (const l of argv.slice(0, 2)) assert.match(l, /ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:<port> /);
  assert.match(argv[0], /--agents \S*agents-1\.json/);
  assert.match(argv[1], /-p 'Reply OK\.' .*--append-system-prompt <\d+ bytes>/);
  const trials = argv.slice(2);
  for (const l of trials) assert.doesNotMatch(l, /ANTHROPIC_BASE_URL/);
  assert.equal(trials.filter((l) => /--append-system-prompt <\d+ bytes> --permission-mode acceptEdits --allowedTools Read,Write,Edit,Bash,Grep,Glob --model claude-sonnet-4-5$/.test(l)).length, 3);
  assert.equal(trials.filter((l) => /--agents \S*agents-\d+\.json .*--allowedTools Agent,Read,Write,Edit,Bash,Grep,Glob /.test(l)).length, 3);
  assert.equal(BRIEF_DIVIDER, '\n\n<!-- worca: step brief -->\n\n', 'C4; Task 31 must export the same value');
});

test('S7a replacesDefaultFrom: only markers the definition does not carry; null without a default in the control', () => {
  const req = (...m) => ({ markersInSystem: m });
  assert.equal(replacesDefaultFrom(req('worca: step brief'), req('You are Claude Code', 'TodoWrite'), 'impl'), true);
  assert.equal(replacesDefaultFrom(req('TodoWrite'), req('TodoWrite'), 'impl'), false);
  assert.equal(replacesDefaultFrom(req('TodoWrite'), req('You are Claude Code', 'TodoWrite'), 'mentions TodoWrite'), true,
    'a marker the definition carries itself proves nothing');
  assert.equal(replacesDefaultFrom(req(), req(), 'impl'), null, 'the control shows no default');
  assert.equal(replacesDefaultFrom(null, req('TodoWrite'), 'impl'), null, 'no child request');
});

test('s7-repo fixture: task A starts red (the off-by-one), task B green; CLAUDE.md carries the marker; no nested .git', () => {
  assert.equal(sum([1, 2, 3]), 5);                 // the bug PLAN-A.md asks to fix
  assert.equal(slug('  Hello   World '), 'hello-world');
  const at = (p) => new URL(`../tools/spikes/session-host/fixtures/s7-repo/${p}`, import.meta.url);
  assert.match(readFileSync(at('CLAUDE.md'), 'utf8'), /^Project rule MARK-CLAUDEMD-7: tests live in test\/\.$/m);
  assert.equal(JSON.parse(readFileSync(at('package.json'), 'utf8')).scripts.test, 'node --test');
  for (const f of ['PLAN-A.md', 'PLAN-B.md', 'test/sum.test.mjs', 'test/slug.test.mjs']) assert.ok(existsSync(at(f)), f);
  assert.equal(existsSync(at('.git')), false);
});
