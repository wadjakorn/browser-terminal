# Keybar Sort Invariant + Adjustable Selection Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้หน้า settings เรียงปุ่มที่เปิดไว้บนสุดจนสลับกันได้ในไม่กี่กด และให้ผู้ใช้ปรับกรอบที่ลากคัดลอกได้ด้วยหมุดสองมุมก่อนยืนยัน

**Architecture:** Part 1 บังคับ invariant `order = [visible...] ++ [hidden...]` ที่ `normalizeKeybarPreferences()` จุดเดียว ทุก API ของโมดูลผ่านมันอยู่แล้ว ค่าเก่าใน localStorage จึงจัดตัวเองไม่ต้อง migrate Part 2 เพิ่มสถานะ `adjusting` เข้า state machine ของ `text-selection.ts` แล้วแยก DOM ของหมุดกับแถบยืนยันไปโมดูลใหม่ `selection-handles.ts` โดย `text-selection.ts` ยังไม่รู้จัก DOM ตามสัญญาเดิมของไฟล์

**Tech Stack:** TypeScript, Vite, xterm.js (DOM renderer), Vitest (`environment: 'node'` — ไม่มี jsdom)

**Spec:** `docs/superpowers/specs/2026-08-21-keybar-sort-and-selection-handles-design.md`

## Global Constraints

- Node.js 22+ และ pnpm — ติดตั้งด้วย `pnpm install`
- ห้ามเพิ่ม dependency ใหม่ ห้ามแตะ `vitest.config.ts` — เทสรันบน `environment: 'node'` ไม่มี DOM ตรรกะที่ต้องเทสต้องเป็นฟังก์ชันบริสุทธิ์ที่ export แยก
- ห้ามใช้ `@xterm/addon-attach` input ต้องผ่าน `web/input-pipeline.ts`
- ห้ามเพิ่ม `@xterm/addon-canvas` หรือ `@xterm/addon-webgl` — DOM renderer คือสิ่งที่ทำให้ไฮไลต์ทรงบล็อกทำงาน
- ห้ามแตะฟิลด์ใน `selectionMouseInit()` (`web/text-selection.ts`) ทุกฟิลด์เป็นเงื่อนไขที่ xterm ตรวจจริง ขาดตัวเดียวเงียบสนิทไม่มี error
- `web/keybar.ts` layout constants ต้องตรงกับค่าใน `web/style.css` เสมอ
- ก่อนถือว่างานเสร็จ: `pnpm test` และ `pnpm build` ต้องผ่าน
- คอมเมนต์ในโค้ดเขียนภาษาไทยตามไฟล์รอบข้าง และอธิบาย *ทำไม* ไม่ใช่ *อะไร*

---

## File Structure

| ไฟล์ | หน้าที่ | สถานะ |
|---|---|---|
| `web/keybar-preferences.ts` | invariant การเรียง, moveKey/setKeyHidden | แก้ |
| `web/keybar-preferences.test.ts` | เทส invariant | แก้ |
| `web/key-definitions.ts` | เพิ่มปุ่ม `enter` | แก้ |
| `web/key-definitions.test.ts` | เทสปุ่ม `enter` | แก้ |
| `web/keybar.ts` | หัวข้อกลุ่ม, ปุ่ม ↑/↓, disabled ที่ขอบกลุ่ม | แก้ |
| `web/text-selection.ts` | state machine `adjusting`/`grabbing`, `blockRect()` | แก้ |
| `web/text-selection.test.ts` | เทส state machine | แก้ |
| `web/selection-handles.ts` | ตรรกะวางตำแหน่ง (บริสุทธิ์) + DOM ของหมุด/แถบยืนยัน | **สร้าง** |
| `web/selection-handles.test.ts` | เทสตรรกะวางตำแหน่ง | **สร้าง** |
| `web/main.ts` | ต่อ overlay เข้ากับ selection และ terminal | แก้ |
| `web/style.css` | `.keybar-mini-btn:disabled`, overlay หมุด/แถบยืนยัน | แก้ |
| `README.md` | สัญญาการโต้ตอบบนมือถือ | แก้ |

---

## Task 1: Sort invariant ใน keybar-preferences

**Files:**
- Modify: `web/keybar-preferences.ts:20-24, 30-46, 48-61, 94-115`
- Test: `web/keybar-preferences.test.ts`

**Interfaces:**
- Consumes: `ALL_KEY_IDS`, `DEFAULT_KEY_IDS`, `defaultOrderOf` จาก `./key-definitions.js` (มีอยู่แล้ว)
- Produces: invariant `order = [visible...] ++ [hidden...]` ที่ทุก export ของโมดูลรับประกัน — Task 3 พึ่งพาโดยตรง

- [ ] **Step 1: เขียนเทสที่ต้องแดง**

เพิ่มใน `web/keybar-preferences.test.ts` ภายใน `describe('keybar preferences', ...)`:

```ts
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
```

- [ ] **Step 2: รันเทสให้เห็นว่าแดง**

Run: `pnpm vitest run web/keybar-preferences.test.ts`
Expected: FAIL — เทส invariant ทุกตัวตก เพราะ `order` ยังไม่ถูก partition

- [ ] **Step 3: เขียน partitionOrder และแก้ defaultKeybarPreferences**

ใน `web/keybar-preferences.ts` แทนที่ `defaultKeybarPreferences()` เดิม และเพิ่มฟังก์ชันช่วย:

```ts
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
```

- [ ] **Step 4: ให้ insertMissingIds แทรกภายในกลุ่มเดียวกัน**

แทนที่ลายเซ็นและตัวฟังก์ชัน `insertMissingIds` ใน `web/keybar-preferences.ts`:

```ts
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
```

- [ ] **Step 5: สลับลำดับใน normalize แล้ว partition ปิดท้าย**

แทนที่ตัว `normalizeKeybarPreferences` ตั้งแต่บรรทัดที่คำนวณ `insertMissingIds` เป็นต้นไป:

```ts
  insertMissingIds(order, seen, hiddenSet);
  return { version: 1, order: partitionOrder(order, hiddenSet), hidden: [...hiddenSet] };
}
```

โดยย้ายการคำนวณ `hidden` ขึ้นมาก่อน `insertMissingIds` และเก็บเป็น `Set`:

```ts
  const hiddenSet = new Set(
    Array.isArray(candidate.hidden)
      ? candidate.hidden.filter((id): id is string => typeof id === 'string' && CATALOG_IDS.has(id))
      : [],
  );
```

- [ ] **Step 6: ให้ moveKey ตรึงที่เส้นแบ่งกลุ่ม**

แทนที่ `moveKey`:

```ts
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
```

- [ ] **Step 7: ให้ setKeyHidden ส่งผลผ่าน normalize**

