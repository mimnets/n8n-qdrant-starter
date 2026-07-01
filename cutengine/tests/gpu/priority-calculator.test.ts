import { describe, it, expect } from 'vitest';
import { calculatePriority, resolveModel } from '../../src/gpu/priority-calculator.js';

describe('PriorityCalculator', () => {
  it('T1 image = priority 1', () => {
    expect(calculatePriority('T1', 'text-to-image')).toBe(1);
  });

  it('T2 image = priority 2', () => {
    expect(calculatePriority('T2', 'text-to-image')).toBe(2);
  });

  it('T8 video = priority 9', () => {
    expect(calculatePriority('T8', 'image-to-video')).toBe(9);
  });

  it('T10 upscale = priority 12', () => {
    expect(calculatePriority('T10', 'upscale')).toBe(12);
  });

  it('clamps minimum to 1', () => {
    expect(calculatePriority('T0', 'text-to-image')).toBe(1);
  });

  it('resolves text-to-image to flux-klein', () => {
    const { model, vram_gb } = resolveModel('text-to-image');
    expect(model).toBe('flux-klein');
    expect(vram_gb).toBe(8);
  });

  it('resolves image-to-video to hunyuan', () => {
    const { model, vram_gb } = resolveModel('image-to-video');
    expect(model).toBe('hunyuan');
    expect(vram_gb).toBe(14);
  });
});
