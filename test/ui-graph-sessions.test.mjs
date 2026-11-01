// test/ui-graph-sessions.test.mjs — trays sit behind wires and cards, carry their header and chip, and never move a route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loopFixture, portsFn, AGENTS } from './helpers/graph-view-fixture.mjs';

const viewPath = new URL('../ui/public/graph/view.mjs', import.meta.url).href;
const S = 's_aaaaaaaa';
const OPEN = { sessionVerified: { claude: true }, sessionsOn: true };   // view options: the open gate, and the Labs flag as on
function grouped() {
  const t = loopFixture();                                      // n_agent and n_rev are wired n_agent.plan → n_rev.task
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = S;
  return t;
}

test('the .gv-sessions layer is the first child of .gv-world, before svg.gv-wires', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, ...OPEN });
  view.render(grouped(), {});
  const world = host.querySelector('.gv-world');
  assert.equal(world.firstElementChild.className, 'gv-sessions');
  assert.equal(world.children[1].getAttribute('class'), 'gv-wires');
  const tray = world.querySelector(`.gv-sess[data-session-id="${S}"]`);
  assert.ok(tray);
  const head = tray.querySelector('.gv-sess-head');
  assert.equal(head.getAttribute('role'), 'button');
  assert.equal(head.getAttribute('tabindex'), '0');
  assert.match(head.querySelector('.st').textContent, /^One session · Claude · 2 sub-agents$/);
});

test('members carry the sub-agent chip; non-members do not', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, ...OPEN });
  view.render(grouped(), {});
  assert.equal(view.nodeEl('n_agent').querySelector('.nlabel .nsess .t').textContent, 'sub-agent');
  assert.equal(view.nodeEl('n_task').querySelector('.nsess'), null);
});

test('gate closed (the default today): the header says separate sessions and no member chip shows', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  view.render(grouped(), {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions');
  assert.ok(host.querySelector('.gv-sess').classList.contains('fallback'));
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null);
});

test('sessionRects matches the pure geometry; bounds() contains every tray', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  view.render(grouped(), {});
  const r = view.sessionRects().get(S);
  const tray = host.querySelector('.gv-sess');
  assert.equal(tray.style.left, `${r.x}px`);
  assert.equal(tray.style.width, `${r.w}px`);
  const b = view.bounds();
  assert.ok(b.y <= r.y && b.x <= r.x && b.x + b.w >= r.x + r.w && b.y + b.h >= r.y + r.h);
  // The view hands sessionRects the rendered model, its sizes and its routes (the internal wires' too).
  const { sessionRects } = await import('../src/shared/graph/sessions.mjs');
  const t = grouped();
  view.render(t, {});
  const pure = sessionRects(view.sessionSpecs(), new Map(t.nodes.map((n) => [n.id, n])), view.size,
    new Map(t.wires.map((w) => [w.id, view.curveOf(w.id)])));
  assert.deepEqual(view.sessionRects().get(S), pure.get(S));
});

test('selection and issues: a session issue pips the header, not the card', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  view.render(grouped(), { report: { errors: [{ code: 'V27', message: 'x', nodeId: 'n_agent', sessionId: S }], warnings: [] } });
  const tray = host.querySelector('.gv-sess');
  assert.ok(tray.classList.contains('bad'));
  assert.ok(tray.querySelector('.gv-sess-head .npip'));
  assert.equal(view.nodeEl('n_agent').querySelector('.npip'), null);
  view.setSelection({ kind: 'session', id: S });
  assert.ok(tray.classList.contains('sel'));
});

test('moveNodes re-routes once; setSessionChrome is a class/text toggle', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  const t = grouped();
  view.render(t, {});
  const before = view.stats.wireDUpdates;
  const r0 = view.sessionRects().get(S);
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).x += 22;
  view.moveNodes(['n_agent', 'n_rev']);
  assert.ok(view.stats.wireDUpdates > before);
  const tray = host.querySelector('.gv-sess');
  const r1 = view.sessionRects().get(S);
  assert.notEqual(r1.x, r0.x, 'the tray follows a drag frame (rerouteAll repaints it)');
  assert.equal(tray.style.left, `${r1.x}px`);
  const node = tray.firstChild;
  view.setSessionChrome(S, { status: 'active', text: 'One session · Claude · Plan · fix 2', right: 'turn 5 · 6m 12s · $2.41', title: 'T' });
  assert.equal(tray.firstChild, node, 'no rebuild');
  assert.ok(tray.classList.contains('is-active'));
  assert.equal(tray.querySelector('.sr').textContent, 'turn 5 · 6m 12s · $2.41');
  assert.equal(tray.querySelector('.gv-sess-head').getAttribute('role'), 'group');
  // Task 56's applyDecor is self-clearing: `right: null` (below expert) clears, `text: null` puts the painted words back.
  view.setSessionChrome(S, { status: 'stopped', text: null, right: null, aria: 'One session: Plan, Plan. stopped' });
  assert.ok(tray.classList.contains('is-stopped') && !tray.classList.contains('is-active'));
  assert.equal(tray.querySelector('.sr').textContent, '');
  assert.equal(tray.querySelector('.st').textContent, 'One session · Claude: separate sessions');
  assert.equal(tray.querySelector('.gv-sess-head').getAttribute('aria-label'), 'One session: Plan, Plan. stopped');
  view.setSessionChrome(S, { status: 'interrupted', aria: null });
  assert.ok(tray.classList.contains('is-interrupted'));
  assert.equal(tray.querySelector('.gv-sess-head').getAttribute('aria-label'), 'One session: Plan, Plan. 2 steps, separate sessions.');
  assert.equal(tray.querySelector('.st').textContent, 'One session · Claude: separate sessions', 'a key left out keeps its value');
});

