import { describe, it, expect } from 'vitest';
import {
  createPhysicalKeyboardFocusGuard,
  isKeyboardVisible,
  shouldReleaseFocus,
  type ViewportSample,
} from './keyboard-visibility.js';

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

// อาการที่เคยเจอจริง: ปิดคีย์บอร์ดด้วยปุ่มของ OS แล้วปัดจออ่านต่อ คีย์บอร์ดเด้งกลับมาเอง
// สาเหตุคือ Android ซ่อนคีย์บอร์ดโดยไม่ blur ให้ พอยังโฟกัสอยู่ IME ก็ยังต่ออยู่
// แล้วการยุ่งกับหน้าครั้งถัดไปทำให้ Chrome เรียกมันกลับขึ้นมา
describe('shouldReleaseFocus — ปล่อย focus เมื่อ OS ซ่อนคีย์บอร์ดให้', () => {
  it('**เห็น → ไม่เห็น ทั้งที่ยังโฟกัส = ต้อง blur** (ผู้ใช้กดปุ่มซ่อนของ OS)', () => {
    expect(shouldReleaseFocus(true, false, true)).toBe(true);
  });

  it('เห็น → ไม่เห็น และไม่ได้โฟกัสแล้ว = ไม่ต้องทำอะไร (เรา blur ไปเองแล้ว)', () => {
    expect(shouldReleaseFocus(true, false, false)).toBe(false);
  });

  // ถ้าข้อนี้พัง คีย์บอร์ดจะปิดตัวเองทันทีที่เพิ่งเปิด กลายเป็นพิมพ์ไม่ได้เลย
  it('**ไม่เห็น → เห็น = ห้าม blur เด็ดขาด**', () => {
    expect(shouldReleaseFocus(false, true, true)).toBe(false);
  });

  // แถบ URL ยุบ/กาง และการหมุนจอ ก็ยิง resize เหมือนกัน ต้องไม่ไปปิดคีย์บอร์ดที่เปิดอยู่
  it('สถานะไม่เปลี่ยน = ไม่ทำอะไร ไม่ว่าจะเปิดหรือปิดอยู่', () => {
    expect(shouldReleaseFocus(true, true, true)).toBe(false);
    expect(shouldReleaseFocus(false, false, true)).toBe(false);
    expect(shouldReleaseFocus(false, false, false)).toBe(false);
  });

  it('คง focus เมื่อ physical keyboard เป็นตัวทำให้ IME หด', () => {
    expect(shouldReleaseFocus(true, false, true, true)).toBe(false);
  });

  it('ยังปล่อย focus เมื่อ Android ซ่อน IME โดยไม่มี physical-key marker', () => {
    expect(shouldReleaseFocus(true, false, true, false)).toBe(true);
  });
});

describe('ลำดับ event ของ physical keyboard focus guard', () => {
  function build() {
    let now = 1000;
    return {
      guard: createPhysicalKeyboardFocusGuard({ now: () => now }),
      advance: (ms: number) => { now += ms; },
    };
  }

  it('คง focus เมื่อ IME หดทันทีหลัง physical key', () => {
    const { guard } = build();
    guard.noteInput();
    expect(guard.shouldRelease(true, false, true)).toBe(false);
  });

  it('คง focus เมื่อ key ถึง terminal หลัง viewport รายงานว่า IME ซ่อนแล้ว', () => {
    const { guard } = build();
    guard.noteInput();
    expect(guard.shouldRelease(true, false, true)).toBe(false);
  });

  it('หมดอายุ correlation หลัง viewport animation window', () => {
    const { guard, advance } = build();
    guard.noteInput();
    advance(1001);
    expect(guard.shouldRelease(true, false, true)).toBe(true);
  });

  it('ใช้ marker ได้ครั้งเดียวจึงไม่บัง dismissal ครั้งต่อไป', () => {
    const { guard } = build();
    guard.noteInput();
    expect(guard.shouldRelease(true, false, true)).toBe(false);
    expect(guard.shouldRelease(true, false, true)).toBe(true);
  });

  it('reset และ focus loss ล้าง marker ที่ค้างอยู่', () => {
    const first = build().guard;
    first.noteInput();
    first.reset();
    expect(first.shouldRelease(true, false, true)).toBe(true);

    const second = build().guard;
    second.noteInput();
    expect(second.shouldRelease(true, true, false)).toBe(false);
    expect(second.shouldRelease(true, false, true)).toBe(true);
  });
});
