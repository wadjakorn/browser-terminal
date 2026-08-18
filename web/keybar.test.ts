import { describe, expect, it, vi } from 'vitest';
import {
  applyKeyboardVisibility,
  applyKeybarView,
  foldAction,
  isRepeatableKey,
  KEYS,
  keybarViewState,
  modifierPresentation,
} from './keybar.js';
import { beginExpansion, initialKeyboardSurface } from './keyboard-surface.js';

describe('shared key inventory', () => {
  it('has the exact quick-row and expanded-grid order without duplicates', () => {
    const labels = KEYS.map(key => key.label);
    expect(labels).toEqual([
      'Esc', 'Tab', 'Ctrl', '↑', '↓', '←', '→', 'Shift Tab', 'Shift',
      'Alt', '^C', '|', '~', '/', '-',
    ]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain('⇄');
  });

  it('represents integrated Shift Tab independently of literal sequences', () => {
    expect(KEYS.find(key => key.label === 'Shift Tab')?.key).toEqual({ kind: 'backtab' });
  });

  it('makes exactly the four cursor arrows repeatable', () => {
    expect(KEYS.filter(spec => isRepeatableKey(spec.key)).map(spec => spec.label))
      .toEqual(['↑', '↓', '←', '→']);
  });
});

describe('keybar surface state', () => {
  it('restores only the keyboard displaced by this panel expansion', () => {
    expect(foldAction(beginExpansion(initialKeyboardSurface(), true, 420)))
      .toBe('restore-keyboard');
    expect(foldAction(beginExpansion(initialKeyboardSurface(), false, 720)))
      .toBe('close');
  });

  it('keeps the same key surface in place while collapsed', () => {
    expect(keybarViewState(false)).toEqual({ expanded: false, restoring: false });
  });

  it('wraps the same key surface instead of replacing it while expanded', () => {
    expect(keybarViewState(true)).toEqual({ expanded: true, restoring: false });
  });

  it('applies expansion to the one rendered key surface', () => {
    const strip = {
      classList: { toggle: vi.fn() },
      setAttribute: vi.fn(),
    };
    const container = { classList: { toggle: vi.fn() } };
    applyKeybarView(true, false, strip, container);
    expect(strip.classList.toggle).toHaveBeenCalledWith('expanded', true);
    expect(strip.classList.toggle).toHaveBeenCalledWith('restoring', false);
    expect(strip.setAttribute).toHaveBeenCalledWith('aria-label', 'Expanded terminal keys');
    expect(container.classList.toggle).toHaveBeenCalledWith('expanded', true);
  });

  it('marks the collapsed bar when the OS keyboard needs bottom clearance', () => {
    const container = { classList: { toggle: vi.fn() } };

    applyKeyboardVisibility(true, container);
    expect(container.classList.toggle).toHaveBeenLastCalledWith('keyboard-visible', true);

    applyKeyboardVisibility(false, container);
    expect(container.classList.toggle).toHaveBeenLastCalledWith('keyboard-visible', false);
  });
});

describe('modifier presentation', () => {
  it.each([
    ['off', false, false, 'Ctrl off'],
    ['armed', true, false, 'Ctrl armed'],
    ['locked', true, true, 'Ctrl locked'],
  ] as const)('maps %s to visual and accessibility state', (mode, pressed, locked, label) => {
    expect(modifierPresentation('Ctrl', mode)).toEqual({ pressed, locked, label });
  });
});
