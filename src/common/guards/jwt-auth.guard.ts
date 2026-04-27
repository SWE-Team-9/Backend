import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

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
    return user;
  }
}
