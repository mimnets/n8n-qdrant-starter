import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { config } from '../../config/index.js';

export interface StorageDriver {
  save(id: string, filename: string, data: Buffer): Promise<string>;
  get(id: string, filename: string): Promise<Buffer | null>;
  delete(id: string): Promise<void>;
  getUrl(id: string, filename: string): string;
  exists(id: string, filename: string): Promise<boolean>;
}

export class LocalStorage implements StorageDriver {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? config.storage.path;
  }

  async save(id: string, filename: string, data: Buffer): Promise<string> {
    const filePath = join(this.basePath, id, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, data);
    return this.getUrl(id, filename);
  }

  async get(id: string, filename: string): Promise<Buffer | null> {
    const filePath = join(this.basePath, id, filename);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath);
  }

  async delete(id: string): Promise<void> {
    const dirPath = join(this.basePath, id);
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }

  getUrl(id: string, filename: string): string {
    return `/serve/v1/assets/${id}/${filename}`;
  }

  async exists(id: string, filename: string): Promise<boolean> {
    const filePath = join(this.basePath, id, filename);
    return existsSync(filePath);
  }

  /** Absolute path on disk for a given asset file */
  getFilePath(id: string, filename: string): string {
    return join(this.basePath, id, filename);
  }
}
