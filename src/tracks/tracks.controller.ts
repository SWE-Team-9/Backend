import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ChangeTrackVisibilityDto } from "./dto/change-track-visibility.dto";
import { SecretTokenParamDto } from "./dto/secret-token-param.dto";
import { TrackIdParamDto } from "./dto/track-id-param.dto";
import { TranscodingCallbackDto } from "./dto/transcoding-callback.dto";
import { UpdateTrackMetadataDto } from "./dto/update-track-metadata.dto";
import { UploadTrackDto } from "./dto/upload-track.dto";
import { TracksService } from "./tracks.service";

@ApiTags("Tracks")
@ApiCookieAuth("access_token")
@Controller("tracks")
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @ApiOperation({
    summary: "Upload track",
    description: "Artist uploads audio file and track enters PROCESSING state.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        title: { type: "string", example: "Ya Ana" },
        genre: { type: "string", example: "Pop" },
        tags: { type: "array", items: { type: "string" }, example: ["pop", "arabic"] },
        releaseDate: { type: "string", example: "2026-03-01" },
        audioFile: { type: "string", format: "binary" },
      },
      required: ["title", "genre", "audioFile"],
    },
  })
  @ApiResponse({
    status: 202,
    description: "Track accepted and processing started.",
    schema: {
      example: {
        trackId: "trk_001",
        title: "Ya Ana",
        artistId: "user_123",
        status: "PROCESSING",
        visibility: "PRIVATE",
      },
    },
  })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor("audioFile"))
  uploadTrack(
    @CurrentUser("userId") userId: string,
    @Body() dto: UploadTrackDto,
    @UploadedFile() audioFile?: Express.Multer.File,
  ) {
    // TODO(Module 4): keep endpoint owner-restricted to artists via auth/role guard.
    return this.tracksService.uploadTrack(userId, dto, audioFile);
  }

  @ApiOperation({
    summary: "Get track details",
    description: "Returns full track metadata when access is allowed.",
  })
  @ApiParam({ name: "trackId", example: "trk_12345" })
  @ApiResponse({
    status: 200,
    description: "Track details returned.",
    schema: {
      example: {
        trackId: "trk_12345",
        title: "Song Title",
        artist: "Amr Diab",
        artistAvatarUrl: "https://example.com/avatars/amrdiab.jpg",
        genre: "Pop",
        tags: ["pop", "2026"],
        releaseDate: "2026-03-06",
        visibility: "PUBLIC",
        status: "FINISHED",
      },
    },
  })
  @Public()
  @Get(":trackId")
  getTrackDetails(
    @Param() params: TrackIdParamDto,
    @CurrentUser("userId") requesterId?: string,
  ) {
    // TODO(Module 4): endpoint placeholder 
    return this.tracksService.getTrackDetails(params, requesterId);
  }

  @ApiOperation({
    summary: "Get track status",
    description: "Returns lightweight status payload for polling.",
  })
  @ApiParam({ name: "trackId", example: "trk_12345" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        trackId: "trk_12345",
        status: "PROCESSING",
      },
    },
  })
  @Public()
  @Get(":trackId/status")
  getTrackStatus(@Param() params: TrackIdParamDto) {
    // TODO(Module 4): endpoint placeholder
    return this.tracksService.getTrackStatus(params);
  }

  @ApiOperation({
    summary: "Update track metadata",
    description: "Updates title, genre, tags, release date and other metadata fields.",
  })
  @ApiParam({ name: "trackId", example: "trk_12345" })
  @ApiBody({ type: UpdateTrackMetadataDto })
  @ApiResponse({ status: 200, description: "Track metadata updated." })
  @Put(":trackId")
  updateTrackMetadata(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
    @Body() dto: UpdateTrackMetadataDto,
  ) {
    // TODO(Module 4): endpoint placeholder 
    return this.tracksService.updateTrackMetadata(userId, params, dto);
  }

  @ApiOperation({
    summary: "Delete track",
    description: "Permanently removes a track resource.",
  })
  @ApiParam({ name: "trackId", example: "trk_12345" })
  @ApiResponse({ status: 204, description: "Track deleted." })
  @Delete(":trackId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTrack(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 4): endpoint placeholder 
    return this.tracksService.deleteTrack(userId, params);
  }

  @ApiOperation({
    summary: "Change track visibility",
    description: "Toggles visibility without changing other metadata fields.",
  })
  @ApiParam({ name: "trackId", example: "trk_12345" })
  @ApiBody({ type: ChangeTrackVisibilityDto })
  @ApiResponse({ status: 200, description: "Visibility updated." })
  @Patch(":trackId/visibility")
  changeTrackVisibility(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
    @Body() dto: ChangeTrackVisibilityDto,
  ) {
    // TODO(Module 4): endpoint placeholder 
    return this.tracksService.changeTrackVisibility(userId, params, dto);
  }

  @ApiOperation({
    summary: "Transcoding callback",
    description: "Internal callback consumed after background processing update.",
  })
  @ApiBody({ type: TranscodingCallbackDto })
  @ApiResponse({ status: 200, description: "Callback accepted." })
  @Public()
  @Post("transcoding/callback")
  transcodingCallback(@Body() dto: TranscodingCallbackDto) {
    // TODO(Module 4): protect this endpoint with internal auth/signature verification.
    // TODO(Module 4): endpoint placeholder
    return this.tracksService.transcodingCallback(dto);
  }

  @ApiOperation({
    summary: "Resolve private track by secret token",
    description: "Resolves a private track using a secret link token.",
  })
  @ApiParam({ name: "secretToken", example: "X7f9zK2qP4mN1vB" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        trackId: "trk_98765",
        title: "Unreleased Demo",
        visibility: "PRIVATE",
        message: "Access granted via secret token",
      },
    },
  })
  @ApiResponse({ status: 404, description: "Secret token invalid or expired." })
  @Public()
  @Get("secret/:secretToken")
  resolvePrivateTrackBySecret(
    @Param() params: SecretTokenParamDto,
    @CurrentUser("userId") requesterId?: string,
  ) {
    // TODO(Module 4): endpoint placeholder.
    return this.tracksService.resolvePrivateTrackBySecret(params, requesterId);
  }
}
