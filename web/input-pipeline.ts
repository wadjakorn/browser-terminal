// web/input-pipeline.ts
export type BarKey =
  | { kind: 'modifier'; name: 'ctrl' | 'alt' }
  | { kind: 'literal'; data: string }
  | { kind: 'interrupt' };

export interface Modes {
  applicationCursorKeysMode: boolean;
}

const ESC = '\x1b';
const encoder = new TextEncoder();

/** ปุ่มที่มีทั้งรูปแบบ CSI (`ESC[X`) และ SS3 (`ESCOX`) */
const CURSOR_FINALS = new Set(['A', 'B', 'C', 'D', 'H', 'F']);

/** ctrl + สัญลักษณ์เหล่านี้มี control code ตามมาตรฐาน */
const CTRL_SYMBOLS: Record<string, number> = {
  '[': 0x1b, '\\': 0x1c, ']': 0x1d, '^': 0x1e,
  '_': 0x1f, '-': 0x1f, '?': 0x7f, ' ': 0x00,
};

interface Parsed {
  kind: 'cursor' | 'sequence' | 'single' | 'paste';
  final?: string;
}

function classify(data: string): Parsed {
  // ESC เดี่ยวเป็น "ตัวอักษร" ไม่ใช่ sequence — ไม่งั้น Alt+Esc จะกลืน modifier ทิ้ง
  if (data === ESC) return { kind: 'single' };
  if (data.startsWith(ESC)) {
    const m = /^\x1b(?:\[|O)([A-Z])$/.exec(data);
    if (m && CURSOR_FINALS.has(m[1]!)) return { kind: 'cursor', final: m[1]! };
    return { kind: 'sequence' };
  }
  // นับเป็นตัวอักษรเดี่ยวเมื่อเป็น code point เดียว ไม่ใช่จำนวน UTF-16 unit
  return [...data].length === 1 ? { kind: 'single' } : { kind: 'paste' };
}

export function createInputPipeline(deps: {
  send: (bytes: Uint8Array) => void;
  getModes: () => Modes;
}) {
  let ctrl = false;
  let alt = false;

  const clear = () => { ctrl = false; alt = false; };

  const sendText = (s: string) => deps.send(encoder.encode(s));

  function handleSingle(ch: string): void {
    let bytes: number[] | null = null;

    if (ctrl) {
      const code = ch.charCodeAt(0);
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        bytes = [code & 0x1f];
      } else if (ch in CTRL_SYMBOLS) {
        bytes = [CTRL_SYMBOLS[ch]!];
      }
      // ctrl กับตัวที่ไม่มี control code → bytes ยังเป็น null, ตกไปส่งดิบ
    }

    if (bytes === null) {
      const raw = [...encoder.encode(ch)];
      bytes = alt ? [0x1b, ...raw] : raw;
    } else if (alt) {
      bytes = [0x1b, ...bytes];
    }

    clear();
    deps.send(new Uint8Array(bytes));
  }

  function handleCursor(final: string): void {
    if (ctrl || alt) {
      const n = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
      clear();
      sendText(`${ESC}[1;${n}${final}`);
      return;
    }
    clear();
    sendText(deps.getModes().applicationCursorKeysMode
      ? `${ESC}O${final}`
      : `${ESC}[${final}`);
  }

  function feed(data: string): void {
    const parsed = classify(data);
    switch (parsed.kind) {
      case 'cursor':   return handleCursor(parsed.final!);
      case 'single':   return handleSingle(data);
      case 'sequence':
      case 'paste':    clear(); return sendText(data);
    }
  }

  return {
    onTerminalData(data: string): void {
      feed(data);
    },

    onBarKey(key: BarKey): void {
      if (key.kind === 'modifier') {
        if (key.name === 'ctrl') ctrl = !ctrl;
        else alt = !alt;
        return;
      }
      if (key.kind === 'interrupt') {
        clear();
        deps.send(new Uint8Array([0x03]));
        return;
      }
      feed(key.data);
    },

    modifierState(): { ctrl: boolean; alt: boolean } {
      return { ctrl, alt };
    },
  };
}
