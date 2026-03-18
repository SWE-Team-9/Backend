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
@Controller('profiles')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /profiles/me
  @Get('me')
  getMyProfile(@CurrentUser('userId') userId: string) {
    return this.usersService.getMyProfile(userId);
  }

  // GET /profiles/check-handle?handle=xyz
  @Public()
  @Get('check-handle')
  checkHandle(@Query() query: CheckHandleQueryDto) {
    return this.usersService.checkHandleAvailability(query.handle);
  }

  // GET /profiles/:handle
  // requesterId forwarded when a valid JWT is present; service uses it to
  // bypass privacy gating for the profile owner.
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
  @Patch('me')
  updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  // PUT /profiles/me/links
  // Full-replace - client sends the complete desired list.
  @Put('me/links')
  updateLinks(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateExternalLinksDto,
  ) {
    return this.usersService.updateExternalLinks(userId, dto);
  }

  // POST /profiles/me/:type (avatar | cover)
  // Accepts multipart/form-data with a single "file" field.
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
