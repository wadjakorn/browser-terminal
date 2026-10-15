import { describe, expect, it } from 'vitest';
import { terminalOptions } from './terminal-options.js';

describe('terminalOptions', () => {
  it('บังคับเลือกบน iPad ได้ — false แล้ว mousedown ของโหมดเลือกทะลุไปเป็นคลิกจริงในแอป', () => {
    expect(terminalOptions(13).macOptionClickForcesSelection).toBe(true);
  });

  it('ไม่ย้าย cursor ด้วย Alt+คลิก — true แล้วแตะในโหมดเลือกพิมพ์ลูกศรเข้า PTY', () => {
    expect(terminalOptions(13).altClickMovesCursor).toBe(false);
  });

  it('ใช้ขนาดฟอนต์ที่ส่งมา', () => {
    expect(terminalOptions(17).fontSize).toBe(17);
  });
});
