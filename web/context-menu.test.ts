import { describe, expect, it } from 'vitest';
import { suppressesContextMenu } from './context-menu.js';

describe('suppressesContextMenu', () => {
  it('ปล่อยเมนูของเบราว์เซอร์เมื่อแอปข้างในไม่ได้ขอ mouse reporting', () => {
    // นี่คือทางคัดลอกข้อความบนเดสก์ท็อป ห้ามกดทิ้ง
    expect(suppressesContextMenu('none')).toBe(false);
  });

  it('กดเมนูทิ้งทุกโหมดที่ TUI ขอปุ่มเมาส์ไว้', () => {
    for (const mode of ['x10', 'vt200', 'drag', 'any'] as const) {
      expect(suppressesContextMenu(mode)).toBe(true);
    }
  });
});
