// test/marketplace-install-view.test.mjs — P4: the install sheet's pure renderers (boards 1.2–1.4): steps, head, Review
// facts from the snapshot inventory, Set up wash, Done rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { addsRows, asksFor, setupLines, renderSteps, renderSheetHead, renderReview, renderSetupStep, nowRows, renderDone } from '../ui/public/marketplace/install-view.mjs';
import { setupSections } from '../ui/public/marketplace/setup-fields.mjs';
import { landing } from '../ui/public/marketplace/kinds.mjs';
import { checkRows } from './helpers/rows.mjs';
import { SLACK, ATLASSIAN, AZURE, INV, item, SLACK_CONFIG } from './helpers/marketplace-install-fixtures.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

test('addsRows: one row per contribution in kind order, the canvas meta line per kind, today\'s consent facts kept', () => {
  assert.deepEqual(addsRows(SLACK.entry.inventory), [{ kind: 'chatChannels', title: 'Slack', mono: false, meta: 'Chat channel · main · inbound + outbound', worker: true }]);
  const inv = INV({ taskSources: [{ id: 'github', displayName: 'GitHub Issues', secrets: ['token'] }],
    chatChannels: [{ id: 'tg', displayName: 'Telegram', platform: 'telegram', inbound: false, outbound: true, secrets: [] }],
    mcpServers: [{ name: 'jira', type: 'stdio', command: 'node <plugin-dir>/mcp/jira.mjs' }],
    models: [{ id: 'ds-fast', label: 'DS fast', engine: 'codex', envKeys: [], baseUrl: 'https://llm.example/v1' }, { id: 'plain', label: '', engine: 'claude', envKeys: [], baseUrl: null }],
    agents: [{ key: 'triager', tools: ['Bash', 'Read'], forms: ['review'], fileTypes: ['md'] }, { key: 'quiet', tools: [], forms: [], fileTypes: [] }],
    scripts: [{ key: 'lint', runtime: 'python', command: null, file: 'lint.py', cases: 2 }],
    skills: ['release-style'], workflows: ['release-notes'] });
  assert.deepEqual(addsRows(inv).map((r) => [r.kind, r.title, r.mono, r.meta, r.worker]), [
    ['taskSources', 'GitHub Issues', false, 'Task source · github', false],
    ['chatChannels', 'Telegram', false, 'Chat channel · tg · outbound', true],
    ['mcpServers', 'jira', true, 'MCP server · stdio · node <plugin-dir>/mcp/jira.mjs', false],
    ['models', 'DS fast', false, 'Model · ds-fast · Codex · routes to https://llm.example/v1', false],
    ['models', 'plain', false, 'Model · plain', false],
    ['agents', 'triager', true, 'Agent · tools: Bash, Read · 1 form: review · may display md from the run folder', false],
    ['agents', 'quiet', true, 'Agent · tools: none declared', false],
    ['scripts', 'lint', true, 'Script · python · lint.py · 2 cases', false],
    ['skills', 'release-style', true, 'Skill', false],
    ['workflows', 'release-notes', true, 'Workflow', false],
  ]);
  assert.deepEqual(addsRows({}), [], 'an old snapshot with no kinds adds nothing');
});

test('asksFor: secret keys of task sources, chat channels, then model secrets — once each', () => {
  assert.deepEqual(asksFor(SLACK.entry.inventory), ['botToken', 'appToken']);
  assert.deepEqual(asksFor({ taskSources: [{ id: 'a', secrets: ['token'] }, { id: 'b', secrets: ['token'] }],
    chatChannels: [{ id: 'c', secrets: ['botToken'] }], modelSecrets: [{ key: 'apiKey', label: 'API key' }] }), ['token', 'botToken', 'apiKey']);
  assert.deepEqual(asksFor({}), []);
});

