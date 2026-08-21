/**
 * หมุดปรับกรอบและแถบยืนยัน — DOM ทั้งหมดของโหมดเลือกที่ไม่ใช่ไฮไลต์
 *
 * ไฮไลต์เป็นของ xterm (DOM renderer วาดทรงบล็อกให้เอง) ไฟล์นี้รับผิดชอบเฉพาะสิ่งที่
 * ลอยอยู่เหนือมัน: หมุดสองมุมที่ลากปรับกรอบได้ และแถบยืนยัน
 *
 * ตรรกะการวางตำแหน่งทั้งหมดแยกเป็นฟังก์ชันบริสุทธิ์ที่ export ไว้ เพราะ vitest ของ repo นี้
 * รันบน environment 'node' ไม่มี DOM ให้เทส — แบบเดียวกับที่ selection-sheet.ts ทำ
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacementLimits {
  viewportHeight: number;
  /** ขอบล่างที่ใช้ได้จริง = top ของแถบปุ่ม ไม่ใช่ขอบ viewport */
  bottomLimit: number;
  barHeight: number;
}

/** ความสูงของแถบยืนยัน — keep synchronized with `.sel-confirm` in style.css */
export const CONFIRM_BAR_HEIGHT_PX = 48;

export function handleAnchors(rect: Rect): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return {
    start: { x: rect.left, y: rect.top },
    end: { x: rect.right, y: rect.bottom },
  };
}

/**
 * เหนือกรอบก่อน ตกลงใต้กรอบเมื่อชิดขอบบน ทับกรอบเมื่อไม่พอทั้งสองทาง
 *
 * ทับกรอบดีกว่าหลุดจอ — แถบที่มองไม่เห็นเท่ากับผู้ใช้ออกจากโหมดไม่ได้เลย
 * นอกจากไปกดปุ่ม ⧉ บนแถบปุ่มซึ่งอาจถูกนิ้วบังอยู่
 */
export function confirmBarPlacement(rect: Rect, limits: PlacementLimits): { side: 'above' | 'below' | 'over'; top: number } {
  /**
   * ตัวแปรสองตัว `top >= 0` และ `top + barHeight <= bottomLimit` อาจขัดแย้ง
   * เมื่อ viewport สั้นกว่าแถบยืนยัน (bottomLimit - barHeight < 0)
   * ในกรณีนี้ `top >= 0` ชนะ — แถบบนจอแม้จะทับแถบปุ่มก็ดีกว่า
   * แถบหลุดจอจะหลุดจากโหมดเลือกไม่ได้เลย และนิ้วอาจบังปุ่ม ⧉ บนแถบปุ่ม
   */
  const clamp = (value: number): number =>
    Math.max(0, Math.min(value, limits.bottomLimit - limits.barHeight));

  if (rect.top - limits.barHeight >= 0) {
    return { side: 'above', top: clamp(rect.top - limits.barHeight) };
  }
  if (rect.bottom + limits.barHeight <= limits.bottomLimit) {
    return { side: 'below', top: clamp(rect.bottom) };
  }
  return { side: 'over', top: clamp((rect.top + rect.bottom) / 2 - limits.barHeight / 2) };
}

/**
 * ซ่อนเฉพาะหมุดที่หลุดจอ ไม่ใช่ทั้งกรอบ — กรอบที่ยาวกว่าหนึ่งหน้าจอเกิดได้จาก
 * output ของ PTY ที่ไหลเข้ามาระหว่างที่ผู้ใช้กำลังปรับ ยกเลิกกรอบทิ้งตอนนั้น
 * เท่ากับลบงานที่ผู้ใช้เพิ่งทำเพราะเหตุที่ไม่ใช่ความผิดเขา
 *
 * หมุด end ต้องเช็คกับ limits.bottomLimit ด้วย ไม่ใช่แค่ viewportHeight — แถบยืนยัน
 * ถูก clip กับ bottomLimit (ขอบบนของแถบปุ่ม) อยู่แล้ว แต่หมุดถูก clip กับ viewportHeight
 * เฉยๆ ทำให้หมุด end โผล่ใต้ขอบบนของแถบปุ่มได้ วงกลม 44px ที่ pointer-events: auto
 * จึงคาบเกี่ยวแถบปุ่มและแย่งแตะแถวบนสุดของปุ่มไป
 *
 * clip ที่จุด anchor (rect.top/rect.bottom) ไม่ใช่ขอบวาดจริงของวงกลม — ตัวเลือกเดียวกับ
 * ที่โค้ดเดิมใช้กับ viewportHeight อยู่แล้ว (สม่ำเสมอกว่าการคิดครึ่งขนาดหมุดเพิ่ม) และ
 * เพราะ CSS วางหมุดด้วย negative margin ครึ่งขนาดตัวเอง "ล้ำ bottomLimit" ในที่นี้คือ
 * anchor อยู่ในระยะครึ่งหมุดจากเส้นนั้น ไม่ใช่ล้ำไปแล้วจริงๆ — ยอมรับความคลาดเคลื่อนนี้
 * เพื่อให้ตรรกะเรียบง่ายและเทสได้ตรงไปตรงมา
 */
export function handleVisibility(rect: Rect, limits: PlacementLimits): { start: boolean; end: boolean } {
  return {
    start: rect.top >= 0 && rect.top <= limits.viewportHeight,
    end: rect.bottom >= 0 && rect.bottom <= Math.min(limits.viewportHeight, limits.bottomLimit),
  };
}

