// ui/public/exec-env-status.mjs — the execution environment status chip (GET /api/exec-envs/status): "connected · N of
// cap in use", "unreachable", "key refused", "not set up". It keeps itself current with no buttons: the watch polls
// while a chip is on screen and the tab is visible, at once when one appears, and holds no timer otherwise. The
// server caches a few seconds. An entry has a `servers` list (one server today); the chip reads the first.
export const STATUS_POLL_MS = 5_000;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** { text, tone: 'ok'|'warn'|'bad'|'muted', title } for one backend entry (null: not known yet). */
export function execEnvStatusText(entry) {
  const s = entry?.servers?.[0];
  if (!s) return { text: 'checking…', tone: 'muted', title: 'Checking the execution environment…' };
  const head = `${entry.title || entry.name}: ${s.label}`;
  const why = s.error ? ` — ${s.error}` : '';
  if (s.state === 'connected') {
    const full = Number.isFinite(s.cap) && s.running >= s.cap;
    const waiting = s.waiting > 0 ? ` · ${s.waiting} waiting` : '';
    return { text: `connected · ${s.running} of ${s.cap} in use${waiting}`, tone: full || s.waiting > 0 ? 'warn' : 'ok',
      title: `${head}\n${plural(s.running, 'sandbox', 'sandboxes')} running of ${s.cap} allowed${s.waiting > 0 ? `; ${plural(s.waiting, 'run waits', 'runs wait')} for a slot` : ''}` };
  }
  if (s.state === 'key-refused') return { text: 'key refused', tone: 'bad', title: `${head}\nThe server refused the API key${why}` };
  if (s.state === 'not-configured') return { text: 'not set up', tone: 'muted', title: `${head}${why}` };
  return { text: 'unreachable', tone: 'bad', title: `${head}\nThe server did not answer${why}` };
}

/** Paint one chip. `hide: true` with no entry hides it (e.g. New run on Local). */
export function paintExecEnvStatusChip(chip, entry, { hide = false } = {}) {
  if (!chip) return;
  if (!entry && hide) { chip.hidden = true; return; }
  const t = execEnvStatusText(entry);
  chip.hidden = false;
  chip.textContent = t.text;
  chip.dataset.tone = t.tone;
  chip.title = t.title;
}

/** Polls every `intervalMs` while active, starting at once; inactive, it holds no timer (so a page or a jsdom test
 *  with no chip on screen runs nothing). setActive(on) is driven by whether a chip is on screen; onStatus(list) after
 *  each good fetch, and a failed fetch keeps the last paint. refresh() polls now; stop() ends it. */
export function watchExecEnvStatus({ fetchFn = (u) => fetch(u), onStatus = () => {}, intervalMs = STATUS_POLL_MS,
  schedule = (f, ms) => setTimeout(f, ms), cancel = (t) => clearTimeout(t) } = {}) {
  let timer = null; let active = false; let stopped = false; let gen = 0;
  async function poll() {
    if (stopped) return;
    try {
      const r = await fetchFn('/api/exec-envs/status');
      const list = r.ok ? (await r.json())?.execEnvs : null;
      if (!stopped && Array.isArray(list)) onStatus(list);
    } catch { /* offline or an older server: keep the last status */ }
  }
  // One loop per activation: a loop from an earlier activation (on, off, on while its fetch was out) ends itself.
  async function tick(g) {
    timer = null;
    await poll();
    if (g === gen && active && !stopped) timer = schedule(() => tick(g), intervalMs);
  }
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  return {
    setActive(on) {
      on = !!on && !stopped;
      if (on === active) return;
      active = on; gen++; clear();
      if (on) void tick(gen);
    },
    refresh: poll,
    stop() { stopped = true; active = false; clear(); },
  };
}
