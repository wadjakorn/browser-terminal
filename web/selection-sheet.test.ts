import { describe, expect, it } from 'vitest';
import { sheetHintText, sheetStateAfterCopy } from './selection-sheet.js';

describe('แผ่นผลลัพธ์', () => {
  it('คัดลอกสำเร็จ = ปิดแผ่นและกลับไปคำใบ้ปกติ', () => {
    expect(sheetStateAfterCopy(true)).toEqual({ hint: 'idle', close: true });
  });

  it('คัดลอกล้มเหลว = แผ่นยังเปิดอยู่ และบอกทางหนีคือกดค้าง', () => {
    // ปิดแผ่นตอนนี้เท่ากับพาผู้ใช้เข้าทางตัน — การกดค้างเลือกเองยังใช้ได้อยู่
    expect(sheetStateAfterCopy(false)).toEqual({ hint: 'copy-failed', close: false });
    expect(sheetHintText('copy-failed')).toContain('กดค้าง');
  });

  it('คำใบ้ปกติชี้ทางไปเมนู native', () => {
    expect(sheetHintText('idle')).toContain('กดค้าง');
    expect(sheetHintText('idle')).not.toContain('ไม่ได้');
  });
});