export interface SelectionHandles {
  element: HTMLElement;
  /** rect เป็น null = ซ่อน overlay ทั้งอัน */
  place(rect: Rect | null, limits: PlacementLimits): void;
  setCopyEnabled(enabled: boolean): void;
}

export function createSelectionHandles(deps: {
  onGrab: (corner: 'start' | 'end') => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  document?: Document;
}): SelectionHandles {
  const doc = deps.document ?? document;

  const root = doc.createElement('div');
  root.className = 'sel-overlay';
  root.hidden = true;

  /**
   * นิ้วที่กดหมุดค้างเป็น target ของ touchmove/touchend อยู่ตลอดกัน แม้จะเลื่อนออกไป
   * ไกลแค่ไหน (เบราว์เซอร์ผูก touch กับ element ที่ touchstart ไว้ ไม่ใช่ตำแหน่งปัจจุบัน)
   * แต่หมุดเป็น element เล็กๆ ลอยอยู่บน .sel-overlay ที่ตรึงกับ #app ไม่ใช่ #terminal จึงไม่มี
   * ทางที่ bindTouch ใน main.ts จะเห็นอีเวนต์ต่อจาก touchstart นี้เลย — ต้องฟังเองที่นี่
   * ผูกที่ document ระหว่างลากเท่านั้นแล้วถอดทิ้งตอนปล่อยนิ้ว ไม่ผูกถาวร เพื่อไม่ให้ไป
   * แย่งอีเวนต์ที่ควรเป็นของจุดอื่นในหน้าเมื่อไม่ได้กำลังลากหมุดอยู่
   */
  const makeHandle = (corner: 'start' | 'end'): HTMLElement => {
    const handle = doc.createElement('div');
    handle.className = `sel-handle sel-handle-${corner}`;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', corner === 'start' ? 'ปรับมุมเริ่มต้น' : 'ปรับมุมสิ้นสุด');

    let move: ((e: TouchEvent) => void) | null = null;
    let end: ((e: TouchEvent) => void) | null = null;

    const detach = (): void => {
      if (move) doc.removeEventListener('touchmove', move);
      if (end) {
        doc.removeEventListener('touchend', end);
        doc.removeEventListener('touchcancel', end);
      }
      move = null;
      end = null;
    };

    // touchstart ไม่ใช่ click — ต้องจับให้ได้ตั้งแต่นิ้วแตะ ไม่ใช่ตอนปล่อย
    // preventDefault กันเบราว์เซอร์สังเคราะห์ mouse event ตามหลังซึ่งจะไปถึง xterm
    handle.addEventListener('touchstart', event => {
      event.preventDefault();
      // สองนิ้วลงบนหมุดเดียวกันยิง touchstart สองรอบ — ไม่ detach ก่อนแล้วผูกซ้ำ
      // คู่แรกจะค้างอยู่ที่ document ตลอดไปเพราะ end closure เดิมถูกตัวแปรตัวใหม่ทับ
      // ไปแล้ว ไม่มีทางเรียก detach() ของมันได้อีก กลายเป็น touchmove ถาวรที่กลืน
      // ทุกการแตะทั้งหน้าแม้ออกจากโหมดเลือกไปแล้ว
      detach();
      deps.onGrab(corner);

      move = (e: TouchEvent) => {
        e.preventDefault();   // กันเบราว์เซอร์เลื่อนหน้าเว็บระหว่างลากหมุด
        const touch = e.changedTouches[0];
        if (touch) deps.onDragMove(touch.clientX, touch.clientY);
      };
      end = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        detach();
        if (touch) deps.onDragEnd(touch.clientX, touch.clientY);
      };
      doc.addEventListener('touchmove', move, { passive: false });
      doc.addEventListener('touchend', end, { passive: false });
      doc.addEventListener('touchcancel', end, { passive: false });
    }, { passive: false });
    return handle;
  };

  const start = makeHandle('start');
  const end = makeHandle('end');

  const bar = doc.createElement('div');
  bar.className = 'sel-confirm';

  const copyButton = doc.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'sel-btn sel-btn-copy';
  copyButton.textContent = 'คัดลอก';
  copyButton.addEventListener('click', () => deps.onConfirm());

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'sel-btn';
  cancelButton.textContent = 'ยกเลิก';
  cancelButton.addEventListener('click', () => deps.onCancel());

  bar.append(copyButton, cancelButton);
  root.append(start, end, bar);

  return {
    element: root,
    setCopyEnabled(enabled: boolean): void { copyButton.disabled = !enabled; },
    place(rect: Rect | null, limits: PlacementLimits): void {
      if (!rect) {
        root.hidden = true;
        return;
      }
      root.hidden = false;

      const anchors = handleAnchors(rect);
      const visible = handleVisibility(rect, limits);

      start.hidden = !visible.start;
      start.style.left = `${anchors.start.x}px`;
      start.style.top = `${anchors.start.y}px`;

      end.hidden = !visible.end;
      end.style.left = `${anchors.end.x}px`;
      end.style.top = `${anchors.end.y}px`;

      const placement = confirmBarPlacement(rect, limits);
      bar.style.top = `${placement.top}px`;
      bar.dataset.side = placement.side;
    },
  };
}
