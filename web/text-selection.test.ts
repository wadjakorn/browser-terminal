import { describe, expect, it, vi } from 'vitest';
import { createTextSelection, selectionMouseInit, type TerminalPort } from './text-selection.js';
import type { SelectionPrefs } from './selection-prefs.js';

const CELL_W = 10;
const CELL_H = 20;
const LEFT = 37;   // ตั้งใจไม่ใช่ 0 เพื่อดักการลืมบวก offset ของ element
const TOP = 11;

/**
 * จอจำลอง 6 แถว กว้าง 30 มี sidebar ซ้ายกว้าง 10 คอลัมน์ เส้นแบ่งที่คอลัมน์ 10
 * เหมือน herdr: `sideNNNNNN│content....`
 */
const SCREEN = [
  'side one  │left row one  right',
  'side two  │left row two  right',
  'side three│left row 3rd  right',
  'side four │left row four right',
  'side five │left row five right',
  'side six  │left row six  right',
];

interface FakeOpts {
  screen?: string[];
  viewportTop?: () => number;
  cellWidth?: number;
  prefs?: SelectionPrefs;
  onBlockChange?: (block: unknown) => void;
}

function fakeTerminal(opts: FakeOpts = {}) {
  const screen = opts.screen ?? SCREEN;
  const columns = Math.max(...screen.map(row => row.length));
  const dispatched: { type: string; x: number; y: number }[] = [];
  const clearSelection = vi.fn();
  const viewportTop = opts.viewportTop ?? (() => 100);

  const port: TerminalPort = {
    rows: screen.length,
    columns,
    viewportTop,
    readCell: (line, column) => screen[line - viewportTop()]?.[column] ?? '',
    readLine: (line, start, end) => (screen[line - viewportTop()] ?? '').slice(start, end + 1),
    screenMetrics: () => ({ cellWidth: opts.cellWidth ?? CELL_W, cellHeight: CELL_H, left: LEFT, top: TOP }),
    dispatchMouse: (type, x, y) => dispatched.push({ type, x, y }),
    clearSelection,
  };

  return { port, dispatched, clearSelection };
}

const at = (column: number, row: number): [number, number] =>
  [LEFT + column * CELL_W + CELL_W / 2, TOP + row * CELL_H + CELL_H / 2];

function build(opts: FakeOpts = {}) {
  const fake = fakeTerminal(opts);
  const onRegionPicked = vi.fn();
  const onModeChange = vi.fn();
  const loadPrefs = vi.fn(() => opts.prefs ?? { manualBounds: null, columns: 0 });

  const selection = createTextSelection({
    terminal: fake.port, loadPrefs, onRegionPicked, onModeChange, onBlockChange: opts.onBlockChange,
  });
  return { ...fake, selection, onRegionPicked, onModeChange, loadPrefs };
}

