import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { startQuery, interruptQuery } from './claude-bridge.js';

describe('startQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('以正確參數呼叫 SDK query', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onMessage = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();
    const abortController = new AbortController();

    await startQuery('hello', {
      cwd: '/test',
      model: 'claude-opus-4-6',
      permissionMode: 'default',
      abortController,
      onMessage,
      onError,
      onComplete,
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hello',
        options: expect.objectContaining({
          cwd: '/test',
          model: 'claude-opus-4-6',
          settingSources: ['project', 'local'],
        }),
      }),
    );
  });

  it('bypassPermissions 設定正確', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('hello', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'bypassPermissions',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      }),
    );
  });

  it('resume 傳遞 session id', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('follow up', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
      resume: 'prev-session-id',
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: 'prev-session-id',
        }),
      }),
    );
  });

  it('有附件時使用 AsyncIterable prompt', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('看這張圖', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
      attachments: [
        { type: 'image', base64: 'abc', mediaType: 'image/png', filename: 'pic.png' },
      ],
    });

    // prompt 應為 AsyncIterable，不是 string
    const callArgs = vi.mocked(query).mock.calls[0][0] as Record<string, unknown>;
    expect(typeof callArgs.prompt).not.toBe('string');
  });

  it('無附件時使用 string prompt', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('plain text', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
    });

    const callArgs = vi.mocked(query).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.prompt).toBe('plain text');
  });

  it('迭代完畢呼叫 onComplete', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onComplete = vi.fn();
    await startQuery('test', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete,
    });

    // 等非同步迭代完成
    await new Promise((r) => setTimeout(r, 600));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('迭代錯誤呼叫 onError', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        throw new Error('SDK error');
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onError = vi.fn();
    await startQuery('test', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError,
      onComplete: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 600));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('SDK error');
  });

  it('AbortError 呼叫 onComplete 而非 onError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        throw abortError;
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onError = vi.fn();
    const onComplete = vi.fn();
    await startQuery('test', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError,
      onComplete,
    });

    await new Promise((r) => setTimeout(r, 600));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('interruptQuery', () => {
  it('呼叫 query.interrupt()', async () => {
    const mockQuery = {
      interrupt: vi.fn().mockResolvedValue(undefined),
    };
    await interruptQuery(mockQuery as never);
    expect(mockQuery.interrupt).toHaveBeenCalledTimes(1);
  });

  it('interrupt 失敗時不拋錯', async () => {
    const mockQuery = {
      interrupt: vi.fn().mockRejectedValue(new Error('already done')),
    };
    await expect(interruptQuery(mockQuery as never)).resolves.toBeUndefined();
  });
});
