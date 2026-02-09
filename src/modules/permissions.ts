import type { BotConfig, Project } from '../types.js';

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
 * 檢查頻道是否為指定頻道（含 Thread 的父頻道）
 * @param channelId - 目前頻道 ID
 * @param allowedChannelId - 允許的頻道 ID
 * @param parentChannelId - Thread 的父頻道 ID（選填）
 * @returns 是否為允許的頻道
 */
export function isChannelAuthorized(
  channelId: string,
  allowedChannelId: string,
  parentChannelId?: string | null,
): boolean {
  return channelId === allowedChannelId || parentChannelId === allowedChannelId;
}

/**
 * 綜合檢查使用者與頻道權限
 * @param userId - 使用者 ID
 * @param channelId - 目前頻道 ID
 * @param config - Bot 設定
 * @param parentChannelId - Thread 的父頻道 ID（選填）
 * @returns 檢查結果（含是否允許及拒絕原因）
 */
export function canExecuteCommand(
  userId: string,
  channelId: string,
  config: BotConfig,
  parentChannelId?: string | null,
): { allowed: boolean; reason?: string } {
  if (!isUserAuthorized(userId, config.allowedUserIds)) {
    return { allowed: false, reason: '你沒有權限使用此指令' };
  }

  if (!isChannelAuthorized(channelId, config.discordChannelId, parentChannelId)) {
    return { allowed: false, reason: '此指令只能在指定頻道使用' };
  }

  return { allowed: true };
}

/**
 * 檢查 CWD 是否在允許的專案路徑中
 * @param cwd - 要檢查的工作目錄
 * @param projects - 允許的專案列表
 * @returns 是否為允許的工作目錄
 */
export function isAllowedCwd(cwd: string, projects: Project[]): boolean {
  return projects.some((p) => p.path === cwd);
}
