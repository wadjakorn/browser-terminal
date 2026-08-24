// web/viewport.ts
/**
 * เรียก onChange ทุกครั้งที่พื้นที่ที่มองเห็นจริงเปลี่ยน (คีย์บอร์ดเปิด/ปิด, หมุนจอ, zoom)
 * พร้อมอัปเดต --visible-height ที่ .app ใช้กำหนดความสูงตัวเอง
 */
export interface ViewportFrame { height: number }

/** คีย์บอร์ด Android ไม่หด layout viewport — ความสูงที่เชื่อได้มีแต่ของ visualViewport */
export function measureViewport(layoutHeight: number, visualHeight?: number): ViewportFrame {
  return { height: visualHeight ?? layoutHeight };
}

export function watchViewport(
  onChange: () => void,
  onFrame: (frame: ViewportFrame) => void = () => {},
): () => void {
  const vv = window.visualViewport;

  let timer: number | undefined;
  const debounced = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 100);
  };

  const apply = () => {
    const { height } = measureViewport(window.innerHeight, vv?.height);
    document.documentElement.style.setProperty('--visible-height', `${height}px`);
    onFrame({ height });
    debounced();
  };

  /*
   * ตอนกลับมาจากสลับแอปหรือปลุกจอ ระบบมักซ่อนคีย์บอร์ดให้ตอนหน้าเว็บยังอยู่
   * เบื้องหลัง — visualViewport resize รอบนั้นจึงไม่มีวันมาถึงเรา (หรือมาพร้อม
   * ค่าที่วัดตอนหน้าถูกซ่อนซึ่งเชื่อไม่ได้) ผลคือ --visible-height ค้างที่ความสูง
   * ตอนคีย์บอร์ดเปิด แล้ว .app สั้นกว่าจอจริง เหลือพื้นที่ว่างท้ายจอ
   * วัดใหม่ทุกครั้งที่หน้ากลับมาแสดงผลจึงเป็นทางเดียวที่กู้คืนได้
   */
  const applyIfVisible = () => {
    if (document.visibilityState === 'hidden') return;
    apply();
  };

  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);
  // resize ครอบเคสที่ไม่มี visualViewport (desktop) และการกลับมาแบบที่เบราว์เซอร์
  // แจ้งผ่าน layout viewport เท่านั้น
  window.addEventListener('resize', applyIfVisible);
  window.addEventListener('pageshow', applyIfVisible);
  document.addEventListener('visibilitychange', applyIfVisible);

  return () => {
    window.clearTimeout(timer);
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    window.removeEventListener('orientationchange', apply);
    window.removeEventListener('resize', applyIfVisible);
    window.removeEventListener('pageshow', applyIfVisible);
    document.removeEventListener('visibilitychange', applyIfVisible);
  };
}