บรรทัดสุดท้ายของ `setKeyHidden` เดิมคืน `{ ...normalized, hidden: [...hiddenIds] }` ซึ่งข้าม partition แทนที่ด้วย:

```ts
  // ต้องผ่าน normalize อีกรอบ ไม่ใช่คืน object ตรงๆ — การเปลี่ยน hidden คือการย้ายกลุ่ม
  // ซึ่งแปลว่า order ที่ถืออยู่ละเมิด invariant ทันทีที่บรรทัดนี้ทำงาน
  return normalizeKeybarPreferences({ ...normalized, hidden: [...hiddenIds] });
```

- [ ] **Step 8: รันเทสให้ผ่าน**

Run: `pnpm vitest run web/keybar-preferences.test.ts`
Expected: PASS ทุกตัว รวมเทสเดิมที่มีอยู่ก่อน

- [ ] **Step 9: รันชุดเต็มกันของพัง**

Run: `pnpm test`
Expected: PASS ทั้งหมด (`keybar.test.ts` พึ่ง `visibleKeyIds` ซึ่งลำดับปุ่มที่เปิดไม่เปลี่ยน)

- [ ] **Step 10: Commit**

```bash
git add web/keybar-preferences.ts web/keybar-preferences.test.ts
git commit -m "feat: keep hidden keybar keys after visible ones in stored order"
```

---

## Task 2: ปุ่ม Enter

**Files:**
- Modify: `web/key-definitions.ts:89` (แทรกหลัง `interrupt`)
- Test: `web/key-definitions.test.ts`, `web/keybar-preferences.test.ts:29-40`

**Interfaces:**
- Consumes: invariant จาก Task 1
- Produces: key id `'enter'` ใน `KEY_CATALOG` — ไม่มี task ถัดไปพึ่งพา

- [ ] **Step 1: เขียนเทสที่ต้องแดง**

เพิ่มใน `web/key-definitions.test.ts`:

```ts
  it('ปุ่ม Enter ส่ง carriage return ไม่ใช่ line feed', () => {
    const spec = getKeySpec('enter');
    expect(spec?.key).toEqual({ kind: 'literal', data: '\r' });
    expect(spec?.defaultVisible).toBe(true);
  });
```

เพิ่มใน `web/keybar-preferences.test.ts`:

```ts
  it('prefs ที่บันทึกก่อนมีปุ่ม Enter ได้ปุ่มนั้นมาอยู่ในกลุ่มเปิด ต่อจาก interrupt', () => {
    const legacy = { version: 1, order: ['esc', 'tab', 'interrupt', 'select'], hidden: [] };
    const result = normalizeKeybarPreferences(legacy);
    expect(result.hidden).not.toContain('enter');
    expect(result.order.indexOf('enter')).toBeGreaterThan(result.order.indexOf('interrupt'));
    expect(result.order.indexOf('enter')).toBeLessThan(result.order.indexOf('select'));
  });
```

ตรวจว่า `getKeySpec` และ `normalizeKeybarPreferences` ถูก import ในไฟล์เทสนั้นแล้ว ถ้ายังไม่มี ให้เพิ่มเข้า import ที่มีอยู่

- [ ] **Step 2: รันเทสให้เห็นว่าแดง**

Run: `pnpm vitest run web/key-definitions.test.ts web/keybar-preferences.test.ts`
Expected: FAIL — `getKeySpec('enter')` คืน `undefined`

- [ ] **Step 3: เพิ่มปุ่มเข้าแค็ตตาล็อก**

ใน `web/key-definitions.ts` แทรกบรรทัดถัดจาก `interrupt` (`defaultOrder: 110`):

```ts
  // `\r` ไม่ใช่ `\n` — PTY ในโหมด canonical แปลง CR เป็น newline ให้เอง ส่วน `\n`
  // ตรงๆ จะกลายเป็น line feed ที่เลื่อนบรรทัดแต่ไม่ submit คำสั่ง
  { id: 'enter', label: '⏎', title: 'Enter', category: 'core', key: { kind: 'literal', data: '\r' }, defaultVisible: true, defaultOrder: 112 },
```

`defaultOrder: 112` — ช่วง 115/117/118/119 ถูกจองโดย `select` / `paste` / `settings` / `fullscreen` แล้ว

- [ ] **Step 4: แก้เทสเดิมที่ตรึงลำดับปุ่มที่เปิดอยู่**

`web/keybar-preferences.test.ts:29-40` ตรึงลิสต์ 19 ตัวแรกไว้ตรงๆ ปุ่มใหม่แทรกระหว่าง `interrupt` กับ `select` ต้องอัปเดตเป็น:

```ts
    expect(visibleKeyIds(defaultKeybarPreferences()).slice(0, 20)).toEqual([
      'esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
      'shift-tab', 'shift', 'alt', 'interrupt', 'enter', 'select', 'paste', 'settings', 'fullscreen',
      'pipe', 'tilde', 'slash', 'dash',
    ]);
```

และเพิ่ม `'enter'` เข้าอาร์เรย์ใน `expect.arrayContaining([...])` ของ `order` ในเทสเดียวกัน

- [ ] **Step 5: รันเทสให้ผ่าน**

Run: `pnpm test`
Expected: PASS ทั้งหมด — ถ้ามีเทสอื่นที่ตรึงจำนวนปุ่มหรือลิสต์ label ไว้ ให้อัปเดตด้วยตัวเลขจริงที่รันได้ ไม่ใช่คาดเดา

- [ ] **Step 6: Commit**

```bash
git add web/key-definitions.ts web/key-definitions.test.ts web/keybar-preferences.test.ts
git commit -m "feat: add Enter key to the keybar catalog"
```

---

## Task 3: หน้า settings — หัวข้อกลุ่ม, ปุ่ม ↑/↓, disabled ที่ขอบ

**Files:**
- Modify: `web/keybar.ts:309-357` (`makeCustomizePanel`)
- Modify: `web/style.css:277-282` (เพิ่ม `.keybar-mini-btn:disabled`)

**Interfaces:**
- Consumes: invariant จาก Task 1 — `orderedCatalog()` คืนกลุ่มเปิดก่อนกลุ่มซ่อนโดยอัตโนมัติ
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: แก้ลูปสร้างแถวให้รู้จักกลุ่ม**

ใน `web/keybar.ts` แทนที่ `for (const spec of orderedCatalog()) {` และเนื้อในลูปส่วนปุ่มลูกศร ด้วย:

