import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { SessionState } from '../types.js';
import { executeStop, buildStopConfirmRow } from './stop.js';

vi.mock('../effects/discord-sender.js', () => ({
  sendInThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/embeds.js', () => ({
  buildStopConfirmEmbed: vi.fn().mockReturnValue({ title: 'confirmed' }),
}));

function makeSession(threadId: string, overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: null,
    status: 'running',
    threadId,
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test',
    cwd: '/test',
    model: 'model',
    effort: null,
    toolCount: 3,
    tools: { Read: 2, Bash: 1 },
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

describe('buildStopConfirmRow', () => {
  it('產生確認與取消按鈕，customId 帶有 threadId', () => {
    const row = buildStopConfirmRow('thread-1').toJSON();

    expect(row.type).toBe(ComponentType.ActionRow);
    expect(row.components).toHaveLength(2);

    const [confirm, cancel] = row.components;
    expect(confirm).toMatchObject({
      custom_id: 'confirm_stop:thread-1',
      style: ButtonStyle.Danger,
    });
    expect(cancel).toMatchObject({
      custom_id: 'cancel_stop:thread-1',
      style: ButtonStyle.Secondary,
    });
  });
});

describe('executeStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('無 session 時靜默返回', async () => {
    const store = new StateStore();
    const client = { channels: { fetch: vi.fn() } };
    await executeStop('nonexistent', store, client as never);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('中斷 abortController', async () => {
    const store = new StateStore();
    const session = makeSession('t1');
    store.setSession('t1', session);

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          setArchived: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    await executeStop('t1', store, client as never);
    expect(session.abortController.signal.aborted).toBe(true);
  });

  it('自動拒絕待審批請求', async () => {
    const store = new StateStore();
    const session = makeSession('t1');
    store.setSession('t1', session);

    const resolveResult = vi.fn();
    store.setPendingApproval('t1', {
      toolName: 'Bash',
      toolInput: {},
      messageId: 'msg',
      resolve: resolveResult,
      createdAt: new Date(),
    });

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          setArchived: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    await executeStop('t1', store, client as never);
    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'deny' }),
    );
  });

  it('清除 session', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1'));

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          setArchived: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    await executeStop('t1', store, client as never);
    expect(store.getSession('t1')).toBeNull();
  });
});
