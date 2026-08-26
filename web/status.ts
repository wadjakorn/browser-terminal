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
 * **ช่องค้าง (sticky)** คือชั้นที่สามที่มีไว้แก้ทางตันโดยเฉพาะ: สถานะหยุดถาวร
 * (โดนเตะด้วย 4000 / shell ปิด) พก `action` ที่เป็น *ทางออกทางเดียว* ของผู้ใช้มาด้วย
 * แต่แถบปุ่มยังกดได้อยู่ ผู้ใช้กดแนบรูป/วางแล้วได้ข้อความแจ้งผลเด้งมาทับ พอมันหาย
 * เองใน 6 วิ แถบก็ว่างเปล่า — ปุ่มทางออกหายไปทั้งที่ยังไม่มีใครแก้สถานะให้ เหลือทาง
 * เดียวคือกด refresh ของเบราว์เซอร์ ซึ่งคือทางตันที่ทั้งสาขานี้มีไว้ปิด
 *
 * ช่องค้างจึงจำ view ล่าสุดที่ประกาศตัวว่า `sticky: true` ไว้ แล้วให้ทั้งทางหมดเวลา
 * และทางกดปิด *วาดตัวนั้นกลับมา* แทนที่จะวาด `null` ล้างเฉพาะเมื่อมี `show(null)`
 * ชัดๆ หรือมี sticky ตัวใหม่มาแทน
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
  /**
   * เก็บ view นี้ไว้เป็น "สถานะยืนพื้น" ที่ข้อความชั่วคราวลบทิ้งไม่ได้
   *
   * ใส่กับสถานะที่ผู้ใช้ต้องลงมือทำอะไรสักอย่างถึงจะออกได้เท่านั้น (ดูคอมเมนต์หัวไฟล์)
   */
  sticky?: boolean;
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

  /**
   * สถานะยืนพื้นที่ข้อความชั่วคราวลบทิ้งไม่ได้ — ดูคอมเมนต์หัวไฟล์ว่าทำไมต้องมี
   *
   * ล้างได้สองทางเท่านั้น: `show(null)` ชัดๆ หรือมี sticky ตัวใหม่มาแทน
   */
  let sticky: StatusView | null = null;
  /** view ที่วาดอยู่จริงตอนนี้ — ใช้ตัดสินว่าปุ่มปิดที่ถูกกดเป็นของ sticky เองหรือเปล่า */
  let current: StatusView | null = null;

  const paint = (view: StatusView | null): void => {
    current = view;
    deps.render(view);
  };

  function show(text: string | null, options: StatusOptions = {}): void {
    generation++;
    if (timer) { cancel(timer); timer = 0; }

    // `show(null)` คือคำสั่งล้างจริงจากผู้เรียก (ต่อติดแล้ว / กด restart แล้ว)
    // ไม่ใช่การหมดเวลาของ toast — ที่เดียวนอกจาก sticky ตัวใหม่ที่ล้างช่องค้างได้
    if (text === null) { sticky = null; paint(null); return; }

    const view: StatusView = {
      text,
      title: options.title,
      dismissible: options.dismissible === true,
      ...(options.action ? { action: options.action } : {}),
    };

    if (options.sticky === true) sticky = view;
    paint(view);

    if (options.autoHideMs !== undefined) {
      const at = generation;
      timer = schedule(() => {
        timer = 0;
        // หมดเวลาแล้วถอยกลับไปที่ sticky ไม่ใช่ `null` — ถ้าไม่มี sticky ค้างอยู่
        // `sticky` ก็เป็น null อยู่แล้ว พฤติกรรมเดิมจึงไม่เปลี่ยน
        if (at === generation) { generation++; paint(sticky); }
      }, options.autoHideMs);
    }
  }

  /**
   * ผู้ใช้กดปุ่ม × เอง — ถอยกลับไปที่ sticky เหมือนทางหมดเวลา
   *
   * ห้ามให้ผู้เรียกใช้ `show(null)` แทน: นั่นคือคำสั่งล้างช่องค้างด้วย ปุ่มปิดของ
   * toast หนึ่งใบจึงจะกลายเป็นตัวลบปุ่มทางออกของผู้ใช้ทิ้งไปด้วย
   *
   * ยกเว้นกรณีเดียว: ถ้าสิ่งที่กดปิดคือตัว sticky เอง แปลว่าผู้ใช้ตั้งใจไล่มันไปจริงๆ
   * วาดมันกลับมาก็เท่ากับปุ่มปิดกดไม่ติด
   */
  function dismiss(): void {
    generation++;
    if (timer) { cancel(timer); timer = 0; }
    if (current !== null && current === sticky) sticky = null;
    paint(sticky);
  }

  return { show, dismiss };
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
