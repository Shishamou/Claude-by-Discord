import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonStyle, ComponentType } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { SessionState } from '../types.js';
import { executeEnd, buildEndButtonRow } from './stop.js';

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

/** 建立一個假的 Thread channel，記錄 send/setArchived 呼叫 */
function makeThreadClient() {
  const send = vi.fn().mockResolvedValue(undefined);
  const setArchived = vi.fn().mockResolvedValue(undefined);
  const thread = { isThread: () => true, archived: false, send, setArchived };
  const client = { channels: { fetch: vi.fn().mockResolvedValue(thread) } };
  return { client, thread, send, setArchived };
}

describe('buildEndButtonRow', () => {
  it('產生單一中止按鈕，customId 帶有 threadId', () => {
    const row = buildEndButtonRow('thread-1').toJSON();

    expect(row.type).toBe(ComponentType.ActionRow);
    expect(row.components).toHaveLength(1);
    expect(row.components[0]).toMatchObject({
      custom_id: 'end:thread-1',
      style: ButtonStyle.Danger,
    });
  });
});

describe('executeEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('無 session 時靜默返回', async () => {
    const store = new StateStore();
    const { client } = makeThreadClient();
    await executeEnd('nonexistent', store, client as never);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('中斷 abortController', async () => {
    const store = new StateStore();
    const session = makeSession('t1');
    store.setSession('t1', session);

    const { client } = makeThreadClient();
    await executeEnd('t1', store, client as never);
    expect(session.abortController.signal.aborted).toBe(true);
  });

  it('自動拒絕待審批請求', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1'));

    const resolveResult = vi.fn();
    store.setPendingApproval('t1', {
      toolName: 'Bash',
      toolInput: {},
      messageId: 'msg',
      resolve: resolveResult,
      createdAt: new Date(),
    });

    const { client } = makeThreadClient();
    await executeEnd('t1', store, client as never);
    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'deny' }),
    );
  });

  it('印出 session id 與 claude -r 還原指令', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1', { sessionId: 'sess-abc', cwd: '/proj' }));

    const { client, send } = makeThreadClient();
    await executeEnd('t1', store, client as never);

    const sent = send.mock.calls[0][0] as string;
    expect(sent).toContain('sess-abc');
    expect(sent).toContain('claude -r sess-abc');
    expect(sent).toContain('/proj');
  });

  it('無 session id 時提示無法還原', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1', { sessionId: null }));

    const { client, send } = makeThreadClient();
    await executeEnd('t1', store, client as never);

    expect(send.mock.calls[0][0] as string).toContain('無法還原');
  });

  it('使用傳入的 reason 作為訊息首行', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1'));

    const { client, send } = makeThreadClient();
    await executeEnd('t1', store, client as never, '閒置逾 30 分鐘，自動中止');

    expect(send.mock.calls[0][0] as string).toContain('閒置逾 30 分鐘，自動中止');
  });

  it('封存 Thread 並清除 session', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1'));

    const { client, setArchived } = makeThreadClient();
    await executeEnd('t1', store, client as never);

    expect(setArchived).toHaveBeenCalledWith(true);
    expect(store.getSession('t1')).toBeNull();
  });
});
