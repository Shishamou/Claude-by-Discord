import type { BotConfig, ChannelConfig } from '../types.js';

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
 * 檢查頻道權限（存取控制改由 Discord 頻道權限把關，不再檢查使用者白名單）
 * @param channelId - 目前頻道 ID
 * @param config - Bot 設定
 * @param parentChannelId - Thread 的父頻道 ID（選填）
 * @returns 檢查結果（含是否允許、拒絕原因及對應的頻道設定）
 */
export function canExecuteCommand(
  channelId: string,
  config: BotConfig,
  parentChannelId?: string | null,
): { allowed: boolean; reason?: string; channel?: ChannelConfig } {
  const channel = resolveChannelConfig(channelId, parentChannelId, config.channels);
  if (!channel) {
    return { allowed: false, reason: '此指令只能在已設定的頻道使用' };
  }

  return { allowed: true, channel };
}
