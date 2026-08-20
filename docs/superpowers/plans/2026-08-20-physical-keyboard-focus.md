# Physical Keyboard Focus Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep xterm focused when Android retracts its IME in response to Bluetooth keyboard input, without regressing explicit OS keyboard dismissal.

**Architecture:** Confirm the browser event sequence on the affected Android device first. Then classify trustworthy physical `keydown` events in a pure helper, correlate one such event with the following `visualViewport` visible-to-hidden transition, and preserve the existing blur behavior for transitions without that marker.

**Tech Stack:** TypeScript, xterm.js 6, Visual Viewport API, Vitest 3, Vite 8

**Spec:** `docs/superpowers/specs/2026-08-20-physical-keyboard-focus-design.md`

**Execution status (2026-08-20):** The original `onKey` classifier implementation failed
on the target device. The corrected implementation correlates xterm's accepted `onData`
input with the following IME retraction, independent of DOM keyboard-event shape and
current viewport geometry. See “Post-implementation correction” below.

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
  t.onKey(({ domEvent }) => traceKeyboard('xterm-onKey', domEvent));
  ```

  In the existing `visualViewport.resize` listener, temporarily replace the release
  call with an explicitly traced decision:

  ```ts
  const focused = terminalFocused();
  const release = shouldReleaseFocus(prevVisible, nextVisible, focused);
  traceKeyboard(`viewport-resize release=${release}`);
  if (release) {
    traceKeyboard('application-blur');
    t.blur();
  }
  ```

  This instruments the actual branch under investigation rather than relying on the
  relative order of independent listeners.

- [ ] **Step 2: Run the app and capture the Bluetooth-keyboard failure**

  Connect the Android device over USB with debugging enabled and forward both loopback
  development ports:

  ```bash
  adb reverse tcp:5173 tcp:5173
  adb reverse tcp:7000 tcp:7000
  ```

  Run the server and web processes in separate terminals. `DEV_ORIGINS` belongs to the
  Node server because that process validates WebSocket origins; it has no effect when
  attached to Vite:

  ```bash
  DEV_ORIGINS=http://localhost:5173 pnpm dev:server
  pnpm dev:web
  ```

  Open `http://localhost:5173` on the Android device through the ADB reverse tunnel and
  attach Chrome remote DevTools to capture the console. This keeps credentials and the
  shell session on loopback instead of exposing the development server as plaintext on
  the LAN. Open the on-screen keyboard, then type at least ten characters and navigation
  keys on the Bluetooth keyboard. Save the ordered trace from the first physical
  `keydown` through the unexpected `blur`.

  Expected evidence for the current hypothesis: a raw `keydown` and subsequent
  `xterm-onKey` with non-empty `code`, `keyCode !== 229`, and
  `isComposing === false`; then
  `viewport-resize release=true` as the viewport crosses from keyboard visible to
  hidden; then `application-blur` and the textarea's `blur` event.

- [ ] **Step 3: Capture the explicit Android hide-keyboard control path**

  Reopen the IME, do not press the Bluetooth keyboard, and press Android's native
  hide-keyboard control.

  Expected evidence: the same `viewport-resize release=true`, `application-blur`, and
  textarea `blur` sequence, but no preceding qualifying physical `keydown`.

- [ ] **Step 4: Gate the remaining plan on the evidence**

  If both expected traces match, add a short `## Confirmed device trace` section to the
  spec containing device/browser versions, event ordering, and relevant event fields.
  Change the spec status to `Root cause confirmed; ready for implementation`.

  If the first trace does not match, stop. Restore `web/main.ts`, change the spec status
  to `Hypothesis rejected`, record the actual blur source, and write a revised design
  before implementing any fix.

- [ ] **Step 5: Remove all temporary trace code and verify the diff**

  Remove the `traceKeyboard` block, restore the original viewport listener, and run:

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

  Import `isPhysicalKeyboardEvent` and `type PhysicalKeySample`, then add these cases to
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
- Produces: `createPhysicalKeyboardFocusGuard({ now, windowMs? })`, a sequence-tested controller whose marker is armed only by xterm-accepted physical input while the IME is visible, valid for `PHYSICAL_KEY_RESIZE_WINDOW_MS = 1000`, and consumed on the next visible-to-hidden viewport transition.

