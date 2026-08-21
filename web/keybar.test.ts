import { describe, expect, it, vi } from 'vitest';
import {
  applyFullscreenButton,
  applyKeyboardVisibility,
  applyKeybarView,
  foldAction,
  isRepeatableKey,
  KEYS,
  keyButtonText,
  keybarSettingsLabel,
  keybarSizingPresentation,
  keybarSurfaceIds,
  keybarVisibleLabels,
  keybarViewState,
  modifierPresentation,
  toggleKeybarCustomization,
} from './keybar.js';
import { beginExpansion, initialKeyboardSurface } from './keyboard-surface.js';
import { getKeySpec } from './key-definitions.js';
import { defaultKeybarPreferences, moveKey, setKeyHidden } from './keybar-preferences.js';

describe('shared key inventory', () => {
  it('has the exact quick-row and expanded-grid order without duplicates', () => {
    const labels = KEYS.map(key => key.label);
    expect(labels).toEqual([
      'Esc', 'Tab', 'Ctrl', '↑', '↓', '←', '→', 'Shift Tab', 'Shift',
      'Alt', '^C', '⏎', '⧉', '⎘', '|', '~', '/', '-',
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
  it('hides unsupported fullscreen and synchronizes active accessibility state', () => {
    const button = {
      hidden: false,
      title: '',
      classList: { toggle: vi.fn() },
      setAttribute: vi.fn(),
    };

    applyFullscreenButton(button, false, false);
    expect(button.hidden).toBe(true);

    applyFullscreenButton(button, true, true);
    expect(button.hidden).toBe(false);
    expect(button.classList.toggle).toHaveBeenLastCalledWith('active', true);
    expect(button.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
    expect(button.setAttribute).toHaveBeenCalledWith('aria-label', 'ออกจากเต็มหน้าจอ');
    expect(button.title).toBe('ออกจากเต็มหน้าจอ');
  });

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

describe('keybar customization state', () => {
  it('notifies terminal layout when customization changes panel height', () => {
    let customizing = false;
    const applyCustomization = vi.fn((next: boolean) => { customizing = next; });
    const onLayoutChange = vi.fn();

    toggleKeybarCustomization(customizing, applyCustomization, onLayoutChange);
    expect(customizing).toBe(true);
    expect(applyCustomization).toHaveBeenLastCalledWith(true);
    expect(onLayoutChange).toHaveBeenCalledOnce();

    toggleKeybarCustomization(customizing, applyCustomization, onLayoutChange);
    expect(customizing).toBe(false);
    expect(applyCustomization).toHaveBeenLastCalledWith(false);
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
  });

  it('gives keyboard-hidden customization a definite scrollport', () => {
    expect(keybarSizingPresentation(true, null)).toEqual({
      keyboardSized: false,
      customizationSized: true,
    });
    expect(keybarSizingPresentation(true, 280)).toEqual({
      keyboardSized: true,
      customizationSized: false,
    });
    expect(keybarSizingPresentation(false, null)).toEqual({
      keyboardSized: false,
      customizationSized: false,
    });
  });

  it('shows settings and fullscreen only on the expanded sortable surface', () => {
    const preferences = moveKey(defaultKeybarPreferences(), 'fullscreen', -1);

    expect(keybarSurfaceIds(preferences, false)).not.toEqual(
      expect.arrayContaining(['settings', 'fullscreen']),
    );
    expect(keybarSurfaceIds(preferences, true).slice(14, 16)).toEqual([
      'fullscreen', 'settings',
    ]);
  });

  it('reports visible labels after hide and reorder preferences', () => {
    const hidden = setKeyHidden(defaultKeybarPreferences(), 'tab', true);
    const moved = moveKey(hidden, 'dash', -1);
    expect(keybarVisibleLabels(moved)).not.toContain('Tab');
    expect(keybarVisibleLabels(moved).at(-2)).toBe('-');
  });

  it('labels the settings toggle by panel state', () => {
    expect(keybarSettingsLabel(false)).toBe('Customize terminal keys');
    expect(keybarSettingsLabel(true)).toBe('Close key customization');
  });

  it('uses compact icon-aware button text when available', () => {
    expect(keyButtonText(getKeySpec('esc')!)).toEqual({ icon: null, label: 'Esc' });
    expect(keyButtonText(getKeySpec('tab')!)).toEqual({ icon: null, label: 'Tab' });
    expect(keyButtonText(getKeySpec('shift-tab')!)).toEqual({ icon: null, label: 'Shift Tab' });
    expect(keyButtonText(getKeySpec('interrupt')!)).toEqual({ icon: null, label: '^C' });
    expect(keyButtonText(getKeySpec('dash')!)).toEqual({ icon: null, label: '-' });
  });
});
