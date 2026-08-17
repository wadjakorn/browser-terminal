export interface LimiterOptions {
  /** จำนวนครั้งที่ยอมให้ล้มเหลวต่อหนึ่ง IP ในหนึ่งหน้าต่างเวลา */
  max?: number;
  windowMs?: number;
  /**
   * เพดานรวมทุก IP — เป็นตาข่ายกันการยิงพร้อมกันจากหลาย IP เท่านั้น
   * จึงต้องตั้งให้สูงกว่า max มากๆ ไม่งั้นมันจะกลายเป็นช่องให้ล็อกเจ้าของออกจากระบบ
   * ซึ่งคือปัญหาเดิมที่การแยกถังตาม IP ตั้งใจจะแก้
   */
  globalMax?: number;
}

export function createLoginLimiter(opts: LimiterOptions = {}) {
  const max = opts.max ?? 5;
  const windowMs = opts.windowMs ?? 60_000;
  const globalMax = opts.globalMax ?? 50;

  /** key = IP ของผู้เรียก (หรือค่าว่างเมื่อไม่รู้ที่มา) */
  const buckets = new Map<string, number[]>();

  /**
   * เก็บกวาดทุกถัง ไม่ใช่แค่ถังที่กำลังถูกถาม — ไม่งั้นผู้โจมตีที่หมุน IP ไปเรื่อยๆ
   * จะทิ้งถังค้างไว้ในหน่วยความจำไม่มีที่สิ้นสุด
   */
  const prune = (nowMs: number): void => {
    for (const [key, times] of buckets) {
      const kept = times.filter(t => nowMs - t < windowMs);
      if (kept.length === 0) buckets.delete(key);
      else buckets.set(key, kept);
    }
  };

  const total = (): number => {
    let n = 0;
    for (const times of buckets.values()) n += times.length;
    return n;
  };

  return {
    isBlocked(nowMs: number, key = ''): boolean {
      prune(nowMs);
      if (total() >= globalMax) return true;
      return (buckets.get(key)?.length ?? 0) >= max;
    },
    recordFailure(nowMs: number, key = ''): void {
      prune(nowMs);
      const times = buckets.get(key) ?? [];
      times.push(nowMs);
      buckets.set(key, times);
    },
    /** เรียกเมื่อล็อกอินสำเร็จ — ปลดเฉพาะ IP นั้น ไม่ยกโทษให้ทั้งระบบ */
    reset(key = ''): void {
      buckets.delete(key);
    },
    /** จำนวนถังที่ยังค้างอยู่ — มีไว้ให้เทสตรวจว่าการเก็บกวาดทำงานจริง */
    size(): number {
      return buckets.size;
    },
  };
}
