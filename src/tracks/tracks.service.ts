import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../common/storage/storage.service";

import { FileRole, FileStatus, Prisma, TrackStatus, TrackVisibility } from "@prisma/client";
import { nanoid } from "nanoid";
import { CreateTrackDto } from "./dto/create-track.dto";
import { UpdateTrackDto } from "./dto/update-track.dto";
import { TranscodingCallbackDto } from "./dto/transcoding-callback.dto";
import { TranscodingService } from "./transcoding.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// ──────────────────────────────────────────────────────────────────────────────
// Audio file validation
// ──────────────────────────────────────────────────────────────────────────────

/** Only allow real audio files - validated by magic bytes, not extension */
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", // MP3
  "audio/wav", // WAV
  "audio/wave", // WAV alternate
  "audio/x-wav", // WAV alternate
]);

/** Magic byte signatures for audio formats */
const AUDIO_SIGNATURES: Array<{
  bytes: number[];
  offset: number;
  mime: string;
}> = [
  // MP3 - ID3 tag header
  { bytes: [0x49, 0x44, 0x33], offset: 0, mime: "audio/mpeg" },
  // MP3 - frame sync (0xFF 0xFB / 0xFF 0xFA / 0xFF 0xF3 / 0xFF 0xF2)
  { bytes: [0xff, 0xfb], offset: 0, mime: "audio/mpeg" },
  { bytes: [0xff, 0xfa], offset: 0, mime: "audio/mpeg" },
  { bytes: [0xff, 0xf3], offset: 0, mime: "audio/mpeg" },
  { bytes: [0xff, 0xf2], offset: 0, mime: "audio/mpeg" },
  // WAV - RIFF....WAVE
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: "audio/wav" },
];

