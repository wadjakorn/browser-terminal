/**
 * ตัดสินว่าคีย์บอร์ดบนจอ "มองเห็นอยู่" ไหม — ตรรกะบริสุทธิ์ แยกออกมาเพื่อให้เทสได้
 *
 * แยกไฟล์เพราะเรื่องนี้ทำพังมาแล้วสามรอบ และทุกรอบมาจากสมมติฐานเดียวกัน:
 * **focus ไม่ใช่ตัวชี้วัดว่าคีย์บอร์ดเปิดอยู่** ตอนผู้ใช้ปิดคีย์บอร์ดด้วยปุ่มของ
 * Android เอง ระบบซ่อนคีย์บอร์ดแต่ textarea ยังโฟกัสอยู่ ตัวชี้วัดที่ถูกคือพื้นที่
 * ที่หายไปของ visualViewport
 */
export interface ViewportSample {
  /** ความสูงของ layout viewport (window.innerHeight) */
  innerHeight: number;
  /** ความสูงที่มองเห็นจริง (visualViewport.height) — undefined = ไม่รองรับ API */
  visualHeight?: number;
  /** visualViewport.offsetTop */
  visualOffsetTop?: number;
  /** เครื่องนี้มีหน้าจอสัมผัสไหม */
  hasTouch: boolean;
  /** textarea ของ terminal โฟกัสอยู่ไหม */
  focused: boolean;
  /** พื้นที่หายไปเกินกี่ px ถึงถือว่าคีย์บอร์ดโผล่ */
  thresholdPx?: number;
}

export interface PhysicalKeySample {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  isComposing: boolean;
}

export function isPhysicalKeyboardEvent(sample: PhysicalKeySample): boolean {
  return sample.type === 'keydown'
    && !sample.isComposing
    && sample.key !== 'Unidentified'
    && sample.keyCode !== 229
    && sample.code !== '';
}

export function isKeyboardVisible(s: ViewportSample): boolean {
  // เครื่องที่ไม่มี touch ไม่มีคีย์บอร์ดบนจอให้ซ่อน — viewport ไม่มีวันหด
  // ที่นั่น focus คือคำตอบที่ถูก ไม่งั้นปุ่ม ⌨ จะกดปิดไม่ได้เลยบน desktop
  if (s.visualHeight === undefined || !s.hasTouch) return s.focused;
  const inset = s.innerHeight - s.visualHeight - (s.visualOffsetTop ?? 0);
  return inset > (s.thresholdPx ?? 120);
}

/**
 * ต้องปล่อย focus ทิ้งไหม หลัง viewport เปลี่ยน
 *
 * **นี่คือจุดที่แก้อาการ "ปิดคีย์บอร์ดด้วยปุ่มของ OS แล้วมันเด้งกลับมาตอนปัดจอ"**
 *
 * ตอนผู้ใช้กดปุ่มซ่อนคีย์บอร์ดของ Android ระบบซ่อนคีย์บอร์ดให้จริง แต่ **ไม่ blur
 * textarea ให้** สถานะที่ได้คือ "คีย์บอร์ดหายแล้วแต่ยังโฟกัสอยู่" ซึ่งแปลว่า
 * IME ยังต่ออยู่กับช่องกรอกนั้น พอผู้ใช้แตะหรือปัดอะไรก็ตามบนหน้านั้นอีกครั้ง
 * Chrome ถือว่ากำลังยุ่งกับช่องที่โฟกัสอยู่ จึงเรียกคีย์บอร์ดกลับขึ้นมาเอง
 * (วัดแล้วว่าไม่มีใครในโค้ดเราหรือใน xterm เรียก focus() ระหว่างปัดจอเลย —
 * มันแค่ไม่เคยเสีย focus ตั้งแต่แรก)
 *
 * ทางแก้คือทำให้ "คีย์บอร์ดถูกซ่อน" แปลว่า "ไม่โฟกัส" เสมอ แล้วจะไม่มี IME
 * ค้างไว้ให้ระบบเรียกกลับมาได้อีก
 */
export function shouldReleaseFocus(
  prevVisible: boolean, nextVisible: boolean, focused: boolean,
  recentPhysicalInput = false,
): boolean {
  return prevVisible && !nextVisible && focused && !recentPhysicalInput;
}
