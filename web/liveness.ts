/**
 * ตรวจว่า WebSocket ยังเป็นอยู่จริงไหม — ใช้ตอนหน้าเว็บกลับมาจากเบื้องหลัง
 *
 * มือถือที่สลับแอปไปนานๆ มักโดน OS/Tailscale/NAT ตัด TCP ทิ้งเงียบๆ socket ฝั่งนี้ยัง
 * รายงานว่า `OPEN` ไปอีกหลายนาทีจนกว่า TCP จะ timeout ระหว่างนั้น `onclose` ไม่มา
 * `reconnect.wake()` จึงไม่มีอะไรให้ปลุก ผู้ใช้เห็นจอนิ่งและพิมพ์ไม่ออก ping/pong
 * ระดับโปรโตคอลที่ server ส่งอยู่แล้ว JavaScript มองไม่เห็น จึงต้องถามเองที่ระดับแอป
 *
 * นับว่าสายดีเฉพาะ pong ที่ nonce ตรงเท่านั้น ไม่ใช่ข้อความใดๆ — ตอนกลับมา เบราว์เซอร์
 * ส่ง frame ที่บัฟเฟอร์ไว้ก่อน TCP ตายเข้ามาทันที ซึ่งพิสูจน์อะไรไม่ได้เลย
 */

/**
 * ไม่ใช่ 3 วิ: วิทยุมือถือกับ Tailscale ที่เพิ่งตื่นใช้เวลาเกิน RTT ปกติไปมาก และการตัดสิน
 * ผิดว่าตายมีราคา — ได้ PTY ใหม่ ซึ่งคืองานหายสำหรับ SHELL_CMD ที่ไม่ใช่ multiplexer
 */
export const LIVENESS_TIMEOUT_MS = 5000;

export interface ProbeSocket {
  send(data: string): void;
}

export interface LivenessDeps<S extends ProbeSocket> {
  /** socket ที่ถามไปไม่ตอบในเวลา — ผู้เรียกต้องเช็คเองว่ายังเป็นตัวปัจจุบันอยู่ไหม */
  onDead: (socket: S) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface Liveness<S extends ProbeSocket> {
  /** ส่ง ping แล้วรอ pong — ถามซ้ำบน socket ที่กำลังรออยู่แล้วไม่ทำอะไร */
  probe(socket: S): void;
  /** ส่งข้อความ text ทุกตัวที่ socket ได้รับมาที่นี่ */
  onText(socket: S, data: string): void;
  /** เลิกรอของ socket นี้ (เรียกจาก onclose) — socket อื่นไม่กระทบ */
  cancel(socket: S): void;
}

export function createLiveness<S extends ProbeSocket>(deps: LivenessDeps<S>): Liveness<S> {
  const schedule = deps.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? (id => window.clearTimeout(id));

  let nonce = 0;
  let pending: { socket: S; n: number; timer: number } | null = null;

  const clear = (): void => {
    if (!pending) return;
    unschedule(pending.timer);
    pending = null;
  };

  return {
    probe(socket) {
      if (pending?.socket === socket) return;
      clear();
      const n = ++nonce;
      try {
        socket.send(JSON.stringify({ t: 'ping', n }));
      } catch {
        deps.onDead(socket);
        return;
      }
      const timer = schedule(() => {
        pending = null;
        deps.onDead(socket);
      }, LIVENESS_TIMEOUT_MS);
      pending = { socket, n, timer };
    },

    onText(socket, data) {
      if (pending?.socket !== socket) return;
      let msg: unknown;
      try { msg = JSON.parse(data); } catch { return; }
      const { t, n } = (msg ?? {}) as { t?: unknown; n?: unknown };
      if (t === 'pong' && n === pending.n) clear();
    },

    cancel(socket) {
      if (pending?.socket === socket) clear();
    },
  };
}
