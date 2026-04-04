import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TracksService {
  constructor(private readonly prisma: PrismaService) {}

  async getTrackById(trackId: string): Promise<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    coverArtUrl: string | null;
    durationMs: number | null;
    status: string;
    publishedAt: Date | null;
    likesCount: number;
    repostsCount: number;
  }> {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        coverArtUrl: true,
        durationMs: true,
        status: true,
        publishedAt: true,
        _count: {
          select: {
            likes: true,
            reposts: true,
          },
        },
      },
    });

    if (!track) {
      throw new NotFoundException({
        code: "TRACK_NOT_FOUND",
        message: "Track not found.",
      });
    }

    return {
      id: track.id,
      title: track.title,
      slug: track.slug,
      description: track.description,
      coverArtUrl: track.coverArtUrl,
      durationMs: track.durationMs,
      status: track.status,
      publishedAt: track.publishedAt,
      likesCount: track._count.likes,
      repostsCount: track._count.reposts,
    };
  }
}
