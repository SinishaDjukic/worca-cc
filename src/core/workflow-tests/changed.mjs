// What makes "Finish the rest" refuse: the draft or a tested version changed, or an example of a stopped/waiting try
// was edited, since the test started. Shared by runner.continueRun and the progress page's `edited` (P38).
import * as store from './store.mjs';

export const changedText = (use) => `${use === 'draft' ? 'Your draft' : `v${use}`} changed since this test started: start a new test.`;
export const editedText = (name) => `"${name}" was edited since this test started: start a new test.`;

/** The tries continueRun makes again. */
export const leftTries = (run) => store.triesOfRun(run.id).filter((t) => t.runId === run.id && (t.status === 'stopped' || t.status === 'waiting'));

/** @returns {Promise<string|null>} the refusal text, or null when nothing changed. `fingerprintNow(workflowId, use)` never throws. */
export async function changedSinceStart(run, { fingerprintNow, left = leftTries(run), examples = new Map() } = {}) {
  for (const [use, fp] of [[run.a, run.aFp], [run.b, run.bFp]]) {
    if (use == null) continue;
    if ((await fingerprintNow(run.workflowId, use)) !== fp) return changedText(use);
  }
  for (const t of left) {
    if (!examples.has(t.exampleId)) examples.set(t.exampleId, store.readExample(run.workflowId, t.exampleId));
    const ex = examples.get(t.exampleId);
    if (ex && ex.fingerprint !== t.exampleFp) return editedText(ex.name);
  }
  return null;
}
