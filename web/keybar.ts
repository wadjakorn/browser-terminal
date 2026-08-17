// web/keybar.ts
import type { BarKey } from './input-pipeline.js';

interface ButtonSpec { label: string; key: BarKey }

const BUTTONS: ButtonSpec[] = [
  { label: 'Esc',  key: { kind: 'literal', data: '\x1b' } },
  { label: 'Tab',  key: { kind: 'literal', data: '\t' } },
  { label: 'Ctrl', key: { kind: 'modifier', name: 'ctrl' } },
  { label: 'Alt',  key: { kind: 'modifier', name: 'alt' } },
  { label: '↑',    key: { kind: 'literal', data: '\x1b[A' } },
  { label: '↓',    key: { kind: 'literal', data: '\x1b[B' } },
  { label: '←',    key: { kind: 'literal', data: '\x1b[D' } },
  { label: '→',    key: { kind: 'literal', data: '\x1b[C' } },
  { label: '|',    key: { kind: 'literal', data: '|' } },
  { label: '~',    key: { kind: 'literal', data: '~' } },
  { label: '/',    key: { kind: 'literal', data: '/' } },
  { label: '-',    key: { kind: 'literal', data: '-' } },
  { label: '^C',   key: { kind: 'interrupt' } },
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
  container.replaceChildren();
  const modifierButtons = new Map<'ctrl' | 'alt', HTMLButtonElement>();

  const refresh = () => {
    const state = handlers.modifierState();
    modifierButtons.get('ctrl')?.classList.toggle('active', state.ctrl);
    modifierButtons.get('alt')?.classList.toggle('active', state.alt);
  };

  for (const spec of BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keybar-btn';
    btn.textContent = spec.label;

    // สำคัญที่สุดในไฟล์นี้: กัน focus ย้ายออกจาก terminal
    // ไม่งั้นคีย์บอร์ด Android จะปิดทุกครั้งที่แตะปุ่ม
    btn.addEventListener('pointerdown', e => e.preventDefault());

    btn.addEventListener('click', () => {
      handlers.onKey(spec.key);
      refresh();
    });

    if (spec.key.kind === 'modifier') modifierButtons.set(spec.key.name, btn);
    container.appendChild(btn);
  }

  const kb = document.createElement('button');
  kb.type = 'button';
  kb.className = 'keybar-btn';
  kb.textContent = '⌨';
  kb.title = 'เปิด/ปิดคีย์บอร์ด';
  kb.addEventListener('pointerdown', e => e.preventDefault());
  kb.addEventListener('click', () => handlers.onToggleKeyboard());
  container.appendChild(kb);

  refresh();
  return {
    refresh,
    syncKeyboard: (open: boolean) => kb.classList.toggle('active', open),
  };
}
