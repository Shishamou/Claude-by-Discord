import { describe, it, expect } from 'vitest';
import { resolveThreadId } from './session-resolver.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { StateStore } from '../effects/state-store.js';

function makeInteraction(inThread: boolean, channelId = 'ch1'): ChatInputCommandInteraction {
  return {
    channel: inThread
      ? { id: channelId, isThread: () => true }
      : { id: channelId, isThread: () => false },
  } as unknown as ChatInputCommandInteraction;
}

function makeStoreWithSessions(threadIds: string[]): StateStore {
  const store = new StateStore();
  for (const id of threadIds) {
    store.setSession(id, {
      sessionId: null,
      status: 'running',
      threadId: id,
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
  }
  return store;
}

describe('resolveThreadId', () => {
  it('在 Thread 內回傳該 Thread ID', () => {
    const store = new StateStore();
    const result = resolveThreadId(makeInteraction(true, 'thread-123'), store);
    expect(result).toBe('thread-123');
  });

  it('不在 Thread 內且有 1 個活躍 session 時回傳其 threadId', () => {
    const store = makeStoreWithSessions(['t1']);
    const result = resolveThreadId(makeInteraction(false), store);
    expect(result).toBe('t1');
  });

  it('不在 Thread 內且有多個活躍 session 時回傳 null', () => {
    const store = makeStoreWithSessions(['t1', 't2']);
    const result = resolveThreadId(makeInteraction(false), store);
    expect(result).toBeNull();
  });

  it('不在 Thread 內且沒有活躍 session 時回傳 null', () => {
    const store = new StateStore();
    const result = resolveThreadId(makeInteraction(false), store);
    expect(result).toBeNull();
  });
});
