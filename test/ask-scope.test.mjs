// test/ask-scope.test.mjs — P4 chat scope (CONTRACT §4): the pure rules in src/core/ask/scope.mjs.
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import {
  chatScopeOf, withChatScope, sameScope, scopeBody, scopeRefusalText, targetInScope, scopeCardKeys,
  validateScopeSwitch, scopeEventPrompt, scopeNoticeText,
} from '../src/core/ask/scope.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { createThread, updateThread, appendMessage } from '../src/core/ask/store.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { buildRestoredPrompt } from '../src/core/ask/prompt.mjs';
import { addProject, displayPath } from '../src/core/projects.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

useTempHome(after);

const A = { key: 'havn-android-0000aaaa', name: 'Havn Android', path: '/p/havn-android', exists: true, vcs: 'git' };
const I = { key: 'havn-ios-0000bbbb', name: 'Havn IOS', path: '/p/Havn', exists: true };            // vcs NULL reads as git (CONTRACT §1)
const T = { key: 'tax-papers-0000cccc', name: 'Tax papers 2026', path: '/p/tax', exists: true, vcs: 'none' };
const G = { key: 'gone-0000dddd', name: 'Gone', path: '/p/gone', exists: false, vcs: 'git' };
const WS = 'wks-havn-0000abcd';
const cardRow = (keys) => ({ role: 'assistant', blocks: [{ kind: 'card', id: 'card_0000ab01', state: 'answered', card: { type: 'scope-switch', candidates: keys.map((projectKey) => ({ projectKey })) } }] });
const ROOM = 'The room photo on the booking screen is tiny on tablets.\nMake it "bigger".';

test('chatScopeOf / withChatScope / sameScope / scopeBody: pinned true = its key, false = No project, absent = the key the context names; projectDir never names a scope', async () => {
  await checkRows([
    { name: 'chatScopeOf', run: () => {
      assert.deepEqual(chatScopeOf({ pinned: true, projectKey: A.key, workspaceId: WS }), { projectKey: A.key });
      assert.deepEqual(chatScopeOf({ pinned: true, workspaceId: WS }), { workspaceId: WS });
      assert.equal(chatScopeOf({ pinned: true }), null);
      assert.equal(chatScopeOf({ pinned: false, projectKey: A.key, workspaceId: WS }), null, 'No project: page targets never count');
      assert.deepEqual(chatScopeOf({ projectKey: A.key }), { projectKey: A.key }, 'a context without `pinned` names its scope by key');
      assert.deepEqual(chatScopeOf({ workspaceId: WS }), { workspaceId: WS });
      assert.equal(chatScopeOf({ projectDir: '/p/havn-android' }), null, 'a projectDir alone is page data, never a scope');
      for (const v of [null, undefined, 'x', [], 7]) assert.equal(chatScopeOf(v), null);
    } },
    { name: 'withChatScope keeps the run context, drops every target, sets pinned + one key', run: () => {
      const page = { view: 'chat', runId: '0f6e5d4c-1b2a-4c3d-8e9f-0a1b2c3d4e5f', pipelineId: '4e1f2a9b', diffPath: 'a.js', runPage: 'diff',
        timeZone: 'Europe/Berlin', projectDir: '/p/x', projectKey: I.key, workspaceId: WS, projectSource: 'fallback', pinned: false };
      const kept = { view: 'chat', runId: page.runId, pipelineId: '4e1f2a9b', diffPath: 'a.js', runPage: 'diff', timeZone: 'Europe/Berlin' };
      assert.deepEqual(withChatScope(page, null), { ...kept, pinned: false });
      assert.deepEqual(withChatScope(page, { projectKey: A.key }), { ...kept, pinned: true, projectKey: A.key });
      assert.deepEqual(withChatScope(null, { workspaceId: WS }), { pinned: true, workspaceId: WS });
    } },
    { name: 'sameScope / scopeBody', run: () => {
      assert.equal(sameScope(null, null), true);
      assert.equal(sameScope({ projectKey: A.key }, { projectKey: A.key }), true);
      assert.equal(sameScope({ projectKey: A.key }, null), false);
      assert.equal(sameScope({ projectKey: A.key }, { workspaceId: WS }), false);
      assert.deepEqual([scopeBody(null), scopeBody({ projectKey: A.key }), scopeBody({ workspaceId: WS })],
        [{ pinned: false }, { pinned: true, projectKey: A.key }, { pinned: true, workspaceId: WS }]);
    } },
  ]);
});

