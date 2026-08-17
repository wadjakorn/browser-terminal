import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'bc_session';
export const SESSION_TTL_MS = 30 * 24 * 3_600_000; // 30 วัน

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual ต้องยาวเท่ากัน — เทียบความยาวแยกแล้วยังเทียบ buffer
  // เพื่อให้เวลาที่ใช้ไม่ผูกกับตำแหน่งตัวอักษรที่ต่างกัน
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const SCRYPT_PREFIX = 'scrypt:';
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

/**
 * สร้างค่าไปใส่ CONSOLE_PASSWORD — รูปแบบ `scrypt:<saltHex>:<keyHex>`
 *
 * ใช้พารามิเตอร์ default ของ Node (N=16384, r=8, p=1 ≈ 16MB, ~100ms) จึงไม่ต้อง
 * เก็บค่าพวกนี้ลงในสตริง ถ้าวันหนึ่งต้องขยับค่า ต้องเปลี่ยน prefix เป็น scrypt2:
 * แล้วรองรับทั้งสองแบบ ไม่ใช่เปลี่ยนความหมายของ prefix เดิม
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}:${key.toString('hex')}`;
}

/**
 * รับได้ทั้งรหัสดิบและ hash — ดูจาก prefix
 *
 * ยอมให้ใช้รหัสดิบต่อไปโดยตั้งใจ เพราะกรณีใช้งานหลักคือรันบนเครื่องตัวเองหลัง
 * Tailscale ซึ่งการบังคับให้ hash เพิ่มขั้นตอนโดยไม่ได้เพิ่มความปลอดภัยที่มีความหมาย
 * (คนที่อ่าน .env ได้ ก็อ่านไฟล์อื่นของผู้ใช้คนนั้นได้อยู่แล้ว)
 */
export function verifyPassword(input: string, expected: string): boolean {
  if (!input || !expected) return false;
  if (!expected.startsWith(SCRYPT_PREFIX)) return safeEqual(input, expected);

  const parts = expected.slice(SCRYPT_PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const [saltHex, keyHex] = parts as [string, string];
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) return false;
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== SCRYPT_KEYLEN) return false;
  try {
    const got = scryptSync(input, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
    return timingSafeEqual(got, key);
  } catch {
    return false;
  }
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * รูปแบบ token: `<epoch>.<expiresAtMs>.<hmac ของสองส่วนแรก>`
 *
 * `epoch` มีไว้เพื่อให้ logout เพิกถอน token ได้จริง — ถ้าไม่มี การกด logout จะแค่
 * สั่งเบราว์เซอร์ลบ cookie ส่วนตัว token ยังใช้ได้จนหมดอายุ แปลว่า cookie ที่รั่วไป
 * ยังเข้าได้อีกเป็นเดือนแม้เจ้าของจะกด logout แล้ว
 */
export function signSession(secret: string, expiresAtMs: number, epoch = 0): string {
  const payload = `${epoch}.${expiresAtMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySession(
  secret: string, token: string, nowMs: number, currentEpoch = 0,
): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [epochStr, expiresStr, sig] = parts as [string, string, string];
  if (!epochStr || !expiresStr || !sig) return false;
  if (!safeEqual(sig, sign(secret, `${epochStr}.${expiresStr}`))) return false;
  if (Number(epochStr) !== currentEpoch) return false;
  const expiresAt = Number(expiresStr);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
