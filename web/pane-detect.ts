/**
 * หา "เส้นแบ่ง pane แนวตั้ง" จากตัวอักษรที่อยู่บนจอ — ตรรกะบริสุทธิ์ ไม่รู้จัก xterm
 *
 * เหตุผลที่ต้องมีไฟล์นี้: การเลือกข้อความหลายบรรทัดบนจอที่มี sidebar (herdr) หรือ
 * pane แนวตั้ง (tmux) จะลากเอาเส้น `│` และเนื้อความของ pane ข้างๆ ติดมาด้วยเสมอ
 * ถ้าไม่รู้ว่าเส้นแบ่งอยู่คอลัมน์ไหน วิธีเดียวที่ตัดมันออกได้คือเลือกแบบจำกัดคอลัมน์
 *
 * เราเลือก "ตรวจสดทุกครั้ง" แทนการให้ผู้ใช้ตั้งค่าแล้วจำไว้ เพราะค่าที่จำไว้จะผิด
 * ทันทีที่ผู้ใช้ย่อ/ขยาย sidebar หรือหมุนจอ — แล้วอาการที่ได้คือ "คัดลอกมาได้ครึ่งเดียว"
 * ซึ่งหาสาเหตุยากกว่าการตรวจพลาดตรงๆ มาก
 */

/** อ่านตัวอักษรของเซลล์ — คืน '' เมื่อเป็นครึ่งขวาของอักษรกว้าง (CJK) */
export type CellReader = (row: number, column: number) => string;

export interface PaneBounds {
  /** คอลัมน์แรกของ pane (inclusive) */
  start: number;
  /** คอลัมน์สุดท้ายของ pane (inclusive) */
  end: number;
}

export interface DetectOptions {
  rows: number;
  columns: number;
  /** สัดส่วนของแถวที่ไม่ว่าง ซึ่งต้องเป็นอักษรเส้นแนวตั้ง ถึงจะนับเป็นเส้นแบ่ง */
  threshold?: number;
  /** ต้องมีแถวที่ไม่ว่างอย่างน้อยเท่านี้ ถึงจะเชื่อผลการตรวจ */
  minRows?: number;
}

/**
 * อักษรที่ถือว่าเป็นเส้นแบ่งแนวตั้ง
 *
 * `|` ธรรมดาอยู่ในนี้ด้วยเพราะ TUI บางตัววาดเส้นด้วย ASCII — แต่มันก็เป็นอักขระที่
 * โผล่ในเนื้อความบ่อยที่สุดในบรรดาทั้งหมด (pipe ใน shell, ตาราง markdown) เกณฑ์
 * threshold คือสิ่งเดียวที่กันไม่ให้ `|` ในเนื้อความกลายเป็นเส้นแบ่งปลอม
 */
export const BORDER_CHARS: ReadonlySet<string> = new Set([
  '│', '┃', '║', '▏', '▕', '┆', '┊', '╎', '╏', '|',
]);

export function detectBorderColumns(read: CellReader, opts: DetectOptions): number[] {
  const { rows, columns } = opts;
  const threshold = opts.threshold ?? 0.8;
  const minRows = opts.minRows ?? 4;

  const hits = new Array<number>(columns).fill(0);
  let contentRows = 0;

  for (let row = 0; row < rows; row++) {
    // ต้องรู้ก่อนว่าแถวนี้ว่างหรือไม่ ค่อยนับ — แถวว่างที่ปนอยู่ในตัวหารจะทำให้
    // เส้นแบ่งที่ถูกต้องตกเกณฑ์ ทั้งที่มันปรากฏครบทุกแถวที่มีเนื้อหาจริง
    let blank = true;
    for (let column = 0; column < columns; column++) {
      const char = read(row, column);
      if (char !== '' && char !== ' ') { blank = false; break; }
    }
    if (blank) continue;

    contentRows++;
    for (let column = 0; column < columns; column++) {
      if (BORDER_CHARS.has(read(row, column))) hits[column]!++;
    }
  }

  if (contentRows < minRows) return [];

  const borders: number[] = [];
  for (let column = 0; column < columns; column++) {
    if (hits[column]! / contentRows >= threshold) borders.push(column);
  }
  return borders;
}

export function panesFromBorders(borders: number[], columns: number): PaneBounds[] {
  const sorted = [...borders].sort((a, b) => a - b);
  const panes: PaneBounds[] = [];
  let start = 0;

  for (const border of sorted) {
    // เส้นแบ่งชิดขอบหรือติดกันสองเส้น จะได้ช่วงกว้างศูนย์ — ข้ามไป ไม่งั้น
    // paneContaining จะคืน pane ที่เลือกอะไรไม่ได้เลย
    if (border > start) panes.push({ start, end: border - 1 });
    start = border + 1;
  }
  if (start <= columns - 1) panes.push({ start, end: columns - 1 });

  return panes;
}

export function paneContaining(panes: PaneBounds[], column: number): PaneBounds | null {
  return panes.find(pane => column >= pane.start && column <= pane.end) ?? null;
}

/**
 * pane ที่คอลัมน์นี้อยู่ — ถ้าจิ้มโดนเส้นแบ่งพอดี ให้เลือก pane ที่ใกล้กว่า (เสมอกันเอาซ้าย)
 *
 * บนมือถือการจิ้มโดนเส้นแบ่งพอดีเป็นเรื่องปกติมาก ถ้าปล่อยให้คืน null แล้วตกไป
 * ใช้เต็มความกว้าง ผู้ใช้จะได้ผลลัพธ์ที่มีเส้นแบ่งติดมาโดยไม่รู้ว่าเพราะอะไร
 */
export function nearestPane(panes: PaneBounds[], column: number): PaneBounds | null {
  const exact = paneContaining(panes, column);
  if (exact) return exact;
  if (panes.length === 0) return null;

  let best = panes[0]!;
  let bestDistance = Infinity;
  for (const pane of panes) {
    const distance = column < pane.start ? pane.start - column : column - pane.end;
    if (distance < bestDistance) { best = pane; bestDistance = distance; }
  }
  return best;
}
