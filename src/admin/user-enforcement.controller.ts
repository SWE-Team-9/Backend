import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UserEnforcementService } from "./user-enforcement.service";
import {
  WarnUserDto,
  SuspendUserDto,
  BanUserDto,
  RestoreUserDto,
} from "./dto/user-enforcement.dto";

@ApiTags("Admin - User Enforcement")
@ApiCookieAuth("access_token")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("admin/users")
@Roles("ADMIN")
export class UserEnforcementController {
  constructor(
    private readonly userEnforcementService: UserEnforcementService,
  ) {}

  // POST /api/v1/admin/users/:userId/warn
  @ApiOperation({
    summary: "Warn a user",
    description: "Issues a formal warning to a user. Admin only.",
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "Target user UUID.",
  })
  @ApiResponse({ status: 201, description: "Warning issued." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({ status: 404, description: "User not found." })
  @Post(":userId/warn")
  @HttpCode(201)
  warnUser(
    @CurrentUser("userId") adminId: string,
    @Param("userId", ParseUUIDPipe) targetUserId: string,
    @Body() dto: WarnUserDto,
  ) {
    return this.userEnforcementService.warnUser(adminId, targetUserId, dto);
  }

  // POST /api/v1/admin/users/:userId/suspend
  @ApiOperation({
    summary: "Suspend a user",
    description:
      "Temporarily suspends a user account for a specified duration. Admin only.",
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "Target user UUID.",
  })
  @ApiResponse({ status: 201, description: "User suspended." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({ status: 404, description: "User not found." })
  @Post(":userId/suspend")
  @HttpCode(201)
  suspendUser(
    @CurrentUser("userId") adminId: string,
    @Param("userId", ParseUUIDPipe) targetUserId: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.userEnforcementService.suspendUser(adminId, targetUserId, dto);
  }

  // POST /api/v1/admin/users/:userId/ban
  @ApiOperation({
    summary: "Ban a user",
    description: "Permanently bans a user account. Admin only.",
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "Target user UUID.",
  })
  @ApiResponse({ status: 201, description: "User banned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({ status: 404, description: "User not found." })
  @Post(":userId/ban")
  @HttpCode(201)
  banUser(
    @CurrentUser("userId") adminId: string,
    @Param("userId", ParseUUIDPipe) targetUserId: string,
    @Body() dto: BanUserDto,
  ) {
    return this.userEnforcementService.banUser(adminId, targetUserId, dto);
  }

  // POST /api/v1/admin/users/:userId/restore
  @ApiOperation({
    summary: "Restore a user",
    description:
      "Lifts a suspension or ban, restoring the user's account access. Admin only.",
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "Target user UUID.",
  })
  @ApiResponse({ status: 200, description: "User restored." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({ status: 404, description: "User not found." })
  @Post(":userId/restore")
  @HttpCode(200)
  restoreUser(
    @CurrentUser("userId") adminId: string,
    @Param("userId", ParseUUIDPipe) targetUserId: string,
    @Body() dto: RestoreUserDto,
  ) {
    return this.userEnforcementService.restoreUser(adminId, targetUserId, dto);
  }
}
