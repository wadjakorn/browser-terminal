import { describe, expect, it, vi } from 'vitest';
import { fitAndSendResize } from './terminal-resize.js';

describe('fitAndSendResize', () => {
  it('always refits even without a connected socket', () => {
    const fit = vi.fn();
    fitAndSendResize({ fit }, { cols: 80, rows: 24 }, null);
    expect(fit).toHaveBeenCalledOnce();
  });

  it('sends the dimensions produced by fit when the socket is open', () => {
    const terminal = { cols: 80, rows: 24 };
    const send = vi.fn();
    fitAndSendResize({ fit: () => { terminal.cols = 100; terminal.rows = 30; } }, terminal, {
      readyState: WebSocket.OPEN,
      send,
    });
    expect(send).toHaveBeenCalledWith(JSON.stringify({ t: 'resize', cols: 100, rows: 30 }));
  });

  it('does not send through a non-open socket', () => {
    const send = vi.fn();
    fitAndSendResize({ fit: vi.fn() }, { cols: 80, rows: 24 }, {
      readyState: WebSocket.CONNECTING,
      send,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
