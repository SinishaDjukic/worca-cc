// test/ask-git-missing.test.mjs — Ask without git: no git-only tool is listed or callable, the child learns the
// state from WORCA_GIT, and the system prompt and sub-agent note stop promising worktrees, branches and clones.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { createAskTools, GIT_ONLY_ASK_TOOLS, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { buildMcpConfig, sandboxNote } from '../src/core/ask/spawn.mjs';
import { resolveChildGit, createAskToolServer, main } from '../src/core/ask/mcp-stdio.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage } from '../src/core/ask/store.mjs';
import { defaultActionsDeps } from '../src/core/ask/actions-deps.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { buildSystemPrompt, noGitSystemRules, ASK_SYSTEM_RULES, ASK_HOSTING_RULE, ASK_NO_GIT_RULE_7 } from '../src/core/ask/prompt.mjs';

useTempHome(after);

const tools = (git) => createAskTools({ limits: ASK_LIMITS, redact: (s) => s, clones: {}, chatActions: { directionMaxChars: 4000 },
  ...(git === undefined ? {} : { gitAvailable: () => git }) });
const names = (t) => t.list().map((d) => d.name);

test('Ask without git', async () => {
  await checkRows([
    { name: 'the git-only set', run: () => {
      assert.deepEqual(GIT_ONLY_ASK_TOOLS, ['list_branches', 'open_worktree', 'list_worktrees', 'remove_worktree', 'git', 'propose_clone_project', 'propose_pull_request']);
    } },
    { name: 'git missing: none listed; get_run_diff stays; a call is refused with the tool name', run: async () => {
      const off = names(tools(false));
      for (const n of GIT_ONLY_ASK_TOOLS) assert.ok(!off.includes(n), n);
      assert.ok(off.includes('get_run_diff'));
      await assert.rejects(tools(false).call('git', { worktreeId: 'w', args: ['log'] }), (e) => e instanceof AskToolError && e.message === 'git: git is not installed on this machine');
    } },
    { name: 'git on, or no dep (every existing caller): all listed', run: () => {
      for (const t of [tools(true), tools(undefined)]) for (const n of GIT_ONLY_ASK_TOOLS) assert.ok(names(t).includes(n), n);
    } },
    { name: 'S67: a child without WORCA_GIT probes once; with it, never', run: async () => {
      let n = 0; cap.useProbe(async () => { n += 1; return { available: true, path: '/g', version: '2', reason: 'ok', checkedAt: Date.now() }; });
      try {
        await resolveChildGit({ WORCA_GIT: '1' }); await resolveChildGit({ WORCA_GIT: '0' });
        assert.equal(n, 0);
        const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;   // gitState() reads the real env (S1)
        try { await resolveChildGit({}); } finally { if (saved !== undefined) process.env.WORCA_GIT = saved; }
        assert.equal(n, 1);
      } finally { cap.reset(); }
    } },
    { name: 'the classic child gets WORCA_GIT; relay and an omitted git add nothing', run: () => {
      const base = { homeBase: '/b', threadId: 't', serverPath: '/s.mjs', env: {} };
      assert.equal(buildMcpConfig({ ...base, git: false }).mcpServers.worca.env.WORCA_GIT, '0');
      assert.equal(buildMcpConfig({ ...base, git: true }).mcpServers.worca.env.WORCA_GIT, '1');
      assert.equal('WORCA_GIT' in buildMcpConfig(base).mcpServers.worca.env, false);
      assert.equal('WORCA_GIT' in buildMcpConfig({ ...base, git: false, relay: { url: 'http://x', token: 'k' } }).mcpServers.worca.env, false);
    } },
    { name: 'prompt: git on = today byte for byte; git off names no git-only tool, rule 7 replaced (Claude, Codex, hosted)', run: () => {
      assert.equal(buildSystemPrompt({}, {}), buildSystemPrompt({}, { git: true }));
      for (const opts of [{}, { engine: 'codex' }, { deployment: 'hosted' }]) {
        const p = buildSystemPrompt({}, { ...opts, git: false });
        for (const n of ['list_branches', 'open_worktree', 'list_worktrees', 'remove_worktree', 'propose_clone_project', 'propose_pull_request', 'WORCA_CLONE_ALLOW']) assert.ok(!p.includes(n), `${JSON.stringify(opts)} ${n}`);
        assert.ok(p.includes(ASK_NO_GIT_RULE_7));
      }
      const all = `${ASK_SYSTEM_RULES}\n${ASK_HOSTING_RULE}`;
      assert.equal(all.split('7. Worktrees').length, 2, 'rule 7 prefix occurs once');
      assert.ok(noGitSystemRules(all).includes('Cloning a repository needs git, which this server does not have.'));
    } },
    { name: 'sub-agent note: no worktree promise without git', run: () => {
      assert.match(sandboxNote(), /read-only detached worktrees/);
      const n = sandboxNote({ git: false });
      assert.doesNotMatch(n, /worktree/); assert.match(n, /This machine has no git, so there is no view into a repository\./);
    } },
  ]);
});