describe('โหมดเลือก', () => {
  it('toggle สลับสถานะและแจ้งทั้งขาเข้าและขาออก', () => {
    const { selection, onModeChange } = build();
    expect(selection.active()).toBe(false);

    selection.toggle();
    expect(selection.active()).toBe(true);
    expect(onModeChange).toHaveBeenLastCalledWith(true);

    selection.toggle();
    expect(selection.active()).toBe(false);
    expect(onModeChange).toHaveBeenLastCalledWith(false);
  });

  it('ตรวจ pane ตอน toggle ไม่ใช่ตอนสร้าง และตรวจใหม่ทุกครั้งที่เข้าโหมด', () => {
    const { selection } = build();
    expect(selection.activePanes()).toEqual([]);

    selection.toggle();
    // sidebar 0-9, เส้นแบ่งที่ 10, เนื้อหา 11-29
    expect(selection.activePanes()).toEqual([{ start: 0, end: 9 }, { start: 11, end: 29 }]);

    selection.toggle();
    selection.toggle();
    expect(selection.activePanes()).toEqual([{ start: 0, end: 9 }, { start: 11, end: 29 }]);
  });

  it('นิ้วไม่ทำอะไรเลยเมื่อยังไม่เข้าโหมด', () => {
    const { selection, dispatched } = build();
    selection.pointerDown(...at(5, 0));
    selection.pointerMove(...at(20, 3));
    selection.pointerUp(...at(20, 3));
    expect(dispatched).toEqual([]);
  });

  it('pointerMove/pointerUp ที่ไม่มี pointerDown นำหน้า ไม่ throw และไม่ยิงอะไร', () => {
    const { selection, dispatched, onRegionPicked } = build();
    selection.toggle();
    expect(() => { selection.pointerMove(...at(3, 1)); selection.pointerUp(...at(3, 1)); }).not.toThrow();
    expect(dispatched).toEqual([]);
    expect(onRegionPicked).not.toHaveBeenCalled();
  });

  it('ปล่อยนิ้วจบการลากแล้วเข้าโหมดปรับ ไม่ส่งข้อความออกไป', () => {
    const seen: unknown[] = [];
    const { selection, onRegionPicked } = build({ onBlockChange: b => seen.push(b) });
    selection.toggle();
    selection.pointerDown(...at(12, 1));
    selection.pointerUp(...at(20, 3));
    expect(onRegionPicked).not.toHaveBeenCalled();
    expect(selection.state()).toBe('adjusting');
    expect(selection.currentBlock()).toEqual({ topLine: 101, bottomLine: 103, startColumn: 12, endColumn: 20 });
    expect(seen.at(-1)).toEqual(selection.currentBlock());
  });

  it('ลากหมุด start เปลี่ยนเฉพาะมุมบนซ้าย', () => {
    const { selection } = build();
    selection.toggle();
    selection.pointerDown(...at(14, 2));
    selection.pointerUp(...at(20, 4));
    selection.beginHandleDrag('start');
    selection.pointerMove(...at(12, 1));
    selection.pointerUp(...at(12, 1));
    expect(selection.currentBlock()).toEqual({ topLine: 101, bottomLine: 104, startColumn: 12, endColumn: 20 });
  });

  it('ลากหมุด end เปลี่ยนเฉพาะมุมล่างขวา', () => {
    const { selection } = build();
    selection.toggle();
    selection.pointerDown(...at(14, 2));
    selection.pointerUp(...at(20, 4));
    selection.beginHandleDrag('end');
    selection.pointerMove(...at(24, 5));
    selection.pointerUp(...at(24, 5));
    expect(selection.currentBlock()).toEqual({ topLine: 102, bottomLine: 105, startColumn: 14, endColumn: 24 });
  });

  it('ลากหมุดข้ามอีกมุมไป กรอบพลิกโดยไม่ค้าง', () => {
    const { selection } = build();
    selection.toggle();
    selection.pointerDown(...at(14, 2));
    selection.pointerUp(...at(20, 4));
    selection.beginHandleDrag('start');
    selection.pointerMove(...at(26, 5));
    selection.pointerUp(...at(26, 5));
    const block = selection.currentBlock()!;
    expect(block.topLine).toBeLessThanOrEqual(block.bottomLine);
    expect(block.startColumn).toBeLessThanOrEqual(block.endColumn);
    expect(block).toEqual({ topLine: 104, bottomLine: 105, startColumn: 20, endColumn: 26 });
  });

  it('แตะที่ terminal ขณะปรับ = เริ่มกรอบใหม่ ทิ้งกรอบเดิม', () => {
    const { selection } = build();
    selection.toggle();
    selection.pointerDown(...at(14, 2));
    selection.pointerUp(...at(20, 4));
    selection.pointerDown(...at(22, 0));
    selection.pointerUp(...at(24, 1));
    expect(selection.currentBlock()).toEqual({ topLine: 100, bottomLine: 101, startColumn: 22, endColumn: 24 });
  });

  it('confirm ส่งข้อความออกไปแต่ยังอยู่ในโหมด', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();
    selection.pointerDown(...at(12, 1));
    selection.pointerUp(...at(20, 2));
    selection.confirm();
    expect(onRegionPicked).toHaveBeenCalledTimes(1);
    // at(12, ...) เริ่มที่คอลัมน์ 12 ไม่ใช่ 11 ('left' ขึ้นต้นที่คอลัมน์ 11) จึงได้ 'eft row'
    expect(onRegionPicked.mock.calls[0]![0]).toContain('eft row');
    expect(selection.active()).toBe(true);
    expect(selection.state()).toBe('adjusting');
  });

  it('กรอบที่คลุมแต่ช่องว่างยังอยู่ให้ปรับต่อ ไม่ถูกล้างทิ้ง', () => {
    const { selection, clearSelection } = build({ screen: ['          │              ', '          │              '] });
    selection.toggle();
    selection.pointerDown(...at(12, 0));
    selection.pointerUp(...at(18, 1));
    expect(selection.state()).toBe('adjusting');
    expect(selection.currentBlock()).not.toBeNull();
    expect(selection.blockHasText()).toBe(false);
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it('blockRect คืน null เมื่อไม่มีกรอบ และครอบเซลล์เต็มใบทั้งสองมุม', () => {
    const { selection } = build();
    expect(selection.blockRect()).toBeNull();
    selection.toggle();
    selection.pointerDown(...at(12, 1));
    selection.pointerUp(...at(20, 3));
    // at() คืนจุดกลางเซลล์ ขอบกรอบจึงห่างจากจุดนั้นครึ่งเซลล์ทั้งสองด้าน
    expect(selection.blockRect()).toEqual({
      left: LEFT + 12 * CELL_W,
      top: TOP + 1 * CELL_H,
      right: LEFT + 21 * CELL_W,
      bottom: TOP + 4 * CELL_H,
    });
  });

  it('การลากหมุดยังตรึงคอลัมน์ไว้ใน pane เดิม', () => {
    const { selection } = build();
    selection.toggle();
    selection.pointerDown(...at(2, 1));   // ใน sidebar ซ้ายของเส้นแบ่งที่คอลัมน์ 10
    selection.pointerUp(...at(6, 2));
    selection.beginHandleDrag('end');
    selection.pointerMove(...at(25, 3));  // ลากข้ามเส้นแบ่งไปฝั่งขวา
    selection.pointerUp(...at(25, 3));
    expect(selection.currentBlock()!.endColumn).toBeLessThan(10);
  });
});

describe('การตัด sidebar ออกจากผลลัพธ์', () => {
  it('เริ่มลากในเนื้อหา แล้วลากทะลุไปฝั่ง sidebar — ได้เฉพาะเนื้อหา ไม่มีเส้นแบ่ง', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(11, 0));
    selection.pointerMove(...at(0, 2));    // ลากทะลุเส้นแบ่งไปถึงคอลัมน์ 0
    selection.pointerUp(...at(0, 2));
    selection.confirm();

    const text = onRegionPicked.mock.calls[0]![0] as string;
    expect(text).not.toContain('│');
    expect(text).not.toContain('side');
    expect(text.split('\n')).toEqual(['l', 'l', 'l']);
  });

  it('เริ่มลากในเนื้อหาแล้วลากไปทางขวา ได้ข้อความเนื้อหาเต็มบรรทัด', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(11, 0));
    selection.pointerMove(...at(29, 1));
    selection.pointerUp(...at(29, 1));
    selection.confirm();

    expect(onRegionPicked).toHaveBeenCalledWith('left row one  right\nleft row two  right');
  });

  it('เริ่มลากใน sidebar แล้วลากไปทางขวา — ได้เฉพาะ sidebar', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(0, 0));
    selection.pointerMove(...at(29, 2));
    selection.pointerUp(...at(29, 2));
    selection.confirm();

    expect(onRegionPicked).toHaveBeenCalledWith('side one\nside two\nside three');
  });

  it('จิ้มโดนเส้นแบ่งพอดี ยังได้ pane จริง ไม่ตกไปใช้เต็มความกว้าง', () => {
    const { selection, dispatched, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(10, 0));   // คอลัมน์ 10 คือตัวเส้นแบ่งเอง
    selection.pointerMove(...at(29, 2));
    selection.pointerUp(...at(29, 2));
    selection.confirm();

    // เสมอกันเอา pane ซ้าย จุดยึดจึงถูกตรึงมาที่คอลัมน์ 9 ไม่ใช่ค้างที่ 10
    const backToColumn = (x: number) => Math.floor((x - LEFT) / CELL_W);
    expect(backToColumn(dispatched[0]!.x)).toBe(9);
    expect(backToColumn(dispatched[2]!.x)).toBe(9);
    expect(onRegionPicked.mock.calls[0]![0]).not.toContain('│');
  });

  it('ลากตรงดิ่งคอลัมน์เดียว ได้ข้อความหนึ่งคอลัมน์ ไม่ใช่สตริงว่าง', () => {
    // นี่คือเคสที่ selectionText ของ xterm เองคืน '' — เหตุผลที่เราดึงข้อความเอง
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(11, 0));
    selection.pointerMove(...at(11, 2));
    selection.pointerUp(...at(11, 2));
    selection.confirm();

    expect(onRegionPicked).toHaveBeenCalledWith('l\nl\nl');
  });
});

