import { SetMetadata } from "@nestjs/common";

/**
 * Mark an endpoint as accessible even for SUSPENDED or BANNED accounts.
 * Used for routes like POST /reports/appeal where restricted users must
 * still be able to act.
 */
export const ALLOW_SUSPENDED_KEY = "allowSuspended";
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
