import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { FileRole, FileStatus, TrackStatus } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import ffmpeg from "fluent-ffmpeg";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { randomUUID } from "crypto";

// Number of amplitude peaks to generate for the waveform visualisation
const WAVEFORM_PEAKS = 200;

@Injectable()
export class TranscodingService {
  private readonly logger = new Logger(TranscodingService.name);
  private readonly storageProvider: "local" | "s3";
  private readonly localUploadDir: string;
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string;
  private readonly s3Region: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.storageProvider = this.config.get<"local" | "s3">("storage.provider", "local");
    this.localUploadDir = this.config.get<string>("storage.localUploadDir", "./uploads");
    this.s3Bucket = this.config.get<string>("storage.s3Bucket", "");
    this.s3Region = this.config.get<string>("storage.s3Region", "us-east-1");

    if (this.storageProvider === "s3") {
      this.s3Client = new S3Client({
        region: this.s3Region,
        credentials: {
          accessKeyId: this.config.get<string>("storage.awsAccessKeyId", ""),
          secretAccessKey: this.config.get<string>("storage.awsSecretAccessKey", ""),
        },
      });
    } else {
      this.s3Client = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC API - called fire-and-forget after upload
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run post-upload processing for a track:
   *  1. Read the original audio from storage into a temp file
   *  2. Transcode to 128 kbps MP3
   *  3. Generate waveform peaks
   *  4. Upload the transcoded file back to storage
   *  5. Update DB: status -> FINISHED, store TrackFile + waveformData
   *
   * On any error the track is marked FAILED.
   */
  async processTrack(trackId: string, originalStorageKey: string): Promise<void> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "iqa3-"));
    const inputPath = path.join(tmpDir, "input");
    const outputPath = path.join(tmpDir, "output.mp3");

    try {
      // 1 - Fetch original file to a temp location
      await this.downloadToTemp(originalStorageKey, inputPath);

      // 2 - Transcode to 128 kbps MP3
      const durationMs = await this.transcode(inputPath, outputPath);

      // 3 - Generate waveform peaks from the transcoded file
      const waveformData = await this.generateWaveform(outputPath);

      // 4 - Upload transcoded file to storage
      const transcodedKey = `tracks/${randomUUID()}.mp3`;
      const transcodedBuffer = await fs.promises.readFile(outputPath);
      await this.uploadBuffer(transcodedBuffer, transcodedKey, "audio/mpeg");

      const fileSizeBytes = transcodedBuffer.length;

      // 5 - Update DB in a transaction
      await this.prisma.$transaction(async (tx) => {
        await tx.track.update({
          where: { id: trackId },
          data: {
            status: TrackStatus.FINISHED,
            durationMs: durationMs > 0 ? Math.round(durationMs) : null,
            waveformData,
          },
        });

        await tx.trackFile.create({
          data: {
            trackId,
            fileRole: FileRole.STREAM,
            storageKey: transcodedKey,
            mimeType: "audio/mpeg",
            format: "mp3",
            bitrateKbps: 128,
            fileSizeBytes: BigInt(fileSizeBytes),
            status: FileStatus.READY,
            isCurrent: true,
          },
        });
      });

      this.logger.log(`Track ${trackId} processed successfully.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Track ${trackId} processing failed: ${message}`);

      // Mark track as FAILED - never throw so the caller's catch-all also stays clean
      await this.prisma.track
        .update({
          where: { id: trackId },
          data: { status: TrackStatus.FAILED },
        })
        .catch((dbErr) => this.logger.error(`Failed to mark track ${trackId} as FAILED: ${dbErr}`));
    } finally {
      // Cleanup temp directory
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TRANSCODE - 128 kbps MP3
  // ──────────────────────────────────────────────────────────────────────────

  private transcode(inputPath: string, outputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let durationMs = 0;

      ffmpeg(inputPath)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .format("mp3")
        .on("codecData", (data: { duration?: string }) => {
          // duration string is "HH:MM:SS.ms"
          if (data.duration) {
            const parts = data.duration.split(":");
            if (parts.length === 3) {
              const hours = parseFloat(parts[0]);
              const minutes = parseFloat(parts[1]);
              const seconds = parseFloat(parts[2]);
              durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
            }
          }
        })
        .on("error", (err: Error) => reject(err))
        .on("end", () => resolve(durationMs))
        .save(outputPath);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WAVEFORM - extract amplitude peaks via ffmpeg raw PCM
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Extracts amplitude peaks from an audio file by decoding to raw 16-bit PCM
   * via ffmpeg, then downsampling into `WAVEFORM_PEAKS` buckets.
   * Returns normalised float values between 0 and 1.
   */
  private generateWaveform(audioPath: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      ffmpeg(audioPath)
        .format("s16le") // raw signed 16-bit little-endian PCM
        .audioChannels(1) // mono
        .audioFrequency(8000) // 8 kHz is enough for peaks
        .on("error", (err: Error) => reject(err))
        .on("end", () => {
          try {
            const pcm = Buffer.concat(chunks);
            const peaks = this.extractPeaks(pcm, WAVEFORM_PEAKS);
            resolve(peaks);
          } catch (err) {
            reject(err);
          }
        })
        .pipe()
        .on("data", (chunk: Buffer) => chunks.push(chunk));
    });
  }

  /**
   * Downsample a raw 16-bit PCM buffer into `numPeaks` normalised peaks (0..1).
   */
  private extractPeaks(pcm: Buffer, numPeaks: number): number[] {
    const sampleCount = Math.floor(pcm.length / 2); // 2 bytes per 16-bit sample
    if (sampleCount === 0) return new Array(numPeaks).fill(0);

    const samplesPerPeak = Math.max(1, Math.floor(sampleCount / numPeaks));
    const peaks: number[] = [];

    for (let i = 0; i < numPeaks; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, sampleCount);
      let max = 0;

      for (let j = start; j < end; j++) {
        const sample = Math.abs(pcm.readInt16LE(j * 2));
        if (sample > max) max = sample;
      }

      // Normalise to 0..1 (Int16 range is -32768..32767)
      peaks.push(Math.round((max / 32767) * 1000) / 1000);
    }

    return peaks;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STORAGE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /** Download from S3 or local storage into a temp file */
  private async downloadToTemp(storageKey: string, destPath: string): Promise<void> {
    if (this.storageProvider === "s3") {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const response = await this.s3Client!.send(
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: storageKey }),
      );
      const stream = response.Body as NodeJS.ReadableStream;
      const fileStream = fs.createWriteStream(destPath);
      await new Promise<void>((resolve, reject) => {
        stream.pipe(fileStream);
        fileStream.on("finish", resolve);
        fileStream.on("error", reject);
      });
    } else {
      const fullPath = path.join(this.localUploadDir, storageKey);
      await fs.promises.copyFile(fullPath, destPath);
    }
  }

  /** Upload buffer back to S3 or local storage */
  private async uploadBuffer(buffer: Buffer, storageKey: string, mimeType: string): Promise<void> {
    if (this.storageProvider === "s3") {
      await this.s3Client!.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: mimeType,
          // Protected audio — do not allow CDN/browser caching. Presigned URLs
          // are only effective when the underlying object is not publicly cached.
          CacheControl: "private, no-cache",
        }),
      );
    } else {
      const fullPath = path.join(this.localUploadDir, storageKey);
      const resolvedUploadDir = path.resolve(this.localUploadDir);
      const resolvedFilePath = path.resolve(fullPath);
      if (!resolvedFilePath.startsWith(resolvedUploadDir)) {
        throw new Error("Invalid storage path.");
      }
      await fs.promises.mkdir(path.dirname(resolvedFilePath), {
        recursive: true,
      });
      await fs.promises.writeFile(resolvedFilePath, buffer);
    }
  }
}
