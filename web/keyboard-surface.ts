export type KeyboardSurfaceState =
  | { mode: 'collapsed'; panelHeightPx: null }
  | {
    mode: 'replacing-ime';
    startVisualHeight: number;
    startPanelHeightPx?: number;
    panelHeightPx: number;
    restoreKeyboardOnFold: boolean;
  }
  | {
    mode: 'expanded';
    panelHeightPx: number | null;
    restoreKeyboardOnFold: boolean;
  }
  | {
    mode: 'restoring-ime';
    startVisualHeight: number;
    startPanelHeightPx: number;
    panelHeightPx: number;
    restoreKeyboardOnFold: boolean;
  };

export function initialKeyboardSurface(): KeyboardSurfaceState {
  return { mode: 'collapsed', panelHeightPx: null };
}

export function beginExpansion(
  state: KeyboardSurfaceState,
  keyboardVisible: boolean,
  visualHeight: number,
  startingPanelHeightPx = 0,
): KeyboardSurfaceState {
  if (state.mode !== 'collapsed') return state;
  if (!keyboardVisible) {
    return { mode: 'expanded', panelHeightPx: null, restoreKeyboardOnFold: false };
  }

  const panelHeightPx = Math.max(0, startingPanelHeightPx);
  return panelHeightPx > 0
    ? {
      mode: 'replacing-ime',
      startVisualHeight: visualHeight,
      startPanelHeightPx: panelHeightPx,
      panelHeightPx,
      restoreKeyboardOnFold: true,
    }
    : {
      mode: 'replacing-ime',
      startVisualHeight: visualHeight,
      panelHeightPx: 0,
      restoreKeyboardOnFold: true,
    };
}

export function beginRestoration(
  state: KeyboardSurfaceState,
  visualHeight: number,
  renderedPanelHeight: number,
): KeyboardSurfaceState {
  if (state.mode !== 'expanded' && state.mode !== 'replacing-ime') return state;
  const panelHeightPx = Math.max(0, renderedPanelHeight);
  return {
    mode: 'restoring-ime',
    startVisualHeight: visualHeight,
    startPanelHeightPx: panelHeightPx,
    panelHeightPx,
    restoreKeyboardOnFold: state.restoreKeyboardOnFold,
  };
}

export function updateVisualHeight(
  state: KeyboardSurfaceState,
  visualHeight: number,
): KeyboardSurfaceState {
  if (state.mode === 'replacing-ime') {
    return {
      ...state,
      panelHeightPx: Math.max(
        0,
        (state.startPanelHeightPx ?? 0) + visualHeight - state.startVisualHeight,
      ),
    };
  }
  if (state.mode === 'restoring-ime') {
    return {
      ...state,
      panelHeightPx: Math.max(
        0,
        state.startPanelHeightPx - (state.startVisualHeight - visualHeight),
      ),
    };
  }
  return state;
}

export function settleViewport(
  state: KeyboardSurfaceState,
  keyboardVisible: boolean,
): KeyboardSurfaceState {
  if (state.mode === 'replacing-ime' && !keyboardVisible) {
    return {
      mode: 'expanded',
      panelHeightPx: state.panelHeightPx > 0 ? state.panelHeightPx : null,
      restoreKeyboardOnFold: state.restoreKeyboardOnFold,
    };
  }
  if (state.mode === 'restoring-ime' && keyboardVisible) {
    return initialKeyboardSurface();
  }
  return state;
}

export function timeoutTransition(state: KeyboardSurfaceState): KeyboardSurfaceState {
  if (state.mode === 'replacing-ime') {
    return {
      mode: 'expanded',
      panelHeightPx: state.panelHeightPx > 0 ? state.panelHeightPx : null,
      restoreKeyboardOnFold: state.restoreKeyboardOnFold,
    };
  }
  if (state.mode === 'restoring-ime') return initialKeyboardSurface();
  return state;
}

export function onOrientationChange(state: KeyboardSurfaceState): KeyboardSurfaceState {
  if (state.mode === 'collapsed') return state;
  if (state.mode === 'restoring-ime') return initialKeyboardSurface();
  return {
    mode: 'expanded',
    panelHeightPx: null,
    restoreKeyboardOnFold: state.restoreKeyboardOnFold,
  };
}

export function closeSurface(_state: KeyboardSurfaceState): KeyboardSurfaceState {
  return initialKeyboardSurface();
}

export function restoreKeyboardOnFold(state: KeyboardSurfaceState): boolean {
  return state.mode !== 'collapsed' && state.restoreKeyboardOnFold;
}
