// src/create/providers/cubeinsight.ts — CubeInsight trend data provider
//
// Fetches trending topics, video sentiment analysis, and channel search
// from the CubeInsight B2B API.

export interface CubeInsightConfig {
  host: string;
  port: number;
  api_key?: string;
}

export class CubeInsightProvider {
  readonly name = 'cubeinsight';

  constructor(private config: CubeInsightConfig) {}

  private get baseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.api_key) h['X-API-KEY'] = this.config.api_key;
    return h;
  }

  /** Fetch trending topics for a tier */
  async getTrendingTopics(
    tier: string,
    region?: string,
    limit?: number,
  ): Promise<any[]> {
    const params = new URLSearchParams({
      tier,
      region_code: region ?? 'US',
      limit: String(limit ?? 10),
    });
    const res = await fetch(`${this.baseUrl}/api/b2b/trend-topics?${params}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`CubeInsight API error: ${res.statusText}`);
    return res.json();
  }

  /** Analyze video sentiment */
  async analyzeVideo(video_id: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/analyze_video?video_id=${encodeURIComponent(video_id)}`,
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`CubeInsight analysis error: ${res.statusText}`);
    return res.json();
  }

  /** Search channels */
  async searchChannels(query: string): Promise<any[]> {
    const res = await fetch(
      `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`,
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`CubeInsight search error: ${res.statusText}`);
    return res.json();
  }
}
