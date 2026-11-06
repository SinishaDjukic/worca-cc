// src/shared/workflow-tests/before-after.mjs — workflow tests 3b (D76): "The command passes" before and after the change
// (SWE-bench's FAIL_TO_PASS / PASS_TO_PASS). Pure and browser-safe. `before` is the run on the start commit (before-run.mjs);
// `after` is the try's own run. "Met" is not decided here: it stays "the command ends without an error" (D57).

export const NAMES_MAX = 20;
const cap = (list, max) => ({ n: list.length, names: list.slice(0, max) });
const setsOf = (t) => ({ pass: new Set(t.pass || []), fail: new Set(t.fail || []), skip: new Set(t.skip || []) });

/**
 * @param {null|{ran: false, reason: string, text?: string}|{ran: true, ok: boolean, exitCode: number|null, timedOut: boolean, tests: object|null, at?: string, cached?: boolean}} before
 * @param {{ok: boolean, exitCode: number|null, timedOut?: boolean, tests: object|null}} after
 * @returns {null|object} see the Interfaces of Task 8
 */
export function beforeAfter(before, after, { max = NAMES_MAX } = {}) {
  if (!before) return null;
  if (before.ran === false) return { ran: false, reason: before.reason, ...(before.text ? { text: before.text } : {}) };
  const base = { ran: true, beforeOk: !!before.ok, beforeTimedOut: !!before.timedOut, afterOk: !!(after && after.ok), cached: !!before.cached, at: before.at || null };
  const b = before.tests;
  const a = after && after.tests;
  if (!b || !a || !b.format || b.format !== a.format || before.timedOut || (after && after.timedOut)) return { ...base, level: 'exit' };
  const B = setsOf(b);
  const A = setsOf(a);
  const sorted = (s) => [...s].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  if (b.passListed && a.passListed) {
    const inB = (x) => B.pass.has(x) || B.fail.has(x) || B.skip.has(x);
    const inA = (x) => A.pass.has(x) || A.fail.has(x) || A.skip.has(x);
    const newOnes = sorted(new Set([...A.pass, ...A.fail])).filter((x) => !inB(x));
    return { ...base, level: 'tests',
      madePass: cap(sorted(B.fail).filter((x) => A.pass.has(x)), max),
      stillPass: { n: sorted(B.pass).filter((x) => A.pass.has(x)).length },
      broke: cap(sorted(B.pass).filter((x) => A.fail.has(x)), max),
      stillFailing: cap(sorted(B.fail).filter((x) => A.fail.has(x)), max),
      added: { n: newOnes.length, failing: newOnes.filter((x) => A.fail.has(x)).length },
      gone: cap(sorted(new Set([...B.pass, ...B.fail])).filter((x) => !inA(x)), max),
      lostPass: { n: sorted(B.pass).filter((x) => !inA(x)).length },   // D82: passed before, missing now
      ...(b.truncated || a.truncated ? { truncated: true } : {}) };
  }
  return { ...base, level: 'failures',
    failingNow: cap(sorted(A.fail).filter((x) => !B.fail.has(x)), max),
    noLongerFail: cap(sorted(B.fail).filter((x) => !A.fail.has(x)), max),
    stillFailing: cap(sorted(B.fail).filter((x) => A.fail.has(x)), max),
    counts: { before: b.counts || null, after: a.counts || null },
    ...(b.truncated || a.truncated ? { truncated: true } : {}) };
}

/**
 * D82: is "The command passes" met? `metWhen` 'passes' (the default, D57): the command ends without an error within its time
 * limit. 'breaks-nothing': also met when it fails, if the before run (`ba`, beforeAfter's answer) shows that nothing that
 * passed before fails now or went missing, judged only on the evidence its level has: tests by name (broke and lostPass both
 * zero); failures by name (no new failing name, and both pass counts read with no fewer passing now); an exit code alone is
 * never evidence. Pure.
 * @returns {{met: boolean, why: string|null, n?: number, before?: number, after?: number}}
 */
export function commandMet({ metWhen = 'passes', afterOk = false, afterTimedOut = false, ba = null } = {}) {
  if (afterOk) return { met: true, why: null };
  if (afterTimedOut) return { met: false, why: 'timed-out' };
  if (metWhen !== 'breaks-nothing') return { met: false, why: 'failed' };
  if (!ba || !ba.ran) return { met: false, why: 'no-before' };
  if (ba.truncated) return { met: false, why: 'cannot-tell' };
  if (ba.level === 'tests') {
    if (ba.broke && ba.broke.n) return { met: false, why: 'broke', n: ba.broke.n };
    if (ba.lostPass && ba.lostPass.n) return { met: false, why: 'lost', n: ba.lostPass.n };
    return { met: true, why: 'nothing-broke' };
  }
  if (ba.level === 'failures') {
    if (ba.failingNow && ba.failingNow.n) return { met: false, why: 'failing-now', n: ba.failingNow.n };
    const b = ba.counts && ba.counts.before;
    const a = ba.counts && ba.counts.after;
    if (!b || !a) return { met: false, why: 'cannot-tell' };
    if (a.passed < b.passed) return { met: false, why: 'fewer-pass', before: b.passed, after: a.passed };
    return { met: true, why: 'nothing-broke' };
  }
  return { met: false, why: ba.beforeOk && !ba.beforeTimedOut ? 'broke-exit' : 'cannot-tell' };
}
