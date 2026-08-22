import { ALL_KEY_IDS, DEFAULT_KEY_IDS, KEY_CATALOG, defaultOrderOf } from './key-definitions.js';

export const KEYBAR_PREFS_STORAGE_KEY = 'browser-terminal:keybar:v1';

export interface KeybarPreferences {
  version: 1;
  order: string[];
  hidden: string[];
}

const CATALOG_IDS = new Set(KEY_CATALOG.map(key => key.id));
const ALL_IDS = [...ALL_KEY_IDS];
const DEFAULT_VISIBLE_IDS = new Set(DEFAULT_KEY_IDS);
const REQUIRED_VISIBLE_IDS = new Set(['settings']);
const UTILITY_IDS = new Set(['settings', 'fullscreen']);

/**
 * ปุ่มที่เปิดอยู่ก่อน ปุ่มที่ซ่อนไว้ต่อท้าย — รักษาลำดับสัมพัทธ์ภายในแต่ละกลุ่ม
 *
 * เหตุผลที่บังคับใน order จริงแทนที่จะเรียงตอนแสดงผล: `←/→` ในหน้า settings สลับ
 * ตำแหน่งใน order โดยตรง ถ้าเรียงแค่ตอนแสดงผล ผู้ใช้จะเห็นสองปุ่มที่ติดกันบนจอ
 * แต่กดสลับแล้วไม่ขยับ เพราะจริงๆ มีปุ่มที่ซ่อนอยู่คั่นกลางหลายตัว
 *
 * แถบปุ่มจริงไม่ขยับจากการนี้ — keybarSurfaceIds() กรองปุ่มที่ซ่อนทิ้งอยู่แล้ว
 * การย้ายมันไปท้ายลิสต์จึงไม่เปลี่ยนลำดับสัมพัทธ์ของปุ่มที่เหลือ
 */
function partitionOrder(order: readonly string[], hidden: ReadonlySet<string>): string[] {
  return [...order.filter(id => !hidden.has(id)), ...order.filter(id => hidden.has(id))];
}

export function defaultKeybarPreferences(): KeybarPreferences {
  const hidden = new Set(ALL_IDS.filter(id => !DEFAULT_VISIBLE_IDS.has(id)));
  return { version: 1, order: partitionOrder(ALL_IDS, hidden), hidden: [...hidden] };
}

/**
 * แทรก id ที่ลำดับซึ่งบันทึกไว้ยังไม่รู้จัก เข้าไปตามตำแหน่งของ defaultOrder
 *
 * ถ้าต่อท้ายเฉยๆ ปุ่มที่เพิ่มใหม่จะไปโผล่หลัง F1-F12 และ Ctrl shortcuts ทั้งหมด
 * คือลึกอยู่ในหน้า `⋯` ที่ผู้ใช้เดิมจะไม่มีวันเจอ — defaultOrder ที่ตั้งไว้ในแค็ตตาล็อก
 * จะไม่มีผลกับใครก็ตามที่เคยเปิดแอปมาก่อน ซึ่งคือผู้ใช้ทุกคน
 *
 * ไม่เลือกวิธี bump storage key เป็น v2 เพราะนั่นคือการทิ้งลำดับและปุ่มที่ผู้ใช้
 * ซ่อนไว้เองทั้งหมด เพื่อแก้ปัญหาของปุ่มไม่กี่ปุ่ม
 */
function insertMissingIds(order: string[], seen: Set<string>, hidden: ReadonlySet<string>): void {
  for (const id of ALL_IDS) {
    if (seen.has(id)) continue;
    const target = defaultOrderOf(id);
    const inHiddenGroup = hidden.has(id);
    // เทียบเฉพาะกับปุ่มในกลุ่มเดียวกัน — พอมี invariant การเรียง order ทั้งเส้นไม่ได้
    // ไล่ตาม defaultOrder อีกต่อไป กลุ่มที่ซ่อนท้ายลิสต์มี defaultOrder ต่ำได้
    // ถ้าไม่กรองกลุ่ม ปุ่มใหม่จะไปแทรกกลางกลุ่มที่ซ่อน แล้วโดน partition ดันกลับมา
    // ท้ายกลุ่มเปิดแทนตำแหน่งที่ defaultOrder ตั้งใจไว้
    const at = order.findIndex(existing =>
      hidden.has(existing) === inHiddenGroup && defaultOrderOf(existing) > target);
    if (at < 0) order.push(id);
    else order.splice(at, 0, id);
    seen.add(id);
  }
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
  const hiddenSet = new Set(
    Array.isArray(candidate.hidden)
      ? candidate.hidden.filter((id): id is string => typeof id === 'string' && CATALOG_IDS.has(id))
      : [],
  );
  insertMissingIds(order, seen, hiddenSet);
  return { version: 1, order: partitionOrder(order, hiddenSet), hidden: [...hiddenSet] };
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

  // ตรึงที่เส้นแบ่งกลุ่ม ไม่ใช่แค่ขอบ array — ปล่อยให้ข้ามได้เท่ากับปุ่มกระโดดสถานะ
  // เปิด/ปิดโดยที่ผู้ใช้แค่กดลูกศร ซึ่งไม่ใช่สิ่งที่ปุ่มลูกศรสัญญาไว้
  const hidden = new Set(normalized.hidden);
  if (hidden.has(normalized.order[index]!) !== hidden.has(normalized.order[target]!)) return normalized;

  const order = [...normalized.order];
  [order[index], order[target]] = [order[target]!, order[index]!];
  return { ...normalized, order };
}

export function setKeyHidden(preferences: KeybarPreferences, keyId: string, hidden: boolean): KeybarPreferences {
  const normalized = normalizeKeybarPreferences(preferences);
  if (!CATALOG_IDS.has(keyId)) return normalized;
  if (hidden && REQUIRED_VISIBLE_IDS.has(keyId)) return normalized;
  const visibleTerminalIds = visibleKeyIds(normalized).filter(id => !UTILITY_IDS.has(id));
  if (hidden && !UTILITY_IDS.has(keyId) && visibleTerminalIds.length === 1 && !normalized.hidden.includes(keyId)) {
    return normalized;
  }

  const order = [...normalized.order];
  const index = order.indexOf(keyId);
  // ถ้าปุ่มในลำดับแล้ว เอามันออกจากตำแหน่งเดิม
  if (index >= 0) {
    order.splice(index, 1);
  }
  // เมื่อ show/hide ให้ย้ายไปท้าย ตัว normalize จะจัด partition
  order.push(keyId);

  const hiddenIds = new Set(normalized.hidden);
  if (hidden) hiddenIds.add(keyId);
  else hiddenIds.delete(keyId);
  // ต้องผ่าน normalize อีกรอบ ไม่ใช่คืน object ตรงๆ — การเปลี่ยน hidden คือการย้ายกลุ่ม
  // ซึ่งแปลว่า order ที่ถืออยู่ละเมิด invariant ทันทีที่บรรทัดนี้ทำงาน
  return normalizeKeybarPreferences({ version: 1, order, hidden: [...hiddenIds] });
}

export function resetKeybarPreferences(storage?: Storage): KeybarPreferences {
  const preferences = defaultKeybarPreferences();
  saveKeybarPreferences(preferences, storage);
  return preferences;
}
