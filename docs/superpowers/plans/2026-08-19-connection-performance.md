# Connection Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลดความหน่วงตอนพิมพ์และอาการ output ไหลสะดุด บนมือถือ cellular ผ่าน Tailscale ด้วย coalescing แบบ immediate-first, permessage-deflate ที่มี threshold, และ backpressure ที่ผูกกับ `ws.bufferedAmount`

**Architecture:** แยกตรรกะขาออกทั้งหมดออกจาก `server/pty.ts` ไปเป็นโมดูลใหม่ `server/outbound.ts` ที่รับ sink (ws) และ source (pty) ผ่าน interface แคบๆ ทำให้เทสด้วย fake ได้เต็มที่โดยไม่ต้อง spawn shell จริง `attachPty` เหลือหน้าที่แค่ต่อสาย ส่วน `server/index.ts` เปิด compression ที่ระดับ `WebSocketServer`

**Tech Stack:** Node.js 22+, TypeScript (ESM, `.js` ใน import specifier), `ws`, `node-pty`, Vitest (ใช้ `vi.useFakeTimers()`), pnpm

**Spec:** `docs/superpowers/specs/2026-08-19-connection-performance-design.md`

## Global Constraints

- Node.js 22+ และ pnpm เท่านั้น
- โค้ดเป็น ESM: import ภายในโปรเจกต์ต้องลงท้าย `.js` เสมอ (เช่น `./outbound.js`) แม้ไฟล์จริงเป็น `.ts`
- คอมเมนต์ในโค้ดและข้อความ commit เป็นภาษาไทย ตามแบบที่ใช้อยู่ทั้ง repo — คอมเมนต์อธิบาย **เหตุผล** ไม่ใช่อธิบายว่าโค้ดทำอะไร
- ค่าคงที่ที่ตกลงไว้: cooldown window `5 ms`, deflate threshold `1024` bytes, `HIGH_WATER = 256 * 1024`, `LOW_WATER = 64 * 1024`, drain poll `50 ms`
- ห้ามใช้ `@xterm/addon-attach`, `@xterm/addon-canvas`, `@xterm/addon-webgl` (ข้อห้ามเดิมของ repo)
- ทุก task จบด้วย `pnpm test` ผ่านทั้งชุด ก่อน commit
- ก่อนแก้โค้ดบรรทัดแรก: `git fetch origin` แล้วสร้าง worktree ใหม่จาก `origin/main`
  (`git worktree add ../browser-console-conn-perf -b conn-perf origin/main`) แล้วรายงาน path ให้ผู้ใช้
- งานนี้ **ไม่แตะ** first-load performance (gzip/cache ของ static) และ **ไม่ทำ** predictive echo — อยู่นอกขอบเขตตาม spec

---

### Task 1: โมดูล outbound — coalescing แบบ immediate-first

หัวใจของงานนี้ chunk แรกหลังจอเงียบต้องออกทันทีแบบไม่หน่วงเลย (นั่นคือ echo ของการพิมพ์) chunk ที่ตามมาถี่ๆ ใน burst ถึงจะถูกยุบรวม

**Files:**
- Create: `server/outbound.ts`
- Test: `server/outbound.test.ts`

**Interfaces:**
- Consumes: ไม่มี (task แรก)
- Produces:
  - `interface OutboundSink { send(data: Buffer): void; bufferedAmount(): number }`
  - `interface OutboundSource { pause(): void; resume(): void }`
  - `interface OutboundOptions { windowMs?: number; highWater?: number; lowWater?: number; drainPollMs?: number }`
  - `function createOutbound(sink: OutboundSink, source: OutboundSource, opts?: OutboundOptions): { push(data: Buffer): void; dispose(): void }`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

