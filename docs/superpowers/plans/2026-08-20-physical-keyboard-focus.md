# Physical Keyboard Focus Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep xterm focused when Android retracts its IME in response to Bluetooth keyboard input, without regressing explicit OS keyboard dismissal.

**Architecture:** Confirm the browser event sequence on the affected Android device first. Then classify trustworthy physical `keydown` events in a pure helper, correlate one such event with the following `visualViewport` visible-to-hidden transition, and preserve the existing blur behavior for transitions without that marker.

**Tech Stack:** TypeScript, xterm.js 6, Visual Viewport API, Vitest 3, Vite 8

**Spec:** `docs/superpowers/specs/2026-08-20-physical-keyboard-focus-design.md`

## Global Constraints

- Use Node.js 22+ and pnpm.
- Never bypass `web/input-pipeline.ts` or add `@xterm/addon-attach`.
- Do not add canvas or WebGL xterm renderers.
- Preserve explicit `⌨` toggling, sticky modifiers, touch gestures, selection focus guards, and responsive keybar behavior.
- Do not change the keybar layout constants or corresponding CSS values.
- Keep authentication, server, PTY, WebSocket, and deployment behavior out of scope.
- Run `pnpm test` and `pnpm build` before completion.

---

### Task 1: Confirm the focus-loss event sequence on Android

**Files:**
- Temporarily modify, then restore: `web/main.ts`
- Record findings in: `docs/superpowers/specs/2026-08-20-physical-keyboard-focus-design.md`

**Interfaces:**
- Consumes: xterm's `t.textarea`, `window.visualViewport`, `keyboardVisible()`, and `terminalFocused()`.
- Produces: a measured event sequence proving or rejecting the spec's root-cause hypothesis; no production code or temporary diagnostics remain.

- [ ] **Step 1: Add a temporary local trace after `t.open($('terminal'))`**

  Add this diagnostic block without staging it:

  ```ts
  const traceKeyboard = (event: string, key?: KeyboardEvent): void => {
    console.debug('[keyboard-focus-trace]', {
      event,
      at: performance.now(),
      active: document.activeElement?.className,
      innerHeight: window.innerHeight,
      visualHeight: window.visualViewport?.height,
      visualOffsetTop: window.visualViewport?.offsetTop,
      key: key?.key,
      code: key?.code,
      keyCode: key?.keyCode,
      composing: key?.isComposing,
    });
  };
  t.textarea?.addEventListener('keydown', event => traceKeyboard('keydown', event), true);
  t.textarea?.addEventListener('focus', () => traceKeyboard('focus'));
  t.textarea?.addEventListener('blur', () => traceKeyboard('blur'));
  window.visualViewport?.addEventListener('resize', () => traceKeyboard('viewport-resize'));
  ```

- [ ] **Step 2: Run the app and capture the Bluetooth-keyboard failure**

  Run the server and web processes in separate terminals:

  ```bash
  pnpm dev:server
  DEV_ORIGINS=http://localhost:5173 pnpm dev:web
  ```

  On the affected Android device, open the on-screen keyboard, then type at least ten
  characters and navigation keys on the Bluetooth keyboard. Save the ordered trace from
  the first physical `keydown` through the unexpected `blur`.

  Expected evidence for the current hypothesis: a `keydown` with non-empty `code`,
  `keyCode !== 229`, and `isComposing === false`; then a viewport resize from keyboard
  visible to hidden; then the application's `blur`.

- [ ] **Step 3: Capture the explicit Android hide-keyboard control path**

  Reopen the IME, do not press the Bluetooth keyboard, and press Android's native
  hide-keyboard control.

  Expected evidence: the same visible-to-hidden viewport transition and application
  blur, but no preceding qualifying physical `keydown`.

- [ ] **Step 4: Gate the remaining plan on the evidence**

  If both expected traces match, add a short `## Confirmed device trace` section to the
  spec containing device/browser versions, event ordering, and relevant event fields.
  Change the spec status to `Root cause confirmed; ready for implementation`.

  If the first trace does not match, stop. Restore `web/main.ts`, change the spec status
  to `Hypothesis rejected`, record the actual blur source, and write a revised design
  before implementing any fix.

