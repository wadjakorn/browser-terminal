// web/keybar.ts
import type { BarKey } from './input-pipeline.js';

export interface ButtonSpec { label: string; key: BarKey }

/**
 * จำนวนช่องสูงสุดในหนึ่งแถว รวมปุ่มที่ตรึงไว้ (⇄ กับ ⌨) แล้ว
 *
 * มาจากเลขจริง ไม่ใช่ค่าที่เลือกเอาสวย: จอแคบสุดที่ยังต้องรองรับคือ 360px
 * หัก padding แล้วเหลือ ~349px ปุ่มกว้าง 40px + ช่องไฟ 4px ลงได้ 8 ช่องพอดี
 * ถ้าจะเพิ่มปุ่มต้องเพิ่มหน้า ไม่ใช่เพิ่มช่อง ไม่งั้นแถวจะกลับไปล้นและต้อง
 * เลื่อนแนวนอนเหมือนเดิม
 */
export const SLOTS_PER_ROW = 8;
/** ⇄ กับ ⌨ อยู่ครบทุกหน้า จึงกินช่องถาวรหน้าละ 2 */
const PINNED = 2;
export const KEYS_PER_PAGE = SLOTS_PER_ROW - PINNED;

/**
 * แบ่งหน้าตามความถี่ที่ใช้จริง ไม่ได้เรียงตามหมวด
 *
 * หน้าแรกคือชุดที่ใช้ตลอดเวลาใน TUI และ claude-code — Esc ออกจากโหมด,
 * ⇧Tab สลับโหมดของ claude-code, ↑↓ เรียกคำสั่งเก่า
 * หน้าสองคือของที่ใช้เป็นครั้งคราว — แก้กลางบรรทัด และอักขระที่คีย์บอร์ด
 * Android ต้องกดสามชั้นกว่าจะเจอ (`|` กับ `~`)
 *
 * `/` กับ `-` ถูกตัดออกโดยตั้งใจ — อยู่หน้าแรกของแป้นสัญลักษณ์ Android
 * กดสองชั้นก็ถึง ไม่คุ้มกับช่องที่มีอยู่จำกัด
 */
export const PAGES: ButtonSpec[][] = [
  [
    { label: 'Esc',  key: { kind: 'literal', data: '\x1b' } },
    { label: 'Tab',  key: { kind: 'literal', data: '\t' } },
    // CSI Z = back-tab — claude-code ใช้สลับโหมด (auto-accept / plan)
    { label: '⇧Tab', key: { kind: 'literal', data: '\x1b[Z' } },
    { label: 'Ctrl', key: { kind: 'modifier', name: 'ctrl' } },
    { label: '↑',    key: { kind: 'literal', data: '\x1b[A' } },
    { label: '↓',    key: { kind: 'literal', data: '\x1b[B' } },
  ],
  [
    { label: 'Alt',  key: { kind: 'modifier', name: 'alt' } },
    { label: '←',    key: { kind: 'literal', data: '\x1b[D' } },
    { label: '→',    key: { kind: 'literal', data: '\x1b[C' } },
    { label: '|',    key: { kind: 'literal', data: '|' } },
    { label: '~',    key: { kind: 'literal', data: '~' } },
    { label: '^C',   key: { kind: 'interrupt' } },
  ],
];

export function mountKeybar(container: HTMLElement, handlers: {
  onKey: (key: BarKey) => void;
  modifierState: () => { ctrl: boolean; alt: boolean };
  /**
   * เปิด/ปิดคีย์บอร์ดบนจอ — จำเป็นเพราะ #terminal กิน touch ทั้งหมดเพื่อให้
   * "แตะ = คลิกส่งให้ TUI" ทำงานได้ การแตะจึงไม่เปิดคีย์บอร์ดให้เองอีกต่อไป
   * (ยืนยันบน Chrome Android แล้วว่า preventDefault ใน pointerdown ของปุ่ม
   * ไม่ได้ขวาง focus() ที่เรียกใน click — คีย์บอร์ดยังเปิดได้)
   */
  onToggleKeyboard: () => void;
}): { refresh: () => void; syncKeyboard: (open: boolean) => void } {
  let page = 0;
  let keyboardOpen = false;
  const modifierButtons = new Map<'ctrl' | 'alt', HTMLButtonElement>();
  let kbButton: HTMLButtonElement | null = null;

  /** ทุกปุ่มต้องกัน focus ย้ายออกจาก terminal ไม่งั้นคีย์บอร์ด Android ปิดทุกครั้งที่แตะ */
  const makeButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keybar-btn';
    btn.textContent = label;
    btn.addEventListener('pointerdown', e => e.preventDefault());
    btn.addEventListener('click', onClick);
    return btn;
  };

  const refresh = () => {
    const state = handlers.modifierState();
    modifierButtons.get('ctrl')?.classList.toggle('active', state.ctrl);
    modifierButtons.get('alt')?.classList.toggle('active', state.alt);
  };

  const render = () => {
    modifierButtons.clear();
    const children: HTMLButtonElement[] = [];

    for (const spec of PAGES[page]!) {
      const btn = makeButton(spec.label, () => {
        handlers.onKey(spec.key);
        refresh();
      });
      if (spec.key.kind === 'modifier') modifierButtons.set(spec.key.name, btn);
      children.push(btn);
    }

    // ⇄ สลับหน้า — ตรึงไว้ทุกหน้า ไม่งั้นสลับไปแล้วกลับมาไม่ได้
    const swap = makeButton('⇄', () => {
      page = (page + 1) % PAGES.length;
      render();
    });
    swap.title = 'สลับชุดปุ่ม';
    swap.classList.add('keybar-swap');
    children.push(swap);

    // ⌨ ตรึงไว้ทุกหน้าเพราะเป็นทางเดียวที่เปิดคีย์บอร์ดได้ ถ้าไปซ่อนอยู่หน้าใด
    // หน้าหนึ่ง ผู้ใช้จะพิมพ์ไม่ออกจนกว่าจะเดาถูกว่าต้องกด ⇄ ก่อน
    kbButton = makeButton('⌨', () => handlers.onToggleKeyboard());
    kbButton.title = 'เปิด/ปิดคีย์บอร์ด';
    // สถานะคีย์บอร์ดต้องทาสีใหม่ทุกครั้งที่ render ไม่งั้นสลับหน้าแล้วปุ่มจะดับ
    // ทั้งที่คีย์บอร์ดยังเปิดอยู่
    kbButton.classList.toggle('active', keyboardOpen);
    children.push(kbButton);

    container.replaceChildren(...children);
    refresh();
  };

  render();

  return {
    refresh,
    syncKeyboard: (open: boolean) => {
      keyboardOpen = open;
      kbButton?.classList.toggle('active', open);
    },
  };
}
