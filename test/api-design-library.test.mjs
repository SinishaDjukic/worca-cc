// test/api-design-library.test.mjs — Design P6: `GET /api/design` on the real server, the Library's one read. A row
// holds exactly what a tile draws, `costKnown` included (an unknown cost reads `cost unknown`, never `$0`), and with no
// Chrome its `thumb` stays null: `WORCA_CHROME=none` keeps a real Chrome from starting inside `npm test`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const prevChrome = process.env.WORCA_CHROME;
process.env.WORCA_CHROME = 'none';
after(() => {
  if (prevChrome === undefined) delete process.env.WORCA_CHROME;
  else process.env.WORCA_CHROME = prevChrome;
});

const { bootDesignChat } = await import('./helpers/design-chat-boot.mjs');
const { call, openWs, waitFrame, base } = await bootDesignChat(after);
// Seeded after the boot, so the design lands in the booted home.
const { seedDone } = await import('./helpers/design-export-seed.mjs');

// First: the server's thumbnail maker remembers a Chrome lookup that found none for a minute, so the row that has a
// (fake) Chrome runs before any listing under `WORCA_CHROME=none`.
test('in the real server: listing a finished design renders its thumbnail, sends design-thumb and serves the PNG', { skip: process.platform === 'win32' && 'the fake Chrome is a sh script' }, async () => {
  const bin = mkdtempSync(join(tmpdir(), 'worca-fake-chrome-'));
  const fake = join(bin, 'chrome');
  writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do case "$a" in --screenshot=*) printf PNG > "${a#--screenshot=}";; esac; done\n');
  chmodSync(fake, 0o755);
  const frames = []; await openWs((f) => frames.push(f));
  const d = seedDone();
  process.env.WORCA_CHROME = fake;
  try {
    const first = await call('GET', '/api/design');
    assert.equal(first.body.find((x) => x.id === d.id).thumb, null, 'the picture is not there yet');
    const frame = await waitFrame(frames, (f) => f.type === 'design-thumb' && f.designId === d.id);
    assert.match(frame.thumb, new RegExp(`^/api/design/${d.id}/thumb\\?v=\\d+$`));
    assert.equal((await call('GET', '/api/design')).body.find((x) => x.id === d.id).thumb, frame.thumb);
    const png = await fetch(`${base}${frame.thumb}`);
    assert.deepEqual([png.status, png.headers.get('content-type'), await png.text()], [200, 'image/png', 'PNG']);
  } finally {
    process.env.WORCA_CHROME = 'none';
    rmSync(bin, { recursive: true, force: true });
  }
});
test('GET /api/design: a finished design row holds exactly the tile fields, with no thumbnail when there is no Chrome', async () => {
  const d = seedDone();
  const r = await call('GET', '/api/design');
  assert.equal(r.status, 200);
  const row = r.body.find((x) => x.id === d.id);
  assert.deepEqual(Object.keys(row).sort(), ['costKnown', 'costUsd', 'id', 'kind', 'status', 'thumb', 'title', 'updatedAt']);
  assert.deepEqual([row.title, row.kind, row.status, row.costUsd, row.costKnown, row.thumb], ['Ship Radar', 'web', 'done', 0, true, null]);
});
