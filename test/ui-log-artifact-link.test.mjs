// test/ui-log-artifact-link.test.mjs
// Regression for the live streaming path of clickable artifact log lines
// (plan v3 §4.3). onArtifact forwards {path,kind} into onLog; onLog must copy
// them onto the record it pushes to r.logLines, or buildLogLine's artifact
// branch (level === 'artifact' && path) never fires and the line renders as a
// plain span. History replay routes through projectLogRecord (covered by
// test/log-line.test.mjs); this pins the LIVE path.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  let lastWs = null;
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  (lastWs._l.open || []).forEach((fn) => fn());
  const recv = (obj) => (lastWs._l.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, np: window.__np, recv };
}
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// Registers a run over the WebSocket and opens its run page on the Live log tab
// (the Running list card carries no log). Returns the run and the `.log` pane.
async function openLogs({ window, np, recv }, { runId = 'p1', status = 'running', pipelineId = 'p1', logLines } = {}) {
  recv({ type: 'hello', runs: [{ runId, title: 't', projectDir: PROJECT, status, kind: 'run', startedAt: '10:00:00', pendingQuestion: null }] });
  await settle();
  const r = np.getRun(runId);
  np.onState(r, { status, id: pipelineId, steps: [] });
  if (logLines) r.logLines = logLines;
  window.location.hash = `running/${runId}/details/logs`;
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  const sec = window.document.querySelector('#run-detail .rd-sec-logs');
  assert.ok(sec, 'the run page has its Live log tab');
  return { r, sec, pane: sec.querySelector('.log') };
}

// The record onArtifact builds and hands to onLog for a live artifact.
const artifactMsg = () => ({
  source: 'artifact', level: 'artifact',
  text: 'deck: deck/deck.html', ts: 1,
  path: 'deck/deck.html', kind: 'deck',
});

test('onLog preserves path/kind so a live artifact line renders as a clickable link', async () => {
  const ctx = await boot();
  const { np } = ctx;
  const { r, sec } = await openLogs(ctx);

  np.onLog(r, artifactMsg());

  // The record kept in the model carries the fields the renderer needs.
  const rec = r.logLines[r.logLines.length - 1];
  assert.equal(rec.path, 'deck/deck.html');
  assert.equal(rec.kind, 'deck');

  // The line mirrored into the open run page's Logs tab is the clickable anchor, not a plain span.
  const a = sec.querySelector('.log a.log-artifact');
  assert.ok(a, 'live artifact log line is an <a class="log-artifact">');
  assert.equal(a.dataset.path, 'deck/deck.html');
  assert.equal(a.dataset.kind, 'deck');
});

