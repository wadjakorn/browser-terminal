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
  | { type: 'blur' }
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
}

export function applyTerminalFocusEffect(
  port: TerminalFocusPort,
  effect: TerminalFocusEffect,
): void {
  if (effect.type === 'none') return;
  if (effect.type === 'blur') {
    port.blur();
    return;
  }
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
      return { state: { mode: 'suspended' }, effect: { type: 'blur' } };
    default: {
      const exhaustive: never = event;
      return { state, effect: { type: 'none' } };
    }
  }
}
