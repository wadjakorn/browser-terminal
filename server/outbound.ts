/** หน้าต่างรวม chunk — เล็กพอที่ RTT บนมือถือกลบมิด ใหญ่พอจะยุบ burst ได้ */
const WINDOW_MS = 5;

/**
 * ~130 ms ของข้อมูลบน cellular ทั่วไป ≈ หนึ่ง RTT
 *
 * ตั้งใหญ่กว่านี้เท่ากับยอมให้ตัวอักษรที่ผู้ใช้พิมพ์ไปต่อแถวอยู่หลังคิวเป็นวินาที
 * (head-of-line blocking) ซึ่งคืออาการที่งานนี้ตั้งใจแก้ทั้งหมด
 */
const HIGH_WATER = 32 * 1024;
/** hysteresis กัน pause/resume กระพริบถี่ๆ ตอนคิวแกว่งรอบเพดาน */
const LOW_WATER = 8 * 1024;

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
  const highWater = opts.highWater ?? HIGH_WATER;
  const lowWater = opts.lowWater ?? LOW_WATER;

  let pending: Buffer[] = [];
  let window: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  /** ไบต์ที่ส่งเข้า ws แล้วแต่ยังไม่ถูกเขียนลง socket */
  let outstanding = 0;
  /** ไบต์ที่สะสมใน `pending` รอหน้าต่างปิด — ยังไม่ถึง `sink.send` แต่ก็คือคิวจริง */
  let pendingBytes = 0;
  let paused = false;

  /**
   * `ws.send()` เข้าคิวได้ไม่จำกัด — ปล่อยไว้แล้วคำสั่งที่พ่น output เยอะจะดอง
   * ตัวอักษรที่ผู้ใช้พิมพ์ตามหลังไว้เป็นวินาที (head-of-line blocking)
   *
   * `source.pause()` หยุดอ่านจาก PTY จริง ทำให้โปรแกรมต้นทาง block ที่ pipe
   * buffer ของ OS — พฤติกรรมเดียวกับเทอร์มินัลจริงที่เลื่อนจอตามไม่ทัน
   *
   * ต้องรวม `pendingBytes` เข้าไปในเพดานด้วย ไม่ใช่แค่ `outstanding` เพราะ
   * หนึ่งหน้าต่างรวม chunk เดียวสะสมเกิน HIGH_WATER ได้หลายเท่าก่อนถูก flush
   * เข้า `sink.send` จริง (วัดได้ 275 KB ในหน้าต่าง 5 ms เดียวจาก `yes`) —
   * รอให้ flush ก่อนค่อยเช็คจึงไม่ทันกันคิวพุ่งเกินเพดานไปแล้ว ต้องเช็คตั้งแต่
   * ตอนของเข้าคิว (`push`) ไม่ใช่ตอนของออกจากคิว
   */
  const checkPause = (): void => {
    if (!paused && !disposed && outstanding + pendingBytes > highWater) {
      paused = true;
      source.pause();
    }
  };

  /** คืน true ถ้ามีของให้ส่งจริง — ใช้ตัดสินว่ายังอยู่ใน burst อยู่ไหม */
  const flushPending = (): boolean => {
    if (pending.length === 0) return false;
    const data = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
    pending = [];
    pendingBytes = 0;
    outstanding += data.length;
    sink.send(data, () => {
      outstanding -= data.length;
      // ต้นทางอาจตายไปแล้วตอน callback มาถึง — ห้ามปลุก pty ที่ถูกฆ่าทิ้ง
      if (paused && !disposed && outstanding + pendingBytes < lowWater) {
        paused = false;
        source.resume();
      }
    });
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
      pendingBytes += data.length;
      // เช็คเพดานตั้งแต่ตอนนี้ ก่อน flush — ไม่งั้นคิวพุ่งเกินได้ทั้งก้อนของ
      // หนึ่งหน้าต่างก่อนใครจะสั่ง pause (ดูเหตุผลที่ checkPause)
      checkPause();
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
      pendingBytes = 0;
      // ต้นทางที่ถูก pause ไว้ต้อง resume ก่อนตาย ไม่งั้น node-pty จะไม่มีวันเห็น
      // EOF (socket ถูก pause ค้างอยู่) แล้วรอ DESTROY_SOCKET_TIMEOUT_MS (200ms)
      // ก่อน destroy ทิ้งเอง — ถ้าคิวขาออกยังระบายไม่ทันใน 200ms (สาย cellular
      // ที่ช้าคือเคสตรงเป้า) output ที่ค้างอยู่ก็หายไปพร้อมกับที่ถูกตัดหาง
      if (paused) {
        paused = false;
        source.resume();
      }
    },
  };
}
