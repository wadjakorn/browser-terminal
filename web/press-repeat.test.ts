import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPressRepeatController } from './press-repeat.js';

const sample = (x = 0, y = 0, primary = true) => ({ id: 7, x, y, primary });

describe('press repeat controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a normal pointer tap exactly once through click', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.down(sample());
    repeat.end(7);
    repeat.click(1);

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('starts at 350ms and repeats every 75ms', () => {
    const activate = vi.fn();
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    const repeat = createPressRepeatController(activate, { onHoldStart, onHoldEnd });

    repeat.down(sample());
    vi.advanceTimersByTime(349);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(onHoldStart).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(150);
    expect(activate).toHaveBeenCalledTimes(3);

    repeat.end(7);
    expect(onHoldEnd).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(150);
    expect(activate).toHaveBeenCalledTimes(3);
  });

  it('suppresses the synthetic click after a completed hold, then accepts the next tap', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.down(sample());
    vi.advanceTimersByTime(350);
    repeat.end(7);
    repeat.click(1);
    expect(activate).toHaveBeenCalledTimes(1);

    repeat.down(sample());
    repeat.end(7);
    repeat.click(1);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('turns a drag beyond 10px into no input and does not poison the next tap', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.down(sample());
    repeat.move(sample(11, 0));
    vi.advanceTimersByTime(500);
    repeat.end(7);
    repeat.click(1);
    expect(activate).not.toHaveBeenCalled();

    repeat.down(sample());
    repeat.end(7);
    repeat.click(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('keeps a movement exactly at the 10px tolerance eligible for hold', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.down(sample());
    repeat.move(sample(6, 8));
    vi.advanceTimersByTime(350);

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('stops pending and active repeats on end or cancellation', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.down(sample());
    repeat.end(7);
    vi.advanceTimersByTime(500);
    expect(activate).not.toHaveBeenCalled();

    repeat.down(sample());
    vi.advanceTimersByTime(350);
    repeat.cancel();
    vi.advanceTimersByTime(300);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('lets keyboard-generated clicks send once without entering repeat', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.click(0);
    vi.advanceTimersByTime(1_000);

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('ignores non-primary pointer presses', () => {
    const activate = vi.fn();
    const repeat = createPressRepeatController(activate);

    repeat.down(sample(0, 0, false));
    vi.advanceTimersByTime(1_000);

    expect(activate).not.toHaveBeenCalled();
  });
});
