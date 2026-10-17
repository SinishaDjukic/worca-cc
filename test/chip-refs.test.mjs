// test/chip-refs.test.mjs — src/shared/chip-refs.mjs: which links and which text in a Chat answer name a GitHub pull
// request or issue, an Azure DevOps pull request or work item, a worca run or a chat, and the key the browser sends to
// POST /api/ask/refs/resolve (parseRefKey, the server's half). Pure: no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { refFromHref, refsInText, parseRefKey } from '../src/shared/chip-refs.mjs';

const PR = 'https://github.com/SinishaDjukic/worca-cc/pull/777';
const UUID = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';

test('chip refs: links, text and keys (src/shared/chip-refs.mjs)', async () => {
  await checkRows([
    { name: 'GitHub PR and issue URLs, with tails; never another host or a zero', run: () => {
      assert.equal(refFromHref(PR).key, 'gh:SinishaDjukic/worca-cc#777');
      assert.equal(refFromHref(`${PR}/files`).type, 'pr');
      assert.equal(refFromHref('https://github.com/o/r/issues/12#issuecomment-1').type, 'issue');
      for (const h of ['https://github.com/o/r/pull/0', 'https://gist.github.com/o/r/pull/3', 'https://github.com/o/r/discussions/3', 'mailto:a@b.c']) assert.equal(refFromHref(h), null, h);
    } },
    { name: 'Azure DevOps PRs (every host spelling) and work items; another host is no ref', run: () => {
      const pr = refFromHref('https://acme.visualstudio.com/DefaultCollection/My%20Shop/_git/api/pullrequest/7?_a=files');
      assert.deepEqual([pr.key, pr.label], ['adopr:acme/My%20Shop#7', 'api!7']);
      assert.deepEqual([refFromHref('https://dev.azure.com/acme/Shop/_workitems/edit/123').key, refFromHref('https://dev.azure.com/acme/Shop/_workitems/edit/123').label], ['adowi:acme#123', 'AB#123']);
      assert.equal(refFromHref('https://acme.visualstudio.com/_workitems/edit/9').key, 'adowi:acme#9');
      assert.equal(refFromHref('https://evil.example/acme/Shop/_workitems/edit/9'), null);
      assert.equal(refFromHref('https://dev.azure.com/acme/Shop/Extra/_workitems/edit/9'), null, 'org, then at most a project');
    } },
    { name: 'worca routes: #history (project or workspace, tab tails), #running/<uuid>, #chat/<id> only', run: () => {
      assert.equal(refFromHref('#history/worca-cc-ace1a602/1a2b3c4d/details/diff').key, 'run:1a2b3c4d');
      assert.equal(refFromHref('#history/workspaces/wks-a-1234abcd/1a2b3c4d').key, 'run:1a2b3c4d');
      assert.equal(refFromHref(`#running/${UUID}`).key, `run:${UUID}`);
      assert.equal(refFromHref('#chat/ask_1a2b3c4d').key, 'chat:ask_1a2b3c4d');
      for (const h of ['#history/p/1', '#running/abc-123', '#chat/ask_1a2b3c4d/run/aaaa1111', '#projects/x', '#history/k-1234abcd/1a2b3c4d/raw',
        `#running/${UUID}/details/diff/extra`]) assert.equal(refFromHref(h), null, h);
    } },
    { name: 'text: owner/repo#N, ask_ ids, and 8-hex run CANDIDATES — never inside a sha, a path, a file name or another id', run: () => {
      const keys = (t) => refsInText(t).map((x) => [x.ref.key, !!x.ref.candidate]);
      assert.deepEqual(keys('see SinishaDjukic/worca-cc#777, run 5c40dcc6 and ask_1a2b3c4d.'),
        [['gh:SinishaDjukic/worca-cc#777', false], ['run:5c40dcc6', true], ['chat:ask_1a2b3c4d', false]]);
      assert.deepEqual(keys('sha 527edc25f69c, file abcd1234.json, x/abcd1234, #history/k/abcd1234, ask_1a2b3c4d5, PR #777, AB#123, a/b#0'), []);
    } },
    { name: 'parseRefKey: only what the browser mints; encoded org/project decoded and checked', run: () => {
      assert.deepEqual(parseRefKey('adopr:acme/My%20Shop#7'), { kind: 'adopr', key: 'adopr:acme/My%20Shop#7', org: 'acme', project: 'My Shop', number: 7 });
      for (const k of ['gh:o/r#0', 'adopr:acme/a%2Fb#1', 'adopr:acme/a%0Ab#1', 'adopr:acme/a%7Fb#1', 'adowi:ac%20me#1', 'run:XYZ', 'chat:askm_1a2b3c4d', 'x:1', 42, `gh:o/${'r'.repeat(400)}#1`]) assert.equal(parseRefKey(k), null, String(k).slice(0, 40));
    } },
  ]);
});
