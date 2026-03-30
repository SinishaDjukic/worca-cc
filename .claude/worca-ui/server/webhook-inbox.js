/**
 * In-memory ring buffer store for webhook inbox events.
 * No persistence — cleared on server restart.
 */

export function createInbox(maxSize = 500) {
  const events = [];
  let nextId = 1;
  let controlAction = 'continue'; // 'continue' | 'pause' | 'abort'

  return {
    push(event) {
      const stored = {
        id: nextId++,
        receivedAt: new Date().toISOString(),
        headers: event.headers || {},
        envelope: event.envelope || {},
        projectId: event.projectId || null,
        controlResponse: { action: controlAction },
      };
      events.push(stored);
      if (events.length > maxSize) {
        events.splice(0, events.length - maxSize);
      }
      return stored;
    },

    list(sinceId, projectId) {
      let result = events;
      if (sinceId != null) {
        result = result.filter((e) => e.id > sinceId);
      }
      if (projectId) {
        result = result.filter((e) => !e.projectId || e.projectId === projectId);
      }
      return [...result];
    },

    clear() {
      events.length = 0;
    },

    size() {
      return events.length;
    },

    getControlAction() {
      return controlAction;
    },

    setControlAction(action) {
      if (['continue', 'pause', 'abort'].includes(action)) {
        controlAction = action;
      }
    },
  };
}
