// test/ask-scope-links.test.mjs — a No-project chat's scope from a pasted issue / PR link: the link parser
// (forge.mjs linkTargetOf) and the pure matcher (src/core/ask/scope-links.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkTargetOf, parseGithubIssueUrl } from '../src/core/forge.mjs';
import { SCOPE_LINKS_MAX, autoScopeKeys, matchScopeFromLinks, messageLinkTargets } from '../src/core/ask/scope-links.mjs';

const repo = (host, owner, r) => ({ kind: 'repo', host, owner, repo: r });

test('linkTargetOf: GitHub issue / PR with /files and #comment tails, Azure PR, Azure work item (azure-project), Bitbucket PR / issue; GitLab, a repo home page, an owner with @ → null', () => {
  const gh = repo('github.com', 'Acme', 'Shop');
  assert.deepEqual(linkTargetOf('https://github.com/Acme/Shop/issues/12'), gh);
  assert.deepEqual(linkTargetOf('https://github.com/Acme/Shop/issues/12#issuecomment-99'), gh);
  assert.deepEqual(linkTargetOf('https://www.github.com/Acme/Shop/pull/3'), gh);
  assert.deepEqual(linkTargetOf('https://github.com/Acme/Shop/pull/3/files'), gh);
  assert.deepEqual(linkTargetOf('https://GitHub.com/Acme/Shop/pull/3?diff=split'), gh);
  assert.deepEqual(linkTargetOf('https://dev.azure.com/acme/Shop/_git/api/pullrequest/9'), repo('dev.azure.com', 'acme/Shop', 'api'));
  assert.deepEqual(linkTargetOf('https://acme.visualstudio.com/Shop/_git/api/pullrequest/9'), repo('dev.azure.com', 'acme/Shop', 'api'));
  assert.deepEqual(linkTargetOf('https://dev.azure.com/acme/Shop/_workitems/edit/77'),
    { kind: 'azure-project', host: 'dev.azure.com', org: 'acme', project: 'Shop' });
  assert.deepEqual(linkTargetOf('https://bitbucket.org/acme/api/pull-requests/4/diff'), repo('bitbucket.org', 'acme', 'api'));
  assert.deepEqual(linkTargetOf('https://bitbucket.org/acme/api/issues/5/some-title'), repo('bitbucket.org', 'acme', 'api'));
  for (const bad of [
    'https://gitlab.com/acme/shop/-/issues/1',
    'https://github.com/Acme/Shop',
    'https://github.com/Acme/Shop/issues',
    'https://github.com/Acme/Shop/issues/0',
    'https://github.com/a@b/Shop/issues/1',
    'https://github.com/a@b/Shop/pull/1',
    'http://github.com/Acme/Shop/issues/1',
    '', null, 42, {},
  ]) assert.equal(linkTargetOf(bad), null, String(bad));
  assert.deepEqual(parseGithubIssueUrl('https://github.com/Acme/Shop/issues/12/'), { host: 'github.com', owner: 'Acme', repo: 'Shop', number: 12 });
  assert.equal(parseGithubIssueUrl('https://github.com/Acme/Shop/issues/99999999999999999999'), null);
});

const P = (key, originUrl, extra = {}) => ({ key, name: key.toUpperCase(), exists: true, originUrl, ...extra });
const decide = (text, projects, excluded) => matchScopeFromLinks({ links: messageLinkTargets(text), projects, excluded });
const SHOP = P('shop', 'https://github.com/Acme/Shop.git');
const API = P('api', 'git@github.com:Acme/Api.git');

