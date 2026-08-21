import { describe, expect, it } from 'vitest';
import { confirmBarPlacement, handleAnchors, handleVisibility } from './selection-handles.js';

const limits = { viewportHeight: 800, bottomLimit: 700, barHeight: 48 };

describe('การวาง overlay ของโหมดเลือก', () => {
  it('หมุดเกาะมุมบนซ้ายกับล่างขวา', () => {
    expect(handleAnchors({ left: 10, top: 20, right: 90, bottom: 60 })).toEqual({
      start: { x: 10, y: 20 },
      end: { x: 90, y: 60 },
    });
  });

  it('กรอบสูงบรรทัดเดียวก็ยังได้หมุดสองอันคนละมุม', () => {
    const anchors = handleAnchors({ left: 10, top: 20, right: 90, bottom: 36 });
    expect(anchors.start).not.toEqual(anchors.end);
  });

  it('แถบยืนยันอยู่เหนือกรอบเป็นค่าตั้งต้น', () => {
    const placement = confirmBarPlacement({ left: 0, top: 300, right: 100, bottom: 400 }, limits);
    expect(placement.side).toBe('above');
    expect(placement.top).toBe(300 - 48);
  });

  it('กรอบชิดขอบบนแล้วแถบตกลงไปอยู่ใต้กรอบ', () => {
    const placement = confirmBarPlacement({ left: 0, top: 10, right: 100, bottom: 80 }, limits);
    expect(placement.side).toBe('below');
    expect(placement.top).toBe(80);
  });

  it('ไม่พอทั้งบนและล่างก็ทับกรอบ ดีกว่าหลุดจอไปเงียบๆ', () => {
    const placement = confirmBarPlacement({ left: 0, top: 10, right: 100, bottom: 690 }, limits);
    expect(placement.side).toBe('over');
  });

  it('แถบไม่เคยล้ำเข้าไปในพื้นที่แถบปุ่ม', () => {
    for (const top of [0, 100, 400, 660, 690]) {
      const placement = confirmBarPlacement({ left: 0, top, right: 100, bottom: top + 60 }, limits);
      expect(placement.top + limits.barHeight).toBeLessThanOrEqual(limits.bottomLimit);
      expect(placement.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('หมุดที่หลุดจอถูกซ่อน อีกอันในกรอบเดียวกันไม่ถูกซ่อนตาม', () => {
    expect(handleVisibility({ left: 0, top: -40, right: 100, bottom: 200 }, 800))
      .toEqual({ start: false, end: true });
    expect(handleVisibility({ left: 0, top: 200, right: 100, bottom: 900 }, 800))
      .toEqual({ start: true, end: false });
    expect(handleVisibility({ left: 0, top: 10, right: 100, bottom: 200 }, 800))
      .toEqual({ start: true, end: true });
  });

  it('viewport สั้นกว่าแถบ → top = 0 เสมอ', () => {
    const shortLimits = { viewportHeight: 100, bottomLimit: 40, barHeight: 48 };
    const placement = confirmBarPlacement({ left: 0, top: 10, right: 100, bottom: 35 }, shortLimits);
    expect(placement.top).toBe(0);
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.top + shortLimits.barHeight).toBeGreaterThanOrEqual(0);
  });

  it("'over' ด้วยกรอบสูง: ตัวเลข top ได้รับการทดสอบและคำนึงถึงขอบเขตจริง", () => {
    // กรอบสูงที่บังคับให้ใช้ 'over': top ใกล้ 0 (ไม่พอเหนือ) bottom ใกล้ bottomLimit (ไม่พอล่าง)
    const placement = confirmBarPlacement({ left: 0, top: 5, right: 100, bottom: 685 }, limits);
    expect(placement.side).toBe('over');
    // middle = (5 + 685) / 2 - 48 / 2 = 345 - 24 = 321
    expect(placement.top).toBe(321);
    // ตรวจสอบว่าไม่ล้ำเข้าแถบปุ่มแม้ว่าเป็น 'over'
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.top + limits.barHeight).toBeLessThanOrEqual(limits.bottomLimit);
  });
});