test('scopeRefusalText: the one refusal, exactly; targetInScope: the scope, or a member of a workspace scope', () => {
  assert.equal(scopeRefusalText(null, { projectKey: A.key }),
    "this chat's scope is No project and project tools act only on it — project havn-android-0000aaaa is outside it. Another project or workspace means the user changes the chat's scope pill; when you are fairly certain which project the message is about, call propose_scope_switch");
  assert.equal(scopeRefusalText({ projectKey: A.key }, { workspaceId: WS }),
    "this chat's scope is project havn-android-0000aaaa and project tools act only on it — workspace wks-havn-0000abcd is outside it. Another project or workspace means the user changes the chat's scope pill");
  assert.equal(scopeRefusalText(null),
    "this chat has No project, so there is no project to act on. The user picks one in the chat's scope pill; when you are fairly certain which project the message is about, call propose_scope_switch");
  assert.equal(targetInScope({ projectKey: A.key }, { projectKey: A.key }), true);
  assert.equal(targetInScope({ projectKey: A.key }, { projectKey: I.key }), false);
  assert.equal(targetInScope({ projectKey: A.key }, { workspaceId: WS }), false);
  assert.equal(targetInScope({ workspaceId: WS }, { workspaceId: WS }), true);
  assert.equal(targetInScope({ workspaceId: WS }, { projectKey: I.key }, [A.key, I.key]), true, 'a member of the chat workspace');
  assert.equal(targetInScope({ workspaceId: WS }, { projectKey: T.key }, [A.key, I.key]), false);
  assert.equal(targetInScope(null, { projectKey: A.key }), false, 'No project acts on no project');
  assert.equal(targetInScope(null, null), true, 'nothing named is never out of scope');
});

test('validateScopeSwitch: No project only, 1–3 known projects, never one this chat already had a card about', () => {
  const ctx = { projects: [A, I, T, G], asked: [] };
  assert.deepEqual(validateScopeSwitch({ candidates: [A.key, I.key, A.key], reason: '  Both Havn apps\nhave a booking screen. ' }, ctx), { ok: true, card: {
    type: 'scope-switch', reason: 'Both Havn apps have a booking screen.', summary: 'Havn Android / Havn IOS',
    candidates: [{ projectKey: A.key, name: 'Havn Android', path: '/p/havn-android', vcs: 'git' }, { projectKey: I.key, name: 'Havn IOS', path: '/p/Havn', vcs: 'git' }] } });
  assert.equal(validateScopeSwitch({ candidates: [T.key], reason: 'r' }, ctx).card.candidates[0].vcs, 'none', 'a Folder project keeps its kind');
  assert.equal(validateScopeSwitch({ candidates: [T.key], reason: 'r' }, { ...ctx, projects: [{ ...T, displayPath: '~/tax' }] }).card.candidates[0].displayPath, '~/tax',
    'S22: a row\'s displayPath rides along when the registry has one (absent otherwise)');
  assert.deepEqual(validateScopeSwitch({ candidates: [A.key], reason: 'r' }, { ...ctx, scope: { projectKey: I.key } }),
    { ok: false, errors: ['this chat already has a scope — never ask to switch it; the user changes it in the scope pill'] }, 'D6');
  const COUNT = 'candidates must list 1 to 3 project keys (2–3 only when it is genuinely one of those)';
  assert.deepEqual(validateScopeSwitch({ candidates: [], reason: 'r' }, ctx).errors, [COUNT]);
  assert.equal(validateScopeSwitch({ candidates: [A.key, I.key, T.key, 'x-00000000'], reason: 'r' }, ctx).errors[0], COUNT);
  const REASON = 'reason is required: one line of at most 200 characters';
  assert.deepEqual(validateScopeSwitch({ candidates: [A.key] }, ctx).errors, [REASON]);
  assert.deepEqual(validateScopeSwitch({ candidates: [A.key], reason: 'x'.repeat(201) }, ctx).errors, [REASON]);
  assert.deepEqual(validateScopeSwitch({ candidates: ['nope-00000000'], reason: 'r' }, ctx).errors, ['unknown projectKey "nope-00000000" — use list_projects']);
  assert.deepEqual(validateScopeSwitch({ candidates: [G.key], reason: 'r' }, ctx).errors, ['project gone-0000dddd is missing on disk — do not offer it']);
  assert.deepEqual(validateScopeSwitch({ candidates: [I.key, A.key], reason: 'r' }, { ...ctx, asked: scopeCardKeys([cardRow([A.key])]) }).errors,
    ['this chat already had a card about havn-android-0000aaaa — continue in No project and never ask about it again here']);
  assert.equal(validateScopeSwitch('x', ctx).ok, false);
  assert.deepEqual(scopeCardKeys([{ role: 'user', text: 'x' }, cardRow([A.key, I.key]),
    { role: 'assistant', blocks: [{ kind: 'card', card: { type: 'web' } }, { kind: 'notice', text: 'n' }] }, cardRow([A.key])]), [A.key, I.key], 'every state counts, each key once');
  assert.deepEqual(scopeCardKeys(null), []);
});

