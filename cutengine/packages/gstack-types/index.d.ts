// Stub types for @gstack/types - private monorepo package
export interface BrowserProfile {
  id: string; name: string; sessionKey?: string; cookies?: any[];
  proxy?: any; platform?: string; [key: string]: any;
}

export interface ServiceHealth {
  status: string; uptime?: number; version?: string; [key: string]: any;
}

export interface ModelSlot { name: string; vram: number; [key: string]: any; }

export interface GPUStatus {
  available: boolean; totalVram: number; current_model: ModelSlot | null;
  resident_models: ModelSlot[]; vram_used_gb: any; vram_total_gb: number;
  is_swapping: boolean; swap_queue_depth: number; [key: string]: any;
}

export interface GenerateRequest {
  prompt: string; type?: string; style?: string; [key: string]: any;
}

export interface GenerateProvider {
  name: string; generate(req: GenerateRequest): Promise<any>; [key: string]: any;
}

export type ProviderName = string;

export interface VisualCoreConfig { [key: string]: any; }

export interface GenerateResponse { images: string[]; [key: string]: any; }
export function resolveDimensions(req: any): { width: number; height: number };

export interface QCResult { score: number; passed: boolean; [key: string]: any; }
export interface QCScores { overall: number; [key: string]: any; }

export interface ModelInfo { name: string; vram: number; [key: string]: any; }
