// web/keybar.ts
import type { BarKey } from './input-pipeline.js';

export interface ButtonSpec { label: string; key: BarKey }

/** ความกว้างต่ำสุดของปุ่มที่ยังกดไม่พลาด (px) — ความสูงคุมไว้ที่ 44px ใน CSS */
export const MIN_BTN_PX = 40;
/** ต้องตรงกับ `gap` ของ .keybar ใน style.css ไม่งั้นจำนวนช่องที่คำนวณจะเกินจริง */
export const GAP_PX = 4;

/**
 * ปุ่มทั้งหมด เรียงจากใช้ถี่สุดไปหาน้อยสุด — ลำดับนี้คือสิ่งที่กำหนดว่าอะไรได้อยู่
 * หน้าแรกตอนจอแคบ ไม่ใช่การจัดหมวด
 *
 * Esc/Tab/⇧Tab/Ctrl คือชุดที่ใช้ตลอดใน TUI และ claude-code (⇧Tab สลับโหมด)
 * ตามด้วยลูกศรสำหรับเรียกคำสั่งเก่าและแก้กลางบรรทัด
 * ท้ายสุดคืออักขระที่คีย์บอร์ด Android ซ่อนลึก — `|` `~` ต้องกดสามชั้น
 * ส่วน `/` `-` กดสองชั้นก็ถึง จึงอยู่ท้ายสุดและเป็นกลุ่มแรกที่หายไปตอนจอแคบ
 */
export const KEYS: ButtonSpec[] = [
  { label: 'Esc',  key: { kind: 'literal', data: '\x1b' } },
  { label: 'Tab',  key: { kind: 'literal', data: '\t' } },
  // CSI Z = back-tab — claude-code ใช้สลับโหมด (auto-accept / plan)
  { label: '⇧Tab', key: { kind: 'literal', data: '\x1b[Z' } },
  { label: 'Ctrl', key: { kind: 'modifier', name: 'ctrl' } },
  { label: '↑',    key: { kind: 'literal', data: '\x1b[A' } },
  { label: '↓',    key: { kind: 'literal', data: '\x1b[B' } },
  { label: '←',    key: { kind: 'literal', data: '\x1b[D' } },
  { label: '→',    key: { kind: 'literal', data: '\x1b[C' } },
  { label: 'Alt',  key: { kind: 'modifier', name: 'alt' } },
  { label: '^C',   key: { kind: 'interrupt' } },
  { label: '|',    key: { kind: 'literal', data: '|' } },
  { label: '~',    key: { kind: 'literal', data: '~' } },
  { label: '/',    key: { kind: 'literal', data: '/' } },
  { label: '-',    key: { kind: 'literal', data: '-' } },
];

/** จำนวนปุ่มที่ยืนเรียงกันได้ในความกว้างนี้โดยไม่ล้น */
export function slotsThatFit(availablePx: number): number {
  const n = Math.floor((availablePx + GAP_PX) / (MIN_BTN_PX + GAP_PX));
  return Math.max(1, n);
}

/**
 * แบ่งปุ่มเป็นหน้าตามจำนวนช่องที่จอรับได้จริง
 *
 * ถ้าลงได้หมดในแถวเดียว (นับ ⌨ ที่ตรึงไว้ด้วย) จะคืนหน้าเดียวและไม่ต้องมีปุ่ม ⇄ เลย
 * — บนแท็บเล็ตหรือมือถือแนวนอนจึงเห็นปุ่มครบโดยไม่ต้องกดสลับ
 *
 * ถ้าไม่พอ ต้องกันช่องให้ ⇄ กับ ⌨ เหลือเป็นช่องคีย์จริงหน้าละ slots-2
 * แล้วเกลี่ยให้ทุกหน้ามีจำนวนใกล้เคียงกัน ไม่ใช่ตัดเต็มหน้าไปเรื่อยๆ จนหน้าสุดท้าย
 * เหลือปุ่มเดียวลอยๆ
 */
