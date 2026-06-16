import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

function writeResults(dir, rows) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'results.jsonl'),
    `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
  );
}

function row(profile) {
  return {
    schema_version: 1,
    profile,
    benchmark: 'swe-bench-verified',
    instance_id: 'i1',
    worca_ref: 'local',
    template: 'builtin:feature',
    rep: 1,
    status: 'graded',
    resolved: true,
    score: 1.0,
    cost_usd: 0.1,
    wall_time_s: 1,
    loop_counters: {},
    completed_at: '2026-06-16T10:00:00Z',
  };
}

async function withServer(opts, fn) {
  const server = createServer(createApp(opts));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

let home;
let primaryDir;
let extraDir;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wb-home-'));
  primaryDir = mkdtempSync(join(tmpdir(), 'wb-primary-'));
  extraDir = mkdtempSync(join(tmpdir(), 'wb-extra-'));
});

describe('settings API + multi-dir aggregation', () => {
  it('GET /api/settings reports primary, configured, effective', async () => {
    await withServer(
      { targetDir: primaryDir, settingsHome: home },
      async (base) => {
        const s = await (await fetch(`${base}/api/settings`)).json();
        expect(s.ok).toBe(true);
        expect(s.primary).toBe(resolve(primaryDir));
        expect(s.configured).toEqual([]);
        expect(s.effective).toEqual([resolve(primaryDir)]);
      },
    );
  });

  it('POST adds a dir, DELETE removes it', async () => {
    await withServer(
      { targetDir: primaryDir, settingsHome: home },
      async (base) => {
        const added = await (
          await fetch(`${base}/api/settings/dirs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: extraDir }),
          })
        ).json();
        expect(added.configured).toEqual([resolve(extraDir)]);
        expect(added.effective).toContain(resolve(extraDir));

        const removed = await (
          await fetch(`${base}/api/settings/dirs`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: extraDir }),
          })
        ).json();
        expect(removed.configured).toEqual([]);
      },
    );
  });

  it('POST a non-existent dir returns 400', async () => {
    await withServer(
      { targetDir: primaryDir, settingsHome: home },
      async (base) => {
        const res = await fetch(`${base}/api/settings/dirs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: '/no/such/dir' }),
        });
        expect(res.status).toBe(400);
      },
    );
  });

  it('aggregates profiles across primary + configured dirs', async () => {
    writeResults(primaryDir, [row('alpha')]);
    writeResults(extraDir, [row('beta')]);
    await withServer(
      { targetDir: primaryDir, settingsHome: home },
      async (base) => {
        // before adding the extra dir: only alpha
        let profiles = (await (await fetch(`${base}/api/profiles`)).json())
          .profiles;
        expect(profiles.map((p) => p.name)).toEqual(['alpha']);

        await fetch(`${base}/api/settings/dirs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: extraDir }),
        });

        // after: both, aggregated
        profiles = (await (await fetch(`${base}/api/profiles`)).json())
          .profiles;
        expect(profiles.map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
      },
    );
  });
});
