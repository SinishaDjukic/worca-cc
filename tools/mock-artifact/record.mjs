// tools/mock-artifact/record.mjs — the recording half of the mock artifact (docs/screenshots.md#mock-artifact).
// tools/readme-screenshots.mjs --record FILE seeds its sandbox and Chrome, then hands them here. This wraps fetch and
// WebSocket in the page, walks every view (opening each tab once), shoots each view for the later pixel check, plays
// one chat turn on the mock engine with a scripted answer, and saves the scrubbed session as one JSON file.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Runs in the page before the app: every fetch and socket frame lands in window.__rec.
const HOOK = `(()=>{const R=window.__rec={http:[],ws:[],t0:Date.now()};
const of=window.fetch.bind(window);
const b64=(buf)=>{let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s);};
window.fetch=async function(input,init){init=init||{};const url=typeof input==='string'?input:(input instanceof URL?input.href:input.url);
 const method=String(init.method||(input&&input.method)||'GET').toUpperCase();
 const body=typeof init.body==='string'?init.body:(init.body?'[binary]':null);
 const e={url,method,body,t:Date.now()-R.t0};R.http.push(e);
 const r=await of(input,init);e.status=r.status;e.ct=r.headers.get('content-type')||'';
 try{const c=r.clone();if(/json|text|javascript|xml|ndjson|event-stream/.test(e.ct)||!e.ct)e.text=await c.text();else e.b64=b64(await c.arrayBuffer());}catch(x){e.err=String(x);}
 return r;};
const OW=window.WebSocket;
window.WebSocket=function(u,p){const ws=p?new OW(u,p):new OW(u);
 ws.addEventListener('message',(ev)=>R.ws.push({dir:'in',data:typeof ev.data==='string'?ev.data:'[binary]',t:Date.now()-R.t0}));
 const os=ws.send.bind(ws);ws.send=(d)=>{R.ws.push({dir:'out',data:typeof d==='string'?d:'[binary]',t:Date.now()-R.t0});return os(d);};
 return ws;};
window.WebSocket.prototype=OW.prototype;Object.assign(window.WebSocket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});
})();`;

// Opens every tab on the current view once, so the fetches behind them are recorded too. check.mjs runs the same
// string against the mock, so both sides reach the same state before their screenshot.
export const OPEN_TABS = `(async()=>{const seen=new Set();for(let k=0;k<12;k++){const t=[...document.querySelectorAll('[role=tab]:not([aria-selected=true]), .tab:not(.active)')].find((e)=>e.offsetParent&&!seen.has(e));if(!t)break;seen.add(t);try{t.click();}catch{}await new Promise(r=>setTimeout(r,500));}return 1;})()`;

// Before each screenshot, on both sides: no smooth scrolling, transitions or animations, so a view that scrolls to its
// target (#settings/experimental/<flag>) is shot at the end of the scroll, not part-way through it.
export const STILL = `(async()=>{let s=document.getElementById('mock-still');if(!s){s=document.createElement('style');s.id='mock-still';
  s.textContent='*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important;caret-color:transparent!important}';
  document.head.appendChild(s);}(document.getAnimations?.()||[]).forEach((a)=>{try{a.finish();}catch{}});
  await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));return 1;})()`;

/** The views the crawl always walks first (hash routes without the #): the seeded records' own pages, which no link
 *  on a page names (rows open on click). Everything else is found by following links (discoverRoutes). */
export function routesFor({ askThread, termThread, csvRun, done, projects, workspace }, liveIds) {
  const run = `history/${csvRun.projectKey}/${csvRun.pipelineId}`;
  return [
    'chat', `chat/${askThread.id}`, ...(termThread ? [`chat/${termThread.id}`] : []), 'chat/new',
    'runs', run, `${run}/details/diff`, `${run}/details/actions`, `${run}/details/logs`,
    ...Object.values(done).slice(0, 6).map((d) => `history/${d.projectKey}/${d.pipelineId}`),
    ...liveIds.map((id) => `running/${id}`),
    'new', 'schedules', 'schedules/repeating', 'schedules/once', 'schedules/activity', 'stats', 'team-metrics', 'team-policy',
    'workflows', 'workflows/agents', 'workflows/scripts', 'marketplace', 'connectors', 'models', 'providers',
    'projects', ...Object.values(projects).map((p) => `projects/${p.key}`), 'workspaces', `workspaces/${workspace.id}`, `workspaces/${workspace.id}/map`,
    'settings', 'settings/general', 'settings/runs', 'settings/ask', 'settings/guardrails', 'settings/memory', 'settings/presets', 'settings/tags', 'settings/experimental',
    'getting-started', 'chat',
  ];
}

