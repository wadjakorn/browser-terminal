import { describe, it, expect, beforeEach } from 'vitest';
import { createGestureRecognizer, type Gesture, type Point } from './touch-gestures.js';

let out: Gesture[];
let clock: number;
let r: ReturnType<typeof createGestureRecognizer>;

const p = (id: number, x: number, y: number): Point => ({ id, x, y });

beforeEach(() => {
  out = [];
  clock = 1000;
  r = createGestureRecognizer({
    emit: g => out.push(g),
    now: () => clock,
    moveThresholdPx: 8,
    tapMaxMs: 300,
    doubleTapMaxMs: 300,
  });
});

const kinds = () => out.map(g => g.kind);
const wheelTotal = () =>
  out.filter(g => g.kind === 'wheel').reduce((s, g) => s + (g as { lines: number }).lines, 0);

describe('แตะครั้งเดียว', () => {
  it('แตะแล้วปล่อยเร็วโดยไม่ขยับ = tap พร้อมพิกัด', () => {
    r.onTouchStart([p(1, 100, 200)]);
    clock += 50;
    r.onTouchEnd([]);
    expect(out).toEqual([{ kind: 'tap', x: 100, y: 200 }]);
  });

  it('กดค้างนานเกิน tapMaxMs แล้วปล่อย ไม่นับเป็น tap', () => {
    r.onTouchStart([p(1, 100, 200)]);
    clock += 500;
    r.onTouchEnd([]);
    expect(kinds()).toEqual([]);
  });

  it('ขยับเกิน threshold แล้วปล่อย ไม่นับเป็น tap', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 240)]);
    clock += 50;
    r.onTouchEnd([]);
    expect(kinds()).not.toContain('tap');
  });
});

describe('แตะสองครั้ง', () => {
  it('แตะสองครั้งเร็วและใกล้กัน = doubleTap ไม่ใช่ tap ซ้ำ', () => {
    r.onTouchStart([p(1, 50, 50)]); clock += 40; r.onTouchEnd([]);
    clock += 100;
    r.onTouchStart([p(1, 52, 53)]); clock += 40; r.onTouchEnd([]);
    expect(kinds()).toEqual(['tap', 'doubleTap']);
  });

  it('แตะสองครั้งช้าเกินไป = tap สองครั้ง', () => {
    r.onTouchStart([p(1, 50, 50)]); clock += 40; r.onTouchEnd([]);
    clock += 900;
    r.onTouchStart([p(1, 50, 50)]); clock += 40; r.onTouchEnd([]);
    expect(kinds()).toEqual(['tap', 'tap']);
  });

  it('แตะสองครั้งคนละที่ = tap สองครั้ง', () => {
    r.onTouchStart([p(1, 50, 50)]); clock += 40; r.onTouchEnd([]);
    clock += 100;
    r.onTouchStart([p(1, 300, 400)]); clock += 40; r.onTouchEnd([]);
    expect(kinds()).toEqual(['tap', 'tap']);
  });

  it('แตะสามครั้งรัวๆ ไม่ยิง doubleTap ซ้อนกันเอง', () => {
    for (let i = 0; i < 3; i++) {
      r.onTouchStart([p(1, 50, 50)]); clock += 40; r.onTouchEnd([]); clock += 100;
    }
    expect(kinds()).toEqual(['tap', 'doubleTap', 'tap']);
  });
});

