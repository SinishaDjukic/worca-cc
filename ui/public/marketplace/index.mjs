// ui/public/marketplace/index.mjs — mounts the Marketplace page on #mk-root (marketplace P3, CONTRACT §3.5): one
// registration line per tab and one provider line per page action. A later plan changes only its own lines; `provide`
// replaces (SM16).
import { createMarketplacePage } from './page.mjs';
import { browseTab, browseAction } from './browse.mjs';
import { createInstallSheet } from './install-sheet.mjs';
import { createInstalledTab } from './installed.mjs';
import { createManageSheet } from './manage-sheet.mjs';
import { createUpdateReview } from './update-sheet.mjs';
import { createMarketplacesTab } from './marketplaces-tab.mjs';
import { createAddMarketplaceDialog } from './add-dialog.mjs';

export { tabFromParam, tabHash, targetFromParam } from './page.mjs';

/** The page on #mk-root (a detached host when the document has none, so a caller always gets a Page). */
export function mountMarketplace({ doc, win, deps }) {
  const host = doc.getElementById('mk-root') ?? doc.createElement('div');
  const page = createMarketplacePage({ doc, win, host, deps });
  page.registerTab('browse', browseTab({ doc }));
  createInstalledTab({ doc, win, page, deps });                                       // the Installed tab and its row actions (P5)
  const marketplaces = createMarketplacesTab({ doc, win, deps, page });
  page.registerTab('marketplaces', marketplaces.spec);
  page.provide('browse', browseAction(page, deps));
  page.provide('openPlugin', createInstallSheet({ doc, win, page, deps }).open);
  const manage = createManageSheet({ doc, win, page, deps });
  page.provide('openManage', (name, opts) => manage.open(name, opts));
  page.provide('checkHealth', (name) => manage.open(name, { section: 'health' }));
  const review = createUpdateReview({ doc, win, page, deps });
  page.provide('openUpdateReview', (names, opts) => review.open(names, opts));
  const addDialog = createAddMarketplaceDialog({ doc, win, deps, page, focusMarketplace: (id) => marketplaces.focus(id) });
  page.provide('openAddMarketplace', (o) => { addDialog.open(o); });   // undefined: renderNoMarketplaces leaves its form alone (LC-P3-23)
  page.provide('marketplaceAddChanged', (job) => addDialog.onJob(job));
  return page;
}
