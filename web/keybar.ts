import type { BarKey, ModifierMode, ModifierName, ModifierState } from './input-pipeline.js';
import { bindPressRepeat } from './press-repeat.js';
import {
  beginExpansion,
  beginRestoration,
  closeSurface,
  initialKeyboardSurface,
  onOrientationChange,
  restoreKeyboardOnFold,
  settleViewport,
  timeoutTransition,
  updateVisualHeight,
  type KeyboardSurfaceState,
} from './keyboard-surface.js';

export interface ButtonSpec { label: string; key: BarKey }
export const KEY_TARGET_PX = 44;

const REPEATABLE_CURSOR_SEQUENCES = new Set(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);

export function isRepeatableKey(key: BarKey): boolean {
  return key.kind === 'literal' && REPEATABLE_CURSOR_SEQUENCES.has(key.data);
}

export const KEYS: ButtonSpec[] = [
  { label: 'Esc', key: { kind: 'literal', data: '\x1b' } },
  { label: 'Tab', key: { kind: 'literal', data: '\t' } },
  { label: 'Ctrl', key: { kind: 'modifier', name: 'ctrl' } },
  { label: '↑', key: { kind: 'literal', data: '\x1b[A' } },
  { label: '↓', key: { kind: 'literal', data: '\x1b[B' } },
  { label: '←', key: { kind: 'literal', data: '\x1b[D' } },
  { label: '→', key: { kind: 'literal', data: '\x1b[C' } },
  { label: 'Shift Tab', key: { kind: 'backtab' } },
  { label: 'Shift', key: { kind: 'modifier', name: 'shift' } },
  { label: 'Alt', key: { kind: 'modifier', name: 'alt' } },
  { label: '^C', key: { kind: 'interrupt' } },
  { label: '|', key: { kind: 'literal', data: '|' } },
  { label: '~', key: { kind: 'literal', data: '~' } },
  { label: '/', key: { kind: 'literal', data: '/' } },
  { label: '-', key: { kind: 'literal', data: '-' } },
];

export function modifierPresentation(label: string, mode: ModifierMode): {
  pressed: boolean;
  locked: boolean;
  label: string;
} {
  return {
    pressed: mode !== 'off',
    locked: mode === 'locked',
    label: `${label} ${mode}`,
  };
}

export function keybarViewState(
  expanded: boolean,
  restoring = false,
): { expanded: boolean; restoring: boolean } {
  return { expanded, restoring };
}

export function foldAction(state: KeyboardSurfaceState): 'restore-keyboard' | 'close' {
  return restoreKeyboardOnFold(state) ? 'restore-keyboard' : 'close';
}

export function applyKeybarView(
  expanded: boolean,
  restoring: boolean,
  strip: {
    classList: { toggle(token: string, force?: boolean): boolean | void };
    setAttribute(name: string, value: string): void;
  },
  container: { classList: { toggle(token: string, force?: boolean): boolean | void } },
): void {
  const view = keybarViewState(expanded, restoring);
  strip.classList.toggle('expanded', view.expanded);
  strip.classList.toggle('restoring', view.restoring);
  strip.setAttribute('aria-label', view.expanded ? 'Expanded terminal keys' : 'Quick terminal keys');
  container.classList.toggle('expanded', view.expanded);
}

export function applyKeyboardVisibility(
  visible: boolean,
  container: { classList: { toggle(token: string, force?: boolean): boolean | void } },
): void {
  container.classList.toggle('keyboard-visible', visible);
}

export interface MountedKeybar {
  refresh: () => void;
  syncKeyboard: (open: boolean, needsBottomClearance: boolean) => void;
  closePanel: () => void;
  onViewportFrame: (visualHeight: number) => void;
  onViewportSettled: (keyboardVisible: boolean) => void;
  onOrientationChange: () => void;
}

