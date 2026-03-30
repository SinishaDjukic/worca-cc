import { describe, expect, it, vi } from 'vitest';
import { createClientManager } from './ws-client-manager.js';

function mockWss() {
  return { clients: new Set() };
}

function mockWs() {
  return { readyState: 1, OPEN: 1, send: vi.fn(), isAlive: true };
}

describe('createClientManager', () => {
  it('tracks per-project client counts on setProtocol', () => {
    const wss = mockWss();
    const cm = createClientManager({ wss });
    const ws = mockWs();
    cm.ensureSubs(ws);

    expect(cm.getProjectClientCount('proj-a')).toBe(0);
    cm.setProtocol(ws, 2, 'proj-a');
    expect(cm.getProjectClientCount('proj-a')).toBe(1);

    cm.destroy();
  });

  it('decrements count on project switch', () => {
    const wss = mockWss();
    const cm = createClientManager({ wss });
    const ws = mockWs();
    cm.ensureSubs(ws);

    cm.setProtocol(ws, 2, 'proj-a');
    expect(cm.getProjectClientCount('proj-a')).toBe(1);

    cm.setProtocol(ws, 2, 'proj-b');
    expect(cm.getProjectClientCount('proj-a')).toBe(0);
    expect(cm.getProjectClientCount('proj-b')).toBe(1);

    cm.destroy();
  });

  it('decrements count on deleteSubs', () => {
    const wss = mockWss();
    const cm = createClientManager({ wss });
    const ws = mockWs();
    cm.ensureSubs(ws);
    cm.setProtocol(ws, 2, 'proj-a');

    cm.deleteSubs(ws);
    expect(cm.getProjectClientCount('proj-a')).toBe(0);

    cm.destroy();
  });

  it('notifies handlers on count change', () => {
    const wss = mockWss();
    const cm = createClientManager({ wss });
    const ws = mockWs();
    cm.ensureSubs(ws);

    const handler = vi.fn();
    const unsub = cm.onClientCountChange(handler);

    cm.setProtocol(ws, 2, 'proj-a');
    expect(handler).toHaveBeenCalledWith('proj-a', 1);

    cm.deleteSubs(ws);
    expect(handler).toHaveBeenCalledWith('proj-a', 0);

    unsub();
    cm.destroy();
  });

  it('handles multiple clients on same project', () => {
    const wss = mockWss();
    const cm = createClientManager({ wss });
    const ws1 = mockWs();
    const ws2 = mockWs();
    cm.ensureSubs(ws1);
    cm.ensureSubs(ws2);

    cm.setProtocol(ws1, 2, 'proj-a');
    cm.setProtocol(ws2, 2, 'proj-a');
    expect(cm.getProjectClientCount('proj-a')).toBe(2);

    cm.deleteSubs(ws1);
    expect(cm.getProjectClientCount('proj-a')).toBe(1);

    cm.deleteSubs(ws2);
    expect(cm.getProjectClientCount('proj-a')).toBe(0);

    cm.destroy();
  });

  it('unsubscribe handler stops notifications', () => {
    const wss = mockWss();
    const cm = createClientManager({ wss });
    const ws = mockWs();
    cm.ensureSubs(ws);

    const handler = vi.fn();
    const unsub = cm.onClientCountChange(handler);
    unsub();

    cm.setProtocol(ws, 2, 'proj-a');
    expect(handler).not.toHaveBeenCalled();

    cm.destroy();
  });
});
