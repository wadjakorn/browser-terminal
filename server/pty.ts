import * as pty from 'node-pty';
import type { WebSocket } from 'ws';
import { createOutbound } from './outbound.js';

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

  const outbound = createOutbound(
    {
      send: (data, onFlushed) => {
        // socket ปิดไปแล้วก็ต้องเรียก onFlushed อยู่ดี ไม่งั้น outstanding ค้าง
        // แล้ว backpressure จะ pause ทิ้งไว้ตลอดกาล
        if (ws.readyState !== ws.OPEN) { onFlushed(); return; }
        ws.send(data, () => onFlushed());
      },
    },
    { pause: () => term.pause(), resume: () => term.resume() },
  );

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    outbound.dispose();
    try { term.kill('SIGHUP'); } catch { /* ตายไปแล้ว */ }
  };

  term.onData(data => outbound.push(Buffer.from(data, 'utf8')));

  term.onExit(({ exitCode }) => {
    disposed = true;
    // ต้อง flush ก่อน close เสมอ: onExit มาถึงได้ภายในไม่กี่ไมโครวินาทีหลัง
    // onData ก้อนสุดท้าย ซึ่งยังนอนอยู่ในหน้าต่างรวม chunk — ปิดเลยคือทำ output
    // บรรทัดสุดท้ายหายเงียบๆ (ws จะส่ง close frame ต่อท้ายข้อมูลที่เข้าคิวไว้แล้ว)
    outbound.flush();
    // ต้อง dispose ตรงนี้ด้วย: `disposed = true` ข้างบนทำให้ `dispose()` ที่ผูกไว้กับ
    // ws.on('close') early-return ไป outbound จึงไม่มีใครปิดให้ — เหลือ timer ค้าง
    // และ send callback ที่มาทีหลังจะไป resume PTY ที่ตายไปแล้ว
    outbound.dispose();
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
