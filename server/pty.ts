import * as pty from 'node-pty';
import type { WebSocket } from 'ws';

export interface PtyOptions {
  shellCmd: string;
  cols: number;
  rows: number;
}

const DEFAULT_DIMS = { cols: 80, rows: 24 };

function dim(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 1000 ? n : null;
}

export function parseDims(url: string): { cols: number; rows: number } {
  const q = new URL(url, 'http://localhost').searchParams;
  const cols = dim(q.get('cols'));
  const rows = dim(q.get('rows'));
  return cols !== null && rows !== null ? { cols, rows } : { ...DEFAULT_DIMS };
}

export function attachPty(ws: WebSocket, opts: PtyOptions): { pid: number } {
  const [cmd, ...args] = opts.shellCmd.split(/\s+/) as [string, ...string[]];

  const term = pty.spawn(cmd, args, {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { term.kill('SIGHUP'); } catch { /* ตายไปแล้ว */ }
  };

  term.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'));
  });

  term.onExit(({ exitCode }) => {
    disposed = true;
    if (ws.readyState === ws.OPEN) ws.close(1000, `exit:${exitCode}`);
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      term.write(Buffer.from(raw as Buffer).toString('utf8'));
      return;
    }
    // text frame = control JSON
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.t === 'resize') {
        const cols = dim(String(msg.cols));
        const rows = dim(String(msg.rows));
        if (cols !== null && rows !== null) term.resize(cols, rows);
      }
    } catch {
      // control frame ที่พัง — ทิ้งไปเงียบๆ ไม่ควรทำให้ session ตาย
    }
  });

  ws.on('close', dispose);
  ws.on('error', dispose);

  return { pid: term.pid };
}