describe('พิกัดที่ส่งให้ xterm', () => {
  it('ตำแหน่งที่ถูกตรึงแล้วต้องแปลงกลับได้เป็นคอลัมน์เดิม แม้ element จะไม่ได้อยู่ชิดขอบซ้าย', () => {
    const { selection, dispatched } = build();
    selection.toggle();

    selection.pointerDown(...at(15, 0));
    selection.pointerMove(...at(0, 0));    // ขอให้ไปคอลัมน์ 0 แต่ต้องถูกตรึงที่ 11
    selection.pointerUp(...at(0, 0));

    const backToColumn = (x: number) => Math.floor((x - LEFT) / CELL_W);
    expect(dispatched.map(event => event.type)).toEqual(['mousedown', 'mousemove', 'mouseup']);
    expect(backToColumn(dispatched[0]!.x)).toBe(15);
    expect(backToColumn(dispatched[1]!.x)).toBe(11);
    expect(backToColumn(dispatched[2]!.x)).toBe(11);
  });

  it('นิ้วที่หลุดขอบล่างและขอบบนถูกตรึงอยู่ในจอ', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(LEFT + 115, TOP - 500);   // เหนือแถวแรก
    selection.pointerUp(LEFT + 115, TOP + 5000);    // ใต้แถวสุดท้าย
    selection.confirm();

    // ได้ทั้ง 6 แถวพอดี ไม่ใช่บรรทัดที่ไม่มีอยู่จริง
    expect((onRegionPicked.mock.calls[0]![0] as string).split('\n')).toHaveLength(6);
  });

  it('วัดขนาดเซลล์ไม่ได้ = ไม่เริ่มลาก แทนที่จะยิงพิกัด NaN', () => {
    const { selection, dispatched } = build({ cellWidth: 0 });
    selection.toggle();
    selection.pointerDown(...at(2, 0));
    expect(dispatched).toEqual([]);
  });

  it('viewport เลื่อนระหว่างลาก จุดยึดยังหมายถึงบรรทัดสัมบูรณ์เดิม', () => {
    let top = 100;
    const { selection, onRegionPicked } = build({ viewportTop: () => top });
    selection.toggle();

    selection.pointerDown(...at(11, 0));
    top = 100;   // อ่านเนื้อหาเดิม แต่ยืนยันว่า anchor ถูกเก็บเป็นเลขสัมบูรณ์
    selection.pointerUp(...at(29, 0));
    selection.confirm();

    expect(onRegionPicked).toHaveBeenCalledWith('left row one  right');
  });
});

