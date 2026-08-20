/**
 * แตะ URL ในเทอร์มินัลแล้วเปิดลิงก์ได้เลย
 *
 * ## ทำไมไม่ใช้ `@xterm/addon-web-links`
 *
 * addon ต่อ URL ที่ถูกตัดข้ามแถวโดยดู `line.isWrapped` อย่างเดียว แต่ herdr ยิง
 * CUP ระบุพิกัดสัมบูรณ์ (`ESC [ row ; col H`) **ก่อนทุกเซลล์** แม้ตอน full redraw
 * ทุกแถวในบัฟเฟอร์จึงเป็นบรรทัดอิสระ `isWrapped` เป็น false เสมอ addon จึงต่อ
 * บรรทัดไม่ได้เลยในบราวเซอร์นี้ — URL ที่ยาวเกินความกว้างเพนจะแตะไม่ติด ซึ่งเป็น
 * เคสที่เจอบ่อยที่สุดเพราะเพนใน herdr แคบ
 *
 * ## ทำไมต้องรู้จักขอบเขตเพน
 *
 * herdr วาดทุกเพนลงบัฟเฟอร์เดียวกัน แถวเดียวบนจอจึงมีทั้ง sidebar เส้นแบ่ง และ
 * เพนอื่นปนกันอยู่ ต่อแถวแบบเต็มความกว้างจะได้ `│` กับเนื้อหาเพนข้างๆ ติดมาใน URL
 * เราจึงตัดเป็นช่วงคอลัมน์ของเพนก่อนเสมอ โดยใช้ตัวตรวจเส้นแบ่งชุดเดียวกับที่การ
 * เลือกข้อความใช้อยู่ (`pane-detect.ts`)
 *
 * ## ทำไมไม่พึ่ง linkifier ของ xterm
 *
 * บนจอสัมผัส `main.ts` `preventDefault()` ทุก touch event เพื่อกันไม่ให้บราวเซอร์
 * สังเคราะห์ mouse แล้วยิง mousedown/mouseup เอง — ไม่มี mousemove ส่วน linkifier
 * ของ xterm ตั้ง `_currentLink` ใน handler ของ mousemove เท่านั้น และ
 * `_handleMouseUp` ขึ้นต้นด้วย `if (!this._currentLink) return;` ลิงก์จึงไม่มีวัน
 * ถูก activate ด้วยการแตะ เราหา URL เองจากบัฟเฟอร์แล้วเปิดเองจึงตรงไปตรงมากว่า
 *
 * ## ทำไมแตะโดนลิงก์แล้วไม่ส่งคลิกต่อ
 *
 * ผู้ใช้แตะเพราะอยากเปิดลิงก์ ถ้าส่งคลิกต่อ herdr จะสลับ pane เงียบๆ ตอนที่ผู้ใช้
 * กำลังมองแท็บใหม่ แล้วกลับมาเจอโฟกัสย้ายโดยไม่รู้สาเหตุ โฟกัสเรียกคืนได้ด้วยการ
 * แตะที่ว่างข้างๆ ซึ่งเสียครั้งเดียวและเห็นผลทันที
 */

import {
  detectBorderColumns,
  panesFromBorders,
  paneContaining,
  type PaneBounds,
} from './pane-detect.js';

/**
 * ชุดอักขระท้าย URL ที่ตัดออก คัดลอกเจตนามาจาก `@xterm/addon-web-links` —
 * TUI ชอบใส่ `)` `,` `.` ปิดท้ายประโยค ซึ่งไม่ใช่ส่วนหนึ่งของ URL
 */
const URL_PATTERN = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;

