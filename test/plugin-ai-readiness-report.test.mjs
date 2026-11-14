// test/plugin-ai-readiness-report.test.mjs — the report script writes the md/json/html card from
// the agents' judgement and the probe, and in gate mode emits the Re-score verdict.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeProfile } from '../src/core/project-profile.mjs';
import run, { renderHtml, renderMarkdown, buildCard, claudeFilesOf } from '../plugins/ai-readiness/scripts/readiness-report.mjs';
import { verdictFor, profileOf } from '../plugins/ai-readiness/scripts/readiness-lib.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const PROBE = { selectedTools: ['claude'], tools: { 'claude': { surface: 'self-sufficient', file: 'CLAUDE.md' } }, commands: [], frontmatter: [], sideEffects: [] };
const GOOD = { dimensions: { commands: 90, architecture: 90, conventions: 90, gotchas: 90, tests: 90, recurringTasks: 90 }, reasons: {}, gaps: [], summary: 's' };

function envelope({ judgement, probe = PROBE, gate = false, mock = false, cardName = gate ? 'readiness-final-cycle1.md' : 'readiness-baseline.md' }) {
  const pd = mkdtempSync(join(tmpdir(), 'air-report-'));
  dirs.push(pd);
  writeFileSync(join(pd, 'j.json'), typeof judgement === 'string' ? judgement : JSON.stringify(judgement));
  writeFileSync(join(pd, 'p.json'), JSON.stringify(probe));
  const outputs = { card: { type: 'md', path: join(pd, cardName) } };
  if (gate) { outputs.findings = { type: 'md', path: join(pd, 'readiness-findings-cycle1.md') }; outputs.pass = { type: 'void' }; }
  return { pd, api: { inputs: { judgement: { path: join(pd, 'j.json') }, probe: { path: join(pd, 'p.json') } }, outputs, ctx: { pipelineDir: pd, mock }, log: () => {} } };
}

