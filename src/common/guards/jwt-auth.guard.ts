import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ALLOW_SUSPENDED_KEY } from "../decorators/allow-suspended.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt-cookie") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // Still attempt to extract the user so @Public() routes can optionally
      // use req.user (e.g. to check track ownership). Swallow any auth errors.
      try {
        await super.canActivate(context);
      } catch {
        // no valid token - that's fine on public routes
      }
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }

  handleRequest<TUser = any>(
    err: Error | null,
    user: TUser | false,
    _info?: unknown,
    context?: ExecutionContext,
  ): TUser {
    const isPublic = context
      ? this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          context.getHandler(),
          context.getClass(),
        ])
      : false;

    // On public routes, missing/invalid tokens are fine - just return no user
    if (isPublic) {
      return (user || undefined) as TUser;
    }

    if (err || !user) {
      throw new UnauthorizedException({
        code: "NOT_AUTHENTICATED",
        message: "Authentication is required to access this resource.",
      });
    }

    // Block suspended / banned users unless the endpoint opts out
    const typedUser = user as { accountStatus?: string };
    if (
      typedUser.accountStatus === "SUSPENDED" ||
      typedUser.accountStatus === "BANNED"
    ) {
      const allowSuspended = context
        ? this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_KEY, [
            context.getHandler(),
            context.getClass(),
          ])
        : false;

      if (!allowSuspended) {
        const code =
          typedUser.accountStatus === "SUSPENDED"
            ? "ACCOUNT_SUSPENDED"
            : "ACCOUNT_BANNED";
        throw new ForbiddenException({ code, message: `Account ${typedUser.accountStatus.toLowerCase()}.` });
      }
    }

    return user;
  }
}
