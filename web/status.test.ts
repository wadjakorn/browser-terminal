import { describe, expect, it } from 'vitest';
import { TRANSIENT, createStatus, type StatusView } from './status.js';

function setup() {
  const rendered: (StatusView | null)[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;

  const status = createStatus({
    render: view => { rendered.push(view); },
    setTimeout: (fn, ms) => { const id = next++; timers.push({ fn, ms, id }); return id; },
    clearTimeout: id => {
      const at = timers.findIndex(timer => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  });

  return {
    status,
    timers,
    rendered,
    last: () => rendered.at(-1),
    fire: () => { timers.shift()?.fn(); },
  };
}

describe('createStatus', () => {
  it('แสดงข้อความ แล้วซ่อนเมื่อส่ง null', () => {
    const { status, last } = setup();

    status.show('กำลังต่อใหม่…');
    expect(last()).toEqual({ text: 'กำลังต่อใหม่…', title: undefined, dismissible: false });

    status.show(null);
    expect(last()).toBeNull();
  });

  it('ข้อความสถานะไม่มีตัวจับเวลาและไม่มีปุ่มปิด — มันต้องค้างไว้', () => {
    const { status, timers, last } = setup();

    status.show('shell ปิดแล้ว — โหลดหน้านี้ใหม่เพื่อเริ่มใหม่');

    expect(timers).toHaveLength(0);
    expect(last()?.dismissible).toBe(false);
  });

  it('ข้อความแจ้งผลมีปุ่มปิด และซ่อนตัวเองเมื่อครบเวลา', () => {
    const { status, timers, last, fire } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    expect(last()?.dismissible).toBe(true);
    expect(timers[0]!.ms).toBe(6000);

    fire();
    expect(last()).toBeNull();
  });

  it('ตัวจับเวลาของข้อความเก่าต้องไม่ซ่อนข้อความใหม่ที่มาแทน', () => {
    const { status, last, fire, timers } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    // เน็ตหลุดระหว่างที่ตัวจับเวลายังเดินอยู่ — ข้อความใหม่ต้องอยู่ต่อ
    status.show('กำลังต่อใหม่ใน 2 วิ…');

    // show() ยกเลิกตัวจับเวลาเก่าตั้งแต่ตอนเปลี่ยนข้อความ
    expect(timers).toHaveLength(0);
    fire();
    expect(last()).toEqual({ text: 'กำลังต่อใหม่ใน 2 วิ…', title: undefined, dismissible: false });
  });

  it('ตัวจับเวลาที่หลุดรอดมาได้ ยังต้องไม่ซ่อนข้อความที่มาทีหลัง', () => {
    const { status, last, timers } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    const stale = timers[0]!.fn;
    status.show('กำลังต่อใหม่ใน 2 วิ…');

    stale();

    expect(last()?.text).toBe('กำลังต่อใหม่ใน 2 วิ…');
  });

  it('path เต็มไปอยู่ใน title ไม่ใช่ในข้อความที่แสดง', () => {
    const { status, last } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', { ...TRANSIENT, title: '/home/u/.cache/images/cat.jpg' });

    expect(last()?.text).toBe('แนบรูปแล้ว: cat.jpg');
    expect(last()?.title).toBe('/home/u/.cache/images/cat.jpg');
  });
});
