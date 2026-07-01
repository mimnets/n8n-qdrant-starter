// src/gpu/priority-calculator.ts

import type { ModelSlot } from '@gstack/types';
import { MODEL_VRAM } from './types.js';

const TYPE_OFFSET: Record<string, number> = {
  'text-to-image': 0,
  'image-to-video': 1,
  'upscale': 2,
};

/** Map generation type to the model slot it requires */
export function resolveModel(type: string): { model: ModelSlot; vram_gb: number } {
  switch (type) {
    case 'text-to-image':
      return { model: 'flux-klein', vram_gb: MODEL_VRAM['flux-klein'] };
    case 'image-to-video':
      return { model: 'hunyuan', vram_gb: MODEL_VRAM['hunyuan'] };
    case 'upscale':
      return { model: 'realesrgan', vram_gb: MODEL_VRAM['realesrgan'] };
    default:
      return { model: 'flux-klein', vram_gb: MODEL_VRAM['flux-klein'] };
  }
}

/** Extract tier number from tier string (e.g. "T3" → 3) */
function parseTier(tier: string): number {
  const match = tier.match(/T?(\d+)/i);
  return match ? parseInt(match[1], 10) : 5;
}

/**
 * Calculate BullMQ priority from channel tier + job type.
 * Lower number = higher priority. Minimum is 1.
 */
export function calculatePriority(tier: string, type: string): number {
  const tierBase = parseTier(tier);
  const offset = TYPE_OFFSET[type] ?? 0;
  return Math.max(1, tierBase + offset);
}