// ── corrections: every branch the plan pins has its own case ──
const { realPortsFn } = await import('./helpers/graph-ports.mjs');
const { SEED_TEMPLATES } = await import('../src/core/graph/seed-templates.mjs');
const { autoLayout } = await import('../src/shared/graph/layout.mjs');
const crosses = (pts, r) => pts.some((p, i) => i > 0 && p.y === pts[i - 1].y && p.y > r.y && p.y < r.y + r.h
  && Math.max(p.x, pts[i - 1].x) > r.x && Math.min(p.x, pts[i - 1].x) < r.x + r.w);

test('an ungrouped template creates no layer at all', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, ...OPEN });
  view.render(loopFixture(), {});
  assert.equal(host.querySelector('.gv-sessions'), null);
  assert.equal(host.querySelector('.gv-world').firstElementChild.getAttribute('class'), 'gv-wires');
  assert.equal(view.sessionRects().size, 0);
});

test('the view routes every lane around the header strip', async () => {
  const real = realPortsFn();
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_no-clarify'));
  const pos = autoLayout(t, real, { describe: true });
  for (const n of t.nodes) Object.assign(n, pos[n.id]);
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const bare = createGraphView(host, { doc, mode: 'edit', portsFn: real, agents: {} });
  bare.render(t, {});
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = S;
  const b2 = boot();
  const view = createGraphView(b2.host, { doc: b2.doc, mode: 'edit', portsFn: real, agents: {} });
  view.render(t, {});
  const head = view.sessionRects().get(S).head;
  assert.ok(t.wires.some((w) => bare.wireRoute(w.id) && crosses(bare.wireRoute(w.id), head)), 'the test bites');
  assert.equal(t.wires.filter((w) => view.wireRoute(w.id) && crosses(view.wireRoute(w.id), head)).length, 0);
});

test('shared mode: its own header words and the shared chip; aria-label names the steps', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, ...OPEN });
  const t = grouped();
  t.sessions = { [S]: { label: 'Build and review', mode: 'shared' } };
  view.render(t, {});
  const head = host.querySelector('.gv-sess-head');
  assert.equal(head.querySelector('.st').textContent, 'Build and review · Claude · shared conversation · 2 steps');
  assert.equal(head.getAttribute('aria-label'), 'Build and review: Plan, Plan. 2 steps, one conversation.');
  assert.equal(view.nodeEl('n_rev').querySelector('.nsess .t').textContent, 'shared');
});

test('the Labs flag off draws the open gate as separate sessions too (C14); a lone member is dashed', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, sessionVerified: { claude: true }, sessionsOn: false });
  view.render(grouped(), {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions');
  assert.equal(view.nodeEl('n_rev').querySelector('.nsess'), null);
  const shared = grouped();
  shared.sessions = { [S]: { mode: 'shared' } };
  view.render(shared, {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions', 'shared falls back too');
  assert.equal(view.nodeEl('n_rev').querySelector('.nsess'), null);
  const lone = loopFixture();
  lone.nodes.find((n) => n.id === 'n_agent').config.session = S;
  view.render(lone, {});
  assert.ok(host.querySelector('.gv-sess').classList.contains('lone'));
  assert.equal(host.querySelector('.gv-sess-head').getAttribute('aria-label'), 'One session: Plan. 1 step, separate sessions.');
});

test('with the flag on and the gate open, a lone member still runs on its own: separate sessions, no chip', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, ...OPEN });
  const lone = loopFixture();
  lone.nodes.find((n) => n.id === 'n_agent').config.session = S;
  view.render(lone, {});
  const tray = host.querySelector('.gv-sess');
  assert.ok(tray.classList.contains('lone') && tray.classList.contains('fallback'));
  assert.equal(tray.querySelector('.st').textContent, 'One session · Claude: separate sessions');
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null, 'no "sub-agent" chip on a step that runs on its own');
});

