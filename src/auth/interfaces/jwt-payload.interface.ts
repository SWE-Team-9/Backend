export interface JwtPayload {
  sub: string;
  role: "USER" | "MODERATOR" | "ADMIN";
  iat?: number;
  exp?: number;
}
