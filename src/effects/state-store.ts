import type { SessionState, PendingApproval, PermissionResult } from '../types.js';

/** 記憶體內 Session 狀態管理，以 Discord Thread ID 為 key */
export class StateStore {
  private sessions = new Map<string, SessionState>();

  /**
   * 取得指定 Thread 的 Session
   * @param threadId - Discord Thread ID
   * @returns Session 狀態，不存在時回傳 null
   */
  getSession(threadId: string): SessionState | null {
    return this.sessions.get(threadId) ?? null;
  }

  /**
   * 儲存 Session 狀態
   * @param threadId - Discord Thread ID
   * @param state - 完整的 Session 狀態
   */
  setSession(threadId: string, state: SessionState): void {
    this.sessions.set(threadId, state);
  }

  /**
   * 部分更新 Session 欄位，同時刷新 lastActivityAt
   * @param threadId - Discord Thread ID
   * @param update - 要更新的欄位
   */
  updateSession(threadId: string, update: Partial<SessionState>): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    Object.assign(session, update, { lastActivityAt: new Date() });
  }

  /**
   * 清除並刪除 Session
   * @param threadId - Discord Thread ID
   */
  clearSession(threadId: string): void {
    this.sessions.delete(threadId);
  }

  /**
   * 記錄一次工具使用，累加計數並刷新 lastActivityAt
   * @param threadId - Discord Thread ID
   * @param toolName - 使用的工具名稱
   */
  recordToolUse(threadId: string, toolName: string): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.toolCount++;
    session.tools[toolName] = (session.tools[toolName] || 0) + 1;
    session.lastActivityAt = new Date();
  }

  /**
   * 取得指定 Session 的待審批項目
   * @param threadId - Discord Thread ID
   * @returns 待審批項目，不存在時回傳 null
   */
  getPendingApproval(threadId: string): PendingApproval | null {
    const session = this.sessions.get(threadId);
    return session?.pendingApproval ?? null;
  }

  /**
   * 設定待審批項目，同時將 Session 狀態切為 `awaiting_permission`
   * @param threadId - Discord Thread ID
   * @param approval - 待審批項目
   */
  setPendingApproval(threadId: string, approval: PendingApproval): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.pendingApproval = approval;
    session.status = 'awaiting_permission';
  }

  /**
   * 解決待審批項目：呼叫 resolve 後清除 pending 並恢復 `running` 狀態
   * @param threadId - Discord Thread ID
   * @param result - 審批結果（allow/deny）
   */
  resolvePendingApproval(threadId: string, result: PermissionResult): void {
    const session = this.sessions.get(threadId);
    if (!session?.pendingApproval) return;
    session.pendingApproval.resolve(result);
    session.pendingApproval = null;
    session.status = 'running';
  }

  /**
   * 取得所有活躍 Session（排除 completed 與 error 狀態）
   * @returns threadId → SessionState 的 Map
   */
  getAllActiveSessions(): Map<string, SessionState> {
    const active = new Map<string, SessionState>();
    for (const [threadId, session] of this.sessions) {
      if (session.status !== 'completed' && session.status !== 'error') {
        active.set(threadId, session);
      }
    }
    return active;
  }

  /**
   * 取得活躍 Session 數量
   * @returns 非 completed/error 的 Session 數
   */
  getActiveSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status !== 'completed' && session.status !== 'error') {
        count++;
      }
    }
    return count;
  }
}
