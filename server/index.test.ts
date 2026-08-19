import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, cookieHeader } from './index.js';
import { signSession } from './auth.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cfg = {
  password: 'hunter2',
  sessionSecret: 'test-secret',
  shellCmd: 'bash',
  host: '127.0.0.1',
  port: 0,
  publicOrigin: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173'],
  cookieSecure: false,
  trustProxy: false,
  sessionTtlMs: 30 * 24 * 3_600_000,
  epochFile: join(mkdtempSync(join(tmpdir(), 'bc-test-')), 'epoch'),
};

const PORT = 7345;
const ORIGIN = 'http://localhost:5173';
const base = `http://127.0.0.1:${PORT}`;
let srv: ReturnType<typeof createServer>;

beforeAll(async () => { srv = createServer(cfg); await srv.listen(PORT); });
afterAll(async () => { await srv.close(); });

const login = (password: string) =>
  fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ password }),
  });

const goodCookie = () =>
  `bc_session=${signSession(cfg.sessionSecret, Date.now() + 3_600_000, 0)}`;

function openWs(headers: Record<string, string>): Promise<
  { ok: true; ws: WebSocket } | { ok: false; status: number }
> {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?cols=80&rows=24`, { headers });
    ws.once('open', () => resolve({ ok: true, ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode! }));
    ws.once('error', () => resolve({ ok: false, status: 0 }));
  });
}

describe('POST /api/login', () => {
  it('รหัสถูกต้องได้ 200 พร้อม Set-Cookie ที่มี HttpOnly', async () => {
    const res = await login('hunter2');
    expect(res.status).toBe(200);
    const c = res.headers.get('set-cookie')!;
    expect(c).toContain('bc_session=');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
  });

  it('รหัสผิดได้ 401', async () => {
    expect((await login('wrong')).status).toBe(401);
  });

  it('ผิดซ้ำเกินลิมิตได้ 429', async () => {
    for (let i = 0; i < 12; i++) await login('wrong');
    expect((await login('wrong')).status).toBe(429);
    // ถูกบล็อกแล้วคือบล็อก ไม่สนว่ารหัสถูกหรือผิด — guard เช็ค isBlocked ก่อน verify
    // เสมอ นี่เป็นพฤติกรรมที่ตั้งใจของ rate limit
    expect((await login('hunter2')).status).toBe(429);
  });
});

describe('GET /api/session', () => {
  it('cookie ถูกต้องได้ 200', async () => {
    const res = await fetch(`${base}/api/session`, { headers: { cookie: goodCookie() } });
    expect(res.status).toBe(200);
  });

  it('ไม่มี cookie ได้ 401', async () => {
    const res = await fetch(`${base}/api/session`);
    expect(res.status).toBe(401);
  });

  it('cookie ปลอมได้ 401', async () => {
    const res = await fetch(`${base}/api/session`, { headers: { cookie: 'bc_session=garbage' } });
    expect(res.status).toBe(401);
  });

  it('cookie หมดอายุได้ 401', async () => {
    const expired = `bc_session=${signSession(cfg.sessionSecret, Date.now() - 1000, 0)}`;
    const res = await fetch(`${base}/api/session`, { headers: { cookie: expired } });
    expect(res.status).toBe(401);
  });
});

describe('WS /pty guard', () => {
  it('ไม่มี cookie ถูกปฏิเสธด้วย 401', async () => {
    const r = await openWs({ origin: ORIGIN });
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it('cookie ปลอมถูกปฏิเสธด้วย 401', async () => {
    const r = await openWs({ origin: ORIGIN, cookie: 'bc_session=garbage' });
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it('Origin ไม่อยู่ในลิสต์ถูกปฏิเสธด้วย 403', async () => {
    const r = await openWs({ origin: 'https://evil.example', cookie: goodCookie() });
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it('cookie และ origin ถูกต้อง เปิดได้', async () => {
    const r = await openWs({ origin: ORIGIN, cookie: goodCookie() });
    expect(r.ok).toBe(true);
    if (r.ok) r.ws.close();
  });
});

describe('บังคับ session เดียว', () => {
  it('connection ใหม่เตะตัวเก่าออกด้วย code 4000', async () => {
    const first = await openWs({ origin: ORIGIN, cookie: goodCookie() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const kicked = new Promise<number>(r => first.ws.once('close', c => r(c)));
    const second = await openWs({ origin: ORIGIN, cookie: goodCookie() });
    expect(second.ok).toBe(true);

    expect(await kicked).toBe(4000);
    if (second.ok) second.ws.close();
  }, 10000);
});

// บั๊กนี้เคยเกิดจริงและมองไม่เห็นเลยบน localhost เพราะเบราว์เซอร์ยกเว้น loopback
// ให้นับเป็น secure context — เห็นเฉพาะตอนเปิดจาก IP วง LAN จริงเท่านั้น
describe('ธง Secure ใน cookie ต้องตามโปรโตคอลจริง', () => {
  it('เสิร์ฟผ่าน http = ห้ามมีคำว่า Secure ไม่งั้นเบราว์เซอร์ทิ้ง cookie เงียบๆ', () => {
    const h = cookieHeader('tok', 3600, false);
    expect(h).not.toMatch(/Secure/);
    expect(h).toMatch(/HttpOnly/);
    expect(h).toMatch(/SameSite=Strict/);
  });

  it('เสิร์ฟผ่าน https = ต้องมี Secure', () => {
    expect(cookieHeader('tok', 3600, true)).toMatch(/; Secure(;|$)/);
  });

  // ใช้ server คนละตัวโดยตั้งใจ — ตัวหลักถูก rate limiter ของเทสก่อนหน้าบล็อกไปแล้ว
  // และเทสนี้ต้องพิสูจน์ว่า cfg.cookieSecure ไหลไปถึง header จริง ไม่ใช่แค่ฟังก์ชันบริสุทธิ์
  it('cfg.cookieSecure ไหลไปถึง header ที่ server ส่งออกจริง', async () => {
    const securePort = 7346;
    const secureSrv = createServer({ ...cfg, cookieSecure: true });
    await secureSrv.listen(securePort);
    try {
      const res = await fetch(`http://127.0.0.1:${securePort}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ password: 'hunter2' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toMatch(/; Secure(;|$)/);
    } finally {
      await secureSrv.close();
    }
  });
});

