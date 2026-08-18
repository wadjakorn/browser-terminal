import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInputPipeline,
  type BarKey,
  type ModifierName,
  type Modes,
} from './input-pipeline.js';

const modifier = (name: ModifierName): BarKey => ({ kind: 'modifier', name });
const lit = (data: string): BarKey => ({ kind: 'literal', data });
const bytes = (text: string) => [...new TextEncoder().encode(text)];

let sent: number[][];
let modes: Modes;
let pipeline: ReturnType<typeof createInputPipeline>;

beforeEach(() => {
  sent = [];
  modes = { applicationCursorKeysMode: false };
  pipeline = createInputPipeline({
    send: data => sent.push([...data]),
    getModes: () => modes,
  });
});

describe('modifier state machine', () => {
  it.each(['ctrl', 'shift', 'alt'] as const)('%s arms, locks within 300ms, then unlocks', name => {
    pipeline.onBarKey(modifier(name), 1000);
    expect(pipeline.modifierState()[name]).toBe('armed');
    pipeline.onBarKey(modifier(name), 1300);
    expect(pipeline.modifierState()[name]).toBe('locked');
    pipeline.onBarKey(modifier(name), 1400);
    expect(pipeline.modifierState()[name]).toBe('off');
  });

  it('a second tap after the 300ms boundary turns an armed modifier off', () => {
    pipeline.onBarKey(modifier('ctrl'), 1000);
    pipeline.onBarKey(modifier('ctrl'), 1301);
    expect(pipeline.modifierState().ctrl).toBe('off');
  });

  it('modifier taps do not consume other armed modifiers', () => {
    pipeline.onBarKey(modifier('ctrl'), 0);
    pipeline.onBarKey(modifier('shift'), 50);
    pipeline.onBarKey(modifier('alt'), 100);
    expect(pipeline.modifierState()).toEqual({ ctrl: 'armed', shift: 'armed', alt: 'armed' });
  });

  it('consumes all armed modifiers together and preserves locked modifiers', () => {
    pipeline.onBarKey(modifier('ctrl'), 0);
    pipeline.onBarKey(modifier('ctrl'), 100);
    pipeline.onBarKey(modifier('shift'), 200);
    pipeline.onBarKey(modifier('alt'), 250);
    pipeline.onTerminalData('a');
    expect(sent).toEqual([[0x1b, 0x01]]);
    expect(pipeline.modifierState()).toEqual({ ctrl: 'locked', shift: 'off', alt: 'off' });

    pipeline.onTerminalData('b');
    expect(sent[1]).toEqual([0x02]);
    expect(pipeline.modifierState().ctrl).toBe('locked');
  });

  it('unlocks modifiers independently', () => {
    for (const name of ['ctrl', 'alt'] as const) {
      pipeline.onBarKey(modifier(name), 0);
      pipeline.onBarKey(modifier(name), 100);
    }
    pipeline.onBarKey(modifier('ctrl'), 500);
    expect(pipeline.modifierState()).toEqual({ ctrl: 'off', shift: 'off', alt: 'locked' });
  });

  it('clears all modes only when explicitly reset for a new process', () => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onBarKey(modifier('shift'), 100);
    pipeline.clearModifiers();
    expect(pipeline.modifierState()).toEqual({ ctrl: 'off', shift: 'off', alt: 'off' });
  });
});

describe('character transformation order', () => {
  it.each([
    ['a', 'A'], ['z', 'Z'], ['`', '~'], ['1', '!'], ['2', '@'], ['3', '#'],
    ['4', '$'], ['5', '%'], ['6', '^'], ['7', '&'], ['8', '*'], ['9', '('],
    ['0', ')'], ['-', '_'], ['=', '+'], ['[', '{'], [']', '}'], ['\\', '|'],
    [';', ':'], ["'", '"'], [',', '<'], ['.', '>'], ['/', '?'],
  ])('Shift maps %s to %s', (input, output) => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onTerminalData(input);
    expect(sent).toEqual([bytes(output)]);
  });

  it.each(['A', 'Z', 'ก', '🙂'])('Shift leaves unsupported or already-uppercase %s unchanged', input => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onTerminalData(input);
    expect(sent).toEqual([bytes(input)]);
  });

  it('applies Shift, then Ctrl, then Alt', () => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onBarKey(modifier('ctrl'), 10);
    pipeline.onBarKey(modifier('alt'), 20);
    pipeline.onTerminalData('a');
    expect(sent).toEqual([[0x1b, 0x01]]);
  });
});

