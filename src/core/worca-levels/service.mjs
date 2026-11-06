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
import { WORCA_LEVELS, WORCA_LEVEL_COUNT, WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';
import { isValidTimeZone } from '../../shared/schedule/recurrence.mjs';
import { evaluate } from './evaluate.mjs';
import { gatherFacts as defaultGatherFacts, requirementCount, countStartedRuns, scheduleFacts } from './facts.mjs';
import { readPerson, updatePerson, recordLive } from './store.mjs';

export const LOCAL_PERSON_KEY = '_local';
export const LIVE_CHANGED_EVENT = 'worca-level-changed';
export const ACK_TARGETS = Object.freeze(['welcome', 'celebration']);
export const VIEWED_TYPES = Object.freeze(['stats-viewed', 'team-metrics-viewed']);

export class WorcaLevelRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorcaLevelRequestError';
    this.code = 'WORCA_LEVEL_BAD_REQUEST';
  }
}

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

const TEAM_POLICY_HREF = '#team-policy';
const TEAM_POLICY_OPEN_LABEL = 'Open Team policy';

// D-6: with the requirements flag off #requirements bounces to chat, so the two Swimmer actions that
// point at it name a task and open the new-task page instead.
const NO_REQUIREMENTS_COPY = Object.freeze({
  firstRequirement: Object.freeze({ label: 'Write your first task', hint: 'New task. Describe what you want built.', href: '#new' }),
  firstFeatureDone: Object.freeze({ label: 'Get your first task done', hint: 'New task. Start a task and let it finish.', href: '#new' }),
});

function adaptNext(next, facts) {
  if (!next) return next;
  return next.map((a) => {
    let adapted = a;
    if (facts.requirementsFlag !== true && NO_REQUIREMENTS_COPY[a.id]) adapted = { ...adapted, ...NO_REQUIREMENTS_COPY[a.id] };
    // D-8: Team metrics is reached through Team policy until a policy is installed.
    if (a.id === 'teamMetrics' && facts.policyInstalled !== true) {
      adapted = { ...adapted, href: TEAM_POLICY_HREF, openLabel: TEAM_POLICY_OPEN_LABEL };
    }
    return adapted;
  });
}

const levelView = ({ index, key, name, tint, hue, tagline, description, hat, phrase, recap, avatar }) =>
  ({ index, key, name, tint, hue, tagline, description, hat, phrase, recap, avatar });

function ladderState(index, level) {
  if (index < level) return 'reached';
  if (index === level) return 'current';
  return index === level + 1 ? 'next' : 'later';
}

function celebrationView(current, ev) {
  const { index, key, name, tint, hue, hat, phrase, recap, avatar } = current;
  return {
    index, key, name, tint, hue, hat, phrase, recap, avatar,
    nextName: ev.nextLevel?.name ?? null,
    nextTotal: ev.progress?.total ?? null,
    nextUnit: ev.progress?.unit ?? null,
  };
}

function toView(record, ev, facts) {
  const current = WORCA_LEVELS[ev.level - 1];
  const celebrating = !!record.welcome.seenAt && ev.level > record.celebrated;
  return {
    count: WORCA_LEVEL_COUNT,
    level: levelView(current),
    progress: ev.progress,
    next: adaptNext(ev.next, facts),
    nextLevel: ev.nextLevel,
    top: ev.top,
    ladder: WORCA_LEVELS.map(({ index, key, name, tint, hue, description, avatar }) =>
      ({ index, key, name, tint, hue, description, avatar, state: ladderState(index, ev.level) })),
    welcome: record.welcome.seenAt ? null : { kind: record.welcome.kind },
    celebration: celebrating ? celebrationView(current, ev) : null,
  };
}

/** D-13: the fact sources that cannot change the answer this time are not read. */
function skipSet(stored) {
  const done = stored?.doneAt ?? {};
  const skip = new Set();
  if (done.parallelFeatures) skip.add('parallel');
  if (done.councilStreak) skip.add('council');
  if (!(stored?.level === 3 && !done.teamMetrics)) skip.add('teamMetrics');
  return skip;
}

