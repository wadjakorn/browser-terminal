import { describe, expect, it, vi } from 'vitest';
import { createLinkOpener, isOpenableUrl } from './links.js';

describe('isOpenableUrl', () => {
  it('รับ http และ https', () => {
    expect(isOpenableUrl('http://example.com')).toBe(true);
    expect(isOpenableUrl('https://example.com/a/b?c=1')).toBe(true);
  });

  it('ปฏิเสธ scheme อื่นทั้งหมด รวม javascript: ที่เป็นช่องทาง XSS', () => {
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableUrl('vscode://open')).toBe(false);
    expect(isOpenableUrl('data:text/html,<b>x')).toBe(false);
  });

  it('ปฏิเสธข้อความที่ไม่ใช่ URL', () => {
    expect(isOpenableUrl('')).toBe(false);
    expect(isOpenableUrl('ไม่ใช่ลิงก์')).toBe(false);
    expect(isOpenableUrl('example.com')).toBe(false);
  });
});

function setup() {
  const open = vi.fn();
  const probe = vi.fn();
  const click = vi.fn();
  const opener = createLinkOpener({ open });
  return { open, probe, click, opener };
}

describe('createLinkOpener', () => {
  it('แตะบนลิงก์ = เปิดลิงก์ และไม่ส่งคลิกต่อให้ TUI', () => {
    const { open, probe, click, opener } = setup();
    probe.mockImplementation(() => opener.onHover('https://example.com/x'));

    expect(opener.handleTap(probe, click)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/x');
    expect(click).not.toHaveBeenCalled();
  });

  it('แตะที่ไม่มีลิงก์ = ส่งคลิกต่อให้ TUI ตามเดิม', () => {
    const { open, probe, click, opener } = setup();

    expect(opener.handleTap(probe, click)).toBe(false);
    expect(probe).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('probe ต้องถูกเรียกก่อน click เสมอ ไม่งั้น linkifier ยังไม่รู้จักลิงก์', () => {
    const { probe, click, opener } = setup();
    const order: string[] = [];
    probe.mockImplementation(() => { order.push('probe'); });
    click.mockImplementation(() => { order.push('click'); });

    opener.handleTap(probe, click);

    expect(order).toEqual(['probe', 'click']);
  });

  it('ลิงก์ที่ scheme ไม่ปลอดภัย ไม่เปิด และตกกลับไปเป็นคลิกปกติ', () => {
    const { open, probe, click, opener } = setup();
    probe.mockImplementation(() => opener.onHover('javascript:alert(1)'));

    expect(opener.handleTap(probe, click)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('onLeave ล้างลิงก์ที่ค้างอยู่ แตะครั้งถัดไปจึงไม่เปิดลิงก์เก่า', () => {
    const { open, probe, click, opener } = setup();
    opener.onHover('https://example.com/old');
    probe.mockImplementation(() => opener.onLeave());

    expect(opener.handleTap(probe, click)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('คลิกด้วยเมาส์จริงบนลิงก์ที่ hover อยู่ = เปิดลิงก์ และกลืนอีเวนต์', () => {
    const { open, opener } = setup();
    opener.onHover('https://example.com/y');

    expect(opener.handleMouseDown()).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/y');
  });

  it('คลิกด้วยเมาส์จริงตรงที่ไม่มีลิงก์ = ปล่อยผ่านให้ xterm จัดการ', () => {
    const { open, opener } = setup();

    expect(opener.handleMouseDown()).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
