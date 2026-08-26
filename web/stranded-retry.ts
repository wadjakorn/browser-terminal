/**
 * จังหวะการลองเข้า session เองตอนติดอยู่หน้า login
 *
 * แยกออกมาจาก main.ts ด้วยเหตุผลเดียวกับ reconnect.ts (`setTimeout` ที่ปล่อยลอยไว้
 * ยกเลิกไม่ได้) บวกอีกข้อที่หนักกว่า: ตรรกะนี้เคยตายเงียบมาแล้วหนึ่งรอบระหว่างเขียน
 * สาขานี้ — timer หมดอายุไปแล้วแต่ไม่มีใครตั้งนัดใหม่ให้ ทั้งที่ข้อความบนจอยังพูดว่า
 * "จะลองใหม่ให้เอง" อยู่ ตรรกะจับเวลาล้วนๆ ที่ผิดแล้วไม่มีใครเห็นแบบนี้ต้องเทสได้
 *
 * เคสที่พบบ่อยที่สุดจริงๆ ของโปรเจกต์นี้คือ *server* ต่อไม่ติด (Tailscale route
 * กระตุก หรือ process server ล่ม) ทั้งที่ Wi-Fi ของมือถือไม่เคยหลุดเลยและแท็บก็เปิด
 * อยู่ตลอด — เหตุการณ์ `online` จึงไม่มีวันยิงในเคสนี้ ต้องมี timer ลองเองด้วย
 *
 * ระยะรอไต่จาก 5 วินาทีถึง 30 วินาทีเป็นเพดาน ตั้งใจให้ต่างจาก reconnect.ts (1s–8s)
 * เพราะที่นี่ยังไม่มี session ที่ใช้งานได้เลย จึงไม่ต้องรีบเท่าตอนกู้ ws ที่หลุดกลางคัน
 */
const FIRST_MS = 5_000;
const MAX_MS = 30_000;

export interface StrandedRetryDeps {
  /** ลองเข้า session หนึ่งครั้ง — ผู้เรียกเป็นคนเช็คเองว่ายังติดอยู่หน้า login จริงไหม */
  attempt: () => void;
  /**
   * มีความพยายามตัวอื่นวิ่งอยู่แล้วหรือเปล่า
   *
   * ผู้เรียกเป็นคนตัดสิน เพราะความหมายของ "ไม่ว่าง" ผูกกับสถานะของหน้า ไม่ใช่ของ timer
   */
  busy: () => boolean;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface StrandedRetry {
  /** ตั้งนัดลองใหม่ตาม backoff ปัจจุบัน — มีนัดค้างอยู่แล้วจะไม่ตั้งซ้อน */
  schedule(): void;
  /** ทิ้งนัดที่ค้างอยู่ แล้วรีเซ็ต backoff ให้การติดค้างครั้งหน้าเริ่มที่ 5 วิใหม่ */
  cancel(): void;
}

export function createStrandedRetry(deps: StrandedRetryDeps): StrandedRetry {
  const schedule_ = deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const cancel_ = deps.clearTimeout ?? (id => window.clearTimeout(id));

  let waitMs = FIRST_MS;
  let timer: number | null = null;

  const arm = (ms: number): void => { timer = schedule_(fire, ms); };

  function fire(): void {
    // null ก่อนเช็คเสมอ — ทั้งสองกิ่งข้างล่างตั้ง timer ใหม่ได้ ถ้าไม่ล้างก่อน
    // จะมี handle เก่าค้างอยู่จน `schedule()` ของคนอื่นเชื่อว่ามีนัดแล้วทั้งที่ไม่มี
    timer = null;

    /*
     * ชนกับความพยายามตัวอื่นที่กำลังวิ่งอยู่ (กดปุ่ม / visibilitychange / online
     * ชนกับนัดของ timer เอง) — ผู้เรียกจะ return ทันทีโดยไม่ทันได้ลองจริง และไม่ทัน
     * เข้าไปถึงจุดที่ตั้งนัดครั้งถัดไป ถ้าปล่อยผ่านตรงนี้เฉยๆ chain จะตายเงียบ:
     * timer หมดอายุไปแล้ว ไม่มีใครตั้งนัดใหม่ให้อีก ทั้งที่ notice บนจอยังสัญญาว่า
     * "จะลองใหม่ให้เอง" อยู่ (นี่คือบั๊กที่เคยเกิดขึ้นจริงในสาขานี้)
     *
     * ตั้งนัดใหม่ด้วย delay *เดิม* ไม่ใช่เท่าตัว เพราะรอบนี้ไม่นับเป็นความพยายามที่
     * ล้มเหลวจริง แค่ชนกับตัวอื่นที่กำลังทำงานอยู่เท่านั้น
     */
    if (deps.busy()) { arm(waitMs); return; }

    waitMs = Math.min(waitMs * 2, MAX_MS);
    deps.attempt();
  }

  return {
    schedule() {
      if (timer !== null) return;   // มีนัดอยู่แล้ว ไม่ต้องซ้อน
      arm(waitMs);
    },

    cancel() {
      if (timer !== null) {
        cancel_(timer);
        timer = null;
      }
      waitMs = FIRST_MS;
    },
  };
}
