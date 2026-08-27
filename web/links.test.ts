import { describe, expect, it, vi } from 'vitest';
import { cellChar, createLinkOpener, findUrlAt, isOpenableUrl, type LinkTerminalPort } from './links.js';

describe('isOpenableUrl', () => {
  it('รับ http และ https', () => {
    expect(isOpenableUrl('http://example.com')).toBe(true);
    expect(isOpenableUrl('https://example.com/a/b?c=1')).toBe(true);
  });

  it('ปฏิเสธ scheme อื่นทั้งหมด รวม javascript: ที่เป็นช่องทาง XSS', () => {
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableUrl('data:text/html,<b>x')).toBe(false);
  });

  it('ปฏิเสธข้อความที่ไม่ใช่ URL', () => {
    expect(isOpenableUrl('')).toBe(false);
    expect(isOpenableUrl('example.com')).toBe(false);
  });
});

/**
 * จอจำลองแบบ herdr: sidebar ซ้ายกว้าง 10 เส้นแบ่งที่คอลัมน์ 10 เพนขวากว้าง 20
 * ทุกแถวยาวเท่ากันเสมอ เหมือนที่ herdr วาดจริง (มันยิง CUP ทุกเซลล์ ไม่เคย soft-wrap)
 *
 * แถวถูกแปลงเป็น "เซลล์" ก่อนเสมอ ไม่ใช่ดัชนีตัวอักษร เพราะหนึ่งเซลล์ของเทอร์มินัลไม่
 * เท่ากับหนึ่งอักขระ JS: อักษร CJK กินสองคอลัมน์ (ครึ่งขวาอ่านได้ `''`) ส่วนสระและ
 * วรรณยุกต์ไทยอยู่ในเซลล์เดียวกับพยัญชนะ นี่คือพฤติกรรมจริงของบัฟเฟอร์ xterm และเป็น
 * เคสที่โค้ดเดิมพลาด
 */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF00-\uFF60]/;

/** ข้อความ → เซลล์ เซลล์ละหนึ่งคอลัมน์ */
function toCells(text: string): string[] {
  const cells: string[] = [];
  for (const char of text) {
    // สระ/วรรณยุกต์เกาะเซลล์ก่อนหน้า ไม่กินคอลัมน์เพิ่ม
    if (/\p{Mn}/u.test(char) && cells.length > 0) {
      cells[cells.length - 1] += char;
      continue;
    }
    cells.push(char);
    if (WIDE.test(char)) cells.push('');   // ครึ่งขวาของอักษรกว้าง
  }
  return cells;
}

/**
 * `blank` คือสิ่งที่ `readCell()` คืนเมื่อเซลล์ว่าง
 *
 * xterm ของจริงคืน `''` ทั้งเซลล์ว่างและครึ่งขวาของอักษรกว้าง เทสจึงต้องยิงทั้งสอง
 * แบบ ไม่งั้นบั๊กที่แยกสองกรณีนี้ไม่ออกจะรอดเทสไปได้ (เคยเกิดมาแล้ว)
 */
function fakePort(rightPane: string[], sidebar?: string[], blank = ' '): LinkTerminalPort {
  const PANE_W = 20;
  const COLUMNS = 31;
  const rows = rightPane.map((text, i) => {
    const side = toCells(sidebar?.[i] ?? 'side').slice(0, 10);
    while (side.length < 10) side.push(blank);
    const pane = toCells(text).slice(0, PANE_W);
    while (pane.length < PANE_W) pane.push(blank);
    return [...side, '│', ...pane];
  });
  return {
    rows: rows.length,
    columns: COLUMNS,
    viewportTop: () => 0,
    readCell: (line, column) => rows[line]?.[column] ?? '',
  };
}

const URL = 'https://example.com/projects/la-moon/conversations/17637d2b-d95f';

/**
 * regression ที่หลุดขึ้น production มาแล้ว: `getChars()` คืน `''` ทั้งเซลล์ว่างและ
 * ครึ่งขวาของอักษรกว้าง พอแยกไม่ออก ช่องว่างท้ายแถวถูกนับเป็นเนื้อหา ทุกแถวเลยดู
 * "เต็มขอบเพน" แล้วต่อบรรทัดมั่ว จนแตะลิงก์ไม่ติดเลยสักอัน
 */
describe('cellChar', () => {
  it("เซลล์ว่าง (width 1, chars '') เป็นช่องว่าง ไม่ใช่ครึ่งขวาของอักษรกว้าง", () => {
    expect(cellChar('', 1)).toBe(' ');
  });

  it("ครึ่งขวาของอักษรกว้าง (width 0) คืน '' ไว้ให้ผู้เรียกรู้ว่าไม่ใช่คอลัมน์ใหม่", () => {
    expect(cellChar('', 0)).toBe('');
  });

  it('เซลล์ที่มีตัวอักษรคืนตามเดิม รวมสระไทยที่อยู่เซลล์เดียวกัน', () => {
    expect(cellChar('a', 1)).toBe('a');
    expect(cellChar('漢', 2)).toBe('漢');
    expect(cellChar('ที', 1)).toBe('ที');
  });
});

