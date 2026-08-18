import { describe, expect, it } from 'vitest';
import { measureViewport } from './viewport.js';

describe('measureViewport', () => {
  it('reports the immediate visual height and bottom inset', () => {
    expect(measureViewport(800, 500, 20)).toEqual({ height: 500, inset: 280 });
  });

  it('falls back to the layout viewport without visualViewport', () => {
    expect(measureViewport(800)).toEqual({ height: 800, inset: 0 });
  });
});
