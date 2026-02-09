import type { TokenUsage } from '../types.js';
import { emptyTokenUsage, mergeTokenUsage } from '../modules/token-usage.js';

/** Bot 啟動以來的全域用量統計快照 */
export interface GlobalUsageStats {
  bootedAt: Date;
  totalSessions: number;
  completedQueries: number;
  totalUsage: TokenUsage;
  totalCostUsd: number;
  totalDurationMs: number;
}

/** 單一 Session 的累計用量紀錄 */
export interface SessionUsageRecord {
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
}

/** 全域 Token 用量追蹤（記憶體內，重啟後歸零） */
export class UsageStore {
  private bootedAt = new Date();
  private totalSessions = 0;
  private completedQueries = 0;
  private totalUsage: TokenUsage = emptyTokenUsage();
  private totalCostUsd = 0;
  private totalDurationMs = 0;
  private sessionUsage = new Map<string, SessionUsageRecord>();

  /** 記錄新 Session 開始，累加 totalSessions 計數 */
  recordSessionStart(): void {
    this.totalSessions++;
  }

  /**
   * 記錄一次查詢結果的用量，同時更新全域與 Session 層級統計
   * @param threadId - Discord Thread ID
   * @param usage - 本次 Token 使用量
   * @param costUsd - 本次費用（美元）
   * @param durationMs - 本次耗時（毫秒）
   */
  recordResult(threadId: string, usage: TokenUsage, costUsd: number, durationMs: number): void {
    this.completedQueries++;
    this.totalUsage = mergeTokenUsage(this.totalUsage, usage);
    this.totalCostUsd += costUsd;
    this.totalDurationMs += durationMs;

    const existing = this.sessionUsage.get(threadId);
    if (existing) {
      existing.usage = mergeTokenUsage(existing.usage, usage);
      existing.costUsd += costUsd;
      existing.durationMs += durationMs;
    } else {
      this.sessionUsage.set(threadId, { usage: { ...usage }, costUsd, durationMs });
    }
  }

  /**
   * 取得全域用量統計快照
   * @returns 包含啟動時間、Session 數、Token 用量等的快照物件
   */
  getGlobalStats(): GlobalUsageStats {
    return {
      bootedAt: this.bootedAt,
      totalSessions: this.totalSessions,
      completedQueries: this.completedQueries,
      totalUsage: { ...this.totalUsage },
      totalCostUsd: this.totalCostUsd,
      totalDurationMs: this.totalDurationMs,
    };
  }

  /**
   * 取得指定 Session 的累計用量
   * @param threadId - Discord Thread ID
   * @returns 用量紀錄，不存在時回傳 undefined
   */
  getSessionUsage(threadId: string): SessionUsageRecord | undefined {
    const record = this.sessionUsage.get(threadId);
    if (!record) return undefined;
    return { usage: { ...record.usage }, costUsd: record.costUsd, durationMs: record.durationMs };
  }
}
