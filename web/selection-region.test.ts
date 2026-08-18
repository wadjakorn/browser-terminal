import { describe, expect, it, vi } from 'vitest';
import { blockFrom, clampColumn, extractText, type LineReader } from './selection-region.js';

/** LineReader จากอาร์เรย์ของบรรทัด — index คือหมายเลขบรรทัดสัมบูรณ์ */
const lines = (rows: Record<number, string>): LineReader =>
  (line, startColumn, endColumn) => (rows[line] ?? '').slice(startColumn, endColumn + 1);

describe('blockFrom', () => {
  const expected = { topLine: 5, bottomLine: 9, startColumn: 3, endColumn: 12 };

  it('ลากไปทางไหนก็ได้กรอบเดียวกัน', () => {
    expect(blockFrom({ line: 5, column: 3 }, { line: 9, column: 12 })).toEqual(expected);
    expect(blockFrom({ line: 9, column: 12 }, { line: 5, column: 3 })).toEqual(expected);
    expect(blockFrom({ line: 5, column: 12 }, { line: 9, column: 3 })).toEqual(expected);
    expect(blockFrom({ line: 9, column: 3 }, { line: 5, column: 12 })).toEqual(expected);
  });

  it('แตะจุดเดียวได้กรอบ 1×1 ไม่ใช่กรอบว่าง', () => {
    // เคสนี้คือเคสที่ selectionText ของ xterm เองคืนสตริงว่าง
    expect(blockFrom({ line: 4, column: 7 }, { line: 4, column: 7 }))
      .toEqual({ topLine: 4, bottomLine: 4, startColumn: 7, endColumn: 7 });
  });
});

describe('clampColumn', () => {
  const pane = { start: 10, end: 20 };

  it('ตรึงค่าที่หลุดขอบซ้ายและขวา', () => {
    expect(clampColumn(3, pane)).toBe(10);
    expect(clampColumn(99, pane)).toBe(20);
    expect(clampColumn(15, pane)).toBe(15);
  });

  it('pane เป็น null คือไม่ตรึงอะไรเลย', () => {
    expect(clampColumn(99, null)).toBe(99);
  });
});

describe('extractText', () => {
  it('ต่อบรรทัดด้วย \\n และขอเฉพาะช่วงคอลัมน์ที่สั่ง', () => {
    const read = vi.fn(lines({ 0: 'left │ right', 1: 'aaaa │ bbbb' }));
    const text = extractText({ topLine: 0, bottomLine: 1, startColumn: 0, endColumn: 3 }, read);

    expect(text).toBe('left\naaaa');
    expect(read).toHaveBeenCalledWith(0, 0, 3);
    expect(read).toHaveBeenCalledWith(1, 0, 3);
  });

  it('ตัดช่องว่างท้ายบรรทัดแต่ไม่แตะการเยื้องหน้าบรรทัด', () => {
    const read = lines({ 0: '  indented   ', 1: 'a  b   ' });
    const text = extractText({ topLine: 0, bottomLine: 1, startColumn: 0, endColumn: 12 }, read);
    expect(text).toBe('  indented\na  b');
  });

  it('ปิด trimTrailing แล้วช่องว่างท้ายบรรทัดยังอยู่', () => {
    const read = lines({ 0: 'a  ' });
    const block = { topLine: 0, bottomLine: 0, startColumn: 0, endColumn: 2 };
    expect(extractText(block, read, { trimTrailing: false })).toBe('a  ');
  });

  it('บรรทัดเดียวไม่มี \\n ต่อท้าย', () => {
    const read = lines({ 7: 'hello' });
    expect(extractText({ topLine: 7, bottomLine: 7, startColumn: 0, endColumn: 4 }, read)).toBe('hello');
  });

  it('กรอบที่ว่างทั้งหมดคืนสตริงว่าง ไม่ใช่กอง \\n', () => {
    const read = lines({ 0: '   ', 1: '   ', 2: '   ' });
    expect(extractText({ topLine: 0, bottomLine: 2, startColumn: 0, endColumn: 2 }, read)).toBe('');
  });

  it('ทิ้งบรรทัดว่างท้ายกรอบ แต่เก็บบรรทัดว่างที่อยู่ตรงกลาง', () => {
    const read = lines({ 0: 'a', 1: '', 2: 'b', 3: '', 4: '' });
    const text = extractText({ topLine: 0, bottomLine: 4, startColumn: 0, endColumn: 0 }, read);
    expect(text).toBe('a\n\nb');
  });
});
