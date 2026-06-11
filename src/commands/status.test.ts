import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import { UsageStore } from '../effects/usage-store.js';
import type { BotConfig } from '../types.js';
import { execute } from './status.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReplyEphemeral: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/embeds.js', () => ({
  buildStatusEmbed: vi.fn().mockReturnValue({ title: 'status' }),
  buildGlobalStatusEmbed: vi.fn().mockReturnValue({ title: 'global' }),
}));

import { editReply } from '../effects/discord-sender.js';
import { buildStatusEmbed, buildGlobalStatusEmbed } from '../modules/embeds.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  defaultModel: 'model',
  defaultEffort: null,
  defaultPermissionMode: 'default',
  maxMessageLength: 2000,
  streamUpdateIntervalMs: 2000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 5,
  channels: [{ channelId: 'channel-1', name: 'test', path: '/test' }],
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

describe('status execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未設定的頻道回覆錯誤', async () => {
    const interaction = {
      user: { id: 'user-1' },
      channelId: 'channel-x',
      channel: { isThread: () => false, parentId: null },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown;
    const store = new StateStore();
    const usageStore = new UsageStore();
    await execute(interaction as never, mockConfig, store, usageStore);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
    expect(editReply).not.toHaveBeenCalled();
  });

  it('在 Thread 內顯示 session 狀態（透過父頻道授權）', async () => {
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
      effort: null,
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController: new AbortController(),
      transcript: [],
    });
    const usageStore = new UsageStore();
    const interaction = makeInteraction(true);
    await execute(interaction as never, mockConfig, store, usageStore);
    expect(buildStatusEmbed).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalled();
  });

  it('在頻道中顯示全域狀態', async () => {
    const store = new StateStore();
    const usageStore = new UsageStore();
    const interaction = makeInteraction(false);
    await execute(interaction as never, mockConfig, store, usageStore);
    expect(buildGlobalStatusEmbed).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalled();
  });
});