สร้าง `server/outbound.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutbound, type OutboundSink, type OutboundSource } from './outbound.js';

function fakes() {
  const sent: string[] = [];
  let buffered = 0;
  const calls: string[] = [];
  const sink: OutboundSink = {
    send: data => { sent.push(data.toString('utf8')); },
    bufferedAmount: () => buffered,
  };
  const source: OutboundSource = {
    pause: () => { calls.push('pause'); },
    resume: () => { calls.push('resume'); },
  };
  return {
    sink, source, sent, calls,
    setBuffered: (n: number) => { buffered = n; },
  };
}

const buf = (s: string) => Buffer.from(s, 'utf8');

describe('createOutbound — coalescing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('chunk แรกหลังเงียบ ออกทันทีโดยไม่ต้องรอ timer', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    expect(f.sent).toEqual(['a']);   // ยังไม่ได้ advance timer เลย
    out.dispose();
  });

  it('chunk ที่ตามมาในหน้าต่างเดียวกัน ถูกรวมเป็น frame เดียว เรียงตามลำดับ', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    out.push(buf('b'));
    out.push(buf('c'));
    expect(f.sent).toEqual(['a']);   // b กับ c ยังสะสมอยู่
    vi.advanceTimersByTime(5);
    expect(f.sent).toEqual(['a', 'bc']);
    out.dispose();
  });

  it('burst ยาวถูกยุบเป็นหนึ่ง frame ต่อหนึ่งหน้าต่าง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('1'));              // ออกทันที
    out.push(buf('2'));
    vi.advanceTimersByTime(5);       // flush '2' แล้วต่อหน้าต่างใหม่
    out.push(buf('3'));
    vi.advanceTimersByTime(5);
    expect(f.sent).toEqual(['1', '2', '3']);
    out.dispose();
  });

  it('พิมพ์ทีละตัวห่างเกินหน้าต่าง ไม่ถูกหน่วงเลยสักตัว', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('x'));
    expect(f.sent).toEqual(['x']);
    vi.advanceTimersByTime(100);     // หน้าต่างปิดไปแล้วเพราะไม่มีของสะสม
    out.push(buf('y'));
    expect(f.sent).toEqual(['x', 'y']);
    out.dispose();
  });

  it('รวม buffer แบบไบต์ ไม่ทำ UTF-8 หลายไบต์พัง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    const thai = buf('ก');           // 3 ไบต์
    out.push(buf('a'));              // กินหน้าต่างแรกไป
    out.push(thai.subarray(0, 1));
    out.push(thai.subarray(1));
    vi.advanceTimersByTime(5);
    expect(f.sent).toEqual(['a', 'ก']);
    out.dispose();
  });

  it('dispose แล้ว push ต่อไม่ส่งอะไรอีก และไม่มี timer ค้าง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    out.push(buf('b'));
    out.dispose();
    out.push(buf('c'));
    vi.advanceTimersByTime(1000);
    expect(f.sent).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

รัน: `pnpm vitest run server/outbound.test.ts`
คาดว่า: ล้มด้วย "Failed to resolve import './outbound.js'"

- [ ] **Step 3: เขียน implementation ขั้นต่ำ**

สร้าง `server/outbound.ts` (ส่วน backpressure ยังไม่ทำ — Task 2 จะเติม):

```ts
/** หน้าต่างรวม chunk — เล็กพอที่ RTT บนมือถือกลบมิด ใหญ่พอจะยุบ burst ได้ */
const WINDOW_MS = 5;

export interface OutboundSink {
  send(data: Buffer): void;
  bufferedAmount(): number;
}

export interface OutboundSource {
  pause(): void;
  resume(): void;
}

export interface OutboundOptions {
  windowMs?: number;
  highWater?: number;
  lowWater?: number;
  drainPollMs?: number;
}

/**
 * ท่อขาออกจาก PTY ไป WebSocket
 *
 * รวม chunk แบบ **immediate-first**: chunk แรกหลังจอเงียบส่งทันที เพราะนั่นคือ
 * echo ของตัวอักษรที่ผู้ใช้เพิ่งพิมพ์ — หน่วงมันแม้ 5 ms ก็สวนทางกับเป้าหมาย
 * ทั้งหมดของงานนี้ ส่วน chunk ที่ตามมาถี่ๆ (burst จาก cat/build log) ถึงจะถูก
 * สะสมแล้วส่งรวดเดียวเมื่อหมดหน้าต่าง
 */