test('setupLines: "No dependencies", else the npm count and each setup command verbatim', () => {
  assert.deepEqual(setupLines(SLACK.entry.inventory), [{ text: 'No dependencies', mono: false }]);
  assert.deepEqual(setupLines({ depCount: 0, setupCommands: [] }), [{ text: 'No dependencies', mono: false }]);
  assert.deepEqual(setupLines(AZURE.entry.inventory), [{ text: '12 npm dependencies (from lockfile)', mono: false },
    { text: 'npm ci --prefix <plugin-dir> --ignore-scripts --omit=dev', mono: true }]);
  assert.deepEqual(setupLines({ depCount: null, setupCommands: ['uv sync --project <plugin-dir>'] }), [{ text: 'uv sync --project <plugin-dir>', mono: true }]);
});

test('renderSteps: four steps, the current one marked, earlier ones done with a check; Done shows a check too', () => {
  const ol = renderSteps(doc, 2);
  assert.deepEqual([ol.tagName, ol.className, ol.getAttribute('aria-label')], ['OL', 'mk-steps', 'Install steps']);
  const row = (s) => [s.querySelector('.mk-step-label').textContent, s.querySelector('.mk-step-n').textContent, s.classList.contains('is-done'), s.getAttribute('aria-current')];
  assert.deepEqual([...ol.querySelectorAll('li.mk-step')].map(row),
    [['Review', '', true, null], ['Install', '', true, null], ['Set up', '3', false, 'step'], ['Done', '4', false, null]]);
  assert.ok(ol.querySelector('li.mk-step.is-done .mk-step-n svg'));
  assert.equal(ol.querySelectorAll('li.mk-step-sep[aria-hidden="true"]').length, 3);
  assert.deepEqual([...renderSteps(doc, 3).querySelectorAll('li.mk-step')].map(row).at(-1), ['Done', '', false, 'step']);
  assert.deepEqual([...renderSteps(doc, 0).querySelectorAll('li.mk-step')].map(row)[0], ['Review', '1', false, 'step']);
});

test('renderSheetHead: plugin icon, name as the sheet title, version · marketplace, then the steps (P3 owns Close)', () => {
  const head = renderSheetHead(doc, SLACK, { step: 0 });
  assert.deepEqual([head.nodeType, [...head.children].map((c) => c.className)], [11, ['mk-sheet-id', 'mk-steps']]);
  assert.ok(head.querySelector('.mk-sheet-id > .mk-mt.mk-mt-lg[aria-hidden="true"]'));
  assert.deepEqual([head.querySelector('h2#mk-sheet-title.subpage-title').textContent, head.querySelector('.mk-sheet-id .mk-meta').textContent,
    head.querySelector('.mk-sheet-id .mk-meta .mk-ver').textContent], ['slack-chat', '0.1.0 · Worca CC Official', '0.1.0']);
  assert.equal(head.querySelector('.mk-sheet-id .mk-meta .mk-mono'), null, 'SM30: a version is sans with tabular numerals');
  assert.equal(head.querySelector('button'), null, 'the Close button is P3\'s layer closeButton');
  const bare = renderSheetHead(doc, item('bare', { version: null }), { step: 0 });
  assert.deepEqual([bare.querySelector('.mk-meta').textContent, bare.querySelector('.mk-ver').className], ['735b354 · Worca CC Official', 'mk-ver mk-mono'],
    'L23: a sha standing in for the version is code');
  const unpinned = { ...item('bare', { version: null }), source: { ...item('bare').source, sha: null } };
  assert.equal(renderSheetHead(doc, unpinned, { step: 0 }).querySelector('.mk-meta').textContent, 'Worca CC Official', 'no version, no sha: the name alone');
  assert.equal(renderReview(doc, unpinned, {}).querySelector('.mk-src-sha'), null, 'no "@" without a sha');
});

