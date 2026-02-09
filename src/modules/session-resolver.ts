import type { ChatInputCommandInteraction } from 'discord.js';
import type { StateStore } from '../effects/state-store.js';

/**
 * 從互動上下文解析 threadId
 * - 若在 Thread 內：回傳該 Thread ID
 * - 若不在 Thread 內：若只有 1 個活躍 session 則回傳其 threadId，否則回傳 null
 * @param interaction - Discord 指令互動
 * @param store - 狀態儲存（用於查詢活躍 Session）
 * @returns 解析出的 threadId，或 null 表示無法判定
 */
export function resolveThreadId(
  interaction: ChatInputCommandInteraction,
  store: StateStore,
): string | null {
  const channel = interaction.channel;
  if (channel?.isThread()) {
    return channel.id;
  }

  // 不在 Thread 中，嘗試找唯一的活躍 session
  const activeSessions = store.getAllActiveSessions();
  if (activeSessions.size === 1) {
    return activeSessions.keys().next().value ?? null;
  }

  return null;
}
