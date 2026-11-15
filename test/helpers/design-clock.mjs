// A fake clock for the Design stage's browser modules (frame host, reveal, overlay, stage): timers and animation
// frames on one hand-driven `now`, in ms from 0. Every member is a plain closure, so a rig can hand them out
// unbound (`setTimer: clock.set`, `win.setTimeout = clock.set`, `performance.now = () => clock.now`).
//
//   set(fn, ms, ...args) -> id    a timer due at now + ms (a bad or negative ms is 0)
//   clear(id)                     drops a timer
//   raf(fn) -> id                 queues an animation-frame callback
//   cancelRaf(id)                 drops a queued callback
//   now                           the current time (a getter)
//   tick(ms)                      walks time forward to now + ms, firing each due timer in (due, id) order,
//                                 `now` at its due time, including timers set while ticking; never frames
//   jump(ms)                      moves `now` first, then fires every timer due by then once, in (due, id) order,
//                                 without firing the timers they set: a hidden tab's single late wake
//   frame()                       runs the callbacks queued before the call, with `now`
//   pending() -> number           timers plus queued frames

const RUNAWAY = 100000;

/** @returns {{ set: Function, clear: Function, raf: Function, cancelRaf: Function, readonly now: number,
 *   tick: (ms?: number) => void, jump: (ms?: number) => void, frame: () => void, pending: () => number }} */
export function fakeClock() {
  const timers = new Map();
  const frames = new Map();
  let now = 0;
  let nextId = 1;

  const set = (fn, ms, ...args) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  const clear = (id) => { timers.delete(id); };
  const raf = (fn) => {
    const id = nextId++;
    frames.set(id, fn);
    return id;
  };
  const cancelRaf = (id) => { frames.delete(id); };

  // The earliest timer due by `end`, ties by id (the order they were set), or null.
  const earliest = (end) => {
    let found = null;
    for (const [id, t] of timers) {
      if (t.at <= end && (!found || t.at < found.t.at)) found = { id, t };
    }
    return found;
  };

  return {
    set,
    clear,
    raf,
    cancelRaf,
    get now() { return now; },
    tick(ms = 0) {
      const end = now + Math.max(0, Number(ms) || 0);
      for (let runs = 0; ; runs++) {
        if (runs > RUNAWAY) throw new Error('fake clock: timers keep rescheduling themselves');
        const due = earliest(end);
        if (!due) break;
        timers.delete(due.id);
        now = due.t.at;
        due.t.fn(...due.t.args);
      }
      now = end;
    },
    jump(ms = 0) {
      now += Math.max(0, Number(ms) || 0);
      const due = [...timers].filter(([, t]) => t.at <= now).sort(([a, x], [b, y]) => x.at - y.at || a - b);
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        t.fn(...t.args);
      }
    },
    frame() {
      for (const id of [...frames.keys()]) {
        const fn = frames.get(id);
        if (!fn) continue;
        frames.delete(id);
        fn(now);
      }
    },
    pending() { return timers.size + frames.size; },
  };
}
