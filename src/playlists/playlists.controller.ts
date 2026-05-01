import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import { PlaylistsService } from "./playlists.service";
import { PlaylistRecentQueryDto } from "./dto/playlist-recent-query.dto";
import {
  AddTrackToPlaylistDto,
  AddTrackToPlaylistResponseDto,
  CreatePlaylistDto,
  DeletePlaylistParamsDto,
  GetMyPlaylistsResponseDto,
  GetPlaylistDetailsParamsDto,
  GetPlaylistDetailsResponseDto,
  GetPlaylistEditResponseDto,
  GetPlaylistEmbedCodeParamsDto,
  GetPlaylistEmbedCodeQueryDto,
  GetPlaylistEmbedCodeResponseDto,
  GetRecentPlaylistsResponseDto,
  GetTopPlaylistsResponseDto,
  LikePlaylistResponseDto,
  PlaylistPaginationQueryDto,
  PlaylistTracksQueryDto,
  RemoveTrackFromPlaylistParamsDto,
  RemoveTrackFromPlaylistResponseDto,
  ReorderPlaylistTracksDto,
  ResolveSecretPlaylistParamsDto,
  ResolveSecretPlaylistResponseDto,
  UnlikePlaylistResponseDto,
  UpdatePlaylistDto,
  UpdatePlaylistResponseDto,
  UploadPlaylistCoverResponseDto,
} from "./dto";

