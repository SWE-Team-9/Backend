export interface JwtPayload {
  sub: string;
  role: string;
  /** Session ID embedded as JWT ID (jti) — used for server-side revocation checks. */
  jti?: string;
  iat?: number;
  exp?: number;
}
