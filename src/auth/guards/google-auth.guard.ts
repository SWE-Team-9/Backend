import { Injectable } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const path = String(req?.route?.path ?? req?.path ?? "");

    // Initial redirect endpoint: pass platform through OAuth state.
    if (!path.includes("callback")) {
      const rawPlatform = String(req?.query?.platform ?? "web").toLowerCase();
      const platform = rawPlatform === "mobile" ? "mobile" : "web";
      return { state: platform };
    }

    // Callback endpoint: don't override options.
    return undefined;
  }
}