// One boot; each row opens its own run, so the per-run burst counters never bleed
// from one row into the next.
test('artifact log capping: a sweep logs its first five per kind/node/execution (restarting on kind, node or cycle), distinct deliverables each get a line, concurrent executions are capped independently, and every artifact still reaches the Artifacts tab', async () => {
  const ctx = await boot();
  const { np } = ctx;
  await checkRows([
    // The deck audit indexes one screenshot per slide — 43 on a real run, 84 on a
    // three-deck one — and one log line each buried the run's narrative. But the
    // suppression has to be a BURST rule, not an "adjacent duplicates" rule: the
    // export step emits deck.html, deck.standalone.html and deck.pdf back to back,
    // all kind `deck` from the same node, and those are three distinct deliverables.
    { name: 'a folder sweep logs its first few files, not all of them', run: async () => {
      const { r, sec } = await openLogs(ctx, { runId: 'cap1', pipelineId: 'pcap1' });

      for (let i = 1; i <= 12; i++) {
        np.onArtifact(r, { kind: 'deck-shot', path: `shots/s${String(i).padStart(2, '0')}.png`, nodeId: 'n_audit' });
      }

      assert.equal(sec.querySelectorAll('.log a.log-artifact').length, 5,
        'the first five of the sweep are logged; the rest are not');
      assert.equal(r.artifacts.length, 12, 'every artifact still reaches the Artifacts tab');
    } },
    { name: 'distinct deliverables from one step each get their own log line', run: async () => {
      const { r, sec } = await openLogs(ctx, { runId: 'cap2', pipelineId: 'pcap2' });

      // deckExport's real emission order, one node, one kind, three separate files.
      for (const path of ['deck/deck.html', 'deck/deck.standalone.html', 'deck/deck.pdf']) {
        np.onArtifact(r, { kind: 'deck', path, nodeId: 'n_export' });
      }

      assert.deepEqual([...sec.querySelectorAll('.log a.log-artifact')].map((a) => a.dataset.path),
        ['deck/deck.html', 'deck/deck.standalone.html', 'deck/deck.pdf'],
        'the PDF is a deliverable and must not be swallowed as a duplicate of deck.html');
    } },
    { name: 'the run counter restarts on a different kind or node', run: async () => {
      const { r, sec } = await openLogs(ctx, { runId: 'cap3', pipelineId: 'pcap3' });

      for (let i = 1; i <= 6; i++) np.onArtifact(r, { kind: 'deck-shot', path: `shots/a${i}.png`, nodeId: 'n_audit' });
      np.onArtifact(r, { kind: 'deck-audit', path: 'deck-audit-cycle1.md', nodeId: 'n_audit' });
      for (let i = 1; i <= 6; i++) np.onArtifact(r, { kind: 'deck-shot', path: `shots/b${i}.png`, nodeId: 'n_review' });

      // 5 of the first sweep + the audit md + 5 of the second sweep.
      assert.equal(sec.querySelectorAll('.log a.log-artifact').length, 11);
    } },
    // The counter must reset per EXECUTION, not per run. Keyed on kind+node alone it
    // stays over the threshold for the rest of the run, so cycle 2 of the
    // build/audit loop logs none of its screenshots at all — the opposite of "the
    // first few of such a run".
    { name: 'a later cycle of the same node logs its own first few', run: async () => {
      const { r, sec } = await openLogs(ctx, { runId: 'cap4', pipelineId: 'pcap4' });

      const sweep = (executionId, cycle) => {
        for (let i = 1; i <= 8; i++) {
          np.onArtifact(r, { kind: 'deck-shot', path: `shots/s${i}.png`, nodeId: 'n_audit', executionId, cycle });
        }
      };
      sweep('x:n_audit:1', 1);
      sweep('x:n_audit:2', 2);

      assert.equal(sec.querySelectorAll('.log a.log-artifact').length, 10,
        'five from each cycle, not five from the first and silence after');
      // The audit RESHOOTS the same eight paths, so the tab holds eight files, not
      // sixteen — each carrying the cycle that last wrote it.
      assert.equal(r.artifacts.length, 8);
      assert.deepEqual([...new Set(r.artifacts.map((a) => a.cycle))], [2]);
      assert.deepEqual([...new Set(r.artifacts.map((a) => a.stepKey))], ['x:n_audit:2']);
    } },
    // The flood suppressor kept ONE slot keyed by kind+execution+node and reset the
    // count whenever the key changed. _indexExtraFiles awaits between files, so two
    // executions sweeping folders concurrently (a workspace fan-out of an
    // extraFiles-declaring agent) interleave: the key flips on every event, the count
    // never passes the threshold, and every screenshot gets a log line — the exact
    // flood BULK_KIND_THRESHOLD exists to stop.
    { name: 'two executions indexing at once are each capped, not mutually reset', run: async () => {
      const { r, sec } = await openLogs(ctx, { runId: 'cap5', pipelineId: 'pcap5' });

      // 8 shots each, interleaved, from two executions of the same node kind.
      for (let i = 0; i < 8; i++) {
        for (const exec of ['audit#1', 'audit#2']) {
          np.onArtifact(r, { kind: 'deck-shot', path: `/abs/${exec}/shots/s${i}.png`, nodeId: 'n_audit', executionId: exec, cycle: 1 });
        }
      }

      const lines = sec.querySelectorAll('.log a.log-artifact');
      assert.ok(lines.length <= 12,
        `each burst is capped independently (~5 each), not 16 unsuppressed: ${lines.length}`);
      assert.ok(lines.length >= 6, `but both bursts are represented: ${lines.length}`);
    } },
  ]);
});

test('the repainted and the run-detail log panes both carry the artifact click context', async () => {
  const ctx = await boot();
  const { np, window } = ctx;
  await checkRows([
    // delegated click handler walks up from the link for `_artifactCtx`. It was stamped
    // only when a LIVE line arrived, so links in a pane painted from the model found
    // no context and did nothing when clicked. Every pane is rebuilt by
    // repaintFilteredLog, so the context is stamped there.
    { name: 'a repainted log pane carries the artifact click context', run: async () => {
      const { pane } = await openLogs(ctx, { runId: 'r1', pipelineId: 'p1', logLines: [{
        ts: 1, source: 'artifact', level: 'artifact', text: 'deck: deck/deck.html',
        path: 'deck/deck.html', kind: 'deck',
      }] });
      assert.ok(pane.querySelector('a.log-artifact'), 'opening the run page rendered the link from the model');
      assert.ok(pane._artifactCtx, 'and the pane carries the context the click handler looks for');
      assert.equal(pane._artifactCtx.runId, 'p1');
    } },
    // rdRepaintLog rebuilds the Running-detail Logs pane — the DEFAULT tab — and
    // never stamped the click context; only the dashboard card and History did. The
    // delegated handler walks up for `_artifactCtx`, finds none, preventDefaults and
    // does nothing, so artifact links were dead on the screen people actually watch.
    { name: 'the run-detail log pane carries the artifact click context', run: async () => {
      const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
      r.logLines = [{
        ts: 1, source: 'artifact', level: 'artifact', text: 'deck: deck/deck.html',
        path: 'deck/deck.html', kind: 'deck',
      }];
      const sec = window.document.createElement('div');
      sec.innerHTML = '<div class="log"></div>';
      np.rdRepaintLog(sec, r);

      const pane = sec.querySelector('.log');
      assert.ok(pane.querySelector('a.log-artifact'), 'the link is rendered');
      assert.ok(pane._artifactCtx, 'and the pane carries the context the handler looks for');
      assert.equal(pane._artifactCtx.runId, 'p1');
    } },
  ]);
});
