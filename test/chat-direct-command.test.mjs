// test/chat-direct-command.test.mjs — the /direct command forwards verbatim
// prose (newlines and @mentions intact) to a live run's direction inbox.
// Fixture mirrors test/chat-command-router.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createCommandRouter } from '../src/core/chat/command-router.mjs';
import { DIRECTIONS_CLOSED } from '../src/core/directions.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

const CONFIG = { allowedChatIds: '42' };

function fixture(overrideActions = {}) {
  const calls = [];
  const state = {
    live: [{ runId: 'run-aaaa1111', pipelineId: 'pipe-aaaa1111', title: 'Deck', status: 'running', kind: 'run', projectDir: '/x/worca' }],
    rows: [],
  };
  const actions = {
    listRuns: () => state.live,
    runState: () => null,
    pendingQuestion: () => null,
    answer: async () => {},
    stop: async () => {},
    pause: async () => {},
    resume: async () => ({ ok: true }),
    history: async () => state.rows,
    listProjects: async () => [{ name: 'worca', path: '/x/worca' }],
    direct: async (runId, text) => { calls.push(['direct', runId, text]); return { id: 'd123' }; },
    ...overrideActions,
  };
  const chatContext = createChatContext(join(worcaHome(), `chat-context-${Math.random().toString(36).slice(2)}.json`));
  const router = createCommandRouter({ actions, chatContext, logger: () => {} });
  const send = (text, chatId = '42') => router.handleIncoming({
    plugin: 'p', channelId: 'main', platform: 'testchat',
    channelConfig: CONFIG, msg: { chatId, userId: 'u1', text, meta: { isGroup: false } },
  });
  return { send, calls, state };
}

test('/direct forwards the verbatim prose (newlines and @mentions intact) to the single live run', async () => {
  const { send, calls } = fixture();
  const out = await send('/direct cut the roadmap section,\nping @alice about the accent');
  assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'cut the roadmap section,\nping @alice about the accent']]);
  assert.equal(out.severity, 'success');
});

test('/direct *ref picks the run; empty text is a warning; no live run is a warning', async () => {
  const { send, calls, state } = fixture();
  await send('/direct *1111 make it darker');
  assert.deepEqual(calls[0], ['direct', 'run-aaaa1111', 'make it darker']);
  assert.equal((await send('/direct')).severity, 'warning');
  state.live = [];
  assert.equal((await send('/direct x')).severity, 'warning');
});

// postDirection returns null when the row cannot be resolved — a run launched but
// not yet seen a `state` event still carries its UUID, not its pipeline id. The
// HTTP twin 404s on that; the chat reply used to claim success anyway, telling the
// user a direction was filed that no step would ever read.
test('/direct reports a warning, not success, when nothing was recorded', async () => {
  const { send } = fixture({ direct: async () => null });
  const out = await send('/direct cut the roadmap');
  assert.equal(out.severity, 'warning', JSON.stringify(out));
  const body = JSON.stringify(out.body);
  assert.match(body, /not addressable yet/);
  assert.doesNotMatch(body, /\*\*posted\*\*/);
});

