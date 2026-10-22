// feedback.mjs (#555): toasts, button states, field errors, card alerts, dirty Save.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { notify, withButton, fieldError, clearFieldErrors, cardAlert, trackDirty, splitMessage, TOAST_MAX, controlSnapshot }
  from '../ui/public/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

const fresh = () => new JSDOM('<!doctype html><body><div id="toasts" class="toasts" role="status" aria-live="polite"></div></body>').window;
const toasts = (doc) => [...doc.querySelectorAll('#toasts > .toast')];

test('notify ok: polite role=status toast that auto-closes after 5 s, paused by hover/focus', async () => {
  await checkRows([
    { name: 'notify ok: polite region, role=status toast, icon + words, closes after 5 s', run: () => {
      mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const { document: doc } = fresh();
        notify({ tone: 'ok', title: 'Actions saved for acme-web', detail: 'Applies to new checkouts.' }, { doc });
        const r = doc.getElementById('toasts');
        assert.equal(r.getAttribute('role'), 'status');
        assert.equal(r.getAttribute('aria-live'), 'polite');
        const [el] = toasts(doc);
        assert.equal(el.getAttribute('role'), 'status');
        assert.equal(el.querySelector('.tt').textContent, 'Actions saved for acme-web');
        assert.equal(el.querySelector('.td').textContent, 'Applies to new checkouts.');
        assert.equal(el.querySelector('.ti svg').getAttribute('aria-hidden'), 'true');
        mock.timers.tick(4999);
        assert.equal(toasts(doc).length, 1);
        mock.timers.tick(1);
        assert.equal(toasts(doc).length, 0);
      } finally { mock.timers.reset(); }
    } },
    { name: 'notify ok: hover and focus pause the auto-close', run: () => {
      mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      try {
        const w = fresh(); const doc = w.document;
        const { el } = notify({ tone: 'ok', title: 'Installed acme-lint' }, { doc });
        mock.timers.tick(3000);
        el.dispatchEvent(new w.MouseEvent('mouseenter'));
        mock.timers.tick(60000);
        assert.equal(toasts(doc).length, 1, 'paused while hovered');
        el.dispatchEvent(new w.MouseEvent('mouseleave'));
        mock.timers.tick(1999);
        assert.equal(toasts(doc).length, 1, 'resumes with the 2 s that were left');
        mock.timers.tick(1);
        assert.equal(toasts(doc).length, 0);
        const b = notify({ tone: 'ok', title: 'x' }, { doc }).el;
        b.dispatchEvent(new w.FocusEvent('focusin'));
        mock.timers.tick(60000);
        assert.equal(toasts(doc).length, 1, 'paused while focused');
      } finally { mock.timers.reset(); }
    } },
  ]);
});

test('notify err: role=alert, stays until dismissed, Retry runs once and closes it', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => mock.timers.reset());
  const { document: doc } = fresh();
  let ran = 0;
  notify({ tone: 'err', title: 'Push failed', detail: 'HTTP 502', action: { label: 'Retry', run: () => { ran++; } } }, { doc });
  const [el] = toasts(doc);
  assert.equal(el.getAttribute('role'), 'alert');
  mock.timers.tick(10 * 60 * 1000);
  assert.equal(toasts(doc).length, 1);
  el.querySelector('.toast-act').click();
  assert.equal(ran, 1);
  assert.equal(toasts(doc).length, 0);
  notify({ tone: 'err', title: 'Again' }, { doc });
  toasts(doc)[0].querySelector('.toast-x').click();
  assert.equal(toasts(doc).length, 0);
});

test('notify: at most 3, the oldest success goes first; a key replaces; focus never moves', () => {
  const { document: doc } = fresh();
  const before = doc.activeElement;
  notify({ tone: 'err', title: 'e1' }, { doc });
  notify({ tone: 'ok', title: 'o1', timeout: 0 }, { doc });
  notify({ tone: 'err', title: 'e2' }, { doc });
  notify({ tone: 'ok', title: 'o2', timeout: 0 }, { doc });
  assert.equal(toasts(doc).length, TOAST_MAX);
  assert.deepEqual(toasts(doc).map((n) => n.querySelector('.tt').textContent), ['e1', 'e2', 'o2']);
  notify({ tone: 'err', title: 'e2 again', key: 'k' }, { doc });
  notify({ tone: 'err', title: 'e2 newest', key: 'k' }, { doc });
  assert.equal(toasts(doc).filter((n) => n.dataset.key === 'k').length, 1);
  assert.equal(doc.activeElement, before);
});

