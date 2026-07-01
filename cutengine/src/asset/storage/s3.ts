import type { StorageDriver } from './local.js';

export class S3Storage implements StorageDriver {
  async save(_id: string, _filename: string, _data: Buffer): Promise<string> {
    throw new Error('S3 storage is not configured. Install @aws-sdk/client-s3 and provide S3 credentials.');
  }

  async get(_id: string, _filename: string): Promise<Buffer | null> {
    throw new Error('S3 storage is not configured.');
  }

  async delete(_id: string): Promise<void> {
    throw new Error('S3 storage is not configured.');
  }

  getUrl(_id: string, _filename: string): string {
    throw new Error('S3 storage is not configured.');
  }

  async exists(_id: string, _filename: string): Promise<boolean> {
    throw new Error('S3 storage is not configured.');
  }
}
