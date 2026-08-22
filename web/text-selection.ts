/**
 * โหมดเลือกข้อความ — ตัวประสานระหว่างนิ้ว, การตรวจ pane และ xterm
 *
 * ─── ทำไมต้องมีโหมด ───
 * herdr และ tmux เปิด mouse reporting ไว้ ระหว่างนั้น xterm จะส่ง pointer event ต่อ
 * ให้แอปข้างในแทนที่จะเลือกข้อความเอง ทางหนีปกติคือกด Shift ค้าง (หรือ Alt เพื่อเลือก
 * แบบคอลัมน์) ซึ่งบนจอสัมผัสไม่มี — จึงต้องมีโหมดที่ดักนิ้วไว้ก่อนถึง xterm
 *
 * ─── xterm ทำอะไรให้เราแล้วบ้าง ───
 * เยอะกว่าที่คิด: มันมีโหมดเลือกแบบคอลัมน์อยู่แล้ว (`shouldColumnSelect` = altKey)
 * และมีทางบังคับให้เลือกได้ทั้งที่ mouse reporting เปิดอยู่ (`shouldForceSelection`
 * = shiftKey บนเครื่องที่ไม่ใช่ Mac) และ DOM renderer ก็วาดไฮไลต์ทรงบล็อกให้เอง
 * เราจึงแค่ยิง mouse event สังเคราะห์ที่ติดธงทั้งสอง ไม่ต้องวาดไฮไลต์เอง
 *
 * ─── สิ่งที่ xterm ไม่ทำให้ ───
 * มันไม่รู้ว่า pane อยู่ตรงไหน บนมือถือผู้ใช้เล็งคอลัมน์ไม่ได้ เราจึงตรึงตำแหน่งนิ้ว
 * ให้อยู่ใน pane ที่เริ่มลาก *ก่อน* ส่งให้ xterm — ไฮไลต์ที่เห็นจึงตรงกับข้อความที่
 * จะได้จริงเสมอ และเราดึงข้อความเองเพื่อให้ผลลัพธ์เหมือนกันทุกแพลตฟอร์ม (ดู
 * selection-region.ts)
 */

import {
  detectBorderColumns,
  nearestPane,
  panesFromBorders,
  type CellReader,
  type PaneBounds,
} from './pane-detect.js';
import { blockFrom, clampColumn, extractText, type Block, type Cell } from './selection-region.js';
import type { SelectionPrefs } from './selection-prefs.js';

/**
 * ค่า MouseEventInit ของ event สังเคราะห์ที่ใช้ขับ selection ของ xterm
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพราะทุกฟิลด์ในนี้เป็นเงื่อนไขที่ xterm ตรวจจริง และ
 * ขาดไปตัวเดียวก็เงียบสนิทโดยไม่มี error ให้เห็น:
 *
 * - `detail: 1` — SelectionService.handleMouseDown แยกทางด้วยจำนวนคลิก
 *   (`1===e.detail ? _handleSingleClick : 2===e.detail ? _handleDoubleClick : ...`)
 *   `new MouseEvent()` ที่ไม่ระบุ detail จะได้ 0 ซึ่งไม่เข้าสาขาไหนเลย ผลคือไม่มี
 *   การเลือกเกิดขึ้นและไม่มีไฮไลต์ ทั้งที่ event ถูกส่งถึงและผ่านด่านอื่นครบแล้ว
 * - `shiftKey` — ทำให้ shouldForceSelection เป็นจริงบนเครื่องที่ไม่ใช่ Mac ซึ่งเป็น
 *   ทางเดียวที่จะเลือกได้ขณะ mouse reporting เปิดอยู่
 * - `altKey` — ทำให้ shouldColumnSelect เป็นจริง (โหมดเลือกแบบคอลัมน์) และทำให้
 *   shouldForceSelection เป็นจริงบน iPad
 * - `button: 0` — handleMouseDown ตรวจ `0===e.button` ตรงๆ
 * - `buttons: 1` ระหว่างกดอยู่ — ต้องมีบน mousemove ด้วย ไม่ใช่แค่ mousedown
 */
