// web/viewport.ts
/**
 * เรียก onChange ทุกครั้งที่พื้นที่ที่มองเห็นจริงเปลี่ยน (คีย์บอร์ดเปิด/ปิด, หมุนจอ, zoom)
 * พร้อมอัปเดต CSS variable ที่ layout ใช้ยึดแถวปุ่มไว้เหนือคีย์บอร์ด
 */
export function watchViewport(onChange: () => void): () => void {
  const vv = window.visualViewport;

  let timer: number | undefined;
  const debounced = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 100);
  };

  const apply = () => {
    const height = vv?.height ?? window.innerHeight;
    // ระยะจากขอบล่างของ layout viewport ถึงขอบล่างของพื้นที่ที่มองเห็น = ความสูงคีย์บอร์ด
    const inset = Math.max(0, window.innerHeight - height - (vv?.offsetTop ?? 0));
    document.documentElement.style.setProperty('--visible-height', `${height}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
    debounced();
  };

  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);

  return () => {
    window.clearTimeout(timer);
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
