// ui/public/marketplace/fallbacks.mjs — the page actions on today's dialogs (marketplace P3, SM16, SM33), one function per
// action, until the plan that replaces an action deletes its function here.
const list = (v) => (Array.isArray(v) ? v : []);

/** openPlugin: a CatalogItem, or `{ name, marketplace }` resolved in state.catalog. Installed → openManage; no snapshot
 *  sha → nothing; else today's install consent. */
export function fallbackOpenPlugin(page, deps, target) {
  const { state } = page;
  const item = target && typeof target.marketplace === 'object' && target.marketplace ? target
    : state.catalog.find((i) => i.name === target?.name && (!target?.marketplace || i.marketplace.id === target.marketplace));
  const name = item?.name ?? target?.name;
  if (!name) return;
  if (item ? item.installed : state.plugins.some((p) => p?.name === name)) { page.act('openManage', name); return; }
  if (!item?.source.sha) return;
  deps.fallbacks.openInstallConsent({ name: item.name, subdir: item.source.subdir, repoUrl: item.source.repoUrl, sha: item.source.sha,
    inventory: item.entry?.inventory || {}, marketplace: item.marketplace.id });
}

/** openRemove: today's uninstall confirm with the sets the plugin's servers and skills leave; onRemoved after a removal. */
export async function fallbackRemove(page, deps, name, { onRemoved = null } = {}) {
  const row = page.state.plugins.find((p) => p?.name === name);
  const removed = await deps.fallbacks.uninstallPlugin(name, { mcpSets: list(row?.mcpSets).join(', '), skillSets: list(row?.skillSets).join(', ') });
  if (removed === true) onRemoved?.();
  return removed;
}

/** openUpdateReview: today's update preview for each name (default: every plugin with an update), one after another. */
export async function fallbackUpdateAll(page, deps, names) {
  const todo = Array.isArray(names) ? names : page.state.plugins.filter((p) => p?.latest).map((p) => p.name);
  for (const name of todo) {
    if (await deps.fallbacks.updatePlugin(name)) await deps.fallbacks.waitModalClosed();
  }
}

/** openAddMarketplace: without a url, the Marketplaces tab and today's add row; with one, the add itself (the empty
 *  Browse form) — a success reloads the page and says what was added. Returns the API result. */
export async function fallbackAddMarketplace(page, deps, { url = '' } = {}) {
  if (!url) {
    page.setTab('marketplaces');
    deps.fallbacks.addMarketplace();
    return null;
  }
  const r = await deps.api('POST', '/api/marketplaces', { url });
  if (!r?.ok) return r;
  await page.load();
  const data = r.data || {};
  if (data.linked) {
    const n = list(data.plugin?.workflows?.imported).length;
    deps.setMsg(`Linked plugin "${data.plugin.name}" from ${data.plugin.dir} — ${n} pipeline template${n === 1 ? '' : 's'} added to your saved pipelines.`, 'ok');
  } else {
    deps.setMsg(`Added ${data.marketplace?.name} (${list(data.marketplace?.plugins).length} plugins).`, 'ok');
  }
  return r;
}
