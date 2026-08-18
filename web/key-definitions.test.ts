import { describe, expect, it } from 'vitest';
import {
  ALL_KEY_IDS,
  DEFAULT_KEY_IDS,
  KEY_CATALOG,
  getKeySpec,
  isRepeatableKey,
  resolveKeySpecs,
} from './key-definitions.js';

describe('key catalog', () => {
  it('keeps stable unique IDs and default order', () => {
    const ids = KEY_CATALOG.map(key => key.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_KEY_IDS).toEqual([
      'esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
      'shift-tab', 'shift', 'alt', 'interrupt', 'select', 'paste', 'pipe', 'tilde', 'slash', 'dash',
    ]);
    expect(ALL_KEY_IDS.slice(0, DEFAULT_KEY_IDS.length)).toEqual(DEFAULT_KEY_IDS);
    expect(ALL_KEY_IDS).toEqual(KEY_CATALOG.map(key => key.id));
    expect(resolveKeySpecs(DEFAULT_KEY_IDS).map(key => key.label)).toEqual([
      'Esc', 'Tab', 'Ctrl', '↑', '↓', '←', '→', 'Shift Tab', 'Shift',
      'Alt', '^C', '⧉', '⎘', '|', '~', '/', '-',
    ]);
  });

  it('ทุกปุ่มมี key หรือ action อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่และไม่ใช่ไม่มีเลย', () => {
    // guard นี้ดักปุ่มที่จะเพิ่มในอนาคตซึ่งเผลอใส่ทั้งสองอย่าง — ปุ่มแบบนั้นจะทั้ง
    // ส่งไบต์เข้า terminal และสั่งงาน UI พร้อมกัน ซึ่งไม่มีใครตั้งใจ
    for (const spec of KEY_CATALOG) {
      expect([spec.key !== undefined, spec.action !== undefined].filter(Boolean)).toHaveLength(1);
    }
  });

  it('ปุ่ม action ไม่ถูกนับเป็นปุ่มกดค้างซ้ำ', () => {
    expect(isRepeatableKey(getKeySpec('select')!.key)).toBe(false);
    expect(isRepeatableKey(getKeySpec('paste')!.key)).toBe(false);
  });

  it('ปุ่มเลือกข้อความและวางเป็น action ไม่ใช่ไบต์ และเห็นตั้งแต่แรก', () => {
    expect(getKeySpec('select')).toMatchObject({ action: 'select-mode', toggle: true, defaultVisible: true });
    expect(getKeySpec('paste')).toMatchObject({ action: 'paste', defaultVisible: true });
    expect(getKeySpec('select')!.key).toBeUndefined();
    expect(getKeySpec('paste')!.key).toBeUndefined();
  });

  it('marks exactly the four arrow keys repeatable', () => {
    expect(KEY_CATALOG.filter(spec => isRepeatableKey(spec.key)).map(spec => spec.id))
      .toEqual(['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right']);
  });

  it('exposes accessible titles for icon-only or short labels', () => {
    for (const spec of KEY_CATALOG) {
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it('resolves unknown IDs by dropping them', () => {
    expect(resolveKeySpecs(['esc', 'unknown-key', 'tab']).map(key => key.id)).toEqual(['esc', 'tab']);
  });

  it('keeps the legacy special keys semantically identical', () => {
    expect(getKeySpec('shift-tab')?.key).toEqual({ kind: 'backtab' });
    expect(getKeySpec('interrupt')?.key).toEqual({ kind: 'interrupt' });
    expect(getKeySpec('ctrl')?.key).toEqual({ kind: 'modifier', name: 'ctrl' });
  });
});

describe('expanded terminal key inventory', () => {
  it('includes navigation and editing keys with VT-compatible sequences', () => {
    expect(getKeySpec('page-up')?.key).toEqual({ kind: 'literal', data: '\x1b[5~' });
    expect(getKeySpec('page-down')?.key).toEqual({ kind: 'literal', data: '\x1b[6~' });
    expect(getKeySpec('home')?.key).toEqual({ kind: 'literal', data: '\x1b[H' });
    expect(getKeySpec('end')?.key).toEqual({ kind: 'literal', data: '\x1b[F' });
    expect(getKeySpec('insert')?.key).toEqual({ kind: 'literal', data: '\x1b[2~' });
    expect(getKeySpec('delete')?.key).toEqual({ kind: 'literal', data: '\x1b[3~' });
  });

  it('includes F1-F12 function keys', () => {
    expect(getKeySpec('f1')?.key).toEqual({ kind: 'literal', data: '\x1bOP' });
    expect(getKeySpec('f2')?.key).toEqual({ kind: 'literal', data: '\x1bOQ' });
    expect(getKeySpec('f3')?.key).toEqual({ kind: 'literal', data: '\x1bOR' });
    expect(getKeySpec('f4')?.key).toEqual({ kind: 'literal', data: '\x1bOS' });
    expect(getKeySpec('f5')?.key).toEqual({ kind: 'literal', data: '\x1b[15~' });
    expect(getKeySpec('f12')?.key).toEqual({ kind: 'literal', data: '\x1b[24~' });
  });

  it('includes common shell symbols as literal keys', () => {
    for (const symbol of ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '=', '{', '}', '[', ']', ':', ';', '"', "'", '<', '>', '?', '\\']) {
      const spec = KEY_CATALOG.find(key => key.label === symbol);
      expect(spec?.key).toEqual({ kind: 'literal', data: symbol });
    }
  });

  it('includes common Ctrl shortcuts as dedicated single-byte actions', () => {
    expect(getKeySpec('ctrl-z')?.key).toEqual({ kind: 'literal', data: '\x1a' });
    expect(getKeySpec('ctrl-x')?.key).toEqual({ kind: 'literal', data: '\x18' });
    expect(getKeySpec('ctrl-r')?.key).toEqual({ kind: 'literal', data: '\x12' });
    expect(getKeySpec('ctrl-f')?.key).toEqual({ kind: 'literal', data: '\x06' });
  });
});