export function createOutbound(
  sink: OutboundSink,
  source: OutboundSource,
  opts: OutboundOptions = {},
): { push(data: Buffer): void; dispose(): void } {
  const windowMs = opts.windowMs ?? WINDOW_MS;

  let pending: Buffer[] = [];
  let window: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  /** คืน true ถ้ามีของให้ส่งจริง — ใช้ตัดสินว่ายังอยู่ใน burst อยู่ไหม */
  const flush = (): boolean => {
    if (pending.length === 0) return false;
    const data = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
    pending = [];
    sink.send(data);
    return true;
  };

  const openWindow = (): void => {
    window = setTimeout(() => {
      window = null;
      // ยังมีของสะสม = ยังอยู่ใน burst ต่อหน้าต่างใหม่
      // ไม่มีของ = จอเงียบแล้ว ปล่อยให้ push ครั้งหน้าส่งทันที
      if (flush()) openWindow();
    }, windowMs);
  };

  return {
    push(data: Buffer): void {
      if (disposed) return;
      pending.push(data);
      if (window) return;
      flush();
      openWindow();
    },
    dispose(): void {
      disposed = true;
      if (window) { clearTimeout(window); window = null; }
      pending = [];
    },
  };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

รัน: `pnpm vitest run server/outbound.test.ts`
คาดว่า: ผ่านทั้ง 6 เทส

- [ ] **Step 5: รันทั้งชุดและ commit**

```bash
pnpm test
git add server/outbound.ts server/outbound.test.ts
git commit -m "รวม chunk ขาออกแบบ immediate-first เพื่อไม่หน่วง echo ตัวแรก"
```

---

### Task 2: Backpressure ผูกกับ ws.bufferedAmount

ตัวนี้คือส่วนที่แก้อาการเจ็บที่สุด: ตอน `cat` ไฟล์ใหญ่ ข้อมูลหลายร้อย KB เข้าคิวรออยู่หน้า ตัวอักษรที่พิมพ์ต่อจากนั้นต้องต่อแถวอยู่หลังทั้งหมด การจำกัดคิวไม่ให้ยาวเกินเพดานคือสิ่งที่ทำให้ echo กลับมาอยู่ในระดับ RTT

**Files:**
- Modify: `server/outbound.ts` (เพิ่มเข้าไปใน `createOutbound` ที่สร้างใน Task 1)
- Test: `server/outbound.test.ts` (เพิ่ม describe block ใหม่ต่อท้าย)

**Interfaces:**
- Consumes: `createOutbound`, `OutboundSink`, `OutboundSource`, `OutboundOptions` จาก Task 1 (ลายเซ็นไม่เปลี่ยน — `opts.highWater` / `opts.lowWater` / `opts.drainPollMs` ที่ประกาศไว้แล้วเริ่มมีผลใน task นี้)
- Produces: ไม่มี export ใหม่ พฤติกรรมเพิ่ม: `source.pause()` เมื่อ `sink.bufferedAmount()` เกิน `highWater` และ `source.resume()` เมื่อลงต่ำกว่า `lowWater`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

เติมต่อท้าย `server/outbound.test.ts`:

```ts
describe('createOutbound — backpressure', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const opts = { highWater: 1000, lowWater: 200, drainPollMs: 50 };

  it('คิวทะลุเพดาน → สั่ง pause ต้นทาง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    f.setBuffered(1001);
    out.push(buf('a'));
    expect(f.calls).toEqual(['pause']);
    out.dispose();
  });

  it('คิวยังไม่ถึงเพดาน → ไม่ยุ่งกับต้นทาง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    f.setBuffered(999);
    out.push(buf('a'));
    expect(f.calls).toEqual([]);
    out.dispose();
  });

  it('ระบายลงต่ำกว่า lowWater → resume', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    f.setBuffered(1001);
    out.push(buf('a'));
    expect(f.calls).toEqual(['pause']);

    f.setBuffered(500);              // ยังอยู่ระหว่าง low กับ high
    vi.advanceTimersByTime(50);
    expect(f.calls).toEqual(['pause']);

    f.setBuffered(199);
    vi.advanceTimersByTime(50);
    expect(f.calls).toEqual(['pause', 'resume']);
    expect(vi.getTimerCount()).toBe(0);   // drain interval ต้องถูกเคลียร์
    out.dispose();
  });

  it('ระหว่าง pause ไม่สั่ง pause ซ้ำ', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    f.setBuffered(1001);
    out.push(buf('a'));
    out.push(buf('b'));
    vi.advanceTimersByTime(5);
    vi.advanceTimersByTime(5);
    expect(f.calls).toEqual(['pause']);
    out.dispose();
  });

  it('dispose ระหว่าง pause → ไม่มี timer ค้าง และไม่สั่ง resume ทีหลัง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    f.setBuffered(1001);
    out.push(buf('a'));
    out.dispose();
    f.setBuffered(0);
    vi.advanceTimersByTime(1000);
    expect(f.calls).toEqual(['pause']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

รัน: `pnpm vitest run server/outbound.test.ts -t backpressure`
คาดว่า: ล้ม — `f.calls` เป็น `[]` เพราะยังไม่มีใครเรียก `pause()`

- [ ] **Step 3: เติม implementation**

ใน `server/outbound.ts` เพิ่มค่าคงที่ต่อจาก `WINDOW_MS`:

```ts
/** ~1 วินาทีของข้อมูลบน cellular ทั่วไป — เกินนี้คือ echo เริ่มติดอยู่หลังคิว */
const HIGH_WATER = 256 * 1024;
/** hysteresis กัน pause/resume กระพริบถี่ๆ */
const LOW_WATER = 64 * 1024;
const DRAIN_POLL_MS = 50;
```

ใน `createOutbound` เพิ่มการอ่าน options ต่อจาก `windowMs`:

```ts
  const highWater = opts.highWater ?? HIGH_WATER;
  const lowWater = opts.lowWater ?? LOW_WATER;
  const drainPollMs = opts.drainPollMs ?? DRAIN_POLL_MS;
```

เพิ่ม state ต่อจาก `let disposed = false;`:

```ts
  let drain: ReturnType<typeof setInterval> | null = null;
  let paused = false;
```

เพิ่มฟังก์ชันก่อน `flush`:

```ts
  /**
   * `ws.send()` เข้าคิวได้ไม่จำกัด — ปล่อยไว้แล้วคำสั่งที่พ่น output เยอะจะดอง
   * ตัวอักษรที่ผู้ใช้พิมพ์ตามหลังไว้เป็นวินาที (head-of-line blocking)
   *
   * `term.pause()` หยุดอ่านจาก PTY จริง ทำให้โปรแกรมต้นทาง block ที่ pipe buffer
   * ของ OS — พฤติกรรมเดียวกับเทอร์มินัลจริงที่เลื่อนจอตามไม่ทัน
   */
  const applyBackpressure = (): void => {
    if (paused || disposed || sink.bufferedAmount() <= highWater) return;
    paused = true;
    source.pause();
    drain = setInterval(() => {
      if (sink.bufferedAmount() >= lowWater) return;
      clearInterval(drain!);
      drain = null;
      paused = false;
      source.resume();
    }, drainPollMs);
  };
```

เรียกใน `flush` ต่อจาก `sink.send(data);`:

```ts
    sink.send(data);
    applyBackpressure();
    return true;
```

และใน `dispose` เพิ่มก่อน `pending = [];`:

```ts
      if (drain) { clearInterval(drain); drain = null; }
```

- [ ] **Step 4: รันเทสให้ผ่าน**

รัน: `pnpm vitest run server/outbound.test.ts`
คาดว่า: ผ่านทั้ง 11 เทส (6 จาก Task 1 + 5 ใหม่)

- [ ] **Step 5: รันทั้งชุดและ commit**

```bash
pnpm test
git add server/outbound.ts server/outbound.test.ts
git commit -m "หยุดอ่าน PTY เมื่อคิว ws ยาวเกิน ไม่ให้ output ดองการพิมพ์"
```

---

### Task 3: ต่อ outbound เข้ากับ attachPty

**Files:**
- Modify: `server/pty.ts` (บรรทัด 42-46 — บล็อก `term.onData` และ `dispose`)
- Test: `server/pty.test.ts` (เพิ่มเทสต่อท้าย)

**Interfaces:**
- Consumes: `createOutbound` จาก Task 1-2
- Produces: `attachPty(ws, opts)` ลายเซ็นเดิมไม่เปลี่ยน (`{ pid: number }`) — ผู้เรียกใน `server/index.ts` ไม่ต้องแก้

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

เติมต่อท้าย `server/pty.test.ts` ไฟล์นี้มี helper `pair()`, `alive()`, `until()` อยู่แล้วด้านบน และมีเทสรูปแบบ `client.send(Buffer.from('echo marker-hi\n'))` อยู่ก่อนหน้า — ใช้รูปแบบเดียวกัน

เทสที่มีอยู่แล้วครอบคลุม round-trip ปกติ (`echo marker-hi`) สิ่งที่ยังไม่มีคือการพิสูจน์ว่า
**burst ใหญ่ผ่านการรวม frame แล้วยังครบและเรียงถูก** ซึ่งเป็นความเสี่ยงที่ Task 1-2 สร้างขึ้น:

```ts
describe('attachPty — burst ผ่านท่อ outbound', () => {
  it('output ก้อนใหญ่มาถึงครบและเรียงถูกแม้ถูกรวม frame', async () => {
    const { server, client, close } = await pair();
    let received = '';
    client.on('message', raw => { received += raw.toString('utf8'); });

    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('seq 1 2000\n'));

    const ok = await until(() => received.includes('\n2000'), 10_000);
    expect(ok).toBe(true);

    // ครบทุกบรรทัด ไม่หายและไม่สลับ
    const numbers = received.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^\d+$/.test(line))
      .map(Number);
    const start = numbers.indexOf(1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(numbers.slice(start, start + 2000)).toEqual(
      Array.from({ length: 2000 }, (_, i) => i + 1),
    );

    client.close();
    await close();
  });
});
```

- [ ] **Step 2: รันเทสเพื่อยืนยัน baseline**

รัน: `pnpm vitest run server/pty.test.ts`
คาดว่า: **ผ่าน** — เทสนี้เป็น regression guard ไม่ใช่เทสที่ขับ implementation ใหม่
(พฤติกรรมที่ต้องคงไว้คือ "ข้อมูลครบและเรียงถูก" ซึ่งโค้ดเดิมทำได้อยู่แล้ว) ต้องเห็นว่าผ่าน
**ก่อน** แก้ `pty.ts` เพื่อให้รู้ว่าถ้ามันล้มหลังแก้ คือ outbound ทำพัง ไม่ใช่เทสเขียนผิด

- [ ] **Step 3: แก้ pty.ts ให้ใช้ outbound**

เพิ่ม import ที่หัวไฟล์ ต่อจาก `import type { WebSocket } from 'ws';`:

```ts
import { createOutbound } from './outbound.js';
```

แทนที่บล็อก `term.onData(...)` เดิม:

```ts
  term.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'));
  });
