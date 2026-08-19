/**
 * Minimal Discord Gateway v10 client (chat-connectivity-design.md §4.9) —
 * zero dependencies (global WebSocket, no compression: undici's client has no
 * permessage-deflate and Discord compression is opt-in). Implements exactly
 * what a chat channel needs: identify, heartbeat/ACK tracking, resume via
 * resume_gateway_url + seq, close-code handling, MESSAGE_CREATE dispatch.
 *
 * Intents: GUILDS (1) + GUILD_MESSAGES (512) + MESSAGE_CONTENT (32768).
 * MESSAGE_CONTENT is a privileged intent — close code 4014 means the toggle
 * is off in the Developer Portal (Bot -> Privileged Gateway Intents).
 */

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 };
export const INTENTS = 1 | 512 | 32768; // 33281

const RECONNECT_DELAYS = [1000, 5000, 30000];

/**
 * @param {{token:string, gatewayUrl:string,
 *          onMessage:(m:object)=>void, onState:(state:string, detail?:string)=>void,
 *          onFatal:(detail:string, kind:'auth'|'plugin')=>void, log:(l:string,m:string)=>void,
 *          WebSocketImpl?:typeof WebSocket, _sleep?:(ms:number)=>Promise<void>,
 *          random?:()=>number}} opts
 */
export function createGatewayClient({
  token, gatewayUrl, onMessage, onState, onFatal, log,
  WebSocketImpl = globalThis.WebSocket,
  _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  let ws = null;
  let running = false;
  let seq = null;
  let sessionId = null;
  let resumeUrl = null;
  let heartbeatTimer = null;
  let jitterTimer = null;
  let ackPending = false;
  let reconnects = 0;
  let identity = null;

  const send = (op, d) => { try { ws?.send(JSON.stringify({ op, d })); } catch { /* dying socket */ } };

  const stopHeartbeat = () => {
    clearInterval(heartbeatTimer);
    clearTimeout(jitterTimer);
    heartbeatTimer = null;
    jitterTimer = null;
    ackPending = false;
  };

  const startHeartbeat = (intervalMs) => {
    stopHeartbeat();
    const beat = () => {
      if (ackPending) {
        // Zombie connection (missed ACK): close and resume.
        log('warn', 'gateway heartbeat ACK missed — resuming');
        try { ws?.close(4009); } catch { /* already closed */ }
        return;
      }
      ackPending = true;
      send(OP.HEARTBEAT, seq);
    };
    // First beat after interval * jitter (gateway spec); the steady interval
    // starts only AFTER that first beat so the two never race.
    jitterTimer = setTimeout(() => {
      if (!running || !ws) return;
      beat();
      heartbeatTimer = setInterval(() => { if (running && ws) beat(); }, intervalMs);
    }, Math.floor(intervalMs * random()));
  };

  function handleFrame(raw, owner) {          // owner = the socket this frame arrived on
    let frame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (frame.s != null) seq = frame.s;
    switch (frame.op) {
      case OP.HELLO: {
        startHeartbeat(frame.d.heartbeat_interval);
        if (sessionId && resumeUrl) {
          send(OP.RESUME, { token, session_id: sessionId, seq });
        } else {
          send(OP.IDENTIFY, {
            token,
            intents: INTENTS,
            properties: { os: process.platform, browser: 'worca-cc', device: 'worca-cc' },
          });
        }
        break;
      }
      case OP.HEARTBEAT: // gateway asked for an immediate beat
        send(OP.HEARTBEAT, seq);
        break;
      case OP.HEARTBEAT_ACK:
        ackPending = false;
        break;
      case OP.RECONNECT:
        log('info', 'gateway requested reconnect — resuming');
        try { ws?.close(4900); } catch { /* already closed */ }
        break;
      case OP.INVALID_SESSION: {
        const resumable = frame.d === true;
        if (!resumable) { sessionId = null; resumeUrl = null; }
        log('warn', `gateway invalid session (resumable=${resumable})`);
        const target = owner ?? ws;           // never close a REPLACEMENT socket from this stale timer
        setTimeout(() => { if (ws === target) { try { target?.close(4901); } catch { /* noop */ } } },
          1000 + Math.floor(random() * 4000));
        break;
      }
      case OP.DISPATCH: {
        if (frame.t === 'READY') {
          sessionId = frame.d.session_id;
          resumeUrl = frame.d.resume_gateway_url || null;
          identity = frame.d.user?.username ?? null;
          reconnects = 0;
          onState('connected');
        } else if (frame.t === 'RESUMED') {
          reconnects = 0;
          onState('connected');
        } else if (frame.t === 'MESSAGE_CREATE') {
          onMessage(frame.d);
        }
        break;
      }
      default:
        break;
    }
  }

  async function connectLoop() {
    while (running) {
      const url = `${resumeUrl || gatewayUrl}?v=10&encoding=json`;
      onState('connecting');
      const socket = new WebSocketImpl(url);
      ws = socket;
      const done = new Promise((resolve) => {
        socket.addEventListener('close', (e) => resolve({ code: e?.code ?? 0 }), { once: true });
        socket.addEventListener('error', () => resolve({ code: 0 }), { once: true });
      });
      socket.addEventListener('message', (e) => handleFrame(typeof e.data === 'string' ? e.data : String(e.data), socket));
      const { code } = await done;
      stopHeartbeat();
      ws = null;
      if (!running) return;
      if (code === 4004) { onFatal('Discord rejected the bot token (4004)', 'auth'); return; }
      if (code === 4014) {
        onFatal('disallowed intents (4014): enable MESSAGE CONTENT INTENT under Bot -> Privileged Gateway Intents in the Developer Portal', 'plugin');
        return;
      }
      if ([4010, 4011, 4012, 4013].includes(code)) { onFatal(`unrecoverable gateway close ${code}`, 'plugin'); return; }
      // Our own resume-intent closes (4900 RECONNECT, 4009 zombie, 4901 after
      // INVALID_SESSION already handled resumability) keep the session; other
      // 4xxx closes invalidate it so the next connect re-identifies.
      if (![4900, 4901, 4007, 4009].includes(code) && code >= 4000) { sessionId = null; resumeUrl = null; }
      onState('disconnected', `gateway closed (${code || 'socket error'})`);
      await _sleep(RECONNECT_DELAYS[Math.min(reconnects++, RECONNECT_DELAYS.length - 1)]);
    }
  }

  return {
    start() {
      running = true;
      connectLoop().catch((err) => log('error', `gateway loop died: ${err?.message || err}`));
    },
    stop() {
      running = false;
      stopHeartbeat();
      try { ws?.close(1000); } catch { /* already closed */ }
    },
    identity: () => identity,
    _debug: { handleFrame: (f) => handleFrame(JSON.stringify(f)) },
  };
}
