// test/docs-site-changelog.test.mjs
// The docs.worca.dev changelog build (docs-site/changelog.mjs): the entries.json
// contract and a full build of the repo's real entries into a temp dir. The
// worca-release skill runs this file before --publish-changelog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEntries, buildChangelog, pageSummary } from '../docs-site/changelog.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FRAGMENT = `<title>Worca — What's new in 9.9.0</title>
<style>body{}</style>
<div class="wrap">
  <section class="sec hero" id="s0"><h1>What's new</h1><p class="sub">Since 9.8.0 — <b>faster</b> runs &amp; fewer clicks.</p>
    <img src="shots/9.9.0/s0.jpg" alt=""></section>
  <section class="sec" id="s1"><h2>Runs start<br>faster.</h2></section>
  <section class="sec" id="s2"><div><h2 class="x">Team &amp; policy.</h2></div></section>
  <section class="sec polish" id="s3"><h2>Shipped, tested, verified live.</h2></section>
</div>`;

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worca-docs-cl-'));
}

function changelogDir(entries, pages) {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'entries.json'), JSON.stringify(entries));
  for (const v of pages) fs.writeFileSync(path.join(dir, `worca-app-v${v}.src.html`), FRAGMENT);
  return dir;
}

test('readEntries: newest first, and every entry needs its page and every page its entry', async () => {
  const ok = changelogDir(
    [{ version: '1.2.0-rc.3', since: '1.1.1', date: '2026-09-03' }, { version: '1.10.0', since: '1.9.0', date: '2026-10-01' }, { version: '1.2.0', since: '1.1.1', date: '2026-09-10' }],
    ['1.2.0-rc.3', '1.10.0', '1.2.0'],
  );
  const got = await readEntries(ok, fs.readdirSync(ok));
  assert.deepEqual(got.map((e) => e.version), ['1.10.0', '1.2.0', '1.2.0-rc.3']);

  const noPage = changelogDir([{ version: '1.0.0', since: '0.9.0', date: '2026-01-01' }], []);
  await assert.rejects(readEntries(noPage, fs.readdirSync(noPage)), /worca-app-v1\.0\.0\.src\.html does not exist/);

  const noEntry = changelogDir([], ['1.0.0']);
  await assert.rejects(readEntries(noEntry, fs.readdirSync(noEntry)), /has no entry in entries\.json/);

  const badDate = changelogDir([{ version: '1.0.0', since: '0.9.0', date: '1 Jan' }], ['1.0.0']);
  await assert.rejects(readEntries(badDate, fs.readdirSync(badDate)), /bad date/);

  const dup = changelogDir([{ version: '1.0.0', since: '0.9.0', date: '2026-01-01' }, { version: '1.0.0', since: '0.9.0', date: '2026-01-01' }], ['1.0.0']);
  await assert.rejects(readEntries(dup, fs.readdirSync(dup)), /duplicate version/);
});

test('the repo\'s real changelog builds: every page, every image, every release in the list', async () => {
  const dist = tmpdir();
  const template = fs.readFileSync(path.join(REPO, 'docs-site/src/changelog.html'), 'utf8');
  const entries = await buildChangelog({ repoRoot: REPO, dist, template, vars: { REPO_URL: 'https://example.test', BUILD_DATE: '2026-09-29' } });
  assert.ok(entries.length >= 5, 'the backfilled entries are all there');

  const list = fs.readFileSync(path.join(dist, 'changelog/index.html'), 'utf8');
  assert.doesNotMatch(list, /\{\{/);
  for (const { version } of entries) {
    const dir = path.join(dist, 'changelog', version);
    const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(page, /^<!doctype html>/, `${version}: document shell`);
    const srcs = [...page.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length > 0, `${version}: has images`);
    for (const src of srcs) {
      if (/^(data:|https?:)/.test(src)) continue;
      assert.ok(!src.includes('/'), `${version}: ${src} points next to the page`);
      assert.ok(fs.existsSync(path.join(dir, src)), `${version}: ${src} was copied`);
    }
    assert.ok(list.includes(`href="/changelog/${version}/"`), `${version}: in the release list`);
  }

  // The feed the app's update dialog reads (GET /api/app/update/preview → changes).
  const feed = JSON.parse(fs.readFileSync(path.join(dist, 'changelog/index.json'), 'utf8'));
  assert.deepEqual(feed.releases.map((r) => r.version), entries.map((e) => e.version), 'one record per entry, newest first');
  for (const r of feed.releases) {
    assert.equal(r.url, `https://docs.worca.dev/changelog/${r.version}/`);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.sections.length > 0, `${r.version}: has sections`);
    assert.ok(r.sections.every((s) => typeof s.title === 'string' && s.title && typeof s.kicker === 'string'), `${r.version}: sections are kicker + title`);
    assert.deepEqual(Object.keys(r).sort(), ['date', 'sections', 'sub', 'url', 'version']);
  }
});

test('pageSummary: each section carries its kicker (empty when the page has none)', () => {
  const html = '<section class="sec" id="s1"><span class="kicker"><span class="dot" style="background:var(--info)"></span>Chat &amp; runs</span><h2>Find the <b>run</b>.</h2></section>'
    + '<section class="sec" id="s2"><h2>No kicker.</h2></section>';
  assert.deepEqual(pageSummary(html).sections, [
    { id: 's1', kicker: 'Chat & runs', title: 'Find the run.' },
    { id: 's2', kicker: '', title: 'No kicker.' },
  ]);
});
