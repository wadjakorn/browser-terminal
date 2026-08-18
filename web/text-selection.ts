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
}

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

  const finish = (): void => {
    if (!drag) return;
    const block: Block = blockFrom(drag.anchor, drag.focus);
    const text = extractText(block, terminal.readLine);
    drag = null;

    if (text === '') {
      // ไฮไลต์ที่ค้างอยู่จะไม่ตรงกับอะไรที่ผู้ใช้ทำอะไรต่อได้ — ล้างทิ้ง แต่ยังอยู่ในโหมด
      terminal.clearSelection();
      return;
    }
    deps.onRegionPicked(text);
  };

  const setMode = (next: boolean): void => {
    if (modeActive === next) return;
    modeActive = next;
    drag = null;
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
  };
}
