/**
 * หมุดปรับกรอบและแถบยืนยัน — DOM ทั้งหมดของโหมดเลือกที่ไม่ใช่ไฮไลต์
 *
 * ไฮไลต์เป็นของ xterm (DOM renderer วาดทรงบล็อกให้เอง) ไฟล์นี้รับผิดชอบเฉพาะสิ่งที่
 * ลอยอยู่เหนือมัน: หมุดสองมุมที่ลากปรับกรอบได้ และแถบยืนยัน
 *
 * ตรรกะการวางตำแหน่งทั้งหมดแยกเป็นฟังก์ชันบริสุทธิ์ที่ export ไว้ เพราะ vitest ของ repo นี้
 * รันบน environment 'node' ไม่มี DOM ให้เทส — แบบเดียวกับที่ selection-sheet.ts ทำ
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacementLimits {
  viewportHeight: number;
  /** ขอบล่างที่ใช้ได้จริง = top ของแถบปุ่ม ไม่ใช่ขอบ viewport */
  bottomLimit: number;
  barHeight: number;
}

/** ความสูงของแถบยืนยัน — keep synchronized with `.sel-confirm` in style.css */
export const CONFIRM_BAR_HEIGHT_PX = 48;

export function handleAnchors(rect: Rect): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return {
    start: { x: rect.left, y: rect.top },
    end: { x: rect.right, y: rect.bottom },
  };
}

/**
 * เหนือกรอบก่อน ตกลงใต้กรอบเมื่อชิดขอบบน ทับกรอบเมื่อไม่พอทั้งสองทาง
 *
 * ทับกรอบดีกว่าหลุดจอ — แถบที่มองไม่เห็นเท่ากับผู้ใช้ออกจากโหมดไม่ได้เลย
 * นอกจากไปกดปุ่ม ⧉ บนแถบปุ่มซึ่งอาจถูกนิ้วบังอยู่
 */
export function confirmBarPlacement(rect: Rect, limits: PlacementLimits): { side: 'above' | 'below' | 'over'; top: number } {
  /**
   * ตัวแปรสองตัว `top >= 0` และ `top + barHeight <= bottomLimit` อาจขัดแย้ง
   * เมื่อ viewport สั้นกว่าแถบยืนยัน (bottomLimit - barHeight < 0)
   * ในกรณีนี้ `top >= 0` ชนะ — แถบบนจอแม้จะทับแถบปุ่มก็ดีกว่า
   * แถบหลุดจอจะหลุดจากโหมดเลือกไม่ได้เลย และนิ้วอาจบังปุ่ม ⧉ บนแถบปุ่ม
   */
  const clamp = (value: number): number =>
    Math.max(0, Math.min(value, limits.bottomLimit - limits.barHeight));

  if (rect.top - limits.barHeight >= 0) {
    return { side: 'above', top: clamp(rect.top - limits.barHeight) };
  }
  if (rect.bottom + limits.barHeight <= limits.bottomLimit) {
    return { side: 'below', top: clamp(rect.bottom) };
  }
  return { side: 'over', top: clamp((rect.top + rect.bottom) / 2 - limits.barHeight / 2) };
}

/**
 * ซ่อนเฉพาะหมุดที่หลุดจอ ไม่ใช่ทั้งกรอบ — กรอบที่ยาวกว่าหนึ่งหน้าจอเกิดได้จาก
 * output ของ PTY ที่ไหลเข้ามาระหว่างที่ผู้ใช้กำลังปรับ ยกเลิกกรอบทิ้งตอนนั้น
 * เท่ากับลบงานที่ผู้ใช้เพิ่งทำเพราะเหตุที่ไม่ใช่ความผิดเขา
 */
export function handleVisibility(rect: Rect, viewportHeight: number): { start: boolean; end: boolean } {
  return {
    start: rect.top >= 0 && rect.top <= viewportHeight,
    end: rect.bottom >= 0 && rect.bottom <= viewportHeight,
  };
}