test('/direct mentions: a leading bot mention is stripped; mentions after the command are kept; a consumed ref is always stripped', async () => {
  await checkRows([
    // parseCommand strips @mentions anywhere, so addressing the bot dispatches fine —
    // but the handler used to re-slice the RAW text anchored on `/direct` at position
    // 0, which does not match when the mention comes first. The mention and the
    // command literal then became part of the direction, and that string is what
    // reaches the next agent's prompt. Group channels are where /direct is used.
    { name: '/direct addressed to the bot by name records only the prose', run: async () => {
      const { send, calls } = fixture();
      const out = await send('@worca /direct cut the roadmap section');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'cut the roadmap section']]);
    } },
    { name: '/direct after a Slack/Discord wire mention records only the prose', run: async () => {
      const { send, calls } = fixture();
      const out = await send('<@U0123ABC> /direct cut the roadmap section');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'cut the roadmap section']]);
    } },
    { name: '/direct strips a consumed ref behind a wire mention and keeps the mention', run: async () => {
      const { send, calls } = fixture();
      await send('/direct <@U0123ABC> *aaaa1111 cut the roadmap slide');
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', '<@U0123ABC> cut the roadmap slide']]);
    } },
    // A mention AFTER the command is ambiguous: it is either the bot handle or the
    // direction's own subject, and the router cannot tell. Deleting the subject is
    // the worse error of the two, so nothing after the command is stripped — a
    // leading bot handle left in the text is noise, a missing "@alice" changes what
    // the direction says.
    { name: '/direct keeps a mention that opens the direction itself', run: async () => {
      const { send, calls } = fixture();
      await send('/direct @alice should sign off on slide 3');
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', '@alice should sign off on slide 3']]);
    } },
    { name: '/direct keeps a mention in the middle of the direction', run: async () => {
      const { send, calls } = fixture();
      await send('/direct tell @alice the accent is wrong');
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'tell @alice the accent is wrong']]);
    } },
    // parseCommand strips @mentions ANYWHERE, so `/direct @bot *a1b2c3d4 cut it`
    // yields args[0] === '*a1b2c3d4' and the ref is consumed for targeting. But the
    // text handed to the agent is sliced off msg.text, which only strips mentions
    // BEFORE the command — so the consumed ref was still sitting in the direction,
    // and renderDirectionsBlock put the literal run id in the next agent's prompt.
    // That is the same leak the other orderings were fixed for.
    { name: '/direct strips a consumed ref even when a mention sits between command and ref', run: async () => {
      const { send, calls } = fixture();
      await send('/direct @bot *aaaa1111 cut the roadmap slide');
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', '@bot cut the roadmap slide']],
        'the ref is gone; the mention stays, because a mention after the command may be the subject');
    } },
  ]);
});

test('/direct ref-vs-prose: only a token naming a live run (4+ chars) is a ref; emphasis and non-matching ids stay prose', async () => {
  await checkRows([
    // A first word that merely starts with '*' is not a run ref.
    { name: '/direct with markdown emphasis in the first word is prose, not a ref', run: async () => {
      const { send, calls } = fixture();
      const out = await send('/direct *never* use red for anything but the ask');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', '*never* use red for anything but the ask']]);
    } },
    { name: '/direct *ref still binds when the token is id-shaped', run: async () => {
      const { send, calls } = fixture();
      await send('/direct *aaaa1111 cut the roadmap');
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', 'cut the roadmap']]);
    } },
    // "Markdown emphasis always closes its asterisk" only holds for SINGLE-word
    // emphasis. `*please remove* the roadmap slide` opens with a bare `*please`,
    // which is id-shaped, so the ref guard consumed it and the direction was
    // silently dropped ("No live run matches `*please`"). A ref is only a ref if it
    // actually names one of this chat's live runs.
    { name: '/direct with multi-word emphasis is prose, not a ref', run: async () => {
      const { send, calls } = fixture();
      const out = await send('/direct *please remove* the roadmap slide');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', '*please remove* the roadmap slide']]);
    } },
    { name: '/direct with an id-shaped token that matches no run is prose too', run: async () => {
      const { send, calls } = fixture();
      await send('/direct *deadbeef99 was never a run here');
      assert.deepEqual(calls, [['direct', 'run-aaaa1111', '*deadbeef99 was never a run here']]);
    } },
    // Run ids are hex, so a one-character suffix matches by accident about one time
    // in sixteen — and the ref strip then eats the first word of the direction.
    { name: '/direct with a one-letter emphasis opener is prose, not a ref', run: async () => {
      const { send, calls, state } = fixture();
      state.live[0].runId = 'run-aaaa111a';                  // ends with "a"
      await send('/direct *a bit shorter on slide 4');
      assert.deepEqual(calls, [['direct', 'run-aaaa111a', '*a bit shorter on slide 4']]);
    } },
  ]);
});

