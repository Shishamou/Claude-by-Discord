import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type Client,
  type ThreadChannel,
} from 'discord.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Stop' });

/**
 * 建立「中止任務」按鈕列（掛在完成通知訊息上）
 * 點擊後直接中止，不再二次確認。
 * @param threadId - 要中止的工作階段所在 Thread ID
 * @returns 含單一中止按鈕的 ActionRow
 */
export function buildEndButtonRow(threadId: string): ActionRowBuilder<ButtonBuilder> {
  const endBtn = new ButtonBuilder()
    .setCustomId(`end:${threadId}`)
    .setLabel('中止任務')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🛑');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(endBtn);
}

/**
 * 直接中止工作階段：中斷查詢、印出 session id 供 `claude -r` 還原，並封存 Thread。
 * 不發送統計摘要。可由完成通知的按鈕或閒置逾時 sweep 觸發。
 * @param threadId - 要中止的工作階段所在 Thread ID
 * @param store - 工作階段狀態儲存
 * @param client - Discord Client 實例，用於取得 Thread 頻道
 * @param reason - 中止原因（顯示於訊息首行）
 * @returns 無回傳值
 */
export async function executeEnd(
  threadId: string,
  store: StateStore,
  client: Client,
  reason = '任務已中止',
): Promise<void> {
  const session = store.getSession(threadId);
  if (!session) return;

  // 中斷執行
  session.abortController.abort();

  // 如有待審批，自動拒絕
  if (session.pendingApproval) {
    store.resolvePendingApproval(threadId, {
      behavior: 'deny',
      message: '使用者已中止任務',
    });
  }

  // 發送中止通知 + 還原指令到 Thread，然後封存
  try {
    const channel = await client.channels.fetch(threadId);
    if (channel?.isThread()) {
      const thread = channel as ThreadChannel;
      if (thread.archived) await thread.setArchived(false);

      const lines = [`🛑 ${reason}`];
      if (session.sessionId) {
        lines.push(
          `Session ID： \`${session.sessionId}\``,
          `還原此對話：於 \`${session.cwd}\` 執行 \`claude -r ${session.sessionId}\``,
        );
      } else {
        lines.push('（此 Session 尚未建立 ID，無法還原）');
      }
      await thread.send(lines.join('\n'));
      await thread.setArchived(true);
    }
  } catch (err) {
    log.warn({ err, threadId }, '發送中止通知失敗（非致命）');
  }

  store.clearSession(threadId);
}
