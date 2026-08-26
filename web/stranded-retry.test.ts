import { describe, expect, it } from 'vitest';
import { createStrandedRetry } from './stranded-retry.js';

function setup(options: { busy?: () => boolean } = {}) {
  const attempts: number[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;

  const retry = createStrandedRetry({
    attempt: () => { attempts.push(Date.now()); },
    busy: options.busy ?? (() => false),
    setTimeout: (fn, ms) => { const id = next++; timers.push({ fn, ms, id }); return id; },
    clearTimeout: id => {
      const at = timers.findIndex(timer => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  });

  return {
    retry,
    timers,
    attemptCount: () => attempts.length,
    fire: () => { timers.shift()?.fn(); },
  };
}

describe('createStrandedRetry', () => {
  it('รอบแรกรอ 5 วิ แล้วไต่ขึ้นเป็นเท่าตัว', () => {
    const { retry, timers, fire } = setup();

    retry.schedule();
    expect(timers[0]!.ms).toBe(5000);
    fire();

    retry.schedule();
    expect(timers[0]!.ms).toBe(10_000);
    fire();

    retry.schedule();
    expect(timers[0]!.ms).toBe(20_000);
  });

  it('ไม่ไต่เกิน 30 วิ', () => {
    const { retry, timers, fire } = setup();
    for (let i = 0; i < 8; i++) { retry.schedule(); fire(); }
    retry.schedule();
    expect(timers[0]!.ms).toBe(30_000);
  });

  it('ครบเวลาแล้วลองจริง', () => {
    const { retry, fire, attemptCount } = setup();
    retry.schedule();
    fire();
    expect(attemptCount()).toBe(1);
  });

  it('มีนัดค้างอยู่แล้ว schedule ซ้ำไม่ตั้งซ้อน', () => {
    const { retry, timers } = setup();
    retry.schedule();
    retry.schedule();
    retry.schedule();
    expect(timers).toHaveLength(1);
  });

  /*
   * นี่คือบั๊กที่เคยเกิดขึ้นจริงในสาขานี้ — timer หมดอายุตอนที่มีความพยายามตัวอื่น
   * วิ่งอยู่พอดี ผู้เรียก return ทันทีโดยไม่ทันเข้าไปถึงจุดที่ตั้งนัดครั้งถัดไป
   * chain จึงตายเงียบทั้งที่ข้อความบนจอยังสัญญาว่า "จะลองใหม่ให้เอง" อยู่
   */
  it('ตื่นมาตอนไม่ว่าง ต้องตั้งนัดใหม่แทน ไม่ใช่ปล่อย chain ตาย', () => {
    let busy = true;
    const { retry, timers, fire, attemptCount } = setup({ busy: () => busy });

    retry.schedule();
    fire();

    expect(attemptCount()).toBe(0);
    expect(timers).toHaveLength(1);

    busy = false;
    fire();
    expect(attemptCount()).toBe(1);
  });

  it('รอบที่ชนกับตัวอื่นไม่นับเป็นความล้มเหลว — นัดใหม่ใช้ delay เดิม', () => {
    let busy = true;
    const { retry, timers, fire } = setup({ busy: () => busy });

    retry.schedule();
    expect(timers[0]!.ms).toBe(5000);
    fire();
    expect(timers[0]!.ms).toBe(5000);
    fire();
    expect(timers[0]!.ms).toBe(5000);

    // พอว่างแล้วถึงจะไต่ขึ้น
    busy = false;
    fire();
    retry.schedule();
    expect(timers[0]!.ms).toBe(10_000);
  });

  it('ตื่นมาตอนไม่ว่างซ้ำๆ ก็ยังมี timer มีชีวิตอยู่ตัวเดียวเสมอ', () => {
    const { retry, timers, fire } = setup({ busy: () => true });

    retry.schedule();
    for (let i = 0; i < 5; i++) {
      fire();
      expect(timers).toHaveLength(1);
    }
  });

  it('cancel ทิ้ง timer โดยไม่ลอง', () => {
    const { retry, timers, attemptCount } = setup();
    retry.schedule();
    retry.cancel();
    expect(timers).toHaveLength(0);
    expect(attemptCount()).toBe(0);
  });

  it('cancel รีเซ็ต backoff ให้การติดค้างครั้งหน้าเริ่มที่ 5 วิใหม่', () => {
    const { retry, timers, fire } = setup();
    retry.schedule(); fire();
    retry.schedule(); fire();

    retry.cancel();
    retry.schedule();
    expect(timers[0]!.ms).toBe(5000);
  });

  it('cancel ตอนไม่มีนัดค้างอยู่ ไม่พังและยังรีเซ็ต backoff', () => {
    const { retry, timers, fire } = setup();
    retry.schedule(); fire();
    retry.cancel();
    retry.cancel();
    retry.schedule();
    expect(timers[0]!.ms).toBe(5000);
  });
});
