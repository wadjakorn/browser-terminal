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
- ค่าคงที่ที่ตกลงไว้: cooldown window `5 ms`, deflate threshold `1024` bytes, `HIGH_WATER = 32 * 1024`, `LOW_WATER = 8 * 1024` (ไม่มี polling — ใช้ callback ของ `ws.send`)
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
  - `interface OutboundSink { send(data: Buffer, onFlushed: () => void): void }`
    — `onFlushed` ต้องถูกเรียกเมื่อข้อมูลออกจาก buffer ของ socket จริง (Task 2 ใช้ค่านี้ทำ backpressure)
  - `interface OutboundSource { pause(): void; resume(): void }`
  - `interface OutboundOptions { windowMs?: number; highWater?: number; lowWater?: number }`
  - `function createOutbound(sink: OutboundSink, source: OutboundSource, opts?: OutboundOptions): { push(data: Buffer): void; flush(): void; dispose(): void }`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

สร้าง `server/outbound.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutbound, type OutboundSink, type OutboundSource } from './outbound.js';

/** sink ปลอมที่เก็บ callback ไว้ให้เทสสั่ง ack เองได้ — Task 2 ใช้เต็มที่ */
function fakes() {
  const sent: string[] = [];
  const acks: Array<() => void> = [];
  const calls: string[] = [];
  const sink: OutboundSink = {
    send: (data, onFlushed) => { sent.push(data.toString('utf8')); acks.push(onFlushed); },
  };
  const source: OutboundSource = {
    pause: () => { calls.push('pause'); },
    resume: () => { calls.push('resume'); },
  };
  /** ack ทุก frame ที่ค้างอยู่ตามลำดับ */
  const ackAll = () => { while (acks.length) acks.shift()!(); };
  return { sink, source, sent, acks, calls, ackAll };
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

  it('flush() ส่งของค้างทันทีโดยไม่รอหน้าต่าง', () => {
    // ใช้ตอน shell ตาย: ถ้าไม่มีตัวนี้ output บรรทัดสุดท้ายจะหายไปกับ pending
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    out.push(buf('ลาก่อน'));
    expect(f.sent).toEqual(['a']);
    out.flush();
    expect(f.sent).toEqual(['a', 'ลาก่อน']);
    out.dispose();
  });

  it('flush() ตอนไม่มีของค้าง ไม่ส่ง frame เปล่า', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.flush();
    expect(f.sent).toEqual([]);
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
  /** `onFlushed` ต้องถูกเรียกเมื่อ data ออกจาก buffer ของ socket จริง */
  send(data: Buffer, onFlushed: () => void): void;
}

export interface OutboundSource {
  pause(): void;
  resume(): void;
}

export interface OutboundOptions {
  windowMs?: number;
  highWater?: number;
  lowWater?: number;
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
): { push(data: Buffer): void; flush(): void; dispose(): void } {
  const windowMs = opts.windowMs ?? WINDOW_MS;

  let pending: Buffer[] = [];
  let window: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  /** คืน true ถ้ามีของให้ส่งจริง — ใช้ตัดสินว่ายังอยู่ใน burst อยู่ไหม */
  const flushPending = (): boolean => {
    if (pending.length === 0) return false;
    const data = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
    pending = [];
    sink.send(data, () => { /* Task 2 เติม backpressure ตรงนี้ */ });
    return true;
  };

  const openWindow = (): void => {
    window = setTimeout(() => {
      window = null;
      // ยังมีของสะสม = ยังอยู่ใน burst ต่อหน้าต่างใหม่
      // ไม่มีของ = จอเงียบแล้ว ปล่อยให้ push ครั้งหน้าส่งทันที
      if (flushPending()) openWindow();
    }, windowMs);
  };

  return {
    push(data: Buffer): void {
      if (disposed) return;
      pending.push(data);
      if (window) return;
      flushPending();
      openWindow();
    },
    /**
     * ส่งของค้างทันที ใช้ตอน PTY ตาย — `onExit` ปิด socket ทันทีที่ยิง
     * ถ้าไม่ล้างหน้าต่างก่อน output บรรทัดสุดท้ายจะหายไปเงียบๆ
     */
    flush(): void {
      if (disposed) return;
      flushPending();
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
คาดว่า: ผ่านทั้ง 8 เทส

- [ ] **Step 5: รันทั้งชุดและ commit**

```bash
pnpm test
git add server/outbound.ts server/outbound.test.ts
git commit -m "รวม chunk ขาออกแบบ immediate-first เพื่อไม่หน่วง echo ตัวแรก"
```

---

### Task 2: Backpressure แบบ event-driven ด้วย send callback

ตัวนี้คือส่วนที่แก้อาการเจ็บที่สุด: ตอน `cat` ไฟล์ใหญ่ ข้อมูลเข้าคิวรออยู่หน้า ตัวอักษรที่พิมพ์ต่อจากนั้นต้องต่อแถวอยู่หลังทั้งหมด การจำกัดคิวไม่ให้ยาวเกินเพดานคือสิ่งที่ทำให้ echo กลับมาอยู่ในระดับ RTT

**สองอย่างที่ต้องเข้าใจก่อนเขียน:**

1. **เพดานต้องเล็ก** เกณฑ์ความสำเร็จคือ echo ตอนมี output ไหล ต้องใกล้เคียงตอนจอเงียบ (≈ RTT 150 ms) บน cellular ~2 Mbps คิว 32 KB ≈ 130 ms ≈ หนึ่ง RTT พอดี ถ้าตั้งไว้หลักร้อย KB ก็คือยอมให้ echo ช้าเป็นวินาทีตั้งแต่ออกแบบ
2. **นับเองด้วย callback ไม่ poll `bufferedAmount`** ที่เพดานเล็กขนาดนี้ การ poll ทุก 50 ms ทำให้ลิงก์ว่างรอเปล่าเกือบครึ่งเวลา `ws.send(data, cb)` เรียก callback เมื่อข้อมูลถูกเขียนลง socket จริง — นับ `outstanding` เองจึงทั้งตรงกว่าและไม่ต้องมี timer ให้เคลียร์

3. **`outstanding` นับไบต์ก่อนบีบอัด** `ws` ส่งข้อมูลเข้า sender แล้วค่อย deflate
   (`node_modules/ws/lib/websocket.js:481`) ดังนั้น 32 KB ที่นับได้อาจเป็นแค่ ~4 KB
   จริงบนสายเมื่อ output บีบได้ดี ผลคือ pause เร็วกว่าที่จำเป็น — ทิศทางนี้ปลอดภัย
   (คิวสั้น = echo ดี) แต่ถ้าวัดแล้ว throughput ตกจนน่ารำคาญ ตัวแรกที่ควรขยับคือ
   `HIGH_WATER` ไม่ใช่รื้อกลไก

**Files:**
- Modify: `server/outbound.ts` (เพิ่มเข้าไปใน `createOutbound` ที่สร้างใน Task 1)
- Test: `server/outbound.test.ts` (เพิ่ม describe block ใหม่ต่อท้าย)

**Interfaces:**
- Consumes: `createOutbound`, `OutboundSink`, `OutboundSource`, `OutboundOptions` จาก Task 1 (ลายเซ็นไม่เปลี่ยน — `opts.highWater` / `opts.lowWater` ที่ประกาศไว้แล้วเริ่มมีผลใน task นี้)
- Produces: ไม่มี export ใหม่ พฤติกรรมเพิ่ม: `source.pause()` เมื่อไบต์ที่ยังไม่ถูกเขียนลง socket เกิน `highWater` และ `source.resume()` เมื่อลงต่ำกว่า `lowWater`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

เติมต่อท้าย `server/outbound.test.ts` (ใช้ `fakes()` และ `buf()` ที่ประกาศไว้แล้วใน Task 1):

```ts
describe('createOutbound — backpressure', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const opts = { highWater: 10, lowWater: 4 };

  it('คิวทะลุเพดาน → สั่ง pause ต้นทาง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('12345678901'));    // 11 ไบต์ > 10
    expect(f.calls).toEqual(['pause']);
    out.dispose();
  });

  it('คิวยังไม่ถึงเพดาน → ไม่ยุ่งกับต้นทาง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('123456'));
    expect(f.calls).toEqual([]);
    out.dispose();
  });

  it('นับสะสมข้ามหลาย frame ไม่ใช่ดูทีละ frame', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('123456'));         // ออกทันที 6 ไบต์ ยังไม่เกิน
    expect(f.calls).toEqual([]);
    out.push(buf('123456'));         // สะสมในหน้าต่าง
    vi.advanceTimersByTime(5);       // ส่งอีก 6 → รวม 12 > 10
    expect(f.calls).toEqual(['pause']);
    out.dispose();
  });

  it('ack แล้วลงต่ำกว่า lowWater → resume', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('12345678901'));
    expect(f.calls).toEqual(['pause']);
    f.ackAll();                      // เขียนลง socket หมดแล้ว → outstanding = 0
    expect(f.calls).toEqual(['pause', 'resume']);
    out.dispose();
  });

  it('ack บางส่วนที่ยังไม่ต่ำกว่า lowWater → ยังไม่ resume', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('123456'));         // frame 1: 6 ไบต์
    out.push(buf('123456'));
    vi.advanceTimersByTime(5);       // frame 2: 6 ไบต์ → รวม 12 → pause
    expect(f.calls).toEqual(['pause']);
    f.acks.shift()!();               // ack frame แรก → เหลือ 6 ซึ่งยัง >= 4
    expect(f.calls).toEqual(['pause']);
    f.acks.shift()!();               // ack frame ที่สอง → เหลือ 0
    expect(f.calls).toEqual(['pause', 'resume']);
    out.dispose();
  });

  it('ระหว่าง pause ไม่สั่ง pause ซ้ำ', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('12345678901'));
    out.push(buf('12345678901'));
    vi.advanceTimersByTime(5);
    vi.advanceTimersByTime(5);
    expect(f.calls).toEqual(['pause']);
    out.dispose();
  });

  it('dispose ระหว่าง pause แล้ว ack มาทีหลัง → ไม่ resume ต้นทางที่ตายแล้ว', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('12345678901'));
    expect(f.calls).toEqual(['pause']);
    out.dispose();
    f.ackAll();                      // socket ปิดแล้ว ws ยังเรียก callback อยู่ดี
    expect(f.calls).toEqual(['pause']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ไม่มี timer เพิ่มจากกลไก backpressure เลย', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source, opts);
    out.push(buf('12345678901'));
    vi.advanceTimersByTime(5);       // หน้าต่างปิดเพราะไม่มีของสะสม
    expect(vi.getTimerCount()).toBe(0);
    out.dispose();
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

รัน: `pnpm vitest run server/outbound.test.ts -t backpressure`
คาดว่า: ล้ม — `f.calls` เป็น `[]` เพราะยังไม่มีใครเรียก `pause()`

- [ ] **Step 3: เติม implementation**

ใน `server/outbound.ts` เพิ่มค่าคงที่ต่อจาก `WINDOW_MS`:

```ts
/**
 * ~130 ms ของข้อมูลบน cellular ทั่วไป ≈ หนึ่ง RTT
 *
 * ตั้งใหญ่กว่านี้เท่ากับยอมให้ตัวอักษรที่ผู้ใช้พิมพ์ไปต่อแถวอยู่หลังคิวเป็นวินาที
 * (head-of-line blocking) ซึ่งคืออาการที่งานนี้ตั้งใจแก้ทั้งหมด
 */
const HIGH_WATER = 32 * 1024;
/** hysteresis กัน pause/resume กระพริบถี่ๆ ตอนคิวแกว่งรอบเพดาน */
const LOW_WATER = 8 * 1024;
```

ใน `createOutbound` เพิ่มการอ่าน options ต่อจาก `windowMs`:

```ts
  const highWater = opts.highWater ?? HIGH_WATER;
  const lowWater = opts.lowWater ?? LOW_WATER;
```

เพิ่ม state ต่อจาก `let disposed = false;`:

```ts
  /** ไบต์ที่ส่งเข้า ws แล้วแต่ยังไม่ถูกเขียนลง socket */
  let outstanding = 0;
  let paused = false;
```

แทนที่บรรทัด `sink.send(...)` ใน `flushPending` ด้วย:

```ts
    outstanding += data.length;
    sink.send(data, () => {
      outstanding -= data.length;
      // ต้นทางอาจตายไปแล้วตอน callback มาถึง — ห้ามปลุก pty ที่ถูกฆ่าทิ้ง
      if (paused && !disposed && outstanding < lowWater) {
        paused = false;
        source.resume();
      }
    });
    /**
     * `ws.send()` เข้าคิวได้ไม่จำกัด — ปล่อยไว้แล้วคำสั่งที่พ่น output เยอะจะดอง
     * ตัวอักษรที่ผู้ใช้พิมพ์ตามหลังไว้เป็นวินาที (head-of-line blocking)
     *
     * `source.pause()` หยุดอ่านจาก PTY จริง ทำให้โปรแกรมต้นทาง block ที่ pipe
     * buffer ของ OS — พฤติกรรมเดียวกับเทอร์มินัลจริงที่เลื่อนจอตามไม่ทัน
     */
    if (!paused && !disposed && outstanding > highWater) {
      paused = true;
      source.pause();
    }
```

- [ ] **Step 4: รันเทสให้ผ่าน**

รัน: `pnpm vitest run server/outbound.test.ts`
คาดว่า: ผ่านทั้ง 16 เทส (8 จาก Task 1 + 8 ใหม่)

- [ ] **Step 5: รันทั้งชุดและ commit**

```bash
pnpm test
git add server/outbound.ts server/outbound.test.ts
git commit -m "หยุดอ่าน PTY เมื่อคิว ws ยาวเกิน ไม่ให้ output ดองการพิมพ์"
```

---

### Task 3: ต่อ outbound เข้ากับ attachPty

**Files:**
- Modify: `server/pty.ts` (บล็อก `dispose`, `term.onData`, `term.onExit` — บรรทัด 34-51)
- Test: `server/pty.test.ts` (เพิ่มเทสต่อท้าย)

**Interfaces:**
- Consumes: `createOutbound`, `flush()`, `dispose()` จาก Task 1-2
- Produces: `attachPty(ws, opts)` ลายเซ็นเดิมไม่เปลี่ยน (`{ pid: number }`) — ผู้เรียกใน `server/index.ts` ไม่ต้องแก้

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

เติมต่อท้าย `server/pty.test.ts` ไฟล์นี้มี helper `pair()`, `alive()`, `until()` อยู่แล้วด้านบน และมีเทสรูปแบบ `client.send(Buffer.from('echo marker-hi\n'))` อยู่ก่อนหน้า — ใช้รูปแบบเดียวกัน

เทสที่มีอยู่แล้วครอบคลุม round-trip ปกติ (`echo marker-hi`) สิ่งที่ยังไม่มีคือการพิสูจน์ว่า
**burst ใหญ่ผ่านการรวม frame แล้วยังครบและเรียงถูก** และ **output บรรทัดสุดท้ายก่อน shell
ตายไม่หาย** ซึ่งเป็นสองความเสี่ยงที่ Task 1-2 สร้างขึ้นโดยตรง:

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

  it('output บรรทัดสุดท้ายก่อน shell ตาย ไม่หายไปกับหน้าต่างรวม chunk', async () => {
    // echo แล้ว exit ติดกันทันที — ระยะห่างระหว่าง onData กับ onExit สั้นกว่า
    // หน้าต่าง 5 ms ถ้าไม่ flush ก่อนปิด socket บรรทัดนี้จะหายเงียบๆ
    const { server, client, close } = await pair();
    let received = '';
    client.on('message', raw => { received += raw.toString('utf8'); });
    const closed = new Promise<void>(r => client.once('close', () => r()));

    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('printf FAREWELL-MARKER; exit\n'));

    await closed;
    expect(received).toContain('FAREWELL-MARKER');
    await close();
  });
});
```

- [ ] **Step 2: รันเทสเพื่อยืนยัน baseline**

รัน: `pnpm vitest run server/pty.test.ts`
คาดว่า: **ผ่านทั้งคู่** — โค้ดเดิมที่ยิง `ws.send()` ตรงๆ ทำสองอย่างนี้ได้อยู่แล้ว
เทสชุดนี้คือ regression guard ต้องเห็นว่าผ่าน **ก่อน** แก้ `pty.ts` เพื่อให้รู้ว่า
ถ้ามันล้มหลังแก้ คือ outbound ทำพัง ไม่ใช่เทสเขียนผิด

- [ ] **Step 3: แก้ pty.ts ให้ใช้ outbound**

เพิ่ม import ที่หัวไฟล์ ต่อจาก `import type { WebSocket } from 'ws';`:

```ts
import { createOutbound } from './outbound.js';
```

สร้าง outbound **ก่อน** `const dispose = ...` (ถ้าวางไว้หลัง จะอ้างตัวแปรก่อน initialize
แล้วพังตอน runtime เพราะ TDZ):

```ts
  const outbound = createOutbound(
    {
      send: (data, onFlushed) => {
        // socket ปิดไปแล้วก็ต้องเรียก onFlushed อยู่ดี ไม่งั้น outstanding ค้าง
        // แล้ว backpressure จะ pause ทิ้งไว้ตลอดกาล
        if (ws.readyState !== ws.OPEN) { onFlushed(); return; }
        ws.send(data, () => onFlushed());
      },
    },
    { pause: () => term.pause(), resume: () => term.resume() },
  );
