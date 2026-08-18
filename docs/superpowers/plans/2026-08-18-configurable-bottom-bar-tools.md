# Configurable Bottom Bar Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed mobile terminal bottom key list with a polished, icon-aware, user-configurable tools bar that supports ordering, show/hide, preset key groups, special symbols, navigation keys, F1-F12, and common Ctrl shortcuts.

**Architecture:** Keep terminal input security-critical and centralized: every toolbar action must still pass through `web/input-pipeline.ts` via `BarKey`. Split key definitions, default layout, and user preferences into focused modules, while `web/keybar.ts` remains responsible for DOM mounting, modifier state rendering, viewport-safe expansion, keyboard restore behavior, and press-repeat wiring. Preferences are local-only in `localStorage`; there is no server persistence and no terminal byte path bypass.

**Tech Stack:** TypeScript, Vite, xterm.js, DOM APIs, Vitest, CSS custom properties, localStorage.

**Spec:** User request from 2026-08-18: “improve the bottom bar tools. the icons and style (use impeccable skills if can). configable by user, key order, show/hide keys. add more keys, pg-up pg-down home end insert delete special signs (! @ # ...) , f1-f12, ctrl+<common keys z x r f ...>”

## Global Constraints

- Use Node.js 22+ and pnpm.
- Install dependencies with `pnpm install` when needed.
- Run focused tests during tasks; before completion run `pnpm test` and `pnpm build`.
- Treat authentication, cookies, origin validation, proxy trust, PTY access, and WebSocket handling as security-critical. This plan does not touch server security code.
- Never use `@xterm/addon-attach`; all terminal input must continue through `web/input-pipeline.ts`.
- Preserve the mobile interaction contract in `README.md`: explicit `⌨` keyboard toggle, sticky modifiers, touch gestures, responsive keybar pagination, `⋯` expansion, keyboard displacement restore, and arrow hold-repeat.
- Keep `web/keybar.ts` layout constants synchronized with `web/style.css`.
- Do not commit `.env`, credentials, session secrets, password hashes, or other sensitive runtime data.
- Keep changes scoped and do not overwrite unrelated work in a dirty worktree.

---

## File Structure

- Create: `web/key-definitions.ts`
  - Owns the complete key catalog, key IDs, labels, icons, categories, default order, and helper functions for encoding terminal sequences.
- Create: `web/keybar-preferences.ts`
  - Owns localStorage schema, default preferences, validation, migration, and pure order/show-hide helpers.
- Modify: `web/input-pipeline.ts`
  - Add explicit `BarKey` variants only if needed for clarity; otherwise keep new keys as `literal`, `interrupt`, and `backtab`.
- Modify: `web/keybar.ts`
  - Consume computed key layout instead of static `KEYS`; render icons/labels; add a customization panel; preserve existing panel/keyboard/press-repeat behavior.
- Modify: `web/style.css`
  - Add polished bottom bar visuals, icon layout, grouped expanded view, customization mode, and accessible active/locked states.
- Modify: `web/keybar.test.ts`
  - Cover catalog order, preference application, show/hide behavior, repeatable arrows, customization DOM seams, and no duplicate rendered keys.
- Create: `web/key-definitions.test.ts`
  - Cover key sequence definitions for navigation, editing, function keys, symbols, and Ctrl shortcuts.
- Create: `web/keybar-preferences.test.ts`
  - Cover localStorage validation, migration fallback, ordering, hidden keys, unknown key filtering, and reset behavior.
- Modify: `web/input-pipeline.test.ts`
  - Add focused pass-through tests for new key sequences and Ctrl shortcut behavior.
- Modify: `README.md`
  - Document the new tools bar, default keys, customization, reset behavior, and privacy boundary.

---

### Task 1: Extract the key catalog and default layout

**Files:**
- Create: `web/key-definitions.ts`
- Create: `web/key-definitions.test.ts`
- Modify: `web/keybar.ts`
- Modify: `web/keybar.test.ts`

**Interfaces:**
- Consumes: `BarKey`, `ModifierName` from `web/input-pipeline.ts`.
- Produces:
  - `export type KeyCategory = 'core' | 'navigation' | 'editing' | 'symbols' | 'function' | 'ctrl';`
  - `export interface KeySpec { id: string; label: string; shortLabel?: string; icon?: string; title: string; category: KeyCategory; key: BarKey; defaultVisible: boolean; defaultOrder: number; repeatable?: boolean; wide?: boolean; }`
  - `export const KEY_TARGET_PX = 44;`
  - `export const KEY_CATALOG: readonly KeySpec[];`
  - `export const DEFAULT_KEY_IDS: readonly string[];`
  - `export const ALL_KEY_IDS: readonly string[];`
  - `export function getKeySpec(id: string): KeySpec | undefined;`
  - `export function resolveKeySpecs(ids: readonly string[]): KeySpec[];`
  - `export function isRepeatableKey(key: BarKey): boolean;`

- [ ] **Step 1: Write the failing catalog tests**

```ts
// web/key-definitions.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY_IDS,
  KEY_CATALOG,
  ALL_KEY_IDS,
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
      'shift-tab', 'shift', 'alt', 'interrupt', 'pipe', 'tilde', 'slash', 'dash',
    ]);
    expect(ALL_KEY_IDS.slice(0, DEFAULT_KEY_IDS.length)).toEqual(DEFAULT_KEY_IDS);
    expect(ALL_KEY_IDS).toEqual(KEY_CATALOG.map(key => key.id));
    expect(resolveKeySpecs(DEFAULT_KEY_IDS).map(key => key.label)).toEqual([
      'Esc', 'Tab', 'Ctrl', '↑', '↓', '←', '→', 'Shift Tab', 'Shift',
      'Alt', '^C', '|', '~', '/', '-',
    ]);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run web/key-definitions.test.ts web/keybar.test.ts`

Expected: FAIL because `web/key-definitions.ts` does not exist and `KEYS` still lives in `web/keybar.ts`.

- [ ] **Step 3: Create `web/key-definitions.ts` with the existing catalog only**

```ts
import type { BarKey } from './input-pipeline.js';

export type KeyCategory = 'core' | 'navigation' | 'editing' | 'symbols' | 'function' | 'ctrl';

export interface KeySpec {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: string;
  title: string;
  category: KeyCategory;
  key: BarKey;
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

export const KEY_CATALOG: readonly KeySpec[] = [
  { id: 'esc', label: 'Esc', icon: '⎋', title: 'Escape', category: 'core', key: { kind: 'literal', data: '\x1b' }, defaultVisible: true, defaultOrder: 10 },
  { id: 'tab', label: 'Tab', icon: '⇥', title: 'Tab', category: 'core', key: { kind: 'literal', data: '\t' }, defaultVisible: true, defaultOrder: 20 },
  { id: 'ctrl', label: 'Ctrl', title: 'Control modifier', category: 'core', key: { kind: 'modifier', name: 'ctrl' }, defaultVisible: true, defaultOrder: 30 },
  arrow('arrow-up', '↑', 'A', 40),
  arrow('arrow-down', '↓', 'B', 50),
  arrow('arrow-left', '←', 'D', 60),
  arrow('arrow-right', '→', 'C', 70),
  { id: 'shift-tab', label: 'Shift Tab', shortLabel: '⇤ Tab', icon: '⇤', title: 'Shift Tab — send back-tab', category: 'core', key: { kind: 'backtab' }, defaultVisible: true, defaultOrder: 80, wide: true },
  { id: 'shift', label: 'Shift', title: 'Shift modifier', category: 'core', key: { kind: 'modifier', name: 'shift' }, defaultVisible: true, defaultOrder: 90 },
  { id: 'alt', label: 'Alt', title: 'Alt modifier', category: 'core', key: { kind: 'modifier', name: 'alt' }, defaultVisible: true, defaultOrder: 100 },
  { id: 'interrupt', label: '^C', icon: '⏹', title: 'Interrupt — send Ctrl+C', category: 'core', key: { kind: 'interrupt' }, defaultVisible: true, defaultOrder: 110 },
  { id: 'pipe', label: '|', title: 'Pipe', category: 'symbols', key: { kind: 'literal', data: '|' }, defaultVisible: true, defaultOrder: 120 },
  { id: 'tilde', label: '~', title: 'Tilde', category: 'symbols', key: { kind: 'literal', data: '~' }, defaultVisible: true, defaultOrder: 130 },
  { id: 'slash', label: '/', title: 'Slash', category: 'symbols', key: { kind: 'literal', data: '/' }, defaultVisible: true, defaultOrder: 140 },
  { id: 'dash', label: '-', title: 'Dash', category: 'symbols', key: { kind: 'literal', data: '-' }, defaultVisible: true, defaultOrder: 150 },
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

export function isRepeatableKey(key: BarKey): boolean {
  return key.kind === 'literal' && REPEATABLE_CURSOR_SEQUENCES.has(key.data);
}
```

- [ ] **Step 4: Update `web/keybar.ts` to consume the catalog**

Move `ButtonSpec`, `KEY_TARGET_PX`, `KEYS`, and `isRepeatableKey` out of `web/keybar.ts`. Import from `web/key-definitions.ts`:

```ts
import {
  DEFAULT_KEY_IDS,
  KEY_TARGET_PX,
  isRepeatableKey,
  resolveKeySpecs,
  type KeySpec,
} from './key-definitions.js';
```

Temporarily preserve the exported `KEYS` compatibility seam for existing tests:

```ts
export const KEYS = resolveKeySpecs(DEFAULT_KEY_IDS);
```

Change `makeKeyButton` to accept `KeySpec` instead of `ButtonSpec`. Use `spec.wide` instead of checking `spec.key.kind === 'backtab'` for the wide class, but keep the backtab `aria-label`/`title` branch.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run web/key-definitions.test.ts web/keybar.test.ts web/input-pipeline.test.ts`

Expected: PASS.

---

### Task 2: Add the expanded key inventory

**Files:**
- Modify: `web/key-definitions.ts`
- Modify: `web/key-definitions.test.ts`
- Modify: `web/input-pipeline.test.ts`
- Modify: `web/keybar.test.ts`

**Interfaces:**
- Consumes: `KeySpec`, `BarKey`.
- Produces:
  - Navigation keys: `page-up`, `page-down`, `home`, `end`.
  - Editing keys: `insert`, `delete`.
  - Function keys: `f1` through `f12`.
  - Symbol keys: common shell/programming signs including `! @ # $ % ^ & * ( ) _ + = { } [ ] : ; " ' < > ? \\`.
  - Ctrl shortcuts: `ctrl-c`, `ctrl-z`, `ctrl-x`, `ctrl-r`, `ctrl-f`, `ctrl-a`, `ctrl-e`, `ctrl-d`, `ctrl-l`, `ctrl-u`, `ctrl-k`, `ctrl-w`, `ctrl-p`, `ctrl-n`.

- [ ] **Step 1: Extend tests for required IDs and byte sequences**

Add to `web/key-definitions.test.ts`:

```ts
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
```

- [ ] **Step 2: Add pass-through tests to `web/input-pipeline.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run web/key-definitions.test.ts web/input-pipeline.test.ts`

Expected: FAIL for missing new key specs.

- [ ] **Step 4: Implement sequence helpers in `web/key-definitions.ts`**

Add helper functions near the top:

```ts
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
```

Append the required specs after the current defaults. Use these exact sequences:

```ts
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
```

For symbols, use IDs like `symbol-bang`, `symbol-at`, `symbol-hash`. For Ctrl shortcuts, use the requested common set:

```ts
ctrlShortcut('c', 610, 'Ctrl+C — interrupt'),
ctrlShortcut('z', 620, 'Ctrl+Z — suspend'),
ctrlShortcut('x', 630, 'Ctrl+X'),
ctrlShortcut('r', 640, 'Ctrl+R — reverse search'),
ctrlShortcut('f', 650, 'Ctrl+F — forward'),
ctrlShortcut('a', 660, 'Ctrl+A — line start'),
ctrlShortcut('e', 670, 'Ctrl+E — line end'),
ctrlShortcut('d', 680, 'Ctrl+D — EOF/delete'),
ctrlShortcut('l', 690, 'Ctrl+L — clear screen'),
ctrlShortcut('u', 700, 'Ctrl+U — delete before cursor'),
ctrlShortcut('k', 710, 'Ctrl+K — delete after cursor'),
ctrlShortcut('w', 720, 'Ctrl+W — delete word before cursor'),
ctrlShortcut('p', 730, 'Ctrl+P — previous'),
ctrlShortcut('n', 740, 'Ctrl+N — next'),
```

Keep `interrupt` as the default visible `^C` action because it has existing behavior that consumes only armed modifiers and is already documented. The `ctrl-c` catalog item is available for user customization but not visible by default.

- [ ] **Step 5: Keep default quick row unchanged**

Do not add the expanded inventory to `DEFAULT_KEY_IDS`. The first migration must preserve current quick-row behavior exactly for existing users.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run web/key-definitions.test.ts web/input-pipeline.test.ts web/keybar.test.ts`

Expected: PASS.

---

### Task 3: Add validated user preferences for order and show/hide

**Files:**
- Create: `web/keybar-preferences.ts`
- Create: `web/keybar-preferences.test.ts`
- Modify: `web/keybar.ts`
- Modify: `web/keybar.test.ts`

**Interfaces:**
- Consumes: `KEY_CATALOG`, `DEFAULT_KEY_IDS`, `resolveKeySpecs`.
- Produces:
  - `export const KEYBAR_PREFS_STORAGE_KEY = 'browser-terminal:keybar:v1';`
  - `export interface KeybarPreferences { version: 1; order: string[]; hidden: string[]; }`
  - `order` always contains every known key ID in current catalog order unless the user has reordered it; default-hidden keys are represented by `hidden`, not omitted from `order`.
  - `export function defaultKeybarPreferences(): KeybarPreferences;`
  - `export function normalizeKeybarPreferences(value: unknown): KeybarPreferences;`
  - `export function loadKeybarPreferences(storage?: Storage): KeybarPreferences;`
  - `export function saveKeybarPreferences(preferences: KeybarPreferences, storage?: Storage): void;`
  - `export function visibleKeyIds(preferences: KeybarPreferences): string[];`
  - `export function moveKey(preferences: KeybarPreferences, keyId: string, direction: -1 | 1): KeybarPreferences;`
  - `export function setKeyHidden(preferences: KeybarPreferences, keyId: string, hidden: boolean): KeybarPreferences;`
  - `setKeyHidden()` must refuse to hide the final visible key; the terminal must always retain at least one reachable toolbar key plus the fixed controls.
  - `export function resetKeybarPreferences(storage?: Storage): KeybarPreferences;`

- [ ] **Step 1: Write preference tests**

```ts
// web/keybar-preferences.test.ts
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
      'esc', 'tab', 'ctrl', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'shift-tab', 'shift', 'alt', 'interrupt', 'pipe', 'tilde', 'slash', 'dash',
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
    expect(moved.hidden).toEqual(['dash']);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run web/keybar-preferences.test.ts`

Expected: FAIL because `web/keybar-preferences.ts` does not exist.

- [ ] **Step 3: Implement preferences**

```ts
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
  const hidden = new Set(preferences.hidden);
  return preferences.order.filter(id => !hidden.has(id));
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
```

This normalization is load-bearing: default-hidden keys such as `page-up`, `f1`, and `ctrl-z` must still be present in `order` so the customization panel can reveal and move them. Do not model hidden default keys by omitting them from `order`; that makes “show key” impossible without a second source of ordering truth.

- [ ] **Step 4: Wire preferences into `web/keybar.ts` without UI controls yet**

Import:

```ts
import {
  loadKeybarPreferences,
  visibleKeyIds,
  type KeybarPreferences,
} from './keybar-preferences.js';
```

Inside `mountKeybar`, before rendering buttons:

```ts
let preferences: KeybarPreferences = loadKeybarPreferences();
let renderedKeys = resolveKeySpecs(visibleKeyIds(preferences));
```

Replace `strip.append(...KEYS.map(makeKeyButton));` with:

```ts
strip.append(...renderedKeys.map(makeKeyButton));
```

Do not add mutation UI in this task; this task only establishes the pure preference path.

Do not import `saveKeybarPreferences` in this task yet. It is first used by the mutation UI in Task 4; keeping Task 3 read-only avoids dead imports if the project later enables `noUnusedLocals`.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run web/keybar-preferences.test.ts web/key-definitions.test.ts web/keybar.test.ts`

Expected: PASS.

---

### Task 4: Add customization controls for show/hide and key order

**Files:**
- Modify: `web/keybar.ts`
- Modify: `web/keybar.test.ts`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: `KeybarPreferences`, `moveKey`, `setKeyHidden`, `resetKeybarPreferences`, `saveKeybarPreferences`, `KEY_CATALOG`.
- Produces:
  - A settings button in the fixed controls area, label `⚙`.
  - A customization panel rendered inside the expanded keybar.
  - Per-key controls: show/hide checkbox, move left/up, move right/down.
  - Reset button restoring default order and visibility.

- [ ] **Step 1: Add pure render seam tests in `web/keybar.test.ts`**

Add exported helpers in the implementation during Step 3:

```ts
// expected exports from web/keybar.ts
// export function keybarSettingsLabel(customizing: boolean): string
// export function keybarVisibleLabels(preferences: KeybarPreferences): string[]
```

Tests:

```ts
import { defaultKeybarPreferences, setKeyHidden, moveKey } from './keybar-preferences.js';
import { keybarSettingsLabel, keybarVisibleLabels } from './keybar.js';

describe('keybar customization state', () => {
  it('reports visible labels after hide and reorder preferences', () => {
    const hidden = setKeyHidden(defaultKeybarPreferences(), 'tab', true);
    const moved = moveKey(hidden, 'dash', -1);
    expect(keybarVisibleLabels(moved)).not.toContain('Tab');
    expect(keybarVisibleLabels(moved).at(-2)).toBe('-');
  });

  it('labels the settings toggle by panel state', () => {
    expect(keybarSettingsLabel(false)).toBe('Customize terminal keys');
    expect(keybarSettingsLabel(true)).toBe('Close key customization');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run web/keybar.test.ts web/keybar-preferences.test.ts`

Expected: FAIL because helper exports and UI logic are missing.

- [ ] **Step 3: Implement helper exports in `web/keybar.ts`**

```ts
export function keybarVisibleLabels(preferences: KeybarPreferences): string[] {
  return resolveKeySpecs(visibleKeyIds(preferences)).map(key => key.label);
}

export function keybarSettingsLabel(customizing: boolean): string {
  return customizing ? 'Close key customization' : 'Customize terminal keys';
}
```

- [ ] **Step 4: Add settings button and customization panel**

Extend the `web/keybar.ts` imports from `web/keybar-preferences.ts`:

```ts
import {
  loadKeybarPreferences,
  resetKeybarPreferences,
  saveKeybarPreferences,
  setKeyHidden,
  moveKey,
  visibleKeyIds,
  type KeybarPreferences,
} from './keybar-preferences.js';
```

Inside `mountKeybar`:

```ts
let customizing = false;
const settingsButton = makeButton('⚙', () => {
  customizing = !customizing;
  if (customizing && surface.mode === 'collapsed') {
    const viewport = handlers.viewport();
    const startingPanelHeight = viewport.keyboardVisible
      ? parseFloat(getComputedStyle(container).marginBottom) || 0
      : 0;
    surface = beginExpansion(
      surface,
      viewport.keyboardVisible,
      viewport.visualHeight,
      startingPanelHeight,
    );
    updateView();
    handlers.onRequestKeyboardClose();
    handlers.onPanelChange(true);
    if (surface.mode === 'replacing-ime') finishTransitionAfterTimeout();
  }
  render();
});
```

This intentionally mirrors the existing `⋯` expansion path in `web/keybar.ts`. Do not pass `0` unconditionally: when the OS keyboard is already visible, the collapsed keybar margin is part of the measured handoff and dropping it causes a visible vertical jump.

Refactor button rendering into one local `render()` function that:

1. Cancels and clears render-owned repeat binders from the previous render.
2. Clears `modifierButtons`.
3. Clears and rebuilds `strip` with visible key buttons.
4. Appends customization rows after the normal key buttons only when `customizing === true`.
5. Calls `refresh()` after rebuilding.
6. Updates `settingsButton` `aria-label`, `title`, `aria-expanded`, and `.active`.

Use two repeat-cleanup layers:

```ts
const cancelRepeats: Array<() => void> = [];
let cancelRenderedRepeats: Array<() => void> = [];

const cancelAllRepeats = () => {
  for (const cancel of cancelRepeats) cancel();
  for (const cancel of cancelRenderedRepeats) cancel();
};

const clearRenderedKeyControls = () => {
  for (const cancel of cancelRenderedRepeats) cancel();
  cancelRenderedRepeats = [];
  modifierButtons.clear();
};
```

When `makeKeyButton()` binds a repeatable key during a render, push the returned cancel function into `cancelRenderedRepeats`, not the mount-lifetime `cancelRepeats` array. Keep the existing `window.blur` and `document.visibilitychange` listeners, but make them call `cancelAllRepeats()`. This is required because customization rebuilds the same `strip`; otherwise every preference change leaves stale repeat controllers and global cancellation cannot reliably stop them.

Customization row behavior:

```ts
const applyPreferences = (next: KeybarPreferences) => {
  preferences = next;
  saveKeybarPreferences(preferences);
  render();
};
```

For each `KEY_CATALOG` item ordered by current preferences:

- A checkbox labelled `Show <label>` is checked when the key is visible. Its change handler calls `setKeyHidden(preferences, spec.id, !checkbox.checked)`.
- Move previous button calls `moveKey(preferences, spec.id, -1)`.
- Move next button calls `moveKey(preferences, spec.id, 1)`.
- Reset button calls `resetKeybarPreferences()`.

Controls must use `pointerdown preventDefault()` like existing keys so they do not steal focus or open the OS keyboard.

Append controls in this order:

```ts
controls.append(moreButton, settingsButton, keyboardButton);
```

- [ ] **Step 5: Add customization styles**

Add to `web/style.css`:

```css
.keybar-btn-icon {
  display: inline-grid;
  place-items: center;
  font-size: 1.05rem;
}

.keybar-btn-label {
  display: inline-grid;
  place-items: center;
}

.keybar-customize {
  flex: 1 0 100%;
  display: grid;
  grid-template-columns: 1fr;
  gap: .35rem;
  padding: .35rem 0 .1rem;
}

.keybar-customize-title {
  color: #a9a9b8;
  font-size: .75rem;
  letter-spacing: .04em;
  text-transform: uppercase;
  padding: 0 .1rem;
}

.keybar-customize-row {
  display: grid;
  grid-template-columns: minmax(5rem, 1fr) auto auto auto;
  gap: .3rem;
  align-items: center;
  min-height: 2.25rem;
  padding: .25rem;
  border: 1px solid #2b2b35;
  border-radius: .65rem;
  background: #1b1b23;
}

.keybar-customize-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: .82rem ui-monospace, monospace;
}

.keybar-mini-btn {
  min-width: 2.25rem;
  min-height: 2.25rem;
  border-radius: .45rem;
}
```

Keep `KEY_TARGET_PX` synchronized with the 2.75rem key target. Mini buttons may be smaller because they are inside the settings panel; if accessibility testing shows they are hard to use, raise them to 2.75rem before shipping.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run web/keybar.test.ts web/keybar-preferences.test.ts web/key-definitions.test.ts`

Expected: PASS.

---

### Task 5: Polish visual design without weakening mobile ergonomics

**Files:**
- Modify: `web/keybar.ts`
- Modify: `web/style.css`
- Modify: `web/keybar.test.ts`

**Interfaces:**
- Consumes: `KeySpec.icon`, `KeySpec.shortLabel`, `modifierPresentation`.
- Produces:
  - Icon + text rendering for keys where useful.
  - More legible active/locked modifier states.
  - Clearer fixed controls cluster.
  - Category-aware styling in expanded/customization mode.

- [ ] **Step 1: Add render structure test seam**

Export:

```ts
export function keyButtonText(spec: KeySpec): { icon: string | null; label: string } {
  return { icon: spec.icon ?? null, label: spec.shortLabel ?? spec.label };
}
```

Add to `web/keybar.test.ts`:

```ts
import { getKeySpec } from './key-definitions.js';
import { keyButtonText } from './keybar.js';

it('uses compact icon-aware button text when available', () => {
  expect(keyButtonText(getKeySpec('esc')!)).toEqual({ icon: '⎋', label: 'Esc' });
  expect(keyButtonText(getKeySpec('shift-tab')!)).toEqual({ icon: '⇤', label: '⇤ Tab' });
  expect(keyButtonText(getKeySpec('dash')!)).toEqual({ icon: null, label: '-' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run web/keybar.test.ts`

Expected: FAIL because `keyButtonText` is not exported.

- [ ] **Step 3: Render icon and label spans**

In `makeButton`, allow either plain text or prebuilt content:

```ts
const setButtonContent = (button: HTMLButtonElement, spec: KeySpec) => {
  const text = keyButtonText(spec);
  button.replaceChildren();
  if (text.icon) {
    const icon = document.createElement('span');
    icon.className = 'keybar-btn-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = text.icon;
    button.append(icon);
  }
  const label = document.createElement('span');
  label.className = 'keybar-btn-label';
  label.textContent = text.label;
  button.append(label);
};
```

Call `setButtonContent(button, spec)` in `makeKeyButton`. Keep `button.setAttribute('aria-label', spec.title)` and `button.title = spec.title`.

- [ ] **Step 4: Replace flat button styling with stronger tactile styling**

Update `web/style.css` keybar sections:

```css
.keybar {
  flex: none;
  background:
    linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0)),
    #15151c;
  border-top: 1px solid #2e2e3a;
  box-shadow: 0 -12px 32px rgba(0, 0, 0, .28);
}

.keybar-controls {
  display: flex;
  flex: none;
  align-self: flex-start;
  gap: .25rem;
  padding-left: .3rem;
  border-left: 1px solid #343442;
  background: linear-gradient(90deg, rgba(21,21,28,0), #15151c 20%);
  margin-left: auto;
}

.keybar-btn {
  flex: 0 0 2.75rem;
  min-width: 2.75rem;
  max-width: 4.25rem;
  min-height: 2.75rem;
  padding: 0 .15rem;
  display: inline-grid;
  grid-auto-flow: row;
  place-items: center;
  align-content: center;
  gap: .05rem;
  border-radius: .7rem;
  border: 1px solid #343443;
  background:
    linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,0)),
    #22222c;
  color: var(--fg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 1px 1px rgba(0,0,0,.25);
  font-size: .86rem;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  touch-action: manipulation;
}

.keybar-btn:active {
  transform: translateY(1px);
  background: #292938;
}

.keybar-btn.active {
  background:
    linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0)),
    var(--accent);
  color: #04121f;
  border-color: #9cc4ff;
}

.keybar-btn.locked::after {
  content: '';
  position: absolute;
  top: .28rem;
  right: .28rem;
  width: .42rem;
  height: .42rem;
  border-radius: 999px;
  background: #04121f;
  box-shadow: 0 0 0 2px rgba(255,255,255,.35);
}
```

Use the fixed `#9cc4ff` border color instead of `color-mix()`. The keybar is a mobile-critical control surface, so the plan should not depend on a CSS feature that may vary across older mobile browsers when a stable color is sufficient.

- [ ] **Step 5: Run focused tests and a mechanical design detector**

Run: `pnpm vitest run web/keybar.test.ts`

Run: `node /home/wadjakorn/.agents/skills/impeccable/scripts/detect.mjs --json web/keybar.ts web/style.css`

Expected: tests PASS. Detector should have no blocking findings; address concrete findings in one batch if present.

---

### Task 6: Document behavior and complete full verification

**Files:**
- Modify: `README.md`
- Modify if verification finds issues: `web/keybar.ts`, `web/key-definitions.ts`, `web/keybar-preferences.ts`, `web/style.css`

**Interfaces:**
- Consumes: completed implementation from Tasks 1-5.
- Produces: updated operator/contributor documentation and final confidence checks.

- [ ] **Step 1: Update README mobile usage**

Replace the static key list section with:

````md
ค่าเริ่มต้นของ quick row ยังเหมือนเดิม:

```text
Esc  Tab  Ctrl  ↑  ↓  ←  →  Shift Tab  Shift  Alt  ^C  |  ~  /  -
```

กด `⚙` เพื่อปรับ bottom tools ในเครื่องนี้ได้: ซ่อน/แสดงปุ่ม, เลื่อนลำดับปุ่ม, และ reset กลับค่าเริ่มต้น การตั้งค่านี้เก็บใน `localStorage` ของ browser เท่านั้น ไม่ถูกส่งไป server และไม่แชร์ข้าม browser/device

ชุดปุ่มที่เพิ่มเข้ามาสำหรับเปิดใช้เองได้รวมถึง:

- Navigation/editing: `PgUp`, `PgDn`, `Home`, `End`, `Ins`, `Del`
- Function keys: `F1`-`F12`
- Symbols: `!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, `(`, `)`, `_`, `+`, `=`, `{`, `}`, `[`, `]`, `:`, `;`, `"`, `'`, `<`, `>`, `?`, `\`
- Ctrl shortcuts: `^C`, `^Z`, `^X`, `^R`, `^F`, `^A`, `^E`, `^D`, `^L`, `^U`, `^K`, `^W`, `^P`, `^N`

ทุกปุ่มยังผ่าน `input-pipeline.ts` เหมือน input จากคีย์บอร์ดจริง ดังนั้น sticky `Ctrl` / `Shift` / `Alt`, application cursor mode, และกติกา modifier เดิมยังมีผลตามเดิม
````

- [ ] **Step 2: Add reset/privacy note**

In README “สิ่งที่ต้องรู้”, add:

```md
- **การตั้งค่า bottom tools เป็น local UI preference** — เก็บใน `localStorage` key `browser-terminal:keybar:v1`; ล้าง site data หรือกด reset ในแผง `⚙` เพื่อกลับค่าเริ่มต้น
```

- [ ] **Step 3: Run all tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 4: Build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Manual mobile viewport QA**

Run development servers:

```bash
pnpm dev:server
DEV_ORIGINS=http://localhost:5173 pnpm dev:web
```

Verify at widths 320, 360, 412, and 740 px:

- Default quick row order is unchanged.
- `⋯` still wraps overflow keys below the first row without duplicating keys.
- `⌨` remains the only explicit keyboard toggle.
- Opening `⋯` while the OS keyboard is visible still restores that keyboard when folded.
- Arrow hold repeat still starts after 350ms and stops on release/cancel/blur.
- Horizontal swiping the quick row still works, including when the swipe starts on an arrow before hold threshold.
- `⚙` opens customization without focusing the terminal textarea or opening the OS keyboard.
- Hide `Tab`, move `Del` near the front, refresh the browser, and confirm settings persist.
- Reset restores the legacy default row.
- Every quick-row key target remains at least 44px tall.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: only planned files changed. Summarize modified files, tests run, build result, and any manual QA gaps.

---

## Self-Review

- Spec coverage:
  - Icons/style: Task 5.
  - User configurable: Tasks 3-4.
  - Key order: Tasks 3-4.
  - Show/hide keys: Tasks 3-4.
  - More keys: Task 2.
  - PgUp/PgDn/Home/End/Insert/Delete: Task 2.
  - Special signs: Task 2.
  - F1-F12: Task 2.
  - Ctrl common shortcuts: Task 2.
  - Existing mobile contract: Global Constraints and Task 6 QA.
- Placeholder scan: no `TBD`, no unscoped “handle later”, no generic test instruction without concrete command.
- Type consistency:
  - `KeySpec`, `KeybarPreferences`, `visibleKeyIds`, `moveKey`, and `setKeyHidden` signatures are defined before use.
  - `KEY_TARGET_PX` moves from `web/keybar.ts` to `web/key-definitions.ts`; all imports are updated.
  - Default quick row remains unchanged until the user intentionally customizes it.
