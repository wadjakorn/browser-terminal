/**
 * จังหวะการต่อใหม่หลังสายหลุด
 *
 * แยกออกมาจาก main.ts ด้วยเหตุผลเดียว: `setTimeout` ที่ปล่อยลอยไว้ยกเลิกไม่ได้
 * และ timer ของแท็บที่ถูกซ่อนถูกเบราว์เซอร์มือถือ throttle จนหยุดสนิท ผู้ใช้ที่
 * สลับแอปกลับมาจึงต้องนั่งรอ timer ที่ควรยิงไปนานแล้ว โมดูลนี้ถือ handle ไว้เอง
 * เพื่อให้ `wake()` ตัดการรอทิ้งได้ทันทีที่หน้ากลับมาเห็นหรือเน็ตกลับมา
 */
const FIRST_MS = 1000;
const MAX_MS = 8000;

export interface ReconnectDeps {
  /** เปิดการเชื่อมต่อใหม่ — ผู้เรียกต้อง guard socket ที่ยังไม่ตายเอง */
  connect: () => void;
  /** แจ้งจำนวนวินาทีที่กำลังจะรอ เพื่อเอาไปขึ้นแถบสถานะ */
  onWait: (seconds: number) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface Reconnect {
  /** ตั้งเวลาต่อใหม่ตาม backoff ปัจจุบัน แล้วขยับ backoff ขึ้น */
  schedule(): void;
  /** ต่อทันทีถ้ากำลังรออยู่ — ไม่มีอะไรค้างก็ไม่ทำอะไร */
  wake(): void;
  /** กลับไปเริ่มนับที่ 1 วิ ใช้เมื่อต่อติดแล้ว */
  reset(): void;
  /** ทิ้งการรอโดยไม่ต่อ */
  cancel(): void;
}

export function createReconnect(deps: ReconnectDeps): Reconnect {
  const schedule_ = deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const cancel_ = deps.clearTimeout ?? (id => window.clearTimeout(id));

  let waitMs = FIRST_MS;
  let timer: number | null = null;

  const clear = (): void => {
    if (timer === null) return;
    cancel_(timer);
    timer = null;
  };

  return {
    schedule() {
      clear();
      const ms = waitMs;
      waitMs = Math.min(waitMs * 2, MAX_MS);
      deps.onWait(Math.round(ms / 1000));
      timer = schedule_(() => { timer = null; deps.connect(); }, ms);
    },

    wake() {
      // `timer === null` ครอบสองกรณีพร้อมกัน: ไม่ได้กำลังรอต่อใหม่อยู่เลย และ
      // wake ตัวที่สองที่ยิงตามมาติดๆ (visibilitychange กับ online มาคู่กันได้)
      if (timer === null) return;
      clear();
      deps.connect();
    },

    reset() {
      waitMs = FIRST_MS;
    },

    cancel() {
      clear();
    },
  };
}
