/**
 * Archive/Unarchive run actions — extracted for testability.
 *
 * @param {object} deps - Injected dependencies
 * @param {function} deps.showConfirm - Confirmation dialog
 * @param {function} deps.showActionError - Error display
 * @param {function} deps.projectUrl - URL builder
 * @param {function} deps.fetchAndUpdateRuns - Refresh runs
 * @param {function} deps.rerender - Re-render UI
 * @param {function} deps.fetchFn - fetch implementation (defaults to global fetch)
 */
export function createArchiveActions({
  showConfirm,
  showActionError,
  projectUrl,
  fetchAndUpdateRuns,
  rerender,
  fetchFn = fetch,
}) {
  function archiveRun(runId) {
    showConfirm(
      {
        label: 'Archive Pipeline Run',
        message:
          "This run will be hidden from the dashboard and history. You can find it later using the 'archived' filter.",
        confirmLabel: 'Archive',
        confirmVariant: 'danger',
        onConfirm: async () => {
          try {
            const res = await fetchFn(projectUrl(`/runs/${runId}/archive`), {
              method: 'POST',
            });
            const data = await res.json();
            if (!data.ok) {
              showActionError(data.error || 'Failed to archive run');
            }
            fetchAndUpdateRuns().catch(() => {});
          } catch (err) {
            showActionError(err?.message || 'Failed to archive run');
          }
        },
      },
      rerender,
    );
  }

  async function unarchiveRun(runId) {
    try {
      const res = await fetchFn(projectUrl(`/runs/${runId}/unarchive`), {
        method: 'POST',
      });
      const data = await res.json();
      if (!data.ok) {
        showActionError(data.error || 'Failed to unarchive run');
      }
      fetchAndUpdateRuns().catch(() => {});
    } catch (err) {
      showActionError(err?.message || 'Failed to unarchive run');
    }
  }

  return { archiveRun, unarchiveRun };
}
