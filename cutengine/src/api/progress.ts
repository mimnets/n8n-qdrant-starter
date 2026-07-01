import { EventEmitter } from 'events';
import { FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';

export interface ProgressEvent {
  renderId: string;
  stage: string;
  frame?: number;
  totalFrames?: number;
  percent: number;
}

/**
 * Global progress hub.
 * Workers emit progress events; WebSocket clients subscribe by renderId.
 */
class ProgressHub extends EventEmitter {
  private lastEmit = new Map<string, number>();
  private lastPercent = new Map<string, number>();

  /**
   * Emit a progress event, throttled to avoid flooding.
   * Sends if: >=1% change OR >=500ms since last emit OR stage changed.
   */
  emitProgress(event: ProgressEvent): void {
    const key = event.renderId;
    const now = Date.now();
    const lastTime = this.lastEmit.get(key) ?? 0;
    const lastPct = this.lastPercent.get(key) ?? -1;

    const pctDelta = Math.abs(event.percent - lastPct);
    const timeDelta = now - lastTime;
    const isStageChange = event.stage === 'done' || event.stage === 'failed';

    if (pctDelta >= 1 || timeDelta >= 500 || isStageChange) {
      this.lastEmit.set(key, now);
      this.lastPercent.set(key, event.percent);
      this.emit('progress', event);
    }
  }

  /** Clean up tracking state for a completed render. */
  cleanup(renderId: string): void {
    this.lastEmit.delete(renderId);
    this.lastPercent.delete(renderId);
  }
}

export const progressHub = new ProgressHub();

/**
 * Attach WebSocket upgrade handler to Fastify for `/ws/progress/:renderId`.
 */
export async function progressRoutes(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/ws\/progress\/(.+)$/);

    if (!match) {
      // Not our route — let other handlers deal with it (or destroy)
      socket.destroy();
      return;
    }

    const renderId = match[1];

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Send current connection confirmation
      ws.send(JSON.stringify({ type: 'connected', renderId }));

      // Subscribe to progress events for this renderId
      const handler = (event: ProgressEvent) => {
        if (event.renderId !== renderId) return;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event));
        }
      };

      progressHub.on('progress', handler);

      ws.on('close', () => {
        progressHub.off('progress', handler);
      });

      ws.on('error', () => {
        progressHub.off('progress', handler);
      });
    });
  });

  // Cleanup on server close
  app.addHook('onClose', async () => {
    wss.close();
  });
}
