# Independent Terminal Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Make Bluetooth keyboard input work from the first key and remain attached after the Android IME closes, without causing the on-screen keyboard to reopen during terminal touch gestures.

**Architecture:** Replace the accepted-input timing workaround with a pure terminal-focus state machine. Its effects are applied through one xterm DOM adapter: physical mode focuses the helper textarea with `inputMode="none"`, soft mode uses `inputMode="text"`, and selection suspends focus. Visual Viewport remains the source of truth for IME visibility on touch devices; terminal focus and IME visibility are deliberately independent.

**Tech Stack:** TypeScript, xterm.js, DOM/Visual Viewport APIs, Vitest, Vite, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-20-physical-keyboard-focus-design.md`

## Global Constraints

- Do not add a document-level keyboard encoder, synthetic character path, direct WebSocket input path, or `@xterm/addon-attach`; terminal bytes must continue through xterm and `web/input-pipeline.ts`.
- Preserve selection's synthetic mouse flags in `selectionMouseInit()` and the existing mouse-reporting/gesture behavior.
- Do not use ADB. Automated verification is local; final device verification is a manual Android browser checklist.
- Keep the `⌨` active state tied to actual IME visibility on touch devices. A focused physical-mode textarea must not make the button appear open.
- Do not globally reclaim focus. Login/password and keybar customization inputs must retain normal ownership.
- Use Node.js 22+ and pnpm. Run `pnpm test` and `pnpm build` before completion.

### Task 1: Add the pure terminal-focus controller

**Files:**

- Create: `web/keyboard-focus-mode.ts`
- Create: `web/keyboard-focus-mode.test.ts`

**Step 1: Write the failing transition tests**

Create `web/keyboard-focus-mode.test.ts` with table-driven assertions for every approved transition and the two regression sequences:

```ts
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
```

If TypeScript rejects `it.each`'s explicit generic with the installed Vitest version, keep the same cases in a typed constant and pass that constant to `it.each`.

**Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm vitest run web/keyboard-focus-mode.test.ts
```

Expected: FAIL because `web/keyboard-focus-mode.ts` does not exist.

**Step 3: Implement the smallest pure controller**

Create `web/keyboard-focus-mode.ts`:

```ts
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
```

The `state` argument is retained for exhaustiveness and future guarded transitions. Do not add automatic transitions based on `document.activeElement`; avoiding global focus recovery is part of the design.

**Step 4: Run the focused test and confirm GREEN**

Run:

```bash
pnpm vitest run web/keyboard-focus-mode.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add web/keyboard-focus-mode.ts web/keyboard-focus-mode.test.ts
git commit -m "feat: model terminal focus independently from IME"
```

### Task 2: Add and test the xterm focus-effect adapter

**Files:**

- Modify: `web/keyboard-focus-mode.ts`
- Modify: `web/keyboard-focus-mode.test.ts`

**Step 1: Write failing adapter ordering tests**

Append tests using a fake xterm port. The assertions must verify that `inputMode` is assigned before any focus operation, explicit open/close cycles call `blur()` then `focus()`, ordinary physical focus never blurs, a missing textarea safely produces no focus, and a visible real form control can veto refocus:

```ts
describe('applyTerminalFocusEffect', () => {
  const buildPort = (withTextarea = true) => {
    const calls: string[] = [];
    let inputMode = '';
    const textarea = withTextarea ? {
      get inputMode() { return inputMode; },
      set inputMode(value: string) { inputMode = value; calls.push(`mode:${value}`); },
    } : undefined;
    return {
      calls,
      port: {
        textarea,
        blur: () => calls.push('blur'),
        focus: () => calls.push('focus'),
        canFocus: () => true,
      },
    };
  };

  it('applies a physical focus without cycling', () => {
    const { calls, port } = buildPort();
    applyTerminalFocusEffect(port, {
      type: 'focus', inputMode: 'none', cycle: false,
    });
    expect(calls).toEqual(['mode:none', 'focus']);
  });

  it('sets text mode before the explicit open focus cycle', () => {
    const { calls, port } = buildPort();
    applyTerminalFocusEffect(port, {
      type: 'focus', inputMode: 'text', cycle: true,
    });
    expect(calls).toEqual(['mode:text', 'blur', 'focus']);
  });

  it('blurs for a blur effect', () => {
    const { calls, port } = buildPort();
    applyTerminalFocusEffect(port, { type: 'blur' });
    expect(calls).toEqual(['blur']);
  });

  it('does not focus when xterm has no helper textarea yet', () => {
    const { calls, port } = buildPort(false);
    applyTerminalFocusEffect(port, {
      type: 'focus', inputMode: 'none', cycle: false,
    });
    expect(calls).toEqual([]);
  });

  it('does not steal focus when a visible real input owns it', () => {
    const { calls, port } = buildPort();
    port.canFocus = () => false;
    applyTerminalFocusEffect(port, {
      type: 'focus', inputMode: 'none', cycle: false,
    });
    expect(calls).toEqual([]);
  });
});
```

