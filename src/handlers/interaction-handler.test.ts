import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import { UsageStore } from '../effects/usage-store.js';
import { createInteractionHandler } from './interaction-handler.js';
import type { BotConfig, PendingApproval } from '../types.js';
import type { RateLimitStore } from '../effects/rate-limit-store.js';

// Mock all command modules
vi.mock('../commands/prompt.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/stop.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  executeStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/status.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/history.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/retry.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./ask-handler.js', () => ({
  handleAskOptionClick: vi.fn().mockResolvedValue(undefined),
  handleAskSubmit: vi.fn().mockResolvedValue(undefined),
  handleAskOther: vi.fn().mockResolvedValue(undefined),
  handleAskModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

import * as promptCmd from '../commands/prompt.js';
import * as stopCmd from '../commands/stop.js';
import * as statusCmd from '../commands/status.js';
import * as historyCmd from '../commands/history.js';
import * as retryCmd from '../commands/retry.js';
import { handleAskOptionClick, handleAskSubmit, handleAskOther, handleAskModalSubmit } from './ask-handler.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  discordChannelId: 'channel',
  allowedUserIds: ['user1'],
  defaultCwd: '/test',
  defaultModel: 'model',
  defaultPermissionMode: 'default',
  maxMessageLength: 2000,
  streamUpdateIntervalMs: 2000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 5,
  projects: [],
};

function makeDeps(store?: StateStore) {
  return {
    config: mockConfig,
    store: store || new StateStore(),
    client: {} as never,
    startClaudeQuery: vi.fn().mockResolvedValue(undefined),
    rateLimitStore: { getEntry: vi.fn(), setEntry: vi.fn() } as unknown as RateLimitStore,
    usageStore: new UsageStore(),
  };
}

function makeSlashInteraction(commandName: string) {
  return {
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    commandName,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

function makeButtonInteraction(customId: string) {
  return {
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    customId,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

function makeModalInteraction(customId: string) {
  return {
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    customId,
    reply: vi.fn().mockResolvedValue(undefined),
    fields: {
      getTextInputValue: vi.fn().mockReturnValue('answer'),
    },
  } as unknown;
}

describe('createInteractionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Slash Commands 路由', () => {
    it('路由 /prompt', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('prompt') as never);
      expect(promptCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('路由 /stop', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('stop') as never);
      expect(stopCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('路由 /status', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('status') as never);
      expect(statusCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('路由 /history', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('history') as never);
      expect(historyCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('路由 /retry', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('retry') as never);
      expect(retryCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('未知指令回覆錯誤', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeSlashInteraction('unknown');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '❌ 未知的指令' }),
      );
    });
  });

  describe('Button 互動', () => {
    it('approve 按鈕核准 pending', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'awaiting_permission',
        threadId: 't1',
        userId: 'u1',
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

      const resolveResult = vi.fn();
      const approval: PendingApproval = {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        messageId: 'msg-1',
        resolve: resolveResult,
        createdAt: new Date(),
      };
      store.setPendingApproval('t1', approval);

      const deps = makeDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('approve:t1');
      await handler(interaction as never);

      expect(resolveResult).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'allow' }),
      );
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '✅ 已核准' }),
      );
    });

    it('approve 無 pending 時回覆過期', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('approve:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '⚠️ 此請求已過期' }),
      );
    });

    it('deny 按鈕拒絕 pending', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'awaiting_permission',
        threadId: 't1',
        userId: 'u1',
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

      const resolveResult = vi.fn();
      store.setPendingApproval('t1', {
        toolName: 'Write',
        toolInput: {},
        messageId: 'msg-1',
        resolve: resolveResult,
        createdAt: new Date(),
      });

      const deps = makeDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('deny:t1');
      await handler(interaction as never);

      expect(resolveResult).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'deny' }),
      );
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '❌ 已拒絕' }),
      );
    });

    it('confirm_stop 執行中斷', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'running',
        threadId: 't1',
        userId: 'u1',
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

      const deps = makeDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('confirm_stop:t1');
      await handler(interaction as never);

      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '🛑 任務已中斷' }),
      );
      expect(stopCmd.executeStop).toHaveBeenCalledWith('t1', store, deps.client);
    });

    it('confirm_stop 無 session 時回覆已結束', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('confirm_stop:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '⚠️ 此任務已結束' }),
      );
    });

    it('cancel_stop 回覆已取消', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('cancel_stop:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '✅ 已取消中斷' }),
      );
    });

    it('ask 按鈕路由到 handleAskOptionClick', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask:t1:0:2');
      await handler(interaction as never);
      expect(handleAskOptionClick).toHaveBeenCalledWith(
        interaction, 't1', 0, 2, expect.any(Object),
      );
    });

    it('ask 舊格式相容（兩段）', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask:t1:2');
      await handler(interaction as never);
      expect(handleAskOptionClick).toHaveBeenCalledWith(
        interaction, 't1', 0, 2, expect.any(Object),
      );
    });

    it('ask_submit 路由到 handleAskSubmit', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask_submit:t1:1');
      await handler(interaction as never);
      expect(handleAskSubmit).toHaveBeenCalledWith(
        interaction, 't1', 1, expect.any(Object),
      );
    });

    it('ask_other 路由到 handleAskOther', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask_other:t1:0');
      await handler(interaction as never);
      expect(handleAskOther).toHaveBeenCalledWith(
        interaction, 't1', 0, expect.any(Object),
      );
    });
  });

  describe('Modal 互動', () => {
    it('ask_modal 路由到 handleAskModalSubmit', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeModalInteraction('ask_modal:t1:2');
      await handler(interaction as never);
      expect(handleAskModalSubmit).toHaveBeenCalledWith(
        interaction, 't1', 2, expect.any(Object),
      );
    });

    it('ask_modal 預設 qIdx 為 0', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeModalInteraction('ask_modal:t1');
      await handler(interaction as never);
      expect(handleAskModalSubmit).toHaveBeenCalledWith(
        interaction, 't1', 0, expect.any(Object),
      );
    });
  });
});
