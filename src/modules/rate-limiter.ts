/** 單一使用者的請求時間戳紀錄 */
export interface RateLimitEntry {
  timestamps: number[];
}

/** Rate Limit 設定參數 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/** Rate Limit 檢查結果 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  remaining: number;
}

/**
 * 檢查使用者是否已達到限流
 * @param entry - 使用者的請求時間戳紀錄（undefined 表示無紀錄）
 * @param config - Rate Limit 設定參數
 * @param now - 目前時間戳（毫秒）
 * @returns 限流檢查結果（含是否允許、剩餘次數、重試等待時間）
 */
export function checkRateLimit(
  entry: RateLimitEntry | undefined,
  config: RateLimitConfig,
  now: number,
): RateLimitResult {
  if (!entry || entry.timestamps.length === 0) {
    return { allowed: true, remaining: config.maxRequests };
  }

  // 只保留在時間窗口內的紀錄
  const validTimestamps = entry.timestamps.filter(
    (t) => now - t < config.windowMs,
  );

  const remaining = config.maxRequests - validTimestamps.length;

  if (remaining <= 0) {
    // 計算最早的紀錄過期時間
    const oldest = Math.min(...validTimestamps);
    const retryAfterMs = config.windowMs - (now - oldest);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  return { allowed: true, remaining };
}

/**
 * 記錄一次請求，回傳更新後的 entry
 * @param entry - 使用者的請求時間戳紀錄（undefined 表示無紀錄）
 * @param now - 目前時間戳（毫秒）
 * @param windowMs - 時間窗口大小（毫秒）
 * @returns 更新後的請求時間戳紀錄
 */
export function recordRequest(
  entry: RateLimitEntry | undefined,
  now: number,
  windowMs: number,
): RateLimitEntry {
  const timestamps = entry
    ? entry.timestamps.filter((t) => now - t < windowMs)
    : [];
  timestamps.push(now);
  return { timestamps };
}