test('scopeEventPrompt / scopeNoticeText: the event lines that continue the user\'s message', () => {
  assert.equal(scopeEventPrompt({ cardId: 'card_0000ab01', state: 'switched', projectKey: A.key, name: 'Havn Android', userText: ROOM }),
    '[worca event] scope card card_0000ab01 switched: this chat\'s scope is now project havn-android-0000aaaa "Havn Android" (the context block\'s project: line). Continue the user\'s message that led to the card — it begins "The room photo on the booking screen is tiny on tablets. Make it \'bigger\'." — now, in that project; do not ask which project again.');
  assert.equal(scopeEventPrompt({ cardId: 'card_0000ab01', state: 'declined', keys: [A.key, I.key], userText: ROOM }),
    '[worca event] scope card card_0000ab01 declined: the chat stays in No project. Continue the user\'s message that led to the card — it begins "The room photo on the booking screen is tiny on tablets. Make it \'bigger\'." — now, without a project, and never ask about havn-android-0000aaaa, havn-ios-0000bbbb again in this chat.');
  assert.ok(scopeEventPrompt({ cardId: 'card_0000ab01', state: 'switched', projectKey: A.key, name: 'Havn Android' }).includes('led to the card now, in that project'), 'no quote without a user row');
  assert.ok(scopeEventPrompt({ cardId: 'c', state: 'switched', projectKey: A.key, name: 'N', userText: 'y'.repeat(400) }).includes(`"${'y'.repeat(160)}…"`), 'the quote is clipped at 160');
  assert.equal(scopeNoticeText({ state: 'switched', name: 'Havn Android' }), 'Switched to Havn Android');
  assert.equal(scopeNoticeText({ state: 'declined' }), 'Continued without project');
});

test('the real tool deps: pinnedScope is the chat scope of the stored row (no reader failure is ever a scope)', async () => {
  const t = createThread();
  const scope = () => defaultToolDeps({ threadId: t.id }).pinnedScope();
  updateThread(t.id, { context: { pinned: true, projectKey: A.key } });
  assert.deepEqual(scope(), { projectKey: A.key });
  updateThread(t.id, { context: { projectKey: A.key } });
  assert.deepEqual(scope(), { projectKey: A.key }, 'a stored context without `pinned` names its scope by key');
  updateThread(t.id, { context: { pinned: false, projectKey: A.key, projectDir: '/p/x' } });
  assert.equal(scope(), null, 'No project');
  assert.equal(defaultToolDeps({ threadId: null }).pinnedScope(), null);
});