```ts
    const specs = orderedCatalog();
    const visibleCount = specs.filter(spec => !hidden.has(spec.id)).length;
    let hiddenHeadingShown = false;

    specs.forEach((spec, index) => {
      const inHiddenGroup = hidden.has(spec.id);

      // เส้นแบ่งกลุ่มต้องมองเห็นได้ ไม่ใช่กฎเงียบๆ ที่ผู้ใช้ต้องอนุมานเอาเองจากการที่
      // ปุ่มลูกศรบางตัวกดไม่ลง
      if (inHiddenGroup && !hiddenHeadingShown) {
        const heading = document.createElement('div');
        heading.className = 'keybar-customize-title';
        heading.textContent = 'ซ่อนอยู่';
        panel.append(heading);
        hiddenHeadingShown = true;
      }

      const groupStart = inHiddenGroup ? visibleCount : 0;
      const groupEnd = inHiddenGroup ? specs.length - 1 : visibleCount - 1;
```

ส่วนที่เหลือของลูป (`row`, `name`, `checkbox`, `label`) คงเดิม แล้วแทนที่ปุ่มลูกศรสองอันด้วย:

```ts
      // ↑/↓ ไม่ใช่ ←/→ — ลิสต์นี้เรียงแนวตั้ง ทิศที่แถวขยับจริงคือขึ้นกับลง
      const previous = makeMiniButton('↑', `Move ${spec.label} up`, () => {
        applyPreferences(moveKey(preferences, spec.id, -1));
      });
      previous.disabled = index === groupStart;

      const next = makeMiniButton('↓', `Move ${spec.label} down`, () => {
        applyPreferences(moveKey(preferences, spec.id, 1));
      });
      next.disabled = index === groupEnd;

      row.append(name, previous, next);
      panel.append(row);
    });
```

- [ ] **Step 2: เพิ่ม style ของปุ่มที่กดไม่ได้**

ใน `web/style.css` ต่อจากบล็อก `.keybar-mini-btn`:

```css
/* ปุ่มที่กดไม่ได้แต่หน้าตาเหมือนเดิมอ่านว่า "พัง" ไม่ใช่ "สุดทางแล้ว" */
.keybar-mini-btn:disabled {
  opacity: .3;
  cursor: default;
}
```

- [ ] **Step 3: รันเทสและ build**

Run: `pnpm test && pnpm build`
Expected: PASS — `keybar.test.ts` เทสเฉพาะฟังก์ชันบริสุทธิ์ ไม่แตะ `makeCustomizePanel`

- [ ] **Step 4: ตรวจด้วยตาบนอุปกรณ์จริง**

รัน `pnpm dev:server` และ `DEV_ORIGINS=http://localhost:5173 pnpm dev:web` แล้วเปิดหน้า settings ตรวจสี่ข้อ:
1. ปุ่มที่ติ๊กไว้อยู่บนทั้งหมด มีหัวข้อ `ซ่อนอยู่` คั่นก่อนกลุ่มล่าง
2. ติ๊กออกแล้วแถวกระโดดลงไปท้ายสุดทันที ติ๊กกลับแล้วขึ้นมาต่อท้ายกลุ่มบน
3. `↑` ของแถวแรกในแต่ละกลุ่ม และ `↓` ของแถวสุดท้าย เป็นสีจาง กดไม่ลง
4. **หัวข้อที่เพิ่มเข้ามาทำให้ panel สูงขึ้น** — terminal ต้องยัง refit ถูก ไม่มีแถวล่างถูกบัง (ดู commit `cc241fe`)

- [ ] **Step 5: Commit**

```bash
git add web/keybar.ts web/style.css
git commit -m "feat: group settings list by visibility with vertical move buttons"
```

---

## Task 4: State machine `adjusting` ใน text-selection

**Files:**
- Modify: `web/text-selection.ts:88-209`
- Test: `web/text-selection.test.ts`

**Interfaces:**
- Consumes: `blockFrom`, `clampColumn`, `extractText` จาก `./selection-region.js`; `nearestPane` จาก `./pane-detect.js` (ทั้งหมดมีอยู่แล้ว ไม่แก้)
- Produces — Task 5, 6, 7 พึ่งพาทั้งหมดนี้:
  - `SelectionState = 'off' | 'idle' | 'dragging' | 'adjusting' | 'grabbing'`
  - `state(): SelectionState`
  - `currentBlock(): Block | null`
  - `beginHandleDrag(corner: 'start' | 'end'): void`
  - `blockRect(): { left: number; top: number; right: number; bottom: number } | null`
  - `confirm(): void`
  - `TextSelectionDeps.onBlockChange?: (block: Block | null) => void`

- [ ] **Step 1: เขียนเทสที่ต้องแดง**

เพิ่มใน `web/text-selection.test.ts` (ใช้ helper สร้าง fake `TerminalPort` ที่ไฟล์นั้นมีอยู่แล้ว — ถ้าชื่อไม่ตรง ให้ใช้ชื่อจริงในไฟล์):

