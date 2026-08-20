/**
 * เปิด URL ในเทอร์มินัลด้วยการแตะหนึ่งครั้ง
 *
 * ทำไมต้องมีโมดูลนี้แทนที่จะโหลด `WebLinksAddon` เฉยๆ: บนจอสัมผัส `main.ts`
 * `preventDefault()` ทุก touch event เพื่อกันไม่ให้บราวเซอร์สังเคราะห์ mouse
 * แล้วยิง mousedown/mouseup สังเคราะห์เองแทน — **ไม่มี mousemove**
 *
 * linkifier ของ xterm ตั้ง `_currentLink` ใน handler ของ mousemove เท่านั้น
 * และ `_handleMouseUp` ขึ้นต้นด้วย `if (!this._currentLink) return;`
 * ลิงก์จึงไม่มีวันถูก activate ด้วยการแตะ ถ้าไม่มี mousemove นำหน้า
 *
 * เราจึงไม่พึ่ง activate ของ xterm แต่ยิง mousemove สังเคราะห์เพื่อ "ถาม" ว่า
 * ตรงนั้นมีลิงก์ไหม (`hover`/`leave` ของ WebLinksAddon ตอบกลับมาแบบ synchronous
 * เพราะ `provideLinks` เรียก callback ทันทีในเฟรมเดียวกัน) แล้วตัดสินใจเอง
 *
 * แตะโดนลิงก์แล้ว **ไม่ส่งคลิกต่อให้ TUI** โดยตั้งใจ: ผู้ใช้แตะเพราะอยากเปิดลิงก์
 * ถ้าส่งต่อด้วย herdr จะสลับ pane ไปเงียบๆ ตอนที่ผู้ใช้กำลังมองแท็บใหม่ที่เพิ่งเปิด
 * แล้วกลับมาเจอโฟกัสย้ายโดยไม่รู้สาเหตุ โฟกัสเรียกคืนได้ด้วยการแตะที่ว่างข้างๆ
 */

/** เปิดได้เฉพาะ http/https — กัน `javascript:` และ scheme อื่นที่เป็นช่องทาง XSS */
export function isOpenableUrl(text: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

export interface LinkOpenerPort {
  open(url: string): void;
}

export interface LinkOpener {
  /** เรียกจาก `hover` ของ WebLinksAddon */
  onHover(text: string): void;
  /** เรียกจาก `leave` ของ WebLinksAddon */
  onLeave(): void;
  /**
   * แตะหนึ่งครั้ง: `probe` ต้องยิง mousemove สังเคราะห์ที่จุดนั้น
   * คืน true เมื่อเปิดลิงก์ไปแล้ว (กลืนการแตะ) — false เมื่อควรคลิกตามปกติ
   */
  handleTap(probe: () => void, click: () => void): boolean;
  /** คลิกด้วยเมาส์จริง คืน true เมื่อเปิดลิงก์แล้วและควรกลืนอีเวนต์ทิ้ง */
  handleMouseDown(): boolean;
}

export function createLinkOpener(port: LinkOpenerPort): LinkOpener {
  let hovered: string | null = null;

  const takeHoveredUrl = (): string | null => {
    return hovered !== null && isOpenableUrl(hovered) ? hovered : null;
  };

  return {
    onHover(text) { hovered = text; },
    onLeave() { hovered = null; },

    handleTap(probe, click) {
      probe();
      const url = takeHoveredUrl();
      if (url === null) {
        click();
        return false;
      }
      port.open(url);
      return true;
    },

    handleMouseDown() {
      const url = takeHoveredUrl();
      if (url === null) return false;
      port.open(url);
      return true;
    },
  };
}
