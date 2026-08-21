import { describe, expect, it, vi } from 'vitest';
import { confirmBarPlacement, createSelectionHandles, handleAnchors, handleVisibility } from './selection-handles.js';

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

// ─────────────────────── การส่งต่อการลากหมุด ───────────────────────
//
// environment ของ repo นี้คือ 'node' (ไม่มี DOM จริง) จึงต้องปลอม document ขั้นต่ำที่สุด
// เท่าที่ createSelectionHandles เรียกใช้จริง: createElement คืน element ปลอมที่เก็บ
// listener ของตัวเองและ dispatch ได้ ส่วน document เก็บ listener ที่ผูก/ถอดเป็น Set ต่อ
// event type ให้ตรวจนับได้ตรงๆ ว่าตอนนี้มีกี่ตัวติดอยู่จริง

type FakeElement = {
  style: Record<string, string>;
  dataset: Record<string, string>;
  children: FakeElement[];
  hidden: boolean;
  className: string;
  textContent: string;
  type: string;
  disabled: boolean;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
  removeEventListener: (type: string, fn: (e: unknown) => void) => void;
  append: (...els: FakeElement[]) => void;
  dispatch: (type: string, event: unknown) => void;
};

function makeFakeElement(): FakeElement {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    style: {},
    dataset: {},
    children: [],
    hidden: false,
    className: '',
    textContent: '',
    type: '',
    disabled: false,
    setAttribute() {},
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    append(...els) {
      this.children.push(...els);
    },
    dispatch(type, event) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
  };
}

type DocTouchEvent = 'touchmove' | 'touchend' | 'touchcancel';

function makeFakeDocument() {
  const docListeners: Record<DocTouchEvent, Set<(e: unknown) => void>> = {
    touchmove: new Set(),
    touchend: new Set(),
    touchcancel: new Set(),
  };
  return {
    createElement: () => makeFakeElement(),
    addEventListener(type: string, fn: (e: unknown) => void) {
      docListeners[type as DocTouchEvent]?.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      docListeners[type as DocTouchEvent]?.delete(fn);
    },
    _listeners: docListeners,
  };
}

const touchEvent = (x: number, y: number) => ({
  preventDefault() {},
  changedTouches: [{ clientX: x, clientY: y }],
});

function setUp() {
  const doc = makeFakeDocument();
  const onGrab = vi.fn();
  const onDragMove = vi.fn();
  const onDragEnd = vi.fn();
  const handles = createSelectionHandles({
    onGrab,
    onDragMove,
    onDragEnd,
    onConfirm: () => {},
    onCancel: () => {},
    document: doc as unknown as Document,
  });
  const root = handles.element as unknown as FakeElement;
  const startHandle = root.children[0]!;
  return { doc, onGrab, onDragMove, onDragEnd, startHandle };
}

describe('การส่งต่อการลากหมุด (grab → move → release)', () => {
  it('จับหมุดแล้วผูก touchmove/touchend/touchcancel เข้า document ทั้งสามตัว', () => {
    const { doc, startHandle } = setUp();
    startHandle.dispatch('touchstart', touchEvent(1, 1));
    expect(doc._listeners.touchmove.size).toBe(1);
    expect(doc._listeners.touchend.size).toBe(1);
    expect(doc._listeners.touchcancel.size).toBe(1);
  });

  it('touchmove ระหว่างลากส่งพิกัดต่อให้ onDragMove', () => {
    const { doc, startHandle, onDragMove } = setUp();
    startHandle.dispatch('touchstart', touchEvent(1, 1));
    const [moveFn] = doc._listeners.touchmove;
    moveFn!(touchEvent(7, 8));
    expect(onDragMove).toHaveBeenCalledWith(7, 8);
  });

  it('touchend ถอด listener ทั้งสามตัวออกจาก document และส่ง onDragEnd ด้วยพิกัดสุดท้าย', () => {
    const { doc, startHandle, onDragEnd } = setUp();
    startHandle.dispatch('touchstart', touchEvent(1, 1));
    const [endFn] = doc._listeners.touchend;
    endFn!(touchEvent(9, 9));
    expect(doc._listeners.touchmove.size).toBe(0);
    expect(doc._listeners.touchend.size).toBe(0);
    expect(doc._listeners.touchcancel.size).toBe(0);
    expect(onDragEnd).toHaveBeenCalledWith(9, 9);
  });

  it('touchcancel ถอด listener ทั้งสามตัวเหมือน touchend', () => {
    const { doc, startHandle } = setUp();
    startHandle.dispatch('touchstart', touchEvent(1, 1));
    const [cancelFn] = doc._listeners.touchcancel;
    cancelFn!(touchEvent(2, 2));
    expect(doc._listeners.touchmove.size).toBe(0);
    expect(doc._listeners.touchend.size).toBe(0);
    expect(doc._listeners.touchcancel.size).toBe(0);
  });

  it('regression (Finding 5): touchstart ซ้ำก่อนปล่อยนิ้วต้องไม่ทิ้ง listener ชุดแรกค้างถาวร', () => {
    const { doc, startHandle, onGrab } = setUp();
    startHandle.dispatch('touchstart', touchEvent(1, 1));
    expect(doc._listeners.touchmove.size).toBe(1);
    expect(doc._listeners.touchend.size).toBe(1);
    expect(doc._listeners.touchcancel.size).toBe(1);

    // นิ้วที่สองแตะหมุดเดียวกันซ้ำก่อนนิ้วแรกปล่อย — ถ้าไม่ detach() ก่อนผูกใหม่
    // จะกลายเป็น listener สองชุดค้างอยู่ (ชุดแรกไม่มีใครเรียก detach ของมันได้อีกเลย
    // เพราะตัวแปร move/end ในโมดูลถูกทับด้วยชุดที่สองไปแล้ว)
    startHandle.dispatch('touchstart', touchEvent(2, 2));
    expect(onGrab).toHaveBeenCalledTimes(2);
    expect(doc._listeners.touchmove.size).toBe(1);
    expect(doc._listeners.touchend.size).toBe(1);
    expect(doc._listeners.touchcancel.size).toBe(1);

    // ปล่อยนิ้วครั้งเดียวต้องถอดให้หมดสนิท ไม่เหลือชุดใดค้างอยู่เลย — ถ้ามีชุดที่หนึ่งค้าง
    // อยู่จริง size จะไม่มีทาง 0 ได้เพราะ removeEventListener ของ document ปลอมนี้ลบ
    // เฉพาะ reference ที่ระบุเป๊ะๆ เท่านั้น
    const [endFn] = doc._listeners.touchend;
    endFn!(touchEvent(3, 3));
    expect(doc._listeners.touchmove.size).toBe(0);
    expect(doc._listeners.touchend.size).toBe(0);
    expect(doc._listeners.touchcancel.size).toBe(0);
  });
});
