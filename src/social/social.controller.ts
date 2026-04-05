import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { SocialService } from "./social.service";

@ApiTags("Social")
@Controller("social")
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @Post("block/:userId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Block a user" })
  @ApiParam({ name: "userId", description: "User ID to block" })
  @ApiCreatedResponse({
    description: "User blocked.",
    schema: {
      example: {
        message: "User blocked successfully",
        blockedUserId: "uuid",
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  blockUser(
    @CurrentUser("userId") currentUserId: string,
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
  ) {
    return this.socialService.blockUser(currentUserId, userId);
  }

  @Delete("block/:userId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Unblock a user" })
  @ApiParam({ name: "userId", description: "User ID to unblock" })
  @ApiOkResponse({
    description: "User unblocked.",
    schema: {
      example: {
        message: "User unblocked successfully",
        blockedUserId: "uuid",
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  unblockUser(
    @CurrentUser("userId") currentUserId: string,
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
  ) {
    return this.socialService.unblockUser(currentUserId, userId);
  }

  @Get("blocked-users")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get blocked users list" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiOkResponse({
    description: "Blocked users fetched.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 4,
        blockedUsers: [
          {
            id: "uuid",
            display_name: "Blocked User",
            handle: "blocked-user",
            avatar_url: null,
            blockedAt: "2026-03-07T11:00:00.000Z",
          },
        ],
      },
    },
  })
  getBlockedUsers(
    @CurrentUser("userId") userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.socialService.getBlockedUsers(
      userId,
      pagination.page,
      pagination.limit,
    );
  }
}