test('/direct refuses finished/unknown-status runs (live or History) and never retargets another run', async () => {
  await checkRows([
    // Resolving the ref against LIVE runs only conflated two different cases: a
    // first token that is not a ref at all, and a ref naming a run that exists but
    // is not live. The second fell through to "no ref given", so with one other live
    // run in scope the direction was filed against a run the user never named — and
    // the literal `*a1b2c3d4` stayed inside the direction text the next agent reads.
    { name: '/direct with a ref that names a non-live run errors instead of picking another', run: async () => {
      const { send, calls, state } = fixture();
      state.live.push({ runId: 'run-dead9999', pipelineId: 'dead9999', title: 'finished', status: 'done', projectDir: '/x/worca' });
      const out = await send('/direct *dead9999 cut the roadmap slide');
      assert.equal(out.severity, 'warning', JSON.stringify(out));
      // "running or paused", not "live": /direct targets every run whose inbox a step
      // can still read, and `paused` is the state that exists for.
      assert.match(JSON.stringify(out.body), /No running or paused run matches/);
      assert.deepEqual(calls, [], 'and nothing is filed against the other live run');
    } },
    { name: '/direct refuses a ref naming a run only History still knows', run: async () => {
      const { send, calls, state } = fixture();
      state.rows = [{ id: 'pipe-dddd4444', title: 'from before the restart', status: 'done' }];
      const out = await send('/direct *dddd4444 cut the roadmap slide');
      assert.equal(out.severity, 'warning', JSON.stringify(out));
      assert.deepEqual(calls, [], 'and it is not silently retargeted');
    } },
    // ...but a FINISHED row is still refused: its inbox will never be read.
    { name: '/direct still refuses a finished run found only in History', run: async () => {
      const { send, calls, state } = fixture();
      state.live = [];
      state.rows = [{ id: 'pipe-ffff6666', title: 'done', status: 'done', projectDir: '/x/worca' }];
      const out = await send('/direct *ffff6666 cut the roadmap slide');
      assert.equal(out.severity, 'warning', JSON.stringify(out));
      assert.deepEqual(calls, []);
    } },
    // The allowlist must stay an allowlist: an unknown or empty status is not
    // directable by default, whatever DIRECTIONS_CLOSED happens to list.
    { name: '/direct still refuses a finished or unknown status', run: async () => {
      for (const status of ['done', 'error', 'stopped', 'weird-new-state', '']) {
        const { send, calls, state } = fixture();
        state.live = [];
        state.rows = [{ id: 'pipe-7777bbbb', title: 'not directable', status, projectDir: '/x/worca' }];
        const out = await send('/direct cut the roadmap slide');
        assert.notEqual(out.severity, 'success', `${status || '(empty)'} must not be directable`);
        assert.deepEqual(calls, [], `nothing may be filed for ${status || '(empty)'}`);
      }
    } },
  ]);
});

test('/direct files against paused/interrupted runs, with or without a ref, live Map or History', async () => {
  await checkRows([
    // The HTTP twin (postDirection in ui/server.mjs) deliberately accepts a direction
    // for a PAUSED run: resume replays directions.ndjson, which is the whole point of
    // accepting one for a run that is not currently live. The chat twin resolved with
    // `wantLive`, whose LIVE set is {running, starting, pausing} — so the surface
    // /direct was built for refused the one state the feature exists to serve.
    { name: '/direct files against a paused run, the state the inbox exists for', run: async () => {
      const { send, calls, state } = fixture();
      state.live = [{ runId: 'run-bbbb2222', pipelineId: 'pipe-bbbb2222', title: 'Deck', status: 'paused', kind: 'run', projectDir: '/x/worca' }];
      const out = await send('/direct cut the roadmap slide');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'run-bbbb2222', 'cut the roadmap slide']]);
    } },
    { name: '/direct with an explicit ref reaches a paused run', run: async () => {
      const { send, calls, state } = fixture();
      state.live.push({ runId: 'run-bbbb2222', pipelineId: 'pipe-bbbb2222', title: 'Paused deck', status: 'paused', projectDir: '/x/worca' });
      const out = await send('/direct *bbbb2222 cut the roadmap slide');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'run-bbbb2222', 'cut the roadmap slide']]);
    } },
    // Recognition was widened to History last round; the TARGET set was not. A paused
    // run that has left the in-memory Map — any server restart — is still directable:
    // postDirection resolves it from the DB, resume replays the inbox, and the HTTP
    // route accepts it. Chat refused it, which is the same disagreement the module
    // header says was fixed, one layer down.
    { name: '/direct reaches a paused run that has left the live Map', run: async () => {
      const { send, calls, state } = fixture();
      state.live = [];                                  // the Map after a restart
      state.rows = [{ id: 'pipe-eeee5555', title: 'paused before the restart', status: 'paused', projectDir: '/x/worca' }];
      const out = await send('/direct *eeee5555 cut the roadmap slide');
      assert.equal(out.severity, 'success', JSON.stringify(out));
      assert.deepEqual(calls, [['direct', 'pipe-eeee5555', 'cut the roadmap slide']]);
    } },
    // ROUND 2, N5. DIRECTABLE was an allowlist built from LIVE + 'paused', while the
    // HTTP route (postDirection) gates on the DENYLIST DIRECTIONS_CLOSED =
    // {done,error,stopped}. `interrupted` fell in the gap, and it is not a rare state:
    // reconcileStaleRunning stamps every dead-owner run `interrupted` on server
    // restart, and resumeRun explicitly accepts it and replays directions.ndjson. So
    // after any restart the UI filed a direction (201, read on resume) while /direct
    // answered "No running or paused runs." for the same row — the exact drift the
    // comment above DIRECTABLE claims its derivation prevents.
    { name: '/direct files against an interrupted run, live or from history', run: async () => {
      for (const where of ['live', 'history']) {
        const { send, calls, state } = fixture();
        const row = { runId: 'run-9999aaaa', pipelineId: 'pipe-9999aaaa', id: 'pipe-9999aaaa',
          title: 'interrupted by a restart', status: 'interrupted', projectDir: '/x/worca' };
        if (where === 'live') state.live = [row];
        else { state.live = []; state.rows = [row]; }

        const out = await send('/direct cut the roadmap slide');
        assert.equal(out.severity, 'success', `${where}: ${JSON.stringify(out)}`);
        assert.equal(calls.length, 1, `${where}: nothing was filed`);
        assert.equal(calls[0][2], 'cut the roadmap slide');
      }
    } },
  ]);
});

