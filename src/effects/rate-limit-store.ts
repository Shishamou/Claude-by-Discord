import type { RateLimitEntry } from '../modules/rate-limiter.js';

/** 記憶體內 Rate Limit 儲存，以 userId 為 key */
export class RateLimitStore {
  private entries = new Map<string, RateLimitEntry>();

  /**
   * 取得指定使用者的限流紀錄
   * @param userId - Discord 使用者 ID
   * @returns 限流紀錄，不存在時回傳 undefined
   */
  getEntry(userId: string): RateLimitEntry | undefined {
    return this.entries.get(userId);
  }

  /**
   * 儲存或更新指定使用者的限流紀錄
   * @param userId - Discord 使用者 ID
   * @param entry - 更新後的限流紀錄
   */
  setEntry(userId: string, entry: RateLimitEntry): void {
    this.entries.set(userId, entry);
  }
}
