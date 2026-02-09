import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig, SessionState } from '../types.js';
import { execute } from './retry.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  sendInThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/embeds.js', () => ({
  buildRetryEmbed: vi.fn().mockReturnValue({ title: 'retry' }),
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

function makeSession(threadId: string, overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'sess-1',
    status: 'completed',
    threadId,
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: '原始 prompt',
    cwd: '/test',
    model: 'claude-opus-4-6',
    toolCount: 5,
    tools: { Read: 3, Write: 2 },
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

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

describe('retry execute', () => {
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
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
  });

  it('不在 Thread 中時提示', async () => {
    const interaction = makeInteraction(false);
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Thread'),
      }),
    );
  });

  it('無 session 時提示', async () => {
    const interaction = makeInteraction(true);
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('找不到'),
      }),
    );
  });

  it('執行中狀態不允許重試', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'running' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('仍在執行中'),
      }),
    );
  });

  it('awaiting_permission 狀態不允許重試', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'awaiting_permission' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('仍在執行中'),
      }),
    );
  });

  it('completed 狀態可重試', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'completed' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);

    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ content: '🔄 正在重新執行...' }),
    );

    // 新 session 應保留原始 prompt
    const newSession = store.getSession('thread-1');
    expect(newSession?.promptText).toBe('原始 prompt');
    expect(newSession?.status).toBe('running');
    expect(newSession?.toolCount).toBe(0);
    expect(newSession?.sessionId).toBeNull();
  });

  it('error 狀態可重試', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'error' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(editReply).toHaveBeenCalled();
  });

  it('waiting_input 狀態可重試', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'waiting_input' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(editReply).toHaveBeenCalled();
  });

  it('中斷舊的 abortController', async () => {
    const store = new StateStore();
    const oldSession = makeSession('thread-1');
    store.setSession('thread-1', oldSession);
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(oldSession.abortController.signal.aborted).toBe(true);
  });
});
