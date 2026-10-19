// ui/public/connection-state.mjs — runs redesign §5a.2: one "server unreachable" state for the whole page. The socket's
// close reports lost(), the next hello reports back(); "down" only after delayMs, so a routine reconnect never flashes.
export const OFFLINE_TEXT = "Can't reach the Worca server. Your runs keep going there; this page catches up when it is back.";

// The default timers resolve the global at call time, so a test's mocked clock drives an instance made at boot.
export function createConnection({ delayMs = 3000, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
  onChange = () => {} } = {}) {
  let down = false;
  let timer = null;
  return {
    lost() {
      if (down || timer) return;
      timer = setTimer(() => { timer = null; down = true; onChange(true); }, delayMs);
    },
    back() {
      if (timer) { clearTimer(timer); timer = null; }
      if (!down) return;
      down = false;
      onChange(false);
    },
    isDown: () => down,
  };
}

/** Paint (idempotent) the one banner into `host`. Hidden while the session-expired alert is up. */
export function paintConnectionBanner(host, down, { onRetry = null } = {}) {
  if (!host) return;
  const doc = host.ownerDocument;
  const show = !!down && !doc.querySelector('.session-expired');
  host.hidden = !show;
  if (onRetry) host.__onRetry = onRetry;   // a later paint may hand a new handler
  if (!show || host.__cb) return;
  host.classList.add('conn-banner');
  host.setAttribute('role', 'status');
  const text = doc.createElement('span');
  text.className = 'conn-banner-text';
  text.textContent = OFFLINE_TEXT;
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm btn-secondary conn-retry';
  b.textContent = 'Retry now';
  b.addEventListener('click', () => { if (typeof host.__onRetry === 'function') host.__onRetry(); });
  host.append(text, b);
  host.__cb = true;
}
