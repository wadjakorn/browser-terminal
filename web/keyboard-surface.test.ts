import { describe, expect, it } from 'vitest';
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
} from './keyboard-surface.js';

describe('keyboard surface replacement', () => {
  it('remembers whether expansion displaced a visible keyboard across layout transitions', () => {
    const fromKeyboard = beginExpansion(initialKeyboardSurface(), true, 420, 8);
    expect(restoreKeyboardOnFold(fromKeyboard)).toBe(true);
    expect(restoreKeyboardOnFold(updateVisualHeight(fromKeyboard, 720))).toBe(true);
    expect(restoreKeyboardOnFold(settleViewport(
      updateVisualHeight(fromKeyboard, 720), false,
    ))).toBe(true);
    expect(restoreKeyboardOnFold(timeoutTransition(fromKeyboard))).toBe(true);
    expect(restoreKeyboardOnFold(onOrientationChange(fromKeyboard))).toBe(true);

    const withoutKeyboard = beginExpansion(initialKeyboardSurface(), false, 720);
    expect(restoreKeyboardOnFold(withoutKeyboard)).toBe(false);
    expect(restoreKeyboardOnFold(closeSurface(fromKeyboard))).toBe(false);
  });

  it('starts at zero height only when expanding directly from a visible keyboard', () => {
    expect(beginExpansion(initialKeyboardSurface(), true, 420)).toEqual({
      mode: 'replacing-ime', startVisualHeight: 420, panelHeightPx: 0,
      restoreKeyboardOnFold: true,
    });
    expect(beginExpansion(initialKeyboardSurface(), false, 800)).toEqual({
      mode: 'expanded', panelHeightPx: null, restoreKeyboardOnFold: false,
    });
  });

  it('grows by exactly the visual viewport height recovered from the closing keyboard', () => {
    const started = beginExpansion(initialKeyboardSurface(), true, 420);
    expect(updateVisualHeight(started, 560)).toMatchObject({
      mode: 'replacing-ime', panelHeightPx: 140,
    });
    expect(updateVisualHeight(started, 400)).toMatchObject({ panelHeightPx: 0 });
  });

  it('transfers collapsed keyboard clearance into the panel without a height jump', () => {
    const started = beginExpansion(initialKeyboardSurface(), true, 420, 8);
    expect(started).toEqual({
      mode: 'replacing-ime',
      startVisualHeight: 420,
      startPanelHeightPx: 8,
      panelHeightPx: 8,
      restoreKeyboardOnFold: true,
    });

    const growing = updateVisualHeight(started, 560);
    expect(growing).toMatchObject({ panelHeightPx: 148 });
    expect(settleViewport(updateVisualHeight(growing, 720), false)).toEqual({
      mode: 'expanded', panelHeightPx: 308,
      restoreKeyboardOnFold: true,
    });
  });

  it('holds the recovered height after the keyboard has settled hidden', () => {
    const growing = updateVisualHeight(
      beginExpansion(initialKeyboardSurface(), true, 420),
      720,
    );
    expect(settleViewport(growing, false)).toEqual({
      mode: 'expanded', panelHeightPx: 300,
      restoreKeyboardOnFold: true,
    });
  });

  it('falls back to content sizing if the keyboard never releases viewport height', () => {
    const started = beginExpansion(initialKeyboardSurface(), true, 420);
    expect(timeoutTransition(started)).toEqual({
      mode: 'expanded', panelHeightPx: null, restoreKeyboardOnFold: true,
    });
  });
});

describe('restoring the OS keyboard', () => {
  it('preserves the rendered panel height at the start of restoration', () => {
    const expanded = {
      mode: 'expanded', panelHeightPx: 300, restoreKeyboardOnFold: true,
    } as const;
    expect(beginRestoration(expanded, 720, 302)).toEqual({
      mode: 'restoring-ime',
      startVisualHeight: 720,
      startPanelHeightPx: 302,
      panelHeightPx: 302,
      restoreKeyboardOnFold: true,
    });
  });

  it('shrinks the spacer by the viewport height consumed by the opening keyboard', () => {
    const restoring = beginRestoration(
      { mode: 'expanded', panelHeightPx: 300, restoreKeyboardOnFold: true }, 720, 300,
    );
    expect(updateVisualHeight(restoring, 540)).toMatchObject({
      mode: 'restoring-ime', panelHeightPx: 120,
    });
    expect(updateVisualHeight(restoring, 400)).toMatchObject({ panelHeightPx: 0 });
  });

  it('collapses only after the opening keyboard settles visible', () => {
    const restoring = beginRestoration(
      { mode: 'expanded', panelHeightPx: 300, restoreKeyboardOnFold: true }, 720, 300,
    );
    expect(settleViewport(restoring, false)).toEqual(restoring);
    expect(settleViewport(restoring, true)).toEqual(initialKeyboardSurface());
  });

  it('collapses if the OS refuses to open', () => {
    const restoring = beginRestoration(
      { mode: 'expanded', panelHeightPx: null, restoreKeyboardOnFold: false }, 720, 250,
    );
    expect(timeoutTransition(restoring)).toEqual(initialKeyboardSurface());
  });
});

describe('interruptions', () => {
  it('uses content sizing after rotation while open and collapses a restoring spacer', () => {
    expect(onOrientationChange({
      mode: 'expanded', panelHeightPx: 300, restoreKeyboardOnFold: true,
    })).toEqual({
      mode: 'expanded', panelHeightPx: null, restoreKeyboardOnFold: true,
    });
    expect(onOrientationChange({
      mode: 'restoring-ime', startVisualHeight: 720,
      startPanelHeightPx: 300, panelHeightPx: 100,
      restoreKeyboardOnFold: true,
    })).toEqual(initialKeyboardSurface());
  });

  it('closes any expanded state immediately when ⋯ is tapped again', () => {
    expect(closeSurface({
      mode: 'expanded', panelHeightPx: 300, restoreKeyboardOnFold: true,
    }))
      .toEqual(initialKeyboardSurface());
  });
});
