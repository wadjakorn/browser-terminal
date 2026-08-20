# Independent Terminal Focus and IME Visibility

Date: 2026-08-20
Status: Approved design; implementation plan pending

## Goal

Bluetooth keyboard input must work immediately after the terminal session opens and
must continue after Android hides its on-screen keyboard. Users must not need to open
the IME first merely to focus xterm.

## Confirmed root cause

xterm receives keyboard events only through its hidden helper textarea. The current app
uses focus as part of its IME visibility policy:

- `startSession()` creates xterm but does not focus it.
- `openKeyboard()` calls `blur()` then `focus()`, so Bluetooth input begins working only
  after the user taps `⌨`.
- A visible-to-hidden `visualViewport` transition may call `t.blur()`, so hiding the IME
  also disconnects the physical keyboard.

The accepted-input correlation added in commit `e0d46d2` prevents one blur when a
Bluetooth key causes the IME to retract. It cannot help when the textarea started
unfocused, because no key reaches xterm or `onData` in that state.

The architectural error is treating two independent states as one:

1. whether xterm owns terminal input focus;
2. whether the Android IME is allowed to appear.

## Behavioral contract

- After session start, xterm owns focus in physical-keyboard mode and Bluetooth typing
  works without first opening the IME.
- Physical-keyboard mode keeps the helper textarea focused with `inputMode = "none"`.
- Tapping `⌨` while the IME is hidden enters soft-keyboard mode and opens the IME.
- Tapping `⌨` while the IME is visible returns to physical-keyboard mode, hides the IME,
  and leaves xterm focused.
- Android's native hide-keyboard action returns to physical-keyboard mode without
  blurring xterm.
- Touching, tapping, dragging, or swiping the terminal in physical-keyboard mode must
  not reopen the IME.
- Selection mode continues to blur xterm and rejects both physical and soft keyboard
  input while active. Leaving selection restores physical-keyboard mode and focus.
- Login, password, and settings inputs may own focus normally. The terminal must not
  steal focus through a global focus or keyboard listener.
- All terminal bytes continue through xterm and `web/input-pipeline.ts`; no document-
  level key encoder or parallel WebSocket path is added.

## Design

### Focus-mode controller

Add a small pure controller in a focused module, `web/keyboard-focus-mode.ts`. It owns
the desired terminal input mode but performs no DOM operations itself.

```ts
export type TerminalFocusMode = 'physical' | 'soft' | 'suspended';

export type TerminalFocusEffect =
  | { type: 'focus'; inputMode: 'none' | 'text'; cycle: boolean }
  | { type: 'blur' }
  | { type: 'none' };

export interface TerminalFocusState {
  mode: TerminalFocusMode;
}
```

Transitions:

| Event | Next mode | Effect |
|---|---|---|
| session ready | physical | focus with `inputMode="none"`; no focus cycle |
| request IME open | soft | set `inputMode="text"`, then blur/focus in the same user gesture |
| request IME close | physical | set `inputMode="none"`, then blur/focus in the same user gesture |
| native IME hidden | physical | set `inputMode="none"`; retain existing textarea focus |
| selection entered | suspended | blur |
| selection exited | physical | focus with `inputMode="none"`; no focus cycle |
| another real input owns focus | suspended | no terminal refocus |
| terminal directly activated | physical or soft, unchanged | focus using the current input mode |

`cycle: true` means blur then focus synchronously. It is used only by the explicit `⌨`
control, where a user activation is available and Android requires the focus edge to
open or close the IME reliably. Native IME dismissal does not cycle focus because the
IME is already hidden and physical input must remain attached.

### DOM adapter

`web/main.ts` applies controller effects through one adapter around xterm's helper
textarea:

1. Set `t.textarea.inputMode` before focusing.
2. For `cycle: true`, call `t.blur()` followed immediately by `t.focus()`.
3. For ordinary physical focus, call `t.focus()` without a preceding blur.
4. Never focus while selection mode is active or while a visible non-terminal input
   owns `document.activeElement`.

The adapter centralizes all mode-driven `inputMode`, `focus()`, and `blur()` operations.
The selection touch path still blurs because selection geometry cannot tolerate an IME
transition. Ordinary tap and drag paths must stop blurring merely because the IME is
hidden; `inputMode="none"` now prevents the unwanted IME opening while preserving
physical focus.

### Session start

After `initTerminal()` has opened xterm and the app page is visible, enter physical mode
before awaiting the WebSocket connection. `inputMode="none"` is set before `t.focus()`,
so programmatic focus does not request the IME. No user activation is required to route
later physical keyboard events to the focused textarea.

### Keyboard controls and viewport transitions

Replace `toggleKeyboard()`'s focus-as-visibility behavior with controller events:

- The `⌨` button still uses `keyboardVisible()` to choose open versus close.
- Open requests soft mode and a `text` blur/focus cycle.
- Close requests physical mode and a `none` blur/focus cycle.
- A `visualViewport` visible-to-hidden transition dispatches `native IME hidden`; it no
  longer calls `t.blur()`.

The accepted-input timing guard becomes unnecessary and is removed. It solved only the
symptom created by the old blur policy, not the unfocused-session root cause.

### Touch and selection

