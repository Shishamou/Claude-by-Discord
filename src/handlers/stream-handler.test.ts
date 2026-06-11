import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ThreadChannel, Message } from 'discord.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { StateStore } from '../effects/state-store.js';
import { UsageStore } from '../effects/usage-store.js';
import { handleSDKMessage } from './stream-handler.js';
import type { StreamHandlerDeps } from './stream-handler.js';

// Mock discord-sender
vi.mock('../effects/discord-sender.js', () => ({
  sendInThread: vi.fn().mockResolvedValue({ id: 'msg1', edit: vi.fn() } as unknown as Message),
  sendPlainInThread: vi.fn().mockResolvedValue({ id: 'stream1', edit: vi.fn() } as unknown as Message),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  sendTextInThread: vi.fn().mockResolvedValue(undefined),
}));

import { sendInThread, sendPlainInThread, editMessageText, sendTextInThread } from '../effects/discord-sender.js';

function makeSession(threadId: string, store: StateStore) {
  store.setSession(threadId, {
    sessionId: null,
    status: 'running',
    threadId,
    userId: 'u1',
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
}

function makeDeps(store: StateStore, usageStore: UsageStore): StreamHandlerDeps {
  return {
    store,
    threadId: 't1',
    thread: { id: 't1' } as unknown as ThreadChannel,
    cwd: '/test',
    streamUpdateIntervalMs: 2000,
    usageStore,
  };
}

function makeStreamState() {
  return {
    currentText: '',
    currentMessage: null as Message | null,
    lastUpdateTime: 0,
    updateTimer: null as ReturnType<typeof setTimeout> | null,
  };
}

describe('handleSDKMessage', () => {
  let store: StateStore;
  let usageStore: UsageStore;

  beforeEach(() => {
    store = new StateStore();
    usageStore = new UsageStore();
    makeSession('t1', store);
    vi.clearAllMocks();
  });

  describe('system init', () => {
    it('更新 sessionId 並記錄 session 開始', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        { type: 'system', subtype: 'init', session_id: 'sess-abc' } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.sessionId).toBe('sess-abc');
      expect(usageStore.getGlobalStats().totalSessions).toBe(1);
    });

    it('非 init subtype 不更新', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        { type: 'system', subtype: 'other' } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.sessionId).toBeNull();
      expect(usageStore.getGlobalStats().totalSessions).toBe(0);
    });
  });

  describe('assistant 文字', () => {
    it('有文字時發送純文字', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(sendTextInThread).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendTextInThread).mock.calls[0][1]).toBe('Hello world');
    });

    it('無文字時不發送', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(sendInThread).not.toHaveBeenCalled();
    });

    it('超長文字直接發送純文字（自動分段）', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const longText = 'x'.repeat(5000);

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: longText }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(sendTextInThread).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendTextInThread).mock.calls[0][1]).toBe(longText);
    });

    it('有串流中訊息時直接編輯為最終文字', async () => {
      const deps = makeDeps(store, usageStore);
      const existingMsg = { id: 'existing', delete: vi.fn() } as unknown as Message;
      const state = makeStreamState();
      state.currentMessage = existingMsg;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Updated' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(editMessageText).toHaveBeenCalledWith(existingMsg, 'Updated');
      expect(existingMsg.delete).not.toHaveBeenCalled();
      expect(sendTextInThread).not.toHaveBeenCalled();
    });

    it('超長文字有串流訊息時刪除後分段發送', async () => {
      const deps = makeDeps(store, usageStore);
      const existingMsg = { id: 'existing', delete: vi.fn() } as unknown as Message;
      const state = makeStreamState();
      state.currentMessage = existingMsg;
      const longText = 'x'.repeat(5000);

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: longText }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(existingMsg.delete).toHaveBeenCalledTimes(1);
      expect(sendTextInThread).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendTextInThread).mock.calls[0][1]).toBe(longText);
    });

    it('重置串流狀態（編輯後）', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      state.currentText = 'accumulated';
      state.currentMessage = { id: 'msg' } as unknown as Message;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Final' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(editMessageText).toHaveBeenCalled();
      expect(state.currentText).toBe('');
      expect(state.currentMessage).toBeNull();
    });

    it('記錄 transcript', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Logged' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.transcript).toHaveLength(1);
      expect(session?.transcript[0].type).toBe('assistant');
      expect(session?.transcript[0].content).toBe('Logged');
    });
  });

  describe('assistant 工具呼叫', () => {
    it('擷取並記錄工具呼叫', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.toolCount).toBe(1);
      expect(session?.tools['Read']).toBe(1);
      // 工具 embed 發送
      expect(sendInThread).toHaveBeenCalledTimes(1);
    });

    it('文字 + 工具呼叫同時處理', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Thinking...' },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' }, id: 'tu2' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      // 純文字 1 次 + 工具 embed 1 次
      expect(sendTextInThread).toHaveBeenCalledTimes(1);
      expect(sendInThread).toHaveBeenCalledTimes(1);
    });

    it('Skill 與 Bash 工具不發送 embed，但仍計數', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu3' },
              { type: 'tool_use', name: 'Skill', input: { name: 'foo' }, id: 'tu4' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.toolCount).toBe(2);
      expect(session?.tools['Bash']).toBe(1);
      expect(session?.tools['Skill']).toBe(1);
      // 兩者都不發送 embed
      expect(sendInThread).not.toHaveBeenCalled();
    });
  });

  describe('stream_event', () => {
    it('text_delta 累積文字', async () => {
      const deps = makeDeps(store, usageStore);
      // 設定足夠久的 lastUpdateTime 以觸發即時更新
      const state = makeStreamState();
      state.lastUpdateTime = 0;

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.currentText).toBe('Hello');
    });

    it('多次 text_delta 持續累積', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' World' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.currentText).toBe('Hello World');
    });

    it('非 text_delta 不累積', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: '{}' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.currentText).toBe('');
    });
  });

  describe('result', () => {
    it('成功時不發送任何訊息或 embed，但仍記錄用量與 transcript', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'success',
          result: 'Done!',
          duration_ms: 5000,
          total_cost_usd: 0.05,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      // 成功結果不再發送統計 embed（回應文字已在 assistant 階段發送）
      expect(sendInThread).not.toHaveBeenCalled();
      expect(sendTextInThread).not.toHaveBeenCalled();
      expect(sendPlainInThread).not.toHaveBeenCalled();

      // 用量仍正常記錄
      const stats = usageStore.getGlobalStats();
      expect(stats.completedQueries).toBe(1);
      expect(stats.totalCostUsd).toBeCloseTo(0.05);

      // transcript 仍正常記錄
      const session = store.getSession('t1');
      expect(session?.transcript).toHaveLength(1);
      expect(session?.transcript[0].type).toBe('result');
      expect(session?.transcript[0].content).toBe('Done!');
    });

    it('失敗時發送錯誤 embed', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'error',
          errors: ['Something broke'],
          duration_ms: 1000,
          total_cost_usd: 0.01,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(sendInThread).toHaveBeenCalledTimes(1);
      const embed = vi.mocked(sendInThread).mock.calls[0][1] as Record<string, unknown>;
      expect(embed.description).toContain('Something broke');
    });

    it('記錄全域用量', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'success',
          result: '',
          duration_ms: 3000,
          total_cost_usd: 0.10,
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const stats = usageStore.getGlobalStats();
      expect(stats.completedQueries).toBe(1);
      expect(stats.totalCostUsd).toBeCloseTo(0.10);
    });

    it('記錄 transcript', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'success',
          result: 'Transcript test',
          duration_ms: 1000,
          total_cost_usd: 0,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.transcript).toHaveLength(1);
      expect(session?.transcript[0].type).toBe('result');
    });
  });

  describe('tool_progress 和 unknown', () => {
    it('tool_progress 不做任何事', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        { type: 'tool_progress' } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(sendInThread).not.toHaveBeenCalled();
    });

    it('未知 type 不做任何事', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        { type: 'unknown_type' } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(sendInThread).not.toHaveBeenCalled();
    });
  });

  describe('assistant 節流計時器清除', () => {
    it('清除排程中的節流更新', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const timer = setTimeout(() => {}, 10000);
      state.updateTimer = timer;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.updateTimer).toBeNull();
    });
  });
});
