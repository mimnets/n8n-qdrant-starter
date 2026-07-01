import type { ServiceHealth } from '@gstack/types';

export function createHealthResponse(
  name: string,
  version: string,
  startTime: number,
  deps?: Record<string, 'healthy' | 'degraded' | 'offline'>,
): ServiceHealth {
  const depValues = deps ? Object.values(deps) : [];
  let status: ServiceHealth['status'] = 'healthy';
  if (depValues.length > 0 && depValues.every(v => v === 'offline')) {
    status = 'offline';
  } else if (depValues.includes('offline') || depValues.includes('degraded')) {
    status = 'degraded';
  }

  return {
    service_name: name,
    status,
    version,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    last_checked_at: new Date().toISOString(),
    ...(deps && { dependencies: deps }),
  };
}

export async function checkHttpDep(url: string, timeoutMs = 2000): Promise<'healthy' | 'offline'> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? 'healthy' : 'offline';
  } catch {
    return 'offline';
  }
}

export async function checkRedisDep(redis: any): Promise<'healthy' | 'offline'> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG' ? 'healthy' : 'offline';
  } catch {
    return 'offline';
  }
}
