import type { PipelineStage } from '@gstack/types';

export interface StageResult {
  stage: PipelineStage;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  output: unknown;
  error?: string;
}

export interface PipelineRun {
  channel_id: string;
  tier: string;
  stages: StageResult[];
  total_duration_ms: number;
  status: 'success' | 'failed';
}
