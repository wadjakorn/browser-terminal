import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { isEntrypoint } from './index.js';

const SELF = new URL(import.meta.url).pathname.replace(/entrypoint\.test\.ts$/, 'index.ts');

describe('isEntrypoint', () => {
  it('path เดียวกันถือว่าเป็น entrypoint', () => {
    expect(isEntrypoint(pathToFileURL(SELF).href, SELF)).toBe(true);
  });

  it('ชื่อไฟล์ซ้ำแต่คนละ path ต้องไม่ผ่าน', () => {
    // นี่คือบั๊กเดิม: endsWith(basename) ทำให้ index.js ที่ไหนก็ผ่าน
    expect(isEntrypoint(pathToFileURL('/opt/app/dist/server/index.js').href, '/tmp/other/index.js'))
      .toBe(false);
  });

  it('ไม่มี argv[1] (ถูก import) ต้องไม่ผ่าน', () => {
    expect(isEntrypoint(pathToFileURL(SELF).href, undefined)).toBe(false);
  });

  it('path สัมพัทธ์ถูก resolve ก่อนเทียบ', () => {
    const rel = SELF.replace(process.cwd() + '/', '');
    expect(isEntrypoint(pathToFileURL(SELF).href, rel)).toBe(true);
  });
});
