import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('แถวของ terminal', () => {
  it('ไม่ตัดวรรณยุกต์ไทยที่ล้นขึ้นเหนือกรอบแถว', () => {
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.terminal \.xterm-rows > div \{ overflow: visible !important; \}/);
  });
});
