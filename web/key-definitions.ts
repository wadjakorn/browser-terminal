import type { BarKey } from './input-pipeline.js';

export type KeyCategory = 'core' | 'navigation' | 'editing' | 'symbols' | 'function' | 'ctrl';

/**
 * งานของปุ่มที่ "ไม่ใช่การส่งไบต์เข้า terminal"
 *
 * แยกออกจาก BarKey โดยตั้งใจ: BarKey คือเส้นทางไบต์ที่ถือว่า security-critical
 * มันไม่ควรรู้จักโหมดของ UI เลย ปุ่มที่มี action จะไม่ผ่าน input-pipeline
 */
export type KeyAction = 'select-mode' | 'paste';

export interface KeySpec {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: string;
  title: string;
  category: KeyCategory;
  /** ปุ่มหนึ่งมีได้อย่างใดอย่างหนึ่งระหว่าง key กับ action เท่านั้น */
  key?: BarKey;
  action?: KeyAction;
  /** ปุ่มที่มีสถานะติด/ดับ — keybar จะถามสถานะมาทาสี */
  toggle?: boolean;
  defaultVisible: boolean;
  defaultOrder: number;
  repeatable?: boolean;
  wide?: boolean;
}

export const KEY_TARGET_PX = 44;

const arrow = (id: string, label: string, final: 'A' | 'B' | 'C' | 'D', order: number): KeySpec => ({
  id,
  label,
  title: `Arrow ${label}`,
  category: 'navigation',
  key: { kind: 'literal', data: `\x1b[${final}` },
  defaultVisible: true,
  defaultOrder: order,
  repeatable: true,
});

const literalKey = (
  id: string,
  label: string,
  data: string,
  category: KeyCategory,
  order: number,
  title = label,
  defaultVisible = false,
): KeySpec => ({
  id,
  label,
  title,
  category,
  key: { kind: 'literal', data },
  defaultVisible,
  defaultOrder: order,
});

const symbolKey = (id: string, label: string, order: number, defaultVisible = false): KeySpec =>
  literalKey(`symbol-${id}`, label, label, 'symbols', order, `Symbol ${label}`, defaultVisible);

const ctrlShortcut = (letter: string, order: number, title: string): KeySpec => ({
  id: `ctrl-${letter}`,
  label: `^${letter.toUpperCase()}`,
  shortLabel: `C-${letter}`,
  title,
  category: 'ctrl',
  key: { kind: 'literal', data: String.fromCharCode(letter.charCodeAt(0) & 0x1f) },
  defaultVisible: false,
  defaultOrder: order,
});

