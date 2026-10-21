// ui/public/marketplace/legacy.mjs — today's Installed and Marketplaces lists as the page's two other tabs (marketplace
// P3, SM38) until the new tabs replace them. The hosts live in index.html, where app.js binds their listeners at boot;
// each render moves its host into the tab's panel and repaints its list. A page without the hosts paints nothing.
import { renderPluginList, renderOrphanList, renderMarketplaceList } from '../plugins-view.mjs';
import { updatesChip } from './page.mjs';
import { icon } from '../icons.mjs';

// The host, moved into the panel once: found by id while it is still in the document.
function adopt(doc, panel, id) {
  const host = doc.getElementById(id);
  if (host && host.parentNode !== panel) panel.replaceChildren(host);
  return host;
}

/** The Installed tab: count = installed plugins; the chip counts those with an update. */
export function legacyInstalledTab({ doc }) {
  return {
    label: 'Installed',
    count: (state) => state.plugins.length,
    chip: (state) => updatesChip(doc, state.plugins.filter((p) => p?.latest).length),
    render(state, panel) {
      const host = adopt(doc, panel, 'mk-legacy-installed');
      const list = host?.querySelector('#plugins-list');
      if (!list) return;
      const parts = [renderPluginList(state.plugins, { doc, channelStatus: state.channelStatus })];
      if (state.orphans.length) parts.push(renderOrphanList(state.orphans, { doc }));
      list.replaceChildren(...parts);
    },
  };
}

/** The Marketplaces tab: count = marketplaces; the header's Add marketplace opens the page action. */
export function legacyMarketplacesTab({ doc }) {
  return {
    label: 'Marketplaces',
    count: (state) => state.marketplaces.length,
    header(state, el, page) {
      const add = doc.createElement('button');
      add.type = 'button';
      add.className = 'btn btn-primary mk-add-mkt';
      add.dataset.focusKey = 'add-mkt';
      add.append(icon(doc, 'plus', 16), 'Add marketplace');
      add.addEventListener('click', () => page.act('openAddMarketplace', { opener: add }));
      el.append(add);
    },
    render(state, panel) {
      const host = adopt(doc, panel, 'mk-legacy-marketplaces');
      const list = host?.querySelector('#marketplaces-list');
      if (!list) return;
      list.replaceChildren(renderMarketplaceList(state.marketplaces, { doc }));
    },
  };
}
