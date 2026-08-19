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