test('renderReview: slack-chat (board 1.2)', () => {
  const body = renderReview(doc, SLACK, {});
  assert.equal(body.className, 'mk-stack');
  assert.equal(body.querySelector('p.mk-desc').textContent, SLACK.description);
  const secs = [...body.querySelectorAll('section.mk-sec')];
  assert.deepEqual(secs.map((s) => s.querySelector('h3.subsection-title').textContent), ['Adds', 'Asks for', 'Setup', 'Source']);
  for (const s of secs) assert.equal(s.getAttribute('aria-labelledby'), s.querySelector('h3').id);
  const add = secs[0].querySelector('ul.mk-list > li.mk-list-row');
  assert.deepEqual([!!add.querySelector('.mk-mt.mk-mt-sm'), add.querySelector('.mk-row-title').textContent, add.querySelector('.mk-meta').textContent, add.querySelector('.mk-chip.mk-chip-n').textContent],
    [true, 'Slack', 'Chat channel · main · inbound + outbound', 'Runs a persistent worker']);
  assert.deepEqual([...secs[1].querySelectorAll('li.mk-list-row')].map((r) => [!!r.querySelector('.mk-ico .ic svg'), r.querySelector('.mk-row-title.mk-mono').textContent, r.querySelector('.mk-chip.mk-chip-n').textContent]),
    [[true, 'botToken', 'Secret'], [true, 'appToken', 'Secret']]);
  const warn = secs[1].nextElementSibling;
  assert.deepEqual([warn.className, warn.getAttribute('role'), warn.textContent],
    ['mk-wash mk-wash-bad', 'note', 'Anyone holding the bot token or in an allowed channel can pause, stop and approve runs.']);
  assert.deepEqual([...secs[2].querySelectorAll('.mk-setup-line')].map((l) => [l.textContent, l.classList.contains('mk-mono')]), [['No dependencies', false]]);
  const src = secs[3].querySelector('.mk-src');
  assert.deepEqual([src.querySelector('.mk-src-url.mk-mono').textContent, src.querySelector('.mk-src-sha.mk-mono').textContent], ['github.com/SinishaDjukic/worca-cc / plugins/slack-chat', '@ 735b354']);
  const gh = src.querySelector('a.mk-link');
  assert.deepEqual([gh.textContent, gh.getAttribute('href'), gh.target, gh.rel, !!gh.querySelector('.ic svg')], ['View on GitHub', SLACK.source.webUrl, '_blank', 'noopener', true]);
  assert.equal(body.querySelector('.pl-needs-git'), null);
});

test('renderReview: the other shapes', async () => {
  await checkRows([
    { name: 'no secrets, no inbound channel: no Asks for, no warning', run: () => {
      const b = renderReview(doc, ATLASSIAN, {});
      assert.deepEqual([...b.querySelectorAll('section.mk-sec h3')].map((h) => h.textContent), ['Adds', 'Setup', 'Source']);
      assert.equal(b.querySelector('.mk-wash'), null);
    } },
    { name: 'outbound-only channel: still a worker, no warning', run: () => {
      const b = renderReview(doc, item('tg', { inventory: INV({ chatChannels: [{ id: 'tg', displayName: 'Telegram', platform: 'telegram', inbound: false, outbound: true, secrets: [] }] }) }), {});
      assert.deepEqual([b.querySelector('.mk-list-row .mk-chip.mk-chip-n').textContent, b.querySelector('.mk-wash')], ['Runs a persistent worker', null]);
    } },
    { name: 'a source off GitHub: no View on GitHub; needsGit: the Needs git chip on the source line', run: () => {
      const b = renderReview(doc, { ...ATLASSIAN, source: { ...ATLASSIAN.source, repoUrl: 'https://gitlab.com/a/m.git', webUrl: null } }, { needsGit: true });
      assert.deepEqual([b.querySelector('.mk-src a'), b.querySelector('.mk-src .pl-needs-git').textContent, b.querySelector('.mk-src-url').textContent],
        [null, 'Needs git', 'gitlab.com/a/m / plugins/atlassian-mcp']);
    } },
    { name: 'no webUrl on the item: View on GitHub falls back to githubWebUrl', run: () => {
      const b = renderReview(doc, { ...SLACK, source: { ...SLACK.source, webUrl: undefined } }, {});
      assert.equal(b.querySelector('.mk-src a.mk-link').getAttribute('href'), `https://github.com/SinishaDjukic/worca-cc/tree/${SLACK.source.sha}/plugins/slack-chat`);
    } },
    { name: 'a repo-root plugin (subdir "") shows the url alone; no description, no paragraph', run: () => {
      const b = renderReview(doc, item('one', { repoUrl: 'https://github.com/acme/one', subdir: '' }), {});
      assert.deepEqual([b.querySelector('.mk-src-url').textContent, b.querySelector('.mk-src-sep'), b.querySelector('p.mk-desc')], ['github.com/acme/one', null, null]);
    } },
    { name: 'an error leads the body as an alert wash', run: () => {
      const w = renderReview(doc, SLACK, { error: 'boom' }).firstElementChild;
      assert.deepEqual([w.className, w.getAttribute('role'), w.textContent, !!w.querySelector('.ic svg')], ['mk-wash mk-wash-bad', 'alert', 'boom', true]);
    } },
    { name: 'a snapshot from before MCP inventories says so inside Adds (today\'s consent line)', run: () => {
      const inv = INV({ taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['pat'] }] }); delete inv.mcpServers;
      const adds = renderReview(doc, item('jira-source', { inventory: inv }), {}).querySelector('section.mk-sec');
      assert.deepEqual([adds.querySelector('h3').textContent, adds.querySelector('.mk-wash').textContent], ['Adds', 'MCP servers: unknown. Refresh the marketplace']);
    } },
  ]);
});

