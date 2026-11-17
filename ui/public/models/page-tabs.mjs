// ui/public/models/page-tabs.mjs — the Models page's tabs (models-menu P1, contract C1). The first path part of the
// address names the tab: #models is Catalogue (#models/model/<id> opens one model there), #models/jobs is Jobs
// (#models/jobs/<card>), #models/providers/<row> is Providers at one row of PROVIDER_ROWS. The strip mirrors
// Marketplace's: links in the shared .tab skin, lit by .on and aria-current="page".
import { icon } from '../icons.mjs';

export const MODELS_PAGE_TABS = Object.freeze(['catalogue', 'jobs', 'providers']);
export const PROVIDER_ROWS = Object.freeze(['copilot', 'openai', 'anthropic', 'speech', 'images', 'sound']);

const LABELS = Object.freeze({ catalogue: 'Catalogue', jobs: 'Jobs', providers: 'Providers' });
const ICON_OF = Object.freeze({ catalogue: 'layers', jobs: 'briefcase', providers: 'cloud' });
// Card addresses written before the tabs (#models/engine, a search pick of a card): their cards now sit on Jobs.
const JOBS_CARDS = new Set(['engine', 'engine-settings-card', 'model-roles-card', 'title-model']);

/** '' → {tab:'catalogue', rest:''}; 'model/x' → catalogue, rest 'model/x'; 'jobs/steps' → jobs, rest 'steps';
 *  'providers/openai' → providers, rest 'openai'; the old card addresses 'engine', 'engine-settings-card',
 *  'model-roles-card', 'title-model' → jobs, rest = that word; anything else → catalogue, rest = param. */
export function parseModelsParam(param = '') {
  const text = String(param ?? '');
  const cut = text.indexOf('/');
  const first = cut === -1 ? text : text.slice(0, cut);
  if (first === 'jobs' || first === 'providers') return { tab: first, rest: cut === -1 ? '' : text.slice(cut + 1) };
  if (JOBS_CARDS.has(text)) return { tab: 'jobs', rest: text };
  return { tab: 'catalogue', rest: text };
}

/** ('catalogue') → 'models'; ('jobs','steps') → 'models/jobs/steps'; ('providers','openai') → 'models/providers/openai';
 *  ('catalogue','model/x') → 'models/model/x'. */
export function modelsHash(tab, rest = '') {
  const base = tab === 'catalogue' ? 'models' : `models/${tab}`;
  return rest ? `${base}/${rest}` : base;
}

/** nav#models-tabs.tabs.mdl-tabs > a.tab.mdl-tab[data-tab][href="#models…"]: icon, name, and on Catalogue span.mdl-tab-count. */
export function renderModelsTabs(doc, { active = 'catalogue', count = null } = {}) {
  const nav = doc.createElement('nav');
  nav.id = 'models-tabs';
  nav.className = 'tabs mdl-tabs';
  nav.setAttribute('aria-label', 'Models');
  for (const tab of MODELS_PAGE_TABS) {
    const a = doc.createElement('a');
    a.className = 'tab mdl-tab';
    a.dataset.tab = tab;
    a.setAttribute('href', `#${modelsHash(tab)}`);
    const name = doc.createElement('span');
    name.className = 'mdl-tab-name';
    name.textContent = LABELS[tab];
    a.append(icon(doc, ICON_OF[tab], 14), name);
    if (tab === 'catalogue') {
      const pill = doc.createElement('span');
      pill.className = 'badge mdl-tab-count';
      pill.hidden = true;
      a.append(pill);
    }
    nav.append(a);
  }
  paintModelsTabs(nav, { active, count });
  return nav;
}

/** Moves `.on` and aria-current="page" to `active`; writes the count (null hides it). */
export function paintModelsTabs(nav, { active, count }) {
  for (const a of nav.querySelectorAll('a.mdl-tab')) {
    const on = a.dataset.tab === active;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const pill = nav.querySelector('.mdl-tab-count');
  if (!pill) return;
  pill.hidden = count == null;
  pill.textContent = count == null ? '' : String(count);
}
