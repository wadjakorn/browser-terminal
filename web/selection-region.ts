/**
 * กรอบสี่เหลี่ยมของการเลือก และการดึงข้อความออกมา — ตรรกะบริสุทธิ์ ไม่รู้จัก DOM
 *
 * ใช้ "หมายเลขบรรทัดสัมบูรณ์ใน buffer" (baseY + แถวบนจอ) ไม่ใช่แถวบนจอ เพราะกรอบ
 * ต้องยังหมายถึงข้อความเดิมแม้ viewport จะเลื่อนใต้มันไป
 *
 * เราดึงข้อความเองแทนที่จะใช้ `selectionText` ของ xterm ด้วยเหตุผลสองข้อ: มันคืน
 * สตริงว่างเมื่อลากตรงดิ่ง (คอลัมน์เริ่มเท่ากับคอลัมน์จบ) และบน iPad โหมดเลือกแบบ
 * คอลัมน์เปิดไม่ได้ ทำให้ข้อความที่ได้มีเส้นแบ่งติดมา — ดึงเองแล้วผลลัพธ์เหมือนกันทุกที่
 */

import type { PaneBounds } from './pane-detect.js';

export interface Cell {
  /** หมายเลขบรรทัดสัมบูรณ์ใน buffer */
  line: number;
  column: number;
}

export interface Block {
  /** inclusive */
  topLine: number;
  /** inclusive */
  bottomLine: number;
  /** inclusive */
  startColumn: number;
  /** inclusive */
  endColumn: number;
}

/** อ่านข้อความช่วงคอลัมน์ของบรรทัด — endColumn เป็น inclusive ในสัญญานี้ */
export type LineReader = (line: number, startColumn: number, endColumn: number) => string;

export function blockFrom(anchor: Cell, focus: Cell): Block {
  return {
    topLine: Math.min(anchor.line, focus.line),
    bottomLine: Math.max(anchor.line, focus.line),
    startColumn: Math.min(anchor.column, focus.column),
    endColumn: Math.max(anchor.column, focus.column),
  };
}

/**
 * ตรึงคอลัมน์เดียวให้อยู่ใน pane
 *
 * ตั้งใจให้ตรึงเป็น "จุด" ไม่ใช่ "กรอบ" เพราะตัวควบคุมตรึงตำแหน่งนิ้วตั้งแต่ตอนที่มัน
 * ขยับ กรอบจึงไม่มีวันหลุด pane ตั้งแต่แรก และไฮไลต์ที่ xterm วาดจะตรงกับข้อความที่
 * จะถูกคัดลอกจริง — ถ้าตรึงทีหลังตอนดึงข้อความ ผู้ใช้จะเห็นไฮไลต์กว้างกว่าที่ได้จริง
 */
export function clampColumn(column: number, pane: PaneBounds | null): number {
  if (!pane) return column;
  return Math.min(pane.end, Math.max(pane.start, column));
}

export function extractText(
  block: Block,
  read: LineReader,
  opts: { trimTrailing?: boolean } = {},
): string {
  const trimTrailing = opts.trimTrailing ?? true;
  const rows: string[] = [];

  for (let line = block.topLine; line <= block.bottomLine; line++) {
    const raw = read(line, block.startColumn, block.endColumn);
    rows.push(trimTrailing ? raw.replace(/\s+$/, '') : raw);
  }

  // บรรทัดว่างท้ายกรอบเกิดจากการลากเลยเนื้อหาลงไป ซึ่งบนมือถือเกิดตลอด — ทิ้ง
  // แต่บรรทัดว่างตรงกลางคือส่วนหนึ่งของเนื้อหาจริง ต้องเก็บไว้
  if (trimTrailing) {
    while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  }

  return rows.join('\n');
}
