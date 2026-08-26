# ทางออกที่ไม่ตัน (เฟส 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กำจัดทุกสถานะในแอปที่ผู้ใช้ต้องพึ่งปุ่ม refresh ของเบราว์เซอร์ และพากลับถึง prompt ที่ใช้ได้เร็วขึ้นหลังเน็ตกระตุก

**Architecture:** แยก logic ของ backoff/wake ออกจาก `web/main.ts` ไปเป็นโมดูลบริสุทธิ์ `web/reconnect.ts` ที่เทสต์ได้โดยไม่ต้องมี DOM (ตามแนวเดียวกับ `web/status.ts` และ `web/viewport.ts`) แล้วเพิ่มทางออกสามทางที่ทุกวันนี้ไม่มี: ปุ่มบนหน้า login, ปุ่มในแถบสถานะตอนโดนเตะ, และ bootstrap ที่ลองใหม่เองเมื่อเน็ตกลับมา ไม่แตะ `server/` เลย

**Tech Stack:** TypeScript, Vite, Vitest, xterm.js, pnpm, Node 22+

**Spec:** `docs/superpowers/specs/2026-08-26-pty-persistence-design.md` (เฉพาะหัวข้อ "เฟส 2")

## Global Constraints

- Node.js 22+ และ pnpm เท่านั้น
- คอมเมนต์และข้อความ UI ทั้งหมดเป็นภาษาไทย ตามแบบที่มีอยู่ในไฟล์ที่แก้
- ห้ามใช้ `@xterm/addon-attach` — input ต้องผ่าน `web/input-pipeline.ts` เท่านั้น
- ห้ามเพิ่ม `@xterm/addon-canvas` หรือ `@xterm/addon-webgl`
- ห้ามแตะ flag ใน `selectionMouseInit()` (`web/text-selection.ts`)
- โมดูล logic ใหม่ต้องเทสต์ได้โดยไม่ต้องมี DOM จริง — รับ dependency ผ่าน parameter แบบเดียวกับ `createStatus` ใน `web/status.ts`
- ปิดงานทุก task ด้วย `pnpm test` ผ่านทั้งหมด และปิด plan ด้วย `pnpm build`
- **ห้ามแตะไฟล์ใน `server/`** — เฟส 1 เป็น follow-up คนละรอบ
- ข้อความบนปุ่มต้องไม่สื่อว่ากู้ shell เดิมได้ เพราะการต่อใหม่ได้ shell ใหม่เสมอในรอบนี้

## File Structure

| ไฟล์ | ความรับผิดชอบ |
|---|---|
| `web/reconnect.ts` *(สร้าง)* | backoff, การตั้ง/ยกเลิก timer, wake — logic ล้วน ไม่รู้จัก WebSocket หรือ DOM |
| `web/reconnect.test.ts` *(สร้าง)* | เทสต์ของข้างบน |
| `web/status.ts` | เพิ่มปุ่ม action ลงในแถบสถานะ (นอกเหนือจากปุ่มปิดที่มีอยู่) |
| `web/status.test.ts` | เทสต์ของ action |
| `web/index.html` | ปุ่ม/ข้อความบนหน้า login |
| `web/style.css` | สไตล์ของปุ่มบนหน้า login และปุ่ม action ในแถบสถานะ |
| `web/main.ts` | เชื่อมทุกอย่างเข้าด้วยกัน: guard socket ซ้อน, wake, กัน session ซ้อน, bootstrap ที่ retry, handler ของปุ่ม |
| `README.md`, `TODO.md` | บันทึกพฤติกรรมใหม่ และเฟส 1 ที่ค้างไว้ |

---

### Task 1: โมดูล backoff/wake ที่เทสต์ได้

`web/main.ts:816-852` ตั้ง `setTimeout(connect, backoffMs)` แล้วปล่อยลอย ไม่มีใครถือ handle ไว้ ยกเลิกไม่ได้ และเบราว์เซอร์มือถือ throttle timer ของแท็บที่ถูกซ่อน งานนี้ดึง logic ออกมาเป็นโมดูลที่คุมได้ก่อน ยังไม่ต่อเข้า `main.ts`

**Files:**
- Create: `web/reconnect.ts`
- Test: `web/reconnect.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces: `createReconnect(deps: ReconnectDeps): Reconnect` โดย
  `ReconnectDeps = { connect: () => void; onWait: (seconds: number) => void; setTimeout?: (fn: () => void, ms: number) => number; clearTimeout?: (id: number) => void }`
  และ `Reconnect = { schedule(): void; wake(): void; reset(): void; cancel(): void }`
  Task 4 เป็นผู้ใช้รายเดียวของ interface นี้

- [ ] **Step 1: เขียนเทสต์ที่ต้องแดง**

สร้าง `web/reconnect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createReconnect } from './reconnect.js';

