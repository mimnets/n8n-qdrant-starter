import type { PipelineStage } from '@gstack/types';
import type { StageResult, PipelineRun } from './types.js';

type StageFn = (input: unknown) => Promise<unknown>;

const STAGE_ORDER: PipelineStage[] = [
  'topic_selection',
  'script_writing',
  'script_qc',
  'tts_generation',
  'image_generation',
  'video_generation',
  'rendering',
  'thumbnail',
  'youtube_upload',
];

export class PipelineRunner {
  private stageHandlers: Map<PipelineStage, StageFn> = new Map();

  registerStage(stage: PipelineStage, handler: StageFn): void {
    this.stageHandlers.set(stage, handler);
  }

  async runAll(channelId: string, tier: string): Promise<PipelineRun> {
    const startTime = Date.now();
    const stages: StageResult[] = [];
    let lastOutput: unknown = { channel_id: channelId, tier };
    let failed = false;

    for (const stage of STAGE_ORDER) {
      if (failed) {
        stages.push({ stage, status: 'skipped', duration_ms: 0, output: null });
        continue;
      }

      const handler = this.stageHandlers.get(stage);
      if (!handler) {
        stages.push({ stage, status: 'skipped', duration_ms: 0, output: null, error: 'No handler registered' });
        continue;
      }

      const stageStart = Date.now();
      try {
        const output = await handler(lastOutput);
        stages.push({
          stage,
          status: 'success',
          duration_ms: Date.now() - stageStart,
          output,
        });
        lastOutput = output;
      } catch (err: any) {
        stages.push({
          stage,
          status: 'failed',
          duration_ms: Date.now() - stageStart,
          output: null,
          error: err.message,
        });
        failed = true;
      }
    }

    return {
      channel_id: channelId,
      tier,
      stages,
      total_duration_ms: Date.now() - startTime,
      status: failed ? 'failed' : 'success',
    };
  }
}