describe('กดค้างแล้วลาก = ลากเมาส์ (ย่อ/ขยาย sidebar ของ herdr)', () => {
  /** เดินนาฬิกาไปข้างหน้าทีละเฟรมพร้อมเรียก tick — เลียนแบบ rAF ของจริง */
  const advance = (ms: number): void => {
    for (let left = ms; left > 0; left -= 16.67) {
      clock += Math.min(16.67, left);
      r.tick();
    }
  };

  it('กดค้างครบเวลาโดยไม่ขยับ = dragStart ที่จุดที่กด', () => {
    r.onTouchStart([p(1, 120, 300)]);
    advance(450);
    expect(out).toEqual([{ kind: 'dragStart', x: 120, y: 300 }]);
  });

  it('ยังไม่ครบเวลา ยังไม่ยิงอะไร', () => {
    r.onTouchStart([p(1, 120, 300)]);
    advance(200);
    expect(out).toEqual([]);
  });

  it('หลัง dragStart การขยับกลายเป็น dragMove ไม่ใช่ wheel', () => {
    r.onTouchStart([p(1, 120, 300)]);
    advance(450);
    r.onTouchMove([p(1, 200, 305)]);
    r.onTouchMove([p(1, 260, 310)]);
    expect(kinds()).toEqual(['dragStart', 'dragMove', 'dragMove']);
    expect(out.at(-1)).toEqual({ kind: 'dragMove', x: 260, y: 310 });
  });

  it('ยกนิ้ว = dragEnd และไม่นับเป็น tap', () => {
    r.onTouchStart([p(1, 120, 300)]);
    advance(450);
    r.onTouchMove([p(1, 200, 300)]);
    r.onTouchEnd([]);
    expect(kinds()).toEqual(['dragStart', 'dragMove', 'dragEnd']);
    expect(out.at(-1)).toEqual({ kind: 'dragEnd', x: 200, y: 300 });
  });

  // ถ้าไม่ยิง dragEnd ตรงนี้ herdr จะคิดว่าปุ่มเมาส์ยังถูกกดค้างอยู่ตลอดกาล
  it('touchcancel ระหว่างลาก = dragEnd ห้ามค้างปุ่มไว้', () => {
    r.onTouchStart([p(1, 120, 300)]);
    advance(450);
    r.onTouchMove([p(1, 200, 300)]);
    r.onTouchCancel();
    expect(kinds()).toEqual(['dragStart', 'dragMove', 'dragEnd']);
  });

  it('touchcancel ตอนยังไม่ได้ลาก ไม่ยิง dragEnd ลอยๆ', () => {
    r.onTouchStart([p(1, 120, 300)]);
    r.onTouchCancel();
    expect(kinds()).toEqual([]);
  });

  it('ขยับก่อนครบเวลา = scroll ตามเดิม ไม่กลายเป็น drag แม้ปล่อยนิ้วนิ่งต่อ', () => {
    r.onTouchStart([p(1, 100, 300)]);
    r.onTouchMove([p(1, 100, 260)]);
    advance(450);
    expect(kinds()).not.toContain('dragStart');
    expect(wheelTotal()).toBeGreaterThan(0);
  });

  it('ขยับนิดเดียว (ยังไม่เกิน threshold) ไม่ยกเลิกการกดค้าง — นิ้วสั่นเป็นเรื่องปกติ', () => {
    r.onTouchStart([p(1, 100, 300)]);
    advance(200);
    r.onTouchMove([p(1, 103, 302)]);
    advance(250);
    expect(kinds()).toEqual(['dragStart']);
  });

  it('นิ้วที่สองแตะระหว่างรอ = pinch ไม่ใช่ drag', () => {
    r.onTouchStart([p(1, 100, 300)]);
    advance(100);
    r.onTouchStart([p(1, 100, 300), p(2, 200, 300)]);
    advance(450);
    expect(kinds()).not.toContain('dragStart');
  });

  it('tick คืน true ระหว่างรอครบเวลา แล้วคืน false เมื่อเข้าโหมดลากแล้ว', () => {
    r.onTouchStart([p(1, 100, 300)]);
    clock += 16.67;
    expect(r.tick()).toBe(true);
    advance(450);
    clock += 16.67;
    expect(r.tick()).toBe(false);
  });

  it('ปิดได้ด้วย longPressMs = 0 — กดค้างนานแค่ไหนก็ไม่กลายเป็น drag', () => {
    const off: Gesture[] = [];
    const r2 = createGestureRecognizer({
      emit: g => off.push(g), now: () => clock, longPressMs: 0,
    });
    r2.onTouchStart([p(1, 100, 300)]);
    clock += 2000;
    expect(r2.tick()).toBe(false);
    expect(off).toEqual([]);
  });
});

