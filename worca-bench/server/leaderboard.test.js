import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetLeaderboardCache,
  getLeaderboard,
  leaderboardBenchmarks,
  parseCommit0Html,
  parseSwebenchVerified,
} from './leaderboard.js';

afterEach(() => _resetLeaderboardCache());

describe('parseSwebenchVerified', () => {
  it('extracts the Verified board, converts % to a rate, sorts desc', () => {
    const data = {
      leaderboards: [
        { name: 'Lite', results: [{ name: 'x', resolved: 99 }] },
        {
          name: 'Verified',
          results: [
            { name: 'low', resolved: 33.5, date: '2025-01-01' },
            {
              name: 'high',
              resolved: 79.2,
              date: '2025-12-15',
              site: 'https://sys.example/high',
            },
          ],
        },
      ],
    };
    const rows = parseSwebenchVerified(data);
    expect(rows.map((r) => r.agent)).toEqual(['high', 'low']);
    expect(rows[0].resolved_rate).toBeCloseTo(0.792);
    expect(rows[0].source).toBe('swebench.com');
    expect(rows[0].date).toBe('2025-12-15');
    expect(rows[0].url).toBe('https://sys.example/high'); // per-entry deep link
  });

  it('is tolerant of a missing board', () => {
    expect(parseSwebenchVerified({ leaderboards: [] })).toEqual([]);
    expect(parseSwebenchVerified({})).toEqual([]);
  });

  it('links to the experiments result folder when present', () => {
    const rows = parseSwebenchVerified({
      leaderboards: [
        {
          name: 'Verified',
          results: [{ name: 'x', resolved: 50, folder: '20260101_sys' }],
        },
      ],
    });
    expect(rows[0].url).toBe(
      'https://github.com/SWE-bench/experiments/tree/main/evaluation/verified/20260101_sys',
    );
  });

  it('drops a non-http(s) site URL (XSS guard)', () => {
    const rows = parseSwebenchVerified({
      leaderboards: [
        {
          name: 'Verified',
          results: [{ name: 'x', resolved: 50, site: 'javascript:alert(1)' }],
        },
      ],
    });
    expect(rows[0].url).toBeNull();
  });
});

describe('parseCommit0Html', () => {
  it('parses table rows, reads Tests-Passed % as the rate', () => {
    const html = `
      <table><tbody>
        <tr><td><a href="https://github.com/x">Claude Base</a></td><td>9/16</td><td>82.3% (179/215)</td><td>12m</td><td>09/25/2024</td><td><a href="../analysis/claude">view</a></td></tr>
        <tr><td>Other Sys</td><td>4/16</td><td>40.0% (50/125)</td><td>5m</td><td>10/01/2024</td></tr>
      </tbody></table>`;
    const rows = parseCommit0Html(html, 'https://commit-0.github.io/analysis/');
    expect(rows.map((r) => r.agent)).toEqual(['Claude Base', 'Other Sys']);
    expect(rows[0].resolved_rate).toBeCloseTo(0.823);
    expect(rows[0].date).toBe('09/25/2024');
    expect(rows[0].source).toBe('commit-0.github.io');
    // prefers the analysis link, resolved to absolute
    expect(rows[0].url).toBe('https://commit-0.github.io/analysis/claude');
  });

  it('dedupes by agent name and tolerates empty html', () => {
    expect(parseCommit0Html('<p>no tables</p>')).toEqual([]);
  });

  it('drops a javascript: href (XSS guard)', () => {
    const html =
      '<table><tbody><tr><td>Sys</td><td>40% (1/2)</td>' +
      '<td><a href="javascript:alert(1)">x</a></td></tr></tbody></table>';
    const rows = parseCommit0Html(html, 'https://commit-0.github.io/analysis/');
    expect(rows[0].url).toBeNull();
  });
});

describe('getLeaderboard', () => {
  it('offline returns the fallback with a local row prepended', async () => {
    const rows = await getLeaderboard('swe-bench-verified', { offline: true });
    expect(rows[0].source).toBe('local');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('fetches live, caches, then serves from cache without re-fetching', async () => {
    const json = JSON.stringify({
      leaderboards: [
        { name: 'Verified', results: [{ name: 'A', resolved: 50 }] },
      ],
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => json }));
    let t = 1000;
    const now = () => t;

    const first = await getLeaderboard('swe-bench-verified', {
      fetchImpl,
      now,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.find((r) => r.agent === 'A').resolved_rate).toBeCloseTo(0.5);

    t = 2000; // within TTL
    await getLeaderboard('swe-bench-verified', { fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // served from cache
  });

  it('falls back to the static fixture when the live fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const rows = await getLeaderboard('commit0', { fetchImpl });
    expect(rows[0].source).toBe('local');
    expect(rows.some((r) => r.source === 'commit-0.github.io')).toBe(true);
  });

  it('accepts the commit-0 alias and lists both benchmarks', async () => {
    expect(leaderboardBenchmarks()).toEqual(['swe-bench-verified', 'commit0']);
    const rows = await getLeaderboard('commit-0', { offline: true });
    expect(rows.length).toBeGreaterThan(0);
  });
});
