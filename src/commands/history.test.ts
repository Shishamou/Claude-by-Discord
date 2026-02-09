import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig } from '../types.js';
import { execute } from './history.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReplyEphemeral: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/transcript-formatter.js', () => ({
  formatTranscript: vi.fn().mockReturnValue('# Transcript'),
}));

import { editReply } from '../effects/discord-sender.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  discordChannelId: 'channel-1',
  allowedUserIds: ['user-1'],
  defaultCwd: '/test',
  defaultModel: 'model',
  defaultPermissionMode: 'default',
  maxMessageLength: 2000,
  streamUpdateIntervalMs: 2000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 5,
  projects: [],
};

function makeInteraction(inThread: boolean, threadId = 'thread-1') {
  return {
    user: { id: 'user-1' },
    channelId: inThread ? threadId : 'channel-1',
    channel: inThread
      ? { isThread: () => true, id: threadId, parentId: 'channel-1' }
      : { isThread: () => false, parentId: null },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

describe('history execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未授權使用者回覆錯誤', async () => {
    const interaction = {
      user: { id: 'bad' },
      channelId: 'channel-1',
      channel: { parentId: null },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown;
    const store = new StateStore();
    await execute(interaction as never, mockConfig, store);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
  });

  it('不在 Thread 中時提示', async () => {
    const interaction = makeInteraction(false);
    const store = new StateStore();
    await execute(interaction as never, mockConfig, store);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Thread'),
      }),
    );
  });

  it('無 transcript 時提示', async () => {
    const store = new StateStore();
    store.setSession('thread-1', {
      sessionId: null,
      status: 'running',
      threadId: 'thread-1',
      userId: 'user-1',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      promptText: 'test',
      cwd: '/test',
      model: 'model',
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController: new AbortController(),
      transcript: [],
    });
    const interaction = makeInteraction(true);
    await execute(interaction as never, mockConfig, store);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('沒有對話記錄'),
      }),
    );
  });

  it('有 transcript 時匯出為 Markdown 檔案', async () => {
    const store = new StateStore();
    store.setSession('thread-1', {
      sessionId: null,
      status: 'completed',
      threadId: 'thread-1',
      userId: 'user-1',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      promptText: 'test',
      cwd: '/test',
      model: 'model',
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController: new AbortController(),
      transcript: [
        { timestamp: new Date(), type: 'assistant' as const, content: 'Hello' },
      ],
    });
    const interaction = makeInteraction(true);
    await execute(interaction as never, mockConfig, store);
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('1 筆'),
        files: expect.any(Array),
      }),
    );
  });
});
