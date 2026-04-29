import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";

import { Public } from "../../common/decorators/public.decorator";
import { BffService } from "../bff.service";

class ProfilePageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

@ApiTags("BFF")
@Controller("pages")
export class PageProfileController {
  constructor(private readonly bffService: BffService) {}

  /**
   * GET /api/v1/pages/profile/:handle
   *
   * Aggregated profile page data: profile, tracks (page 1), viewer relationship,
   * viewer interactions (liked/reposted track ids), and permissions.
   *
   * Works for guests (no auth cookie) and authenticated users.
   * Private profiles return a gated response for non-owners.
   * Cache: no-store — includes viewer-specific state.
   */
  @ApiOperation({
    summary: "Profile page aggregate data",
    description:
      "Returns everything needed to render a profile page in one request. " +
      "Works for guests (no session) and authenticated users alike. " +
      "Fields: `profile`, paginated `tracks`, `counts` (followers/following/tracks), " +
      "`viewer` (requester summary), `relationship` (isFollowing/isBlocked), " +
      "`viewerInteractions` (likedTrackIds / repostedTrackIds), and `permissions`. " +
      "Private profiles return an empty tracks list and `canViewPrivateTracks: false` for non-owners.",
  })
  @ApiCookieAuth("access_token")
  @ApiBearerAuth()
  @ApiParam({
    name: "handle",
    description: "Public handle of the target user (e.g. `alice`).",
    example: "alice",
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Track page number (default: 1).",
    example: 1,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Tracks per page, max 50 (default: 10).",
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: "Profile page payload returned successfully.",
    schema: {
      example: {
        viewer: { id: "uuid", handle: "bob", displayName: "Bob", avatarUrl: null, accountType: "LISTENER" },
        profile: {
          id: "uuid",
          handle: "alice",
          display_name: "Alice",
          bio: "Producer & DJ",
          avatarUrl: null,
          coverPhotoUrl: null,
          account_type: "ARTIST",
          is_private: false,
          followers_count: 120,
          following_count: 45,
          track_count: 8,
        },
        tracks: {
          items: [],
          page: 1,
          limit: 10,
          total: 8,
          hasMore: false,
        },
        counts: { followers: 120, following: 45, tracks: 8 },
        relationship: {
          isFollowing: false,
          isBlocked: false,
          isBlockedBy: false,
          canMessage: true,
        },
        viewerInteractions: { likedTrackIds: ["uuid"], repostedTrackIds: [] },
        permissions: { canEditProfile: false, canViewPrivateTracks: false },
      },
    },
  })
  @ApiResponse({ status: 404, description: "No profile found for the given handle." })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Get("profile/:handle")
  async getProfilePage(
    @Param("handle") handle: string,
    @Query() query: ProfilePageQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requesterId: string | undefined = (req.user as any)?.userId;
    res.setHeader("Cache-Control", "no-store, private");
    return this.bffService.getProfilePageData(
      handle,
      requesterId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }
}
