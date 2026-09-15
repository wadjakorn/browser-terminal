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

    /**
     * อ่านได้ทั้งรูปและข้อความ — ทางเดียวที่รูปจากคลิปบอร์ดมือถือเข้ามาได้ เพราะปุ่มวาง
     * ของคีย์บอร์ดมือถือส่งแค่ข้อความเข้า textarea ไม่เคยมีรูปใน paste event
     *
     * ต้องเรียกตรงจาก user gesture โดยไม่มี await คั่นก่อนหน้า ไม่งั้น iOS ปฏิเสธ
     * รูปมาก่อนข้อความ: ของที่คัดลอกจากเว็บมักมีทั้งสองชนิด และคนกดวางตอนมีรูปต้องการรูป
     */
    async readContent(): Promise<ContentResult> {
      if (!secure) return { ok: false, reason: 'unsupported' };
      if (typeof api?.read === 'function') {
        try {
          const items = await api.read();
          for (const item of items) {
            const type = item.types.find(t => t.startsWith('image/'));
            if (type) return { ok: true, kind: 'image', blob: await item.getType(type) };
          }
          for (const item of items) {
            if (item.types.includes('text/plain')) {
              return { ok: true, kind: 'text', text: await (await item.getType('text/plain')).text() };
            }
          }
          return { ok: true, kind: 'text', text: '' };
        } catch (error) {
          // ปฏิเสธแล้วถามซ้ำด้วย readText จะเด้งกล่องที่สองใส่ผู้ใช้ — จบตรงนี้
          if (reasonFor(error) === 'denied') return { ok: false, reason: 'denied' };
        }
      }
      const text = await this.read();
      return text.ok ? { ok: true, kind: 'text', text: text.text } : text;
    },
  };
}

export type ContentResult =
  | { ok: true; kind: 'image'; blob: Blob }
  | { ok: true; kind: 'text'; text: string }
  | { ok: false; reason: FailureReason };
