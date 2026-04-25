import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UserEnforcementService } from "./user-enforcement.service";
import {
  WarnUserDto,
  SuspendUserDto,
  BanUserDto,
  RestoreUserDto,
} from "./dto/user-enforcement.dto";

@Controller("api/v1/admin/users")
@Roles("ADMIN")
export class UserEnforcementController {
  constructor(private readonly userEnforcementService: UserEnforcementService) {}

  // POST /api/v1/admin/users/:userId/warn
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
