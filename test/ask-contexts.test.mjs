import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextEntries, mergeContexts, mentionedRefs, MAX_CONTEXTS } from '../src/core/ask/contexts.mjs';
import { checkRows } from './helpers/rows.mjs';

test('contextEntries: resolved chips (pin marked, page named, untitled run by id, long names clipped); unresolved/list views/homeless runs give none', async () => {
  await checkRows([
    { name: 'contextEntries: resolved project/run/workspace + named page, pin marked', run: async () => {
      const ctx = { view: 'settings', pinned: true, workspaceId: 'wks-havn-0000abcd', pipelineId: '1a2b3c4d' };
      const header = {
        view: 'settings', pinned: true,
        project: { name: 'worca-cc', key: 'worca-cc-ace1a602' },
        workspace: { name: 'havn', id: 'wks-havn-0000abcd', members: [] },
        run: { id: '1a2b3c4d', title: 'Fix login', status: 'done', startedAt: '', branch: null, home: 'worca-cc-ace1a602' },
      };
      assert.deepEqual(contextEntries(ctx, header), [
        { kind: 'project', id: 'worca-cc-ace1a602', label: 'worca-cc' },
        { kind: 'workspace', id: 'wks-havn-0000abcd', label: 'havn', pinned: true },
        { kind: 'run', id: '1a2b3c4d', label: 'Fix login', home: 'worca-cc-ace1a602' },
        { kind: 'page', id: 'settings', label: 'Settings' },
      ]);
    } },
    { name: 'contextEntries: the four Add-ons pages earn a page chip named like their sidebar row', run: () => {
      for (const [view, label] of [['marketplace', 'Marketplace'], ['connectors', 'Connectors'], ['models', 'Models'], ['providers', 'Providers']]) {
        assert.deepEqual(contextEntries({ view }, { view }), [{ kind: 'page', id: view, label }]);
      }
    } },
    { name: 'contextEntries: unresolved ids, list views and a run with no home produce no chip', run: async () => {
      await checkRows([
        { name: 'contextEntries: unresolved ids and list views produce nothing', run: () => {
          assert.deepEqual(contextEntries({ view: 'history', projectKey: 'gone-00000001' }, { view: 'history' }), []);
          assert.deepEqual(contextEntries({}, {}), []);
          assert.deepEqual(contextEntries(undefined, undefined), []);
        } },
        { name: 'contextEntries: a run with no home (a live run before its pipeline id) earns no chip', run: () => {
          // its header id is a run-id prefix, not the pipeline id a later turn resolves: a chip would duplicate
          assert.deepEqual(contextEntries({}, { run: { id: 'deadbeef', title: 'Live', home: null } }), []);
          assert.deepEqual(contextEntries({}, { run: { id: 'deadbeef', title: 'Live' } }), []);
        } },
      ]);
    } },
    { name: 'contextEntries: untitled run labels with its id; long names are clipped', run: async () => {
      const [run] = contextEntries({}, { run: { id: '1a2b3c4d', title: '', home: 'p-00000001' } });
      assert.deepEqual(run, { kind: 'run', id: '1a2b3c4d', label: '1a2b3c4d', home: 'p-00000001' });
      const [p] = contextEntries({}, { project: { name: 'x'.repeat(200), key: 'p-00000001' } });
      assert.equal(p.label.length, 80);
    } },
  ]);
});

