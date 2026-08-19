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
    terminal: fake.port, loadPrefs, onRegionPicked, onModeChange,
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
});

describe('การตัด sidebar ออกจากผลลัพธ์', () => {
  it('เริ่มลากในเนื้อหา แล้วลากทะลุไปฝั่ง sidebar — ได้เฉพาะเนื้อหา ไม่มีเส้นแบ่ง', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(11, 0));
    selection.pointerMove(...at(0, 2));    // ลากทะลุเส้นแบ่งไปถึงคอลัมน์ 0
    selection.pointerUp(...at(0, 2));

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

    expect(onRegionPicked).toHaveBeenCalledWith('left row one  right\nleft row two  right');
  });

  it('เริ่มลากใน sidebar แล้วลากไปทางขวา — ได้เฉพาะ sidebar', () => {
    const { selection, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(0, 0));
    selection.pointerMove(...at(29, 2));
    selection.pointerUp(...at(29, 2));

    expect(onRegionPicked).toHaveBeenCalledWith('side one\nside two\nside three');
  });

  it('จิ้มโดนเส้นแบ่งพอดี ยังได้ pane จริง ไม่ตกไปใช้เต็มความกว้าง', () => {
    const { selection, dispatched, onRegionPicked } = build();
    selection.toggle();

    selection.pointerDown(...at(10, 0));   // คอลัมน์ 10 คือตัวเส้นแบ่งเอง
    selection.pointerMove(...at(29, 2));
    selection.pointerUp(...at(29, 2));

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

  it('เลือกได้แต่ข้อความว่าง: ไม่เปิดแผ่นผลลัพธ์ ล้างไฮไลต์ และยังอยู่ในโหมด', () => {
    const blank = ['     ', '     ', '     ', '     ', '     '];
    const { selection, onRegionPicked, clearSelection } = build({ screen: blank });
    selection.toggle();

    selection.pointerDown(...at(0, 0));
    selection.pointerUp(...at(4, 2));

    expect(onRegionPicked).not.toHaveBeenCalled();
    expect(clearSelection).toHaveBeenCalled();
    expect(selection.active()).toBe(true);
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
