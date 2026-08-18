# Keybar Order, Keyboard Memory, and Arrow Repeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the less-used Shift controls behind the arrows, restore the OS keyboard automatically when folding a tools panel that displaced it, and let users hold an arrow key for continuous cursor movement without breaking quick-row swiping.

**Architecture:** Keep key ordering declarative in `KEYS`, extend the existing `KeyboardSurfaceState` as the single source of truth for whether an expanded panel displaced a visible IME, and add a small testable press-repeat controller used only by the four arrow buttons. The input pipeline remains unchanged: every repeat passes through `onBarKey`, so application-cursor mode and sticky modifiers retain their existing behavior.

**Tech Stack:** TypeScript, DOM Pointer Events, xterm.js, Visual Viewport API, Vitest, Vite, Playwright-based browser QA already available in the workspace.

## Global Constraints

- Use Node.js 22+ and pnpm.
- Add no runtime or test dependency.
- Keep all terminal bytes flowing through `web/input-pipeline.ts`.
- Keep 44×44 px minimum targets and the fixed `⋯` / `⌨` controls.
- Preserve the expanded panel’s measured IME-height handoff and the 8 px keyboard seam clearance.
- Repeat timing is fixed at a 350 ms hold delay and a 75 ms interval.
- A movement of more than 10 CSS px before repeat starts cancels the hold so horizontal scrolling wins.
- A normal arrow tap sends exactly once; keyboard activation with Enter/Space also sends exactly once.
- Arrow presses must preserve the terminal's pre-gesture focus state: they neither dismiss an already-visible IME nor open a hidden IME.

---

### Task 1: Reorder the shared key inventory

**Files:**
- Modify: `web/keybar.ts`
- Test: `web/keybar.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing `ButtonSpec` and `KEYS: ButtonSpec[]`.
- Produces: exact shared order `Esc`, `Tab`, `Ctrl`, `↑`, `↓`, `←`, `→`, `Shift Tab`, `Shift`, `Alt`, `^C`, `|`, `~`, `/`, `-` for both the quick strip and expanded grid.

- [ ] **Step 1: Change the inventory test first**

  Update the exact-order assertion in `web/keybar.test.ts` to:

  ```ts
  expect(labels).toEqual([
    'Esc', 'Tab', 'Ctrl', '↑', '↓', '←', '→', 'Shift Tab', 'Shift',
    'Alt', '^C', '|', '~', '/', '-',
  ]);
  ```

  Retain the uniqueness assertion, the absence of `⇄`, and the assertion that `Shift Tab` maps to `{ kind: 'backtab' }`.

- [ ] **Step 2: Run the focused test and confirm the old order fails**

  Run: `pnpm vitest run web/keybar.test.ts`

  Expected: FAIL because `Shift Tab` and `Shift` still precede the arrow group.

- [ ] **Step 3: Reorder only the `KEYS` entries**

  In `web/keybar.ts`, reorder the existing entries without changing any labels or `BarKey` values:

  ```ts
  Esc, Tab, Ctrl, ↑, ↓, ←, →, Shift Tab, Shift, Alt, ^C, |, ~, /, -
  ```

  Because both surfaces render `KEYS.map(makeKeyButton)`, this changes both copies without adding layout branches.

- [ ] **Step 4: Update the README key-order example**

  Replace the current key sequence with the exact order above. Keep the dedicated `Shift Tab` behavior and modifier documentation unchanged.

- [ ] **Step 5: Run the focused test**

  Run: `pnpm vitest run web/keybar.test.ts`

  Expected: PASS.

---

### Task 2: Remember whether expansion displaced the OS keyboard

**Files:**
- Modify: `web/keyboard-surface.ts`
- Test: `web/keyboard-surface.test.ts`
- Modify: `web/keybar.ts`
- Test: `web/keybar.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `beginExpansion`, `beginRestoration`, `settleViewport`, `timeoutTransition`, `updateVisualHeight`, `closeSurface`, and the existing synchronous `onOpenKeyboard()` handler.
- Produces: `restoreKeyboardOnFold(state: KeyboardSurfaceState): boolean`; every non-collapsed state carries `restoreKeyboardOnFold: boolean`, set from `keyboardVisible` at expansion and preserved until collapse completes.

