import { describe, expect, it } from 'vitest';
import {
  initialTerminalFocusState,
  transitionTerminalFocus,
  type TerminalFocusEvent,
  type TerminalFocusState,
} from './keyboard-focus-mode.js';

describe('terminal focus mode transitions', () => {
  it.each<{
    from: TerminalFocusState['mode'];
    event: TerminalFocusEvent;
    to: TerminalFocusState['mode'];
    effect: unknown;
  }>([
    { from: 'suspended', event: 'session-ready', to: 'physical',
      effect: { type: 'focus', inputMode: 'none', cycle: false } },
    { from: 'physical', event: 'request-ime-open', to: 'soft',
      effect: { type: 'focus', inputMode: 'text', cycle: true } },
    { from: 'soft', event: 'request-ime-close', to: 'physical',
      effect: { type: 'focus', inputMode: 'none', cycle: true } },
    { from: 'soft', event: 'native-ime-hidden', to: 'physical',
      effect: { type: 'focus', inputMode: 'none', cycle: false } },
    { from: 'physical', event: 'selection-entered', to: 'suspended',
      effect: { type: 'blur' } },
    { from: 'suspended', event: 'selection-exited', to: 'physical',
      effect: { type: 'focus', inputMode: 'none', cycle: false } },
  ])('$from + $event -> $to', ({ from, event, to, effect }) => {
    expect(transitionTerminalFocus({ mode: from }, event)).toEqual({
      state: { mode: to }, effect,
    });
  });

  it('starts suspended until the terminal is ready', () => {
    expect(initialTerminalFocusState()).toEqual({ mode: 'suspended' });
  });

  it('keeps physical focus when Android hides the IME after soft input', () => {
    let result = transitionTerminalFocus({ mode: 'physical' }, 'request-ime-open');
    result = transitionTerminalFocus(result.state, 'native-ime-hidden');
    expect(result).toEqual({
      state: { mode: 'physical' },
      effect: { type: 'focus', inputMode: 'none', cycle: false },
    });
  });

  it('restores physical focus after selection without reopening the IME', () => {
    const entered = transitionTerminalFocus({ mode: 'physical' }, 'selection-entered');
    expect(transitionTerminalFocus(entered.state, 'selection-exited')).toEqual({
      state: { mode: 'physical' },
      effect: { type: 'focus', inputMode: 'none', cycle: false },
    });
  });
});
