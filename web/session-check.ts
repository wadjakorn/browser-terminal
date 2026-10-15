/**
 * GET /api/session — แยกสามสถานะ ไม่ใช่ boolean
 *
 * 'valid' / 'expired' / 'unreachable' ต้องแยกกัน เพราะเน็ตมือถือสะดุดคือ
 * สถานการณ์อันดับหนึ่งของแอปนี้ ถ้ารวม "เน็ตล่ม" เข้ากับ "session หมดอายุ"
 * ผู้ใช้จะถูกเด้งกลับหน้า login ทุกครั้งที่ขาดสัญญาณ ทั้งที่ cookie ยังใช้ได้
 */
export type SessionState = 'valid' | 'expired' | 'unreachable';

/**
 * ต้องมี timeout — `onclose` รอคำตอบนี้ก่อนจะตั้งนัดต่อใหม่ ถ้า fetch ค้าง (เน็ตตายตอนหน้า
 * อยู่เบื้องหลัง request ไม่มีวันจบ) ก็ไม่มี timer ให้ `reconnect.wake()` ปลุก ผู้ใช้ที่กลับมา
 * จะเห็นจอนิ่งตลอดไป
 */
export const SESSION_CHECK_TIMEOUT_MS = 4000;

type Fetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

export async function checkSession(
  fetchFn: Fetch = (input, init) => fetch(input, init),
  timeoutMs = SESSION_CHECK_TIMEOUT_MS,
): Promise<SessionState> {
  try {
    const res = await fetchFn('/api/session', { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return 'valid';
    if (res.status === 401) return 'expired';
    return 'unreachable';   // 5xx = server มีปัญหา ไม่ใช่ session หมดอายุ
  } catch {
    return 'unreachable';   // fetch โยน/หมดเวลา = เน็ตล่ม ต้อง reconnect ต่อ ไม่ใช่เด้ง login
  }
}