describe('นิ้วเดียวลาก = wheel', () => {
  it('ยังไม่เกิน threshold ยังไม่ยิงอะไร', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 205)]);
    expect(out).toEqual([]);
  });

  it('ลากนิ้วลง = เลื่อนดูของเก่า (ค่าติดลบ ตามความหมายของ WheelEvent)', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 260)]);
    expect(wheelTotal()).toBeLessThan(0);
  });

  it('ลากนิ้วขึ้น = เลื่อนดูของใหม่ (ค่าเป็นบวก)', () => {
    r.onTouchStart([p(1, 100, 300)]);
    r.onTouchMove([p(1, 100, 240)]);
    expect(wheelTotal()).toBeGreaterThan(0);
  });

  it('จำนวนบรรทัดที่ยิงออกไป = ระยะที่นิ้วขยับ หารด้วยขนาดขั้น', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 230)]);
    r.onTouchMove([p(1, 100, 260)]);
    r.onTouchMove([p(1, 100, 300)]);
    expect(wheelTotal()).toBe(-5);          // 100px ÷ ขั้นละ 20 = 5 บรรทัด
  });

  // xterm ส่ง mouse report หนึ่งครั้งต่อหนึ่ง wheel event ไม่ว่า deltaY จะมากแค่ไหน
  // (ดู CoreBrowserTerminal.sendEvent — `lines` ถูกใช้เป็นแค่ gate ว่า != 0)
  // จำนวน event ที่เรายิงจึงเป็นตัวกำหนดความเร็ว scroll ไม่ใช่ระยะทางรวม
  it('ยิงหนึ่ง event ต่อหนึ่งขั้น เพื่อให้ 1 บรรทัดของนิ้ว = 1 คลิกของ wheel', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 300)]);              // 100px, ขั้นละ 20 → 5 คลิก
    const wheels = out.filter(g => g.kind === 'wheel');
    expect(wheels).toHaveLength(5);
    // หนึ่งบรรทัดต่อหนึ่ง event — ห้ามยุบเป็น event เดียวที่ lines -5
    expect(wheels.every(w => (w as { lines: number }).lines === -1)).toBe(true);
  });

  it('เศษที่ไม่ครบขั้นถูกเก็บไว้ทบกับการขยับครั้งถัดไป', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 215)]);              // 15px — ยังไม่ครบ 20
    r.onTouchMove([p(1, 100, 225)]);              // รวม 25px → ครบ 1 ขั้น
    expect(out.filter(g => g.kind === 'wheel')).toHaveLength(1);
  });

  it('ขนาดขั้นตั้งค่าได้ เพื่อผูกกับความสูงบรรทัดจริงของ xterm', () => {
    out = [];
    const r2 = createGestureRecognizer({
      emit: g => out.push(g), now: () => clock, moveThresholdPx: 8, wheelStepPx: 50,
    });
    r2.onTouchStart([p(1, 100, 200)]);
    r2.onTouchMove([p(1, 100, 300)]);             // 100px, ขั้นละ 50 → 2 คลิก
    expect(out.filter(g => g.kind === 'wheel')).toHaveLength(2);
  });

  it('wheel พกพิกัดปัจจุบันไปด้วย เพื่อให้ TUI รู้ว่าเลื่อน pane ไหน', () => {
    r.onTouchStart([p(1, 300, 200)]);
    r.onTouchMove([p(1, 300, 260)]);
    const w = out.find(g => g.kind === 'wheel') as { x: number; y: number };
    expect([w.x, w.y]).toEqual([300, 260]);
  });

  it('การขยับแนวนอนล้วนไม่ยิง wheel', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 200, 200)]);
    expect(kinds()).not.toContain('wheel');
  });
});

