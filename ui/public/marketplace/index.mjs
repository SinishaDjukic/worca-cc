// ui/public/marketplace/index.mjs — mounts the Marketplace page on #mk-root (marketplace P3, CONTRACT §3.5): one
// registration line per tab and one provider line per page action. A later plan changes only its own lines; `provide`
// replaces (SM16).
import { createMarketplacePage } from './page.mjs';
import { browseTab, browseAction } from './browse.mjs';
import { legacyInstalledTab, legacyMarketplacesTab } from './legacy.mjs';
import { fallbackOpenPlugin, fallbackRemove, fallbackUpdateAll, fallbackAddMarketplace } from './fallbacks.mjs';

export { tabFromParam, tabHash } from './page.mjs';

/** The page on #mk-root (a detached host when the document has none, so a caller always gets a Page). */
export function mountMarketplace({ doc, win, deps }) {
  const host = doc.getElementById('mk-root') ?? doc.createElement('div');
  const page = createMarketplacePage({ doc, win, host, deps });
  page.registerTab('browse', browseTab({ doc }));
  page.registerTab('installed', legacyInstalledTab({ doc }));                         // P5 replaces
  page.registerTab('marketplaces', legacyMarketplacesTab({ doc }));                   // P7 replaces
  page.provide('browse', browseAction(page, deps));
  page.provide('openPlugin', (target) => fallbackOpenPlugin(page, deps, target));     // P4 replaces
  page.provide('openManage', (name, o = {}) => deps.fallbacks.openPluginSettings(name, undefined, { seeds: o.seeds ?? null }));   // P6 replaces
  page.provide('openUpdateReview', (names) => fallbackUpdateAll(page, deps, names));  // P6 replaces
  page.provide('updateOne', (name) => deps.fallbacks.updatePlugin(name));             // P5 replaces (name, { opener })
  page.provide('openRemove', (name, o) => fallbackRemove(page, deps, name, o));       // P5 replaces (name, { opener, onRemoved })
  page.provide('openAddMarketplace', (o) => fallbackAddMarketplace(page, deps, o));   // P7 replaces
  page.provide('marketplaceAddChanged', () => {});                                    // P7 replaces (SM16)
  return page;
}
