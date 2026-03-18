import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";

import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { CookieService } from "../src/auth/services/cookie.service";
import { TokenService } from "../src/auth/services/token.service";
import { GlobalHttpExceptionFilter } from "../src/common/filters/global-http-exception.filter";
import { UsersController } from "../src/users/users.controller";
import { UsersService } from "../src/users/users.service";

type AuthServiceMock = {
  register: jest.Mock;
  login: jest.Mock;
  applyAuthCookies: jest.Mock;
  refreshSession: jest.Mock;
};

type UsersServiceMock = {
  updateProfile: jest.Mock;
  uploadProfileImage: jest.Mock;
};

describe("Module 1/2 critical flows (e2e)", () => {
  let app: INestApplication;
  let authService: AuthServiceMock;
  let usersService: UsersServiceMock;

  beforeEach(async () => {
    authService = {
      register: jest.fn().mockResolvedValue({
        message:
          "Registration successful. Please check your email for a verification link.",
      }),
      login: jest.fn().mockResolvedValue({
        accessToken: "mock-access",
        refreshToken: "mock-refresh",
        rememberMe: false,
        user: {
          id: "user-e2e",
          email: "e2e@example.com",
          role: "USER",
          isVerified: true,
        },
      }),
      applyAuthCookies: jest.fn().mockImplementation(({ response }: any) => {
        response.cookie("access_token", "mock-access", {
          httpOnly: true,
          path: "/",
        });
        response.cookie("refresh_token", "mock-refresh", {
          httpOnly: true,
          path: "/",
        });
      }),
      refreshSession: jest.fn().mockResolvedValue({
        accessToken: "mock-access-2",
        refreshToken: "mock-refresh-2",
        rememberMe: false,
        user: {
          id: "user-e2e",
          email: "e2e@example.com",
          role: "USER",
          isVerified: true,
        },
      }),
    };

    usersService = {
      updateProfile: jest.fn().mockResolvedValue({
        display_name: "E2E User",
        bio: "Updated by e2e",
      }),
      uploadProfileImage: jest.fn().mockResolvedValue({
        url: "http://localhost:3000/uploads/avatar/e2e.jpg",
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: CookieService,
          useValue: {
            clearAuthCookies: jest.fn(),
            setAuthCookies: jest.fn(),
          },
        },
        {
          provide: TokenService,
          useValue: {
            signAccessToken: jest.fn().mockReturnValue("google-access"),
            createRefreshToken: jest.fn().mockReturnValue({
              rawToken: "google-refresh",
              tokenHash: "google-refresh-hash",
              expiresAt: new Date(Date.now() + 60_000),
            }),
          },
        },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        userId: "user-e2e",
        role: "USER",
      };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /api/v1/auth/register validates and returns success", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: "invalid-email",
        password: "StrongP@ss1",
        password_confirm: "StrongP@ss1",
        display_name: "E2E User",
        date_of_birth: "2000-01-01",
        gender: "MALE",
      })
      .expect(400);

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: "e2e@example.com",
        password: "StrongP@ss1",
        password_confirm: "StrongP@ss1",
        display_name: "E2E User",
        date_of_birth: "2000-01-01",
        gender: "MALE",
      })
      .expect(201);

    expect(response.body.message).toContain("Registration successful");
    expect(authService.register).toHaveBeenCalled();
  });

  it("POST /api/v1/auth/login sets auth cookies", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: "e2e@example.com",
        password: "StrongP@ss1",
      })
      .expect(200);

    expect(response.body.message).toBe("Login successful.");
    const setCookieHeader = response.headers["set-cookie"];
    expect(Array.isArray(setCookieHeader)).toBe(true);

    const cookieValues = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [String(setCookieHeader)];

    expect(cookieValues.some((v) => v.includes("access_token="))).toBe(true);
    expect(cookieValues.some((v) => v.includes("refresh_token="))).toBe(true);
  });

  it("POST /api/v1/auth/refresh reads cookie and rotates tokens", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", ["refresh_token=mock-refresh"])
      .send({})
      .expect(200);

    expect(authService.refreshSession).toHaveBeenCalledWith(
      "mock-refresh",
      expect.objectContaining({
        ipAddress: expect.any(String),
        userAgent: expect.any(String),
      }),
    );
    expect(response.body.message).toBe("Token refreshed successfully.");
  });

  it("PATCH /api/v1/profiles/me updates profile for authenticated user", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/v1/profiles/me")
      .send({
        display_name: "Updated E2E",
        website: "https://example.com",
      })
      .expect(200);

    expect(response.body.display_name).toBe("E2E User");
    expect(usersService.updateProfile).toHaveBeenCalledWith("user-e2e", {
      display_name: "Updated E2E",
      website: "https://example.com",
    });
  });

  it("POST /api/v1/profiles/me/images/:type uploads avatar image", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/profiles/me/images/avatar")
      .attach("file", Buffer.from("fake-image-content"), {
        filename: "avatar.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);

    expect(response.body.url).toContain("uploads/avatar");
    expect(usersService.uploadProfileImage).toHaveBeenCalledWith(
      "user-e2e",
      "avatar",
      expect.any(Object),
    );
  });
});
