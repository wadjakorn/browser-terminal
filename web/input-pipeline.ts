export type ModifierName = 'ctrl' | 'shift' | 'alt';
export type ModifierMode = 'off' | 'armed' | 'locked';
export type ModifierState = Record<ModifierName, ModifierMode>;

export type BarKey =
  | { kind: 'modifier'; name: ModifierName }
  | { kind: 'literal'; data: string }
  | { kind: 'interrupt' }
  | { kind: 'backtab' };

export interface Modes {
  applicationCursorKeysMode: boolean;
}

const ESC = '\x1b';
const DOUBLE_TAP_MS = 300;
const encoder = new TextEncoder();
const MODIFIERS: ModifierName[] = ['ctrl', 'shift', 'alt'];

const CURSOR_FINALS = new Set(['A', 'B', 'C', 'D', 'H', 'F']);
const CTRL_SYMBOLS: Record<string, number> = {
  '[': 0x1b, '\\': 0x1c, ']': 0x1d, '^': 0x1e,
  '_': 0x1f, '-': 0x1f, '?': 0x7f, ' ': 0x00,
};
const SHIFT_SYMBOLS: Record<string, string> = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^',
  '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', '[': '{',
  ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
};

interface Parsed {
  kind: 'cursor' | 'sequence' | 'single' | 'paste';
  final?: string;
}

function classify(data: string): Parsed {
  if (data === ESC) return { kind: 'single' };
  if (data.startsWith(ESC)) {
    const match = /^\x1b(?:\[|O)([A-Z])$/.exec(data);
    if (match && CURSOR_FINALS.has(match[1]!)) return { kind: 'cursor', final: match[1]! };
    return { kind: 'sequence' };
  }
  return [...data].length === 1 ? { kind: 'single' } : { kind: 'paste' };
}

export function createInputPipeline(deps: {
  send: (bytes: Uint8Array) => void;
  getModes: () => Modes;
}) {
  const state: ModifierState = { ctrl: 'off', shift: 'off', alt: 'off' };
  const armedAt: Partial<Record<ModifierName, number>> = {};

  const active = (name: ModifierName) => state[name] !== 'off';
  const sendText = (text: string) => deps.send(encoder.encode(text));
  const consumeArmed = () => {
    for (const name of MODIFIERS) {
      if (state[name] === 'armed') state[name] = 'off';
      delete armedAt[name];
    }
  };
  const clearModifiers = () => {
    for (const name of MODIFIERS) state[name] = 'off';
    for (const name of MODIFIERS) delete armedAt[name];
  };

  function tapModifier(name: ModifierName, timestampMs: number): void {
    if (state[name] === 'off') {
      state[name] = 'armed';
      armedAt[name] = timestampMs;
    } else if (state[name] === 'armed') {
      state[name] = timestampMs - armedAt[name]! <= DOUBLE_TAP_MS ? 'locked' : 'off';
      delete armedAt[name];
    } else {
      state[name] = 'off';
      delete armedAt[name];
    }
  }

  function shiftCharacter(character: string): string {
    if (character >= 'a' && character <= 'z') return character.toUpperCase();
    return SHIFT_SYMBOLS[character] ?? character;
  }

  function handleSingle(rawCharacter: string): void {
    const character = active('shift') ? shiftCharacter(rawCharacter) : rawCharacter;
    let bytes: number[] | null = null;

    if (active('ctrl')) {
      const code = character.charCodeAt(0);
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        bytes = [code & 0x1f];
      } else if (character in CTRL_SYMBOLS) {
        bytes = [CTRL_SYMBOLS[character]!];
      }
    }

    if (bytes === null) bytes = [...encoder.encode(character)];
    if (active('alt')) bytes = [0x1b, ...bytes];
    consumeArmed();
    deps.send(new Uint8Array(bytes));
  }

  function handleCursor(final: string): void {
    const modified = MODIFIERS.some(active);
    if (modified) {
      const value = 1 + (active('shift') ? 1 : 0) + (active('alt') ? 2 : 0) + (active('ctrl') ? 4 : 0);
      consumeArmed();
      sendText(`${ESC}[1;${value}${final}`);
      return;
    }
    consumeArmed();
    sendText(deps.getModes().applicationCursorKeysMode ? `${ESC}O${final}` : `${ESC}[${final}`);
  }

  function feed(data: string): void {
    const parsed = classify(data);
    if (parsed.kind === 'cursor') return handleCursor(parsed.final!);
    if (parsed.kind === 'single') return handleSingle(data);
    consumeArmed();
    sendText(data);
  }

  return {
    onTerminalData(data: string): void {
      feed(data);
    },

    onBarKey(key: BarKey, timestampMs = performance.now()): void {
      if (key.kind === 'modifier') return tapModifier(key.name, timestampMs);
      if (key.kind === 'interrupt') {
        consumeArmed();
        deps.send(new Uint8Array([0x03]));
        return;
      }
      if (key.kind === 'backtab') {
        consumeArmed();
        sendText(`${ESC}[Z`);
        return;
      }
      feed(key.data);
    },

    modifierState(): ModifierState {
      return { ...state };
    },

    clearModifiers,
  };
}
