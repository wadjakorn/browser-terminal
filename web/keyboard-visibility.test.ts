import { describe, it, expect } from 'vitest';
import { isKeyboardVisible, type ViewportSample } from './keyboard-visibility.js';

const phone = (over: Partial<ViewportSample> = {}): ViewportSample => ({
  innerHeight: 800, visualHeight: 800, visualOffsetTop: 0,
  hasTouch: true, focused: false, ...over,
});

describe('มือถือ — ตัดสินจากพื้นที่ที่หายไป ไม่ใช่ focus', () => {
  it('คีย์บอร์ดโผล่ (จอหด 300px) = เห็น', () => {
    expect(isKeyboardVisible(phone({ visualHeight: 500, focused: true }))).toBe(true);
  });

  it('**เคสที่เคยพัง**: ผู้ใช้ปิดคีย์บอร์ดด้วยปุ่มของ OS — ยังโฟกัสอยู่แต่จอไม่หด = ไม่เห็น', () => {
    expect(isKeyboardVisible(phone({ visualHeight: 800, focused: true }))).toBe(false);
  });

  it('ไม่โฟกัสและจอไม่หด = ไม่เห็น', () => {
    expect(isKeyboardVisible(phone())).toBe(false);
  });

  it('จอหดนิดเดียว (แถบ URL ยุบ) ไม่นับเป็นคีย์บอร์ด', () => {
    expect(isKeyboardVisible(phone({ visualHeight: 740, focused: true }))).toBe(false);
  });

  it('นับ offsetTop ด้วย — จอหดเท่ากันแต่ถูกเลื่อนลงมา คือ scroll ไม่ใช่คีย์บอร์ด', () => {
    // จอหด 200px แต่พื้นที่ที่หายไปอยู่ "ข้างบน" (offsetTop) ไม่ใช่ข้างล่าง
    // = หน้าเว็บถูกเลื่อน ไม่ใช่คีย์บอร์ดกินที่ด้านล่าง
    expect(isKeyboardVisible(phone({ visualHeight: 600, visualOffsetTop: 100 }))).toBe(false);
    expect(isKeyboardVisible(phone({ visualHeight: 600, visualOffsetTop: 0 }))).toBe(true);
  });

  it('ปรับ threshold ได้', () => {
    expect(isKeyboardVisible(phone({ visualHeight: 700, thresholdPx: 50 }))).toBe(true);
    expect(isKeyboardVisible(phone({ visualHeight: 700, thresholdPx: 200 }))).toBe(false);
  });
});

describe('เครื่องที่ไม่มีคีย์บอร์ดบนจอ — ถอยไปใช้ focus', () => {
  it('ไม่มี touch: โฟกัส = ถือว่าเปิด (ไม่งั้นปุ่ม ⌨ กดปิดไม่ได้)', () => {
    expect(isKeyboardVisible(phone({ hasTouch: false, focused: true }))).toBe(true);
    expect(isKeyboardVisible(phone({ hasTouch: false, focused: false }))).toBe(false);
  });

  it('ไม่รองรับ visualViewport: ถอยไปใช้ focus เช่นกัน', () => {
    expect(isKeyboardVisible(phone({ visualHeight: undefined, focused: true }))).toBe(true);
  });
});