describe('ทางสำรองเมื่อตรวจไม่เจอเส้นแบ่ง', () => {
  const plain = ['aaaa bbbb', 'cccc dddd', 'eeee ffff', 'gggg hhhh', 'iiii jjjj'];

  it('ใช้ขอบที่ผู้ใช้เคยลากเองเมื่อมี', () => {
    const { selection } = build({ screen: plain, prefs: { manualBounds: { start: 5, end: 8 }, columns: 9 } });
    selection.toggle();
    expect(selection.activePanes()).toEqual([{ start: 5, end: 8 }]);
  });

  it('ไม่มีทั้งเส้นแบ่งและค่าที่จำไว้ = เต็มความกว้าง', () => {
    const { selection } = build({ screen: plain });
    selection.toggle();
    expect(selection.activePanes()).toEqual([{ start: 0, end: 8 }]);
  });
});

describe('การล้างสถานะ', () => {
  it('cancel ล้างไฮไลต์และออกจากโหมด', () => {
    const { selection, clearSelection } = build();
    selection.toggle();
    selection.cancel();

    expect(selection.active()).toBe(false);
    expect(clearSelection).toHaveBeenCalled();
  });

  it('เลือกได้แต่ข้อความว่าง: ไม่เปิดแผ่นผลลัพธ์ ไม่ล้างไฮไลต์ ยังอยู่ในโหมดปรับ', () => {
    const blank = ['     ', '     ', '     ', '     ', '     '];
    const { selection, onRegionPicked, clearSelection } = build({ screen: blank });
    selection.toggle();

    selection.pointerDown(...at(0, 0));
    selection.pointerUp(...at(4, 2));

    expect(onRegionPicked).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(selection.active()).toBe(true);
    expect(selection.state()).toBe('adjusting');
  });
});