test('scope from links: matcher rows', () => {
  // a GitHub issue link + an https origin → switch
  assert.deepEqual(decide('see https://github.com/Acme/Shop/issues/12 please', [SHOP, API]), { action: 'switch', projectKey: 'shop', name: 'SHOP' });
  // a GitHub PR link + an ssh origin, different case → switch
  assert.deepEqual(decide('https://github.com/acme/api/pull/3', [SHOP, API]), { action: 'switch', projectKey: 'api', name: 'API' });
  // an Azure PR link + an Azure ssh v3 origin → switch
  const AZ = P('az', 'git@ssh.dev.azure.com:v3/acme/Shop/api');
  assert.deepEqual(decide('https://dev.azure.com/acme/Shop/_git/api/pullrequest/9', [SHOP, AZ]), { action: 'switch', projectKey: 'az', name: 'AZ' });
  // an Azure work item link: exactly one project in the org/project → switch; two → none
  const AZ2 = P('az2', 'https://dev.azure.com/acme/Shop/_git/web');
  const AZX = P('azx', 'https://dev.azure.com/acme/Other/_git/web');
  assert.deepEqual(decide('https://dev.azure.com/ACME/shop/_workitems/edit/5', [AZ, AZX]), { action: 'switch', projectKey: 'az', name: 'AZ' });
  assert.deepEqual(decide('https://dev.azure.com/acme/Shop/_workitems/edit/5', [AZ, AZ2, AZX]), { action: 'none' });
  // a Bitbucket PR and issue link → switch
  const BB = P('bb', 'git@bitbucket.org:acme/web.git');
  assert.deepEqual(decide('https://bitbucket.org/acme/web/pull-requests/2 and https://bitbucket.org/acme/web/issues/8', [SHOP, BB]), { action: 'switch', projectKey: 'bb', name: 'BB' });
  // a link to a repo no project has → none
  assert.deepEqual(decide('https://github.com/Other/Thing/issues/1', [SHOP, API]), { action: 'none' });
  // two projects with the same origin → ask with both, never switch
  const SHOP2 = P('shop2', 'git@github.com:Acme/Shop.git');
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/12', [SHOP, SHOP2]),
    { action: 'ask', candidates: [{ projectKey: 'shop', name: 'SHOP' }, { projectKey: 'shop2', name: 'SHOP2' }] });
  // links to two registered repos → ask with both
  assert.deepEqual(decide('https://github.com/Acme/Api/pull/1 https://github.com/Acme/Shop/issues/2', [SHOP, API]),
    { action: 'ask', candidates: [{ projectKey: 'api', name: 'API' }, { projectKey: 'shop', name: 'SHOP' }] });
  // one matched link + one unregistered link → switch (clarify 2)
  assert.deepEqual(decide('https://github.com/Other/Thing/issues/1 https://github.com/Acme/Shop/issues/2', [SHOP, API]), { action: 'switch', projectKey: 'shop', name: 'SHOP' });
  // two links into the same repo → switch
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1 https://github.com/Acme/Shop/pull/2', [SHOP, API]), { action: 'switch', projectKey: 'shop', name: 'SHOP' });
  // excluded key, single match → none
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', [SHOP, API], ['shop']), { action: 'none' });
  // excluded key among 2 → ask with the remaining 1, never switch (D4)
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', [SHOP, SHOP2], ['shop']), { action: 'ask', candidates: [{ projectKey: 'shop2', name: 'SHOP2' }] });
  // ... and every candidate excluded → none
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', [SHOP, SHOP2], ['shop', 'shop2']), { action: 'none' });
  // 4 candidates → none; 3 → ask
  const four = ['a', 'b', 'c', 'd'].map((k) => P(k, 'https://github.com/Acme/Shop'));
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', four), { action: 'none' });
  assert.equal(decide('https://github.com/Acme/Shop/issues/1', four.slice(0, 3)).action, 'ask');
  // exists:false project never matches
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', [P('gone', 'https://github.com/Acme/Shop.git', { exists: false })]), { action: 'none' });
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', [P('gone', 'https://github.com/Acme/Shop.git', { exists: false }), SHOP]),
    { action: 'switch', projectKey: 'shop', name: 'SHOP' });
  // null / unparsable origin ignored; bad entries skipped
  assert.deepEqual(decide('https://github.com/Acme/Shop/issues/1', [P('x', null), P('y', '/local/path'), null, 'junk', SHOP]),
    { action: 'switch', projectKey: 'shop', name: 'SHOP' });
  // nothing to decide from
  assert.deepEqual(matchScopeFromLinks({ links: [], projects: [SHOP] }), { action: 'none' });
  assert.deepEqual(matchScopeFromLinks({}), { action: 'none' });
  assert.deepEqual(matchScopeFromLinks(), { action: 'none' });
});

test('messageLinkTargets: http links ignored, trailing punctuation stripped, duplicates once, at most 20', () => {
  assert.deepEqual(messageLinkTargets('http://github.com/Acme/Shop/issues/1'), []);
  assert.deepEqual(messageLinkTargets(null), []);
  assert.deepEqual(messageLinkTargets(42), []);
  const r = messageLinkTargets('Fix https://github.com/Acme/Shop/issues/1. Also (https://github.com/Acme/Shop/pull/2), <https://github.com/Acme/Shop/issues/1>! and https://gitlab.com/x/y/-/issues/3?');
  assert.deepEqual(r, [
    { url: 'https://github.com/Acme/Shop/issues/1', target: repo('github.com', 'Acme', 'Shop') },
    { url: 'https://github.com/Acme/Shop/pull/2', target: repo('github.com', 'Acme', 'Shop') },
  ]);
  assert.equal(SCOPE_LINKS_MAX, 20);
  const many = Array.from({ length: 25 }, (_, i) => `https://github.com/Acme/R${i}/issues/1`).join(' ');
  const got = messageLinkTargets(many);
  assert.equal(got.length, 20);
  assert.equal(got[19].target.repo, 'R19');
  // a long paste stays linear: one bounded scan
  const t0 = process.cpuUsage();
  messageLinkTargets('https://' + 'a'.repeat(200000) + ' ' + 'x '.repeat(100000));
  const used = process.cpuUsage(t0);
  assert.ok((used.user + used.system) / 1000 < 1000, 'scan stays linear');
});

test('autoScopeKeys: notice blocks with autoScope, any role, each key once; plain notices ignored', () => {
  const msgs = [
    { role: 'system', blocks: [{ kind: 'notice', text: 'Switched to Shop', autoScope: { projectKey: 'shop' } }] },
    { role: 'system', blocks: [{ kind: 'notice', text: 'Switched to Api' }] },
    { role: 'assistant', blocks: [{ kind: 'notice', text: 'x', autoScope: { projectKey: 'web' } }, { kind: 'notice', text: 'y', autoScope: { projectKey: 'shop' } }] },
    { role: 'user', blocks: [{ kind: 'text', autoScope: { projectKey: 'nope' } }, { kind: 'notice', autoScope: { projectKey: '' } }, { kind: 'notice', autoScope: null }, null] },
    null, { blocks: 'junk' },
  ];
  assert.deepEqual(autoScopeKeys(msgs), ['shop', 'web']);
  assert.deepEqual(autoScopeKeys(null), []);
});
