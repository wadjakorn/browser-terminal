import { describe, it, expect } from 'vitest';
import {
  KEYS, paginate, slotsThatFit, MIN_BTN_PX, GAP_PX,
} from './keybar.js';

/** ความกว้างที่ปุ่มใช้ได้จริงบนจอกว้างเท่านี้ — หัก padding .35rem สองข้างออกแล้ว */
const usable = (viewportPx: number) => viewportPx - 11.2;

describe('slotsThatFit — นับช่องจากความกว้างจริง', () => {
  it('จอ 360px (แคบสุดที่รองรับ) ได้ 8 ช่อง', () => {
    expect(slotsThatFit(usable(360))).toBe(8);
  });

  it('จอ 412px (Android ทั่วไป) ได้มากกว่าจอ 360px', () => {
    expect(slotsThatFit(usable(412))).toBeGreaterThan(slotsThatFit(usable(360)));
  });

  it('มือถือแนวนอน 740px ใส่ปุ่มได้ครบทั้งหมดในแถวเดียว', () => {
    expect(slotsThatFit(usable(740))).toBeGreaterThanOrEqual(KEYS.length + 1);
  });

  // ถ้าข้อนี้พัง แถบจะล้นออกนอกจอ ซึ่งคือปัญหาเดิมทั้งหมดที่งานนี้แก้
  it('**ช่องที่นับได้ต้องกางออกแล้วไม่เกินความกว้างที่มี**', () => {
    for (const w of [320, 360, 390, 412, 480, 600, 740, 1024, 1920]) {
      const avail = usable(w);
      const n = slotsThatFit(avail);
      const needed = n * MIN_BTN_PX + (n - 1) * GAP_PX;
      expect(needed, `จอ ${w}px นับได้ ${n} ช่อง ต้องใช้ ${needed}px จาก ${avail}px`)
        .toBeLessThanOrEqual(avail);
    }
  });

  it('จอแคบผิดปกติหรือยังวัดไม่ได้ ต้องคืนอย่างน้อย 1 ไม่ใช่ 0 หรือติดลบ', () => {
    expect(slotsThatFit(0)).toBe(1);
    expect(slotsThatFit(-100)).toBe(1);
  });
});

describe('paginate — แบ่งหน้าตามช่องที่มี', () => {
  it('ช่องพอใส่ครบ (นับ ⌨ ด้วย) = หน้าเดียว ไม่ต้องมีปุ่ม ⇄', () => {
    expect(paginate(KEYS, KEYS.length + 1)).toEqual([KEYS]);
  });

  it('ขาดไปช่องเดียวก็ต้องแบ่งหน้า — ⌨ ต้องมีที่ยืนเสมอ', () => {
    expect(paginate(KEYS, KEYS.length).length).toBeGreaterThan(1);
  });

  it('**ทุกหน้าต้องไม่เกินช่องที่เหลือหลังกันให้ ⇄ กับ ⌨**', () => {
    for (const w of [320, 360, 390, 412, 480, 600]) {
      const slots = slotsThatFit(usable(w));
      for (const page of paginate(KEYS, slots)) {
        expect(page.length + 2, `จอ ${w}px`).toBeLessThanOrEqual(slots);
      }
    }
  });

  it('ไม่ทำปุ่มหาย ไม่ทำปุ่มซ้ำ ไม่ว่าจอกว้างเท่าไร', () => {
    for (const slots of [3, 4, 5, 6, 8, 10, 14, 15, 20]) {
      expect(paginate(KEYS, slots).flat()).toEqual(KEYS);
    }
  });

  // ตัดเต็มหน้าไปเรื่อยๆ จะได้ 6,6,2 — หน้าสุดท้ายโล่งจนดูเหมือนแอปพัง
  it('เกลี่ยให้หน้าท้ายๆ ไม่โล่ง', () => {
    const sizes = paginate(KEYS, 8).map(p => p.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('ปุ่มที่ใช้ถี่ที่สุดอยู่หน้าแรกเสมอ แม้จอแคบสุด', () => {
    const first = paginate(KEYS, slotsThatFit(usable(360)))[0]!.map(b => b.label);
    expect(first).toContain('Esc');
    expect(first).toContain('⇧Tab');
  });
});

describe('ชุดปุ่ม', () => {
  it('ไม่มี label ซ้ำ', () => {
    const labels = KEYS.map(b => b.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('ปุ่มที่ขาดไม่ได้อยู่ครบ', () => {
    const labels = KEYS.map(b => b.label);
    for (const need of ['Esc', 'Tab', '⇧Tab', 'Ctrl', 'Alt', '^C', '↑', '↓', '←', '→']) {
      expect(labels).toContain(need);
    }
  });

  it('⇧Tab ส่ง CSI Z ตามมาตรฐาน back-tab', () => {
    expect(KEYS.find(b => b.label === '⇧Tab')!.key)
      .toEqual({ kind: 'literal', data: '\x1b[Z' });
  });
});
