import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEpochStore } from './epoch.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bc-epoch-'));
  file = join(dir, 'epoch');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('createEpochStore', () => {
  it('ยังไม่มีไฟล์ = เริ่มที่ 0', () => {
    expect(createEpochStore(file).current()).toBe(0);
  });

  it('bump เพิ่มทีละหนึ่ง', () => {
    const s = createEpochStore(file);
    expect(s.bump()).toBe(1);
    expect(s.bump()).toBe(2);
    expect(s.current()).toBe(2);
  });

  // ถ้าข้อนี้พัง การ logout จะถูกลืมทุกครั้งที่ restart — session ที่ตั้งใจเพิกถอนจะกลับมาใช้ได้
  it('**ค่าอยู่รอดข้าม restart**', () => {
    createEpochStore(file).bump();
    expect(createEpochStore(file).current()).toBe(1);
  });

  it('ไฟล์มีขยะ = ถอยไปที่ 0 ไม่ throw', () => {
    for (const junk of ['ไม่ใช่ตัวเลข', '-5', '1.5', '']) {
      writeFileSync(file, junk);
      expect(createEpochStore(file).current()).toBe(0);
    }
  });

  it('เขียนไฟล์ไม่ได้ = ยังทำงานต่อในหน่วยความจำ และเตือน', () => {
    const warnings: string[] = [];
    const s = createEpochStore(join(dir, 'ไม่มี', 'โฟลเดอร์นี้'), m => warnings.push(m));
    expect(s.bump()).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/logout/);
  });
});