test('mergeContexts rules: origin first, dedupe, label refresh (never to an id-only fallback), sticky pin, page beats chat', async () => {
  await checkRows([
    { name: 'mergeContexts: origin first, dedupe by kind:id, label refresh, sticky pin', run: async () => {
      const a = { kind: 'project', id: 'p-00000001', label: 'Old' };
      const b = { kind: 'page', id: 'settings', label: 'Settings' };
      let m = mergeContexts(null, [a]);
      m = mergeContexts(m, [b, { ...a, label: 'New', pinned: true }]);
      m = mergeContexts(m, [{ kind: 'project', id: 'p-00000001', label: 'New' }]);   // later unpinned sighting
      assert.deepEqual(m, [
        { kind: 'project', id: 'p-00000001', label: 'New', pinned: true },
        { kind: 'page', id: 'settings', label: 'Settings' },
      ]);
      assert.deepEqual(mergeContexts('garbage', []), [], 'a corrupt stored value degrades to empty');
    } },
    { name: 'mergeContexts: an id-only fallback label never replaces a real one', run: async () => {
      const named = { kind: 'run', id: '1a2b3c4d', label: 'Fix login', home: 'p-00000001' };
      let m = mergeContexts([], [named]);
      m = mergeContexts(m, [{ ...named, label: '1a2b3c4d' }]);           // a later turn saw no title
      assert.equal(m[0].label, 'Fix login');
      m = mergeContexts(m, [{ ...named, label: 'Fix login v2' }]);        // a real rename still lands
      assert.equal(m[0].label, 'Fix login v2');
    } },
    { name: 'mergeContexts: a page sighting wins over a chat one, both ways', run: async () => {
      const page = { kind: 'run', id: '1a2b3c4d', label: 'Fix login', home: 'p-00000001' };
      const chat = { ...page, source: 'chat' };
      assert.deepEqual(mergeContexts([chat], [page]), [page], 'a chat chip seen from the page becomes a page chip');
      assert.deepEqual(mergeContexts([page], [chat]), [page], 'a page chip mentioned in the chat stays a page chip');
      assert.deepEqual(mergeContexts([], [chat]), [chat], 'a new chat chip keeps its source');
      assert.deepEqual(mergeContexts([chat], [{ ...chat, label: 'Fix login v2' }]), [{ ...chat, label: 'Fix login v2' }]);
    } },
  ]);
});

test('mergeContexts over the cap: origin + newest kept; chat chips evicted first (oldest first), page chips and the pin survive', async () => {
  await checkRows([
    { name: 'mergeContexts: cap keeps the origin plus the most recent', run: () => {
      const many = Array.from({ length: MAX_CONTEXTS + 5 }, (_, i) => ({ kind: 'run', id: i.toString(16).padStart(8, '0'), label: `r${i}`, home: null }));
      const m = mergeContexts([], many);
      assert.equal(m.length, MAX_CONTEXTS);
      assert.equal(m[0].label, 'r0', 'origin kept');
      assert.equal(m.at(-1).label, `r${MAX_CONTEXTS + 4}`, 'newest kept');
    } },
    { name: 'mergeContexts: over the cap, chat chips go first (oldest first), page chips and the pin survive', run: () => {
      const page = [
        { kind: 'page', id: 'settings', label: 'Settings' },
        { kind: 'workspace', id: 'wks-havn-0000abcd', label: 'havn', pinned: true },
        { kind: 'project', id: 'p-00000001', label: 'p' },
      ];
      const chat = (i) => ({ kind: 'run', id: i.toString(16).padStart(8, '0'), label: `r${i}`, home: 'p-00000001', source: 'chat' });
      const m = mergeContexts(page, Array.from({ length: 25 }, (_, i) => chat(i)));
      assert.equal(m.length, MAX_CONTEXTS);
      assert.deepEqual(m.slice(0, 3), page, 'every page chip kept, in place');
      assert.deepEqual(m.slice(3).map((c) => c.label), Array.from({ length: MAX_CONTEXTS - 3 }, (_, i) => `r${i + 25 - (MAX_CONTEXTS - 3)}`), 'the newest chat chips');
      const more = mergeContexts(m, [{ kind: 'page', id: 'team-policy', label: 'Team policy' }]);
      assert.equal(more.length, MAX_CONTEXTS);
      assert.equal(more.at(-1).id, 'team-policy', 'a new page chip evicts a chat chip');
      assert.equal(more.filter((c) => !c.source).length, 4);
    } },
  ]);
});

// ── conversation chips: what the answer linked to and what the main conversation's worca tools touched ──

const tool = (name, input, over = {}) => ({ kind: 'tool', id: `toolu_${name}`, name: `mcp__worca__${name}`, input, status: 'done', ...over });