- [ ] **Step 1: Add the pure controller interface with a deliberately inert implementation**

  Add to `web/keyboard-visibility.ts`:

  ```ts
  export const PHYSICAL_KEY_RESIZE_WINDOW_MS = 1000;

  export interface PhysicalKeyboardFocusGuard {
    noteKey(sample: PhysicalKeySample, keyboardVisible: boolean): void;
    shouldRelease(prevVisible: boolean, nextVisible: boolean, focused: boolean): boolean;
    reset(): void;
  }

  export function createPhysicalKeyboardFocusGuard(options: {
    now: () => number;
    windowMs?: number;
  }): PhysicalKeyboardFocusGuard {
    return {
      noteKey() {},
      shouldRelease: (prevVisible, nextVisible, focused) =>
        shouldReleaseFocus(prevVisible, nextVisible, focused),
      reset() {},
    };
  }
  ```

  Import `createPhysicalKeyboardFocusGuard` and add sequence tests. Use a mutable clock
  so no fake timers or browser globals are required:

  ```ts
  describe('physical keyboard focus guard sequences', () => {
    const physicalA: PhysicalKeySample = {
      type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65, isComposing: false,
    };

    function build() {
      let now = 1000;
      return {
        guard: createPhysicalKeyboardFocusGuard({ now: () => now }),
        advance: (ms: number) => { now += ms; },
      };
    }

    it('preserves focus for the IME retraction immediately following a physical key', () => {
      const { guard } = build();
      guard.noteKey(physicalA, true);
      expect(guard.shouldRelease(true, false, true)).toBe(false);
    });

    it('does not arm from physical keys received while the IME is already hidden', () => {
      const { guard } = build();
      guard.noteKey(physicalA, false);
      expect(guard.shouldRelease(true, false, true)).toBe(true);
    });

    it('expires the correlation after the viewport animation window', () => {
      const { guard, advance } = build();
      guard.noteKey(physicalA, true);
      advance(1001);
      expect(guard.shouldRelease(true, false, true)).toBe(true);
    });

    it('consumes the marker so it cannot mask a second dismissal', () => {
      const { guard } = build();
      guard.noteKey(physicalA, true);
      expect(guard.shouldRelease(true, false, true)).toBe(false);
      expect(guard.shouldRelease(true, false, true)).toBe(true);
    });

    it('reset and loss of focus clear a pending marker', () => {
      const first = build().guard;
      first.noteKey(physicalA, true);
      first.reset();
      expect(first.shouldRelease(true, false, true)).toBe(true);

      const second = build().guard;
      second.noteKey(physicalA, true);
      expect(second.shouldRelease(true, true, false)).toBe(false);
      expect(second.shouldRelease(true, false, true)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  ```bash
  pnpm vitest run web/keyboard-visibility.test.ts
  ```

  Expected: preservation and controller-state cases fail while existing release-policy
  tests continue to pass.

- [ ] **Step 3: Implement the one-shot correlation controller**

  Replace the factory body with:

  ```ts
  const windowMs = options.windowMs ?? PHYSICAL_KEY_RESIZE_WINDOW_MS;
  let physicalInputAt: number | null = null;

  return {
    noteKey(sample, keyboardVisible) {
      if (keyboardVisible && isPhysicalKeyboardEvent(sample)) {
        physicalInputAt = options.now();
      }
    },
    shouldRelease(prevVisible, nextVisible, focused) {
      if (!focused || (!prevVisible && nextVisible)) physicalInputAt = null;

      let recentPhysicalInput = false;
      if (prevVisible && !nextVisible && physicalInputAt !== null) {
        const age = options.now() - physicalInputAt;
        recentPhysicalInput = age >= 0 && age <= windowMs;
        physicalInputAt = null;
      }

      return shouldReleaseFocus(
        prevVisible, nextVisible, focused, recentPhysicalInput,
      );
    },
    reset() { physicalInputAt = null; },
  };
  ```

- [ ] **Step 4: Wire the marker into `initTerminal()`**

  Import `createPhysicalKeyboardFocusGuard`. Immediately before the existing focus/blur
  synchronization listeners, add:

  ```ts
  const physicalKeyboardFocus = createPhysicalKeyboardFocusGuard({
    now: () => performance.now(),
  });

  t.onKey(({ domEvent }) => {
    physicalKeyboardFocus.noteKey(domEvent, keyboardVisible());
  });

  t.textarea?.addEventListener('blur', () => {
    physicalKeyboardFocus.reset();
  });
  ```

  Replace the current release call in the `visualViewport.resize` listener with:

  ```ts
  if (physicalKeyboardFocus.shouldRelease(
    prevVisible, nextVisible, terminalFocused(),
  )) t.blur();
  ```

  Keep `prevVisible = nextVisible` and `syncKeyboardButton()` in their existing order
  after the decision. Do not call `preventDefault`, `stopPropagation`, `ws.send`, or the
  input pipeline from this listener; xterm remains the only encoder for physical keys.
  The public `onKey` event is observational and does not create another byte path.

- [ ] **Step 5: Verify every explicit focus-loss path reaches the shared reset**

  Do not add reset calls beside every `t.blur()`. The helper textarea's shared `blur`
  listener from Step 4 resets the guard for `onRequestKeyboardClose`, selection mode,
  `toggleKeyboard`, `openKeyboard`, touch gestures, and any browser/xterm-owned focus
  loss. Trace each current `t.blur()` call in `web/main.ts` and confirm it either blurs
  the focused helper textarea (therefore firing the listener) or starts with no focused
  textarea and therefore cannot have an armed marker. Add a comment beside the listener:

  ```ts
  // Every app, browser, and xterm focus-loss path converges on this DOM event.
  t.textarea?.addEventListener('blur', () => physicalKeyboardFocus.reset());
  ```

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

## Scrutinize Review History

## Post-implementation correction

Target-device feedback showed the first Bluetooth key reached the terminal and then the
IME retracted and focus was lost. That disproved the plan's assumption that a qualifying
`onKey` event would always arm the guard while `keyboardVisible()` was still true.

The implementation now arms the one-shot guard from `t.onData`, immediately before the
existing input pipeline call. `onData` is the only reliable proof needed: xterm accepted
the input, whether Android delivered it through `keydown`, `keypress`, or `input`, and
whether the viewport animation started before or after that browser event. The guard
still expires after 1,000 ms, is consumed by one visible→hidden transition, and resets
on blur. No second terminal-byte path was added.

### Iteration 1

**Verdict before revision:** rework — the proposed marker could outlive the transition
it was intended to explain, and the tests did not exercise the stateful sequence.

- **Finding:** Every classified hardware key armed the marker, including keys received
  after the IME was already hidden. **Why it matters:** a stale marker could suppress a
  later genuine OS hide action. **Evidence:** the original Task 3 keydown listener wrote
  `physicalInputAt` without consulting `keyboardVisible()`, while consumption occurred
  only on a later visible-to-hidden transition. **Addressed:** `noteKey` now arms only
  while the IME is visible.
- **Finding:** Predicate tests could pass while marker lifecycle wiring remained wrong.
  **Why it matters:** the bug is an ordering problem across keydown, viewport resize,
  focus, and reset events. **Evidence:** the original plan tested classification and age
  separately but had no test for consumption or stale state. **Addressed:** Task 3 now
  introduces a pure controller with full sequence tests for preservation, expiry,
  consumption, hidden-IME keys, reset, and focus loss.
- **Finding:** The test instructions used `PhysicalKeySample` without explicitly
  importing the type. **Why it matters:** a literal execution of the plan would fail
  TypeScript compilation. **Evidence:** Task 2 named only the value import.
  **Addressed:** the plan now calls out both the value and type imports.

### Iteration 2

**Verdict before revision:** fix-then-ship — the proposed code path was testable, but
the target-device evidence procedure could not reliably reach or identify that path.

- **Finding:** The development commands attached `DEV_ORIGINS` to Vite, although origin
  validation runs in `server/config.ts` and `server/index.ts`. **Why it matters:** the
  WebSocket handshake from the Vite origin could still be rejected, preventing a valid
  reproduction. **Evidence:** `server/config.ts` reads `process.env.DEV_ORIGINS`; Vite
  never consumes it. **Addressed:** the variable is now applied to `pnpm dev:server`.
- **Finding:** Opening `http://localhost:5173` on Android addresses the phone itself, not
  the development machine. **Why it matters:** the plan omitted a usable and safe path
  to the instrumented build. **Evidence:** Vite and the server bind loopback by default
  in `vite.config.ts` and `server/config.ts`. **Addressed:** Task 1 now uses `adb reverse`
  for ports 5173 and 7000 and keeps the security-sensitive terminal session on loopback.
