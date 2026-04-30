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
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
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
@ThrottlePolicy(30, 60_000)
export class UserEnforcementController {
  constructor(
    private readonly userEnforcementService: UserEnforcementService,
  ) {}

  // POST /api/v1/admin/users/:userId/warn
  @ApiOperation({
    summary: "Warn a user",
    description: `Issues a formal warning to a user account. The warning is logged in the audit trail and the user receives an in-app notification.

**When to use:** First-level enforcement for minor policy violations (e.g. repeated spam, misleading content, minor harassment). Does NOT change account status — the user stays ACTIVE.

**State transition:** No account status change.

**Side effects:**
- Creates a \`ModerationAction\` record (\`actionType: WARN_USER\`)
- Sends an in-app notification to the target user
- Optionally links to an existing \`ModerationReport\` via \`reportId\`

**Restrictions:**
- Cannot warn another ADMIN (\`CANNOT_WARN_ADMIN\`)
- Cannot warn an already-BANNED user (\`USER_ALREADY_BANNED\` 409)
- Cannot target yourself (\`CANNOT_SELF_ENFORCE\`)
- Admin must supply their current password for re-authentication

**Rate limit:** 30 requests / 60 s`,
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "UUID of the target user.",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @ApiBody({ type: WarnUserDto })
  @ApiCreatedResponse({
    description: "Warning issued successfully.",
    schema: {
      example: {
        action_id: "b3d4e5f6-a7b8-9c0d-e1f2-a3b4c5d6e7f8",
        action_type: "WARN_USER",
        target_user: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          display_name: "Jane Doe",
          handle: "janedoe",
        },
        admin_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        notes: "Posting misleading content repeatedly.",
        created_at: "2025-06-01T12:00:00.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error — `reason` missing, too short (<10 chars), or invalid `reportId` format.",
    schema: {
      example: {
        statusCode: 400,
        message: ["reason must be longer than or equal to 10 characters"],
        error: "Bad Request",
      },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      "Not authenticated — missing or expired `access_token` cookie. Re-login required.",
  })
  @ApiResponse({
    status: 403,
    description: `Forbidden. Error codes:
- \`INSUFFICIENT_PERMISSIONS\` — caller's ADMIN role could not be re-verified from DB
- \`CANNOT_SELF_ENFORCE\` — admin is targeting their own account
- \`CANNOT_WARN_ADMIN\` — target user is an ADMIN
- \`INCORRECT_PASSWORD\` — \`currentPassword\` did not match`,
    schema: {
      example: {
        code: "INCORRECT_PASSWORD",
        message: "Incorrect password.",
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "User not found or has been deleted.",
    schema: {
      example: { code: "USER_NOT_FOUND", message: "User not found." },
    },
  })
  @ApiResponse({
    status: 409,
    description: "Conflict — user is already BANNED. Cannot warn a banned user.",
    schema: {
      example: {
        code: "USER_ALREADY_BANNED",
        message: "User is already banned.",
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
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
    description: `Temporarily suspends a user account for 1–365 days. The user is locked out immediately — all active sessions are revoked in the same atomic transaction.

**When to use:** Moderate-to-serious violations where a permanent ban is premature. Typical durations: 1 day (first offence), 7 days (repeat), 30 days (serious), up to 365 days (borderline permanent).

**State transition:** ACTIVE → SUSPENDED (expires after \`durationDays\`).

**Side effects:**
- Sets \`accountStatus = SUSPENDED\` and \`suspendedUntil\` on the user record
- Revokes ALL active sessions immediately (user is forcefully logged out everywhere)
- Creates a \`ModerationAction\` record (\`actionType: SUSPEND_USER\`)
- Sends an in-app notification to the target user
- Optionally links to an existing \`ModerationReport\`

**Restrictions:**
- Cannot suspend another ADMIN
- Cannot suspend an already-BANNED user (409)
- Admin must supply their current password for re-authentication

**Note:** Suspended users regain access automatically when \`suspendedUntil\` passes (if the app enforces it), or use \`/restore\` to lift early.

**Rate limit:** 30 requests / 60 s`,
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "UUID of the target user.",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @ApiBody({ type: SuspendUserDto })
  @ApiCreatedResponse({
    description: "User suspended. Returns the moderation action with suspension details.",
    schema: {
      example: {
        action_id: "c4d5e6f7-b8c9-0d1e-f2a3-b4c5d6e7f8a9",
        action_type: "SUSPEND_USER",
        target_user: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          display_name: "Jane Doe",
          handle: "janedoe",
          account_status: "SUSPENDED",
          suspended_until: "2025-06-08T12:00:00.000Z",
        },
        admin_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        notes: "Repeated violations of community guidelines.",
        created_at: "2025-06-01T12:00:00.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error — `durationDays` missing, not an integer, or out of range (1–365); or `reason` too short.",
    schema: {
      example: {
        statusCode: 400,
        message: [
          "durationDays must be an integer number",
          "durationDays must not be less than 1",
        ],
        error: "Bad Request",
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated — missing or expired `access_token` cookie.",
  })
  @ApiResponse({
    status: 403,
    description:
      "Forbidden. Error codes: `INSUFFICIENT_PERMISSIONS`, `CANNOT_SELF_ENFORCE`, `CANNOT_SUSPEND_ADMIN`, `INCORRECT_PASSWORD`.",
  })
  @ApiResponse({
    status: 404,
    description: "User not found or has been deleted.",
  })
  @ApiResponse({
    status: 409,
    description: "Conflict — user is already BANNED. Restore them first if needed.",
    schema: {
      example: {
        code: "USER_ALREADY_BANNED",
        message: "User is already banned.",
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
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
    summary: "Permanently ban a user",
    description: `Permanently bans a user and immediately hides all their visible content. This is the most severe enforcement action.

**When to use:** Confirmed severe violations — illegal content, targeted harassment campaigns, repeated ban evasion, large-scale spam, or when a prior suspension had no effect.

**State transition:** ACTIVE or SUSPENDED → BANNED (permanent until an admin explicitly restores).

**Side effects (all happen atomically in a single DB transaction):**
- Sets \`accountStatus = BANNED\`
- Revokes ALL active sessions (user is logged out everywhere immediately)
- Hides ALL the user's VISIBLE tracks (\`moderationState\` → \`HIDDEN\`)
- Hides ALL the user's VISIBLE playlists (\`moderationState\` → \`HIDDEN\`)
- Creates a \`ModerationAction\` record (\`actionType: BAN_USER\`)
- Sends an in-app notification to the target user
- Response includes \`tracks_hidden\` — the count of tracks that were hidden

**Restrictions:**
- Cannot ban another ADMIN
- Cannot ban an already-BANNED user (409)
- Admin must supply their current password for re-authentication

**Important:** Content is *hidden* (not deleted). Use the content moderation endpoints to set tracks/playlists to \`REMOVED\` if permanent deletion is required. Content can be restored if the ban is lifted via \`/restore?restoreContent=true\`.

**Rate limit:** 30 requests / 60 s`,
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "UUID of the target user.",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @ApiBody({ type: BanUserDto })
  @ApiCreatedResponse({
    description: "User banned. Returns the moderation action and the number of tracks that were hidden.",
    schema: {
      example: {
        action_id: "d5e6f7a8-c9d0-1e2f-a3b4-c5d6e7f8a9b0",
        action_type: "BAN_USER",
        target_user: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          display_name: "Jane Doe",
          handle: "janedoe",
          account_status: "BANNED",
        },
        admin_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        notes: "Severe and repeated abuse of the platform.",
        tracks_hidden: 12,
        created_at: "2025-06-01T12:00:00.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error — `reason` missing or shorter than 10 characters.",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated — missing or expired `access_token` cookie.",
  })
  @ApiResponse({
    status: 403,
    description:
      "Forbidden. Error codes: `INSUFFICIENT_PERMISSIONS`, `CANNOT_SELF_ENFORCE`, `CANNOT_BAN_ADMIN`, `INCORRECT_PASSWORD`.",
  })
  @ApiResponse({
    status: 404,
    description: "User not found or has been deleted.",
  })
  @ApiResponse({
    status: 409,
    description: "Conflict — user is already BANNED.",
    schema: {
      example: {
        code: "USER_ALREADY_BANNED",
        message: "User is already banned.",
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
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
    summary: "Restore a suspended or banned user",
    description: `Lifts an active suspension or ban, restoring the user's account to ACTIVE status. Optionally re-publishes the user's admin-hidden tracks and playlists.

**When to use:**
- Suspension period ended early (accepted appeal, compassionate grounds)
- Ban was applied in error (false positive)
- Reinstating a previously banned user after a review

**State transition:** SUSPENDED or BANNED → ACTIVE.

**Side effects:**
- Sets \`accountStatus = ACTIVE\` and clears \`suspendedUntil\`
- If \`restoreContent: true\`: all admin-HIDDEN tracks and playlists are set back to VISIBLE
  - Only restores HIDDEN content, NOT REMOVED content (permanent removal is irreversible via this endpoint)
  - Response fields \`tracks_restored\` and \`playlists_restored\` report the counts
- Creates a \`ModerationAction\` record (\`actionType: RESTORE_CONTENT\`)
- Sends an in-app notification to the target user

**Restrictions:**
- Cannot restore an already-ACTIVE user (409 \`USER_ALREADY_ACTIVE\`)
- Does NOT require password re-authentication (unlike warn/suspend/ban)

**Rate limit:** 30 requests / 60 s`,
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "UUID of the target user.",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @ApiBody({ type: RestoreUserDto })
  @ApiCreatedResponse({
    description: "User restored. Returns the moderation action with content restoration counts.",
    schema: {
      example: {
        action_id: "e6f7a8b9-d0e1-2f3a-b4c5-d6e7f8a9b0c1",
        action_type: "RESTORE_CONTENT",
        target_user: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          display_name: "Jane Doe",
          handle: "janedoe",
          account_status: "ACTIVE",
        },
        admin_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        notes: "Appeal accepted. Suspension was applied in error.",
        tracks_restored: 5,
        playlists_restored: 2,
        created_at: "2025-06-01T12:00:00.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error — `reason` missing or shorter than 10 characters.",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated — missing or expired `access_token` cookie.",
  })
  @ApiResponse({
    status: 403,
    description:
      "Forbidden. Error codes: `INSUFFICIENT_PERMISSIONS`, `CANNOT_SELF_ENFORCE`.",
  })
  @ApiResponse({
    status: 404,
    description: "User not found or has been deleted.",
  })
  @ApiResponse({
    status: 409,
    description: "Conflict — user account is already ACTIVE.",
    schema: {
      example: {
        code: "USER_ALREADY_ACTIVE",
        message: "User is already active.",
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Post(":userId/restore")
  @HttpCode(201)
  restoreUser(
    @CurrentUser("userId") adminId: string,
    @Param("userId", ParseUUIDPipe) targetUserId: string,
    @Body() dto: RestoreUserDto,
  ) {
    return this.userEnforcementService.restoreUser(adminId, targetUserId, dto);
  }
}
