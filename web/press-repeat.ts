export interface PressPointerSample {
  id: number;
  x: number;
  y: number;
  primary: boolean;
}

export interface PressRepeatOptions {
  holdDelayMs?: number;
  intervalMs?: number;
  moveTolerancePx?: number;
  onHoldStart?: (pointerId: number) => void;
  onHoldEnd?: (pointerId: number) => void;
}

export interface PressRepeatController {
  down(sample: PressPointerSample): void;
  move(sample: PressPointerSample): void;
  end(pointerId: number): void;
  cancel(): void;
  click(detail: number): boolean;
}

export function createPressRepeatController(
  activate: () => void,
  options: PressRepeatOptions = {},
): PressRepeatController {
  const holdDelayMs = options.holdDelayMs ?? 350;
  const intervalMs = options.intervalMs ?? 75;
  const moveTolerancePx = options.moveTolerancePx ?? 10;

  let activeId: number | null = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let holding = false;
  let suppressNextClick = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setInterval> | undefined;
  let suppressionTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    if (repeatTimer !== undefined) clearInterval(repeatTimer);
    holdTimer = undefined;
    repeatTimer = undefined;
  };

  const finish = (pointerId?: number) => {
    if (activeId === null || (pointerId !== undefined && pointerId !== activeId)) return;
    const finishedId = activeId;
    clearTimers();
    activeId = null;
    if (holding) {
      holding = false;
      suppressNextClick = true;
      options.onHoldEnd?.(finishedId);
    }
    if (moved) suppressNextClick = true;
    moved = false;
    if (suppressNextClick) {
      clearTimeout(suppressionTimer);
      suppressionTimer = setTimeout(() => { suppressNextClick = false; }, 0);
    }
  };

  return {
    down(sample) {
      if (!sample.primary || activeId !== null) return;
      clearTimeout(suppressionTimer);
      suppressionTimer = undefined;
      activeId = sample.id;
      startX = sample.x;
      startY = sample.y;
      moved = false;
      holding = false;
      holdTimer = setTimeout(() => {
        if (activeId !== sample.id || moved) return;
        holding = true;
        suppressNextClick = true;
        options.onHoldStart?.(sample.id);
        activate();
        repeatTimer = setInterval(activate, intervalMs);
      }, holdDelayMs);
    },

    move(sample) {
      if (sample.id !== activeId || holding || moved) return;
      if (Math.hypot(sample.x - startX, sample.y - startY) <= moveTolerancePx) return;
      moved = true;
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      holdTimer = undefined;
    },

    end(pointerId) {
      finish(pointerId);
    },

    cancel() {
      finish();
    },

    click(detail) {
      if (detail !== 0 && suppressNextClick) {
        suppressNextClick = false;
        clearTimeout(suppressionTimer);
        suppressionTimer = undefined;
        return false;
      }
      activate();
      return true;
    },
  };
}

export function bindPressRepeat(
  element: HTMLElement,
  activate: () => void,
): () => void {
  const controller = createPressRepeatController(activate, {
    onHoldStart(pointerId) {
      try { element.setPointerCapture(pointerId); } catch { /* pointer already ended */ }
    },
    onHoldEnd(pointerId) {
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    },
  });

  element.addEventListener('pointerdown', event => {
    controller.down({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      primary: event.isPrimary && event.button === 0,
    });
  });
  element.addEventListener('pointermove', event => {
    controller.move({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      primary: event.isPrimary,
    });
  });
  element.addEventListener('pointerup', event => controller.end(event.pointerId));
  element.addEventListener('pointercancel', () => controller.cancel());
  element.addEventListener('lostpointercapture', () => controller.cancel());
  element.addEventListener('click', event => {
    if (!controller.click(event.detail)) event.preventDefault();
  });
  element.addEventListener('contextmenu', event => event.preventDefault());

  return () => controller.cancel();
}
