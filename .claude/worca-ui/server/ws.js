/**
 * WebSocket server entry point with kill switch.
 * Default: modular implementation. Set WORCA_WS_MODULES=0 to use legacy.
 */

import { attachWsServer as attachLegacy } from './ws-legacy.js';
import {
  attachWsServer as attachModular,
  resolveActiveRunDir as resolveModular,
} from './ws-modular.js';

const USE_MODULES = process.env.WORCA_WS_MODULES !== '0';

export function attachWsServer(server, config) {
  return USE_MODULES
    ? attachModular(server, config)
    : attachLegacy(server, config);
}

export { resolveModular as resolveActiveRunDir };
