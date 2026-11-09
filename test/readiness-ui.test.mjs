// test/readiness-ui.test.mjs — the agent-readiness wiring in ui/public/app.js: chips in the projects
// list, the breakdown flyout, the ignore list (flyout link + project settings card) and the
// readiness-changed WebSocket frame. app.js is a browser monolith that cannot be imported under node,
// so — like ui-id-consistency.test.mjs — these read its source for the contract each piece must keep.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');

/** Source of `function <name>(…) {…}` up to the next top-level `}` line. */
function fnSource(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(app);
  assert.ok(m, `function ${name} exists in app.js`);
  const end = app.indexOf('\n}\n', m.index);
  return app.slice(m.index, end + 3);
}

describe('readiness UI: chips in the projects list', () => {
  it('imports the chip renderer statically', () => {
    assert.match(app, /import \{ renderReadinessChip, readinessAddedToast, readinessMenuModel, renderLevelLabel, LEVEL_WORDS \} from '\.\/readiness-chip\.mjs';/);
  });

  it('turns a readiness-added frame into the one-time toast', () => {
    assert.match(app, /msg\.type === 'readiness-added'[\s\S]{0,200}readinessAddedToast\(msg/);
    assert.match(app, /notify\(toast\)/);
  });

  it('renderProjectsList paints the chips after the list is built', () => {
    assert.match(fnSource('renderProjectsList'), /paintReadinessChips\(\)/);
  });

  it('paintReadinessChips renders from the project summary into the title line, after the name', () => {
    const src = fnSource('paintReadinessChips');
    assert.match(src, /renderReadinessChip\(/);
    assert.match(src, /\.pl-rd-slot/);
    assert.doesNotMatch(src, /\.pl-sync/, 'not the sync column: it wraps under the sync bar and hides with it');
  });

  it('the title line of a keyed row holds the name, then the chip slot', () => {
    const src = fnSource('buildProjectRow');
    assert.match(src, /className = 'pl-title'/);
    assert.match(src, /className = 'pl-rd-slot'/);
    assert.match(src, /title\.append\(name, rdSlot\)/);
    assert.match(src, /main\.append\(title, path\)/);
  });

  it('the header chip is the trigger of one createFlyout popup', () => {
    assert.match(fnSource('newReadinessChip'), /createFlyout\(/);
  });

  it('the row chip is status only: a click on it opens the project page like the rest of the row', () => {
    assert.doesNotMatch(app, /closest\('\.pl-rd'\)/, 'the row click handler no longer skips the chip');
    assert.doesNotMatch(fnSource('paintReadinessChips'), /newReadinessChip\(/);
  });
});

describe('readiness UI: popover v2', () => {
  it('a hash navigation (Back, a link) closes an open popover: it lives on <body>, outside every view', () => {
    assert.match(app, /addEventListener\('hashchange', closeReadinessPopovers\)/);
    assert.match(fnSource('closeReadinessPopovers'), /rec\.fly\.isOpen\(\)\) rec\.fly\.close\(\)/);
  });
  it('Change in Settings scrolls to the card once the card has filled, not before', () => {
    assert.match(fnSource('openReadinessSettings'), /readinessScrollTo = key/);
    assert.match(fnSource('fillReadinessCard'), /readinessScrollTo === key[\s\S]{0,200}scrollIntoView/);
  });
  it('opens below the chip', () => {
    assert.match(fnSource('newReadinessChip'), /mode: 'below'/);
  });
  it('scrolling the page closes it (it is fixed, the chip scrolls away): the list chip on .main, the header chip on its page', () => {
    assert.match(fnSource('newReadinessChip'), /closeOn = document\.querySelector\('\.main'\)/);
    assert.match(fnSource('newReadinessChip'), /createFlyout\(\{[^}]*closeOn,/);
    assert.match(fnSource('paintReadinessHeadChip'), /newReadinessChip\(key, fresh, \{ closeOn: screen \}\)/);
  });
  it('builds from the pure model and never from innerHTML', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /readinessMenuModel\(/);
    assert.doesNotMatch(src, /innerHTML/);
  });
  it('has a fixed head, a scrolling body and a fixed foot', () => {
    const src = fnSource('buildReadinessMenu');
    for (const cls of ['rp-head', 'rp-body', 'rp-foot']) assert.match(src, new RegExp(cls));
  });
  it('offers "Not used here" with an Undo toast that restores the previous value', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Not used here/);
    assert.match(src, /setReadinessTool\(key, t\.name, 'unused'\)/);
    assert.match(src, /label: 'Undo'/);
    assert.match(src, /setReadinessTool\(key, t\.name, prev\)/);
  });
  it('the run engine gets no button and no extra hint: its "(runs use it)" reason says it', () => {
    const src = fnSource('buildReadinessMenu');
    assert.doesNotMatch(src, /rp-hint/);
    assert.match(src, /if \(!t\.runs\)/);
  });
  it('the not-judged line is plain text; the foot keeps the one Settings link', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Not judged: /);
    assert.doesNotMatch(src, /Change in Settings/);
    assert.match(src, /el\('a', '', 'Settings'\)/);
    assert.match(src, /openReadinessSettings\(key\)/);
  });
  it('the head has no pass count: the passed box says it once', () => {
    assert.doesNotMatch(fnSource('buildReadinessMenu'), /rp-count/);
  });
  it('the popover buttons are design-system buttons, and none is a menuitem', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /'btn btn-sm btn-quiet rp-act'/);
    assert.match(src, /'btn btn-sm btn-quiet rp-ign', 'Ignore'/);
    assert.match(src, /'btn btn-sm btn-quiet rp-ign', 'Stop ignoring'/);
    assert.doesNotMatch(src, /menuitem/);
  });
  it('ignored checks can be restored from the popover', () => {
    assert.match(fnSource('buildReadinessMenu'), /Stop ignoring/);
  });
  it('no middle dot in any readiness copy', () => {
    for (const name of ['buildReadinessMenu', 'fillReadinessCard']) assert.doesNotMatch(fnSource(name), /·/);
  });
  it('setReadinessTool writes the whole map and returns the previous value', () => {
    const src = fnSource('setReadinessTool');
    assert.match(src, /'readiness\.tools'/);
    assert.match(src, /return prev/);
  });
});

