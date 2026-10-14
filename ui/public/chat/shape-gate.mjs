// ui/public/chat/shape-gate.mjs — the ONE client gate for Shape it first (spec D12). Fed by every WebSocket
// `hello` (a restarted server may have changed it); after #675 the body becomes flagOn('shapeFirst').
let on = false;

/** Called from app.js onHello on EVERY hello frame. */
export function applyShapeFirstHello(msg) {
  on = msg?.features?.shapeFirst === true;
}

export function shapeFirstOn() {
  return on;
}
