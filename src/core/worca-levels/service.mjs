// src/core/worca-levels/service.mjs
// The worca-level service: one person's WorcaLevelView, read and acknowledged. Identity comes ONLY from
// resolveIdentity(req); facts are re-read on every getState (gatherFacts), evaluated (evaluate), and the
// result is latched into the person's stored record (store.mjs). Nothing here knows another person.
//
// Server wiring is injected so this module never imports ui/server.mjs:
//   isFreshInstall()      single-person install: past activity = !isFreshInstall()
//   emitChanged(type)     the payload-free poke noteLiveEvent sends
//   gatherFacts, now      tests replace them
import { resolveIdentity, isSharedIdentity } from '../identity.mjs';
import { WORCA_LEVELS } from '../../shared/worca-levels.mjs';
import { evaluate } from './evaluate.mjs';
import { gatherFacts as defaultGatherFacts, requirementCount, countStartedRuns, scheduleFacts } from './facts.mjs';
import { readPerson, updatePerson, recordLive } from './store.mjs';

export const LOCAL_PERSON_KEY = '_local';
export const LIVE_CHANGED_EVENT = 'worca-level-changed';
export const ACK_TARGETS = Object.freeze(['welcome', 'celebration']);

export class WorcaLevelRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorcaLevelRequestError';
    this.code = 'WORCA_LEVEL_BAD_REQUEST';
  }
}

const today = (now) => now().slice(0, 10);

/** { person, shared } for a request: the lowercased name on a shared install, else the fixed key. */
export function personOf(req) {
  const id = resolveIdentity(req);
  const shared = isSharedIdentity(id.source);
  return { person: shared ? id.name.toLowerCase() : LOCAL_PERSON_KEY, shared };
}

/** A person with any req_features, pipelines or schedules row of their own (shared installs only). */
function hasOwnRows(person) {
  const who = { person, shared: true };
  return requirementCount(who) > 0 || countStartedRuns(who) > 0 || scheduleFacts(who).schedules > 0;
}

const pick = ({ index, key, name, avatar }) => ({ index, key, name, avatar });

// D-6: with the requirements flag off #requirements bounces to chat, so the two Swimmer actions that
// point at it name a task and open the new-task page instead.
const NO_REQUIREMENTS_COPY = Object.freeze({
  firstRequirement: Object.freeze({ label: 'Write your first task', hint: 'New task. Describe what you want built.', href: '#new' }),
  firstFeatureDone: Object.freeze({ label: 'Get your first task done', hint: 'New task. Start a task and let it finish.', href: '#new' }),
});

function adaptNext(next, facts) {
  if (!next || facts.requirementsFlag === true) return next;
  return next.map((a) => (NO_REQUIREMENTS_COPY[a.id] ? { ...a, ...NO_REQUIREMENTS_COPY[a.id] } : a));
}

function toView(record, ev, facts) {
  const current = WORCA_LEVELS[ev.level - 1];
  const celebrating = !!record.welcome.seenAt && ev.level > record.celebrated;
  return {
    level: { index: current.index, key: current.key, name: current.name, description: current.description, avatar: current.avatar },
    progress: ev.progress,
    next: adaptNext(ev.next, facts),
    top: ev.top,
    ladder: WORCA_LEVELS.map((l) => ({ ...pick(l), reached: l.index <= ev.level })),
    welcome: record.welcome.seenAt ? null : { kind: record.welcome.kind },
    celebration: celebrating ? pick(current) : null,
  };
}

const sameRecord = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createWorcaLevelService({
  isFreshInstall,
  emitChanged,
  gatherFacts = defaultGatherFacts,
  hasSharedActivity = hasOwnRows,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof isFreshInstall !== 'function') throw new TypeError('worca-level service: isFreshInstall is required');
  if (typeof emitChanged !== 'function') throw new TypeError('worca-level service: emitChanged is required');

  const pastActivity = ({ person, shared }) => (shared ? hasSharedActivity(person) : !isFreshInstall());

  /** The record after this evaluation: created when absent (or only live-touched), else latched. Pure. */
  function advance(rec, ev, kind) {
    const stamp = now();
    if (rec && rec.level >= 1) {
      const next = { ...rec, level: ev.level, doneAt: ev.doneAt };
      return sameRecord(next, rec) ? rec : { ...next, updatedAt: stamp };
    }
    // Creation: the evaluated level is where this person starts, so nothing earlier is celebrated.
    return {
      level: ev.level,
      celebrated: ev.level,
      welcome: { kind, seenAt: null },
      doneAt: ev.doneAt,
      live: rec ? rec.live : { addons: [], spaces: false, statsDays: [], peakParallel: 0 },
      createdAt: rec ? rec.createdAt : stamp,
      updatedAt: stamp,
    };
  }

  /** Compute the view and latch it. Writes only when the record changed. */
  async function sync(req) {
    const who = personOf(req);
    const stored = readPerson(who.person);
    const facts = await gatherFacts({ person: who.person, shared: who.shared, live: stored?.live });
    const ev = evaluate(facts, stored, now());
    // Past activity is asked at creation only; welcome.kind never changes afterwards (I-4).
    const kind = !stored || stored.level < 1 ? (pastActivity(who) ? 'existing' : 'new') : 'new';
    let record = advance(stored, ev, kind);
    if (record !== stored) {
      record = await updatePerson(who.person, (current) => {
        const fresh = evaluate(facts, current, now());
        return advance(current, fresh, kind);
      });
      return toView(record, evaluate(facts, record, now()), facts);
    }
    return toView(record, ev, facts);
  }

  async function getState(req) {
    return sync(req);
  }

  async function ack(req, { what, index } = {}) {
    if (!ACK_TARGETS.includes(what)) throw new WorcaLevelRequestError(`what must be one of: ${ACK_TARGETS.join(', ')}`);
    if (what === 'celebration' && !(Number.isInteger(index) && index >= 1 && index <= WORCA_LEVELS.length)) {
      throw new WorcaLevelRequestError(`index must be the level number that was shown (1 to ${WORCA_LEVELS.length})`);
    }
    await sync(req);                                       // the record exists before it is acknowledged
    const { person } = personOf(req);
    await updatePerson(person, (rec) => {
      if (what === 'welcome') {
        return rec.welcome.seenAt ? rec : { ...rec, welcome: { ...rec.welcome, seenAt: now() }, updatedAt: now() };
      }
      // Only the level that was shown is acknowledged; a level reached since then stays to be celebrated.
      const seen = Math.max(rec.celebrated, Math.min(index, rec.level));
      return seen === rec.celebrated ? rec : { ...rec, celebrated: seen, updatedAt: now() };
    });
    return sync(req);
  }

  async function recordStatsViewed(req) {
    const { person } = personOf(req);
    await recordLive(person, { statsDay: today(now) });     // no backfill: only today is added (D-5)
  }

  async function noteLiveEvent(person, patch) {
    await recordLive(person, patch);
    emitChanged(LIVE_CHANGED_EVENT);
  }

  return { getState, ack, recordStatsViewed, noteLiveEvent };
}
