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

export function isKeyboardVisible(s: ViewportSample): boolean {
  // เครื่องที่ไม่มี touch ไม่มีคีย์บอร์ดบนจอให้ซ่อน — viewport ไม่มีวันหด
  // ที่นั่น focus คือคำตอบที่ถูก ไม่งั้นปุ่ม ⌨ จะกดปิดไม่ได้เลยบน desktop
  if (s.visualHeight === undefined || !s.hasTouch) return s.focused;
  const inset = s.innerHeight - s.visualHeight - (s.visualOffsetTop ?? 0);
  return inset > (s.thresholdPx ?? 120);
}
