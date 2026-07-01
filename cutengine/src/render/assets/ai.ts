export interface AIGenerateRequest {
  type: 'text-to-image' | 'image-to-video';
  prompt?: string;
  src?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface AIGenerateResult {
  url: string;
  type: 'image' | 'video';
}

export interface ProviderConfig {
  url: string;
  apiKey: string;
  model?: string;
  pollInterval?: number;
  maxPollAttempts?: number;
}

async function pollForResult(
  taskUrl: string,
  apiKey: string,
  pollInterval: number,
  maxAttempts: number,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetch(taskUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Poll request failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;

    if (data.status === 'completed' || data.status === 'succeeded') {
      return data.output?.url ?? data.result?.url ?? data.url;
    }

    if (data.status === 'failed' || data.status === 'error') {
      throw new Error(data.error ?? data.message ?? 'Generation failed');
    }
  }

  throw new Error('Generation timed out: max poll attempts reached');
}

export async function generateAIAsset(
  request: AIGenerateRequest,
  providerConfig: ProviderConfig,
): Promise<AIGenerateResult> {
  if (!providerConfig?.url || !providerConfig?.apiKey) {
    throw new Error('Provider not configured');
  }

  const pollInterval = providerConfig.pollInterval ?? 3000;
  const maxAttempts = providerConfig.maxPollAttempts ?? 60;

  // Build request payload based on type
  const payload: Record<string, unknown> = {};
  if (request.type === 'text-to-image') {
    payload.prompt = request.prompt;
    if (request.width) payload.width = request.width;
    if (request.height) payload.height = request.height;
    if (providerConfig.model) payload.model = providerConfig.model;
  } else if (request.type === 'image-to-video') {
    payload.image_url = request.src;
    if (request.prompt) payload.prompt = request.prompt;
    if (request.duration) payload.duration = request.duration;
    if (providerConfig.model) payload.model = providerConfig.model;
  }

  // Submit generation request
  const submitRes = await fetch(providerConfig.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '');
    throw new Error(`Provider API error: HTTP ${submitRes.status} ${errText}`);
  }

  const submitData = (await submitRes.json()) as any;

  // If result is immediately available
  if (submitData.output?.url || submitData.result?.url || submitData.url) {
    const url = submitData.output?.url ?? submitData.result?.url ?? submitData.url;
    return {
      url,
      type: request.type === 'text-to-image' ? 'image' : 'video',
    };
  }

  // Otherwise poll for completion
  const taskId = submitData.id ?? submitData.task_id;
  if (!taskId) {
    throw new Error('No task ID returned from provider');
  }

  const taskUrl = `${providerConfig.url}/${taskId}`;
  const resultUrl = await pollForResult(taskUrl, providerConfig.apiKey, pollInterval, maxAttempts);

  return {
    url: resultUrl,
    type: request.type === 'text-to-image' ? 'image' : 'video',
  };
}
