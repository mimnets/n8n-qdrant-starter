import { describe, it, expect } from 'vitest';
import { PipelineRunner } from './helpers/pipeline-runner.js';
import topicFixture from './fixtures/topic.json';
import scriptFixture from './fixtures/script.json';
import qcFixture from './fixtures/qc-result.json';

describe('E2E Pipeline (Mock)', () => {
  it('should complete all 9 pipeline stages successfully', async () => {
    const runner = new PipelineRunner();

    // Stage 1: Topic Selection
    runner.registerStage('topic_selection', async () => {
      return topicFixture;
    });

    // Stage 2: Script Writing
    runner.registerStage('script_writing', async (input: any) => {
      expect(input.title).toBeTruthy();
      return scriptFixture;
    });

    // Stage 3: Script QC
    runner.registerStage('script_qc', async (input: any) => {
      expect(input.hook).toBeTruthy();
      expect(input.body.length).toBeGreaterThan(100);
      return { ...qcFixture, script: input };
    });

    // Stage 4: TTS Generation
    runner.registerStage('tts_generation', async (input: any) => {
      expect(input.pass).toBe(true);
      return {
        status: 'done',
        url: 'mock://audio/tts-output.wav',
        format: 'wav',
        duration: 180,
      };
    });

    // Stage 5: Image Generation
    runner.registerStage('image_generation', async () => {
      return {
        status: 'done',
        images: [
          { url: 'mock://images/scene-1.png', width: 1920, height: 1080 },
          { url: 'mock://images/scene-2.png', width: 1920, height: 1080 },
          { url: 'mock://images/scene-3.png', width: 1920, height: 1080 },
        ],
      };
    });

    // Stage 6: Video Generation
    runner.registerStage('video_generation', async (input: any) => {
      expect(input.images.length).toBeGreaterThan(0);
      return {
        status: 'done',
        url: 'mock://videos/i2v-output.mp4',
        format: 'mp4',
        duration: 5,
      };
    });

    // Stage 7: Rendering
    runner.registerStage('rendering', async (input: any) => {
      expect(input.url).toContain('.mp4');
      return {
        status: 'done',
        url: 'mock://renders/final-render.mp4',
        format: 'mp4',
        duration: 180,
        width: 1920,
        height: 1080,
      };
    });

    // Stage 8: Thumbnail
    runner.registerStage('thumbnail', async () => {
      return {
        status: 'done',
        url: 'mock://thumbnails/thumb.png',
        width: 1280,
        height: 720,
        is_thumbnail: true,
      };
    });

    // Stage 9: YouTube Upload (dry-run)
    runner.registerStage('youtube_upload', async () => {
      return { dry_run: true, status: 'skipped' };
    });

    // Run the full pipeline
    const result = await runner.runAll('TEST-CH-001', 'T10');

    // Validate overall result
    expect(result.status).toBe('success');
    expect(result.stages).toHaveLength(9);
    expect(result.stages.every(s => s.status === 'success')).toBe(true);
    expect(result.total_duration_ms).toBeGreaterThan(0);

    // Validate individual stages
    const topicResult = result.stages[0];
    expect(topicResult.stage).toBe('topic_selection');
    expect((topicResult.output as any).ci_score).toBeGreaterThan(0);

    const scriptResult = result.stages[1];
    expect((scriptResult.output as any).hook).toBeTruthy();

    const ttsResult = result.stages[3];
    expect((ttsResult.output as any).url).toContain('.wav');

    const renderResult = result.stages[6];
    expect((renderResult.output as any).url).toContain('.mp4');

    const uploadResult = result.stages[8];
    expect((uploadResult.output as any).dry_run).toBe(true);

    // Print summary
    console.log('\n📊 Pipeline Run Summary:');
    console.log(`   Channel: ${result.channel_id} (${result.tier})`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Duration: ${result.total_duration_ms}ms`);
    result.stages.forEach(s => {
      const icon = s.status === 'success' ? '✅' : s.status === 'failed' ? '❌' : '⏭️';
      console.log(`   ${icon} ${s.stage}: ${s.status} (${s.duration_ms}ms)`);
    });
  });

  it('should stop pipeline on stage failure and skip remaining', async () => {
    const runner = new PipelineRunner();

    runner.registerStage('topic_selection', async () => topicFixture);
    runner.registerStage('script_writing', async () => {
      throw new Error('Claude API mock failure');
    });
    // Remaining stages not registered

    const result = await runner.runAll('TEST-CH-002', 'T10');

    expect(result.status).toBe('failed');
    expect(result.stages[0].status).toBe('success');
    expect(result.stages[1].status).toBe('failed');
    expect(result.stages[1].error).toBe('Claude API mock failure');
    // All remaining stages should be skipped
    expect(result.stages.slice(2).every(s => s.status === 'skipped')).toBe(true);
  });

  it('should track per-stage duration accurately', async () => {
    const runner = new PipelineRunner();

    runner.registerStage('topic_selection', async () => {
      await new Promise(r => setTimeout(r, 50));
      return topicFixture;
    });
    runner.registerStage('script_writing', async () => scriptFixture);

    const result = await runner.runAll('TEST-CH-003', 'T10');

    expect(result.stages[0].duration_ms).toBeGreaterThanOrEqual(40); // allow some tolerance
    expect(result.total_duration_ms).toBeGreaterThanOrEqual(40);
  });
});