export const KEY_CATALOG: readonly KeySpec[] = [
  { id: 'esc', label: 'Esc', title: 'Escape', category: 'core', key: { kind: 'literal', data: '\x1b' }, defaultVisible: true, defaultOrder: 10 },
  { id: 'tab', label: 'Tab', title: 'Tab', category: 'core', key: { kind: 'literal', data: '\t' }, defaultVisible: true, defaultOrder: 20 },
  { id: 'ctrl', label: 'Ctrl', title: 'Control modifier', category: 'core', key: { kind: 'modifier', name: 'ctrl' }, defaultVisible: true, defaultOrder: 30 },
  arrow('arrow-up', '↑', 'A', 40),
  arrow('arrow-down', '↓', 'B', 50),
  arrow('arrow-left', '←', 'D', 60),
  arrow('arrow-right', '→', 'C', 70),
  { id: 'shift-tab', label: 'Shift Tab', title: 'Shift Tab — send back-tab', category: 'core', key: { kind: 'backtab' }, defaultVisible: true, defaultOrder: 80, wide: true },
  { id: 'shift', label: 'Shift', title: 'Shift modifier', category: 'core', key: { kind: 'modifier', name: 'shift' }, defaultVisible: true, defaultOrder: 90 },
  { id: 'alt', label: 'Alt', title: 'Alt modifier', category: 'core', key: { kind: 'modifier', name: 'alt' }, defaultVisible: true, defaultOrder: 100 },
  { id: 'interrupt', label: '^C', title: 'Interrupt — send Ctrl+C', category: 'core', key: { kind: 'interrupt' }, defaultVisible: true, defaultOrder: 110 },
  {
    id: 'select', label: '⧉', title: 'Select text — highlight and copy', category: 'core',
    action: 'select-mode', toggle: true, defaultVisible: true, defaultOrder: 115,
  },
  {
    id: 'paste', label: '⎘', title: 'Paste from clipboard', category: 'core',
    action: 'paste', defaultVisible: true, defaultOrder: 117,
  },
  { id: 'pipe', label: '|', title: 'Pipe', category: 'symbols', key: { kind: 'literal', data: '|' }, defaultVisible: true, defaultOrder: 120 },
  { id: 'tilde', label: '~', title: 'Tilde', category: 'symbols', key: { kind: 'literal', data: '~' }, defaultVisible: true, defaultOrder: 130 },
  { id: 'slash', label: '/', title: 'Slash', category: 'symbols', key: { kind: 'literal', data: '/' }, defaultVisible: true, defaultOrder: 140 },
  { id: 'dash', label: '-', title: 'Dash', category: 'symbols', key: { kind: 'literal', data: '-' }, defaultVisible: true, defaultOrder: 150 },
  literalKey('page-up', 'PgUp', '\x1b[5~', 'navigation', 210, 'Page Up'),
  literalKey('page-down', 'PgDn', '\x1b[6~', 'navigation', 220, 'Page Down'),
  literalKey('home', 'Home', '\x1b[H', 'navigation', 230, 'Home'),
  literalKey('end', 'End', '\x1b[F', 'navigation', 240, 'End'),
  literalKey('insert', 'Ins', '\x1b[2~', 'editing', 250, 'Insert'),
  literalKey('delete', 'Del', '\x1b[3~', 'editing', 260, 'Delete'),
  literalKey('f1', 'F1', '\x1bOP', 'function', 310, 'Function key F1'),
  literalKey('f2', 'F2', '\x1bOQ', 'function', 320, 'Function key F2'),
  literalKey('f3', 'F3', '\x1bOR', 'function', 330, 'Function key F3'),
  literalKey('f4', 'F4', '\x1bOS', 'function', 340, 'Function key F4'),
  literalKey('f5', 'F5', '\x1b[15~', 'function', 350, 'Function key F5'),
  literalKey('f6', 'F6', '\x1b[17~', 'function', 360, 'Function key F6'),
  literalKey('f7', 'F7', '\x1b[18~', 'function', 370, 'Function key F7'),
  literalKey('f8', 'F8', '\x1b[19~', 'function', 380, 'Function key F8'),
  literalKey('f9', 'F9', '\x1b[20~', 'function', 390, 'Function key F9'),
  literalKey('f10', 'F10', '\x1b[21~', 'function', 400, 'Function key F10'),
  literalKey('f11', 'F11', '\x1b[23~', 'function', 410, 'Function key F11'),
  literalKey('f12', 'F12', '\x1b[24~', 'function', 420, 'Function key F12'),
  symbolKey('bang', '!', 500),
  symbolKey('at', '@', 510),
  symbolKey('hash', '#', 520),
  symbolKey('dollar', '$', 530),
  symbolKey('percent', '%', 540),
  symbolKey('caret', '^', 550),
  symbolKey('ampersand', '&', 560),
  symbolKey('asterisk', '*', 570),
  symbolKey('paren-left', '(', 580),
  symbolKey('paren-right', ')', 590),
  symbolKey('underscore', '_', 600),
  symbolKey('plus', '+', 610),
  symbolKey('equals', '=', 620),
  symbolKey('brace-left', '{', 630),
  symbolKey('brace-right', '}', 640),
  symbolKey('bracket-left', '[', 650),
  symbolKey('bracket-right', ']', 660),
  symbolKey('colon', ':', 670),
  symbolKey('semicolon', ';', 680),
  symbolKey('quote-double', '"', 690),
  symbolKey('quote-single', "'", 700),
  symbolKey('less-than', '<', 710),
  symbolKey('greater-than', '>', 720),
  symbolKey('question', '?', 730),
  symbolKey('backslash', '\\', 740),
  ctrlShortcut('c', 810, 'Ctrl+C — interrupt'),
  ctrlShortcut('z', 820, 'Ctrl+Z — suspend'),
  ctrlShortcut('x', 830, 'Ctrl+X'),
  ctrlShortcut('r', 840, 'Ctrl+R — reverse search'),
  ctrlShortcut('f', 850, 'Ctrl+F — forward'),
  ctrlShortcut('a', 860, 'Ctrl+A — line start'),
  ctrlShortcut('e', 870, 'Ctrl+E — line end'),
  ctrlShortcut('d', 880, 'Ctrl+D — EOF/delete'),
  ctrlShortcut('l', 890, 'Ctrl+L — clear screen'),
  ctrlShortcut('u', 900, 'Ctrl+U — delete before cursor'),
  ctrlShortcut('k', 910, 'Ctrl+K — delete after cursor'),
  ctrlShortcut('w', 920, 'Ctrl+W — delete word before cursor'),
  ctrlShortcut('p', 930, 'Ctrl+P — previous'),
  ctrlShortcut('n', 940, 'Ctrl+N — next'),
];

export const DEFAULT_KEY_IDS: readonly string[] = KEY_CATALOG
  .filter(key => key.defaultVisible)
  .sort((a, b) => a.defaultOrder - b.defaultOrder)
  .map(key => key.id);

export const ALL_KEY_IDS: readonly string[] = KEY_CATALOG
  .slice()
  .sort((a, b) => a.defaultOrder - b.defaultOrder)
  .map(key => key.id);

const KEY_BY_ID = new Map(KEY_CATALOG.map(key => [key.id, key]));
const REPEATABLE_CURSOR_SEQUENCES = new Set(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);

export function getKeySpec(id: string): KeySpec | undefined {
  return KEY_BY_ID.get(id);
}

export function resolveKeySpecs(ids: readonly string[]): KeySpec[] {
  return ids.flatMap(id => {
    const spec = getKeySpec(id);
    return spec ? [spec] : [];
  });
}

export function isRepeatableKey(key: BarKey | undefined): boolean {
  return key?.kind === 'literal' && REPEATABLE_CURSOR_SEQUENCES.has(key.data);
}

/** ลำดับเริ่มต้นของ id — ใช้ตอนแทรกปุ่มใหม่เข้าไปในลำดับที่ผู้ใช้จัดไว้แล้ว */
export function defaultOrderOf(id: string): number {
  return KEY_BY_ID.get(id)?.defaultOrder ?? Number.MAX_SAFE_INTEGER;
}
