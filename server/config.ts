export interface Config {
  password: string;
  sessionSecret: string;
  shellCmd: string;
  host: string;
  port: number;
  /** origin ที่ผู้ใช้เปิดจริงในเบราว์เซอร์ — เป็นตัวตัดสินทุกอย่างที่เกี่ยวกับความปลอดภัยของ cookie */
  publicOrigin: string;
  /** origin ที่ยอมรับสำหรับ WebSocket — publicOrigin บวก DEV_ORIGINS (ถ้าไม่ใช่ production) */
  allowedOrigins: string[];
  /** ใส่ธง Secure ใน cookie หรือไม่ — true ก็ต่อเมื่อ publicOrigin เป็น https */
  cookieSecure: boolean;
  /** เชื่อ X-Forwarded-For หรือไม่ — ต้องเปิดเองเมื่ออยู่หลัง proxy ที่ควบคุมได้ */
  trustProxy: boolean;
  /** อายุ session (ms) */
  sessionTtlMs: number;
  /** ไฟล์เก็บตัวนับ epoch ที่ทำให้ logout เพิกถอน session ได้จริง */
  epochFile: string;
}

/** ค่าใน .env.example ที่ต้องไม่หลุดไปอยู่ในเครื่องจริง */
const PLACEHOLDERS = new Set([
  'changeme',
  'generate-with-openssl-rand-hex-32',
]);

const MIN_PASSWORD_LEN = 8;
const MIN_SECRET_LEN = 16;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`ตัวแปรใน .env ขาดหรือว่าง: ${key}`);
  return v;
}

function parseDays(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ตัวแปรใน .env ผิดรูป: SESSION_TTL_DAYS (ต้องเป็นจำนวนบวก, ได้ "${raw}")`);
  }
  return n;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 7000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`ตัวแปรใน .env ผิดรูป: PORT (ต้องเป็นจำนวนเต็มบวก, ได้ "${raw}")`);
  }
  return n;
}

/**
 * loopback = เบราว์เซอร์ถือว่าเป็น secure context จึงยอมเก็บ cookie แม้เป็น http
 * และ traffic ไม่ออกนอกเครื่อง — http จึงปลอดภัยพอในกรณีนี้เท่านั้น
 */
function isLoopbackHost(hostname: string): boolean {
  // URL.hostname คืน IPv6 พร้อมวงเล็บก้ามปูติดมา
  const h = hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * ตรวจว่า PUBLIC_ORIGIN เป็น origin เปล่าๆ จริง (scheme + host + port เท่านั้น)
 *
 * ต้องเข้มเรื่องนี้เพราะค่านี้ถูกเอาไปเทียบกับ header `Origin` แบบตรงตัว
 * ถ้ามี path หรือ / ต่อท้ายติดมา การเทียบจะไม่มีวันตรง แล้ว WebSocket จะโดน
 * ปฏิเสธ 403 โดยที่ผู้ใช้ไม่มีทางเดาสาเหตุได้เลย
 */
function parseOrigin(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ตัวแปรใน .env ผิดรูป: PUBLIC_ORIGIN (ต้องเป็น URL เช่น https://box.example.com, ได้ "${raw}")`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ตัวแปรใน .env ผิดรูป: PUBLIC_ORIGIN ต้องขึ้นต้นด้วย http:// หรือ https:// (ได้ "${raw}")`);
  }
  if (url.origin !== raw.replace(/\/$/, '')) {
    throw new Error(
      `ตัวแปรใน .env ผิดรูป: PUBLIC_ORIGIN ต้องเป็น origin เปล่าๆ ไม่มี path ต่อท้าย ` +
      `(ได้ "${raw}" ควรเป็น "${url.origin}")`,
    );
  }
  return url;
}

function checkSecret(env: NodeJS.ProcessEnv, key: string, minLen: number): string {
  const v = required(env, key);
  if (PLACEHOLDERS.has(v)) {
    throw new Error(`${key} ยังเป็นค่าตัวอย่างจาก .env.example — ตั้งค่าจริงก่อนใช้งาน`);
  }
  if (v.length < minLen) {
    throw new Error(`${key} สั้นเกินไป (ต้องยาวอย่างน้อย ${minLen} ตัวอักษร, ได้ ${v.length})`);
  }
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const password = checkSecret(env, 'CONSOLE_PASSWORD', MIN_PASSWORD_LEN);
  const sessionSecret = checkSecret(env, 'SESSION_SECRET', MIN_SECRET_LEN);

  const publicOriginRaw = required(env, 'PUBLIC_ORIGIN');
  const origin = parseOrigin(publicOriginRaw);
  const https = origin.protocol === 'https:';

  // ตัวชี้วัดคือ PUBLIC_ORIGIN ไม่ใช่ HOST โดยตั้งใจ — สิ่งที่กำหนดว่ารหัสผ่านกับ
  // cookie วิ่งเปลือยบนสายหรือไม่ คือสิ่งที่เบราว์เซอร์คุยด้วย ไม่ใช่สิ่งที่เรา bind
  // (Docker ต้อง bind 0.0.0.0 เสมอ แต่ publish เฉพาะ loopback ได้ ซึ่งปลอดภัย)
  if (!https && !isLoopbackHost(origin.hostname) && !env.ALLOW_INSECURE) {
    throw new Error(
      `PUBLIC_ORIGIN เป็น http:// ไปยัง "${origin.hostname}" ซึ่งไม่ใช่ loopback — ` +
      `รหัสผ่านและ session จะวิ่งเป็น plaintext ให้ใครก็ตามในเครือข่ายเดียวกันดักอ่านได้ ` +
      `และผู้ที่ดักได้จะได้สิทธิ์ shell เต็มรูปแบบบนเครื่องนี้\n` +
      `ทางแก้: ใช้ https (reverse proxy, tailscale serve, tunnel) หรือ SSH tunnel มาที่ localhost\n` +
      `ถ้ายืนยันว่ารับความเสี่ยงนี้ได้จริง ตั้ง ALLOW_INSECURE=1`,
    );
  }

  const devOrigins = env.NODE_ENV === 'production'
    ? []
    : (env.DEV_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);

  return {
    password,
    sessionSecret,
    // trim ก่อนเสมอ: ช่องว่างต่อท้ายใน .env มองไม่เห็นด้วยตา แต่ทำให้ spawn
    // คำสั่งชื่อ "bash " แล้วตายด้วย ENOENT ที่โยงกลับมาหาสาเหตุไม่ได้เลย
    shellCmd: env.SHELL_CMD?.trim() || 'herdr',
    host: env.HOST || '127.0.0.1',
    port: parsePort(env.PORT),
    publicOrigin: origin.origin,
    allowedOrigins: [origin.origin, ...devOrigins],
    cookieSecure: https,
    trustProxy: !!env.TRUST_PROXY,
    sessionTtlMs: parseDays(env.SESSION_TTL_DAYS, 30) * 24 * 3_600_000,
    epochFile: env.SESSION_EPOCH_FILE || '.session-epoch',
  };
}
