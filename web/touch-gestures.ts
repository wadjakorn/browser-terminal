/**
 * แปลง touch ดิบเป็นเจตนา (intent) — ตรรกะบริสุทธิ์ ไม่รู้จัก DOM ไม่รู้จัก xterm
 *
 * แยกออกมาเป็นไฟล์ของตัวเองด้วยเหตุผลเดียวกับ input-pipeline.ts: ตรรกะที่พลาดแล้ว
 * จะไม่มีใครเห็นจนกว่าจะเอาไปลองบนมือถือจริง ต้องเทสได้โดยไม่ต้องมีเบราว์เซอร์
 *
 * `now` ถูก inject เข้ามาเพื่อให้เทสเรื่องเวลา (tap, double-tap) รันได้ทันทีโดยไม่ต้อง
 * await sleep จริง — ไม่งั้นชุดเทสจะช้าและ flaky
 */

export interface Point {
  id: number;
  x: number;
  y: number;
}

export type Gesture =
  | { kind: 'wheel'; lines: number; x: number; y: number }
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'doubleTap'; x: number; y: number }
  | { kind: 'zoom'; scale: number }
  /** กดค้างครบเวลาแล้ว = กดปุ่มเมาส์ซ้ายค้าง (ลากเส้นแบ่ง sidebar ของ herdr) */
  | { kind: 'dragStart'; x: number; y: number }
  | { kind: 'dragMove'; x: number; y: number }
  | { kind: 'dragEnd'; x: number; y: number };

export interface RecognizerOptions {
  emit: (g: Gesture) => void;
  now?: () => number;
  /** ขยับเกินกี่ px ถึงถือว่า "ลาก" ไม่ใช่ "แตะ" */
  moveThresholdPx?: number;
  /** แตะค้างนานกว่านี้ไม่นับเป็น tap */
  tapMaxMs?: number;
  /** ระยะห่างเวลาสูงสุดระหว่างสองแตะที่ยังนับเป็น double tap */
  doubleTapMaxMs?: number;
  /** สองแตะต้องอยู่ในรัศมีนี้ถึงนับเป็น double tap */
  doubleTapMaxDistPx?: number;
  /**
   * นิ้วขยับกี่ px ถึงยิง wheel หนึ่งครั้ง — ควรตั้งเท่าความสูงหนึ่งบรรทัดจริง
   *
   * จำเป็นเพราะ xterm ส่ง mouse report **หนึ่งครั้งต่อหนึ่ง wheel event** ไม่ว่า
   * delta จะมากแค่ไหน (ค่า lines ที่มันคำนวณถูกใช้เป็นแค่ gate ว่า != 0) ถ้าเรายิง
   * event เดียวที่ deltaY -300 TUI จะเลื่อนแค่คลิกเดียว ไม่ใช่ 20 บรรทัด
   *
   * รับเป็นฟังก์ชันได้ เพราะความสูงบรรทัดเปลี่ยนตาม pinch zoom — ค่าที่อ่านครั้งเดียว
   * ตอนสร้าง recognizer จะผิดทันทีที่ผู้ใช้ซูม (และตอนนั้น xterm อาจยังไม่วาดแถวเลย)
   */
  wheelStepPx?: number | (() => number);

  /**
   * ─── momentum ───
   * ตัวเลข default จูนไว้ให้สะบัดเร็วหนึ่งที (~2 px/ms) ไหลต่อราว 2 วินาที
   * ได้ประมาณ 70 บรรทัด ระยะทางรวม ≈ v0 × frame ÷ (1 − friction)
   */
  /** ต่ำกว่านี้ถือว่าปล่อยเฉยๆ ไม่ใช่สะบัด (px/ms) */
  minFlickVelocity?: number;
  /** ความเร็วเหลือต่ำกว่านี้ให้หยุด (px/ms) */
  stopVelocity?: number;
  /** ตัวคูณความเร็วต่อหนึ่งเฟรม 16.67ms — ยิ่งใกล้ 1 ยิ่งไหลไกล */
  friction?: number;
  /** เพดานเวลา กันกรณี friction ถูกตั้งผิดจนไหลไม่จบ (ms) */
  maxMomentumMs?: number;
  /** ใช้ตัวอย่างการขยับย้อนหลังไม่เกินกี่ ms ในการวัดความเร็วตอนปล่อย */
  velocityWindowMs?: number;