@Controller("playlists")
@ApiTags("Playlists")
@ApiBearerAuth()
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Create playlist",
    description: "Creates a new playlist (set) for the authenticated user.",
  })
  @ApiBody({ type: CreatePlaylistDto })
  @ApiResponse({
    status: 201,
    description: "Playlist created successfully.",
    schema: {
      example: {
        playlistId: "pl_101",
        title: "Late Night Drive",
        visibility: "PUBLIC",
        secretToken: null,
      },
    },
  })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ThrottlePolicy(15, 60_000)
  create(@CurrentUser("userId") userId: string, @Body() dto: CreatePlaylistDto) {
    return this.playlistsService.create(userId, dto);
  }

  @Get("top")
  @Public()
  @ApiOperation({
    summary: "Get top playlists",
    description: "Returns the top 10 public playlists ordered by likes count.",
  })
  @ApiResponse({
    status: 200,
    description: "Top playlists fetched successfully.",
    type: GetTopPlaylistsResponseDto,
    schema: {
      example: {
        playlists: [
          {
            playlistId: "pl_101",
            title: "Late Night Drive",
            visibility: "PUBLIC",
            likesCount: 48,
          },
        ],
      },
    },
  })
  getTopPlaylists() {
    return this.playlistsService.getTopPlaylists();
  }

  @Get("me")
  @ApiOperation({
    summary: "Get my playlists",
    description: "Returns playlists created by the authenticated user.",
  })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiResponse({
    status: 200,
    description: "Playlists fetched successfully.",
    type: GetMyPlaylistsResponseDto,
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 5,
        playlists: [
          {
            playlistId: "pl_101",
            title: "Late Night Drive",
            visibility: "PUBLIC",
            tracksCount: 12,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  getMyPlaylists(
    @CurrentUser("userId") userId: string,
    @Query() query: PlaylistPaginationQueryDto,
  ) {
    return this.playlistsService.getMyPlaylists(userId, query);
  }

  @Get("secret/:secretToken")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Resolve secret playlist access",
    description: "Allows access to a private/secret playlist via an unguessable tokenized link.",
  })
  @ApiParam({
    name: "secretToken",
    description: "Secret share token for a private playlist",
    example: "sec_9f1d2a3b4c5d6e7f8a9b0c",
  })
  @ApiResponse({
    status: 200,
    description: "Access granted via secret token.",
    type: ResolveSecretPlaylistResponseDto,
    schema: {
      example: {
        playlistId: "pl_101",
        title: "Late Night Drive",
        visibility: "PRIVATE",
        message: "Access granted via secret token",
      },
    },
  })
  @ApiResponse({ status: 404, description: "Secret playlist not found." })
  resolveSecret(@Param() params: ResolveSecretPlaylistParamsDto) {
    return this.playlistsService.resolveSecret(params.secretToken);
  }

  @Get("recent")
  @ApiOperation({
    summary: "Get recently played playlists",
    description: "Returns the most recently played playlists for the authenticated user.",
  })
  @ApiQuery({ name: "limit", required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: "Recently played playlists fetched successfully.",
    type: GetRecentPlaylistsResponseDto,
    schema: {
      example: {
        playlists: [
          {
            playlistId: "pl_101",
            title: "Late Night Drive",
            coverImageUrl: "https://cdn.example.com/playlists/pl_101.jpg",
            owner: {
              id: "usr_1",
              display_name: "Ahmed Hassan",
            },
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ThrottlePolicy(60, 60_000)
  getRecentPlaylists(
    @CurrentUser("userId") userId: string,
    @Query() query: PlaylistRecentQueryDto,
  ) {
    return this.playlistsService.getRecentPlaylists(userId, query.limit);
  }

  @Post(":playlistId/like")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Like playlist",
    description: "Adds the playlist to the authenticated user's liked playlists.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiResponse({
    status: 201,
    description: "Playlist liked successfully.",
    type: LikePlaylistResponseDto,
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(60, 60_000)
  likePlaylist(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
  ) {
    return this.playlistsService.likePlaylist(userId, params.playlistId);
  }

  @Delete(":playlistId/like")
  @ApiOperation({
    summary: "Unlike playlist",
    description: "Removes the playlist from the authenticated user's liked playlists.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiResponse({
    status: 200,
    description: "Playlist unliked successfully.",
    type: UnlikePlaylistResponseDto,
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(60, 60_000)
  unlikePlaylist(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
  ) {
    return this.playlistsService.unlikePlaylist(userId, params.playlistId);
  }

  @Get(":playlistId/embed")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Get playlist embed code",
    description: "Returns a simple iframe embed code for externally sharing a playlist.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiResponse({
    status: 200,
    description: "Playlist embed code generated successfully.",
    type: GetPlaylistEmbedCodeResponseDto,
    schema: {
      example: {
        playlistId: "pl_101",
        embedCode: '<iframe src="https://example.com/embed/playlists/pl_101"></iframe>',
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can access embed code.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(30, 60_000)
  getEmbedCode(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistEmbedCodeParamsDto,
    @Query() query: GetPlaylistEmbedCodeQueryDto,
  ) {
    return this.playlistsService.getEmbedCode(userId, params.playlistId, query);
  }

  @Get(":playlistId/edit")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Get playlist edit data",
    description: "Returns owner-only editable playlist metadata for the edit screen.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiResponse({
    status: 200,
    description: "Editable playlist metadata fetched successfully.",
    type: GetPlaylistEditResponseDto,
    schema: {
      example: {
        playlistId: "pl_101",
        title: "Late Night Drive",
        description: "My favorite chill tracks",
        visibility: "PUBLIC",
        slug: "late-night-drive",
        coverImageUrl: "https://cdn.example.com/playlists/pl_101.jpg",
        type: "PLAYLIST",
        releaseDate: "2026-03-01",
        genreId: 12,
        tags: ["chill", "night-drive"],
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can access edit mode.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(30, 60_000)
  getEditDetails(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
  ) {
    return this.playlistsService.getEditDetails(userId, params.playlistId);
  }

  @Post(":playlistId/cover")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype?.startsWith("image/")) {
          cb(null, true);
          return;
        }

        cb(new BadRequestException("Only image uploads are allowed for playlist covers."), false);
      },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Upload playlist cover image",
    description: "Uploads a new playlist cover image to shared storage and saves the public URL.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Image file (max 5 MB)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Playlist cover uploaded successfully.",
    type: UploadPlaylistCoverResponseDto,
    schema: {
      example: {
        message: "Playlist cover uploaded successfully",
        coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid image file or file too large.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can upload a cover image.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(20, 60_000)
  uploadCover(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.playlistsService.uploadCover(userId, params.playlistId, file);
  }

  @Post(":playlistId/tracks")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Add track to playlist",
    description: "Adds a track to an existing playlist. Owner only.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiBody({
    type: AddTrackToPlaylistDto,
  })
  @ApiResponse({
    status: 201,
    description: "Track added to playlist successfully.",
    type: AddTrackToPlaylistResponseDto,
  })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can add tracks.",
  })
  @ApiResponse({ status: 404, description: "Playlist or track not found." })
  @ApiResponse({
    status: 409,
    description: "Track already exists in playlist.",
  })
  @ThrottlePolicy(60, 60_000)
  addTrack(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: AddTrackToPlaylistDto,
  ) {
    return this.playlistsService.addTrack(userId, params.playlistId, dto);
  }

  @Delete(":playlistId/tracks/:trackId")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Remove track from playlist",
    description: "Removes a track from a playlist. Owner only.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiParam({
    name: "trackId",
    description: "Track identifier",
    example: "trk_123",
  })
  @ApiResponse({
    status: 200,
    description: "Track removed from playlist successfully.",
    type: RemoveTrackFromPlaylistResponseDto,
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can remove tracks.",
  })
  @ApiResponse({
    status: 404,
    description: "Playlist not found or track is not in playlist.",
  })
  @ThrottlePolicy(60, 60_000)
  removeTrack(
    @CurrentUser("userId") userId: string,
    @Param() params: RemoveTrackFromPlaylistParamsDto,
  ) {
    return this.playlistsService.removeTrack(userId, params.playlistId, params.trackId);
  }

  @Patch(":playlistId/reorder")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Reorder playlist tracks",
    description: "Reorders tracks inside a playlist. Owner only.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiBody({
    type: ReorderPlaylistTracksDto,
    schema: {
      example: {
        orderedTrackIds: ["trk_8", "trk_3", "trk_10", "trk_2"],
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Playlist reordered successfully.",
    schema: {
      example: {
        message: "Playlist reordered successfully",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Validation error or invalid reorder payload.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can reorder tracks.",
  })
  @ApiResponse({
    status: 404,
    description: "Playlist not found or some track IDs are invalid.",
  })
  @ThrottlePolicy(40, 60_000)
  reorderTracks(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: ReorderPlaylistTracksDto,
  ) {
    return this.playlistsService.reorderTracks(userId, params.playlistId, dto);
  }

  @Get(":playlistId")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Get playlist details",
    description: "Returns playlist details and its tracks.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiResponse({
    status: 200,
    description:
      "Playlist details fetched successfully. secretToken is only returned for the playlist owner.",
    type: GetPlaylistDetailsResponseDto,
    schema: {
      example: {
        playlistId: "pl_101",
        title: "Late Night Drive",
        description: "My favorite chill tracks",
        visibility: "PUBLIC",
        secretToken: null,
        owner: {
          id: "usr_1",
          display_name: "Ahmed Hassan",
        },
        tracks: [
          {
            trackId: "trk_123",
            title: "Layali",
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  getDetails(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Query() query: PlaylistTracksQueryDto,
  ) {
    return this.playlistsService.getDetails(params.playlistId, userId, query);
  }

  @Patch(":playlistId")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Update playlist",
    description: "Updates playlist title, description, or visibility. Owner only.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiBody({
    type: UpdatePlaylistDto,
    schema: {
      example: {
        title: "Late Night Drive Vol. 2",
        visibility: "PRIVATE",
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Playlist updated successfully.",
    type: UpdatePlaylistResponseDto,
    schema: {
      example: {
        message: "Playlist updated successfully",
        playlist: {
          playlistId: "pl_101",
          title: "Late Night Drive Vol. 2",
          description: "My favorite chill tracks",
          visibility: "SECRET",
          secretToken: "2e8b35f8-98d2-4f78-8899-b5fb688d809a",
          owner: {
            id: "usr_1",
            display_name: "Ahmed Hassan",
          },
          tracks: [
            {
              trackId: "trk_123",
              title: "Layali",
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Validation error or empty update payload.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can update this playlist.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(30, 60_000)
  update(
    @CurrentUser("userId") userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlistsService.update(userId, params.playlistId, dto);
  }

  @Delete(":playlistId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: "Delete playlist",
    description: "Permanently deletes a playlist. Owner only.",
  })
  @ApiParam({
    name: "playlistId",
    description: "Playlist identifier",
    example: "pl_101",
  })
  @ApiResponse({ status: 204, description: "Playlist deleted successfully." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Only playlist owner can delete this playlist.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ThrottlePolicy(20, 60_000)
  remove(@CurrentUser("userId") userId: string, @Param() params: DeletePlaylistParamsDto) {
    this.playlistsService.remove(userId, params.playlistId);
  }
}
// mmary: "Delete playlist",
//     description: "Permanently deletes a playlist. Owner only.",
//   })
//   @ApiParam({
//     name: "playlistId",
//     description: "Playlist identifier",
//     example: "pl_101",
//   })
//   @ApiResponse({ status: 204, description: "Playlist deleted successfully." })
//   @ApiResponse({ status: 401, description: "Not authenticated." })
//   @ApiResponse({
//     status: 403,
//     description: "Only playlist owner can delete this playlist.",
//   })
//   @ApiResponse({ status: 404, description: "Playlist not found." })
//   @ThrottlePolicy(20, 60_000)
//   remove(@CurrentUser("userId") userId: string, @Param() params: DeletePlaylistParamsDto) {
// e,
//       transform: true,
//     }),
//   )
//   @ApiOperation({
//     summary: 'Delete playlist',
//     description: 'Permanently deletes a playlist. Owner only.',
//   })
//   @ApiParam({
//     name: 'playlistId',
//     description: 'Playlist identifier',
//     example: 'pl_101',
//   })
//   @ApiResponse({ status: 204, description: 'Playlist deleted successfully.' })
//   @ApiResponse({ status: 401, description: 'Not authenticated.' })
//   @ApiResponse({
//     status: 403,
//     description: 'Only playlist owner can delete this playlist.',
//   })
//   @ApiResponse({ status: 404, description: 'Playlist not found.' })
//   @ThrottlePolicy(20, 60_000)
//   remove(@CurrentUser('userId') userId: string, @Param() params: DeletePlaylistParamsDto) {
// Whitelisted: true,
//       transform: true,
//     }),
//   )
//   @ApiOperation({
//     summary: "Delete playlist",
//     description: "Permanently deletes a playlist. Owner only.",
//   })
//   @ApiParam({
//     name: "playlistId",
//     description: "Playlist identifier",
//     example: "pl_101",
//   })
//   @ApiResponse({ status: 204, description: "Playlist deleted successfully." })
//   @ApiResponse({ status: 401, description: "Not authenticated." })
//   @ApiResponse({
//     status: 403,
//     description: "Only playlist owner can delete this playlist.",
//   })
//   @ApiResponse({ status: 404, description: "Playlist not found." })
//   @ThrottlePolicy(20, 60_000)
//   remove(@CurrentUser("userId") userId: string, @Param() params: DeletePlaylistParamsDto) {
//     this.playlistsService.remove(userId, params.playlistId);
//   }
// }