test('withButton: busy -> done -> idle, failure skips done, a throw becomes {ok:false,error}', async () => {
  await checkRows([
    { name: 'withButton: busy → done (2 s) → idle; dirty rule decides the idle disabled state', run: async () => {
      const { document: doc } = fresh();
      const btn = doc.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'Save';
      doc.body.append(btn);
      let release;
      const p = withButton(btn, () => new Promise((r) => { release = r; }), { idleDisabled: () => true });
      assert.equal(btn.disabled, true);
      assert.equal(btn.getAttribute('aria-busy'), 'true');
      assert.ok(btn.classList.contains('is-busy'));
      assert.equal(btn.textContent, 'Saving…');
      assert.ok(btn.querySelector('.btn-spin'));
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        release({ ok: true, data: 1 });
        assert.deepEqual(await p, { ok: true, data: 1 });
        assert.ok(btn.classList.contains('is-done'));
        assert.equal(btn.textContent, 'Saved');
        assert.equal(btn.getAttribute('aria-disabled'), 'true');
        assert.equal(doc.querySelector('#toasts .toasts-sr').textContent, 'Saved');
        mock.timers.tick(2000);
        assert.equal(btn.textContent, 'Save');
        assert.equal(btn.disabled, true, 'clean again → Save disabled');
        assert.ok(!btn.classList.contains('is-done'));
      } finally { mock.timers.reset(); }
    } },
    { name: 'withButton: failure skips done; a throw becomes {ok:false,error}', run: async () => {
      const { document: doc } = fresh();
      const btn = doc.createElement('button'); btn.textContent = 'Test'; doc.body.append(btn);
      assert.deepEqual(await withButton(btn, async () => ({ ok: false, error: 'nope' })), { ok: false, error: 'nope' });
      assert.equal(btn.textContent, 'Test');
      assert.equal(btn.disabled, false);
      assert.deepEqual(await withButton(btn, async () => { throw new Error('boom'); }), { ok: false, error: 'boom' });
      assert.equal(btn.textContent, 'Test');
    } },
  ]);
});

test('(v4) withButton re-attaches the ORIGINAL children: a cached label node stays live', async (t) => {
  const { document: doc } = fresh();
  doc.body.insertAdjacentHTML('beforeend', '<button id="go" class="btn btn-primary"><svg id="play"></svg><span id="lbl">Start run</span></button>');
  const btn = doc.getElementById('go');
  const label = doc.getElementById('lbl');                 // what app.js caches as el.startBtnLabel
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let release;
  const p = withButton(btn, () => new Promise((r) => { release = r; }), { busy: 'Starting…', done: 'Started' });
  label.textContent = 'Schedule';                           // app code writes while busy
  release({ ok: true });
  await p;
  mock.timers.tick(2000);
  assert.equal(doc.getElementById('lbl'), label, 'the same node is back in the button');
  assert.equal(btn.textContent, 'Schedule');
  label.textContent = 'Start run';
  assert.equal(btn.textContent, 'Start run', 'later writes to the cached node still show');
});

test('trackDirty: a sibling going busy fires fb-state and Save waits until it settles', async () => {
  await checkRows([
    { name: '(v4) trackDirty: a sibling going busy fires a bubbling fb-state event', run: async () => {
      const w = fresh(); const doc = w.document;
      doc.body.insertAdjacentHTML('beforeend', '<section class="card"><button id="r">Reset</button></section>');
      const card = doc.querySelector('.card');
      const seen = [];
      card.addEventListener('fb-state', (e) => seen.push(e.target.dataset.fbState || 'idle'));
      await withButton(doc.getElementById('r'), async () => ({ ok: false, error: 'x' }));
      assert.deepEqual(seen, ['busy', 'idle']);
    } },
    { name: '(v4) trackDirty: Save waits while a sibling is busy and re-enables when it settles', run: async () => {
      const w = fresh(); const doc = w.document;
      doc.body.insertAdjacentHTML('beforeend', `<section class="card"><input id="a" value="1">
    <div class="add-project-actions"><button id="r">Reset</button><button id="s">Save</button></div></section>`);
      const card = doc.querySelector('.card'); const save = doc.getElementById('s'); const reset = doc.getElementById('r');
      trackDirty(card, { saveBtn: save });
      const a = doc.getElementById('a');
      a.value = '2'; a.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.equal(save.disabled, false);
      let release;
      const p = withButton(reset, () => new Promise((r) => { release = r; }), { busy: 'Resetting…', done: 'Reset' });
      assert.equal(save.disabled, true, 'no Save while Reset is in flight');
      release({ ok: false, error: 'nope' });
      await p;
      assert.equal(save.disabled, false, 'Reset failed, the card is still dirty: Save is back');
    } },
  ]);
});