test('mentionedRefs: links in the answer, run ids from the run tools, projectKey/workspaceId on any worca tool (truncated/foreign ignored)', async () => {
  await checkRows([
    { name: 'mentionedRefs: run, workspace-run, live-run, project and workspace links in the answer', run: async () => {
      const text = [
        'Last run: [Fix login](#history/worca-cc-ace1a602/1a2b3c4d).',
        'Its diff: #history/worca-cc-ace1a602/2b3c4d5e/details/diff, and the workspace run',
        '[here](#history/workspaces/wks-havn-0000abcd/3c4d5e6f/details/logs).',
        'Live: #running/0f8fad5b-d9cb-469f-a165-70867728950e/details/agents, project #projects/havn-api-0000beef,',
        'workspace #workspaces/wks-havn-0000abcd.',
      ].join('\n');
      assert.deepEqual(mentionedRefs({ text, blocks: [] }), [
        { kind: 'run', id: '1a2b3c4d', projectKey: 'worca-cc-ace1a602' },
        { kind: 'run', id: '2b3c4d5e', projectKey: 'worca-cc-ace1a602' },
        { kind: 'run', id: '3c4d5e6f', workspaceId: 'wks-havn-0000abcd' },
        { kind: 'liveRun', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
        { kind: 'project', id: 'havn-api-0000beef' },
        { kind: 'workspace', id: 'wks-havn-0000abcd' },
      ]);
    } },
    { name: 'mentionedRefs: run ids from get_run / get_run_diff / track_run with their scope', run: async () => {
      const blocks = [
        tool('get_run', { id: '1a2b3c4d', projectKey: 'worca-cc-ace1a602' }),
        tool('get_run_diff', { id: '3c4d5e6f', workspaceId: 'wks-havn-0000abcd', offset: 0 }),
        tool('track_run', { id: '0f8fad5b-d9cb-469f-a165-70867728950e' }),
        tool('track_run', { id: '4d5e6f70' }),
      ];
      assert.deepEqual(mentionedRefs({ text: '', blocks }), [
        { kind: 'run', id: '1a2b3c4d', projectKey: 'worca-cc-ace1a602' },
        { kind: 'project', id: 'worca-cc-ace1a602' },
        { kind: 'run', id: '3c4d5e6f', workspaceId: 'wks-havn-0000abcd' },
        { kind: 'workspace', id: 'wks-havn-0000abcd' },
        { kind: 'liveRun', id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
        { kind: 'run', id: '4d5e6f70' },
      ]);
    } },
    { name: 'mentionedRefs: projectKey / workspaceId on any worca tool; truncated and foreign inputs ignored', run: async () => {
      const blocks = [
        tool('list_runs', { projectKey: 'worca-cc-ace1a602', status: 'done' }),
        tool('list_people', { workspaceId: 'wks-havn-0000abcd' }),
        tool('propose_run', { _truncated: true, preview: '{"projectKey":"secret-00000001"' }),
        { kind: 'tool', id: 'toolu_x', name: 'WebFetch', input: { projectKey: 'not-worca-00000002' } },
        { kind: 'agent', id: 'toolu_a', label: 'Explore', log: ['→ get_run {"id":"5e6f7081"}'] },
        { kind: 'card', id: 'card_1', card: { projectKey: 'card-only-00000003' } },
        tool('get_run', { id: 42, projectKey: '' }),
      ];
      assert.deepEqual(mentionedRefs({ text: '', blocks }), [
        { kind: 'project', id: 'worca-cc-ace1a602' },
        { kind: 'workspace', id: 'wks-havn-0000abcd' },
      ]);
    } },
  ]);
});

test('mentionedRefs: other hashes and half links ignored, repeats collapse, at most MAX_CONTEXTS refs', async () => {
  await checkRows([
    { name: 'mentionedRefs: other hashes and half links are ignored; repeats collapse', run: () => {
      const text = 'See #settings, #history, #history/worca-cc-ace1a602, #running, #team-policy, #projects/, '
        + 'a#history/x/y, #history/worca-cc-ace1a602/1a2b3c4d twice: #history/worca-cc-ace1a602/1a2b3c4d';
      assert.deepEqual(mentionedRefs({ text, blocks: [] }), [{ kind: 'run', id: '1a2b3c4d', projectKey: 'worca-cc-ace1a602' }]);
      assert.deepEqual(mentionedRefs({}), []);
      assert.deepEqual(mentionedRefs(null), []);
    } },
    { name: 'mentionedRefs: at most MAX_CONTEXTS refs, the first ones (the server resolves each before ask-done)', run: () => {
      const text = Array.from({ length: 30 }, (_, i) => `#history/p-00000001/${i.toString(16).padStart(8, '0')}`).join(' ');
      const refs = mentionedRefs({ text, blocks: [] });
      assert.equal(refs.length, MAX_CONTEXTS);
      assert.equal(refs[0].id, '00000000');
    } },
  ]);
});