describe('readiness UI: ignore list and recheck', () => {
  it('ignoring a check PATCHes the project settings with the extended readiness.ignore list', () => {
    const src = fnSource('setReadinessIgnore');
    assert.match(src, /\/settings`/);
    assert.match(src, /method: 'PATCH'/);
    assert.match(src, /'readiness\.ignore'/);
  });

  it('recheck re-evaluates past the cache', () => {
    assert.match(fnSource('fetchReadinessReport'), /refresh=1/);
    assert.match(fnSource('buildReadinessMenu'), /Recheck[\s\S]{0,300}refresh: true/);
  });

  it('an error toast uses the err tone', () => {
    assert.match(fnSource('buildReadinessMenu'), /tone: 'err'/);
  });
});

describe('readiness UI: project settings card', () => {
  it('buildPdSettings appends the Agent Readiness card', () => {
    assert.match(fnSource('buildPdSettings'), /buildReadinessSettingsCard\(/);
  });

  it('the card toggles each check through readiness.ignore with a switch', () => {
    assert.match(fnSource('buildReadinessSettingsCard'), /readiness-settings-card/);
    const src = fnSource('fillReadinessCard');
    assert.match(src, /'Agent readiness'/);
    assert.match(src, /type = 'checkbox'/);
    assert.match(src, /setReadinessIgnore\(/);
  });
});

describe('readiness UI: settings card v2', () => {
  it('one three-way control per tool', () => {
    const src = fnSource('fillReadinessCard');
    assert.match(src, /seg seg-sm/);
    for (const w of ["'Detect'", "'Used'", "'Not used'"]) assert.ok(src.includes(w), w);
    assert.match(src, /aria-pressed/);
  });
  it('says what Detect finds and whether the tool is judged; the run engine\'s line says only how it is judged', () => {
    const src = fnSource('fillReadinessCard');
    assert.match(src, /Detect finds: /);
    assert.match(src, /Detect finds nothing/);
    assert.match(src, /Not judged\./);
    assert.match(src, /textContent: runs \? judged : `\$\{finds\}\. \$\{judged\}`/);
  });
  it('the run engine cannot be set to Not used, and the disabled button says why in its tooltip', () => {
    const src = fnSource('fillReadinessCard');
    assert.match(src, /Runs use this tool, so it is always judged\. To stop, change the Run engine setting\./);
    assert.match(src, /b\.disabled = true; b\.title = 'Runs use this tool';/);
  });
  it('View report is a design-system button', () => {
    assert.match(fnSource('fillReadinessCard'), /className: 'btn btn-sm btn-quiet rs-view'/);
  });
  it('a choice writes through setReadinessTool', () => {
    assert.match(fnSource('fillReadinessCard'), /setReadinessTool\(key, name, v\)/);
  });
  it('the chosen button is marked on, like every .seg', () => {
    assert.match(fnSource('fillReadinessCard'), /classList\.toggle\('on', e\.setting === v\)/);
  });
  it('the card can take focus when Settings is opened from the popover', () => {
    assert.match(fnSource('buildReadinessSettingsCard'), /tabIndex = -1/);
  });
});

describe('readiness UI: WebSocket frame', () => {
  it('readiness-changed refetches the project report and repaints', () => {
    const i = app.indexOf("msg.type === 'readiness-changed'");
    assert.ok(i > 0, 'handled in handleServerMessage');
    const block = app.slice(i, i + 900);
    assert.match(block, /refreshReadiness\(/);
    assert.match(block, /return;/);
  });

  it('readiness-changed also repaints an open popover or a settings card outside the Projects page', () => {
    const i = app.indexOf("msg.type === 'readiness-changed'");
    const block = app.slice(i, i + 600);
    assert.match(block, /readiness-settings-card/);
    assert.doesNotMatch(block, /currentView\(\) === 'projects'\) void refreshReadiness/);
  });

  it('a refreshed report becomes the row summary with its counts', () => {
    assert.match(fnSource('applyReadinessReport'), /summaryOfClient\(report\)/);
    assert.match(app, /const summaryOfClient = \(r\) => \(\{ level: r\.level, failingCount: r\.counts\.mustFix \+ r\.counts\.shouldFix, \.\.\.r\.counts \}\);/);
  });
});

describe('readiness UI: repaint keeps the reader\'s place', () => {
  it('a repaint keeps which boxes are open and the body scroll (spec 5)', () => {
    const src = fnSource('paintReadinessMenu');
    assert.match(src, /\.rp-more/);
    assert.match(src, /scrollTop/);
    assert.match(src, /\.open = true/);
  });
});

describe('readiness UI: one fact once (jsdom)', () => {
  it('no fact twice in the popover', async () => {
    const { JSDOM } = await import('jsdom');
    const { pathToFileURL, fileURLToPath } = await import('node:url');
    const { readIndexHtml } = await import('../src/core/read-index-html.mjs');
    const report = JSON.parse(readFileSync(new URL('./fixtures/readiness-report-not-ready.json', import.meta.url), 'utf8'));
    assert.ok(report.engines.claude.reasons.some((r) => r.kind === 'run-engine'), 'the run engine is used');
    const KEY = 'alpha-00000001';
    const dom = new JSDOM(readIndexHtml(), { url: 'http://localhost:4321/' });
    const { window } = dom;
    try {
      window.Element.prototype.scrollIntoView = function () {};
      window.WebSocket = class { addEventListener() {} send() {} close() {} };
      window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
      const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
      const summary = { level: report.level, failingCount: report.counts.mustFix + report.counts.shouldFix, ...report.counts };
      window.fetch = (url) => {
        const u = String(url);
        if (u.includes(`/api/projects/${KEY}/readiness`)) return ok({ readiness: report });
        if (u.includes(`/api/projects/${KEY}/settings`)) return ok({ own: {}, effective: {} });
        if (u.includes('/api/projects')) return ok({ projects: [{ name: 'alpha', path: '/p/alpha', exists: true, key: KEY, readiness: summary }] });
        if (u.includes('/api/history')) return ok({ pipelines: [], ghAvailable: false });
        return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
      };
      for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
        try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
      }
      const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
      await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
      const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
      window.location.hash = `projects/${KEY}`;
      await settle();
      window.document.querySelector('#proj-detail .pd-rd-slot .pl-rd').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
      await settle();
      const pop = [...window.document.querySelectorAll('.readiness-pop')].find((m) => !m.hidden);
      assert.ok(pop, 'the popover is open');
      assert.equal(pop.querySelector('.rp-hint'), null);
      assert.equal(pop.querySelector('.rp-count'), null);
      assert.equal(pop.querySelectorAll('a[href$="/settings"]').length, 1);
    } finally { window.close(); }
  });
});
