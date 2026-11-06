// The Runs list's mock: the runs and groups of the Pulse case in view (shell/world.js). Each row points at a real run-page case: its state, word, section and
// page come from there through the library (runs-list.js), so a list can never call Paused or Stopped Ready.
(function () {
  const seed = () => window.RailWorld.data();
  window.RunsListModel = { seed, PEOPLE: ['Emil Angelov', 'Dana Ruiz'], DAYS: [['upcoming', 'Upcoming'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older']] };
})();