```

แก้ `dispose` ให้ปิดท่อด้วย:

```ts
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    outbound.dispose();
    try { term.kill('SIGHUP'); } catch { /* ตายไปแล้ว */ }
  };
```

แทนที่บล็อก `term.onData(...)` เดิม:

```ts
  term.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'));
  });
```

ด้วย:

```ts
  term.onData(data => outbound.push(Buffer.from(data, 'utf8')));
```

และแก้ `term.onExit` ให้ล้างหน้าต่างก่อนปิด socket:

```ts
  term.onExit(({ exitCode }) => {
    disposed = true;
    // ต้อง flush ก่อน close เสมอ: onExit มาถึงได้ภายในไม่กี่ไมโครวินาทีหลัง
    // onData ก้อนสุดท้าย ซึ่งยังนอนอยู่ในหน้าต่างรวม chunk — ปิดเลยคือทำ output
    // บรรทัดสุดท้ายหายเงียบๆ (ws จะส่ง close frame ต่อท้ายข้อมูลที่เข้าคิวไว้แล้ว)
    outbound.flush();
    // ต้อง dispose ตรงนี้ด้วย: `disposed = true` ข้างบนทำให้ `dispose()` ที่ผูกไว้กับ
    // ws.on('close') early-return ไป outbound จึงไม่มีใครปิดให้ — เหลือ timer ค้าง
    // และ send callback ที่มาทีหลังจะไป resume PTY ที่ตายไปแล้ว
    outbound.dispose();
    if (ws.readyState === ws.OPEN) ws.close(1000, `exit:${exitCode}`);
  });
