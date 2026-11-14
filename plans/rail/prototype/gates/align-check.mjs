// The alignment check of a settings tab, shared by ds-check.mjs and its own test: run it in the page (page.evaluate).
// --- alignment: a settings tab's rows line up because the components draw them; this proves it on the page ---
// Every group of SettingsRows: one left edge for the rows' names, the rows and the section's line and head, one right edge
// where every row's end stops (a quiet button by its text, not its padding), and the name, the sentence and the end's
// first words on one baseline. Measured with a zero-size probe at the start of each text: its bottom is the baseline.
export const ALIGN = () => {
  const out = []; const near = (a, b) => Math.abs(a - b) <= 1;
  // The baseline of an element's first words: the bottom of their glyph box less the font's descent (measured once per
  // font on a probe), so it holds for text in a flex button as well as in a line.
  const descents = new Map();
  const descent = (font) => {
    if (!descents.has(font)) { const t = document.createElement('span'); t.style.cssText = `position:absolute;visibility:hidden;font:${font};line-height:normal`; t.innerHTML = 'x<span style="display:inline-block;width:0;height:0"></span>'; document.body.append(t); const g = document.createRange(); g.selectNodeContents(t.firstChild); descents.set(font, g.getBoundingClientRect().bottom - t.lastChild.getBoundingClientRect().bottom); t.remove(); }
    return descents.get(font);
  };
  const base = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 3) }); const n = w.nextNode(); if (!n) return NaN; const g = document.createRange(); g.selectNodeContents(n); const r = g.getClientRects()[0]; return r.bottom - descent(getComputedStyle(n.parentElement).font); };
  const textBox = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const label = (row) => (row.querySelector('.set-name')?.textContent || '?').slice(0, 30);
  for (const list of document.querySelectorAll('.set-rows')) {
    const rows = [...list.children].filter((e) => e.matches('.set-row') && e.offsetParent);
    if (!rows.length) continue;
    const box = rows[0].getBoundingClientRect(); const L = box.left, R = box.right;
    const folded = !!list.closest('.set-detail');   // a folded row: its name over its sentence, its end at the right
    const stacked = folded || getComputedStyle(rows[0]).gridTemplateColumns.split(' ').length === 1;
    const head = list.parentElement.matches('.set-sec') && list.parentElement.querySelector(':scope > .set-sec-head');
    const sec = list.parentElement.matches('.set-sec') ? list.parentElement.getBoundingClientRect() : null;
    if (sec && (!near(sec.left, L) || !near(sec.right, R))) out.push(`the section's line is off the rows' edges: ${list.parentElement.querySelector('.set-sec-h')?.textContent.slice(0, 30)}`);
    if (head) {
      const h = textBox(head.querySelector('.set-sec-h'));
      if (!near(h.left, L)) out.push(`the head starts ${Math.round(h.left - L)}px off its rows: ${head.textContent.trim().slice(0, 30)}`);
      const act = head.querySelector(':scope > .btn, :scope > .tip-wrap > .btn');
      if (act) { const r = act.matches('.btn-quiet') ? textBox(act).right : act.getBoundingClientRect().right; if (!near(r, R)) out.push(`the head's action ends ${Math.round(R - r)}px off the right edge: ${head.textContent.trim().slice(0, 30)}`); }
    }
    for (const row of rows) {
      const b = row.getBoundingClientRect(); const name = row.querySelector('.set-name'), text = row.querySelector('.set-text'), end = row.querySelector('.set-end');
      if (!near(b.left, L) || !near(b.right, R)) out.push(`a row off the edges: ${label(row)}`);
      if (!near(textBox(name).left, L)) out.push(`a name off the left edge: ${label(row)}`);
      if (stacked && text.textContent.trim() && !near(textBox(text).left, L)) out.push(`a stacked sentence off the left edge: ${label(row)}`);
      const first = [...end.children].find((e) => e.offsetParent);
      if (stacked && !folded && first) { const l = first.matches('.btn-quiet') ? textBox(first).left : first.getBoundingClientRect().left; if (!near(l, L)) out.push(`a stacked end starts ${Math.round(l - L)}px off the left edge: ${label(row)}`); }
      const items = [...end.children].filter((e) => e.offsetParent);
      const last = items[items.length - 1];
      if (last && (!stacked || folded)) { const r = last.matches('.btn-quiet') ? textBox(last).right : last.getBoundingClientRect().right; if (!near(r, R)) out.push(`the end stops ${Math.round(R - r)}px off the right edge: ${label(row)}`); }
      if (!stacked) {
        const y = base(name);
        if (text.textContent.trim() && !near(base(text), y)) out.push(`the sentence is ${Math.round(base(text) - y)}px off the name's baseline: ${label(row)}`);
        for (const it of items) if (it.matches('.btn') && it.textContent.trim() && !near(base(it), y)) out.push(`${it.textContent.trim().slice(0, 16)} is ${Math.round(base(it) - y)}px off the name's baseline: ${label(row)}`);
      }
    }
    const sl = rows.filter((r) => !stacked && r.querySelector('.set-text').textContent.trim()).map((r) => textBox(r.querySelector('.set-text')).left);
    if (sl.some((x) => !near(x, sl[0]))) out.push(`the sentences start on ${new Set(sl.map(Math.round)).size} edges: ${label(rows[0])}…`);
  }
  // One rail, one end: in every list of rows, on one edge each: the marks, the text, and the end's left and right.
  const edges = (rows, name, sel) => { const xs = rows.map((r) => r.querySelector(sel)).filter((e) => e && e.offsetParent).map((e) => e.getBoundingClientRect()); return { xs, name }; };
  const ROWS = [['.list-rows', ':scope > .list-row', { mark: '.lr-rail', text: '.lr-main', end: '.lr-end' }], ['.sc-subs', ':scope > .sc-row', { mark: '.rd-route-dot', text: '.sc-name' }], ['.pz-list', ':scope > .pz-row', { mark: '.pz-rail', text: '.pz-row-main', endR: '.pz-row-time' }]];
  for (const [box, sel, parts] of ROWS) for (const list of document.querySelectorAll(box)) {
    const rows = [...list.querySelectorAll(sel)].filter((r) => r.offsetParent); if (rows.length < 2) continue;
    for (const [what, s] of Object.entries(parts)) {
      const { xs } = edges(rows, what, s); if (xs.length < 2) continue;
      if (what !== 'endR' && xs.some((x) => !near(x.left, xs[0].left))) out.push(`${box}: its rows' ${what} start on ${new Set(xs.map((x) => Math.round(x.left))).size} edges`);
      if ((what === 'end' || what === 'endR') && xs.some((x) => !near(x.right, xs[0].right))) out.push(`${box}: its rows' ends stop on ${new Set(xs.map((x) => Math.round(x.right))).size} edges`);
    }
  }
  // The end's columns: in a list, its switches stand on one edge, and so do its ⋯ and its chips; nothing in an end overlaps.
  for (const list of document.querySelectorAll('.list-rows')) {
    if (getComputedStyle(list).gridTemplateColumns.split(' ').length < 6) continue;
    for (const [what, sel] of [['switches', ':scope > .list-row > .lr-end > .switch'], ['⋯', ':scope > .list-row > .lr-end > .rc-pop']]) {
      const xs = [...list.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().right);
      if (xs.some((x) => !near(x, xs[0]))) out.push(`a list's ${what} stop on ${new Set(xs.map(Math.round)).size} edges`);
    }
    for (const end of list.querySelectorAll(':scope > .list-row > .lr-end')) {
      const kids = [...end.children].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
      for (let i = 1; i < kids.length; i++) if (kids[i].left < kids[i - 1].right - 1 && kids[i].right > kids[i - 1].left + 1) out.push(`two things overlap in a row's end: ${end.textContent.trim().slice(0, 30)}`);
    }
  }
  // a record's title starts on its section's text edge: its mark hangs left of it
  for (const sec of document.querySelectorAll('.set-sec')) {
    const h = sec.querySelector(':scope > .set-sec-head .set-sec-h'); if (!h || !h.offsetParent) continue;
    const L = textBox(h).left;
    for (const t of sec.querySelectorAll(':scope > .set-rows > .list .lr-t')) if (t.offsetParent && !near(textBox(t).left, L)) out.push(`a record's title is ${Math.round(textBox(t).left - L)}px off the text edge: ${t.textContent.slice(0, 30)}`);
  }
  return out;
};