test('addsRows / renderReview details: command wins over file, one case, fileTypes only with forms, no dirs no dot; mono titles; an old snapshot', () => {
  const inv = INV({ scripts: [{ key: 'fmt', runtime: 'node', command: 'node fmt.mjs', file: 'fmt.mjs', cases: 1 }],
    agents: [{ key: 'viewer', tools: [], forms: [], fileTypes: ['png'] }],
    chatChannels: [{ id: 'mute', displayName: '', platform: 'x', inbound: false, outbound: false, secrets: [] }] });
  assert.deepEqual(addsRows(inv).map((r) => r.meta), ['Chat channel · mute', 'Agent · tools: none declared', 'Script · node · node fmt.mjs · 1 case']);
  assert.equal(renderReview(doc, ATLASSIAN, {}).querySelector('#mk-r-adds ~ ul .mk-row-title').className, 'mk-row-title mk-mono');
  assert.equal(renderReview(doc, SLACK, {}).querySelector('#mk-r-adds ~ ul .mk-row-title').className, 'mk-row-title');
  const old = renderReview(doc, item('old', { inventory: { depCount: null, setupCommands: [] } }), {});
  assert.deepEqual([...old.querySelectorAll('section.mk-sec h3')].map((h) => h.textContent), ['Adds', 'Setup', 'Source']);
  assert.equal(old.querySelector('section.mk-sec .mk-wash').textContent, 'MCP servers: unknown. Refresh the marketplace');
});

test('renderSetupStep: the installed wash, then one Set up section per source / channel (board 1.3)', () => {
  const b = renderSetupStep(doc, SLACK, setupSections(SLACK_CONFIG));
  const wash = b.firstElementChild;
  assert.deepEqual([wash.className, wash.getAttribute('role'), wash.querySelector('.mk-wash-text').textContent, wash.querySelector('.mk-wash-end.mk-mono').textContent],
    ['mk-wash mk-wash-ok', 'status', 'Installed slack-chat 0.1.0', '735b354']);
  assert.deepEqual([...b.querySelectorAll('section.mk-setup .mk-setup-h')].map((h) => h.textContent), ['Set up Slack']);
  const e = renderSetupStep(doc, SLACK, [], { error: 'plugin manifest unreadable — run doctor' });
  assert.deepEqual([e.children.length, e.querySelector('.mk-wash-bad[role="alert"]').textContent], [2, 'plugin manifest unreadable — run doctor']);
  const bare = renderSetupStep(doc, item('bare', { version: null }), []).firstElementChild;
  assert.deepEqual([bare.querySelector('.mk-wash-text').textContent, bare.querySelector('.mk-wash-end').textContent], ['Installed bare', '735b354'], 'a version that is only the sha shows it once, as code');
});