```

หมายเหตุลำดับ: `flush()` ต้องมาก่อน `dispose()` เสมอ — `dispose()` ล้าง pending ทิ้ง
ถ้าสลับกัน output บรรทัดสุดท้ายจะหายด้วยเหตุผลเดียวกับที่พยายามแก้อยู่

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

เพิ่มเป็นหัวข้อย่อย `###` ใต้ `## สิ่งที่ต้องรู้` (หัวข้อรวมกับดักของโปรเจกต์)
วางไว้ท้ายหัวข้อนั้น ก่อน `## พัฒนาต่อ`:

```markdown
### ท่อขาออกจาก PTY

output จาก PTY ไม่ได้ยิงเข้า `ws.send()` ตรงๆ แต่ผ่าน `server/outbound.ts` ซึ่งทำสามอย่าง:

- **รวม chunk แบบ immediate-first** — chunk แรกหลังจอเงียบส่งทันที (นั่นคือ echo ของ
  ตัวอักษรที่เพิ่งพิมพ์ หน่วงไม่ได้) chunk ที่ตามมาใน 5 ms ถึงจะถูกสะสมแล้วส่งรวดเดียว
  burst จาก `cat` หรือ build log จึงถูกยุบเหลือ ~200 frame/วินาที แทนที่จะเป็นพันเฟรม
- **หยุดอ่าน PTY เมื่อคิวยาวเกิน** — เกิน 32 KB (≈ หนึ่ง RTT ของข้อมูลบน cellular)
  สั่ง `term.pause()` และ resume เมื่อระบายต่ำกว่า 8 KB นับจาก callback ของ `ws.send()`
  ไม่ใช่ poll ถ้าไม่ทำ ข้อมูลที่ค้างในคิวจะดองตัวอักษรที่ผู้ใช้พิมพ์ตามหลัง
  ไว้เป็นวินาที (head-of-line blocking) ซึ่งเป็นอาการที่รู้สึกได้ชัดที่สุดบนมือถือ
- **บีบอัดเฉพาะ frame ใหญ่** — `perMessageDeflate` มี `threshold: 1024` เพื่อไม่ให้
  frame echo จิ๋วๆ ต้องเสียเวลา deflate

ทั้งสามอย่างนี้ลด**สิ่งที่ทำให้แย่กว่า RTT** ไม่ได้ลด RTT เอง — บนเส้นทางมือถือ cellular
ผ่าน Tailscale RTT อยู่ที่ 60-250 ms และเป็นเพดานที่ transport ลดไม่ได้
```

- [ ] **Step 2: เพิ่มงานที่เลื่อนออกไปใน TODO.md**

เพิ่มเป็นหัวข้อ `##` ใหม่ วางไว้ก่อน `## รู้ไว้ แก้ที่นี่ไม่ได้` (หัวข้อสุดท้ายของไฟล์):

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
