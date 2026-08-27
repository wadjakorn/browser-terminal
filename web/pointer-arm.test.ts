import { describe, expect, it } from 'vitest';
import { createPointerArm } from './pointer-arm.js';

describe('createPointerArm', () => {
  it('arm ใช้ได้ครั้งเดียว — แตะครั้งที่สองเป็นคลิกซ้ายตามเดิม', () => {
    const arm = createPointerArm();
    arm.toggle();
    expect(arm.consume()).toBe(true);
    expect(arm.consume()).toBe(false);
    expect(arm.armed()).toBe(false);
  });
});
