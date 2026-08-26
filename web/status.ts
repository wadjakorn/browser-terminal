/**
 * แถบสถานะเหนือ terminal
 *
 * แยกข้อความสองชนิดออกจากกันโดยตั้งใจ:
 *
 * - **สถานะที่ยังเป็นจริงอยู่** (ถูกเตะออก, shell ปิด, กำลังต่อใหม่) ต้องค้างไว้
 *   จนกว่าสถานะจะเปลี่ยน เพราะผู้ใช้ต้องทำอะไรสักอย่าง
 * - **การแจ้งผล** (แนบรูปแล้ว, วางไม่สำเร็จ) หายเองได้ — ถ้าไม่หาย มันจะกินพื้นที่จอ
 *   มือถือทิ้งไว้ตลอดโดยไม่มีประโยชน์อะไรแล้ว และเบียดความสูงของ terminal
 *
 * การตัดสินใจว่าจะแสดงอะไรแยกออกจากการเขียน DOM เพื่อให้เทสต์ได้โดยไม่ต้องมี DOM
 * เหมือนโมดูลอื่นในโฟลเดอร์นี้
 */

export interface StatusOptions {
  /** ซ่อนเองหลังกี่ ms — ใส่เฉพาะข้อความที่เป็นการแจ้งผล */
  autoHideMs?: number;
  /** ใส่ปุ่มปิดให้ผู้ใช้กดเองได้ */
  dismissible?: boolean;
  /** ข้อความเต็มสำหรับ tooltip เมื่อตัวที่แสดงถูกย่อ */
  title?: string;
  /** ปุ่มที่พาผู้ใช้ออกจากสถานะปัจจุบัน — ใช้กับสถานะที่ไม่หายไปเอง */
  action?: StatusAction;
}

/** ปุ่มที่พาผู้ใช้ออกจากสถานะปัจจุบัน — ใช้กับสถานะที่ไม่หายไปเอง */
export interface StatusAction {
  label: string;
  onClick: () => void;
}

/** สิ่งที่ต้องปรากฏบนจอ — `null` คือซ่อนแถบทั้งอัน */
export interface StatusView {
  text: string;
  title?: string;
  dismissible: boolean;
  action?: StatusAction;
}

/** ค่าที่ใช้กับข้อความแจ้งผลทุกอัน — รวมไว้ที่เดียวเพื่อให้พฤติกรรมเหมือนกันหมด */
export const TRANSIENT: StatusOptions = { autoHideMs: 6000, dismissible: true };

export function createStatus(deps: {
  render: (view: StatusView | null) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}) {
  const schedule = deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((id) => window.clearTimeout(id));

  /**
   * นับทุกครั้งที่ข้อความเปลี่ยน
   *
   * ตัวจับเวลาต้องเช็คเลขนี้ก่อนซ่อนเสมอ ไม่งั้นจะเกิดเคสนี้: แนบรูป (ตั้งเวลาซ่อนไว้
   * 6 วิ) → เน็ตหลุดที่วินาทีที่ 3 → ขึ้น "กำลังต่อใหม่…" → วินาทีที่ 6 ตัวจับเวลา
   * ของข้อความเก่าซ่อนข้อความที่ยังต้องอยู่ทิ้งไปเงียบๆ
   */
  let generation = 0;
  let timer = 0;

  function show(text: string | null, options: StatusOptions = {}): void {
    generation++;
    if (timer) { cancel(timer); timer = 0; }

    if (text === null) { deps.render(null); return; }

    deps.render({
      text,
      title: options.title,
      dismissible: options.dismissible === true,
      ...(options.action ? { action: options.action } : {}),
    });

    if (options.autoHideMs !== undefined) {
      const at = generation;
      timer = schedule(() => {
        timer = 0;
        if (at === generation) show(null);
      }, options.autoHideMs);
    }
  }

  return { show };
}

/**
 * เขียน view ลง DOM — ส่วนที่เหลือของโมดูลนี้ตัดสินใจให้แล้วว่าจะแสดงอะไร
 *
 * สร้าง element ใหม่ทุกครั้งแทนการแก้ของเดิม เพราะปุ่มปิดของข้อความก่อนหน้าต้องหายไป
 * เมื่อข้อความใหม่ไม่ได้ขอปุ่มปิด
 */
export function renderStatus(
  element: HTMLElement,
  view: StatusView | null,
  onDismiss: () => void,
): void {
  if (view === null) {
    element.hidden = true;
    element.replaceChildren();
    return;
  }

  const message = element.ownerDocument.createElement('span');
  message.className = 'status-text';
  message.textContent = view.text;
  if (view.title) message.title = view.title;
  element.replaceChildren(message);

  if (view.action) {
    const action = element.ownerDocument.createElement('button');
    action.type = 'button';
    action.className = 'status-action';
    action.textContent = view.action.label;
    action.addEventListener('click', view.action.onClick);
    element.append(action);
  }

  if (view.dismissible) {
    const close = element.ownerDocument.createElement('button');
    close.type = 'button';
    close.className = 'status-close';
    close.textContent = '×';
    close.title = 'ปิดข้อความนี้';
    close.setAttribute('aria-label', 'ปิดข้อความนี้');
    close.addEventListener('click', onDismiss);
    element.append(close);
  }

  element.hidden = false;
}