```ts
  it('ปล่อยนิ้วจบการลากแล้วเข้าโหมดปรับ ไม่เปิดแผ่นผลลัพธ์', () => {
    const picked = vi.fn();
    const blocks: unknown[] = [];
    const s = createTextSelection({ ...baseDeps(), onRegionPicked: picked, onBlockChange: b => blocks.push(b) });
    s.toggle();
    s.pointerDown(10, 10);
    s.pointerMove(60, 30);
    s.pointerUp(60, 30);
    expect(picked).not.toHaveBeenCalled();
    expect(s.state()).toBe('adjusting');
    expect(s.currentBlock()).not.toBeNull();
    expect(blocks.at(-1)).toEqual(s.currentBlock());
  });

  it('ลากหมุด start เปลี่ยนเฉพาะมุมบนซ้าย', () => {
    const s = createTextSelection(baseDeps());
    s.toggle();
    s.pointerDown(30, 30);
    s.pointerMove(80, 60);
    s.pointerUp(80, 60);
    const before = s.currentBlock()!;
    s.beginHandleDrag('start');
    s.pointerMove(10, 10);
    s.pointerUp(10, 10);
    const after = s.currentBlock()!;
    expect(after.bottomLine).toBe(before.bottomLine);
    expect(after.endColumn).toBe(before.endColumn);
    expect(after.topLine).toBeLessThan(before.topLine);
  });

  it('ลากหมุด end เปลี่ยนเฉพาะมุมล่างขวา', () => {
    const s = createTextSelection(baseDeps());
    s.toggle();
    s.pointerDown(30, 30);
    s.pointerMove(80, 60);
    s.pointerUp(80, 60);
    const before = s.currentBlock()!;
    s.beginHandleDrag('end');
    s.pointerMove(140, 90);
    s.pointerUp(140, 90);
    const after = s.currentBlock()!;
    expect(after.topLine).toBe(before.topLine);
    expect(after.startColumn).toBe(before.startColumn);
    expect(after.bottomLine).toBeGreaterThan(before.bottomLine);
  });

  it('ลากหมุดข้ามอีกมุมไป กรอบพลิกได้ถูกต้อง', () => {
    const s = createTextSelection(baseDeps());
    s.toggle();
    s.pointerDown(30, 30);
    s.pointerMove(80, 60);
    s.pointerUp(80, 60);
    s.beginHandleDrag('start');
    s.pointerMove(200, 200);
    s.pointerUp(200, 200);
    const block = s.currentBlock()!;
    expect(block.topLine).toBeLessThanOrEqual(block.bottomLine);
    expect(block.startColumn).toBeLessThanOrEqual(block.endColumn);
  });

  it('แตะที่ terminal ขณะปรับ = เริ่มกรอบใหม่ ทิ้งกรอบเดิม', () => {
    const s = createTextSelection(baseDeps());
    s.toggle();
    s.pointerDown(30, 30);
    s.pointerMove(80, 60);
    s.pointerUp(80, 60);
    const before = s.currentBlock()!;
    s.pointerDown(200, 200);
    s.pointerUp(200, 200);
    expect(s.currentBlock()).not.toEqual(before);
  });

  it('confirm ส่งข้อความออกไปแต่ยังอยู่ในโหมด', () => {
    const picked = vi.fn();
    const s = createTextSelection({ ...baseDeps(), onRegionPicked: picked });
    s.toggle();
    s.pointerDown(10, 10);
    s.pointerMove(60, 30);
    s.pointerUp(60, 30);
    s.confirm();
    expect(picked).toHaveBeenCalledTimes(1);
    expect(s.active()).toBe(true);
  });

  it('กรอบที่ดึงข้อความไม่ได้ยังอยู่ให้ปรับต่อ', () => {
    const s = createTextSelection(emptyTextDeps());
    s.toggle();
    s.pointerDown(10, 10);
    s.pointerMove(60, 30);
    s.pointerUp(60, 30);
    expect(s.state()).toBe('adjusting');
    expect(s.currentBlock()).not.toBeNull();
  });

  it('blockRect คืน null เมื่อไม่มีกรอบ และไม่ clamp ให้อยู่ในจอ', () => {
    const s = createTextSelection(baseDeps());
    expect(s.blockRect()).toBeNull();
    s.toggle();
    s.pointerDown(10, 10);
    s.pointerMove(60, 30);
    s.pointerUp(60, 30);
    const rect = s.blockRect()!;
    expect(rect.right).toBeGreaterThan(rect.left);
    expect(rect.bottom).toBeGreaterThan(rect.top);
  });

  it('การลากหมุดยังตรึงคอลัมน์ไว้ใน pane เดิม', () => {
    const s = createTextSelection(pipedPaneDeps());
    s.toggle();
    s.pointerDown(10, 10);
    s.pointerMove(40, 30);
    s.pointerUp(40, 30);
    s.beginHandleDrag('end');
    s.pointerMove(9999, 30);
    s.pointerUp(9999, 30);
    const pane = s.activePanes().find(p => p.start <= s.currentBlock()!.startColumn)!;
    expect(s.currentBlock()!.endColumn).toBeLessThanOrEqual(pane.end);
  });
```

`baseDeps()`, `emptyTextDeps()`, `pipedPaneDeps()` คือ helper ที่ต้องเขียนในไฟล์เทส โดยล้อจาก fake port ที่มีอยู่แล้วในไฟล์นั้น — `emptyTextDeps` คือ port ที่ `readLine` คืนสตริงว่างเสมอ `pipedPaneDeps` คือ port ที่มีอักขระ `│` อยู่คอลัมน์กลางทุกแถว

- [ ] **Step 2: รันเทสให้เห็นว่าแดง**

Run: `pnpm vitest run web/text-selection.test.ts`
Expected: FAIL — `s.state is not a function`

- [ ] **Step 3: เพิ่ม state และ block ที่คงอยู่**

ใน `web/text-selection.ts` เพิ่ม type และแก้ deps:

```ts
export type SelectionState = 'off' | 'idle' | 'dragging' | 'adjusting' | 'grabbing';
```

เพิ่มลงใน `TextSelectionDeps`:

```ts
  /** ยิงทุกครั้งที่กรอบเปลี่ยนหรือหาย — main.ts ใช้ขยับหมุดตาม */
  onBlockChange?: (block: Block | null) => void;
```

ใน `createTextSelection` เพิ่มตัวแปรสถานะข้าง `drag`:

```ts
  let block: Block | null = null;
  let phase: SelectionState = 'off';

  const setBlock = (next: Block | null): void => {
    block = next;
    deps.onBlockChange?.(next);
  };
```

- [ ] **Step 4: แก้ finish ให้เข้าโหมดปรับแทนการจบ**

แทนที่ `finish()` ทั้งฟังก์ชัน:

```ts
  /**
   * จบการลาก = เข้าโหมดปรับ ไม่ใช่จบงาน
   *
   * บนจอมือถือการลากครั้งเดียวให้ตรงเป๊ะเป็นไปไม่ได้ ก่อนหน้านี้ลากพลาดแปลว่าต้อง
   * ปิดแผ่น ออกจากโหมด แล้วเริ่มใหม่ทั้งหมด
   *
   * กรอบที่ดึงข้อความไม่ได้ก็ไม่ล้างทิ้ง — ผู้ใช้ลากหมุดต่อจนโดนข้อความได้เลย
   * ปุ่มคัดลอกที่ disabled คือคำบอกที่พอแล้ว
   */
  const finish = (): void => {
    if (!drag) return;
    setBlock(blockFrom(drag.anchor, drag.focus));
    drag = null;
    phase = 'adjusting';
  };
```

- [ ] **Step 5: เพิ่ม beginHandleDrag, blockRect, confirm, state**

ใน `return { ... }` ของ `createTextSelection` เพิ่ม (และให้ `pointerDown` ตั้ง `phase = 'dragging'`, `setMode` ตั้ง `phase` เป็น `'idle'` / `'off'` พร้อม `setBlock(null)`):

