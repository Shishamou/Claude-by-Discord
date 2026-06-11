import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type Client,
  type ThreadChannel,
} from 'discord.js';
import type { StateStore } from '../effects/state-store.js';
import { buildStopConfirmEmbed } from '../modules/embeds.js';
import { sendInThread } from '../effects/discord-sender.js';

/**
 * 建立「確認中斷 / 取消」按鈕列（由 stop_request 按鈕觸發後顯示）
 * @param threadId - 要中斷的工作階段所在 Thread ID
 * @returns 含確認與取消按鈕的 ActionRow
 */
export function buildStopConfirmRow(threadId: string): ActionRowBuilder<ButtonBuilder> {
  const confirmBtn = new ButtonBuilder()
    .setCustomId(`confirm_stop:${threadId}`)
    .setLabel('確認中斷')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🛑');

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`cancel_stop:${threadId}`)
    .setLabel('取消')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

/**
 * 執行實際的中斷邏輯（由 confirm_stop 按鈕觸發）
 * @param threadId - 要中斷的工作階段所在 Thread ID
 * @param store - 工作階段狀態儲存
 * @param client - Discord Client 實例，用於取得 Thread 頻道
 * @returns 無回傳值
 */
export async function executeStop(
  threadId: string,
  store: StateStore,
  client: Client,
): Promise<void> {
  const session = store.getSession(threadId);
  if (!session) return;

  // 中斷執行
  session.abortController.abort();

  // 如有待審批，自動拒絕
  if (session.pendingApproval) {
    store.resolvePendingApproval(threadId, {
      behavior: 'deny',
      message: '使用者已中斷任務',
    });
  }

  // 計算執行時間
  const durationMs = Date.now() - session.startedAt.getTime();

  // 發送中斷確認到 Thread
  try {
    const channel = await client.channels.fetch(threadId);
    if (channel?.isThread()) {
      const thread = channel as ThreadChannel;
      const embed = buildStopConfirmEmbed(
        { toolCount: session.toolCount, tools: session.tools },
        durationMs,
      );
      await sendInThread(thread, embed);
      await thread.setArchived(true);
    }
  } catch {
    // Thread 可能已不存在
  }

  store.clearSession(threadId);
}
