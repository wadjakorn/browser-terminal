import { describe, it, expect } from 'vitest';
import { PAGES, KEYS_PER_PAGE } from './keybar.js';

const all = PAGES.flat();

describe('การแบ่งหน้าของแถบปุ่ม', () => {
  // ข้อนี้คือทั้งหมดของงานนี้ — ถ้าพัง แถบปุ่มจะกลับไปล้นจอแคบและต้องเลื่อน
  // แนวนอนอีกครั้ง ซึ่งคือปัญหาที่การแบ่งหน้าเกิดมาเพื่อแก้
  it('**ไม่มีหน้าไหนเกินจำนวนช่องที่จอ 360px รับได้**', () => {
    for (const [i, page] of PAGES.entries()) {
      expect(page.length, `หน้า ${i + 1} มี ${page.length} ปุ่ม`)
        .toBeLessThanOrEqual(KEYS_PER_PAGE);
    }
  });

  it('ไม่มีปุ่มซ้ำข้ามหน้า', () => {
    const labels = all.map(b => b.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('ปุ่มที่ขาดไม่ได้ยังอยู่ครบ', () => {
    const labels = all.map(b => b.label);
    for (const need of ['Esc', 'Tab', '⇧Tab', 'Ctrl', 'Alt', '^C', '↑', '↓', '←', '→']) {
      expect(labels).toContain(need);
    }
  });

  // Esc กับ ⇧Tab คือสองปุ่มที่ใช้ถี่ที่สุดใน claude-code (ออกจากโหมด / สลับโหมด)
  // ถ้าหลุดไปหน้าสองจะต้องกด ⇄ ก่อนทุกครั้ง ซึ่งทำให้แถบนี้เสียเหตุผลที่มีอยู่
  it('ปุ่มที่ใช้ถี่ที่สุดอยู่หน้าแรก', () => {
    const first = PAGES[0]!.map(b => b.label);
    expect(first).toContain('Esc');
    expect(first).toContain('⇧Tab');
  });

  it('⇧Tab ส่ง CSI Z ตามมาตรฐาน back-tab', () => {
    const shiftTab = all.find(b => b.label === '⇧Tab')!;
    expect(shiftTab.key).toEqual({ kind: 'literal', data: '\x1b[Z' });
  });
});