describe('ธงบน mouse event สังเคราะห์', () => {
  it('detail ต้องเป็น 1 — ขาดไปแล้ว xterm จะไม่เลือกอะไรเลยแบบเงียบๆ', () => {
    // SelectionService.handleMouseDown แยกทางด้วย `1===e.detail ? _handleSingleClick : ...`
    // new MouseEvent() ที่ไม่ระบุ detail ได้ 0 ซึ่งไม่เข้าสาขาไหน ผลคือไม่มีไฮไลต์และ
    // ไม่มี error ให้เห็น ยืนยันด้วยการวัดจริงในเบราว์เซอร์แล้ว
    expect(selectionMouseInit('mousedown', 10, 20).detail).toBe(1);
  });

  it('shiftKey + altKey ต้องมีครบทั้งคู่ทุก event', () => {
    for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
      const init = selectionMouseInit(type, 1, 2);
      expect(init.shiftKey).toBe(true);   // shouldForceSelection บนเครื่องที่ไม่ใช่ Mac
      expect(init.altKey).toBe(true);     // shouldColumnSelect + shouldForceSelection บน iPad
      expect(init.button).toBe(0);        // handleMouseDown ตรวจ 0===e.button
    }
  });

  it('buttons เป็น 1 ตอนกดค้าง และ 0 ตอนปล่อย', () => {
    expect(selectionMouseInit('mousedown', 1, 2).buttons).toBe(1);
    expect(selectionMouseInit('mousemove', 1, 2).buttons).toBe(1);
    expect(selectionMouseInit('mouseup', 1, 2).buttons).toBe(0);
  });

  it('ส่งพิกัดต่อไปตรงตัว', () => {
    expect(selectionMouseInit('mousemove', 37.5, 91.5)).toMatchObject({ clientX: 37.5, clientY: 91.5 });
  });
});
