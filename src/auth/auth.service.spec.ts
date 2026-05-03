import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service";

jest.mock("argon2");

describe("AuthService - setupPassword", () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  const mockMailService = {} as any;
  const mockTokenService = {} as any;
  const mockSessionService = {} as any;
  const mockRecaptchaService = {} as any;
  const mockConfigService = {} as any;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      mockPrisma,
      mockMailService,
      mockTokenService,
      mockSessionService,
      mockRecaptchaService,
      mockConfigService,
    );
  });

  it("sets local password for authenticated OAuth user with null passwordHash", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "u1", passwordHash: null });
    (argon2.hash as jest.Mock).mockResolvedValueOnce("hashed-new-password");
    mockPrisma.user.update.mockResolvedValueOnce({ id: "u1" });

    const result = await service.setupPassword("u1", {
      newPassword: "StrongP@ssw0rd",
      confirmPassword: "StrongP@ssw0rd",
    });

    expect(argon2.hash).toHaveBeenCalledWith("StrongP@ssw0rd");
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "hashed-new-password" },
    });
    expect(result).toEqual({
      message: "Local password set successfully.",
      hasPassword: true,
    });
    expect((result as any).passwordHash).toBeUndefined();
  });

  it("rejects unauthenticated/missing user", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.setupPassword("missing", {
        newPassword: "StrongP@ssw0rd",
        confirmPassword: "StrongP@ssw0rd",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects overwrite when user already has a password", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      passwordHash: "existing-hash",
    });

    await expect(
      service.setupPassword("u1", {
        newPassword: "StrongP@ssw0rd",
        confirmPassword: "StrongP@ssw0rd",
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