- [ ] **Step 1: Write state-machine regression tests**

  Extend `web/keyboard-surface.test.ts` with explicit assertions that:

  ```ts
  const fromKeyboard = beginExpansion(initialKeyboardSurface(), true, 420, 8);
  expect(restoreKeyboardOnFold(fromKeyboard)).toBe(true);
  expect(restoreKeyboardOnFold(updateVisualHeight(fromKeyboard, 720))).toBe(true);
  expect(restoreKeyboardOnFold(settleViewport(
    updateVisualHeight(fromKeyboard, 720), false,
  ))).toBe(true);

  const withoutKeyboard = beginExpansion(initialKeyboardSurface(), false, 720);
  expect(restoreKeyboardOnFold(withoutKeyboard)).toBe(false);
  ```

  Also assert that `timeoutTransition()` and `onOrientationChange()` preserve the remembered origin for an open panel, while a completed restoration and `closeSurface()` return the collapsed state with no remembered restore request.

- [ ] **Step 2: Run the focused state tests and confirm they fail**

  Run: `pnpm vitest run web/keyboard-surface.test.ts`

  Expected: FAIL because the state does not yet retain the expansion origin.

- [ ] **Step 3: Put the remembered origin in the existing state machine**

  Add `restoreKeyboardOnFold: boolean` to `replacing-ime`, `expanded`, and `restoring-ime`. Set it to the `keyboardVisible` argument in `beginExpansion`, copy it in `updateVisualHeight`, `settleViewport`, `timeoutTransition`, and `onOrientationChange`, and expose:

  ```ts
  export function restoreKeyboardOnFold(state: KeyboardSurfaceState): boolean {
    return state.mode !== 'collapsed' && state.restoreKeyboardOnFold;
  }
  ```

  `initialKeyboardSurface()` and `closeSurface()` remain the only collapsed constructor, so no second mutable boolean can drift from panel state.

- [ ] **Step 4: Extract one synchronous restore path in `mountKeybar`**

  Add a local helper that is called directly inside the originating button click:

  ```ts
  const restoreKeyboardAndCollapse = () => {
    const viewport = handlers.viewport();
    surface = beginRestoration(
      surface,
      viewport.visualHeight,
      panel.getBoundingClientRect().height,
    );
    updateView();
    finishTransitionAfterTimeout();
    handlers.onOpenKeyboard();
  };
  ```

  Use it for the existing `⌨`-while-expanded flow and for `⋯` when `restoreKeyboardOnFold(surface)` is true. This keeps `blur(); focus()` inside the user gesture. If the panel was opened while the keyboard was hidden, `⋯` continues to close immediately without opening the IME. Do not infer the restore decision from current focus or current viewport size after expansion; both are intentionally hidden by then.

- [ ] **Step 5: Add a DOM-level keybar test seam for the two fold decisions**

  Refactor only enough to export a pure decision:

  ```ts
  export function foldAction(state: KeyboardSurfaceState): 'restore-keyboard' | 'close' {
    return restoreKeyboardOnFold(state) ? 'restore-keyboard' : 'close';
  }
  ```

  Test that an expanded-from-keyboard state returns `restore-keyboard`, an expanded-without-keyboard state returns `close`, and the `⌨` path remains an unconditional keyboard restoration while expanded. Keep browser QA in Task 4 to verify that `onOpenKeyboard()` is actually reached synchronously from a real click.

- [ ] **Step 6: Run focused tests**

  Run: `pnpm vitest run web/keyboard-surface.test.ts web/keybar.test.ts`

  Expected: PASS.

- [ ] **Step 7: Document restoration behavior**

  In `README.md`, state that `⋯` remembers whether it displaced a visible OS keyboard: tapping `⋯` again restores that keyboard automatically; a panel opened while the keyboard was hidden folds without opening it. Keep `⌨` documented as the explicit override.

---

### Task 3: Add swipe-safe press-and-hold repeat for arrow keys

