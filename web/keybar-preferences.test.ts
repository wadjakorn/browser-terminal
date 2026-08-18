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
      order: expect.arrayContaining(['esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'shift-tab', 'shift', 'alt', 'interrupt', 'pipe', 'tilde', 'slash', 'dash', 'page-up', 'delete', 'f12', 'ctrl-z']),
      hidden: expect.arrayContaining(['page-up', 'delete', 'f12', 'ctrl-z']),
    });
    expect(visibleKeyIds(defaultKeybarPreferences()).slice(0, 15)).toEqual([
      'esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
      'shift-tab', 'shift', 'alt', 'interrupt', 'pipe', 'tilde', 'slash', 'dash',
    ]);
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
    expect(visibleKeyIds(stillVisible)).toEqual(['esc']);
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
});