export function selectionMouseInit(
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number,
): MouseEventInit {
  return {
    clientX, clientY,
    bubbles: true, cancelable: true,
    detail: 1,
    shiftKey: true, altKey: true,
    button: 0, buttons: type === 'mouseup' ? 0 : 1,
  };
}

export interface TerminalPort {
  rows: number;
  columns: number;
  /** บรรทัดบนสุดของ viewport ในพิกัด buffer สัมบูรณ์ */
  viewportTop(): number;
  readCell(line: number, column: number): string;
  /** endColumn เป็น inclusive */
  readLine(line: number, startColumn: number, endColumn: number): string;
  /** ขนาดเซลล์จริงบนจอ และมุมซ้ายบนของพื้นที่จอในพิกัด viewport ของเบราว์เซอร์ */
  screenMetrics(): { cellWidth: number; cellHeight: number; left: number; top: number };
  /** ยิง mouse event สังเคราะห์เข้า xterm เพื่อให้มันวาดไฮไลต์ให้ */
  dispatchMouse(type: 'mousedown' | 'mousemove' | 'mouseup', clientX: number, clientY: number): void;
  clearSelection(): void;
}

export interface TextSelectionDeps {
  terminal: TerminalPort;
  loadPrefs: (columns: number) => SelectionPrefs;
  onRegionPicked: (text: string) => void;
  onModeChange: (active: boolean) => void;
  vibrate?: (ms: number) => void;
  /** ยิงทุกครั้งที่กรอบเปลี่ยนหรือหาย — main.ts ใช้ขยับหมุดตาม */
  onBlockChange?: (block: Block | null) => void;
}

export type SelectionState = 'off' | 'idle' | 'dragging' | 'adjusting' | 'grabbing';

interface Drag {
  anchor: Cell;
  pane: PaneBounds | null;
  focus: Cell;
}