test('the restored prompt replays the divider as a System line (CONTRACT §4)', () => {
  const p = buildRestoredPrompt([
    { role: 'user', text: 'The room photo is tiny on tablets.' },
    { role: 'system', text: 'Switched to Havn Android', blocks: [{ kind: 'divider', text: 'Switched to Havn Android', scope: { pinned: true, projectKey: A.key } }] },
  ], 'NEXT');
  assert.ok(p.includes('User: The room photo is tiny on tablets.\n\nSystem: Switched to Havn Android'), p);
});

test('propose_scope_switch: listed only with its bundle and never in the Workflows chat; the handler hands the input to the bundle; the description repeats every gate', async () => {
  const seen = [];
  const bundle = { validate: async (i) => { seen.push(i); return { ok: true, card: { type: 'scope-switch' } }; } };
  const t = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, scopeSwitch: bundle });
  const def = t.list().find((d) => d.name === 'propose_scope_switch');
  assert.deepEqual(Object.keys(def.inputSchema.properties).sort(), ['candidates', 'reason']);
  assert.deepEqual(def.inputSchema.required, ['candidates', 'reason']);
  for (const gate of ['No project', 'fairly certain', 'general question', 'hunch', '2–3', 'at most one card per project per chat',
    'Continue without project', 'END YOUR TURN', 'already has a project or workspace']) assert.ok(def.description.includes(gate), gate);
  assert.deepEqual(await t.call('propose_scope_switch', { candidates: [A.key], reason: 'r' }), { ok: true, card: { type: 'scope-switch' } });
  assert.deepEqual(seen, [{ candidates: [A.key], reason: 'r' }]);
  assert.ok(!createAskTools({ limits: ASK_LIMITS, redact: (s) => s }).list().some((d) => d.name === 'propose_scope_switch'), 'a bundle-less list is unchanged');
  const comp = createAskTools({ limits: ASK_LIMITS, redact: (s) => s, scopeSwitch: bundle, askMode: 'composer', composer: {} });
  assert.ok(!comp.list().some((d) => d.name === 'propose_scope_switch'));
  await assert.rejects(comp.call('propose_scope_switch', { candidates: [A.key], reason: 'r' }), /propose_scope_switch: not available in the Workflows chat/);
});

test('the real tool deps: scopeSwitch.validate reads the stored scope, the registry and the thread\'s earlier scope cards', async () => {
  const projDir = mkdtempSync(join(tmpdir(), 'worca-ask-scope-proj-'));
  after(() => rmSync(projDir, { recursive: true, force: true }));
  const p = (await addProject({ name: 'scopedemo', path: projDir })).find((x) => x.name === 'scopedemo');
  const t = createThread();
  const ok = await defaultToolDeps({ threadId: t.id }).scopeSwitch.validate({ candidates: [p.key], reason: 'You named scopedemo.' });
  assert.equal(ok.ok, true);
  assert.equal(ok.card.candidates[0].displayPath, displayPath(p.path), 'S22/S45: the card carries the display path');
  assert.deepEqual(ok.card.candidates.map((c) => [c.projectKey, c.name]), [[p.key, 'scopedemo']]);
  appendMessage(t.id, { role: 'assistant', text: '', blocks: [{ kind: 'card', id: 'card_0000ab01', state: 'answered', card: { ...ok.card, choice: 'none' } }] });
  assert.match((await defaultToolDeps({ threadId: t.id }).scopeSwitch.validate({ candidates: [p.key], reason: 'again' })).errors[0], /already had a card about/);
  const pinned = createThread();
  updateThread(pinned.id, { context: { pinned: true, projectKey: p.key } });
  assert.match((await defaultToolDeps({ threadId: pinned.id }).scopeSwitch.validate({ candidates: [p.key], reason: 'r' })).errors[0], /already has a scope/);
});
