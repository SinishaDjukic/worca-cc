// server/leaderboard.js
//
// Public cross-agent leaderboard rows for a given benchmark, fetched LIVE from the
// upstream sources (W-075 phase 4), cached with a TTL, and falling back to a small
// static fixture when offline/unreachable so the dashboard still renders.
//
//   - SWE-bench Verified: clean JSON published by the site itself —
//     https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json
//     (filter leaderboards[].name == "Verified"; each result has name/resolved(%)/date/tags).
//   - Commit0: no scores JSON exists; the numbers live only in the static HTML table at
//     https://commit-0.github.io/analysis/ , so we fetch + parse that table.
//
// Tests pass { offline: true } (via createApp) to stay hermetic; the running server
// fetches live.

const SOURCES = {
  'swe-bench-verified': {
    url: 'https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json',
    source: 'swebench.com',
    kind: 'swebench',
  },
  commit0: {
    url: 'https://commit-0.github.io/analysis/',
    source: 'commit-0.github.io',
    kind: 'commit0',
  },
};

// Offline/last-resort fixture (used only when a live fetch fails with no cache).
const SWEBENCH_HOME = 'https://www.swebench.com';
const COMMIT0_HOME = 'https://commit-0.github.io/analysis/';
const FALLBACK = {
  'swe-bench-verified': [
    {
      agent: 'TRAE',
      resolved_rate: 0.7026,
      source: 'swebench.com',
      date: null,
      url: SWEBENCH_HOME,
    },
    {
      agent: 'Augment Agent',
      resolved_rate: 0.654,
      source: 'swebench.com',
      date: null,
      url: SWEBENCH_HOME,
    },
    {
      agent: 'SWE-agent',
      resolved_rate: 0.335,
      source: 'swebench.com',
      date: null,
      url: SWEBENCH_HOME,
    },
  ],
  commit0: [
    {
      agent: 'reference',
      resolved_rate: 0.58,
      source: 'commit-0.github.io',
      date: null,
      url: COMMIT0_HOME,
    },
  ],
};

const TTL_MS = 30 * 60 * 1000; // 30 min
const _cache = new Map(); // key -> { rows, fetchedAt }

function normalizeKey(benchmark) {
  if (benchmark === 'commit-0' || benchmark === 'commit0') {
    return 'commit0';
  }
  return benchmark;
}

function localRow() {
  return {
    agent: 'worca (this run)',
    resolved_rate: null,
    source: 'local',
    date: null,
    url: null,
  };
}

// ----------------------------- pure parsers ------------------------------ //

/** Parse the SWE-bench site leaderboards.json into Verified rows (descending). */
export function parseSwebenchVerified(data) {
  const board = (data?.leaderboards || []).find((b) => b.name === 'Verified');
  const rows = (board?.results || []).map((r) => ({
    agent: r.name,
    resolved_rate: typeof r.resolved === 'number' ? r.resolved / 100 : null,
    date: r.date || null,
    source: 'swebench.com',
    // Per-entry deep link: the system's own result page (the same link the
    // swebench.com leaderboard uses for that row).
    url: r.site || null,
  }));
  return rows.sort((a, b) => (b.resolved_rate ?? -1) - (a.resolved_rate ?? -1));
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve a possibly-relative href against the page base; null on failure. */
function resolveHref(href, base) {
  if (!href) {
    return null;
  }
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Parse the Commit0 analysis HTML table(s) into rows (Tests-Passed % as the rate).
 * Per-row links (the "Analysis" link, else the first link) are captured as `url`,
 * resolved to absolute against `base`.
 */
export function parseCommit0Html(html, base = SOURCES.commit0.url) {
  const rows = [];
  const seen = new Set();
  const bodies = html.match(/<tbody[\s\S]*?<\/tbody>/gi) || [];
  for (const body of bodies) {
    const trs = body.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map(stripTags);
      if (cells.length < 2) {
        continue;
      }
      const agent = cells[0];
      if (!agent || seen.has(agent)) {
        continue;
      }
      const pctCell = cells.find((c) => c.includes('%'));
      let rate = null;
      if (pctCell) {
        const m = pctCell.match(/([\d.]+)\s*%/);
        if (m) {
          rate = Number.parseFloat(m[1]) / 100;
        }
      }
      const dateCell = cells.find((c) =>
        /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/.test(c),
      );
      const hrefs = [...tr.matchAll(/href="([^"]*)"/gi)].map((m) => m[1]);
      const pick = hrefs.find((h) => /analysis/i.test(h)) || hrefs[0] || null;
      seen.add(agent);
      rows.push({
        agent,
        resolved_rate: rate,
        date: dateCell || null,
        source: 'commit-0.github.io',
        url: resolveHref(pick, base),
      });
    }
  }
  return rows.sort((a, b) => (b.resolved_rate ?? -1) - (a.resolved_rate ?? -1));
}

// ------------------------------- fetching -------------------------------- //

async function fetchText(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'worca-bench-dashboard' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLive(key, fetchImpl, timeoutMs) {
  const src = SOURCES[key];
  const text = await fetchText(src.url, fetchImpl, timeoutMs);
  if (src.kind === 'swebench') {
    return parseSwebenchVerified(JSON.parse(text));
  }
  return parseCommit0Html(text);
}

/**
 * Return leaderboard rows for a benchmark — live, cached, with offline fallback.
 * The first row is always the local "this run" placeholder.
 *
 * @param {string} benchmark
 * @param {{offline?: boolean, fetchImpl?: typeof fetch, now?: () => number, timeoutMs?: number}} [opts]
 * @returns {Promise<Array<{agent:string, resolved_rate:number|null, source:string, date:string|null}>>}
 */
export async function getLeaderboard(benchmark, opts = {}) {
  const key = normalizeKey(benchmark);
  if (!SOURCES[key]) {
    return [];
  }
  const {
    offline = false,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeoutMs = 5000,
  } = opts;

  if (offline) {
    return [localRow(), ...FALLBACK[key]];
  }

  const ts = now();
  const cached = _cache.get(key);
  if (cached && ts - cached.fetchedAt < TTL_MS) {
    return [localRow(), ...cached.rows];
  }

  try {
    const rows = await fetchLive(key, fetchImpl, timeoutMs);
    if (!rows.length) {
      throw new Error('no rows parsed');
    }
    _cache.set(key, { rows, fetchedAt: ts });
    return [localRow(), ...rows];
  } catch {
    // stale-on-error, then static fallback
    if (cached) {
      return [localRow(), ...cached.rows];
    }
    return [localRow(), ...FALLBACK[key]];
  }
}

/** Benchmarks with a leaderboard source. */
export function leaderboardBenchmarks() {
  return Object.keys(SOURCES);
}

/** Test seam: clear the in-memory cache. */
export function _resetLeaderboardCache() {
  _cache.clear();
}