/** D-6: a valid request zone wins and is stored; otherwise the stored zone, else the server's. An invalid zone never fails. */
function resolveTz(requested, stored) {
  if (isValidTimeZone(requested)) return { zone: requested, fresh: requested };
  const zone = isValidTimeZone(stored?.tz) ? stored.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { zone, fresh: null };
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
  // D-11: 'existing' only with past activity AND a backfilled level above Curious; otherwise 'new'.
  const welcomeKind = (who, level) => (level > 1 && pastActivity(who) ? 'existing' : 'new');

  /** The record after this evaluation: created when absent (or only live-touched), else latched. Pure. */
  function advance(rec, ev, kind, freshTz) {
    const stamp = now();
    if (rec && rec.level >= 1) {
      const next = { ...rec, level: ev.level, doneAt: ev.doneAt, tz: freshTz ?? rec.tz ?? null };
      return sameRecord(next, rec) ? rec : { ...next, updatedAt: stamp };
    }
    // Creation: the evaluated level is where this person starts, so nothing earlier is celebrated.
    return {
      level: ev.level,
      celebrated: ev.level,
      welcome: { kind, seenAt: null },
      doneAt: ev.doneAt,
      tz: freshTz ?? rec?.tz ?? null,
      live: rec ? rec.live : { addons: [], addonPeak: 0, spaces: false, statsViewedAt: null, teamMetricsOpenedAt: null },
      createdAt: rec ? rec.createdAt : stamp,
      updatedAt: stamp,
    };
  }

  /** Compute the view and latch it. Writes only when the record changed. */
  async function sync(req, requestedTz) {
    const who = personOf(req);
    const stored = readPerson(who.person);
    const tz = resolveTz(requestedTz, stored);
    const facts = await gatherFacts({ person: who.person, shared: who.shared, live: stored?.live, tz: tz.zone, skip: skipSet(stored) });
    const ev = evaluate(facts, stored, now());
    // Past activity is asked at creation only; welcome.kind never changes afterwards (I-4).
    const kind = !stored || stored.level < 1 ? welcomeKind(who, ev.level) : 'new';
    let record = advance(stored, ev, kind, tz.fresh);
    if (record !== stored) {
      record = await updatePerson(who.person, (current) => {
        const fresh = evaluate(facts, current, now());
        return advance(current, fresh, kind, tz.fresh);
      });
      return toView(record, evaluate(facts, record, now()), facts);
    }
    return toView(record, ev, facts);
  }

  async function getState(req, { tz } = {}) {
    return sync(req, tz);
  }

  async function ack(req, { what, index, tz } = {}) {
    if (!ACK_TARGETS.includes(what)) throw new WorcaLevelRequestError(`what must be one of: ${ACK_TARGETS.join(', ')}`);
    if (what === 'celebration' && !(Number.isInteger(index) && index >= 1 && index <= WORCA_LEVEL_COUNT)) {
      throw new WorcaLevelRequestError(`index must be the level number that was shown (1 to ${WORCA_LEVEL_COUNT})`);
    }
    await sync(req, tz);                                   // the record exists before it is acknowledged
    const { person } = personOf(req);
    await updatePerson(person, (rec) => {
      if (what === 'welcome') {
        return rec.welcome.seenAt ? rec : { ...rec, welcome: { ...rec.welcome, seenAt: now() }, updatedAt: now() };
      }
      // Only the level that was shown is acknowledged; a level reached since then stays to be celebrated.
      const seen = Math.max(rec.celebrated, Math.min(index, rec.level));
      return seen === rec.celebrated ? rec : { ...rec, celebrated: seen, updatedAt: now() };
    });
    return sync(req, tz);
  }

  /** True when opening Team metrics counts: a policy is installed and 10 of the person's runs are in it (R-po-33, R-po-38). */
  async function teamMetricsReady(who, stored, tz) {
    const skip = new Set(['parallel', 'council']);        // never skip the count source here (D-13)
    const facts = await gatherFacts({ person: who.person, shared: who.shared, live: stored?.live, tz: tz.zone, skip });
    return facts.policyInstalled === true && facts.teamMetricsRuns >= WORCA_THRESHOLDS.teamMetricsRuns;
  }

  async function recordViewed(req, { type, tz } = {}) {
    if (!VIEWED_TYPES.includes(type)) throw new WorcaLevelRequestError(`type must be one of: ${VIEWED_TYPES.join(', ')}`);
    const who = personOf(req);
    if (type === 'stats-viewed') {
      await recordLive(who.person, { statsViewedAt: now() });   // nothing else is recorded (R-po-34)
    } else {
      const stored = readPerson(who.person);
      if (!(await teamMetricsReady(who, stored, resolveTz(tz, stored)))) return;
      await recordLive(who.person, { teamMetricsOpenedAt: now() });
    }
    emitChanged(LIVE_CHANGED_EVENT);
  }

  async function noteLiveEvent(person, patch) {
    await recordLive(person, patch);
    emitChanged(LIVE_CHANGED_EVENT);
  }

  return { getState, ack, recordViewed, noteLiveEvent };
}