Import `applyTerminalFocusEffect` at the top of the test.

**Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm vitest run web/keyboard-focus-mode.test.ts
```

Expected: FAIL because the adapter is not exported.

**Step 3: Implement the adapter**

Append to `web/keyboard-focus-mode.ts`:

```ts
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
```

Do not move effect ordering back into `main.ts`; this adapter is the single ordering rule for mode-driven focus operations. `main.ts` supplies the DOM-specific `canFocus` predicate in Task 3.

**Step 4: Run the focused test and confirm GREEN**

Run:

```bash
pnpm vitest run web/keyboard-focus-mode.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add web/keyboard-focus-mode.ts web/keyboard-focus-mode.test.ts
git commit -m "test: specify xterm focus effect ordering"
```

### Task 3: Integrate modes with session, keybar, viewport, and selection

**Files:**

- Modify: `web/main.ts`
- Test: `web/keyboard-focus-mode.test.ts`
- Test: existing `web/keybar.test.ts`, `web/keyboard-surface.test.ts`, `web/text-selection.test.ts`

**Step 1: Establish one dispatcher inside `initTerminal()`**

Import the controller and adapter:

```ts
import {
  applyTerminalFocusEffect,
  initialTerminalFocusState,
  transitionTerminalFocus,
  type TerminalFocusEvent,
} from './keyboard-focus-mode.js';
```

Immediately after `t.open(...)`, initialize state, define whether the terminal may take focus, and create a local adapter/dispatcher:

```ts
let terminalFocusState = initialTerminalFocusState();
const terminalFocusPort = {
  textarea: t.textarea,
  focus: () => t.focus(),
  blur: () => t.blur(),
  canFocus: () => {
    const active = document.activeElement;
    if (!active || active === document.body || active === t.textarea) return true;
    const ownsTextInput = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || active instanceof HTMLSelectElement
      || (active instanceof HTMLElement && active.isContentEditable);
    const visible = active instanceof HTMLElement && active.getClientRects().length > 0;
    return !(ownsTextInput && visible);
  },
};
const dispatchTerminalFocus = (event: TerminalFocusEvent): void => {
  const transition = transitionTerminalFocus(terminalFocusState, event);
  terminalFocusState = transition.state;
  applyTerminalFocusEffect(terminalFocusPort, transition.effect);
};
```

Keep the dispatcher scoped to this terminal instance so a future reinitialization cannot drive a stale textarea. The visibility check lets a delayed Visual Viewport event leave a settings/password input alone, while a hidden login input cannot prevent session-start terminal focus.

**Step 2: Route explicit keyboard controls through mode events**

Change `mountKeybar(...)` handlers to:

```ts
onToggleKeyboard: () => {
  if (keyboardVisible()) dispatchTerminalFocus('request-ime-close');
  else {
    leaveSelectionForKeyboard();
    dispatchTerminalFocus('request-ime-open');
  }
  syncKeyboardButton();
},
onOpenKeyboard: () => {
  leaveSelectionForKeyboard();
  dispatchTerminalFocus('request-ime-open');
  syncKeyboardButton();
},
onRequestKeyboardClose: () => {
  dispatchTerminalFocus('request-ime-close');
  syncKeyboardButton();
},
```

The expansion/settings close path intentionally enters focused physical mode. This hides the IME while preserving Bluetooth input even when the expanded keybar is visible.

Delete the old `toggleKeyboard(t)` and `openKeyboard(t)` functions after all callers are removed. Keep `leaveSelectionForKeyboard()`.

**Step 3: Replace viewport blur/correlation with a native-hide transition**

Remove `createPhysicalKeyboardFocusGuard` from imports and delete its instance, blur reset listener, `noteInput()` call, and `shouldRelease(...)` block.

Retain `prevVisible`, and on Visual Viewport resize dispatch only on a true visible-to-hidden edge:

```ts
const vv = window.visualViewport;
if (vv) {
  let prevVisible = keyboardVisible();
  vv.addEventListener('resize', () => {
    const nextVisible = keyboardVisible();
    if (prevVisible && !nextVisible) {
      dispatchTerminalFocus('native-ime-hidden');
    }
    prevVisible = nextVisible;
    syncKeyboardButton();
  });
}
```

Do not dispatch on hidden-to-hidden URL-bar changes, orientation changes, or desktop focus changes.

Keep `t.onData(...)` limited to `pipeline.onTerminalData(data)` and `keybar.refresh()`.

**Step 4: Route selection entry and exit through the controller**

In `onModeChange`, retain class toggling, gesture cancellation, modifier clearing, and keybar refresh. Replace direct `t.blur()` with:

```ts
if (active) {
  stopGestures?.();
  pipeline.clearModifiers();
  dispatchTerminalFocus('selection-entered');
} else {
  dispatchTerminalFocus('selection-exited');
}
```

`createTextSelection` updates its internal active flag before invoking `onModeChange`, so the existing textarea focus guard will permit the exit refocus and continue rejecting xterm's Linux-selection refocus while active.

**Step 5: Enter physical mode at session initialization**

At the end of `initTerminal()`, after `bindTouch(t, fit)` and before returning, add:

```ts
dispatchTerminalFocus('session-ready');
syncKeyboardButton();
```

This happens after the app page is made visible and before `startSession()` awaits `connect()`. Update the stale `socket.onopen` comment that says the terminal intentionally remains unfocused; reconnection must leave the current controller mode untouched.

**Step 6: Keep button state separate from terminal focus**

Do not change `isKeyboardVisible()`'s touch-device viewport logic. `syncKeyboardButton()` continues to pass `keyboardVisible()` to `keybar.syncKeyboard`; on Android, physical focus with an unshrunk viewport therefore leaves `⌨` inactive.

For non-touch desktop behavior, preserve the existing focus fallback for now. Auto-focus means the button can reflect terminal focus there, but it does not claim a soft IME exists or affect layout because `needsBottomClearance` remains touch-and-Visual-Viewport gated. Add a comment explaining this compatibility behavior; do not broaden this mobile bug fix into a desktop keybar redesign.

**Step 7: Run focused regression suites**

Run:

```bash
pnpm vitest run web/keyboard-focus-mode.test.ts web/keybar.test.ts web/keyboard-surface.test.ts web/text-selection.test.ts
```

Expected: PASS. If an existing keybar surface test fails, preserve its IME replacement/restoration behavior and adjust only the new handler wiring.

**Step 8: Commit**

```bash
git add web/main.ts
git commit -m "fix: retain terminal focus without keeping IME open"
```

### Task 4: Preserve physical focus across ordinary terminal touch gestures

**Files:**

- Modify: `web/main.ts` (`bindTouch`, tap and drag-start cases)
- Test: existing `web/touch-gestures.test.ts`, `web/links.test.ts`, `web/text-selection.test.ts`

**Step 1: Remove hidden-IME blur from tap**

In the `tap` case, remove `const wasVisible = keyboardVisible()` and change:

```ts
if (!wasVisible || opened) t.blur();
```

to:

```ts
if (opened) t.blur();
```

Update the nearby comment: xterm may focus its textarea during the synthetic click, and physical mode's `inputMode="none"` now prevents IME reopening. Opening an external link may still release terminal focus.

**Step 2: Remove hidden-IME blur from drag start**

Delete `const wasVisible = keyboardVisible()` and `if (!wasVisible) t.blur()` from `dragStart`. Update the comment to explain that the focused helper textarea remains safe because physical mode suppresses the IME; mouse reporting remains unchanged.

Do not modify the selection-owned touch branch: selection entry still suspends focus through the controller and the Linux-selection guard.

**Step 3: Run gesture and link regression suites**

Run:

```bash
pnpm vitest run web/touch-gestures.test.ts web/links.test.ts web/text-selection.test.ts
```

Expected: PASS. These are pure recognizer/interaction regressions; the final Android checklist verifies that the browser does not reopen the IME.

**Step 4: Commit**

```bash
git add web/main.ts
git commit -m "fix: keep physical keyboard attached during touch gestures"
```

### Task 5: Remove the obsolete timing guard and update documentation

**Files:**

- Modify: `web/keyboard-visibility.ts`
- Modify: `web/keyboard-visibility.test.ts`
- Modify: `README.md` (mobile keyboard behavior/pitfalls near the current physical-key guard note)

**Step 1: Remove obsolete guard tests and implementation**

From `web/keyboard-visibility.test.ts`, remove imports and all tests for:

- `createPhysicalKeyboardFocusGuard`
- `shouldReleaseFocus`
- accepted-input timing and reset behavior

Retain all `isKeyboardVisible()` tests, including the Android native-hide regression proving a focused textarea with a full viewport means the IME is not visible.

From `web/keyboard-visibility.ts`, remove:

- `PHYSICAL_KEY_RESIZE_WINDOW_MS`
- `PhysicalKeyboardFocusGuard`
- `createPhysicalKeyboardFocusGuard(...)`
- `shouldReleaseFocus(...)`
- comments describing blur-on-native-hide as the policy

Keep `ViewportSample` and `isKeyboardVisible(...)`. Update its module comment to say visibility detection does not decide whether terminal focus should be released.

**Step 2: Run visibility and controller tests**

Run:

```bash
pnpm vitest run web/keyboard-visibility.test.ts web/keyboard-focus-mode.test.ts
```

Expected: PASS.

**Step 3: Replace the stale README guidance**

In `README.md`, replace the current accepted-`onData` correlation explanation with the new contract:

- terminal focus and IME visibility are separate states;
- physical mode focuses xterm with `inputMode="none"`;
- `⌨` explicitly enters/exits soft mode with a synchronous focus cycle;
- native IME dismissal returns to physical mode without blur;
- selection suspends terminal focus;
- no global key capture exists, so real form inputs retain ownership.

Also state that ordinary terminal taps/drags no longer blur merely because the IME is hidden.

**Step 4: Commit**

```bash
git add web/keyboard-visibility.ts web/keyboard-visibility.test.ts README.md
git commit -m "docs: describe independent terminal and IME focus"
```

### Task 6: Full verification and no-ADB Android acceptance

**Files:**

- Verify only; fix scoped failures in the owning files above and add focused tests before committing any correction.

**Step 1: Inspect the final diff for forbidden or stale patterns**

Run:

```bash
git diff --check
rg -n "createPhysicalKeyboardFocusGuard|shouldReleaseFocus|PHYSICAL_KEY_RESIZE_WINDOW_MS|noteInput\(\)" web README.md
rg -n "addEventListener\(['\"]keydown|document\.onkeydown|ws\.send" web/main.ts web/keyboard-focus-mode.ts
```

Expected:

- `git diff --check` is clean.
- The obsolete guard search returns no matches.
- No new global key listener exists.
- The only `ws.send` in `main.ts` remains the existing `input-pipeline` sender; no parallel physical-keyboard path was added.

**Step 2: Run the complete automated suite**

Run:

```bash
pnpm test
```

Expected: all Vitest suites pass.

**Step 3: Build frontend and server**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite builds complete successfully.

**Step 4: Review the effective change**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
git log --oneline -5
```

