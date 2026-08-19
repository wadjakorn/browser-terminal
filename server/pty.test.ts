import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { attachPty, parseDims } from './pty.js';

describe('parseDims', () => {
  it('อ่าน cols/rows จาก query', () =>
    expect(parseDims('/pty?cols=52&rows=38')).toEqual({ cols: 52, rows: 38 }));
  it('ไม่มี query → 80x24', () =>
    expect(parseDims('/pty')).toEqual({ cols: 80, rows: 24 }));
  it('ค่าไม่ใช่ตัวเลข → 80x24', () =>
    expect(parseDims('/pty?cols=abc&rows=-')).toEqual({ cols: 80, rows: 24 }));
  it('ค่านอกช่วง 1-1000 → 80x24', () =>
    expect(parseDims('/pty?cols=0&rows=99999')).toEqual({ cols: 80, rows: 24 }));
  it('ทศนิยมถูกปฏิเสธ', () =>
    expect(parseDims('/pty?cols=52.5&rows=38')).toEqual({ cols: 80, rows: 24 }));
});

/** เปิด ws server ชั่วคราวแล้วคืนคู่ (serverSideSocket, clientSocket) */
async function pair(): Promise<{
  server: WebSocket; client: WebSocket; close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const { port } = wss.address() as { port: number };
  const serverP = new Promise<WebSocket>(r => wss.once('connection', ws => r(ws)));
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>(r => client.once('open', () => r()));
  const server = await serverP;
  return {
    server, client,
    close: () => new Promise<void>(r => wss.close(() => r())),
  };
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** รอจนกว่า predicate เป็นจริง หรือหมดเวลา */
async function until(fn: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return fn();
}

/** เก็บ output ที่ server ส่งกลับมาหา client จนกว่าจะเจอ pattern */
function collect(client: WebSocket): { text: () => string } {
  let buf = '';
  client.on('message', d => { buf += d.toString(); });
  return { text: () => buf };
}

describe('attachPty', () => {
  it('รันคำสั่งแล้ว stream output กลับมา', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('echo marker-hi\n'));
    expect(await until(() => out.text().includes('marker-hi'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('ตั้ง TERM เป็น xterm-256color', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('echo TERM=$TERM\n'));
    expect(await until(() => out.text().includes('TERM=xterm-256color'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('spawn ด้วยขนาดที่ให้มา ไม่ใช่ 80x24', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 52, rows: 38 });
    client.send(Buffer.from('stty size\n'));
    expect(await until(() => out.text().includes('38 52'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('control frame resize มีผลจริง', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(JSON.stringify({ t: 'resize', cols: 100, rows: 40 }));
    await new Promise(r => setTimeout(r, 300));
    client.send(Buffer.from('stty size\n'));
    expect(await until(() => out.text().includes('40 100'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('ws ปิดแล้ว process ตายจริง', async () => {
    const { server, client, close } = await pair();
    const { pid } = attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    expect(alive(pid)).toBe(true);
    client.close();
    expect(await until(() => !alive(pid))).toBe(true);
    await close();
  }, 15000);

  it('process ตายแล้ว ws ถูกปิดด้วย code 1000', async () => {
    const { server, client, close } = await pair();
    const closed = new Promise<number>(r => client.once('close', c => r(c)));
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('exit\n'));
    expect(await closed).toBe(1000);
    await close();
  }, 15000);
});

describe('attachPty — burst ผ่านท่อ outbound', () => {
  it('output ก้อนใหญ่มาถึงครบและเรียงถูกแม้ถูกรวม frame', async () => {
    const { server, client, close } = await pair();
    let received = '';
    client.on('message', raw => { received += raw.toString('utf8'); });

    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('seq 1 2000\n'));

    const ok = await until(() => received.includes('\n2000'), 10_000);
    expect(ok).toBe(true);

    // bash บนเครื่องนี้เปิด bracketed-paste (ESC[?2004h/l) รอบ prompt ทุกครั้งโดย
    // ปริยาย (ดีฟอลต์ตั้งแต่ bash 5.1) real terminal อย่าง xterm.js parse escape
    // เหล่านี้ทิ้งเอง แต่ตรงนี้เทียบ raw byte ต่อบรรทัดตรงๆ จึงต้องตัดโค้ด ANSI
    // และแยกบรรทัดด้วย \r เดี่ยวด้วย ไม่งั้นบรรทัดแรกที่ติดหลัง ESC จะหายไปจากการ
    // เทียบ ทั้งที่ข้อมูลจริงมาถึงครบ — ไม่ใช่เรื่องที่ outbound เกี่ยวข้อง
    const plain = received.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    const numbers = plain.split(/\r\n|\r|\n/)
      .map(line => line.trim())
      .filter(line => /^\d+$/.test(line))
      .map(Number);
    const start = numbers.indexOf(1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(numbers.slice(start, start + 2000)).toEqual(
      Array.from({ length: 2000 }, (_, i) => i + 1),
    );

    client.close();
    await close();
  }, 15000);

  it('output บรรทัดสุดท้ายก่อน shell ตาย ไม่หายไปกับหน้าต่างรวม chunk', async () => {
    // echo แล้ว exit ติดกันทันที — ระยะห่างระหว่าง onData กับ onExit สั้นกว่า
    // หน้าต่าง 5 ms ถ้าไม่ flush ก่อนปิด socket บรรทัดนี้จะหายเงียบๆ
    const { server, client, close } = await pair();
    let received = '';
    client.on('message', raw => { received += raw.toString('utf8'); });
    const closed = new Promise<void>(r => client.once('close', () => r()));

    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('printf FAREWELL-MARKER; exit\n'));

    await closed;
    expect(received).toContain('FAREWELL-MARKER');
    await close();
  }, 15000);
});