test('a session warning ambers the header, not the card; V25 (sessionId null) still pips the card', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  view.render(grouped(), { report: { errors: [{ code: 'V25', message: 'bad id', nodeId: 'n_task', sessionId: null }],
    warnings: [{ code: 'V28', message: 'loop runs outside', nodeId: 'n_agent', sessionId: S }] } });
  const tray = host.querySelector('.gv-sess');
  assert.ok(tray.classList.contains('warn'));
  assert.equal(tray.classList.contains('bad'), false);
  assert.equal(tray.querySelector('.gv-sess-head .nwarn').dataset.sessionId, S);
  assert.equal(view.nodeEl('n_agent').querySelector('.nwarn'), null);
  assert.ok(view.nodeEl('n_task').querySelector('.npip'));
  view.render(grouped(), { report: { errors: [], warnings: [] } });
  assert.equal(tray.classList.contains('warn'), false);
  assert.equal(tray.querySelector('.nwarn'), null);
});

test('the chip survives a label repaint; ungrouping removes the tray and the chip', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, ...OPEN });
  view.render(grouped(), {});
  view.repaintMeta({ ...AGENTS, planner: { ...AGENTS.planner, displayName: 'Planner' } });
  assert.equal(view.nodeEl('n_agent').querySelector('.nlabel .tt').textContent, 'Planner');
  assert.equal(view.nodeEl('n_agent').querySelector('.nlabel .tt').nextElementSibling.className, 'nsess', 'right after the title');
  view.render(loopFixture(), {});
  assert.equal(host.querySelector('.gv-sess'), null);
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null);
});

test('a static host keeps the strip (routes match the monitor), shows no chip, and keeps the words in its title', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, ...OPEN });
  view.render(grouped(), {});
  const head = host.querySelector('.gv-sess-head');
  assert.equal(head.hidden, false);
  assert.equal(head.title, 'One session · Claude · 2 sub-agents');
  assert.ok(head.querySelector('.sdot'));
  assert.equal(host.querySelector('.nsess'), null);
});

test('flag on with the gate shut: a lanes host draws separate sessions and no chip', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS, sessionsOn: true, sessionVerified: { claude: false } });
  view.render(grouped(), {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions');
  assert.ok(host.querySelector('.gv-sess').classList.contains('fallback'));
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null);
});

test('a run decor\'s fallback wins: the member chips go and come back; a key left out keeps the status', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, ...OPEN });
  view.render(grouped(), {});
  assert.ok(view.nodeEl('n_agent').querySelector('.nsess'), 'the gate is open: the chip shows');
  const tray = host.querySelector('.gv-sess');
  view.setSessionChrome(S, { status: 'active', fallback: true });
  assert.ok(tray.classList.contains('fallback'));
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null, 'the run fell back: no "sub-agent" chip (C14)');
  view.repaintMeta(AGENTS);
  assert.equal(view.nodeEl('n_rev').querySelector('.nsess'), null, 'a label repaint keeps it away');
  const renamed = grouped();
  renamed.sessions = { [S]: { label: 'Build' } };
  view.render(renamed, {});
  assert.ok(tray.classList.contains('fallback'), 'a paint with new words keeps the decor\'s fallback');
  view.setSessionChrome(S, { aria: 'One session: Plan, Plan. running Plan, turn 5' });
  assert.ok(tray.classList.contains('is-active'), 'a key left out keeps its value, the status too');
  view.setSessionChrome(S, { fallback: false });
  assert.equal(tray.classList.contains('fallback'), false);
  assert.ok(view.nodeEl('n_rev').querySelector('.nsess'), 'the chip comes back');
  view.setSessionChrome(S, null);
  view.setSessionChrome(S, { status: null });
  assert.equal(tray.classList.contains('is-active'), false, 'status: null clears it');
});

test('a run decor\'s fallback: false wins over a painted fallback: solid, the chips come, a repaint keeps it', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, sessionVerified: { claude: true }, sessionsOn: false });
  view.render(grouped(), {});
  const tray = host.querySelector('.gv-sess');
  assert.ok(tray.classList.contains('fallback'), 'the flag is off: the paint falls back');
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null);
  // The run did run them as sub-agents (Task 57: "once a decor exists, its fallback wins"); a decor sets its words too.
  view.setSessionChrome(S, { fallback: false, text: 'One session · Claude · 2 sub-agents' });
  assert.equal(tray.classList.contains('fallback'), false);
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess .t').textContent, 'sub-agent', 'the chips follow the run');
  const renamed = grouped();
  renamed.sessions = { [S]: { label: 'Build' } };
  view.render(renamed, {});
  assert.equal(tray.classList.contains('fallback'), false, 'a paint with new words keeps the decor\'s answer');
  assert.ok(view.nodeEl('n_rev').querySelector('.nsess'));
});