- [ ] **Step 5: Remove all temporary trace code and verify the diff**

  Remove the `traceKeyboard` block and run:

  ```bash
  git diff --check
  git diff -- web/main.ts
  ```

  Expected: no diff for `web/main.ts`; only the evidence update in the spec remains.

- [ ] **Step 6: Commit the confirmed investigation**

  ```bash
  git add docs/superpowers/specs/2026-08-20-physical-keyboard-focus-design.md
  git commit -m "docs: confirm physical keyboard focus root cause"
  ```

### Task 2: Add failing physical-keyboard focus-policy tests

**Files:**
- Modify: `web/keyboard-visibility.test.ts`
- Modify: `web/keyboard-visibility.ts`

**Interfaces:**
- Consumes: existing `shouldReleaseFocus(prevVisible, nextVisible, focused)` behavior.
- Produces: `PhysicalKeySample`, `isPhysicalKeyboardEvent(sample): boolean`, and `shouldReleaseFocus(prevVisible, nextVisible, focused, recentPhysicalInput): boolean`.

- [ ] **Step 1: Define the event sample interface without implementing classification**

  Add to `web/keyboard-visibility.ts`:

  ```ts
  export interface PhysicalKeySample {
    type: string;
    key: string;
    code: string;
    keyCode: number;
    isComposing: boolean;
  }

  export function isPhysicalKeyboardEvent(_sample: PhysicalKeySample): boolean {
    return false;
  }
  ```

  Extend `shouldReleaseFocus` with `recentPhysicalInput = false` but leave its current
  return expression unchanged so the new preservation test fails first:

  ```ts
  export function shouldReleaseFocus(
    prevVisible: boolean,
    nextVisible: boolean,
    focused: boolean,
    recentPhysicalInput = false,
  ): boolean {
    void recentPhysicalInput;
    return prevVisible && !nextVisible && focused;
  }
  ```

- [ ] **Step 2: Add the classifier and release-policy regression matrix**

  Import `isPhysicalKeyboardEvent` and add these cases to
  `web/keyboard-visibility.test.ts`:

  ```ts
  describe('physical keyboard event classification', () => {
    const key = (over: Partial<PhysicalKeySample> = {}): PhysicalKeySample => ({
      type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65,
      isComposing: false, ...over,
    });

    it.each([
      ['letter', key()],
      ['arrow', key({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 })],
      ['control chord', key({ key: 'c', code: 'KeyC', keyCode: 67 })],
      ['numpad', key({ key: 'Enter', code: 'NumpadEnter', keyCode: 13 })],
    ])('accepts a usable physical %s keydown', (_name, sample) => {
      expect(isPhysicalKeyboardEvent(sample)).toBe(true);
    });

    it.each([
      ['keyup', key({ type: 'keyup' })],
      ['composition', key({ isComposing: true })],
      ['Android IME key code', key({ keyCode: 229 })],
      ['unidentified key', key({ key: 'Unidentified' })],
      ['missing physical code', key({ code: '' })],
    ])('rejects %s', (_name, sample) => {
      expect(isPhysicalKeyboardEvent(sample)).toBe(false);
    });
  });
  ```

  In the existing `shouldReleaseFocus` describe block, add:

  ```ts
  it('keeps focus when physical input caused the IME to retract', () => {
    expect(shouldReleaseFocus(true, false, true, true)).toBe(false);
  });

  it('still releases focus when Android hide has no physical marker', () => {
    expect(shouldReleaseFocus(true, false, true, false)).toBe(true);
  });
  ```

- [ ] **Step 3: Run the focused tests and verify the intended failures**

  ```bash
  pnpm vitest run web/keyboard-visibility.test.ts
  ```

  Expected: classifier acceptance cases and the physical-input focus-preservation case
  fail; all pre-existing visibility and explicit-hide cases pass.

