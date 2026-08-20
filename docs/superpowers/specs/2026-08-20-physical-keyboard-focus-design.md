# Physical Keyboard Focus Preservation

Date: 2026-08-20
Status: Implemented with automated coverage; target-device validation pending

## Problem

The terminal works correctly with Android's on-screen keyboard. With a Bluetooth
keyboard, however, only the first one or two keys reach the PTY before xterm's hidden
textarea loses focus. Further physical keystrokes then go nowhere until the user
focuses the terminal again.

## Current behavior and likely root cause

`web/main.ts` listens to `visualViewport.resize`. When the viewport changes from
"soft keyboard visible" to "soft keyboard hidden" while xterm's textarea is still
focused, it calls `t.blur()` through `shouldReleaseFocus()`.

That behavior was added in commit `ebbf7cc` for a different Android case: pressing
the OS hide-keyboard button hides the IME without blurring its textarea, and the next
touch can otherwise reopen the IME. The current predicate cannot distinguish that
explicit dismissal from Android automatically retracting the IME after a Bluetooth
keyboard begins sending physical `keydown` events. In both cases it sees:

```text
visualViewport: keyboard visible -> keyboard hidden
textarea: focused
```

The reported delay of one or two accepted keys is consistent with event ordering:
the physical key reaches xterm first, Android retracts the IME, the viewport resize
arrives afterward, and the application's resize handler blurs the textarea.

This is the leading hypothesis, not yet a device-measured conclusion. The normal
investigation path is to capture the ordering on the affected device and verify that
the application's visible-to-hidden viewport handler is the source of the blur.

On 2026-08-20, the user explicitly authorized implementation without ADB. Automated
regression coverage therefore gates the code change, while the target-device trace and
Bluetooth-keyboard acceptance checks remain required before claiming device validation.

## Desired behavior

- A Bluetooth or otherwise physical keyboard keeps xterm's textarea focused when
  Android retracts the on-screen keyboard in response to physical input.
- Physical character, navigation, modifier, and control keys continue through xterm
  and `web/input-pipeline.ts` without a parallel byte path.
- Pressing Android's own hide-keyboard control still releases textarea focus, preserving
  the fix from commit `ebbf7cc`.
- The explicit `⌨` control remains the only app-provided way to open or close the IME.
- Selection mode continues to own focus and may still blur the textarea immediately.
- Touch gestures, sticky modifiers, and responsive keybar behavior remain unchanged.

## Design

### 1. Confirm event ordering on the target device

Use a temporary, uncommitted event trace on xterm's helper textarea and
`visualViewport`. Record `keydown`, textarea `focus`/`blur`, viewport `resize`,
`document.activeElement`, viewport dimensions, `KeyboardEvent.key`,
`KeyboardEvent.code`, `KeyboardEvent.keyCode`, and `isComposing`.

Run two traces:

1. Open the IME, type with the Bluetooth keyboard until focus is lost.
2. Open the IME and press Android's hide-keyboard control without using the Bluetooth
   keyboard.

Proceed with the design below only if trace 1 shows a usable physical-key marker before
the visible-to-hidden resize and trace 2 does not. If the blur comes from a different
listener or xterm itself, stop and revise this design from that evidence.

### 2. Classify usable physical keyboard events

Add a small pure classifier in `web/keyboard-visibility.ts`. A keyboard event is a
physical-input signal only when all of these are true:

- `type === 'keydown'`
- `isComposing === false`
- `key !== 'Unidentified'`
- `keyCode !== 229`
- `code !== ''`

The `code` requirement is important: hardware keys normally expose a physical key
position such as `KeyA`, `ArrowLeft`, or `NumpadEnter`, while Android IME compatibility
events commonly use an empty code or composition key code 229. The target-device trace
is the gate for relying on this distinction.

### 3. Preserve focus for the associated viewport transition

When xterm's public synchronous `onKey` event reports a classified physical `keydown`
**while the IME is visible**, record its monotonic timestamp. Keys received while the
IME is already hidden cannot cause an IME-retraction transition and must not arm the
guard. The target-device trace must verify that `onKey` fires before the relevant
viewport resize. When a visible-to-hidden viewport transition arrives, suppress `t.blur()`
only if a classified event was observed in the immediately preceding 1,000 ms. Consume
that marker after evaluating the transition so it cannot mask a later, unrelated IME
dismissal.

Keep the existing release rule unchanged when there is no recent physical marker.
Actual textarea blur and an IME hidden-to-visible transition must clear the marker;
those paths already cover app keyboard toggles and selection mode without adding reset
calls to every `t.blur()` site. Encapsulate the marker in a small pure controller so
tests exercise complete keydown → viewport transition sequences rather than only
disconnected predicates.

The 1,000 ms window is not a keyboard mode timeout; it only correlates one key event
with the asynchronous viewport resize it caused. It is deliberately long enough for a
mobile viewport animation and short enough not to affect a later user action.

### 4. Verification

Unit tests cover classification and focus-release decisions without synthesizing
terminal bytes. Target-device checks cover the browser/OS behavior that Vitest cannot
model:

- Bluetooth keyboard input continues for at least 30 mixed keys after the IME retracts.
- Android's hide-keyboard control still leaves the textarea unfocused.
- Reopening the IME with `⌨` still works.
- Disconnecting the Bluetooth keyboard and returning to the on-screen keyboard still
  works.
- Selection mode still prevents keyboard focus.

## Files

- `web/keyboard-visibility.ts`: physical-event classifier and focus-release decision.
- `web/keyboard-visibility.test.ts`: regression matrix for both IME dismissal paths.
- `web/main.ts`: capture physical key timing and pass it into the pure decision.
- `README.md`: document physical keyboard focus behavior and the viewport distinction.

No server, PTY, WebSocket, input-pipeline, keybar layout, CSS, or dependency changes are
needed.
