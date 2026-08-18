/**
 * แผ่นผลลัพธ์ — ที่เดียวในแอปที่ข้อความถูก "เลือกได้ด้วยนิ้วแบบ native"
 *
 * เหตุผลที่ต้องมี: ผู้ใช้อยากได้เมนู native (คัดลอก, แชร์, แปลภาษา) ที่ได้จากการ
 * กดค้างบนข้อความ แต่ตัว terminal ทำแบบนั้นไม่ได้ — xterm ตั้ง `user-select: none`
 * และ style.css ตั้ง `touch-action: none` ทับไว้ ยิ่งกว่านั้น การเลือกแบบ native
 * ไหลข้ามบรรทัดเชิงเส้นเสมอ จึงลากเส้นแบ่ง pane ติดมาด้วยทุกครั้ง ซึ่งคือปัญหาตั้งต้น
 *
 * แผ่นนี้แก้ทั้งสองข้อพร้อมกัน: ข้อความในนี้ถูกตัดคอลัมน์มาแล้ว (ไม่มีเส้นแบ่ง) และ
 * เป็น DOM ธรรมดาที่เปิด user-select ไว้ กดค้างจึงได้เมนูจริงของระบบ พร้อมปุ่ม
 * "คัดลอก" เป็นทางลัดสำหรับเคสปกติ
 *
 * ปุ่มคัดลอกที่ล้มเหลวต้อง *ไม่* ปิดแผ่น — การกดค้างเองคือทางหนีที่ใช้ได้จริง
 * ปิดแผ่นทิ้งตอนนั้นเท่ากับพาผู้ใช้เข้าทางตัน
 */

/** สถานะของคำใบ้บนแผ่น — แยกออกมาเพื่อให้เทสได้โดยไม่ต้องมี DOM เหมือน keybar.ts */
export type SheetHint = 'idle' | 'copy-failed';

export function sheetHintText(hint: SheetHint): string {
  return hint === 'copy-failed'
    ? 'คัดลอกอัตโนมัติไม่ได้ — กดค้างบนข้อความแล้วเลือก Copy'
    : 'กดค้างบนข้อความเพื่อเปิดเมนูของระบบ';
}

/**
 * ผลของการกดปุ่มคัดลอก
 *
 * ล้มเหลวแล้ว *ไม่* ปิดแผ่น เพราะการกดค้างเลือกเองคือทางหนีที่ยังใช้ได้จริง
 * ปิดทิ้งตอนนั้นเท่ากับพาผู้ใช้เข้าทางตัน
 */
export function sheetStateAfterCopy(ok: boolean): { hint: SheetHint; close: boolean } {
  return ok ? { hint: 'idle', close: true } : { hint: 'copy-failed', close: false };
}

export interface SelectionSheet {
  open(text: string): void;
  close(): void;
  isOpen(): boolean;
  element: HTMLElement;
}

export function createSelectionSheet(deps: {
  copy: (text: string) => Promise<{ ok: boolean }>;
  onClose: () => void;
  document?: Document;
}): SelectionSheet {
  const doc = deps.document ?? document;
  let current = '';

  const root = doc.createElement('div');
  root.className = 'sheet';
  root.hidden = true;

  const backdrop = doc.createElement('div');
  backdrop.className = 'sheet-backdrop';

  const panel = doc.createElement('div');
  panel.className = 'sheet-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ข้อความที่เลือก');

  const hint = doc.createElement('p');
  hint.className = 'sheet-hint';
  hint.textContent = sheetHintText('idle');

  const pre = doc.createElement('pre');
  pre.className = 'sheet-text';

  const actions = doc.createElement('div');
  actions.className = 'sheet-actions';

  const copyButton = doc.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'sheet-btn sheet-btn-copy';
  copyButton.textContent = 'คัดลอก';

  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'sheet-btn';
  closeButton.textContent = 'ปิด';

  actions.append(copyButton, closeButton);
  panel.append(hint, pre, actions);
  root.append(backdrop, panel);

  const close = (): void => {
    if (root.hidden) return;
    root.hidden = true;
    current = '';
    deps.onClose();
  };

  const applyHint = (next: SheetHint): void => {
    hint.textContent = sheetHintText(next);
    hint.classList.toggle('sheet-hint-warn', next === 'copy-failed');
  };

  copyButton.addEventListener('click', () => {
    void deps.copy(current).then(result => {
      const next = sheetStateAfterCopy(result.ok);
      applyHint(next.hint);
      if (next.close) close();
    });
  });

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  return {
    element: root,
    isOpen: () => !root.hidden,
    close,
    open(text: string): void {
      current = text;
      pre.textContent = text;
      applyHint('idle');
      root.hidden = false;
    },
  };
}
