import { describe, it, expect } from 'vitest';
import { createLoginLimiter } from './ratelimit.js';

const T = 1_000_000;

describe('createLoginLimiter', () => {
  it('เริ่มต้นไม่บล็อก', () => {
    expect(createLoginLimiter().isBlocked(T)).toBe(false);
  });

  it('ล้มเหลวใต้ลิมิตยังไม่บล็อก', () => {
    const l = createLoginLimiter({ max: 3, windowMs: 60_000 });
    l.recordFailure(T); l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(false);
  });

  it('ล้มเหลวถึงลิมิตแล้วบล็อก', () => {
    const l = createLoginLimiter({ max: 3, windowMs: 60_000 });
    l.recordFailure(T); l.recordFailure(T); l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(true);
  });

  it('พ้นหน้าต่างเวลาแล้วปลดบล็อกเอง', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000 });
    l.recordFailure(T); l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(true);
    expect(l.isBlocked(T + 60_001)).toBe(false);
  });

  it('ความล้มเหลวเก่ากว่าหน้าต่างไม่ถูกนับ', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000 });
    l.recordFailure(T);
    l.recordFailure(T + 60_001);
    expect(l.isBlocked(T + 60_001)).toBe(false);
  });

  it('reset ล้างถังทันที', () => {
    const l = createLoginLimiter({ max: 1, windowMs: 60_000 });
    l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(true);
    l.reset();
    expect(l.isBlocked(T)).toBe(false);
  });
});

describe('แยกถังตาม IP', () => {
  // นี่คือเหตุผลทั้งหมดของการแยกถัง: เดิมใครก็ล็อกเจ้าของออกจากระบบได้
  it('**IP หนึ่งถูกบล็อก ไม่ทำให้ IP อื่นถูกบล็อกไปด้วย**', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000 });
    l.recordFailure(T, '1.1.1.1'); l.recordFailure(T, '1.1.1.1');
    expect(l.isBlocked(T, '1.1.1.1')).toBe(true);
    expect(l.isBlocked(T, '2.2.2.2')).toBe(false);
  });

  it('reset ปลดเฉพาะ IP ที่ล็อกอินสำเร็จ', () => {
    const l = createLoginLimiter({ max: 1, windowMs: 60_000 });
    l.recordFailure(T, 'a'); l.recordFailure(T, 'b');
    l.reset('a');
    expect(l.isBlocked(T, 'a')).toBe(false);
    expect(l.isBlocked(T, 'b')).toBe(true);
  });

  it('เพดานรวมยังกันการยิงจากหลาย IP พร้อมกัน', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000, globalMax: 5 });
    for (let i = 0; i < 5; i++) l.recordFailure(T, `ip-${i}`);
    expect(l.isBlocked(T, 'ip-ใหม่ที่ยังไม่เคยยิง')).toBe(true);
  });

  // ผู้โจมตีที่หมุน IP ไปเรื่อยๆ ต้องไม่ทำให้หน่วยความจำโตไม่มีที่สิ้นสุด
  it('ถังที่หมดอายุถูกเก็บกวาด ไม่สะสมไปเรื่อยๆ', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000 });
    for (let i = 0; i < 1000; i++) l.recordFailure(T, `ip-${i}`);
    expect(l.size()).toBe(1000);
    l.isBlocked(T + 60_001, 'ใครก็ได้');
    expect(l.size()).toBe(0);
  });
});
