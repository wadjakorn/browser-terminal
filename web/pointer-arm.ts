/**
 * "แตะปุ่มหนึ่งครั้ง แล้วแตะจอครั้งถัดไปเป็นคลิกขวา" — สถานะเดียว ใช้แล้วดับเอง
 *
 * แยกออกมาจาก main.ts เพราะตรงนั้นไม่มีอะไรเทสต์ได้เลย และเพราะมันไม่ควรรู้จัก
 * keybar หรือ DOM — ผู้เรียกเป็นคนสั่งทาสีปุ่มเอง
 *
 * มีแค่ consume() ไม่มี disarm() แยก: สองตัวนั้นเปลี่ยนสถานะเหมือนกันทุกอย่าง
 * ต่างแค่ผู้เรียกสนใจค่าที่คืนหรือไม่ จุดที่ต้องการแค่ยกเลิกเขียน `void arm.consume()`
 */
export interface PointerArm {
  toggle(): void;
  /** armed → off คืน true เมื่อสถานะเดิม armed */
  consume(): boolean;
  armed(): boolean;
}

export function createPointerArm(): PointerArm {
  let on = false;
  return {
    toggle() { on = !on; },
    consume() {
      const was = on;
      on = false;
      return was;
    },
    armed: () => on,
  };
}
