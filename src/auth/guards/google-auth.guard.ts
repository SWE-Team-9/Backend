import { Injectable } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
	getAuthenticateOptions(context: ExecutionContext) {
		const request = context.switchToHttp().getRequest();
		const redirectUri =
			typeof request.query?.redirect_uri === "string"
				? request.query.redirect_uri
				: undefined;

		if (!redirectUri) {
			return {};
		}

		const state = Buffer.from(redirectUri, "utf8").toString("base64url");

		return { state };
	}
}
