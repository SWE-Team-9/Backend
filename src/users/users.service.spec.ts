import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { UsersService } from "./users.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../common/storage/storage.service";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function buildPrismaProfile(overrides: Partial<any> = {}) {
  return {
    userId: "user-1",
    handle: "testuser",
    displayName: "Test User",
    bio: "Hello world",
    location: "Cairo",
    avatarUrl: null,
    coverPhotoUrl: null,
    accountType: "LISTENER",
    visibility: "PUBLIC",
    likesVisible: true,
    websiteUrl: null,
    updatedAt: new Date("2024-01-01"),
    user: { createdAt: new Date("2024-01-01"), isVerified: false },
    ...overrides,
  };
}

function buildPrismaMock() {
  const $transaction = jest
    .fn()
    .mockImplementation((fn: any) =>
      typeof fn === "function" ? fn(prismaMock) : Promise.all(fn),
    );

  const prismaMock: any = {
    $transaction,
    userProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userFavoriteGenre: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userSocialLink: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    genre: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    track: {
      count: jest.fn().mockResolvedValue(0),
    },
    userHandleHistory: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  return prismaMock;
}

function buildStorageMock() {
  return {
    upload: jest.fn().mockResolvedValue({
      url: "https://cdn.example.com/avatar/abc.jpg",
      key: "avatar/abc.jpg",
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("UsersService", () => {
  let service: UsersService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let storage: ReturnType<typeof buildStorageMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    storage = buildStorageMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  // getProfileByHandle
  describe("getProfileByHandle", () => {
    it("returns the full profile for a public profile", async () => {
      const profile = buildPrismaProfile();
      prisma.userProfile.findUnique.mockResolvedValue(profile);

      const result = await service.getProfileByHandle("testuser");

      expect(result).toMatchObject({
        handle: "testuser",
        display_name: "Test User",
        is_private: false,
      });
    });

    it("returns limited fields for a private profile viewed by a stranger", async () => {
      const profile = buildPrismaProfile({ visibility: "PRIVATE" });
      prisma.userProfile.findUnique.mockResolvedValue(profile);

      const result = await service.getProfileByHandle(
        "testuser",
        "stranger-id",
      );

      expect(result).toEqual({
        handle: "testuser",
        display_name: "Test User",
        avatar_url: null,
        account_type: "LISTENER",
        is_private: true,
      });

      // Should NOT have loaded genres or social links for a private/hidden profile
      expect(prisma.userFavoriteGenre.findMany).not.toHaveBeenCalled();
    });

    it("returns the full profile when the owner views their own private profile", async () => {
      const profile = buildPrismaProfile({ visibility: "PRIVATE" });
      prisma.userProfile.findUnique.mockResolvedValue(profile);

      const result = await service.getProfileByHandle("testuser", "user-1");

      expect(result).toHaveProperty("bio");
      expect(result).toHaveProperty("social_links");
    });

    it("throws NotFoundException when handle does not exist", async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(service.getProfileByHandle("nobody")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("includes track_count for ARTIST profiles", async () => {
      const profile = buildPrismaProfile({ accountType: "ARTIST" });
      prisma.userProfile.findUnique.mockResolvedValue(profile);
      prisma.track.count.mockResolvedValue(12);

      const result = await service.getProfileByHandle("testuser");

      expect(result).toHaveProperty("track_count", 12);
    });

    it("sets track_count to 0 for LISTENER profiles", async () => {
      const profile = buildPrismaProfile({ accountType: "LISTENER" });
      prisma.userProfile.findUnique.mockResolvedValue(profile);

      const result = await service.getProfileByHandle("testuser");

      expect(result).toHaveProperty("track_count", 0);
      expect(prisma.track.count).not.toHaveBeenCalled();
    });
  });

  // getMyProfile
  describe("getMyProfile", () => {
    it("returns the full profile without privacy gating", async () => {
      const profile = buildPrismaProfile({ visibility: "PRIVATE" });
      prisma.userProfile.findUnique.mockResolvedValue(profile);

      const result = await service.getMyProfile("user-1");

      expect(result).toHaveProperty("bio");
    });

    it("throws NotFoundException when user has no profile", async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(service.getMyProfile("no-profile")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // updateProfile
  describe("updateProfile", () => {
    beforeEach(() => {
      const updatedProfile = buildPrismaProfile({ displayName: "New Name" });
      prisma.userProfile.update.mockResolvedValue(updatedProfile);
    });

    it("updates display_name and bio", async () => {
      await service.updateProfile("user-1", {
        display_name: "New Name",
        bio: "Bio text",
      });

      expect(prisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          data: { displayName: "New Name", bio: "Bio text" },
        }),
      );
    });

    it("sets visibility to PRIVATE when is_private = true", async () => {
      await service.updateProfile("user-1", { is_private: true });

      expect(prisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { visibility: "PRIVATE" },
        }),
      );
    });

    it("sets visibility to PUBLIC when is_private = false", async () => {
      await service.updateProfile("user-1", { is_private: false });

      expect(prisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { visibility: "PUBLIC" },
        }),
      );
    });

    it("resolves genres and performs a transaction when favorite_genres is provided", async () => {
      prisma.genre.findMany.mockResolvedValue([
        { id: 1, slug: "pop", name: "Pop" },
        { id: 2, slug: "rock", name: "Rock" },
      ]);
      prisma.userProfile.update.mockResolvedValue(buildPrismaProfile());

      await service.updateProfile("user-1", {
        favorite_genres: ["pop", "rock"],
      });

      // Transaction wraps the genre-swap, so deleteMany + createMany must be called
      expect(prisma.userFavoriteGenre.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(prisma.userFavoriteGenre.createMany).toHaveBeenCalledWith({
        data: [
          { userId: "user-1", genreId: 1 },
          { userId: "user-1", genreId: 2 },
        ],
      });
    });

    it("throws BadRequestException for an invalid genre slug", async () => {
      // Only one of two slugs found in DB
      prisma.genre.findMany.mockResolvedValue([
        { id: 1, slug: "pop", name: "Pop" },
      ]);

      await expect(
        service.updateProfile("user-1", {
          favorite_genres: ["pop", "not-a-genre"],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for a non-HTTPS website URL (SSRF guard)", async () => {
      await expect(
        service.updateProfile("user-1", {
          website: "http://internal.corp/admin",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // checkHandleAvailability
  describe("checkHandleAvailability", () => {
    it("returns { available: true } when the handle is not taken", async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      prisma.userHandleHistory.findFirst.mockResolvedValue(null);

      const result = await service.checkHandleAvailability("freshhandle");

      expect(result).toEqual({ available: true });
    });

    it("returns { available: false } when the handle is active", async () => {
      prisma.userProfile.findUnique.mockResolvedValue({ userId: "someone" });

      const result = await service.checkHandleAvailability("takenhandle");

      expect(result).toEqual({ available: false });
      // Should not bother checking history once the profile hit is found
      expect(prisma.userHandleHistory.findFirst).not.toHaveBeenCalled();
    });

    it("returns { available: false } for a recently retired handle (30-day cooldown)", async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      prisma.userHandleHistory.findFirst.mockResolvedValue({ id: "hist-1" });

      const result = await service.checkHandleAvailability("retiredhandle");

      expect(result).toEqual({ available: false });
    });
  });

  // updateExternalLinks
  describe("updateExternalLinks", () => {
    it("deletes existing links and inserts the new set", async () => {
      prisma.userSocialLink.findMany.mockResolvedValue([
        {
          platform: "X",
          url: "https://twitter.com/user",
          createdAt: new Date(),
        },
      ]);

      await service.updateExternalLinks("user-1", {
        links: [{ platform: "twitter", url: "https://twitter.com/user" }],
      });

      expect(prisma.userSocialLink.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(prisma.userSocialLink.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            {
              userId: "user-1",
              platform: "X",
              url: "https://twitter.com/user",
            },
          ],
        }),
      );
    });

    it("clears all links when an empty array is sent", async () => {
      prisma.userSocialLink.findMany.mockResolvedValue([]);

      const result = await service.updateExternalLinks("user-1", { links: [] });

      expect(prisma.userSocialLink.deleteMany).toHaveBeenCalled();
      expect(prisma.userSocialLink.createMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("throws BadRequestException for an http:// URL (SSRF guard)", async () => {
      await expect(
        service.updateExternalLinks("user-1", {
          links: [{ platform: "twitter", url: "http://twitter.com/user" }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("defaults sort_order to the array index when not supplied", async () => {
      prisma.userSocialLink.findMany.mockResolvedValue([]);

      await service.updateExternalLinks("user-1", {
        links: [
          { platform: "instagram", url: "https://instagram.com/a" },
          { platform: "twitter", url: "https://twitter.com/b" },
        ],
      });

      const { data } = (prisma.userSocialLink.createMany as jest.Mock).mock
        .calls[0][0];
      expect(data[0].platform).toBe("INSTAGRAM");
      expect(data[1].platform).toBe("X");
    });
  });

  // uploadProfileImage
  describe("uploadProfileImage", () => {
    const mockFile: Express.Multer.File = {
      buffer: Buffer.from("fake"),
      mimetype: "image/jpeg",
      originalname: "photo.jpg",
      fieldname: "file",
      encoding: "7bit",
      size: 4,
      stream: null as any,
      destination: "",
      filename: "",
      path: "",
    };

    beforeEach(() => {
      prisma.userProfile.findUnique.mockResolvedValue(
        buildPrismaProfile({
          avatarUrl: "https://cdn.example.com/avatar/old.jpg",
        }),
      );
      prisma.userProfile.update.mockResolvedValue(buildPrismaProfile());
    });

    it("calls StorageService.upload and updates the profile avatar_url", async () => {
      const result = await service.uploadProfileImage(
        "user-1",
        "avatar",
        mockFile,
      );

      expect(storage.upload).toHaveBeenCalledWith(mockFile.buffer, {
        userId: "user-1",
        type: "avatar",
        mimeType: "image/jpeg",
        originalName: "photo.jpg",
      });

      expect(prisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          data: { avatarUrl: "https://cdn.example.com/avatar/abc.jpg" },
        }),
      );

      expect(result).toEqual({ url: "https://cdn.example.com/avatar/abc.jpg" });
    });

    it("triggers deletion of the old avatar (fire-and-forget)", async () => {
      await service.uploadProfileImage("user-1", "avatar", mockFile);

      // Give the background promise a tick to run
      await new Promise((r) => setImmediate(r));

      expect(storage.delete).toHaveBeenCalledWith("avatar/old.jpg");
    });

    it("updates coverPhotoUrl when type is cover", async () => {
      prisma.userProfile.findUnique.mockResolvedValue(
        buildPrismaProfile({
          coverPhotoUrl: "https://cdn.example.com/cover/old.jpg",
        }),
      );

      await service.uploadProfileImage("user-1", "cover", mockFile);

      expect(prisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { coverPhotoUrl: "https://cdn.example.com/avatar/abc.jpg" },
        }),
      );
    });

    it("throws NotFoundException when the user has no profile record", async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadProfileImage("ghost", "avatar", mockFile),
      ).rejects.toThrow(NotFoundException);
    });

    it("does not throw if old image deletion fails (non-critical)", async () => {
      storage.delete.mockRejectedValue(new Error("S3 error"));

      await expect(
        service.uploadProfileImage("user-1", "avatar", mockFile),
      ).resolves.not.toThrow();
    });
  });
});
