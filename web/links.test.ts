import { describe, expect, it, vi } from 'vitest';
import { createLinkOpener, findUrlAt, isOpenableUrl, type LinkTerminalPort } from './links.js';

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
 */
function fakePort(rightPane: string[], sidebar?: string[]): LinkTerminalPort {
  const PANE_W = 20;
  const rows = rightPane.map((text, i) => {
    const side = (sidebar?.[i] ?? 'side').padEnd(10, ' ').slice(0, 10);
    return side + '│' + text.padEnd(PANE_W, ' ').slice(0, PANE_W);
  });
  return {
    rows: rows.length,
    columns: 31,
    viewportTop: () => 0,
    readCell: (line, column) => rows[line]?.[column] ?? '',
    readLine: (line, start, end) => (rows[line] ?? '').slice(start, end + 1),
  };
}

const URL = 'https://example.com/projects/la-moon/conversations/17637d2b-d95f';

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
    const port = fakePort(['tail-of-nothing', 'https://a.io/ok']);
    expect(findUrlAt(port, 1, 12)).toBe('https://a.io/ok');
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
    expect(opener.handleMouseDown(AT_URL)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://a.io/x');
  });

  it('คลิกเมาส์จริงตรงข้อความธรรมดา = ปล่อยผ่านให้ xterm', () => {
    const { open, opener } = setup(['see https://a.io/x ok']);
    expect(opener.handleMouseDown(AT_TEXT)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
