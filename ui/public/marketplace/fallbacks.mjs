// ui/public/marketplace/fallbacks.mjs — the page actions on today's dialogs (marketplace P3, SM16, SM33), one function per
// action, until the plan that replaces an action deletes its function here.
const list = (v) => (Array.isArray(v) ? v : []);

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