test('nowRows: one row per kind the plugin adds, where it lands, the saved chat ids (ids mono, L23)', () => {
  assert.deepEqual(nowRows(SLACK.entry.inventory, { values: { main: { notifyChatIds: 'C07Q2M4KD1', allowedChatIds: 'C07Q2M4KD1, C2' } } }),
    [{ kind: 'chatChannels', title: 'Slack chat channel', link: landing('chatChannels'),
      meta: [{ text: 'Notifies ' }, { text: 'C07Q2M4KD1', mono: true }, { text: ' · commands from ' }, { text: 'C07Q2M4KD1, C2', mono: true }] }]);
  assert.deepEqual(nowRows(SLACK.entry.inventory, { values: { main: { notifyChatIds: '', allowedChatIds: 'C9' } } })[0].meta,
    [{ text: 'Commands from ' }, { text: 'C9', mono: true }]);
  assert.deepEqual(nowRows(SLACK.entry.inventory)[0].meta, []);
  assert.deepEqual(nowRows(ATLASSIAN.entry.inventory), [{ kind: 'mcpServers', title: 'atlassian MCP server', meta: [], link: landing('mcpServers') }]);
  assert.deepEqual(nowRows({ models: [{ id: 'a', label: 'A' }, { id: 'b', label: '' }] }), [{ kind: 'models', title: '2 models', meta: [{ text: 'A, b' }], link: landing('models') }]);
  assert.deepEqual(nowRows({}), []);
});

test('renderDone: ready line, live chips, Now in worca, Next (board 1.4)', () => {
  const b = renderDone(doc, SLACK, { channels: [
    { plugin: 'slack-chat', channelId: 'main', displayName: 'Slack', state: 'connected', detail: null },
    { plugin: 'other', channelId: 'main', displayName: 'Other', state: 'connected', detail: null }],
  values: { main: { notifyChatIds: 'C07Q2M4KD1', allowedChatIds: 'C07Q2M4KD1' } } });
  assert.ok(b.querySelector('.mk-done-hero > .mk-ok-tile .ic svg'));
  assert.equal(b.querySelector('.mk-done-hero > h3.subpage-title').textContent, 'slack-chat is ready');
  assert.deepEqual([...b.querySelectorAll('.mk-chips .pl-channel')].map((c) => [c.dataset.channelKey, c.textContent, c.className]),
    [['slack-chat/main', 'Slack · connected', 'badge mk-chip mk-chip-ok pl-channel']]);   // SM37: P5 later rewrites this className
  const [now, next] = b.querySelectorAll('section.mk-sec');
  assert.deepEqual([now.querySelector('h3.subsection-title').textContent, next.querySelector('h3.subsection-title').textContent], ['Now in worca', 'Next']);
  const row = now.querySelector('ul.mk-list > li.mk-list-row');
  const go = row.querySelector('a.mk-link[data-link="landing"]');
  assert.deepEqual([!!row.querySelector('.mk-mt.mk-mt-sm'), row.querySelector('.mk-row-title').textContent, row.querySelector('.mk-meta').textContent, go.textContent, go.getAttribute('href')],
    [true, 'Slack chat channel', 'Notifies C07Q2M4KD1 · commands from C07Q2M4KD1', landing('chatChannels').label, landing('chatChannels').href]);
  assert.deepEqual([...row.querySelectorAll('.mk-meta .mk-mono')].map((m) => m.textContent), ['C07Q2M4KD1', 'C07Q2M4KD1']);
  assert.deepEqual([...next.querySelectorAll('.mk-links > a.mk-lrow')].map((a) => [a.textContent, a.getAttribute('href'), a.dataset.link]),
    [['Manage slack-chat', '#marketplace/installed', 'manage'], ['Browse more chat channels', '#marketplace/browse', 'browse']]);
});