// Every route a page offers: sidebar and menu entries ([data-nav], [data-hash]) and in-app links (href="#…"). A route
// counts only when its first part names a view of the page ([data-view]; history/ and running/ are the Runs view's):
// other controls reuse data-nav for their own values (the canvas zoom buttons: in, out, center).
const LINKS = `(()=>{const views=new Set([...document.querySelectorAll('[data-view]')].map((e)=>e.dataset.view).concat(['history','running']));
  return [...document.querySelectorAll('[data-nav],[data-hash],a[href^="#"]')].map((e)=>e.dataset.hash||e.dataset.nav||e.getAttribute('href')||'')
    .filter((h)=>views.has(String(h).replace(/^#/,'').split('/')[0]));})()`;

/** A route's shape: id-like segments (uuids, hex ids, ask_…, project keys ending in -hex8) become ':id', so the crawl
 *  visits a few pages of each kind instead of every run. */
export function routeShape(route) {
  return route.split('/').map((seg) => (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{8,}$|^ask_[\w-]+$|-[0-9a-f]{8}$|^wks-/i.test(seg) ? ':id' : seg)).join('/');
}

/** Normalises what LINKS returns into crawlable routes: no '#', no empty, no whitespace or query. */
export function cleanRoute(raw) {
  const r = String(raw || '').replace(/^#/, '').trim();
  return r && !/[\s?]/.test(r) ? r : null;
}

/** Adds the routes found on a page to the queue: unseen, at most PER_SHAPE of each shape, MAX_ROUTES in all. */
export const PER_SHAPE = 2;
export const MAX_ROUTES = 120;
export function enqueue(queue, found, shapes) {
  for (const raw of found) {
    const r = cleanRoute(raw);
    if (!r || queue.includes(r) || queue.length >= MAX_ROUTES) continue;
    const k = routeShape(r);
    if ((shapes.get(k) || 0) >= PER_SHAPE) continue;
    shapes.set(k, (shapes.get(k) || 0) + 1);
    queue.push(r);
  }
  return queue;
}

/** A file name for a route's screenshot (the same on both sides of the pixel check). */
export const shotName = (i, route) => `${String(i).padStart(2, '0')}-${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`;

/** Replace the machine's paths in a recording's text: the checkout reads as an install, the sandbox as a home folder.
 *  Both spellings: plain, and URL-encoded (projectDir=%2Ftmp%2F… query strings are lookup keys). */
export function scrubText(text, { repo, sandbox }) {
  const pairs = [[repo.replace(/\/$/, ''), '/Users/maya/.local/lib/worca'], [sandbox.replace(/\/$/, ''), '/Users/maya']];
  let out = text;
  for (const [from, to] of pairs) {
    // macOS resolves /tmp to /private/tmp: the server reports both.
    // Longest first: '/private/tmp/x' must go before '/tmp/x' eats its tail.
    const forms = [...new Set([from, from.replace(/^\/private(?=\/)/, ''), from.startsWith('/tmp/') ? `/private${from}` : from])].sort((a, b) => b.length - a.length);
    for (const f of forms) {
      out = out.split(f).join(to).split(encodeURIComponent(f)).join(encodeURIComponent(to));
    }
  }
  return out;
}

// The chat turn's prompt and its scripted answer (src/core/demo-scenario.mjs). The mock artifact's own chat engine
// (shim.js) answers from its own list; this turn records the frames' shape and the page's state after a reply.
const TURN_PROMPT = 'Which runs need me right now?';
const TURN_ANSWER = 'Three runs are waiting on you. Each one stopped at **Clarify** with a few multiple-choice questions, and planning carries on once you answer them:\n\n- **Bulk-edit contact owners** in nimbus-web\n- **Full-text search for the docs** in lumen-docs\n- **Webhooks for deal stage changes** in nimbus-crm\n\nNothing else is running. The newest finished run, **CSV export for contacts**, is ready to ship: its tests pass and the PR description is drafted.';

export async function recordMockSession(ctx) {
  const { out, repo, sandbox, deny, base, api, cdp, ev, until2, kick, waitEvent, sleep, log, pageErrors, startLiveRuns, seed } = ctx;
  const dir = path.dirname(out);
  const shots = path.join(dir, 'real-shots');
  await mkdir(shots, { recursive: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  const liveIds = await startLiveRuns();
  log(`live runs held at clarify: ${liveIds.length}`);
  await api('/api/settings', { uiLevel: 'expert' });
  { const loaded = waitEvent('Page.loadEventFired'); await cdp('Page.navigate', { url: `${base}/#chat` }); await loaded; }
  await until2('window.__np && window.__np.getRun', 'app boot');
  await sleep(1500);

  // The seeded pages first, then whatever each visited page links to (a new page is found by its sidebar entry).
  const routes = [];
  const shapes = new Map();
  enqueue(routes, routesFor(seed, liveIds), new Map());
  for (const r of routes) shapes.set(routeShape(r), (shapes.get(routeShape(r)) || 0) + 1);
  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    await ev(`location.hash=${JSON.stringify(route)};0`); await sleep(1800); await kick(); await sleep(400);
    await ev(OPEN_TABS, 60000).catch(() => null);
    enqueue(routes, (await ev(LINKS).catch(() => [])) || [], shapes);
    await ev(`location.hash=${JSON.stringify(route)};0`); await sleep(900); await kick();
    await ev(STILL).catch(() => null); await kick();
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, 60000);
    await writeFile(path.join(shots, shotName(i, route)), Buffer.from(data, 'base64'));
    log(`recorded ${route}`);
  }

  // One chat turn on the mock engine. It is kept apart (turnMark): the page's state after it is not the start state.
  const scenario = path.join(sandbox, 'mock-chat-scenario.json');
  await writeFile(scenario, JSON.stringify({ chunkMs: 70, ask: [{ match: 'need', title: 'Runs waiting on me', answer: TURN_ANSWER, usage: { input_tokens: 18240, output_tokens: 412 }, costUsd: 0.04 }] }));
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_DEMO_SCENARIO = scenario;
  await ev("window.__rec.turnMark={http:window.__rec.http.length,ws:window.__rec.ws.length};location.hash='chat/new';0");
  await sleep(1500);
  await ev(`(()=>{const t=[...document.querySelectorAll('textarea.ask-input')].find((e)=>e.offsetParent);t.focus();t.value=${JSON.stringify(TURN_PROMPT)};t.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(300);
  await ev("[...document.querySelectorAll('.ask-send')].find((e)=>e.offsetParent).click();0");
  await until2('window.__rec.ws.slice(window.__rec.turnMark.ws).some((w)=>w.data&&w.data.includes(\'"ask-done"\'))', 'the chat turn', 300);
  await sleep(1500);

  // CDP answers one message per call: read the log in slices.
  const len = await ev('(window.__s=JSON.stringify(window.__rec)).length', 120000);
  let json = '';
  for (let o = 0; o < len; o += 2_000_000) json += await ev(`window.__s.slice(${o},${o + 2_000_000})`, 120000);
  const rec = JSON.parse(scrubText(json, { repo, sandbox }));
  rec.version = 1;
  rec.routes = routes;
  rec.timeZone = process.env.TZ || null;
  const text = JSON.stringify(rec);
  // The leak guard of readme-screenshots, applied to the whole recording: only the entry's number is printed.
  const lower = text.toLowerCase();
  const hits = deny.map((d, i) => (lower.includes(d.toLowerCase()) ? i + 1 : 0)).filter(Boolean);
  if (hits.length) throw new Error(`leak in the recording: denylist entry #${hits.join(', #')}`);
  await writeFile(out, text);
  log(`recording ${out}: ${rec.http.length} requests, ${rec.ws.length} socket frames, ${(text.length / 1e6).toFixed(1)} MB`);
  if (pageErrors.length) throw new Error(`page errors while recording:\n${pageErrors.slice(0, 10).join('\n')}`);
}