// Drift guard, read from the shared source rather than restated here: chat and
// HTTP must agree on which runs can still read the inbox. A status the server
// calls closed must be refused; every other live status must be filed.
test('/direct agrees with DIRECTIONS_CLOSED about which runs can still be directed', async () => {
  for (const status of DIRECTIONS_CLOSED) {
    const { send, calls, state } = fixture();
    state.live.push({ runId: 'run-cccc3333', pipelineId: 'cccc3333', title: 'closed', status, projectDir: '/x/worca' });
    const out = await send('/direct *cccc3333 cut the roadmap slide');
    assert.equal(out.severity, 'warning', `${status} must be refused: ${JSON.stringify(out)}`);
    assert.deepEqual(calls, [], `nothing filed for ${status}`);
  }
  for (const status of ['running', 'starting', 'pausing', 'paused']) {
    const { send, calls, state } = fixture();
    state.live = [{ runId: 'run-dddd4444', pipelineId: 'dddd4444', title: 'open', status, projectDir: '/x/worca' }];
    const out = await send('/direct *dddd4444 cut the roadmap slide');
    assert.equal(out.severity, 'success', `${status} must be directable: ${JSON.stringify(out)}`);
    assert.deepEqual(calls, [['direct', 'run-dddd4444', 'cut the roadmap slide']], `filed for ${status}`);
  }
});

test('/direct turns RUN_FINISHED and unknown runId throws into a warning, never "Command failed"', async () => {
  await checkRows([
    // postDirection throws RUN_FINISHED when a run settles between resolving the
    // target and posting — the likelier of the two throw paths, since /direct targets
    // live and paused runs. Neither it nor `unknown runId` was caught, so both came
    // out of the router's generic wrapper as "Command failed: …", while the `!rec`
    // path right below already produces a friendly, actionable line.
    { name: '/direct reports a run that finished under it, without a raw command failure', run: async () => {
      const { send, calls } = fixture({
        direct: async () => { const e = new Error('run is finished; a direction would never be read'); e.code = 'RUN_FINISHED'; throw e; },
      });
      const out = await send('/direct cut the roadmap slide');
      assert.equal(out.severity, 'warning', JSON.stringify(out));
      assert.doesNotMatch(JSON.stringify(out.body), /Command failed/, 'not the generic wrapper');
      assert.match(JSON.stringify(out.body), /finished/, JSON.stringify(out.body));
      assert.deepEqual(calls, []);
    } },
    { name: '/direct reports a run that is gone the same way', run: async () => {
      const { send } = fixture({ direct: async () => { throw new Error('unknown runId'); } });
      const out = await send('/direct cut the roadmap slide');
      assert.equal(out.severity, 'warning', JSON.stringify(out));
      assert.doesNotMatch(JSON.stringify(out.body), /Command failed/);
    } },
  ]);
});

