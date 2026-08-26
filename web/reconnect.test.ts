import { describe, expect, it } from 'vitest';
import { createReconnect } from './reconnect.js';

function setup() {
  const connects: number[] = [];
  const waits: number[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;

  const reconnect = createReconnect({
    connect: () => { connects.push(Date.now()); },
    onWait: seconds => { waits.push(seconds); },
    setTimeout: (fn, ms) => { const id = next++; timers.push({ fn, ms, id }); return id; },
    clearTimeout: id => {
      const at = timers.findIndex(timer => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  });

  return {
    reconnect,
    timers,
    waits,
    connectCount: () => connects.length,
    fire: () => { const timer = timers.shift(); timer?.fn(); },
  };
}

describe('createReconnect', () => {
  it('รอบแรกรอ 1 วิ แล้วไต่ขึ้นเป็นเท่าตัว', () => {
    const { reconnect, timers, fire } = setup();

    reconnect.schedule();
    expect(timers[0]!.ms).toBe(1000);
    fire();

    reconnect.schedule();
    expect(timers[0]!.ms).toBe(2000);
    fire();

    reconnect.schedule();
    expect(timers[0]!.ms).toBe(4000);
  });

  it('ไม่ไต่เกิน 8 วิ', () => {
    const { reconnect, timers, fire } = setup();
    for (let i = 0; i < 8; i++) { reconnect.schedule(); fire(); }
    reconnect.schedule();
    expect(timers[0]!.ms).toBe(8000);
  });

  it('บอกจำนวนวินาทีที่ต้องรอ เพื่อให้ผู้เรียกเอาไปแสดงผล', () => {
    const { reconnect, waits, fire } = setup();
    reconnect.schedule();
    fire();
    reconnect.schedule();
    expect(waits).toEqual([1, 2]);
  });

  /*
   * นี่คือเหตุผลหลักที่โมดูลนี้มีอยู่ — timer ของแท็บที่ถูกซ่อนถูก throttle
   * ผู้ใช้ที่สลับกลับมาต้องได้ต่อทันที ไม่ใช่รอเก้อจนครบ 8 วิ
   */
  it('wake ต่อทันทีและทิ้ง timer ที่ค้างอยู่', () => {
    const { reconnect, timers, connectCount } = setup();
    reconnect.schedule();
    expect(timers).toHaveLength(1);

    reconnect.wake();
    expect(connectCount()).toBe(1);
    expect(timers).toHaveLength(0);
  });

  it('wake ตอนไม่มีอะไรค้างอยู่ ไม่ทำอะไรเลย', () => {
    const { reconnect, connectCount } = setup();
    reconnect.wake();
    expect(connectCount()).toBe(0);
  });

  /*
   * `visibilitychange` กับ `online` ยิงพร้อมกันได้ ถ้า wake สองครั้งแปลว่า connect
   * สองครั้ง server จะเตะ socket ตัวแรกด้วย 4000 ซึ่งฝั่ง client ตีความว่า
   * "เปิดที่อื่นแล้ว" แล้วหยุดถาวร — เท่ากับสร้างทางตันอันใหม่จากฟีเจอร์ที่ปิดทางตัน
   */
  it('wake ซ้อนติดกันต่อแค่ครั้งเดียว', () => {
    const { reconnect, connectCount } = setup();
    reconnect.schedule();
    reconnect.wake();
    reconnect.wake();
    expect(connectCount()).toBe(1);
  });

  it('reset ทำให้รอบถัดไปกลับไปเริ่มที่ 1 วิ', () => {
    const { reconnect, timers, fire } = setup();
    reconnect.schedule(); fire();
    reconnect.schedule(); fire();
    reconnect.reset();
    reconnect.schedule();
    expect(timers[0]!.ms).toBe(1000);
  });

  it('cancel ทิ้ง timer โดยไม่ต่อ', () => {
    const { reconnect, timers, connectCount } = setup();
    reconnect.schedule();
    reconnect.cancel();
    expect(timers).toHaveLength(0);
    expect(connectCount()).toBe(0);
  });
});