test('fieldError: aria-invalid, aria-describedby (kept), message under the field, focus, cleared on edit', () => {
  const w = fresh(); const doc = w.document;
  doc.body.insertAdjacentHTML('beforeend', `<section class="card"><div class="field act-port-range">
    <input id="lo" class="input" aria-describedby="lo-note"><input id="hi" class="input"></div>
    <div class="add-project-actions"><button>Save</button></div></section>`);
  const lo = doc.getElementById('lo'); const hi = doc.getElementById('hi');
  const msg = fieldError([lo, hi], 'The low port can’t be higher than the high port.');
  assert.equal(lo.getAttribute('aria-invalid'), 'true');
  assert.equal(hi.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(lo.getAttribute('aria-describedby').split(' '), ['lo-note', msg.id]);
  assert.equal(hi.getAttribute('aria-describedby'), msg.id);
  assert.equal(msg.parentElement, lo.closest('.field'));
  assert.equal(msg.textContent, 'The low port can’t be higher than the high port.');
  assert.equal(doc.activeElement, lo);
  hi.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('.field-error'), null);
  assert.equal(lo.getAttribute('aria-describedby'), 'lo-note');
  assert.equal(lo.hasAttribute('aria-invalid'), false);
  fieldError(lo, 'x', { focus: false });
  clearFieldErrors(doc.body);
  assert.equal(doc.querySelectorAll('.field-invalid, .field-error').length, 0);
});

test('cardAlert: one per card above the card\'s own action row, role=alert, removable', async () => {
  await checkRows([
    { name: 'cardAlert: one per card, above the action row, role=alert; null and Dismiss remove it', run: () => {
      const { document: doc } = fresh();
      doc.body.insertAdjacentHTML('beforeend', '<section class="card"><div class="field"></div><div class="add-project-actions"><button>Save</button></div><small class="hint"></small></section>');
      const card = doc.querySelector('.card');
      cardAlert(card, { title: 'Not saved', detail: 'Another Worca process is writing the settings file. Try again in a moment.' });
      cardAlert(card, { title: 'Not saved', detail: 'second' });
      const boxes = card.querySelectorAll('.card-alert');
      assert.equal(boxes.length, 1);
      assert.equal(boxes[0].getAttribute('role'), 'alert');
      assert.equal(boxes[0].nextElementSibling, card.querySelector('.add-project-actions'));
      assert.equal(boxes[0].querySelector('.ca-title').textContent, 'Not saved');
      assert.equal(boxes[0].querySelector('.ca-detail').textContent, 'second');
      boxes[0].querySelector('.ca-x').click();
      assert.equal(card.querySelector('.card-alert'), null);
      cardAlert(card, { title: 'a' }); cardAlert(card, null);
      assert.equal(card.querySelector('.card-alert'), null);
    } },
    { name: '(v5) cardAlert prefers the card\'s own action row over a nested one that comes first', run: () => {
      const { document: doc } = fresh();
      doc.body.insertAdjacentHTML('beforeend', `<form id="run-form"><div id="add-project" class="add-project hidden">
    <div class="add-project-actions"><button>Save</button></div></div>
    <div class="field"><textarea id="prompt"></textarea></div>
    <div class="actions" data-card-actions><button id="start-btn">Start run</button></div><p id="form-msg"></p></form>`);
      const form = doc.getElementById('run-form');
      const box = cardAlert(form, { title: 'Run not started', detail: 'Failed to start: HTTP 500' });
      assert.equal(box.nextElementSibling, form.querySelector(':scope > .actions'));
      assert.equal(box.closest('#add-project'), null, 'never inside the hidden add-project panel');
    } },
  ]);
});

