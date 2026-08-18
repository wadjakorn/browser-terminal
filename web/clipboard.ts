/**
 * เข้าถึงคลิปบอร์ดแบบที่ "ล้มเหลวอย่างซื่อสัตย์"
 *
 * `writeText` ใช้ได้ในทุกวิธี deploy ที่ README แนะนำ เพราะทั้งหมดเป็น secure context
 * (tailscale serve, SSH tunnel ผ่าน loopback, reverse proxy + TLS)
 *
 * `readText` คือตัวที่เปราะ — Chrome บน Android ขอ permission ก่อน และ Safari บน iOS
 * เด้งกล่องยืนยันทุกครั้ง ผู้ใช้กดปฏิเสธได้เสมอ จึงต้องล้มเหลวได้โดยไม่พังทั้งโฟลว์
 * และผู้เรียกต้องแยกออกว่า "ปฏิเสธ" กับ "ไม่รองรับ" ต่างกัน เพราะข้อความที่ควรบอก
 * ผู้ใช้ไม่เหมือนกัน
 *
 * ไม่มี fallback ไปที่ `document.execCommand` — deployment ที่รองรับทั้งหมดเป็น
 * secure context อยู่แล้ว และทางหนีจริงของ write คือเมนู native บนแผ่นผลลัพธ์
 */

export type WriteResult = { ok: true } | { ok: false; reason: FailureReason };
export type ReadResult = { ok: true; text: string } | { ok: false; reason: FailureReason };
type FailureReason = 'unsupported' | 'denied' | 'failed';

const reasonFor = (error: unknown): FailureReason =>
  error instanceof Error && error.name === 'NotAllowedError' ? 'denied' : 'failed';

export function createClipboard(deps: { clipboard?: Clipboard; isSecureContext?: boolean } = {}) {
  const api = 'clipboard' in deps
    ? deps.clipboard
    : (typeof navigator === 'undefined' ? undefined : navigator.clipboard);
  const secure = deps.isSecureContext ?? (typeof isSecureContext === 'undefined' ? false : isSecureContext);

  return {
    async write(text: string): Promise<WriteResult> {
      if (!secure || typeof api?.writeText !== 'function') return { ok: false, reason: 'unsupported' };
      try {
        await api.writeText(text);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: reasonFor(error) };
      }
    },

    async read(): Promise<ReadResult> {
      if (!secure || typeof api?.readText !== 'function') return { ok: false, reason: 'unsupported' };
      try {
        return { ok: true, text: await api.readText() };
      } catch (error) {
        return { ok: false, reason: reasonFor(error) };
      }
    },
  };
}
