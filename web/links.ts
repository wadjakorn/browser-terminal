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
 * ## ทำไมต้องตัดย่อหน้าของบรรทัดต่อเนื่องทิ้ง
 *
 * Claude Code (Ink) เขียนเต็มถึงคอลัมน์สุดท้ายแล้วขึ้นบรรทัดใหม่พร้อม **ย่อหน้า 2
 * ช่อง** ทุกครั้ง ต่อแถวดิบจะได้ `…-tap-fi` + `␣␣x-plan.md` แล้ว regex ตัด URL ตรง
 * ช่องว่างนั้นพอดี — อาการคือ "แตะแล้วได้ครึ่งเดียว" เฉพาะตอนลิงก์ยาวข้ามบรรทัด
 * bash ไม่มีอาการนี้เพราะมันหักบรรทัดที่คอลัมน์ 0 ไม่มีอะไรมาคั่น
 *
 * ## ทำไมนับเป็นคอลัมน์ ไม่ใช่ตัวอักษร
 *
 * หนึ่งเซลล์ของเทอร์มินัลไม่เท่ากับหนึ่งอักขระ JS: อักษร CJK กินสองคอลัมน์แต่เป็น
 * อักขระเดียว ส่วนสระและวรรณยุกต์ไทยเป็นหลายอักขระในเซลล์เดียว การเทียบ
 * `text.length` กับความกว้างเพนจึงผิดทั้งสองทาง แล้วอาการที่ได้คือ "บางแถวก็ต่อ
 * บรรทัดให้ บางแถวก็ไม่" โดยไม่มี error ให้เห็น เราจึงอ่านทีละเซลล์แล้วทำตาราง
 * คอลัมน์ → offset ไว้เอง
 *
 * ## ทำไมแตะโดนลิงก์แล้วไม่ส่งคลิกต่อ
 *
 * ผู้ใช้แตะเพราะอยากเปิดลิงก์ ถ้าส่งคลิกต่อ herdr จะสลับ pane เงียบๆ ตอนที่ผู้ใช้
 * กำลังมองแท็บใหม่ แล้วกลับมาเจอโฟกัสย้ายโดยไม่รู้สาเหตุ โฟกัสเรียกคืนได้ด้วยการ
 * แตะที่ว่างข้างๆ ซึ่งเสียครั้งเดียวและเห็นผลทันที
 */

