import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureViewport, watchViewport } from './viewport.js';

describe('measureViewport', () => {
  it('reports the visual height, not the layout height', () => {
    expect(measureViewport(800, 500)).toEqual({ height: 500 });
  });

  it('falls back to the layout viewport without visualViewport', () => {
    expect(measureViewport(800)).toEqual({ height: 800 });
  });
});

/**
 * จำลอง window/document เท่าที่ watchViewport ใช้ เพื่อทดสอบว่ามันผูก listener
 * ครบตามเหตุการณ์ที่ทำให้ viewport เปลี่ยนจริง — โดยเฉพาะตอนกลับมาจากสลับแอป
 */
function stubDom(innerHeight: number, visualHeight: number) {
  const listeners = new Map<string, Set<(e?: unknown) => void>>();
  const add = (target: string) => (type: string, fn: (e?: unknown) => void) => {
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
  };
  const remove = (target: string) => (type: string, fn: (e?: unknown) => void) => {
    listeners.get(`${target}:${type}`)?.delete(fn);
  };

  const vars = new Map<string, string>();
  const win = {
    innerHeight,
    visualViewport: {
      height: visualHeight,
      offsetTop: 0,
      addEventListener: add('vv'),
      removeEventListener: remove('vv'),
    },
    addEventListener: add('win'),
    removeEventListener: remove('win'),
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout),
  };
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    documentElement: { style: { setProperty: (k: string, v: string) => vars.set(k, v) } },
    addEventListener: add('doc'),
    removeEventListener: remove('doc'),
  };

  const prevWin = (globalThis as any).window;
  const prevDoc = (globalThis as any).document;
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  return {
    win,
    doc,
    vars,
    fire: (key: string) => {
      const fns = listeners.get(key);
      expect(fns, `ไม่มี listener สำหรับ ${key}`).toBeDefined();
      for (const fn of fns!) fn({});
    },
    has: (key: string) => (listeners.get(key)?.size ?? 0) > 0,
    restore: () => {
      (globalThis as any).window = prevWin;
      (globalThis as any).document = prevDoc;
    },
  };
}

describe('watchViewport', () => {
  let dom: ReturnType<typeof stubDom> | undefined;
  afterEach(() => { dom?.restore(); dom = undefined; vi.useRealTimers(); });

  it('re-measures when the tab becomes visible again after an app switch', () => {
    dom = stubDom(800, 500);   // ตอนสลับแอปออกไป คีย์บอร์ดยังเปิดอยู่
    const stop = watchViewport(() => {});
    expect(dom.vars.get('--visible-height')).toBe('500px');

    // ระบบซ่อนคีย์บอร์ดตอนหน้าอยู่เบื้องหลัง จึงไม่มี visualViewport resize ถึงเรา
    dom.win.visualViewport.height = 800;
    dom.fire('doc:visibilitychange');

    expect(dom.vars.get('--visible-height')).toBe('800px');
    stop();
  });

  it('ignores a visibilitychange that hides the page', () => {
    dom = stubDom(800, 500);
    const stop = watchViewport(() => {});
    dom.doc.visibilityState = 'hidden';
    dom.win.visualViewport.height = 800;   // ค่าที่อ่านตอนหน้าถูกซ่อนเชื่อไม่ได้
    dom.fire('doc:visibilitychange');

    expect(dom.vars.get('--visible-height')).toBe('500px');
    stop();
  });

  it('re-measures on pageshow and on window resize', () => {
    dom = stubDom(800, 500);
    const stop = watchViewport(() => {});

    dom.win.visualViewport.height = 700;
    dom.fire('win:pageshow');
    expect(dom.vars.get('--visible-height')).toBe('700px');

    dom.win.visualViewport.height = 800;
    dom.fire('win:resize');
    expect(dom.vars.get('--visible-height')).toBe('800px');
    stop();
  });

  it('unbinds every listener it added', () => {
    dom = stubDom(800, 500);
    watchViewport(() => {})();
    for (const key of ['vv:resize', 'vv:scroll', 'win:orientationchange',
      'win:pageshow', 'win:resize', 'doc:visibilitychange']) {
      expect(dom.has(key), key).toBe(false);
    }
  });
});
