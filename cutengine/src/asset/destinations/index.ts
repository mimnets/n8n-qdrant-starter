export interface TransferRequest {
  id: string;
  destination: {
    provider: 's3' | 'mux' | 'webhook';
    options: Record<string, any>;
  };
}

export interface TransferResult {
  success: boolean;
  provider: string;
  message: string;
  data?: Record<string, any>;
}

/**
 * Transfer an asset to an external destination.
 * Currently only the webhook provider is implemented.
 */
export async function transferAsset(
  request: TransferRequest,
  assetInfo: { url: string | null; filename: string | null; type: string; size: number | null },
): Promise<TransferResult> {
  const { provider, options } = request.destination;

  switch (provider) {
    case 'webhook':
      return transferViaWebhook(request.id, options, assetInfo);
    case 's3':
      return {
        success: false,
        provider: 's3',
        message: 'S3 destination is not configured.',
      };
    case 'mux':
      return {
        success: false,
        provider: 'mux',
        message: 'Mux destination is not configured.',
      };
    default:
      return {
        success: false,
        provider: String(provider),
        message: `Unknown destination provider: ${provider}`,
      };
  }
}

async function transferViaWebhook(
  assetId: string,
  options: Record<string, any>,
  assetInfo: { url: string | null; filename: string | null; type: string; size: number | null },
): Promise<TransferResult> {
  const { url, headers } = options;

  if (!url) {
    return {
      success: false,
      provider: 'webhook',
      message: 'Missing required option: url',
    };
  }

  try {
    const payload = {
      event: 'asset.transfer',
      asset: {
        id: assetId,
        ...assetInfo,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: JSON.stringify(payload),
    });

    return {
      success: res.ok,
      provider: 'webhook',
      message: res.ok ? 'Transfer notification sent' : `Webhook returned ${res.status}`,
      data: { statusCode: res.status },
    };
  } catch (err: any) {
    return {
      success: false,
      provider: 'webhook',
      message: `Webhook request failed: ${err.message}`,
    };
  }
}
