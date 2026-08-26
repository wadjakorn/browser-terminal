import { describe, expect, it } from 'vitest';
import { TRANSIENT, createStatus, renderStatus, type StatusView } from './status.js';

function setup() {
  const rendered: (StatusView | null)[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;

  const status = createStatus({
    render: view => { rendered.push(view); },
    setTimeout: (fn, ms) => { const id = next++; timers.push({ fn, ms, id }); return id; },
    clearTimeout: id => {
      const at = timers.findIndex(timer => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  });

  return {
    status,
    timers,
    rendered,
    last: () => rendered.at(-1),
    fire: () => { timers.shift()?.fn(); },
  };
}

describe('createStatus', () => {
  it('แสดงข้อความ แล้วซ่อนเมื่อส่ง null', () => {
    const { status, last } = setup();

    status.show('กำลังต่อใหม่…');
    expect(last()).toEqual({ text: 'กำลังต่อใหม่…', title: undefined, dismissible: false });

    status.show(null);
    expect(last()).toBeNull();
  });

  it('ข้อความสถานะไม่มีตัวจับเวลาและไม่มีปุ่มปิด — มันต้องค้างไว้', () => {
    const { status, timers, last } = setup();

    status.show('shell ปิดแล้ว — โหลดหน้านี้ใหม่เพื่อเริ่มใหม่');

    expect(timers).toHaveLength(0);
    expect(last()?.dismissible).toBe(false);
  });

  it('ข้อความแจ้งผลมีปุ่มปิด และซ่อนตัวเองเมื่อครบเวลา', () => {
    const { status, timers, last, fire } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    expect(last()?.dismissible).toBe(true);
    expect(timers[0]!.ms).toBe(6000);

    fire();
    expect(last()).toBeNull();
  });

  it('ตัวจับเวลาของข้อความเก่าต้องไม่ซ่อนข้อความใหม่ที่มาแทน', () => {
    const { status, last, fire, timers } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    // เน็ตหลุดระหว่างที่ตัวจับเวลายังเดินอยู่ — ข้อความใหม่ต้องอยู่ต่อ
    status.show('กำลังต่อใหม่ใน 2 วิ…');

    // show() ยกเลิกตัวจับเวลาเก่าตั้งแต่ตอนเปลี่ยนข้อความ
    expect(timers).toHaveLength(0);
    fire();
    expect(last()).toEqual({ text: 'กำลังต่อใหม่ใน 2 วิ…', title: undefined, dismissible: false });
  });

  it('ตัวจับเวลาที่หลุดรอดมาได้ ยังต้องไม่ซ่อนข้อความที่มาทีหลัง', () => {
    const { status, last, timers } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    const stale = timers[0]!.fn;
    status.show('กำลังต่อใหม่ใน 2 วิ…');

    stale();

    expect(last()?.text).toBe('กำลังต่อใหม่ใน 2 วิ…');
  });

  it('path เต็มไปอยู่ใน title ไม่ใช่ในข้อความที่แสดง', () => {
    const { status, last } = setup();

    status.show('แนบรูปแล้ว: cat.jpg', { ...TRANSIENT, title: '/home/u/.cache/images/cat.jpg' });

    expect(last()?.text).toBe('แนบรูปแล้ว: cat.jpg');
    expect(last()?.title).toBe('/home/u/.cache/images/cat.jpg');
  });
});

/*
 * ช่องค้าง (sticky) — นี่คือทางตันที่เคยมีจริง: โดนเตะด้วย 4000 → แถบขึ้นปุ่ม
 * "ใช้ที่นี่" ซึ่งเป็นทางออกทางเดียว (stopped = true, ไม่มี timer ไหนมาต่อให้อีก)
 * → ผู้ใช้กดปุ่มแนบรูปที่ยังกดได้อยู่ → toast "ยังไม่ได้เชื่อมต่อ" ทับ → 6 วิผ่านไป
 * แถบว่างเปล่า ปุ่มทางออกหายไปแล้ว เหลือทางเดียวคือกด refresh ของเบราว์เซอร์
 */
describe('สถานะยืนพื้นที่ข้อความชั่วคราวลบทิ้งไม่ได้', () => {
  it('toast ที่หมดเวลา ถอยกลับไปที่ sticky ไม่ใช่หายไปเฉยๆ', () => {
    const { status, last, fire } = setup();
    const onClick = () => {};

    status.show('เปิดที่อื่นแล้ว', { sticky: true, action: { label: 'ใช้ที่นี่', onClick } });
    status.show('ยังไม่ได้เชื่อมต่อ — รอสักครู่แล้วลองใหม่', TRANSIENT);
    expect(last()?.text).toBe('ยังไม่ได้เชื่อมต่อ — รอสักครู่แล้วลองใหม่');

    fire();
    expect(last()?.text).toBe('เปิดที่อื่นแล้ว');
    expect(last()?.action).toEqual({ label: 'ใช้ที่นี่', onClick });
  });

  it('กดปิด toast ที่ทับอยู่ ก็ถอยกลับไปที่ sticky เหมือนกัน', () => {
    const { status, last } = setup();

    status.show('shell ปิดแล้ว', { sticky: true, action: { label: 'เริ่ม shell ใหม่', onClick: () => {} } });
    status.show('วางไม่สำเร็จ', TRANSIENT);

    status.dismiss();
    expect(last()?.text).toBe('shell ปิดแล้ว');
  });

  it('ตัวจับเวลาของ toast ที่ถูกกดปิดไปแล้ว ต้องไม่ลบ sticky ทีหลัง', () => {
    const { status, last, timers } = setup();

    status.show('shell ปิดแล้ว', { sticky: true, action: { label: 'เริ่ม shell ใหม่', onClick: () => {} } });
    status.show('วางไม่สำเร็จ', TRANSIENT);
    const stale = timers[0]!.fn;

    status.dismiss();
    stale();

    expect(last()?.text).toBe('shell ปิดแล้ว');
  });

  it('show(null) เท่านั้นที่ล้าง sticky ทิ้ง', () => {
    const { status, last, fire } = setup();

    status.show('เปิดที่อื่นแล้ว', { sticky: true, action: { label: 'ใช้ที่นี่', onClick: () => {} } });
    status.show(null);
    expect(last()).toBeNull();

    // ต่อติดแล้ว (restart) — toast ใบถัดไปต้องหายไปเป็น null ตามพฤติกรรมเดิม
    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    fire();
    expect(last()).toBeNull();
  });

  it('sticky ตัวใหม่แทนที่ตัวเก่า', () => {
    const { status, last, fire } = setup();

    status.show('เปิดที่อื่นแล้ว', { sticky: true, action: { label: 'ใช้ที่นี่', onClick: () => {} } });
    status.show('shell ปิดแล้ว', { sticky: true, action: { label: 'เริ่ม shell ใหม่', onClick: () => {} } });
    status.show('วางไม่สำเร็จ', TRANSIENT);

    fire();
    expect(last()?.text).toBe('shell ปิดแล้ว');
  });

  it('กดปิดตัว sticky เอง = ไล่มันไปจริงๆ ไม่ใช่วาดกลับมาให้ปุ่มปิดกดไม่ติด', () => {
    const { status, last } = setup();

    status.show('shell ปิดแล้ว', {
      sticky: true,
      dismissible: true,
      action: { label: 'เริ่ม shell ใหม่', onClick: () => {} },
    });

    status.dismiss();
    expect(last()).toBeNull();
  });

  it('ไม่มี sticky ค้างอยู่ dismiss ก็ล้างแถบตามเดิม', () => {
    const { status, last } = setup();
    status.show('แนบรูปแล้ว: cat.jpg', TRANSIENT);
    status.dismiss();
    expect(last()).toBeNull();
  });
});

describe('ปุ่ม action ในแถบสถานะ', () => {
  it('ส่ง action ต่อไปให้ผู้วาด', () => {
    const { status, last } = setup();
    const onClick = () => {};

    status.show('shell ปิดแล้ว', { action: { label: 'เริ่มใหม่', onClick } });

    expect(last()?.action).toEqual({ label: 'เริ่มใหม่', onClick });
  });

  it('ไม่มี action ก็ไม่มีฟิลด์นี้', () => {
    const { status, last } = setup();
    status.show('กำลังต่อใหม่…');
    expect(last()?.action).toBeUndefined();
  });
});

// ─────────────────────── renderStatus ───────────────────────
//
// environment ของ repo นี้คือ 'node' (ไม่มี DOM จริง) จึงปลอม document/element
// ขั้นต่ำที่สุดเท่าที่ renderStatus เรียกใช้จริง (ดูแพทเทิร์นเดียวกันใน
// selection-handles.test.ts): createElement คืน element ปลอมที่เก็บ listener
// ของตัวเอง append เข้า host แล้วหาด้วย className เพื่อกดปุ่มทดสอบได้

type FakeStatusElement = {
  ownerDocument: { createElement: (tag: string) => FakeStatusElement };
  className: string;
  textContent: string;
  type: string;
  title: string;
  hidden: boolean;
  children: FakeStatusElement[];
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, fn: () => void) => void;
  append: (...els: FakeStatusElement[]) => void;
  replaceChildren: (...els: FakeStatusElement[]) => void;
  querySelector: (selector: string) => FakeStatusElement | null;
};

function makeFakeHost(): FakeStatusElement {
  const listeners: Record<string, (() => void)[]> = {};
  const host: FakeStatusElement = {
    ownerDocument: { createElement: () => makeFakeHost() },
    className: '',
    textContent: '',
    type: '',
    title: '',
    hidden: false,
    children: [],
    setAttribute() {},
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
      if (type === 'click') {
        // เก็บไว้ให้ querySelector หา element นี้แล้วกดได้จากเทสต์
        (host as unknown as { _click: () => void })._click = () => {
          for (const listener of listeners.click ?? []) listener();
        };
      }
    },
    append(...els) {
      this.children.push(...els);
    },
    replaceChildren(...els) {
      this.children = els;
    },
    querySelector(selector: string) {
      const className = selector.replace(/^\./, '');
      for (const child of this.children) {
        if (child.className === className) return child;
      }
      return null;
    },
  };
  return host;
}

function click(el: FakeStatusElement | null): void {
  (el as unknown as { _click?: () => void })?._click?.();
}

describe('renderStatus', () => {
  it('วาดปุ่ม action แล้วเรียก onClick เมื่อกด', () => {
    const host = makeFakeHost();
    let clicked = 0;

    renderStatus(host as unknown as HTMLElement, {
      text: 'เปิดที่อื่นแล้ว',
      dismissible: false,
      action: { label: 'เชื่อมต่อใหม่', onClick: () => { clicked++; } },
    }, () => {});

    const button = host.querySelector('.status-action');
    expect(button?.textContent).toBe('เชื่อมต่อใหม่');
    click(button);
    expect(clicked).toBe(1);
  });

  /*
   * ลำดับสำคัญ: ปุ่ม action คือทางออกของผู้ใช้ ต้องอยู่ก่อนปุ่ม × ที่แค่ซ่อนข้อความ
   * ทั้งเพื่อสายตาและเพื่อลำดับ tab — สลับกันเมื่อไหร่ นิ้วโป้งบนมือถือจะเจอปุ่มปิด
   * ก่อนปุ่มที่พาออกจากสถานะ
   */
  it('วาดปุ่ม action ก่อนปุ่มปิดเสมอ', () => {
    const host = makeFakeHost();

    renderStatus(host as unknown as HTMLElement, {
      text: 'shell ปิดแล้ว',
      dismissible: true,
      action: { label: 'เริ่ม shell ใหม่', onClick: () => {} },
    }, () => {});

    expect(host.children.map(child => child.className))
      .toEqual(['status-text', 'status-action', 'status-close']);
  });

  it('ไม่มี action ก็ไม่มีปุ่ม', () => {
    const host = makeFakeHost();
    renderStatus(host as unknown as HTMLElement, { text: 'กำลังต่อใหม่…', dismissible: false }, () => {});
    expect(host.querySelector('.status-action')).toBeNull();
  });
});
