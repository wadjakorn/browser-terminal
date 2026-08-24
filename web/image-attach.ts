/**
 * แนบรูปเข้า prompt ของ agent ที่รันอยู่ในเทอร์มินัล
 *
 * รูปไม่เคยวิ่งผ่าน PTY ได้ ทั้ง Claude Code และ Codex รับรูปด้วยการ **วาง path ของไฟล์**
 * เข้าไปที่ prompt แล้วไปอ่านไฟล์เอง โมดูลนี้จึงมีหน้าที่แค่ ส่ง bytes ขึ้น server →
 * ได้ path กลับมา ส่วนการวางเป็นงานของผู้เรียก ซึ่งต้องใช้ `term.paste()`
 *
 * **ต้องเป็น paste จริงเท่านั้น** — ทดสอบแล้วว่า path ที่ถูก *พิมพ์* เข้าไปเฉยๆ
 * Claude Code ไม่แปลงเป็นรูปให้ ต้องมาในรูป bracketed paste ซึ่ง xterm ห่อให้เอง
 * ตามโหมด 2004 (ดู docs/2026-08-25-image-paste-plan.md §7)
 */

export type AttachResult =
  | { ok: true; path: string }
  | { ok: false; reason: AttachFailure };

/**
 * แยกเหตุผลให้ละเอียดเพราะสิ่งที่ผู้ใช้ต้องทำต่อไม่เหมือนกันเลย —
 * `heic` แก้ได้ด้วยการเปลี่ยนรูปแบบถ่ายภาพ ส่วน `offline` แค่รอแล้วลองใหม่
 */
export type AttachFailure =
  | 'too-large'
  | 'heic'
  | 'not-image'
  | 'disabled'
  | 'unauthorized'
  | 'failed';

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** ฟอร์แมตที่ปลายทางอ่านได้จริง — ไม่ใส่ `image/*` เพราะ iPhone จะยื่น HEIC มา */
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

const FAILURE_BY_STATUS: Record<number, AttachFailure> = {
  401: 'unauthorized',
  404: 'disabled',
  413: 'too-large',
};

export function messageFor(reason: AttachFailure): string {
  switch (reason) {
    case 'too-large': return 'รูปใหญ่เกิน 16 MB — ย่อก่อนแล้วลองใหม่';
    case 'heic': return 'รูปเป็นรูปแบบ HEIC ซึ่ง agent อ่านไม่ได้ — ตั้งกล้องเป็น "รองรับสูงสุด" หรือแปลงเป็น JPEG ก่อน';
    case 'not-image': return 'ไฟล์นี้ไม่ใช่รูปภาพ';
    case 'disabled': return 'เซิร์ฟเวอร์ปิดการแนบรูปไว้';
    case 'unauthorized': return 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่';
    case 'failed': return 'แนบรูปไม่สำเร็จ';
  }
}

/**
 * ดึงรูปจาก clipboard ของ paste event
 *
 * ต้องอ่าน `items` ไม่ใช่ `files` — Safari ใส่รูปที่ถูกคัดลอกไว้ใน items แต่
 * `files` ว่าง เมื่อรูปนั้นไม่ได้มาจากไฟล์จริงบนเครื่อง
 */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of data.items ?? []) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  for (const file of data.files ?? []) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

export function createImageAttacher(deps: {
  fetch?: typeof fetch;
  endpoint?: string;
} = {}) {
  const request = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const endpoint = deps.endpoint ?? '/api/image';

  return async function attach(blob: Blob): Promise<AttachResult> {
    // เช็คขนาดตั้งแต่ฝั่งนี้ด้วย ไม่ใช่ปล่อยให้ server ปฏิเสธอย่างเดียว — บนเน็ตมือถือ
    // การอัปโหลด 40 MB ไปเพื่อโดนปฏิเสธคือการเผาเวลาและโควตาของผู้ใช้ฟรีๆ
    if (blob.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-large' };

    let response: Response;
    try {
      response = await request(endpoint, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        body: blob,
      });
    } catch {
      return { ok: false, reason: 'failed' };
    }

    if (!response.ok) {
      if (response.status === 415) {
        const body = await response.text().catch(() => '');
        return { ok: false, reason: body === 'heic' ? 'heic' : 'not-image' };
      }
      return { ok: false, reason: FAILURE_BY_STATUS[response.status] ?? 'failed' };
    }

    try {
      const body = await response.json() as { path?: unknown };
      if (typeof body.path !== 'string' || body.path === '') return { ok: false, reason: 'failed' };
      return { ok: true, path: body.path };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  };
}
