import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import { UsersService } from "./users.service";
import {
  CheckHandleQueryDto,
  GetProfileParamsDto,
  UpdateExternalLinksDto,
  UpdateProfileDto,
  UploadImageParamsDto,
} from "./dto/profile.dto";

// /me and /check-handle must be declared before /:handle so NestJS
// does not route them as handle parameter matches.
@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /profiles/me
  @ApiOperation({ summary: 'Get my profile', description: 'Returns the full profile of the authenticated user. No privacy gating.' })
  @ApiResponse({ status: 200, description: 'Full profile object.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Get('me')
  getMyProfile(@CurrentUser('userId') userId: string) {
    return this.usersService.getMyProfile(userId);
  }

  // GET /profiles/check-handle?handle=xyz
  @ApiOperation({ summary: 'Check handle availability', description: 'Returns whether a handle is available. Handles retired within the last 30 days are blocked.' })
  @ApiQuery({ name: 'handle', description: 'The handle to check (3–30 chars, lowercase letters, numbers, underscores).', example: 'yahia_dev' })
  @ApiResponse({ status: 200, description: '{ available: boolean }' })
  @ApiResponse({ status: 400, description: 'Invalid handle format.' })
  @Public()
  @Get("check-handle")
  @ApiOperation({
    summary: "Check handle availability",
    description: `Verify if a desired username handle is available for registration or update.

Validation:
- 3–30 characters (alphanumeric + underscores only)
- Real-time availability check
- 30-day retirement window (recently deleted handles cannot be re-used)

Response:
- available: true/false
- handle: Normalized handle (lowercase, sanitized)
- reason: If unavailable, reason given (taken, reserved, recently-deleted)

Public endpoint: No authentication required.
Rate Limited: Default (100 req/min).`,
  })
  @ApiResponse({ status: 200, description: "Handle availability status" })
  @ApiResponse({ status: 400, description: "Invalid handle format" })
  checkHandle(@Query() query: CheckHandleQueryDto) {
    return this.usersService.checkHandleAvailability(query.handle);
  }

  // GET /profiles/:handle
  // requesterId forwarded when a valid JWT is present; service uses it to
  // bypass privacy gating for the profile owner.
  @ApiOperation({ summary: 'Get profile by handle', description: 'Public endpoint. Returns reduced shape for private profiles the requester does not own.' })
  @ApiParam({ name: 'handle', description: 'The user\'s handle.', example: 'yahia_dev' })
  @ApiResponse({ status: 200, description: 'Full or reduced profile object.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @Public()
  @Get(":handle")
  @ApiOperation({
    summary: "Get user profile by handle (public)",
    description: `Retrieve profile information for any user by their handle.

Behavior:
- If profile is PUBLIC or requester is the owner: Return full profile
- If profile is PRIVATE and requester is not the owner: Return limited public info only
  - Handle, display name, avatar, account type
  - Hide: bio, location, links, private genre preferences
- If profile not found: Return 404

Note: Tracks, followers, and reposts are fetched separately (pagination endpoints).
Public endpoint: No authentication required, but user ID auto-detected if logged in.
Rate Limited: Default (100 req/min).`,
  })
  @ApiResponse({ status: 200, description: "User profile (full or limited based on privacy)" })
  @ApiResponse({ status: 404, description: "Handle not found" })
  getProfile(@Param() params: GetProfileParamsDto, @Req() req: Request) {
    const requesterId = (req as any).user?.userId as string | undefined;
    return this.usersService.getProfileByHandle(params.handle, requesterId);
  }

  // PATCH /profiles/me
  @ApiOperation({ summary: 'Update my profile', description: 'Partial update — only fields present in the body are written. Send favorite_genres: [] to clear all genres.' })
  @ApiResponse({ status: 200, description: 'Updated profile.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Patch('me')
  updateProfile(
    @CurrentUser("userId") userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  // PUT /profiles/me/links
  // Full-replace - client sends the complete desired list.
  @ApiOperation({ summary: 'Update external links', description: 'Full-replace — client sends the complete desired list. Send links: [] to clear all.' })
  @ApiResponse({ status: 200, description: 'Updated links array.' })
  @ApiResponse({ status: 400, description: 'Validation or SSRF error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Put('me/links')
  updateLinks(
    @CurrentUser("userId") userId: string,
    @Body() dto: UpdateExternalLinksDto,
  ) {
    return this.usersService.updateExternalLinks(userId, dto);
  }

  // POST /profiles/me/:type (avatar | cover)
  // Accepts multipart/form-data with a single "file" field.
  @ApiOperation({ summary: 'Upload avatar or cover photo', description: 'Accepts multipart/form-data with a single "file" field. type must be "avatar" (max 5 MB) or "cover" (max 15 MB). Replaces existing image.' })
  @ApiParam({ name: 'type', enum: ['avatar', 'cover'], description: 'Image type to upload.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, description: '{ url: string }' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Post('me/:type')
  @ThrottlePolicy(10, 60_000)
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({
    summary: "Upload profile image (avatar or cover)",
    description: `Upload and replace profile picture or cover image.

Image types:
- avatar: Profile picture (displayed on profile page, 5MB max)
- cover: Header/banner image (displayed at top of profile, 15MB max)

Validation:
- MIME type: JPEG, PNG, or WebP only
- File size: 5MB (avatar) or 15MB (cover)
- Request format: multipart/form-data with file field

Storage:
- Local: ./uploads/{type}/{uuid}.{ext}
- S3 (production): s3://spotly-uploads-prod/{type}/{uuid}.{ext}
- CloudFront CDN URL returned to client

Return:
- url: URI to access image (http://localhost:3000/uploads/... or https://cdn...)
- key: Storage key for deletion (if re-uploading)

Rate Limited: 10 uploads per minute (per user).
Authentication: Requires valid access token.
Note: Old image kept in storage (cleanup via background job).`,
  })
  @ApiResponse({ status: 200, description: "Image uploaded, URL returned" })
  @ApiResponse({ status: 400, description: "Validation failed (invalid MIME, too large, etc.)" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (10/min)",
  })
  uploadImage(
    @CurrentUser("userId") userId: string,
    @Param() params: UploadImageParamsDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfileImage(userId, params.type, file);
  }

  // POST /profiles/me/images/:type (avatar | cover)
  // Backward-compatible alias used by FE/Cross teams in the sprint contract.
  @Post("me/images/:type")
  @ThrottlePolicy(10, 60_000)
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({
    summary: "Upload profile image (FE/Cross sprint contract alias)",
    description: `Backward-compatible endpoint alias for uploading profile images.

This endpoint is identical to POST /profiles/me/:type but uses the path segment
'images' instead of directly in the route. Both endpoints are supported for
compatibility with different frontend implementations.

Same behavior, validation, and rate limiting as POST /profiles/me/:type.
Preferred route: /me/:type
Legacy/compatible route: /me/images/:type

Rate Limited: 10 uploads per minute (shared quota with /me/:type).
Authentication: Requires valid access token.`,
  })
  @ApiResponse({ status: 200, description: "Image uploaded, URL returned" })
  @ApiResponse({ status: 400, description: "Validation failed (invalid MIME, too large, etc.)" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (10/min)",
  })
  uploadImageWithImagesPath(
    @CurrentUser("userId") userId: string,
    @Param() params: UploadImageParamsDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfileImage(userId, params.type, file);
  }
}