```

ด้วย:

```ts
  const outbound = createOutbound(
    {
      send: data => { if (ws.readyState === ws.OPEN) ws.send(data); },
      bufferedAmount: () => ws.bufferedAmount,
    },
    { pause: () => term.pause(), resume: () => term.resume() },
  );

  term.onData(data => outbound.push(Buffer.from(data, 'utf8')));
```

และใน `dispose` เพิ่ม `outbound.dispose();` เป็นบรรทัดแรกหลัง `disposed = true;`:

```ts
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    outbound.dispose();
    try { term.kill('SIGHUP'); } catch { /* ตายไปแล้ว */ }
  };
```

ข้อควรระวังเรื่องลำดับ: `dispose` ถูกประกาศก่อน `outbound` ในไฟล์เดิม ต้องย้ายบล็อก `createOutbound` ขึ้นไปอยู่**ก่อน** `const dispose = ...` ไม่งั้นจะอ้าง `outbound` ก่อนถูก initialize (TDZ) แล้วพังตอน runtime

- [ ] **Step 4: รันเทสให้ยังผ่าน**

รัน: `pnpm vitest run server/pty.test.ts`
คาดว่า: ผ่านทั้งไฟล์ รวมเทสเดิมเรื่อง resize และการฆ่า process

- [ ] **Step 5: รันทั้งชุด, build, commit**

```bash
pnpm test
pnpm build
git add server/pty.ts server/pty.test.ts
git commit -m "ส่ง output ของ PTY ผ่านท่อ outbound แทนการยิง ws.send ตรงๆ"
```

---

### Task 4: เปิด permessage-deflate พร้อม threshold

**Files:**
- Modify: `server/index.ts:126` (บรรทัด `const wss = new WebSocketServer({ noServer: true });`)
- Test: `server/index.test.ts` (เพิ่มเทสต่อท้าย)

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี export ใหม่ — เปลี่ยน option ของ `WebSocketServer` ที่สร้างใน `createServer`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

เติมต่อท้าย `server/index.test.ts` ไฟล์นี้มี `openWs(headers)`, `goodCookie()`, `ORIGIN`, `PORT`
อยู่แล้วด้านบน แต่ `openWs` ไม่รับ option ของ client จึงต้องเปิด socket เองในเทสนี้:

```ts
describe('การบีบอัด WebSocket', () => {
  it('server ตอบรับ permessage-deflate ตอน handshake', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?cols=80&rows=24`, {
      headers: { origin: ORIGIN, cookie: goodCookie() },
      perMessageDeflate: true,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    // frame ใหญ่ถูกบีบ ส่วน frame เล็ก (echo) รอดเพราะ threshold ฝั่ง server
    expect(Object.keys(ws.extensions)).toContain('permessage-deflate');
    ws.close();
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

รัน: `pnpm vitest run server/index.test.ts -t 'บีบอัด'`
คาดว่า: เทสตัวที่สองล้ม — `client.extensions` ว่าง เพราะ `ws` ตั้ง `perMessageDeflate: false` เป็นค่า default

- [ ] **Step 3: แก้ index.ts**

```ts
  // เปิดบีบอัดเฉพาะ frame ใหญ่ ข้อความเทอร์มินัลมี escape sequence ซ้ำสูงมาก
  // บีบได้ 5-10 เท่า ซึ่งบนแบนด์วิดท์มือถือคือของจริง
  //
  // threshold กัน frame จิ๋วไว้: echo ของตัวอักษรที่ผู้ใช้พิมพ์ยาวไม่กี่ไบต์
  // การ deflate มันมีแต่เสียเวลา CPU และบวก latency ให้สิ่งที่ต้องเร็วที่สุด
  //
  // คง context takeover ไว้ (ค่า default) — dictionary ข้ามเฟรมช่วยได้เยอะกับ
  // ข้อความที่ซ้ำแบบนี้ และแอปนี้จำกัด session เดียว หน่วยความจำจึงไม่ใช่ประเด็น
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024 } });
```

- [ ] **Step 4: รันเทสให้ผ่าน**

รัน: `pnpm vitest run server/index.test.ts`
คาดว่า: ผ่านทั้งไฟล์

- [ ] **Step 5: รันทั้งชุด, build, commit**

```bash
pnpm test
pnpm build
git add server/index.ts server/index.test.ts
git commit -m "เปิด permessage-deflate เฉพาะ frame ใหญ่ ไม่แตะ frame echo"
```

---

### Task 5: เอกสารและงานที่เลื่อนออกไป

**Files:**
- Modify: `README.md` (ส่วนที่อธิบายสถาปัตยกรรม server / WebSocket)
- Modify: `TODO.md`

**Interfaces:**
- Consumes: พฤติกรรมที่สร้างใน Task 1-4
- Produces: ไม่มีโค้ด

- [ ] **Step 1: เพิ่มหัวข้อใน README.md**

เพิ่มหัวข้อย่อยใต้ส่วนที่พูดถึง WebSocket/PTY:

```markdown
### ท่อขาออกจาก PTY

