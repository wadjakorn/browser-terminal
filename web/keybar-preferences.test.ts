import { describe, expect, it, vi } from 'vitest';
import {
  KEYBAR_PREFS_STORAGE_KEY,
  defaultKeybarPreferences,
  loadKeybarPreferences,
  moveKey,
  normalizeKeybarPreferences,
  resetKeybarPreferences,
  saveKeybarPreferences,
  setKeyHidden,
  visibleKeyIds,
} from './keybar-preferences.js';
import { ALL_KEY_IDS } from './key-definitions.js';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn(key => data.get(key) ?? null),
    key: vi.fn(index => [...data.keys()][index] ?? null),
    removeItem: vi.fn(key => data.delete(key)),
    setItem: vi.fn((key, value) => data.set(key, value)),
  };
}

describe('keybar preferences', () => {
  it('starts from the legacy quick-row defaults', () => {
    expect(defaultKeybarPreferences()).toEqual({
      version: 1,
      order: expect.arrayContaining(['esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'shift-tab', 'shift', 'alt', 'interrupt', 'enter', 'select', 'paste', 'pipe', 'tilde', 'slash', 'dash', 'page-up', 'delete', 'f12', 'ctrl-z']),
      hidden: expect.arrayContaining(['page-up', 'delete', 'f12', 'ctrl-z']),
    });
    expect(visibleKeyIds(defaultKeybarPreferences()).slice(0, 20)).toEqual([
      'esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
      'shift-tab', 'shift', 'alt', 'interrupt', 'enter', 'select', 'paste', 'settings', 'fullscreen',
      'pipe', 'tilde', 'slash', 'dash',
    ]);
  });

  it('adds the expanded settings and fullscreen tools to the sortable order', () => {
    const preferences = defaultKeybarPreferences();

    expect(preferences.order.slice(14, 20)).toEqual([
      'settings', 'fullscreen', 'pipe', 'tilde', 'slash', 'dash',
    ]);
    expect(visibleKeyIds(preferences)).toEqual(expect.arrayContaining(['settings', 'fullscreen']));
  });

  it('filters unknown IDs and appends every missing catalog ID in catalog order', () => {
    const normalized = normalizeKeybarPreferences({
      version: 1,
      order: ['tab', 'unknown', 'esc'],
      hidden: ['missing', 'dash'],
    });
    expect(normalized.order.slice(0, 4)).toEqual(['tab', 'esc', 'ctrl', 'arrow-up']);
    expect(normalized.order).toContain('page-up');
    expect(normalized.order).toContain('ctrl-z');
    expect(normalized.hidden).toEqual(['dash']);
  });

  it('แทรก id ที่ยังไม่รู้จักตามตำแหน่ง defaultOrder ไม่ใช่ต่อท้าย', () => {
    // ผู้ใช้เดิมมีลำดับที่เก็บไว้ครบทุก id เก่า ถ้าต่อท้ายเฉยๆ ปุ่มใหม่จะไปอยู่หลัง
    // F1-F12 และ Ctrl shortcuts ทั้งหมด คือลึกจนหาไม่เจอ
    const legacy = ALL_KEY_IDS.filter(id => id !== 'select' && id !== 'paste');
    const normalized = normalizeKeybarPreferences({ version: 1, order: [...legacy], hidden: [] });

    expect(normalized.order.indexOf('select')).toBe(normalized.order.indexOf('interrupt') + 2);
    expect(normalized.order.indexOf('paste')).toBe(normalized.order.indexOf('select') + 1);
    expect(normalized.order.indexOf('paste')).toBeLessThan(normalized.order.indexOf('pipe'));
  });

  it('prefs ที่บันทึกก่อนมีปุ่ม Enter ได้ปุ่มนั้นมาอยู่ในกลุ่มเปิด ต่อจาก interrupt', () => {
    const legacy = { version: 1, order: ['esc', 'tab', 'interrupt', 'select'], hidden: [] };
    const result = normalizeKeybarPreferences(legacy);
    expect(result.hidden).not.toContain('enter');
    expect(result.order.indexOf('enter')).toBeGreaterThan(result.order.indexOf('interrupt'));
    expect(result.order.indexOf('enter')).toBeLessThan(result.order.indexOf('select'));
  });

  it('ลำดับที่ผู้ใช้จัดเองไม่ถูกรื้อ แทรกเฉพาะ id ใหม่', () => {
    // ลำดับ *สัมพัทธ์* ของ id ที่บันทึกไว้ต้องไม่เปลี่ยน แม้ id ใหม่จะแทรกคั่นเข้ามา
    const rearranged = ['dash', 'esc', 'tab'];
    const normalized = normalizeKeybarPreferences({ version: 1, order: rearranged, hidden: [] });

    expect(normalized.order.filter(id => rearranged.includes(id))).toEqual(rearranged);
    expect(normalized.order).toContain('select');
  });

  it('ปุ่มใหม่มองเห็นได้สำหรับผู้ใช้เดิม เพราะไม่อยู่ใน hidden ที่บันทึกไว้', () => {
    const legacy = ALL_KEY_IDS.filter(id => id !== 'select' && id !== 'paste');
    const normalized = normalizeKeybarPreferences({ version: 1, order: [...legacy], hidden: ['f12'] });
    expect(visibleKeyIds(normalized)).toContain('select');
    expect(visibleKeyIds(normalized)).toContain('paste');
  });

  it('moves visible keys without dropping hidden state', () => {
    const prefs = setKeyHidden(defaultKeybarPreferences(), 'dash', true);
    const moved = moveKey(prefs, 'tab', 1);
    expect(moved.order.slice(0, 3)).toEqual(['esc', 'ctrl', 'tab']);
    expect(moved.hidden).toContain('dash');
  });

  it('hides and shows keys idempotently', () => {
    const hidden = setKeyHidden(defaultKeybarPreferences(), 'tab', true);
    expect(visibleKeyIds(hidden)).not.toContain('tab');
    const shown = setKeyHidden(hidden, 'tab', false);
    expect(visibleKeyIds(shown)).toContain('tab');
  });

  it('does not allow hiding the final visible key', () => {
    let prefs = defaultKeybarPreferences();
    for (const id of visibleKeyIds(prefs).filter(id => id !== 'esc')) {
      prefs = setKeyHidden(prefs, id, true);
    }
    const stillVisible = setKeyHidden(prefs, 'esc', true);
    expect(visibleKeyIds(stillVisible)).toEqual(['esc', 'settings']);
  });

  it('keeps settings visible so customization cannot become inaccessible', () => {
    const hidden = setKeyHidden(defaultKeybarPreferences(), 'settings', true);

    expect(visibleKeyIds(hidden)).toContain('settings');
  });

  it('loads invalid JSON as defaults and save/reset round-trips', () => {
    const storage = memoryStorage();
    storage.setItem(KEYBAR_PREFS_STORAGE_KEY, '{bad json');
    expect(loadKeybarPreferences(storage)).toEqual(defaultKeybarPreferences());

    const prefs = setKeyHidden(defaultKeybarPreferences(), 'dash', true);
    saveKeybarPreferences(prefs, storage);
    expect(loadKeybarPreferences(storage)).toEqual(prefs);

    expect(resetKeybarPreferences(storage)).toEqual(defaultKeybarPreferences());
    expect(loadKeybarPreferences(storage)).toEqual(defaultKeybarPreferences());
  });

  it('treats storage get/set failures as non-fatal local preference failures', () => {
    const throwingStorage = {
      get length() { return 0; },
      clear: vi.fn(),
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error('quota'); }),
    } as unknown as Storage;

    expect(loadKeybarPreferences(throwingStorage)).toEqual(defaultKeybarPreferences());
    expect(() => saveKeybarPreferences(defaultKeybarPreferences(), throwingStorage)).not.toThrow();
  });

  it('normalize ดันปุ่มที่ซ่อนไปท้ายลิสต์ และรักษาลำดับภายในกลุ่ม', () => {
    const result = normalizeKeybarPreferences({
      version: 1,
      order: ['esc', 'f12', 'tab', 'ctrl-z', 'ctrl'],
      hidden: ['f12', 'ctrl-z'],
    });
    const positions = ['esc', 'tab', 'ctrl', 'f12', 'ctrl-z'].map(id => result.order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(result.order.indexOf('f12')).toBeLessThan(result.order.indexOf('ctrl-z'));
  });

  it('normalize เป็น idempotent', () => {
    const once = normalizeKeybarPreferences({ version: 1, order: ['f12', 'esc'], hidden: ['f12'] });
    expect(normalizeKeybarPreferences(once)).toEqual(once);
  });

  it('ค่าตั้งต้นก็เคารพ invariant', () => {
    const prefs = defaultKeybarPreferences();
    const hidden = new Set(prefs.hidden);
    const firstHidden = prefs.order.findIndex(id => hidden.has(id));
    expect(firstHidden).toBeGreaterThan(0);
    expect(prefs.order.slice(firstHidden).every(id => hidden.has(id))).toBe(true);
  });

  it('ติ๊กออกดันปุ่มไปท้ายสุด', () => {
    const next = setKeyHidden(defaultKeybarPreferences(), 'tab', true);
    expect(next.order[next.order.length - 1]).toBe('tab');
  });

  it('ติ๊กกลับพาปุ่มมาต่อท้ายกลุ่มที่เปิด ไม่ใช่ท้ายสุด', () => {
    const hiddenPrefs = setKeyHidden(defaultKeybarPreferences(), 'tab', true);
    const next = setKeyHidden(hiddenPrefs, 'tab', false);
    const visible = visibleKeyIds(next);
    expect(visible[visible.length - 1]).toBe('tab');
    expect(next.order[next.order.length - 1]).not.toBe('tab');
  });

  it('moveKey ไม่ข้ามเส้นแบ่งกลุ่ม', () => {
    const prefs = normalizeKeybarPreferences(defaultKeybarPreferences());
    const hidden = new Set(prefs.hidden);
    const lastVisible = prefs.order.filter(id => !hidden.has(id)).at(-1)!;
    expect(moveKey(prefs, lastVisible, 1)).toEqual(prefs);
  });

  it('moveKey ยังสลับได้ตามปกติภายในกลุ่ม', () => {
    const prefs = normalizeKeybarPreferences(defaultKeybarPreferences());
    const visible = visibleKeyIds(prefs);
    const moved = moveKey(prefs, visible[1]!, -1);
    expect(visibleKeyIds(moved).slice(0, 2)).toEqual([visible[1], visible[0]]);
  });

  it('prefs ที่ผู้ใช้จัดเองจนไม่เรียงตาม defaultOrder ยังได้ปุ่มใหม่อยู่ในกลุ่มที่ถูก', () => {
    const result = normalizeKeybarPreferences({
      version: 1,
      order: ['ctrl-z', 'f12', 'interrupt', 'esc'],
      hidden: ['ctrl-z', 'f12'],
    });
    const hidden = new Set(result.hidden);
    for (const id of ALL_KEY_IDS) {
      expect(result.order).toContain(id);
    }
    const firstHidden = result.order.findIndex(id => hidden.has(id));
    expect(result.order.slice(firstHidden).every(id => hidden.has(id))).toBe(true);
  });
});
