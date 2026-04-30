import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { MessagesService } from "./messages.service";
import { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
  userBlock: { findFirst: jest.fn(), findUnique: jest.fn() },
  conversation: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  conversationParticipant: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  track: { findUnique: jest.fn() },
  playlist: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

describe("MessagesService", () => {
  let service: MessagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    jest.clearAllMocks();
  });

  // 1. sendMessage - blocked users cannot message
  it("sendMessage: throws MESSAGING_BLOCKED when block exists", async () => {
    mockPrisma.userBlock.findFirst.mockResolvedValueOnce({
      blockerId: "userA",
    });
    await expect(service.sendMessage("userA", "userB", "hello")).rejects.toThrow(
      ForbiddenException,
    );
  });

  // 2. sendMessage - creates new conversation when none exists
  it("sendMessage: calls conversation.create when no conversation exists", async () => {
    mockPrisma.userBlock.findFirst.mockResolvedValueOnce(null);
    mockPrisma.conversation.findFirst.mockResolvedValueOnce(null);
    const convId = "conv-1";
    mockPrisma.conversation.create.mockResolvedValueOnce({ id: convId });
    mockPrisma.conversationParticipant.update.mockResolvedValue({});
    mockPrisma.conversationParticipant.updateMany.mockResolvedValue({});
    mockPrisma.conversationParticipant.findMany.mockResolvedValueOnce([]);
    mockPrisma.message.create.mockResolvedValueOnce({
      id: "msg-1",
      conversationId: convId,
      senderId: "userA",
      messageType: "TEXT",
      body: "hello",
      deletedAt: null,
      editedAt: null,
      createdAt: new Date(),
      conversation: {
        participants: [{ userId: "userA" }, { userId: "userB" }],
      },
      share: null,
    });
    await service.sendMessage("userA", "userB", "hello");
    expect(mockPrisma.conversation.create).toHaveBeenCalled();
  });

  // 3. sendMessage - reuses existing conversation
  it("sendMessage: does not create conversation when one exists", async () => {
    mockPrisma.userBlock.findFirst.mockResolvedValueOnce(null);
    const convId = "conv-existing";
    mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: convId });
    mockPrisma.conversationParticipant.update.mockResolvedValue({});
    mockPrisma.conversationParticipant.updateMany.mockResolvedValue({});
    mockPrisma.conversationParticipant.findMany.mockResolvedValueOnce([]);
    mockPrisma.message.create.mockResolvedValueOnce({
      id: "msg-2",
      conversationId: convId,
      senderId: "userA",
      messageType: "TEXT",
      body: "hey",
      deletedAt: null,
      editedAt: null,
      createdAt: new Date(),
      conversation: {
        participants: [{ userId: "userA" }, { userId: "userB" }],
      },
      share: null,
    });
    await service.sendMessage("userA", "userB", "hey");
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  // 4. getConversationMessages - non-participant gets 404
  it("getConversationMessages: throws NotFoundException for non-participant", async () => {
    mockPrisma.conversationParticipant.findUnique.mockResolvedValueOnce(null);
    await expect(service.getConversationMessages("userX", "conv-1", 1, 20)).rejects.toThrow(
      NotFoundException,
    );
  });

  // 5. shareTrack - throws 404 when track not found
  it("shareTrack: throws 404 when track not found", async () => {
    mockPrisma.userBlock.findFirst.mockResolvedValueOnce(null);
    mockPrisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(service.shareTrack("userA", "userB", "no-track")).rejects.toThrow(
      NotFoundException,
    );
  });

  // 6. shareTrack - throws 403 for private track not owned by sender
  it("shareTrack: throws 403 for private track not owned by sender", async () => {
    mockPrisma.userBlock.findFirst.mockResolvedValueOnce(null);
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-1",
      visibility: "PRIVATE",
      uploaderId: "ownerC",
    });
    await expect(service.shareTrack("userA", "userB", "track-1")).rejects.toThrow(
      ForbiddenException,
    );
  });

  // 7. sharePlaylist - throws 403 for SECRET playlist not owned by sender
  it("sharePlaylist: throws 403 for SECRET playlist not owned by sender", async () => {
    mockPrisma.userBlock.findFirst.mockResolvedValueOnce(null);
    mockPrisma.playlist.findUnique.mockResolvedValueOnce({
      id: "pl-1",
      visibility: "SECRET",
      ownerId: "ownerD",
    });
    await expect(service.sharePlaylist("userA", "userB", "pl-1")).rejects.toThrow(
      ForbiddenException,
    );
  });

  // 8. deleteMessage - non-sender gets 403
  it("deleteMessage: throws 403 when user is not sender", async () => {
    mockPrisma.message.findUnique.mockResolvedValueOnce({
      id: "msg-3",
      senderId: "userB",
      conversationId: "conv-1",
      deletedAt: null,
    });
    await expect(service.deleteMessage("userA", "msg-3")).rejects.toThrow(ForbiddenException);
  });

  // 9. getUnreadCount - returns 0 when no conversations
  it("getUnreadCount: returns 0 when user has no conversations", async () => {
    mockPrisma.conversationParticipant.findMany.mockResolvedValueOnce([]);
    const result = await service.getUnreadCount("userA");
    expect(result).toBe(0);
  });

  // 10. markAsUnread - non-participant gets NotFoundException
  it("markAsUnread: throws NotFoundException for non-participant", async () => {
    mockPrisma.conversationParticipant.findUnique.mockResolvedValueOnce(null);
    await expect(service.markAsUnread("userX", "conv-1")).rejects.toThrow(NotFoundException);
  });
});