output จาก PTY ไม่ได้ยิงเข้า `ws.send()` ตรงๆ แต่ผ่าน `server/outbound.ts` ซึ่งทำสามอย่าง:

- **รวม chunk แบบ immediate-first** — chunk แรกหลังจอเงียบส่งทันที (นั่นคือ echo ของ
  ตัวอักษรที่เพิ่งพิมพ์ หน่วงไม่ได้) chunk ที่ตามมาใน 5 ms ถึงจะถูกสะสมแล้วส่งรวดเดียว
  burst จาก `cat` หรือ build log จึงถูกยุบเหลือ ~200 frame/วินาที แทนที่จะเป็นพันเฟรม
- **หยุดอ่าน PTY เมื่อคิวยาวเกิน** — เกิน 256 KB สั่ง `term.pause()` และ resume เมื่อ
  ระบายต่ำกว่า 64 KB ถ้าไม่ทำ ข้อมูลที่ค้างในคิวจะดองตัวอักษรที่ผู้ใช้พิมพ์ตามหลัง
  ไว้เป็นวินาที (head-of-line blocking) ซึ่งเป็นอาการที่รู้สึกได้ชัดที่สุดบนมือถือ
- **บีบอัดเฉพาะ frame ใหญ่** — `perMessageDeflate` มี `threshold: 1024` เพื่อไม่ให้
  frame echo จิ๋วๆ ต้องเสียเวลา deflate

