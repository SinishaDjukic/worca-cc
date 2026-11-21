// ui/public/tool-run.mjs — the tool panel's Run tab: a run opened from a chat (a run card, a link) shows in the tool panel
// beside the chat, as one of its tabs, instead of a panel of its own. The run screen itself stays app.js's (the Chat run
// panel, `crp*`: the run pages' own screens in their panel dress, the #chat/<thread>/run/<id>/<tab> address); this kind
// only lends it the tab's host and tells app.js when the tab comes on screen or leaves it. A chat has at most one Run
// tab (the address names one run); it opens only from the chat, never from the + page or a header icon.

export const RUN_FROM_CHAT = 'A run opens here from its card in the chat.';

/**
 * `frame()` → the run panel's element (app.js crpEls().aside), moved into the tab's host while the tab is on screen.
 * `onShown(tab)`: the tab came on screen (opened, or picked again in the strip): app.js shows its run there.
 * `onLeft(tab)`: the tab left the screen (another tab, closed, the panel hidden): app.js closes the run screen and steps
 * the address back to the chat.
 */
export function createRunKind({ frame, onShown, onLeft }) {
  return {
    kind: 'run', label: 'Run', icon: 'run', order: 6,
    strip: false, onlyWhenAvailable: true, folderless: true,
    unavailable: () => RUN_FROM_CHAT,
    title: (tab) => (tab && tab.state && typeof tab.state.title === 'string' && tab.state.title) || 'Run',
    mount(tab, host) {
      const el = frame();
      if (el) { el.hidden = false; host.append(el); }
      onShown(tab);
    },
    unmount(tab) { onLeft(tab); },
    close: async () => true,
  };
}