describe('สองนิ้ว = zoom', () => {
  it('ถ่างออกได้ scale > 1', () => {
    r.onTouchStart([p(1, 100, 100), p(2, 200, 100)]);   // ห่าง 100
    r.onTouchMove([p(1, 50, 100), p(2, 250, 100)]);     // ห่าง 200
    expect(out).toEqual([{ kind: 'zoom', scale: 2 }]);
  });

  it('บีบเข้าได้ scale < 1', () => {
    r.onTouchStart([p(1, 100, 100), p(2, 200, 100)]);
    r.onTouchMove([p(1, 125, 100), p(2, 175, 100)]);
    expect(out).toEqual([{ kind: 'zoom', scale: 0.5 }]);
  });

  it('scale วัดจากระยะตอนเริ่มเสมอ ไม่ใช่สะสมทีละก้าว', () => {
    r.onTouchStart([p(1, 100, 100), p(2, 200, 100)]);
    r.onTouchMove([p(1, 75, 100), p(2, 225, 100)]);
    r.onTouchMove([p(1, 50, 100), p(2, 250, 100)]);
    const zooms = out.filter(g => g.kind === 'zoom') as { scale: number }[];
    expect(zooms.map(z => z.scale)).toEqual([1.5, 2]);
  });

  it('วัดระยะแบบยุคลิด ไม่ใช่แกนเดียว', () => {
    r.onTouchStart([p(1, 0, 0), p(2, 30, 40)]);         // ห่าง 50
    r.onTouchMove([p(1, 0, 0), p(2, 60, 80)]);          // ห่าง 100
    expect(out).toEqual([{ kind: 'zoom', scale: 2 }]);
  });
});

describe('การสลับจำนวนนิ้วกลางคัน', () => {
  it('นิ้วที่สองมาระหว่างลาก หยุด wheel แล้วเปลี่ยนเป็น zoom', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 260)]);
    const wheelsBefore = out.filter(g => g.kind === 'wheel').length;
    expect(wheelsBefore).toBeGreaterThan(0);

    r.onTouchStart([p(1, 100, 260), p(2, 200, 260)]);
    r.onTouchMove([p(1, 50, 260), p(2, 250, 260)]);

    expect(out.filter(g => g.kind === 'wheel').length).toBe(wheelsBefore);
    expect(kinds()).toContain('zoom');
  });

  it('ยกเหลือนิ้วเดียวหลัง zoom ไม่กลายเป็น wheel กระโดด', () => {
    r.onTouchStart([p(1, 100, 100), p(2, 200, 100)]);
    r.onTouchMove([p(1, 50, 100), p(2, 250, 100)]);
    r.onTouchEnd([p(1, 50, 100)]);
    r.onTouchMove([p(1, 50, 400)]);
    expect(kinds()).not.toContain('wheel');
  });

  it('ยกครบทุกนิ้วหลัง zoom ไม่นับเป็น tap', () => {
    r.onTouchStart([p(1, 100, 100), p(2, 200, 100)]);
    clock += 50;
    r.onTouchEnd([p(1, 100, 100)]);
    r.onTouchEnd([]);
    expect(kinds()).not.toContain('tap');
  });
});

describe('touchcancel', () => {
  it('ล้าง state ทั้งหมด การขยับหลังจากนั้นไม่ยิงอะไร', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchMove([p(1, 100, 260)]);
    out.length = 0;
    r.onTouchCancel();
    r.onTouchMove([p(1, 100, 400)]);
    r.onTouchEnd([]);
    expect(out).toEqual([]);
  });

  it('หลัง cancel แล้วเริ่มใหม่ยังทำงานปกติ', () => {
    r.onTouchStart([p(1, 100, 200)]);
    r.onTouchCancel();
    r.onTouchStart([p(1, 10, 20)]);
    clock += 40;
    r.onTouchEnd([]);
    expect(out).toEqual([{ kind: 'tap', x: 10, y: 20 }]);
  });
});