```ts
    state(): SelectionState { return phase; },
    currentBlock(): Block | null { return block; },

    /**
     * จับหมุด = ลากต่อจากมุมตรงข้าม
     *
     * blockFrom() คำนวณ min/max อยู่แล้ว การลากข้ามอีกมุมไปจึงพลิกกรอบให้เองถูกต้อง
     * โดยไม่ต้องมีสาขาแยก
     *
     * pane ต้องมาจากมุมที่ตรึงไว้ ไม่ใช่ null — ถ้าเป็น null clampColumn() กลายเป็น
     * no-op แล้วการลากหมุดจะดึงเส้นแบ่ง pane ติดมา ซึ่งคือปัญหาที่ทั้งไฟล์นี้แก้อยู่
     */
    beginHandleDrag(corner: 'start' | 'end'): void {
      if (!block) return;
      const anchor: Cell = corner === 'start'
        ? { line: block.bottomLine, column: block.endColumn }
        : { line: block.topLine, column: block.startColumn };
      const focus: Cell = corner === 'start'
        ? { line: block.topLine, column: block.startColumn }
        : { line: block.bottomLine, column: block.endColumn };
      drag = { anchor, pane: nearestPane(panes, anchor.column), focus };
      phase = 'grabbing';
      deps.vibrate?.(10);

      const px = pixelAt(anchor);
      terminal.dispatchMouse('mousedown', px.x, px.y);
      const focusPx = pixelAt(focus);
      terminal.dispatchMouse('mousemove', focusPx.x, focusPx.y);
    },

    /**
     * ไม่ clamp ให้อยู่ในจอโดยตั้งใจ — คืนพิกัดจริงแม้ติดลบหรือเกินความสูง
     * ถ้า clamp ตรงนี้ หมุดจะไปเกาะขอบจอแล้วผู้ใช้เข้าใจว่ากรอบสิ้นสุดตรงนั้น
     * แล้วลากต่อจากตำแหน่งที่ผิด selection-handles.ts เป็นคนตัดสินว่าจะซ่อนอันไหน
     */
    blockRect() {
      if (!block) return null;
      const { cellWidth, cellHeight } = terminal.screenMetrics();
      const topLeft = pixelAt({ line: block.topLine, column: block.startColumn });
      const bottomRight = pixelAt({ line: block.bottomLine, column: block.endColumn });
      return {
        left: topLeft.x - cellWidth / 2,
        top: topLeft.y - cellHeight / 2,
        right: bottomRight.x + cellWidth / 2,
        bottom: bottomRight.y + cellHeight / 2,
      };
    },

    /**
     * ไม่ออกจากโหมดตรงนี้ — setMode(false) จะเรียก clearSelection() ทำให้ไฮไลต์หายไป
     * ใต้แผ่นที่เพิ่งเปิด ทั้งที่ข้อความบนแผ่นยังหมายถึงกรอบนั้นอยู่
     * ผู้ปิดโหมดคือ sheet.onClose เหมือนเดิม (main.ts)
     */
    confirm(): void {
      if (!block) return;
      const text = extractText(block, terminal.readLine);
      if (text === '') return;
      deps.onRegionPicked(text);
    },
```

`pointerDown` ต้องเพิ่ม `setBlock(null); phase = 'dragging';` ก่อนตั้ง `drag` — การแตะที่ terminal ทิ้งกรอบเดิมเสมอ และ `setMode` ต้องเรียก `setBlock(null)` พร้อมตั้ง `phase = next ? 'idle' : 'off'`

- [ ] **Step 6: รันเทสให้ผ่าน**

Run: `pnpm vitest run web/text-selection.test.ts`
Expected: PASS ทุกตัว รวมเทสเดิม

- [ ] **Step 7: Commit**

```bash
git add web/text-selection.ts web/text-selection.test.ts
git commit -m "feat: keep the selection block adjustable after the first drag"
```

---

## Task 5: ตรรกะวางตำแหน่งของ overlay (ฟังก์ชันบริสุทธิ์)

**Files:**
- Create: `web/selection-handles.ts`
- Test: `web/selection-handles.test.ts`

**Interfaces:**
- Consumes: `Block` จาก `./selection-region.js`
- Produces — Task 6, 7 พึ่งพา:
  - `interface Rect { left: number; top: number; right: number; bottom: number }`
  - `interface PlacementLimits { viewportHeight: number; bottomLimit: number; barHeight: number }`
  - `handleAnchors(rect: Rect): { start: { x: number; y: number }; end: { x: number; y: number } }`
  - `confirmBarPlacement(rect: Rect, limits: PlacementLimits): { side: 'above' | 'below' | 'over'; top: number }`
  - `handleVisibility(rect: Rect, viewportHeight: number): { start: boolean; end: boolean }`

- [ ] **Step 1: เขียนเทสที่ต้องแดง**

สร้าง `web/selection-handles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { confirmBarPlacement, handleAnchors, handleVisibility } from './selection-handles.js';

const limits = { viewportHeight: 800, bottomLimit: 700, barHeight: 48 };

describe('การวาง overlay ของโหมดเลือก', () => {
  it('หมุดเกาะมุมบนซ้ายกับล่างขวา', () => {
    expect(handleAnchors({ left: 10, top: 20, right: 90, bottom: 60 })).toEqual({
      start: { x: 10, y: 20 },
      end: { x: 90, y: 60 },
    });
  });

  it('กรอบสูงบรรทัดเดียวก็ยังได้หมุดสองอันคนละมุม', () => {
    const anchors = handleAnchors({ left: 10, top: 20, right: 90, bottom: 36 });
    expect(anchors.start).not.toEqual(anchors.end);
  });

  it('แถบยืนยันอยู่เหนือกรอบเป็นค่าตั้งต้น', () => {
    const placement = confirmBarPlacement({ left: 0, top: 300, right: 100, bottom: 400 }, limits);
    expect(placement.side).toBe('above');
    expect(placement.top).toBe(300 - 48);
  });

  it('กรอบชิดขอบบนแล้วแถบตกลงไปอยู่ใต้กรอบ', () => {
    const placement = confirmBarPlacement({ left: 0, top: 10, right: 100, bottom: 80 }, limits);
    expect(placement.side).toBe('below');
    expect(placement.top).toBe(80);
  });

  it('ไม่พอทั้งบนและล่างก็ทับกรอบ ดีกว่าหลุดจอไปเงียบๆ', () => {
    const placement = confirmBarPlacement({ left: 0, top: 10, right: 100, bottom: 690 }, limits);
    expect(placement.side).toBe('over');
  });

  it('แถบไม่เคยล้ำเข้าไปในพื้นที่แถบปุ่ม', () => {
    for (const top of [0, 100, 400, 660, 690]) {
      const placement = confirmBarPlacement({ left: 0, top, right: 100, bottom: top + 60 }, limits);
      expect(placement.top + limits.barHeight).toBeLessThanOrEqual(limits.bottomLimit);
      expect(placement.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('หมุดที่หลุดจอถูกซ่อน อีกอันในกรอบเดียวกันไม่ถูกซ่อนตาม', () => {
    expect(handleVisibility({ left: 0, top: -40, right: 100, bottom: 200 }, 800))
      .toEqual({ start: false, end: true });
    expect(handleVisibility({ left: 0, top: 200, right: 100, bottom: 900 }, 800))
      .toEqual({ start: true, end: false });
    expect(handleVisibility({ left: 0, top: 10, right: 100, bottom: 200 }, 800))
      .toEqual({ start: true, end: true });
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าแดง**

Run: `pnpm vitest run web/selection-handles.test.ts`
Expected: FAIL — หาไฟล์ `./selection-handles.js` ไม่เจอ

- [ ] **Step 3: เขียนฟังก์ชันบริสุทธิ์**

สร้าง `web/selection-handles.ts`:

```ts
/**
 * หมุดปรับกรอบและแถบยืนยัน — DOM ทั้งหมดของโหมดเลือกที่ไม่ใช่ไฮไลต์
 *
 * ไฮไลต์เป็นของ xterm (DOM renderer วาดทรงบล็อกให้เอง) ไฟล์นี้รับผิดชอบเฉพาะสิ่งที่
 * ลอยอยู่เหนือมัน: หมุดสองมุมที่ลากปรับกรอบได้ และแถบยืนยัน
 *
 * ตรรกะการวางตำแหน่งทั้งหมดแยกเป็นฟังก์ชันบริสุทธิ์ที่ export ไว้ เพราะ vitest ของ repo นี้
 * รันบน environment 'node' ไม่มี DOM ให้เทส — แบบเดียวกับที่ selection-sheet.ts ทำ
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacementLimits {
  viewportHeight: number;
  /** ขอบล่างที่ใช้ได้จริง = top ของแถบปุ่ม ไม่ใช่ขอบ viewport */
  bottomLimit: number;
  barHeight: number;
}