function setup() {
  const connects: number[] = [];
  const waits: number[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let next = 1;

  const reconnect = createReconnect({
    connect: () => { connects.push(Date.now()); },
    onWait: seconds => { waits.push(seconds); },
    setTimeout: (fn, ms) => { const id = next++; timers.push({ fn, ms, id }); return id; },
    clearTimeout: id => {
      const at = timers.findIndex(timer => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  });

  return {
    reconnect,
    timers,
    waits,
    connectCount: () => connects.length,
    fire: () => { const timer = timers.shift(); timer?.fn(); },
  };
}

describe('createReconnect', () => {
  it('รอบแรกรอ 1 วิ แล้วไต่ขึ้นเป็นเท่าตัว', () => {
    const { reconnect, timers, fire } = setup();

    reconnect.schedule();
    expect(timers[0]!.ms).toBe(1000);
    fire();

    reconnect.schedule();
    expect(timers[0]!.ms).toBe(2000);
    fire();

    reconnect.schedule();
    expect(timers[0]!.ms).toBe(4000);
  });

  it('ไม่ไต่เกิน 8 วิ', () => {
    const { reconnect, timers, fire } = setup();
    for (let i = 0; i < 8; i++) { reconnect.schedule(); fire(); }
    reconnect.schedule();
    expect(timers[0]!.ms).toBe(8000);
  });

  it('บอกจำนวนวินาทีที่ต้องรอ เพื่อให้ผู้เรียกเอาไปแสดงผล', () => {
    const { reconnect, waits, fire } = setup();
    reconnect.schedule();
    fire();
    reconnect.schedule();
    expect(waits).toEqual([1, 2]);
  });

  /*
   * นี่คือเหตุผลหลักที่โมดูลนี้มีอยู่ — timer ของแท็บที่ถูกซ่อนถูก throttle
   * ผู้ใช้ที่สลับกลับมาต้องได้ต่อทันที ไม่ใช่รอเก้อจนครบ 8 วิ
   */
  it('wake ต่อทันทีและทิ้ง timer ที่ค้างอยู่', () => {
    const { reconnect, timers, connectCount } = setup();
    reconnect.schedule();
    expect(timers).toHaveLength(1);

    reconnect.wake();
    expect(connectCount()).toBe(1);
    expect(timers).toHaveLength(0);
  });

  it('wake ตอนไม่มีอะไรค้างอยู่ ไม่ทำอะไรเลย', () => {
    const { reconnect, connectCount } = setup();
    reconnect.wake();
    expect(connectCount()).toBe(0);
  });

  /*
   * `visibilitychange` กับ `online` ยิงพร้อมกันได้ ถ้า wake สองครั้งแปลว่า connect
   * สองครั้ง server จะเตะ socket ตัวแรกด้วย 4000 ซึ่งฝั่ง client ตีความว่า
   * "เปิดที่อื่นแล้ว" แล้วหยุดถาวร — เท่ากับสร้างทางตันอันใหม่จากฟีเจอร์ที่ปิดทางตัน
   */
  it('wake ซ้อนติดกันต่อแค่ครั้งเดียว', () => {
    const { reconnect, connectCount } = setup();
    reconnect.schedule();
    reconnect.wake();
    reconnect.wake();
    expect(connectCount()).toBe(1);
  });

  it('reset ทำให้รอบถัดไปกลับไปเริ่มที่ 1 วิ', () => {
    const { reconnect, timers, fire } = setup();
    reconnect.schedule(); fire();
    reconnect.schedule(); fire();
    reconnect.reset();
    reconnect.schedule();
    expect(timers[0]!.ms).toBe(1000);
  });

  it('cancel ทิ้ง timer โดยไม่ต่อ', () => {
    const { reconnect, timers, connectCount } = setup();
    reconnect.schedule();
    reconnect.cancel();
    expect(timers).toHaveLength(0);
    expect(connectCount()).toBe(0);
  });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

Run: `pnpm test -- reconnect`
Expected: FAIL — `Failed to resolve import "./reconnect.js"`

- [ ] **Step 3: เขียน implementation ให้น้อยที่สุดที่ผ่าน**

สร้าง `web/reconnect.ts`:

```ts
/**
 * จังหวะการต่อใหม่หลังสายหลุด
 *
 * แยกออกมาจาก main.ts ด้วยเหตุผลเดียว: `setTimeout` ที่ปล่อยลอยไว้ยกเลิกไม่ได้
 * และ timer ของแท็บที่ถูกซ่อนถูกเบราว์เซอร์มือถือ throttle จนหยุดสนิท ผู้ใช้ที่
 * สลับแอปกลับมาจึงต้องนั่งรอ timer ที่ควรยิงไปนานแล้ว โมดูลนี้ถือ handle ไว้เอง
 * เพื่อให้ `wake()` ตัดการรอทิ้งได้ทันทีที่หน้ากลับมาเห็นหรือเน็ตกลับมา
 */
const FIRST_MS = 1000;
const MAX_MS = 8000;

export interface ReconnectDeps {
  /** เปิดการเชื่อมต่อใหม่ — ผู้เรียกต้อง guard socket ที่ยังไม่ตายเอง */
  connect: () => void;
  /** แจ้งจำนวนวินาทีที่กำลังจะรอ เพื่อเอาไปขึ้นแถบสถานะ */
  onWait: (seconds: number) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface Reconnect {
  /** ตั้งเวลาต่อใหม่ตาม backoff ปัจจุบัน แล้วขยับ backoff ขึ้น */
  schedule(): void;
  /** ต่อทันทีถ้ากำลังรออยู่ — ไม่มีอะไรค้างก็ไม่ทำอะไร */
  wake(): void;
  /** กลับไปเริ่มนับที่ 1 วิ ใช้เมื่อต่อติดแล้ว */
  reset(): void;
  /** ทิ้งการรอโดยไม่ต่อ */
  cancel(): void;
}

export function createReconnect(deps: ReconnectDeps): Reconnect {
  const schedule_ = deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const cancel_ = deps.clearTimeout ?? (id => window.clearTimeout(id));

  let waitMs = FIRST_MS;
  let timer: number | null = null;

  const clear = (): void => {
    if (timer === null) return;
    cancel_(timer);
    timer = null;
  };

  return {
    schedule() {
      clear();
      const ms = waitMs;
      waitMs = Math.min(waitMs * 2, MAX_MS);
      deps.onWait(Math.round(ms / 1000));
      timer = schedule_(() => { timer = null; deps.connect(); }, ms);
    },

    wake() {
      // `timer === null` ครอบสองกรณีพร้อมกัน: ไม่ได้กำลังรอต่อใหม่อยู่เลย และ
      // wake ตัวที่สองที่ยิงตามมาติดๆ (visibilitychange กับ online มาคู่กันได้)
      if (timer === null) return;
      clear();
      deps.connect();
    },

    reset() {
      waitMs = FIRST_MS;
    },

    cancel() {
      clear();
    },
  };
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `pnpm test -- reconnect`
Expected: PASS ทั้ง 8 เทสต์

- [ ] **Step 5: commit**

```bash
git add web/reconnect.ts web/reconnect.test.ts
git commit -m "feat: โมดูล backoff/wake ที่ยกเลิก timer ได้"
```

---

### Task 2: ปุ่ม action ในแถบสถานะ

`web/main.ts:822-824` รับ code 4000 แล้วตั้ง `stopped = true` ถาวร ข้อความบอกให้ "โหลดหน้านี้ใหม่" แต่ไม่มีปุ่ม — เป็นทางตันแบบเดียวกับหน้า login แต่เกิดในแอป `web/status.ts` วันนี้รองรับแค่ปุ่มปิด งานนี้เพิ่มปุ่ม action เข้าไป โดยยังไม่มีใครเรียกใช้

**Files:**
- Modify: `web/status.ts`
- Modify: `web/style.css`
- Test: `web/status.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces: `StatusOptions` เพิ่มฟิลด์ `action?: { label: string; onClick: () => void }` และ `StatusView` เพิ่มฟิลด์ `action?: { label: string; onClick: () => void }` — Task 4 เป็นผู้ใช้

- [ ] **Step 1: เขียนเทสต์ที่ต้องแดง**

เพิ่มต่อท้าย `describe('createStatus', …)` ใน `web/status.test.ts`:

```ts
describe('ปุ่ม action ในแถบสถานะ', () => {
  it('ส่ง action ต่อไปให้ผู้วาด', () => {
    const { status, last } = setup();
    const onClick = () => {};

    status.show('shell ปิดแล้ว', { action: { label: 'เริ่มใหม่', onClick } });

    expect(last()?.action).toEqual({ label: 'เริ่มใหม่', onClick });
  });

  it('ไม่มี action ก็ไม่มีฟิลด์นี้', () => {
    const { status, last } = setup();
    status.show('กำลังต่อใหม่…');
    expect(last()?.action).toBeUndefined();
  });
});
```

และเพิ่มเทสต์ของ `renderStatus` ต่อท้ายไฟล์ (ไฟล์นี้ยังไม่มีเทสต์ฝั่ง DOM — สร้าง element ด้วย `document` ที่ vitest ให้มา):

```ts
import { renderStatus } from './status.js';

describe('renderStatus', () => {
  it('วาดปุ่ม action แล้วเรียก onClick เมื่อกด', () => {
    const host = document.createElement('div');
    let clicked = 0;

    renderStatus(host, {
      text: 'เปิดที่อื่นแล้ว',
      dismissible: false,
      action: { label: 'เชื่อมต่อใหม่', onClick: () => { clicked++; } },
    }, () => {});

    const button = host.querySelector<HTMLButtonElement>('.status-action');
    expect(button?.textContent).toBe('เชื่อมต่อใหม่');
    button?.click();
    expect(clicked).toBe(1);
  });

  it('ไม่มี action ก็ไม่มีปุ่ม', () => {
    const host = document.createElement('div');
    renderStatus(host, { text: 'กำลังต่อใหม่…', dismissible: false }, () => {});
    expect(host.querySelector('.status-action')).toBeNull();
  });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

Run: `pnpm test -- status`
Expected: FAIL — `last()?.action` เป็น `undefined` และหา `.status-action` ไม่เจอ

ถ้าเจอ error ว่า `document is not defined` แปลว่าไฟล์นี้ยังไม่ได้รันในสภาพแวดล้อม DOM — เพิ่มบรรทัดนี้ไว้บนสุดของ `web/status.test.ts`:

```ts
// @vitest-environment jsdom
```

- [ ] **Step 3: เขียน implementation**

ใน `web/status.ts` เพิ่มฟิลด์เข้า interface ทั้งสอง:

```ts
/** ปุ่มที่พาผู้ใช้ออกจากสถานะปัจจุบัน — ใช้กับสถานะที่ไม่หายไปเอง */
export interface StatusAction {
  label: string;
  onClick: () => void;
}
```

เพิ่ม `action?: StatusAction;` ทั้งใน `StatusOptions` และ `StatusView`

ใน `show()` เปลี่ยนบรรทัด `deps.render({ … })` เป็น:

```ts
    deps.render({
      text,
      title: options.title,
      dismissible: options.dismissible === true,
      ...(options.action ? { action: options.action } : {}),
    });
```

ใน `renderStatus()` แทรกก่อนบล็อก `if (view.dismissible)`:

```ts
  if (view.action) {
    const action = element.ownerDocument.createElement('button');
    action.type = 'button';
    action.className = 'status-action';
    action.textContent = view.action.label;
    action.addEventListener('click', view.action.onClick);
    element.append(action);
  }
```

ใน `web/style.css` เพิ่มต่อจากบล็อก `.status-close:active`:

```css
.status-action {
  flex: none;
  padding: .2rem .6rem; border: 0; border-radius: .25rem;
  background: rgba(255, 215, 154, .18); color: inherit;
  font: inherit; cursor: pointer;
}

.status-action:active { background: rgba(255, 215, 154, .32); }
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `pnpm test -- status`
Expected: PASS ทั้งไฟล์ รวมเทสต์เดิมที่ต้องไม่พัง

- [ ] **Step 5: commit**

```bash
git add web/status.ts web/status.test.ts web/style.css
git commit -m "feat: ปุ่ม action ในแถบสถานะ"
```

---

### Task 3: ปุ่มและข้อความบนหน้า login

หน้า login ทุกวันนี้มีทางออกทางเดียวคือกรอกรหัส ทั้งที่เคสที่ผู้ใช้เจอบ่อยที่สุดคือ cookie ยังใช้ได้แต่ต่อ server ไม่ติดตอนโหลดหน้า งานนี้ใส่ปุ่มกับที่วางข้อความไว้ก่อน โดยยังไม่ต่อ logic

**Files:**
- Modify: `web/index.html`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: ไม่มี
- Produces: element id `login-retry` (`<button>`) และ `login-notice` (`<p>`) — Task 5 เป็นผู้ใช้

- [ ] **Step 1: แก้ `web/index.html`**

แทนที่บล็อก `<form id="login-form">` ทั้งอันด้วย:

```html
    <form id="login-form">
      <h1>Browser Terminal</h1>
      <p id="login-notice" class="notice" hidden></p>
      <input id="password" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" required>
      <button type="submit">เข้าสู่ระบบ</button>
      <button id="login-retry" type="button" class="secondary">ลองเชื่อมต่อใหม่</button>
      <p id="login-error" class="error" hidden></p>
    </form>
```

`type="button"` สำคัญ — ปุ่มใน `<form>` ที่ไม่ระบุ type จะเป็น submit โดยปริยาย แล้วการกดจะไปยิง handler ของการล็อกอินแทน

- [ ] **Step 2: แก้ `web/style.css`**

เพิ่มต่อจากบรรทัด `.login button { … }`:

```css
.login button.secondary {
  background: transparent; color: var(--accent);
  border: 1px solid var(--accent); font-weight: 500;
}

.notice { margin: 0; font-size: .85rem; color: #ffd79a; text-align: center; }
```

- [ ] **Step 3: ดูด้วยตาว่าไม่พัง**

Run: `pnpm dev:server` ในเทอร์มินัลหนึ่ง และ `DEV_ORIGINS=http://localhost:5173 pnpm dev:web` ในอีกเทอร์มินัล
Expected: หน้า login แสดงปุ่ม "ลองเชื่อมต่อใหม่" ใต้ปุ่มเข้าสู่ระบบ กดแล้วยังไม่เกิดอะไร (ยังไม่มี handler) และ**ต้องไม่ submit form**

- [ ] **Step 4: รันเทสต์ทั้งหมดให้แน่ใจว่าไม่กระทบใคร**

Run: `pnpm test`
Expected: PASS ทั้งหมด

- [ ] **Step 5: commit**

```bash
git add web/index.html web/style.css
git commit -m "feat: ปุ่มลองเชื่อมต่อใหม่บนหน้า login"
```

---

### Task 4: guard socket ซ้อน + ใช้ reconnect + ปุ่มตอนโดนเตะ

งานนี้เป็นแกนของทั้ง plan รวมสามอย่างเข้าด้วยกันเพราะแยกไม่ได้: `wake()` จาก Task 1 จะเปิด socket ซ้อนถ้าไม่มี guard และ socket ซ้อนจะทำให้ server เตะด้วย 4000 ซึ่งต้องมีปุ่มจาก Task 2 มารองรับ

**Files:**
- Modify: `web/main.ts:54-58` (ตัวแปร module scope), `web/main.ts:790-852` (`connect`), `web/main.ts:854-879` (`startSession`)

**Interfaces:**
- Consumes: `createReconnect` จาก Task 1, `StatusAction` จาก Task 2
- Produces: `restart(): void` ที่ module scope — ล้าง `stopped` แล้วต่อใหม่ Task 5 เป็นผู้ใช้

- [ ] **Step 1: เพิ่ม import และตัวแปร**

ที่กลุ่ม import บนสุดของ `web/main.ts` เพิ่ม:

```ts
import { createReconnect } from './reconnect.js';
```

แทนที่บรรทัด `let backoffMs = 1000;` (`web/main.ts:56`) ด้วย:

```ts
const reconnect = createReconnect({
  connect: () => { void connect(); },
  onWait: seconds => { showStatus(`กำลังต่อใหม่ใน ${seconds} วิ…`); },
});
```

`connect` กับ `showStatus` ถูกประกาศ*ใต้*บรรทัดนี้ ซึ่งใช้ได้เพราะทั้งคู่ถูกอ้างถึงอยู่ใน callback ที่ไม่ถูกเรียกตอน module ประเมินตัวเอง กว่าจะถึงเวลานั้น `const showStatus` พ้น TDZ ไปแล้ว ถ้า TypeScript บ่นเรื่อง "used before its declaration" ให้ย้ายบล็อก `const reconnect = …` ทั้งอันลงไปไว้ใต้บรรทัด `const showStatus = status.show;` แทน — ตำแหน่งไม่สำคัญขอแค่อยู่ที่ module scope

- [ ] **Step 2: ใส่ guard ใน `connect()`**

แทนที่บรรทัดแรกของ `connect()` (`web/main.ts:791`) จาก:

```ts
  if (stopped || !term || !fitAddon) return;
```

เป็น:

```ts
  if (stopped || !term || !fitAddon) return;

  /*
   * กัน socket ซ้อน — `visibilitychange` กับ `online` ยิงพร้อมกันได้ และ socket
   * ตัวที่สองจะทำให้ server เตะตัวแรกด้วย 4000 (`server/index.ts:304`) ซึ่งฝั่งนี้
   * ตีความว่า "เปิดที่อื่นแล้ว" แล้วตั้ง stopped ถาวร — คือสร้างทางตันอันใหม่
   * ขึ้นมาเองจากฟีเจอร์ที่มีไว้ปิดทางตัน
   */
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
```

- [ ] **Step 3: ใช้ reconnect แทน backoff เดิม และเติมปุ่ม**

ใน `socket.onopen` แทนที่ `backoffMs = 1000;` ด้วย `reconnect.reset();`

ใน `socket.onclose` แทนที่บล็อกของ code 4000 ด้วย:

```ts
    if (ev.code === 4000) {
      stopped = true;
      showStatus('เปิดที่อื่นแล้ว — ใช้ที่นี่แทนได้โดยเริ่ม shell ใหม่', {
        action: { label: 'ใช้ที่นี่', onClick: restart },
      });
      return;
    }
```

แทนที่บล็อกของ code 1000 ด้วย:

```ts
    if (ev.code === 1000) {
      const m = /^exit:(-?\d+)$/.exec(ev.reason);
      const code = m ? m[1] : null;
      let text = 'shell ปิดแล้ว';
      if (code !== null) {
        text = `[process exited: code ${code}]`;
        if (code === '127') {
          text += ' (127 = หาโปรแกรมไม่เจอ เช็ค SHELL_CMD ใน .env)';
        }
      }
      stopped = true;
      showStatus(text, { action: { label: 'เริ่ม shell ใหม่', onClick: restart } });
      return;
    }
```

แทนที่สองบรรทัดท้ายของบล็อก `void (async () => { … })()` จาก:

```ts
      showStatus(`กำลังต่อใหม่ใน ${Math.round(backoffMs / 1000)} วิ…`);
      setTimeout(() => { void connect(); }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 8000);
```

เป็น:

```ts
      reconnect.schedule();
```

- [ ] **Step 4: เพิ่ม `restart()`, กันการสร้าง session ซ้อน, และ wake listener**

เพิ่มฟังก์ชันนี้เหนือ `connect()`:

```ts
/**
 * ออกจากสถานะที่หยุดถาวร — ทุกจุดที่ตั้ง `stopped = true` ต้องมีปุ่มที่เรียกตัวนี้
 *
 * การต่อใหม่ได้ shell ใหม่เสมอ (server spawn PTY ต่อหนึ่งการเชื่อมต่อ) ข้อความบนปุ่ม
 * จึงต้องไม่สัญญาว่ากู้ของเดิมได้
 */
function restart(): void {
  stopped = false;
  reconnect.reset();
  showStatus(null);
  void connect();
}
```

จากนั้นกันการสร้าง session ซ้อน — `startSession()` ทุกวันนี้เรียก `initTerminal()` ใหม่ทุกครั้งโดยไม่ dispose ของเก่า ถ้าผู้ใช้เคยถูกเด้งกลับหน้า login แล้วเข้าใหม่ จะได้ Terminal สองตัวซ้อนกันใน `#terminal`, keybar ซ้อน, viewport listener สองชุดแย่งกันเขียน `--visible-height` และ (หลัง step นี้) wake listener สองชุดที่ยิง `connect()` พร้อมกัน

แทรกเป็นบรรทัดแรกของ `startSession()` เหนือ `stopped = false;`:

```ts
  /*
   * เข้ามารอบสอง (ถูกเด้งไป login แล้วกลับเข้ามา) ต้องไม่สร้าง Terminal ตัวใหม่ทับ
   * ของเดิม — ไม่มี teardown ให้เรียก ของเก่าจึงค้างอยู่ในหน้าและใน DOM ตลอดไป
   * เมื่อมี Terminal อยู่แล้วก็แค่สลับหน้ากลับมาแล้วต่อใหม่พอ
   */
  if (term) {
    stopped = false;
    loginPage.hidden = true;
    appPage.hidden = false;
    reconnect.reset();
    await connect();
    return;
  }
```

ใน `startSession()` เพิ่มต่อจากบรรทัด `window.addEventListener('orientationchange', created.keybar.onOrientationChange);`:

```ts
  // timer ของแท็บที่ถูกซ่อนถูก throttle จนหยุด — ถ้าไม่ปลุกตรงนี้ ผู้ใช้ที่สลับแอป
  // กลับมาจะนั่งมองจอนิ่งรอ timer ที่ควรยิงไปนานแล้ว ซึ่งแยกไม่ออกจากอาการค้าง
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnect.wake();
  });
  window.addEventListener('online', () => { reconnect.wake(); });
```

- [ ] **Step 5: ตรวจ type และรันเทสต์**

Run: `pnpm build && pnpm test`
Expected: build ผ่านโดยไม่มี type error (ถ้ามี error ว่า `backoffMs` ไม่ถูกใช้ แปลว่ายังลบไม่หมด) และเทสต์ผ่านทั้งหมด

- [ ] **Step 6: ทดสอบด้วยมือ**

Run: `pnpm dev:server` + `DEV_ORIGINS=http://localhost:5173 pnpm dev:web` แล้วเปิดสองแท็บ
Expected: แท็บแรกขึ้น "เปิดที่อื่นแล้ว…" พร้อมปุ่ม "ใช้ที่นี่" กดแล้วได้ prompt ใหม่ในแท็บแรก และแท็บที่สองขึ้นข้อความเดียวกันแทน

จากนั้นพิมพ์ `exit` ในเทอร์มินัล
Expected: ขึ้น `[process exited: code 0]` พร้อมปุ่ม "เริ่ม shell ใหม่" กดแล้วได้ prompt ใหม่

ทดสอบการกันสร้างซ้อน: ล็อกอิน → หยุด `pnpm dev:server` → รอจนถูกเด้งกลับหน้า login → เปิด server กลับมา → ล็อกอินใหม่
Expected: มี Terminal เดียวในหน้า ไม่ใช่สองตัวซ้อนกัน (ตรวจใน DevTools ว่า `#terminal` มีลูกชุดเดียว)

- [ ] **Step 7: commit**

```bash
git add web/main.ts
git commit -m "fix: ปิดทางตันตอนโดนเตะ/shell ปิด และกัน socket ซ้อนตอน wake"
```

---

### Task 5: bootstrap ที่ลองใหม่เองและปุ่มบนหน้า login

`web/main.ts:911-915` เป็นต้นตอของอาการ "ค้างหน้า login แล้ว refresh เองก็เข้าได้เลย": `'unreachable'` (เน็ตยังไม่กลับตอนโหลดหน้า) ไม่มี retry ไม่มีปุ่ม จบที่หน้า login ถาวร

**Files:**
- Modify: `web/main.ts:881-915` (handler ของ form และ bootstrap)

**Interfaces:**
- Consumes: `checkSession()` และ `startSession()` ที่มีอยู่แล้วใน `web/main.ts`, element `login-retry` และ `login-notice` จาก Task 3
- Produces: ไม่มี — งานสุดท้ายของ plan

- [ ] **Step 1: เพิ่ม element reference**

ต่อจากบรรทัด `const errorEl = $('login-error');` (`web/main.ts:37`) เพิ่ม:

```ts
const noticeEl = $('login-notice');
const retryEl = $<HTMLButtonElement>('login-retry');
```

- [ ] **Step 2: แทนที่ bootstrap ท้ายไฟล์**

แทนที่บล็อก `void (async () => { … })();` ทั้งอัน (`web/main.ts:909-915`) ด้วย:

```ts
/**
 * พยายามเข้า session ด้วย cookie ที่มีอยู่
 *
 * แยก `'unreachable'` ออกจาก `'expired'` เป็นเรื่องคอขาดบาดตายของแอปนี้: เน็ตมือถือ
 * ที่ยังไม่กลับมาตอนโหลดหน้าไม่ได้แปลว่า cookie หมดอายุ ก่อนหน้านี้ทั้งสองกรณีจบที่
 * หน้า login เหมือนกันโดยไม่มีทางออก ผู้ใช้จึงต้องไปหาปุ่ม refresh ของเบราว์เซอร์เอง
 * ทั้งที่กด refresh แล้วเข้าได้ทันทีโดยไม่ต้องกรอกอะไร
 */
async function tryResume(): Promise<void> {
  retryEl.disabled = true;
  noticeEl.hidden = true;
  try {
    const state = await checkSession();
    if (state === 'valid') { await startSession(); return; }
    if (state === 'unreachable') {
      noticeEl.textContent = 'ต่อ server ไม่ได้ — จะลองใหม่ให้เองเมื่อเน็ตกลับมา';
      noticeEl.hidden = false;
      return;
    }
    // 'expired' — ต้องกรอกรหัสจริงๆ พาโฟกัสไปที่ช่องรหัสให้เลย
    $<HTMLInputElement>('password').focus();
  } finally {
    retryEl.disabled = false;
  }
}

retryEl.addEventListener('click', () => { void tryResume(); });

// ลองใหม่เองเมื่อหน้ากลับมาเห็นหรือเน็ตกลับมา — เฉพาะตอนยังติดอยู่ที่หน้า login
// ถ้าเข้า session ไปแล้ว `reconnect.wake()` ใน startSession เป็นคนดูแลแทน
const resumeIfStranded = (): void => { if (!loginPage.hidden) void tryResume(); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeIfStranded();
});
window.addEventListener('online', resumeIfStranded);

void tryResume();
```

- [ ] **Step 3: ซ่อน notice ตอนล็อกอินสำเร็จ**

ใน handler ของ `login-form` แทนที่บรรทัด `errorEl.hidden = true;` ด้วย:

```ts
  errorEl.hidden = true;
  noticeEl.hidden = true;
```

- [ ] **Step 4: ตรวจ type และรันเทสต์**

Run: `pnpm build && pnpm test`
Expected: PASS ทั้งหมด

- [ ] **Step 5: ทดสอบเคสจริงด้วยมือ**

1. ล็อกอินให้สำเร็จหนึ่งครั้ง (ได้ cookie มา)
2. หยุด `pnpm dev:server`
3. โหลดหน้าเว็บใหม่ → Expected: เห็นหน้า login พร้อมข้อความ "ต่อ server ไม่ได้ — จะลองใหม่ให้เองเมื่อเน็ตกลับมา" **ไม่ใช่หน้า login เปล่าๆ แบบเดิม**
4. เปิด `pnpm dev:server` กลับมา แล้วกด "ลองเชื่อมต่อใหม่" → Expected: เข้า terminal ทันทีโดยไม่ต้องกรอกรหัส
5. ทำซ้ำข้อ 2-3 แล้วแทนที่จะกดปุ่ม ให้สลับไปแท็บอื่นแล้วสลับกลับมา → Expected: เข้า terminal ให้เองโดยไม่ต้องกดอะไร

- [ ] **Step 6: อัปเดตเอกสาร**

ใน `README.md` หาหัวข้อที่อธิบายพฤติกรรมการเชื่อมต่อ แล้วเพิ่มย่อหน้า:

```markdown
เมื่อการเชื่อมต่อขาด หน้าเว็บจะต่อใหม่เองโดยไต่ระยะรอจาก 1 วินาทีถึง 8 วินาที และจะ
ตัดการรอทิ้งเพื่อต่อทันทีเมื่อแท็บกลับมาแสดงผลหรือเมื่อเบราว์เซอร์แจ้งว่าเน็ตกลับมา
ทุกสถานะที่หยุดถาวร (ถูกเปิดที่อื่นแทน, shell ปิดตัว) มีปุ่มในแถบสถานะให้เริ่มใหม่ และ
หน้า login มีปุ่ม "ลองเชื่อมต่อใหม่" สำหรับกรณีที่ cookie ยังใช้ได้แต่ต่อ server ไม่ติด

**การต่อใหม่ทุกครั้งได้ shell ใหม่เสมอ** — งานที่รันค้างไว้ไม่รอดข้ามการเชื่อมต่อที่ขาด
เพราะ server ผูก PTY ไว้กับ WebSocket ตัวนั้น ดู `TODO.md` สำหรับงานที่จะแก้ข้อนี้
```

ใน `TODO.md` เพิ่ม:

```markdown
- **PTY อยู่รอดข้ามการ disconnect** — วันนี้ `server/pty.ts` ผูก `term.kill('SIGHUP')`
  ไว้กับ `ws.on('close')` ทำให้เน็ตกระตุกหนึ่งครั้งเท่ากับฆ่า shell อาการที่ผู้ใช้เห็นคือ
  สลับแท็บกลับมาแล้วเจอจอว่าง design เต็มอยู่ใน
  `docs/superpowers/specs/2026-08-26-pty-persistence-design.md` หัวข้อ "เฟส 1"
```

- [ ] **Step 7: commit**

```bash
git add web/main.ts README.md TODO.md
git commit -m "fix: หน้า login ไม่ตันอีกต่อไปเมื่อต่อ server ไม่ติดตอนโหลดหน้า"
```

---

## ปิดงาน

- [ ] `pnpm test` ผ่านทั้งหมด
- [ ] `pnpm build` ผ่าน
- [ ] ทดสอบด้วยมือบนมือถือจริงผ่าน Tailscale: สลับแอปออกไปสักครู่แล้วกลับมา ต้องต่อใหม่ทันทีไม่ต้องรอ
- [ ] ยืนยันว่าไม่มีไฟล์ใน `server/` ถูกแก้: `git diff --stat origin/main -- server/` ต้องว่าง
- [ ] ยืนยันว่า `#terminal` มีลูกชุดเดียวหลังผ่านวงจร login → หลุด → login ใหม่
