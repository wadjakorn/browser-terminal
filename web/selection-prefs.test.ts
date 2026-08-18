import { beforeEach, describe, expect, it } from 'vitest';
import {
  SELECTION_PREFS_STORAGE_KEY,
  clearManualBounds,
  loadSelectionPrefs,
  saveManualBounds,
} from './selection-prefs.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

const EMPTY = { manualBounds: null, columns: 0 };

describe('loadSelectionPrefs', () => {
  let storage: FakeStorage;
  beforeEach(() => { storage = new FakeStorage(); });

  it('ยังไม่เคยบันทึก คืนค่าว่างที่ปลอดภัย', () => {
    expect(loadSelectionPrefs(80, storage)).toEqual(EMPTY);
  });

  it('ข้อมูลพังทุกแบบไม่ทำให้ throw', () => {
    for (const bad of [
      'not json', 'null', '[]', '"text"',
      '{"manualBounds":{"start":"a","end":5},"columns":80}',
      '{"manualBounds":{"start":30,"end":10},"columns":80}',   // start > end
      '{"manualBounds":{"start":-1,"end":10},"columns":80}',
      '{"manualBounds":{"start":0,"end":80},"columns":80}',    // end หลุดขอบขวา
      '{"manualBounds":{"start":0,"end":10},"columns":-5}',
    ]) {
      storage.setItem(SELECTION_PREFS_STORAGE_KEY, bad);
      expect(loadSelectionPrefs(80, storage)).toEqual(EMPTY);
    }
  });

  it('บันทึกแล้วอ่านกลับได้ที่ความกว้างเดิม', () => {
    saveManualBounds({ start: 0, end: 39 }, 80, storage);
    expect(loadSelectionPrefs(80, storage)).toEqual({ manualBounds: { start: 0, end: 39 }, columns: 80 });
  });

  it('ความกว้างเปลี่ยน = ทิ้งค่าที่จำไว้', () => {
    // ขอบที่เก่าแล้วจะตัดข้อความที่คัดลอกทิ้งไปครึ่งหนึ่งโดยไม่มีอะไรฟ้อง
    saveManualBounds({ start: 0, end: 39 }, 80, storage);
    expect(loadSelectionPrefs(40, storage)).toEqual(EMPTY);
  });

  it('ลบค่าที่จำไว้ได้', () => {
    saveManualBounds({ start: 0, end: 39 }, 80, storage);
    clearManualBounds(storage);
    expect(loadSelectionPrefs(80, storage)).toEqual(EMPTY);
  });
});

describe('saveManualBounds', () => {
  it('storage ที่เขียนไม่ได้ (โหมดส่วนตัว/โควตาเต็ม) ต้องไม่ throw', () => {
    const hostile = new FakeStorage();
    hostile.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => saveManualBounds({ start: 0, end: 10 }, 80, hostile)).not.toThrow();
  });
});
