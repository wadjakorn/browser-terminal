import type { BarKey, ModifierMode, ModifierName, ModifierState } from './input-pipeline.js';
import {
  DEFAULT_KEY_IDS,
  KEY_CATALOG,
  KEY_TARGET_PX,
  isRepeatableKey,
  resolveKeySpecs,
  type KeyAction,
  type KeySpec,
} from './key-definitions.js';
import {
  loadKeybarPreferences,
  moveKey,
  resetKeybarPreferences,
  saveKeybarPreferences,
  setKeyHidden,
  visibleKeyIds,
  type KeybarPreferences,
} from './keybar-preferences.js';
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

export type ButtonSpec = KeySpec;
export { KEY_TARGET_PX, isRepeatableKey };
export const KEYS = resolveKeySpecs(DEFAULT_KEY_IDS);

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

export function keybarVisibleLabels(preferences: KeybarPreferences): string[] {
  return resolveKeySpecs(visibleKeyIds(preferences)).map(key => key.label);
}

export function keybarSettingsLabel(customizing: boolean): string {
  return customizing ? 'Close key customization' : 'Customize terminal keys';
}

export function keyButtonText(spec: KeySpec): { icon: string | null; label: string } {
  return { icon: spec.icon ?? null, label: spec.shortLabel ?? spec.label };
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
  onAction: (action: KeyAction) => void;
  actionState: (action: KeyAction) => boolean;
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
  let preferences: KeybarPreferences = loadKeybarPreferences();
  let customizing = false;
  const modifierButtons = new Map<ModifierName, HTMLButtonElement[]>();
  const toggleButtons = new Map<KeyAction, HTMLButtonElement[]>();
  const cancelRepeats: Array<() => void> = [];
  let cancelRenderedRepeats: Array<() => void> = [];

  const makeButton = (label: string, onClick?: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keybar-btn';
    button.textContent = label;
    button.addEventListener('pointerdown', event => event.preventDefault());
    if (onClick) button.addEventListener('click', onClick);
    return button;
  };

  const makeMiniButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const button = makeButton(label, onClick);
    button.classList.add('keybar-mini-btn');
    button.title = title;
    button.setAttribute('aria-label', title);
    return button;
  };

  const setButtonContent = (button: HTMLButtonElement, spec: KeySpec) => {
    const text = keyButtonText(spec);
    button.replaceChildren();
    if (text.icon) {
      const icon = document.createElement('span');
      icon.className = 'keybar-btn-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = text.icon;
      button.append(icon);
    }
    const label = document.createElement('span');
    label.className = 'keybar-btn-label';
    label.textContent = text.label;
    button.append(label);
  };

  const registerToggle = (action: KeyAction, button: HTMLButtonElement) => {
    const buttons = toggleButtons.get(action) ?? [];
    buttons.push(button);
    toggleButtons.set(action, buttons);
  };

  const registerModifier = (name: ModifierName, button: HTMLButtonElement) => {
    const buttons = modifierButtons.get(name) ?? [];
    buttons.push(button);
    modifierButtons.set(name, buttons);
  };

  const refresh = () => {
    for (const [action, buttons] of toggleButtons) {
      const on = handlers.actionState(action);
      for (const button of buttons) {
        // ใช้คลาสเดียวกับ modifier ที่ล็อกอยู่ เพื่อให้ "ติดอยู่" หน้าตาเหมือนกันทั้งแถบ
        button.classList.toggle('active', on);
        button.classList.toggle('locked', on);
        button.setAttribute('aria-pressed', String(on));
      }
    }

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

  const makeKeyButton = (spec: KeySpec) => {
    const activate = () => {
      if (spec.action) handlers.onAction(spec.action);
      else if (spec.key) handlers.onKey(spec.key);
      refresh();
    };
    const repeatable = isRepeatableKey(spec.key);
    const button = makeButton(spec.label, repeatable ? undefined : activate);
    setButtonContent(button, spec);
    button.title = spec.title;
    button.setAttribute('aria-label', spec.title);
    button.dataset.keyId = spec.id;
    button.dataset.category = spec.category;
    if (repeatable) {
      button.classList.add('keybar-btn-arrow');
      cancelRenderedRepeats.push(bindPressRepeat(button, activate));
    }
    if (spec.wide) {
      button.classList.add('keybar-btn-wide');
    }
    if (spec.key?.kind === 'backtab') {
      button.setAttribute('aria-label', 'Shift Tab — send back-tab');
      button.title = 'Shift Tab — send back-tab';
    }
    if (spec.key?.kind === 'modifier') registerModifier(spec.key.name, button);
    if (spec.toggle && spec.action) registerToggle(spec.action, button);
    return button;
  };

  const strip = document.createElement('div');
  strip.className = 'keybar-strip';
  strip.setAttribute('aria-label', 'Quick terminal keys');

  const controls = document.createElement('div');
  controls.className = 'keybar-controls';

  let moreButton: HTMLButtonElement;
  let settingsButton: HTMLButtonElement;

  const cancelAllRepeats = () => {
    for (const cancel of cancelRepeats) cancel();
    for (const cancel of cancelRenderedRepeats) cancel();
  };

  const clearRenderedKeyControls = () => {
    for (const cancel of cancelRenderedRepeats) cancel();
    cancelRenderedRepeats = [];
    modifierButtons.clear();
  };

  const orderedCatalog = () => resolveKeySpecs(preferences.order);

  const applyPreferences = (next: KeybarPreferences) => {
    preferences = next;
    saveKeybarPreferences(preferences);
    render();
  };

  const makeCustomizePanel = (): HTMLElement => {
    const hidden = new Set(preferences.hidden);
    const panel = document.createElement('div');
    panel.className = 'keybar-customize';

    const title = document.createElement('div');
    title.className = 'keybar-customize-title';
    title.textContent = 'Customize keys';
    panel.append(title);

    for (const spec of orderedCatalog()) {
      const row = document.createElement('div');
      row.className = 'keybar-customize-row';
      row.dataset.category = spec.category;

      const name = document.createElement('label');
      name.className = 'keybar-customize-name';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !hidden.has(spec.id);
      checkbox.addEventListener('pointerdown', event => event.preventDefault());
      checkbox.addEventListener('change', () => {
        applyPreferences(setKeyHidden(preferences, spec.id, !checkbox.checked));
      });

      const label = document.createElement('span');
      label.textContent = `${spec.label} · ${spec.title}`;
      name.append(checkbox, label);

      const previous = makeMiniButton('←', `Move ${spec.label} earlier`, () => {
        applyPreferences(moveKey(preferences, spec.id, -1));
      });
      const next = makeMiniButton('→', `Move ${spec.label} later`, () => {
        applyPreferences(moveKey(preferences, spec.id, 1));
      });

      row.append(name, previous, next);
      panel.append(row);
    }

    const reset = makeButton('Reset', () => {
      applyPreferences(resetKeybarPreferences());
    });
    reset.classList.add('keybar-reset-btn');
    reset.setAttribute('aria-label', 'Reset terminal keys');
    reset.title = 'Reset terminal keys';
    panel.append(reset);
    return panel;
  };

  function render(): void {
    clearRenderedKeyControls();
    const visibleKeys = resolveKeySpecs(visibleKeyIds(preferences));
    const children: HTMLElement[] = visibleKeys.map(makeKeyButton);
    if (customizing) children.push(makeCustomizePanel());
    strip.replaceChildren(...children);
    if (settingsButton) {
      const label = keybarSettingsLabel(customizing);
      settingsButton.classList.toggle('active', customizing);
      settingsButton.setAttribute('aria-label', label);
      settingsButton.setAttribute('aria-expanded', String(customizing));
      settingsButton.title = label;
    }
    refresh();
  }

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
    settingsButton.disabled = restoring;
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
    customizing = false;
    render();
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
      customizing = false;
      render();
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

  settingsButton = makeButton('⚙', () => {
    customizing = !customizing;
    if (customizing && surface.mode === 'collapsed') {
      const viewport = handlers.viewport();
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
    }
    render();
  });
  settingsButton.title = keybarSettingsLabel(false);
  settingsButton.setAttribute('aria-label', keybarSettingsLabel(false));
  settingsButton.setAttribute('aria-expanded', 'false');

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
  controls.append(moreButton, settingsButton, keyboardButton);

  const row = document.createElement('div');
  row.className = 'keybar-row';
  row.append(strip, controls);
  container.replaceChildren(row);
  window.addEventListener('blur', cancelAllRepeats);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAllRepeats();
  });
  render();

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
      customizing = false;
      render();
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