describe('findUrlAt', () => {
  it('หา URL ที่อยู่ครบในแถวเดียวได้', () => {
    const port = fakePort(['see https://a.io/x ok']);
    expect(findUrlAt(port, 0, 15)).toBe('https://a.io/x');
  });

  it('ต่อ URL ที่ถูกตัดข้ามแถวภายในเพนเดียวกัน — เคสจริงของ herdr', () => {
    // ยาว 63 ตัวในเพนกว้าง 20 → กินสามแถวเต็มกับเศษ
    const rows = [URL.slice(0, 20), URL.slice(20, 40), URL.slice(40, 60), URL.slice(60) + ')'];
    const port = fakePort(rows);
    // แตะแถวสุดท้ายซึ่งเป็นหางของ URL
    expect(findUrlAt(port, 3, 12)).toBe(URL);
    // แตะแถวแรกก็ต้องได้ URL เต็มเหมือนกัน
    expect(findUrlAt(port, 0, 15)).toBe(URL);
  });

  it('ไม่ลากเนื้อหา sidebar หรือเส้นแบ่งเข้ามาใน URL', () => {
    const rows = [URL.slice(0, 20), URL.slice(20, 40), URL.slice(40, 60), URL.slice(60) + ')'];
    const port = fakePort(rows, ['w1 herdr', 'w2 codex', 'w3 claude', 'w4 zsh']);
    const found = findUrlAt(port, 1, 15);
    expect(found).toBe(URL);
    expect(found).not.toContain('│');
    expect(found).not.toContain('herdr');
  });

  it('หยุดต่อแถวเมื่อแถวก่อนหน้าไม่ได้เต็มถึงขอบเพน', () => {
    // แถว 0 มีที่ว่างท้ายแถว → แถว 1 เป็นคนละบรรทัดตรรกะ ห้ามต่อกัน
    // แถวเส้นคั่นเป็นตัวบอกขอบขวาจริง ไม่งั้นบรรทัดสั้นจะกลายเป็นเกณฑ์เสียเอง
    const port = fakePort(['─'.repeat(16), 'tail-of-nothing', 'https://a.io/ok']);
    expect(findUrlAt(port, 2, 12)).toBe('https://a.io/ok');
  });

  it('ต่อบรรทัดได้แม้ TUI กันรางขวาไว้จนเนื้อหาไม่เคยชน pane.end — เคสจริงของ herdr', () => {
    // herdr กันคอลัมน์ขวาไว้เป็นรางสกรอลบาร์ถาวร วัดของจริงได้ช่องโหว่ 4 คอลัมน์
    // (เพน 26–101 เนื้อหาจบที่ 97) เกณฑ์ที่เทียบกับ pane.end จึงไม่เคยเป็นจริงเลย
    const W = 16;                       // เนื้อหากว้างสุด 16 จากเพน 20
    const rows = [
      '─'.repeat(W),                    // เส้นคั่นคือสิ่งที่บอกว่าขอบขวาจริงอยู่ตรงไหน
      URL.slice(0, W), URL.slice(W, 2 * W), URL.slice(2 * W, 3 * W), URL.slice(3 * W),
    ];
    const port = fakePort(rows);
    expect(findUrlAt(port, 2, 11 + 5)).toBe(URL);
    expect(findUrlAt(port, 1, 11 + 5)).toBe(URL);
  });

  it('คืน null เมื่อแตะข้อความธรรมดา', () => {
    const port = fakePort(['see https://a.io/x ok']);
    expect(findUrlAt(port, 0, 12)).toBeNull();   // ตรงคำว่า "see"
  });

  it('คืน null เมื่อแตะใน sidebar ที่ไม่มีลิงก์', () => {
    const port = fakePort(['https://a.io/x']);
    expect(findUrlAt(port, 0, 2)).toBeNull();
  });

  it('ไม่กิน `)` ปิดท้ายที่ TUI ใส่มาเอง', () => {
    const port = fakePort(['(https://a.io/x)']);
    expect(findUrlAt(port, 0, 15)).toBe('https://a.io/x');
  });

  it('ต่อ URL ที่ Claude Code ตัด โดยข้ามย่อหน้าของบรรทัดต่อเนื่อง — เคสจริง', () => {
    // Ink เขียนเต็มถึงคอลัมน์สุดท้ายแล้วขึ้นบรรทัดใหม่พร้อมย่อหน้า 2 ช่องเสมอ
    const head = '  ' + URL.slice(0, 18);          // เต็ม 20 พอดี
    const rows = [head, '  ' + URL.slice(18, 36), '  ' + URL.slice(36, 54), '  ' + URL.slice(54)];
    const port = fakePort(rows);
    expect(findUrlAt(port, 0, 11 + 5)).toBe(URL);   // แตะแถวแรก
    expect(findUrlAt(port, 3, 11 + 5)).toBe(URL);   // แตะแถวสุดท้าย
  });

  it('ต่อบรรทัดได้แม้แถวนั้นมีอักษรกว้างหรือสระไทยปนอยู่', () => {
    // 'ไทย' กินคอลัมน์เท่าจำนวนพยัญชนะ ส่วน '漢' กินสองคอลัมน์ — ทั้งคู่ทำให้
    // ความยาวสตริงไม่เท่าจำนวนคอลัมน์ ซึ่งเป็นสิ่งที่เกณฑ์เดิมนับผิด
    // '漢' 2 คอลัมน์ + ' ' + 'ที' 1 คอลัมน์ + ' ' = 5 คอลัมน์ เหลือ 15 ให้ URL พอดี 20
    const rows = [
      '漢 ที ' + URL.slice(0, 15),
      '  ' + URL.slice(15, 33),
      '  ' + URL.slice(33, 51),
      '  ' + URL.slice(51),
    ];
    const port = fakePort(rows);
    expect(findUrlAt(port, 1, 11 + 5)).toBe(URL);
  });

  it('แตะย่อหน้าของบรรทัดต่อเนื่อง = ไม่ใช่ลิงก์', () => {
    const rows = ['  ' + URL.slice(0, 18), '  ' + URL.slice(18)];
    expect(findUrlAt(fakePort(rows), 1, 11)).toBeNull();
  });

  it('ไม่ลากอักษรวาดกล่องเข้ามาใน URL', () => {
    // URL ในกล่องผลลัพธ์: `│` ท้ายแถวต้องไม่กลายเป็นส่วนหนึ่งของลิงก์
    const port = fakePort(['│ https://a.io/x  │']);
    const found = findUrlAt(port, 0, 11 + 5);
    expect(found).toBe('https://a.io/x');
    expect(found).not.toContain('│');
  });

  it('ปฏิเสธ scheme อันตรายแม้ regex จะจับได้', () => {
    const port = fakePort(['x javascript://a.io/x']);
    expect(findUrlAt(port, 0, 15)).toBeNull();
  });
});