export function createTextSelection(deps: TextSelectionDeps) {
  const { terminal } = deps;

  let modeActive = false;
  let panes: PaneBounds[] = [];
  let drag: Drag | null = null;
  let block: Block | null = null;
  let phase: SelectionState = 'off';

  const setBlock = (next: Block | null): void => {
    block = next;
    deps.onBlockChange?.(next);
  };

  const detectPanes = (): PaneBounds[] => {
    const top = terminal.viewportTop();
    const read: CellReader = (row, column) => terminal.readCell(top + row, column);
    const borders = detectBorderColumns(read, { rows: terminal.rows, columns: terminal.columns });

    if (borders.length > 0) return panesFromBorders(borders, terminal.columns);

    // ตรวจไม่เจอเส้น — เช่น pane ที่แบ่งด้วยสีพื้นหลัง ค่อยใช้ขอบที่ผู้ใช้เคยลากเอง
    const manual = deps.loadPrefs(terminal.columns).manualBounds;
    return manual ? [manual] : panesFromBorders([], terminal.columns);
  };

  /** px (พิกัด viewport) → เซลล์ พร้อมตรึงไม่ให้หลุดจอ */
  const cellAt = (clientX: number, clientY: number): Cell | null => {
    const { cellWidth, cellHeight, left, top } = terminal.screenMetrics();
    // วัดขนาดไม่ได้ (ยังไม่วาดเฟรมแรก) — คำนวณต่อจะได้ Infinity/NaN ไม่ยอมเริ่มลากดีกว่า
    if (!(cellWidth > 0) || !(cellHeight > 0)) return null;

    const column = Math.min(terminal.columns - 1, Math.max(0, Math.floor((clientX - left) / cellWidth)));
    const row = Math.min(terminal.rows - 1, Math.max(0, Math.floor((clientY - top) / cellHeight)));
    return { line: terminal.viewportTop() + row, column };
  };

  /**
   * เซลล์ → px กลางเซลล์ ในพิกัด viewport
   *
   * ต้องบวก `left` เพราะ mouse event สังเคราะห์ใช้ `clientX` และ xterm แปลงกลับด้วย
   * bounding rect ของ element ลืมบวกแล้วจะ "เลือกผิด pane" โดยไม่มี error ให้เห็น
   * และต้องอ่าน rect สดทุกครั้ง เพราะแถบปุ่มที่กางออกและคีย์บอร์ดที่โผล่ขึ้นมาย้ายมันได้
   */
  const pixelAt = (cell: Cell): { x: number; y: number } => {
    const { cellWidth, cellHeight, left, top } = terminal.screenMetrics();
    const row = cell.line - terminal.viewportTop();
    return {
      x: left + cell.column * cellWidth + cellWidth / 2,
      y: top + row * cellHeight + cellHeight / 2,
    };
  };

  /**
   * จบการลาก = เข้าโหมดปรับ ไม่ใช่จบงาน
   *
   * บนจอมือถือการลากครั้งเดียวให้ตรงเป๊ะเป็นไปไม่ได้ ก่อนหน้านี้ลากพลาดแปลว่าต้อง
   * ปิดแผ่น ออกจากโหมด แล้วเริ่มใหม่ทั้งหมด
   *
   * กรอบที่ดึงข้อความไม่ได้ก็ไม่ล้างทิ้ง — ผู้ใช้ลากหมุดต่อจนโดนข้อความได้เลย
   * ปุ่มคัดลอกที่ disabled คือคำบอกที่พอแล้ว
   */
  const finish = (): void => {
    if (!drag) return;
    setBlock(blockFrom(drag.anchor, drag.focus));
    drag = null;
    phase = 'adjusting';
  };

  const setMode = (next: boolean): void => {
    if (modeActive === next) return;
    modeActive = next;
    drag = null;
    setBlock(null);
    phase = next ? 'idle' : 'off';
    if (next) {
      // ตรวจใหม่ทุกครั้งที่เข้าโหมด ไม่ใช่ครั้งเดียวตอนสร้าง — ผู้ใช้ย่อ/ขยาย sidebar
      // ระหว่างการใช้สองครั้งได้เสมอ และค่าที่ค้างไว้จะผิดโดยไม่มีอะไรฟ้อง
      panes = detectPanes();
      deps.vibrate?.(10);
    } else {
      terminal.clearSelection();
    }
    deps.onModeChange(modeActive);
  };

  return {
    toggle(): void { setMode(!modeActive); },
    active(): boolean { return modeActive; },
    activePanes(): readonly PaneBounds[] { return panes; },

    pointerDown(clientX: number, clientY: number): void {
      if (!modeActive) return;
      const cell = cellAt(clientX, clientY);
      if (!cell) return;

      // nearestPane ไม่ใช่ paneContaining: นิ้วจิ้มโดนเส้นแบ่งพอดีเป็นเรื่องปกติบนมือถือ
      // ถ้าปล่อยให้เป็น null แล้วตกไปใช้เต็มความกว้าง ผู้ใช้จะได้เส้นแบ่งติดมาโดยไม่รู้ตัว
      const pane = nearestPane(panes, cell.column);
      const anchor: Cell = { line: cell.line, column: clampColumn(cell.column, pane) };
      setBlock(null);
      phase = 'dragging';
      drag = { anchor, pane, focus: anchor };

      const px = pixelAt(anchor);
      terminal.dispatchMouse('mousedown', px.x, px.y);
    },

    pointerMove(clientX: number, clientY: number): void {
      if (!modeActive || !drag) return;
      const cell = cellAt(clientX, clientY);
      if (!cell) return;

      drag.focus = { line: cell.line, column: clampColumn(cell.column, drag.pane) };
      const px = pixelAt(drag.focus);
      terminal.dispatchMouse('mousemove', px.x, px.y);
    },

    pointerUp(clientX: number, clientY: number): void {
      if (!modeActive || !drag) return;
      const cell = cellAt(clientX, clientY);
      if (cell) drag.focus = { line: cell.line, column: clampColumn(cell.column, drag.pane) };

      const px = pixelAt(drag.focus);
      terminal.dispatchMouse('mouseup', px.x, px.y);
      finish();
    },

    cancel(): void { setMode(false); },

    state(): SelectionState { return phase; },
    currentBlock(): Block | null { return block; },

    /**
     * จับหมุด = ลากต่อจากมุมตรงข้าม
     *
     * blockFrom() คำนวณ min/max อยู่แล้ว การลากข้ามอีกมุมไปจึงพลิกกรอบให้เองถูกต้อง
     * โดยไม่ต้องมีสาขาแยก
     *
     * pane ต้องมาจากมุมที่ตรึงไว้ ไม่ใช่ null — ถ้าเป็น null clampColumn() กลายเป็น
     * no-op แล้วการลากหมุดจะดึงเส้นแบ่ง pane ติดมา ซึ่งคือปัญหาที่ทั้งไฟล์นี้แก้อยู่
     */
    beginHandleDrag(corner: 'start' | 'end'): void {
      if (!block) return;
      const anchor: Cell = corner === 'start'
        ? { line: block.bottomLine, column: block.endColumn }
        : { line: block.topLine, column: block.startColumn };
      const focus: Cell = corner === 'start'
        ? { line: block.topLine, column: block.startColumn }
        : { line: block.bottomLine, column: block.endColumn };
      drag = { anchor, pane: nearestPane(panes, anchor.column), focus };
      phase = 'grabbing';
      deps.vibrate?.(10);

      const px = pixelAt(anchor);
      terminal.dispatchMouse('mousedown', px.x, px.y);
      const focusPx = pixelAt(focus);
      terminal.dispatchMouse('mousemove', focusPx.x, focusPx.y);
    },

    /**
     * ไม่ clamp ให้อยู่ในจอโดยตั้งใจ — คืนพิกัดจริงแม้ติดลบหรือเกินความสูง
     * ถ้า clamp ตรงนี้ หมุดจะไปเกาะขอบจอแล้วผู้ใช้เข้าใจว่ากรอบสิ้นสุดตรงนั้น
     * แล้วลากต่อจากตำแหน่งที่ผิด selection-handles.ts เป็นคนตัดสินว่าจะซ่อนอันไหน
     */
    blockRect() {
      if (!block) return null;
      const { cellWidth, cellHeight } = terminal.screenMetrics();
      const topLeft = pixelAt({ line: block.topLine, column: block.startColumn });
      const bottomRight = pixelAt({ line: block.bottomLine, column: block.endColumn });
      return {
        left: topLeft.x - cellWidth / 2,
        top: topLeft.y - cellHeight / 2,
        right: bottomRight.x + cellWidth / 2,
        bottom: bottomRight.y + cellHeight / 2,
      };
    },

    /** กรอบที่คลุมแต่ช่องว่างดึงข้อความไม่ได้ — ปุ่มคัดลอกต้องดับ ไม่ใช่กดแล้วเงียบ */
    blockHasText(): boolean {
      return block !== null && extractText(block, terminal.readLine) !== '';
    },

    /**
     * ไม่ออกจากโหมดตรงนี้ — setMode(false) จะเรียก clearSelection() ทำให้ไฮไลต์หายไป
     * ใต้แผ่นที่เพิ่งเปิด ทั้งที่ข้อความบนแผ่นยังหมายถึงกรอบนั้นอยู่
     * ผู้ปิดโหมดคือ sheet.onClose เหมือนเดิม (main.ts)
     */
    confirm(): void {
      if (!block) return;
      const text = extractText(block, terminal.readLine);
      if (text === '') return;
      deps.onRegionPicked(text);
    },
  };
}
