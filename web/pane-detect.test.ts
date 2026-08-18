import { describe, expect, it } from 'vitest';
import {
  detectBorderColumns, panesFromBorders, paneContaining, nearestPane, type CellReader,
} from './pane-detect.js';

/** สร้าง CellReader จากอาร์เรย์ของสตริง — ตัวอักษรหนึ่งตัวต่อหนึ่งคอลัมน์ */
const grid = (rows: string[]): CellReader => (row, column) => rows[row]?.[column] ?? '';

/** จอ 20 แถว กว้าง 40 มีเส้นแบ่งที่คอลัมน์ 20 ตามจำนวนแถวที่สั่ง */
const withBorder = (borderRows: number, totalRows = 20): string[] =>
  Array.from({ length: totalRows }, (_, i) => {
    const left = 'left'.padEnd(20, ' ');
    return i < borderRows ? `${left}│right`.padEnd(40, ' ') : `${left} right`.padEnd(40, ' ');
  });

describe('detectBorderColumns', () => {
  it('เจอเส้นแบ่งที่ปรากฏทุกแถว', () => {
    expect(detectBorderColumns(grid(withBorder(20)), { rows: 20, columns: 40 })).toEqual([20]);
  });

  it('ทนต่อแถวที่เส้นขาดหายไปบ้าง แต่ไม่ทนเมื่อขาดเกินครึ่ง', () => {
    // 17/20 = 85% ผ่านเกณฑ์ 0.8
    expect(detectBorderColumns(grid(withBorder(17)), { rows: 20, columns: 40 })).toEqual([20]);
    // 12/20 = 60% ไม่ผ่าน
    expect(detectBorderColumns(grid(withBorder(12)), { rows: 20, columns: 40 })).toEqual([]);
  });

  it('ไม่นับแถวว่างเป็นตัวหาร', () => {
    const rows = Array.from({ length: 20 }, (_, i) => (i < 5 ? `${'a'.repeat(10)}│b` : ''));
    expect(detectBorderColumns(grid(rows), { rows: 20, columns: 40 })).toEqual([10]);
  });

  it('ปฏิเสธการเดาเมื่อมีแถวที่ไม่ว่างน้อยเกินไป', () => {
    const rows = Array.from({ length: 20 }, (_, i) => (i < 3 ? `${'a'.repeat(10)}│b` : ''));
    expect(detectBorderColumns(grid(rows), { rows: 20, columns: 40 })).toEqual([]);
  });

  it('ไม่หลงเครื่องหมาย | ที่อยู่ในเนื้อความ', () => {
    const rows = Array.from({ length: 20 }, (_, i) => (i < 2 ? 'a|b' : 'plain text'));
    expect(detectBorderColumns(grid(rows), { rows: 20, columns: 40 })).toEqual([]);
  });

  it('คืนเส้นแบ่งหลายเส้นเรียงจากซ้ายไปขวา', () => {
    const rows = Array.from({ length: 20 }, () => `${' '.repeat(20)}│${' '.repeat(29)}│x`);
    expect(detectBorderColumns(grid(rows), { rows: 20, columns: 60 })).toEqual([20, 50]);
  });

  it("อักษรกว้างที่คืน '' สำหรับเซลล์เติม ไม่ทำให้ดัชนีคอลัมน์เลื่อน", () => {
    // คอลัมน์ 0 เป็นอักษรกว้าง คอลัมน์ 1 เป็นเซลล์เติม เส้นแบ่งยังอยู่ที่ 4
    const read: CellReader = (_row, column) =>
      column === 0 ? '中' : column === 1 ? '' : column === 4 ? '│' : 'x';
    expect(detectBorderColumns(read, { rows: 20, columns: 40 })).toEqual([4]);
  });
});

describe('panesFromBorders', () => {
  it('แบ่งความกว้างออกเป็นสอง pane รอบเส้นแบ่ง', () => {
    expect(panesFromBorders([20], 80)).toEqual([{ start: 0, end: 19 }, { start: 21, end: 79 }]);
  });

  it('ไม่มีเส้นแบ่ง = pane เดียวเต็มความกว้าง', () => {
    expect(panesFromBorders([], 80)).toEqual([{ start: 0, end: 79 }]);
  });

  it('เส้นแบ่งชิดขอบไม่สร้าง pane ความกว้างศูนย์', () => {
    expect(panesFromBorders([0], 80)).toEqual([{ start: 1, end: 79 }]);
    expect(panesFromBorders([79], 80)).toEqual([{ start: 0, end: 78 }]);
  });

  it('เส้นแบ่งสองเส้นติดกันไม่สร้าง pane ความกว้างศูนย์ตรงกลาง', () => {
    expect(panesFromBorders([20, 21], 80)).toEqual([{ start: 0, end: 19 }, { start: 22, end: 79 }]);
  });
});

describe('paneContaining', () => {
  const panes = panesFromBorders([20], 80);

  it('คืน pane ที่คอลัมน์นั้นอยู่', () => {
    expect(paneContaining(panes, 5)).toEqual({ start: 0, end: 19 });
    expect(paneContaining(panes, 50)).toEqual({ start: 21, end: 79 });
  });

  it('คืน null เมื่อคอลัมน์นั้นคือตัวเส้นแบ่งเอง', () => {
    expect(paneContaining(panes, 20)).toBeNull();
  });
});

describe('nearestPane', () => {
  const panes = panesFromBorders([20], 80);

  it('คืน pane ที่คอลัมน์นั้นอยู่ เหมือน paneContaining', () => {
    expect(nearestPane(panes, 5)).toEqual({ start: 0, end: 19 });
  });

  it('จิ้มโดนเส้นแบ่งพอดี ยังได้ pane ไม่ใช่ null — เสมอกันเอาซ้าย', () => {
    expect(nearestPane(panes, 20)).toEqual({ start: 0, end: 19 });
  });

  it('เส้นแบ่งกว้างสองคอลัมน์: เลือกฝั่งที่ใกล้กว่า', () => {
    const wide = panesFromBorders([20, 21], 80);
    expect(nearestPane(wide, 20)).toEqual({ start: 0, end: 19 });
    expect(nearestPane(wide, 21)).toEqual({ start: 22, end: 79 });
  });

  it('ไม่มี pane เลย คืน null', () => {
    expect(nearestPane([], 5)).toBeNull();
  });
});