describe('momentum — ไหลต่อหลังสะบัดนิ้ว', () => {
  /** ขับ tick ทีละเฟรมจนกว่าจะหยุด คืนจำนวนเฟรมที่วิ่ง */
  const runToStop = (maxFrames = 600): number => {
    let frames = 0;
    while (frames < maxFrames) {
      clock += 16.67;
      if (!r.tick()) break;
      frames++;
    }
    return frames;
  };

  const flick = (pxPerMs: number, ms = 100): void => {
    r.onTouchStart([p(1, 100, 500)]);
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      clock += ms / steps;
      r.onTouchMove([p(1, 100, 500 - pxPerMs * (ms / steps) * i)]);
    }
    r.onTouchEnd([]);
  };

  it('สะบัดเร็วแล้วปล่อย ยังยิง wheel ต่อหลังนิ้วออกจากจอ', () => {
    flick(2);
    const duringDrag = out.filter(g => g.kind === 'wheel').length;
    runToStop();
    expect(out.filter(g => g.kind === 'wheel').length).toBeGreaterThan(duringDrag);
  });

  it('ยิ่งสะบัดเร็ว ยิ่งไหลไกล', () => {
    flick(0.6);
    runToStop();
    const slow = out.filter(g => g.kind === 'wheel').length;

    out = []; clock += 5000;
    flick(2.4);
    runToStop();
    const fast = out.filter(g => g.kind === 'wheel').length;

    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('ลากช้าๆ แล้วปล่อยเฉยๆ ไม่มี momentum', () => {
    r.onTouchStart([p(1, 100, 500)]);
    for (let i = 1; i <= 10; i++) { clock += 100; r.onTouchMove([p(1, 100, 500 - i * 5)]); }
    r.onTouchEnd([]);
    const afterRelease = out.filter(g => g.kind === 'wheel').length;
    runToStop();
    expect(out.filter(g => g.kind === 'wheel').length).toBe(afterRelease);
  });

  it('วัดความเร็วจากช่วงท้ายเท่านั้น — ลากช้าแล้วสะบัดตอนจบก็ต้องได้ momentum', () => {
    r.onTouchStart([p(1, 100, 500)]);
    for (let i = 1; i <= 5; i++) { clock += 200; r.onTouchMove([p(1, 100, 500 - i * 5)]); }  // ช้ามาก
    for (let i = 1; i <= 4; i++) { clock += 12; r.onTouchMove([p(1, 100, 475 - i * 30)]); }  // สะบัดท้าย
    r.onTouchEnd([]);
    const afterRelease = out.filter(g => g.kind === 'wheel').length;
    runToStop();
    expect(out.filter(g => g.kind === 'wheel').length).toBeGreaterThan(afterRelease);
  });

  it('ชะลอลงแล้วหยุดเอง ไม่วิ่งตลอดกาล', () => {
    flick(2.4);
    const frames = runToStop();
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(200);          // ~2 วินาทีที่ 60fps
    clock += 16.67;
    expect(r.tick()).toBe(false);  // ยืนยันว่าจบจริง
  });

  it('ทิศทางคงเดิม — สะบัดขึ้นแล้วไหลขึ้นต่อ ไม่กลับทาง', () => {
    flick(2);   // นิ้วขึ้น → เลื่อนดูของใหม่ → ค่าเป็นบวก
    out = [];
    runToStop();
    const wheels = out.filter(g => g.kind === 'wheel') as { lines: number }[];
    expect(wheels.length).toBeGreaterThan(0);
    expect(wheels.every(w => w.lines > 0)).toBe(true);
  });

  it('แตะระหว่าง momentum วิ่งอยู่ = หยุดทันที', () => {
    flick(2.4);
    clock += 16.67; r.tick();
    r.onTouchStart([p(1, 100, 300)]);
    out = [];
    // tick ยัง true อยู่เพราะเปลี่ยนไปนับเวลากดค้างแทน — ที่ต้องพิสูจน์คือ
    // ไม่มี wheel ไหลออกมาอีก ไม่ใช่ว่าลูป rAF หยุด
    clock += 100; r.tick();
    expect(out.filter(g => g.kind === 'wheel')).toHaveLength(0);
  });

  it('touchcancel หยุด momentum ด้วย', () => {
    flick(2.4);
    r.onTouchCancel();
    clock += 16.67;
    expect(r.tick()).toBe(false);
  });

  it('tick ตอนไม่มีอะไรวิ่งอยู่ คืน false และไม่ยิงอะไร', () => {
    clock += 100;
    expect(r.tick()).toBe(false);
    expect(out).toEqual([]);
  });
});