// The wiring: the tool server both the classic child and the relay build reads the git state; a turn hands it to the
// child (WORCA_GIT) and to the sub-agent note; main() resolves it before the classic tool server starts (S67).
test('Ask without git: the wiring (tool server, turn, child main)', async () => {
  await checkRows([
    { name: 'createAskToolServer (classic child and relay) drops every git-only tool while git is missing', run: async () => {
      const listed = async () => {
        const out = [];
        const rpc = createAskToolServer({ threadId: null, env: { ...process.env }, write: (s) => out.push(s), log: () => {} });
        await rpc.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })); await rpc.idle();
        return JSON.parse(out.join('').trim()).result.tools.map((d) => d.name);
      };
      const on = await listed();
      for (const n of GIT_ONLY_ASK_TOOLS) assert.ok(on.includes(n), `git on: ${n}`);
      const restore = withNoGit();
      try {
        const off = await listed();
        for (const n of GIT_ONLY_ASK_TOOLS) assert.ok(!off.includes(n), `git missing: ${n}`);
        assert.ok(off.includes('get_run_diff'));
      } finally { restore(); }
    } },
    { name: 'a turn hands the git state to the child (WORCA_GIT) and to the sub-agent note', run: async () => {
      const seen = {};
      for (const git of [true, false]) {
        const thread = createThread();
        const user = appendMessage(thread.id, { role: 'user', text: 'hi' });
        const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
        const turn = createAskTurn({ threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id, prompt: 'P', systemPrompt: 'S', restoredPrompt: 'R',
          model: 'claude-opus-5-5', effort: 'high', resumeSessionId: null, firstTurn: false, firstText: 'hi', deterministicTitle: null, mock: null, attachmentNames: {},
          deps: { gitAvailable: () => git, onFrame: () => {}, onOutOfTurn: () => {}, generateTitle: async () => '', failedBecauseSignedOut: async () => false,
            claudeAuthState: async () => 'unknown', suggestionsEnabled: () => false,
            runClaudeImpl: async (opts) => {
              seen[git] = { env: JSON.parse(readFileSync(opts.mcpConfigPath, 'utf8')).mcpServers.worca.env, note: opts.appendSubagentSystemPrompt };
              throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
            } } });
        await turn.run();
      }
      assert.equal(seen.true.env.WORCA_GIT, '1'); assert.match(seen.true.note, /read-only detached worktrees/);
      assert.equal(seen.false.env.WORCA_GIT, '0'); assert.doesNotMatch(seen.false.note, /worktree/);
    } },
    { name: 'get_run_checkout says why Check out is refused: git is missing', run: async () => {
      const { actions } = defaultActionsDeps();
      const row = { id: 'abcd1234', status: 'done', project_key: 'web-00000001', target: 'project', branch: JSON.stringify({ source: 'main', feature: 'worca-cc/x' }) };
      assert.equal(actions.runCheckout(row).checkoutBlocked, null, 'git on: offered');
      const restore = withNoGit();
      try { assert.equal(actions.runCheckout(row).checkoutBlocked, 'git is not installed on this machine'); } finally { restore(); }
    } },
    { name: 'S67: main() resolves the git state before the classic tool server starts', run: async () => {
      let n = 0; cap.useProbe(async () => { n += 1; return { available: true, path: '/g', version: '2', reason: 'ok', checkedAt: Date.now() }; });
      const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;   // a child started without the forwarded value
      try {
        await main({ argv: [], env: {}, stdin: Readable.from([]), stdout: new Writable({ write(_c, _e, cb) { cb(); } }) });
        assert.equal(n, 1);
      } finally { if (saved !== undefined) process.env.WORCA_GIT = saved; cap.reset(); }
    } },
  ]);
});

// The server builds its turns WITHOUT a gitAvailable dep, so the default is what ships: a default that forwarded
// WORCA_GIT=1 would let the classic child list and run the git tools while git is missing.
test('Ask without git: the turn default', async () => {
  await checkRows([
    { name: 'a turn built without a gitAvailable dep (as the server builds them) hands the real state to the child and the note', run: async () => {
      const restore = withNoGit();
      try {
        const thread = createThread();
        const user = appendMessage(thread.id, { role: 'user', text: 'hi' });
        const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
        let seen = null;
        const turn = createAskTurn({ threadId: thread.id, assistantMessageId: asst.id, userMessageId: user.id, prompt: 'P', systemPrompt: 'S', restoredPrompt: 'R',
          model: 'claude-opus-5-5', effort: 'high', resumeSessionId: null, firstTurn: false, firstText: 'hi', deterministicTitle: null, mock: null, attachmentNames: {},
          deps: { onFrame: () => {}, onOutOfTurn: () => {}, generateTitle: async () => '', failedBecauseSignedOut: async () => false,
            claudeAuthState: async () => 'unknown', suggestionsEnabled: () => false,
            runClaudeImpl: async (opts) => {
              seen = { env: JSON.parse(readFileSync(opts.mcpConfigPath, 'utf8')).mcpServers.worca.env, note: opts.appendSubagentSystemPrompt };
              throw Object.assign(new Error('claude exited with code 1: boom'), { errorClass: 'api' });
            } } });
        await turn.run();
        assert.equal(seen.env.WORCA_GIT, '0'); assert.doesNotMatch(seen.note, /worktree/);
      } finally { restore(); }
    } },
  ]);
});