import {
  BORDER_CHARS,
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
  /** คืน `''` เมื่อเป็นครึ่งขวาของอักษรกว้าง — ตรงตามสัญญาของ xterm */
  readCell(line: number, column: number): string;
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

/** แถวหนึ่งของเพน อ่านมาแล้วทีละเซลล์ */
interface Row {
  /** ข้อความของแถวหลังแปลงอักษรวาดกล่องเป็นช่องว่าง */
  text: string;
  /** offset ใน `text` ของแต่ละคอลัมน์ ดัชนีคือ `column - pane.start` */
  offsetOf: number[];
  /** คอลัมน์แรก/สุดท้ายที่มีเนื้อหา — `-1` เมื่อแถวว่าง */
  firstColumn: number;
  lastColumn: number;
}

/**
 * อ่านหนึ่งแถวในช่วงคอลัมน์ของเพน
 *
 * อักษรวาดกล่องกลายเป็นช่องว่าง เพราะ `URL_PATTERN` ไม่ได้กัน `│` ไว้ ถ้าปล่อยไว้
 * ลิงก์ในกล่องผลลัพธ์จะมีเส้นกรอบติดมาด้วย
 */
function readRow(port: LinkTerminalPort, line: number, pane: PaneBounds): Row {
  let text = '';
  const offsetOf: number[] = [];
  let firstColumn = -1;
  let lastColumn = -1;

  for (let column = pane.start; column <= pane.end; column++) {
    const raw = port.readCell(line, column);
    if (raw === '') {
      // ครึ่งขวาของอักษรกว้าง — ชี้ไป offset เดียวกับครึ่งซ้าย เพื่อให้แตะโดนครึ่งไหน
      // ก็เจอตัวอักษรเดียวกัน และนับเป็นเนื้อหาถ้าครึ่งซ้ายเป็นเนื้อหา
      offsetOf.push(offsetOf[offsetOf.length - 1] ?? 0);
      if (lastColumn === column - 1) lastColumn = column;
      continue;
    }
    const char = BORDER_CHARS.has(raw) ? ' ' : raw;
    offsetOf.push(text.length);
    text += char;
    if (char !== ' ') {
      if (firstColumn < 0) firstColumn = column;
      lastColumn = column;
    }
  }

  return { text, offsetOf, firstColumn, lastColumn };
}

/**
 * แถวนี้ "ล้นไปแถวถัดไป" หรือไม่
 *
 * เกณฑ์คือเนื้อหากินถึงคอลัมน์สุดท้ายของเพน ซึ่งเป็นร่องรอยเดียวที่เหลืออยู่ว่า TUI
 * ตัดบรรทัดตรงนั้น — herdr ลบข้อมูล soft wrap ทิ้งไปหมดแล้ว
 */
function overflowsToNextRow(row: Row, pane: PaneBounds): boolean {
  return row.lastColumn === pane.end;
}

/** ส่วนของหนึ่งแถวที่ถูกต่อเข้าไปในสตริงรวม */
interface Segment {
  line: number;
  row: Row;
  /** คอลัมน์แรกที่ถูกต่อเข้ามา — คอลัมน์ก่อนหน้านี้คือย่อหน้าที่ตัดทิ้ง */
  fromColumn: number;
  /** offset ใน `joined` ของ `fromColumn` */
  base: number;
}

/**
 * หา URL ที่คลุมเซลล์ที่ระบุ โดยต่อแถวที่ล้นต่อกันภายในเพนเดียวกัน
 *
 * คืน `null` เมื่อไม่มี URL ตรงนั้น หรือมีแต่ scheme เปิดไม่ได้
 */
export function findUrlAt(port: LinkTerminalPort, line: number, column: number): string | null {
  const pane = paneAt(port, column);
  if (pane.end < pane.start) return null;

  const cache = new Map<number, Row>();
  const rowAt = (l: number): Row => {
    let row = cache.get(l);
    if (!row) { row = readRow(port, l, pane); cache.set(l, row); }
    return row;
  };

  // ขยายขึ้นบนตราบใดที่แถวก่อนหน้าล้นลงมา แล้วขยายลงล่างตราบใดที่แถวปัจจุบันล้นต่อ
  let first = line;
  while (first - 1 >= 0 && overflowsToNextRow(rowAt(first - 1), pane)) first--;
  let last = line;
  const bottom = port.viewportTop() + port.rows;
  while (last + 1 < bottom && overflowsToNextRow(rowAt(last), pane)) last++;

  // แถวแรกต่อทั้งแถว แถวต่อเนื่องตัดย่อหน้าทิ้งก่อน — URL ไม่มีช่องว่างในตัวอยู่แล้ว
  // จึงไม่มีทางตัดเนื้อ URL หายไป
  const segments: Segment[] = [];
  let joined = '';
  for (let l = first; l <= last; l++) {
    const row = rowAt(l);
    const fromColumn = l === first ? pane.start : Math.max(pane.start, row.firstColumn);
    if (row.firstColumn < 0 && l !== first) continue;   // แถวว่างล้วน ไม่มีอะไรให้ต่อ
    const dropped = row.offsetOf[fromColumn - pane.start] ?? 0;
    segments.push({ line: l, row, fromColumn, base: joined.length });
    joined += row.text.slice(dropped);
  }

  const offset = offsetInJoined(segments, pane, line, column);
  if (offset === null) return null;

  URL_PATTERN.lastIndex = 0;
  for (let m = URL_PATTERN.exec(joined); m !== null; m = URL_PATTERN.exec(joined)) {
    if (offset < m.index || offset >= m.index + m[0].length) continue;
    return isOpenableUrl(m[0]) ? m[0] : null;
  }
  return null;
}

/** เซลล์ที่แตะ → offset ใน `joined` · `null` เมื่อแตะโดนย่อหน้าที่ถูกตัดทิ้ง */
function offsetInJoined(
  segments: Segment[],
  pane: PaneBounds,
  line: number,
  column: number,
): number | null {
  const segment = segments.find(s => s.line === line);
  if (!segment || column < segment.fromColumn || column > pane.end) return null;
  const within = segment.row.offsetOf[column - pane.start];
  const dropped = segment.row.offsetOf[segment.fromColumn - pane.start] ?? 0;
  if (within === undefined) return null;
  return segment.base + within - dropped;
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
