import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * เขียนรูปที่อัปโหลดมาเป็นไฟล์ให้ agent CLI อ่านได้
 *
 * ทำไมต้องเป็นไฟล์: image bytes ไม่เคยวิ่งผ่าน PTY ได้เลย — bracketed paste เป็น
 * ข้อความล้วน, OSC 52 เป็น text/plain, kitty graphics เป็นทิศ output ทางเดียว
 * ทั้ง Claude Code และ Codex จึงรับรูปด้วยการ **วาง path ของไฟล์** เข้าไปที่ prompt
 * แล้วมันไปอ่านไฟล์เอง (ยืนยันด้วยการทดสอบจริง ดู docs/2026-08-25-image-paste-plan.md §7)
 *
 * โครงนี้ลอกมาจาก herdr `src/server/clipboard_image.rs` ซึ่งแก้ปัญหาเดียวกันสำหรับ
 * `herdr --remote` มาแล้ว — dir 0700, ไฟล์ 0600, ชื่อไม่มีช่องว่าง, ลบตาม TTL
 */

export type ImageKind = 'png' | 'jpg' | 'gif' | 'webp';

/** ฟอร์แมตที่รู้จักแต่ปลายทางรับไม่ได้ — ต้องแยกจาก "ไม่ใช่รูป" เพราะข้อความที่บอกผู้ใช้ต่างกัน */
export type RejectedKind = 'heic';

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const STAGE_TTL_MS = 24 * 3_600_000;
/** เพดานพื้นที่รวมของไดเรกทอรี — TTL อย่างเดียวยังกองได้หลาย GB ก่อนถูกกวาด */
export const STAGE_QUOTA_BYTES = 256 * 1024 * 1024;

const starts = (bytes: Uint8Array, sig: number[], at = 0): boolean =>
  sig.every((b, i) => bytes[at + i] === b);

const ascii = (text: string): number[] => [...text].map(c => c.charCodeAt(0));

/**
 * ชนิดของรูปมาจากไบต์จริงเท่านั้น ไม่ใช่จาก Content-Type หรือชื่อไฟล์ที่ client ส่งมา
 *
 * ไม่ได้ทำเพื่อความปลอดภัยเป็นหลัก แต่เพื่อ UX: iPhone ยื่นไฟล์ HEIC มาโดยดีฟอลต์
 * ซึ่งทั้ง Claude Code และ Codex อ่านไม่ออก และ **ล้มเหลวเงียบ** ที่ปลายทาง
 * ตรวจตรงนี้แล้วปฏิเสธพร้อมเหตุผล ดีกว่าปล่อยให้ผู้ใช้งงว่าทำไมรูปไม่ขึ้น
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | RejectedKind | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'gif';
  if (starts(bytes, ascii('RIFF')) && starts(bytes, ascii('WEBP'), 8)) return 'webp';
  // ISO-BMFF: ไบต์ 4..8 เป็น "ftyp" แล้วตามด้วย brand ที่บอกว่าเป็น HEIF ตระกูลไหน
  if (starts(bytes, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

/** ต้องกวาดทุกไฟล์ ไม่ใช่แค่ไฟล์ที่กำลังจะเขียน ไม่งั้นของเก่าไม่มีวันถูกลบ */
async function sweep(dir: string, now: number, incoming: number): Promise<void> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }

  const files: { path: string; mtime: number; size: number }[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (now - info.mtimeMs > STAGE_TTL_MS) { await unlink(path).catch(() => {}); continue; }
      files.push({ path, mtime: info.mtimeMs, size: info.size });
    } catch { /* ไฟล์หายไประหว่างกวาด — ไม่ใช่ปัญหา */ }
  }

  // เก่าสุดออกก่อน จนกว่าจะมีที่ว่างพอสำหรับไฟล์ที่กำลังจะเขียน
  let total = files.reduce((n, f) => n + f.size, 0);
  files.sort((a, b) => a.mtime - b.mtime);
  for (const file of files) {
    if (total + incoming <= STAGE_QUOTA_BYTES) break;
    await unlink(file.path).catch(() => {});
    total -= file.size;
  }
}

export interface StagedImage {
  path: string;
  kind: ImageKind;
}

/**
 * `O_EXCL` ไม่ใช่ `O_CREAT` เฉยๆ และสิทธิ์ต้องตั้งตอนเปิดไฟล์ ไม่ใช่ chmod ทีหลัง —
 * ระหว่าง create กับ chmod มีหน้าต่างที่ไฟล์อ่านได้ทั้งเครื่อง
 *
 * ชื่อไฟล์ **ห้ามมีช่องว่าง**: Codex แยกข้อความที่ถูก paste ด้วย `shlex` ก่อนเช็คว่า
 * เป็น path ของรูปหรือไม่ path ที่มีช่องว่างและไม่ถูก quote จะโดนหั่นแล้วทิ้งเงียบ
 */
export async function stageImage(
  dir: string,
  bytes: Uint8Array,
  kind: ImageKind,
  now = Date.now(),
): Promise<StagedImage> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir ไม่แก้สิทธิ์ของไดเรกทอรีที่มีอยู่แล้ว และ mode ยังโดน umask หักด้วย
  await chmod(dir, 0o700);
  await sweep(dir, now, bytes.byteLength);

  for (let attempt = 0; attempt < 8; attempt++) {
    const path = join(dir, `paste-${now}-${randomBytes(6).toString('hex')}.${kind}`);
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
    try {
      await handle.write(bytes);
    } finally {
      await handle.close();
    }
    return { path, kind };
  }

  throw new Error('หาชื่อไฟล์ว่างสำหรับรูปที่วางไม่ได้');
}
