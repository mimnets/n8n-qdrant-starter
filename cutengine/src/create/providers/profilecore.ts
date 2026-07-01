// src/create/providers/profilecore.ts — ProfileCore browser automation provider
//
// Launches anti-detect browser profiles for YouTube upload and metadata management.
// Supports HTTP API and CLI modes.

export interface ProfileCoreConfig {
  host: string;
  port: number;
  mode: 'http' | 'cli';
  cliPath?: string;
}

export class ProfileCoreProvider {
  readonly name = 'profilecore';

  constructor(private config: ProfileCoreConfig) {}

  /** Launch a browser profile for YouTube upload */
  async launchProfile(
    profileId: string,
    url?: string,
  ): Promise<{ sessionId: string; status: string }> {
    if (this.config.mode === 'http') {
      const res = await fetch(
        `http://${this.config.host}:${this.config.port}/api/launch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileId,
            url: url ?? 'https://studio.youtube.com',
          }),
        },
      );
      if (!res.ok) throw new Error(`ProfileCore launch error: ${res.statusText}`);
      return res.json();
    }

    // CLI mode fallback — uses execFileSync to avoid shell injection
    const { execFileSync } = await import('child_process');
    const cliPath = this.config.cliPath ?? '.';
    const args = [
      `${cliPath}/src/index.js`,
      'launch',
      profileId,
      ...(url ? ['--url', url] : []),
      '--headless',
    ];
    execFileSync('node', args, { encoding: 'utf-8' });
    return { sessionId: profileId, status: 'launched' };
  }

  /** Close a browser profile */
  async closeProfile(profileId: string): Promise<void> {
    if (this.config.mode === 'http') {
      const res = await fetch(
        `http://${this.config.host}:${this.config.port}/api/close`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId }),
        },
      );
      if (!res.ok) throw new Error(`ProfileCore close error: ${res.statusText}`);
    }
  }

  /** Get profile/proxy health status */
  async getHealth(tier?: string): Promise<any> {
    if (this.config.mode === 'http') {
      const qs = tier ? `?tier=${tier}` : '';
      const res = await fetch(
        `http://${this.config.host}:${this.config.port}/api/health${qs}`,
      );
      if (!res.ok) throw new Error(`ProfileCore health error: ${res.statusText}`);
      return res.json();
    }
    return { status: 'cli-mode', message: 'Use CLI directly for health checks' };
  }

  /** List profiles, optionally filtered by tier */
  async listProfiles(tier?: string): Promise<any[]> {
    if (this.config.mode === 'http') {
      const qs = tier ? `?tier=${tier}` : '';
      const res = await fetch(
        `http://${this.config.host}:${this.config.port}/api/list${qs}`,
      );
      if (!res.ok) throw new Error(`ProfileCore list error: ${res.statusText}`);
      return res.json();
    }
    return [];
  }
}
