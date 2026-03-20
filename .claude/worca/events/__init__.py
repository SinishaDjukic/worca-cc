"""
worca.events — pipeline event emission package.

Public API:
  - types: event type constants and payload builders (Task 3)
  - emitter: EventContext and emit_event (Task 4)
  - webhook: HTTP delivery and control response handling (Task 6)
"""

from worca.events.emitter import EventContext, emit_event  # noqa: F401