Confirm only the planned frontend tests/docs changed and no unrelated dirty work was staged or overwritten. Adjust `HEAD~4` if corrective commits were required.

**Step 5: Perform manual Android acceptance without ADB**

Using the affected Android browser and Bluetooth keyboard:

1. Load an authenticated terminal session. Never tap `⌨`; type at least 30 mixed letters, digits, punctuation, Backspace, Enter, and arrow keys. The first and every later key must reach the PTY while the IME stays hidden.
2. Tap `⌨`, type through the native soft keyboard, then type through Bluetooth. If Android retracts the IME, Bluetooth input must continue immediately.
3. Reopen `⌨`, hide it with Android's native hide control, and type through Bluetooth without touching the terminal first.
4. Toggle `⌨` open and closed at least five times; after each close, verify the button is inactive, the IME is absent, and Bluetooth input works.
5. With the IME hidden, tap, swipe, drag, and pinch the terminal. The IME must not reopen and Bluetooth input must still work afterward.
6. Enter selection mode. Verify neither keyboard alters the terminal. Exit selection and type through Bluetooth immediately; the IME must remain hidden.
7. Focus the login/password field after session expiration or a keybar customization input. Type through Bluetooth and verify the terminal does not steal those keystrokes.
8. On a desktop browser, confirm ordinary terminal keyboard input still works and keybar expansion does not acquire mobile bottom clearance.

Record the browser name/version and pass/fail results in the handoff. If `inputMode="none"` is ignored on the target browser, stop and report that compatibility result; do not introduce synthetic key encoding as an unreviewed fallback.

**Step 6: Commit only if verification required fixes**

For each scoped correction, rerun its focused test plus `pnpm test` and `pnpm build`, then commit with a message describing the actual correction. Do not create an empty verification commit.