export function handleAnchors(rect: Rect): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return {
    start: { x: rect.left, y: rect.top },
    end: { x: rect.right, y: rect.bottom },
  };
}

/**
 * เหนือกรอบก่อน ตกลงใต้กรอบเมื่อชิดขอบบน ทับกรอบเมื่อไม่พอทั้งสองทาง
 *
 * ทับกรอบดีกว่าหลุดจอ — แถบที่มองไม่เห็นเท่ากับผู้ใช้ออกจากโหมดไม่ได้เลย
 * นอกจากไปกดปุ่ม ⧉ บนแถบปุ่มซึ่งอาจถูกนิ้วบังอยู่
 */
export function confirmBarPlacement(rect: Rect, limits: PlacementLimits): { side: 'above' | 'below' | 'over'; top: number } {
  const clamp = (value: number): number =>
    Math.max(0, Math.min(value, limits.bottomLimit - limits.barHeight));

  if (rect.top - limits.barHeight >= 0) {
    return { side: 'above', top: clamp(rect.top - limits.barHeight) };
  }
  if (rect.bottom + limits.barHeight <= limits.bottomLimit) {
    return { side: 'below', top: clamp(rect.bottom) };
  }
  return { side: 'over', top: clamp((rect.top + rect.bottom) / 2 - limits.barHeight / 2) };
}

/**
 * ซ่อนเฉพาะหมุดที่หลุดจอ ไม่ใช่ทั้งกรอบ — กรอบที่ยาวกว่าหนึ่งหน้าจอเกิดได้จาก
 * output ของ PTY ที่ไหลเข้ามาระหว่างที่ผู้ใช้กำลังปรับ ยกเลิกกรอบทิ้งตอนนั้น
 * เท่ากับลบงานที่ผู้ใช้เพิ่งทำเพราะเหตุที่ไม่ใช่ความผิดเขา
 */