- [ ] **Step 4: Implement the minimal pure policy**

  Replace the classifier body with:

  ```ts
  return sample.type === 'keydown'
    && !sample.isComposing
    && sample.key !== 'Unidentified'
    && sample.keyCode !== 229
    && sample.code !== '';
  ```

  Replace the release expression with:

  ```ts
  return prevVisible && !nextVisible && focused && !recentPhysicalInput;
  ```

- [ ] **Step 5: Run the focused tests and type-check through the build**

  ```bash
  pnpm vitest run web/keyboard-visibility.test.ts
  pnpm build
  ```

  Expected: both commands pass.

- [ ] **Step 6: Commit the pure focus policy**

  ```bash
  git add web/keyboard-visibility.ts web/keyboard-visibility.test.ts
  git commit -m "test: define physical keyboard focus policy"
  ```

### Task 3: Correlate physical keydown with one viewport transition

**Files:**
- Modify: `web/main.ts`
- Test: `web/keyboard-visibility.test.ts`

**Interfaces:**
- Consumes: `isPhysicalKeyboardEvent(PhysicalKeySample)` and four-argument `shouldReleaseFocus(...)` from Task 2.
- Produces: a capture-phase keydown marker that is valid for `PHYSICAL_KEY_RESIZE_WINDOW_MS = 1000` and consumed on the next visible-to-hidden viewport transition.

