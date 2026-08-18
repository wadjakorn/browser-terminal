/**
 * ขอบ pane ที่ผู้ใช้ลากเอง — เก็บไว้เป็น "ตัวสำรอง" เท่านั้น
 *
 * ตัวหลักคือการตรวจเส้นแบ่งสดทุกครั้ง (ดู pane-detect.ts) ค่าที่จำไว้นี้จะถูกใช้
 * ก็ต่อเมื่อตรวจไม่เจอเส้นเลย เช่น pane ที่แบ่งด้วยสีพื้นหลังแทนอักขระเส้น
 *
 * เก็บความกว้างของ terminal ตอนบันทึกไว้ด้วย แล้วทิ้งค่าทันทีที่ความกว้างไม่ตรง —
 * ขอบเก่าบนจอที่แคบลงจะตัดข้อความที่คัดลอกทิ้งไปเงียบๆ ซึ่งแย่กว่าการไม่มีค่าเลย
 */

import type { PaneBounds } from './pane-detect.js';

export const SELECTION_PREFS_STORAGE_KEY = 'browser-terminal:selection:v1';

export interface SelectionPrefs {
  manualBounds: PaneBounds | null;
  /** ความกว้าง terminal ตอนบันทึก — 0 เมื่อไม่มีค่าที่ใช้ได้ */
  columns: number;
}

const EMPTY: SelectionPrefs = { manualBounds: null, columns: 0 };

function readStorage(storage?: Storage): Storage | undefined {
  return storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
}

function validate(value: unknown, columnsNow: number): SelectionPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY;
  const { manualBounds, columns } = value as Record<string, unknown>;

  if (typeof columns !== 'number' || !Number.isInteger(columns) || columns <= 0) return EMPTY;
  if (columns !== columnsNow) return EMPTY;
  if (!manualBounds || typeof manualBounds !== 'object') return EMPTY;

  const { start, end } = manualBounds as Record<string, unknown>;
  if (typeof start !== 'number' || typeof end !== 'number') return EMPTY;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return EMPTY;
  if (start < 0 || end < start || end > columns - 1) return EMPTY;

  return { manualBounds: { start, end }, columns };
}

export function loadSelectionPrefs(columnsNow: number, storage?: Storage): SelectionPrefs {
  const target = readStorage(storage);
  if (!target) return EMPTY;
  try {
    return validate(JSON.parse(target.getItem(SELECTION_PREFS_STORAGE_KEY) ?? 'null'), columnsNow);
  } catch {
    return EMPTY;
  }
}

export function saveManualBounds(bounds: PaneBounds, columns: number, storage?: Storage): void {
  const target = readStorage(storage);
  if (!target) return;
  try {
    target.setItem(SELECTION_PREFS_STORAGE_KEY, JSON.stringify({ manualBounds: bounds, columns }));
  } catch {
    // ค่านี้เป็นแค่ความสะดวก ไม่ใช่ข้อมูลที่ขาดไม่ได้ — storage ปฏิเสธก็ปล่อยผ่าน
  }
}

export function clearManualBounds(storage?: Storage): void {
  const target = readStorage(storage);
  if (!target) return;
  try {
    target.removeItem(SELECTION_PREFS_STORAGE_KEY);
  } catch {
    // เหมือนกับ saveManualBounds
  }
}