describe('cursor keys', () => {
  it('preserves normal and application cursor modes without modifiers', () => {
    pipeline.onTerminalData('\x1b[D');
    modes.applicationCursorKeysMode = true;
    pipeline.onTerminalData('\x1b[D');
    expect(sent).toEqual([bytes('\x1b[D'), bytes('\x1bOD')]);
  });

  it.each([
    [['shift'], 2],
    [['shift', 'alt'], 4],
    [['shift', 'ctrl'], 6],
    [['shift', 'alt', 'ctrl'], 8],
  ] as const)('encodes %j as CSI modifier %s in both cursor modes', (names, value) => {
    for (const mode of [false, true]) {
      modes.applicationCursorKeysMode = mode;
      for (const name of names) pipeline.onBarKey(modifier(name), 0);
      pipeline.onTerminalData('\x1b[A');
    }
    expect(sent).toEqual([bytes(`\x1b[1;${value}A`), bytes(`\x1b[1;${value}A`)]);
  });
});

describe('non-character inputs', () => {
  it.each([
    ['paste', 'hello world'],
    ['unknown sequence', '\x1b[3~'],
  ])('%s passes through and consumes only armed modifiers', (_label, input) => {
    pipeline.onBarKey(modifier('ctrl'), 0);
    pipeline.onBarKey(modifier('alt'), 0);
    pipeline.onBarKey(modifier('alt'), 100);
    pipeline.onTerminalData(input);
    expect(sent).toEqual([bytes(input)]);
    expect(pipeline.modifierState()).toEqual({ ctrl: 'off', shift: 'off', alt: 'locked' });
  });

  it('^C always sends byte 0x03 and consumes only armed modifiers', () => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onBarKey(modifier('ctrl'), 0);
    pipeline.onBarKey(modifier('ctrl'), 100);
    pipeline.onBarKey({ kind: 'interrupt' });
    expect(sent).toEqual([[0x03]]);
    expect(pipeline.modifierState()).toEqual({ ctrl: 'locked', shift: 'off', alt: 'off' });
  });

  it('dedicated ⇧Tab always sends CSI Z and consumes only armed modifiers', () => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onBarKey(modifier('alt'), 0);
    pipeline.onBarKey(modifier('alt'), 100);
    pipeline.onBarKey({ kind: 'backtab' });
    expect(sent).toEqual([bytes('\x1b[Z')]);
    expect(pipeline.modifierState()).toEqual({ ctrl: 'off', shift: 'off', alt: 'locked' });
  });

  it('toolbar literals use the same transformation path as native input', () => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onBarKey(lit('/'));
    expect(sent).toEqual([[0x3f]]);
  });

  it('toolbar navigation and editing sequences pass through and consume armed modifiers only', () => {
    pipeline.onBarKey(modifier('shift'), 0);
    pipeline.onBarKey(lit('\x1b[5~'));
    expect(sent).toEqual([bytes('\x1b[5~')]);
    expect(pipeline.modifierState().shift).toBe('off');
  });

  it('dedicated Ctrl shortcut literals send their control byte without needing sticky Ctrl', () => {
    pipeline.onBarKey(lit('\x1a'));
    pipeline.onBarKey(lit('\x18'));
    pipeline.onBarKey(lit('\x12'));
    pipeline.onBarKey(lit('\x06'));
    expect(sent).toEqual([[0x1a], [0x18], [0x12], [0x06]]);
  });
});
