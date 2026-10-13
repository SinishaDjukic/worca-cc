// extension/src/panel-state.mjs — which tab a window's open sidebar acts on (Pinpoint is live ONLY there). Pure.
export function createPanelState() {
  const panels = new Map();   // windowId -> { pinnedTabId, activeTabId }
  const windowOfActiveTab = (tabId) => { for (const [w, p] of panels) if (p.activeTabId === tabId) return w; return null; };
  return {
    open(windowId, { pinnedTabId = null } = {}) { panels.set(windowId, { pinnedTabId, activeTabId: null }); },
    /** → the tab that was active (to deactivate), or null. */
    close(windowId) { const p = panels.get(windowId); panels.delete(windowId); return p ? p.activeTabId : null; },
    isOpen: (windowId) => panels.has(windowId),
    focus(windowId, tabId) {
      const p = panels.get(windowId);
      if (!p) return { deactivate: null, activate: null };
      const target = p.pinnedTabId ?? tabId;
      if (p.activeTabId === target) return { deactivate: null, activate: null };
      const prev = p.activeTabId;
      p.activeTabId = target;
      return { deactivate: prev, activate: target };
    },
    activeTabOf: (windowId) => (panels.get(windowId) ? panels.get(windowId).activeTabId : null),
    windowOfActiveTab,
    isActiveTab: (tabId) => windowOfActiveTab(tabId) !== null,
  };
}