export function mountKeybar(container: HTMLElement, handlers: {
  onKey: (key: BarKey) => void;
  modifierState: () => ModifierState;
  onToggleKeyboard: () => void;
  onOpenKeyboard: () => void;
  onRequestKeyboardClose: () => void;
  viewport: () => { visualHeight: number; keyboardVisible: boolean };
  onPanelChange: (open: boolean) => void;
}): MountedKeybar {
  let keyboardOpen = false;
  let surface: KeyboardSurfaceState = initialKeyboardSurface();
  let transitionTimer: ReturnType<typeof setTimeout> | undefined;
  const modifierButtons = new Map<ModifierName, HTMLButtonElement[]>();
  const cancelRepeats: Array<() => void> = [];

  const makeButton = (label: string, onClick?: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keybar-btn';
    button.textContent = label;
    button.addEventListener('pointerdown', event => event.preventDefault());
    if (onClick) button.addEventListener('click', onClick);
    return button;
  };

  const registerModifier = (name: ModifierName, button: HTMLButtonElement) => {
    const buttons = modifierButtons.get(name) ?? [];
    buttons.push(button);
    modifierButtons.set(name, buttons);
  };

  const refresh = () => {
    const state = handlers.modifierState();
    for (const [name, buttons] of modifierButtons) {
      const label = name === 'ctrl' ? 'Ctrl' : name === 'shift' ? 'Shift' : 'Alt';
      const presentation = modifierPresentation(label, state[name]);
      for (const button of buttons) {
        button.classList.toggle('active', presentation.pressed);
        button.classList.toggle('locked', presentation.locked);
        button.setAttribute('aria-pressed', String(presentation.pressed));
        button.setAttribute('aria-label', presentation.label);
        button.title = presentation.label;
      }
    }
  };

  const makeKeyButton = (spec: ButtonSpec) => {
    const activate = () => {
      handlers.onKey(spec.key);
      refresh();
    };
    const repeatable = isRepeatableKey(spec.key);
    const button = makeButton(spec.label, repeatable ? undefined : activate);
    if (repeatable) {
      button.classList.add('keybar-btn-arrow');
      cancelRepeats.push(bindPressRepeat(button, activate));
    }
    if (spec.key.kind === 'backtab') {
      button.classList.add('keybar-btn-wide');
      button.setAttribute('aria-label', 'Shift Tab — send back-tab');
      button.title = 'Shift Tab — send back-tab';
    }
    if (spec.key.kind === 'modifier') registerModifier(spec.key.name, button);
    return button;
  };

  const strip = document.createElement('div');
  strip.className = 'keybar-strip';
  strip.setAttribute('aria-label', 'Quick terminal keys');
  strip.append(...KEYS.map(makeKeyButton));

  const controls = document.createElement('div');
  controls.className = 'keybar-controls';

  let moreButton: HTMLButtonElement;

  const updateView = () => {
    const occupiesLayout = surface.mode !== 'collapsed';
    const restoring = surface.mode === 'restoring-ime';
    const measuredHeight = occupiesLayout ? surface.panelHeightPx : null;

    applyKeybarView(occupiesLayout, restoring, strip, container);
    strip.classList.toggle('keyboard-sized', measuredHeight !== null);
    if (measuredHeight === null) {
      strip.style.removeProperty('--keybar-panel-height');
    } else {
      strip.style.setProperty('--keybar-panel-height', `${measuredHeight}px`);
    }
    strip.inert = restoring;
    strip.setAttribute('aria-hidden', String(restoring));

    const expanded = surface.mode === 'expanded' || surface.mode === 'replacing-ime';
    moreButton.classList.toggle('active', expanded);
    moreButton.setAttribute('aria-expanded', String(expanded));
    moreButton.disabled = restoring;
  };

  const clearTransitionTimer = () => {
    if (transitionTimer === undefined) return;
    clearTimeout(transitionTimer);
    transitionTimer = undefined;
  };

  const finishTransitionAfterTimeout = () => {
    clearTransitionTimer();
    transitionTimer = setTimeout(() => {
      transitionTimer = undefined;
      const wasOpen = surface.mode !== 'collapsed';
      surface = timeoutTransition(surface);
      updateView();
      if (wasOpen && surface.mode === 'collapsed') handlers.onPanelChange(false);
    }, 600);
  };

  const restoreKeyboardAndCollapse = () => {
    const viewport = handlers.viewport();
    surface = beginRestoration(
      surface,
      viewport.visualHeight,
      Math.max(0, strip.getBoundingClientRect().height - KEY_TARGET_PX),
    );
    updateView();
    finishTransitionAfterTimeout();
    // ต้องอยู่ใน click gesture เดิม ไม่งั้น mobile browser จะปฏิเสธการเปิด IME
    handlers.onOpenKeyboard();
  };

  moreButton = makeButton('⋯', () => {
    if (surface.mode !== 'collapsed') {
      clearTransitionTimer();
      if (foldAction(surface) === 'restore-keyboard') {
        restoreKeyboardAndCollapse();
        return;
      }
      surface = closeSurface(surface);
      updateView();
      handlers.onPanelChange(false);
      return;
    }

    const viewport = handlers.viewport();
    // เมื่อ keyboard เปิด collapsed bar มี margin กันขอบ IME อยู่ ต้องโอนพื้นที่นั้น
    // เข้า panel ก่อนถอด class expanded ไม่งั้น keybar จะตกลงทันทีหนึ่งจังหวะ
    const startingPanelHeight = viewport.keyboardVisible
      ? parseFloat(getComputedStyle(container).marginBottom) || 0
      : 0;
    surface = beginExpansion(
      surface,
      viewport.keyboardVisible,
      viewport.visualHeight,
      startingPanelHeight,
    );
    updateView();
    handlers.onRequestKeyboardClose();
    handlers.onPanelChange(true);
    if (surface.mode === 'replacing-ime') finishTransitionAfterTimeout();
  });
  moreButton.title = 'แสดง/ซ่อนปุ่มทั้งหมด';
  moreButton.setAttribute('aria-label', 'แสดง/ซ่อนปุ่มทั้งหมด');
  moreButton.setAttribute('aria-expanded', 'false');

  const keyboardButton = makeButton('⌨', () => {
    const restoringPanel = surface.mode !== 'collapsed';
    if (restoringPanel) {
      restoreKeyboardAndCollapse();
      return;
    }
    handlers.onToggleKeyboard();
  });
  keyboardButton.title = 'เปิด/ปิดคีย์บอร์ด';
  keyboardButton.setAttribute('aria-label', 'เปิด/ปิดคีย์บอร์ด');
  controls.append(moreButton, keyboardButton);

  const row = document.createElement('div');
  row.className = 'keybar-row';
  row.append(strip, controls);
  container.replaceChildren(row);
  window.addEventListener('blur', () => cancelRepeats.forEach(cancel => cancel()));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelRepeats.forEach(cancel => cancel());
  });
  refresh();

  return {
    refresh,
    syncKeyboard(open: boolean, needsBottomClearance: boolean) {
      keyboardOpen = open;
      keyboardButton.classList.toggle('active', keyboardOpen);
      applyKeyboardVisibility(needsBottomClearance, container);
    },
    closePanel() {
      if (surface.mode === 'collapsed') return;
      clearTransitionTimer();
      surface = closeSurface(surface);
      updateView();
      handlers.onPanelChange(false);
    },
    onViewportFrame(visualHeight: number) {
      const next = updateVisualHeight(surface, visualHeight);
      if (next === surface) return;
      surface = next;
      updateView();
    },
    onViewportSettled(keyboardVisible: boolean) {
      const next = settleViewport(surface, keyboardVisible);
      if (next === surface) return;
      surface = next;
      clearTransitionTimer();
      updateView();
    },
    onOrientationChange() {
      surface = onOrientationChange(surface);
      clearTransitionTimer();
      updateView();
    },
  };
}