  /**
   * กดค้างนิ่งๆ นานเท่านี้แล้วเข้าโหมดลากเมาส์ — 0 = ปิดฟีเจอร์
   *
   * ต้องมากกว่า tapMaxMs พอสมควร ไม่งั้นแตะปกติจะกลายเป็นลากโดยไม่ตั้งใจ
   * และการนับเวลาอาศัย tick() จากผู้เรียก ไม่ใช่ setTimeout ในนี้ ด้วยเหตุผล
   * เดียวกับ momentum: จะได้เทสได้โดยไม่ต้องรอเวลาจริง
   */
  longPressMs?: number;
}

/** โหมดที่กำลังเป็นอยู่ — ตัดสินตอนนิ้วเริ่มขยับ แล้วล็อกไว้จนยกนิ้วครบ */
type Mode = 'idle' | 'undecided' | 'scroll' | 'zoom' | 'dead' | 'momentum' | 'drag';

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function createGestureRecognizer(opts: RecognizerOptions) {
  const now = opts.now ?? (() => Date.now());
  const moveThreshold = opts.moveThresholdPx ?? 8;
  const tapMaxMs = opts.tapMaxMs ?? 300;
  const doubleTapMaxMs = opts.doubleTapMaxMs ?? 300;
  const doubleTapMaxDist = opts.doubleTapMaxDistPx ?? 40;
  const wheelStepOpt = opts.wheelStepPx ?? 20;
  const wheelStep = (): number => {
    const v = typeof wheelStepOpt === 'function' ? wheelStepOpt() : wheelStepOpt;
    return v > 0 ? v : 20;
  };

  let mode: Mode = 'idle';
  let startPoint: Point | null = null;
  let startTime = 0;
  let lastY = 0;
  let wheelAcc = 0;      // เศษ px ที่ยังไม่ครบหนึ่งขั้น
  let pinchStartDist = 0;

  const longPressMs = opts.longPressMs ?? 400;
  /** เวลาที่การกดค้างจะครบกำหนด — 0 = ไม่มีการกดค้างค้างอยู่ */
  let pressDeadline = 0;
  /** ตำแหน่งล่าสุดของนิ้วในโหมดลาก ใช้เป็นพิกัดของ dragEnd */
  let dragPoint: Point | null = null;

  // ─── momentum ───
  const minFlick = opts.minFlickVelocity ?? 0.35;
  const stopVel = opts.stopVelocity ?? 0.05;
  const friction = opts.friction ?? 0.968;
  const maxMomentumMs = opts.maxMomentumMs ?? 3000;
  const velWindowMs = opts.velocityWindowMs ?? 100;
  const FRAME_MS = 16.67;

  /** ตัวอย่างการขยับล่าสุด ใช้วัดความเร็วตอนปล่อยนิ้ว */
  let samples: { t: number; y: number }[] = [];
  let velocity = 0;          // px/ms — บวก = นิ้วขยับลง
  let momentumLastT = 0;
  let momentumEndsAt = 0;
  let lastX = 0;

  // แตะครั้งก่อน ใช้ตัดสิน double tap
  let prevTap: { x: number; y: number; t: number } | null = null;

  const stopMomentum = (): void => {
    if (mode === 'momentum') mode = 'idle';
    velocity = 0;
  };

  const reset = (): void => {
    mode = 'idle';
    startPoint = null;
    wheelAcc = 0;
    pinchStartDist = 0;
    samples = [];
    velocity = 0;
    pressDeadline = 0;
    dragPoint = null;
  };

  /** ปิดโหมดลากให้เรียบร้อย — ต้องยิง dragEnd เสมอ ไม่งั้นปุ่มเมาส์ค้างที่ TUI */
  const endDrag = (): void => {
    if (mode !== 'drag') return;
    const d = dragPoint ?? startPoint;
    if (d) opts.emit({ kind: 'dragEnd', x: d.x, y: d.y });
  };

  /** แปลงระยะที่สะสมไว้เป็น wheel ทีละบรรทัด */
  const drainWheel = (x: number, y: number): void => {
    const step = wheelStep();
    while (Math.abs(wheelAcc) >= step) {
      const dir = Math.sign(wheelAcc);
      wheelAcc -= dir * step;
      // นิ้วลง (dir บวก) = อยากเห็นของเก่า = wheel ขึ้น = ค่าติดลบ
      // ส่งเป็น "บรรทัด" ไม่ใช่ px โดยตั้งใจ — ถ้าส่งเป็น px ที่น้อยกว่า 50
      // xterm จะเดาว่าเป็น trackpad แล้วคูณ 0.3 ทิ้ง (CoreMouseService:257)
      opts.emit({ kind: 'wheel', lines: -dir, x, y });
    }
  };

  /** ความเร็วเฉลี่ยของช่วงท้าย (px/ms) บวก = นิ้วขยับลง */
  function measureVelocity(): number {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return 0;
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (last.y - first.y) / dt;
  }

  function beginPinch(touches: Point[]): void {
    mode = 'zoom';
    pinchStartDist = dist(touches[0]!, touches[1]!);
  }

  return {
    onTouchStart(touches: Point[]): void {
      stopMomentum();          // แตะระหว่างไหลอยู่ = จับให้หยุด (มาตรฐานของ inertia)
      if (touches.length >= 2) {
        pressDeadline = 0;     // นิ้วที่สองมาแล้ว = ตั้งใจ pinch ไม่ใช่กดค้าง
        beginPinch(touches);
        return;
      }
      const t = touches[0];
      if (!t) return;
      mode = 'undecided';
      pressDeadline = longPressMs > 0 ? now() + longPressMs : 0;
      samples = [{ t: now(), y: t.y }];
      startPoint = t;
      startTime = now();
      lastY = t.y;
    },

    onTouchMove(touches: Point[]): void {
      if (mode === 'dead') return;

      if (mode === 'drag') {
        const t = touches[0];
        if (!t) return;
        dragPoint = t;
        opts.emit({ kind: 'dragMove', x: t.x, y: t.y });
        return;
      }

      if (touches.length >= 2) {
        pressDeadline = 0;
        // นิ้วที่สองอาจโผล่มาโดยไม่ผ่าน onTouchStart ในบาง event stream
        if (mode !== 'zoom') beginPinch(touches);
        const d = dist(touches[0]!, touches[1]!);
        if (pinchStartDist > 0) opts.emit({ kind: 'zoom', scale: d / pinchStartDist });
        return;
      }

      if (mode === 'zoom') return;   // ยกเหลือนิ้วเดียวหลัง pinch — รอยกให้ครบก่อน

      const t = touches[0];
      if (!t || !startPoint) return;

      if (mode === 'undecided') {
        if (dist(startPoint, t) < moveThreshold) return;
        pressDeadline = 0;   // ขยับจริงแล้ว = ไม่ใช่การกดค้าง
        // แนวนอนล้วนไม่ใช่งานของเรา ปล่อยผ่านไปเลยจนกว่าจะยกนิ้ว
        if (Math.abs(t.y - startPoint.y) < Math.abs(t.x - startPoint.x)) {
          mode = 'dead';
          return;
        }
        mode = 'scroll';
        lastY = startPoint.y;
        wheelAcc = 0;
      }

      if (mode === 'scroll') {
        wheelAcc += t.y - lastY;
        lastY = t.y;
        lastX = t.x;
        // เก็บเฉพาะช่วงท้าย — ลากช้ายาวๆ แล้วสะบัดตอนจบต้องได้ momentum ตามการสะบัด
        const tNow = now();
        samples.push({ t: tNow, y: t.y });
        while (samples.length > 1 && tNow - samples[0]!.t > velWindowMs) samples.shift();
        drainWheel(t.x, t.y);
      }
    },

    onTouchEnd(touches: Point[]): void {
      if (touches.length > 0) {
        // ยังเหลือนิ้วอยู่ — หลัง pinch อย่าให้กลายเป็น scroll กระโดด
        if (mode === 'zoom') mode = 'dead';
        return;
      }

      if (mode === 'drag') {
        endDrag();
        reset();
        prevTap = null;      // จบการลาก ไม่ใช่การแตะ ห้ามต่อยอดเป็น doubleTap
        return;
      }

      const wasTappable = mode === 'undecided' && startPoint !== null;
      const wasScrolling = mode === 'scroll';
      const sp = startPoint;
      const elapsed = now() - startTime;
      const flick = wasScrolling ? measureVelocity() : 0;
      reset();

      if (Math.abs(flick) >= minFlick) {
        mode = 'momentum';
        velocity = flick;
        momentumLastT = now();
        momentumEndsAt = momentumLastT + maxMomentumMs;
      }

      if (!wasTappable || !sp || elapsed > tapMaxMs) {
        prevTap = null;
        return;
      }

      const t = now();
      const isDouble =
        prevTap !== null &&
        t - prevTap.t <= doubleTapMaxMs &&
        Math.hypot(sp.x - prevTap.x, sp.y - prevTap.y) <= doubleTapMaxDist;

      if (isDouble) {
        prevTap = null;   // ไม่ให้แตะครั้งที่สามต่อยอดเป็น double ซ้อน
        opts.emit({ kind: 'doubleTap', x: sp.x, y: sp.y });
      } else {
        prevTap = { x: sp.x, y: sp.y, t };
        opts.emit({ kind: 'tap', x: sp.x, y: sp.y });
      }
    },

    onTouchCancel(): void {
      endDrag();
      reset();
      prevTap = null;
    },

    /**
     * เดินเวลามาถึงปัจจุบัน — ขับด้วย requestAnimationFrame จากฝั่งที่เรียก
     * โมดูลนี้ไม่ผูก setTimeout เอง เพื่อให้เทสเรื่องเวลารันได้โดยไม่ต้องรอจริง
     *
     * คืน true ตราบใดที่ยังมีงานค้าง (นับเวลากดค้าง หรือ momentum ไหลอยู่)
     * ผู้เรียกใช้ค่านี้ตัดสินใจว่าจะขอเฟรมถัดไปไหม
     *
     * **ไม่รับเวลาเป็นพารามิเตอร์โดยตั้งใจ** — เคยรับ แล้วฝั่งเรียกส่ง timestamp
     * ของ rAF (นับจากตอนเปิดหน้า) เข้ามาปนกับ now() ที่เป็น Date.now() (นับจาก
     * epoch) ต่างกันพันล้านเท่า ผลคือกดค้างไม่เข้าโหมดลากเลยสักครั้ง
     * นาฬิกาเรือนเดียวคือทางเดียวที่ทำให้พลาดแบบนั้นไม่ได้อีก
     */
    tick(): boolean {
      const nowMs = now();
      if (pressDeadline > 0 && mode === 'undecided') {
        if (nowMs < pressDeadline) return true;   // ยังนับเวลาอยู่ ขอเฟรมต่อไป
        pressDeadline = 0;
        mode = 'drag';
        dragPoint = startPoint;
        if (startPoint) opts.emit({ kind: 'dragStart', x: startPoint.x, y: startPoint.y });
        return false;   // จากนี้ไปขับด้วย touchmove ไม่ต้องใช้ rAF อีก
      }

      if (mode !== 'momentum') return false;

      const dt = nowMs - momentumLastT;
      momentumLastT = nowMs;
      if (dt <= 0) return true;

      wheelAcc += velocity * dt;
      drainWheel(lastX, lastY);
      velocity *= Math.pow(friction, dt / FRAME_MS);

      if (Math.abs(velocity) < stopVel || nowMs >= momentumEndsAt) {
        stopMomentum();
        return false;
      }
      return true;
    },
  };
}
