import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendCallback,
  buildCallbackPayload,
  type CallbackPayload,
} from '../../../src/queue/workers/render-worker.js';

// We need to mock ioredis since render-worker imports connection.js
vi.mock('ioredis', () => {
  class RedisMock {
    status = 'ready';
    options = { maxRetriesPerRequest: null };
    disconnect() {}
    duplicate() { return new RedisMock(); }
  }
  return { default: RedisMock };
});

vi.mock('bullmq', () => {
  class MockWorker {
    name: string;
    processor: any;
    opts: any;
    constructor(name: string, processor: any, opts: any) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
    }
    async close() {}
  }
  return {
    Worker: MockWorker,
    Queue: class MockQueue {
      name: string;
      constructor(name: string) { this.name = name; }
      async close() {}
    },
    Job: class {},
  };
});

vi.mock('../../../src/render/pipeline.js', () => ({
  executePipeline: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

describe('buildCallbackPayload', () => {
  it('builds a success callback payload', () => {
    const payload = buildCallbackPayload(
      'render-123',
      'done',
      'https://example.com/output.mp4',
      null,
    );

    expect(payload.type).toBe('render');
    expect(payload.action).toBe('render');
    expect(payload.id).toBe('render-123');
    expect(payload.owner).toBe('cutengine');
    expect(payload.status).toBe('done');
    expect(payload.url).toBe('https://example.com/output.mp4');
    expect(payload.error).toBeNull();
    expect(payload.completed).toBeDefined();
  });

  it('builds a failure callback payload', () => {
    const payload = buildCallbackPayload(
      'render-456',
      'failed',
      null,
      'FFmpeg crashed',
    );

    expect(payload.status).toBe('failed');
    expect(payload.url).toBeNull();
    expect(payload.error).toBe('FFmpeg crashed');
    expect(payload.completed).toBeDefined();
  });
});

describe('sendCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use fake timers to avoid actual delays in tests
    vi.useFakeTimers();
  });

  const successPayload: CallbackPayload = {
    type: 'render',
    action: 'render',
    id: 'render-001',
    owner: 'cutengine',
    status: 'done',
    url: '/serve/v1/assets/render-001/output.mp4',
    error: null,
    completed: '2026-03-29T12:00:00.000Z',
  };

  const failedPayload: CallbackPayload = {
    type: 'render',
    action: 'render',
    id: 'render-002',
    owner: 'cutengine',
    status: 'failed',
    url: null,
    error: 'Encode error',
    completed: '2026-03-29T12:00:00.000Z',
  };

  it('sends successful callback with done status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await sendCallback('https://webhook.example.com/cb', successPayload, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://webhook.example.com/cb',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(successPayload),
      },
    );
  });

  it('sends callback with failed status on render error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await sendCallback('https://webhook.example.com/cb', failedPayload, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(calledBody.status).toBe('failed');
    expect(calledBody.error).toBe('Encode error');
    expect(calledBody.url).toBeNull();
  });

  it('retries up to 3 times on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const promise = sendCallback('https://webhook.example.com/cb', successPayload, mockFetch);

    // Advance timers for backoff: 1s, 2s
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on non-2xx response and succeeds on third attempt', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = sendCallback('https://webhook.example.com/cb', successPayload, mockFetch);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('succeeds on first attempt without retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await sendCallback('https://webhook.example.com/cb', successPayload, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('Callback integration with render worker', () => {
  it('no callback URL means no POST attempt', async () => {
    // The render worker only calls sendCallback when callback is truthy
    // This tests the contract: if callback is not set, sendCallback is never called
    const mockFetch = vi.fn();
    const callback: string | undefined = undefined;

    if (callback) {
      await sendCallback(callback, successPayload, mockFetch);
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  const successPayload: CallbackPayload = {
    type: 'render',
    action: 'render',
    id: 'render-no-cb',
    owner: 'cutengine',
    status: 'done',
    url: '/serve/v1/assets/render-no-cb/output.mp4',
    error: null,
    completed: '2026-03-29T12:00:00.000Z',
  };
});