- **Finding:** Independent resize and blur logs showed ordering but did not prove that
  `shouldReleaseFocus` caused the blur. **Why it matters:** xterm or another listener
  could blur in the same interval, producing a false root-cause conclusion. **Evidence:**
  the original trace listener was separate from `web/main.ts`'s release branch.
  **Addressed:** the temporary probe now logs the exact decision and immediately logs
  the application-owned `t.blur()` call.

### Iteration 3

**Verdict before revision:** fix-then-ship — the policy was coherent, but integration
used lower-level and broader state plumbing than the existing xterm API requires.

- **Finding:** The plan observed physical input by adding another listener directly to
  xterm's helper textarea. **Why it matters:** that private DOM seam is more coupled to
  xterm internals and made listener ordering part of correctness. **Evidence:** xterm 6
  already exposes `Terminal.onKey` in `node_modules/@xterm/xterm/typings/xterm.d.ts`,
  including the original `domEvent`. **Addressed:** the device trace now verifies
  `onKey` ordering and production integration uses that public synchronous event.
- **Finding:** A module-level `resetPhysicalInput` callback and edits around selected
  `t.blur()` calls duplicated a convergence point that already exists. **Why it matters:**
  missing any current or future blur call would leave stale state, while touching all
  callers expands the diff. **Evidence:** app, browser, and xterm focus loss all produce
  the helper textarea's DOM `blur` event, which `web/main.ts` already observes.
  **Addressed:** the plan resets once in the shared blur listener and explicitly traces
  every current `t.blur()` path to validate that assumption.
- **Finding:** The plan did not prove that the proposed public `onKey` seam precedes the
  viewport transition on the affected browser. **Why it matters:** a correct classifier
  is useless if its marker arrives after the release decision. **Evidence:** Task 1 only
  logged raw textarea keydown. **Addressed:** the trace now records `xterm-onKey`, and
  implementation remains gated on it occurring before `viewport-resize release=true`.