export function paginate<T>(keys: T[], slots: number): T[][] {
  if (keys.length + 1 <= slots) return [keys];   // +1 = ⌨ ไม่ต้องมี ⇄

  const perPage = Math.max(1, slots - 2);        // กันช่องให้ ⇄ กับ ⌨
  const pageCount = Math.ceil(keys.length / perPage);
  const balanced = Math.ceil(keys.length / pageCount);

  const pages: T[][] = [];
  for (let i = 0; i < keys.length; i += balanced) pages.push(keys.slice(i, i + balanced));
  return pages;
}

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
}): { refresh: () => void; syncKeyboard: (open: boolean) => void; destroy: () => void } {
  let page = 0;
  let slots = 0;
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

  /** ความกว้างที่ปุ่มใช้ได้จริง = ความกว้างในกรอบ ลบ padding ของแถบเอง */
  const availableWidth = (): number => {
    const cs = getComputedStyle(container);
    return container.clientWidth
      - (parseFloat(cs.paddingLeft) || 0)
      - (parseFloat(cs.paddingRight) || 0);
  };

  const render = () => {
    const pages = paginate(KEYS, slots);
    if (page >= pages.length) page = 0;   // จอหดจนหน้าหาย ต้องไม่ค้างที่หน้าที่ไม่มีแล้ว

    modifierButtons.clear();
    const children: HTMLButtonElement[] = [];

    for (const spec of pages[page]!) {
      const btn = makeButton(spec.label, () => {
        handlers.onKey(spec.key);
        refresh();
      });
      if (spec.key.kind === 'modifier') modifierButtons.set(spec.key.name, btn);
      children.push(btn);
    }

    // ⇄ โผล่เฉพาะตอนที่มีอะไรให้สลับจริงๆ — จอกว้างพอใส่ครบแถวเดียวก็ไม่ต้องมี
    if (pages.length > 1) {
      const swap = makeButton('⇄', () => {
        page = (page + 1) % pages.length;
        render();
      });
      swap.title = `สลับชุดปุ่ม (${page + 1}/${pages.length})`;
      swap.classList.add('keybar-swap');
      children.push(swap);
    }

    // ⌨ ตรึงไว้ทุกหน้าเพราะเป็นทางเดียวที่เปิดคีย์บอร์ดได้ ถ้าไปซ่อนอยู่หน้าใด
    // หน้าหนึ่ง ผู้ใช้จะพิมพ์ไม่ออกจนกว่าจะเดาถูกว่าต้องกด ⇄ ก่อน
    kbButton = makeButton('⌨', () => handlers.onToggleKeyboard());
    kbButton.title = 'เปิด/ปิดคีย์บอร์ด';
    // ทาสถานะคีย์บอร์ดใหม่ทุกครั้งที่ render ไม่งั้นสลับหน้าหรือหมุนจอแล้วปุ่มจะดับ
    // ทั้งที่คีย์บอร์ดยังเปิดอยู่
    kbButton.classList.toggle('active', keyboardOpen);
    children.push(kbButton);

    container.replaceChildren(...children);
    refresh();
  };

  /**
   * วัดใหม่แล้ว render เฉพาะตอนจำนวนช่องเปลี่ยนจริง
   *
   * ResizeObserver ยิงถี่มากระหว่างหมุนจอหรือคีย์บอร์ดเลื่อนขึ้นลง ถ้า render ทุกครั้ง
   * ปุ่มจะถูกสร้างใหม่กลางนิ้วที่กำลังกดค้างอยู่ และการกดจะหลุด
   */
  const measure = (): void => {
    const next = slotsThatFit(availableWidth());
    if (next === slots) return;
    slots = next;
    render();
  };

  measure();

  const ro = new ResizeObserver(measure);
  ro.observe(container);

  return {
    refresh,
    syncKeyboard: (open: boolean) => {
      keyboardOpen = open;
      kbButton?.classList.toggle('active', open);
    },
    destroy: () => ro.disconnect(),
  };
}
