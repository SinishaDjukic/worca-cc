// The Tasks list's mock: the tasks and groups of the Pulse case in view (shell/world.js). Each row points at a real task-page case: its state, word, section and
// page come from there through the library (runs-list.js), so a list can never call Paused or Stopped Ready.
(function () {
  const seed = () => window.StillhetWorld.data();
  window.RunsListModel = { seed, PEOPLE: ['Sam Rivera', 'Dana Ruiz'], DAYS: window.StillhetUI.DAY_SECTIONS };
})();
