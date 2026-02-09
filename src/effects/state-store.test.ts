import { describe, it, expect } from 'vitest';
import { StateStore } from './state-store.js';
import type { SessionState, PendingApproval } from '../types.js';

function makeSession(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: null,
    status: 'running',
    threadId: 'thread-1',
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test prompt',
    cwd: '/test',
    model: 'claude-sonnet-4-5-20250929',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

describe('StateStore', () => {
  it('setSession / getSession', () => {
    const store = new StateStore();
    const session = makeSession();
    store.setSession('t1', session);
    expect(store.getSession('t1')).toBe(session);
  });

  it('getSession 不存在時回傳 null', () => {
    const store = new StateStore();
    expect(store.getSession('nonexistent')).toBeNull();
  });

  it('clearSession 移除 session', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.clearSession('t1');
    expect(store.getSession('t1')).toBeNull();
  });

  it('updateSession 部分更新', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.updateSession('t1', { status: 'completed' });
    expect(store.getSession('t1')?.status).toBe('completed');
  });

  it('updateSession 不存在時無動作', () => {
    const store = new StateStore();
    // 不應拋錯
    store.updateSession('nonexistent', { status: 'error' });
  });

  it('recordToolUse 累加計數', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.recordToolUse('t1', 'Read');
    store.recordToolUse('t1', 'Read');
    store.recordToolUse('t1', 'Write');
    const session = store.getSession('t1')!;
    expect(session.toolCount).toBe(3);
    expect(session.tools['Read']).toBe(2);
    expect(session.tools['Write']).toBe(1);
  });

  it('getAllActiveSessions 排除 completed/error', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession({ status: 'running' }));
    store.setSession('t2', makeSession({ status: 'completed' }));
    store.setSession('t3', makeSession({ status: 'error' }));
    store.setSession('t4', makeSession({ status: 'awaiting_permission' }));
    const active = store.getAllActiveSessions();
    expect(active.size).toBe(2);
    expect(active.has('t1')).toBe(true);
    expect(active.has('t4')).toBe(true);
  });

  it('getActiveSessionCount', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession({ status: 'running' }));
    store.setSession('t2', makeSession({ status: 'completed' }));
    expect(store.getActiveSessionCount()).toBe(1);
  });

  it('setPendingApproval / getPendingApproval', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());

    const approval: PendingApproval = {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      messageId: 'msg-1',
      resolve: () => {},
      createdAt: new Date(),
    };

    store.setPendingApproval('t1', approval);
    expect(store.getPendingApproval('t1')).toBe(approval);
    expect(store.getSession('t1')?.status).toBe('awaiting_permission');
  });

  it('recordToolUse 不存在的 session 無動作', () => {
    const store = new StateStore();
    // 不應拋錯
    store.recordToolUse('nonexistent', 'Read');
  });

  it('getPendingApproval 不存在的 session 回傳 null', () => {
    const store = new StateStore();
    expect(store.getPendingApproval('nonexistent')).toBeNull();
  });

  it('setPendingApproval 不存在的 session 無動作', () => {
    const store = new StateStore();
    store.setPendingApproval('nonexistent', {
      toolName: 'Bash',
      toolInput: {},
      messageId: 'msg',
      resolve: () => {},
      createdAt: new Date(),
    });
    // 不應有 session 被建立
    expect(store.getSession('nonexistent')).toBeNull();
  });

  it('resolvePendingApproval 無 pending 時無動作', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    // 不應拋錯
    store.resolvePendingApproval('t1', { behavior: 'deny', message: 'test' });
    expect(store.getSession('t1')?.status).toBe('running');
  });

  it('clearSession 不存在的 key 無動作', () => {
    const store = new StateStore();
    store.clearSession('nonexistent');
    // 不應拋錯
  });

  it('updateSession 更新 lastActivityAt', () => {
    const store = new StateStore();
    const oldDate = new Date(2020, 0, 1);
    store.setSession('t1', makeSession({ lastActivityAt: oldDate }));
    store.updateSession('t1', { status: 'completed' });
    expect(store.getSession('t1')!.lastActivityAt.getTime()).toBeGreaterThan(oldDate.getTime());
  });

  it('getAllActiveSessions 包含 waiting_input', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession({ status: 'waiting_input' }));
    expect(store.getAllActiveSessions().size).toBe(1);
  });

  it('resolvePendingApproval', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());

    let resolved = false;
    const approval: PendingApproval = {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      messageId: 'msg-1',
      resolve: () => { resolved = true; },
      createdAt: new Date(),
    };

    store.setPendingApproval('t1', approval);
    store.resolvePendingApproval('t1', { behavior: 'allow' });

    expect(resolved).toBe(true);
    expect(store.getPendingApproval('t1')).toBeNull();
    expect(store.getSession('t1')?.status).toBe('running');
  });
});
