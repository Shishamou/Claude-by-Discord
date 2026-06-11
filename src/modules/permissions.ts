import type { BotConfig, ChannelConfig } from '../types.js';

/**
 * 檢查使用者是否在允許名單中
 * @param userId - 使用者 ID
 * @param allowedIds - 允許的使用者 ID 列表
 * @returns 是否在允許名單中
 */
export function isUserAuthorized(userId: string, allowedIds: string[]): boolean {
  return allowedIds.includes(userId);
}

/**
 * 從頻道設定清單中解析出對應的頻道設定（含 Thread 的父頻道）
 * @param channelId - 目前頻道 ID
 * @param parentChannelId - Thread 的父頻道 ID（選填）
 * @param channels - 頻道設定清單
 * @returns 對應的頻道設定，找不到時回傳 null
 */
export function resolveChannelConfig(
  channelId: string,
  parentChannelId: string | null | undefined,
  channels: ChannelConfig[],
): ChannelConfig | null {
  return (
    channels.find((c) => c.channelId === channelId || c.channelId === parentChannelId) ?? null
  );
}

/**
 * 綜合檢查使用者與頻道權限
 * @param userId - 使用者 ID
 * @param channelId - 目前頻道 ID
 * @param config - Bot 設定
 * @param parentChannelId - Thread 的父頻道 ID（選填）
 * @returns 檢查結果（含是否允許、拒絕原因及對應的頻道設定）
 */
export function canExecuteCommand(
  userId: string,
  channelId: string,
  config: BotConfig,
  parentChannelId?: string | null,
): { allowed: boolean; reason?: string; channel?: ChannelConfig } {
  if (!isUserAuthorized(userId, config.allowedUserIds)) {
    return { allowed: false, reason: '你沒有權限使用此指令' };
  }

  const channel = resolveChannelConfig(channelId, parentChannelId, config.channels);
  if (!channel) {
    return { allowed: false, reason: '此指令只能在已設定的頻道使用' };
  }

  return { allowed: true, channel };
}
