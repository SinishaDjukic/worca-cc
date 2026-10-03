import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { listArtifacts, listRunArtifacts } from '../src/core/artifacts.mjs';

useTempHome(after);

test('wf_presentation runs offline end to end and leaves the golden run-folder shape', { timeout: 120000 }, async () => {
  const orch = createOrchestrator({
    projectDir: gitDir('deck'), workflowId: 'wf_presentation', prompt: 'a five-minute deck on why worca',
    claude: { mock: true }, auto: true,          // auto: no clarify gate, no approval checkpoints
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const st = orch.getState();
  assert.equal(st.endReached, true);
  assert.deepEqual(st.warnings, []);

  const dir = orch.pipeline.dir;
  // Cycle shape: both verifier mocks block once (cycle 1), builder fixes, then clean.
  const ordinals = Object.fromEntries(st.steps.filter((s) => s.nodeId).map((s) => [s.nodeId, Math.max(s.ordinal, 0)]));
  // Run-folder layout: each allocated report/verdict lives in its execution's step
  // folder, while the deck tree (deck/, shots/) stays at the run root, edited in
  // place across fix cycles, where the ports' extraFiles globs sweep it.
  for (const f of ['steps/n_clarify-c1/deck-clarify.json', 'steps/n_narr-c1/spine.md', 'steps/n_system-c1/visual-system.md',
    'steps/n_build-c1/deck-manifest.md', 'deck/deck.html', 'deck/proof.html',
    'steps/n_audit-c1/deck-audit-cycle1.json', 'steps/n_audit-c1/deck-audit-cycle1.md', 'steps/n_audit-c2/deck-audit-cycle2.json',
    'steps/n_review-c1/deck-review-cycle1.json', 'shots/s01.png']) {
    await access(join(dir, f));
  }

  // The deliverables a human can actually open. A run once finished "clean"
  // having produced neither, because every assertion here was derived from the
  // design's file list rather than from what the task asked for.
  for (const f of ['deck/deck.pdf', 'deck/deck.standalone.html']) await access(join(dir, f));
  assert.ok((await readFile(join(dir, 'deck/deck.pdf'))).subarray(0, 5).equals(Buffer.from('%PDF-')), 'deck.pdf is not a PDF');
  const standalone = await readFile(join(dir, 'deck/deck.standalone.html'), 'utf8');
  assert.ok(!/<script src="[^"]+\.js"><\/script>/.test(standalone), 'deck.standalone.html still references a companion script — it is not standalone');
  const kinds = (await listArtifacts(orch.pipeline.id)).map((a) => `${a.kind}:${a.relPath}`);
  assert.ok(kinds.includes('deck:deck/deck.html'), kinds.join('\n'));
  assert.ok(kinds.includes('deck-shot:shots/s01.png'));
  assert.ok(kinds.includes('deck-manifest:steps/n_build-c1/deck-manifest.md'), kinds.join('\n'));
  // deck-clarify.json is a real file in its step folder, so it gets a kind of its
  // own. Under the shared `clarify` kind the engine refused to index it — the Q&A
  // of the OTHER clarify agent lives in the clarify table, not in a file — so it
  // was invisible in the Artifacts tab, unreadable via read_run_artifact, and
  // left behind by pipeline-delete's index-driven cleanup.
  assert.ok(kinds.includes('deck-clarify:steps/n_clarify-c1/deck-clarify.json'), kinds.join('\n'));
  assert.ok(kinds.includes('deck:deck/deck.pdf'), kinds.join('\n'));
  assert.ok(kinds.includes('deck:deck/deck.standalone.html'), kinds.join('\n'));

  // The bundle card owns the single file now, and the export step gates on it.
  // Under the mock the card writes only its report, so the standalone comes from
  // the export agent's FALLBACK — the same branch a host with no interpreter
  // takes, which is exactly what is worth pinning here. The card's own program is
  // covered for real by test/deck-bundle-script.test.mjs.
  await access(join(dir, 'steps/n_bundle-c1/deck-bundle-cycle1.md'));
  assert.equal(ordinals.n_bundle, 1, 'the bundle step runs once, after a clean review');
  const bundleKinds = kinds.filter((k) => k.startsWith('deck-bundle:'));
  assert.deepEqual(bundleKinds, ['deck-bundle:steps/n_bundle-c1/deck-bundle-cycle1.md'], kinds.join('\n'));

  // The port's extraFiles entries are FIRST-MATCH-WINS: the deliverables take the
  // browsable `deck` kind, and the catch-all sweeps the rest into `deck-asset` —
  // still indexed (the raw route resolves `rel` only among indexed rows, so
  // deck.html's <script src> and @font-face would 404 otherwise), never listed.
  for (const f of ['deck-stage.js', 'deck-enhance.js', 'deck-export.js', 'deck-audit.js']) {
    assert.ok(kinds.includes(`deck-asset:deck/${f}`), kinds.join('\n'));
    assert.ok(!kinds.includes(`deck:deck/${f}`), `${f} is still indexed as a deliverable`);
  }
  assert.ok(kinds.includes('deck-asset:deck/proof.html'), kinds.join('\n'));
  assert.ok(!kinds.includes('deck:deck/proof.html'), 'the instrumented proof copy is not a deliverable');

  // ATTRIBUTION follows whoever WROTE the file, not whoever swept the directory
  // last. deckBuilder and deckExport declare IDENTICAL extraFiles globs
  // (deck/deck*.html, deck/deck*.pdf, deck/*), and the globs match what is on
  // disk rather than what this execution produced — so the export sweep re-stamped
  // the builder's deck.html and all four kit scripts onto n_export, and the whole
  // Artifacts tab filed them under the wrong node card while list_run_artifacts
  // handed the model a stepKey that never wrote them.
  const attributed = await listRunArtifacts(orch.pipeline.id, {});
  const nodeOf = (rel) => (attributed.find((a) => a.relPath === rel) || {}).nodeId;
  assert.equal(nodeOf('deck/deck.html'), 'n_build', 'deck.html belongs to the builder that wrote it');
  for (const f of ['deck-stage.js', 'deck-enhance.js', 'deck-export.js', 'deck-audit.js']) {
    assert.equal(nodeOf(`deck/${f}`), 'n_build', `${f} was staged by the builder, not the exporter`);
  }
  // ...and the exporter keeps its own deliverables.
  assert.equal(nodeOf('deck/deck.pdf'), 'n_export');
  // Under the mock deckBundle writes only its report, so this file comes from the
  // export agent's FALLBACK branch — the same one a Python-less host takes — and
  // is still stamped n_export, not n_bundle.
  assert.equal(nodeOf('deck/deck.standalone.html'), 'n_export');

  // EVERY indexed row must resolve to a real file. `allocateOutputs` allocates a
  // path for every port with a `filename`, including the `when: "blocking"` ones
  // (deckAudit.findings, deckExport.findings, deckReviewer.review), and a clean
  // verdict leaves those unwritten — so indexing on "a path was allocated" put
  // rows in the Artifacts tab that render as `0 B` and 404 when clicked, and that
  // `list_run_artifacts` hands the model for `read_run_artifact` to fail on.
  const indexed = await listArtifacts(orch.pipeline.id);
  const missing = [];
  for (const a of indexed) {
    const candidates = [join(dir, a.relPath), join(dir, '..', '..', a.relPath)];
    if (!(await Promise.all(candidates.map((f) => access(f).then(() => true, () => false)))).some(Boolean)) {
      missing.push(`${a.kind}:${a.relPath}`);
    }
  }
  assert.deepEqual(missing, [], 'indexed artifacts with no file behind them');

  // The persisted log carries the artifact links too. Only `_log` used to push to
  // the logWriter, so live-log.ndjson held no artifact records and History — plus
  // any live run reloaded in the browser — showed none of the clickable links the
  // live view does.
  const logLines = (await readFile(join(dir, 'live-log.ndjson'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const artifactLines = logLines.filter((r) => r.level === 'artifact');
  assert.ok(artifactLines.length > 0, 'the run log records the artifacts it produced');
  for (const r of artifactLines) {
    assert.ok(r.path, `an artifact log record with no path: ${JSON.stringify(r)}`);
    assert.ok(r.kind, `an artifact log record with no kind: ${JSON.stringify(r)}`);
  }
  assert.ok(artifactLines.some((r) => r.kind === 'deck' && /deck\.html$/.test(r.path)), 'including the deck itself');
  // And no line for a kind the viewer refuses to list — those links only 404.
  assert.deepEqual(artifactLines.filter((r) => ['pipeline', 'questions', 'live-log'].includes(r.kind)), []);

  // The kit is STAGED by the engine (requiresAssets), not hunted for on disk:
  // before this, the builder prompt said "cp from the project checkout" while the
  // kit shipped inside worca, and a run only found it by globbing the filesystem.
  await access(join(dir, 'deck-kit', 'build-standalone.mjs'));
  await access(join(dir, 'deck-kit', 'CONTRACT.md'));
  assert.equal(ordinals.n_review, 2);
  assert.equal(ordinals.n_build, 3);
  assert.equal(ordinals.n_audit, 3);
  // Export runs ONCE, after the review is clean — the whole reason it is its own
  // node rather than trailing work inside the builder's fix loop.
  assert.equal(ordinals.n_export, 1);
});

// _writtenDuring answered `true` for ANY stat failure. The candidate name came
// from a readdir a moment earlier, so the only way to reach the throw is the file
// having been unlinked in between — and answering `true` then records an index row
// for a file that no longer exists: exactly the 0-byte row that 404s on click,
// which forgetMissingArtifacts was added to remove. ENOENT means gone; every other
// error is unknown and keeps the old permissive answer.
test('_writtenDuring: a file that vanished after the listing is not recorded as written', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const orch = createOrchestrator({ projectDir: gitDir('deck'), prompt: 'x', claude: { mock: true } });
  const gone = join(gitDir('deck'), 'definitely-not-here-' + Math.random().toString(36).slice(2));

  assert.equal(await orch._writtenDuring(gone, { startedMs: Date.now() }), false,
    'a vanished file must not be indexed');
  // The legacy path — no timestamp to compare against — still answers permissively.
  assert.equal(await orch._writtenDuring(gone, {}), true, 'no startedMs: behave as before');
});