- [ ] **Step 1: Add a pure timestamp correlation helper and failing tests**

  Add to `web/keyboard-visibility.ts`:

  ```ts
  export const PHYSICAL_KEY_RESIZE_WINDOW_MS = 1000;

  export function hasRecentPhysicalInput(
    physicalInputAt: number | null,
    now: number,
    windowMs = PHYSICAL_KEY_RESIZE_WINDOW_MS,
  ): boolean {
    return false;
  }
  ```

  Add tests proving that a marker at the same time and at 999 ms is recent, while
  `null`, a future timestamp, and markers 1,001 ms old are not recent:

  ```ts
  describe('physical key to viewport resize correlation', () => {
    it.each([
      [1000, 1000, true],
      [1, 1000, true],
      [0, 1001, false],
      [1001, 1000, false],
      [null, 1000, false],
    ])('marker %s at time %s => %s', (markedAt, now, expected) => {
      expect(hasRecentPhysicalInput(markedAt, now)).toBe(expected);
    });
  });
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  ```bash
  pnpm vitest run web/keyboard-visibility.test.ts
  ```

  Expected: the two recent-marker cases fail.

- [ ] **Step 3: Implement timestamp correlation**

  Replace the helper body with:

  ```ts
  if (physicalInputAt === null) return false;
  const age = now - physicalInputAt;
  return age >= 0 && age <= windowMs;
  ```

- [ ] **Step 4: Wire the marker into `initTerminal()`**

  Import `hasRecentPhysicalInput` and `isPhysicalKeyboardEvent`. Immediately before the
  existing focus/blur synchronization listeners, add:

  ```ts
  let physicalInputAt: number | null = null;

  t.textarea?.addEventListener('keydown', event => {
    if (isPhysicalKeyboardEvent(event)) physicalInputAt = performance.now();
  }, { capture: true });

  t.textarea?.addEventListener('blur', () => {
    physicalInputAt = null;
  });
  ```

  In the `visualViewport.resize` listener, compute and consume the marker only for a
  visible-to-hidden transition:

  ```ts
  const transitionHidKeyboard = prevVisible && !nextVisible;
  const recentPhysicalInput = transitionHidKeyboard
    && hasRecentPhysicalInput(physicalInputAt, performance.now());

  if (transitionHidKeyboard) physicalInputAt = null;
  if (shouldReleaseFocus(
    prevVisible, nextVisible, terminalFocused(), recentPhysicalInput,
  )) t.blur();
  ```

  Keep `prevVisible = nextVisible` and `syncKeyboardButton()` in their existing order
  after the decision. Do not call `preventDefault`, `stopPropagation`, `ws.send`, or the
  input pipeline from this listener; xterm remains the only encoder for physical keys.

- [ ] **Step 5: Clear stale correlation during explicit focus ownership changes**

  Beside the existing module-level `resetInputModifiers`, add:

  ```ts
  let resetPhysicalInput = (): void => {};
  ```

  After declaring `physicalInputAt` in `initTerminal`, assign:

  ```ts
  resetPhysicalInput = () => { physicalInputAt = null; };
  ```

  Call `resetPhysicalInput()` immediately before each explicit `t.blur()` used by
  `onRequestKeyboardClose`, selection activation, `toggleKeyboard` close, and
  `openKeyboard`'s blur/focus reset. Use it in the textarea `blur` listener too. This
  gives the module-level keyboard functions one narrow reset operation without moving
  physical key encoding or terminal bytes outside xterm.

- [ ] **Step 6: Run focused and full automated verification**

  ```bash
  pnpm vitest run web/keyboard-visibility.test.ts web/input-pipeline.test.ts web/keybar.test.ts web/text-selection.test.ts
  pnpm test
  pnpm build
  ```

  Expected: all focused tests, all 377+ repository tests, and both frontend/server builds pass.

- [ ] **Step 7: Commit the browser integration**

  ```bash
  git add web/main.ts web/keyboard-visibility.ts web/keyboard-visibility.test.ts
  git commit -m "fix: preserve focus for physical keyboard input"
  ```

### Task 4: Document and verify the complete mobile keyboard contract

**Files:**
- Modify: `README.md`
- Verify: `web/main.ts`, `web/keyboard-visibility.ts`, `web/keyboard-visibility.test.ts`

**Interfaces:**
- Consumes: the confirmed behavior from Tasks 1-3.
- Produces: operator/contributor guidance and target-device acceptance evidence.

- [ ] **Step 1: Update the README keyboard pitfalls section**

  After the existing explanation that focus is not equivalent to IME visibility, add:

  ```md
  - **Bluetooth keyboard input must survive Android retracting the IME.** A physical
    `keydown` can be followed by the same `visualViewport` visible→hidden transition as
    Android's native hide-keyboard button. The former keeps xterm's helper textarea
    focused; the latter releases it. Keep the physical-key classifier and the one-shot
    resize correlation in `keyboard-visibility.ts` covered together—treating every IME
    retraction as an unconditional blur breaks hardware keyboards after the first keys.
  ```

- [ ] **Step 2: Run target-device Bluetooth keyboard acceptance checks**

  On the device/browser recorded in Task 1:

  1. Open the IME with `⌨`, then type at least 30 mixed physical keys: letters, spaces,
     Enter, Backspace, arrows, Ctrl+C, and an Alt-modified key. Confirm the IME may
     retract but the textarea stays focused and every intended key reaches the PTY.
  2. Reopen the IME and press Android's native hide-keyboard control without a physical
     key immediately beforehand. Confirm the textarea becomes unfocused and a later
     terminal swipe does not reopen the IME.
  3. Tap `⌨` again and confirm the on-screen keyboard opens and types normally.
  4. Disconnect the Bluetooth keyboard, reopen the IME, and confirm normal soft-keyboard
     input, sticky modifiers, and explicit close still work.
  5. Enter selection mode and confirm its focus guard still prevents both physical and
     on-screen typing until selection is cancelled.

- [ ] **Step 3: Inspect the final diff for scope and temporary diagnostics**

  ```bash
  git diff main...HEAD --check
  git diff main...HEAD --stat
  rg -n "keyboard-focus-trace|console\.(debug|log)" web
  ```

  Expected: no whitespace errors, no temporary trace/logging code, and changes only in
  the spec, plan, README, `web/main.ts`, `web/keyboard-visibility.ts`, and its test.

- [ ] **Step 4: Run final verification**

  ```bash
  pnpm test
  pnpm build
  git status --short
  ```

  Expected: all tests and builds pass; status shows only the intended README update and
  this plan document if it was not committed earlier.

- [ ] **Step 5: Commit documentation**

  ```bash
  git add README.md docs/superpowers/plans/2026-08-20-physical-keyboard-focus.md
  git commit -m "docs: explain physical keyboard focus handling"
  ```
