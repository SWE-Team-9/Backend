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
  @Get('check-handle')
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
  @Get(':handle')
  getProfile(
    @Param() params: GetProfileParamsDto,
    @Req() req: Request,
  ) {
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
    @CurrentUser('userId') userId: string,
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
    @CurrentUser('userId') userId: string,
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
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @CurrentUser('userId') userId: string,
    @Param() params: UploadImageParamsDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfileImage(userId, params.type, file);
  }
}
