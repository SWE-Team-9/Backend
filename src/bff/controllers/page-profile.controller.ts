import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";

import { Public } from "../../common/decorators/public.decorator";
import { BffService } from "../bff.service";

class ProfilePageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

@ApiTags("BFF")
@Controller("pages")
export class PageProfileController {
  constructor(private readonly bffService: BffService) {}

  /**
   * GET /api/v1/pages/profile/:handle
   *
   * Aggregated profile page data: profile, tracks (page 1), viewer relationship,
   * viewer interactions (liked/reposted track ids), and permissions.
   *
   * Works for guests (no auth cookie) and authenticated users.
   * Private profiles return a gated response for non-owners.
   * Cache: no-store — includes viewer-specific state.
   */
  @ApiOperation({
    summary: "Profile page aggregate data",
    description:
      "Returns everything needed to render the profile page in one request: " +
      "profile, tracks, viewer relationship, viewer interactions, and permissions.",
  })
  @ApiParam({ name: "handle", description: "User handle" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Profile page payload." })
  @ApiResponse({ status: 404, description: "Profile not found." })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Get("profile/:handle")
  async getProfilePage(
    @Param("handle") handle: string,
    @Query() query: ProfilePageQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requesterId: string | undefined = (req.user as any)?.userId;
    res.setHeader("Cache-Control", "no-store, private");
    return this.bffService.getProfilePageData(
      handle,
      requesterId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }
}
