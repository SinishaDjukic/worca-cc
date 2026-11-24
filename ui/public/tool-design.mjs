// ui/public/tool-design.mjs — the tool panel's Design tab (docs/design.md, "In the chat"): a design chat's stage
// (preview, builds, agents, pictures, Export) beside its chat. The stage belongs to the chat's design studio
// (design/studio.mjs), which app.js keeps for the design chat on screen; this kind only lends it the tab's host. Its
// icon and + row show on a design chat only, and it needs no project folder (most designs have No project).

export const DESIGN_ONLY = 'Only a design chat has a design.';

/** `studioFor(threadId)` → the open design chat's studio (attachStage/detachStage), or null. The panel can mount the
 *  tab before the chat's studio exists (a design chat opened with its panel open): the tab waits, and `ready(threadId)`
 *  (app.js, once the studio is made) gives it the stage. */
export function createDesignKind({ doc, studioFor }) {
  const studioOf = (scope) => (scope && scope.type === 'chat' ? studioFor(scope.id) : null);
  let waiting = null;   // { tab, host }: a mounted tab whose chat had no studio yet
  return {
    kind: 'design', label: 'Design', icon: 'design', order: 5,
    strip: true, onlyWhenAvailable: true, folderless: true,
    unavailable: (view) => (studioOf(view && view.side) ? null : DESIGN_ONLY),
    title: () => 'Design',
    mount(tab, host) {
      const studio = studioOf(tab.scope);
      if (!studio) {
        waiting = { tab, host };
        const line = doc.createElement('div');   // docs/design-system.md: the empty line
        line.className = 'empty-line';
        const t = doc.createElement('span');
        t.className = 'el-t';
        t.textContent = 'No design here';
        const why = doc.createElement('span');
        why.textContent = DESIGN_ONLY;
        line.append(t, why);
        host.append(line);
        return undefined;
      }
      return studio.attachStage(host);
    },
    unmount(tab) {
      if (waiting && waiting.tab.id === tab.id) waiting = null;
      studioOf(tab.scope)?.detachStage();
    },
    /** The design chat `threadId` has its studio now: a tab of it that is on screen takes the stage. */
    ready(threadId) {
      const w = waiting;
      const studio = w && w.tab.scope && w.tab.scope.id === threadId ? studioOf(w.tab.scope) : null;
      if (!studio) return;
      waiting = null;
      w.host.replaceChildren();
      void studio.attachStage(w.host);
    },
  };
}