// `hasRef` tested the token against scopedRuns() — only runs in the ACTIVE
// PROJECT scope that are still in the server's in-memory Map. A ref naming a real
// run outside that set therefore looked like prose, and the command fell through
// to the no-ref path: filed against whichever run happened to be live, with the
// literal `*a1b2c3d4` still in the text the next agent reads. Two reachable ways
// in: `/use projA` while reffing a run in projB, and any run from before the last
// server restart (the Map is empty after one; History is not).
test('/direct refuses a ref naming a run outside the active project scope', async () => {
  const { send, calls, state } = fixture();
  await send('/use worca');                          // the scope has to actually be SET
  state.rows = [{ id: 'pipe-cccc3333', title: 'other project', status: 'running', projectDir: '/x/other' }];
  const out = await send('/direct *cccc3333 cut the roadmap slide');
  assert.equal(out.severity, 'warning', JSON.stringify(out));
  assert.deepEqual(calls, [], 'nothing is filed against the in-scope run');
});

// With NO scope set, chat sees every project — so a ref to a run in another one is
// a run the user named, and targeting it is right. What must never happen is the
// silent retarget: filing against whichever run happens to be live instead.
test('/direct with no scope set reaches the run the ref names, wherever it lives', async () => {
  const { send, calls, state } = fixture();
  state.rows = [{ id: 'pipe-cccc3333', title: 'other project', status: 'running', projectDir: '/x/other' }];
  const out = await send('/direct *cccc3333 cut the roadmap slide');
  assert.equal(out.severity, 'success', JSON.stringify(out));
  assert.deepEqual(calls, [['direct', 'pipe-cccc3333', 'cut the roadmap slide']],
    'the run that was named, not the one that happened to be live');
});

test('/direct length: 4200 chars refused naming 4000, 3900 accepted', async () => {
  await checkRows([
    // appendDirection silently `.slice(0, DIRECTION_MAX_CHARS)`s, and the HTTP twin
    // 400s anything longer rather than let that happen quietly. Chat checked nothing
    // and then reported success — so a pasted 6 KB direction was confirmed as
    // "recorded" while the agent received a sentence cut off mid-word. The two
    // surfaces are the ones DIRECTIONS_CLOSED was extracted to keep in agreement.
    { name: '/direct refuses an over-long direction instead of silently truncating it', run: async () => {
      const { send, calls } = fixture();
      const out = await send(`/direct ${'x'.repeat(4200)}`);
      assert.equal(out.severity, 'warning', JSON.stringify(out).slice(0, 200));
      assert.match(JSON.stringify(out.body), /4000/, 'and says what the limit is');
      assert.deepEqual(calls, [], 'nothing truncated was filed');
    } },
    { name: '/direct still accepts a direction at the limit', run: async () => {
      const { send, calls } = fixture();
      const out = await send(`/direct ${'x'.repeat(3900)}`);
      assert.equal(out.severity, 'success', JSON.stringify(out).slice(0, 200));
      assert.equal(calls.length, 1);
    } },
  ]);
});

// History is a 500-row listAllPipelines. It is read only when it can change the
// answer — to tell a ref from prose, or when nothing in the Map is directable —
// never on the common `/direct <text>` with a run live. The comment claimed this
// while the fetch ran unconditionally, so the guard bought nothing.
test('/direct reads History only when it can change the answer', async () => {
  let queries = 0;
  // (a) ref-less, with a live run: no History at all.
  let f = fixture({ history: async () => { queries += 1; return []; } });
  await f.send('/direct cut the roadmap slide');
  assert.equal(queries, 0, 'the common form reads no History');

  // (b) a ref-shaped token: History decides ref-vs-prose.
  queries = 0;
  f = fixture({ history: async () => { queries += 1; return []; } });
  await f.send('/direct *a1b2c3d4 cut the roadmap slide');
  assert.equal(queries, 1, 'a ref is resolved against History');

  // (c) ref-less with NOTHING live: the paused run may only exist in the DB.
  queries = 0;
  f = fixture({ history: async () => { queries += 1; return []; } });
  f.state.live = [];
  await f.send('/direct cut the roadmap slide');
  assert.equal(queries, 1, 'with no live candidate it still looks');
});