**Files:**
- Create: `web/press-repeat.ts`
- Create: `web/press-repeat.test.ts`
- Modify: `web/keybar.ts`
- Test: `web/keybar.test.ts`
- Modify: `web/style.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: an `activate(): void` callback plus pointer samples `{ id, x, y, primary }` supplied by a thin DOM binder.
- Produces: `createPressRepeatController(activate, options?): PressRepeatController`, with `down(sample)`, `move(sample)`, `end(id)`, `cancel()`, and `click(detail)` methods; options default to `{ holdDelayMs: 350, intervalMs: 75, moveTolerancePx: 10 }` and accept optional `onHoldStart(pointerId)` / `onHoldEnd(pointerId)` hooks. `bindPressRepeat(element, activate)` translates DOM events into that controller, uses those hooks for pointer capture/release, and returns the controller's `cancel()` function. `mountKeybar` owns the cancel functions and uses one shared window/document lifecycle listener to cancel all repeat controllers.

- [ ] **Step 1: Write fake-timer tests for the repeat controller**

  In `web/press-repeat.test.ts`, test the pure `PressRepeatController` with `vi.useFakeTimers()`; do not require `document`, `window`, `HTMLElement`, `PointerEvent`, or a DOM test environment. Verify:

  - click without a completed hold calls `activate()` once;
  - 349 ms produces no hold activation, 350 ms produces the first activation, and each further 75 ms produces one more;
  - release after repeat cancels the interval and suppresses the synthetic click generated by that same pointer sequence;
  - moving more than 10 px before 350 ms cancels repeat and suppresses any click synthesized for that pointer sequence, so a short drag cannot emit one arrow;
  - moving 10 px or less does not cancel;
  - `end()` and `cancel()` stop pending/repeating timers;
  - a click with `detail === 0` (keyboard activation) sends once and never enters repeat;
  - non-primary mouse buttons do not start repeat.

- [ ] **Step 2: Run the new focused test and confirm it fails**

  Run: `pnpm vitest run web/press-repeat.test.ts`

  Expected: FAIL because `web/press-repeat.ts` does not exist.

- [ ] **Step 3: Implement the controller without sending on pointerdown**

  Implement the pure controller with one active pointer ID, starting coordinates, a hold timeout, a repeat interval, and a one-sequence click-suppression flag. `bindPressRepeat()` maps `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `lostpointercapture`, and `click` into it. Do not call `activate()` on `pointerdown`; normal taps continue through `click`, which prevents an accidental arrow when the user begins a horizontal swipe on that key. At the 350 ms threshold, call `onHoldStart(pointerId)`, call `activate()` once, and start the 75 ms interval. The binder captures only then and releases through `onHoldEnd(pointerId)` on every terminal event. Both completed repeat and movement beyond 10 px mark that pointer sequence’s synthetic click for suppression. Clear suppression after consuming that click, with a zero-delay fallback so a missing synthetic click cannot poison the next genuine tap.

- [ ] **Step 4: Bind repeat only to literal arrow specs**

  In `web/keybar.ts`, identify arrows by their exact existing CSI literals (`\x1b[A`, `\x1b[B`, `\x1b[C`, `\x1b[D`). For those four buttons, call `bindPressRepeat(button, activate)` instead of registering the generic click handler. Keep all other keys on the existing click path. Do not capture the pointer on `pointerdown`; capture is allowed only once the 350 ms hold wins, so the quick strip still has a chance to claim an early horizontal drag. Each repeated activation must call:

  ```ts
  handlers.onKey(spec.key);
  refresh();
  ```

  This ensures the first repeated arrow consumes armed modifiers and later repeats use only locked modifiers, exactly as separate taps already do.

  Keep every returned cancel function in `mountKeybar`. Install one `window.blur` listener and one `document.visibilitychange` listener for the whole keybar; each cancels all controllers. This avoids eight duplicate global listener pairs for the quick/grid copies. The keybar is mounted once for the page lifetime, matching the existing viewport and textarea listener lifecycle; do not add an unused public disposal API in this change.

