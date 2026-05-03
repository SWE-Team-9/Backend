import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";

import { AuthService } from "./auth.service";

jest.mock("argon2");

const makeUser = (overrides: Record<string, any> = {}) => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: "hashed-current",
  profile: {
    displayName: "Test User",
    handle: "testuser",
    avatarUrl: null,
    accountType: "LISTENER",
  },
  systemRole: "USER",
  accountStatus: "ACTIVE",
  isVerified: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  subscriptions: [],
  ...overrides,
});

function buildService() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const sessionService: any = {
    revokeOtherSessions: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AuthService(
    prisma,
    {} as any,
    {} as any,
    sessionService,
    {} as any,
    {} as any,
  );

  return { service, prisma, sessionService };
}

describe("AuthService password setup/change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (argon2.hash as jest.Mock).mockResolvedValue("hashed-new");
  });

  it("getMe returns hasPassword=false without exposing passwordHash for OAuth users", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser({ passwordHash: null }));

    const result = await service.getMe("user-1");

    expect(result.hasPassword).toBe(false);
    expect(result.has_password).toBe(false);
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("getMe returns hasPassword=true for users with a local password", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());

    const result = await service.getMe("user-1");

    expect(result.hasPassword).toBe(true);
    expect(result.has_password).toBe(true);
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("lets an OAuth user with no local password set one without current password", async () => {
    const { service, prisma, sessionService } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser({ passwordHash: null }));

    const result = await service.changePassword("user-1", "session-1", {
      new_password: "NewPass123!",
      new_password_confirm: "NewPass123!",
    });

    expect(argon2.hash).toHaveBeenCalledWith("NewPass123!");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "hashed-new" },
    });
    expect(sessionService.revokeOtherSessions).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "Password set successfully.", hasPassword: true });
  });

  it("requires current password for users who already have a local password", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());

    await expect(
      service.changePassword("user-1", "session-1", {
        new_password: "NewPass123!",
        new_password_confirm: "NewPass123!",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: "CURRENT_PASSWORD_REQUIRED" }),
    });
  });

  it("rejects wrong current password for local-password users", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());
    (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

    await expect(
      service.changePassword("user-1", "session-1", {
        current_password: "wrong",
        new_password: "NewPass123!",
        new_password_confirm: "NewPass123!",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("changes password normally for local-password users and revokes other sessions", async () => {
    const { service, prisma, sessionService } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);

    const result = await service.changePassword("user-1", "session-1", {
      current_password: "OldPass123!",
      new_password: "NewPass123!",
      new_password_confirm: "NewPass123!",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "hashed-new" },
    });
    expect(sessionService.revokeOtherSessions).toHaveBeenCalledWith("user-1", "session-1");
    expect(result.hasPassword).toBe(true);
  });

  it("rejects changing to the same password text", async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);

    await expect(
      service.changePassword("user-1", "session-1", {
        current_password: "SamePass123!",
        new_password: "SamePass123!",
        new_password_confirm: "SamePass123!",
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