function setup(rows: string[]) {
  const open = vi.fn();
  const click = vi.fn();
  const opener = createLinkOpener({ open, terminal: fakePort(rows) });
  return { open, click, opener };
}

describe('createLinkOpener', () => {
  const AT_URL = { line: 0, column: 15 };
  const AT_TEXT = { line: 0, column: 12 };

  it('แตะบนลิงก์ = เปิดลิงก์ และไม่ส่งคลิกต่อให้ TUI', () => {
    const { open, click, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleTap(AT_URL, click)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://a.io/x');
    expect(click).not.toHaveBeenCalled();
  });

  it('แตะที่ไม่มีลิงก์ = ส่งคลิกต่อให้ TUI ตามเดิม', () => {
    const { open, click, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleTap(AT_TEXT, click)).toBe(false);
    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('แตะนอกจอ (แปลงพิกัดไม่ได้) = ส่งคลิกต่อ ไม่พังเงียบ', () => {
    const { open, click, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleTap(null, click)).toBe(false);
    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('คลิกเมาส์จริงบนลิงก์ = เปิดลิงก์และกลืนอีเวนต์', () => {
    const { open, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleMouseDown(AT_URL, 0)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://a.io/x');
  });

  it('คลิกเมาส์จริงตรงข้อความธรรมดา = ปล่อยผ่านให้ xterm', () => {
    const { open, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleMouseDown(AT_TEXT, 0)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('คลิกขวาบนลิงก์ = ไม่เปิดลิงก์ ปล่อยให้ mouse report ไปถึง TUI', () => {
    // ปุ่ม RMB ยิง MouseEvent สังเคราะห์ที่ target เดียวกับเมาส์จริง มันจึงวิ่งผ่าน
    // listener เฟส capture ตัวนี้ด้วย ถ้าไม่กรอง button ที่นี่ คลิกขวาบนลิงก์จะกลาย
    // เป็นการเปิดแท็บใหม่ และ arm ก็ถูกใช้ทิ้งไปโดยที่ TUI ไม่ได้รับอะไรเลย
    const { open, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleMouseDown(AT_URL, 2)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