describe('POST /api/logout เพิกถอน session จริง', () => {
  // ใช้ server แยกเพราะการ bump epoch ทำให้ cookie ของเทสอื่นใช้ไม่ได้ทั้งหมด
  const freshCfg = () => ({
    ...cfg,
    epochFile: join(mkdtempSync(join(tmpdir(), 'bc-logout-')), 'epoch'),
  });

  it('**cookie ใบเดิมใช้ไม่ได้อีกหลัง logout — ไม่ใช่แค่ลบฝั่งเบราว์เซอร์**', async () => {
    const port = 7347;
    const c = freshCfg();
    const srv2 = createServer(c);
    await srv2.listen(port);
    try {
      const cookie = `bc_session=${signSession(c.sessionSecret, Date.now() + 3_600_000, 0)}`;
      const b = `http://127.0.0.1:${port}`;

      expect((await fetch(`${b}/api/session`, { headers: { cookie } })).status).toBe(200);
      expect((await fetch(`${b}/api/logout`, { method: 'POST', headers: { cookie } })).status).toBe(200);
      // จุดสำคัญ: ส่ง cookie ใบเดิมซ้ำ เหมือนคนที่ขโมย cookie ไปแล้วจะทำ
      expect((await fetch(`${b}/api/session`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await srv2.close();
    }
  });

  it('ไม่มี session ที่ใช้ได้ ยิง logout ไม่ได้ — ไม่งั้นใครก็เตะเราออกจากระบบ', async () => {
    const port = 7348;
    const srv2 = createServer(freshCfg());
    await srv2.listen(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/logout`, { method: 'POST' });
      expect(res.status).toBe(401);
    } finally {
      await srv2.close();
    }
  });
});

describe('การบีบอัด WebSocket', () => {
  it('server ตอบรับ permessage-deflate ตอน handshake', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?cols=80&rows=24`, {
      headers: { origin: ORIGIN, cookie: goodCookie() },
      perMessageDeflate: true,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    // เทสนี้พิสูจน์แค่ว่า negotiate สำเร็จ ไม่ได้พิสูจน์ผลของ threshold
    // (threshold แค่ตัดสินใจว่าเฟรมไหนจะถูก deflate ก่อนส่ง ไม่กระทบ handshake)
    expect(ws.extensions).toContain('permessage-deflate');
    ws.close();
  });

  it('เฟรมขาเข้าเกิน maxPayload ถูกปฏิเสธ ไม่ปล่อยให้ inflate จนหน่วยความจำบาน', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?cols=80&rows=24`, {
      headers: { origin: ORIGIN, cookie: goodCookie() },
      // ปิด deflate ฝั่ง client เพื่อให้ frame ที่ส่งมีขนาดเท่าที่เขียนจริง —
      // ทดสอบเพดาน maxPayload ตรงๆ ไม่ให้การบีบอัดมากวนผล
      perMessageDeflate: false,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const closed = new Promise<number>(resolve => {
      ws.once('close', code => resolve(code));
    });
    ws.send(Buffer.alloc(300 * 1024, 'x')); // เกิน MAX_INBOUND_PAYLOAD (256 KB) ใน index.ts
    const code = await closed;
    expect(code).toBe(1009); // ws ปิดด้วย "Message Too Big" ตาม maxPayload
  });
});
