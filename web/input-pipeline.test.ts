// web/input-pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createInputPipeline, type BarKey, type Modes } from './input-pipeline.js';

const CTRL: BarKey = { kind: 'modifier', name: 'ctrl' };
const ALT: BarKey = { kind: 'modifier', name: 'alt' };
const lit = (data: string): BarKey => ({ kind: 'literal', data });

let sent: number[][];
let modes: Modes;
let p: ReturnType<typeof createInputPipeline>;

beforeEach(() => {
  sent = [];
  modes = { applicationCursorKeysMode: false };
  p = createInputPipeline({
    send: b => sent.push([...b]),
    getModes: () => modes,
  });
});

const bytes = (s: string) => [...new TextEncoder().encode(s)];
const only = () => { expect(sent).toHaveLength(1); return sent[0]!; };

describe('ตัวอักษรเดี่ยว', () => {
  it('ไม่มี modifier ส่งผ่านเป็น UTF-8', () => {
    p.onTerminalData('a');
    expect(only()).toEqual([0x61]);
  });

  it('ctrl + ตัวอักษร', () => {
    p.onBarKey(CTRL); p.onTerminalData('a');
    expect(only()).toEqual([0x01]);
  });

  it('ctrl + ตัวพิมพ์ใหญ่ก็ได้ control code เดียวกัน', () => {
    p.onBarKey(CTRL); p.onTerminalData('A');
    expect(only()).toEqual([0x01]);
  });

  it('ctrl + สัญลักษณ์', () => {
    p.onBarKey(CTRL); p.onTerminalData('?');
    expect(only()).toEqual([0x7f]);
  });

  it('alt เติม ESC นำหน้า', () => {
    p.onBarKey(ALT); p.onTerminalData('x');
    expect(only()).toEqual([0x1b, 0x78]);
  });

  it('ctrl + alt แปลง ctrl ก่อนแล้วเติม ESC', () => {
    p.onBarKey(CTRL); p.onBarKey(ALT); p.onTerminalData('a');
    expect(only()).toEqual([0x1b, 0x01]);
  });

  it('ctrl กับตัวที่ไม่มี control code ส่งดิบและล้าง modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('ก');
    expect(only()).toEqual(bytes('ก'));
    expect(p.modifierState().ctrl).toBe(false);
  });

  it('modifier ถูกปลดหลังใช้', () => {
    p.onBarKey(CTRL); p.onTerminalData('a'); p.onTerminalData('b');
    expect(sent).toEqual([[0x01], [0x62]]);
  });
});

describe('ปุ่มลูกศร — โหมด cursor', () => {
  it('โหมดปกติ ส่งผ่าน CSI ตามเดิม', () => {
    p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1b[D'));
  });

  it('application cursor mode แปลงเป็น SS3', () => {
    modes.applicationCursorKeysMode = true;
    p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1bOD'));
  });

  it('input ที่เป็น SS3 อยู่แล้วในโหมดปกติ ถูกแปลงกลับเป็น CSI', () => {
    p.onTerminalData('\x1bOD');
    expect(only()).toEqual(bytes('\x1b[D'));
  });

  it('ctrl + ลูกศร ได้ CSI แบบมี modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1b[1;5D'));
  });

  it('ctrl + ลูกศร ใน app cursor mode ก็ยังเป็น CSI แบบมี modifier', () => {
    modes.applicationCursorKeysMode = true;
    p.onBarKey(CTRL); p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1b[1;5D'));
  });

  it('alt + ลูกศร ได้ n = 3', () => {
    p.onBarKey(ALT); p.onTerminalData('\x1b[A');
    expect(only()).toEqual(bytes('\x1b[1;3A'));
  });

  it('ctrl + alt + ลูกศร ได้ n = 7', () => {
    p.onBarKey(CTRL); p.onBarKey(ALT); p.onTerminalData('\x1b[C');
    expect(only()).toEqual(bytes('\x1b[1;7C'));
  });

  it('Home/End ก็ใช้กติกาเดียวกัน', () => {
    p.onBarKey(CTRL); p.onTerminalData('\x1b[H');
    expect(only()).toEqual(bytes('\x1b[1;5H'));
  });
});

describe('paste และ sequence อื่น', () => {
  it('paste ระหว่างค้าง ctrl ส่งดิบและล้าง modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('hello world');
    expect(only()).toEqual(bytes('hello world'));
    expect(p.modifierState().ctrl).toBe(false);
  });

  it('paste ที่มีภาษาไทยเข้ารหัส UTF-8 ถูกต้อง', () => {
    p.onTerminalData('สวัสดี');
    expect(only()).toEqual(bytes('สวัสดี'));
  });

  it('sequence อื่นที่ไม่ใช่ cursor ส่งผ่านและล้าง modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('\x1b[3~');
    expect(only()).toEqual(bytes('\x1b[3~'));
    expect(p.modifierState().ctrl).toBe(false);
  });
});

describe('BarKey', () => {
  it('modifier ไม่ส่ง byte ออกเอง', () => {
    p.onBarKey(CTRL);
    expect(sent).toHaveLength(0);
    expect(p.modifierState().ctrl).toBe(true);
  });

  it('กด modifier ซ้ำคือ toggle ปลด', () => {
    p.onBarKey(CTRL); p.onBarKey(CTRL);
    expect(p.modifierState().ctrl).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('literal ผ่านกติกา modifier เหมือน input จากคีย์บอร์ด — alt + Esc', () => {
    p.onBarKey(ALT); p.onBarKey(lit('\x1b'));
    expect(only()).toEqual([0x1b, 0x1b]);
  });

  it('literal — ctrl + ขีดกลาง ได้ 0x1f', () => {
    p.onBarKey(CTRL); p.onBarKey(lit('-'));
    expect(only()).toEqual([0x1f]);
  });

  it('literal — ปุ่มลูกศรบนแถบใช้กติกาโหมดเดียวกัน', () => {
    modes.applicationCursorKeysMode = true;
    p.onBarKey(lit('\x1b[D'));
    expect(only()).toEqual(bytes('\x1bOD'));
  });

  it('literal — Tab ธรรมดา', () => {
    p.onBarKey(lit('\t'));
    expect(only()).toEqual([0x09]);
  });

  it('interrupt ส่ง 0x03 และล้าง modifier ที่ค้างอยู่', () => {
    p.onBarKey(CTRL); p.onBarKey({ kind: 'interrupt' });
    expect(only()).toEqual([0x03]);
    expect(p.modifierState().ctrl).toBe(false);
  });
});