export function handleVisibility(rect: Rect, viewportHeight: number): { start: boolean; end: boolean } {
  return {
    start: rect.top >= 0 && rect.top <= viewportHeight,
    end: rect.bottom >= 0 && rect.bottom <= viewportHeight,
  };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run web/selection-handles.test.ts`
Expected: PASS ทั้ง 7 ตัว

- [ ] **Step 5: Commit**

```bash
git add web/selection-handles.ts web/selection-handles.test.ts
git commit -m "feat: add placement logic for selection handles overlay"
```

---

## Task 6: DOM ของหมุดและแถบยืนยัน

**Files:**
- Modify: `web/selection-handles.ts` (เพิ่ม factory ต่อจากฟังก์ชันบริสุทธิ์)
- Modify: `web/style.css` (ต่อจากบล็อก `.terminal.selecting`)

**Interfaces:**
- Consumes: `handleAnchors`, `confirmBarPlacement`, `handleVisibility`, `Rect`, `PlacementLimits` จาก Task 5
- Produces — Task 7 พึ่งพา:
  - `createSelectionHandles(deps: { onGrab: (corner: 'start' | 'end') => void; onConfirm: () => void; onCancel: () => void; document?: Document }): SelectionHandles`
  - `interface SelectionHandles { element: HTMLElement; place(rect: Rect | null, limits: PlacementLimits): void; setCopyEnabled(enabled: boolean): void }`

- [ ] **Step 1: เขียน factory**

ต่อท้าย `web/selection-handles.ts`:

```ts
export interface SelectionHandles {
  element: HTMLElement;
  /** rect เป็น null = ซ่อน overlay ทั้งอัน */
  place(rect: Rect | null, limits: PlacementLimits): void;
  setCopyEnabled(enabled: boolean): void;
}

export function createSelectionHandles(deps: {
  onGrab: (corner: 'start' | 'end') => void;
  onConfirm: () => void;
  onCancel: () => void;
  document?: Document;
}): SelectionHandles {
  const doc = deps.document ?? document;

  const root = doc.createElement('div');
  root.className = 'sel-overlay';
  root.hidden = true;

  const makeHandle = (corner: 'start' | 'end'): HTMLElement => {
    const handle = doc.createElement('div');
    handle.className = `sel-handle sel-handle-${corner}`;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', corner === 'start' ? 'ปรับมุมเริ่มต้น' : 'ปรับมุมสิ้นสุด');
    // touchstart ไม่ใช่ click — ต้องจับให้ได้ตั้งแต่นิ้วแตะ ไม่ใช่ตอนปล่อย
    // preventDefault กันเบราว์เซอร์สังเคราะห์ mouse event ตามหลังซึ่งจะไปถึง xterm
    handle.addEventListener('touchstart', event => {
      event.preventDefault();
      deps.onGrab(corner);
    }, { passive: false });
    return handle;
  };

  const start = makeHandle('start');
  const end = makeHandle('end');

  const bar = doc.createElement('div');
  bar.className = 'sel-confirm';

  const copyButton = doc.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'sel-btn sel-btn-copy';
  copyButton.textContent = 'คัดลอก';
  copyButton.addEventListener('click', () => deps.onConfirm());

  const cancelButton = doc.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'sel-btn';
  cancelButton.textContent = 'ยกเลิก';
  cancelButton.addEventListener('click', () => deps.onCancel());

  bar.append(copyButton, cancelButton);
  root.append(start, end, bar);

  return {
    element: root,
    setCopyEnabled(enabled: boolean): void { copyButton.disabled = !enabled; },
    place(rect: Rect | null, limits: PlacementLimits): void {
      if (!rect) {
        root.hidden = true;
        return;
      }
      root.hidden = false;

      const anchors = handleAnchors(rect);
      const visible = handleVisibility(rect, limits.viewportHeight);

      start.hidden = !visible.start;
      start.style.left = `${anchors.start.x}px`;
      start.style.top = `${anchors.start.y}px`;

      end.hidden = !visible.end;
      end.style.left = `${anchors.end.x}px`;
      end.style.top = `${anchors.end.y}px`;

      const placement = confirmBarPlacement(rect, limits);
      bar.style.top = `${placement.top}px`;
      bar.dataset.side = placement.side;
    },
  };
}
```

- [ ] **Step 2: เขียน CSS**

ต่อจากบล็อก `.terminal.selecting` ใน `web/style.css`:

```css
/*
 * overlay ต้อง fixed ไม่ใช่ flex item — .app เป็น flex column ที่ความสูงถูกตรึงด้วย
 * --visible-height ของที่ append เข้าไปเฉยๆ จะไปเบียดความสูงของ .terminal
 * เหตุผลเดียวกับที่ .sheet ทำ z-index ต่ำกว่า .sheet (20) เพื่อให้แผ่นผลลัพธ์ทับได้
 */
.sel-overlay {
  position: fixed; inset: 0; z-index: 15;
  pointer-events: none;
}

/*
 * touch-action: none ที่นี่จำเป็นแม้ .terminal จะตั้งไว้แล้ว — overlay อยู่นอก .terminal
 * ไม่ได้สืบทอดมา ถ้าไม่ตั้ง เบราว์เซอร์จะกินการลากไปทำ scroll ก่อนถึง handler
 */
.sel-handle {
  position: absolute;
  width: 2.75rem; height: 2.75rem; /* 44px; keep synchronized with KEY_TARGET_PX */
  margin: -1.375rem 0 0 -1.375rem;
  border-radius: 50%;
  pointer-events: auto;
  touch-action: none;
  background: radial-gradient(circle at center, var(--accent) 0 .4rem, transparent .45rem);
}

.sel-confirm {
  position: absolute; left: 50%;
  transform: translateX(-50%);
  display: flex; gap: .5rem;
  padding: .3rem;
  border-radius: .6rem;
  background: #15151c;
  border: 1px solid #2e2e3a;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .45);
  pointer-events: auto;
}

.sel-confirm[data-side="over"] { opacity: .92; }

.sel-btn {
  min-width: 5rem; min-height: 2.5rem;
  font: inherit; color: var(--fg);
  background: #22222c;
  border: 1px solid #2e2e3a; border-radius: .45rem;
}

.sel-btn:disabled { opacity: .3; }
```

- [ ] **Step 3: รันเทสและ build**

Run: `pnpm test && pnpm build`
Expected: PASS — เทสของ Task 5 ยังผ่าน และ TypeScript คอมไพล์ factory ใหม่ได้

- [ ] **Step 4: Commit**

```bash
git add web/selection-handles.ts web/style.css
git commit -m "feat: render selection handles and confirm bar overlay"
```

---

## Task 7: ต่อ overlay เข้ากับ main.ts

**Files:**
- Modify: `web/main.ts:251-282` (สร้าง sheet/selection), `web/main.ts:284` (`bindTouch`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `state()`, `currentBlock()`, `beginHandleDrag()`, `blockRect()`, `confirm()`, `onBlockChange` จาก Task 4; `createSelectionHandles`, `PlacementLimits` จาก Task 6
- Produces: ไม่มี export ใหม่

- [ ] **Step 1: สร้าง overlay และส่งเข้า deps ของ selection**

ใน `web/main.ts` เพิ่ม import:

```ts
import { createSelectionHandles } from './selection-handles.js';
```

ต่อจากบล็อกที่สร้าง `sheet` (`main.ts:251-256`) เพิ่ม:

```ts
  const handles = createSelectionHandles({
    onGrab: corner => selection?.beginHandleDrag(corner),
    onConfirm: () => selection?.confirm(),
    onCancel: () => selection?.cancel(),
  });
  $('app').append(handles.element);

  /**
   * ขอบล่างที่ใช้ได้คือ top ของแถบปุ่ม ไม่ใช่ขอบ viewport — แถบปุ่มกินพื้นที่ล่างจอ
   * อยู่ตลอด และความสูงของมันเปลี่ยนได้ตอนกางหน้า settings จึงต้องอ่านสดทุกครั้ง
   */
  const placementLimits = () => {
    const bar = $('keybar').getBoundingClientRect();
    return { viewportHeight: window.innerHeight, bottomLimit: bar.top, barHeight: 48 };
  };

  /**
   * overlay โผล่เฉพาะสถานะ adjusting — ระหว่างลากไม่ต้องมีหมุดให้รก และ onBlockChange
   * ที่ยิงถี่ระหว่างลากจะไม่ทำให้ overlay กะพริบ
   */
  const syncHandles = (): void => {
    if (!selection || selection.state() !== 'adjusting') {
      handles.place(null, placementLimits());
      return;
    }
    handles.place(selection.blockRect(), placementLimits());
  };
```

- [ ] **Step 2: ต่อ callback เข้ากับ createTextSelection**

ใน `createTextSelection({ ... })` (`main.ts:265`) เพิ่ม `onBlockChange` และแก้ `onRegionPicked`:

```ts
    onRegionPicked: text => {
      // ซ่อน overlay ก่อนเปิดแผ่น ไม่งั้นหมุดจะลอยทับ backdrop
      handles.place(null, placementLimits());
      sheet.open(text);
    },
    onBlockChange: block => {
      handles.setCopyEnabled(block !== null);
      syncHandles();
    },
```

และใน `onModeChange` เพิ่ม `syncHandles();` เป็นบรรทัดสุดท้ายก่อน `keybar.refresh();`

- [ ] **Step 3: ให้หมุดตามการเลื่อนและการปรับขนาด**

ต่อจาก `bindTouch(t, fit);` (`main.ts:284`) เพิ่ม:

```ts
  // การเลื่อนนี้มาจาก output ของ PTY เท่านั้น — ในโหมดเลือก stopGestures() ถูกเรียก
  // และนิ้วเดียวทุกครั้งถูก selectionOwnsTouch() ยึดไป ผู้ใช้เลื่อนจอเองไม่ได้
  t.onScroll(() => syncHandles());
  t.onResize(() => syncHandles());
  window.addEventListener('resize', syncHandles);
```

- [ ] **Step 4: ให้ปุ่มคัดลอกดับเมื่อกรอบดึงข้อความไม่ได้**

`onBlockChange` ใน Step 2 เปิด/ปิดตามการมีกรอบ แต่กรอบที่คลุมพื้นที่ว่างก็ยังไม่ใช่ null
แก้เป็นการถามข้อความจริง โดยเปลี่ยนบรรทัดใน `onBlockChange`:

```ts
      handles.setCopyEnabled(block !== null && selection?.blockHasText() === true);
```

และเพิ่มใน `web/text-selection.ts` ภายใน object ที่ return:

```ts
    /** กรอบที่คลุมแต่ช่องว่างดึงข้อความไม่ได้ — ปุ่มคัดลอกต้องดับ ไม่ใช่กดแล้วเงียบ */
    blockHasText(): boolean {
      return block !== null && extractText(block, terminal.readLine) !== '';
    },
```

- [ ] **Step 5: รันเทสและ build**

Run: `pnpm test && pnpm build`
Expected: PASS ทั้งหมด

- [ ] **Step 6: ตรวจด้วยตาบนมือถือจริง**

รัน dev server แล้วเปิดจากมือถือ ตรวจแปดข้อ:
1. เข้าโหมดเลือก ลากหนึ่งครั้ง → หมุดสองมุมโผล่ แผ่นผลลัพธ์ **ไม่** เปิด
2. ลากหมุดบนซ้าย → มุมล่างขวาไม่ขยับ และไฮไลต์เดินตามนิ้ว
3. ลากหมุดจนข้ามอีกมุมไป → กรอบพลิกโดยไม่ค้าง
4. แตะที่ terminal → กรอบเดิมหาย เริ่มกรอบใหม่
5. กดคัดลอก → แผ่นเปิด หมุดหาย ไฮไลต์ยังอยู่ใต้แผ่น กดค้างบนข้อความในแผ่นได้เมนู native
6. ปิดแผ่น → ออกจากโหมด ไฮไลต์หาย
7. กดยกเลิก → ออกจากโหมดทันทีโดยไม่เปิดแผ่น
8. ลากคลุมพื้นที่ว่าง → ปุ่มคัดลอกจาง กดไม่ลง แต่หมุดยังลากต่อได้
9. ในหน้าจอที่แบ่ง pane (herdr/tmux) → ลากหมุดออกนอก pane แล้วคอลัมน์ยังถูกตรึง ไม่มีเส้นแบ่งติดมา

- [ ] **Step 7: อัปเดต README**

ใน `README.md` ส่วนที่อธิบายสัญญาการโต้ตอบบนมือถือ เพิ่มสองบรรทัด:

```markdown
- โหมดเลือกข้อความ: ลากหนึ่งครั้งได้กรอบตั้งต้น แล้วปรับด้วยหมุดสองมุมได้ไม่จำกัดครั้ง
  ก่อนกดคัดลอก แตะที่ terminal ระหว่างนั้นคือการเริ่มกรอบใหม่
- หน้า settings ของแถบปุ่ม: ปุ่มที่เปิดอยู่เรียงบนสุดเสมอ ปุ่มที่ปิดถูกดันไปท้ายลิสต์
  ปุ่ม ↑/↓ สลับตำแหน่งได้เฉพาะภายในกลุ่มเดียวกัน
```

- [ ] **Step 8: Commit**

```bash
git add web/main.ts web/text-selection.ts README.md
git commit -m "feat: wire adjustable selection handles into the terminal view"
```

---

## Self-Review

**Spec coverage:**

| ข้อกำหนดใน spec | Task |
|---|---|
| Invariant `[visible] ++ [hidden]` ที่ normalize | 1 |
| สลับลำดับ normalize (hidden ก่อน insertMissingIds) | 1 |
| `insertMissingIds` scan ภายในกลุ่ม | 1 |
| `defaultKeybarPreferences()` เคารพ invariant | 1 |
| `moveKey` ตรึงที่เส้นแบ่งกลุ่ม | 1 |
| `setKeyHidden` ย้ายกลุ่มผ่าน normalize | 1 |
| ปุ่ม Enter (`\r`, defaultOrder 112) | 2 |
| หัวข้อกลุ่ม `ซ่อนอยู่` | 3 |
| ปุ่ม ↑/↓ แทน ←/→ + aria-label | 3 |
| disabled ที่ขอบกลุ่ม + style | 3 |
| ตรวจ refit ของ panel ที่สูงขึ้น | 3 (Step 4.4) |
| State machine `adjusting` / `grabbing` | 4 |
| `beginHandleDrag` พร้อม pane ที่ถูกต้อง | 4 |
| `blockRect()` ไม่ clamp | 4 |
| `confirm()` ไม่ออกจากโหมด | 4 |
| กรอบว่างไม่ถูกล้างทิ้ง | 4, 7 (Step 4) |
| Haptics ใน `beginHandleDrag` | 4 |
| ตรรกะวางตำแหน่งเป็นฟังก์ชันบริสุทธิ์ | 5 |
| แถบยืนยันไม่ทับแถบปุ่ม | 5, 7 (`placementLimits`) |
| ซ่อนหมุดที่หลุดจอโดยไม่ยกเลิกกรอบ | 5, 6 |
| overlay `position: fixed` + z-index 15 + touch-action | 6 |
| ไม่ต้องมี bail logic ใน touch handler ของ terminal | 7 (ไม่แตะ `bindTouch`) |
| ซ่อน overlay ตอนเปิด sheet | 7 (Step 2) |
| ผูก onScroll / resize | 7 (Step 3) |
| อัปเดตเอกสาร | 7 (Step 7) |

**Placeholder scan:** ไม่มี TBD/TODO ทุก step ที่แก้โค้ดมี code block จริง ข้อยกเว้นที่ตั้งใจคือ helper `baseDeps()` / `emptyTextDeps()` / `pipedPaneDeps()` ใน Task 4 Step 1 ซึ่งต้องล้อจาก fake port ที่มีอยู่แล้วในไฟล์เทสนั้น — เขียนตายตัวไว้ในแผนไม่ได้เพราะยังไม่รู้ชื่อ helper จริงในไฟล์

**Type consistency:** `Rect` / `PlacementLimits` นิยามใน Task 5 ใช้ชื่อเดียวกันใน Task 6 และ 7 `'start' | 'end'` เป็นชื่อมุมเดียวกันทั้ง Task 4, 5, 6, 7 `blockRect()` คืน shape เดียวกับ `Rect` `state()` คืน `SelectionState` ที่ Task 7 เทียบกับ `'adjusting'` ตรงกัน
