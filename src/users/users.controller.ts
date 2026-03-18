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
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";

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
@ApiTags("Profiles")
@Controller("profiles")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /profiles/me
  @Get("me")
  @ApiOperation({
    summary: "Get current user's full profile",
    description: `Retrieve complete profile information for the authenticated user.

Returned data:
- Handle (URL-safe identifier)
- Display name
- Bio / description
- Profile images (avatar, cover)
- Location
- Website (if set and validated)
- Account type (LISTENER or ARTIST)
- Visibility (PUBLIC or PRIVATE)
- Favorite genres (up to 5)
- Social links (Instagram, YouTube, Twitter, etc.)
- Track count
- Follower/Following counts
- Likes visibility
- Profile created date
- Last updated date

Note: Includes all private fields since authenticated user viewing own profile.
Authentication: Requires valid access token.
Rate Limited: Default (100 req/min).`,
  })
  @ApiResponse({ status: 200, description: "Full user profile" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({ status: 404, description: "User not found" })
  getMyProfile(@CurrentUser("userId") userId: string) {
    return this.usersService.getMyProfile(userId);
  }

  // GET /profiles/check-handle?handle=xyz
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
  @Patch("me")
  @ApiOperation({
    summary: "Update current user's profile",
    description: `Partially update profile information (only provided fields are updated).

Updatable fields:
- display_name: 2–50 characters (shown in UI)
- bio: Up to 500 characters
- location: Up to 100 characters
- website: HTTPS-only, SSRF-validated, XSS-safe (or empty string to clear)
- is_private: Toggle profile visibility (PUBLIC / PRIVATE)
- favorite_genres: Array of genres (max 5, from allowed list)
- account_type: LISTENER or ARTIST

Validation:
- Handles not editable (permanent)
- Email changed via separate /request-email-change flow
- Password changed via separate /change-password flow

Example:
{
  display_name: "DJ Mohan Updated",
  bio: "Music producer & sound engineer",
  favorite_genres: ["electronic", "house", "techno"],
  is_private: false,
  account_type: "ARTIST"
}

Authentication: Requires valid access token.
Rate Limited: Default (100 req/min).`,
  })
  @ApiResponse({ status: 200, description: "Updated profile" })
  @ApiResponse({ status: 400, description: "Validation failed (invalid genres, website format, etc.)" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({ status: 404, description: "User not found" })
  updateProfile(
    @CurrentUser("userId") userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  // PUT /profiles/me/links
  // Full-replace - client sends the complete desired list.
  @Put("me/links")
  @ApiOperation({
    summary: "Update external social links (full replace)",
    description: `Replace entire set of social/external links atomically.

Example request (full replace):
{
  links: [
    { platform: "instagram", url: "https://instagram.com/djmohan" },
    { platform: "youtube", url: "https://youtube.com/c/djmohan" },
    { platform: "spotify", url: "https://open.spotify.com/artist/xyz" },
    { platform: "website", url: "https://djmohan.com" }
  ]
}

Supported platforms:
- website, twitter, instagram, facebook, youtube, tiktok, spotify, apple-music,
- bandcamp, soundcloud, patreon, twitch, discord, linkedin, github

Validation:
- URLs must be HTTPS (for security)
- SSRF validation (blocks internal/cloud metadata endpoints)
- No duplicates per platform
- Max 15 links total

Note: Full replace — omitted links are deleted. Send empty array [] to clear all.

Authentication: Requires valid access token.
Rate Limited: Default (100 req/min).`,
  })
  @ApiResponse({ status: 200, description: "Updated social links" })
  @ApiResponse({ status: 400, description: "Validation failed (invalid URL, blocked hostname, etc.)" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  updateLinks(
    @CurrentUser("userId") userId: string,
    @Body() dto: UpdateExternalLinksDto,
  ) {
    return this.usersService.updateExternalLinks(userId, dto);
  }

  // POST /profiles/me/:type (avatar | cover)
  // Accepts multipart/form-data with a single "file" field.
  @Post("me/:type")
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