test('trackDirty + withButton: Save disabled until a change, reverting disables, Reset never gated, a clean \'Saved\' click ignored', async () => {
  await checkRows([
    { name: 'trackDirty: Save disabled until a change; reverting disables again; marker beside the buttons', run: () => {
      const w = fresh(); const doc = w.document;
      doc.body.insertAdjacentHTML('beforeend', `<section class="card"><input id="a" value="1">
    <select data-dirty-ignore><option value="">Choose</option><option value="x">x</option></select>
    <div class="add-project-actions"><button id="r">Reset</button><button id="s">Save</button></div></section>`);
      const card = doc.querySelector('.card'); const save = doc.getElementById('s'); const a = doc.getElementById('a');
      const d = trackDirty(card, { saveBtn: save });
      const mark = card.querySelector('.dirty-mark');
      assert.equal(mark.parentElement, card.querySelector('.add-project-actions'));
      assert.equal(save.disabled, true);
      assert.equal(mark.hidden, true);
      a.value = '2'; a.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.equal(save.disabled, false);
      assert.equal(mark.hidden, false);
      assert.equal(mark.textContent, 'Unsaved changes');
      a.value = '1'; a.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.equal(save.disabled, true);
      a.value = '3'; d.markClean();
      assert.equal(d.isDirty(), false);
      assert.equal(save.disabled, true);
    } },
    { name: '(v2) withButton + trackDirty: idle Save follows the tracker; Reset is never gated; a click on a clean "Saved" is ignored', run: async () => {
      const w = fresh(); const doc = w.document;
      doc.body.insertAdjacentHTML('beforeend', `<section class="card"><input id="a" value="1">
    <div class="add-project-actions"><button id="r">Reset</button><button id="s">Save</button></div></section>`);
      const card = doc.querySelector('.card'); const save = doc.getElementById('s'); const reset = doc.getElementById('r');
      const a = doc.getElementById('a');
      const d = trackDirty(card, { saveBtn: save });
      a.value = '2'; a.dispatchEvent(new w.Event('input', { bubbles: true }));
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        // No idleDisabled passed: the tracker alone decides the idle state.
        const r1 = await withButton(save, async () => { d.markClean(); return { ok: true }; });
        assert.equal(r1.ok, true);
        let calls = 0;
        assert.deepEqual(await withButton(save, async () => { calls++; return { ok: true }; }), { ok: false, skipped: true });
        assert.equal(calls, 0, 'clean card: a click on "Saved" does not save again');
        mock.timers.tick(2000);
        assert.equal(save.disabled, true, 'clean card → idle Save disabled without an idleDisabled callback');
        assert.equal(card.querySelector('.dirty-mark').hidden, true);
        await withButton(reset, async () => ({ ok: true }), { busy: 'Resetting…', done: 'Reset' });
        mock.timers.tick(2000);
        assert.equal(reset.disabled, false, 'Reset is never gated on dirtiness');
      } finally { mock.timers.reset(); }
    } },
  ]);
});

test('splitMessage: short head becomes the title', () => {
  assert.deepEqual(splitMessage('Install failed: 401 bad token'), { title: 'Install failed', detail: '401 bad token' });
  assert.deepEqual(splitMessage('Deleted.'), { title: 'Deleted.', detail: '' });
});

test('controlSnapshot: every control value or check, minus [data-dirty-ignore], buttons and file inputs', () => {
  const { document: doc } = fresh();
  doc.body.insertAdjacentHTML('beforeend', '<div id="c"><input value="a"><input type="checkbox" checked>'
    + '<select><option>x</option></select><textarea>t</textarea><div data-dirty-ignore><input value="skip"></div>'
    + '<input type="button" value="b"><input type="file"></div>');
  assert.equal(controlSnapshot(doc.getElementById('c')), JSON.stringify(['a', true, 'x', 't']));
});

test('dismiss: a toast that holds focus hands it back, never to BODY', () => {
  const setup = (withMain = true) => {
    const w = new JSDOM(`<!doctype html><body>${withMain ? '<main class="main"></main>' : ''}<button id="trig">Go</button><div id="toasts" class="toasts"></div></body>`, { pretendToBeVisual: true }).window;
    return w;
  };
  const w = setup(); const doc = w.document;
  const trig = doc.getElementById('trig');
  trig.focus();
  const { el } = notify({ tone: 'ok', title: 'x', action: { label: 'Undo', run() {} } }, { doc });
  el.querySelector('.toast-x').focus();
  assert.equal(doc.activeElement.className.includes('toast-x'), true);
  el.querySelector('.toast-x').click();
  assert.equal(doc.activeElement, trig, 'returns to the element focused before the toast');

  const w2 = setup(); const d2 = w2.document;
  const e2 = notify({ tone: 'err', title: 'boom' }, { doc: d2 }).el;
  e2.querySelector('.toast-x').focus();
  e2.querySelector('.toast-x').click();
  assert.equal(d2.activeElement, d2.querySelector('main.main'), 'no remembered element: main');

  const w3 = setup(false); const d3 = w3.document;
  const e3 = notify({ tone: 'err', title: 'boom' }, { doc: d3 }).el;
  e3.querySelector('.toast-x').focus();
  e3.querySelector('.toast-x').click();
  assert.notEqual(d3.activeElement, d3.body, 'no main: first focusable');
});