- [ ] **Step 5: Preserve scroll arbitration in CSS**

  Add an arrow-specific class with `touch-action: pan-x`, `user-select: none`, and `-webkit-touch-callout: none` in the quick strip; use `touch-action: manipulation` in the expanded grid. Prevent the arrow button's `contextmenu` event. Keep the existing `pointerdown.preventDefault()` focus protection and do not capture before the hold threshold. The acceptance contract is explicit: a pre-threshold horizontal drag beginning on an arrow must scroll the strip, must emit no arrow, and must leave textarea/IME focus unchanged. If implementation evidence refutes any part of that contract, stop and debug the gesture path before completion rather than shipping a fallback with different semantics. Do not change non-arrow keys, fixed controls, or panel scrolling behavior.

- [ ] **Step 6: Add keybar wiring tests**

  Extend `web/keybar.test.ts` to assert that exactly the four arrow specs are repeatable and that `Shift Tab`, modifiers, and printable keys are not. Keep the repeat timing tests isolated in `web/press-repeat.test.ts` rather than duplicating them.

- [ ] **Step 7: Run focused tests**

  Run: `pnpm vitest run web/press-repeat.test.ts web/keybar.test.ts web/input-pipeline.test.ts`

  Expected: PASS, including existing normal/application cursor and modifier consumption assertions.

- [ ] **Step 8: Update mobile-use documentation**

  Add: “แตะลูกศร = ขยับหนึ่งครั้ง; กดค้าง 350 ms = ขยับต่อเนื่องจนปล่อย; เริ่มปัดแนวนอนก่อนเวลาค้าง = เลื่อน quick row โดยไม่ส่งลูกศร.”

---

### Task 4: End-to-end verification on mobile-sized viewports

**Files:**
- Modify if needed from findings: `web/keybar.ts`, `web/keyboard-surface.ts`, `web/press-repeat.ts`, `web/style.css`
- Test if needed from findings: corresponding `*.test.ts`

**Interfaces:**
- Consumes: the completed keybar behavior from Tasks 1–3.
- Produces: test/build evidence plus browser geometry and interaction evidence; no permanent QA script or new dependency.

- [ ] **Step 1: Run all automated checks**

  Run:

  ```bash
  pnpm test
  pnpm build
  git diff --check
  ```

  Expected: all tests pass, both frontend/server builds pass, and no whitespace errors are reported.

- [ ] **Step 2: Browser-check exact order and scrolling**

  At 320, 360, 412, and 740 px widths in portrait and landscape, assert from the rendered DOM that both surfaces have the exact shared order. On the collapsed quick row, drag horizontally starting on an arrow before 350 ms and verify the strip scrolls without terminal input. Run that check once with the OS keyboard logically open and once closed; `document.activeElement` and the keyboard-visible state must be unchanged by the drag. Confirm `⋯` and `⌨` remain fixed and every target remains at least 44×44 px.

- [ ] **Step 3: Browser-check keyboard memory with simulated Visual Viewport frames**

  Exercise both branches:

  1. Visible keyboard → tap `⋯` → panel replaces the measured keyboard height → tap `⋯` again → `openKeyboard()` runs in that click and the panel shrinks as the viewport contracts.
  2. Hidden keyboard → tap `⋯` → content-sized panel → tap `⋯` again → panel closes and the terminal textarea remains blurred.

  During branch 1, assert the terminal/keybar top edge stays constant through expansion and restoration, including the existing 8 px seam handoff. Verify `fitAddon.fit()` runs on panel frames and PTY resize is sent only when the WebSocket is open.

- [ ] **Step 4: Browser-check arrow repeat and cancellation**

  Hold each arrow longer than 350 ms and verify repeated `onKey` calls stop immediately on release. Repeat with pointer cancellation, a drag over 10 px, window blur, and tab visibility loss; after the drag, verify the same pointer sequence's click sends no arrow and the following clean tap sends exactly one. With armed Shift/Ctrl/Alt, verify only the first emitted arrow consumes armed state; with locked modifiers, verify every repeated arrow uses the expected CSI modifier parameter.

- [ ] **Step 5: Real-device acceptance check**

  On the target Android browser, verify a real IME can be restored by folding with `⋯` without an extra touch. Headless Chrome can validate geometry and synchronous calls but cannot prove the OS accepts the IME request. Also verify holding an arrow does not trigger text selection, page zoom, stuck input after the finger lifts, or loss of horizontal quick-row swipe.