xterm already focuses its textarea from terminal mouse activation. In physical mode,
the textarea has `inputMode="none"`, so this preserves hardware focus without opening
the IME. Remove the current post-tap `!wasVisible` blur and post-drag `!wasVisible` blur.
Opening an external link may still blur. Existing synthetic mouse flags, mouse reporting,
gesture recognition, and selection geometry remain unchanged.

Selection remains an explicit suspension boundary:

- entering selection sets suspended mode before blurring;
- xterm's Linux-selection focus guard continues to blur any focus attempt while active;
- closing/cancelling selection exits to physical mode, sets `inputMode="none"`, and
  restores focus only after selection is inactive.

No global `keydown`, `focus`, or `blur` loop is added. This prevents the terminal from
stealing focus from the login password or keybar customization inputs.

### Compatibility fallback

The target is Android Chrome, where `HTMLTextAreaElement.inputMode = "none"` is expected
to suppress the virtual keyboard. Browser support must be verified on the affected
device. If the browser ignores `inputMode="none"`, do not add a document-level key
encoder or synthesize character events as a fallback; those approaches lose keyboard
layout, composition, dead-key, and terminal-mode fidelity. Record the unsupported
browser and keep the existing explicit `⌨` behavior there.

## Files

- Create `web/keyboard-focus-mode.ts`: pure state transitions and effects.
- Create `web/keyboard-focus-mode.test.ts`: transition matrix and regression sequences.
- Modify `web/main.ts`: DOM adapter, session-start focus, keyboard toggle, viewport, and
  selection integration; remove hidden-IME blur from ordinary terminal tap and drag.
- Modify `web/keyboard-visibility.ts`: remove the accepted-input focus guard while
  retaining viewport-based IME visibility detection.
- Modify `web/keyboard-visibility.test.ts`: remove obsolete guard tests; preserve native
  visibility tests.
- Modify `README.md`: document separate terminal-focus and IME-visibility states.

No server, PTY, WebSocket, authentication, keybar layout, CSS, dependency, or terminal
input-pipeline change is required.

## Testing

### Automated

- Physical mode always requests `inputMode="none"` and focus.
- Soft mode always requests `inputMode="text"` with a focus cycle.
- Native IME dismissal returns to physical mode without blur.
- Explicit IME close returns to physical mode with a cycle.
- Selection entry blurs and selection exit restores physical mode.
- Suspended mode does not automatically reclaim focus from another input.
- Ordinary terminal tap and drag in physical mode retain textarea focus without opening
  the IME; selection entry still blurs.
- Existing keyboard visibility, input pipeline, keybar, touch gesture, and selection
  suites remain green.
- Run `pnpm test` and `pnpm build`.

### Android acceptance

1. Start a session and type at least 30 mixed Bluetooth keys without ever opening the
   IME. The first key and every subsequent key must reach the PTY.
2. Tap `⌨`, type with the soft keyboard, then type with Bluetooth while the IME retracts.
   Focus and input must continue.
3. Hide the IME using Android's native control, then type with Bluetooth immediately.
4. Toggle `⌨` open and closed repeatedly; physical input must work after every close.
5. Tap, swipe, drag, and pinch the terminal in physical mode; the IME must stay hidden.
6. Enter selection mode; both keyboards must stop affecting the terminal. Exit selection
   and verify Bluetooth input resumes without opening the IME.
7. Focus the login/password or a settings input and verify terminal focus does not steal
   its keystrokes.

## Scrutinize review history

### Iteration 1

**Verdict before revision:** rework.

- **Finding:** A global `keydown` listener that focuses xterm cannot deliver the first
  physical key. **Why it matters:** the event target is fixed before dispatch, while
  xterm's keyboard listeners are attached to its textarea. **Addressed:** the textarea
  remains focused in physical mode instead of attempting reactive focus.
- **Finding:** Keeping ordinary textarea focus would reintroduce the Android IME rebound
  fixed by commit `ebbf7cc`. **Why it matters:** hidden IME and focused text input were
  previously enough for later touch interaction to reopen it. **Addressed:** physical
  mode combines retained focus with `inputMode="none"`.

### Iteration 2

**Verdict before revision:** fix-then-ship.

- **Finding:** Changing `inputMode` alone does not define reliable explicit open/close
  behavior. **Why it matters:** Android may require a new focus edge to attach or detach
  the IME. **Addressed:** `⌨` transitions set input mode first, then synchronously
  blur/focus; native dismissal retains focus without cycling.
- **Finding:** Session-start behavior was unspecified. **Why it matters:** fixing only
  post-IME transitions still leaves Bluetooth input dead when the user never opens the
  IME. **Addressed:** session start enters focused physical mode before connection wait.

### Iteration 3

**Verdict before revision:** fix-then-ship.

- **Finding:** An unconditional focus-restoration listener would steal input from real
  form controls and fight selection mode. **Why it matters:** the app contains password
  and customization inputs, while selection deliberately owns focus state. **Addressed:**
  there is no global refocus loop; only explicit controller transitions restore focus,
  and suspended mode protects other inputs and selection.
- **Finding:** The accepted-input timing guard would become dead complexity under the
  new focus policy. **Why it matters:** two competing focus mechanisms would make future
  regressions harder to reason about. **Addressed:** the design removes the timing guard
  and makes the focus-mode controller the single policy owner.