ทั้งสามอย่างนี้ลด**สิ่งที่ทำให้แย่กว่า RTT** ไม่ได้ลด RTT เอง — บนเส้นทางมือถือ cellular
ผ่าน Tailscale RTT อยู่ที่ 60-250 ms และเป็นเพดานที่ transport ลดไม่ได้
```

- [ ] **Step 2: เพิ่มงานที่เลื่อนออกไปใน TODO.md**

```markdown
## ประสิทธิภาพการเชื่อมต่อ (เลื่อนออกไป)

- **first-load ช้าบน cellular** — `serveStatic()` ส่ง JS 368 KB โดยไม่บีบอัดและไม่มี
  `Cache-Control`/`ETag` ทั้งที่ชื่อไฟล์เป็น content-hash อยู่แล้ว (gzip เหลือ 95 KB)
  ของถูกและได้ผลชัด แค่ยังไม่ใช่อาการที่เจอจริง
- **predictive local echo แบบ mosh** — ชั้นเดียวที่ลด RTT ที่ผู้ใช้รู้สึกได้จริง
  ต้องรู้ว่า terminal อยู่ใน mode ไหน (`input-pipeline.ts` มีข้อมูลนี้บางส่วนแล้ว)
  ควรมีตัวเลข baseline จาก key→echo RTT probe ก่อนตัดสินใจลงทุน
