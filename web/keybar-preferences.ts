import { ALL_KEY_IDS, DEFAULT_KEY_IDS, KEY_CATALOG } from './key-definitions.js';

export const KEYBAR_PREFS_STORAGE_KEY = 'browser-terminal:keybar:v1';

export interface KeybarPreferences {
  version: 1;
  order: string[];
  hidden: string[];
}

const CATALOG_IDS = new Set(KEY_CATALOG.map(key => key.id));
const ALL_IDS = [...ALL_KEY_IDS];
const DEFAULT_VISIBLE_IDS = new Set(DEFAULT_KEY_IDS);

export function defaultKeybarPreferences(): KeybarPreferences {
  return {
    version: 1,
    order: [...ALL_IDS],
    hidden: ALL_IDS.filter(id => !DEFAULT_VISIBLE_IDS.has(id)),
  };
}

export function normalizeKeybarPreferences(value: unknown): KeybarPreferences {
  if (!value || typeof value !== 'object') return defaultKeybarPreferences();
  const candidate = value as Partial<KeybarPreferences>;
  const inputOrder = Array.isArray(candidate.order) ? candidate.order : [];
  const seen = new Set<string>();
  const order = inputOrder.filter((id): id is string => {
    if (typeof id !== 'string' || !CATALOG_IDS.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const id of ALL_IDS) {
    if (!seen.has(id)) order.push(id);
  }
  const hidden = Array.isArray(candidate.hidden)
    ? candidate.hidden.filter((id): id is string => typeof id === 'string' && CATALOG_IDS.has(id))
    : [];
  return { version: 1, order, hidden: [...new Set(hidden)] };
}

function readStorage(storage?: Storage): Storage | undefined {
  return storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
}

export function loadKeybarPreferences(storage?: Storage): KeybarPreferences {
  const target = readStorage(storage);
  if (!target) return defaultKeybarPreferences();
  try {
    return normalizeKeybarPreferences(JSON.parse(target.getItem(KEYBAR_PREFS_STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultKeybarPreferences();
  }
}

export function saveKeybarPreferences(preferences: KeybarPreferences, storage?: Storage): void {
  const target = readStorage(storage);
  if (!target) return;
  try {
    target.setItem(KEYBAR_PREFS_STORAGE_KEY, JSON.stringify(normalizeKeybarPreferences(preferences)));
  } catch {
    // Preferences are local UI convenience only. Storage denial or quota exhaustion must not break terminal input.
  }
}

export function visibleKeyIds(preferences: KeybarPreferences): string[] {
  const normalized = normalizeKeybarPreferences(preferences);
  const hidden = new Set(normalized.hidden);
  return normalized.order.filter(id => !hidden.has(id));
}

export function moveKey(preferences: KeybarPreferences, keyId: string, direction: -1 | 1): KeybarPreferences {
  const normalized = normalizeKeybarPreferences(preferences);
  const index = normalized.order.indexOf(keyId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= normalized.order.length) return normalized;
  const order = [...normalized.order];
  [order[index], order[target]] = [order[target]!, order[index]!];
  return { ...normalized, order };
}

export function setKeyHidden(preferences: KeybarPreferences, keyId: string, hidden: boolean): KeybarPreferences {
  const normalized = normalizeKeybarPreferences(preferences);
  if (!CATALOG_IDS.has(keyId)) return normalized;
  if (hidden && visibleKeyIds(normalized).length === 1 && !normalized.hidden.includes(keyId)) {
    return normalized;
  }
  const hiddenIds = new Set(normalized.hidden);
  if (hidden) hiddenIds.add(keyId);
  else hiddenIds.delete(keyId);
  return { ...normalized, hidden: [...hiddenIds] };
}

export function resetKeybarPreferences(storage?: Storage): KeybarPreferences {
  const preferences = defaultKeybarPreferences();
  saveKeybarPreferences(preferences, storage);
  return preferences;
}
