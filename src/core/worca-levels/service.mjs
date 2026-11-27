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
import { WORCA_LEVEL_COUNT } from '../../shared/worca-levels.mjs';
import { isValidTimeZone } from '../../shared/schedule/recurrence.mjs';
import { evaluate } from './evaluate.mjs';
import { toView } from './view.mjs';
import { gatherFacts as defaultGatherFacts, requirementCount, countStartedRuns, scheduleFacts } from './facts.mjs';
import { readPerson as readRawPerson, updatePerson, recordLive } from './store.mjs';
import { normaliseRecord, migrateRecord } from './migrate.mjs';
import { CONDITIONS } from './conditions.mjs';

export const LOCAL_PERSON_KEY = '_local';
export const LIVE_CHANGED_EVENT = 'worca-level-changed';
export const ACK_TARGETS = Object.freeze(['celebration', 'summary', 'nudge', 'mode-suggestion']);
/** A stale tab may still ack the removed levels welcome (D-19): it is answered with the view and records nothing. */
const ACK_NO_OP = 'welcome';
export const SUGGESTION_MODES = Object.freeze(['advanced', 'expert']);
export const SUGGESTION_ANSWERS = Object.freeze(['accepted', 'dismissed']);
export const VIEWED_TYPES = Object.freeze(['stats-viewed', 'team-metrics-viewed']);

/** The person's stored record repaired to the v1 shape, or null when absent or not an object. */
const readPerson = (key) => normaliseRecord(readRawPerson(key));

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

/** A record the service has written under the v2 rules; anything else is created or migrated at its next view. */
const isV2 = (rec) => rec?.rules === 2;

/** D-13: the fact sources that cannot change the answer this time are not read. The first v2 evaluation reads them all (D-10). */
function skipSet(stored) {
  const skip = new Set();
  if (isV2(stored) && stored.doneAt?.parallelFeatures) skip.add('parallel');
  return skip;
}

