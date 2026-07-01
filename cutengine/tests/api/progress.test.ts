import { describe, it, expect, vi, beforeEach } from 'vitest';
import { progressHub, type ProgressEvent } from '../../src/api/progress.js';

beforeEach(() => {
  progressHub.removeAllListeners();
  // Reset internal state
  (progressHub as any).lastEmit.clear();
  (progressHub as any).lastPercent.clear();
});

describe('ProgressHub', () => {
  it('emits progress events to listeners', () => {
    const events: ProgressEvent[] = [];
    progressHub.on('progress', (e) => events.push(e));

    progressHub.emitProgress({
      renderId: 'r1',
      stage: 'capture',
      frame: 100,
      totalFrames: 1000,
      percent: 10,
    });

    expect(events).toHaveLength(1);
    expect(events[0].renderId).toBe('r1');
    expect(events[0].percent).toBe(10);
  });

  it('throttles events with less than 1% change within 500ms', () => {
    const events: ProgressEvent[] = [];
    progressHub.on('progress', (e) => events.push(e));

    // First event always emits
    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 10 });
    // 0.3% change — should be throttled
    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 10.3 });
    // 0.5% change — should be throttled
    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 10.5 });

    expect(events).toHaveLength(1);
  });

  it('emits when percent changes by >=1%', () => {
    const events: ProgressEvent[] = [];
    progressHub.on('progress', (e) => events.push(e));

    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 10 });
    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 11 });
    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 12.5 });

    expect(events).toHaveLength(3);
  });

  it('always emits done and failed stage events', () => {
    const events: ProgressEvent[] = [];
    progressHub.on('progress', (e) => events.push(e));

    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 99 });
    progressHub.emitProgress({ renderId: 'r1', stage: 'done', percent: 100 });

    expect(events).toHaveLength(2);
    expect(events[1].stage).toBe('done');
  });

  it('tracks separate renderIds independently', () => {
    const events: ProgressEvent[] = [];
    progressHub.on('progress', (e) => events.push(e));

    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 10 });
    progressHub.emitProgress({ renderId: 'r2', stage: 'capture', percent: 10 });

    expect(events).toHaveLength(2);
  });

  it('cleanup removes tracking state', () => {
    progressHub.emitProgress({ renderId: 'r1', stage: 'capture', percent: 50 });
    progressHub.cleanup('r1');

    expect((progressHub as any).lastEmit.has('r1')).toBe(false);
    expect((progressHub as any).lastPercent.has('r1')).toBe(false);
  });
});