/** เปิดได้เฉพาะ http/https — กัน `javascript:` และ scheme อื่นที่เป็นช่องทาง XSS */
export function isOpenableUrl(text: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

/** ส่วนของ `TerminalPort` ที่โมดูลนี้ใช้ — รับแคบไว้เพื่อให้เทสสร้าง port ปลอมได้ง่าย */
export interface LinkTerminalPort {
  rows: number;
  columns: number;
  viewportTop(): number;
  readCell(line: number, column: number): string;
  /** endColumn เป็น inclusive */
  readLine(line: number, startColumn: number, endColumn: number): string;
}

export interface Cell {
  line: number;
  column: number;
}

function paneAt(port: LinkTerminalPort, column: number): PaneBounds {
  const borders = detectBorderColumns(
    (row, col) => port.readCell(port.viewportTop() + row, col),
    { rows: port.rows, columns: port.columns },
  );
  const pane = paneContaining(panesFromBorders(borders, port.columns), column);
  return pane ?? { start: 0, end: port.columns - 1 };
}

/**
 * แถวนี้ "ล้นไปแถวถัดไป" หรือไม่
 *
 * เกณฑ์คือเนื้อหาเต็มถึงคอลัมน์สุดท้ายของเพนโดยไม่มีช่องว่างปิดท้าย ซึ่งเป็นร่องรอย
 * เดียวที่เหลืออยู่ว่า TUI ตัดบรรทัดตรงนั้น — herdr ลบข้อมูล soft wrap ทิ้งไปหมดแล้ว
 */
function overflowsToNextRow(text: string, width: number): boolean {
  return text.length === width && !/\s$/.test(text);
}

/**
 * หา URL ที่คลุมเซลล์ที่ระบุ โดยต่อแถวที่ล้นต่อกันภายในเพนเดียวกัน
 *
 * คืน `null` เมื่อไม่มี URL ตรงนั้น หรือมีแต่ scheme เปิดไม่ได้
 */
export function findUrlAt(port: LinkTerminalPort, line: number, column: number): string | null {
  const pane = paneAt(port, column);
  const width = pane.end - pane.start + 1;
  if (width <= 0) return null;

  const rowText = (l: number): string => port.readLine(l, pane.start, pane.end);

  // ขยายขึ้นบนตราบใดที่แถวก่อนหน้าล้นลงมา แล้วขยายลงล่างตราบใดที่แถวปัจจุบันล้นต่อ
  let first = line;
  while (first - 1 >= 0 && overflowsToNextRow(rowText(first - 1), width)) first--;
  let last = line;
  while (last + 1 < port.viewportTop() + port.rows && overflowsToNextRow(rowText(last), width)) last++;

  let joined = '';
  for (let l = first; l <= last; l++) joined += rowText(l).padEnd(width, ' ');

  const offset = (line - first) * width + (column - pane.start);

  URL_PATTERN.lastIndex = 0;
  for (let m = URL_PATTERN.exec(joined); m !== null; m = URL_PATTERN.exec(joined)) {
    if (offset < m.index || offset >= m.index + m[0].length) continue;
    return isOpenableUrl(m[0]) ? m[0] : null;
  }
  return null;
}

export interface LinkOpenerDeps {
  open(url: string): void;
  terminal: LinkTerminalPort;
}

export interface LinkOpener {
  /**
   * แตะหนึ่งครั้ง — `cell` เป็น null ได้เมื่อแปลงพิกัดไม่สำเร็จ
   * คืน true เมื่อเปิดลิงก์ไปแล้ว (กลืนการแตะ) · false เมื่อควรคลิกตามปกติ
   */
  handleTap(cell: Cell | null, click: () => void): boolean;
  /** คลิกด้วยเมาส์จริง คืน true เมื่อเปิดลิงก์แล้วและควรกลืนอีเวนต์ทิ้ง */
  handleMouseDown(cell: Cell | null): boolean;
}

export function createLinkOpener({ open, terminal }: LinkOpenerDeps): LinkOpener {
  const urlAt = (cell: Cell | null): string | null =>
    cell === null ? null : findUrlAt(terminal, cell.line, cell.column);

  return {
    handleTap(cell, click) {
      const url = urlAt(cell);
      if (url === null) {
        click();
        return false;
      }
      open(url);
      return true;
    },

    handleMouseDown(cell) {
      const url = urlAt(cell);
      if (url === null) return false;
      open(url);
      return true;
    },
  };
}
