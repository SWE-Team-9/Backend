import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type UploadType = 'avatar' | 'cover';

export interface UploadResult {
  url: string;
  key: string;
}

interface UploadMetadata {
  userId: string;
  type: UploadType;
  mimeType: string;
  originalName: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Map mime type to a safe file extension - never derive from user input
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Abstracts local-disk and S3 behind a single upload/delete interface.
// Switch providers via STORAGE_PROVIDER='local'|'s3' - cannot change at runtime.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: 'local' | 's3';
  private readonly localUploadDir: string;
  private readonly localUploadUrl: string;
  private readonly maxAvatarBytes: number;
  private readonly maxCoverBytes: number;
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string;
  private readonly cdnUrl: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<'local' | 's3'>('storage.provider', 'local');
    this.localUploadDir = this.config.get<string>('storage.localUploadDir', './uploads');
    this.localUploadUrl = this.config.get<string>(
      'storage.localUploadUrl',
      'http://localhost:3000/uploads',
    );
    this.maxAvatarBytes = this.config.get<number>('storage.maxAvatarBytes', 5 * 1024 * 1024);
    this.maxCoverBytes = this.config.get<number>('storage.maxCoverBytes', 15 * 1024 * 1024);
    this.s3Bucket = this.config.get<string>('storage.s3Bucket', '');
    this.cdnUrl = this.config.get<string>('storage.cdnUrl', '');

    if (this.provider === 's3') {
      this.s3Client = new S3Client({
        region: this.config.get<string>('storage.s3Region', 'us-east-1'),
        credentials: {
          accessKeyId: this.config.get<string>('storage.awsAccessKeyId', ''),
          secretAccessKey: this.config.get<string>('storage.awsSecretAccessKey', ''),
        },
      });
    } else {
      this.s3Client = null;
    }
  }

  // Throws before any I/O if mime or size is invalid.
  // Key format: {type}/{uuid}.{ext} - callers hold the key for later deletion.
  async upload(file: Buffer, metadata: UploadMetadata): Promise<UploadResult> {
    this.validateMimeType(metadata.mimeType);
    this.validateFileSize(file.length, metadata.type);

    const ext = MIME_TO_EXT[metadata.mimeType];
    const key = `${metadata.type}/${randomUUID()}.${ext}`;

    if (this.provider === 's3') {
      return this.uploadToS3(file, key, metadata.mimeType);
    }
    return this.uploadToLocal(file, key);
  }

  // Errors are swallowed - do not depend on this completing successfully.
  async delete(key: string): Promise<void> {
    if (!key) return;

    try {
      if (this.provider === 's3') {
        await this.deleteFromS3(key);
      } else {
        this.deleteFromLocal(key);
      }
    } catch (err) {
      // Deletion failures are non-critical - log and move on so the
      // caller's request isn't blocked by a stale-asset cleanup issue.
      this.logger.warn(`Failed to delete storage key "${key}": ${err}`);
    }
  }

  private async uploadToS3(file: Buffer, key: string, mimeType: string): Promise<UploadResult> {
    if (!this.s3Client) {
      throw new InternalServerErrorException('S3 client not initialised.');
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
        Body: file,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const baseUrl = this.cdnUrl || `https://${this.s3Bucket}.s3.amazonaws.com`;
    return { url: `${baseUrl}/${key}`, key };
  }

  private async deleteFromS3(key: string): Promise<void> {
    if (!this.s3Client) return;

    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.s3Bucket, Key: key }),
    );
  }

  private async uploadToLocal(file: Buffer, key: string): Promise<UploadResult> {
    const fullPath = path.join(this.localUploadDir, key);
    const dir = path.dirname(fullPath);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, file);

    const url = `${this.localUploadUrl}/${key}`;
    return { url, key };
  }

  private deleteFromLocal(key: string): void {
    const fullPath = path.join(this.localUploadDir, key);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  private validateMimeType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        `Unsupported image type "${mimeType}". Allowed: jpeg, png, webp.`,
      );
    }
  }

  private validateFileSize(bytes: number, type: UploadType): void {
    const limit = type === 'avatar' ? this.maxAvatarBytes : this.maxCoverBytes;
    if (bytes > limit) {
      const limitMb = (limit / (1024 * 1024)).toFixed(0);
      throw new BadRequestException(
        `File exceeds the ${limitMb} MB limit for ${type} images.`,
      );
    }
  }
}
