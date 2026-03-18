import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { StorageService, UploadType } from "./storage.service";

// ---------------------------------------------------------------------------
// S3 SDK is mocked at the module level so no real AWS calls are made.
// ---------------------------------------------------------------------------

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
    PutObjectCommand: jest
      .fn()
      .mockImplementation((params) => ({ _type: "Put", ...params })),
    DeleteObjectCommand: jest
      .fn()
      .mockImplementation((params) => ({ _type: "Delete", ...params })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    "storage.provider": "local",
    "storage.localUploadDir": os.tmpdir(),
    "storage.localUploadUrl": "http://localhost:3000/uploads",
    "storage.maxAvatarBytes": 5 * 1024 * 1024,
    "storage.maxCoverBytes": 15 * 1024 * 1024,
    "storage.s3Bucket": "test-bucket",
    "storage.s3Region": "us-east-1",
    "storage.awsAccessKeyId": "key",
    "storage.awsSecretAccessKey": "secret",
    "storage.cdnUrl": "https://cdn.example.com",
    ...overrides,
  };

  return {
    get: jest.fn().mockImplementation((key: string, fallback?: unknown) => {
      return key in defaults ? defaults[key] : fallback;
    }),
  };
}

async function buildService(
  overrides?: Record<string, unknown>,
): Promise<StorageService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StorageService,
      { provide: ConfigService, useValue: makeConfigService(overrides) },
    ],
  }).compile();

  return module.get(StorageService);
}

const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic bytes
const metadata = (type: UploadType = "avatar") => ({
  userId: "user-1",
  type,
  mimeType: "image/jpeg",
  originalName: "photo.jpg",
});

// ---------------------------------------------------------------------------
// StorageService - local provider
// ---------------------------------------------------------------------------

describe("StorageService (local)", () => {
  let service: StorageService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
    service = await buildService({
      "storage.provider": "local",
      "storage.localUploadDir": tmpDir,
      "storage.localUploadUrl": "http://localhost:3000/uploads",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("upload", () => {
    it("writes the file to disk under {type}/{uuid}.{ext}", async () => {
      const result = await service.upload(validJpeg, metadata());

      expect(result.url).toContain("http://localhost:3000/uploads/avatar/");
      expect(result.key).toMatch(/^avatar\/[0-9a-f-]+\.jpg$/);

      // File must actually exist
      const fullPath = path.join(tmpDir, result.key);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.readFileSync(fullPath)).toEqual(validJpeg);
    });

    it("returns a key with the correct extension for png", async () => {
      const result = await service.upload(validJpeg, {
        ...metadata(),
        mimeType: "image/png",
        originalName: "photo.png",
      });
      expect(result.key).toMatch(/\.png$/);
    });

    it("places cover images under the cover/ prefix", async () => {
      const result = await service.upload(validJpeg, metadata("cover"));
      expect(result.key).toMatch(/^cover\//);
    });

    it("throws BadRequestException for an unsupported mime type", async () => {
      await expect(
        service.upload(validJpeg, { ...metadata(), mimeType: "image/gif" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when avatar exceeds the 5 MB limit", async () => {
      const bigFile = Buffer.alloc(6 * 1024 * 1024);
      await expect(service.upload(bigFile, metadata("avatar"))).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when cover exceeds the 15 MB limit", async () => {
      const bigFile = Buffer.alloc(16 * 1024 * 1024);
      await expect(service.upload(bigFile, metadata("cover"))).rejects.toThrow(
        BadRequestException,
      );
    });

    it("never uses the original filename in the storage key (SSRF / path-traversal guard)", async () => {
      const malicious = { ...metadata(), originalName: "../../etc/passwd.jpg" };
      const result = await service.upload(validJpeg, malicious);
      expect(result.key).not.toContain("..");
      expect(result.key).not.toContain("etc");
    });
  });

  describe("delete", () => {
    it("removes the file from disk", async () => {
      const { key } = await service.upload(validJpeg, metadata());
      const fullPath = path.join(tmpDir, key);
      expect(fs.existsSync(fullPath)).toBe(true);

      await service.delete(key);
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it("does not throw when key does not exist", async () => {
      await expect(
        service.delete("avatar/nonexistent.jpg"),
      ).resolves.not.toThrow();
    });

    it("does not throw when key is empty string", async () => {
      await expect(service.delete("")).resolves.not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// StorageService - S3 provider
// ---------------------------------------------------------------------------

describe("StorageService (S3)", () => {
  let service: StorageService;

  beforeEach(async () => {
    mockS3Send.mockResolvedValue({});
    service = await buildService({
      "storage.provider": "s3",
      "storage.s3Bucket": "my-bucket",
      "storage.s3Region": "eu-west-1",
      "storage.awsAccessKeyId": "AKID",
      "storage.awsSecretAccessKey": "secret",
      "storage.cdnUrl": "https://cdn.example.com",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("upload", () => {
    it("calls S3Client.send with a PutObjectCommand", async () => {
      const result = await service.upload(validJpeg, metadata());

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const [cmd] = mockS3Send.mock.calls[0] as any[];
      expect(cmd._type).toBe("Put");
      expect(cmd.Bucket).toBe("my-bucket");
      expect(cmd.Key).toMatch(/^avatar\//);
      expect(cmd.ContentType).toBe("image/jpeg");
      expect(cmd.Body).toEqual(validJpeg);
    });

    it("returns a URL prefixed with the CDN URL", async () => {
      const result = await service.upload(validJpeg, metadata());
      expect(result.url).toMatch(/^https:\/\/cdn\.example\.com\/avatar\//);
    });

    it("falls back to the default S3 URL when cdnUrl is empty", async () => {
      const svc = await buildService({
        "storage.provider": "s3",
        "storage.s3Bucket": "my-bucket",
        "storage.cdnUrl": "",
      });
      const result = await svc.upload(validJpeg, metadata());
      expect(result.url).toMatch(
        /^https:\/\/my-bucket\.s3\.amazonaws\.com\/avatar\//,
      );
    });

    it("still rejects disallowed mime types on the S3 path", async () => {
      await expect(
        service.upload(validJpeg, { ...metadata(), mimeType: "image/bmp" }),
      ).rejects.toThrow(BadRequestException);
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("calls S3Client.send with a DeleteObjectCommand", async () => {
      await service.delete("avatar/abc.jpg");

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const [cmd] = mockS3Send.mock.calls[0] as any[];
      expect(cmd._type).toBe("Delete");
      expect(cmd.Bucket).toBe("my-bucket");
      expect(cmd.Key).toBe("avatar/abc.jpg");
    });

    it("does not throw when S3 send fails (non-critical cleanup)", async () => {
      mockS3Send.mockRejectedValueOnce(new Error("NoSuchKey"));
      await expect(service.delete("avatar/gone.jpg")).resolves.not.toThrow();
    });
  });
});
