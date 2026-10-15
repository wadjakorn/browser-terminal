export type TerminalFocusMode = 'physical' | 'soft' | 'suspended';

export type TerminalFocusEvent =
  | 'session-ready'
  | 'request-ime-open'
  | 'request-ime-close'
  | 'native-ime-hidden'
  | 'selection-entered'
  | 'selection-exited';

export type TerminalFocusEffect =
  | { type: 'focus'; inputMode: 'none' | 'text'; cycle: boolean }
  /** `lock` = ห้าม textarea รับ focus จนกว่าจะมี focus effect ถัดไป (ดู setLocked) */
  | { type: 'blur'; lock: boolean }
  | { type: 'none' };

export interface TerminalFocusState {
  mode: TerminalFocusMode;
}

export interface TerminalFocusTransition {
  state: TerminalFocusState;
  effect: TerminalFocusEffect;
}

export interface TerminalFocusPort {
  textarea?: { inputMode: string };
  focus(): void;
  blur(): void;
  canFocus?(): boolean;
  /**
   * ปิด/เปิดให้ textarea รับ focus ได้ — ใช้ตลอดโหมดเลือก
   *
   * mousedown สังเคราะห์ของโหมดเลือกทำให้ xterm เรียก focus() เสมอ ถ้า textarea รับได้
   * xterm จะส่ง focus-in (`ESC[I`) ให้แอปข้างใน แล้ว herdr ตอบด้วยการตั้ง mouse mode
   * ใหม่ทั้งชุด ซึ่งทำให้ xterm ล้าง selection ที่เพิ่งเริ่มทิ้งก่อนจะวาดทัน
   */
  setLocked?(locked: boolean): void;
}

export function applyTerminalFocusEffect(
  port: TerminalFocusPort,
  effect: TerminalFocusEffect,
): void {
  if (effect.type === 'none') return;
  if (effect.type === 'blur') {
    port.blur();
    if (effect.lock) port.setLocked?.(true);
    return;
  }
  // ปลดก่อนทุกเงื่อนไขข้างล่าง — ถ้ายาม canFocus หรือ textarea ที่ยังไม่มี return ไปก่อน
  // textarea จะ disabled ค้างถาวรและพิมพ์อะไรไม่ได้อีกเลยจนกว่าจะ reload
  port.setLocked?.(false);
  if (!port.textarea || port.canFocus?.() === false) return;
  port.textarea.inputMode = effect.inputMode;
  if (effect.cycle) port.blur();
  port.focus();
}

export function initialTerminalFocusState(): TerminalFocusState {
  return { mode: 'suspended' };
}

export function transitionTerminalFocus(
  state: TerminalFocusState,
  event: TerminalFocusEvent,
): TerminalFocusTransition {
  if (state.mode === 'suspended'
    && (event === 'native-ime-hidden' || event === 'request-ime-close')) {
    return { state, effect: { type: 'none' } };
  }

  switch (event) {
    case 'session-ready':
    case 'selection-exited':
      return {
        state: { mode: 'physical' },
        effect: { type: 'focus', inputMode: 'none', cycle: false },
      };
    case 'request-ime-open':
      return {
        state: { mode: 'soft' },
        effect: { type: 'focus', inputMode: 'text', cycle: true },
      };
    case 'request-ime-close':
      return {
        state: { mode: 'physical' },
        effect: { type: 'focus', inputMode: 'none', cycle: true },
      };
    case 'native-ime-hidden':
      return {
        state: { mode: 'physical' },
        effect: { type: 'focus', inputMode: 'none', cycle: false },
      };
    case 'selection-entered':
      return { state: { mode: 'suspended' }, effect: { type: 'blur', lock: true } };
    default: {
      const exhaustive: never = event;
      return { state, effect: { type: 'none' } };
    }
  }
}