/** The mode suggestions a level already holds are never offered (D-16). */
const heldSuggestions = (level) => ({ advanced: level >= 3 ? 'skipped' : null, expert: level >= 4 ? 'skipped' : null });

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

  /** A source that cannot be read counts as no past activity: the first GET must not fail for want of a summary. */
  const pastActivity = ({ person, shared }) => {
    try {
      return shared ? hasSharedActivity(person) : !isFreshInstall();
    } catch (err) {
      console.warn(`worca level: could not read past activity: ${err.message}`);
      return false;
    }
  };

  /**
   * The record after this evaluation. A v2 record is latched. Anything else (absent, live-only, v1) is the person's
   * first v2 evaluation: it is migrated, evaluated with full facts, credited as held (`celebrated = level`) and
   * given one summary when the credit is new and there is past activity (D-10, R-po-12). Pure.
   */
  function advance(rec, facts, freshTz, hasHistory) {
    const stamp = now();
    if (isV2(rec)) {
      const ev = evaluate(facts, rec, stamp);
      const next = { ...rec, level: ev.level, doneAt: ev.doneAt, reachedAt: ev.reachedAt, tz: freshTz ?? rec.tz ?? null };
      return sameRecord(next, rec) ? rec : { ...next, updatedAt: stamp };
    }
    const { record: base, from } = migrateRecord(rec, { now: stamp });
    const ev = evaluate(facts, base, stamp);
    return {
      ...base,
      level: ev.level,
      celebrated: ev.level,
      doneAt: ev.doneAt,
      reachedAt: ev.reachedAt,
      summary: hasHistory && ev.level > from && ev.level >= 1 ? { from, to: ev.level, shownAt: null } : null,
      modeSuggestion: heldSuggestions(ev.level),
      tz: freshTz ?? base.tz ?? null,
      updatedAt: stamp,
    };
  }

  /** Compute the view and latch it. Writes only when the record changed. */
  async function sync(req, requestedTz) {
    const who = personOf(req);
    const stored = readPerson(who.person);
    const tz = resolveTz(requestedTz, stored);
    const facts = await gatherFacts({ person: who.person, shared: who.shared, live: stored?.live, tz: tz.zone, skip: skipSet(stored) });
    // Re-read after the facts: an ack that landed meanwhile must show in this view (and in the unchanged case, which writes nothing).
    const current = readPerson(who.person);
    // Past activity is asked at the first v2 evaluation only; the summary is never offered again.
    const hasHistory = isV2(current) ? false : pastActivity(who);
    let record = advance(current, facts, tz.fresh, hasHistory);
    if (record !== current) {
      record = await updatePerson(who.person, (raw) => advance(normaliseRecord(raw), facts, tz.fresh, hasHistory));
    }
    return toView(record, evaluate(facts, record, now()), facts);
  }

  async function getState(req, { tz } = {}) {
    return sync(req, tz);
  }

  async function ack(req, { what, index, id, mode, answer, tz } = {}) {
    if (what !== ACK_NO_OP && !ACK_TARGETS.includes(what)) throw new WorcaLevelRequestError(`what must be one of: ${ACK_TARGETS.join(', ')}`);
    if (what === ACK_NO_OP) return sync(req, tz);
    if (what === 'celebration' && !(Number.isInteger(index) && index >= 1 && index <= WORCA_LEVEL_COUNT)) {
      throw new WorcaLevelRequestError(`index must be the level number that was shown (1 to ${WORCA_LEVEL_COUNT})`);
    }
    if (what === 'nudge' && !(typeof id === 'string' && Object.hasOwn(CONDITIONS, id))) {
      throw new WorcaLevelRequestError('id must be the id of the ladder item that was shown');
    }
    if (what === 'mode-suggestion' && !(SUGGESTION_MODES.includes(mode) && SUGGESTION_ANSWERS.includes(answer))) {
      throw new WorcaLevelRequestError(`mode must be one of: ${SUGGESTION_MODES.join(', ')} and answer one of: ${SUGGESTION_ANSWERS.join(', ')}`);
    }
    await sync(req, tz);                                   // the record exists before it is acknowledged
    const { person } = personOf(req);
    await updatePerson(person, (raw) => {
      const rec = normaliseRecord(raw) ?? raw;
      if (what === 'summary') {
        return rec.summary && rec.summary.shownAt === null ? { ...rec, summary: { ...rec.summary, shownAt: now() }, updatedAt: now() } : rec;
      }
      if (what === 'nudge') {                                // latched even when the toast was missed (I-11)
        return rec.nudged?.[id] ? rec : { ...rec, nudged: { ...rec.nudged, [id]: now() }, updatedAt: now() };
      }
      if (what === 'mode-suggestion') {                      // the first answer stands: a suggestion is never re-offered
        const held = rec.modeSuggestion ?? {};
        return held[mode] ? rec : { ...rec, modeSuggestion: { ...held, [mode]: answer }, updatedAt: now() };
      }
      if (what !== 'celebration') return rec;
      // Only the level that was shown is acknowledged; a level reached since then stays to be celebrated.
      const seen = Math.max(rec.celebrated, Math.min(index, rec.level));
      return seen === rec.celebrated ? rec : { ...rec, celebrated: seen, updatedAt: now() };
    });
    return sync(req, tz);
  }

  /** Page-view events no longer feed any level (D-19): a stale tab's post is accepted and records nothing. */
  async function recordViewed(_req, { type } = {}) {
    if (!VIEWED_TYPES.includes(type)) throw new WorcaLevelRequestError(`type must be one of: ${VIEWED_TYPES.join(', ')}`);
  }

  async function noteLiveEvent(person, patch) {
    await recordLive(person, patch);
    emitChanged(LIVE_CHANGED_EVENT);
  }

  /** A recorded fact changed (a PR state, a discovery): tell clients to re-read. Emits only; `sync` does the writing. */
  function pokeLevelFactsChanged() {
    emitChanged(LIVE_CHANGED_EVENT);
  }

  return { getState, ack, recordViewed, noteLiveEvent, pokeLevelFactsChanged };
}