- **protocol flow-control เต็มรูปแบบ (client ack)** — ทำเมื่อพิสูจน์ว่า
  `bufferedAmount` อย่างเดียวไม่พอ
```

- [ ] **Step 3: Commit**

```bash
git add README.md TODO.md
git commit -m "บันทึกพฤติกรรมท่อขาออกและงานประสิทธิภาพที่เลื่อนออกไป"
```

---

## การวัดผล (ทำนอกแผน ไม่ commit)

หลัง Task 4 ผ่าน ให้วัดบนมือถือจริงผ่าน Tailscale ก่อน/หลัง:

1. เพิ่ม probe ชั่วคราวใน `web/main.ts` — บันทึก `performance.now()` ตอน `send`
   จับคู่กับ byte แรกที่กลับมาใน `socket.onmessage` เก็บ p50/p95 แล้ว log
2. วัดสองสถานการณ์: จอเงียบ (พิมพ์เฉยๆ) และระหว่าง `cat` ไฟล์ใหญ่
3. เกณฑ์สำเร็จตาม spec: p95 ตอนมี output ไหล ต้องไม่ห่างจาก p95 ตอนจอเงียบอย่างมีนัยสำคัญ
   (ก่อนแก้ ห่างกันหลายเท่า)
4. ถอด probe ออกก่อน merge
