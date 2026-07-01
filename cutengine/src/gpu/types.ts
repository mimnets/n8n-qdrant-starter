// src/gpu/types.ts — GPU scheduler types

import type { ModelSlot, GPUStatus } from '@gstack/types';

/** Extended status for the GPU scheduler (superset of GPUStatus) */
export interface GPUSchedulerStatus extends GPUStatus {
  gpu_id: string;
  total_gb: number;
  available_gb: number;
  safety_margin_gb: number;
  reservations: Record<string, number>;
  queue_depth: number;
}

/** Job data for the gpu-scheduler queue */
export interface GPUSchedulerJob {
  type: 'text-to-image' | 'image-to-video' | 'upscale';
  model_needed: ModelSlot;
  vram_gb: number;
  tier: string;
  channel_id: string;
  visual_priority: 'normal' | 'high';
  request: Record<string, unknown>;
  callback_url?: string;
}

/** Model-to-VRAM mapping (mirrors GPUMemoryManager's MODEL_REGISTRY) */
export const MODEL_VRAM: Record<string, number> = {
  'flux-klein': 8,
  'flux-dev': 20,
  'hunyuan': 14,
  'fish-speech': 2,
  'realesrgan': 1,
};

/** Models that cannot coexist on GPU */
export const FORBIDDEN_PAIRS: [string, string][] = [
  ['flux-klein', 'hunyuan'],
  ['hunyuan', 'flux-klein'],
];
