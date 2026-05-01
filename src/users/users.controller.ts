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

import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottlePolicy } from '../common/decorators/throttle-policy.decorator';
import { UsersService } from './users.service';
import {
  CheckHandleQueryDto,
  GetProfileParamsDto,
  UpdateExternalLinksDto,
  UpdateProfileDto,
  UploadImageParamsDto,
} from './dto/profile.dto';

// /me and /check-handle must be declared before /:handle so NestJS
// does not route them as handle parameter matches.
@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /profiles/me
  @ApiOperation({
    summary: 'Get my profile',
    description: 'Returns the full profile of the authenticated user. No privacy gating.',
  })
  @ApiResponse({
    status: 200,
    description: 'Full profile object.',
    schema: {
      example: {
        id: 'usr_123',
        user_id: 'usr_123',
        handle: 'yahia_dev',
        display_name: 'Yahia Dev',
        bio: 'Music producer from Cairo.',
        location: 'Cairo, Egypt',
        avatarUrl: 'https://cdn.iqa3.tech/avatars/yahia.jpg',
        coverPhotoUrl: 'https://cdn.iqa3.tech/covers/yahia-cover.jpg',
        account_type: 'ARTIST',
        visibility: 'PUBLIC',
        likes_visible: true,
        website_url: null,
        is_private: false,
        is_verified: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
        favorite_genres: [{ slug: 'electronic', name: 'Electronic' }, { slug: 'lo-fi', name: 'Lo-Fi' }],
        social_links: [{ platform: 'OTHER', url: 'https://soundcloud.com/yahia_dev', sort_order: 0 }],
        followers_count: 340,
        following_count: 89,
        track_count: 12,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @Get('me')
  getMyProfile(@CurrentUser('userId') userId: string) {
    return this.usersService.getMyProfile(userId);
  }

  // GET /profiles/check-handle?handle=xyz
  @ApiQuery({
    name: 'handle',
    description: 'The handle to check (3-30 chars, lowercase letters, numbers, underscores).',
    example: 'yahia_dev',
  })
  @ApiResponse({ status: 200, description: '{ available: boolean }' })
  @ApiResponse({ status: 400, description: 'Invalid handle format.' })
  @Public()
  @Get('check-handle')
  @ApiOperation({
    summary: 'Check handle availability',
    description: `Verify if a desired username handle is available for registration or update.

Validation:
- 3-30 characters (lowercase letters, numbers, underscores, hyphens)
- Real-time availability check
- 30-day retirement window (recently deleted handles cannot be re-used)

Response:
- available: true/false

Public endpoint: No authentication required.
Rate Limited: Default (100 req/min).`,
  })
  @ApiResponse({
    status: 200,
    description: 'Handle availability status',
    schema: {
      example: { available: true },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid handle format' })
  checkHandle(@Query() query: CheckHandleQueryDto) {
    return this.usersService.checkHandleAvailability(query.handle);
  }

  // GET /profiles/:handle
  // requesterId forwarded when a valid JWT is present; service uses it to
  // bypass privacy gating for the profile owner.
  @ApiParam({
    name: 'handle',
    description: "The user's handle.",
    example: 'yahia_dev',
  })
  @ApiResponse({ status: 200, description: 'Full or reduced profile object.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @Public()
  @Get(':handle')
  @ApiOperation({
    summary: 'Get user profile by handle (public)',
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
  @ApiResponse({
    status: 200,
    description: 'User profile (full or limited based on privacy)',
    schema: {
      example: {
        id: 'usr_456',
        user_id: 'usr_456',
        handle: 'amrdiab',
        display_name: 'Amr Diab',
        bio: 'Legendary Egyptian artist.',
        location: 'Cairo, Egypt',
        avatarUrl: 'https://cdn.iqa3.tech/avatars/amrdiab.jpg',
        coverPhotoUrl: null,
        account_type: 'ARTIST',
        visibility: 'PUBLIC',
        likes_visible: true,
        website_url: null,
        is_private: false,
        is_verified: true,
        created_at: '2025-01-15T00:00:00.000Z',
        updated_at: '2025-06-01T00:00:00.000Z',
        favorite_genres: [{ slug: 'pop', name: 'Pop' }],
        social_links: [],
        followers_count: 50000,
        following_count: 12,
        track_count: 120,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Handle not found' })
  getProfile(@Param() params: GetProfileParamsDto, @Req() req: Request) {
    const requesterId = (req as any).user?.userId as string | undefined;
    return this.usersService.getProfileByHandle(params.handle, requesterId);
  }

  // PATCH /profiles/me
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Partial update - only fields present in the body are written. Send favorite_genres: [] to clear all genres.',
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 200,
    description: 'Updated profile.',
    schema: {
      example: {
        userId: 'usr_123',
        displayName: 'Yahia Dev',
        handle: 'yahia_dev',
        bio: 'Updated bio.',
        location: 'Alexandria, Egypt',
        avatarUrl: null,
        coverPhotoUrl: null,
        accountType: 'ARTIST',
        visibility: 'PUBLIC',
        likesVisible: true,
        websiteUrl: null,
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Patch('me')
  updateProfile(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  // PUT /profiles/me/links
  // Full-replace - client sends the complete desired list.
  @ApiOperation({
    summary: 'Update external links',
    description:
      'Full-replace - client sends the complete desired list. Send links: [] to clear all.',
  })
  @ApiBody({ type: UpdateExternalLinksDto })
  @ApiResponse({
    status: 200,
    description: 'Updated links array.',
    schema: {
      example: [
        { platform: 'OTHER', url: 'https://soundcloud.com/yahia_dev' },
        { platform: 'INSTAGRAM', url: 'https://instagram.com/yahia_dev' },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Validation or SSRF error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Put('me/links')
  updateLinks(@CurrentUser('userId') userId: string, @Body() dto: UpdateExternalLinksDto) {
    return this.usersService.updateExternalLinks(userId, dto);
  }

  // DELETE /profiles/me
  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete my account',
    description:
      'Permanently deletes the authenticated user account and all associated data (tracks, likes, followers, history, sessions, etc.). This action is irreversible.',
  })
  @ApiResponse({
    status: 200,
    description: 'Account deleted successfully.',
    schema: { example: { message: 'Account deleted successfully.' } },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  deleteAccount(@CurrentUser('userId') userId: string) {
    return this.usersService.deleteAccount(userId);
  }

  // POST /profiles/me/:type (avatar | cover)
  // Accepts multipart/form-data with a single "file" field.
  @ApiParam({
    name: 'type',
    enum: ['avatar', 'cover'],
    description: 'Image type to upload.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: '{ url: string }' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Post('me/:type')
  @ThrottlePolicy(10, 60_000)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload profile image (avatar or cover)',
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

Rate Limited: 10 uploads per minute (per user).
Authentication: Requires valid access token.
Note: Old image kept in storage (cleanup via background job).`,
  })
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (invalid MIME, too large, etc.)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (10/min)',
  })
  uploadImage(
    @CurrentUser('userId') userId: string,
    @Param() params: UploadImageParamsDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfileImage(userId, params.type, file);
  }

  // POST /profiles/me/images/:type (avatar | cover)
  // Backward-compatible alias used by FE/Cross teams in the sprint contract.
  @Post('me/images/:type')
  @ThrottlePolicy(10, 60_000)
  @UseInterceptors(FileInterceptor('file'))
  @ApiParam({
    name: 'type',
    enum: ['avatar', 'cover'],
    description: 'Image type to upload.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload profile image (FE/Cross sprint contract alias)',
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
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (invalid MIME, too large, etc.)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (10/min)',
  })
  uploadImageWithImagesPath(
    @CurrentUser('userId') userId: string,
    @Param() params: UploadImageParamsDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfileImage(userId, params.type, file);
  }
}
