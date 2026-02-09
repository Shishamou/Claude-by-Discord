import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ThreadChannel, Message } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import { createCanUseTool } from './permission-handler.js';

// Mock discord-sender
vi.mock('../effects/discord-sender.js', () => ({
  sendEmbedWithApprovalButtons: vi.fn().mockResolvedValue({ id: 'btn-msg-1' } as unknown as Message),
  sendEmbedWithAskButtons: vi.fn().mockResolvedValue({ id: 'ask-msg-1' } as unknown as Message),
  buildQuestionButtons: vi.fn().mockReturnValue([]),
  sendTextInThread: vi.fn().mockResolvedValue([]),
}));

vi.mock('../modules/embeds.js', () => ({
  buildPermissionRequestEmbed: vi.fn().mockReturnValue({ title: 'permission' }),
  buildAskQuestionStepEmbed: vi.fn().mockReturnValue({ title: 'ask-step' }),
}));

import { sendEmbedWithApprovalButtons, sendEmbedWithAskButtons, sendTextInThread } from '../effects/discord-sender.js';

function makeStore(threadId: string, userId = 'u1'): StateStore {
  const store = new StateStore();
  store.setSession(threadId, {
    sessionId: null,
    status: 'running',
    threadId,
    userId,
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
  return store;
}

function makeThread(id = 't1'): ThreadChannel {
  return { id } as unknown as ThreadChannel;
}

/** 等待 pending approval 被設定到 store */
async function waitForPending(store: StateStore, threadId: string, maxWait = 500): Promise<void> {
  const start = Date.now();
  while (!store.getPendingApproval(threadId)) {
    if (Date.now() - start > maxWait) throw new Error('pending approval 設定逾時');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('createCanUseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('一般工具權限請求', () => {
    it('發送權限請求 Embed + 按鈕並回傳結果', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      // 不 await，因為 Promise 會暫停等使用者回應
      const promise = canUseTool('Bash', { command: 'ls' }, { signal });

      await waitForPending(store, 't1');

      expect(sendEmbedWithApprovalButtons).toHaveBeenCalledTimes(1);

      const pending = store.getPendingApproval('t1');
      expect(pending!.toolName).toBe('Bash');

      store.resolvePendingApproval('t1', { behavior: 'allow', updatedInput: { command: 'ls' } });

      const result = await promise;
      expect(result.behavior).toBe('allow');
    });

    it('使用者拒絕時回傳 deny', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const promise = canUseTool('Write', { file_path: '/a.ts' }, { signal });

      await waitForPending(store, 't1');
      store.resolvePendingApproval('t1', { behavior: 'deny', message: '不要' });

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('不要');
    });

    it('@mention 通知使用者', async () => {
      const store = makeStore('t1', 'user-123');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const promise = canUseTool('Bash', {}, { signal });

      await waitForPending(store, 't1');

      expect(sendTextInThread).toHaveBeenCalledWith(
        thread,
        '<@user-123> 有工具需要你審批。',
      );

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AbortSignal 觸發時自動拒絕', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const abortController = new AbortController();
      const promise = canUseTool('Bash', {}, { signal: abortController.signal });

      await waitForPending(store, 't1');
      abortController.abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('任務已中斷');
    });
  });

  describe('AskUserQuestion 特殊處理', () => {
    it('顯示問題按鈕而非審批按鈕', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const input = {
        questions: [
          {
            question: '你要選哪個？',
            header: 'Q1',
            options: [{ label: 'A', description: 'a' }],
            multiSelect: false,
          },
        ],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');

      expect(sendEmbedWithAskButtons).toHaveBeenCalledTimes(1);
      expect(sendEmbedWithApprovalButtons).not.toHaveBeenCalled();

      const pending = store.getPendingApproval('t1');
      expect(pending?.askState).toBeDefined();
      expect(pending?.askState?.totalQuestions).toBe(1);

      store.resolvePendingApproval('t1', { behavior: 'allow', updatedInput: input });
      await promise;
    });

    it('AskUser 別名也觸發特殊處理', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const input = {
        questions: [
          {
            question: 'Q?',
            options: [{ label: 'A' }],
          },
        ],
      };

      const promise = canUseTool('AskUser', input, { signal });

      await waitForPending(store, 't1');
      expect(sendEmbedWithAskButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AskUserQuestion 無選項時 fallback 到一般權限流程', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?' }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');
      expect(sendEmbedWithApprovalButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('@mention 通知使用者回答問題', async () => {
      const store = makeStore('t1', 'user-456');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');

      expect(sendTextInThread).toHaveBeenCalledWith(
        thread,
        '<@user-456> Claude 有問題需要你回答。',
      );

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AskUserQuestion AbortSignal 自動拒絕', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const abortController = new AbortController();
      const input = {
        questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal: abortController.signal });

      await waitForPending(store, 't1');
      abortController.abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('任務已中斷');
    });
  });
});