test('renderDone: MCP plugins lead Next with Set up in Connectors; Mix plugins get no Browse more row', () => {
  const b = renderDone(doc, ATLASSIAN, {});
  assert.deepEqual([b.querySelector('.mk-chips'), [...b.querySelectorAll('a.mk-lrow')].map((a) => [a.textContent, a.getAttribute('href'), a.dataset.link])],
    [null, [['Set up in Connectors', '#connectors/servers', 'connectors'], ['Manage atlassian-mcp', '#marketplace/installed', 'manage'], ['Browse more MCP servers', '#marketplace/browse', 'browse']]]);
  const mix = item('release-notes', { iconKind: 'mix', inventory: INV({ agents: [{ key: 'drafter', tools: [], forms: [], fileTypes: [] }], skills: ['release-style'] }) });
  assert.deepEqual([...renderDone(doc, mix, {}).querySelectorAll('a.mk-lrow')].map((a) => a.dataset.link), ['manage']);
});

test('Set up and Done details: the error wash order, blank ids dropped, no empty meta line', () => {
  const b = renderSetupStep(doc, SLACK, setupSections(SLACK_CONFIG), { error: 'x' });
  assert.deepEqual([...b.children].map((c) => c.className), ['mk-wash mk-wash-ok', 'mk-wash mk-wash-bad', 'mk-setup']);
  assert.deepEqual(nowRows(SLACK.entry.inventory, { values: { main: { notifyChatIds: 'C1,,C2', allowedChatIds: ' , ' } } })[0].meta,
    [{ text: 'Notifies ' }, { text: 'C1, C2', mono: true }]);
  assert.equal(renderDone(doc, ATLASSIAN, {}).querySelector('.mk-list-row .mk-meta'), null);
});

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
// Classes that are only JS / test hooks and need no rule of their own.
const HOOKS = new Set(['mk-step-label', 'mk-setup', 'mk-disc-body', 'mk-replace', 'mk-profile-sel', 'mk-profile-id', 'mk-src-sha', 'mk-src-sep']);
test('every mk- class the install renderers emit has a rule in style.css; the P4 block is tokens only', () => {
  const trees = [renderSheetHead(doc, SLACK, { step: 1 }), renderReview(doc, SLACK, { error: 'x', needsGit: true }),
    renderSetupStep(doc, SLACK, setupSections(SLACK_CONFIG)), renderDone(doc, ATLASSIAN, {}),
    renderDone(doc, SLACK, { channels: [{ plugin: 'slack-chat', channelId: 'main', displayName: 'Slack', state: 'connected' }] })];
  // The live chip is channelBadge's (plugins-view); P5 restyles it with its own classes and rules (SM37).
  const used = new Set(trees.flatMap((t) => [...(t.nodeType === 1 ? [t] : []), ...t.querySelectorAll('*')]).filter((n) => !n.closest('.pl-channel'))
    .flatMap((n) => [...n.classList]).filter((c) => c.startsWith('mk-')));
  const missing = [...used].filter((c) => !HOOKS.has(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(css));
  assert.deepEqual(missing, []);
  const at = css.indexOf('/* ── marketplace P4 ── */');
  assert.ok(at > css.indexOf('/* ── marketplace P3 ── */'), 'after P3\'s block');
  const next = css.indexOf('/* ── marketplace', at + 1);
  const block = css.slice(at, next > 0 ? next : css.length);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|box-shadow|text-transform|50%/i);
  assert.deepEqual([...block.matchAll(/font-size:([^;}]+)/g)].map((m) => m[1]).filter((v) => !v.startsWith('var(--fs-')), []);
  assert.match(block, /\.mk-src \.pl-needs-git\{color:var\(--amber-ink-strong\);\}/, 'L19: the Needs git chip reads at the stronger shade inside the sheet');
});
