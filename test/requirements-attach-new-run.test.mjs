// test/requirements-attach-new-run.test.mjs — the New run wiring of the Requirements attach button (P4-T3).
// app.js is a 40k-line script no test can boot, so the wiring is pinned by reading its source (the way
// requirements-app.test.mjs does) and by mounting the real entry module on the real new.html in jsdom.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../ui/public/new-run/new.html', import.meta.url), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const appFlat = squash(app);

const { window } = new JSDOM(html, { url: 'http://localhost:4317/' });
for (const k of ['document', 'window', 'Event']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
after(() => window.close());
const tick = () => new Promise((r) => setTimeout(r, 0));

const { mountNewRunAttach } = await import('../ui/public/requirements-attach/entries.mjs');
const { createAttachStore } = await import('../ui/public/requirements-attach/store.mjs');

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const feat = (seq, title) => ({ seq, id: `F-${seq}`, title, criteriaCount: 1, startable: true });

test('button placement: the attach button sits right after the Task source field, hidden until the flag is on', () => {
  const btn = window.document.getElementById('pull-from-requirements');
  assert.ok(btn, 'the button exists');
  assert.equal(btn.getAttribute('data-flag'), 'requirements');
  assert.equal(btn.hidden, true);
  const sourceField = window.document.getElementById('source-field');
  assert.equal(sourceField.nextElementSibling, btn.closest('#pull-field'), 'its field follows #source-field');
  assert.equal(window.document.querySelectorAll('#pull-from-requirements').length, 1);
});

test('the button is shown by the flag and labelled from the store', async () => {
  const btn = window.document.getElementById('pull-from-requirements');
  const store = createAttachStore({ storage: memStorage(), key: 'worca-cc.attach.newrun' });
  let on = true;
  const stop = mountNewRunAttach({
    button: btn, store, getTarget: () => ({ runTarget: 'project', projectKey: 'shop', projectPath: '/p/shop' }), setRunTarget: () => {},
    flagOn: () => on, onFlagChange: () => () => {}, fetchJson: async () => ({ items: [] }),
  });
  assert.equal(btn.hidden, false);
  store.add([feat(1, 'Cancel order')]);
  await tick();
  assert.match(btn.textContent, /1/);
  stop();
});

test('app.js mounts the attach entry, not the old pull entry', () => {
  assert.match(app, /import \{[^}]*mountNewRunAttach[^}]*\} from '\.\/requirements-attach\/entries\.mjs'/);
  assert.doesNotMatch(app, /mountFeaturePull/);
  assert.match(appFlat, /const pullBtn = document\.getElementById\('pull-from-requirements'\)/);
  assert.match(appFlat, /mountNewRunAttach\(\{ button: pullBtn, store: newRunAttachStore/);
  assert.match(app, /'worca-cc\.attach\.newrun'/);
});

test('scope passed: the hash search reads the run target and the Enter/Tab keys go to it first', () => {
  assert.match(app, /attachHashSearch\(/);
  assert.match(appFlat, /newRunScope\(newRunTarget\(\)\)\.scope/);
  assert.match(appFlat, /if \(newRunHash\.get\(ta\)\?\.handleKey\(e\)\) return;[^]*?if \(mentionPopup\.hidden \|\| mention\.ta !== ta\) return;/);
  assert.match(appFlat, /ta\.addEventListener\('input', \(\) => \{ refreshMentionPopup\(ta\); newRunHashInput\(ta\); \}\)/);
});

test('cancel restores select: target segment and both selects go through guardScopeChange', () => {
  assert.match(appFlat, /return guardScopeChange\(\{ store: newRunAttachStore/);
  const calls = app.match(/void guardNewRunScope\(/g) || [];
  assert.equal(calls.length, 3, 'segment, project select and workspace select');
  assert.match(appFlat, /btn\.addEventListener\('click', \(\) => \{ const prev = state\.runTarget; void guardNewRunScope\(/);
  assert.match(appFlat, /el\.workspaceSelect\.addEventListener\('change', \(\) => \{ const prev = workspacePrev; void guardNewRunScope\(/);
  assert.match(appFlat, /el\.projectSelect\.addEventListener\('change', \(\) => \{[^]*?guardNewRunScope\(/);
  assert.match(appFlat, /el\.projectSelect\.value = prev/);
  assert.match(appFlat, /el\.workspaceSelect\.value = prev/);
});

test('empty prompt with requirements: the prompt checks are skipped and the body carries seqs only', () => {
  assert.match(appFlat, /if \(!mdText && !attachedItems\.length\) return fieldError\(el\.promptMarkdown/);
  assert.match(appFlat, /if \(!promptText && !attachedItems\.length\) return fieldError\(el\.prompt/);
  assert.match(appFlat, /body\.requirements = attachedItems\.map\(\(i\) => \(\{ seq: i\.seq \}\)\)/);
  assert.match(appFlat, /if \(attachedItems\.length\) \{ body\.requirements/);
});

test('flag off: no requirements key is sent', () => {
  assert.match(appFlat, /const attachedItems = flagOn\('requirements'\) && !psrc \? newRunAttachStore\.get\(\)\.items : \[\]/);
});

test('submit asks before running a feature again and shows the server message otherwise', () => {
  assert.match(app, /RUN_IN_PROGRESS/);
  assert.match(app, /confirmAttachedRunning: true/);
  assert.match(app, /REQUIREMENTS_UNAVAILABLE/);
});

test('title: the placeholder and the empty-title fallback use suggestTitle', () => {
  assert.match(app, /suggestTitle\(/);
  assert.match(appFlat, /el\.title\.placeholder = /);
  assert.match(appFlat, /if \(!title\) body\.title = suggestTitle\(attachedItems\)/);
});

test('plugin source: attach is disabled while a plugin source is active', () => {
  assert.match(appFlat, /pullBtn\.disabled = !!state\.activePluginSource/);
});

test('the store is restored and revalidated on showView(new) and cleared on an accepted run', () => {
  assert.match(appFlat, /if \(name === 'new'\) \{ loadTaskSources\(\); applyBudgetToNewView\(\); refreshMentionHighlights\(\); restoreNewRunAttach\(\)/);
  assert.match(appFlat, /newRunAttachStore\.clear\(\)/);
});

test('the attached features show as cards beside the button, each with its status and its own remove', async () => {
  const { renderAttachedCards } = await import('../ui/public/requirements-attach/cards.mjs');
  const host = window.document.getElementById('attach-cards');
  assert.ok(host, 'new.html has the card strip');
  assert.equal(host.closest('#pull-field').contains(window.document.getElementById('pull-from-requirements')), true);
  const store = createAttachStore({ storage: memStorage(), key: 'worca-cc.attach.cards' });
  store.add([feat(1, 'Cancel order'), { ...feat(2, 'Old flow'), status: 'archived' }]);
  const paint = () => {
    const items = store.get().items;
    renderAttachedCards(host, items, { onRemove: (seq) => store.remove(seq), flagOn: () => true });
    host.hidden = !items.length;
  };
  store.subscribe(paint);
  paint();
  assert.equal(host.hidden, false);
  const chips = [...host.querySelectorAll('.ask-chip-feature')];
  assert.equal(chips.length, 2);
  assert.match(chips[0].textContent, /Cancel order/);
  assert.match(chips[1].textContent, /Archived — remove to send\/run/);
  chips[1].querySelector('.ask-chip-x').click();
  assert.deepEqual(store.get().items.map((i) => i.seq), [1]);
  host.replaceChildren();
});

test('flag off: the strip is not under any requirements flag gate and says "Requirements unavailable" (R-po-12)', async () => {
  const { renderAttachedCards } = await import('../ui/public/requirements-attach/cards.mjs');
  const host = window.document.getElementById('attach-cards');
  for (let n = host; n; n = n.parentElement) {
    assert.equal(/\brequirements\b/.test(n.getAttribute('data-flag') || ''), false, `${n.id || n.tagName} must not be flag-gated`);
  }
  renderAttachedCards(host, [feat(1, 'Cancel order')], { onRemove: () => {}, flagOn: () => false });
  assert.match(host.textContent, /Requirements unavailable/);
  host.replaceChildren();
});

test('app.js hides the wrapper only when the flag is off and nothing is attached', () => {
  assert.match(appFlat, /field\.hidden = !flagOn\('requirements'\) && !\(state\.activePluginSource \? \[\] : items\)\.length/);
});

test('app.js paints the strip from the store and the flag, and routes every project choice through the guarded change', () => {
  assert.match(appFlat, /document\.getElementById\('attach-cards'\)/);
  assert.match(appFlat, /renderAttachedCards\(cards, shown, \{ onRemove: \(seq\) => newRunAttachStore\.remove\(seq\)/);
  assert.match(appFlat, /onFlagChange\('requirements', syncNewRunAttach\)/);
  assert.match(appFlat, /const applyNewRunProject = createProjectChange\(/);
  assert.match(appFlat, /function cycleNewRunProject\(\) \{[^}]*void applyNewRunProject\(/);
  assert.doesNotMatch(appFlat, /function cycleNewRunProject\(\) \{[^}]*setRunTarget\(/);
  assert.match(appFlat, /if \(attachedItems\.length\) newRunAttachStore\.clear\(\)/);
});
