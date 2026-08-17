import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig, type Config } from './config.js';
import {
  COOKIE_NAME,
  parseCookie, signSession, verifyPassword, verifySession,
} from './auth.js';
import { createLoginLimiter } from './ratelimit.js';
import { clientIp } from './clientip.js';
import { createEpochStore } from './epoch.js';
import { attachPty, parseDims } from './pty.js';

const STATIC_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

/** ต้องต่ำกว่า idle timeout ที่สั้นที่สุดที่เจอได้จริง (nginx default 60 วิ) พอสมควร */
const KEEPALIVE_MS = 25_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new Error('body ใหญ่เกินไป');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * ธง `Secure` ต้องตามโปรโตคอลที่เบราว์เซอร์ใช้จริง ไม่ใช่ใส่ไว้เสมอ
 *
 * เบราว์เซอร์ **ทิ้ง cookie ที่มีธง Secure บน origin ที่ไม่ใช่ https ไปเงียบๆ**
 * ไม่มี error ให้เห็นทั้งฝั่ง server และ console ผู้ใช้จะเจอแค่ "ล็อกอินสำเร็จแล้ว
 * เด้งกลับหน้า login" วนไปเรื่อยๆ — และทดสอบบน localhost จะผ่านเสมอ เพราะเบราว์เซอร์
 * ยกเว้น loopback ให้นับเป็น secure context
 */
export function cookieHeader(token: string, maxAgeSec: number, secure: boolean): string {
  const flags = ['HttpOnly'];
  if (secure) flags.push('Secure');
  flags.push('SameSite=Strict', 'Path=/', `Max-Age=${maxAgeSec}`);
  return `${COOKIE_NAME}=${token}; ${flags.join('; ')}`;
}

export function createServer(cfg: Config) {
  const limiter = createLoginLimiter();
  const epochs = createEpochStore(cfg.epochFile);
  let active: WebSocket | null = null;

  const ipOf = (req: IncomingMessage): string =>
    clientIp(req.headers, req.socket.remoteAddress, cfg.trustProxy);

  const originAllowed = (origin: string | undefined): boolean =>
    !!origin && cfg.allowedOrigins.includes(origin);

  const sessionValid = (req: IncomingMessage): boolean => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    return !!token && verifySession(cfg.sessionSecret, token, Date.now(), epochs.current());
  };

  function serveStatic(url: string, res: ServerResponse): void {
    const rel = normalize(url.split('?')[0]!).replace(/^(\.\.[/\\])+/, '');
    let file = join(STATIC_ROOT, rel === '/' ? 'index.html' : rel);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(STATIC_ROOT, 'index.html'); // SPA fallback
    }
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }

  const http = createHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/login') {
      const now = Date.now();
      const ip = ipOf(req);
      if (limiter.isBlocked(now, ip)) { res.writeHead(429).end('ลองใหม่ภายหลัง'); return; }
      let password = '';
      try {
        const body = await readJsonBody(req) as { password?: string };
        password = body.password ?? '';
      } catch { /* body พัง = ถือว่ารหัสผิด */ }

      if (!verifyPassword(password, cfg.password)) {
        limiter.recordFailure(now, ip);
        res.writeHead(401).end('เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      limiter.reset(ip);
      const token = signSession(cfg.sessionSecret, now + cfg.sessionTtlMs, epochs.current());
      res.writeHead(200, {
        'set-cookie': cookieHeader(token, cfg.sessionTtlMs / 1000, cfg.cookieSecure),
      }).end('ok');
      return;
    }

    if (req.method === 'POST' && req.url === '/api/logout') {
      // เพิกถอนจริง ไม่ใช่แค่สั่งเบราว์เซอร์ลืม cookie — ถ้า cookie รั่วไปแล้ว
      // การลบฝั่งเบราว์เซอร์ไม่ได้ทำให้ token ที่อยู่ในมือคนอื่นใช้ไม่ได้
      // ต้องมี session ที่ใช้ได้อยู่ก่อน ไม่งั้นใครก็ยิง endpoint นี้เตะเราออกได้
      if (!sessionValid(req)) { res.writeHead(401).end('unauthorized'); return; }
      epochs.bump();
      if (active && active.readyState === active.OPEN) active.close(4001, 'logged out');
      res.writeHead(200, { 'set-cookie': cookieHeader('', 0, cfg.cookieSecure) }).end('ok');
      return;
    }

    if (req.method === 'GET' && req.url === '/api/session') {
      if (sessionValid(req)) { res.writeHead(200).end('ok'); return; }
      res.writeHead(401).end('unauthorized');
      return;
    }

    if (req.method === 'GET') { serveStatic(req.url ?? '/', res); return; }
    res.writeHead(405).end('method not allowed');
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const reject = (code: number, text: string) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };

    if (!url.startsWith('/pty')) return reject(404, 'Not Found');
    if (!originAllowed(req.headers.origin)) return reject(403, 'Forbidden');
    if (!sessionValid(req)) return reject(401, 'Unauthorized');

    wss.handleUpgrade(req, socket, head, ws => {
      // บังคับ session เดียว: เตะตัวเก่าออกก่อนเสมอ
      if (active && active.readyState === active.OPEN) {
        active.close(4000, 'superseded');
      }
      active = ws;

      // เทอร์มินัลที่เปิดทิ้งไว้เฉยๆ คือ traffic ศูนย์ ซึ่ง proxy ทุกตัวถือว่า idle
      // แล้วตัดทิ้ง — nginx ตัดที่ 60 วิเป็นค่า default, Cloudflare Tunnel ~100 วิ
      // ping frame นับเป็น traffic บนสาย จึงกันได้ทั้งสองกรณี
      // (เบราว์เซอร์ตอบ pong ให้เองในระดับโปรโตคอล ฝั่งหน้าเว็บไม่ต้องทำอะไร)
      const keepalive = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping();
      }, KEEPALIVE_MS);

      ws.on('close', () => {
        clearInterval(keepalive);
        if (active === ws) active = null;
      });

      const { cols, rows } = parseDims(url);
      try {
        attachPty(ws, { shellCmd: cfg.shellCmd, cols, rows });
      } catch (err) {
        console.error('attachPty ล้ม:', err);
        ws.close(1011, 'spawn failed');
      }
    });
  });

  return {
    listen: (port: number, host = '127.0.0.1') =>
      new Promise<void>(r => http.listen(port, host, () => r())),
    close: () =>
      new Promise<void>(r => { wss.close(); http.close(() => r()); }),
  };
}

// entrypoint — ไม่รันตอน import จากเทส
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const cfg = loadConfig(process.env);
  const server = createServer(cfg);
  await server.listen(cfg.port, cfg.host);
  console.log(`browser-console ฟังอยู่ที่ ${cfg.host}:${cfg.port} (shell: ${cfg.shellCmd})`);
  console.log(`เปิดใช้งานที่ ${cfg.publicOrigin}`);
  if (!cfg.cookieSecure) {
    console.warn('คำเตือน: เสิร์ฟผ่าน http — รหัสผ่านและ session ไม่ได้ถูกเข้ารหัสบนสาย');
  }
}
