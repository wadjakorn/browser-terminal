// web/viewport.ts
/**
 * เรียก onChange ทุกครั้งที่พื้นที่ที่มองเห็นจริงเปลี่ยน (คีย์บอร์ดเปิด/ปิด, หมุนจอ, zoom)
 * พร้อมอัปเดต CSS variable ที่ layout ใช้ยึดแถวปุ่มไว้เหนือคีย์บอร์ด
 */
export interface ViewportFrame { height: number; inset: number }

export function measureViewport(
  layoutHeight: number,
  visualHeight?: number,
  visualOffsetTop = 0,
): ViewportFrame {
  const height = visualHeight ?? layoutHeight;
  return {
    height,
    inset: Math.max(0, layoutHeight - height - visualOffsetTop),
  };
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
    const { height, inset } = measureViewport(
      window.innerHeight,
      vv?.height,
      vv?.offsetTop,
    );
    document.documentElement.style.setProperty('--visible-height', `${height}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
    onFrame({ height, inset });
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