test('baseline: md, json and html under readiness/, no verdict', async () => {
  const { pd, api } = envelope({ judgement: GOOD });
  const r = await run(api);
  assert.equal(r.verdict, undefined);
  assert.match(readFileSync(join(pd, 'readiness-baseline.md'), 'utf8'), /^# AI-readiness: 90\/100/m);
  assert.equal(JSON.parse(readFileSync(join(pd, 'readiness/baseline.json'), 'utf8')).overall, 90);
  assert.ok(existsSync(join(pd, 'readiness/baseline.html')));
});

test('final: states the baseline delta and passes at 80+', async () => {
  const { pd, api } = envelope({ judgement: GOOD, gate: true });
  mkdirSync(join(pd, 'readiness'), { recursive: true });
  writeFileSync(join(pd, 'readiness/baseline.json'), JSON.stringify({ overall: 40 }));
  const r = await run(api);
  assert.deepEqual(r.verdict.issues, []);
  assert.match(readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8'), /Started at 40\/100, now 90\/100 \(\+50\)\./);
});

test('final below the pass mark blocks and writes findings with locations', async () => {
  const low = { ...GOOD, dimensions: { ...GOOD.dimensions, commands: 0 }, gaps: [{ id: 'g1', dimension: 'commands', title: 'No test command', fix: 'document it', location: 'AGENTS.md' }] };
  const { pd, api } = envelope({ judgement: low, gate: true });
  const r = await run(api);
  assert.equal(r.verdict.issues[0].severity, 'critical');
  assert.match(readFileSync(join(pd, 'readiness-findings-cycle1.md'), 'utf8'), /AGENTS\.md/);
});

test('an unreadable judgement: a card that says so; the gate blocks on a real run, passes on a mock run', async () => {
  const real = envelope({ judgement: '{oops', gate: true });
  assert.equal((await run(real.api)).verdict.issues[0].title, 'The re-score judgement is missing or unreadable');
  assert.match(readFileSync(join(real.pd, 'readiness-final-cycle1.md'), 'utf8'), /No score/);
  const mock = envelope({ judgement: { mock: true }, gate: true, mock: true });
  assert.deepEqual((await run(mock.api)).verdict.issues, []);
});

test('html: self-contained, both themes, repository text escaped, JSON embedded safely', () => {
  const evil = { ...GOOD, gaps: [{ id: 'g1', dimension: 'gotchas', title: '</script><img src=x onerror=alert(1)>', fix: '', location: '' }] };
  const html = renderHtml(buildCard(evil, PROBE, { final: false }), null);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.doesNotMatch(html, /\s(src|href)=["']?https?:/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /<script type="application\/json" id="readiness">/);
});

test('workspace: one section per member, the overall is the lowest member', () => {
  const card = buildCard({ members: { api: GOOD, web: { ...GOOD, dimensions: { ...GOOD.dimensions, commands: 0 } } } },
    { members: { api: PROBE, web: PROBE } }, { final: false });
  assert.deepEqual(Object.keys(card.members), ['api', 'web']);
  assert.equal(card.overall, Math.min(card.members.api.overall, card.members.web.overall));
  const html = renderHtml(card, null);
  assert.match(html, /<h2>api: \d+\/100<\/h2>/);
  assert.match(html, /<h2>web: \d+\/100<\/h2>/);
  assert.doesNotMatch(html, /No tool selected/, 'each member section shows its own tools');
});

test('workspace: a member the probe measured but the judgement left out blocks, and is named', async () => {
  const card = buildCard({ members: { api: GOOD } }, { members: { api: PROBE, web: PROBE } }, { final: true });
  assert.deepEqual(Object.keys(card.members), ['api', 'web']);
  assert.equal(card.members.web.valid, false);
  assert.equal(card.pass, false);
  assert.ok(verdictFor(card).issues.length > 0);
  assert.match(renderMarkdown(card, null), /No score: no readable judgement for web\./);
  assert.match(renderMarkdown(card, null), /## api: 90\/100/);
  assert.match(verdictFor(card).issues[0].detail, /web/);
});

test('workspace gate: the findings start with the members to fix, sorted', async () => {
  const low = { ...GOOD, dimensions: { ...GOOD.dimensions, commands: 0 }, gaps: [{ id: 'g1', dimension: 'commands', title: 'No test command', fix: 'document it', location: 'AGENTS.md' }] };
  const { pd, api } = envelope({ judgement: { members: { api: GOOD, worker: low, web: low } }, probe: { members: { api: PROBE, worker: PROBE, web: PROBE } }, gate: true });
  const r = await run(api);
  assert.equal(r.verdict.issues.length > 0, true);
  const lines = readFileSync(join(pd, 'readiness-findings-cycle1.md'), 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(lines[0], '# Re-score findings');
  assert.equal(lines[1], 'Members to fix: web, worker');
});

test('workspace markdown: the overall is the lowest member, not the lowest selected tool', () => {
  const card = buildCard({ members: { api: GOOD, web: GOOD } }, { members: { api: PROBE, web: PROBE } }, { final: false });
  const md = renderMarkdown(card, null);
  assert.match(md, /The overall score is the lowest member's score; every member must reach the pass mark\./);
  assert.doesNotMatch(md, /lowest selected tool's score/);
});

test('html: a final card shows the hard failures and the files a command left behind, escaped', () => {
  const probe = { ...PROBE, commands: [{ command: 'npm test', documented: true, documentedIn: 'AGENTS.md', status: 'fail', exitCode: 1, baselineStatus: 'pass' }], sideEffects: ['junk.txt', '<b>x</b>.txt'] };
  const card = buildCard(GOOD, probe, { final: true });
  assert.equal(card.pass, false);
  const html = renderHtml(card, null);
  assert.match(html, /<h2>Hard failures<\/h2>/);
  assert.match(html, /Documented command fails: npm test/);
  assert.match(html, /Files a probed command wrote \(restored\)/);
  assert.match(html, /junk\.txt/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  const clean = renderHtml(buildCard(GOOD, PROBE, { final: true }), null);
  assert.doesNotMatch(clean, /Hard failures|wrote/);
});

test('restored and could-not-restore side effects get their own headings, escaped in html', () => {
  const probe = { ...PROBE, sideEffects: ['a.txt', '<i>c</i>.txt'], restoreFailed: ['b.txt', '<u>d</u>'] };
  const card = buildCard(GOOD, probe, { final: false });
  const md = renderMarkdown(card, null);
  assert.match(md, /## Files a probed command wrote \(restored\)\n\n- `a\.txt`/);
  assert.match(md, /## Files a probed command wrote and the probe could not restore\n\n- `b\.txt`/);
  const html = renderHtml(card, null);
  assert.match(html, /Files a probed command wrote \(restored\)/);
  assert.match(html, /Files a probed command wrote and the probe could not restore/);
  assert.match(html, /a\.txt/);
  assert.match(html, /b\.txt/);
  assert.doesNotMatch(html, /<i>c<\/i>|<u>d<\/u>/);
  assert.doesNotMatch(renderMarkdown(buildCard(GOOD, PROBE, { final: false }), null), /could not restore/);
});

test('markdown: an invalid workspace member heading says No score', () => {
  const card = buildCard({ members: { api: GOOD } }, { members: { api: PROBE, web: PROBE } }, { final: false });
  assert.match(renderMarkdown(card, null), /^## web: No score$/m);
});

// F2: one headline gap per dimension. 12 gotcha gaps (gotchas 0: 15 points lost) and 3 architecture
// gaps (architecture 40: 9 points lost), a partial Codex surface and a documented command that broke.
const MANY = {
  dimensions: { commands: 90, architecture: 40, conventions: 90, gotchas: 0, tests: 90, recurringTasks: null }, reasons: {},
  gaps: [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `k${i + 1}`, dimension: 'gotchas', title: `Gotcha ${i + 1}`, fix: 'write it', location: 'AGENTS.md' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i + 1}`, dimension: 'architecture', title: `Arch ${i + 1}`, fix: 'map it', location: 'AGENTS.md' })),
  ],
};
const MANY_PROBE = {
  selectedTools: ['claude', 'codex'],
  tools: { 'claude': { surface: 'self-sufficient', file: 'CLAUDE.md' }, codex: { surface: 'partial', expected: 'AGENTS.md', why: 'half' } },
  commands: [{ command: 'npm test', documented: true, documentedIn: 'AGENTS.md', status: 'fail', exitCode: 1, baselineStatus: 'pass' }],
  frontmatter: [], sideEffects: [],
};
const gapsSection = (md) => md.split('## Gaps\n')[1].split(/\n## /)[0];
const topRows = (section) => section.split('\n').filter((l) => l.startsWith('- '));

test('markdown: one headline row per dimension, its items nested, the bigger loss first', () => {
  const md = renderMarkdown(buildCard(MANY, MANY_PROBE, { final: true }), null);
  const section = gapsSection(md);
  const heads = topRows(section).filter((l) => /^- \*\*\w+\*\* (gotchas|architecture): /.test(l));
  assert.deepEqual(heads, ['- **critical** gotchas: 12 items', '- **major** architecture: 3 items']);
  assert.match(section, /- \*\*critical\*\* gotchas: 12 items\n(  - Gotcha \d+ — write it \(`AGENTS\.md`\)\n){12}/);
  assert.match(section, /- \*\*major\*\* architecture: 3 items\n(  - Arch \d+ — map it \(`AGENTS\.md`\)\n?){3}/);
  assert.doesNotMatch(section, /^- \*\*\w+\*\* Gotcha /m, 'no item is a row of its own');
});

test('markdown: the tool surface gap and the documented-command failure stay separate rows', () => {
  const md = renderMarkdown(buildCard(MANY, MANY_PROBE, { final: true }), null);
  assert.deepEqual(topRows(gapsSection(md)), [
    '- **critical** gotchas: 12 items',
    '- **critical** Codex: instructions partial — Write or complete AGENTS.md (`AGENTS.md`)',
    '- **major** architecture: 3 items',
  ]);
  assert.match(md, /## Hard failures\n\n- Documented command fails: npm test — exit 1 \(fail\)/);
});

test('card JSON keeps every item with its own dimension and severity', async () => {
  const { pd, api } = envelope({ judgement: MANY, probe: MANY_PROBE });
  await run(api);
  const card = JSON.parse(readFileSync(join(pd, 'readiness/baseline.json'), 'utf8'));
  assert.equal(card.gaps.length, 16);
  assert.equal(card.gaps.filter((g) => g.dimension === 'gotchas' && g.severity === 'critical' && g.fix === 'write it' && g.location === 'AGENTS.md').length, 12);
  assert.equal(card.gaps.filter((g) => g.dimension === 'architecture' && g.severity === 'major').length, 3);
  assert.equal(card.gaps.find((g) => g.id === 'tool-codex').severity, 'major');
  assert.ok(card.gaps.every((g) => g.title && !/ items$/.test(g.title)), 'no headline rows in the data');
  assert.match(readFileSync(join(pd, 'readiness-baseline.md'), 'utf8'), /- \*\*critical\*\* gotchas: 12 items/);
});

test('html: grouped items are escaped, the headline groups them', () => {
  const evil = { ...MANY, gaps: [...MANY.gaps, { id: 'x', dimension: 'gotchas', title: '</script><img src=x onerror=alert(1)>', fix: '<img onerror=x>', location: '<b>loc</b>' }] };
  const html = renderHtml(buildCard(evil, MANY_PROBE, { final: false }), null);
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.doesNotMatch(html, /<b>loc<\/b>/);
  assert.match(html, /&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<b>gotchas: 13 items<\/b>/);
  assert.match(html, /<b>architecture: 3 items<\/b>/);
  assert.equal((html.match(/<li class="gap /g) || []).length, 3, 'two headlines and the Codex row');
});

test('workspace: each member gets its own grouped headlines', () => {
  const card = buildCard({ members: { api: MANY, web: { ...MANY, gaps: MANY.gaps.slice(12) } } },
    { members: { api: MANY_PROBE, web: MANY_PROBE } }, { final: false });
  const section = gapsSection(renderMarkdown(card, null));
  const [, api, web] = section.split(/^### /m);
  assert.match(api, /^api\n/);
  assert.deepEqual(topRows(api).filter((l) => / items$/.test(l)), ['- **critical** gotchas: 12 items', '- **major** architecture: 3 items']);
  assert.match(api, / {2}- Gotcha 1 — write it \(`api\/AGENTS\.md`\)/);
  assert.match(web, /^web\n/);
  assert.deepEqual(topRows(web).filter((l) => / items$/.test(l)), ['- **major** architecture: 3 items']);
  const html = renderHtml(card, null);
  assert.match(html, /<h3>api<\/h3><ul>.*<b>gotchas: 12 items<\/b>/s);
  assert.match(html, /<h3>web<\/h3><ul>.*<b>architecture: 3 items<\/b>/s);
});

test('the gate verdict does not change with the grouping', () => {
  const v = verdictFor(buildCard(MANY, MANY_PROBE, { final: true }));
  const gotchas = Array.from({ length: 12 }, (_, i) => ['major', `Gotcha ${i + 1}`, 'write it', 'AGENTS.md']);
  const arch = Array.from({ length: 3 }, (_, i) => ['major', `Arch ${i + 1}`, 'map it', 'AGENTS.md']);
  assert.deepEqual(v.issues.map((i) => [i.severity, i.title, i.detail, i.location]), [
    ['critical', 'Score 33/100 is below the pass mark 80', 'Fix the gaps below.', ''],
    ['critical', 'Documented command fails: npm test', 'exit 1 (fail)', 'AGENTS.md'],
    ...gotchas,
    ['major', 'Codex: instructions partial', 'half Fix: Write or complete AGENTS.md', 'AGENTS.md'],
    ...arch,
    ['major', 'commands scored 90/100', 'The judgement listed no gap for it.', ''],
  ]);
  assert.equal(v.summary, 'Blocked: 19 finding(s); score 33/100.');
});

test('profileOf keeps only confirmed facts and the card score', () => {
  const map = { summary: 's', architecture: 'a', stack: { language: 'JS' }, conventions: ['c'], entryPoints: ['e'], tools: ['codex'],
    commands: [{ id: 't', kind: 'test', command: 'npm test', verdict: 'correct' }, { id: 'x', kind: 'lint', command: 'bad', verdict: 'wrong' }],
    gotchas: [{ id: 'g', text: 'keep', verdict: 'confirm' }, { id: 'h', text: 'drop', verdict: 'remove' }],
    recurringTasks: [{ id: 'r', name: 'Add a route', verdict: 'confirm' }, { id: 'q', name: 'No', verdict: 'reject' }] };
  const card = { overall: 40, core: 60, tools: { codex: { score: 40 } } };
  const p = profileOf(map, card, { phase: 'baseline' });
  assert.equal(p.version, 1);
  assert.deepEqual(p.commands, [{ kind: 'test', command: 'npm test' }]);
  assert.deepEqual(p.gotchas, ['keep']);
  assert.deepEqual(p.recurringTasks, [{ id: 'r', name: 'Add a route' }]);
  assert.deepEqual(p.score, { overall: 40, core: 60, tools: { codex: 40 } });
});

test('profileOf on a workspace map keys by member', () => {
  const p = profileOf({ members: { api: { summary: 'a' } } }, { members: { api: { overall: 10, core: 20, tools: {} } } }, { phase: 'final' });
  assert.equal(p.members.api.summary, 'a');
  assert.equal(p.members.api.phase, 'final');
});

test('profileOf on a workspace map appends each member\'s relations to its architecture', () => {
  const map = { tools: ['claude'], runTogether: 'docker compose up', relations: [{ from: 'web', to: 'api', how: 'calls the REST API (web/src/client.ts)' }],
    members: { api: { summary: 'a', architecture: 'API.' }, web: { summary: 'w', architecture: 'Web.' }, docs: { architecture: 'Docs.' } } };
  const p = profileOf(map, { members: { api: { overall: 90, core: 90, tools: {} }, web: { overall: 85, core: 85, tools: {} } } }, { phase: 'final' });
  assert.equal(p.members.web.architecture, 'Web.\nRelated repositories: api (calls the REST API (web/src/client.ts)).\nRun together: docker compose up');
  assert.equal(p.members.api.architecture, 'API.\nRelated repositories: web (uses it: calls the REST API (web/src/client.ts)).\nRun together: docker compose up');
  assert.equal(p.members.docs.architecture, 'Docs.');
  assert.deepEqual(Object.keys(p.members.web), Object.keys(p.members.docs));
});

test('profileOf keeps only relations whose both ends are members', () => {
  const map = { members: { api: { architecture: 'API.' }, web: { architecture: 'Web.' } },
    relations: [{ from: 'ghost', to: 'api', how: 'calls it' }, { from: 'web', to: 'phantom', how: 'calls it' }] };
  const p = profileOf(map, {}, { phase: 'baseline' });
  assert.equal(p.members.api.architecture, 'API.');
  assert.equal(p.members.web.architecture, 'Web.');
});

test('profileOf without relations leaves architecture unchanged', () => {
  const p = profileOf({ runTogether: 'make up', members: { api: { architecture: 'API.' } } }, {}, { phase: 'baseline' });
  assert.equal(p.members.api.architecture, 'API.');
});

test('profileOf on a workspace map gives every member the confirmed top-level tools', () => {
  const map = { tools: ['claude', 'codex'], members: { api: { summary: 'a', tools: ['claude'] }, web: { summary: 'w' } } };
  const p = profileOf(map, { members: {} }, { phase: 'baseline' });
  assert.deepEqual(p.members.api.tools, ['claude', 'codex']);
  assert.deepEqual(p.members.web.tools, ['claude', 'codex']);
  // Without a top-level list, a member keeps its own.
  const q = profileOf({ members: { api: { tools: ['cursor'] } } }, {}, { phase: 'baseline' });
  assert.deepEqual(q.members.api.tools, ['cursor']);
});

test('profileOf output is accepted by the host sanitizer', () => {
  const map = { summary: 's', architecture: 'a', stack: { language: 'JS' }, conventions: ['c'], entryPoints: ['e'], tools: ['codex'],
    commands: [{ id: 't', kind: 'test', command: 'npm test', verdict: 'correct' }],
    gotchas: [{ id: 'g', text: 'keep', verdict: 'confirm' }], recurringTasks: [{ id: 'r', name: 'Add a route' }] };
  const p = profileOf(map, { overall: 40, core: 60, tools: { codex: { score: 40 } } }, { phase: 'baseline' });
  const r = sanitizeProfile(p);
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(r.profile.summary, 's');
  assert.deepEqual(r.profile.commands, [{ kind: 'test', command: 'npm test' }]);
  assert.equal(r.profile.score.tools.codex, 40);
});

function withMap(opts, map) {
  const e = envelope(opts);
  if (map) { writeFileSync(join(e.pd, 'm.json'), JSON.stringify(map)); e.api.inputs.map = { path: join(e.pd, 'm.json') }; }
  e.api.outputs.profile = { type: 'json', path: join(e.pd, 'readiness-profile-baseline.json') };
  return e;
}

test('writes the profile when the map is present and none when it is missing', async () => {
  const a = withMap({ judgement: GOOD }, { summary: 's', commands: [{ kind: 'test', command: 'npm test' }] });
  await run(a.api);
  const p = JSON.parse(readFileSync(join(a.pd, 'readiness-profile-baseline.json'), 'utf8'));
  assert.equal(p.phase, 'baseline');
  assert.equal(p.score.overall, 90);
  const b = withMap({ judgement: GOOD }, null);
  await run(b.api);
  assert.equal(existsSync(join(b.pd, 'readiness-profile-baseline.json')), false);
  const g = withMap({ judgement: GOOD, gate: true }, { summary: 's' });
  await run(g.api);
  assert.equal(JSON.parse(readFileSync(join(g.pd, 'readiness-profile-baseline.json'), 'utf8')).phase, 'final');
});

// --- Claude files section: what Place Claude files did, and the block when it never ran ---
const gen3 = { files: [1, 2, 3].map((i) => ({ path: `.claude/skills/s${i}/SKILL.md`, action: 'staged', tools: [] })).concat([{ path: 'AGENTS.md', action: 'created', tools: [] }]) };
const put = (pd, name, v) => writeFileSync(join(pd, name), JSON.stringify(v));
const CLAUDE_TITLE = 'Staged Claude files were not placed';

test('claude files: a placed json lists the counts, the ignored files and the skip reason, with no extra issue', async () => {
  const { pd, api } = envelope({ judgement: GOOD, gate: true });
  put(pd, 'readiness-generated.json', gen3);
  put(pd, 'readiness-claude-placed.json', { placed: [{ path: 'skills/s1/SKILL.md', ignored: false }, { path: 'skills/s2/SKILL.md', ignored: true }], skipped: [{ path: 'skills/s3/SKILL.md', reason: 'not approved on card B' }] });
  const r = await run(api);
  assert.deepEqual(r.verdict.issues, []);
  const md = readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8');
  assert.match(md, /## Claude files/);
  assert.match(md, /Placed 2 of 3 staged/);
  assert.match(md, /Ignored by \.gitignore, so not committed: `skills\/s2\/SKILL\.md`/);
  assert.match(md, /Skipped `skills\/s3\/SKILL\.md`: not approved on card B/);
  assert.match(readFileSync(join(pd, 'readiness/final-cycle1.html'), 'utf8'), /<h2>Claude files<\/h2>[\s\S]*not approved on card B/);
});

test('claude files: staged files and no placed json block the gate', async () => {
  const { pd, api } = envelope({ judgement: GOOD, gate: true });
  put(pd, 'readiness-generated.json', gen3);
  const r = await run(api);
  const issue = r.verdict.issues.find((i) => i.title === CLAUDE_TITLE);
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.location, 'readiness-claude/');
  assert.match(r.verdict.summary, /^Blocked/);
  assert.match(readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8'), /Generate staged 3 Claude files, but this run has no Place Claude files step, so none were placed\./);
  assert.match(readFileSync(join(pd, 'readiness-findings-cycle1.md'), 'utf8'), /Staged Claude files were not placed/);
});

test('claude files: neither file means no section and today\'s verdict', async () => {
  const { pd, api } = envelope({ judgement: GOOD, gate: true });
  const r = await run(api);
  assert.deepEqual(r.verdict.issues, []);
  assert.doesNotMatch(readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8'), /Claude files/);
  assert.doesNotMatch(readFileSync(join(pd, 'readiness/final-cycle1.html'), 'utf8'), /Claude files/);
  assert.equal(claudeFilesOf(pd), null);
});

test('claude files: the baseline report never reads them', async () => {
  const plain = envelope({ judgement: GOOD });
  await run(plain.api);
  const withFiles = envelope({ judgement: GOOD });
  put(withFiles.pd, 'readiness-generated.json', gen3);
  put(withFiles.pd, 'readiness-claude-placed.json', { placed: [], skipped: [{ path: 'skills/x/SKILL.md', reason: 'r' }] });
  await run(withFiles.api);
  assert.equal(readFileSync(join(withFiles.pd, 'readiness-baseline.md'), 'utf8'), readFileSync(join(plain.pd, 'readiness-baseline.md'), 'utf8'));
  assert.doesNotMatch(readFileSync(join(withFiles.pd, 'readiness/baseline.html'), 'utf8'), /Claude files/);
});

test('claude files: a workspace shows each member\'s result', async () => {
  const probe = { members: { api: PROBE, web: PROBE } };
  const judgement = { members: { api: GOOD, web: GOOD } };
  const { pd, api } = envelope({ judgement, probe, gate: true });
  put(pd, 'readiness-generated.json', { members: { api: gen3, web: { files: [{ path: '.claude/rules/r.md', action: 'staged' }] } } });
  put(pd, 'readiness-claude-placed.json', { members: { api: { placed: [{ path: 'skills/s1/SKILL.md', ignored: false }], skipped: [] }, web: { placed: [], skipped: [{ path: 'rules/r.md', reason: 'outside .claude/skills and .claude/rules' }] } } });
  const r = await run(api);
  assert.deepEqual(r.verdict.issues, []);
  const md = readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8');
  assert.match(md, /### api\n\n- Placed 1 of 3 staged/);
  assert.match(md, /### web\n\n- Placed 0 of 1 staged\.\n- Skipped `rules\/r\.md`: outside/);
  const c = claudeFilesOf(pd);
  assert.equal(c.members.api.placed.length, 1);
  assert.equal(c.members.web.skipped[0].reason, 'outside .claude/skills and .claude/rules');
});

test('generate prompt reports staged Claude files as "staged"', () => {
  const text = readFileSync(new URL('../plugins/ai-readiness/agents/readinessGenerate.md', import.meta.url), 'utf8');
  assert.match(text, /`action: "staged"`/);
  assert.match(text, /created\|updated\|unchanged\|staged/);
});

// --- Gate holds the chip's rule: the fresh api.readiness, not the first step's snapshot ---
const row = (id, status, o = {}) => ({ id, title: o.title || id, scope: o.engine ? 'tool' : 'repository', severity: o.severity || 'warn', status, detail: o.detail || '', fix: o.fix || `fix ${id}`, ...(o.engine ? { engine: o.engine } : {}) });
const CLEAN_ROWS = [row('git.repo', 'pass'), row('commands.test', 'pass'), row('ignore.heavy-dirs', 'pass'), row('deps.lockfile', 'pass'), row('secrets.tracked-names', 'pass')];
const fresh = (checks, o = {}) => ({ engines: ['claude', 'gemini'], labels: { claude: 'Claude', gemini: 'Gemini' }, sources: {}, limits: {}, judged: o.judged || ['claude'], report: { checks } });
function gateRun(readiness, { tools = ['claude'], probe = PROBE, baselineProbe, judgement = GOOD, map } = {}) {
  const e = envelope({ judgement, probe, gate: true });
  const m = map || { tools };
  put(e.pd, 'm.json', m);
  e.api.inputs.map = { path: join(e.pd, 'm.json') };
  if (baselineProbe) put(e.pd, 'readiness-probe.json', baselineProbe);
  e.api.readiness = readiness;
  return e;
}

test('Gate blocks when GEMINI.md is missing and gemini was added on card A', async () => {
  const checks = [...CLEAN_ROWS, row('instructions.present', 'fail', { engine: 'gemini', severity: 'blocker', fix: 'Add GEMINI.md' }), row('instructions.present', 'pass', { engine: 'claude', severity: 'blocker' })];
  const { pd, api } = gateRun(fresh(checks), { tools: ['claude', 'gemini'] });
  const r = await run(api);
  assert.equal(r.verdict.issues.length, 1);
  assert.match(r.verdict.issues[0].title, /Gemini/);
  assert.match(readFileSync(join(pd, 'readiness-findings-cycle1.md'), 'utf8'), /Add GEMINI\.md/);
});

test('Gate ignores an engine that is neither judged nor selected', async () => {
  const checks = [...CLEAN_ROWS, row('instructions.present', 'fail', { engine: 'gemini', severity: 'blocker' })];
  assert.deepEqual((await run(gateRun(fresh(checks), { tools: ['claude'] }).api)).verdict.issues, []);
});

test('Gate passes with a tracked .env and lists it under Outside setup', async () => {
  const checks = [...CLEAN_ROWS.filter((c) => c.id !== 'secrets.tracked-names'), row('secrets.tracked-names', 'fail', { detail: '.env is tracked', fix: 'Remove it and rotate it' }), row('deps.lockfile', 'fail'), row('git.repo', 'fail')];
  const { pd, api } = gateRun(fresh(checks));
  const r = await run(api);
  assert.deepEqual(r.verdict.issues, []);
  const md = readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8');
  assert.match(md, /## Outside setup/);
  assert.match(md, /\.env is tracked/);
  assert.match(md, /Remove it and rotate it/);
  assert.match(readFileSync(join(pd, 'readiness/final-cycle1.html'), 'utf8'), /Outside setup/);
  assert.equal(JSON.parse(readFileSync(join(pd, 'readiness/final-cycle1.json'), 'utf8')).outsideSetup.length, 3);
});

test('Gate blocks on an unignored node_modules and a failing test command', async () => {
  const checks = [...CLEAN_ROWS.filter((c) => c.id !== 'ignore.heavy-dirs' && c.id !== 'commands.test'), row('ignore.heavy-dirs', 'fail', { detail: 'node_modules not ignored', fix: '.gitignore it' }), row('commands.test', 'fail')];
  const r = await run(gateRun(fresh(checks)).api);
  assert.equal(r.verdict.issues.length, 2);
  assert.ok(r.verdict.issues.some((i) => /node_modules not ignored/.test(i.detail)));
});

test('workspace Gate names only the failing member', async () => {
  const bad = fresh([...CLEAN_ROWS.filter((c) => c.id !== 'ignore.heavy-dirs'), row('ignore.heavy-dirs', 'fail', { detail: 'node_modules not ignored' })]);
  const { pd, api } = gateRun({ members: { api: fresh(CLEAN_ROWS), web: bad } }, { judgement: { members: { api: GOOD, web: GOOD } }, probe: { members: { api: PROBE, web: PROBE } }, map: { tools: ['claude'], members: { api: {}, web: {} } } });
  const r = await run(api);
  const lines = readFileSync(join(pd, 'readiness-findings-cycle1.md'), 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(lines[1], 'Members to fix: web');
  assert.ok(r.verdict.issues.every((i) => i.title.startsWith('web: ')));
});

test('a Folder run does not block on git-only checks', async () => {
  const skipped = [row('git.repo', 'skip'), row('commands.test', 'pass'), row('ignore.heavy-dirs', 'pass'), row('deps.lockfile', 'skip'), row('secrets.tracked-names', 'skip'), row('instructions.committed', 'skip', { engine: 'claude' })];
  const { pd, api } = gateRun(fresh(skipped));
  assert.deepEqual((await run(api)).verdict.issues, []);
  assert.doesNotMatch(readFileSync(join(pd, 'readiness-final-cycle1.md'), 'utf8'), /Outside setup/);
});

const withFiles = (copilot) => ({ ...PROBE, files: { 'AGENTS.md': { exists: true }, '.github/copilot-instructions.md': copilot ? { exists: true } : { exists: false } } });

test('Gate fails when setup created .github/copilot-instructions.md', async () => {
  const { api } = gateRun(fresh(CLEAN_ROWS), { baselineProbe: withFiles(false), probe: withFiles(true) });
  const r = await run(api);
  assert.equal(r.verdict.issues.length, 1);
  assert.match(r.verdict.issues[0].title, /never creates \.github\/copilot-instructions\.md/);
});

test('Gate does not fail when copilot-instructions.md was already there', async () => {
  const { api } = gateRun(fresh(CLEAN_ROWS), { baselineProbe: withFiles(true), probe: withFiles(true) });
  assert.deepEqual((await run(api)).verdict.issues, []);
});

test('Gate blocks when the host view is broken (report null, error set)', async () => {
  const { api } = gateRun({ engines: ['claude'], labels: {}, judged: ['claude'], report: null, error: 'boom' });
  const r = await run(api);
  assert.equal(r.verdict.issues.length, 1);
  assert.equal(r.verdict.issues[0].title, 'Readiness view unavailable: boom');
});

test('workspace Gate blocks a member whose view is missing, and names it', async () => {
  const { pd, api } = gateRun({ members: { a: fresh(CLEAN_ROWS) } }, { judgement: { members: { a: GOOD, b: GOOD } }, probe: { members: { a: PROBE, b: PROBE } }, map: { tools: ['claude'], members: { a: {}, b: {} } } });
  const r = await run(api);
  assert.ok(r.verdict.issues.every((i) => i.title.startsWith('b: Readiness view unavailable')));
  assert.equal(r.verdict.issues.length, 1);
  assert.equal(readFileSync(join(pd, 'readiness-findings-cycle1.md'), 'utf8').split('\n').filter((l) => l.trim())[1], 'Members to fix: b');
});