function isValidAudioFile(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return AUDIO_SIGNATURES.some((sig) => {
    if (buffer.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((b, i) => buffer[sig.offset + i] === b);
  });
}

/** Max file size: 250 MB */
const MAX_AUDIO_SIZE_BYTES = 250 * 1024 * 1024;

// ──────────────────────────────────────────────────────────────────────────────
// Slug helper
// ──────────────────────────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

const CANONICAL_GENRE_NAMES: Record<string, string> = {
  electronic: "Electronic",
  "hip-hop": "Hip-Hop",
  pop: "Pop",
  rock: "Rock",
  alternative: "Alternative",
  ambient: "Ambient",
  classical: "Classical",
  jazz: "Jazz",
  "r-b-soul": "R&B / Soul",
  metal: "Metal",
  "folk-singer-songwriter": "Folk / Singer-Songwriter",
  country: "Country",
  reggaeton: "Reggaeton",
  dancehall: "Dancehall",
  "drum-bass": "Drum & Bass",
  house: "House",
  techno: "Techno",
  "deep-house": "Deep House",
  trance: "Trance",
  "lo-fi": "Lo-Fi",
  indie: "Indie",
  punk: "Punk",
  blues: "Blues",
  latin: "Latin",
  afrobeat: "Afrobeat",
  trap: "Trap",
  experimental: "Experimental",
  world: "World",
  gospel: "Gospel",
  "spoken-word": "Spoken Word",
  quran: "Quran",
  sha3by: "Sha3by",
  islamic: "Islamic",
};

const CANONICAL_GENRE_SLUGS = new Set(Object.keys(CANONICAL_GENRE_NAMES));

// ──────────────────────────────────────────────────────────────────────────────
// Select objects - control exactly what leaves the service
// ──────────────────────────────────────────────────────────────────────────────

/** Fields returned for a full track detail */
const TRACK_DETAIL_SELECT = {
  id: true,
  title: true,
  slug: true,
  description: true,
  releaseDate: true,
  durationMs: true,
  waveformData: true,
  visibility: true,
  accessLevel: true,
  status: true,
  license: true,
  allowComments: true,
  downloadable: true,
  coverArtUrl: true,
  secretToken: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  uploader: {
    select: {
      id: true,
      profile: {
        select: {
          displayName: true,
          handle: true,
          avatarUrl: true,
        },
      },
    },
  },
  primaryGenre: {
    select: { id: true, name: true, slug: true },
  },
  tags: {
    select: {
      tag: { select: { name: true, slug: true } },
    },
  },
  files: {
    where: { isCurrent: true },
    select: {
      id: true,
      fileRole: true,
      mimeType: true,
      format: true,
      fileSizeBytes: true,
      status: true,
    },
  },
  _count: {
    select: {
      likes: true,
      reposts: true,
    },
  },
} as const;

/** Lightweight fields for list views */
const TRACK_LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  durationMs: true,
  waveformData: true,
  visibility: true,
  status: true,
  coverArtUrl: true,
  createdAt: true,
  uploader: {
    select: {
      id: true,
      profile: {
        select: {
          displayName: true,
          handle: true,
          avatarUrl: true,
        },
      },
    },
  },
  primaryGenre: {
    select: { name: true },
  },
  _count: {
    select: {
      likes: true,
      reposts: true,
    },
  },
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);
  private readonly storageProvider: "local" | "s3";
  private readonly localUploadDir: string;
  private readonly localUploadUrl: string;
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly cdnUrl: string;
  private readonly transcodingApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly transcodingService: TranscodingService,
    private readonly storageService: StorageService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    this.storageProvider = this.config.get<"local" | "s3">("storage.provider", "local");
    this.localUploadDir = this.config.get<string>("storage.localUploadDir", "./uploads");
    this.localUploadUrl = this.config.get<string>(
      "storage.localUploadUrl",
      "http://localhost:3000/uploads",
    );
    this.s3Bucket = this.config.get<string>("storage.s3Bucket", "");
    this.s3Region = this.config.get<string>("storage.s3Region", "us-east-1");
    this.cdnUrl = this.config.get<string>("storage.cdnUrl", "");
    this.transcodingApiKey = this.config.get<string>("app.transcodingApiKey", "");

    if (this.storageProvider === "s3") {
      const accessKeyId = this.config.get<string>("storage.awsAccessKeyId", "");
      const secretAccessKey = this.config.get<string>("storage.awsSecretAccessKey", "");
      this.s3Client = new S3Client({
        region: this.s3Region,
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
    } else {
      this.s3Client = null;
    }
  }

  private async resolveGenreId(input: string): Promise<number | null> {
    const normalizedInput = input.trim();
    const normalizedSlug = slugify(normalizedInput);

    // Frontend dropdown includes "None" as a sentinel for no genre.
    if (!normalizedSlug || normalizedSlug === "none") {
      return null;
    }

    const existingGenre = await this.prisma.genre.findFirst({
      where: {
        OR: [
          { name: { equals: normalizedInput, mode: "insensitive" } },
          { slug: { equals: normalizedSlug, mode: "insensitive" } },
        ],
      },
    });

    if (existingGenre) {
      return existingGenre.id;
    }

    if (!CANONICAL_GENRE_SLUGS.has(normalizedSlug)) {
      throw new BadRequestException(`Genre "${input}" not found.`);
    }

    // Auto-heal environments where seed data is incomplete.
    const ensuredGenre = await this.prisma.genre.upsert({
      where: { slug: normalizedSlug },
      update: {},
      create: {
        slug: normalizedSlug,
        name: CANONICAL_GENRE_NAMES[normalizedSlug] ?? normalizedInput,
      },
      select: { id: true },
    });

    this.logger.warn(
      `Missing canonical genre "${normalizedSlug}" was auto-created during track write.`,
    );

    return ensuredGenre.id;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UPLOAD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Upload a new audio track.
   *
   * 1. Validates the file (magic bytes + size)
   * 2. Stores the original file (S3 or local)
   * 3. Creates DB records: Track + TrackFile
   * 4. Returns the new track with status=PROCESSING
   */
  async uploadTrack(
    userId: string,
    dto: CreateTrackDto,
    file: Express.Multer.File,
    coverArtFile?: Express.Multer.File,
  ) {
    // --- upload quota guard ---
    const { uploadLimit, uploadedCount } = await this.subscriptionsService.getUploadQuota(userId);
    if (uploadedCount >= uploadLimit) {
      throw new ForbiddenException({
        code: "UPLOAD_LIMIT_REACHED",
        message: "You have reached your upload limit. Upgrade your plan to upload more tracks.",
      });
    }

    // --- validate the file ---
    if (!file?.buffer) {
      throw new BadRequestException("Audio file is required.");
    }
    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_AUDIO_SIZE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    if (!isValidAudioFile(file.buffer)) {
      throw new BadRequestException("Invalid audio file. Only MP3 and WAV files are accepted.");
    }

    // --- resolve genre (optional) ---
    let genreId: number | null = null;
    if (dto.genre) {
      genreId = await this.resolveGenreId(dto.genre);
    }

    // --- upload audio to storage ---
    const mimeType = AUDIO_MIME_TYPES.has(file.mimetype) ? file.mimetype : "audio/mpeg";
    const ext = mimeType.includes("wav") ? "wav" : "mp3";
    const storageKey = `tracks/${randomUUID()}.${ext}`;
    try {
      await this.uploadAudioFile(file.buffer, storageKey, mimeType);
    } catch (err) {
      this.logger.error(
        `Audio upload to storage failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new BadRequestException("Failed to upload audio file. Please try again.");
    }

    // --- upload cover art if provided ---
    let coverArtUrl: string | null = null;
    if (coverArtFile?.buffer) {
      const coverResult = await this.storageService.upload(coverArtFile.buffer, {
        userId,
        type: "cover",
        mimeType: coverArtFile.mimetype,
        originalName: coverArtFile.originalname,
      });
      coverArtUrl = coverResult.url;
    }

    // --- create DB records in a transaction ---
    const slug = slugify(dto.title);
    const secretToken = nanoid(24);

    const track = await this.prisma.$transaction(async (tx) => {
      const newTrack = await tx.track.create({
        data: {
          uploaderId: userId,
          title: dto.title,
          slug,
          description: dto.description ?? null,
          releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null,
          visibility: TrackVisibility.PRIVATE,
          status: TrackStatus.PROCESSING,
          secretToken,
          primaryGenreId: genreId,
          ...(coverArtUrl ? { coverArtUrl } : {}),
        },
      });

      // store original file reference
      await tx.trackFile.create({
        data: {
          trackId: newTrack.id,
          fileRole: FileRole.ORIGINAL,
          storageKey,
          mimeType,
          fileSizeBytes: BigInt(file.size),
          status: FileStatus.READY,
          isCurrent: true,
        },
      });

      // handle tags
      if (dto.tags && dto.tags.length > 0) {
        await this.upsertTags(tx, newTrack.id, dto.tags);
      }

      return newTrack;
    });

    // Fire transcoding in the background - never await so the upload response
    // returns immediately with status=PROCESSING.
    this.transcodingService
      .processTrack(track.id, storageKey)
      .catch((err) =>
        this.logger.error(`Background processing for track ${track.id} failed: ${err}`),
      );

    return this.formatTrackResponse(track, null);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET TRACK DETAILS
  // ──────────────────────────────────────────────────────────────────────────

  async getTrackById(trackId: string, requesterId?: string) {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, deletedAt: null },
      select: TRACK_DETAIL_SELECT,
    });

    if (!track) {
      throw new NotFoundException("Track not found.");
    }

    // Private tracks: only the owner can see them (unless via secret token)
    if (track.visibility === TrackVisibility.PRIVATE && track.uploader.id !== requesterId) {
      throw new NotFoundException("Track not found.");
    }

    const base = this.formatDetailResponse(track);

    if (!requesterId) return base;

    const [likeRecord, repostRecord] = await Promise.all([
      this.prisma.like.findUnique({
        where: { userId_trackId: { userId: requesterId, trackId } },
        select: { id: true },
      }),
      this.prisma.repost.findUnique({
        where: { userId_trackId: { userId: requesterId, trackId } },
        select: { id: true },
      }),
    ]);

    return {
      ...base,
      liked: Boolean(likeRecord),
      reposted: Boolean(repostRecord),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET TRACK STATUS (lightweight polling)
  // ──────────────────────────────────────────────────────────────────────────

  async getTrackStatus(trackId: string, requesterId?: string) {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, deletedAt: null },
      select: { id: true, status: true, uploaderId: true, visibility: true },
    });
    if (!track) {
      throw new NotFoundException("Track not found.");
    }
    if (track.visibility === TrackVisibility.PRIVATE && track.uploaderId !== requesterId) {
      throw new NotFoundException("Track not found.");
    }
    return { trackId: track.id, status: track.status };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE TRACK METADATA
  // ──────────────────────────────────────────────────────────────────────────

  async updateTrack(
    trackId: string,
    userId: string,
    dto: UpdateTrackDto,
    coverArtFile?: Express.Multer.File,
  ) {
    const track = await this.findOwnedTrack(trackId, userId);

    // Block edits while the track is still being processed
    const fullTrack = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: { status: true },
    });
    if (fullTrack?.status === TrackStatus.PROCESSING) {
      throw new ConflictException("Cannot edit track while it is still processing.");
    }

    // Resolve genre if changing
    let genreId: number | null | undefined;
    if (dto.genre !== undefined) {
      if (dto.genre === null || dto.genre === "") {
        genreId = null;
      } else {
        genreId = await this.resolveGenreId(dto.genre);
      }
    }

    let coverArtUrl: string | undefined;
    if (coverArtFile?.buffer) {
      const coverResult = await this.storageService.upload(coverArtFile.buffer, {
        userId,
        type: "cover",
        mimeType: coverArtFile.mimetype,
        originalName: coverArtFile.originalname,
      });
      coverArtUrl = coverResult.url;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.TrackUpdateInput = {};
      if (dto.title !== undefined) {
        data.title = dto.title;
        data.slug = slugify(dto.title);
      }
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.releaseDate !== undefined) {
        data.releaseDate = dto.releaseDate ? new Date(dto.releaseDate) : null;
      }
      if (genreId !== undefined) {
        data.primaryGenre = genreId ? { connect: { id: genreId } } : { disconnect: true };
      }
      if (coverArtUrl !== undefined) {
        data.coverArtUrl = coverArtUrl;
      }

      const updatedTrack = await tx.track.update({
        where: { id: trackId },
        data,
        select: TRACK_DETAIL_SELECT,
      });

      // Update tags if provided
      if (dto.tags !== undefined) {
        await tx.trackTag.deleteMany({ where: { trackId } });
        if (dto.tags.length > 0) {
          await this.upsertTags(tx, trackId, dto.tags);
        }
      }

      return updatedTrack;
    });

    return this.formatDetailResponse(updated);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE TRACK (soft-delete)
  // ──────────────────────────────────────────────────────────────────────────

  async deleteTrack(trackId: string, userId: string, userRole: string) {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, deletedAt: null },
      select: { id: true, uploaderId: true },
    });
    if (!track) {
      throw new NotFoundException("Track not found.");
    }

    // Owner or admin can delete
    if (track.uploaderId !== userId && userRole !== "ADMIN") {
      throw new ForbiddenException("You do not have permission to delete this track.");
    }

    await this.prisma.track.update({
      where: { id: trackId },
      data: { deletedAt: new Date() },
    });

    // Schedule file cleanup in background (fire and forget)
    this.cleanupTrackFiles(trackId).catch((err) =>
      this.logger.warn(`Failed to cleanup files for track ${trackId}: ${err.message}`),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CHANGE VISIBILITY
  // ──────────────────────────────────────────────────────────────────────────

  async changeVisibility(trackId: string, userId: string, visibility: TrackVisibility) {
    const track = await this.findOwnedTrack(trackId, userId);

    const data: Prisma.TrackUpdateInput = { visibility };

    // Regenerate secret token when switching to PRIVATE
    if (visibility === TrackVisibility.PRIVATE) {
      data.secretToken = nanoid(24);
    }

    // Set publishedAt when first going PUBLIC
    if (visibility === TrackVisibility.PUBLIC && !track.publishedAt) {
      data.publishedAt = new Date();
    }

    const updated = await this.prisma.track.update({
      where: { id: trackId },
      data,
      select: TRACK_DETAIL_SELECT,
    });

    return this.formatDetailResponse(updated);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET USER'S TRACKS
  // ──────────────────────────────────────────────────────────────────────────

  async getUserTracks(
    targetUserId: string,
    requesterId: string | undefined,
    page: number,
    limit: number,
  ) {
    const isOwner = targetUserId === requesterId;

    const where: Prisma.TrackWhereInput = {
      uploaderId: targetUserId,
      deletedAt: null,
      // Non-owners only see public & finished tracks
      ...(!isOwner && {
        visibility: TrackVisibility.PUBLIC,
        status: TrackStatus.FINISHED,
      }),
    };

    const [tracks, totalTracks] = await Promise.all([
      this.prisma.track.findMany({
        where,
        select: TRACK_LIST_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.track.count({ where }),
    ]);

    const artist = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        profile: {
          select: { displayName: true, avatarUrl: true },
        },
      },
    });

    return {
      artist: artist
        ? {
            userId: artist.id,
            name: artist.profile?.displayName,
            avatarUrl: artist.profile?.avatarUrl,
          }
        : null,
      page,
      limit,
      totalTracks,
      tracks: tracks.map((t) => this.formatListItem(t)),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WAVEFORM
  // ──────────────────────────────────────────────────────────────────────────

  async getWaveform(trackId: string) {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, deletedAt: null },
      select: { id: true, waveformData: true, status: true },
    });
    if (!track) {
      throw new NotFoundException("Track not found.");
    }
    return { trackId: track.id, waveformData: track.waveformData };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TRANSCODING CALLBACK
  // ──────────────────────────────────────────────────────────────────────────

  async handleTranscodingCallback(apiKey: string, dto: TranscodingCallbackDto) {
    // Validate API key - constant-time comparison to prevent timing attacks
    if (!this.transcodingApiKey) {
      throw new BadRequestException("Transcoding API key is not configured.");
    }

    const keyBuffer = Buffer.from(apiKey);
    const expectedBuffer = Buffer.from(this.transcodingApiKey);
    if (
      keyBuffer.length !== expectedBuffer.length ||
      !require("crypto").timingSafeEqual(keyBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException("Invalid transcoding API key.");
    }

    const track = await this.prisma.track.findUnique({
      where: { id: dto.trackId },
      select: { id: true, status: true },
    });
    if (!track) {
      throw new NotFoundException("Track not found.");
    }
    if (track.status !== TrackStatus.PROCESSING) {
      throw new ConflictException("Track is not in PROCESSING state.");
    }

    const newStatus = dto.status === "FINISHED" ? TrackStatus.FINISHED : TrackStatus.FAILED;

    await this.prisma.$transaction(async (tx) => {
      const trackUpdateData: any = { status: newStatus };
      if (newStatus === TrackStatus.FINISHED) {
        if (dto.waveformData) trackUpdateData.waveformData = dto.waveformData;
        if (dto.durationMs) trackUpdateData.durationMs = Math.round(dto.durationMs);
      }

      await tx.track.update({
        where: { id: dto.trackId },
        data: trackUpdateData,
      });

      // Store generated file references if FINISHED
      if (newStatus === TrackStatus.FINISHED && dto.fileUrls) {
        for (const [format, url] of Object.entries(dto.fileUrls)) {
          const fileRole = format.toLowerCase() === "mp3" ? FileRole.STREAM : FileRole.ORIGINAL;
          await tx.trackFile.create({
            data: {
              trackId: dto.trackId,
              fileRole,
              storageKey: url,
              mimeType: format === "mp3" ? "audio/mpeg" : "audio/wav",
              format,
              status: FileStatus.READY,
              isCurrent: true,
            },
          });
        }
      }
    });

    return { trackId: dto.trackId, status: newStatus };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECRET TOKEN ACCESS
  // ──────────────────────────────────────────────────────────────────────────

  async getTrackBySecretToken(secretToken: string) {
    const track = await this.prisma.track.findFirst({
      where: { secretToken, deletedAt: null },
      select: TRACK_DETAIL_SELECT,
    });
    if (!track) {
      throw new NotFoundException("Track not found or token is invalid.");
    }
    return {
      ...this.formatDetailResponse(track),
      message: "Access granted via secret token",
    };
  }

  async findTrackShareTarget(identifier: string): Promise<{ id: string } | null> {
    return this.prisma.track.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: identifier }, { slug: identifier }],
      },
      select: { id: true },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Finds a track and verifies the requester is the owner.
   * Throws 404 if not found, 403 if not owner.
   */
  private async findOwnedTrack(trackId: string, userId: string) {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, deletedAt: null },
      select: { id: true, uploaderId: true, publishedAt: true },
    });
    if (!track) {
      throw new NotFoundException("Track not found.");
    }
    if (track.uploaderId !== userId) {
      throw new ForbiddenException("You do not have permission to modify this track.");
    }
    return track;
  }

  /** Create or find tags, then link them to the track */
  private async upsertTags(tx: Prisma.TransactionClient, trackId: string, tagNames: string[]) {
    for (const name of tagNames) {
      const slug = slugify(name);
      if (!slug) continue;

      // Upsert the tag
      const tag = await tx.tag.upsert({
        where: { slug },
        create: { name: name.trim().toLowerCase(), slug },
        update: {},
      });

      // Link to track (ignore if already linked)
      await tx.trackTag
        .create({
          data: { trackId, tagId: tag.id },
        })
        .catch(() => {
          // Duplicate key - already linked, ignore
        });
    }
  }

  /** Upload an audio file to S3 or local disk */
  private async uploadAudioFile(
    buffer: Buffer,
    storageKey: string,
    mimeType: string,
  ): Promise<void> {
    if (this.storageProvider === "s3") {
      if (!this.s3Client) {
        throw new BadRequestException("S3 client is not initialized.");
      }
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: mimeType,
          // Audio files are protected content - must not be publicly cached by CDN or
          // browser. Using "private, no-cache" ensures each request goes through
          // presigned-URL authorization, preventing cached delivery after logout.
          CacheControl: "private, no-cache",
        }),
      );
    } else {
      const fullPath = path.join(this.localUploadDir, storageKey);
      const resolvedUploadDir = path.resolve(this.localUploadDir);
      const resolvedFilePath = path.resolve(fullPath);

      // Path traversal protection
      if (!resolvedFilePath.startsWith(resolvedUploadDir)) {
        throw new BadRequestException("Invalid storage path.");
      }

      await fs.promises.mkdir(path.dirname(resolvedFilePath), {
        recursive: true,
      });
      await fs.promises.writeFile(resolvedFilePath, buffer);
    }
  }

  /** Cleanup S3/local files when a track is soft-deleted */
  private async cleanupTrackFiles(trackId: string): Promise<void> {
    const files = await this.prisma.trackFile.findMany({
      where: { trackId },
      select: { storageKey: true },
    });

    for (const file of files) {
      try {
        if (this.storageProvider === "s3" && this.s3Client) {
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: this.s3Bucket,
              Key: file.storageKey,
            }),
          );
        } else {
          const fullPath = path.join(this.localUploadDir, file.storageKey);
          const resolvedUploadDir = path.resolve(this.localUploadDir);
          const resolvedFilePath = path.resolve(fullPath);
          if (resolvedFilePath.startsWith(resolvedUploadDir) && fs.existsSync(resolvedFilePath)) {
            fs.unlinkSync(resolvedFilePath);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to delete file ${file.storageKey}: ${err}`);
      }
    }
  }

  /** Format a raw track record into the upload response shape */
  private formatTrackResponse(track: any, waveformData: any) {
    return {
      trackId: track.id,
      title: track.title,
      artistId: track.uploaderId,
      status: track.status,
      visibility: track.visibility,
      coverArtUrl: track.coverArtUrl ?? null,
      waveformData: waveformData,
    };
  }

  /** Format a full detail query result */
  private formatDetailResponse(track: any) {
    return {
      trackId: track.id,
      title: track.title,
      slug: track.slug,
      description: track.description,
      artist: track.uploader?.profile?.displayName ?? null,
      artistId: track.uploader?.id ?? null,
      artistHandle: track.uploader?.profile?.handle ?? null,
      artistAvatarUrl: track.uploader?.profile?.avatarUrl ?? null,
      genre: track.primaryGenre?.name ?? null,
      tags: track.tags?.map((t: any) => t.tag?.name ?? t.tag?.slug) ?? [],
      releaseDate: track.releaseDate,
      durationMs: track.durationMs,
      waveformData: track.waveformData,
      visibility: track.visibility,
      accessLevel: track.accessLevel,
      status: track.status,
      license: track.license,
      allowComments: track.allowComments,
      downloadable: track.downloadable,
      coverArtUrl: track.coverArtUrl,
      secretToken: track.secretToken,
      publishedAt: track.publishedAt,
      createdAt: track.createdAt,
      updatedAt: track.updatedAt,
      files:
        track.files?.map((f: any) => ({
          id: f.id,
          role: f.fileRole,
          mimeType: f.mimeType,
          format: f.format,
          size: f.fileSizeBytes ? Number(f.fileSizeBytes) : null,
          status: f.status,
        })) ?? [],
      likesCount: track._count?.likes ?? 0,
      repostsCount: track._count?.reposts ?? 0,
    };
  }

  /** Format a track for list views */
  private formatListItem(track: any) {
    return {
      trackId: track.id,
      title: track.title,
      slug: track.slug,
      durationMs: track.durationMs,
      waveformData: track.waveformData,
      visibility: track.visibility,
      status: track.status,
      coverArtUrl: track.coverArtUrl,
      createdAt: track.createdAt,
      genre: track.primaryGenre?.name ?? null,
      artist: {
        id: track.uploader?.id,
        displayName: track.uploader?.profile?.displayName,
        handle: track.uploader?.profile?.handle,
        avatarUrl: track.uploader?.profile?.avatarUrl,
      },
      likesCount: track._count?.likes ?? 0,
      repostsCount: track._count?.reposts ?? 0,
    };
  }
}
